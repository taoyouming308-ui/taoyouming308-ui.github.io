CREATE OR REPLACE FUNCTION zysyr_private.assert_daily_entry_scope(target_user_account_id uuid, target_company_id uuid, target_store_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not zysyr_private.account_has_capability(
    target_user_account_id, target_company_id, target_store_id, 'daily_report.write'
  ) then
    raise exception using errcode = '42501', message = 'DAILY_ENTRY_SCOPE_FORBIDDEN';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.assert_finance_scope(target_user_account_id uuid, target_company_id uuid, target_store_id uuid, target_capability_code text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not zysyr_private.account_is_finance_in_scope(
    target_user_account_id, target_company_id, target_store_id
  ) or not zysyr_private.account_has_capability(
    target_user_account_id, target_company_id, target_store_id, target_capability_code
  ) then
    raise exception using errcode = '42501', message = 'FINANCE_SCOPE_FORBIDDEN';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.zysyr_confirm_daily_sheet(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid, p_report jsonb, p_is_business_day boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_validation jsonb;
  v_lines jsonb;
  v_report_cells jsonb;
  v_report_data jsonb;
  v_report_id uuid;
  v_batch public.zysyr_import_batches;
  v_daily public.zysyr_daily_reports;
  v_approved public.zysyr_daily_reports;
  v_reconciliation public.zysyr_reconciliation_reports;
  v_version public.zysyr_daily_sheet_versions;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if jsonb_typeof(p_report) <> 'object' or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_CONFIRM_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_ALREADY_CONFIRMED'; end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_draft.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if exists(select 1 from public.zysyr_daily_reports report where report.company_id = p_company_id
    and report.store_id = p_store_id and report.report_date = v_draft.report_date
    and report.status in ('submitted', 'approved')) then
    raise exception using errcode = '55000', message = 'EXISTING_DAILY_REPORT_REQUIRES_REVERSAL';
  end if;
  v_validation := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, p_draft_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_CONTROL_MISMATCH', detail = v_validation::text;
  end if;

  select jsonb_agg(jsonb_build_object(
    'line_type', 'income',
    'metric_code', 'SERVICE_' || upper(cell.column_code),
    'description', cell.row_label || ' · ' || cell.column_label,
    'amount', zysyr_private.daily_sheet_cell_value(cell),
    'quantity', null
  ) order by cell.row_number, cell.column_number, cell.section_code, cell.row_key) into v_lines
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_value' and zysyr_private.daily_sheet_cell_value(cell) > 0;
  if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'DAILY_SHEET_ATOMIC_INCOME_REQUIRED'; end if;

  v_batch := public.zysyr_create_photo_import_batch(p_actor_user_id, p_company_id, p_store_id,
    v_draft.report_date, v_draft.source_voucher_id, v_lines, p_reason);
  if v_batch.status <> 'validated' then raise exception using errcode = '55000', message = 'DAILY_SHEET_IMPORT_CONFLICT'; end if;

  select jsonb_agg(jsonb_build_object(
    'sheet_name', '原图电子日报/' || cell.section_code,
    'cell_address', zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text,
    'row_number', cell.row_number,
    'column_number', cell.column_number,
    'cell_kind', 'input',
    'display_value', coalesce(zysyr_private.daily_sheet_cell_value(cell)::text, ''),
    'numeric_value', zysyr_private.daily_sheet_cell_value(cell),
    'formula', null,
    'precedent_addresses', '[]'::jsonb,
    'label', cell.section_code || ' / ' || cell.row_label || ' / ' || cell.column_label
  ) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id;

  p_report := p_report || jsonb_build_object(
    'company_id', p_company_id, 'store_id', p_store_id, 'report_type', 'daily',
    'report_date', v_draft.report_date, 'template_code', v_draft.template_code,
    'template_version', v_draft.template_version, 'uploaded_by_user_id', p_actor_user_id
  );
  v_report_data := public.zysyr_register_report_upload(p_report, v_report_cells);
  v_report_id := (v_report_data->>'id')::uuid;

  update public.zysyr_import_batches set source_report_id = v_report_id, status = 'importing'
    where id = v_batch.id and company_id = p_company_id and store_id = p_store_id;
  insert into public.zysyr_voucher_links(company_id, store_id, voucher_id, business_type,
    business_id, relation_type, linked_by_user_id)
  values(p_company_id, p_store_id, v_draft.source_voucher_id, 'report_upload', v_report_id,
    'source_document', p_actor_user_id)
  on conflict(company_id, voucher_id, business_type, business_id, relation_type)
    where unlinked_at is null do nothing;

  with atomic as (
    select row_number() over(order by cell.row_number, cell.column_number, cell.section_code, cell.row_key) as line_number,
      cell.section_code,
      zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text as cell_address
    from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.cell_role = 'staff_value' and zysyr_private.daily_sheet_cell_value(cell) > 0
  )
  update public.zysyr_import_rows import_row set source_report_cell_id = report_cell.id
  from atomic join public.zysyr_report_cells report_cell
    on report_cell.company_id = p_company_id and report_cell.store_id = p_store_id
    and report_cell.report_id = v_report_id
    and report_cell.sheet_name = '原图电子日报/' || atomic.section_code
    and report_cell.cell_address = atomic.cell_address
  where import_row.company_id = p_company_id and import_row.store_id = p_store_id
    and import_row.import_batch_id = v_batch.id and import_row.row_number = atomic.line_number;

  select jsonb_agg(import_row.mapped_json || jsonb_build_object('source_report_cell_id', import_row.source_report_cell_id)
    order by import_row.row_number) into v_lines
  from public.zysyr_import_rows import_row
  where import_row.company_id = p_company_id and import_row.store_id = p_store_id
    and import_row.import_batch_id = v_batch.id;
  if exists(select 1 from public.zysyr_import_rows import_row where import_row.import_batch_id = v_batch.id
    and import_row.source_report_cell_id is null) then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_SOURCE_CELL_MAPPING_FAILED';
  end if;

  v_daily := public.zysyr_save_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_report_id, p_is_business_day, v_lines, p_reason);
  v_reconciliation := public.zysyr_finalize_daily_import(p_actor_user_id, p_company_id,
    p_store_id, v_batch.id, v_daily.id);
  if v_reconciliation.status <> 'matched' then raise exception using errcode = '22023', message = 'DAILY_SHEET_RECONCILIATION_FAILED'; end if;
  v_approved := public.zysyr_review_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_daily.id, 'approved', p_reason);

  insert into public.zysyr_daily_sheet_versions(company_id, store_id, draft_id, version,
    source_voucher_id, source_report_id, import_batch_id, daily_report_id,
    validation_result, confirmed_snapshot, confirmed_by_user_id, reason)
  select p_company_id, p_store_id, p_draft_id, 1, v_draft.source_voucher_id, v_report_id,
    v_batch.id, v_daily.id, v_validation,
    jsonb_agg(jsonb_build_object(
      'cell_id', cell.id, 'section_code', cell.section_code, 'row_key', cell.row_key,
      'row_label', cell.row_label, 'column_code', cell.column_code, 'column_label', cell.column_label,
      'row_number', cell.row_number, 'column_number', cell.column_number, 'cell_role', cell.cell_role,
      'ocr_text', cell.ocr_text, 'ocr_numeric', cell.ocr_numeric,
      'confirmed_numeric', zysyr_private.daily_sheet_cell_value(cell), 'manual_override', cell.manual_override,
      'confidence', cell.confidence, 'bbox', cell.bbox, 'source_method', cell.source_method
    ) order by cell.row_number, cell.column_number), p_actor_user_id, btrim(p_reason)
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
  returning * into v_version;

  update public.zysyr_daily_sheet_drafts set status = 'confirmed', validation_result = v_validation,
    updated_by_user_id = p_actor_user_id, updated_at = now(), confirmed_by_user_id = p_actor_user_id,
    confirmed_at = v_version.confirmed_at, confirm_reason = btrim(p_reason) where id = p_draft_id;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', p_draft_id,
    'confirm', jsonb_build_object('status', 'draft', 'edit_revision', v_draft.edit_revision),
    jsonb_build_object('status', 'confirmed', 'version_id', v_version.id,
      'source_report_id', v_report_id, 'daily_report_id', v_daily.id,
      'import_batch_id', v_batch.id, 'validation', v_validation), btrim(p_reason), 'financial');
  return jsonb_build_object('draft_id', p_draft_id, 'version_id', v_version.id,
    'source_report_id', v_report_id, 'import_batch_id', v_batch.id,
    'daily_report_id', v_daily.id, 'daily_report_status', v_approved.status,
    'reconciliation', to_jsonb(v_reconciliation), 'validation', v_validation,
    'formal_source', 'confirmed_daily_sheet_atomic_cells', 'meiguanjia_used', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.zysyr_confirm_daily_sheet(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid, p_report jsonb, p_is_business_day boolean, p_reason text, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft public.zysyr_daily_sheet_drafts;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_EXPECTED_REVISION_REQUIRED';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_ALREADY_CONFIRMED'; end if;
  if v_draft.edit_revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'DAILY_SHEET_REVISION_CONFLICT',
      detail = json_build_object('expected_revision', p_expected_revision,
        'current_revision', v_draft.edit_revision)::text;
  end if;
  return public.zysyr_confirm_daily_sheet(
    p_actor_user_id, p_company_id, p_store_id, p_draft_id,
    p_report, p_is_business_day, p_reason
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.zysyr_create_photo_import_batch(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_report_date date, p_source_voucher_id uuid, p_rows jsonb, p_reason text)
 RETURNS zysyr_import_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_saved public.zysyr_import_batches; v_row jsonb; v_number integer:=0; v_errors jsonb; v_status text; v_existing uuid;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  if p_report_date is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='IMPORT_BATCH_INPUT_INVALID'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,p_report_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  if not exists(select 1 from public.zysyr_voucher_attachments voucher where voucher.company_id=p_company_id and voucher.store_id=p_store_id
    and voucher.id=p_source_voucher_id and voucher.audit_status='approved' and voucher.document_type='daily_report') then
    raise exception using errcode='P0002',message='APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  select report.id into v_existing from public.zysyr_daily_reports report where report.company_id=p_company_id and report.store_id=p_store_id
    and report.report_date=p_report_date and report.status in ('submitted','approved') order by report.version desc limit 1;
  insert into public.zysyr_import_batches(company_id,store_id,import_type,report_date,source_voucher_id,status,raw_row_count,payload_sha256,reason,created_by_user_id)
  values(p_company_id,p_store_id,'daily_photo',p_report_date,p_source_voucher_id,case when v_existing is null then 'validated' else 'conflict' end,
    jsonb_array_length(p_rows),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_rows::text,'UTF8')),'hex'),btrim(p_reason),p_actor_user_id) returning * into v_saved;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_number:=v_number+1; v_errors:='[]'::jsonb;
    if jsonb_typeof(v_row)<>'object' or coalesce(v_row->>'line_type','') not in ('income','expense','petty_cash','payment','note') then v_errors:=v_errors||'["line_type"]'::jsonb; end if;
    if coalesce(v_row->>'metric_code','')!~'^[A-Z][A-Z0-9_]{1,63}$' then v_errors:=v_errors||'["metric_code"]'::jsonb; end if;
    if nullif(btrim(v_row->>'description'),'') is null then v_errors:=v_errors||'["description"]'::jsonb; end if;
    if coalesce(v_row->>'line_type','')<>'note' and (v_row->>'amount' is null or (v_row->>'amount')::numeric<0) then v_errors:=v_errors||'["amount"]'::jsonb; end if;
    v_status:=case when jsonb_array_length(v_errors)=0 then 'valid' else 'invalid' end;
    insert into public.zysyr_import_rows(company_id,store_id,import_batch_id,row_number,raw_json,mapped_json,validation_status,validation_errors)
    values(p_company_id,p_store_id,v_saved.id,v_number,v_row,v_row,v_status,v_errors);
  end loop;
  update public.zysyr_import_batches set mapped_row_count=(select count(*) from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='valid')
    where id=v_saved.id returning * into v_saved;
  if exists(select 1 from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='invalid') then
    update public.zysyr_import_batches set status='conflict' where id=v_saved.id returning * into v_saved;
    insert into public.zysyr_import_conflicts(company_id,store_id,import_batch_id,conflict_type,details)
    values(p_company_id,p_store_id,v_saved.id,'row_validation',jsonb_build_object('invalid_rows',(select jsonb_agg(row.row_number) from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='invalid')));
  end if;
  if v_existing is not null then insert into public.zysyr_import_conflicts(company_id,store_id,import_batch_id,conflict_type,existing_entity_type,existing_entity_id,details)
    values(p_company_id,p_store_id,v_saved.id,'existing_daily_report','daily_report',v_existing,jsonb_build_object('rule','先冲销现有日报，再新建导入批次；系统不覆盖。')); end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'import','import_batch',v_saved.id,'validate',jsonb_build_object('status',v_saved.status,'row_count',v_saved.raw_row_count,'payload_sha256',v_saved.payload_sha256),btrim(p_reason),'financial');
  return v_saved;
end $function$;

CREATE OR REPLACE FUNCTION public.zysyr_finalize_daily_import(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_import_batch_id uuid, p_daily_report_id uuid)
 RETURNS zysyr_reconciliation_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_batch public.zysyr_import_batches; v_report public.zysyr_daily_reports; v_recon public.zysyr_reconciliation_reports;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_batch from public.zysyr_import_batches batch where batch.company_id=p_company_id and batch.store_id=p_store_id and batch.id=p_import_batch_id and batch.status='importing' for update;
  if not found then raise exception using errcode='55000',message='IMPORT_BATCH_NOT_IMPORTING'; end if;
  select * into v_report from public.zysyr_daily_reports report where report.company_id=p_company_id and report.store_id=p_store_id and report.id=p_daily_report_id and report.source_report_id=v_batch.source_report_id;
  if not found then raise exception using errcode='P0002',message='IMPORTED_DAILY_REPORT_NOT_FOUND'; end if;
  update public.zysyr_import_rows row set business_type='daily_report_line',business_id=line.id
  from public.zysyr_daily_report_lines line where row.import_batch_id=v_batch.id and line.daily_report_id=v_report.id and line.line_number=row.row_number;
  insert into public.zysyr_reconciliation_reports(company_id,store_id,import_batch_id,daily_report_id,status,source_row_count,business_row_count,source_amount,business_amount,delta,generated_by_user_id)
  select p_company_id,p_store_id,v_batch.id,v_report.id,
    case when count(row.id)=count(line.id) and coalesce(sum((row.mapped_json->>'amount')::numeric),0)=coalesce(sum(line.amount),0) then 'matched' else 'mismatch' end,
    count(row.id),count(line.id),coalesce(sum((row.mapped_json->>'amount')::numeric),0),coalesce(sum(line.amount),0),
    coalesce(sum(line.amount),0)-coalesce(sum((row.mapped_json->>'amount')::numeric),0),p_actor_user_id
  from public.zysyr_import_rows row left join public.zysyr_daily_report_lines line on line.company_id=p_company_id and line.daily_report_id=v_report.id and line.line_number=row.row_number
  where row.import_batch_id=v_batch.id returning * into v_recon;
  insert into public.zysyr_reconciliation_lines(company_id,store_id,reconciliation_report_id,import_row_id,business_type,business_id,source_amount,business_amount,delta,status,details)
  select p_company_id,p_store_id,v_recon.id,row.id,'daily_report_line',line.id,nullif(row.mapped_json->>'amount','')::numeric,line.amount,
    coalesce(line.amount,0)-coalesce(nullif(row.mapped_json->>'amount','')::numeric,0),case when line.id is null then 'missing' when line.amount is not distinct from nullif(row.mapped_json->>'amount','')::numeric then 'matched' else 'mismatch' end,
    jsonb_build_object('metric_code',row.mapped_json->>'metric_code','row_number',row.row_number)
  from public.zysyr_import_rows row left join public.zysyr_daily_report_lines line on line.company_id=p_company_id and line.daily_report_id=v_report.id and line.line_number=row.row_number where row.import_batch_id=v_batch.id;
  insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
  select p_company_id,p_store_id,v_batch.source_voucher_id,'daily_report',v_report.id,'source_document',p_actor_user_id
  union all select p_company_id,p_store_id,v_batch.source_voucher_id,'daily_report_line',line.id,'source_document',p_actor_user_id from public.zysyr_daily_report_lines line where line.company_id=p_company_id and line.daily_report_id=v_report.id
  on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  update public.zysyr_import_batches set status=case when v_recon.status='matched' then 'reconciled' else 'failed' end,completed_at=now(),error_message=case when v_recon.status='matched' then null else 'IMPORT_RECONCILIATION_MISMATCH' end where id=v_batch.id;
  return v_recon;
end $function$;

CREATE OR REPLACE FUNCTION public.zysyr_review_daily_report(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_daily_report_id uuid, p_decision text, p_reason text)
 RETURNS zysyr_daily_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_saved public.zysyr_daily_reports;
begin
  v_saved:=public.zysyr_review_daily_report_core_v429(p_actor_user_id,p_company_id,p_store_id,p_daily_report_id,p_decision,p_reason);
  if p_decision='approved' then
    insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
    select income.company_id,income.store_id,link.voucher_id,'income_record',income.id,'source_document',p_actor_user_id
    from public.zysyr_income_records income join public.zysyr_voucher_links link on link.company_id=income.company_id and link.business_type='daily_report_line'
      and link.business_id=income.daily_report_line_id and link.unlinked_at is null where income.company_id=p_company_id and income.daily_report_id=p_daily_report_id
    on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  end if; return v_saved;
end $function$;

CREATE OR REPLACE FUNCTION public.zysyr_save_daily_report(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_source_report_id uuid, p_is_business_day boolean, p_lines jsonb, p_reason text)
 RETURNS zysyr_daily_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.zysyr_report_uploads;
  v_previous public.zysyr_daily_reports;
  v_saved public.zysyr_daily_reports;
  v_version integer;
  v_line jsonb;
  v_line_number integer := 0;
  v_cell_id uuid;
  v_business_day boolean;
  v_business_day_source text;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_REPORT_INPUT_INVALID';
  end if;

  select * into v_source
  from public.zysyr_report_uploads report
  where report.id = p_source_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_type = 'daily'
    and report.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SOURCE_REPORT_NOT_FOUND';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_source.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' || v_source.report_date::text, 0
  ));
  select * into v_previous
  from public.zysyr_daily_reports report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_date = v_source.report_date
  order by report.version desc
  limit 1
  for update;
  if found and v_previous.status = 'approved' then
    raise exception using errcode = '55000', message = 'APPROVED_DAILY_REPORT_REQUIRES_REVERSAL';
  end if;
  if found and v_previous.status = 'submitted' then
    update public.zysyr_daily_reports
    set status = 'reversed',
        reversed_by_user_id = p_actor_user_id,
        reversed_at = now(),
        reverse_reason = btrim(p_reason)
    where id = v_previous.id and company_id = p_company_id;
  end if;

  select coalesce(max(report.version), 0) + 1 into v_version
  from public.zysyr_daily_reports report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_date = v_source.report_date;
  v_business_day := coalesce(p_is_business_day, extract(isodow from v_source.report_date) <> 1);
  v_business_day_source := case when p_is_business_day is null then 'monday_rule' else 'manual_override' end;

  insert into public.zysyr_daily_reports (
    company_id, store_id, report_date, is_business_day, business_day_source,
    version, supersedes_daily_report_id, source_report_id, submitted_by_user_id
  ) values (
    p_company_id, p_store_id, v_source.report_date, v_business_day,
    v_business_day_source, v_version, v_previous.id, p_source_report_id,
    p_actor_user_id
  ) returning * into v_saved;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(v_line->>'line_type', '') not in ('income', 'expense', 'petty_cash', 'payment', 'note')
       or coalesce(v_line->>'metric_code', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
       or nullif(btrim(v_line->>'description'), '') is null then
      raise exception using errcode = '22023', message = 'DAILY_REPORT_LINE_INVALID';
    end if;
    v_cell_id := nullif(v_line->>'source_report_cell_id', '')::uuid;
    if v_line->>'line_type' <> 'note' then
      if v_line->>'amount' is null or (v_line->>'amount')::numeric < 0 or v_cell_id is null then
        raise exception using errcode = '22023', message = 'DAILY_REPORT_AMOUNT_SOURCE_REQUIRED';
      end if;
      if not exists (
        select 1 from public.zysyr_report_cells cell
        where cell.id = v_cell_id
          and cell.company_id = p_company_id
          and cell.store_id = p_store_id
          and cell.report_id = p_source_report_id
      ) then
        raise exception using errcode = 'P0002', message = 'DAILY_REPORT_SOURCE_CELL_NOT_FOUND';
      end if;
    end if;
    insert into public.zysyr_daily_report_lines (
      company_id, store_id, daily_report_id, line_number, line_type,
      metric_code, description, amount, quantity, source_report_cell_id
    ) values (
      p_company_id, p_store_id, v_saved.id, v_line_number, v_line->>'line_type',
      v_line->>'metric_code', btrim(v_line->>'description'),
      nullif(v_line->>'amount', '')::numeric,
      nullif(v_line->>'quantity', '')::numeric,
      v_cell_id
    );
  end loop;

  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'daily_report', v_saved.id, null, 'submitted',
    'submit', p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import', 'daily_report',
    v_saved.id, 'submit',
    case when v_previous.id is null then null else jsonb_build_object(
      'id', v_previous.id, 'version', v_previous.version, 'status', v_previous.status
    ) end,
    jsonb_build_object(
      'id', v_saved.id, 'report_date', v_saved.report_date,
      'is_business_day', v_saved.is_business_day, 'version', v_saved.version,
      'source_report_id', v_saved.source_report_id,
      'line_count', jsonb_array_length(p_lines), 'status', v_saved.status
    ), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$function$;
