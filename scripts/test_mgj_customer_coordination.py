import os,sys,fcntl,tempfile,unittest,copy,subprocess
from unittest import mock
from datetime import datetime,timedelta
import importlib.util
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('customer_coordination_candidate',Path(__file__).with_name('sync_mgj_customer_profiles.py'))
s=importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=self.tmp.name+'/source'
  self.patches=[mock.patch.object(s,'SOURCE_LOCK',self.path),mock.patch.object(s,'SOURCE_LAST_END',None),mock.patch.object(s,'SESSION_LOCK',self.tmp.name+'/session'),mock.patch.object(s,'WAIT_TOTAL_SECONDS',0),mock.patch.object(s,'locked_session',return_value={'cookies':'fixture','shop':'fixture','employee':'123'}),mock.patch.object(s,'RUN_DEADLINE',s.time.monotonic()+105),mock.patch.object(s,'source_priority_reason',return_value=''),mock.patch.object(s,'log'),mock.patch.object(s,'DEFERRED_PATH',self.tmp.name+'/deferred.json'),mock.patch.object(s.subprocess,'check_output',side_effect=AssertionError('unmocked source command forbidden'))]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def unlocked(self):
  with open(self.path,'a') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def queue(self):return {'version':1,'items':[{'phone':'fixture','attempts':5,'status':'needs_review','first_failed_at':(datetime.now().astimezone()-timedelta(days=2)).isoformat()}]}
 def test_busy_actual_flow_preserves_queue(self):
  q=self.queue()
  with open(self.path,'a') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with mock.patch.object(s,'get_customer_full',side_effect=lambda p:s.bounded_source_curl(lambda: (['fixture'],b''))),mock.patch.object(s.subprocess,'check_output') as run,mock.patch.object(s,'upsert_customer') as write:
    ok,failed,skipped,out=s.sync_phones(['fixture','other'])
    self.assertEqual((ok,failed,skipped),(0,0,2));run.assert_not_called();write.assert_not_called()
  self.assertEqual(s.update_retry_queue(q,out)['items'],q['items']);self.unlocked()
 def test_http429_actual_flow_no_write_no_second_request(self):
  with mock.patch.object(s,'get_customer_full',side_effect=lambda p:s.multipart_post('memberDetail!detail.action',{},'fixture')),mock.patch.object(s,'load_cookies',return_value='fixture'),mock.patch.object(s.subprocess,'check_output',return_value=b'limited\n__MGJ_HTTP_STATUS__:429') as run,mock.patch.object(s,'upsert_customer') as write:
   ok,failed,skipped,out=s.sync_phones(['fixture','other'])
   self.assertEqual((ok,failed,skipped),(0,0,2));self.assertEqual(run.call_count,1);write.assert_not_called()
  q=self.queue();self.assertEqual(s.update_retry_queue(q,out)['items'],q['items']);self.unlocked()
 def test_search_http429_no_false_not_found(self):
  with mock.patch.object(s,'load_cookies',return_value='fixture'),mock.patch.object(s.subprocess,'check_output',return_value=b'limited\n__MGJ_HTTP_STATUS__:429') as run:
   with self.assertRaises(s.SourceRateLimitError):s.search_customer('fixture')
   self.assertEqual(run.call_count,1)
  self.unlocked()
 def test_hard_subprocess_timeout_and_exception_release(self):
  with mock.patch.object(s.subprocess,'check_output',side_effect=subprocess.TimeoutExpired('fixture',10)) as run:
   with self.assertRaises(subprocess.TimeoutExpired):s.bounded_source_curl(lambda: (['fixture'],b''))
   self.assertEqual(run.call_args.kwargs['timeout'],10)
  self.unlocked()
 def test_daily_due_does_not_acquire_or_send(self):
  with mock.patch.object(s,'source_priority_reason',return_value='daily_due_or_cooling'),mock.patch.object(s.subprocess,'check_output') as run:
   with self.assertRaises(s.SourceDeferred):s.bounded_source_curl(lambda: (['fixture'],b''))
   run.assert_not_called();self.assertFalse(os.path.exists(self.path))
 def test_booking_priority_no_send(self):
  with mock.patch.object(s,'source_priority_reason',return_value='booking_active'),mock.patch.object(s.subprocess,'check_output') as run:
   with self.assertRaises(s.SourceDeferred):s.bounded_source_curl(lambda: (['fixture'],b''))
   run.assert_not_called()
 def test_age_alert_has_no_customer_identifier(self):
  result=s.queue_age_alert(self.queue());self.assertTrue(result['retry_age_alert']);self.assertGreaterEqual(result['retry_oldest_age_seconds'],172799);self.assertNotIn('fixture',str(result))
 def test_releases_after_success_and_finite_contention(self):
  with open(self.path,'a') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(s.SourceDeferred):s.bounded_source_curl(lambda: (['fixture'],b''))
  with mock.patch.object(s.subprocess,'check_output',return_value=b'ok'):
   self.assertEqual(s.bounded_source_curl(lambda: (['fixture'],b'')),b'ok')
  self.unlocked()
 def test_actual_priority_adapter_booking_lock(self):
  import types
  daily=types.SimpleNamespace(read_daily_sync_state=lambda:{},daily_sync_due=lambda state:False)
  # Restore actual function just for this adapter check; no connectors imported.
  next(p for p in self.patches if p.attribute=='source_priority_reason').stop()
  booking=self.tmp.name+'/booking'
  with mock.patch.dict(sys.modules,{'sync_mgj_daily_electronic_sources':daily}),mock.patch.object(s,'BOOKING_LOCK',booking):
   with open(booking,'a') as f:
    fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
    self.assertEqual(s.source_priority_reason(),'booking_active')
   self.assertEqual(s.source_priority_reason(),'')
 def test_actual_priority_adapter_daily_due(self):
  import types
  daily=types.SimpleNamespace(read_daily_sync_state=lambda:None,daily_sync_due=lambda state:True)
  next(p for p in self.patches if p.attribute=='source_priority_reason').stop()
  with mock.patch.dict(sys.modules,{'sync_mgj_daily_electronic_sources':daily}):
   self.assertEqual(s.source_priority_reason(),'daily_due_or_cooling')
 def test_deferrals_persist_and_resume_without_retry_mutation(self):
  q=self.queue();before=copy.deepcopy(q)
  s.record_deferred(['new-fixture'],'booking_active')
  s.record_deferred(['new-fixture'],'source_transport_incomplete')
  self.assertEqual(s.compensation_phones(q)[0],'new-fixture');self.assertEqual(q,before)
  self.assertEqual(s.load_deferred()['items'][0]['deferrals'],2)
  self.assertEqual(os.stat(s.DEFERRED_PATH).st_mode & 0o777,0o600)
  s.clear_completed_deferred('new-fixture');self.assertEqual(s.deferred_metrics()['deferred_pending'],0)
 def test_persistent_error_alert_and_terminal_modes(self):
  for _ in range(3):s.record_deferred(['fixture'],'source_transport_incomplete')
  self.assertTrue(s.deferred_metrics()['persistent_source_alert'])
  for mode in ['services','backfill','validate','sync']:
   with mock.patch.object(s,'write_status') as write:
    s.finish_deferred(mode,'source_budget')
    self.assertEqual(write.call_args.args[0],'deferred');self.assertEqual(write.call_args.kwargs['mode'],mode)
 def test_corrupt_deferred_state_not_overwritten(self):
  with open(s.DEFERRED_PATH,'w') as f:f.write('bad')
  with self.assertRaises(ValueError):s.record_deferred(['fixture'],'source_busy')
  with open(s.DEFERRED_PATH) as f:self.assertEqual(f.read(),'bad')
 def test_actual_entrypoint_finishes_and_releases_all_modes(self):
  import ast
  from pathlib import Path
  tree=ast.parse(Path(s.__file__).read_text());entry=tree.body[-1]
  code=compile(ast.Module(body=[entry],type_ignores=[]),s.__file__,'exec')
  for mode,target in [('services','run_service_refresh'),('backfill','run_backfill'),('validate','validate_customer')]:
   lock=mock.Mock();write=mock.Mock();ns=dict(s.__dict__)
   ns.update(__name__='__main__',load_status=lambda:{},acquire_run_lock=lambda:lock,write_status=write)
   ns[target]=mock.Mock(side_effect=s.SourceDeferred('source_busy'))
   ns['finish_deferred']=lambda m,r:write('deferred',mode=m)
   with mock.patch.object(s.sys,'argv',['fixture',mode,'fixture']):exec(code,ns)
   self.assertEqual(write.call_args.args[0],'deferred');lock.close.assert_called_once()
 def test_real_wrapper_records_each_deferral_once(self):
  with mock.patch.object(s,'_get_customer_full',side_effect=s.SourceDeferred('source_busy')):
   ok,fail,skipped,out=s.sync_phones(['fixture','other'])
  self.assertEqual((ok,fail,skipped),(0,0,2))
  self.assertEqual([i['deferrals'] for i in s.load_deferred()['items']],[1,1])
 def test_sync_entry_dedup_and_deferred_terminal(self):
  import ast
  from pathlib import Path
  entry=ast.parse(Path(s.__file__).read_text()).body[-1]
  code=compile(ast.Module(body=[entry],type_ignores=[]),s.__file__,'exec')
  lock=mock.Mock();write=mock.Mock();batch=mock.Mock(return_value=(0,0,2,[{'phone':'fixture','skipped':True}]))
  ns=dict(s.__dict__);ns.update(__name__='__main__',load_status=lambda:{'consecutive_failures':5},acquire_run_lock=lambda:lock,write_status=write,load_retry_queue=lambda:{'version':1,'items':[]},compensation_phones=lambda q:['fixture'],get_booking_phones=lambda **kw:['fixture','other'],select_sync_window=lambda values,limit:values[:limit],sync_phones=batch,save_retry_queue=mock.Mock())
  with mock.patch.object(s.sys,'argv',['fixture','sync']):exec(code,ns)
  self.assertEqual(batch.call_args.args[0],['fixture','other'])
  self.assertEqual(write.call_args.args[0],'deferred');self.assertEqual(write.call_args.kwargs['consecutive_failures'],0)
  lock.close.assert_called_once()
 def test_preexpired_budget_tracks_unstarted_customers(self):
  with mock.patch.object(s,'RUN_DEADLINE',0),mock.patch.object(s,'get_customer_full') as read:
   ok,fail,skipped,out=s.sync_phones(['fixture','other'])
   read.assert_not_called()
  self.assertEqual((ok,fail,skipped),(0,0,2))
  self.assertEqual({i['phone'] for i in s.load_deferred()['items']},{'fixture','other'})
  self.assertTrue(all(i['reason']=='source_budget' for i in s.load_deferred()['items']))
if __name__=='__main__':unittest.main()
