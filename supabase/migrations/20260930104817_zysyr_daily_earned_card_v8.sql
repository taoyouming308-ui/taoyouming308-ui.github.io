-- Daily totals include earned stylist card performance; monthly cash_flow unchanged.
-- Candidate only. No posted rows modified, permissions widened, or manual edits overwritten.
set statement_timeout='30s';
set lock_timeout='5s';
create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 else (select category from(values
 ('1837032','101','洗吹98元','makeup_styling'),
 ('1837032','103','洗发15分钟','wash_cut_blow'),
 ('1837032','104','洗发15分钟内','wash_cut_blow'),
 ('1837032','201','剪发120','wash_cut_blow'),
 ('1837032','202','剪发180','wash_cut_blow'),
 ('1837032','203','剪发280','wash_cut_blow'),
 ('1837032','205','剪发79','wash_cut_blow'),
 ('1837032','311','烫刘海400','perm'),
 ('1837032','323','质感烫发699','perm'),
 ('1837032','324','健康烫发980','perm'),
 ('1837032','427','褪色','color'),
 ('1837032','439','健康染699','color'),
 ('1009951','101','洗吹98元','makeup_styling'),
 ('1009951','103','洗发15分钟','wash_cut_blow'),
 ('1009951','104','洗发15分钟内','wash_cut_blow'),
 ('1009951','201','剪发120','wash_cut_blow'),
 ('1009951','202','剪发180','wash_cut_blow'),
 ('1009951','203','剪发280','wash_cut_blow'),
 ('1009951','204','剪发380','wash_cut_blow'),
 ('1009951','308','烫发1780','perm'),
 ('1009951','316','烫发980','perm'),
 ('1009951','417','基础染中发','color'),
 ('1009951','434','基础染长发1060','color'),
 ('1009951','501','护理400','treatment'),
 ('1009951','512','歌薇酸护680','treatment'),
 ('1837032','511','歌薇酸护480','treatment'),
 ('1009951','307','烫发1380','perm'),
 ('1009951','410','健康染中发','color'),
 ('1009951','411','健康染长发','color'),
 ('1009951','416','基础染短发','color'),
 ('1009951','523','歌薇酸护（盖白发）880','treatment'),
 ('1009951','513','歌薇酸护880','treatment')
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;
create or replace function zysyr_daily_electronic_private.earned_card_total(p_source jsonb)
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

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6','frontdesk-autofill-v7','frontdesk-autofill-v8'));
create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 earned_card numeric; source jsonb; cash_projection jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
 conflicts jsonb; before_data jsonb; after_data jsonb; cell jsonb; result jsonb; n integer:=0; is_new boolean:=false;
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
 -- Never convert a human-populated legacy grid into source rows silently.
 if draft.id is not null and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2')
  and exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override
   and c.section_code in('stylist','technician')) then
  return jsonb_build_object('status','manual_draft_preserved','draft_id',draft.id,'needs_finance_review',true,'automatic_posting_enabled',false);
 end if;
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v8'
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
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',c.id,'source_value',(x->>'value')::numeric)),'[]') into conflicts
 from public.zysyr_daily_sheet_cells c join jsonb_array_elements(cells)x
 on x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code
 where c.draft_id=draft.id and c.manual_override and c.corrected_numeric is distinct from (x->>'value')::numeric;
 if jsonb_array_length(conflicts)>0 then gaps:=gaps||'["manual_source_conflict"]'::jsonb; end if;
 -- User instruction 2026-09-30 supersedes the old blanket replacement consent.
 -- Authorized on 2026-09-28: update unposted drafts, including manual/image
 -- drafts. Keep cell IDs, change-history FKs, vouchers and attachments intact.
 -- Previous numeric staff candidates cannot be mixed with source employee rows.
 -- Exact pre-images remain in the immutable audit; never turn old money into counts.
 if draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then
  update public.zysyr_daily_sheet_cells c set ocr_numeric=null,corrected_numeric=null,
   ocr_text=null,manual_text=null,manual_override=false,updated_at=now(),updated_by_user_id=null
  where c.draft_id=draft.id and not c.manual_override and c.section_code in('stylist','technician')
   and c.cell_role not in('signature','unclosed_order','note');
 end if;
 for cell in select value from jsonb_array_elements(cells) loop
  insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,
   column_code,column_label,row_number,column_number,cell_role,ocr_text,ocr_numeric,source_method,updated_by_user_id)
  values(company,store,draft.id,cell->>'section_code',cell->>'row_key',cell->>'row_label',cell->>'column_code',cell->>'column_label',
   (cell->>'row_number')::int,(cell->>'column_number')::int,cell->>'cell_role',cell->>'value',(cell->>'value')::numeric,'frontdesk_autofill',null)
  on conflict(company_id,draft_id,section_code,row_key,column_code) do update
   set column_label=excluded.column_label,row_number=excluded.row_number,
    column_number=excluded.column_number,ocr_text=excluded.ocr_text,ocr_numeric=excluded.ocr_numeric,
    source_method='frontdesk_autofill',manual_override=false,corrected_numeric=null,manual_text=null,
    updated_by_user_id=null,updated_at=now()
   where not public.zysyr_daily_sheet_cells.manual_override;
  if found then n:=n+1; end if;
 end loop;
 -- Retire superseded machine values, but preserve every human edit.
 -- Unsupported payment/retail fields and text notes are outside the projection.
 update public.zysyr_daily_sheet_cells c set ocr_numeric=null,ocr_text=null,corrected_numeric=null,
  manual_override=false,manual_text=null,updated_at=now(),updated_by_user_id=null
 where c.draft_id=draft.id and not c.manual_override and c.source_method='frontdesk_autofill'
  and not exists(select 1 from jsonb_array_elements(cells)x where x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code);
 update public.zysyr_daily_sheet_drafts d set ocr_model='frontdesk-autofill-v2',template_code='zysyr_frontdesk_project_draft',
  ocr_raw_result=d.ocr_raw_result||jsonb_build_object('autofill',jsonb_build_object('snapshot_id',sid,
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v8','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'daily_total_policy','cash-plus-earned-card-v1',
   'manual_conflicts',conflicts,'recognition_policy','compare_only',
   'known_absence_display','blank','cash_receipts',cash_projection->'metadata',
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct k),'[]'::jsonb) from (
    select x->>'row_key' k from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')
    union select c.row_key from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
     and c.manual_override and c.section_code in('stylist','technician')) preserved_rows))),
  edit_revision=d.edit_revision+1,updated_by_user_id=null,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v8',draft.edit_revision,before_data,after_data,gaps);
 result:=jsonb_build_object('status','draft_filled','draft_id',draft.id,'snapshot_id',sid,'revision',draft.edit_revision,
  'cell_count',n,'filled_value_count',(select count(*) from jsonb_array_elements(cells)x where x->>'value' is not null),
  'needs_finance_review',true,'automatic_posting_enabled',false,'formal_ledger_amount_changed',false);
 insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
 values(p_shop,p_day,sid,result) on conflict(shop_name,business_date) do update
  set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
 return result;
end $$;
revoke all on function public.mgj_autofill_daily_sheet(text,date) from public,anon,authenticated;
grant execute on function public.mgj_autofill_daily_sheet(text,date) to service_role;
create or replace function zysyr_private.daily_sheet_validation(
  p_company_id uuid, p_store_id uuid, p_draft_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_atomic numeric := 0;
  v_staff_reported numeric := 0;
  v_category_reported numeric := 0;
  v_stylist_subtotal numeric;
  v_stylist_subtotal_count integer := 0;
  v_actual numeric;
  v_grand numeric;
  v_payment_methods numeric := 0;
  v_cashflow numeric;
  v_card_consumption numeric := 0;
  v_payment_total numeric;
  v_row_mismatches integer := 0;
  v_category_mismatches integer := 0;
  v_atomic_count integer := 0;
  v_missing_controls text[] := array[]::text[];
  v_valid boolean;
  v_earned_mode boolean:=false; v_cash_mode boolean:=false; v_card_sales numeric; v_cash_metadata jsonb; v_cash_source_current boolean:=false;
begin
  if not exists (select 1 from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id) then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;

  select draft.ocr_raw_result#>'{autofill,cash_receipts}' into v_cash_metadata
  from public.zysyr_daily_sheet_drafts draft where draft.company_id=p_company_id and draft.store_id=p_store_id and draft.id=p_draft_id;
  v_cash_mode:=coalesce(v_cash_metadata->>'policy'='operating-external-cash-v1' and v_cash_metadata->>'state'='candidate',false);
  select coalesce(d.ocr_raw_result#>>'{autofill,daily_total_policy}'='cash-plus-earned-card-v1',false) into v_earned_mode
  from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id;
  if v_cash_mode then
    select zysyr_private.daily_sheet_cell_value(cell) into v_card_sales
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id
      and cell.section_code='summary' and cell.row_key='summary' and cell.column_code='card_subtotal';
    v_cash_source_current:=exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id and d.status='confirmed')
      or v_cash_metadata is not distinct from (zysyr_daily_electronic_private.cash_receipt_projection(p_company_id,p_store_id,
        (select report_date from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id and store_id=p_store_id))->'metadata');
  end if;

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0),
    count(*) filter (where zysyr_private.daily_sheet_cell_value(cell) is not null)
    into v_staff_atomic, v_atomic_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_value';

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_staff_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_total';

  select count(*) into v_row_mismatches from (
    select cell.row_key,
      coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_value'), 0) as atomic_total,
      max(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_total') as reported_total
    from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.section_code = 'stylist'
    group by cell.row_key
  ) row_control
  where (row_control.atomic_total <> 0 or row_control.reported_total is not null)
    and (row_control.reported_total is null or abs(row_control.atomic_total - row_control.reported_total) > 0.01);

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_category_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'category_total';

  select count(*) into v_category_mismatches from (
    select category.column_code, coalesce(atomic.atomic_total, 0) as atomic_total,
      zysyr_private.daily_sheet_cell_value(category) as reported_total
    from public.zysyr_daily_sheet_cells category
    left join lateral (
      select sum(zysyr_private.daily_sheet_cell_value(cell)) as atomic_total
      from public.zysyr_daily_sheet_cells cell
      where cell.company_id = category.company_id and cell.store_id = category.store_id
        and cell.draft_id = category.draft_id and cell.cell_role = 'staff_value'
        and cell.column_code = category.column_code
    ) atomic on true
    where category.company_id = p_company_id and category.store_id = p_store_id
      and category.draft_id = p_draft_id and category.cell_role = 'category_total'
  ) category_control
  where (category_control.atomic_total <> 0 or category_control.reported_total is not null)
    and (category_control.reported_total is null or abs(category_control.atomic_total - category_control.reported_total) > 0.01);

  select max(zysyr_private.daily_sheet_cell_value(cell)), count(*)
    into v_stylist_subtotal, v_stylist_subtotal_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.section_code = 'stylist' and cell.row_key = 'stylist_category_total'
    and cell.column_code = 'subtotal' and cell.cell_role = 'summary_value';

  select zysyr_private.daily_sheet_cell_value(cell) into v_actual
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_actual' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_grand
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_grand' limit 1;
  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_payment_methods
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_method';
  select zysyr_private.daily_sheet_cell_value(cell) into v_cashflow
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_cashflow' limit 1;
  select case when v_earned_mode then zysyr_private.daily_sheet_cell_value(cell) else coalesce(zysyr_private.daily_sheet_cell_value(cell),0) end into v_card_consumption
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_card_consumption' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_payment_total
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_total' limit 1;

  if v_earned_mode and v_card_consumption is null then v_missing_controls:=array_append(v_missing_controls,'实际获得卡金业绩'); end if;
  if v_actual is null then v_missing_controls := array_append(v_missing_controls, '实做'); end if;
  if v_grand is null then v_missing_controls := array_append(v_missing_controls, '总计'); end if;
  if v_cashflow is null then v_missing_controls := array_append(v_missing_controls, '现金流'); end if;
  if v_payment_total is null then v_missing_controls := array_append(v_missing_controls, '支付总计'); end if;
  if v_atomic_count = 0 then v_missing_controls := array_append(v_missing_controls, '员工明细'); end if;
  if v_stylist_subtotal_count <> 1 or v_stylist_subtotal is null then
    v_missing_controls := array_append(v_missing_controls, '造型区总小计');
  end if;

  if v_cash_mode and v_card_sales is null then v_missing_controls:=array_append(v_missing_controls,'卡类新收款小计'); end if;
  if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb) then
    v_missing_controls:=array_append(v_missing_controls,'现金收款来源核对');
  end if;
  v_valid := cardinality(v_missing_controls) = 0
    and v_row_mismatches = 0 and v_category_mismatches = 0
    and v_staff_atomic > 0
    and abs(v_staff_atomic - v_staff_reported) <= 0.01
    and abs(v_staff_atomic - v_category_reported) <= 0.01
    and abs(v_staff_atomic - v_stylist_subtotal) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and (case when v_cash_mode then
      abs(v_actual-v_cashflow-(case when v_earned_mode then v_card_consumption else 0 end))<=0.01 and abs(v_actual+v_card_sales-v_grand)<=0.01
      and abs(v_grand-v_payment_total)<=0.01
    else abs(v_staff_atomic-v_actual)<=0.01 and abs(v_staff_atomic-v_grand)<=0.01
      and abs(v_cashflow+v_card_consumption-v_payment_total)<=0.01 and abs(v_staff_atomic-v_payment_total)<=0.01 end);

  return jsonb_build_object(
    'valid', v_valid,
    'staff_atomic_total', round(v_staff_atomic, 2),
    'staff_reported_total', round(v_staff_reported, 2),
    'category_reported_total', round(v_category_reported, 2),
    'stylist_subtotal', v_stylist_subtotal,
    'stylist_subtotal_mismatch', v_stylist_subtotal is null or abs(v_staff_atomic - v_stylist_subtotal) > 0.01,
    'actual_total', v_actual,
    'grand_total', v_grand,
    'payment_method_total', round(v_payment_methods, 2),
    'cashflow_total', v_cashflow,
    'card_consumption', round(v_card_consumption, 2),
    'payment_total', v_payment_total,
    'staff_row_mismatches', v_row_mismatches,
    'category_mismatches', v_category_mismatches,
    'missing_controls', to_jsonb(v_missing_controls),
    'tolerance', 0.01,
    'daily_total_policy',case when v_earned_mode then 'cash-plus-earned-card-v1' else null end,
    'cash_policy',case when v_cash_mode then 'operating-external-cash-v1' else null end,
    'income_source',case when v_cash_mode then 'operating_external_cash_receipts' else 'nonzero_stylist_atomic_cells_only' end
  );
end
$$;

revoke execute on function zysyr_private.daily_sheet_validation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
