import fs from 'node:fs';
import assert from 'node:assert/strict';
const sql=fs.readFileSync('supabase/migrations/20260906120718_salon_time_context_transactions.sql','utf8');
for(const [outer,inner] of [['salon_reschedule_booking_with_time','salon_reschedule_booking'],['salon_customer_reschedule_with_time','salon_customer_request_reschedule'],['salon_review_reschedule_with_time','salon_review_reschedule_request']]){
 const fn=sql.match(new RegExp(`create function public\\.${outer}\\(([\\s\\S]*?)end\\$\\$;`))[0];
 const params=fn.match(/\((.*?)\) returns/)[1].split(',').map(x=>x.split(' ')[0]);
 const guard=fn.match(/perform salon_private\.claim_time_context\([\s\S]*?\);/)[0];
 for(const p of params.filter(x=>x!=='p_request_key'))assert.ok(guard.includes(`'${p}',${p}`),outer+'.'+p);
 assert.ok(fn.indexOf('claim_time_context')<fn.indexOf(`v_response:=public.${inner}`));
 assert.ok(fn.indexOf(`v_response:=public.${inner}`)<fn.indexOf('set completed=true'));
 assert.match(fn,/assert_(staff_permission|customer_read_scope)/);
 assert.doesNotMatch(fn,/exception when/,'must not swallow business errors and persist a guard');
}
assert.match(sql,/status='active' for share/);assert.match(sql,/if not v_guard.completed and \(v_zone is distinct from p_zone or v_version is distinct from p_version\)/);
assert.match(sql,/new.timezone_version:=old.timezone_version\+case when new.timezone is distinct from old.timezone then 1 else 0 end/);
assert.match(sql,/force row level security/);
console.log('Time transaction contract passed: all arguments bound, wrapper lock before business, rollback propagation, version trigger and restricted access');
