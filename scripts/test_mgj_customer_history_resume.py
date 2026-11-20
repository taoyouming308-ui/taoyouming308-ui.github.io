"""Synthetic filesystem/clock tests. No real identities, sessions or network."""
import copy
from datetime import datetime, timedelta
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("history_resume", Path(__file__).with_name("mgj_customer_history_resume.py"))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "private"
        self.now = datetime(2026, 11, 20, 10, tzinfo=m.TZ).timestamp()
        self.store = m.HistoryResumeStore(self.root, clock=lambda: self.now)
        self.owner = hashlib.sha256(b"synthetic-owner").hexdigest()
        self.scope = {"host": "vip12.meiguanjia.net", "customer_id": "fixture-customer", "card_id": "fixture-card",
                      "store_id": "fixture-store", "session_shop": "fixture-session-store",
                      "session_user": "fixture-user", "session_employee": "fixture-employee"}

    def tearDown(self):
        self.temp.cleanup()

    def start(self, **kw):
        return self.store.start(self.owner, self.scope, kw.pop("start_date", "2026-11-01"),
                                kw.pop("anchor_date", "2026-11-20"), **kw)

    def row(self, key="fixture-bill", day="2026-11-20"):
        return {"id": key, "source_id": key, "bill_no": "fixture-number", "date": day, "time": "09:00",
                "amount": 0, "items": [], "barber": "", "staff": [], "shop": "fixture-store",
                "comment": "", "bill_type": 0, "consume_type": 0}

    def all_windows(self, state, rows=None):
        while True:
            pending = self.store.pending_windows(state, self.store._today().isoformat())
            if not pending: return state
            w = pending[0]
            selected = [r for r in (rows or []) if w["start"] <= r["date"] <= w["end"]]
            state = self.store.record_window(state, w["start"], w["end"], selected)

    def ready(self, rows=None, detail_limit=2):
        state = self.all_windows(self.start(detail_limit=detail_limit), rows)
        state = self.store.refresh_recent_window(state, rows or [])
        ids = [m.bill_key(r) for r in self.store.list_rows(state, "2026-11-20")][:detail_limit]
        state = self.store.select_enrichment(state, ids)
        for key in ids:
            row = next(r for r in (rows or []) if m.bill_key(r) == key)
            state = self.store.record_enrichment(state, key, row)
        return state

    def raw_path(self):
        return self.root / (self.owner + ".json")

    def rewrite(self, callback):
        value = json.loads(self.raw_path().read_text())
        callback(value["state"])
        value["sha256"] = hashlib.sha256(m._json(value["state"])).hexdigest()
        self.raw_path().write_bytes(m._json(value))

    def test_empty_read_only_does_not_create_anything(self):
        ro = m.HistoryResumeStore(self.root, read_only=True, clock=lambda: self.now)
        self.assertIsNone(ro.load(self.owner, self.scope))
        self.assertIsNone(ro.peek(self.owner))
        self.assertFalse(self.root.exists())
        for call in [lambda: ro.start(self.owner, self.scope, "2026-01-01", "2026-11-20"),
                     lambda: ro.record_window({}, "x", "y", []),
                     lambda: ro.record_enrichment({}, "x", {}),
                     lambda: ro.select_enrichment({}, []), lambda: ro.ack({})]:
            with self.assertRaises(m.ResumeReadOnly): call()
        self.assertFalse(self.root.exists())

    def test_private_modes_and_scope_not_persisted(self):
        state = self.start()
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        for p in self.root.iterdir(): self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
        raw = self.raw_path().read_text()
        self.assertNotIn("fixture-customer", raw)
        self.assertNotIn("fixture-user", raw)
        self.assertNotIn("synthetic-owner", raw)
        self.assertEqual(self.store.load(self.owner, self.scope), state)

    def test_read_only_existing_has_no_mutation(self):
        state = self.all_windows(self.start(detail_limit=0))
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        ro = m.HistoryResumeStore(self.root, read_only=True, clock=lambda: self.now)
        self.assertEqual(ro.load(self.owner, self.scope), state)
        self.assertEqual(ro.list_rows(state, "2026-11-20"), [])
        with self.assertRaises(m.ResumeIncomplete): ro.finalize(state, "2026-11-20")
        self.assertIsNotNone(ro.peek(self.owner))
        self.now += m.TTL_SECONDS
        self.assertIsNone(ro.peek(self.owner))
        with self.assertRaises(m.ResumeExpired): ro.load(self.owner, self.scope)
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()})

    def test_valid_owner_and_exact_scope_allowlist(self):
        for owner in ["../fixture", "abc", "G" * 64]:
            with self.assertRaises(m.ResumeInvalid): self.store.load(owner, self.scope)
        for scope in [{}, self.scope | {"cookie": "fixture"}, self.scope | {"host": "example.invalid"}]:
            with self.assertRaises(m.ResumeInvalid): self.store.load(self.owner, scope)
        self.assertFalse(self.root.exists())

    def test_changed_scope_requires_explicit_cas_new_cycle(self):
        state = self.start()
        for field in m.SCOPE_FIELDS - {"host"}:
            changed = self.scope | {field: "changed-fixture"}
            with self.assertRaises(m.ResumeConflict) as err: self.store.load(self.owner, changed)
            self.assertEqual(err.exception.revision, state["revision"])
        changed = self.scope | {"card_id": "changed-card"}
        with self.assertRaises(m.ResumeConflict):
            self.store.start(self.owner, changed, "2026-11-01", "2026-11-20")
        new = self.store.start(self.owner, changed, "2026-11-01", "2026-11-20", expected_revision=state["revision"])
        self.assertNotEqual(new["cycle_id"], state["cycle_id"])
        with self.assertRaises(m.ResumeConflict): self.store.pending_windows(state, "2026-11-20")

    def test_no_same_scope_restart_or_ttl_extension(self):
        state = self.start()
        self.now += 60
        with self.assertRaises(m.ResumeConflict): self.start(expected_revision=state["revision"])
        loaded = self.store.load(self.owner, self.scope)
        self.assertEqual((loaded["created_at"], loaded["expires_at"]), (state["created_at"], state["expires_at"]))

    def test_expired_cycle_explicit_cas_restarts_without_rows(self):
        state = self.all_windows(self.start(), [self.row()])
        self.now += m.TTL_SECONDS
        with self.assertRaises(m.ResumeExpired) as err: self.store.load(self.owner, self.scope)
        self.assertEqual(err.exception.revision, state["revision"])
        with self.assertRaises(m.ResumeConflict): self.start(anchor_date="2026-11-23")
        new = self.start(anchor_date="2026-11-23", expected_revision=state["revision"])
        self.assertEqual(new["windows"], [])
        self.assertGreater(new["created_at"], state["created_at"])

    def test_year_windows_cover_each_date_once_including_leap_day(self):
        state = self.start(start_date="2024-01-01")
        windows = self.store.pending_windows(state, "2026-11-20")
        days = []
        for w in windows:
            a, b = m._day(w["start"]), m._day(w["end"])
            self.assertLessEqual((b - a).days, 364)
            days.extend(a + timedelta(days=n) for n in range((b - a).days + 1))
        self.assertEqual(len(days), len(set(days)))
        self.assertEqual(min(days).isoformat(), "2024-01-01")
        self.assertEqual(max(days).isoformat(), "2026-11-20")
        self.assertIn(m._day("2024-02-29"), days)

    def test_resume_complete_window_without_exposing_partial_rows(self):
        state = self.start(start_date="2024-01-01")
        w = self.store.pending_windows(state, "2026-11-20")[0]
        state = self.store.record_window(state, w["start"], w["end"], [self.row()])
        other = m.HistoryResumeStore(self.root, clock=lambda: self.now)
        loaded = other.load(self.owner, self.scope)
        self.assertNotEqual(other.pending_windows(loaded, "2026-11-20")[0], w)
        with self.assertRaises(m.ResumeIncomplete): other.list_rows(loaded, "2026-11-20")
        with self.assertRaises(m.ResumeIncomplete): other.finalize(loaded, "2026-11-20")

    def test_cross_day_preserves_anchor_then_requires_tail(self):
        state = self.all_windows(self.start(detail_limit=0), [self.row()])
        self.now += 86400
        self.assertEqual(state["anchor_date"], "2026-11-20")
        self.assertEqual(self.store.pending_windows(state, "2026-11-21"), [{"start": "2026-11-21", "end": "2026-11-21"}])
        with self.assertRaises(m.ResumeIncomplete): self.store.finalize(state, "2026-11-21")
        state = self.store.record_window(state, "2026-11-21", "2026-11-21", [self.row("next-bill", "2026-11-21")])
        state = self.store.refresh_recent_window(state, [self.row(), self.row("next-bill", "2026-11-21")])
        self.assertEqual(len(self.store.finalize(state, "2026-11-21")), 2)

    def test_cross_day_during_base_never_moves_old_windows(self):
        state = self.start(start_date="2024-01-01", detail_limit=0)
        before = self.store.pending_windows(state, "2026-11-20")
        self.now += 86400
        self.assertEqual(self.store.pending_windows(state, "2026-11-21"), before)
        state = self.all_windows(state)
        self.assertEqual(self.store.pending_windows(state, "2026-11-21"), [])
        self.assertEqual(state["windows"][-1]["start"], "2026-11-21")

    def test_stale_revision_and_changed_input_do_not_overwrite(self):
        state = self.start()
        new = self.store.record_window(state, "2026-11-01", "2026-11-20", [self.row()])
        before = self.raw_path().read_bytes()
        with self.assertRaises(m.ResumeConflict): self.store.record_window(state, "2026-11-01", "2026-11-20", [])
        tampered = copy.deepcopy(new); tampered["created_at"] -= 1
        with self.assertRaises(m.ResumeConflict): self.store.list_rows(tampered, "2026-11-20")
        self.assertEqual(self.raw_path().read_bytes(), before)

    def test_bad_window_and_row_validation_do_not_mutate(self):
        state = self.start()
        for begin, end, rows in [("2026-11-02", "2026-11-20", []),
                                 ("2026-11-01", "2026-11-20", [self.row(day="2026-10-31")]),
                                 ("2026-11-01", "2026-11-20", [self.row(), self.row()]),
                                 ("2026-11-01", "2026-11-20", [self.row() | {"cookie": "fixture"}]),
                                 ("2026-11-01", "2026-11-20", [self.row() | {"amount": float("nan")}])]:
            with self.assertRaises(m.ResumeError): self.store.record_window(state, begin, end, rows)
            self.assertEqual(self.store.load(self.owner, self.scope), state)

    def test_selection_frozen_and_no_more_than_two_enrichments(self):
        rows = [self.row(str(n)) for n in range(4)]
        state = self.all_windows(self.start(), rows)
        state = self.store.refresh_recent_window(state, rows)
        with self.assertRaises(m.ResumeIncomplete): self.store.finalize(state, "2026-11-20")
        state = self.store.select_enrichment(state, ["3", "1"])
        self.assertEqual(self.store.select_enrichment(state, ["3", "1"]), state)
        with self.assertRaises(m.ResumeConflict): self.store.select_enrichment(state, ["3", "2"])
        self.assertEqual(self.store.enrichment_candidates(state, "2026-11-20"), ["3", "1"])
        state = self.store.record_enrichment(state, "3", rows[3] | {"items": [{"name": "fixture", "quantity": 1, "price": 0, "list_price": 0}], "card_type": "fixture"})
        with self.assertRaises(m.ResumeIncomplete): self.store.finalize(state, "2026-11-20")
        state = self.store.record_enrichment(state, "1", rows[1] | {"detail_fetch_error": "source_detail_unavailable"})
        self.assertEqual(self.store.enrichment_candidates(state, "2026-11-20"), [])
        with self.assertRaises(m.ResumeConflict): self.store.record_enrichment(state, "0", rows[0])
        result = self.store.finalize(state, "2026-11-20")
        self.assertEqual(len(result), 4)
        self.assertEqual(next(r for r in result if r["id"] == "1")["detail_fetch_error"], "source_detail_unavailable")

    def test_cross_day_after_selection_keeps_cycle_detail_limit(self):
        state = self.ready([self.row("a"), self.row("b")])
        self.now += 86400
        state = self.store.record_window(state, "2026-11-21", "2026-11-21", [self.row("c", "2026-11-21")])
        state = self.store.refresh_recent_window(state, [self.row("a"), self.row("b"), self.row("c", "2026-11-21")])
        self.assertEqual(state["enrichment_ids"], ["b", "a"])
        self.assertEqual(self.store.enrichment_candidates(state, "2026-11-21"), [])
        self.assertEqual(len(self.store.finalize(state, "2026-11-21")), 3)

    def test_safe_summary_can_count_as_processed_detail_not_success(self):
        state = self.all_windows(self.start(), [self.row()])
        state = self.store.refresh_recent_window(state, [self.row()])
        state = self.store.select_enrichment(state, ["fixture-bill"])
        with self.assertRaises(m.ResumeInvalid):
            self.store.record_enrichment(state, "fixture-bill", self.row() | {"detail_fetch_error": "unsafe exception /path or customer"})
        state = self.store.record_enrichment(state, "fixture-bill", self.row() | {"detail_fetch_error": "detail_failed"})
        self.assertEqual(self.store.finalize(state, "2026-11-20")[0]["items"], [])

    def test_ack_only_ready_and_next_cycle_is_fresh(self):
        state = self.start()
        with self.assertRaises(m.ResumeIncomplete): self.store.ack(state)
        state = self.all_windows(state)
        state = self.store.refresh_recent_window(state, [])
        state = self.store.select_enrichment(state, [])
        self.assertTrue(self.raw_path().exists())
        self.assertEqual(self.store.finalize(state, "2026-11-20"), [])
        self.assertTrue(self.raw_path().exists(), "finalization is not a cloud ack")
        self.store.ack(state)
        self.assertIsNone(self.store.load(self.owner, self.scope))
        new = self.start()
        self.assertNotEqual(new["cycle_id"], state["cycle_id"])
        with self.assertRaises(m.ResumeConflict): self.store.ack(state)

    def test_peek_only_real_progress_metadata(self):
        state = self.start()
        self.assertIsNone(self.store.peek(self.owner))
        self.all_windows(state)
        result = self.store.peek(self.owner)
        self.assertEqual(set(result), {"created_at", "revision", "anchor_date", "completed_windows", "total_windows"})
        self.assertNotIn("fixture", str(result))

    def test_corruption_checksum_and_semantic_validation_fail_closed(self):
        state = self.start()
        self.raw_path().write_text("not json")
        before = self.raw_path().read_bytes()
        with self.assertRaises(m.ResumeCorrupt): self.store.load(self.owner, self.scope)
        with self.assertRaises(m.ResumeCorrupt): self.start(expected_revision=state["revision"])
        self.assertEqual(self.raw_path().read_bytes(), before)

    def test_valid_checksum_cannot_hide_invalid_ttl_revision_or_windows(self):
        self.start()
        original = self.raw_path().read_bytes()
        for change in [lambda s: s.update(expires_at=s["expires_at"] + 1),
                       lambda s: s.update(revision=True), lambda s: s.update(enrichment_ids=["unknown"]),
                       lambda s: s.update(windows=[{"start": "2026-11-01", "end": "2026-11-20", "rows": [self.row(day="2026-10-31")]}])]:
            self.raw_path().write_bytes(original)
            self.rewrite(change)
            with self.assertRaises(m.ResumeCorrupt): self.store.load(self.owner, self.scope)

    def test_capacity_limits_preserve_previous_state(self):
        state = self.start()
        before = self.raw_path().read_bytes()
        small = m.HistoryResumeStore(self.root, clock=lambda: self.now, max_rows=1)
        with self.assertRaises(m.ResumeCapacity): small.record_window(state, "2026-11-01", "2026-11-20", [self.row("a"), self.row("b")])
        self.assertEqual(self.raw_path().read_bytes(), before)
        for limits in [dict(max_files=1), dict(max_total_bytes=len(before))]:
            store = m.HistoryResumeStore(self.root, clock=lambda: self.now, **limits)
            with self.assertRaises(m.ResumeCapacity): store.start(hashlib.sha256(b"other").hexdigest(), self.scope, "2026-11-01", "2026-11-20")
        self.assertEqual(self.raw_path().read_bytes(), before)

    def test_unsafe_permissions_and_symlinks_rejected(self):
        self.start()
        self.raw_path().chmod(0o644)
        with self.assertRaises(m.ResumeCorrupt): self.store.load(self.owner, self.scope)
        self.raw_path().unlink()
        target = Path(self.temp.name) / "outside"; target.write_text("preserve")
        self.raw_path().symlink_to(target)
        with self.assertRaises(m.ResumeCorrupt): self.store.load(self.owner, self.scope)
        with self.assertRaises(m.ResumeCorrupt): self.start()
        self.assertEqual(target.read_text(), "preserve")
        self.raw_path().unlink(); self.root.chmod(0o755)
        with self.assertRaises(m.ResumeCorrupt): self.store.load(self.owner, self.scope)

    def test_root_symlink_and_busy_lock_rejected(self):
        elsewhere = Path(self.temp.name) / "elsewhere"; elsewhere.mkdir(mode=0o700)
        self.root.symlink_to(elsewhere)
        with self.assertRaises(m.ResumeCorrupt): self.start()
        self.root.unlink()
        state = self.start()
        with open(self.root / ".lock", "rb") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(m.ResumeBusy): self.store.record_window(state, "2026-11-01", "2026-11-20", [])
        self.assertEqual(self.store.load(self.owner, self.scope), state)

    def test_returned_values_cannot_change_disk_without_cas(self):
        state = self.ready([self.row()])
        rows = self.store.finalize(state, "2026-11-20")
        rows[0]["comment"] = "changed fixture"
        self.assertEqual(self.store.finalize(state, "2026-11-20")[0]["comment"], "")

    def test_one_latest_in_recent_period_is_valid_single_selection(self):
        state = self.all_windows(self.start(), [self.row("a"), self.row("b")])
        state = self.store.select_enrichment(state, ["a"])
        self.assertEqual(state["enrichment_ids"], ["a"])
        self.assertEqual(self.store.enrichment_candidates(state, "2026-11-20"), ["a"])

    def test_nested_unknown_credentials_and_bad_numeric_types_rejected(self):
        state = self.start()
        for item in [{"name": "fixture", "token": "private-fixture"},
                     {"name": "fixture", "price": True}, {"name": "fixture", "quantity": float("inf")},
                     {"name": {"cookie": "fixture"}}, {"name": "fixture", "list_price": "12"}]:
            with self.assertRaises(m.ResumeCorrupt):
                self.store.record_window(state, "2026-11-01", "2026-11-20", [self.row() | {"items": [item]}])
        self.assertEqual(self.store.load(self.owner, self.scope), state)

    def test_refresh_captures_late_anchor_and_cached_tail_additions(self):
        state = self.all_windows(self.start(detail_limit=0), [self.row("early")])
        state = self.store.refresh_recent_window(state, [self.row("early"), self.row("late-anchor")])
        self.assertEqual(len(self.store.finalize(state, "2026-11-20")), 2)
        self.now += 86400
        state = self.store.record_window(state, "2026-11-21", "2026-11-21", [self.row("early-tail", "2026-11-21")])
        self.now += 1800
        refreshed = [self.row("early"), self.row("late-anchor"), self.row("early-tail", "2026-11-21"), self.row("late-tail", "2026-11-21")]
        state = self.store.refresh_recent_window(state, refreshed)
        self.assertEqual(len(self.store.finalize(state, "2026-11-21")), 4)
        self.assertEqual(state["windows"][0]["end"], "2026-11-20")
        self.assertEqual(state["windows"][-1]["start"], "2026-11-21")

    def test_fresh_recent_span_stays_365_days_and_preserves_older_rows(self):
        old = self.row("old", "2024-01-01")
        state = self.all_windows(self.start(start_date="2024-01-01", detail_limit=0), [old, self.row()])
        self.now += 86400
        state = self.store.record_window(state, "2026-11-21", "2026-11-21", [])
        span = self.store.recent_window(state, "2026-11-21")
        self.assertEqual((m._day(span["end"]) - m._day(span["start"])).days, 364)
        state = self.store.refresh_recent_window(state, [self.row(), self.row("new", "2026-11-21")])
        self.assertEqual({r["id"] for r in self.store.finalize(state, "2026-11-21")}, {"old", "fixture-bill", "new"})

    def test_changed_summary_invalidates_previous_enrichment(self):
        state = self.ready([self.row()])
        changed = self.row() | {"amount": 12}
        state = self.store.refresh_recent_window(state, [changed])
        self.assertEqual(state["enrichments"], {})
        self.assertEqual(self.store.enrichment_candidates(state, "2026-11-20"), ["fixture-bill"])
        with self.assertRaises(m.ResumeIncomplete): self.store.finalize(state, "2026-11-20")
        state = self.store.record_enrichment(state, "fixture-bill", changed | {"detail_fetch_error": "detail_unavailable"})
        self.assertEqual(self.store.finalize(state, "2026-11-20")[0]["amount"], 12)

    def test_deleted_selected_id_fails_closed_without_mutation(self):
        state = self.ready([self.row()])
        before = self.raw_path().read_bytes()
        with self.assertRaises(m.ResumeConflict): self.store.refresh_recent_window(state, [])
        self.assertEqual(self.raw_path().read_bytes(), before)
        with self.assertRaises(m.ResumeIncomplete): self.store.finalize(state, "2026-11-20")

    def test_loaded_complete_cannot_finalize_without_current_read(self):
        state = self.ready([self.row()])
        other = m.HistoryResumeStore(self.root, clock=lambda: self.now)
        state = other.load(self.owner, self.scope)
        with self.assertRaises(m.ResumeIncomplete): other.finalize(state, "2026-11-20")
        # Cloud ack deletes only; root has already received a real successful cloud receipt.
        other.ack(state)
        self.assertIsNone(other.load(self.owner, self.scope))

    def test_capacity_prunes_only_valid_expired_other_records(self):
        original = self.start()
        self.now += m.TTL_SECONDS
        other_owner = hashlib.sha256(b"other").hexdigest()
        limited = m.HistoryResumeStore(self.root, clock=lambda: self.now, max_files=1)
        limited.start(other_owner, self.scope, "2026-11-01", "2026-11-23")
        self.assertFalse(self.raw_path().exists())
        self.assertIsNotNone(limited.load(other_owner, self.scope))
        with self.assertRaises(m.ResumeConflict): self.store.pending_windows(original, "2026-11-23")

    def test_capacity_keeps_corrupt_expired_and_live_files(self):
        self.start()
        self.now += m.TTL_SECONDS
        self.raw_path().write_text("damaged expired-looking fixture")
        before = self.raw_path().read_bytes()
        limited = m.HistoryResumeStore(self.root, clock=lambda: self.now, max_files=1)
        with self.assertRaises(m.ResumeCapacity):
            limited.start(hashlib.sha256(b"other").hexdigest(), self.scope, "2026-11-01", "2026-11-23")
        self.assertEqual(before, self.raw_path().read_bytes())

    def test_prune_checks_at_most_sixteen_and_read_only_never_prunes(self):
        states = []
        for n in range(18):
            owner = hashlib.sha256(str(n).encode()).hexdigest()
            states.append(self.store.start(owner, self.scope, "2026-11-01", "2026-11-20"))
        self.now += m.TTL_SECONDS
        ro = m.HistoryResumeStore(self.root, read_only=True, clock=lambda: self.now, max_files=1)
        with self.assertRaises(m.ResumeReadOnly): ro.start(self.owner, self.scope, "2026-11-01", "2026-11-23")
        self.assertEqual(len(list(self.root.glob("*.json"))), 18)
        limited = m.HistoryResumeStore(self.root, clock=lambda: self.now, max_files=1)
        with self.assertRaises(m.ResumeCapacity): limited.start(self.owner, self.scope, "2026-11-01", "2026-11-23")
        self.assertEqual(len(list(self.root.glob("*.json"))), 2)

    def test_atomic_replace_failure_preserves_previous_checkpoint(self):
        state = self.start()
        before = self.raw_path().read_bytes()
        with mock.patch.object(m.os, "replace", side_effect=OSError("synthetic disk error")):
            with self.assertRaises(OSError): self.store.record_window(state, "2026-11-01", "2026-11-20", [])
        self.assertEqual(self.raw_path().read_bytes(), before)
        self.assertEqual(list(self.root.glob(".window-*")), [])


if __name__ == "__main__":
    unittest.main()
