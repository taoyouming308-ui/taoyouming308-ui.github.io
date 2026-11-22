import tempfile,fcntl,unittest
from scripts.mgj_customer_cutover_guard import *
from scripts import mgj_customer_cutover_guard as rollout_guard
from unittest import mock
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.patch=mock.patch.object(rollout_guard,'LOCK_ROOT',self.t.name);self.patch.start();self.paths=[self.t.name+'/'+x for x in LOCK_NAMES]
 def tearDown(self):self.patch.stop();self.t.cleanup()
 def test_requires_pause_receipts(self):
  with self.assertRaises(UnsafeCutover):
   with quiescent_cutover(lambda:False,lambda:[]):self.fail('entered')
 def test_old_process_even_when_locks_free(self):
  with self.assertRaises(UnsafeCutover):
   with quiescent_cutover(lambda:True,lambda:['old-mode']):self.fail('entered')
 def test_busy_never_waits(self):
  with open(self.paths[1],'a') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(UnsafeCutover):
    with quiescent_cutover(lambda:True,lambda:[]):self.fail('entered')
 def test_exception_releases_all(self):
  with self.assertRaises(ValueError):
   with quiescent_cutover(lambda:True,lambda:[]):raise ValueError()
  for path in self.paths:
   with open(path,'a') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def test_rechecks_pause(self):
  results=iter([True,False])
  with self.assertRaises(UnsafeCutover):
   with quiescent_cutover(lambda:next(results),lambda:[]):self.fail('entered')
 def test_empty_or_duplicate_inventory_refused(self):
  for names in [(),('same','same','same','same')]:
   with mock.patch.object(rollout_guard,'LOCK_NAMES',names),self.assertRaises(UnsafeCutover):
    with quiescent_cutover(lambda:True,lambda:[]):self.fail('entered')
if __name__=='__main__':unittest.main()
