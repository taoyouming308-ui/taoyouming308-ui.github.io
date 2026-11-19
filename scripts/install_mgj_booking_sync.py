#!/usr/bin/env python3
"""Install one canonical appointment task; preserve unrelated jobs and data."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path('/Users/a1/.hermes/scripts')
LABEL = 'com.hermes.booking-sync'
JOBS = Path('/Users/a1/.hermes/cron/jobs.json')
CONSUMPTION_PLIST = Path('/Users/a1/Library/LaunchAgents/com.hermes.daily-consumption-sync.plist')
PLIST = Path('/Users/a1/Library/LaunchAgents') / (LABEL + '.plist')
KNOWN = {
    'sync_mgj_bookings.py': '62827e359b693cb9c605b779574e97577a7c6aba231a4abece1d503558c359ce',
    'sync_bookings_wrapper.sh': '5fd413949d842f3a90281646a9fb7b8afccdef0036a27b51cf6a037a13633df0',
    'sync_bookings_v2.py': '6e761d06f98ddf9b3f5a02a34c65908ef048ba1fb05d77485301dd34dc9ace55',
}

def desired_files():
    shim = b'#!/usr/bin/env python3\nimport runpy\nfrom pathlib import Path\nrunpy.run_path(str(Path(__file__).with_name("sync_mgj_bookings.py")), run_name="__main__")\n'
    return {
        'mgj_booking_source.py': (ROOT/'scripts/mgj_booking_source.py').read_bytes(),
        'sync_mgj_bookings.py': (ROOT/'scripts/sync_mgj_bookings.py').read_bytes(),
        'sync_bookings_wrapper.sh': (ROOT/'scripts/sync_mgj_bookings.sh').read_bytes(),
        'sync_bookings_v2.py': shim,
    }

def plist_bytes():
    return plistlib.dumps({
        'Label': LABEL,
        'ProgramArguments': ['/usr/bin/python3', str(RUNTIME/'sync_mgj_bookings.py'), '--scheduled'],
        'WorkingDirectory': str(RUNTIME),
        'EnvironmentVariables': {'HOME': '/Users/a1', 'PYTHONDONTWRITEBYTECODE': '1'},
        'StartInterval': 60,
        'RunAtLoad': True,
        'StandardOutPath': '/Users/a1/.hermes/logs/booking-sync.log',
        'StandardErrorPath': '/Users/a1/.hermes/logs/booking-sync.error.log',
    })

def atomic_write(path, content, mode):
    fd, temporary = tempfile.mkstemp(prefix='.booking-install-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def preflight(files, plist):
    if os.getuid()!=501 or os.geteuid()!=501:
        raise RuntimeError('unexpected_user')
    jobs = json.loads(JOBS.read_text())['jobs']
    if any(j.get('enabled') and j.get('script') in ('sync_bookings_wrapper.sh','sync_mgj_bookings.py','sync_bookings_v2.py') for j in jobs):
        raise RuntimeError('existing_hermes_booking_scheduler')
    cron = subprocess.run(['crontab','-l'],capture_output=True,text=True)
    if cron.returncode not in (0,1):
        raise RuntimeError('crontab_unavailable')
    if cron.returncode==1 and 'no crontab' not in cron.stderr:
        raise RuntimeError('crontab_unavailable')
    if any('booking' in line.lower() for line in cron.stdout.splitlines() if line.strip() and not line.lstrip().startswith('#')):
        raise RuntimeError('existing_os_booking_scheduler')
    for name, content in files.items():
        path = RUNTIME/name
        if path.is_symlink():
            raise RuntimeError('symlink_runtime')
        if path.exists() and path.read_bytes()!=content and hashlib.sha256(path.read_bytes()).hexdigest()!=KNOWN.get(name):
            raise RuntimeError('unknown_runtime_preimage:'+name)
    if PLIST.exists() and PLIST.read_bytes()!=plist:
        raise RuntimeError('unknown_launchd_preimage')
    if not CONSUMPTION_PLIST.exists():
        raise RuntimeError('independent_consumption_task_missing')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--install',action='store_true')
    args=parser.parse_args()
    files, plist = desired_files(), plist_bytes()
    preflight(files,plist)
    if not args.install:
        print('Preflight passed; four runtime files and one launchd task; no data/state reset.')
        return
    lock=open('/tmp/sync_mgj_bookings.lock','a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        preflight(files,plist)
        backup=Path(tempfile.mkdtemp(prefix='mgj-booking-v2-backup-',dir=RUNTIME.parent))
        os.chmod(backup,0o700)
        for name in files:
            if (RUNTIME/name).exists():
                shutil.copy2(RUNTIME/name,backup/name)
        if PLIST.exists(): shutil.copy2(PLIST,backup/PLIST.name)
        for name, content in files.items():
            atomic_write(RUNTIME/name,content,0o700)
            assert (RUNTIME/name).read_bytes()==content
        atomic_write(PLIST,plist,0o600)
        print('Recoverable runtime backup:',backup)
    finally:
        fcntl.flock(lock,fcntl.LOCK_UN)
        lock.close()
    domain='gui/501/'+LABEL
    loaded=subprocess.run(['launchctl','print',domain],capture_output=True)
    subprocess.run(['launchctl','enable',domain],check=True)
    if loaded.returncode:
        subprocess.run(['launchctl','bootstrap','gui/501',str(PLIST)],check=True)
    print('Installed canonical runtime and enabled',domain)

if __name__=='__main__':
    main()
