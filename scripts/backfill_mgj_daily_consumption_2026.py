#!/usr/bin/env python3
"""Finite, resumable 2026 project-bill backfill; no scheduler, no source writes.

Read at most seven days per query to reduce source requests, then split a fully
validated period into daily snapshots, including verified zero-business days.
Today/yesterday remain owned by the regular live worker. Checkpoints contain
only aggregate reconciliation metadata, never customer data or credentials.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

try:
    import sync_mgj_daily_consumption as daily
except ModuleNotFoundError:
    from scripts import sync_mgj_daily_consumption as daily

START, END = '2026-01-01', '2026-09-25'
OPERATION = 'daily_consumption_backfill_2026'
STATE = Path.home() / '.hermes/mgj_daily_consumption_backfill_2026.json'
LOCK = '/tmp/mgj_daily_consumption_backfill_2026.lock'


def dates(start, end):
    day, last = date.fromisoformat(start), date.fromisoformat(end)
    while day <= last:
        yield day.isoformat()
        day += timedelta(days=1)


def groups():
    all_days = list(dates(START, END))
    for i in range(0, len(all_days), 7):
        for shop in daily.SHOPS:
            yield shop, all_days[i:i + 7]


def split_period(period):
    if not START <= period['start'] <= period['end'] <= END:
        raise ValueError('backfill_scope_mismatch')
    if len(period['services']) != period['source_count']:
        raise ValueError('incomplete_period')
    buckets = {d: [] for d in dates(period['start'], period['end'])}
    seen = set()
    for row in period['services']:
        if row['source_id'] in seen or row['shop_name'] != period['shop'] or row['service_date'] not in buckets:
            raise ValueError('invalid_period_row')
        seen.add(row['source_id'])
        buckets[row['service_date']].append(row)
    return [{'operation': OPERATION, 'shop': period['shop'], 'date': d,
             'fetched_at': period['fetched_at'], 'source_count': len(rows), 'services': rows}
            for d, rows in buckets.items()]


def metadata(snapshot):
    rows = snapshot['services']
    return {'count': len(rows), 'amount_cents': sum(int(Decimal(str(r['amount'])) * 100) for r in rows),
            'ids_md5': hashlib.md5(','.join(sorted(r['source_id'] for r in rows)).encode()).hexdigest(),
            'fetched_at': snapshot['fetched_at']}


def save(state):
    state['updated_at'] = datetime.now(daily.TZ).isoformat(timespec='seconds')
    with tempfile.NamedTemporaryFile(mode='w', dir=STATE.parent, delete=False) as f:
        json.dump(state, f, ensure_ascii=False)
        pending = f.name
    os.chmod(pending, 0o600)
    os.replace(pending, STATE)


def live_due():
    if not daily.STATE.exists():
        return True
    status = json.loads(daily.STATE.read_text())
    if time.time() < status.get('cooldown_until', 0):
        raise RuntimeError('source_cooldown_preserved')
    today = datetime.now(daily.TZ).date().isoformat()
    return any(time.time() - status.get('pairs', {}).get(shop + ':' + today, {}).get('success_at', 0) > 240
               for shop in daily.SHOPS)


@contextmanager
def source_slot(deadline):
    # A minute tick can arrive just before the five-minute live interval is due.
    # Allow the following tick and its booking prelude, without forcing a refresh.
    wait_until = min(deadline - 45, time.monotonic() + 180)
    with open(daily.LOCK, 'a') as source_lock:
        while time.monotonic() < wait_until:
            if not live_due():
                try:
                    fcntl.flock(source_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    try:
                        yield
                    finally:
                        fcntl.flock(source_lock, fcntl.LOCK_UN)
                    return
            time.sleep(2)
        raise TimeoutError('waiting_for_live_sync')


def write_group(shop, days, state, deadline):
    period = daily.fetch_period(shop, days[0], days[-1], min(deadline, time.monotonic() + 40))
    for snapshot in split_period(period):
        key = shop + ':' + snapshot['date']
        if key in state['pairs']:
            continue
        if deadline - time.monotonic() < 5 or time.time() - datetime.fromisoformat(snapshot['fetched_at']).timestamp() > 90:
            raise TimeoutError('backfill_budget')
        receipt = daily.private_customer.request(snapshot, timeout=min(15, deadline - time.monotonic()))
        if receipt.get('written') != 1 or receipt.get('count') != snapshot['source_count']:
            raise ValueError('invalid_write_receipt')
        state['pairs'][key] = metadata(snapshot)
        save(state)
        # Small write pacing, with a fresh timestamp on the next source period.
        time.sleep(0.2)


def run(max_groups=80, budget=1800):
    if not 1 <= max_groups <= 80 or not 60 <= budget <= 3600:
        raise ValueError('invalid_run_limit')
    deadline = time.monotonic() + budget
    with open(LOCK, 'a') as owner:
        try:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('backfill_already_running')
        state = json.loads(STATE.read_text()) if STATE.exists() else {'start': START, 'end': END, 'pairs': {}}
        if state.get('start') != START or state.get('end') != END:
            raise ValueError('checkpoint_scope_mismatch')
        allowed = {shop + ':' + d for shop in daily.SHOPS for d in dates(START, END)}
        if not set(state['pairs']).issubset(allowed):
            raise ValueError('checkpoint_keys_invalid')
        state.update(status='running', error='')
        save(state)
        completed_groups = 0
        try:
            for shop, days in groups():
                if all(shop + ':' + d in state['pairs'] for d in days):
                    continue
                if completed_groups >= max_groups or deadline - time.monotonic() < 50:
                    break
                # Yield before live consumption is due, never starve its lock.
                with source_slot(deadline):
                    write_group(shop, days, state, deadline)
                completed_groups += 1
                print(f"历史补齐 {daily.SHOPS[shop]} {days[0]}~{days[-1]}，已完成 {len(state['pairs'])}/{len(allowed)} 店日", flush=True)
                time.sleep(2)
            state['status'] = 'complete' if set(state['pairs']) == allowed else 'partial'
            save(state)
            return 0 if state['status'] == 'complete' else 2
        except Exception as exc:
            message = str(exc)
            code = message if re.fullmatch(r'[a-z_]+', message) else type(exc).__name__
            state.update(status='stopped', error=code)
            save(state)
            print(f"历史补齐已停止并保留进度: {code} ({len(state['pairs'])}/{len(allowed)} 店日)", flush=True)
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--max-groups', type=int, default=80)
    parser.add_argument('--budget-seconds', type=int, default=1800)
    args = parser.parse_args()
    try:
        raise SystemExit(run(args.max_groups, args.budget_seconds))
    except Exception as error:
        # Never print response bodies, credentials or customer rows on failure.
        print(f'补齐未完成: {type(error).__name__}', flush=True)
        raise SystemExit(1)
