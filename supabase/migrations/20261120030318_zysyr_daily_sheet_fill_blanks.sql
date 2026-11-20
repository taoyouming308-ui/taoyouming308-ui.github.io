-- The scheduled writer and explicit button use the same verified source projection.
-- The button writes only known numbers into empty fields of one revision-checked draft.
set statement_timeout='30s';
set lock_timeout='5s';
create function zysyr_daily_electronic_private.apply_daily_autofill(
 p_shop text,p_day date,p_draft_id uuid,p_expected_revision integer,p_actor_user_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 earned_card numeric; source jsonb; cash_projection jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
 conflicts jsonb; before_data jsonb; after_data jsonb; cell jsonb; result jsonb; n integer:=0; is_new boolean:=false;
 fill_blanks boolean:=p_draft_id is not null;
 filled integer:=0;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'AUTOFILL_SERVICE_REQUIRED'; end if;
 store:=case p_shop when '自由手艺人' then 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid
   when '向里造型' then '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid end;
 if store is null or p_day is null or p_day<date '2026-01-01' or p_day>date '2026-12-31'
  or p_day>(now() at time zone 'Asia/Shanghai')::date then raise exception 'AUTOFILL_SCOPE_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('daily_autofill:'||store||':'||p_day,0));
 if zysyr_private.period_is_locked(company,store,p_day) then return jsonb_build_object('status','period_locked','automatic_posting_enabled',false); end if;
 if exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
   and d.report_date=p_day and d.status='confirmed') then return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false); end if;
 source:=public.mgj_read_business_details(p_shop,p_day);
 if source->'available' is distinct from 'true'::jsonb or source->'source_list_changed' is distinct from 'false'::jsonb
 then return jsonb_build_object('status','source_unavailable_or_changed','automatic_posting_enabled',false); end if;
 sid:=(source->>'snapshot_id')::uuid;
 cash_projection:=zysyr_daily_electronic_private.cash_receipt_projection(company,store,p_day);
 if (select count(*) from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft')>1 then return jsonb_build_object('status','multiple_drafts_preserved','automatic_posting_enabled',false); end if;
 select * into draft from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft' for update;
 -- Recheck after waiting on an existing row lock: finance may have confirmed it.
 if exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
   and d.report_date=p_day and d.status='confirmed') then return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false); end if;
 -- A user action must target the exact open draft and revision.
 if fill_blanks then
  if draft.id is distinct from p_draft_id or draft.edit_revision is distinct from p_expected_revision then
   return jsonb_build_object('status','draft_changed','automatic_posting_enabled',false);
  end if;
  if zysyr_private.period_is_locked(company,store,p_day) then
   return jsonb_build_object('status','period_locked','automatic_posting_enabled',false);
  end if;
  if exists(select 1 from public.zysyr_daily_reports r where r.company_id=company and r.store_id=store
   and r.report_date=p_day and r.status in('submitted','approved')) then
   return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false);
  end if;
 end if;
 -- Only the user action can reuse a completely empty manual template.
 -- Legacy numeric or renamed rows must keep their original coordinate system.
 if draft.id is not null and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2')
  and (not fill_blanks or draft.ocr_model <> 'manual-entry-v1'
   or exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
    and (c.manual_override or c.ocr_numeric is not null or c.corrected_numeric is not null
     or nullif(btrim(c.ocr_text),'') is not null or nullif(btrim(c.manual_text),'') is not null
     or c.row_label_source_method='manual'))) then
  return jsonb_build_object('status','manual_draft_preserved','draft_id',draft.id,'needs_finance_review',true,'automatic_posting_enabled',false);
 end if;
 -- Source-head triggers cannot silently upgrade an existing old mapping.
 if pg_trigger_depth()>0 and draft.id is not null
  and (select e.mapping_version from public.zysyr_daily_autofill_events e
       where e.draft_id=draft.id order by e.revision desc limit 1) is distinct from 'frontdesk-autofill-v10'
 then return jsonb_build_object('status','mapping_upgrade_requires_review','draft_id',draft.id,
  'automatic_posting_enabled',false,'formal_ledger_amount_changed',false); end if;
 if not fill_blanks and sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v10'
  and draft.ocr_raw_result#>'{autofill,cash_receipts}' is not distinct from cash_projection->'metadata'
 then return jsonb_build_object('status','already_applied','draft_id',draft.id,'automatic_posting_enabled',false); end if;
 cells:=zysyr_daily_electronic_private.autofill_cells(source);
 -- One writer, one immutable before/after event. Replacement by exact cell key
 -- avoids two projections double-counting project payment channels.
 if cash_projection->'available'='true'::jsonb then
  select coalesce(jsonb_agg(x),'[]'::jsonb) into cells from jsonb_array_elements(cells)x
   where not exists(select 1 from jsonb_array_elements(cash_projection->'cells')c
    where c->>'section_code'=x->>'section_code' and c->>'row_key'=x->>'row_key' and c->>'column_code'=x->>'column_code');
  cells:=cells||(cash_projection->'cells');
 end if;
 -- Daily performance totals include EARNED stylist card performance, not raw cardfee.
 -- External receipts / cash_flow remain unchanged for the monthly income path.
 earned_card:=zysyr_daily_electronic_private.earned_card_total(source);
 select coalesce(jsonb_agg(case when x->>'section_code'='summary' and x->>'column_code' in('actual_total','grand_total')
   or x->>'section_code'='payment' and x->>'column_code'='total'
  then jsonb_set(x,'{value}',coalesce(to_jsonb((x->>'value')::numeric+earned_card),'null'::jsonb)) else x end),'[]'::jsonb)
 into cells from jsonb_array_elements(cells)x;
 cells:=cells||jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','row_label','支付',
  'column_code','card_consumption','column_label','卡金消费','row_number',33,'column_number',11,
  'cell_role','payment_card_consumption','value',earned_card));
 if jsonb_array_length(cells)>1000 or exists(select 1 from jsonb_array_elements(cells)x
  where (x->>'row_number')::int>120 or length(x->>'row_label')>120)
 then return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false); end if;
 if fill_blanks then
  -- Keep existing source numbers tied to the evidence displayed alongside them.
  -- When they disagree, the entire operation waits for source reconciliation.
  if exists(select 1 from public.zysyr_daily_sheet_cells c
   left join jsonb_array_elements(cells)x on x->>'section_code'=c.section_code
    and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code
   where c.draft_id=draft.id and not c.manual_override and c.ocr_numeric is not null
    and (c.source_method='frontdesk_autofill' or x is not null)
    and (x->>'value')::numeric is distinct from c.ocr_numeric) then
   return jsonb_build_object('status','source_conflict','draft_id',draft.id,'automatic_posting_enabled',false);
  end if;
  select count(*) into filled from jsonb_array_elements(cells)x where x->>'value' is not null
   and not exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
    and c.section_code=x->>'section_code' and c.row_key=x->>'row_key' and c.column_code=x->>'column_code'
    and (c.manual_override or c.ocr_numeric is not null or c.corrected_numeric is not null
     or nullif(btrim(c.ocr_text),'') is not null or nullif(btrim(c.manual_text),'') is not null));
  if filled=0 then
   return jsonb_build_object('status','no_fillable_blanks','draft_id',draft.id,'automatic_posting_enabled',false);
  end if;
  -- The detail route rejects reports at its 1000-row read boundary.
  if (select count(*) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id)
    + (select count(*) from jsonb_array_elements(cells)x
       where not exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
        and c.section_code=x->>'section_code' and c.row_key=x->>'row_key' and c.column_code=x->>'column_code')) >= 1000 then
   return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false);
  end if;
 end if;
 select coalesce(jsonb_agg(distinct g),'[]'::jsonb) into gaps from jsonb_array_elements(source->'bills')b
  cross join lateral jsonb_array_elements(b->'gaps')g;
 gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);
 if earned_card is null then gaps:=gaps||'["earned_card_performance_unknown"]'::jsonb; end if;
 gaps:=gaps||'["financial_review_required","full_business_totals_not_filled","new_old_customer_counts_unknown"]'::jsonb;
 if exists(select 1 from jsonb_array_elements(cells)x where x->>'cell_role'='staff_value'
  and x->>'column_code' in('dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment')
  and x->>'value' is null) then gaps:=gaps||'["project_or_platform_assignment_unresolved"]'::jsonb; end if;
 if draft.id is null then
  insert into public.zysyr_daily_sheet_drafts(company_id,store_id,report_date,source_voucher_id,source_sha256,
   ocr_provider,ocr_model,ocr_raw_result,created_by_user_id,updated_by_user_id)
  values(company,store,p_day,null,null,'frontdesk-autofill','frontdesk-autofill-v2','{}',null,null) returning * into draft;
  is_new:=true;
 end if;
 before_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id),'created',is_new);
 if fill_blanks then
  before_data:=before_data||jsonb_build_object('triggered_by_user_id',p_actor_user_id);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',c.id,'source_value',(x->>'value')::numeric)),'[]') into conflicts
 from public.zysyr_daily_sheet_cells c join jsonb_array_elements(cells)x
 on x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code
 where c.draft_id=draft.id and c.manual_override and c.corrected_numeric is distinct from (x->>'value')::numeric;
 if jsonb_array_length(conflicts)>0 then gaps:=gaps||'["manual_source_conflict"]'::jsonb; end if;
 -- Retain the scheduler's original cleanup behavior. Button writes only blanks.
 if not fill_blanks and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then
  update public.zysyr_daily_sheet_cells c set ocr_numeric=null,corrected_numeric=null,
   ocr_text=null,manual_text=null,manual_override=false,updated_at=now(),updated_by_user_id=null
  where c.draft_id=draft.id and not c.manual_override and c.section_code in('stylist','technician')
   and c.cell_role not in('signature','unclosed_order','note');
 end if;
 for cell in select value from jsonb_array_elements(cells) loop
  insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,
   column_code,column_label,row_number,column_number,cell_role,ocr_text,ocr_numeric,source_method,updated_by_user_id)
  values(company,store,draft.id,cell->>'section_code',cell->>'row_key',cell->>'row_label',cell->>'column_code',cell->>'column_label',
   (cell->>'row_number')::int,(cell->>'column_number')::int,cell->>'cell_role',cell->>'value',(cell->>'value')::numeric,'frontdesk_autofill',p_actor_user_id)
  on conflict(company_id,draft_id,section_code,row_key,column_code) do update
   set column_label=excluded.column_label,row_number=excluded.row_number,
    column_number=excluded.column_number,ocr_text=excluded.ocr_text,ocr_numeric=excluded.ocr_numeric,
    source_method='frontdesk_autofill',manual_override=false,corrected_numeric=null,manual_text=null,
    updated_by_user_id=p_actor_user_id,updated_at=now()
   where not public.zysyr_daily_sheet_cells.manual_override
    and (not fill_blanks or (
     excluded.ocr_numeric is not null
     and public.zysyr_daily_sheet_cells.ocr_numeric is null
     and public.zysyr_daily_sheet_cells.corrected_numeric is null
     and nullif(btrim(public.zysyr_daily_sheet_cells.ocr_text),'') is null
     and nullif(btrim(public.zysyr_daily_sheet_cells.manual_text),'') is null));
  if found then n:=n+1; end if;
 end loop;
 -- Retire superseded machine values, but preserve every human edit.
 -- Unsupported payment/retail fields and text notes are outside the projection.
 update public.zysyr_daily_sheet_cells c set ocr_numeric=null,ocr_text=null,corrected_numeric=null,
  manual_override=false,manual_text=null,updated_at=now(),updated_by_user_id=null
 where not fill_blanks and c.draft_id=draft.id and not c.manual_override and c.source_method='frontdesk_autofill'
  and not exists(select 1 from jsonb_array_elements(cells)x where x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code);
 update public.zysyr_daily_sheet_drafts d set ocr_model='frontdesk-autofill-v2',template_code='zysyr_frontdesk_project_draft',
  ocr_raw_result=d.ocr_raw_result||jsonb_build_object('autofill',jsonb_build_object('snapshot_id',sid,
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v10','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'daily_total_policy','cash-plus-earned-card-v1',
   'manual_conflicts',conflicts,'recognition_policy','compare_only',
   'classification_issues',zysyr_daily_electronic_private.project_classification_issues(source),
   'known_absence_display','blank','cash_receipts',cash_projection->'metadata',
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct k),'[]'::jsonb) from (
    select x->>'row_key' k from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')
    union select c.row_key from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
     and c.section_code in('stylist','technician')
     and (c.manual_override or (fill_blanks and (
      c.row_label_source_method='manual' or c.ocr_numeric is not null or c.corrected_numeric is not null
      or nullif(btrim(c.ocr_text),'') is not null or nullif(btrim(c.manual_text),'') is not null
      or (draft.ocr_raw_result#>'{autofill,active_staff_row_keys}') ? c.row_key
     )))) preserved_rows))),
  edit_revision=d.edit_revision+1,updated_by_user_id=p_actor_user_id,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 -- Same-source replays use this receipt after the explicit mode has verified
 -- matching stored source numbers and applied every eligible known blank.
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v10',draft.edit_revision,before_data,after_data,gaps);
 result:=jsonb_build_object('status','draft_filled','draft_id',draft.id,'snapshot_id',sid,'revision',draft.edit_revision,
  'cell_count',n,'filled_value_count',case when fill_blanks then filled else
   (select count(*) from jsonb_array_elements(cells)x where x->>'value' is not null) end,
  'needs_finance_review',true,'automatic_posting_enabled',false,'formal_ledger_amount_changed',false);
 insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
 values(p_shop,p_day,sid,result) on conflict(shop_name,business_date) do update
  set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
 return result;
end $$;
revoke all on function zysyr_daily_electronic_private.apply_daily_autofill(text,date,uuid,integer,uuid)
 from public,anon,authenticated,service_role;

-- Preserve the existing scheduler and source-head trigger entry point.
create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language sql security definer set search_path='' as $$
 select zysyr_daily_electronic_private.apply_daily_autofill(p_shop,p_day,null,null,null)
$$;
revoke all on function public.mgj_autofill_daily_sheet(text,date) from public,anon,authenticated;
grant execute on function public.mgj_autofill_daily_sheet(text,date) to service_role;

create function public.zysyr_fill_daily_sheet_blanks(
 p_company_id uuid,p_store_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_day date,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 shop text;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='AUTOFILL_SERVICE_REQUIRED';
 end if;
 if p_draft_id is null or p_actor_user_id is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception using errcode='22023',message='AUTOFILL_SCOPE_INVALID';
 end if;
 perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
 if p_company_id='02463a53-dfdb-4291-b04d-dd1d85f9d998'::uuid then
  shop:=case p_store_id
   when 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid then '自由手艺人'
   when '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid then '向里造型'
  end;
 end if;
 if shop is null then
  return jsonb_build_object('status','store_not_connected','automatic_posting_enabled',false);
 end if;
 if p_day is null or p_day<date '2026-01-01' or p_day>date '2026-12-31'
  or p_day>(now() at time zone 'Asia/Shanghai')::date then
  return jsonb_build_object('status','date_not_supported','automatic_posting_enabled',false);
 end if;
 return zysyr_daily_electronic_private.apply_daily_autofill(shop,p_day,p_draft_id,p_expected_revision,p_actor_user_id);
end
$$;
revoke all on function public.zysyr_fill_daily_sheet_blanks(uuid,uuid,uuid,uuid,date,integer) from public,anon,authenticated;
grant execute on function public.zysyr_fill_daily_sheet_blanks(uuid,uuid,uuid,uuid,date,integer) to service_role;
