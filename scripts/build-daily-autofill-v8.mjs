// Deterministic offline migration builder; output must be applied with apply_patch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='supabase/migrations/20260930104817_zysyr_daily_earned_card_v8.sql';
const v7=fs.readFileSync('supabase/migrations/20260930045230_zysyr_daily_source_protection_v7.sql','utf8');
const v4=fs.readFileSync('supabase/migrations/20260928141730_zysyr_daily_cash_candidate_v4.sql','utf8');
const replace=(s,a,b)=>{assert(s.includes(a),'missing '+a);return s.replace(a,b)};
const policy='cash-plus-earned-card-v1';
let catalog=v7.slice(v7.indexOf('create or replace function zysyr_daily_electronic_private.report_project_category'),v7.indexOf('create or replace function zysyr_daily_electronic_private.autofill_cells'));
catalog=replace(catalog,"('1009951','523','歌薇酸护（盖白发）880','treatment')","('1009951','523','歌薇酸护（盖白发）880','treatment'),\n ('1009951','513','歌薇酸护880','treatment')");
const helper=`create or replace function zysyr_daily_electronic_private.earned_card_total(p_source jsonb)
returns numeric language sql immutable set search_path='' as $$
 with a as(select x from jsonb_array_elements(p_source->'bills') b
 cross join lateral jsonb_array_elements(b->'employee_allocations') x
 where x->>'source_role' ~ '设计师|发型师')
 select case when count(*)=0 then 0
 when count(x->>'source_allocation_id')=count(*) and count(distinct x->>'source_allocation_id')=count(*)
 and count(x->>'card_performance_cents')=count(*) and count(x->>'cash_performance_cents')=count(*)
 and count(x->>'other_performance_cents')=count(*) and count(x->>'performance_cents')=count(*)
 and bool_and((x->>'card_performance_cents')::numeric>=0 and (x->>'cash_performance_cents')::numeric>=0
 and (x->>'other_performance_cents')::numeric>=0
 and (x->>'performance_cents')::numeric=(x->>'card_performance_cents')::numeric+(x->>'cash_performance_cents')::numeric+(x->>'other_performance_cents')::numeric)
 then sum((x->>'card_performance_cents')::numeric)/100 end from a
$$;
revoke all on function zysyr_daily_electronic_private.earned_card_total(jsonb) from public,anon,authenticated,service_role;
`;
let writer=v7.slice(v7.indexOf('create or replace function public.mgj_autofill_daily_sheet'),v7.indexOf('create or replace function zysyr_private.daily_sheet_has_sync'));
writer=writer.replaceAll("'frontdesk-autofill-v7'","'frontdesk-autofill-v8'");
writer=replace(writer,' source jsonb; cash_projection jsonb;', ' earned_card numeric; source jsonb; cash_projection jsonb;');
writer=replace(writer,' if jsonb_array_length(cells)>1000',` -- Daily performance totals include EARNED stylist card performance, not raw cardfee.
 -- External receipts / cash_flow remain unchanged for the monthly income path.
 earned_card:=zysyr_daily_electronic_private.earned_card_total(source);
 select coalesce(jsonb_agg(case when x->>'section_code'='summary' and x->>'column_code' in('actual_total','grand_total')
   or x->>'section_code'='payment' and x->>'column_code'='total'
  then jsonb_set(x,'{value}',coalesce(to_jsonb((x->>'value')::numeric+earned_card),'null'::jsonb)) else x end),'[]'::jsonb)
 into cells from jsonb_array_elements(cells)x;
 cells:=cells||jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','row_label','支付',
  'column_code','card_consumption','column_label','卡金消费','row_number',33,'column_number',11,
  'cell_role','payment_card_consumption','value',earned_card));
 if jsonb_array_length(cells)>1000`);
writer=replace(writer," gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);", " gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);\n if earned_card is null then gaps:=gaps||'[\"earned_card_performance_unknown\"]'::jsonb; end if;");
writer=replace(writer,"'source_scope','project_consumption','automatic_posting_enabled',false,",`'source_scope','project_consumption','automatic_posting_enabled',false,
   'daily_total_policy','${policy}',`);
let validation=v4.slice(v4.indexOf('create or replace function zysyr_private.daily_sheet_validation'));
validation=replace(validation,'  v_cash_mode boolean:=false;', '  v_earned_mode boolean:=false; v_cash_mode boolean:=false;');
validation=replace(validation,'  if v_cash_mode then',`  select coalesce(d.ocr_raw_result#>>'{autofill,daily_total_policy}'='${policy}',false) into v_earned_mode
  from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id;
  if v_cash_mode then`);
validation=replace(validation,"  if v_actual is null then",`  if v_earned_mode and v_card_consumption is null then v_missing_controls:=array_append(v_missing_controls,'实际获得卡金业绩'); end if;
  if v_actual is null then`);
// Missing card evidence must not silently become zero in the new policy.
validation=replace(validation,'select coalesce(zysyr_private.daily_sheet_cell_value(cell), 0) into v_card_consumption', 'select case when v_earned_mode then zysyr_private.daily_sheet_cell_value(cell) else coalesce(zysyr_private.daily_sheet_cell_value(cell),0) end into v_card_consumption');
validation=replace(validation,'abs(v_actual-v_cashflow)<=0.01', 'abs(v_actual-v_cashflow-(case when v_earned_mode then v_card_consumption else 0 end))<=0.01');
validation=replace(validation,"'cash_policy',case",`'daily_total_policy',case when v_earned_mode then '${policy}' else null end,
    'cash_policy',case`);
const result=`-- Daily totals include earned stylist card performance; monthly cash_flow unchanged.
-- Candidate only. No posted rows modified, permissions widened, or manual edits overwritten.
set statement_timeout='30s';
set lock_timeout='5s';
${catalog.trimEnd()}
${helper}
alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in(${Array.from({length:8},(_,i)=>`'frontdesk-autofill-v${i+1}'`).join(',')}));
${writer.trimEnd()}
${validation.trimEnd()}
`;
if(process.argv.includes('--check')){assert.equal(fs.readFileSync(file,'utf8'),result);console.log('v8 earned-card migration matches');}
else{assert.equal(fs.readFileSync(file,'utf8').trim(),'');console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');}
