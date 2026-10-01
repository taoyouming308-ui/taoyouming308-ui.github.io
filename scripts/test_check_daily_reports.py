import copy
import unittest
from datetime import datetime
from decimal import Decimal
from scripts import check_daily_reports as monitor

NOW = datetime.fromisoformat('2026-10-01T23:30:00+08:00')


def fixture():
    controls = {key: {'known': 1, 'value': '100.25'} for key in (
        'staff_value', 'staff_total', 'category_total', 'summary_actual',
        'summary_grand', 'payment_method', 'payment_cashflow', 'payment_total')}
    controls['payment_card_consumption'] = {'known': 1, 'value': '0'}
    cash = {'policy': 'operating-external-cash-v1', 'cash_channels_complete': True}
    draft = dict(id='synthetic', status='draft', revision=1, template='zysyr_frontdesk_project_draft',
                 metadata=dict(source_sha256='same', classification_issues=[], manual_conflicts=[],
                               daily_total_policy='cash-plus-earned-card-v1', cash_receipts=cash),
                 cell_count=40, duplicate_count=0, negative_count=0, source_cell_differences=[],
                 rows=[dict(label='合成员工', parts='100.25', total='100.25')],
                 categories=[dict(column_code='treatment', parts='100.25', total='100.25')],
                 controls=controls, stylist_subtotal='100.25', card_sales='0')
    stores = [dict(store_id=key, shop=name, source_snapshot_id='source', source_sha256='same',
                   source_seen_at='2026-10-01T21:30:00+08:00', list_seen_at=NOW.isoformat(),
                   source_list_changed=False, cash_available=True, cash_metadata=cash,
                   drafts=[copy.deepcopy(draft)]) for key, name in monitor.STORES.items()]
    return dict(schema=1, date='2026-10-01', checked_at=NOW.isoformat(), stores=stores)


class MonitorTests(unittest.TestCase):
    def check(self, data):
        return monitor.audit(data, '2026-10-01', now=NOW)

    def codes(self, data):
        return {i['code'] for i in self.check(data)['issues']}

    def test_pass_exact_decimals_and_no_mutation(self):
        data = fixture()
        before = copy.deepcopy(data)
        self.assertEqual(self.check(data)['status'], 'passed_covered_checks')
        self.assertEqual(data, before)
        self.assertEqual(monitor.money('0.10')+monitor.money('0.20'), Decimal('0.30'))

    def test_missing_employee_project_detected_despite_matching_grand(self):
        data = fixture()
        data['stores'][0]['drafts'][0]['rows'][0]['parts'] = '80.25'
        issue = next(i for i in self.check(data)['issues'] if i['code']=='employee_projects')
        self.assertEqual(issue['difference'], '20.00')

    def test_consistent_but_missing_source_project_and_manual_override(self):
        for manual in (True,False):
            data = fixture()
            data['stores'][0]['drafts'][0]['source_cell_differences'] = [dict(
                employee='测试',column='treatment',expected='500',actual='0',manual=manual,missing=False)]
            issue = self.check(data)['issues'][0]
            self.assertEqual(issue['code'],'source_cell_difference')
            self.assertEqual(issue['kind'],'review' if manual else 'mismatch')

    def test_unmapped_project_and_manual_conflict(self):
        data = fixture()
        meta = data['stores'][0]['drafts'][0]['metadata']
        meta['classification_issues'] = [dict(employee_name='测试', project_name='新项目', amount=20)]
        meta['manual_conflicts'] = ['synthetic']
        self.assertTrue({'project_unassigned', 'manual_source_conflict'} <= self.codes(data))

    def test_unknown_is_not_zero(self):
        data = fixture()
        data['stores'][0]['drafts'][0]['controls']['payment_cashflow'] = dict(value=None, known=0)
        self.assertIn('payment_channels_unknown', self.codes(data))

    def test_empty_rows_not_false_positive(self):
        data = fixture()
        data['stores'][0]['drafts'][0]['rows'].append(dict(label='unused', parts=None, total=None))
        self.assertFalse(self.check(data)['issues'])

    def test_source_missing_stale_changed(self):
        for field, value, code in (
            ('source_seen_at', None, 'source_seen_at'),
            ('list_seen_at', '2026-10-01T12:00:00+08:00', 'list_seen_at'),
            ('source_list_changed', True, 'source_not_current'),
            ('source_snapshot_id', None, 'source_not_current'),
            ('source_sha256', 'new', 'report_source_changed'),
            ('cash_metadata', {}, 'cash_source_changed'),
            ('cash_available', False, 'cash_source_incomplete')):
            with self.subTest(field=field):
                data = fixture()
                data['stores'][0][field] = value
                self.assertIn(code, self.codes(data))

    def test_missing_duplicate_draft(self):
        for n in (0, 2):
            data = fixture()
            data['stores'][0]['drafts'] *= n
            self.assertIn('report_count', self.codes(data))

    def test_cash_business_scope_not_equal_staff_is_valid(self):
        data = fixture()
        draft = data['stores'][0]['drafts'][0]
        for role in ('summary_actual','summary_grand','payment_method','payment_cashflow','payment_total'):
            draft['controls'][role]['value'] = '199.25'  # retail within operating receipts
        self.assertFalse(self.check(data)['issues'])

    def test_negative_duplicate_empty_cells(self):
        for field,value,code in (('negative_count',1,'negative_count'),('duplicate_count',1,'duplicate_count'),('cell_count',0,'cell_count')):
            data = fixture()
            data['stores'][0]['drafts'][0][field] = value
            self.assertIn(code,self.codes(data))

    def test_confirmed_not_replaced_by_new_cash_source(self):
        data = fixture()
        data['stores'][0]['drafts'][0]['status'] = 'confirmed'
        data['stores'][0]['cash_metadata'] = {}
        self.assertNotIn('cash_source_changed', self.codes(data))

    def test_category_and_payment_mismatch(self):
        data = fixture()
        draft = data['stores'][0]['drafts'][0]
        draft['categories'][0]['total'] = '1000'
        draft['controls']['payment_total']['value'] = '500'
        self.assertTrue({'category_total','grand_payment'} <= self.codes(data))

    def test_wrong_scope_or_old_snapshot_fails_closed(self):
        for field,value in (('date','2026-09-30'),('checked_at','2026-10-01T10:00:00+08:00'),('stores',[]),('schema',2)):
            data = fixture()
            data[field] = value
            with self.assertRaises(ValueError):
                self.check(data)

    def test_money_rejects_nonfinite_boolean(self):
        for value in ('NaN','Infinity',True):
            with self.assertRaises(ValueError):
                monitor.money(value)

    def test_sql_date_injection_and_cross_year(self):
        for value in ('2026-02-30', "2026-10-01'; delete from t;--", '2026-1-1'):
            with self.assertRaises(ValueError):
                monitor.query(value)
        sql = monitor.query('2027-01-01')
        self.assertIn("date '2027-01-01'",sql)
        self.assertIn('repeatable read read only',sql)
        self.assertIn("statement_timeout = '20s'",sql)
        self.assertNotIn(':day',sql)
        for mutation in ('insert into','update public.','delete from','alter table','create function'):
            self.assertNotIn(mutation,sql.lower())


if __name__ == '__main__':
    unittest.main()
