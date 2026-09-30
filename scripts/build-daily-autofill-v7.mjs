// Deterministic, offline builder. Prints an apply_patch; never writes a database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {REPORT_PROJECT_ROUTES as routes} from '../supabase/functions/_shared/salon-report-catalog.mjs';
const file='supabase/migrations/20260930045230_zysyr_daily_source_protection_v7.sql';
const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const replace=(s,a,b)=>{assert(s.includes(a),'missing anchor: '+a);return s.replace(a,b)};
const catalog=`create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 else (select category from(values
 ${routes.map(r=>'('+r.map(q).join(',')+')').join(',\n ')}
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;`;
const v2=read('20260928084952_zysyr_daily_autofill_precise_v2.sql');
let projection=v2.slice(v2.indexOf('create or replace function zysyr_daily_electronic_private.autofill_cells'),v2.indexOf('alter table public.zysyr_daily_autofill_events'));
projection=replace(projection,'and u.stylist_category is null)','and u.stylist_category is null and u.performance is distinct from 0)');
// Known zero is not missing money. Unknown nonzero project counts remain review items.
projection=projection.replaceAll('and u.category is null)','and u.category is null and u.project_count is distinct from 0)');
const v6=read('20260930040928_zysyr_daily_bank_card_v6.sql');
let writer=v6.slice(v6.indexOf('create or replace function public.mgj_autofill_daily_sheet')).replaceAll("'frontdesk-autofill-v6'","'frontdesk-autofill-v7'");
writer=replace(writer,'before_data jsonb; after_data jsonb;','conflicts jsonb; before_data jsonb; after_data jsonb;');
writer=replace(writer,' if sid=(select',` -- Never convert a human-populated legacy grid into source rows silently.
 if draft.id is not null and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2')
  and exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override
   and c.section_code in('stylist','technician')) then
  return jsonb_build_object('status','manual_draft_preserved','draft_id',draft.id,'needs_finance_review',true,'automatic_posting_enabled',false);
 end if;
 if sid=(select`);
writer=replace(writer,' -- Authorized on 2026-09-28:',` select coalesce(jsonb_agg(jsonb_build_object('cell_id',c.id,'source_value',(x->>'value')::numeric)),'[]') into conflicts
 from public.zysyr_daily_sheet_cells c join jsonb_array_elements(cells)x
 on x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code
 where c.draft_id=draft.id and c.manual_override and c.corrected_numeric is distinct from (x->>'value')::numeric;
 if jsonb_array_length(conflicts)>0 then gaps:=gaps||'["manual_source_conflict"]'::jsonb; end if;
 -- User instruction 2026-09-30 supersedes the old blanket replacement consent.
 -- Authorized on 2026-09-28:`);
writer=replace(writer,"where c.draft_id=draft.id and c.section_code in('stylist','technician')","where c.draft_id=draft.id and not c.manual_override and c.section_code in('stylist','technician')");
writer=replace(writer,'set row_label=excluded.row_label,column_label=excluded.column_label','set column_label=excluded.column_label');
writer=replace(writer,'updated_by_user_id=null,updated_at=now();\n  if found',`updated_by_user_id=null,updated_at=now()
   where not public.zysyr_daily_sheet_cells.manual_override;
  if found`);
writer=replace(writer,' -- A superseded source value must not survive, even under a manual override.',' -- Retire superseded machine values, but preserve every human edit.');
writer=replace(writer,"where c.draft_id=draft.id and c.source_method='frontdesk_autofill'","where c.draft_id=draft.id and not c.manual_override and c.source_method='frontdesk_autofill'");
writer=replace(writer,"'known_absence_display','blank','cash_receipts'","'manual_conflicts',conflicts,'recognition_policy','compare_only',\n   'known_absence_display','blank','cash_receipts'");
writer=replace(writer,"'active_staff_row_keys',(select coalesce(jsonb_agg(distinct x->>'row_key'),'[]'::jsonb)\n    from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician'))",`'active_staff_row_keys',(select coalesce(jsonb_agg(distinct k),'[]'::jsonb) from (
    select x->>'row_key' k from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')
    union select c.row_key from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
     and c.manual_override and c.section_code in('stylist','technician')) preserved_rows)`);
const syncGuard=`create or replace function zysyr_private.daily_sheet_has_sync(p_draft uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft and
  (d.template_code='zysyr_frontdesk_project_draft' or d.ocr_provider='frontdesk-autofill' or d.ocr_raw_result ? 'autofill'))
 or exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=p_draft and c.source_method='frontdesk_autofill')
 or exists(select 1 from public.zysyr_daily_autofill_events e where e.draft_id=p_draft)
$$;
revoke all on function zysyr_private.daily_sheet_has_sync(uuid) from public,anon,authenticated,service_role;`;
const oldRecognition=read('20260912120743_daily_full_fidelity_recognition_jobs.sql');
let recognition=oldRecognition.slice(oldRecognition.indexOf('create or replace function public.zysyr_apply_daily_sheet_recognition_candidates'));
recognition=replace(recognition,'  v_revision integer;',"  v_compare boolean; v_diff jsonb:='[]'; v_current numeric; v_old_text text;\n  v_revision integer;");
recognition=replace(recognition,'  -- A new full-table pass',`  v_compare:=zysyr_private.daily_sheet_has_sync(p_draft_id);
  -- A new full-table pass`);
recognition=replace(recognition,'and not manual_override\n     and source_method','and not manual_override and not v_compare\n     and source_method');
recognition=replace(recognition,'    if v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else\n      update public.zysyr_daily_sheet_cells set ocr_numeric',`    if v_compare then
      v_current:=case when v_cell.manual_override then v_cell.corrected_numeric else v_cell.ocr_numeric end;
      if v_current is distinct from v_value then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'cell_id',v_cell.id,'name',v_cell.row_label,'column',v_cell.column_label,'current',v_current,'recognized',v_value,'confidence',v_confidence)); end if;
    elsif v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_numeric`);
recognition=replace(recognition,'    if v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else\n      update public.zysyr_daily_sheet_cells set ocr_text',`    if v_compare then
      v_old_text:=case when v_cell.manual_override then v_cell.manual_text else v_cell.ocr_text end;
      if v_old_text is distinct from v_text then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'cell_id',v_cell.id,'name',v_cell.row_label,'column',v_cell.column_label,'current',v_old_text,'recognized',v_text,'confidence',v_confidence)); end if;
    elsif v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_text`);
recognition=replace(recognition,'    if exists(select 1 from public.zysyr_daily_sheet_cell_changes',`    if v_compare then
      select min(row_label) into v_old_text from public.zysyr_daily_sheet_cells
       where draft_id=p_draft_id and company_id=p_company_id and store_id=p_store_id
       and section_code=v_item->>'section' and row_key=v_item->>'row_key';
      if v_old_text is null then raise exception 'DAILY_RECOGNITION_NAME_INVALID'; end if;
      if v_old_text is distinct from v_text then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'name',v_old_text,'column','姓名','current',v_old_text,'recognized',v_text,'confidence',v_confidence)); end if;
    elsif exists(select 1 from public.zysyr_daily_sheet_cell_changes`);
recognition=replace(recognition,'  v_revision:=v_draft.edit_revision+1;',`  if v_compare then
    insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'daily_recognition_comparison_saved',
     jsonb_build_object('revision',v_draft.edit_revision),jsonb_build_object('revision',v_draft.edit_revision,'voucher_id',p_voucher_id,
      'model',btrim(p_model),'comparison_only',true,'differences',v_diff),'同步日报原图只读对照；没有写入表格','financial');
    return jsonb_build_object('draft_id',p_draft_id,'revision',v_draft.edit_revision,'saved_cells',0,'saved_text_cells',0,'saved_row_names',0,
     'comparison_only',true,'differences',v_diff,'difference_count',jsonb_array_length(v_diff),'formal_data_unchanged',true);
  end if;
  v_revision:=v_draft.edit_revision+1;`);
let expand=read('20260921033000_daily_recognition_adaptive_staff_rows.sql');
expand=replace(expand,'  for v_section, v_target in',`  if zysyr_private.daily_sheet_has_sync(p_draft_id) then
    return jsonb_build_object('draft_id',p_draft_id,'revision',v_draft.edit_revision,'added_rows',0,'comparison_only',true);
  end if;
  for v_section, v_target in`);
const result=`-- v7: confirmed care route, source/recognition separation, human edits preserved.
-- No source/posted data changes. Original source and immutable before/after audit retained.
set statement_timeout='30s';
set lock_timeout='5s';

${catalog}

${projection.trimEnd()}

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6','frontdesk-autofill-v7'));

${writer.trimEnd()}

${syncGuard}

${recognition.trimEnd()}

${expand.trimEnd()}
`;
if(process.argv.includes('--check')){assert.equal(fs.readFileSync(file,'utf8'),result);console.log('v7 migration matches source protection builder');}
else{assert.equal(fs.readFileSync(file,'utf8').trim(),'');console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');}
