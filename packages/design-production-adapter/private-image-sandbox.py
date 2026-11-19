"""Private image worker launcher. Standard library only; never reads image files or network."""
import os
import resource
import sys

try:
    executable, mode = sys.argv[1:3]
    if not os.path.isabs(executable) or mode not in ("strict", "synthetic-macos"):
        raise ValueError()
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    try:
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    except (ValueError, OSError):
        if mode != "synthetic-macos" or sys.platform != "darwin":
            sys.stderr.write("IMAGE_ADDRESS_SPACE_LIMIT_UNAVAILABLE\n")
            sys.exit(78)
        # Test-only fallback, never represented as a production memory sandbox.
    os.execv(executable, [executable] + sys.argv[3:])
except Exception:
    sys.stderr.write("IMAGE_WORKER_LAUNCH_REJECTED\n")
    sys.exit(78)
