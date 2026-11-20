"""Private bounded history-read checkpoints; no network, queues or cloud writes.

Only a fully checked source window may be recorded. ``finalize`` never clears
progress: call ``ack`` only after the existing cloud writer/readback succeeds.
The checksum detects corruption, not malicious changes by the owning account.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import uuid

TZ = timezone(timedelta(hours=8))
TTL_SECONDS = 72 * 3600
SCOPE_FIELDS = {"host", "customer_id", "card_id", "store_id", "session_shop", "session_user", "session_employee"}
ROW_FIELDS = {"bill_id", "id", "source_id", "bill_no", "date", "time", "amount", "items", "barber", "staff", "shop", "comment", "bill_type", "consume_type", "card_type", "detail_fetch_error"}


class ResumeError(RuntimeError):
    code = "resume_error"
    def __init__(self, revision=None):
        self.revision = revision
        super().__init__(self.code)


class ResumeConflict(ResumeError): code = "resume_conflict"
class ResumeExpired(ResumeError): code = "resume_expired"
class ResumeCorrupt(ResumeError): code = "resume_corrupt"
class ResumeIncomplete(ResumeError): code = "resume_incomplete"
class ResumeReadOnly(ResumeError): code = "resume_read_only"
class ResumeCapacity(ResumeError): code = "resume_capacity"
class ResumeBusy(ResumeError): code = "resume_busy"
class ResumeInvalid(ResumeError): code = "resume_invalid"


def _json(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError, UnicodeError):
        raise ResumeInvalid() from None


def _day(value):
    try:
        result = date.fromisoformat(value)
        if result.isoformat() != value: raise ValueError()
        return result
    except (TypeError, ValueError):
        raise ResumeInvalid() from None


def _owner(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ResumeInvalid()
    return value


def _scope(value):
    if not isinstance(value, dict) or set(value) != SCOPE_FIELDS:
        raise ResumeInvalid()
    if any(not isinstance(v, str) or not v or len(v) > 160 or v.strip() != v for v in value.values()):
        raise ResumeInvalid()
    if value["host"] != "vip12.meiguanjia.net": raise ResumeInvalid()
    return hashlib.sha256(_json(value)).hexdigest()


def bill_key(row):
    if not isinstance(row, dict): raise ResumeInvalid()
    key = row.get("id") or row.get("bill_id") or row.get("source_id")
    if not isinstance(key, str) or not key or len(key) > 160: raise ResumeInvalid()
    return key


def _row(row):
    if not isinstance(row, dict) or set(row) - ROW_FIELDS: raise ResumeInvalid()
    bill_key(row)
    _day(row.get("date"))
    error = row.get("detail_fetch_error")
    if error is not None and (not isinstance(error, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", error)):
        raise ResumeInvalid()
    for field in ("amount",):
        value = row.get(field)
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
            raise ResumeInvalid()
    for field in ("bill_id", "id", "source_id", "bill_no", "time", "barber", "shop", "comment", "card_type"):
        value = row.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > (8192 if field == "comment" else 1024)):
            raise ResumeInvalid()
    for field in ("bill_type", "consume_type"):
        if row.get(field) is not None and type(row[field]) not in (str, int): raise ResumeInvalid()
    staff = row.get("staff", [])
    if not isinstance(staff, list) or len(staff) > 100 or any(not isinstance(s, str) or len(s) > 160 for s in staff):
        raise ResumeInvalid()
    items = row.get("items", [])
    if not isinstance(items, list) or len(items) > 2000: raise ResumeInvalid()
    for item in items:
        if not isinstance(item, dict) or set(item) - {"name", "quantity", "price", "list_price"}:
            raise ResumeInvalid()
        if not isinstance(item.get("name"), str) or len(item["name"]) > 1024: raise ResumeInvalid()
        for field in ("quantity", "price", "list_price"):
            if field in item and (type(item[field]) not in (int, float) or not math.isfinite(item[field])):
                raise ResumeInvalid()
    if len(_json(row)) > 65536: raise ResumeCapacity()
    return copy.deepcopy(row)


def _base_windows(start, anchor):
    first, last = _day(start), _day(anchor)
    if first > last or (last - first).days > 365 * 128: raise ResumeInvalid()
    windows = []
    while last >= first:
        begin = max(first, last - timedelta(days=364))
        windows.append({"start": begin.isoformat(), "end": last.isoformat()})
        last = begin - timedelta(days=1)
    return windows


class HistoryResumeStore:
    def __init__(self, root=None, read_only=False, clock=time.time, max_files=256,
                 max_file_bytes=4 * 1024 * 1024, max_total_bytes=64 * 1024 * 1024,
                 max_rows=20000):
        self.root = Path(root or Path.home() / ".hermes/mgj_customer_history_resume")
        self.read_only = read_only
        self.clock = clock
        self.max_files = max_files
        self.max_file_bytes = max_file_bytes
        self.max_total_bytes = max_total_bytes
        self.max_rows = max_rows
        self._refresh_receipts = {}

    def _today(self):
        return datetime.fromtimestamp(self.clock(), TZ).date()

    def _directory(self, write=False):
        if write and self.read_only: raise ResumeReadOnly()
        try: info = self.root.lstat()
        except FileNotFoundError:
            if not write: return False
            try: self.root.mkdir(mode=0o700)
            except FileExistsError: pass
            info = self.root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ResumeCorrupt()
        return True

    def _path(self, owner_key):
        return self.root / (_owner(owner_key) + ".json")

    @contextmanager
    def _lock(self):
        self._directory(write=True)
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        try: fd = os.open(self.root / ".lock", flags, 0o600)
        except OSError: raise ResumeCorrupt() from None
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise ResumeCorrupt()
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise ResumeBusy() from None
            yield
        finally: os.close(fd)

    def _read(self, owner_key):
        if not self._directory(): return None
        try: fd = os.open(self._path(owner_key), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except FileNotFoundError: return None
        except OSError: raise ResumeCorrupt() from None
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise ResumeCorrupt()
            if info.st_size > self.max_file_bytes: raise ResumeCapacity()
            with os.fdopen(fd, "rb", closefd=False) as handle:
                raw = handle.read(self.max_file_bytes + 1)
            if len(raw) > self.max_file_bytes: raise ResumeCapacity()
            envelope = json.loads(raw)
            state = envelope["state"]
            if set(envelope) != {"state", "sha256"} or envelope["sha256"] != hashlib.sha256(_json(state)).hexdigest():
                raise ResumeCorrupt()
            self._validate(state, owner_key)
            return state
        except ResumeError: raise
        except (ValueError, KeyError, TypeError, RecursionError): raise ResumeCorrupt() from None
        finally: os.close(fd)

    def _validate(self, state, owner_key):
        keys = {"schema_version", "owner_key", "scope_hash", "cycle_id", "revision", "created_at", "expires_at", "start_date", "anchor_date", "detail_limit", "windows", "enrichment_ids", "enrichments", "recent_refresh_id"}
        try:
            if not isinstance(state, dict) or set(state) != keys or state["schema_version"] != 1 or state["owner_key"] != owner_key:
                raise ResumeCorrupt()
            _owner(state["scope_hash"])
            if str(uuid.UUID(state["cycle_id"])) != state["cycle_id"]: raise ResumeCorrupt()
            refresh_id = state["recent_refresh_id"]
            if refresh_id is not None and str(uuid.UUID(refresh_id)) != refresh_id: raise ResumeCorrupt()
            if type(state["revision"]) is not int or state["revision"] < 1: raise ResumeCorrupt()
            if type(state["detail_limit"]) is not int or not 0 <= state["detail_limit"] <= 2: raise ResumeCorrupt()
            if any(type(state[k]) not in (int, float) or not math.isfinite(state[k]) for k in ("created_at", "expires_at")):
                raise ResumeCorrupt()
            if state["expires_at"] != state["created_at"] + TTL_SECONDS or state["created_at"] > self.clock() + 5:
                raise ResumeCorrupt()
            base = _base_windows(state["start_date"], state["anchor_date"])
            if not isinstance(state["windows"], list) or not isinstance(state["enrichments"], dict): raise ResumeCorrupt()
            seen = {}
            end = _day(state["anchor_date"])
            for index, window in enumerate(state["windows"]):
                if not isinstance(window, dict) or set(window) != {"start", "end", "rows"}: raise ResumeCorrupt()
                begin, finish = _day(window["start"]), _day(window["end"])
                if index < len(base):
                    if {"start": window["start"], "end": window["end"]} != base[index]: raise ResumeCorrupt()
                else:
                    if begin != end + timedelta(days=1) or not begin <= finish <= self._today() or (finish - begin).days > 364:
                        raise ResumeCorrupt()
                    end = finish
                if not isinstance(window["rows"], list): raise ResumeCorrupt()
                for row in window["rows"]:
                    item = _row(row)
                    if not begin <= _day(item["date"]) <= finish: raise ResumeCorrupt()
                    key = bill_key(item)
                    if key in seen: raise ResumeCorrupt()
                    seen[key] = item
            if len(seen) > self.max_rows: raise ResumeCapacity()
            selected = state["enrichment_ids"]
            if selected is not None:
                if (not isinstance(selected, list) or len(selected) > state["detail_limit"]
                        or any(not isinstance(key, str) or key not in seen for key in selected)
                        or len(set(selected)) != len(selected)):
                    raise ResumeCorrupt()
            if len(state["enrichments"]) > state["detail_limit"]: raise ResumeCorrupt()
            for key, row in state["enrichments"].items():
                item = _row(row)
                if (selected is None or key not in selected or key not in seen or key != bill_key(item)
                        or not _day(state["start_date"]) <= _day(item["date"]) <= end):
                    raise ResumeCorrupt()
        except ResumeError as exc:
            if isinstance(exc, ResumeCapacity): raise
            raise ResumeCorrupt() from None
        except (ValueError, KeyError, TypeError, AttributeError): raise ResumeCorrupt() from None

    def _live(self, state):
        if self.clock() >= state["expires_at"]: raise ResumeExpired(state["revision"])
        return state

    def load(self, owner_key, scope):
        owner_key, scope_hash = _owner(owner_key), _scope(scope)
        state = self._read(owner_key)
        if state is None: return None
        if state["scope_hash"] != scope_hash: raise ResumeConflict(state["revision"])
        return copy.deepcopy(self._live(state))

    def peek(self, owner_key):
        state = self._read(_owner(owner_key))
        if state is None or self.clock() >= state["expires_at"] or not state["windows"]: return None
        return {k: state[k] for k in ("created_at", "revision", "anchor_date")} | {
            "completed_windows": len(state["windows"]),
            "total_windows": len(_base_windows(state["start_date"], state["anchor_date"]))}

    def _current(self, state):
        if not isinstance(state, dict): raise ResumeInvalid()
        current = self._read(_owner(state.get("owner_key")))
        if current is None or _json(current) != _json(state):
            raise ResumeConflict(current["revision"] if current else 0)
        return self._live(current)

    def _persist(self, state):
        self._validate(state, state["owner_key"])
        raw = _json({"state": state, "sha256": hashlib.sha256(_json(state)).hexdigest()})
        if len(raw) > self.max_file_bytes: raise ResumeCapacity()
        entries = self._capacity_entries()
        target = self._path(state["owner_key"])
        def over_capacity():
            return (len(entries) + int(not target.exists()) > self.max_files
                    or sum(info.st_size for path, info in entries if path != target) + len(raw) > self.max_total_bytes)
        if over_capacity():
            self._prune_expired(entries, state["owner_key"])
            entries = self._capacity_entries()
        if over_capacity(): raise ResumeCapacity()
        fd, temporary = tempfile.mkstemp(prefix=".window-", dir=self.root)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            os.replace(temporary, target)
            self._fsync_directory()
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
        return copy.deepcopy(state)

    def _capacity_entries(self):
        entries = []
        for entry in self.root.iterdir():
            if not re.fullmatch(r"[0-9a-f]{64}\.json", entry.name): continue
            info = entry.lstat()
            if not stat.S_ISREG(info.st_mode): raise ResumeCorrupt()
            entries.append((entry, info))
        return entries

    def _prune_expired(self, entries, excluding):
        # Called under the write lock ONLY on capacity pressure. Never interpret
        # a damaged file as expired or remove another live/unknown record.
        candidates = sorted((pair for pair in entries if pair[0].stem != excluding), key=lambda pair: pair[1].st_mtime_ns)[:16]
        removed = False
        for path, _ in candidates:
            try: state = self._read(path.stem)
            except ResumeError: continue
            if state is not None and self.clock() >= state["expires_at"]:
                path.unlink()
                self._refresh_receipts.pop(state["cycle_id"], None)
                removed = True
        if removed: self._fsync_directory()

    def _fsync_directory(self):
        fd = os.open(self.root, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

    def start(self, owner_key, scope, start_date, anchor_date, detail_limit=2, expected_revision=0):
        owner_key, scope_hash = _owner(owner_key), _scope(scope)
        _base_windows(start_date, anchor_date)
        if _day(anchor_date) != self._today() or type(detail_limit) is not int or not 0 <= detail_limit <= 2:
            raise ResumeInvalid()
        with self._lock():
            old = self._read(owner_key)
            revision = old["revision"] if old else 0
            if type(expected_revision) is not int or revision != expected_revision: raise ResumeConflict(revision)
            if old and self.clock() < old["expires_at"] and old["scope_hash"] == scope_hash:
                raise ResumeConflict(revision)
            now = self.clock()
            return self._persist({"schema_version": 1, "owner_key": owner_key, "scope_hash": scope_hash,
                "cycle_id": str(uuid.uuid4()), "revision": revision + 1, "created_at": now,
                "expires_at": now + TTL_SECONDS, "start_date": start_date, "anchor_date": anchor_date,
                "detail_limit": detail_limit, "windows": [],
                "enrichment_ids": [] if detail_limit == 0 else None, "enrichments": {}, "recent_refresh_id": None})

    def _pending(self, state, today):
        target = _day(today)
        if target < _day(state["anchor_date"]) or target > self._today(): raise ResumeInvalid()
        base = _base_windows(state["start_date"], state["anchor_date"])
        if len(state["windows"]) < len(base): return base[len(state["windows"]):]
        end = _day(state["windows"][-1]["end"]) if len(state["windows"]) > len(base) else _day(state["anchor_date"])
        if end > target: raise ResumeInvalid()
        if end < target:
            return [{"start": (end + timedelta(days=1)).isoformat(), "end": min(target, end + timedelta(days=365)).isoformat()}]
        return []

    def pending_windows(self, state, today):
        return self._pending(self._current(state), today)

    def record_window(self, state, start, end, rows):
        with self._lock():
            current = self._current(state)
            pending = self._pending(current, self._today().isoformat())
            if not pending or pending[0] != {"start": start, "end": end}: raise ResumeConflict(current["revision"])
            current["windows"].append({"start": start, "end": end, "rows": copy.deepcopy(rows)})
            current["recent_refresh_id"] = None
            self._refresh_receipts.pop(current["cycle_id"], None)
            current["revision"] += 1
            return self._persist(current)

    @staticmethod
    def _rows(state):
        rows = {bill_key(row): copy.deepcopy(row) for w in state["windows"] for row in w["rows"]}
        rows.update(copy.deepcopy(state["enrichments"]))
        return sorted(rows.values(), key=lambda row: (row["date"], row.get("time") or "", bill_key(row)), reverse=True)

    def enrichment_candidates(self, state, today):
        current = self._current(state)
        if self._pending(current, today): raise ResumeIncomplete(current["revision"])
        if current["enrichment_ids"] is None: raise ResumeIncomplete(current["revision"])
        return [key for key in current["enrichment_ids"] if key not in current["enrichments"]]

    def list_rows(self, state, today):
        """Return all checked summaries only after every requested window is done."""
        current = self._current(state)
        if self._pending(current, today): raise ResumeIncomplete(current["revision"])
        return self._rows(current)

    def recent_window(self, state, today):
        current = self._current(state)
        if self._pending(current, today): raise ResumeIncomplete(current["revision"])
        end = _day(today)
        return {"start": max(_day(current["start_date"]), end - timedelta(days=364)).isoformat(), "end": today}

    def refresh_recent_window(self, state, rows):
        """Refresh latest <=365 days, including late anchor/tail-day additions.

        Existing window boundaries stay fixed. The fresh source list replaces
        only rows in this range, and changed summaries invalidate old details.
        Deleted selected IDs fail closed instead of silently changing selection.
        """
        with self._lock():
            current = self._current(state)
            self._refresh_receipts.pop(current["cycle_id"], None)
            span = self.recent_window(current, self._today().isoformat())
            if not isinstance(rows, list): raise ResumeInvalid()
            incoming = {}
            for raw in rows:
                row = _row(raw)
                key = bill_key(row)
                if key in incoming or not span["start"] <= row["date"] <= span["end"]: raise ResumeInvalid()
                incoming[key] = row
            previous = {bill_key(r): r for w in current["windows"] for r in w["rows"]}
            outside = {k: r for k, r in previous.items() if not span["start"] <= r["date"] <= span["end"]}
            if set(outside) & set(incoming): raise ResumeCorrupt()
            combined = outside | incoming
            if any(key not in combined for key in current["enrichment_ids"] or []):
                raise ResumeConflict(current["revision"])
            for key in list(current["enrichments"]):
                if previous.get(key) != combined.get(key): del current["enrichments"][key]
            for window in current["windows"]:
                window["rows"] = [copy.deepcopy(r) for r in combined.values() if window["start"] <= r["date"] <= window["end"]]
            current["recent_refresh_id"] = str(uuid.uuid4())
            current["revision"] += 1
            result = self._persist(current)
            self._refresh_receipts[current["cycle_id"]] = (current["recent_refresh_id"], self._today().isoformat())
            return result

    def select_enrichment(self, state, bill_ids):
        """Freeze the caller's existing latest/rotating selection once per cycle."""
        with self._lock():
            current = self._current(state)
            if self._pending(current, self._today().isoformat()): raise ResumeIncomplete(current["revision"])
            rows = self._rows(current)
            keys = {bill_key(row) for row in rows}
            limit = min(current["detail_limit"], len(rows))
            if (not isinstance(bill_ids, list) or not (0 < len(bill_ids) <= limit if limit else len(bill_ids) == 0)
                    or any(not isinstance(key, str) or key not in keys for key in bill_ids)
                    or len(set(bill_ids)) != len(bill_ids)):
                raise ResumeInvalid()
            if current["enrichment_ids"] is not None:
                if current["enrichment_ids"] != bill_ids: raise ResumeConflict(current["revision"])
                return copy.deepcopy(current)
            current["enrichment_ids"] = list(bill_ids)
            current["revision"] += 1
            return self._persist(current)

    def record_enrichment(self, state, bill_id, row):
        with self._lock():
            current = self._current(state)
            if bill_id not in self.enrichment_candidates(current, self._today().isoformat()) or bill_key(row) != bill_id:
                raise ResumeConflict(current["revision"])
            current["enrichments"][bill_id] = _row(row)
            current["revision"] += 1
            return self._persist(current)

    def finalize(self, state, today):
        current = self._current(state)
        if self._pending(current, today) or self.enrichment_candidates(current, today):
            raise ResumeIncomplete(current["revision"])
        if (today != self._today().isoformat() or self._refresh_receipts.get(current["cycle_id"])
                != (current["recent_refresh_id"], today)):
            raise ResumeIncomplete(current["revision"])
        return self._rows(current)

    def ack(self, state):
        with self._lock():
            current = self._current(state)
            today = self._today().isoformat()
            if self._pending(current, today) or self.enrichment_candidates(current, today) or current["recent_refresh_id"] is None:
                raise ResumeIncomplete(current["revision"])
            self._path(current["owner_key"]).unlink()
            self._refresh_receipts.pop(current["cycle_id"], None)
            self._fsync_directory()
