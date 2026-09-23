-- Adaptive staff rows can share a visual paper coordinate with another logical
-- section (technician row 23 versus product row 23). Keep the visual address,
-- but scope each source cell to its section so report-cell uniqueness and
-- financial lineage remain one-to-one. Existing records are not modified.
create or replace function public.zysyr_confirm_daily_sheet(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_report jsonb, p_is_business_day boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;

revoke execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  to service_role;
