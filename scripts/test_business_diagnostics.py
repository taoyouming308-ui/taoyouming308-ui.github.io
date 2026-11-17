import json
import unittest
from scripts import sync_mgj_business_details as sync
from scripts import run_mgj_business_detail_2026 as task
from scripts.test_sync_mgj_business_details import BusinessSyncTests as _BusinessSyncTests
from scripts.test_run_mgj_business_detail_2026 import ScheduleTests as _ScheduleTests

class DiagnosticTests(unittest.TestCase):
    def fail_http(self, *args):
        raise sync.urllib.error.HTTPError('https://secret.invalid?token=PRIVATE', 503, 'PRIVATE_BODY', {'cookie':'PRIVATE'}, None)

    def test_list_and_cloud_are_distinct_without_retries(self):
        for target,stage in [('period_reader','source_list'),('submitter','cloud_submit')]:
            base=_BusinessSyncTests(); opts=base.options(); opts[target]=self.fail_http
            with self.assertRaises(sync.urllib.error.HTTPError) as caught:
                sync.run('1837032','2026-01-01',write=True,**opts)
            fields=task.diagnostic_fields(caught.exception)
            self.assertEqual(fields,{'failure_stage':stage,'http_status':503})
            self.assertNotIn('PRIVATE',json.dumps(fields))
            self.assertEqual(base.calls,[])
            self.assertTrue(base.lock.closed)

    def test_recheck_is_labeled(self):
        base=_BusinessSyncTests(); opts=base.options(); count=[]
        def read(*args):
            count.append(1)
            if len(count)>1: return self.fail_http()
            return base.period
        opts['period_reader']=read
        with self.assertRaises(sync.urllib.error.HTTPError) as caught:
            sync.run('1837032','2026-01-01',write=True,**opts)
        self.assertEqual(task.diagnostic_fields(caught.exception)['failure_stage'],'source_recheck')
        self.assertEqual(len(count),2)
        self.assertEqual(base.calls,[])

    def test_detail_timeout_retains_error_code(self):
        base=_BusinessSyncTests(); opts=base.options()
        def fail(*args): raise sync.audit.AuditError('curl_timeout')
        opts['detail_reader']=fail
        with self.assertRaises(sync.audit.AuditError) as caught:
            sync.run('1837032','2026-01-01',write=True,**opts)
        self.assertEqual(task.diagnostic_fields(caught.exception),{'failure_stage':'source_detail'})
        self.assertEqual(task.safe_error_code(caught.exception),'curl_timeout')

    def test_unknown_attributes_not_serialized(self):
        exc=RuntimeError('PRIVATE'); exc.business_sync_stage='PRIVATE'; exc.code='PRIVATE'
        self.assertEqual(task.diagnostic_fields(exc),{})

    def test_runner_outputs_only_safe_diagnostics(self):
        base=_ScheduleTests(); base.setUp()
        try:
            def fail(*args,**kwargs):
                try: self.fail_http()
                except Exception as exc:
                    exc.business_sync_stage='cloud_submit'; raise
            result=base.run_at('1837032',11,100000,fail)
            self.assertEqual(result['failure_stage'],'cloud_submit')
            self.assertEqual(result['http_status'],503)
            self.assertNotIn('PRIVATE',json.dumps(result))
            self.assertEqual(task.read_state(base.state)['pairs'],{})
        finally: base.doCleanups()


class ContractHintTests(unittest.TestCase):
    def test_missing_optional_lists_produce_safe_hint(self):
        from scripts.test_mgj_business_detail import fixture
        from scripts.mgj_business_detail import normalize_bill
        for field in ('empList','payConfigs'):
            raw=fixture(); raw.pop(field,None)
            bill=normalize_bill(raw,bill_id='42',shop='1837032',day='2026-01-01')
            self.assertIsNone(sync.contract_hint({'source':{'bills':[bill]}}))
            bill['gaps'].append('legacyCamelCase_missing')
            self.assertEqual(sync.contract_hint({'source':{'bills':[bill]}}),'gaps_format')

    def test_http400_annotates_without_swallowing_or_leaking(self):
        base=_BusinessSyncTests(); opts=base.options()
        def fail(*args):
            raise sync.urllib.error.HTTPError('https://private.invalid',400,'PRIVATE',{},None)
        def detail(*args):
            from scripts.test_mgj_business_detail import fixture
            raw=fixture();raw['empfees'][0]['empname']='😀'*101;return raw
        opts['detail_reader']=detail;opts['submitter']=fail
        with self.assertRaises(sync.urllib.error.HTTPError) as caught:
            sync.run('1837032','2026-01-01',write=True,**opts)
        self.assertEqual(task.diagnostic_fields(caught.exception),{'failure_stage':'cloud_submit','http_status':400,'contract_hint':'employee_allocations_employee_name_length'})
        self.assertTrue(base.lock.closed)


if __name__ == "__main__":
    unittest.main()
