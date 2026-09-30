#!/usr/bin/env python3
"""Bounded live 15-minute slots; one alternating historical store/5 minutes.

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
END = date(2026, 12, 31)
STATE = Path.home() / '.hermes/mgj_business_detail_2026_state.json'
LOCK = Path.home() / '.hermes/mgj_business_detail_2026.lock'
LIVE_INTERVAL_SECONDS = 900
HISTORY_INTERVAL_SECONDS = 300
CASH_RETRY_SECONDS = 21600


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
        if not sep or shop not in allowed or not START <= date.fromisoformat(day) <= END or not isinstance(row, dict) or type(row.get('finalized')) is not bool:
            raise ValueError('invalid_checkpoint_pair')
        if ('cash_finalized' in row and type(row['cash_finalized']) is not bool
                or type(row.get('cash_retry_after', 0)) not in (int, float)
                or not 0 <= row.get('cash_retry_after', 0) < float('inf')):
            raise ValueError('invalid_cash_checkpoint')
    if not set(value['last_attempts']).issubset(allowed) or any(type(v) not in (int, float) or v < 0 for v in value['last_attempts'].values()):
        raise ValueError('invalid_checkpoint_attempt')
    if value.get('last_history_shop') not in (None, *allowed) or type(value.get('last_history_attempt', 0)) not in (int, float):
        raise ValueError('invalid_history_checkpoint')
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


def target_date(shop, state, now, mode='auto'):
    today = now.date()
    if today < START:
        raise ValueError('before_2026')
    if mode == 'live' or (mode == 'auto' and 9 <= now.hour < 22):
        return today.isoformat(), False
    yesterday = min(today - timedelta(days=1), END)
    def pending(day):
        row = state['pairs'].get(shop + ':' + day.isoformat(), {})
        return (not row.get('finalized') or (not row.get('cash_finalized')
                and now.timestamp() >= row.get('cash_retry_after', 0)))
    if yesterday >= START and pending(yesterday):
        return yesterday.isoformat(), True
    day = START
    while day <= yesterday:
        if pending(day):
            return day.isoformat(), True
        day += timedelta(days=1)
    return None


def progress(state, today):
    total_days = max(0, (min(today, END + timedelta(days=1)) - START).days)
    expected = total_days * len(sync.audit.daily.SHOPS)
    completed = sum(bool(state['pairs'].get(shop + ':' + (START + timedelta(days=offset)).isoformat(), {}).get('finalized'))
                    for shop in sync.audit.daily.SHOPS for offset in range(total_days))
    cash_completed = sum(bool(state['pairs'].get(shop + ':' + (START + timedelta(days=offset)).isoformat(), {}).get('cash_finalized'))
                         for shop in sync.audit.daily.SHOPS for offset in range(total_days))
    return {'finalized_store_days': completed, 'cash_finalized_store_days': cash_completed, 'past_store_days': expected}


def run_slot(shop=None, *, mode='auto', now=None, state_path=STATE, lock_path=LOCK, runner=None, epoch=None,
             source_ready=None, ready_wait_seconds=90, sleeper=time.sleep, backoff_reader=None,
             cash_runner=None, monotonic=time.monotonic):
    if mode not in ('auto', 'live', 'history'):
        raise ValueError('invalid_mode')
    if shop is not None:
        shop = sync.audit.validate_shop(shop)
    now = now or datetime.now(TZ)
    if now.tzinfo is None:
        raise ValueError('timezone_required')
    now = now.astimezone(TZ)
    epoch = time.time() if epoch is None else epoch
    daytime = 9 <= now.hour < 22
    mode = ('live' if daytime else 'history') if mode == 'auto' else mode
    if (mode == 'history' and daytime) or (mode == 'live' and not daytime):
        return {'status': 'yielded_outside_window', 'mode': mode}
    if mode == 'live' and shop is None:
        raise ValueError('live_shop_required')
    if mode == 'live' and now.date() > END:
        return {'status': 'year_scope_complete', 'mode': mode}
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'yielded_scheduler_busy', 'shop': shop}
        state = read_state(state_path)
        if mode == 'history':
            if epoch - state.get('last_history_attempt', 0) < HISTORY_INTERVAL_SECONDS:
                return {'status': 'yielded_cadence_limit', 'mode': mode, **progress(state, now.date())}
            stores = list(sync.audit.daily.SHOPS)
            if shop is None:
                previous = state.get('last_history_shop')
                shop = stores[(stores.index(previous) + 1) % len(stores)] if previous in stores else stores[0]
            target = target_date(shop, state, now, mode)
            if target is None:
                shop = next(value for value in stores if value != shop)
                target = target_date(shop, state, now, mode)
            if target is None:
                counts = progress(state, now.date())
                complete = counts['cash_finalized_store_days'] == counts['past_store_days']
                return {'status': 'history_complete' if complete else 'history_waiting_cash_retry', **counts}
        else:
            if epoch - state['last_attempts'].get(shop, 0) < LIVE_INTERVAL_SECONDS:
                return {'status': 'yielded_cadence_limit', 'shop': shop, 'mode': mode, **progress(state, now.date())}
            target = target_date(shop, state, now, mode)
        day, finalized = target
        if epoch < (backoff_reader or sync.read_backoff)().get('cooldown_until', 0):
            return {'status': 'yielded_source_cooldown', 'shop': shop, 'date': day, **progress(state, now.date())}
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
        previous_history = (state.get('last_history_attempt'), state.get('last_history_shop'))
        if mode == 'history':
            state.update(last_history_attempt=epoch, last_history_shop=shop)
        else:
            state['last_attempts'][shop] = epoch
        save_state(state, state_path)
        started = monotonic()
        pair = state['pairs'].get(shop + ':' + day, {})
        try:
            # Previously finalized detail snapshots are immutable evidence;
            # cash-only backfill must not repeat all their per-bill requests.
            if mode == 'history' and pair.get('finalized'):
                result = {'status': 'accepted', 'source_count': pair.get('source_count')}
            else:
                result = (runner or sync.run)(shop, day, write=True, budget=90, max_bills=100)
        except Exception as exc:
            code = str(exc) if str(exc) in ('invalid_money', 'posted_amount_mismatch', 'employee_id_alias_conflict') else type(exc).__name__
            return {'status': 'failed_or_unconfirmed', 'shop': shop, 'date': day, 'error_code': code, **progress(state, now.date())}
        if result.get('status') in ('yielded_daily_sync_due', 'yielded_source_cooldown'):
            if mode == 'history':
                for key, value in zip(('last_history_attempt', 'last_history_shop'), previous_history):
                    if value is None:
                        state.pop(key, None)
                    else:
                        state[key] = value
            else:
                state['last_attempts'].pop(shop, None)
            save_state(state, state_path)
        if result.get('status') == 'accepted':
            pair = {**pair, 'finalized': finalized, 'source_count': result['source_count'], 'synced_at': now.isoformat()}
            state['pairs'][shop + ':' + day] = pair
            save_state(state, state_path)
            # Reuse the existing staggered slot and the shared source lock.
            # Details + three cash summaries share one 90-second source budget.
            remaining = min(60, int(90 - (monotonic() - started)))
            cash = {'status': 'budget_exhausted', 'scopes': []}
            if remaining >= 15:
                try:
                    cash = (cash_runner or sync.signed.run)(shop, day, scope='cash', write=True, budget_seconds=remaining)
                except Exception as exc:
                    cash = {'status': 'failed_or_unconfirmed', 'error_code': type(exc).__name__, 'scopes': []}
            scopes = cash.get('scopes') or []
            expected = {sync.signed.SCOPE_NAMES[key] for key in sync.signed.selected_scopes('cash')}
            cash_complete = (len(scopes) == len(expected) and {row.get('scope') for row in scopes} == expected
                             and all(row.get('status') == 'accepted' for row in scopes))
            pair.update(cash_finalized=finalized and cash_complete, cash_status=cash.get('status', 'unconfirmed'),
                        cash_scopes=[{'scope':row.get('scope'), 'status':row.get('status')} for row in scopes])
            pair['cash_retry_after'] = 0 if cash_complete else now.timestamp() + CASH_RETRY_SECONDS
            save_state(state, state_path)
            result['cash_status'] = pair['cash_status']
        return {'status': result.get('status', 'invalid_result'), 'shop': shop, 'date': day,
                'source_count': result.get('source_count'), 'cash_status': result.get('cash_status'), **progress(state, now.date())}


def main(argv=None):
    parser = argparse.ArgumentParser(description='白天每店15分钟、夜间每5分钟两店交替补录2026明细')
    parser.add_argument('--shop', choices=sorted(sync.audit.daily.SHOPS))
    parser.add_argument('--mode', choices=('auto', 'live', 'history'), default='auto')
    args = parser.parse_args(argv)
    try:
        result = run_slot(args.shop, mode=args.mode)
    except Exception as exc:
        result = {'status': 'failed_or_unconfirmed', 'error_code': type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] in ('accepted', 'yielded_cadence_limit', 'yielded_scheduler_busy',
                                     'yielded_daily_sync_due', 'yielded_source_cooldown',
                                     'yielded_outside_window', 'history_complete', 'history_waiting_cash_retry', 'year_scope_complete') else 2


if __name__ == '__main__':
    raise SystemExit(main())
