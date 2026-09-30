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
        self.cash_calls = []

    def cash(self, shop, day, **kwargs):
        self.cash_calls.append((shop, day, kwargs))
        return {'status':'needs_review', 'scopes':[
            {'scope':task.sync.signed.SCOPE_NAMES[key], 'status':'accepted'}
            for key in task.sync.signed.selected_scopes('cash')]}

    def call(self, shop, day, **kwargs):
        self.calls.append((shop, day, kwargs))
        return {'status': 'accepted', 'source_count': 2}

    def run_at(self, shop, hour, epoch, runner=None):
        now = datetime(2026, 9, 28, hour, 17, tzinfo=task.TZ)
        return task.run_slot(shop, now=now, epoch=epoch, state_path=self.state, lock_path=self.lock,
                             runner=runner or self.call, source_ready=lambda: True, backoff_reader=lambda: {}, cash_runner=self.cash)

    def test_daytime_prioritizes_today_and_limits_15_minutes(self):
        result = self.run_at('1009951', 11, 100000)
        self.assertEqual(result['date'], '2026-09-28')
        self.assertEqual(self.calls[0][2], {'write': True, 'budget': 90, 'max_bills': 100})
        self.assertEqual(self.run_at('1009951', 12, 100100)['status'], 'yielded_cadence_limit')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.run_at('1837032', 11, 100100)['status'], 'accepted')
        self.assertEqual(self.run_at('1009951', 12, 100901)['status'], 'accepted')

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
        self.assertEqual(candidate.count('run_mgj_business_detail_2026.py'), 3)
        self.assertEqual(installer.cron_candidate(candidate, runner, '/private/log'), (candidate, False))
        with self.assertRaises(ValueError):
            installer.cron_candidate(candidate.replace('2,17,32,47', '3,18,33,48'), runner, '/private/log')

    def test_history_round_robin_is_global_and_preserves_completed_dates(self):
        now=datetime(2026,9,28,6,0,tzinfo=task.TZ)
        def run(epoch):
            return task.run_slot(mode='history',now=now,epoch=epoch,state_path=self.state,lock_path=self.lock,
                                 runner=self.call,source_ready=lambda:True,backoff_reader=lambda:{},cash_runner=self.cash)
        self.assertEqual(run(100000)['shop'],'1009951')
        self.assertEqual(run(100299)['status'],'yielded_cadence_limit')
        self.assertEqual(run(100301)['shop'],'1837032')
        self.assertEqual(run(100602)['date'],'2026-01-01')
        self.assertEqual([row[0] for row in self.calls],['1009951','1837032','1009951'])

    def test_window_and_cooldown_prevent_all_source_access(self):
        value=task.run_slot(mode='history',now=datetime(2026,9,28,12,0,tzinfo=task.TZ),runner=self.call)
        self.assertEqual(value['status'],'yielded_outside_window')
        value=task.run_slot(mode='history',now=datetime(2026,9,28,6,0,tzinfo=task.TZ),epoch=100000,
                           state_path=self.state,lock_path=self.lock,runner=self.call,source_ready=lambda:True,
                           backoff_reader=lambda:{'cooldown_until':200000})
        self.assertEqual(value['status'],'yielded_source_cooldown')
        self.assertEqual(self.calls,[])

    def test_installer_upgrades_only_exact_legacy_block(self):
        runner='/private/run_mgj_business_detail_2026.py'
        prefix='*/30 * * * * existing-sync\n'
        legacy='\n'.join([installer.MARKER]+[line.format(runner=runner,log='/private/log') for line in installer.LEGACY_CRON])+'\n'
        value,changed=installer.cron_candidate(prefix+legacy,runner,'/private/log')
        self.assertTrue(changed)
        self.assertTrue(value.startswith(prefix))
        self.assertEqual(value.count('--mode history'),1)
        self.assertEqual(value.count('--mode live'),2)
        with self.assertRaises(ValueError):
            installer.cron_candidate((prefix+legacy).replace('17 *','18 *'),runner,'/private/log')

    def test_2026_scope_does_not_query_2027(self):
        now=datetime(2027,1,2,12,0,tzinfo=task.TZ)
        value=task.run_slot('1009951',mode='live',now=now,runner=self.call)
        self.assertEqual(value['status'],'year_scope_complete')
        self.assertEqual(self.calls,[])
        target=task.target_date('1009951',task.empty_state(),datetime(2027,1,2,6,0,tzinfo=task.TZ),'history')
        self.assertEqual(target,('2026-12-31',True))
        self.assertEqual(task.progress(task.empty_state(),now.date())['past_store_days'],730)

    def test_legacy_finalized_detail_gets_cash_without_requerying_bills(self):
        state=task.empty_state()
        state['pairs']['1009951:2026-09-27']={'finalized':True,'source_count':26}
        task.save_state(state,self.state)
        result=self.run_at('1009951',6,100000)
        self.assertEqual(result['date'],'2026-09-27')
        self.assertEqual(self.calls,[])
        self.assertEqual(len(self.cash_calls),1)
        self.assertEqual(self.cash_calls[0][:2],('1009951','2026-09-27'))
        self.assertTrue(task.read_state(self.state)['pairs']['1009951:2026-09-27']['cash_finalized'])

    def test_missing_cash_is_deferred_without_zero_or_blocking_history(self):
        now=datetime(2026,9,28,6,0,tzinfo=task.TZ)
        value=task.run_slot('1009951',now=now,epoch=100000,state_path=self.state,lock_path=self.lock,
            runner=self.call,source_ready=lambda:True,backoff_reader=lambda:{},
            cash_runner=lambda *a,**k:{'status':'partial','scopes':[{'scope':'card_sales_daily_summary','status':'missing_source'}]})
        pair=task.read_state(self.state)['pairs']['1009951:2026-09-27']
        self.assertTrue(pair['finalized'])
        self.assertFalse(pair['cash_finalized'])
        self.assertEqual(value['cash_status'],'partial')
        self.assertEqual(task.target_date('1009951',task.read_state(self.state),now,'history'),('2026-01-01',True))

    def test_details_and_cash_share_bounded_source_budget(self):
        ticks=iter([100,181])
        value=task.run_slot('1009951',now=datetime(2026,9,28,11,0,tzinfo=task.TZ),epoch=100000,
            state_path=self.state,lock_path=self.lock,runner=self.call,cash_runner=self.cash,
            source_ready=lambda:True,backoff_reader=lambda:{},monotonic=lambda:next(ticks))
        self.assertEqual(value['cash_status'],'budget_exhausted')
        self.assertEqual(self.cash_calls,[])
        self.assertFalse(task.read_state(self.state)['pairs']['1009951:2026-09-28']['cash_finalized'])


if __name__ == '__main__':
    unittest.main()
