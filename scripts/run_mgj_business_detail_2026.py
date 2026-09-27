#!/usr/bin/env python3
"""One bounded store/hour: current day by day, 2026 backfill off-hours.

Checkpoint contains store/date/count/status only; no customer, money or source
secrets. The signed writer remains the only cloud write path. No MGJ writes.
"""
import argparse
import fcntl
import json
import os
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from scripts import sync_mgj_business_details as sync
except ModuleNotFoundError:
    import sync_mgj_business_details as sync

TZ = ZoneInfo('Asia/Shanghai')
START = date(2026, 1, 1)
STATE = Path.home() / '.hermes/mgj_business_detail_2026_state.json'
LOCK = Path.home() / '.hermes/mgj_business_detail_2026.lock'
MIN_INTERVAL_SECONDS = 3600


def empty_state():
    return {'version': 1, 'pairs': {}, 'last_attempts': {}}


def read_state(path=STATE):
    if not path.exists():
        return empty_state()
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('pairs'), dict) or not isinstance(value.get('last_attempts'), dict):
        raise ValueError('invalid_checkpoint')
    allowed = set(sync.audit.daily.SHOPS)
    for key, row in value['pairs'].items():
        shop, sep, day = key.partition(':')
        if not sep or shop not in allowed or date.fromisoformat(day) < START or not isinstance(row, dict) or row.get('finalized') not in (True, False):
            raise ValueError('invalid_checkpoint_pair')
    if not set(value['last_attempts']).issubset(allowed) or any(type(v) not in (int, float) or v < 0 for v in value['last_attempts'].values()):
        raise ValueError('invalid_checkpoint_attempt')
    return value


def save_state(state, path=STATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as pending:
        os.chmod(pending.name, 0o600)
        json.dump(state, pending, ensure_ascii=False, sort_keys=True)
        pending.flush()
        os.fsync(pending.fileno())
        name = pending.name
    os.replace(name, path)


def target_date(shop, state, now):
    today = now.date()
    if today < START:
        raise ValueError('before_2026')
    if 9 <= now.hour < 22:
        return today.isoformat(), False
    yesterday = today - timedelta(days=1)
    if yesterday >= START and not state['pairs'].get(shop + ':' + yesterday.isoformat(), {}).get('finalized'):
        return yesterday.isoformat(), True
    day = START
    while day < today:
        if not state['pairs'].get(shop + ':' + day.isoformat(), {}).get('finalized'):
            return day.isoformat(), True
        day += timedelta(days=1)
    return today.isoformat(), False


def progress(state, today):
    total_days = (today - START).days
    expected = total_days * len(sync.audit.daily.SHOPS)
    completed = sum(bool(state['pairs'].get(shop + ':' + (START + timedelta(days=offset)).isoformat(), {}).get('finalized'))
                    for shop in sync.audit.daily.SHOPS for offset in range(total_days))
    return {'finalized_store_days': completed, 'past_store_days': expected}


def run_slot(shop, *, now=None, state_path=STATE, lock_path=LOCK, runner=None, epoch=None,
             source_ready=None, ready_wait_seconds=90, sleeper=time.sleep):
    shop = sync.audit.validate_shop(shop)
    now = now or datetime.now(TZ)
    if now.tzinfo is None:
        raise ValueError('timezone_required')
    now = now.astimezone(TZ)
    epoch = time.time() if epoch is None else epoch
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'yielded_scheduler_busy', 'shop': shop}
        state = read_state(state_path)
        if epoch - state['last_attempts'].get(shop, 0) < MIN_INTERVAL_SECONDS:
            return {'status': 'yielded_hourly_limit', 'shop': shop, **progress(state, now.date())}
        day, finalized = target_date(shop, state, now)
        ready = source_ready or (lambda: not sync.signed.daily_sync_due(sync.signed.read_daily_sync_state()))
        # Normal consumption refresh has priority. Wait for its fresh state
        # without touching MGJ; a due-only yield does not count as a source
        # attempt and must not suppress the next hourly slot.
        until = time.monotonic() + ready_wait_seconds
        while not ready() and time.monotonic() < until:
            sleeper(min(5, max(0, until - time.monotonic())))
        if not ready():
            return {'status': 'yielded_daily_sync_due', 'shop': shop, 'date': day, **progress(state, now.date())}
        # Persist the attempt before source access; retries cannot double the
        # request rate after an interrupted job or a restarted Mac.
        state['last_attempts'][shop] = epoch
        save_state(state, state_path)
        try:
            result = (runner or sync.run)(shop, day, write=True, budget=90, max_bills=100)
        except Exception as exc:
            return {'status': 'failed_or_unconfirmed', 'shop': shop, 'date': day, 'error_code': type(exc).__name__, **progress(state, now.date())}
        if result.get('status') in ('yielded_daily_sync_due', 'yielded_source_cooldown'):
            state['last_attempts'].pop(shop, None)
            save_state(state, state_path)
        if result.get('status') == 'accepted':
            state['pairs'][shop + ':' + day] = {'finalized': finalized, 'source_count': result['source_count'], 'synced_at': now.isoformat()}
            save_state(state, state_path)
        return {'status': result.get('status', 'invalid_result'), 'shop': shop, 'date': day,
                'source_count': result.get('source_count'), **progress(state, now.date())}


def main(argv=None):
    parser = argparse.ArgumentParser(description='每店每小时最多一次、错峰补齐 2026 年项目单明细')
    parser.add_argument('--shop', required=True, choices=sorted(sync.audit.daily.SHOPS))
    args = parser.parse_args(argv)
    try:
        result = run_slot(args.shop)
    except Exception as exc:
        result = {'status': 'failed_or_unconfirmed', 'error_code': type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] in ('accepted', 'yielded_hourly_limit', 'yielded_scheduler_busy',
                                     'yielded_daily_sync_due', 'yielded_source_cooldown') else 2


if __name__ == '__main__':
    raise SystemExit(main())
