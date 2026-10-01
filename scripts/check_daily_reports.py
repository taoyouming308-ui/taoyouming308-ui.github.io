#!/usr/bin/env python3
"""Read-only daily report audit; no network client, credentials, writes or posting.

--sql emits a fixed scoped query for the connected Supabase read tool.
--input accepts its single {audit: ...} result, or the unwrapped audit object.
Exit 0: covered checks passed, 1: attention required, 2: check failed.
"""
import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

TZ = timezone(timedelta(hours=8))
STORES = {
    'ea7e281f-a254-4664-bb03-cf1acf48d79d': '自由手艺人',
    '8d057980-ff8f-4b2c-9c7f-4dd23a568f35': '向里造型',
}


def day_value(value):
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('invalid_date')
    return value


def query(day):
    return Path(__file__).with_suffix('.sql').read_text().replace(':day', day_value(day))


def money(value):
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError('invalid_amount')
    amount = Decimal(str(value))
    if not amount.is_finite() or abs(amount) > Decimal('1000000000000'):
        raise ValueError('invalid_amount')
    return amount


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone_missing')
    return result


def audit(data, day, now=None):
    day_value(day)
    if isinstance(data, list) and len(data) == 1:
        data = data[0]
    if isinstance(data, dict) and 'audit' in data:
        data = data['audit']
    if data.get('schema') != 1 or data.get('date') != day:
        raise ValueError('snapshot_scope_invalid')
    now = now or datetime.now(TZ)
    checked = timestamp(data['checked_at'])
    if abs((now - checked).total_seconds()) > 900:
        raise ValueError('snapshot_stale')
    stores = data['stores']
    if len(stores) != 2 or {s['store_id'] for s in stores} != set(STORES):
        raise ValueError('store_scope_invalid')
    issues, summaries = [], []

    def add(shop, code, message, kind='review', **details):
        issues.append(dict(shop=shop, code=code, kind=kind, message=message, **details))

    def compare(shop, code, label, parts, total):
        if parts is None or total is None:
            add(shop, code + '_unknown', label + '缺少可核对的金额', kind='incomplete')
        elif abs(parts-total) > Decimal('0.01'):
            add(shop, code, label + '不一致', kind='mismatch',
                expected=str(parts), actual=str(total), difference=str(total-parts))

    for store in stores:
        shop = STORES[store['store_id']]
        if store['shop'] != shop:
            raise ValueError('store_name_invalid')
        for key in ('source_seen_at', 'list_seen_at'):
            value = store[key]
            # Existing detail sync stops after 21:52; allow 3h at the 23:30 check.
            if value is None or not -300 <= (checked-timestamp(value)).total_seconds() <= 10800:
                add(shop, key, '来源缺失或超过3小时未核验', kind='incomplete')
        if not store['source_snapshot_id'] or store['source_list_changed'] is not False:
            add(shop, 'source_not_current', '单据列表与项目明细未同步齐', kind='incomplete')
        drafts = store['drafts']
        if len(drafts) != 1:
            add(shop, 'report_count', '当天日报缺失或存在多张，需要核对', count=len(drafts))
            continue
        draft = drafts[0]
        meta = draft.get('metadata') or {}
        if draft['status'] not in ('draft', 'confirmed'):
            add(shop, 'report_status', '日报状态需要核对', status=draft['status'])
        summaries.append(dict(shop=shop, status=draft['status'], revision=draft['revision']))
        if draft['cell_count'] == 0 or draft['cell_count'] > 10000:
            add(shop, 'cell_count', '日报为空或超过检查容量', count=draft['cell_count'])
        for key in ('negative_count', 'duplicate_count'):
            if draft[key]:
                add(shop, key, '存在负值或重复单元格，需要财务核对', count=draft[key])
        auto = draft['template'] == 'zysyr_frontdesk_project_draft'
        if auto:
            for diff in draft['source_cell_differences']:
                add(shop, 'source_cell_difference',
                    '员工项目与来源不同；人工修改不覆盖' if diff['manual'] else '员工项目缺失或与来源不同',
                    kind='review' if diff['manual'] else 'mismatch', **diff)
            if meta.get('classification_issues') is None:
                add(shop, 'classification_unavailable', '缺少项目完整性检查结果', kind='incomplete')
            for item in meta.get('classification_issues') or []:
                add(shop, 'project_unassigned', '项目尚未完整归栏；已计入小计，不可重复加总',
                    employee=item.get('employee_name'), project=item.get('project_name'),
                    amount=item.get('amount'), bill=item.get('bill_id'), reason=item.get('reason'))
            if meta.get('manual_conflicts'):
                add(shop, 'manual_source_conflict', '来源与人工修改存在差异，保留人工值待核对',
                    count=len(meta['manual_conflicts']))
            # A confirmed sheet is immutable history. Changed sources require review, not replacement.
            if meta.get('source_sha256') != store['source_sha256']:
                add(shop, 'report_source_changed', '日报使用的项目来源与最新来源不同', kind='incomplete')
        controls = draft['controls']
        for role in ('summary_actual','summary_grand','payment_cashflow','payment_card_consumption','payment_total'):
            if (controls.get(role) or {}).get('known', 0) > 1:
                add(shop, 'duplicate_control', '同一汇总控制金额出现多次', role=role)

        def control(role):
            item = controls.get(role) or {}
            return money(item.get('value')) if item.get('known', 0) else None

        for row in draft['rows']:
            parts, total = money(row['parts']), money(row['total'])
            if parts is None and total is None:
                continue  # Unused template row, not proof of zero business.
            compare(shop, 'employee_projects', '员工 '+str(row['label'])+' 项目合计与小计', parts, total)
        for category in draft['categories']:
            parts, total = money(category['parts']), money(category['total'])
            if parts is None and total is None:
                continue
            compare(shop, 'category_total', '项目 '+category['column_code']+' 列合计', parts, total)
        staff = control('staff_value')
        compare(shop, 'staff_subtotal', '员工项目合计与造型区小计', staff, money(draft['stylist_subtotal']))
        cash = control('payment_cashflow')
        card = control('payment_card_consumption')
        actual, grand = control('summary_actual'), control('summary_grand')
        payment = control('payment_total')
        compare(shop, 'payment_channels', '付款渠道与现金业绩', control('payment_method'), cash)
        cash_mode = (meta.get('cash_receipts') or {}).get('policy') == 'operating-external-cash-v1'
        if cash_mode:
            if store['cash_available'] is not True or (meta.get('cash_receipts') or {}).get('cash_channels_complete') is not True:
                add(shop, 'cash_source_incomplete', '收款来源存在未知字段，不能认定已完整核对', kind='incomplete')
            if draft['status'] != 'confirmed' and meta.get('cash_receipts') != store['cash_metadata']:
                add(shop, 'cash_source_changed', '草稿付款来源与最新收款批次不同', kind='incomplete')
            if meta.get('daily_total_policy') == 'cash-plus-earned-card-v1':
                compare(shop, 'cash_card_actual', '现金业绩加实际卡金与实做',
                        None if cash is None or card is None else cash+card, actual)
            else:
                compare(shop, 'cash_actual', '现金业绩与实做', cash, actual)
            sales = money(draft['card_sales'])
            compare(shop, 'actual_card_sales', '实做加新卡收款与总计',
                    None if actual is None or sales is None else actual+sales, grand)
        else:
            compare(shop, 'staff_actual', '员工合计与实做', staff, actual)
            compare(shop, 'staff_grand', '员工合计与总计', staff, grand)
            compare(shop, 'cash_card_payment', '现金加卡金与支付总计',
                    None if cash is None or card is None else cash+card, payment)
        compare(shop, 'grand_payment', '总计与支付总计', grand, payment)
    return dict(date=day, checked_at=data['checked_at'],
                status='attention' if issues else 'passed_covered_checks',
                stores=summaries, issues=issues,
                limitations=['只核对系统已采集来源，不证明未上传原件或源系统本身无误',
                             '未确认候选不是正式账；人工修改保留，不自动入账或修正'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=datetime.now(TZ).date().isoformat())
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--sql', action='store_true')
    group.add_argument('--input', help='JSON result file, or - for stdin')
    args = parser.parse_args(argv)
    try:
        if args.sql:
            print(query(args.date))
            return 0
        raw = sys.stdin.read(2_000_001) if args.input == '-' else Path(args.input).read_text()
        if len(raw) > 2_000_000:
            raise ValueError('snapshot_too_large')
        result = audit(json.loads(raw, parse_float=Decimal), args.date)
        print(json.dumps(result, ensure_ascii=False, default=str))
        return int(bool(result['issues']))
    except Exception:
        # Never leak raw payloads, credentials, or database error contents.
        print(json.dumps({'status': 'check_failed', 'message': '检查失败，不能认定日报正常'}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
