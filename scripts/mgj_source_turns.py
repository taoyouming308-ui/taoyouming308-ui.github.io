"""Private, request-scoped coordination for booking and customer source reads.

The booking RUN_LOCK still prevents duplicate batches. These two locks cover
only real Meiguanjia HTTP exchanges, never Supabase traffic or retry sleeps.
An announced booking request wins after an already-started customer read ends.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import math
import os
from pathlib import Path
import re
import stat
import time

ROOT = Path.home() / '.hermes' / 'mgj_source_turns'
BOOKING_PATH = Path(__file__).with_name('sync_mgj_bookings.py')
# Frozen after the canonical booking adapter is reviewed. An unknown/old booking
# binary must not make customers assume that request-level cooperation exists.
EXPECTED_BOOKING_SHA256 = '3baac7235e03876d1d00a48e60066b471c38bd317dfe1579bf1efa98dd415148'
POLL_SECONDS = 0.05
BOOKING_MAX_WAIT_SECONDS = 12.0


class TurnBusy(RuntimeError):
    pass


class TurnUnsafe(RuntimeError):
    pass


def booking_protocol_verified():
    try:
        if not re.fullmatch(r'[0-9a-f]{64}', EXPECTED_BOOKING_SHA256):
            return False
        info = BOOKING_PATH.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o022 or not 0 < info.st_size <= 256_000):
            return False
        fd = os.open(str(BOOKING_PATH), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        with os.fdopen(fd, 'rb') as stream:
            opened = os.fstat(stream.fileno())
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                return False
            content = stream.read(256_001)
        return len(content) <= 256_000 and hashlib.sha256(content).hexdigest() == EXPECTED_BOOKING_SHA256
    except (OSError, TypeError, ValueError):
        return False


def _open_lock(name):
    fd = None
    try:
        parent = ROOT.parent.lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid()
                or parent.st_mode & 0o022):
            raise TurnUnsafe('source_turn_directory_unsafe')
        try:
            ROOT.mkdir(mode=0o700)
        except FileExistsError:
            pass
        directory = ROOT.lstat()
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid()
                or stat.S_IMODE(directory.st_mode) != 0o700):
            raise TurnUnsafe('source_turn_directory_unsafe')
        path = ROOT / name
        fd = os.open(str(path), os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
                     | getattr(os, 'O_CLOEXEC', 0), 0o600)
        info, current = os.fstat(fd), path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)):
            raise TurnUnsafe('source_turn_lock_unsafe')
        stream = os.fdopen(fd, 'r+b', buffering=0)
        fd = None
        return stream
    except OSError:
        raise TurnUnsafe('source_turn_lock_unavailable') from None
    finally:
        if fd is not None:
            os.close(fd)


def _try_lock(stream):
    try:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False
    except OSError:
        raise TurnUnsafe('source_turn_lock_unavailable') from None


def booking_pending():
    with _open_lock('booking-intent.lock') as intent:
        return not _try_lock(intent)


@contextmanager
def customer_request():
    if not booking_protocol_verified():
        raise TurnUnsafe('booking_protocol_unverified')
    if booking_pending():
        raise TurnBusy('booking_active')
    with _open_lock('request.lock') as request:
        if not _try_lock(request):
            raise TurnBusy('source_busy')
        # Close the check/acquire race. A later booking arrival may wait for this
        # already-started bounded request, but no following customer can pass it.
        if booking_pending():
            raise TurnBusy('booking_active')
        yield


def _wait_lock(stream, limit):
    while True:
        now = time.monotonic()
        if now >= limit:
            raise TurnBusy('booking_source_wait_timeout')
        if _try_lock(stream):
            return
        time.sleep(min(POLL_SECONDS, limit - now))


@contextmanager
def booking_request(deadline=None, max_wait_seconds=BOOKING_MAX_WAIT_SECONDS):
    if (isinstance(max_wait_seconds, bool) or not isinstance(max_wait_seconds, (int, float))
            or not math.isfinite(max_wait_seconds) or not 0 < max_wait_seconds <= BOOKING_MAX_WAIT_SECONDS):
        raise TurnUnsafe('source_turn_wait_invalid')
    if deadline is not None and (isinstance(deadline, bool) or not isinstance(deadline, (int, float))
                                 or not math.isfinite(deadline)):
        raise TurnUnsafe('source_turn_deadline_invalid')
    limit = time.monotonic() + max_wait_seconds
    if deadline is not None:
        limit = min(limit, deadline)
    # Keep intent while waiting for a customer's existing <=10s exchange. No
    # customer session/daily lock is acquired here; there is no inverted order.
    with _open_lock('booking-intent.lock') as intent:
        _wait_lock(intent, limit)
        with _open_lock('request.lock') as request:
            _wait_lock(request, limit)
            yield
