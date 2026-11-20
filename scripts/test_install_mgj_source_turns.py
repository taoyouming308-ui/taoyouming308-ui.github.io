"""Temporary synthetic code/lock fixtures only; never read the real runtime."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('turn_installer_fixture', Path(__file__).with_name('install_mgj_source_turns.py'))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
digest = lambda value: hashlib.sha256(value).hexdigest()
BOOK = b'''import fcntl
import mgj_source_turns as source_turns
RUN_LOCK_PATH = '/tmp/sync_mgj_bookings.lock'
def acquire_lock(path):
    handle = open(path, 'w')
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle
def request_json():
    with source_turns.booking_request(): pass
def login():
    with source_turns.booking_request(): pass
def main(): return acquire_lock(RUN_LOCK_PATH)
'''
CLIENT = b'''import fcntl
import mgj_source_turns as source_turns
COORDINATOR_LOCK = '/tmp/mgj_customer_coordinator.lock'
def acquire_run_lock():
    handle = open(COORDINATOR_LOCK, 'w')
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle
def source_slot():
    with source_turns.customer_request(): pass
if __name__ == '__main__': acquire_run_lock()
'''
HELPER = ("EXPECTED_BOOKING_SHA256 = '" + digest(BOOK) + "'\ndef booking_request(): pass\ndef customer_request(): pass\ndef booking_protocol_verified(): pass\n").encode()
OLD_BOOK, OLD_CLIENT = b'# known booking fixture\n', b'# known customer fixture\n'


class InstallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source, self.runtime, self.locks, self.backups = [self.root / name for name in ('source', 'runtime', 'locks', 'backups')]
        for directory in (self.source, self.runtime, self.locks, self.backups): directory.mkdir(mode=0o700)
        for name, content in ((m.BOOKING, BOOK), (m.CUSTOMER_SOURCE, CLIENT), (m.MODULE, HELPER)):
            (self.source / name).write_bytes(content)
        self.book, self.client, self.helper = [self.runtime / name for name in (m.BOOKING, m.CUSTOMER, m.MODULE)]
        for target, content in ((self.book, OLD_BOOK), (self.client, OLD_CLIENT)):
            target.write_bytes(content); target.chmod(0o755)
        for name in m.LOCK_NAMES: (self.locks / name).write_bytes(b'existing lock, never modify')
        self.sentinels = []
        for name in ('mgj_customer_history_resume.py', 'sync_mgj_daily_consumption.py', 'mgj_keepalive.py',
                     'care_outbound_worker.py', 'credentials.json', 'queue.json', 'cron', 'launchd.plist'):
            target = self.runtime / name; target.write_bytes(b'synthetic private sentinel'); self.sentinels.append(target)
        patch = mock.patch.multiple(m, SOURCE_DIR=self.source, RUNTIME=self.runtime, LOCK_DIR=self.locks,
                                    BACKUP_PARENT=self.backups, EXPECTED_UID=os.getuid(),
                                    PREIMAGES={m.BOOKING: digest(OLD_BOOK), m.CUSTOMER: digest(OLD_CLIENT)})
        patch.start(); self.addCleanup(patch.stop)

    def run_install(self, apply=False, processes=lambda: []):
        return m.install(digest(BOOK), digest(CLIENT), digest(HELPER), apply=apply, process_reader=processes)

    def tree(self):
        return {str(p.relative_to(self.root)): (stat.S_IMODE(p.lstat().st_mode), p.lstat().st_mtime_ns,
                p.read_bytes() if p.is_file() else None) for p in self.root.rglob('*')}

    def assert_old(self):
        self.assertEqual(self.book.read_bytes(), OLD_BOOK); self.assertEqual(self.client.read_bytes(), OLD_CLIENT)
        self.assertFalse(self.helper.exists())

    def assert_locks_free(self):
        for name in m.LOCK_NAMES:
            with open(self.locks / name, 'rb') as handle: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_check_zero_writes_even_without_lock_files(self):
        for lock in self.locks.iterdir(): lock.unlink()
        before = self.tree(); result = self.run_install()
        self.assertEqual(result['status'], 'check_ready'); self.assertFalse(result['changed'])
        self.assertEqual(self.tree(), before)

    def test_requires_explicit_mode_and_three_valid_hashes(self):
        complete = ['--check', '--booking-sha256', digest(BOOK), '--customer-sha256', digest(CLIENT), '--module-sha256', digest(HELPER)]
        for args in [[], complete[:-2], complete[1:], complete[:-1] + ['not-a-sha']]:
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): m.main(args)

    def test_each_hash_mismatch_refuses_without_mutation(self):
        for index in range(3):
            values = [digest(BOOK), digest(CLIENT), digest(HELPER)]; values[index] = '0' * 64
            before = self.tree()
            with self.assertRaisesRegex(m.UnsafeInstall, 'source_hash_mismatch'): m.install(*values, process_reader=lambda: [])
            self.assertEqual(self.tree(), before)

    def test_module_peer_hash_must_equal_exact_booking_target(self):
        for content in [HELPER.replace(digest(BOOK).encode(), b'0' * 64), HELPER + b"EXPECTED_BOOKING_SHA256='" + digest(BOOK).encode() + b"'\n"]:
            (self.source / m.MODULE).write_bytes(content)
            with self.assertRaisesRegex(m.UnsafeInstall, 'module_booking_hash_mismatch'):
                m.install(digest(BOOK), digest(CLIENT), digest(content), process_reader=lambda: [])

    def test_preflight_parses_but_never_imports_target_code(self):
        content = HELPER + b"raise AssertionError('target must not execute')\n"
        (self.source / m.MODULE).write_bytes(content)
        self.assertEqual(m.install(digest(BOOK), digest(CLIENT), digest(content), process_reader=lambda: [])['status'], 'check_ready')

    def test_unknown_newer_partial_or_missing_runtime_refused(self):
        for name, value in ((m.BOOKING, b'unknown booking'), (m.CUSTOMER, b'unknown customer'),
                            (m.MODULE, b'unknown helper'), (m.MODULE, HELPER), (m.BOOKING, BOOK)):
            with self.subTest(target=name):
                self.book.write_bytes(OLD_BOOK); self.client.write_bytes(OLD_CLIENT)
                if self.helper.exists(): self.helper.unlink()
                (self.runtime / name).write_bytes(value)
                before = self.tree()
                with self.assertRaisesRegex(m.UnsafeInstall, 'runtime_preimage'): self.run_install(apply=True)
                self.assertEqual(self.tree(), before)
        self.book.unlink()
        with self.assertRaisesRegex(m.UnsafeInstall, 'required_file_missing'): self.run_install(apply=True)

    def test_protocol_requires_both_singletons_and_both_narrow_participants(self):
        bad_book = BOOK.replace(b'source_turns.booking_request()', b'unguarded()')
        (self.source / m.BOOKING).write_bytes(bad_book)
        helper = HELPER.replace(digest(BOOK).encode(), digest(bad_book).encode())
        (self.source / m.MODULE).write_bytes(helper)
        with self.assertRaisesRegex(m.UnsafeInstall, 'booking_source_turn_protocol'):
            m.install(digest(bad_book), digest(CLIENT), digest(helper), process_reader=lambda: [])
        (self.source / m.BOOKING).write_bytes(BOOK); (self.source / m.MODULE).write_bytes(HELPER)
        bad_client = CLIENT.replace(b'if __name__', b'if False and __name__')
        (self.source / m.CUSTOMER_SOURCE).write_bytes(bad_client)
        with self.assertRaisesRegex(m.UnsafeInstall, 'customer_source_turn_protocol'):
            m.install(digest(BOOK), digest(bad_client), digest(HELPER), process_reader=lambda: [])

    def test_all_four_busy_locks_nonblocking_and_previous_locks_released(self):
        for name in m.LOCK_NAMES:
            with self.subTest(lock=name), open(self.locks / name, 'rb') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); before = self.tree()
                with self.assertRaisesRegex(m.UnsafeInstall, 'coordination_lock_busy'): self.run_install(apply=True)
                self.assertEqual(self.tree(), before)
            self.assert_locks_free()

    def test_reviewed_customer_guard_wrapper_is_a_valid_participant(self):
        wrapped = CLIENT.replace(b'def source_slot():\n    with source_turns.customer_request(): pass',
                                 b'def customer_turn_guard():\n    with source_turns.customer_request(): pass\ndef source_slot():\n    return customer_turn_guard()')
        (self.source / m.CUSTOMER_SOURCE).write_bytes(wrapped)
        self.assertEqual(m.install(digest(BOOK), digest(wrapped), digest(HELPER), process_reader=lambda: [])['status'], 'check_ready')
        unused = wrapped.replace(b'return customer_turn_guard()', b'return unguarded()')
        (self.source / m.CUSTOMER_SOURCE).write_bytes(unused)
        with self.assertRaisesRegex(m.UnsafeInstall, 'customer_source_turn_protocol'):
            m.install(digest(BOOK), digest(unused), digest(HELPER), process_reader=lambda: [])

    def test_missing_or_symlink_lock_is_not_created_or_followed(self):
        target = self.locks / m.LOCK_NAMES[-1]; target.unlink(); before = self.tree()
        with self.assertRaisesRegex(m.UnsafeInstall, 'lock_unavailable'): self.run_install(apply=True)
        self.assertEqual(self.tree(), before)
        target.symlink_to(self.sentinels[0])
        with self.assertRaisesRegex(m.UnsafeInstall, 'lock_unavailable'): self.run_install(apply=True)

    def test_active_process_before_or_inside_locks_refused_without_writes(self):
        for answers in (([100],), ([], [100])):
            before = self.tree()
            with self.assertRaisesRegex(m.UnsafeInstall, 'active_booking_or_customer'):
                self.run_install(apply=True, processes=mock.Mock(side_effect=answers))
            self.assertEqual(self.tree(), before); self.assert_locks_free()

    def test_process_start_between_steps_rolls_back_and_does_not_kill(self):
        # Preflight, locked preflight, pre-module, pre-booking see no process;
        # a new interpreter is visible before customer activation.
        with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'):
            self.run_install(apply=True, processes=mock.Mock(side_effect=[[], [], [], [], [123]]))
        self.assert_old(); self.assert_locks_free()

    def test_runtime_and_source_rechecked_under_all_locks(self):
        actual = m.deployment_locks
        @contextmanager
        def changed():
            with actual():
                self.book.write_bytes(b'concurrent foreign booking')
                yield
        with mock.patch.object(m, 'deployment_locks', changed), self.assertRaisesRegex(m.UnsafeInstall, 'runtime_preimage'):
            self.run_install(apply=True)
        self.assertEqual(self.book.read_bytes(), b'concurrent foreign booking'); self.assertFalse(self.helper.exists())
        self.book.write_bytes(OLD_BOOK)
        @contextmanager
        def source_changed():
            with actual():
                (self.source / m.MODULE).write_bytes(b'concurrent changed source')
                yield
        with mock.patch.object(m, 'deployment_locks', source_changed), self.assertRaisesRegex(m.UnsafeInstall, 'source_hash_mismatch'):
            self.run_install(apply=True)

    def test_install_dependency_order_private_backup_hashes_and_idempotency(self):
        sentinels = {p: p.read_bytes() for p in self.sentinels}; order = []; actual = m.atomic_write
        def record(target, content, mode):
            if target.parent == self.runtime:
                order.append(target.name)
                if target == self.book: self.assertEqual(self.helper.read_bytes(), HELPER)
                if target == self.client: self.assertEqual(self.book.read_bytes(), BOOK)
            return actual(target, content, mode)
        with mock.patch.object(m, 'atomic_write', side_effect=record): result = self.run_install(apply=True)
        self.assertEqual(order, [m.MODULE, m.BOOKING, m.CUSTOMER])
        for name in order: self.assertEqual((self.runtime / name).stat().st_mode & 0o777, 0o700)
        backup = Path(result['backup']); self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / m.BOOKING).read_bytes(), OLD_BOOK); self.assertEqual((backup / m.CUSTOMER).read_bytes(), OLD_CLIENT)
        for p in backup.iterdir(): self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        receipt = json.loads((backup / 'receipt.json').read_text()); self.assertEqual(receipt['status'], 'installed')
        self.assertEqual({p: p.read_bytes() for p in self.sentinels}, sentinels); self.assert_locks_free()
        before = self.tree(); self.assertEqual(self.run_install(apply=True)['status'], 'already_installed'); self.assertEqual(self.tree(), before)

    def test_failure_before_each_replace_restores_only_owned_bytes(self):
        actual = m.atomic_write
        for name in (m.MODULE, m.BOOKING, m.CUSTOMER):
            def fail(target, content, mode):
                if target == self.runtime / name: raise OSError('synthetic before replace')
                return actual(target, content, mode)
            with self.subTest(target=name), mock.patch.object(m, 'atomic_write', side_effect=fail):
                with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'): self.run_install(apply=True)
            self.assert_old(); self.assert_locks_free()

    def test_failure_after_each_replace_restores_original_dependency_set(self):
        actual = m.atomic_write
        for name in (m.MODULE, m.BOOKING, m.CUSTOMER):
            fired = False
            def fail(target, content, mode):
                nonlocal fired
                result = actual(target, content, mode)
                if target == self.runtime / name and not fired:
                    fired = True; raise OSError('synthetic after replace')
                return result
            with self.subTest(target=name), mock.patch.object(m, 'atomic_write', side_effect=fail):
                with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'): self.run_install(apply=True)
            self.assert_old()

    def test_foreign_customer_keeps_booking_and_helper_dependencies(self):
        actual = m.atomic_write
        def foreign(target, content, mode):
            result = actual(target, content, mode)
            if target == self.client:
                self.client.write_bytes(b'foreign customer requiring new peers'); raise OSError('synthetic foreign client')
            return result
        with mock.patch.object(m, 'atomic_write', side_effect=foreign), self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True)
        self.assertEqual(self.client.read_bytes(), b'foreign customer requiring new peers')
        self.assertEqual(self.book.read_bytes(), BOOK); self.assertEqual(self.helper.read_bytes(), HELPER)

    def test_foreign_customer_not_written_here_still_preserves_dependencies(self):
        actual = m.atomic_write
        def foreign(target, content, mode):
            result = actual(target, content, mode)
            if target == self.book:
                self.client.write_bytes(b'foreign client before its deployment step'); raise OSError('synthetic foreign client')
            return result
        with mock.patch.object(m, 'atomic_write', side_effect=foreign), self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True)
        self.assertEqual(self.book.read_bytes(), BOOK); self.assertEqual(self.helper.read_bytes(), HELPER)
        self.assertEqual(self.client.read_bytes(), b'foreign client before its deployment step')

    def test_foreign_booking_keeps_helper_but_old_customer_remains(self):
        actual = m.atomic_write
        def foreign(target, content, mode):
            result = actual(target, content, mode)
            if target == self.book:
                self.book.write_bytes(b'foreign booking'); raise OSError('synthetic foreign booking')
            return result
        with mock.patch.object(m, 'atomic_write', side_effect=foreign), self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True)
        self.assertEqual(self.book.read_bytes(), b'foreign booking'); self.assertEqual(self.helper.read_bytes(), HELPER)
        self.assertEqual(self.client.read_bytes(), OLD_CLIENT)

    def test_foreign_helper_is_never_deleted_or_overwritten(self):
        actual = m.atomic_write
        def foreign(target, content, mode):
            if target == self.client:
                self.helper.write_bytes(b'foreign helper'); raise OSError('synthetic foreign helper')
            return actual(target, content, mode)
        with mock.patch.object(m, 'atomic_write', side_effect=foreign), self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True)
        self.assertEqual(self.helper.read_bytes(), b'foreign helper'); self.assertEqual(self.book.read_bytes(), OLD_BOOK)
        self.assertEqual(self.client.read_bytes(), OLD_CLIENT)

    def test_changed_earlier_dependency_is_checked_before_next_activation(self):
        actual = m.atomic_write
        def changed(target, content, mode):
            result = actual(target, content, mode)
            if target == self.book: self.helper.write_bytes(b'foreign helper after booking readback')
            return result
        with mock.patch.object(m, 'atomic_write', side_effect=changed), self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True)
        self.assertEqual(self.client.read_bytes(), OLD_CLIENT)
        self.assertEqual(self.helper.read_bytes(), b'foreign helper after booking readback')
        self.assertEqual(self.book.read_bytes(), OLD_BOOK)

    def test_final_generation_check_cannot_claim_install_after_foreign_edit(self):
        calls = 0
        def inventory():
            nonlocal calls
            calls += 1
            if calls == 6: self.book.write_bytes(b'foreign booking before success receipt')
            return []
        with self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery'):
            self.run_install(apply=True, processes=inventory)
        self.assertEqual(self.client.read_bytes(), OLD_CLIENT)
        self.assertEqual(self.book.read_bytes(), b'foreign booking before success receipt')
        self.assertEqual(self.helper.read_bytes(), HELPER)
        receipt = json.loads(next(self.backups.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rollback_blocked')

    def test_symlink_hardlink_and_writable_code_refused(self):
        self.helper.symlink_to(self.sentinels[0])
        with self.assertRaisesRegex(m.UnsafeInstall, 'unsafe_code_file'): self.run_install()
        self.helper.unlink(); os.link(self.sentinels[0], self.helper)
        with self.assertRaisesRegex(m.UnsafeInstall, 'unsafe_code_file'): self.run_install()
        self.helper.unlink(); self.book.chmod(0o777)
        with self.assertRaisesRegex(m.UnsafeInstall, 'unsafe_code_file'): self.run_install()

    def test_process_inventory_matches_four_entrypoints_and_module_calls(self):
        result = mock.Mock(returncode=0, stdout='101 /usr/bin/python3 /private/sync_mgj_bookings.py --scheduled\n102 /usr/bin/python3 /private/sync_bookings_v2.py\n103 /usr/bin/python3 /private/sync_mgj_all.py one PRIVATE\n104 /usr/bin/python3 -m scripts.sync_mgj_customer_profiles\n105 /usr/bin/python3 /private/sync_mgj_all.py.bak\n106 /bin/sh harmless-job\n')
        with mock.patch.object(m.subprocess, 'run', return_value=result): self.assertEqual(m.active_source_processes(), [101, 102, 103, 104])
        self.assertNotIn('PRIVATE', str(m.ensure_quiescent.__doc__))

    def test_process_inventory_failures_are_closed_and_cli_output_safe(self):
        for result in (mock.Mock(returncode=1, stdout=''), mock.Mock(returncode=0, stdout=''),
                       mock.Mock(returncode=0, stdout='bad /usr/bin/python3 sync_mgj_all.py PRIVATE')):
            with mock.patch.object(m.subprocess, 'run', return_value=result), self.assertRaises(m.UnsafeInstall): m.active_source_processes()
        with mock.patch.object(m.subprocess, 'run', side_effect=subprocess.TimeoutExpired('ps', 5)), self.assertRaisesRegex(m.UnsafeInstall, 'inventory_unavailable'): m.active_source_processes()
        with self.assertRaisesRegex(m.UnsafeInstall, 'invalid_process_inventory'): self.run_install(processes=lambda: False)
        output = io.StringIO()
        with mock.patch.object(m, 'install', side_effect=m.UnsafeInstall('active_booking_or_customer_processes')), redirect_stdout(output):
            self.assertEqual(m.main(['--check', '--booking-sha256', digest(BOOK), '--customer-sha256', digest(CLIENT), '--module-sha256', digest(HELPER)]), 1)
        self.assertNotIn('PRIVATE', output.getvalue()); self.assertEqual(json.loads(output.getvalue())['status'], 'refused')


if __name__ == '__main__':
    unittest.main()
