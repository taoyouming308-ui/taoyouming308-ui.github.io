import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import install_mgj_business_diagnostics as installer

class InstallerTests(unittest.TestCase):
    def test_unknown_preimage_dry_run_install_and_idempotence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); src=root/'src'; dst=root/'runtime';src.mkdir();dst.mkdir()
            for name in installer.FILES:
                (src/name).write_text('new synthetic code');(dst/name).write_text('old synthetic code')
            paths=(root/'lock1',root/'lock2')
            with self.assertRaisesRegex(ValueError,'unknown_runtime_preimage'):
                installer.install(src,dst,paths,True)
            known={name:installer.digest(dst/name) for name in installer.FILES}
            with patch.object(installer,'FILES',known):
                self.assertEqual(installer.install(src,dst,paths)['status'],'ready')
                self.assertEqual((dst/next(iter(known))).read_text(),'old synthetic code')
                result=installer.install(src,dst,paths,True)
                self.assertEqual(result['verified_files'],2)
                self.assertTrue(Path(result['backup']).is_dir())
                self.assertEqual(installer.install(src,dst,paths,True)['status'],'already_installed')
                for name in known:
                    self.assertEqual((dst/name).read_text(),'new synthetic code')
                    self.assertEqual((Path(result['backup'])/name).read_text(),'old synthetic code')

    def test_busy_lock_and_mid_install_failure_preserve_runtime(self):
        import fcntl
        import os
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);src=root/'src';dst=root/'runtime';src.mkdir();dst.mkdir()
            for name in installer.FILES:
                (src/name).write_text('new');(dst/name).write_text('old')
            paths=(root/'lock1',root/'lock2')
            known={name:installer.digest(dst/name) for name in installer.FILES}
            with patch.object(installer,'FILES',known):
                with paths[1].open('a') as busy:
                    fcntl.flock(busy,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    with self.assertRaises(BlockingIOError):installer.install(src,dst,paths,True)
                self.assertTrue(all((dst/name).read_text()=='old' for name in known))
                replace=os.replace;calls=[]
                def fail_second(a,b):
                    calls.append(1)
                    if len(calls)==2:raise OSError('synthetic replacement failure')
                    return replace(a,b)
                with patch.object(installer.os,'replace',side_effect=fail_second):
                    with self.assertRaises(OSError):installer.install(src,dst,paths,True)
                self.assertEqual(len(calls),4)
                self.assertTrue(all(installer.digest(dst/name)==known[name] for name in known))
