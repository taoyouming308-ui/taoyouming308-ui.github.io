#!/bin/sh
# Run after the SQL fixture. Scope stays valid; only write capability is revoked.
set -eu
container=${1:-zysyr-archive-isolated}
psql_test() { docker exec "$container" psql -U postgres -At -v ON_ERROR_STOP=1 -c "$1"; }
psql_test "create or replace function zysyr_private.assert_daily_entry_scope(uuid,uuid,uuid) returns void language plpgsql as \$\$begin if \$3<>'00000000-0000-0000-0000-000000000003'::uuid then raise exception 'SCOPE'; end if; end\$\$; update public.synthetic_authority set enabled=true;" >/dev/null
request=00000000-0000-0000-0000-000000000077
out=$(mktemp -d)
psql_test "begin; select pg_advisory_xact_lock(hashtextextended('$request',0)); select pg_sleep(3); update public.synthetic_authority set enabled=false; commit;" >"$out/lock" &
locker=$!
sleep 1
if psql_test "select public.test_archive('reserve','$request')" >"$out/result" 2>"$out/error"; then
 echo 'FAIL: revoked capability was accepted'; exit 1
fi
wait "$locker"
grep -q ARCHIVE_SCOPE_FORBIDDEN "$out/error"
[ "$(psql_test "select count(*) from public.zysyr_daily_original_reservations where request_id='$request'")" = 0 ]
echo 'Post-lock revocation denied; no reservation written; scope helper remained valid.'
