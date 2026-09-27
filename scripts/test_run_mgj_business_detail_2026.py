import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from scripts import run_mgj_business_detail_2026 as task
from scripts import install_mgj_business_detail_2026 as installer


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.state, self.lock = root / 'state.json', root / 'lock'
        self.calls = []

    def call(self, shop, day, **kwargs):
        self.calls.append((shop, day, kwargs))
        return {'status': 'accepted', 'source_count': 2}

    def run_at(self, shop, hour, epoch, runner=None):
        now = datetime(2026, 9, 28, hour, 17, tzinfo=task.TZ)
        return task.run_slot(shop, now=now, epoch=epoch, state_path=self.state, lock_path=self.lock,
                             runner=runner or self.call, source_ready=lambda: True)

    def test_daytime_prioritizes_today_and_limits_rolling_hour(self):
        result = self.run_at('1009951', 11, 100000)
        self.assertEqual(result['date'], '2026-09-28')
        self.assertEqual(self.calls[0][2], {'write': True, 'budget': 90, 'max_bills': 100})
        self.assertEqual(self.run_at('1009951', 12, 100100)['status'], 'yielded_hourly_limit')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.run_at('1837032', 11, 100100)['status'], 'accepted')

    def test_off_hours_finalizes_yesterday_then_resumes_january(self):
        self.assertEqual(self.run_at('1009951', 6, 100000)['date'], '2026-09-27')
        self.assertEqual(self.run_at('1009951', 7, 104000)['date'], '2026-01-01')
        state = task.read_state(self.state)
        self.assertTrue(state['pairs']['1009951:2026-09-27']['finalized'])
        self.assertEqual(task.progress(state, datetime(2026, 9, 28).date())['finalized_store_days'], 2)

    def test_yield_and_error_do_not_complete_date_or_leak_details(self):
        yielded = lambda *args, **kwargs: {'status': 'yielded_daily_sync_due'}
        self.assertEqual(self.run_at('1009951', 6, 100000, yielded)['status'], 'yielded_daily_sync_due')
        self.assertEqual(task.read_state(self.state)['pairs'], {})
        self.assertEqual(task.read_state(self.state)['last_attempts'], {})
        def secret_failure(*args, **kwargs):
            raise RuntimeError('customer private payload')
        value = self.run_at('1009951', 7, 104000, secret_failure)
        self.assertEqual(value['status'], 'failed_or_unconfirmed')
        self.assertNotIn('private', json.dumps(value))
        self.assertEqual(task.read_state(self.state)['pairs'], {})

    def test_normal_sync_stale_yields_without_source_attempt(self):
        value = task.run_slot('1009951', now=datetime(2026, 9, 28, 6, 17, tzinfo=task.TZ),
                              epoch=100000, state_path=self.state, lock_path=self.lock,
                              runner=self.call, source_ready=lambda: False, ready_wait_seconds=0)
        self.assertEqual(value['status'], 'yielded_daily_sync_due')
        self.assertEqual(self.calls, [])
        self.assertEqual(task.read_state(self.state)['last_attempts'], {})

    def test_invalid_checkpoint_fails_closed(self):
        self.state.write_text('{"version":1,"pairs":{"bad:2026-01-01":{"finalized":true}},"last_attempts":{}}')
        with self.assertRaises(ValueError):
            self.run_at('1009951', 6, 100000)
        self.assertEqual(self.calls, [])

    def test_cron_candidate_preserves_original_and_is_idempotent(self):
        old = '*/30 * * * * existing-sync\n'
        runner='/private/run_mgj_business_detail_2026.py'
        candidate, changed = installer.cron_candidate(old, runner, '/private/log')
        self.assertTrue(changed)
        self.assertTrue(candidate.startswith(old))
        self.assertEqual(candidate.count('run_mgj_business_detail_2026.py'), 2)
        self.assertEqual(installer.cron_candidate(candidate, runner, '/private/log'), (candidate, False))
        with self.assertRaises(ValueError):
            installer.cron_candidate(candidate.replace('17 *', '18 *'), runner, '/private/log')


if __name__ == '__main__':
    unittest.main()
