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

SAFE_AUDIT_ERROR_CODES = frozenset({
    'budget_exhausted', 'curl_timeout', 'curl_unavailable',
    'http_status:400', 'http_status:401', 'http_status:403',
    'http_status:404', 'http_status:408', 'http_status:429',
    'http_status:500', 'http_status:502', 'http_status:503', 'http_status:504',
    'invalid_json_response', 'source_response_rejected', 'source_detail_missing',
    'invalid_source_datetime', 'bill_id_mismatch', 'bill_shop_mismatch',
    'bill_date_mismatch', 'source_lock_busy', 'session_config_unavailable',
})


def safe_error_code(exc):
    # Only fixed literal codes survive; never retain arbitrary exception text.
    if type(exc).__name__ == 'AuditError' and str(exc) in SAFE_AUDIT_ERROR_CODES:
        return str(exc)
    if str(exc) in ('invalid_money', 'posted_amount_mismatch', 'employee_id_alias_conflict'):
        return str(exc)
    return type(exc).__name__


def diagnostic_fields(exc):
    # Export fixed labels/numeric status only. Never URL, headers or body.
    stage = vars(exc).get('business_sync_stage')
    result = {}
    if stage in {'source_list', 'source_detail', 'normalize', 'source_recheck', 'signing_key', 'cloud_submit'}:
        result['failure_stage'] = stage
    if isinstance(exc, sync.urllib.error.HTTPError) and type(exc.code) is int and 100 <= exc.code <= 599:
        result['http_status'] = exc.code
    hint = vars(exc).get('business_contract_hint')
    allowed_hints = {'gaps_format'}
    for collection, fields, suffix in (
        ('items', ('source_item_id',), 'format'),
        ('employee_allocations', ('source_allocation_id', 'employee_id', 'source_item_id'), 'format'),
        ('items', ('item_code', 'item_name', 'source_category_code', 'source_category_name'), 'length'),
        ('employee_allocations', ('employee_name', 'source_role'), 'length'),
        ('payments', ('source_label',), 'length'),
    ):
        allowed_hints.update(collection + '_' + field + '_' + suffix for field in fields)
    if hint in allowed_hints:
        result['contract_hint'] = hint
    return result


TZ = ZoneInfo('Asia/Shanghai')
START = date(2026, 1, 1)
END = date(2026, 12, 31)
STATE = Path.home() / '.hermes/mgj_business_detail_2026_state.json'
LOCK = Path.home() / '.hermes/mgj_business_detail_2026.lock'
LIVE_INTERVAL_SECONDS = 900
HISTORY_INTERVAL_SECONDS = 300
DAY_HISTORY_INTERVAL_SECONDS = 900
CASH_RETRY_SECONDS = 21600
DETAIL_RETRY_SECONDS = 21600


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
                or not 0 <= row.get('cash_retry_after', 0) < float('inf')
                or type(row.get('detail_retry_after', 0)) not in (int, float)
                or not 0 <= row.get('detail_retry_after', 0) < float('inf')):
            raise ValueError('invalid_cash_checkpoint')
    if not set(value['last_attempts']).issubset(allowed) or any(type(v) not in (int, float) or v < 0 for v in value['last_attempts'].values()):
        raise ValueError('invalid_checkpoint_attempt')
    if value.get('last_history_shop') not in (None, *allowed) or type(value.get('last_history_attempt', 0)) not in (int, float):
        raise ValueError('invalid_history_checkpoint')
    kinds = value.get("last_history_kind", {})
    if (not isinstance(kinds, dict) or not set(kinds).issubset(allowed)
            or any(kind not in ("detail", "cash") for kind in kinds.values())):
        raise ValueError("invalid_history_kind")
    return value


def cash_empty_backoff(day, now, scopes, expected, previous):
    """Only exact safe no-row evidence counts, separately per store/day/scope."""
    previous = previous if isinstance(previous, dict) else {}
    streaks = {}
    by_scope = {}
    for row in scopes:
        scope = row.get('scope')
        if scope not in expected or scope in by_scope:
            return {}, False
        by_scope[scope] = row
    for scope in expected:
        old = previous.get(scope, 0)
        old = old if type(old) is int and 0 <= old <= 2 else 0
        row = by_scope.get(scope)
        if row and row.get('status') == 'missing_source' and row.get('reason') == 'summary_no_rows':
            streaks[scope] = min(2, old + 1)
        elif row and row.get('status') in ('yielded_daily_sync_due', 'yielded_source_cooldown'):
            streaks[scope] = old  # No observation, no extra consecutive evidence.
        else:
            streaks[scope] = 0  # Success, other failure or missing evidence resets.
    unresolved = [scope for scope in expected if by_scope.get(scope, {}).get('status') != 'accepted']
    eligible = (len(by_scope) == len(expected) and bool(unresolved)
                and (now.date() - date.fromisoformat(day)).days > 7
                and all(by_scope[scope].get('status') == 'missing_source'
                        and by_scope[scope].get('reason') == 'summary_no_rows'
                        and streaks[scope] >= 2 for scope in unresolved))
    return streaks, eligible


def save_state(state, path=STATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as pending:
        os.chmod(pending.name, 0o600)
        json.dump(state, pending, ensure_ascii=False, sort_keys=True)
        pending.flush()
        os.fsync(pending.fileno())
        name = pending.name
    os.replace(name, path)


def june_priority_target(state, now):
    """Temporary existing-slot priority; no I/O or changes to retry state."""
    yesterday = min(now.date() - timedelta(days=1), END)
    if yesterday < date(2026, 6, 1):
        return None
    eligible_cash = None
    for offset in range(30):
        day = date(2026, 6, 1) + timedelta(days=offset)
        if day > yesterday:
            break
        row = state['pairs'].get('1837032:' + day.isoformat(), {})
        if not row.get('finalized'):
            if now.timestamp() >= row.get('detail_retry_after', 0):
                return day.isoformat(), True
        elif (not row.get('cash_finalized') and eligible_cash is None
              and now.timestamp() >= row.get('cash_retry_after', 0)):
            eligible_cash = day.isoformat(), True
    return eligible_cash


def target_date(shop, state, now, mode='auto'):
    today = now.date()
    if today < START:
        raise ValueError('before_2026')
    if mode == 'live' or (mode == 'auto' and 9 <= now.hour < 22):
        return today.isoformat(), False
    yesterday = min(today - timedelta(days=1), END)
    candidates = {'detail': None, 'cash': None}
    # Yesterday remains first within each queue, never ahead of the other queue.
    days = ([yesterday] if yesterday >= START else [])
    days += [START + timedelta(days=n) for n in range(max(0, (yesterday-START).days))]
    if shop == '1837032' and mode == 'history':
        priority = june_priority_target(state, now)
        if priority is not None:
            return priority
    for day in days:
        row = state['pairs'].get(shop + ':' + day.isoformat(), {})
        kind = 'cash' if row.get('finalized') else 'detail'
        retry = 'cash_retry_after' if kind == 'cash' else 'detail_retry_after'
        if (candidates[kind] is None and (kind == 'detail' or not row.get('cash_finalized'))
                and now.timestamp() >= row.get(retry, 0)):
            candidates[kind] = (day.isoformat(), True)
        if all(candidates.values()):
            break
    previous = state.get('last_history_kind', {}).get(shop)
    preferred = 'cash' if previous == 'detail' else 'detail'
    return candidates[preferred] or candidates['detail' if preferred == 'cash' else 'cash']


def progress(state, today):
    total_days = max(0, (min(today, END + timedelta(days=1)) - START).days)
    expected = total_days * len(sync.audit.daily.SHOPS)
    completed = sum(bool(state['pairs'].get(shop + ':' + (START + timedelta(days=offset)).isoformat(), {}).get('finalized'))
                    for shop in sync.audit.daily.SHOPS for offset in range(total_days))
    cash_completed = sum(bool(state['pairs'].get(shop + ':' + (START + timedelta(days=offset)).isoformat(), {}).get('cash_finalized'))
                         for shop in sync.audit.daily.SHOPS for offset in range(total_days))
    shops = {}
    for shop, name in sync.audit.daily.SHOPS.items():
        rows = [state['pairs'].get(shop + ':' + (START + timedelta(days=n)).isoformat(), {}) for n in range(total_days)]
        details = sum(bool(r.get('finalized')) for r in rows)
        cash = sum(bool(r.get('cash_finalized')) for r in rows)
        both = sum(bool(r.get('finalized') and r.get('cash_finalized')) for r in rows)
        shops[name] = {'expected_days': total_days, 'detail_days': details, 'cash_days': cash,
                       'source_complete_days': both, 'remaining_source_days': total_days-both,
                       'deferred_detail_days': sum(bool(r.get('detail_retry_after')) for r in rows)}
    return {'finalized_store_days': completed, 'cash_finalized_store_days': cash_completed,
            'past_store_days': expected, 'shops': shops, 'report_completion_not_implied': True}


def defer_detail(state, shop, day, now, status):
    key = shop + ':' + day
    row = state['pairs'].setdefault(key, {'finalized': False})
    row.update(detail_retry_after=now.timestamp()+DETAIL_RETRY_SECONDS, detail_status=status)


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
    # Daytime history is explicit and staggered; auto still prioritizes today.
    if mode == 'live' and not daytime:
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
            interval = DAY_HISTORY_INTERVAL_SECONDS if daytime else HISTORY_INTERVAL_SECONDS
            if epoch - state.get('last_history_attempt', 0) < interval:
                return {'status': 'yielded_cadence_limit', 'mode': mode, **progress(state, now.date())}
            stores = list(sync.audit.daily.SHOPS)
            if shop is None:
                if june_priority_target(state, now) is not None:
                    shop = '1837032'
                else:
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
        previous_kinds = dict(state.get('last_history_kind', {}))
        had_kinds = 'last_history_kind' in state
        previous_pair = dict(state['pairs'].get(shop + ':' + day, {}))
        def restore_history():
            for key, value in zip(('last_history_attempt', 'last_history_shop'), previous_history):
                if value is None:
                    state.pop(key, None)
                else:
                    state[key] = value
            if had_kinds:
                state['last_history_kind'] = previous_kinds
            else:
                state.pop('last_history_kind', None)
        if mode == 'history':
            state.update(last_history_attempt=epoch, last_history_shop=shop)
            state.setdefault('last_history_kind', {})[shop] = ('cash' if previous_pair.get('finalized') else 'detail')
        else:
            state['last_attempts'][shop] = epoch
        save_state(state, state_path)
        started = monotonic()
        pair = state['pairs'].get(shop + ':' + day, {})
        detail_reused = bool(mode == 'history' and pair.get('finalized'))
        try:
            # Previously finalized detail snapshots are immutable evidence;
            # cash-only backfill must not repeat all their per-bill requests.
            if mode == 'history' and pair.get('finalized'):
                result = {'status': 'accepted', 'source_count': pair.get('source_count')}
            else:
                result = (runner or sync.run)(shop, day, write=True, budget=90, max_bills=100)
        except Exception as exc:
            code = safe_error_code(exc)
            if mode == 'history':
                defer_detail(state, shop, day, now, code)
                save_state(state, state_path)
            return {'status': 'failed_or_unconfirmed', 'shop': shop, 'date': day, 'error_code': code, **diagnostic_fields(exc),
                    'elapsed_seconds': round(monotonic()-started, 2), **progress(state, now.date())}
        if result.get('status') in ('yielded_daily_sync_due', 'yielded_source_cooldown'):
            if mode == 'history':
                restore_history()
            else:
                state['last_attempts'].pop(shop, None)
            save_state(state, state_path)
        elif result.get('status') != 'accepted' and mode == 'history':
            defer_detail(state, shop, day, now, result.get('status', 'unconfirmed'))
            save_state(state, state_path)
        if result.get('status') == 'accepted':
            pair = {**pair, 'finalized': finalized, 'source_count': result['source_count'], 'synced_at': now.isoformat(),
                    'detail_retry_after': 0, 'detail_status': 'accepted'}
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
            # A cash-only task that yielded before any accepted scope has not
            # consumed a queue turn; restore its additive checkpoint exactly.
            cash_yielded = (detail_reused and cash.get('status') in
                            ('yielded_daily_sync_due', 'yielded_source_cooldown')
                            and not any(row.get('status') == 'accepted' for row in scopes))
            if cash_yielded:
                restore_history()
                state['pairs'][shop + ':' + day] = previous_pair
                save_state(state, state_path)
                return {'status': cash['status'], 'shop': shop, 'date': day,
                        'detail_reused': True, 'elapsed_seconds': round(monotonic()-started, 2),
                        **progress(state, now.date())}
            streaks, empty_deferred = cash_empty_backoff(
                day, now, scopes, expected, pair.get('cash_empty_streaks'))
            pair['cash_empty_streaks'] = streaks
            # Today/recent days and all other failures retain six-hour retry.
            retry_seconds = 86400 if mode == 'history' and empty_deferred else CASH_RETRY_SECONDS
            pair['cash_retry_after'] = 0 if cash_complete else now.timestamp() + retry_seconds
            save_state(state, state_path)
            result['cash_status'] = pair['cash_status']
        return {'status': result.get('status', 'invalid_result'), 'shop': shop, 'date': day,
                'source_count': result.get('source_count'), 'cash_status': result.get('cash_status'),
                'detail_reused': detail_reused,
                'elapsed_seconds': round(monotonic()-started, 2), **progress(state, now.date())}


def main(argv=None):
    parser = argparse.ArgumentParser(description='当天每店15分钟；历史白天15分钟/夜间5分钟全局轮换')
    parser.add_argument('--shop', choices=sorted(sync.audit.daily.SHOPS))
    parser.add_argument('--mode', choices=('auto', 'live', 'history'), default='auto')
    parser.add_argument('--status', action='store_true', help='只读汇总进度，不访问美管加或写入数据')
    args = parser.parse_args(argv)
    try:
        result = ({'status': 'progress', **progress(read_state(), datetime.now(TZ).date())}
                  if args.status else run_slot(args.shop, mode=args.mode))
    except Exception as exc:
        result = {'status': 'failed_or_unconfirmed', 'error_code': type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] in ('progress', 'accepted', 'yielded_cadence_limit', 'yielded_scheduler_busy',
                                     'yielded_daily_sync_due', 'yielded_source_cooldown',
                                     'yielded_outside_window', 'history_complete', 'history_waiting_cash_retry', 'year_scope_complete') else 2


if __name__ == '__main__':
    raise SystemExit(main())
