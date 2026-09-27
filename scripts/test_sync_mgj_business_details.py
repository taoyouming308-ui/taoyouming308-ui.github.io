import copy
import json
import unittest
from scripts import sync_mgj_business_details as sync
from scripts.test_mgj_business_detail import fixture


class Lock:
    def __init__(self): self.closed = False
    def close(self): self.closed = True


class BusinessSyncTests(unittest.TestCase):
    def options(self):
        self.lock = Lock()
        self.calls = []
        self.period = {"source_count": 1, "services": [{"source_id": "42", "amount": 100, "date": "2026-01-01"}]}
        def submitter(payload,key,timeout):
            self.calls.append(payload)
            return {"status": "accepted"}
        return {"period_reader": lambda *args: copy.deepcopy(self.period), "detail_reader": lambda *args: fixture(),
                "submitter": submitter, "lock_factory": lambda: self.lock, "config_loader": lambda: {},
                "due_checker": lambda: False, "key_loader": lambda: "fixture-key",
                "backoff_reader": lambda: {}, "backoff_recorder": lambda code: None, "request_pause": lambda seconds: None}

    def test_source_cooldown_prevents_all_network_and_lock_access(self):
        opts = self.options()
        opts['backoff_reader'] = lambda: {'cooldown_until': float('inf')}
        opts['lock_factory'] = lambda: self.fail('cooldown must not acquire source lock')
        opts['period_reader'] = lambda *args: self.fail('cooldown must not read source')
        self.assertEqual(sync.run('1837032', '2026-01-01', **opts)['status'], 'yielded_source_cooldown')

    def test_rate_limit_records_backoff_without_retry_or_partial_write(self):
        opts = self.options()
        codes = []
        opts['backoff_recorder'] = codes.append
        def limited(*args): raise sync.audit.AuditError('http_status:429')
        opts['detail_reader'] = limited
        with self.assertRaisesRegex(sync.audit.AuditError, 'http_status:429'):
            sync.run('1837032', '2026-01-01', write=True, **opts)
        self.assertEqual(codes, ['http_status:429'])
        self.assertEqual(self.calls, [])
        self.assertTrue(self.lock.closed)

    def test_list_http_rate_limit_also_records_cooldown(self):
        opts = self.options()
        codes = []
        opts['backoff_recorder'] = codes.append
        def limited(*args):
            raise sync.urllib.error.HTTPError('https://synthetic.invalid', 429, 'limited', {}, None)
        opts['period_reader'] = limited
        with self.assertRaises(sync.urllib.error.HTTPError):
            sync.run('1837032', '2026-01-01', **opts)
        self.assertEqual(codes, ['http_status:429'])
        self.assertEqual(self.calls, [])
        self.assertTrue(self.lock.closed)

    def test_dry_run_cannot_write_or_read_signing_key(self):
        opts = self.options()
        opts["key_loader"] = lambda: self.fail("dry run cannot read secret")
        result = sync.run("1837032", "2026-01-01", **opts)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(self.calls, [])
        self.assertTrue(self.lock.closed)

    def test_write_is_scoped_normalized_and_never_posts(self):
        result = sync.run("1837032", "2026-01-01", write=True, **self.options())
        self.assertEqual(result["status"], "accepted")
        payload = self.calls[0]
        self.assertEqual(payload["operation"], "business_details_append")
        self.assertEqual(payload["source"]["source_scope"], "project_consumption")
        self.assertFalse(payload["source"]["bills"][0]["report_ready"])
        self.assertNotIn("PRIVATE_CUSTOMER", json.dumps(payload))

    def test_wrong_store_detail_keeps_cloud_untouched(self):
        opts = self.options()
        opts["detail_reader"] = lambda *args: {**fixture(), "shopid": "1009951"}
        with self.assertRaises(ValueError):
            sync.run("1837032", "2026-01-01", write=True, **opts)
        self.assertEqual(self.calls, [])
        self.assertTrue(self.lock.closed)

    def test_source_changed_while_fetching_is_not_uploaded(self):
        opts = self.options()
        results = iter([self.period, {"source_count": 0, "services": []}])
        opts["period_reader"] = lambda *args: next(results)
        result = sync.run("1837032", "2026-01-01", write=True, **opts)
        self.assertEqual(result["status"], "source_changed")
        self.assertEqual(self.calls, [])

    def test_daily_sync_priority_does_not_touch_source(self):
        opts = self.options()
        opts["due_checker"] = lambda: True
        opts["period_reader"] = lambda *args: self.fail("must yield")
        self.assertEqual(sync.run("1837032", "2026-01-01", **opts)["status"], "yielded_daily_sync_due")

    def test_list_and_detail_posting_must_match(self):
        opts=self.options()
        self.period['services'][0]['amount']=101
        with self.assertRaisesRegex(ValueError,'posted_amount_mismatch'):
            sync.run('1837032','2026-01-01',write=True,**opts)
        self.assertEqual(self.calls,[])

    def test_incomplete_list_and_duplicate_ids_fail(self):
        for value in ({"source_count": 1, "services": []}, {"source_count": 2, "services": [{"source_id": "42"}]*2}):
            with self.assertRaises(ValueError): sync.list_signature(value)


if __name__ == "__main__": unittest.main()
