#!/usr/bin/env python3
"""Install only the customer coordinator and its history-resume module.

--check never creates files or acquires locks. Installation uses the existing
four lock files; it never starts/stops jobs or reads customer/session data.
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
KNOWN_PREIMAGE = '89a51806212cf335f1ba2c38c3dbe0880cf77996cda72a8c350bf6627da6a338'
MAIN_SOURCE = 'sync_mgj_customer_profiles.py'
MAIN_TARGET = 'sync_mgj_all.py'
MODULE = 'mgj_customer_history_resume.py'
LOCK_NAMES = ('mgj_customer_coordinator.lock', 'sync_mgj_all.lock',
              'sync_mgj_bookings.lock', 'mgj_daily_consumption.lock')


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
    if not stat.S_ISREG(info.st_mode) or info.st_uid != EXPECTED_UID or info.st_mode & 0o022:
        raise UnsafeInstall('unsafe_file:' + path.name)
    # O_NOFOLLOW also rejects a symlink swapped after lstat.
    descriptor = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        actual = os.fstat(stream.fileno())
        if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
            raise UnsafeInstall('file_changed_during_read:' + path.name)
        content = stream.read()
    return {'content': content, 'sha256': sha256(content), 'mode': stat.S_IMODE(info.st_mode)}


def validate_source_protocol(content):
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        raise UnsafeInstall('invalid_customer_source') from None
    coordinator = any(isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'COORDINATOR_LOCK'
                              for target in node.targets)
                      and isinstance(node.value, ast.Constant)
                      and node.value.value == '/tmp/mgj_customer_coordinator.lock'
                      for node in tree.body)
    acquire = next((node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name == 'acquire_run_lock'), None)
    names = {node.id for node in ast.walk(acquire) if isinstance(node, ast.Name)} if acquire else set()
    attributes = {node.attr for node in ast.walk(acquire) if isinstance(node, ast.Attribute)} if acquire else set()
    cli = next((node for node in tree.body if isinstance(node, ast.If)
                and isinstance(node.test, ast.Compare)
                and isinstance(node.test.left, ast.Name) and node.test.left.id == '__name__'
                and any(isinstance(value, ast.Constant) and value.value == '__main__'
                        for value in node.test.comparators)), None)
    cli_calls = {node.func.id for node in ast.walk(cli) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name)} if cli else set()
    if (not coordinator or 'COORDINATOR_LOCK' not in names or 'LOCK_NB' not in attributes
            or 'flock' not in attributes or 'acquire_run_lock' not in cli_calls):
        raise UnsafeInstall('customer_coordinator_protocol_required')


def desired_files(source_sha256, module_sha256):
    expected = {MAIN_SOURCE: require_digest(source_sha256), MODULE: require_digest(module_sha256)}
    originals = {name: snapshot(SOURCE_DIR / name, required=True) for name in expected}
    for name, digest in expected.items():
        if originals[name]['sha256'] != digest:
            raise UnsafeInstall('source_hash_mismatch:' + name)
    validate_source_protocol(originals[MAIN_SOURCE]['content'])
    try:
        ast.parse(originals[MODULE]['content'])
    except (SyntaxError, ValueError):
        raise UnsafeInstall('invalid_resume_module') from None
    # Insertion order is the deployment order: helper first, entrypoint last.
    return {MODULE: originals[MODULE]['content'], MAIN_TARGET: originals[MAIN_SOURCE]['content']}


def active_customer_processes():
    try:
        result = subprocess.run(['/bin/ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        raise UnsafeInstall('process_inventory_unavailable') from None
    if result.returncode:
        raise UnsafeInstall('process_inventory_unavailable')
    if not result.stdout.strip():
        raise UnsafeInstall('process_inventory_unavailable')
    targets = re.compile(r'(?<![\w.-])(?:sync_mgj_all|sync_mgj_customer_profiles)(?:\.py)?(?![\w.-])')
    python = re.compile(r'^python(?:\d+(?:\.\d+)*)?$', re.IGNORECASE)
    active = []
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or not targets.search(fields[1]):
            continue
        try:
            pid = int(fields[0])
            arguments = shlex.split(fields[1])
        except (ValueError, TypeError):
            raise UnsafeInstall('ambiguous_customer_process') from None
        if any(python.fullmatch(Path(argument).name) for argument in arguments):
            active.append(pid)
    return sorted(set(active))


def ensure_quiescent(process_reader):
    processes = process_reader()
    if not isinstance(processes, (list, tuple)) or any(type(pid) is not int or pid <= 0 for pid in processes):
        raise UnsafeInstall('invalid_process_inventory')
    if processes:
        # Never print process arguments: they may contain customer identifiers.
        raise UnsafeInstall('active_customer_processes')


def preflight(source_sha256, module_sha256, process_reader=active_customer_processes):
    check_owner()
    desired = desired_files(source_sha256, module_sha256)
    before = {name: snapshot(RUNTIME / name, required=name == MAIN_TARGET) for name in desired}
    if before[MAIN_TARGET]['sha256'] not in (KNOWN_PREIMAGE, sha256(desired[MAIN_TARGET])):
        raise UnsafeInstall('unknown_customer_runtime_preimage')
    if before[MODULE] and before[MODULE]['sha256'] != sha256(desired[MODULE]):
        raise UnsafeInstall('unknown_resume_module_preimage')
    ensure_quiescent(process_reader)
    return desired, before


@contextmanager
def deployment_locks():
    handles = []
    try:
        # Never create/unlink lock files: all four belong to the existing runtime.
        for name in LOCK_NAMES:
            lock = LOCK_DIR / name
            try:
                descriptor = os.open(str(lock), os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
            except OSError:
                raise UnsafeInstall('coordination_lock_unavailable:' + name) from None
            stream = os.fdopen(descriptor, 'r+b')
            handles.append(stream)
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != EXPECTED_UID:
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
    descriptor, temporary = tempfile.mkstemp(prefix='.mgj-customer-install-', dir=str(path.parent))
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


def metadata(value):
    return {'present': value is not None, **({key: value[key] for key in ('sha256', 'mode')} if value else {})}


def save_receipt(backup, receipt):
    atomic_write(backup / 'receipt.json', (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode(), 0o600)


def same_snapshot(left, right):
    return metadata(left) == metadata(right)


def rollback_owned(writes, before):
    blocked = []
    for name, digest in reversed(list(writes.items())):
        # If an unknown main now exists, keep its potentially required helper.
        if name == MODULE and MAIN_TARGET in blocked:
            blocked.append(MODULE)
            continue
        target = RUNTIME / name
        try:
            current = snapshot(target)
            if same_snapshot(current, before[name]):
                continue  # The write failed before replacement, or was already restored.
            if not current or current['sha256'] != digest:
                blocked.append(name)
                continue
            if before[name] is None:
                target.unlink()  # Only this install's still-identical new helper.
            else:
                atomic_write(target, before[name]['content'], before[name]['mode'])
                if not same_snapshot(snapshot(target), before[name]):
                    blocked.append(name)
        except (OSError, UnsafeInstall):
            blocked.append(name)
    return blocked


def install(source_sha256, module_sha256, apply=False, process_reader=active_customer_processes):
    desired, before = preflight(source_sha256, module_sha256, process_reader)
    ready = all(before[name] and before[name]['sha256'] == sha256(content)
                and before[name]['mode'] == 0o700 for name, content in desired.items())
    if not apply:
        return {'status': 'already_installed' if ready else 'check_ready', 'changed': False,
                'targets': {name: sha256(content) for name, content in desired.items()}}
    with deployment_locks():
        # A launch after this inventory still uses the known coordinator: it
        # fails its nonblocking run lock before it can write business/status data.
        locked_desired, locked_before = preflight(source_sha256, module_sha256, process_reader)
        if locked_desired != desired or any(not same_snapshot(before[name], locked_before[name]) for name in desired):
            raise UnsafeInstall('runtime_changed_before_install')
        if ready:
            return {'status': 'already_installed', 'changed': False,
                    'targets': {name: sha256(content) for name, content in desired.items()}}
        backup = Path(tempfile.mkdtemp(prefix='mgj-customer-backlog-backup-', dir=str(BACKUP_PARENT)))
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
                if not same_snapshot(snapshot(RUNTIME / name), before[name]):
                    raise UnsafeInstall('runtime_changed_during_install:' + name)
                writes[name] = sha256(content)  # Track even a replace-followed-by-I/O failure.
                atomic_write(RUNTIME / name, content, 0o700)
                installed = snapshot(RUNTIME / name, required=True)
                if installed['sha256'] != writes[name] or installed['mode'] != 0o700:
                    raise UnsafeInstall('runtime_readback_failed:' + name)
            receipt['status'] = 'installed'
            save_receipt(backup, receipt)
        except Exception:
            blocked = rollback_owned(writes, before)
            receipt['status'] = 'rollback_blocked' if blocked else 'rolled_back'
            receipt['rollback_blocked'] = blocked
            try:
                save_receipt(backup, receipt)
            except OSError:
                pass  # Private original bytes already exist; never broaden rollback.
            if blocked:
                raise UnsafeInstall('install_failed_manual_code_recovery_required') from None
            raise UnsafeInstall('install_failed_rolled_back') from None
        return {'status': 'installed', 'changed': True, 'backup': str(backup),
                'targets': receipt['target']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='read-only preflight; no files or locks created')
    mode.add_argument('--install', action='store_true', help='explicit customer-only runtime replacement')
    parser.add_argument('--source-sha256', required=True, type=digest_argument)
    parser.add_argument('--module-sha256', required=True, type=digest_argument)
    args = parser.parse_args(argv)
    try:
        result = install(args.source_sha256, args.module_sha256, apply=args.install)
    except (UnsafeInstall, OSError) as exc:
        # Fixed safe codes only, never source bytes, ps output or exception payloads.
        code = str(exc) if isinstance(exc, UnsafeInstall) else type(exc).__name__
        print(json.dumps({'status': 'refused', 'code': code}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
