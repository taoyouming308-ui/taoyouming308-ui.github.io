// Deterministic increment: preserve the v8 writer, totals, locks and manual protection.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {REPORT_PROJECT_ROUTES,APPROVED_ACID_CARE_PATTERN} from '../supabase/functions/_shared/salon-report-catalog.mjs';
const file='supabase/migrations/20261001124358_zysyr_daily_project_completeness_v9.sql';
const prior=fs.readFileSync('supabase/migrations/20260930104817_zysyr_daily_earned_card_v8.sql','utf8');
const replace=(s,a,b)=>{assert(s.includes(a),'missing '+a);return s.replace(a,()=>b)};
const q=s=>"'"+s.replaceAll("'","''")+"'";
// Single shared catalog; released historical builders keep their frozen routes.
const catalog=`create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 when p_shop in('1837032','1009951') and p_name ~ ${q(APPROVED_ACID_CARE_PATTERN)} then 'treatment'
 else (select category from(values
 ${REPORT_PROJECT_ROUTES.map(r=>'('+r.map(q).join(',')+')').join(',\n ')}
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;
`;
const helper=`-- One explanation per unresolved source allocation; never invent a destination/amount.
create or replace function zysyr_daily_electronic_private.project_classification_issues(p_source jsonb)
returns jsonb language sql immutable set search_path='' as $$
with bills as (
 select b,zysyr_daily_electronic_private.platform_item_routes(b) routes
 from jsonb_array_elements(p_source->'bills') b
), lines as (
 select b->>'source_bill_id' bill_id,a->>'source_allocation_id' allocation_id,
  'stylist_e'||(a->>'employee_id')||'_'||substr(md5(a->>'source_role'),1,8) row_key,
  a->>'employee_name' employee_name,i->>'item_code' project_code,i->>'item_name' project_name,
  (a->>'performance_cents')::numeric/100 amount,
  case when a->>'performance_cents' is null then 'amount_unknown'
   when routes->>(i->>'source_item_id')='project'
    and zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name') is not null then null
   when routes->>(i->>'source_item_id') in('dianping_group','douyin') then null
   when routes->>(i->>'source_item_id')='project' then 'project_unmapped'
   else 'platform_unresolved' end reason
 from bills cross join lateral jsonb_array_elements(b->'employee_allocations') a
 left join lateral (select x i from jsonb_array_elements(b->'items')x where x->>'source_item_id'=a->>'source_item_id') item on true
 where a->>'source_role' ~ '设计师|发型师'
)
select coalesce(jsonb_agg(to_jsonb(lines) order by row_key,bill_id,allocation_id),'[]'::jsonb)
from lines where reason is not null and amount is distinct from 0
$$;
revoke all on function zysyr_daily_electronic_private.project_classification_issues(jsonb) from public,anon,authenticated,service_role;
`;
let writer=prior.slice(prior.indexOf('create or replace function public.mgj_autofill_daily_sheet'),prior.indexOf('create or replace function zysyr_private.daily_sheet_validation('));
writer=writer.replaceAll("'frontdesk-autofill-v8'","'frontdesk-autofill-v9'");
writer=replace(writer,"'manual_conflicts',conflicts,'recognition_policy','compare_only',","'manual_conflicts',conflicts,'recognition_policy','compare_only',\n   'classification_issues',zysyr_daily_electronic_private.project_classification_issues(source),");
const result=`-- Verified project coverage and explicit unresolved-allocation explanations.
-- No historical updates, total formula changes, public grants or automatic posting.
set statement_timeout='30s';
set lock_timeout='5s';
${catalog.trimEnd()}
${helper}
alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in(${Array.from({length:9},(_,i)=>`'frontdesk-autofill-v${i+1}'`).join(',')}));
${writer.trimEnd()}
`;
if(process.argv.includes('--check')){assert.equal(fs.readFileSync(file,'utf8'),result);console.log('v9 classification migration matches');}
else{const old=fs.readFileSync(file,'utf8');if(!process.argv.includes('--patch'))assert.equal(old.trim(),'');console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+(old.trim()?old.trimEnd().split('\n').map(l=>'-'+l).join('\n')+'\n':'')+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');}
