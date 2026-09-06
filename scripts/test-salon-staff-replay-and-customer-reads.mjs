import fs from 'node:fs';
import assert from 'node:assert/strict';
const migration=fs.readFileSync('supabase/migrations/20260906094322_salon_staff_replay_and_customer_reads.sql','utf8');
for(const name of ['salon_bind_customer_identity','salon_create_work','salon_submit_work','salon_review_work','salon_moderate_review','salon_create_campaign','salon_set_campaign_status','salon_review_customer_booking']){
 const start=migration.indexOf('create or replace function public.'+name+'(');
 assert.ok(start>=0,name);
 const source=migration.slice(start,migration.indexOf('end$$;',start));
 const signature=source.slice(source.indexOf('(')+1,source.indexOf(')\nreturns'));
 const guard=source.slice(source.indexOf('v_op:='),source.indexOf('if v_op.completed_at'));
 assert.match(guard,/salon_private.claim_staff_request/);
 for(const p of signature.split(',').map(s=>s.trim().split(' ')[0]).filter(p=>p!=='p_request_key'))
  assert.ok(guard.includes("'"+p+"',"+p),'missing parameter '+p);
 assert.ok(source.indexOf('assert_staff_permission')<source.indexOf('if v_op.completed_at'));
 assert.match(source,/security invoker/);assert.match(source,/set timezone='UTC'/);
}
for(const name of ['salon_customer_list_public_works','salon_customer_list_bookings','salon_customer_list_booking_options']){
 const start=migration.indexOf('create or replace function public.'+name+'(');
 assert.ok(start>=0);
 const source=migration.slice(start,migration.indexOf('end$$;',start));
 assert.match(source,/perform salon_private.assert_customer_read_scope/);
}
assert.match(migration,/join public.salon_organizations o on o.id=i.organization_id and o.status='active'/);
assert.doesNotMatch(migration,/as \$begin/);
console.log('staff replay/read contracts passed: 8 full-payload guarded employee mutations and 4 customer read entries');
