#!/usr/bin/env python3
"""Explicit three-file source-turn rollout; never starts or changes jobs.

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
PREIMAGES = {
    BOOKING: '0e4ac3573da68c5f41f71251111ca3e89e9a2f41f9283ffa9b02cc3a3b303dd6',
    CUSTOMER: '7abffe237c5e8dc4b54109ed05af913c65fa8f9f96abc8a967474219f7a8169f',
}
LOCK_NAMES = ('mgj_customer_coordinator.lock', 'sync_mgj_all.lock',
              'sync_mgj_bookings.lock', 'mgj_daily_consumption.lock')
MAX_CODE_BYTES = 512_000
DEPENDENTS = {BOOKING: (CUSTOMER,), MODULE: (CUSTOMER, BOOKING)}


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
    return {'content': content, 'sha256': sha256(content), 'mode': stat.S_IMODE(info.st_mode)}


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
    expected = {BOOKING: require_digest(booking_sha256), CUSTOMER_SOURCE: require_digest(customer_sha256),
                MODULE: require_digest(module_sha256)}
    sources = {name: snapshot(SOURCE_DIR / name, required=True) for name in expected}
    for name, digest in expected.items():
        if sources[name]['sha256'] != digest:
            raise UnsafeInstall('source_hash_mismatch:' + name)
    validate_protocols(sources[BOOKING]['content'], sources[CUSTOMER_SOURCE]['content'],
                       sources[MODULE]['content'], booking_sha256)
    # One-way safe activation: shared dependency, booking participant, then client.
    return {MODULE: sources[MODULE]['content'], BOOKING: sources[BOOKING]['content'],
            CUSTOMER: sources[CUSTOMER_SOURCE]['content']}


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
    return {'present': value is not None, **({key: value[key] for key in ('sha256', 'mode')} if value else {})}


def same_snapshot(left, right):
    return metadata(left) == metadata(right)


def preflight(booking_sha256, customer_sha256, module_sha256, process_reader=active_source_processes):
    check_owner()
    desired = desired_files(booking_sha256, customer_sha256, module_sha256)
    before = {name: snapshot(RUNTIME / name, required=name != MODULE) for name in desired}
    original = before[MODULE] is None and all(before[name]['sha256'] == digest for name, digest in PREIMAGES.items())
    identical = all(before[name] and before[name]['sha256'] == sha256(content) for name, content in desired.items())
    # Do not infer authorization to repair partial or unrelated newer deployments.
    if not original and not identical:
        raise UnsafeInstall('unknown_or_mixed_runtime_preimage')
    ensure_quiescent(process_reader)
    return desired, before


@contextmanager
def deployment_locks():
    handles = []
    try:
        for name in LOCK_NAMES:
            try:
                descriptor = os.open(str(LOCK_DIR / name), os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
            except OSError:
                raise UnsafeInstall('coordination_lock_unavailable:' + name) from None
            stream = os.fdopen(descriptor, 'r+b')
            handles.append(stream)
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != EXPECTED_UID or info.st_nlink != 1:
                raise UnsafeInstall('unsafe_coordination_lock:' + name)
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise UnsafeInstall('coordination_lock_busy:' + name) from None
        yield
    finally:
        for stream in reversed(handles):
            stream.close()


def atomic_write(path, content, mode):
    descriptor, temporary = tempfile.mkstemp(prefix='.mgj-source-turn-install-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(str(path.parent), os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save_receipt(backup, receipt):
    atomic_write(backup / 'receipt.json', (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode(), 0o600)


def rollback_owned(writes, before):
    blocked = []
    for name, digest in reversed(list(writes.items())):
        # Never remove/downgrade a dependency of any surviving foreign main,
        # including a main that changed before this installer wrote that file.
        dependency_blocked = False
        for dependent in DEPENDENTS.get(name, ()):
            try:
                restored = same_snapshot(snapshot(RUNTIME / dependent), before[dependent])
            except (OSError, UnsafeInstall):
                restored = False
            if not restored:
                blocked.extend([dependent, name])
                dependency_blocked = True
        if dependency_blocked:
            continue
        target = RUNTIME / name
        try:
            current = snapshot(target)
            if same_snapshot(current, before[name]):
                continue
            if not current or current['sha256'] != digest:
                blocked.append(name)
                continue
            if before[name] is None:
                target.unlink()
            else:
                atomic_write(target, before[name]['content'], before[name]['mode'])
                if not same_snapshot(snapshot(target), before[name]):
                    blocked.append(name)
        except (OSError, UnsafeInstall):
            blocked.append(name)
    return sorted(set(blocked))


def verify_runtime_generation(desired, before, writes):
    for name in desired:
        current = snapshot(RUNTIME / name)
        if name in writes:
            matches = current and current['sha256'] == writes[name] and current['mode'] == 0o700
        else:
            matches = same_snapshot(current, before[name])
        if not matches:
            raise UnsafeInstall('runtime_changed_during_install:' + name)


def install(booking_sha256, customer_sha256, module_sha256, apply=False, process_reader=active_source_processes):
    desired, before = preflight(booking_sha256, customer_sha256, module_sha256, process_reader)
    ready = all(before[name] and before[name]['sha256'] == sha256(content) and before[name]['mode'] == 0o700
                for name, content in desired.items())
    if not apply:
        return {'status': 'already_installed' if ready else 'check_ready', 'changed': False,
                'targets': {name: sha256(content) for name, content in desired.items()}}
    with deployment_locks():
        locked_desired, locked_before = preflight(booking_sha256, customer_sha256, module_sha256, process_reader)
        if locked_desired != desired or any(not same_snapshot(before[name], locked_before[name]) for name in desired):
            raise UnsafeInstall('runtime_changed_before_install')
        if ready:
            return {'status': 'already_installed', 'changed': False,
                    'targets': {name: sha256(content) for name, content in desired.items()}}
        backup = Path(tempfile.mkdtemp(prefix='mgj-source-turns-backup-', dir=str(BACKUP_PARENT)))
        os.chmod(backup, 0o700)
        receipt = {'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'status': 'prepared',
                   'before': {name: metadata(value) for name, value in before.items()},
                   'target': {name: sha256(content) for name, content in desired.items()}}
        for name, value in before.items():
            if value is not None:
                atomic_write(backup / name, value['content'], 0o600)
                if sha256((backup / name).read_bytes()) != value['sha256']:
                    raise UnsafeInstall('backup_readback_failed')
        save_receipt(backup, receipt)
        writes = {}
        try:
            for name, content in desired.items():
                ensure_quiescent(process_reader)
                # Check both not-yet-written preimages and earlier dependencies.
                verify_runtime_generation(desired, before, writes)
                writes[name] = sha256(content)
                atomic_write(RUNTIME / name, content, 0o700)
                installed = snapshot(RUNTIME / name, required=True)
                if installed['sha256'] != writes[name] or installed['mode'] != 0o700:
                    raise UnsafeInstall('runtime_readback_failed:' + name)
            ensure_quiescent(process_reader)
            verify_runtime_generation(desired, before, writes)
            receipt['status'] = 'installed'
            save_receipt(backup, receipt)
        except Exception:
            blocked = rollback_owned(writes, before)
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
    mode.add_argument('--install', action='store_true', help='explicit three-file runtime installation')
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
