"""Synthetic temporary-directory tests; never touch live runtime, cron or locks."""
import builtins
import contextlib
import fcntl
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import install_mgj_business_detail_2026 as installer


class SourceTransportInstallTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        base = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.source, self.runtime = base / 'source', base / 'runtime'
        self.source.mkdir()
        self.runtime.mkdir()
        self.lock = base / 'source.lock'
        self.names = tuple(installer.EXPECTED_TRANSPORT_BASE)
        self.old = {}
        for name in self.names:
            self.old[name] = ('old synthetic ' + name).encode()
            (self.runtime / name).write_bytes(self.old[name])
            (self.source / name).write_text('new synthetic ' + name)
        self.runner = self.runtime / 'run_mgj_business_detail_2026.py'
        self.runner.write_text('independent runner must remain unchanged')
        expected = {name: installer.sha256(self.runtime / name) for name in self.names}
        for key, value in [('ROOT', self.source), ('RUNTIME', self.runtime), ('EXPECTED_TRANSPORT_BASE', expected)]:
            self.stack.enter_context(patch.object(installer, key, value))
        self.stack.enter_context(patch.object(installer, 'open', lambda *a, **k: builtins.open(self.lock, 'a'), create=True))
        self.stack.enter_context(patch.object(installer, 'read_cron', side_effect=AssertionError('cron access forbidden')))
        self.stack.enter_context(patch.object(installer.subprocess, 'run', side_effect=AssertionError('subprocess forbidden')))

    def test_backup_hashes_permissions_and_isolation(self):
        result = installer.install_source_transport()
        backup = Path(result['backup'])
        self.assertFalse(result['cron_changed'])
        self.assertEqual(set(result['runtime_verified_files']), set(self.names))
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        for name in self.names:
            self.assertEqual((backup / name).read_bytes(), self.old[name])
            self.assertEqual(installer.sha256(self.runtime / name), installer.sha256(self.source / name))
            self.assertEqual((self.runtime / name).stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.runner.read_text(), 'independent runner must remain unchanged')
        self.assertEqual(set(p.name for p in self.runtime.iterdir()), set(self.names) | {self.runner.name})

    def test_unknown_second_preimage_rejects_before_any_install(self):
        (self.runtime / self.names[1]).write_text('another worker edit')
        with self.assertRaisesRegex(RuntimeError, 'source_transport_concurrent_change'):
            installer.install_source_transport()
        self.assertEqual((self.runtime / self.names[0]).read_bytes(), self.old[self.names[0]])
        self.assertEqual((self.runtime / self.names[1]).read_text(), 'another worker edit')
        self.assertEqual(list(self.runtime.parent.glob('mgj-source-transport-backup-*')), [])

    def test_active_lock_prevents_install(self):
        with builtins.open(self.lock, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                installer.install_source_transport()
        for name in self.names:
            self.assertEqual((self.runtime / name).read_bytes(), self.old[name])

    def test_matching_desired_hashes_allow_safe_repeat(self):
        installer.install_source_transport()
        installer.install_source_transport()
        for name in self.names:
            self.assertEqual(installer.sha256(self.runtime / name), installer.sha256(self.source / name))

    def test_dry_run_does_not_install(self):
        with patch.object(installer, 'install_source_transport') as install:
            self.assertEqual(installer.main(['--source-transport-only']), 0)
            install.assert_not_called()


if __name__ == '__main__':
    unittest.main()
