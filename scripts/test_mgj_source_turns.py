"""Synthetic filesystem/process coordination; no live state or network."""
import fcntl
import hashlib
import multiprocessing
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest import mock

try:
    import mgj_source_turns as turns
except ModuleNotFoundError:
    from scripts import mgj_source_turns as turns


def booking_child(ready, start, entered, finish, errors):
    ready.set()
    if not start.wait(3):
        errors.put('start_timeout')
        return
    try:
        with turns.booking_request(max_wait_seconds=2):
            entered.set()
            if not finish.wait(3):
                errors.put('finish_timeout')
    except Exception as exc:
        errors.put(type(exc).__name__)


class SourceTurnTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.base = Path(directory.name)
        self.root = self.base / 'turns'
        self.booking = self.base / 'booking.py'
        self.booking.write_bytes(b'# synthetic booking protocol fixture\n')
        self.booking.chmod(0o600)
        digest = hashlib.sha256(self.booking.read_bytes()).hexdigest()
        for key, value in (('ROOT', self.root), ('BOOKING_PATH', self.booking),
                           ('EXPECTED_BOOKING_SHA256', digest)):
            patch = mock.patch.object(turns, key, value)
            patch.start()
            self.addCleanup(patch.stop)

    def test_protocol_hash_is_exact_and_read_only(self):
        self.assertTrue(turns.booking_protocol_verified())
        self.assertFalse(self.root.exists())
        self.booking.write_bytes(b'# a different runtime\n')
        self.assertFalse(turns.booking_protocol_verified())
        with self.assertRaisesRegex(turns.TurnUnsafe, 'booking_protocol_unverified'):
            with turns.customer_request():
                self.fail('unknown runtime cannot admit a customer')
        self.assertFalse(self.root.exists())

    def test_protocol_rejects_missing_symlink_world_writable_or_oversize_file(self):
        self.booking.chmod(0o666)
        self.assertFalse(turns.booking_protocol_verified())
        self.booking.chmod(0o600)
        original = self.booking.with_suffix('.saved')
        self.booking.rename(original)
        self.assertFalse(turns.booking_protocol_verified())
        self.booking.symlink_to(original)
        self.assertFalse(turns.booking_protocol_verified())
        self.booking.unlink()
        self.booking.write_bytes(b'x' * 256_001)
        self.assertFalse(turns.booking_protocol_verified())

    def test_protocol_rejects_owner_change_and_invalid_expected_digest(self):
        with mock.patch.object(turns.os, 'getuid', return_value=os.getuid() + 1):
            self.assertFalse(turns.booking_protocol_verified())
        with mock.patch.object(turns, 'EXPECTED_BOOKING_SHA256', 'not-a-digest'):
            self.assertFalse(turns.booking_protocol_verified())

    def test_private_empty_control_files_only_and_customer_exclusion(self):
        with turns.customer_request():
            self.assertFalse(turns.booking_pending())
            with self.assertRaisesRegex(turns.TurnBusy, 'source_busy'):
                with turns.customer_request():
                    self.fail('overlapping customers')
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'booking-intent.lock', 'request.lock'})
        for path in self.root.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.read_bytes(), b'')
        with turns.customer_request():
            pass

    def test_booking_intent_blocks_following_customer(self):
        with turns.booking_request():
            self.assertTrue(turns.booking_pending())
            with self.assertRaisesRegex(turns.TurnBusy, 'booking_active'):
                with turns.customer_request():
                    self.fail('customer passed announced booking')
        self.assertFalse(turns.booking_pending())
        with turns.customer_request():
            pass

    def test_customer_rechecks_booking_intent_after_gate_acquisition(self):
        with mock.patch.object(turns, 'booking_pending', side_effect=[False, True]):
            with self.assertRaisesRegex(turns.TurnBusy, 'booking_active'):
                with turns.customer_request():
                    self.fail('race not closed')
        with turns.customer_request():
            pass

    def test_exceptions_release_both_turns(self):
        for guard in (turns.booking_request, turns.customer_request):
            with self.assertRaisesRegex(ValueError, 'fixture'):
                with guard():
                    raise ValueError('fixture')
            with turns.booking_request():
                pass
            with turns.customer_request():
                pass

    def test_booking_wait_expires_without_releasing_existing_customer(self):
        now = [10.0]
        with turns.customer_request():
            with mock.patch.object(turns.time, 'monotonic', side_effect=lambda: now[0]), \
                    mock.patch.object(turns.time, 'sleep', side_effect=lambda delay: now.__setitem__(0, now[0] + delay)):
                with self.assertRaisesRegex(turns.TurnBusy, 'booking_source_wait_timeout'):
                    with turns.booking_request(max_wait_seconds=0.2):
                        self.fail('busy gate entered')
                self.assertLessEqual(now[0], 10.20001)
            self.assertFalse(turns.booking_pending(), 'timed-out intent must be released')
            with self.assertRaises(turns.TurnBusy):
                with turns.customer_request():
                    self.fail('original customer lost its lock')

    def test_deadline_bounds_wait_and_expired_request_never_enters(self):
        now = [10.0]
        with turns.customer_request():
            with mock.patch.object(turns.time, 'monotonic', side_effect=lambda: now[0]), \
                    mock.patch.object(turns.time, 'sleep', side_effect=lambda delay: now.__setitem__(0, now[0] + delay)):
                with self.assertRaises(turns.TurnBusy):
                    with turns.booking_request(deadline=10.1):
                        self.fail('deadline ignored')
                self.assertLessEqual(now[0], 10.10001)
        with turns.booking_request():
            pass
        with self.assertRaises(turns.TurnBusy):
            with turns.booking_request(deadline=time.monotonic() - 1):
                self.fail('expired turn admitted')

    def test_invalid_waits_and_deadlines_fail_closed(self):
        for value in (0, -1, 13, True, '3', float('nan'), float('inf')):
            with self.subTest(wait=value), self.assertRaises(turns.TurnUnsafe):
                with turns.booking_request(max_wait_seconds=value):
                    self.fail('invalid wait admitted')
        for value in (True, '3', float('nan'), float('inf')):
            with self.subTest(deadline=value), self.assertRaises(turns.TurnUnsafe):
                with turns.booking_request(deadline=value):
                    self.fail('invalid deadline admitted')
        self.assertFalse(self.root.exists())

    def test_unsafe_directory_is_never_repaired_or_used(self):
        self.root.mkdir(mode=0o755)
        with self.assertRaises(turns.TurnUnsafe):
            turns.booking_pending()
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o755)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_directory_and_lock_are_rejected(self):
        actual = self.base / 'actual'
        actual.mkdir(mode=0o700)
        self.root.symlink_to(actual, target_is_directory=True)
        with self.assertRaises(turns.TurnUnsafe):
            turns.booking_pending()
        self.root.unlink()
        self.root.mkdir(mode=0o700)
        target = self.base / 'unrelated'
        target.write_bytes(b'preserve')
        (self.root / 'booking-intent.lock').symlink_to(target)
        with self.assertRaises(turns.TurnUnsafe):
            turns.booking_pending()
        self.assertEqual(target.read_bytes(), b'preserve')

    def test_nonprivate_or_hardlinked_lock_is_rejected_not_chmodded(self):
        self.root.mkdir(mode=0o700)
        path = self.root / 'booking-intent.lock'
        path.write_bytes(b'')
        path.chmod(0o644)
        with self.assertRaises(turns.TurnUnsafe):
            turns.booking_pending()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        path.chmod(0o600)
        os.link(path, self.base / 'other-link')
        with self.assertRaises(turns.TurnUnsafe):
            turns.booking_pending()

    def test_control_files_are_not_inherited_by_source_subprocesses(self):
        with turns._open_lock('request.lock') as handle:
            self.assertFalse(os.get_inheritable(handle.fileno()))

    def test_waiting_booking_wins_after_existing_customer_across_processes(self):
        # Start child before taking a flock, so it cannot inherit the parent's
        # active open-file description. No production locks or session files.
        ctx = multiprocessing.get_context('fork')
        ready, start, entered, finish = [ctx.Event() for _ in range(4)]
        errors = ctx.Queue()
        process = ctx.Process(target=booking_child, args=(ready, start, entered, finish, errors))
        process.start()
        try:
            self.assertTrue(ready.wait(2))
            with turns.customer_request():
                start.set()
                limit = time.monotonic() + 2
                while not turns.booking_pending() and time.monotonic() < limit:
                    time.sleep(0.01)
                self.assertTrue(turns.booking_pending())
                self.assertFalse(entered.is_set())
                with self.assertRaises(turns.TurnBusy):
                    with turns.customer_request():
                        self.fail('new customer jumped waiting booking')
            self.assertTrue(entered.wait(2))
            with self.assertRaises(turns.TurnBusy):
                with turns.customer_request():
                    self.fail('customer overlapped actual booking read')
            finish.set()
            process.join(3)
            self.assertEqual(process.exitcode, 0)
            self.assertTrue(errors.empty())
            with turns.customer_request():
                pass
        finally:
            start.set()
            finish.set()
            process.join(3)
            if process.is_alive():
                process.terminate()
                process.join(3)


if __name__ == '__main__':
    unittest.main()
