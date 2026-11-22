import copy, unittest
from scripts.mgj_booking_source import complete_reservations
class Test(unittest.TestCase):
 def setUp(self):
  self.good={'code':0,'content':{'reservations':[{'id':123,'status':0,'reservationTime':1795017600000}],'rvlist':None}}
 def check(self,x): return complete_reservations(x,'1009951','2026-11-19')
 def test_valid(self): self.assertEqual(len(self.check(self.good)),1)
 def test_empty_explicit(self): self.good['content']['reservations']=[]; self.assertEqual(self.check(self.good),[])
 def test_rejections(self):
  cases=[{}, {'code':0}, {'code':0,'content':{}}, {'code':False,'content':{'reservations':[]}}]
  for key,val in [('reservations',None),('reservations',[None]),('page',1),('rvlist',[]),('total',1)]:
   c=copy.deepcopy(self.good);c['content'][key]=val;cases.append(c)
  for key,val in [('id',True),('id',0),('status',99),('reservationTime',0),('shopId','other'),('custName',123)]:
   c=copy.deepcopy(self.good);c['content']['reservations'][0][key]=val;cases.append(c)
  c=copy.deepcopy(self.good);c['content']['reservations']*=2;cases.append(c)
  for c in cases:
   with self.subTest(c=c),self.assertRaises(ValueError): self.check(c)
if __name__=='__main__': unittest.main()
