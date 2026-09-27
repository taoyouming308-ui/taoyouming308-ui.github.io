#!/usr/bin/env python3
"""Read MGJ's complete project-consumption list. Never calls a source write API.

Contract observed 2026-09-27: bill!bill.action?set=null, billFlag=0,
bill.type=-1 includes project/package/year-card consumption. Amount is the
source page's 入账 (billEafeeEdit), NOT cash receipts or employee commissions.
Only fully fetched, scope-checked pages may replace a private cloud snapshot.
"""
import argparse
import fcntl
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path

try:
    import mgj_private_customer as private_customer
except ModuleNotFoundError:
    from scripts import mgj_private_customer as private_customer

TZ = timezone(timedelta(hours=8))
SHOPS = {'1009951': '自由手艺人', '1837032': '向里造型'}
CONFIG = Path.home() / '.hermes/meiguanjia-care-config.json'
STATE = Path.home() / '.hermes/mgj_daily_consumption_status.json'
LOCK = '/tmp/mgj_daily_consumption.lock'
ENDPOINT = 'https://vip12.meiguanjia.net/shair/bill!bill.action?set=null'
INTERVAL = 300
MAX_ROWS = 1000
PAGE_SIZE = 100


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def find(self, tag=None, **attrs):
        return [n for n in self.walk() if (tag is None or n.tag == tag)
                and all(n.attrs.get(k) == v for k, v in attrs.items())]

    def walk(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.walk()

    def text(self):
        return ' '.join(c.text() if isinstance(c, Node) else c for c in self.children).strip()

    def by_class(self, name):
        return [n for n in self.walk() if name in n.attrs.get('class', '').split()]


class Document(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def only(nodes, label):
    if len(nodes) != 1:
        raise ValueError('source_structure_changed:' + label)
    return nodes[0]


def query_params(shop, day, page):
    # Send ALL filters on every page: never inherit server-side saved searches.
    return {'billFlag': 0, 'shopId': shop, 'bill.startDate': day, 'bill.endDate': day,
            'bill.type': -1, 'bill.consumeType': -1, 'bill.itemNo': -1,
            'notSharedPerformance': 2, 'bill.employeeId': 0, 'bill.payFlag': 0,
            'bill.mdFlag': 0, 'bill.otherFlag': 0, 'bill.operatorId': 0,
            'bill.orderFlag': 0, 'bill.errorFlag': 0, 'bill.repeatFlag': 0,
            'bill.emptyFlag': 0, 'bill.billNo': '', 'bill.startBillNo': '',
            'bill.endBillNo': '', 'page.currNum': page, 'page.rpp': PAGE_SIZE}


def parse_page(html, shop, day):
    root = Document(html).root
    form = only(root.find(id='searchForm'), 'searchForm')
    if only(form.find(id='pageShopId'), 'shop').attrs.get('value') != shop:
        raise ValueError('source_shop_mismatch')
    date_control = only(form.find(**{'data-start-name': 'bill.startDate'}), 'date')
    if date_control.attrs.get('data-start-value') != day or date_control.attrs.get('data-end-value') != day:
        raise ValueError('source_date_mismatch')
    for name, expected in [('bill.type', '-1'), ('bill.payFlag', '0'), ('bill.employeeId', '0'), ('bill.otherFlag', '0'), ('bill.mdFlag', '0'), ('bill.operatorId', '0')]:
        select = only(form.find('select', name=name), name)
        selected = [o for o in select.find('option') if 'selected' in o.attrs]
        if only(selected, name).attrs.get('value') != expected:
            raise ValueError('source_filter_mismatch:' + name)
    page = only(root.find(id='page'), 'page_count')
    count = re.search(r'共\s*(\d+)\s*条', page.text())
    if not count or int(count[1]) > MAX_ROWS:
        raise ValueError('source_count_missing_or_too_large')
    total = int(count[1])
    rows = []
    for row in root.find('tr'):
        key = row.attrs.get('data-id')
        if not key:
            continue
        if not re.fullmatch(r'\d+', key):
            raise ValueError('source_invalid_id')
        bill = only(row.by_class('billNoEdit'), 'bill')
        scope = urllib.parse.parse_qs(bill.attrs.get('data-params', ''))
        if scope.get('shopId') != [shop]:
            raise ValueError('bill_shop_mismatch')
        when = only(row.by_class('billDateEdit'), 'bill_date').text()
        if not re.fullmatch(re.escape(day) + r' \d{2}:\d{2}:\d{2}', when):
            raise ValueError('bill_date_mismatch')
        raw_amount = only(row.by_class('billEafeeEdit'), 'amount').text()
        if not re.fullmatch(r'\d+(?:\.\d{1,2})?', raw_amount):
            raise ValueError('invalid_source_amount')
        cents = int(Decimal(raw_amount) * 100)
        cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'td']
        if len(cells) < 8:
            raise ValueError('source_columns_changed')
        name = ' '.join(c for c in cells[3].children if isinstance(c, str)).strip()
        mobiles = cells[3].by_class('MGJ_mobile_str')
        raw_phone = mobiles[0].text() if mobiles else ''
        phone = re.sub(r'\D', '', raw_phone) if not re.search(r'[*×xX]', raw_phone) else ''
        if phone and not re.fullmatch(r'\d{7,20}', phone):
            phone = ''  # masked phones are not customer identities
        staff, stylists = [], []
        for employee in row.by_class('billEmpEdit'):
            match = re.search(r'\[([^\]]+)\]', employee.text())
            if match and match[1] not in staff:
                staff.append(match[1])
                if '设计师' in employee.text() or '发型师' in employee.text():
                    stylists.append(match[1])
        staff = stylists + [n for n in staff if n not in stylists]
        items = list(dict.fromkeys(n.text() for n in row.by_class('billItemEdit')))
        rows.append({'source_id': key, 'bill_no': bill.text(), 'customer_name': name,
                     'customer_phone': phone, 'shop_name': SHOPS[shop], 'service_date': day,
                     'service_time': when[11:16], 'amount': cents / 100,
                     'staff': staff, 'items': [{'name': n} for n in items], 'service_types': []})
    if len({r['source_id'] for r in rows}) != len(rows) or len(rows) > total or (total and not rows):
        raise ValueError('source_rows_inconsistent')
    return total, rows


def fetch_snapshot(shop, day, deadline, fetch=None):
    fetched_at = datetime.now(TZ).isoformat(timespec='seconds')
    cfg = json.loads(CONFIG.read_text()) if fetch is None else None
    def request(params):
        remaining = deadline - time.monotonic()
        if remaining < 2:
            raise TimeoutError('daily_consumption_budget')
        req = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode(params).encode(),
                headers={'Cookie': cfg['cookies'], 'Request-From': 'MGJ_SHAIR',
                         'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'})
        with urllib.request.urlopen(req, timeout=min(15, remaining)) as response:
            if response.status != 200 or urllib.parse.urlsplit(response.url).hostname != 'vip12.meiguanjia.net':
                raise ValueError('invalid_source_response')
            body = response.read(12_000_001)
            if len(body) > 12_000_000:
                raise ValueError('source_response_too_large')
            return body.decode('utf-8')
    reader = fetch or request
    total, rows = parse_page(reader(query_params(shop, day, 1)), shop, day)
    seen = {r['source_id'] for r in rows}
    page = 1
    while len(rows) < total:
        page += 1
        if page > 20:
            raise ValueError('source_pagination_limit')
        if fetch is None:
            time.sleep(1)
        next_total, incoming = parse_page(reader(query_params(shop, day, page)), shop, day)
        if next_total != total or not incoming or any(r['source_id'] in seen for r in incoming):
            raise ValueError('source_changed_during_pagination')
        rows.extend(incoming)
        seen.update(r['source_id'] for r in incoming)
    if len(rows) != total:
        raise ValueError('source_incomplete')
    return {'operation': 'daily_consumption_write', 'shop': SHOPS[shop], 'date': day,
            'fetched_at': fetched_at, 'source_count': total, 'services': rows}


def save_state(value):
    # Atomic, local-only metadata: no customer names, phones or cookies.
    today = datetime.now(TZ).date().isoformat()
    healthy = all(time.time() - value.get('pairs', {}).get(shop + ':' + today, {}).get('success_at', 0) <= 900
                  and not value.get('pairs', {}).get(shop + ':' + today, {}).get('error') for shop in SHOPS)
    value.update(updated_at=datetime.now(TZ).isoformat(timespec='seconds'), status='healthy' if healthy else 'degraded')
    with tempfile.NamedTemporaryFile(mode='w', dir=STATE.parent, delete=False) as f:
        json.dump(value, f, ensure_ascii=False)
        pending = f.name
    os.chmod(pending, 0o600)
    os.replace(pending, STATE)


def run(day=None, scheduled=False):
    deadline = time.monotonic() + 45
    now = datetime.now(TZ)
    days = [day or now.date().isoformat()]
    if scheduled:
        days.append((now.date() - timedelta(days=1)).isoformat())
    with open(LOCK, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        state = json.loads(STATE.read_text()) if STATE.exists() else {'pairs': {}}
        if scheduled and time.time() < state.get('cooldown_until', 0):
            return 0
        failed = False
        for date in days:
            for shop, name in SHOPS.items():
                key = shop + ':' + date
                previous = state['pairs'].get(key, {})
                interval = INTERVAL if date == days[0] else 86400
                if scheduled and (time.time() - previous.get('success_at', 0) < interval or time.time() < previous.get('retry_after', 0)):
                    continue
                if deadline - time.monotonic() < 5:
                    break
                try:
                    snapshot = fetch_snapshot(shop, date, deadline)
                    receipt = private_customer.request(snapshot, timeout=max(1, min(15, deadline - time.monotonic())))
                    if receipt.get('written') != 1 or receipt.get('count') != len(snapshot['services']):
                        raise ValueError('invalid_write_receipt')
                    amount = sum(Decimal(str(r['amount'])) for r in snapshot['services'])
                    state['pairs'][key] = {'success_at': time.time(), 'fetched_at': snapshot['fetched_at'], 'count': snapshot['source_count'], 'amount': str(amount)}
                    print(f'消费快照 {name} {date}: {snapshot["source_count"]}笔，项目入账{amount}', flush=True)
                except Exception as exc:
                    failed = True
                    previous.update(error=type(exc).__name__, retry_after=time.time() + 300)
                    state['pairs'][key] = previous
                    print(f'消费快照 {name} {date} 未更新，保留旧数据: {type(exc).__name__}', flush=True)
                    if isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403, 429):
                        state['cooldown_until'] = time.time() + 900
                        save_state(state)
                        return 1
                save_state(state)
        state['pairs'] = {k: v for k, v in state['pairs'].items() if k.split(':')[1] >= (now.date() - timedelta(days=7)).isoformat()}
        save_state(state)
        return int(failed)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', type=lambda d: datetime.strptime(d, '%Y-%m-%d').date().isoformat())
    parser.add_argument('--scheduled', action='store_true')
    args = parser.parse_args()
    raise SystemExit(run(args.date, args.scheduled))
