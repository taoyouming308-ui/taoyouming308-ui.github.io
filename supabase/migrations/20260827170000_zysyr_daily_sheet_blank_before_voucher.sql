-- ZYSYR: allow creating a blank daily sheet before uploading the source voucher
alter table public.zysyr_daily_sheet_drafts alter column source_voucher_id drop not null;

create or replace function public.zysyr_create_daily_sheet_draft(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_report_date date,
  p_source_voucher_id uuid, p_ocr_provider text, p_ocr_model text,
  p_ocr_raw_result jsonb, p_cells jsonb, p_reason text
) returns public.zysyr_daily_sheet_drafts language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_daily_sheet_drafts;
  v_source_sha text;
  v_cell jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if p_report_date is null or nullif(btrim(p_ocr_provider), '') is null or nullif(btrim(p_ocr_model), '') is null
    or jsonb_typeof(p_ocr_raw_result) <> 'object' or jsonb_typeof(p_cells) <> 'array'
    or jsonb_array_length(p_cells) not between 1 and 1000 or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_DRAFT_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if p_source_voucher_id is not null then
    select voucher.sha256 into v_source_sha from public.zysyr_voucher_attachments voucher
    where voucher.company_id = p_company_id and voucher.store_id = p_store_id and voucher.id = p_source_voucher_id
      and voucher.audit_status = 'approved' and voucher.document_type = 'daily_report';
    if not found then raise exception using errcode = 'P0002', message = 'APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
    select * into v_saved from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.source_voucher_id = p_source_voucher_id
      and draft.status in ('draft', 'confirmed') order by draft.created_at desc limit 1;
    if found then return v_saved; end if;
  else
    select * into v_saved from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.report_date = p_report_date
      and draft.source_voucher_id is null and draft.status = 'draft' order by draft.created_at desc limit 1;
    if found then return v_saved; end if;
  end if;

  insert into public.zysyr_daily_sheet_drafts(
    company_id, store_id, source_voucher_id, report_date, source_sha256,
    ocr_provider, ocr_model, ocr_raw_result, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, p_store_id, p_source_voucher_id, p_report_date, v_source_sha,
    btrim(p_ocr_provider), btrim(p_ocr_model), p_ocr_raw_result, p_actor_user_id, p_actor_user_id
  ) returning * into v_saved;

  for v_cell in select value from jsonb_array_elements(p_cells) loop
    insert into public.zysyr_daily_sheet_cells(
      company_id, store_id, draft_id, section_code, row_key, row_label,
      column_code, column_label, row_number, column_number, cell_role,
      ocr_text, ocr_numeric, confidence, bbox, source_method, updated_by_user_id
    ) values (
      p_company_id, p_store_id, v_saved.id, v_cell->>'section_code', v_cell->>'row_key', v_cell->>'row_label',
      v_cell->>'column_code', v_cell->>'column_label', (v_cell->>'row_number')::integer,
      (v_cell->>'column_number')::integer, v_cell->>'cell_role', nullif(v_cell->>'ocr_text', ''),
      nullif(v_cell->>'ocr_numeric', '')::numeric, nullif(v_cell->>'confidence', '')::numeric,
      v_cell->'bbox', coalesce(nullif(v_cell->>'source_method', ''), 'blank_template'), p_actor_user_id
    );
  end loop;
  v_saved.validation_result := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, v_saved.id);
  update public.zysyr_daily_sheet_drafts set validation_result = v_saved.validation_result where id = v_saved.id
    returning * into v_saved;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', v_saved.id,
    'create', jsonb_build_object('report_date', p_report_date, 'source_voucher_id', p_source_voucher_id,
      'source_sha256', v_source_sha, 'ocr_provider', p_ocr_provider, 'ocr_model', p_ocr_model,
      'cell_count', jsonb_array_length(p_cells)), btrim(p_reason), 'financial');
  return v_saved;
end
$$;
