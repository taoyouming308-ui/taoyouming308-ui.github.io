import unittest, tempfile, socket, importlib.util
from unittest.mock import patch
from pathlib import Path
p=Path(__file__).with_name('sync_mgj_bookings.py');sp=importlib.util.spec_from_file_location('candidate',p);b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
class Protocol(unittest.TestCase):
 def exercise(self, fail=None):
  events=[]; statuses=[]
  def request(payload,key):
   op=payload['operation']; events.append(op)
   if fail==op: raise TimeoutError('simulated')
   if op=='begin':return {'lease_id':'test','generation':1}
   if op=='commit':
    self.assertEqual(payload['source_rows'],[{'id':1,'status':0,'reservation_time':123}]);return {'upserted':1,'deleted':0,'generation':1}
   return {}
  def fetch(*args):
   events.append('source')
   if fail=='source':raise ValueError('bad list')
   return {'raw_rows':[{'id':1,'status':0,'reservationTime':123}], 'bookings':[{'id':1}]}
  with patch.object(b,'ensure_session',return_value=('server','cookie')),patch.object(b,'load_signing_key',return_value=None),patch.object(b,'signed_protocol_request',side_effect=request),patch.object(b,'fetch_reservation_snapshot',side_effect=fetch),patch.object(b,'write_status',side_effect=lambda *a,**k:statuses.append((a,k))),patch.object(b,'SHOPS',[{'shopId':'1009951','name':'test'}]),patch.object(socket,'socket',side_effect=AssertionError('network forbidden')):
   result=b.sync_bookings(['2026-11-19'])
  return result,events,statuses
 def test_success(self): self.assertEqual(self.exercise()[:2],(0,['begin','source','commit']))
 def test_begin_unknown_no_source(self):self.assertEqual(self.exercise('begin')[:2],(1,['begin']))
 def test_source_failure_abort_no_commit(self):self.assertEqual(self.exercise('source')[:2],(1,['begin','source','abort']))
 def test_commit_unknown_no_new_lease(self):self.assertEqual(self.exercise('commit')[:2],(1,['begin','source','commit']))
if __name__=='__main__': unittest.main()
