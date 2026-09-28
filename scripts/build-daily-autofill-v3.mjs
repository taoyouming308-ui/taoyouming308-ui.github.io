// Offline only: stdout apply_patch or verify; never writes files or databases.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='supabase/migrations/20260928094856_zysyr_daily_autofill_cash_evidence_v3.sql';
const base=fs.readFileSync('supabase/migrations/20260928084952_zysyr_daily_autofill_precise_v2.sql','utf8');
let helper=base.slice(base.indexOf('create function zysyr_daily_electronic_private.platform_item_routes'),base.indexOf('create function zysyr_daily_electronic_private.report_project_category'));
helper=helper.replace('create function','create or replace function')
 .replace('complete boolean; ids text[]','complete boolean; performance_route_verified boolean; ids text[]')
 .replace('if not coalesce(complete,false) or platform_count<>1 then','if platform_count<>1 then');
const anchor=' if platform_code is null then return routes; end if;';
assert(helper.includes(anchor));
helper=helper.replace(anchor,anchor+`
 -- Missing noncash totals stay missing. This exception classifies EMPLOYEE
 -- PERFORMANCE only: one actual project, one verified platform payer, exact
 -- cash closure and explicit cash-only allocation components for every row.
 -- It never fills card/credit totals with zero or marks the bill/report complete.
 performance_route_verified:=coalesce(complete,false);
 if not performance_route_verified then
  performance_route_verified:=positive_count=1
   and jsonb_array_length(p_bill->'items')=1
   and jsonb_array_length(p_bill->'employee_allocations')>0
   and (p_bill->'items'->0->>'amount_cents')::numeric=(p_bill->>'source_posted_amount_cents')::numeric
   and pay_sum=(p_bill->>'source_posted_amount_cents')::numeric
   and not exists(select 1 from jsonb_array_elements(p_bill->'payments')x
    where (x->>'amount_cents')::numeric<0 or (x->>'amount_cents' is null
     and (x->>'source_field' is null or x->>'source_field' not in('cardfee','presentfee','treatfee','treatpresentfee','dividefee','offlineCreditPay','onlineCreditPay'))))
   and not exists(select 1 from jsonb_array_elements(p_bill->'employee_allocations')a
    where a->>'performance_cents' is null or (a->>'performance_cents')::numeric<0
     or (a->>'cash_performance_cents')::numeric is distinct from (a->>'performance_cents')::numeric
     or (a->>'card_performance_cents')::numeric is distinct from 0
     or (a->>'other_performance_cents')::numeric is distinct from 0
     or a->>'source_item_id' is distinct from (p_bill->'items'->0->>'source_item_id'));
 end if;
 if not coalesce(performance_route_verified,false) then return routes; end if;
`);
let writer=base.slice(base.indexOf('create or replace function public.mgj_autofill_daily_sheet'));
const oldGuard="and draft.ocr_model='frontdesk-autofill-v2'";
assert(writer.includes(oldGuard));
writer=writer.replace(oldGuard,oldGuard+" and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v3'");
writer=writer.replace('"platform_performance_mapping_pending",','')
 .replace("'mapping_version','frontdesk-autofill-v2'","'mapping_version','frontdesk-autofill-v3'")
 .replace("values(company,store,draft.id,sid,'frontdesk-autofill-v2',","values(company,store,draft.id,sid,'frontdesk-autofill-v3',");
// Keep the v2 paper-format marker and renderer compatibility. Mapping and audit
// revisions identify v3; it is not a new OCR engine or a new financial format.
assert(writer.includes("set ocr_model='frontdesk-autofill-v2'"));
const result=`-- Candidate-only performance evidence fix. Original payment gaps remain.
-- No posted data, public permissions, MGJ writes or automatic posting changes.
set statement_timeout='30s';
set lock_timeout='5s';

${helper.trimEnd()}

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3'));

${writer.trimEnd()}
`;
if(process.argv.includes('--check')){
 assert.equal(fs.readFileSync(file,'utf8'),result,'v3 migration differs from reviewed generator');
 console.log('v3 matches reviewed cash-only performance evidence and scoped writer');
}else{
 assert.equal(fs.readFileSync(file,'utf8').trim(),'','only initialize a new empty migration');
 console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}
