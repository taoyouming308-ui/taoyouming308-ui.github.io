import fs from 'node:fs';
import assert from 'node:assert/strict';
const migration=fs.readFileSync('supabase/migrations/20260906093809_salon_customer_request_ownership.sql','utf8');
for(const name of ['salon_customer_set_consent','salon_customer_create_review','salon_customer_request_booking','salon_customer_request_booking_cancel']){
 const start=migration.indexOf('create or replace function public.'+name+'(');
 assert.ok(start>=0,name);
 const source=migration.slice(start,migration.indexOf('end$$;',start));
 const signature=source.slice(source.indexOf('(')+1,source.indexOf(')\nreturns'));
 const guard=source.slice(source.indexOf('v_op:='),source.indexOf('if v_op.completed_at'));
 assert.match(guard,/salon_private.claim_customer_request/);
 for(const parameter of signature.split(',').map(s=>s.trim().split(' ')[0]).filter(p=>p!=='p_request_key'))
  assert.ok(guard.includes("'"+parameter+"',"+parameter),'missing fingerprint parameter '+parameter);
 assert.match(source,/security invoker/);assert.match(source,/set timezone='UTC'/);
 assert.doesNotMatch(source,/v_op:=salon_private.claim_request\(/);
}
assert.match(migration,/customer_payload_digest bytea/);
assert.match(migration,/sha256\(convert_to\(p_payload::text,'UTF8'\)\)/);
assert.match(migration,/for share of i,c,o,s/);
assert.match(migration,/where id=v_op.id for update/);
assert.match(migration,/from public,anon,authenticated/);
console.log('customer request contract passed: four guarded mutations, complete parameter fingerprints, permission and locking boundaries');
