import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='20260906095003_salon_financial_request_replay.sql';
const migration=fs.readFileSync('supabase/migrations/'+file,'utf8');
const names=['salon_checkout_order','salon_move_inventory','salon_count_inventory','salon_open_member_account','salon_recharge_member_account','salon_set_member_status','salon_submit_refund_request','salon_review_refund_request','salon_execute_refund_request','salon_add_finance_entry','salon_generate_payroll','salon_review_payroll'];
const definitions=text=>[...text.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/g)];
const prior=new Map();
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f<file&&/_salon_.*\.sql$/.test(f)).sort())
 for(const m of definitions(fs.readFileSync('supabase/migrations/'+f,'utf8')))prior.set(m[1],m[0]);
const updated=new Map(definitions(migration).map(m=>[m[1],m[0]]));
assert.equal(updated.size,12);
for(const name of names){
 const source=updated.get(name);assert.ok(source,name);
 const params=source.match(/^create or replace function public\.\w+\(([\s\S]*?)\)\s*returns/)?.[1];assert.ok(params);
 const guard=source.match(/\w+:=salon_private\.claim_staff_request\([\s\S]*?\);/)?.[0];assert.ok(guard);
 for(const p of params.split(',').map(s=>s.trim().split(/\s+/)[0]).filter(p=>p!=='p_request_key'))
  assert.ok(guard.includes("'"+p+"',"+p),'missing full payload field '+name+'.'+p);
 // Verify all amount calculations, business rules and ledger mutations are unchanged.
 const old=prior.get(name);assert.ok(old);
 const oldClaim=old.match(/\w+:=salon_private\.claim_request\([\s\S]*?\);/)?.[0];assert.ok(oldClaim);
 assert.equal(source.replace(guard,()=>oldClaim),old,name+' changed beyond replay protection');
 assert.doesNotMatch(source,/security definer|as \$begin/);
}
console.log('financial replay contracts passed: 12 complete employee fingerprints; business calculations and ledger writes unchanged');
