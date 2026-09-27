import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import backfill_mgj_daily_consumption_2026 as backfill


def period():
    return {'shop':'自由手艺人','start':'2026-01-01','end':'2026-01-02','source_count':1,
            'fetched_at':backfill.datetime.now(backfill.daily.TZ).isoformat(),
            'services':[{'source_id':'123','shop_name':'自由手艺人','service_date':'2026-01-01','amount':100.12}]}


class HistoricalConsumptionTests(unittest.TestCase):
    def test_exact_scope_and_no_today_yesterday(self):
        pairs=[(shop,d) for shop,days in backfill.groups() for d in days]
        self.assertEqual(len(pairs),536)
        self.assertEqual(len(set(pairs)),536)
        self.assertEqual(min(d for _,d in pairs),'2026-01-01')
        self.assertEqual(max(d for _,d in pairs),'2026-09-25')

    def test_complete_period_splits_verified_zero_days(self):
        snapshots=backfill.split_period(period())
        self.assertEqual([s['source_count'] for s in snapshots],[1,0])
        self.assertTrue(all(s['operation']==backfill.OPERATION for s in snapshots))
        self.assertEqual(backfill.metadata(snapshots[0])['amount_cents'],10012)
        self.assertNotIn('services',backfill.metadata(snapshots[0]))

    def test_incomplete_wrong_shop_date_and_duplicate_fail_before_writes(self):
        p=period()
        for bad in [{**p,'source_count':2},{**p,'start':'2025-12-31'},
                    {**p,'services':[{**p['services'][0],'shop_name':'向里造型'}]},
                    {**p,'services':[{**p['services'][0],'service_date':'2026-01-03'}]},
                    {**p,'services':p['services']*2,'source_count':2}]:
            with self.assertRaises(ValueError):
                backfill.split_period(bad)

    def test_receipt_checkpoint_and_resume_skip(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill,'STATE',Path(tmp)/'status.json'), \
             patch.object(backfill.daily,'fetch_period',return_value=period()), patch.object(backfill.time,'sleep'):
            state={'pairs':{}}
            with patch.object(backfill.daily.private_customer,'request',side_effect=[{'written':1,'count':1},TimeoutError('synthetic')]):
                with self.assertRaises(TimeoutError):
                    backfill.write_group('1009951',['2026-01-01','2026-01-02'],state,time.monotonic()+60)
            self.assertEqual(list(state['pairs']),['1009951:2026-01-01'])
            self.assertEqual(json.loads(backfill.STATE.read_text())['pairs'],state['pairs'])
            self.assertEqual(backfill.STATE.stat().st_mode & 0o777,0o600)
            with patch.object(backfill.daily.private_customer,'request',return_value={'written':1,'count':0}) as write:
                backfill.write_group('1009951',['2026-01-01','2026-01-02'],state,time.monotonic()+60)
                self.assertEqual(write.call_count,1)
            self.assertEqual(len(state['pairs']),2)

    def test_live_priority_and_source_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill.daily,'STATE',Path(tmp)/'live.json'):
            self.assertTrue(backfill.live_due())
            today=backfill.datetime.now(backfill.daily.TZ).date().isoformat()
            state={'pairs':{shop+':'+today:{'success_at':time.time()} for shop in backfill.daily.SHOPS}}
            backfill.daily.STATE.write_text(json.dumps(state))
            self.assertFalse(backfill.live_due())
            state['cooldown_until']=time.time()+900
            backfill.daily.STATE.write_text(json.dumps(state))
            with self.assertRaises(RuntimeError):
                backfill.live_due()

    def test_live_priority_wait_is_bounded_and_never_fetches(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill.daily,'LOCK',str(Path(tmp)/'lock')), \
             patch.object(backfill,'live_due',return_value=True), patch.object(backfill.time,'sleep'), \
             patch.object(backfill.time,'monotonic',side_effect=[0,0,181]):
            with self.assertRaises(TimeoutError):
                with backfill.source_slot(300):
                    self.fail('live priority must not yield the source lock')

    def test_live_tick_can_complete_after_old_hundred_second_window(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill.daily,'LOCK',str(Path(tmp)/'lock')), \
             patch.object(backfill,'live_due',side_effect=[True,False]), patch.object(backfill.time,'sleep'), \
             patch.object(backfill.time,'monotonic',side_effect=[0,0,130]):
            with backfill.source_slot(300):
                pass


if __name__ == '__main__':
    unittest.main()
