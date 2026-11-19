import unittest, json, importlib.util
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
p=Path(__file__).with_name('sync_mgj_bookings.py');s=importlib.util.spec_from_file_location('client_review',p);b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
class Key:
 def sign(self,x):return b'fake-signature'
class Response:
 def __init__(self,x):self.x=x
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self):return json.dumps(self.x).encode()
class Transport(unittest.TestCase):
 def setUp(self):
  self.base={'protocol':2,'shop_id':'1009951','date':'2026-11-19'}
  self.lease='35026998-3652-4230-afc7-2bba0361b58a'
 def call(self,payload,receipt):
  with patch.object(b.urllib.request,'urlopen',return_value=Response(receipt)):
   return b.signed_protocol_request(payload,Key())
 def test_begin_receipts(self):
  good=dict(self.base,operation="begin",lease_id=self.lease,generation=1,expires_at=(datetime.now(timezone.utc)+timedelta(seconds=120)).isoformat())
  self.call(dict(self.base,operation='begin'),good)
  for field,value in [('lease_id',''),('lease_id',None),('generation',True),('generation',0),('expires_at','2020-01-01T00:00:00+00:00'),('expires_at','2030-01-01T00:00:00'),('date','wrong'),('operation','commit'),('operation',None)]:
   with self.subTest(field=field,value=value),self.assertRaises(RuntimeError):self.call(dict(self.base,operation='begin'),dict(good,**{field:value}))
 def test_commit_strict_counts(self):
  payload=dict(self.base,operation='commit',lease_id=self.lease,bookings=[{}]);good=dict(self.base,operation="commit",lease_id=self.lease,upserted=1,deleted=2,generation=1)
  self.call(payload,good)
  for field,value in [('upserted',True),('upserted','1'),('upserted',0),('deleted',True),('deleted',-1),('deleted',1001),('protocol',2.0),('operation','abort'),('operation',None),('lease_id','wrong'),('lease_id',None)]:
   with self.subTest(field=field,value=value),self.assertRaises(RuntimeError):self.call(payload,dict(good,**{field:value}))
 def test_abort_receipt_binding(self):
  payload=dict(self.base,operation="abort",lease_id=self.lease)
  good=dict(self.base,operation="abort",lease_id=self.lease,aborted=True)
  self.call(payload,good)
  for field,value in [("operation","commit"),("operation",None),("lease_id","wrong"),("lease_id",None)]:
   with self.subTest(field=field,value=value),self.assertRaises(RuntimeError):self.call(payload,dict(good,**{field:value}))
 def test_same_request_on_retry(self):
  payload=dict(self.base,operation='begin',request_id=self.lease);good=dict(self.base,operation="begin",lease_id=self.lease,generation=1,expires_at=(datetime.now(timezone.utc)+timedelta(seconds=120)).isoformat());seen=[]
  def fake(req,**kw):
   seen.append(req)
   if len(seen)==1:raise TimeoutError('simulated')
   return Response(good)
  with patch.object(b.urllib.request,'urlopen',side_effect=fake),patch.object(b.time,'sleep'):
   b.signed_protocol_request(payload,Key())
  self.assertIs(seen[0],seen[1]);self.assertEqual(json.loads(seen[0].data)['request_id'],self.lease)
if __name__=='__main__':unittest.main()
