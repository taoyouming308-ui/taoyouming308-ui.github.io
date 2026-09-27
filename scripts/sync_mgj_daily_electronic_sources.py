#!/usr/bin/env python3
"""Read-only-first collector for reviewed Meiguanjia daily-summary candidates.

Dry-run is the default. With --write, this appends validated source evidence to
the private candidate endpoint; it never writes the formal ledger or Meiguanjia.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from scripts import audit_mgj_daily_report_source as audit
    from scripts import mgj_private_customer as private_sync
except ModuleNotFoundError:
    import audit_mgj_daily_report_source as audit
    import mgj_private_customer as private_sync

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ImportError:
    serialization = None
    Ed25519PrivateKey = ()


SYNC_ENDPOINT = "https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/mgj-daily-report-sync"
DAILY = audit.daily
SHOPS = {shop_id: name for shop_id, name in DAILY.SHOPS.items()}
SCOPE_NAMES = {"projects": "projects_daily_summary", "all": "all_business_daily_summary"}
SCOPE_SEQUENCE = ("projects", "all")
MAX_BUDGET_SECONDS = 60
LIVE_SYNC_FRESH_SECONDS = 240
TZ = DAILY.TZ
SIGNATURE_DOMAIN = b"mgj-daily-report-sync\n"


class SyncError(ValueError):
    """Safe status error; messages never contain request or response bodies."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def tls_urlopen(request, timeout, context):
    """Use certificate validation and never forward signed payloads on redirects."""
    opener = urllib.request.build_opener(
        NoRedirectHandler(),
        urllib.request.HTTPSHandler(context=context),
    )
    return opener.open(request, timeout=timeout)


def validate_options(shop, day, scope, budget_seconds):
    if str(shop) not in SHOPS:
        raise SyncError("invalid_shop")
    day = audit.validate_day(day)
    if scope not in ("projects", "all", "both"):
        raise SyncError("invalid_scope")
    if type(budget_seconds) is not int or not 1 <= budget_seconds <= MAX_BUDGET_SECONDS:
        raise SyncError("invalid_budget")
    return str(shop), day


def selected_scopes(scope):
    if scope == "both":
        return list(SCOPE_SEQUENCE)
    if scope in SCOPE_NAMES:
        return [scope]
    raise SyncError("invalid_scope")


def source_object(shop_id, day, scope, config, content):
    audit.parse_daily_summary(content, shop_id, day, scope)
    return {
        "shop_id": shop_id,
        "business_date": day,
        "query": audit.daily_summary_payload(shop_id, day, config, scope),
        "content": content,
    }


def source_digest(source):
    encoded = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def make_candidate(shop_id, day, scope, source, fetched_at):
    return {
        "operation": "source_append",
        "shop": SHOPS[shop_id],
        "date": day,
        "source_scope": SCOPE_NAMES[scope],
        "fetched_at": fetched_at,
        "source": source,
    }


def signature_for(payload, signing_key, timestamp):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signed = SIGNATURE_DOMAIN + timestamp.encode("ascii") + b"." + body
    signature = base64.urlsafe_b64encode(signing_key.sign(signed)).rstrip(b"=").decode("ascii")
    return body, signature


def load_signing_key():
    if serialization is None:
        raise SyncError("signing_dependency_unavailable")
    key_path = Path(private_sync.KEY_PATH)
    try:
        if os.stat(key_path).st_mode & 0o077:
            raise SyncError("signing_key_permissions_invalid")
        with open(key_path, "rb") as key_file:
            key = serialization.load_pem_private_key(key_file.read(), password=None)
    except SyncError:
        raise
    except (OSError, ValueError):
        raise SyncError("signing_key_unavailable") from None
    if not isinstance(key, Ed25519PrivateKey):
        raise SyncError("signing_key_type_invalid")
    return key


def validate_receipt(receipt, candidate):
    if not isinstance(receipt, dict):
        raise SyncError("invalid_receipt")
    for key in ("snapshot_id", "candidate_id"):
        value = receipt.get(key)
        if not isinstance(value, str) or not re.fullmatch(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value
        ):
            raise SyncError("invalid_receipt")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", str(receipt.get("source_sha256", ""))):
        raise SyncError("invalid_receipt")
    if type(receipt.get("version")) is not int or receipt["version"] <= 0:
        raise SyncError("invalid_receipt")
    if receipt.get("status") != "needs_review" or receipt.get("stage") != "source_only":
        raise SyncError("invalid_receipt")
    for key in ("inserted", "latest", "watermark_advanced"):
        if type(receipt.get(key)) is not bool:
            raise SyncError("invalid_receipt")
    if receipt.get("source_scope") != candidate["source_scope"]:
        raise SyncError("invalid_receipt")
    if receipt.get("scope_verified") is not False or receipt.get("formal_ledger_amount_changed") is not False:
        raise SyncError("invalid_receipt")
    parsed_times = {}
    for key in ("fetched_at", "latest_fetched_at"):
        value = receipt.get(key)
        if not isinstance(value, str):
            raise SyncError("invalid_receipt")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise SyncError("invalid_receipt") from None
        if parsed.tzinfo is None:
            raise SyncError("invalid_receipt")
        parsed_times[key] = parsed.astimezone(timezone.utc)
    try:
        candidate_time = datetime.fromisoformat(candidate["fetched_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise SyncError("invalid_candidate_timestamp") from None
    if candidate_time.tzinfo is None:
        raise SyncError("invalid_receipt")
    candidate_time = candidate_time.astimezone(timezone.utc)
    fetched_time = parsed_times["fetched_at"]
    latest_time = parsed_times["latest_fetched_at"]
    now = datetime.now(timezone.utc)
    if fetched_time > latest_time or latest_time > now:
        raise SyncError("invalid_receipt")
    if receipt["latest"] and latest_time < candidate_time:
        raise SyncError("invalid_receipt")
    if latest_time < candidate_time:
        raise SyncError("invalid_receipt")
    if receipt["inserted"] and fetched_time != candidate_time:
        raise SyncError("invalid_receipt")
    return {key: receipt[key] for key in (
        "snapshot_id", "candidate_id", "source_sha256", "version", "status", "stage",
        "inserted", "latest", "watermark_advanced", "fetched_at", "latest_fetched_at",
        "source_scope", "scope_verified", "formal_ledger_amount_changed",
    )}


def submit_candidate(candidate, signing_key, timeout, urlopen=tls_urlopen, now=None):
    if timeout <= 0:
        return {"status": "unconfirmed", "reason": "budget_exhausted"}
    timestamp = str(int((now or time.time())))
    body, signature = signature_for(candidate, signing_key, timestamp)
    request = urllib.request.Request(SYNC_ENDPOINT, data=body, headers={
        "Content-Type": "application/json",
        "apikey": private_sync.PUBLIC_API_KEY,
        "X-Daily-Report-Sync-Ts": timestamp,
        "X-Daily-Report-Sync-Signature": signature,
    })
    try:
        with urlopen(request, timeout=min(15, timeout), context=ssl.create_default_context()) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                return {"status": "unconfirmed", "reason": "response_too_large"}
            result = json.loads(raw)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            try:
                error_body = json.loads(exc.read(16_385))
                if isinstance(error_body, dict) and error_body.get("outcome") == "unconfirmed":
                    return {"status": "unconfirmed", "http_status": 409, "reason": "server_unconfirmed"}
            except (OSError, ValueError, TypeError):
                pass
        return {"status": "unconfirmed" if exc.code >= 500 else "rejected", "http_status": exc.code}
    except (TimeoutError, socket.timeout, urllib.error.URLError, OSError):
        return {"status": "unconfirmed", "reason": "transport_uncertain"}
    except (json.JSONDecodeError, TypeError, ValueError):
        return {"status": "unconfirmed", "reason": "invalid_response"}
    try:
        return {"status": "accepted", "receipt": validate_receipt(result, candidate)}
    except SyncError:
        return {"status": "unconfirmed", "reason": "invalid_receipt"}


def read_daily_sync_state():
    if not DAILY.STATE.exists():
        return None
    try:
        value = json.loads(DAILY.STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def daily_sync_due(state, now=None):
    """Conservatively yield to the existing project-consumption synchronizer."""
    if not isinstance(state, dict):
        return True
    now = now or time.time()
    if now < (state.get("cooldown_until") or 0):
        return True
    today = datetime.now(TZ).date().isoformat()
    pairs = state.get("pairs") if isinstance(state.get("pairs"), dict) else {}
    for shop_id in SHOPS:
        pair = pairs.get(shop_id + ":" + today)
        if not isinstance(pair, dict):
            return True
        try:
            age = now - float(pair.get("success_at") or 0)
        except (TypeError, ValueError):
            return True
        if age > LIVE_SYNC_FRESH_SECONDS:
            return True
    return False


def acquire_shared_lock():
    lock = open(DAILY.LOCK, "a", encoding="utf-8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return None
    return lock


def fresh_fetched_at():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run(shop, day, scope="both", write=False, budget_seconds=MAX_BUDGET_SECONDS,
        config_loader=audit.load_config, summary_reader=audit.request_daily_summary,
        key_loader=load_signing_key, submitter=submit_candidate, now_fn=time.monotonic,
        state_reader=read_daily_sync_state, lock_acquirer=acquire_shared_lock):
    shop, day = validate_options(shop, day, scope, budget_seconds)
    scopes = selected_scopes(scope)
    if daily_sync_due(state_reader()):
        return {"status": "yielded_daily_sync_due", "shop": shop, "date": day, "scopes": []}
    lock = lock_acquirer()
    if lock is None:
        return {"status": "yielded_lock_busy", "shop": shop, "date": day, "scopes": []}

    deadline = now_fn() + budget_seconds
    results = []
    try:
        config = config_loader()
        if daily_sync_due(state_reader()):
            return {"status": "yielded_daily_sync_due", "shop": shop, "date": day, "scopes": []}
        signing_key = key_loader() if write else None
        for source_scope in scopes:
            if deadline - now_fn() <= 0:
                results.append({"scope": SCOPE_NAMES[source_scope], "status": "budget_exhausted"})
                continue
            if daily_sync_due(state_reader()):
                results.extend({"scope": SCOPE_NAMES[pending], "status": "yielded_daily_sync_due"}
                               for pending in scopes[len(results):])
                break
            try:
                content = summary_reader(shop, day, config, source_scope,
                                         deadline=min(deadline, now_fn() + 15))
                source = source_object(shop, day, source_scope, config, content)
                fetched_at = fresh_fetched_at()
                candidate = make_candidate(shop, day, source_scope, source, fetched_at)
            except audit.AuditError as exc:
                status = "missing_source" if str(exc) == "summary_no_rows" else "source_read_failed"
                results.append({"scope": SCOPE_NAMES[source_scope], "status": status,
                                "reason": str(exc) if status == "missing_source" else "source_or_validation_error"})
                continue
            except Exception:
                results.append({"scope": SCOPE_NAMES[source_scope], "status": "source_read_failed",
                                "reason": "source_or_validation_error"})
                continue

            output = {
                "scope": SCOPE_NAMES[source_scope],
                "status": "dry_run_ready" if not write else "pending_submission",
                "shop": shop,
                "date": day,
                "row_count": len(content.get("data", [])),
                "local_source_digest": source_digest(source),
            }
            if write:
                remaining = deadline - now_fn()
                try:
                    result = submitter(candidate, signing_key, remaining)
                except Exception:
                    result = {"status": "unconfirmed", "reason": "write_outcome_uncertain"}
                output["status"] = result.get("status", "unconfirmed")
                if "receipt" in result:
                    output["receipt"] = result["receipt"]
                else:
                    output["reason"] = result.get("reason", "write_unconfirmed")
                    if result.get("http_status") is not None:
                        output["http_status"] = result["http_status"]
            results.append(output)
        states = [entry["status"] for entry in results]
        if not states:
            status = "no_scope_processed"
        elif any(value not in ("dry_run_ready", "accepted") for value in states):
            status = "partial" if len(scopes) > 1 else states[0]
        else:
            status = "dry_run_ready" if not write else "needs_review"
        return {"status": status, "shop": shop, "date": day, "scopes": results}
    finally:
        lock.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="只读采集并可选追加美管加日报源候选；默认dry-run")
    parser.add_argument("--shop", required=True, choices=sorted(SHOPS))
    parser.add_argument("--date", required=True)
    parser.add_argument("--scope", choices=("projects", "all", "both"), default="both")
    parser.add_argument("--budget-seconds", type=int, default=MAX_BUDGET_SECONDS)
    parser.add_argument("--write", action="store_true", help="明确提交到needs_review候选，不写正式账本")
    return parser.parse_args(argv)


def main(argv=None):
    try:
        args = parse_args(argv)
        result = run(args.shop, args.date, args.scope, args.write, args.budget_seconds)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 1 if result["status"] in (
            "partial", "source_read_failed", "missing_source", "unconfirmed",
            "rejected", "budget_exhausted", "no_scope_processed",
        ) else 0
    except SyncError as exc:
        print(json.dumps({"status": "rejected", "reason": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception:
        print(json.dumps({"status": "failed", "reason": "unexpected_error"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
