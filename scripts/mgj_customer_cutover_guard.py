"""Offline-tested rollout guard primitive only; no installer or scheduler mutation."""
from contextlib import contextmanager
import fcntl
class UnsafeCutover(RuntimeError):pass
LOCK_ROOT = "/tmp"
LOCK_NAMES = ("mgj_customer_coordinator.lock", "sync_mgj_all.lock", "sync_mgj_bookings.lock", "mgj_daily_consumption.lock")

@contextmanager
def quiescent_cutover(launchers_paused, old_processes):
    import os
    paths = [os.path.join(LOCK_ROOT, name) for name in LOCK_NAMES]
    if len(paths) != 4 or len(set(paths)) != 4: raise UnsafeCutover("invalid_lock_inventory")
    if not launchers_paused(): raise UnsafeCutover('launchers_not_paused')
    handles=[]
    try:
        for path in paths:
            handle=open(path,'a'); handles.append(handle)
            try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise UnsafeCutover('inflight_lock') from None
        if old_processes(): raise UnsafeCutover('old_processes_present')
        if not launchers_paused(): raise UnsafeCutover('pause_receipt_changed')
        yield
    finally:
        for handle in reversed(handles): handle.close()
