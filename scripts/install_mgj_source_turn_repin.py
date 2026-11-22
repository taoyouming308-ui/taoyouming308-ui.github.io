#!/usr/bin/env python3
"""Exact reviewed customer/source-turn repair; never replaces booking or runs jobs.

--check only reads code and a process inventory. The installer never imports
the target module, creates coordination locks, or reads private business state.
"""
import argparse
import ast
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / 'scripts'
RUNTIME = Path('/Users/a1/.hermes/scripts')
BACKUP_PARENT = RUNTIME.parent
LOCK_DIR = Path('/tmp')
EXPECTED_UID = 501
MODULE = 'mgj_source_turns.py'
BOOKING = 'sync_mgj_bookings.py'
CUSTOMER_SOURCE = 'sync_mgj_customer_profiles.py'
CUSTOMER = 'sync_mgj_all.py'
# Deliberately not CLI-overridable. Protected release must review any new tuple.
PREIMAGES = {
    BOOKING: '826ec45da840f78a6c1e5aa5dcc003bfe1cf98ba95ec9f0e71db112740e09a28',
    CUSTOMER: '53b575ab0b47698adc68db618b6e4c85ea5fb04090fd045cd292b3d1230bb335',
    MODULE: '5d5628203985a7f9ab9b8a17861b2a598323a1d41bee50c6417a6ff705f2b787',
}
REVIEWED = {
    BOOKING: PREIMAGES[BOOKING],
    CUSTOMER: '368dffa7cece1103b9e7b3fc09a78ed92fbba4458806aeded7dc460a2d3dff27',
    MODULE: '7caac89a7f011fad46f6384feda9ddb42dece49a357c4df6ad683ef8c8f7dd28',
}
WRITE_ORDER = (CUSTOMER, MODULE)
LOCK_NAMES = ('mgj_customer_coordinator.lock', 'sync_mgj_all.lock',
              'sync_mgj_bookings.lock', 'mgj_daily_consumption.lock')
MAX_CODE_BYTES = 512_000


class UnsafeInstall(RuntimeError):
    pass


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def require_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise UnsafeInstall('invalid_expected_sha256')
    return value


def digest_argument(value):
    try:
        return require_digest(value)
    except UnsafeInstall:
        raise argparse.ArgumentTypeError('expected a lowercase SHA-256 digest') from None


def check_owner():
    if os.getuid() != EXPECTED_UID or os.geteuid() != EXPECTED_UID:
        raise UnsafeInstall('unexpected_user')
    for directory in (SOURCE_DIR, RUNTIME, BACKUP_PARENT):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != EXPECTED_UID or info.st_mode & 0o022:
            raise UnsafeInstall('unsafe_directory')


def snapshot(path, required=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if required:
            raise UnsafeInstall('required_file_missing:' + path.name) from None
        return None
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != EXPECTED_UID
            or info.st_mode & 0o022 or info.st_nlink != 1 or info.st_size > MAX_CODE_BYTES):
        raise UnsafeInstall('unsafe_code_file:' + path.name)
    descriptor = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        actual = os.fstat(stream.fileno())
        if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
            raise UnsafeInstall('code_changed_during_read:' + path.name)
        content = stream.read(MAX_CODE_BYTES + 1)
    if len(content) > MAX_CODE_BYTES:
        raise UnsafeInstall('unsafe_code_file:' + path.name)
    return {'content': content, 'sha256': sha256(content), 'mode': stat.S_IMODE(info.st_mode),
            'identity': (info.st_dev, info.st_ino), 'mtime_ns': info.st_mtime_ns}


def parsed(content):
    try:
        return ast.parse(content)
    except (SyntaxError, ValueError):
        raise UnsafeInstall('invalid_target_python') from None


def constants(tree, name):
    return [node.value.value for node in tree.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)
            and isinstance(node.value, ast.Constant)]


def function(tree, name):
    return next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name), None)


def has_nonblocking_flock(node):
    attributes = {part.attr for part in ast.walk(node) if isinstance(part, ast.Attribute)} if node else set()
    return {'flock', 'LOCK_NB'}.issubset(attributes)


def calls_attribute(node, attribute):
    return node is not None and any(isinstance(part, ast.Call) and isinstance(part.func, ast.Attribute)
                                    and part.func.attr == attribute for part in ast.walk(node))


def calls_name(node, name):
    return node is not None and any(isinstance(part, ast.Call) and isinstance(part.func, ast.Name)
                                    and part.func.id == name for part in ast.walk(node))


def validate_protocols(booking, customer, module, booking_sha256):
    book, client, helper = parsed(booking), parsed(customer), parsed(module)
    if constants(helper, 'EXPECTED_BOOKING_SHA256') != [booking_sha256]:
        raise UnsafeInstall('module_booking_hash_mismatch')
    if any(function(helper, name) is None for name in ('booking_request', 'customer_request', 'booking_protocol_verified')):
        raise UnsafeInstall('source_turn_module_protocol_required')
    if (constants(book, 'RUN_LOCK_PATH') != ['/tmp/sync_mgj_bookings.lock']
            or not has_nonblocking_flock(function(book, 'acquire_lock'))
            or not calls_name(function(book, 'main'), 'acquire_lock')
            or any(not calls_attribute(function(book, name), 'booking_request') for name in ('request_json', 'login'))):
        raise UnsafeInstall('booking_source_turn_protocol_required')
    cli = next((node for node in client.body if isinstance(node, ast.If)
                and isinstance(node.test, ast.Compare)
                and isinstance(node.test.left, ast.Name) and node.test.left.id == '__name__'
                and any(isinstance(value, ast.Constant) and value.value == '__main__'
                        for value in node.test.comparators)), None)
    slot = function(client, 'source_slot')
    guarded_customer = calls_attribute(slot, 'customer_request') or (
        calls_name(slot, 'customer_turn_guard')
        and calls_attribute(function(client, 'customer_turn_guard'), 'customer_request'))
    if (constants(client, 'COORDINATOR_LOCK') != ['/tmp/mgj_customer_coordinator.lock']
            or not has_nonblocking_flock(function(client, 'acquire_run_lock'))
            or not calls_name(cli, 'acquire_run_lock')
            or not guarded_customer):
        raise UnsafeInstall('customer_source_turn_protocol_required')


def desired_files(booking_sha256, customer_sha256, module_sha256):
    caller = {BOOKING: require_digest(booking_sha256), CUSTOMER: require_digest(customer_sha256),
              MODULE: require_digest(module_sha256)}
    if caller != REVIEWED:
        raise UnsafeInstall('unsupported_release_tuple')
    stock = {BOOKING: BOOKING, CUSTOMER: CUSTOMER_SOURCE, MODULE: MODULE}
    sources = {name: snapshot(SOURCE_DIR / source, required=True) for name, source in stock.items()}
    for name, digest in REVIEWED.items():
        if sources[name]['sha256'] != digest:
            raise UnsafeInstall('source_hash_mismatch:' + stock[name])
    validate_protocols(sources[BOOKING]['content'], sources[CUSTOMER]['content'],
                       sources[MODULE]['content'], booking_sha256)
    return {name: sources[name]['content'] for name in (BOOKING, *WRITE_ORDER)}


def active_source_processes():
    try:
        result = subprocess.run(['/bin/ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        raise UnsafeInstall('process_inventory_unavailable') from None
    if result.returncode or not result.stdout.strip():
        raise UnsafeInstall('process_inventory_unavailable')
    # A qualified -m scripts.sync_* module is also a real participant; the
    # trailing boundary still excludes unrelated .bak / suffixed filenames.
    targets = re.compile(r'(?<![\w-])(?:sync_mgj_bookings|sync_bookings_v2|sync_mgj_all|sync_mgj_customer_profiles)(?:\.py)?(?![\w.-])')
    python = re.compile(r'^python(?:\d+(?:\.\d+)*)?$', re.IGNORECASE)
    active = []
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or not targets.search(fields[1]):
            continue
        try:
            pid, arguments = int(fields[0]), shlex.split(fields[1])
        except (ValueError, TypeError):
            raise UnsafeInstall('ambiguous_source_process') from None
        if pid <= 0:
            raise UnsafeInstall('ambiguous_source_process')
        if any(python.fullmatch(Path(argument).name) for argument in arguments):
            active.append(pid)
    return sorted(set(active))


def ensure_quiescent(process_reader):
    processes = process_reader()
    if not isinstance(processes, (list, tuple)) or any(type(pid) is not int or pid <= 0 for pid in processes):
        raise UnsafeInstall('invalid_process_inventory')
    if processes:
        raise UnsafeInstall('active_booking_or_customer_processes')


def metadata(value):
    return {'present': value is not None, **({key: value[key] for key in ('sha256', 'mode', 'mtime_ns')} if value else {})}


def same_snapshot(left, right):
    return left == right


def preflight(booking_sha256, customer_sha256, module_sha256, process_reader=active_source_processes):
    check_owner()
    desired = desired_files(booking_sha256, customer_sha256, module_sha256)
    before = {name: snapshot(RUNTIME / name, required=True) for name in desired}
    original = all(before[name]['sha256'] == digest for name, digest in PREIMAGES.items())
    identical = all(before[name]['sha256'] == REVIEWED[name] for name in desired)
    if not original and not identical:
        raise UnsafeInstall('unknown_or_mixed_runtime_preimage')
    if identical and any(before[name]['mode'] != 0o700 for name in WRITE_ORDER):
        raise UnsafeInstall('reviewed_bytes_with_unexpected_modes')
    ensure_quiescent(process_reader)
    return desired, before


@contextmanager
def deployment_locks():
    handles = {}
    try:
        for name in LOCK_NAMES:
            try:
                descriptor = os.open(str(LOCK_DIR / name), os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
            except OSError:
                raise UnsafeInstall('coordination_lock_unavailable:' + name) from None
            stream = os.fdopen(descriptor, 'r+b')
            handles[name] = stream
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != EXPECTED_UID or info.st_nlink != 1:
                raise UnsafeInstall('unsafe_coordination_lock:' + name)
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise UnsafeInstall('coordination_lock_busy:' + name) from None
        verify_locks(handles)
        yield handles
    finally:
        for stream in reversed(list(handles.values())):
            stream.close()


def verify_locks(handles):
    for name, stream in handles.items():
        acquired = os.fstat(stream.fileno())
        try:
            live = (LOCK_DIR / name).lstat()
        except OSError:
            raise UnsafeInstall('coordination_lock_changed:' + name) from None
        if (live.st_dev, live.st_ino, live.st_nlink) != (acquired.st_dev, acquired.st_ino, 1):
            raise UnsafeInstall('coordination_lock_changed:' + name)


def fsync_directory(path):
    directory = os.open(str(path), os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def atomic_write(path, content, mode, record_owned=None, mtime_ns=None):
    descriptor, temporary = tempfile.mkstemp(prefix='.mgj-source-turn-install-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            if mtime_ns is not None:
                os.utime(stream.fileno(), ns=(mtime_ns, mtime_ns))
            os.fsync(stream.fileno())
            info = os.fstat(stream.fileno())
            identity = (info.st_dev, info.st_ino)
        if record_owned is not None:
            # Register inode before replace so a post-rename fsync failure is recoverable.
            record_owned(identity)
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save_receipt(backup, receipt):
    atomic_write(backup / 'receipt.json', (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode(), 0o600)


def matches_owned(current, event):
    return bool(current and current['sha256'] == event['sha256']
                and current['mode'] == 0o700 and current['identity'] == event['identity']
                and current['mtime_ns'] == event['mtime_ns'])


def rollback_owned(writes, before, handles):
    # Restore the old pin first to close source access before touching customer code.
    # Stop rather than overwrite a foreign edit or mix with an unknown booking/pin.
    for name in reversed(WRITE_ORDER):
        try:
            verify_locks(handles)
            if not same_snapshot(snapshot(RUNTIME / BOOKING), before[BOOKING]):
                return [BOOKING, name]
            if name == CUSTOMER:
                pin = snapshot(RUNTIME / MODULE)
                if not pin or metadata(pin) != metadata(before[MODULE]):
                    return [MODULE, CUSTOMER]
            if name not in writes:
                continue
            target = RUNTIME / name
            current = snapshot(target)
            if same_snapshot(current, before[name]):
                continue
            if not matches_owned(current, writes[name]):
                return [name]
            atomic_write(target, before[name]['content'], before[name]['mode'],
                         mtime_ns=before[name]['mtime_ns'])
            if metadata(snapshot(target)) != metadata(before[name]):
                return [name]
        except (OSError, UnsafeInstall):
            return [name]
    return []


def verify_runtime_generation(desired, before, writes):
    for name in desired:
        current = snapshot(RUNTIME / name)
        matches = (matches_owned(current, writes[name]) if name in writes
                   else same_snapshot(current, before[name]))
        if not matches:
            raise UnsafeInstall('runtime_changed_during_install:' + name)


def install(booking_sha256, customer_sha256, module_sha256, apply=False, process_reader=active_source_processes):
    desired, before = preflight(booking_sha256, customer_sha256, module_sha256, process_reader)
    ready = all(before[name]['sha256'] == REVIEWED[name] for name in desired)
    if not apply:
        return {'status': 'already_installed' if ready else 'check_ready', 'changed': False,
                'targets': {name: sha256(content) for name, content in desired.items()}}
    with deployment_locks() as handles:
        locked_desired, locked_before = preflight(booking_sha256, customer_sha256, module_sha256, process_reader)
        if locked_desired != desired or any(not same_snapshot(before[name], locked_before[name]) for name in desired):
            raise UnsafeInstall('runtime_changed_before_install')
        if ready:
            return {'status': 'already_installed', 'changed': False,
                    'targets': {name: sha256(content) for name, content in desired.items()}}
        backup = Path(tempfile.mkdtemp(prefix='mgj-source-turn-repin-backup-', dir=str(BACKUP_PARENT)))
        os.chmod(backup, 0o700)
        receipt = {'version': 1, 'release': '2026-11-22-customer-source-turn-repin', 'created_at': datetime.now(timezone.utc).isoformat(), 'status': 'prepared',
                   'before': {name: metadata(value) for name, value in before.items()},
                   'target': dict(REVIEWED), 'write_order': list(WRITE_ORDER)}
        for name, value in before.items():
            if value is not None:
                atomic_write(backup / name, value['content'], 0o600)
                if sha256((backup / name).read_bytes()) != value['sha256']:
                    raise UnsafeInstall('backup_readback_failed')
        save_receipt(backup, receipt)
        fsync_directory(BACKUP_PARENT)
        writes = {}
        try:
            for name in WRITE_ORDER:
                content = desired[name]
                ensure_quiescent(process_reader)
                verify_locks(handles)
                # Check both not-yet-written preimages and earlier dependencies.
                verify_runtime_generation(desired, before, writes)
                # CPython timestamp cache stores whole seconds and source size.
                # Make the installed timestamp differ from the old one even when
                # code size is unchanged and a runner imports before its run lock.
                prior_second = before[name]['mtime_ns'] // 1_000_000_000
                fresh_mtime = max(time.time_ns() // 1_000_000_000, prior_second + 1) * 1_000_000_000
                atomic_write(RUNTIME / name, content, 0o700, mtime_ns=fresh_mtime,
                             record_owned=lambda identity: writes.update({name: {
                                 'sha256': REVIEWED[name], 'identity': identity,
                                 'mtime_ns': fresh_mtime,
                             }}))
                if not matches_owned(snapshot(RUNTIME / name, required=True), writes[name]):
                    raise UnsafeInstall('runtime_readback_failed:' + name)
            ensure_quiescent(process_reader)
            verify_locks(handles)
            verify_runtime_generation(desired, before, writes)
            receipt['status'] = 'installed'
            save_receipt(backup, receipt)
        except Exception:
            blocked = rollback_owned(writes, before, handles) if writes else []
            receipt['status'] = 'rollback_blocked' if blocked else 'rolled_back'
            receipt['rollback_blocked'] = blocked
            try:
                save_receipt(backup, receipt)
            except OSError:
                pass
            raise UnsafeInstall('install_failed_manual_code_recovery_required' if blocked else 'install_failed_rolled_back') from None
        return {'status': 'installed', 'changed': True, 'backup': str(backup), 'targets': receipt['target']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='read-only preflight, no files or locks created')
    mode.add_argument('--install', action='store_true', help='explicit customer-then-pin repair; never writes booking')
    parser.add_argument('--booking-sha256', required=True, type=digest_argument)
    parser.add_argument('--customer-sha256', required=True, type=digest_argument)
    parser.add_argument('--module-sha256', required=True, type=digest_argument)
    args = parser.parse_args(argv)
    try:
        result = install(args.booking_sha256, args.customer_sha256, args.module_sha256, apply=args.install)
    except (UnsafeInstall, OSError) as exc:
        code = str(exc) if isinstance(exc, UnsafeInstall) else type(exc).__name__
        print(json.dumps({'status': 'refused', 'code': code}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
