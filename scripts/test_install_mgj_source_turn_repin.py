"""Synthetic filesystem tests: no live lock directories, processes or jobs."""
import fcntl
import json
import importlib.util
import os
import py_compile
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

try:
    from scripts import install_mgj_source_turn_repin as m
except ModuleNotFoundError:
    import install_mgj_source_turn_repin as m

BOOKING_FIXTURE = b"""
RUN_LOCK_PATH = '/tmp/sync_mgj_bookings.lock'
def acquire_lock():
    fcntl.flock(lock, fcntl.LOCK_NB)
def main():
    acquire_lock()
def request_json():
    turns.booking_request()
def login():
    turns.booking_request()
"""
CUSTOMER_FIXTURE = b"""
COORDINATOR_LOCK = '/tmp/mgj_customer_coordinator.lock'
def acquire_run_lock():
    fcntl.flock(lock, fcntl.LOCK_NB)
def source_slot():
    turns.customer_request()
if __name__ == '__main__':
    acquire_run_lock()
"""
GUARD_FIXTURE = """
EXPECTED_BOOKING_SHA256 = %r
def booking_request():
    pass
def customer_request():
    pass
def booking_protocol_verified():
    pass
"""


def fixture():
    before = {m.BOOKING: BOOKING_FIXTURE, m.CUSTOMER: CUSTOMER_FIXTURE + b'# legacy\n',
              m.MODULE: (GUARD_FIXTURE % ('0'*64)).encode()}
    target = {m.BOOKING: BOOKING_FIXTURE, m.CUSTOMER: CUSTOMER_FIXTURE,
              m.MODULE: (GUARD_FIXTURE % m.sha256(BOOKING_FIXTURE)).encode()}
    return before, target


class Cutover(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(dir=Path(__file__).parent.parent)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.home = self.root / 'private'
        self.run = self.home / 'scripts'
        self.sources = self.root / 'release'
        self.locks = self.root / 'locks'
        for p in self.home, self.run, self.sources, self.locks:
            p.mkdir()
        for name in m.LOCK_NAMES:
            (self.locks / name).touch()
        before, target = fixture()
        for name, content in target.items():
            source = m.CUSTOMER_SOURCE if name == m.CUSTOMER else name
            (self.sources / source).write_bytes(content)
        for name, content in before.items():
            (self.run / name).write_bytes(content)
        (self.run / m.CUSTOMER).chmod(0o700)
        (self.run / m.BOOKING).chmod(0o640)  # unusual but safe, must preserve.
        self.patch = patch.multiple(m, SOURCE_DIR=self.sources, RUNTIME=self.run, BACKUP_PARENT=self.home,
                                    LOCK_DIR=self.locks, EXPECTED_UID=os.getuid(),
                                    PREIMAGES={n: m.sha256(c) for n, c in before.items()},
                                    REVIEWED={n: m.sha256(c) for n, c in target.items()})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.booking = m.snapshot(self.run / m.BOOKING, required=True)
        self.orig_pin = m.snapshot(self.run / m.MODULE, required=True)

    def run_install(self, apply=True, process_reader=lambda: []):
        return m.install(*(m.REVIEWED[n] for n in (m.BOOKING, m.CUSTOMER, m.MODULE)),
                         apply=apply, process_reader=process_reader)

    def observed(self):
        return {name: m.snapshot(self.run / name, required=True)['sha256'] for name in m.PREIMAGES}

    def verify_booking(self):
        self.assertEqual(m.snapshot(self.run / m.BOOKING, True), self.booking)

    def receipts(self):
        return list(self.home.glob('mgj-source-turn-repin-backup-*/receipt.json'))

    def test_check_never_acquires_locks_or_writes(self):
        with patch.object(m, 'deployment_locks', side_effect=AssertionError('unexpected lock')):
            self.assertEqual(self.run_install(False)['status'], 'check_ready')
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.assertEqual(self.receipts(), [])
        self.verify_booking()

    def test_exact_success_two_steps_backup_and_idempotence(self):
        orig = m.atomic_write
        seen = []
        def traced(path, content, mode, **kwargs):
            if path.parent == self.run:
                seen.append((path.name, self.observed()))
            return orig(path, content, mode, **kwargs)
        with patch.object(m, 'atomic_write', side_effect=traced):
            result = self.run_install()
        self.assertEqual(result['status'], 'installed')
        self.assertEqual([n for n, _ in seen], [m.CUSTOMER, m.MODULE])
        self.assertEqual(seen[0][1], m.PREIMAGES)
        self.assertEqual(seen[1][1], {**m.PREIMAGES, m.CUSTOMER: m.REVIEWED[m.CUSTOMER]})
        self.assertEqual(self.observed(), m.REVIEWED)
        self.verify_booking()
        self.assertEqual(self.run_install()['status'], 'already_installed')
        [receipt] = self.receipts()
        self.assertEqual(json.loads(receipt.read_text())['status'], 'installed')
        self.assertEqual(receipt.parent.stat().st_mode & 0o777, 0o700)
        for name, digest in m.PREIMAGES.items():
            source = receipt.with_name(name)
            self.assertEqual(source.stat().st_mode & 0o777, 0o600)
            self.assertEqual(m.sha256(source.read_bytes()), digest)

    def test_fixed_target_and_staging_integrity(self):
        with self.assertRaisesRegex(m.UnsafeInstall, 'unsupported_release_tuple'):
            m.install(m.REVIEWED[m.BOOKING], 'c'*64, m.REVIEWED[m.MODULE], process_reader=lambda: [])
        (self.sources / m.CUSTOMER_SOURCE).write_bytes(b'# unrelated synthetic candidate')
        with self.assertRaisesRegex(m.UnsafeInstall, 'source_hash_mismatch'):
            self.run_install()
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.assertFalse(self.receipts())

    def test_unknown_or_mixed_tuple_stops(self):
        for name, payload in [(m.CUSTOMER, (self.sources/m.CUSTOMER_SOURCE).read_bytes()),
                              (m.BOOKING, b'# synthetic unreviewed booking')]:
            with self.subTest(name=name):
                target = self.run/name
                baseline = target.read_bytes()
                target.write_bytes(payload)
                with self.assertRaisesRegex(m.UnsafeInstall, 'unknown_or_mixed_runtime_preimage'):
                    self.run_install()
                self.assertEqual(target.read_bytes(), payload)
                target.write_bytes(baseline)
        self.assertFalse(self.receipts())

    def test_busy_fourth_lock_does_not_create_backup(self):
        with (self.locks / m.LOCK_NAMES[3]).open('r+b') as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(m.UnsafeInstall, 'coordination_lock_busy'):
                self.run_install()
        self.assertFalse(self.receipts())
        self.assertEqual(self.observed(), m.PREIMAGES)
        with m.deployment_locks() as handles:
            self.assertEqual(tuple(handles), m.LOCK_NAMES)

    def test_unavailable_or_active_process_inventory_refused(self):
        def denied():
            raise m.UnsafeInstall('process_inventory_unavailable')
        for reader, code in ((denied,'process_inventory_unavailable'), (lambda: [9], 'active_booking')):
            with self.assertRaisesRegex(m.UnsafeInstall, code):
                self.run_install(process_reader=reader)
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.assertFalse(self.receipts())

    def test_after_pin_rename_failure_rolls_back_pin_before_customer(self):
        orig = m.atomic_write
        names = []
        def failing(path, content, mode, **kwargs):
            result = orig(path, content, mode, **kwargs)
            if path.parent == self.run:
                names.append(path.name)
                if len(names) == 2:
                    raise OSError('fake error just after pin replace')
            return result
        with patch.object(m, 'atomic_write', side_effect=failing):
            with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'):
                self.run_install()
        self.assertEqual(names, [m.CUSTOMER, m.MODULE, m.MODULE, m.CUSTOMER])
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.verify_booking()
        self.assertEqual(json.loads(self.receipts()[0].read_text())['status'], 'rolled_back')

    def test_old_pin_rollback_rejects_same_length_new_python_cache(self):
        orig = m.atomic_write
        target = self.run / m.MODULE
        old_ns = self.orig_pin['mtime_ns']
        real_replace = []
        def failing(path, content, mode, **kwargs):
            orig(path, content, mode, **kwargs)
            if path == target:
                real_replace.append(path.stat().st_mtime_ns)
                if len(real_replace) == 1:
                    self.assertEqual(len(content), len(self.orig_pin['content']))
                    py_compile.compile(str(path), doraise=True)
                    raise OSError('forced rollback with new pin cached')
        with patch.object(m, 'atomic_write', side_effect=failing), patch.object(
                m.time, 'time_ns', return_value=old_ns):
            with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'):
                self.run_install()
        self.assertNotEqual(real_replace[0] // 1_000_000_000, real_replace[1] // 1_000_000_000)
        self.assertEqual(real_replace[1], old_ns)
        spec = importlib.util.spec_from_file_location('synthetic_rollback_pin', target)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.EXPECTED_BOOKING_SHA256, '0' * 64)

    def test_foreign_pin_same_bytes_different_inode_is_not_owned(self):
        orig = m.atomic_write
        def foreign(path, content, mode, **kwargs):
            orig(path, content, mode, **kwargs)
            if path == self.run / m.MODULE:
                orig(path, content, mode, mtime_ns=kwargs['mtime_ns'])
                raise OSError('unrelated writer replaced pin inode')
        with patch.object(m, 'atomic_write', side_effect=foreign):
            with self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery_required'):
                self.run_install()
        self.assertEqual(self.observed(), m.REVIEWED)
        self.verify_booking()
        result = json.loads(self.receipts()[0].read_text())
        self.assertEqual(result['status'], 'rollback_blocked')
        self.assertIn(m.MODULE, result['rollback_blocked'])

    def test_process_appears_after_customer_preserves_closed_old_pin(self):
        readings = iter([[], [], [], [9]])
        with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'):
            self.run_install(process_reader=lambda: next(readings))
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.verify_booking()

    def test_same_bytes_post_preflight_booking_replacement_refused(self):
        calls = 0
        def process_reader():
            nonlocal calls
            calls += 1
            if calls == 2:
                m.atomic_write(self.run / m.BOOKING, self.booking['content'], self.booking['mode'])
            return []
        with self.assertRaisesRegex(m.UnsafeInstall, 'install_failed_rolled_back'):
            self.run_install(process_reader=process_reader)
        self.assertEqual(self.observed(), m.PREIMAGES)
        self.assertNotEqual(m.snapshot(self.run / m.BOOKING)['identity'], self.booking['identity'])

    def test_changed_lock_path_blocks_pin_and_automatic_rollback(self):
        orig = m.atomic_write
        def replace_lock(path, content, mode, **kwargs):
            orig(path, content, mode, **kwargs)
            if path == self.run / m.CUSTOMER:
                lock = self.locks / m.LOCK_NAMES[3]
                lock.rename(lock.with_suffix('.moved'))
                lock.touch()
        with patch.object(m, 'atomic_write', side_effect=replace_lock):
            with self.assertRaisesRegex(m.UnsafeInstall, 'manual_code_recovery_required'):
                self.run_install()
        self.assertEqual(self.observed(), {**m.PREIMAGES, m.CUSTOMER: m.REVIEWED[m.CUSTOMER]})
        self.verify_booking()


if __name__ == '__main__':
    unittest.main()
