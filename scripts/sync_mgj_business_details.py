#!/usr/bin/env python3
"""Finite complete-day project-detail sync. Dry-run unless --write is supplied.

Shares the existing source lock and yields when normal consumption sync is due.
Queries observed read-only list/detail APIs. No financial or MGJ write API.
"""
import argparse
import base64
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts import audit_mgj_daily_report_source as audit
    from scripts import sync_mgj_daily_electronic_sources as signed
    from scripts.mgj_business_detail import normalize_bill, money_cents
except ModuleNotFoundError:
    import audit_mgj_daily_report_source as audit
    import sync_mgj_daily_electronic_sources as signed
    from mgj_business_detail import normalize_bill, money_cents

ENDPOINT = "https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/mgj-business-detail-sync"
DOMAIN = b"mgj-business-detail-sync\n"
BACKOFF_STATE = Path.home() / '.hermes/mgj_business_detail_backoff.json'


def read_backoff():
    try:
        value = json.loads(BACKOFF_STATE.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {'cooldown_until': float('inf')}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {'cooldown_until': float('inf')}


def record_backoff(code):
    # Independent source protection; never alter the normal sync's state.
    BACKOFF_STATE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=BACKOFF_STATE.parent, delete=False) as pending:
        os.chmod(pending.name, 0o600)
        json.dump({'cooldown_until': time.time()+900, 'reason': code}, pending)
    os.replace(pending.name, BACKOFF_STATE)


def list_signature(period):
    services = period.get("services")
    if not isinstance(services, list) or period.get("source_count") != len(services):
        raise ValueError("incomplete_source_list")
    ids = [str(row["source_id"]) for row in services]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate_source_bill")
    return sorted((str(row["source_id"]), str(row.get("amount")), str(row.get("date"))) for row in services)


def submit(payload, key, timeout):
    ts = str(int(time.time()))
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    if len(body) > 2097152:
        raise ValueError("source_payload_too_large")
    signature = base64.urlsafe_b64encode(key.sign(DOMAIN + ts.encode() + b"." + body)).rstrip(b"=").decode()
    request = urllib.request.Request(ENDPOINT, data=body, headers={
        "Content-Type": "application/json", "apikey": signed.private_sync.PUBLIC_API_KEY,
        "X-Business-Sync-Ts": ts, "X-Business-Sync-Signature": signature,
    })
    # Uncertain transport is not automatically retried; the server is idempotent.
    with signed.tls_urlopen(request, timeout=min(timeout, 20), context=ssl.create_default_context()) as response:
        raw = response.read(16385)
        if len(raw) > 16384:
            raise ValueError("receipt_too_large")
        receipt = json.loads(raw)
    if not isinstance(receipt, dict) or receipt.get("formal_ledger_amount_changed") is not False:
        raise ValueError("invalid_receipt")
    if receipt.get("accepted") is not True:
        return {"status": "not_accepted"}
    if (receipt.get("shop") != payload["shop"] or receipt.get("date") != payload["date"]
            or receipt.get("source_count") != len(payload["source"]["bills"])
            or receipt.get("source_scope") != "project_consumption" or receipt.get("report_ready") is not False
            or receipt.get("stage") != "business_details"):
        raise ValueError("invalid_receipt")
    return {"status": "accepted", "snapshot_id": receipt.get("snapshot_id"),
            "source_count": receipt["source_count"], "deduplicated": receipt.get("deduplicated")}


def run(shop, day, *, write=False, budget=60, max_bills=100,
        period_reader=None, detail_reader=None, submitter=None, lock_factory=None,
        config_loader=None, due_checker=None, key_loader=None,
        backoff_reader=None, backoff_recorder=None, request_pause=None):
    shop = audit.validate_shop(shop)
    day = audit.validate_day(day)
    if type(budget) is not int or not 1 <= budget <= 90 or type(max_bills) is not int or not 1 <= max_bills <= 1000:
        raise ValueError("invalid_budget_or_limit")
    if time.time() < (backoff_reader or read_backoff)().get('cooldown_until', 0):
        return {'status': 'yielded_source_cooldown', 'shop': shop, 'date': day}
    if (due_checker or (lambda: signed.daily_sync_due(signed.read_daily_sync_state())))():
        return {"status": "yielded_daily_sync_due", "shop": shop, "date": day}
    deadline = time.monotonic() + budget
    lock = (lock_factory or audit.acquire_shared_lock)()
    try:
        if (due_checker or (lambda: signed.daily_sync_due(signed.read_daily_sync_state())))():
            return {"status": "yielded_daily_sync_due", "shop": shop, "date": day}
        reader = period_reader or audit.daily.fetch_period
        detail = detail_reader or audit.request_bill_detail
        first = reader(shop, day, day, deadline)
        signature = list_signature(first)
        if first["source_count"] > max_bills:
            return {"status": "source_count_exceeds_limit", "source_count": first["source_count"]}
        config = (config_loader or audit.load_config)()
        bills = []
        for row in first["services"]:
            if bills:
                (request_pause or time.sleep)(1)
            if time.monotonic() >= deadline - (8 if write else 2):
                return {"status": "budget_exhausted", "loaded_count": len(bills), "source_count": first["source_count"]}
            raw = detail(row["source_id"], config, deadline)
            bill = normalize_bill(raw, bill_id=row["source_id"], shop=shop, day=day)
            if bill["source_posted_amount_cents"] != money_cents(row.get("amount")):
                raise ValueError("posted_amount_mismatch")
            bills.append(bill)
        if time.monotonic() >= deadline - (5 if write else 1):
            return {"status": "budget_exhausted", "loaded_count": len(bills)}
        if signature != list_signature(reader(shop, day, day, deadline)):
            return {"status": "source_changed", "source_count": first["source_count"]}
        source = {"contract_version": "mgj-business-day-v1", "shop_id": shop, "business_date": day,
                  "source_scope": "project_consumption", "bills": sorted(bills, key=lambda row: row["source_bill_id"])}
        summary = {"shop": shop, "date": day, "source_count": len(bills),
                   "employee_allocation_count": sum(len(b["employee_allocations"]) for b in bills),
                   "report_ready": False}
        if not write:
            return {"status": "dry_run", **summary}
        payload = {"operation": "business_details_append", "shop": audit.daily.SHOPS[shop], "date": day,
                   "fetched_at": datetime.now(timezone.utc).isoformat(), "source": source}
        key = (key_loader or signed.load_signing_key)()
        result = (submitter or submit)(payload, key, deadline-time.monotonic())
        return {**summary, **result}
    except audit.AuditError as exc:
        if str(exc) in ('http_status:401', 'http_status:403', 'http_status:429'):
            (backoff_recorder or record_backoff)(str(exc))
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 429):
            (backoff_recorder or record_backoff)('http_status:'+str(exc.code))
        raise
    finally:
        lock.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="有界采集收银和日报共用项目明细，默认仅核验")
    parser.add_argument("--shop", required=True, choices=sorted(audit.daily.SHOPS))
    parser.add_argument("--date", required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--budget-seconds", type=int, default=60)
    parser.add_argument("--max-bills", type=int, default=100)
    args = parser.parse_args(argv)
    try:
        result = run(args.shop, args.date, write=args.write, budget=args.budget_seconds, max_bills=args.max_bills)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] in ("dry_run", "accepted", "yielded_daily_sync_due", "yielded_source_cooldown") else 2
    except Exception as exc:
        # No source payload, cookies, employee names or amounts in failure logs.
        code = str(exc) if isinstance(exc, audit.AuditError) else 'validation_or_transport_failed'
        print(json.dumps({"status": "failed_or_unconfirmed", "error_code": code}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
