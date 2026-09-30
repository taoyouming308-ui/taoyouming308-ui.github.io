#!/usr/bin/env python3
"""Install isolated business-detail live/history cron slots, preserve others.

Existing cron lines and normal booking/customer/consumption runtime files are
not modified. Default mode is read-only; --install is explicit.
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = Path.home() / '.hermes/scripts'
FILES = (
    'mgj_employee_identity.py', 'audit_mgj_daily_report_source.py',
    'sync_mgj_daily_electronic_sources.py', 'mgj_business_detail.py',
    'sync_mgj_business_details.py', 'run_mgj_business_detail_2026.py',
)
MARKER = '# MGJ business-detail 2026 staggered read-only source sync'
CRON = (
    '2,17,32,47 9-21 * * * /usr/bin/python3 {runner} --mode live --shop 1009951 >> {log} 2>&1',
    '7,22,37,52 9-21 * * * /usr/bin/python3 {runner} --mode live --shop 1837032 >> {log} 2>&1',
    '*/5 0-8,22-23 * * * /usr/bin/python3 {runner} --mode history >> {log} 2>&1',
    '12,27,42,57 9-21 * * * /usr/bin/python3 {runner} --mode history >> {log} 2>&1',
)
PREVIOUS_CRON = CRON[:3]
LEGACY_CRON = (
    '17 * * * * /usr/bin/python3 {runner} --shop 1009951 >> {log} 2>&1',
    '47 * * * * /usr/bin/python3 {runner} --shop 1837032 >> {log} 2>&1',
)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cron_candidate(existing, runner, log):
    if MARKER in existing or 'run_mgj_business_detail_2026.py' in existing:
        lines = [line for line in existing.splitlines() if 'run_mgj_business_detail_2026.py' in line]
        wanted = [line.format(runner=runner, log=log) for line in CRON]
        if lines == wanted and MARKER in existing:
            return existing, False
        new_block = '\n'.join([MARKER] + wanted) + '\n'
        for old in (LEGACY_CRON, PREVIOUS_CRON):
            legacy = [line.format(runner=runner, log=log) for line in old]
            old_block = '\n'.join([MARKER] + legacy) + '\n'
            if lines == legacy and existing.count(MARKER) == 1 and existing.count(old_block) == 1:
                return existing.replace(old_block, new_block, 1), True
        raise ValueError('existing_business_cron_conflict')
    addition = '\n'.join([MARKER] + [line.format(runner=runner, log=log) for line in CRON])
    return existing.rstrip('\n') + '\n' + addition + '\n', True


def read_cron():
    result = subprocess.run(['crontab', '-l'], text=True, capture_output=True, check=False)
    if result.returncode == 0:
        return result.stdout
    if result.returncode == 1 and 'no crontab for' in result.stderr.lower():
        return ''
    raise RuntimeError('cron_read_failed')


def install():
    private = RUNTIME.parent
    runner = RUNTIME / 'run_mgj_business_detail_2026.py'
    log = private / 'mgj_business_detail_2026.log'
    existing = read_cron()
    candidate, changed = cron_candidate(existing, runner, log)
    prerequisites = ('mgj_private_customer.py', 'sync_mgj_daily_consumption.py')
    if any(not (RUNTIME / name).is_file() for name in prerequisites):
        raise RuntimeError('normal_sync_runtime_missing')
    if subprocess.run(['/usr/bin/python3', '-c', 'from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey'],
                      capture_output=True, check=False).returncode:
        raise RuntimeError('signing_runtime_unavailable')
    if not changed and all((RUNTIME / name).is_file() and sha256(ROOT / name) == sha256(RUNTIME / name) for name in FILES):
        return {'status': 'already_installed'}
    private.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='mgj-business-backup-', dir=private))
    os.chmod(backup, 0o700)
    for name in FILES:
        target = RUNTIME / name
        if target.exists():
            shutil.copy2(target, backup / name)
        pending = RUNTIME / (name + '.pending.' + str(os.getpid()))
        shutil.copy2(ROOT / name, pending)
        os.chmod(pending, 0o700)
        if sha256(pending) != sha256(ROOT / name):
            raise RuntimeError('runtime_hash_mismatch')
        os.replace(pending, target)
    if changed:
        backup_cron = backup / 'crontab.before'
        backup_cron.write_text(existing, encoding='utf-8')
        os.chmod(backup_cron, 0o600)
        result = subprocess.run(['crontab', '-'], input=candidate, text=True, capture_output=True, check=False)
        if result.returncode:
            raise RuntimeError('cron_install_failed')
        if read_cron() != candidate:
            raise RuntimeError('cron_verify_failed')
    return {'status': 'installed', 'backup': str(backup), 'cron_changed': changed,
            'runtime_verified_files': len(FILES)}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args(argv)
    if not args.install:
        print('dry_run: would verify six runtime files and replace only the known business-detail block with live 15-minute/history 5-minute slots; no changes')
        return 0
    try:
        result = install()
    except Exception as exc:
        print('install_failed: ' + type(exc).__name__ + ': ' + str(exc))
        return 2
    print(result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
