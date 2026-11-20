import sys,unittest,tempfile,fcntl,json,subprocess
from pathlib import Path
from unittest import mock
import importlib.util
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('customer_fairness',Path(__file__).with_name('sync_mgj_customer_profiles.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.now=0;self.paths={k:self.tmp.name+'/'+k for k in ['SOURCE_LOCK','SESSION_LOCK','COORDINATOR_LOCK']}
  self.patches=[mock.patch.object(s,k,v) for k,v in self.paths.items()]+[mock.patch.object(s,'RUN_DEADLINE',105),mock.patch.object(s,'SOURCE_LAST_END',None),mock.patch.object(s,'WAIT_USED',0),mock.patch.object(s,'WAIT_EPISODES',0),mock.patch.object(s,'SESSION_SCOPES',{}),mock.patch.object(s,'DEFERRED_PATH',self.tmp.name+'/deferred.json'),mock.patch.object(s.time,'monotonic',side_effect=lambda:self.now),mock.patch.object(s.time,'sleep',side_effect=self.sleep),mock.patch.object(s,'source_priority_reason',return_value=''),mock.patch.object(s,'load_config',return_value={'server':s.SERVER,'shop_id':'fixture','emp_id':'123','cookies':'userId=fixture; JSESSIONID=old;'}),mock.patch.object(s.subprocess,'check_output',side_effect=AssertionError('unmocked source forbidden'))]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def sleep(self,seconds):
  for k in ['SESSION_LOCK','SOURCE_LOCK']:
   with open(self.paths[k],'a') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  self.now+=seconds
 def source(self):return s.form_post('consumerHelp!find.action',{'keyword':'fixture'})
 def response(self):return mock.patch.object(s.subprocess,'check_output',return_value=b'ok\n__MGJ_HTTP_STATUS__:200')
 def test_wait_has_no_shared_locks_and_reload_cookie(self):
  def cfg(_):return {'server':s.SERVER,'shop_id':'fixture','cookies':'userId=fixture; JSESSIONID=new;' if self.now else 'userId=fixture; JSESSIONID=old;'}
  with mock.patch.object(s,'source_priority_reason',side_effect=lambda:'booking_active' if self.now<4 else ''),mock.patch.object(s,'load_config',side_effect=cfg),self.response() as call:
   self.assertEqual(self.source(),'ok');self.assertIn('Cookie: userId=fixture; JSESSIONID=new;',call.call_args.args[0]);self.assertEqual(s.WAIT_USED,4)
 def test_identity_change_discards_further_window(self):
  with self.response() as call:self.source()
  with mock.patch.object(s,'load_config',return_value={'shop_id':'other','cookies':'userId=fixture;'}),self.response() as call:
   with self.assertRaisesRegex(s.SourceDeferred,'scope_changed'):self.source()
   call.assert_not_called()
 def test_total_wait_shared_across_calls(self):
  with mock.patch.object(s,'source_priority_reason',return_value='booking_active'),self.response() as call:
   for _ in range(3):
    with self.assertRaises(s.SourceDeferred):self.source()
   self.assertEqual(s.WAIT_USED,20);call.assert_not_called();self.assertLessEqual(s.WAIT_EPISODES,2)
 def test_two_episodes_shared_across_customers(self):
  for _ in range(2):
   until=self.now+2
   with mock.patch.object(s,'source_priority_reason',side_effect=lambda:'booking_active' if self.now<until else ''),self.response():self.source()
  with mock.patch.object(s,'source_priority_reason',return_value='booking_active'),self.response() as call:
   with self.assertRaises(s.SourceDeferred):self.source()
   call.assert_not_called();self.assertEqual(s.WAIT_EPISODES,2)
 def test_budget_reserves_request_and_write(self):
  self.now=76
  with self.response() as call:
   with self.assertRaisesRegex(s.SourceDeferred,'budget'):self.source()
   call.assert_not_called()
 def test_timeout_releases_shared_locks(self):
  with mock.patch.object(s.subprocess,'check_output',side_effect=subprocess.TimeoutExpired('fixture',10)) as call:
   with self.assertRaises(s.SourceDeferred):self.source()
   self.assertEqual(call.call_args.kwargs['timeout'],10)
  self.sleep(0)
 def test_429_is_not_readiness_retried(self):
  with mock.patch.object(s.subprocess,'check_output',return_value=b'limited\n__MGJ_HTTP_STATUS__:429') as call:
   with self.assertRaises(s.SourceRateLimitError):self.source()
   self.assertEqual(call.call_count,1);self.assertEqual(s.WAIT_USED,0)
 def test_daily_due_not_polled(self):
  with mock.patch.object(s,'source_priority_reason',return_value='daily_due_or_cooling'),self.response() as call:
   with self.assertRaises(s.SourceDeferred):self.source()
   self.assertEqual(s.WAIT_USED,0);call.assert_not_called()
 def test_all_customer_modes_share_new_coordinator(self):
  first=s.acquire_run_lock()
  try:self.assertIsNone(s.acquire_run_lock());self.sleep(0)
  finally:first.close()
 def test_readiness_is_not_repeated_sent_request(self):
  with self.response() as call:
   self.source();until=self.now+4
   with mock.patch.object(s,'source_priority_reason',side_effect=lambda:'booking_active' if self.now<until else ''):self.source()
   self.assertEqual(call.call_count,2)
 def test_frozen_member_payload_and_cookie_under_lock(self):
  with mock.patch.object(s.subprocess,'check_output',return_value=b'{"code":0}\n__MGJ_HTTP_STATUS__:200') as call:
   s.multipart_post('memberDetail!detail.action',{'memberid':'fixture'},'fixture')
   self.assertIn(b'"memberid": "fixture"',call.call_args.kwargs['input'])
 def test_invalid_session_never_sent(self):
  with mock.patch.object(s,'load_config',return_value={}),self.response() as call:
   with self.assertRaisesRegex(s.SourceDeferred,'unverified'):self.source()
   call.assert_not_called()
 def test_multipart_unknown_transport_is_not_replayed(self):
  with mock.patch.object(s.subprocess,'check_output',side_effect=subprocess.TimeoutExpired('fixture',10)) as call:
   with self.assertRaises(s.SourceDeferred):s.multipart_post('memberDetail!detail.action',{},'fixture')
   self.assertEqual(call.call_count,1);self.assertEqual(s.WAIT_USED,0)
 def test_session_change_is_persistent_alert(self):
  for _ in range(3):s.record_deferred(['fixture'],'session_scope_changed')
  self.assertTrue(s.deferred_metrics()['persistent_source_alert'])
 def test_first_wait_derives_new_session_shop_and_cookie_together(self):
  def cfg(_):return {'shop_id':'new-shop','emp_id':'456','cookies':'userId=fixture; JSESSIONID=new;'}
  with mock.patch.object(s,'source_priority_reason',side_effect=lambda:'booking_active' if self.now<2 else ''),mock.patch.object(s,'load_config',side_effect=cfg),mock.patch.object(s.subprocess,'check_output',return_value=b'{"code":0}\n__MGJ_HTTP_STATUS__:200') as call:
   s.multipart_post('member!queryMemberBillListnew.action',{'memberid':'fixed-customer','shopid':'business-shop'},None)
   self.assertIn(b'new-shop',call.call_args.kwargs['input']);self.assertIn(b'fixed-customer',call.call_args.kwargs['input']);self.assertIn('Cookie: userId=fixture; JSESSIONID=new;',call.call_args.args[0])
 def test_employee_is_derived_after_wait(self):
  with mock.patch.object(s,'source_priority_reason',side_effect=lambda:'booking_active' if self.now<2 else ''),mock.patch.object(s,'load_config',return_value={'shop_id':'fixture','emp_id':'456','cookies':'userId=fixture;'}),mock.patch.object(s.subprocess,'check_output',return_value=b'{"code":0}\n__MGJ_HTTP_STATUS__:200') as call:
   s.multipart_post('memberDetail!detail.action',{'memberid':'fixed','empId':111},'fixture')
   self.assertIn(b'"empId": 456',call.call_args.kwargs['input']);self.assertNotIn(b'111',call.call_args.kwargs['input'])
 def test_changed_employee_rejects_existing_window_scope(self):
  with self.response():self.source()
  with mock.patch.object(s,'load_config',return_value={'shop_id':'fixture','emp_id':'456','cookies':'userId=fixture; JSESSIONID=old;'}),self.response() as call:
   with self.assertRaisesRegex(s.SourceDeferred,'scope_changed'):self.source()
   call.assert_not_called()
 def test_nonjson_multipart_not_replayed(self):
  with mock.patch.object(s.subprocess,'check_output',return_value=b'not-json\n__MGJ_HTTP_STATUS__:200') as call:
   with self.assertRaises(s.SourceDeferred):s.multipart_post('memberDetail!detail.action',{},'fixture')
   self.assertEqual(call.call_count,1)
 def test_html_details_stop_real_customer_chain_without_fallback(self):
  with mock.patch.object(s,'search_customer',return_value=('1','2','fixture')),mock.patch.object(s.subprocess,'check_output',return_value=b'<html>blocked</html>\n__MGJ_HTTP_STATUS__:200') as call,mock.patch.object(s,'fetch_cashier_html') as fallback,mock.patch.object(s,'upsert_customer') as write,mock.patch.object(s,'log'):
   ok,failed,skipped,out=s.sync_phones(['fixture'])
   self.assertEqual((ok,failed,skipped),(0,0,1));self.assertEqual(call.call_count,1);fallback.assert_not_called();write.assert_not_called()
 def test_malformed_response_shape_never_falls_back(self):
  for payload in [b'[]',b'{"code":false}']:
   with mock.patch.object(s,'search_customer',return_value=('1','2','fixture')),mock.patch.object(s.subprocess,'check_output',return_value=payload+b'\n__MGJ_HTTP_STATUS__:200') as call,mock.patch.object(s,'fetch_cashier_html') as fallback,mock.patch.object(s,'log'):
    self.assertEqual(s.sync_phones(['fixture'])[:3],(0,0,1));self.assertEqual(call.call_count,1);fallback.assert_not_called()
if __name__=='__main__':unittest.main()
