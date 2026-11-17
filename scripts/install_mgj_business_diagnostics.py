#!/usr/bin/env python3
"""Install only reviewed detail diagnostic files; no scheduler/data changes."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

FILES = {
 'mgj_business_detail.py': '2bc47eda9661238782c4b5cd00e917c05c56410af0ac60b5aa7062947547fe02',
 'run_mgj_business_detail_2026.py': '79283270bb3b5a239bd723730b9a89839095275f1d871721d386f57e11e6ef60',
 'sync_mgj_business_details.py': '7632909e38e09b5107e81a591c7cc4a2dfb105b1f500f238d768193598f9d0b2',
}
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def install(source=None, runtime=None, lock_paths=None, apply=False):
    source = source or Path(__file__).resolve().parent
    runtime = runtime or Path.home()/'.hermes/scripts'
    lock_paths = lock_paths or (Path.home()/'.hermes/mgj_business_detail_2026.lock',Path('/tmp/mgj_daily_consumption.lock'))
    handles=[]
    try:
        for path in lock_paths:
            handle=path.open('a'); handles.append(handle)
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        wanted={name:digest(source/name) for name in FILES}
        actual={name:digest(runtime/name) for name in FILES}
        if any(actual[name] not in (FILES[name],wanted[name]) for name in FILES):
            raise ValueError('unknown_runtime_preimage')
        if actual==wanted: return {'status':'already_installed'}
        if not apply: return {'status':'ready','files':len(FILES)}
        backup=Path(tempfile.mkdtemp(prefix='business-diagnostics-backup-',dir=runtime.parent))
        for name in FILES: shutil.copy2(runtime/name,backup/name)
        try:
            for name in FILES:
                pending=runtime/(name+'.pending.'+str(os.getpid()))
                shutil.copy2(source/name,pending);os.chmod(pending,0o700)
                if digest(pending)!=wanted[name]: raise ValueError('copy_verification_failed')
                os.replace(pending,runtime/name)
            if any(digest(runtime/name)!=wanted[name] for name in FILES): raise ValueError('deployment_verification_failed')
        except Exception:
            failures=[]
            for name in FILES:
                try:
                    recovery=runtime/(name+'.recovery.'+str(os.getpid()))
                    shutil.copy2(backup/name,recovery)
                    if digest(recovery)!=actual[name]: raise ValueError('recovery_copy_failed')
                    os.replace(recovery,runtime/name)
                except Exception:
                    failures.append(name)
            if failures: raise RuntimeError('deployment_and_recovery_failed') from None
            raise
        return {'status':'installed','verified_files':len(FILES),'backup':str(backup)}
    finally:
        for handle in reversed(handles): handle.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--install',action='store_true')
    args=parser.parse_args();print(json.dumps(install(apply=args.install)))
