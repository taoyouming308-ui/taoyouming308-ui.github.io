#!/bin/sh
# Isolated synthetic host evidence only; not image-worker or rootless acceptance.
set -eu
name="design-stage10-isolation-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
image=$(docker image inspect postgres:17 --format '{{.Id}}')
docker run --name "$name" --pull never --network none --read-only --user 65532:65532 --cap-drop ALL --security-opt no-new-privileges --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 16 --log-driver none --entrypoint /bin/sh "$image" -c '
set -eu
[ "$(id -u)" = 65532 ]
if touch /design-negative-write 2>/dev/null; then exit 11; fi
if cat /etc/shadow >/dev/null 2>&1; then exit 12; fi
[ "$(awk "/^CapEff:/{print \$2}" /proc/self/status)" = 0000000000000000 ]
[ "$(awk "/^NoNewPrivs:/{print \$2}" /proc/self/status)" = 1 ]
[ "$(cat /sys/fs/cgroup/memory.max)" = 134217728 ]
[ "$(cat /sys/fs/cgroup/pids.max)" = 16 ]
[ "$(cat /sys/fs/cgroup/cpu.max)" = "50000 100000" ]
[ "$(wc -l </proc/net/route | tr -d " ")" = 1 ]
echo "PASS nonroot, forbidden root write, shadow read denied, empty effective capabilities, no-new-privileges, bounded cgroup controls, no network route"
'

docker rm -f "$name" >/dev/null
if docker container inspect "$name" >/dev/null 2>&1; then echo "cleanup uncertain" >&2; exit 21; fi
trap - EXIT
echo "PASS named container removed; no production image decoder was tested"
