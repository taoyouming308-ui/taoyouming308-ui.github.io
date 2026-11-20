"""Synthetic installer coverage: temporary files and fake process inventory only."""
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('customer_backlog_installer', Path(__file__).with_name('install_mgj_customer_backlog.py'))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)

SOURCE = b'''import fcntl
COORDINATOR_LOCK = "/tmp/mgj_customer_coordinator.lock"
def acquire_run_lock():
    f = open(COORDINATOR_LOCK, "w")
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return f
from mgj_customer_history_resume import resume
if __name__ == "__main__":
    run_lock = acquire_run_lock()
    if run_lock is None:
        raise SystemExit(0)
'''
MODULE = b'def resume():\n    return None\n'
OLD = b'# known current customer coordinator fixture\n'
digest = lambda value: hashlib.sha256(value).hexdigest()


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.sources = self.root / 'source'
        self.runtime = self.root / 'runtime'
        self.locks = self.root / 'locks'
        self.backups = self.root / 'backups'
        for directory in (self.sources, self.runtime, self.locks, self.backups):
            directory.mkdir(mode=0o700)
        (self.sources / installer.MAIN_SOURCE).write_bytes(SOURCE)
        (self.sources / installer.MODULE).write_bytes(MODULE)
        self.main = self.runtime / installer.MAIN_TARGET
        self.module = self.runtime / installer.MODULE
        self.main.write_bytes(OLD)
        self.main.chmod(0o700)
        for name in installer.LOCK_NAMES:
            (self.locks / name).write_bytes(b'existing-lock-content')
        self.sentinels = []
        for name in ('sync_mgj_bookings.py', 'sync_mgj_daily_consumption.py', 'mgj_keepalive.py',
                     'care_outbound_worker.py', 'state.json', 'queue.json', 'cron', 'credentials.json'):
            target = self.runtime / name
            target.write_bytes(b'private sentinel, never inspect or change')
            self.sentinels.append(target)
        patcher = mock.patch.multiple(installer, SOURCE_DIR=self.sources, RUNTIME=self.runtime,
                                     BACKUP_PARENT=self.backups, LOCK_DIR=self.locks,
                                     EXPECTED_UID=os.getuid(), KNOWN_PREIMAGE=digest(OLD))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_installer(self, apply=False, processes=lambda: []):
        return installer.install(digest(SOURCE), digest(MODULE), apply=apply, process_reader=processes)

    def tree(self):
        result = {}
        for item in self.root.rglob('*'):
            data = item.lstat()
            result[str(item.relative_to(self.root))] = (stat.S_IMODE(data.st_mode), data.st_mtime_ns,
                                                       item.read_bytes() if item.is_file() else None)
        return result

    def assert_locks_released(self):
        for name in installer.LOCK_NAMES:
            with open(self.locks / name, 'rb') as stream:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_check_zero_writes_and_no_lock_creation(self):
        for lock in self.locks.iterdir():
            lock.unlink()
        before = self.tree()
        result = self.run_installer()
        self.assertEqual(result['status'], 'check_ready')
        self.assertEqual(self.tree(), before)
        self.assertFalse(result['changed'])

    def test_only_explicit_modes_and_both_target_hashes(self):
        with mock.patch('sys.stderr', new=io.StringIO()), self.assertRaises(SystemExit):
            installer.main(['--check'])
        with mock.patch('sys.stderr', new=io.StringIO()), self.assertRaises(SystemExit):
            installer.main(['--source-sha256', digest(SOURCE), '--module-sha256', digest(MODULE)])
        with mock.patch('sys.stderr', new=io.StringIO()), self.assertRaises(SystemExit):
            installer.main(['--check', '--source-sha256', 'not-a-hash', '--module-sha256', digest(MODULE)])

    def test_target_hash_and_coordinator_validation(self):
        before = self.tree()
        with self.assertRaisesRegex(installer.UnsafeInstall, 'source_hash_mismatch'):
            installer.install('0' * 64, digest(MODULE), process_reader=lambda: [])
        self.assertEqual(before, self.tree())
        bad = b'print("legacy locking")\n'
        (self.sources / installer.MAIN_SOURCE).write_bytes(bad)
        with self.assertRaisesRegex(installer.UnsafeInstall, 'coordinator_protocol'):
            installer.install(digest(bad), digest(MODULE), process_reader=lambda: [])

    def test_unknown_or_missing_runtime_and_module_conflict_refused(self):
        for value in (b'legacy uncoordinated runtime', b'unknown customer runtime'):
            self.main.write_bytes(value)
            before = self.tree()
            with self.assertRaisesRegex(installer.UnsafeInstall, 'unknown_customer_runtime'):
                self.run_installer(apply=True)
            self.assertEqual(before, self.tree())
        self.main.write_bytes(OLD)
        self.module.write_bytes(b'unknown helper')
        with self.assertRaisesRegex(installer.UnsafeInstall, 'unknown_resume_module'):
            self.run_installer(apply=True)
        self.module.unlink()
        self.main.unlink()
        with self.assertRaisesRegex(installer.UnsafeInstall, 'required_file_missing'):
            self.run_installer(apply=True)

    def test_each_busy_lock_is_nonblocking_and_releases_previous_locks(self):
        for name in installer.LOCK_NAMES:
            with self.subTest(lock=name), open(self.locks / name, 'rb') as stream:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                before = self.tree()
                with self.assertRaisesRegex(installer.UnsafeInstall, 'coordination_lock_busy'):
                    self.run_installer(apply=True)
                self.assertEqual(self.tree(), before)
            self.assert_locks_released()

    def test_missing_lock_refused_without_creating_it(self):
        (self.locks / installer.LOCK_NAMES[-1]).unlink()
        before = self.tree()
        with self.assertRaisesRegex(installer.UnsafeInstall, 'lock_unavailable'):
            self.run_installer(apply=True)
        self.assertEqual(self.tree(), before)

    def test_active_process_at_preflight_or_under_locks_refused(self):
        for answers in (([123],), ([], [123])):
            with self.subTest(answers=answers):
                before = self.tree()
                with self.assertRaisesRegex(installer.UnsafeInstall, 'active_customer_processes'):
                    self.run_installer(apply=True, processes=mock.Mock(side_effect=answers))
                self.assertEqual(self.tree(), before)
                self.assert_locks_released()

    def test_runtime_or_source_change_after_first_preflight_refused(self):
        def modify_runtime():
            self.main.write_bytes(b'concurrent owner change')
        actual = installer.deployment_locks
        from contextlib import contextmanager
        @contextmanager
        def changed():
            modify_runtime()
            with actual():
                yield
        with mock.patch.object(installer, 'deployment_locks', changed):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'unknown_customer_runtime'):
                self.run_installer(apply=True)
        self.assertEqual(self.main.read_bytes(), b'concurrent owner change')
        self.assertFalse(self.module.exists())
        self.main.write_bytes(OLD)
        @contextmanager
        def source_changed():
            (self.sources / installer.MODULE).write_bytes(b'# changed source\n')
            with actual():
                yield
        with mock.patch.object(installer, 'deployment_locks', source_changed):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'source_hash_mismatch'):
                self.run_installer(apply=True)

    def test_install_module_first_main_last_private_backup_and_other_files_unchanged(self):
        sentinels = {item: item.read_bytes() for item in self.sentinels}
        order = []
        actual = installer.atomic_write
        def record(target, content, mode):
            if target.parent == self.runtime:
                order.append(target.name)
                if target.name == installer.MAIN_TARGET:
                    self.assertEqual(self.module.read_bytes(), MODULE)
            return actual(target, content, mode)
        with mock.patch.object(installer, 'atomic_write', side_effect=record):
            result = self.run_installer(apply=True)
        self.assertEqual(order, [installer.MODULE, installer.MAIN_TARGET])
        self.assertEqual(self.main.read_bytes(), SOURCE)
        self.assertEqual(self.module.read_bytes(), MODULE)
        self.assertEqual(self.main.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.module.stat().st_mode & 0o777, 0o700)
        backup = Path(result['backup'])
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / installer.MAIN_TARGET).read_bytes(), OLD)
        self.assertEqual((backup / installer.MAIN_TARGET).stat().st_mode & 0o777, 0o600)
        receipt = json.loads((backup / 'receipt.json').read_text())
        self.assertEqual(receipt['status'], 'installed')
        self.assertEqual((backup / 'receipt.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual({item: item.read_bytes() for item in self.sentinels}, sentinels)
        self.assert_locks_released()
        before = self.tree()
        self.assertEqual(self.run_installer(apply=True)['status'], 'already_installed')
        self.assertEqual(before, self.tree())

    def test_failure_before_main_rolls_back_owned_module_only(self):
        actual = installer.atomic_write
        def fail(target, content, mode):
            if target == self.main:
                raise OSError('synthetic replace failure')
            return actual(target, content, mode)
        with mock.patch.object(installer, 'atomic_write', side_effect=fail):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'install_failed_rolled_back'):
                self.run_installer(apply=True)
        self.assertEqual(self.main.read_bytes(), OLD)
        self.assertFalse(self.module.exists())
        self.assert_locks_released()

    def test_failure_after_main_replace_restores_original_and_helper(self):
        actual = installer.atomic_write
        failed = False
        def fail(target, content, mode):
            nonlocal failed
            result = actual(target, content, mode)
            if target == self.main and content == SOURCE and not failed:
                failed = True
                raise OSError('synthetic post-replace failure')
            return result
        with mock.patch.object(installer, 'atomic_write', side_effect=fail):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'install_failed_rolled_back'):
                self.run_installer(apply=True)
        self.assertEqual(self.main.read_bytes(), OLD)
        self.assertFalse(self.module.exists())

    def test_rollback_never_overwrites_concurrent_unknown_main_or_removes_its_helper(self):
        actual = installer.atomic_write
        def foreign(target, content, mode):
            result = actual(target, content, mode)
            if target == self.main and content == SOURCE:
                self.main.write_bytes(b'concurrent foreign main')
                raise OSError('synthetic foreign replacement')
            return result
        with mock.patch.object(installer, 'atomic_write', side_effect=foreign):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'manual_code_recovery'):
                self.run_installer(apply=True)
        self.assertEqual(self.main.read_bytes(), b'concurrent foreign main')
        self.assertEqual(self.module.read_bytes(), MODULE)

    def test_rollback_never_deletes_unknown_module(self):
        actual = installer.atomic_write
        def foreign(target, content, mode):
            if target == self.main:
                self.module.write_bytes(b'concurrent foreign helper')
                raise OSError('synthetic foreign helper')
            return actual(target, content, mode)
        with mock.patch.object(installer, 'atomic_write', side_effect=foreign):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'manual_code_recovery'):
                self.run_installer(apply=True)
        self.assertEqual(self.main.read_bytes(), OLD)
        self.assertEqual(self.module.read_bytes(), b'concurrent foreign helper')

    def test_symlink_targets_and_lock_are_refused(self):
        self.module.symlink_to(self.sentinels[0])
        with self.assertRaisesRegex(installer.UnsafeInstall, 'unsafe_file'):
            self.run_installer(apply=True)
        self.module.unlink()
        lock = self.locks / installer.LOCK_NAMES[0]
        lock.unlink()
        lock.symlink_to(self.sentinels[0])
        with self.assertRaisesRegex(installer.UnsafeInstall, 'lock_unavailable'):
            self.run_installer(apply=True)

    def test_process_inventory_is_fail_closed_and_never_exposes_arguments(self):
        result = mock.Mock(returncode=0, stdout='123 /usr/bin/python3 /private/sync_mgj_all.py one PRIVATE\n124 /bin/sh other-job\n125 /usr/bin/python3 -m sync_mgj_customer_profiles\n')
        with mock.patch.object(installer.subprocess, 'run', return_value=result):
            self.assertEqual(installer.active_customer_processes(), [123, 125])
        result.returncode = 1
        with mock.patch.object(installer.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'inventory_unavailable'):
                installer.active_customer_processes()
        result.returncode = 0
        result.stdout = ''
        with mock.patch.object(installer.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(installer.UnsafeInstall, 'inventory_unavailable'):
                installer.active_customer_processes()
        with self.assertRaisesRegex(installer.UnsafeInstall, 'invalid_process_inventory'):
            self.run_installer(processes=lambda: False)


if __name__ == '__main__':
    unittest.main()
