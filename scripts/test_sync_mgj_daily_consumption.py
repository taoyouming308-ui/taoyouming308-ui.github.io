import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import sync_mgj_daily_consumption as daily


def page(ids=('10',), total=None, shop='1009951', day='2026-09-27', amount='100.10', phone='13800000000'):
    filters = ''.join(f'<select name="{n}"><option selected value="{v}">全部</option></select>' for n, v in [('bill.type', '-1'), ('bill.payFlag', '0'), ('bill.employeeId', '0'), ('bill.otherFlag', '0'), ('bill.mdFlag', '0'), ('bill.operatorId', '0')])
    rows = ''.join(f'''<tr data-id="{i}"><td></td><td><a class="billNoEdit" data-params="shopId={shop}&amp;billType=0">B{i}</a></td>
        <td><a class="billDateEdit">{day} 10:30:00</a></td><td>合成客户<br><span class="MGJ_mobile_str">{phone}</span></td>
        <td></td><td></td><td><a class="billEafeeEdit">{amount}</a></td><td><a class="billItemEdit">剪发</a><a class="billEmpEdit">01号 设计师 [合成员工]</a></td></tr>''' for i in ids)
    return f'''<form id="searchForm"><input id="pageShopId" value="{shop}"><div data-start-name="bill.startDate" data-start-value="{day}" data-end-value="{day}"></div>{filters}</form>
        <table><tbody>{rows}</tbody></table><div id="page">共{len(ids) if total is None else total}条</div>'''


class DailyConsumptionTests(unittest.TestCase):
    def test_full_page_and_money_from_accounted_not_employee(self):
        total, rows = daily.parse_page(page(), '1009951', '2026-09-27')
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]['amount'], 100.1)
        self.assertEqual(rows[0]['customer_name'], '合成客户')
        self.assertEqual(rows[0]['staff'], ['合成员工'])
        self.assertEqual(rows[0]['items'], [{'name': '剪发'}])

    def test_complete_pagination_and_explicit_filters(self):
        seen = []
        def fetch(p):
            seen.append(p)
            return page(('10',) if len(seen) == 1 else ('11',), total=2)
        result = daily.fetch_snapshot('1009951', '2026-09-27', time.monotonic()+10, fetch=fetch)
        self.assertEqual(result['source_count'], 2)
        self.assertEqual([p['page.currNum'] for p in seen], [1, 2])
        self.assertTrue(all(p['shopId'] == '1009951' and p['bill.type'] == -1 and p['billFlag'] == 0 for p in seen))

    def test_incomplete_changed_repeated_pages_never_return_snapshot(self):
        for second in [page(('10',),total=2), page(('11',),total=3), page((),total=2), '<html>登录已失效</html>']:
            responses = iter([page(('10',),total=2), second])
            with self.assertRaises(ValueError):
                daily.fetch_snapshot('1009951','2026-09-27',time.monotonic()+10,fetch=lambda _: next(responses))

    def test_scope_amount_and_page_structure_fail_closed(self):
        for html in [page(shop='1837032'), page(day='2026-09-26'), page(amount='NaN'), page(amount=''), page(ids=('10','10')), page().replace('共1条','读取失败'), page().replace('value="-1"','value="0"')]:
            with self.assertRaises(ValueError):
                daily.parse_page(html, '1009951', '2026-09-27')

    def test_zero_is_valid_only_with_complete_source_and_masked_identity_not_guessed(self):
        self.assertEqual(daily.parse_page(page(ids=()),'1009951','2026-09-27'),(0,[]))
        _, rows = daily.parse_page(page(amount='0.0',phone='138****1234'),'1009951','2026-09-27')
        self.assertEqual(rows[0]['customer_phone'],'')
        self.assertEqual(rows[0]['amount'],0)

    def test_historical_period_is_scoped_and_preserves_each_bill_date(self):
        html = page(day='2026-01-02').replace('data-start-value="2026-01-02" data-end-value="2026-01-02"', 'data-start-value="2026-01-01" data-end-value="2026-01-07"')
        seen = []
        def fetch(p):
            seen.append(p)
            return html
        period = daily.fetch_period('1009951','2026-01-01','2026-01-07',time.monotonic()+10,fetch)
        self.assertEqual(period['services'][0]['service_date'],'2026-01-02')
        self.assertEqual(seen[0]['bill.endDate'],'2026-01-07')
        for bad in [html.replace('2026-01-02 10:30','2026-01-08 10:30'), html.replace('data-end-value="2026-01-07"','data-end-value="2026-01-06"')]:
            with self.assertRaises(ValueError):
                daily.parse_page(bad,'1009951','2026-01-01','2026-01-07')
        with self.assertRaises(ValueError):
            daily.fetch_period('1009951','2026-01-01','2026-01-08',time.monotonic()+10,fetch)

    def test_failure_preserves_previous_success_and_five_minute_cadence(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(daily,'STATE',Path(tmp)/'state.json'), patch.object(daily,'LOCK',str(Path(tmp)/'lock')):
            day = daily.datetime.now(daily.TZ).date().isoformat()
            snapshot = {'operation':'daily_consumption_write','source_count':1,'services':[{'amount':100}], 'fetched_at':'synthetic'}
            with patch.object(daily,'fetch_snapshot',return_value=snapshot), patch.object(daily.private_customer,'request',return_value={'written':1,'count':1}):
                self.assertEqual(daily.run(scheduled=True),0)
            before=daily.json.loads(daily.STATE.read_text())
            with patch.object(daily,'fetch_snapshot') as fetch:
                self.assertEqual(daily.run(scheduled=True),0)
                fetch.assert_not_called()
            with patch.object(daily,'fetch_snapshot',side_effect=ValueError('bad source')), patch.object(daily.private_customer,'request') as write:
                self.assertEqual(daily.run(day),1)
                write.assert_not_called()
            after=daily.json.loads(daily.STATE.read_text())
            self.assertEqual(before['pairs']['1009951:'+day]['success_at'],after['pairs']['1009951:'+day]['success_at'])


if __name__ == '__main__':
    unittest.main()
