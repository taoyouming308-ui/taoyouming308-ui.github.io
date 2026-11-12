#!/bin/sh
# Run after daily-original-archive.sql in the disposable container only.
set -eu
container=${1:-zysyr-archive-isolated}
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'update public.synthetic_authority set enabled=true' >/dev/null
request=00000000-0000-0000-0000-000000000099
out=$(mktemp -d)
for n in 1 2; do
 docker exec "$container" psql -U postgres -At -v ON_ERROR_STOP=1 -c "select public.test_archive('reserve','$request')->>'newly_reserved'" >"$out/$n" &
done
wait
[ "$(cat "$out/1" "$out/2" | grep -c '^true$')" = 1 ]
[ "$(cat "$out/1" "$out/2" | grep -c '^false$')" = 1 ]
echo 'Concurrent reserve: exactly one winner; retry status only.'
