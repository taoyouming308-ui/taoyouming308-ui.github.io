// Offline generator: prints apply_patch, never writes files or contacts sources.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {REPORT_PROJECT_ROUTES as routes} from '../supabase/functions/_shared/salon-report-catalog.mjs';
const file='supabase/migrations/20260930034900_zysyr_daily_project_routes_v5.sql';
const base=fs.readFileSync('supabase/migrations/20260928094856_zysyr_daily_autofill_cash_evidence_v3.sql','utf8');
let helper=base.slice(base.indexOf('create or replace function zysyr_daily_electronic_private.platform_item_routes'),base.indexOf('alter table public.zysyr_daily_autofill_events'));
const replace=(old,next)=>{assert(helper.includes(old));helper=helper.replace(old,next);};
replace("and jsonb_array_length(p_bill->'items')=1",`and (select count(*) from jsonb_array_elements(p_bill->'items')x where (x->>'amount_cents')::numeric>0)=1
   and not exists(select 1 from jsonb_array_elements(p_bill->'items')x
    where x->>'amount_cents' is null or (x->>'amount_cents')::numeric<0)`);
replace("and (p_bill->'items'->0->>'amount_cents')::numeric=(p_bill->>'source_posted_amount_cents')::numeric", "and (select sum((x->>'amount_cents')::numeric) from jsonb_array_elements(p_bill->'items')x)=(p_bill->>'source_posted_amount_cents')::numeric");
replace("or a->>'source_item_id' is distinct from (p_bill->'items'->0->>'source_item_id')",`or not exists(select 1 from jsonb_array_elements(p_bill->'items')x
      where x->>'source_item_id'=a->>'source_item_id'
       and ((x->>'amount_cents')::numeric>0 or (a->>'performance_cents')::numeric=0))`);
helper=helper.replace('-- PERFORMANCE only: one actual project, one verified platform payer, exact', '-- PERFORMANCE only: one positive project (zero-valued accessories allowed),')
 .replace('-- cash closure and explicit cash-only allocation components for every row.', '-- one verified platform payer, exact closure and cash-only allocations.');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const catalog=`create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 else (select category from(values
 ${routes.map(r=>'('+r.map(q).join(',')+')').join(',\n ')}
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;`;
const v4=fs.readFileSync('supabase/migrations/20260928141730_zysyr_daily_cash_candidate_v4.sql','utf8');
const writer=v4.slice(v4.indexOf('create or replace function public.mgj_autofill_daily_sheet'),v4.indexOf('create function zysyr_daily_electronic_private.cash_source_autofill_trigger'))
 .replaceAll("'frontdesk-autofill-v4'","'frontdesk-autofill-v5'");
assert(writer.includes('confirmed_preserved')&&writer.includes('period_locked')&&writer.includes('before_snapshot'));
const result=`-- Exact observed project route + zero-value accessory evidence; drafts only.
-- No source rewrites, public grants, payment inference or automatic posting.
set statement_timeout='30s';
set lock_timeout='5s';

${helper.trimEnd()}

${catalog}

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5'));

${writer.trimEnd()}
`;
if(process.argv.includes('--check')){
 assert.equal(fs.readFileSync(file,'utf8'),result,'v5 migration differs from reviewed generator');
 console.log('v5 matches exact catalog and scoped writer');
}else{
 assert.equal(fs.readFileSync(file,'utf8').trim(),'','only initialize an empty migration');
 console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}
