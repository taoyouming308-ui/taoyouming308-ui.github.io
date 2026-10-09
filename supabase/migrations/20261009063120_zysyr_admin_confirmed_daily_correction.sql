-- Admin-only confirmed daily correction. Existing functions, formulas, RLS and historical snapshots remain unchanged.
set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function zysyr_private.assert_daily_correction_scope(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid
) returns void language plpgsql stable security definer set search_path = '' as $function$
begin
  if zysyr_private.request_role() <> 'service_role'
    or not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.correct_confirmed')
    or not exists(select 1 from public.zysyr_user_accounts ua
      where ua.id=p_actor_user_id and ua.company_id=p_company_id
        and ua.login_name='admin' and ua.status='active' and ua.auth_user_id is not null
        and exists(select 1 from public.zysyr_user_role_grants rg join public.zysyr_roles r on r.id=rg.role_id
          where rg.company_id=p_company_id and rg.user_account_id=ua.id and r.code='shareholder' and r.status='active'
            and rg.scope_type='company' and rg.revoked_at is null and rg.valid_from<=current_date
            and (rg.valid_to is null or rg.valid_to>=current_date))) then
    raise exception using errcode='42501',message='ADMIN_DAILY_CORRECTION_FORBIDDEN';
  end if;
end
$function$;
revoke all on function zysyr_private.assert_daily_correction_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Private copies of the verified posting pipeline. The only differences are:
-- dedicated scope checks, private call names, confirmed projection guards,
-- and increasing immutable version. Calculation and reconciliation are unchanged.
-- These helpers have no direct API/client/service execution grant.
CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_save_daily_sheet_cells(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid, p_cells jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_item jsonb;
  v_cell public.zysyr_daily_sheet_cells;
  v_before numeric;
  v_after numeric;
  v_text_before text;
  v_text_after text;
  v_label_before text;
  v_label_after text;
  v_section text;
  v_row_key text;
  v_column_code text;
  v_role text;
  v_has_value boolean;
  v_numeric_changed boolean;
  v_text_changed boolean;
  v_label_changed boolean;
  v_label_reviewed boolean;
  v_value_reviewed boolean;
  v_revision integer;
  v_changed integer := 0;
  v_label_changes integer := 0;
  v_validation jsonb;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) not between 1 and 1000
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_EDIT_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'confirmed' then raise exception using errcode = '55000', message = 'DAILY_CORRECTION_CONFIRMED_REQUIRED'; end if;
  v_revision := v_draft.edit_revision + 1;

  for v_item in select value from jsonb_array_elements(p_cells) loop
    v_section := nullif(btrim(coalesce(v_item->>'section_code', '')), '');
    v_row_key := nullif(btrim(coalesce(v_item->>'row_key', '')), '');
    v_column_code := nullif(btrim(coalesce(v_item->>'column_code', '')), '');
    v_role := nullif(btrim(coalesce(v_item->>'cell_role', '')), '');
    v_label_after := nullif(btrim(coalesce(v_item->>'row_label', '')), '');
    -- JSON null 表示用户明确清空。仅缺少 value 键才表示本次不修改值。
    v_has_value := v_item ? 'value';

    if coalesce(v_item->>'id', '') <> '' then
      select * into v_cell from public.zysyr_daily_sheet_cells cell
      where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
        and cell.id = (v_item->>'id')::uuid for update;
      if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_CELL_NOT_FOUND'; end if;
      -- 已有单元格的类型和逻辑位置必须以数据库为准，不能信任客户端角色。
      v_section := v_cell.section_code;
      v_row_key := v_cell.row_key;
      v_column_code := v_cell.column_code;
      v_role := v_cell.cell_role;
    else
      if v_section is null or v_row_key is null or v_column_code is null or v_role is null then
        raise exception using errcode = '22023', message = 'DAILY_SHEET_CELL_INPUT_INVALID';
      end if;
      if not (v_has_value or v_label_after is not null) then
        continue;
      end if;
      select * into v_cell from public.zysyr_daily_sheet_cells cell
      where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
        and cell.section_code = v_section and cell.row_key = v_row_key and cell.column_code = v_column_code
      for update;
      if not found then
        if (v_item->>'value') is null and v_label_after is null then
          continue;
        end if;
        insert into public.zysyr_daily_sheet_cells(
          company_id, store_id, draft_id, section_code, row_key, row_label,
          column_code, column_label, row_number, column_number, cell_role,
          source_method, updated_by_user_id
        ) values (
          p_company_id, p_store_id, p_draft_id, v_section, v_row_key,
          coalesce(v_label_after, '未命名'),
          v_column_code,
          coalesce(nullif(btrim(coalesce(v_item->>'column_label', '')), ''), '未命名列'),
          coalesce(nullif(v_item->>'row_number', '')::integer, 1),
          coalesce(nullif(v_item->>'column_number', '')::integer, 1),
          v_role, 'blank_template', p_actor_user_id
        ) returning * into v_cell;
      end if;
    end if;

    v_before := zysyr_private.daily_sheet_cell_value(v_cell);
    v_text_before := v_cell.manual_text;
    v_label_before := v_cell.row_label;
    v_text_after := v_text_before;
    v_after := v_before;
    v_numeric_changed := false;
    v_text_changed := false;
    v_label_changed := false;
    -- A candidate is excluded from accounting, so its effective value may already
    -- be NULL. Explicitly clearing it must still persist a manual override.
    -- Also protect deliberately blank template cells from subsequent recognition.
    v_value_reviewed := v_has_value and not v_cell.manual_override;
    v_label_reviewed := coalesce((v_item->>'row_label_reviewed')::boolean, false)
      and v_label_after is not null and v_cell.row_label_source_method = 'codex_local_candidate';

    if v_has_value then
      if v_role in ('signature', 'unclosed_order', 'note') then
        v_text_after := nullif(v_item->>'value', '');
        if v_text_after is not null and char_length(v_text_after) > 500 then
          raise exception using errcode = '22023', message = 'DAILY_SHEET_TEXT_INVALID';
        end if;
        v_text_changed := v_text_before is distinct from v_text_after;
      else
        v_after := nullif(v_item->>'value', '')::numeric;
        if v_after is not null and v_after < 0 then
          raise exception using errcode = '22023', message = 'DAILY_SHEET_VALUE_INVALID';
        end if;
        v_numeric_changed := v_before is distinct from v_after;
      end if;
    end if;

    if v_label_after is not null and v_label_after <> v_label_before then
      v_label_changed := true;
      update public.zysyr_daily_sheet_cells set row_label = v_label_after,
        updated_by_user_id = p_actor_user_id, updated_at = now()
      where company_id = p_company_id and store_id = p_store_id and draft_id = p_draft_id
        and section_code = v_section and row_key = v_row_key;
    end if;

    if v_numeric_changed or v_text_changed or v_value_reviewed then
      update public.zysyr_daily_sheet_cells set corrected_numeric = v_after, manual_text = v_text_after,
        manual_override = true, updated_by_user_id = p_actor_user_id, updated_at = now() where id = v_cell.id;
    end if;

    if v_label_reviewed then
      update public.zysyr_daily_sheet_cells set row_label_source_method = 'manual', row_label_confidence = null,
        updated_by_user_id = p_actor_user_id, updated_at = now()
      where company_id = p_company_id and store_id = p_store_id and draft_id = p_draft_id
        and section_code = v_section and row_key = v_row_key;
    end if;

    if v_numeric_changed or v_text_changed or v_value_reviewed or v_label_changed or v_label_reviewed then
      insert into public.zysyr_daily_sheet_cell_changes(company_id, store_id, draft_id, cell_id,
        revision, before_value, after_value, before_text, after_text, before_label, after_label,
        changed_by_user_id, reason, row_label_reviewed, value_reviewed)
      values(p_company_id, p_store_id, p_draft_id, v_cell.id, v_revision,
        v_before, v_after, v_text_before, v_text_after, v_label_before,
        case when v_label_changed then v_label_after else v_label_before end,
        p_actor_user_id, btrim(p_reason), v_label_reviewed, v_value_reviewed);
      v_changed := v_changed + 1;
    end if;
    if v_label_changed or v_label_reviewed then
      v_label_changes := v_label_changes + 1;
    end if;
  end loop;

  if v_changed = 0 then
    return jsonb_build_object('draft_id', p_draft_id, 'revision', v_draft.edit_revision,
      'changed_cells', 0, 'label_changes', 0, 'validation', v_draft.validation_result);
  end if;

  v_validation := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision = v_revision, validation_result = v_validation,
    updated_by_user_id = p_actor_user_id, updated_at = now() where id = p_draft_id;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', p_draft_id,
    'edit', jsonb_build_object('revision', v_draft.edit_revision),
    jsonb_build_object('revision', v_revision, 'changed_cells', v_changed,
      'label_changes', v_label_changes, 'validation', v_validation),
    btrim(p_reason), 'financial');
  return jsonb_build_object('draft_id', p_draft_id, 'revision', v_revision,
    'changed_cells', v_changed, 'label_changes', v_label_changes, 'validation', v_validation);
end
$function$;

revoke all on function zysyr_private.admin_correction_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_create_photo_import_batch(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_report_date date, p_source_voucher_id uuid, p_rows jsonb, p_reason text)
 RETURNS zysyr_import_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_saved public.zysyr_import_batches; v_row jsonb; v_number integer:=0; v_errors jsonb; v_status text; v_existing uuid;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
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

revoke all on function zysyr_private.admin_correction_create_photo_import_batch(uuid,uuid,uuid,date,uuid,jsonb,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_register_report_upload(p_report jsonb, p_cells jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid := (p_report->>'company_id')::uuid;
  v_store_id uuid := (p_report->>'store_id')::uuid;
  v_actor_id uuid := (p_report->>'uploaded_by_user_id')::uuid;
  v_report_type text := p_report->>'report_type';
  v_report_date date := (p_report->>'report_date')::date;
  v_prior public.zysyr_report_uploads%rowtype;
  v_saved public.zysyr_report_uploads%rowtype;
  v_cell_count integer;
begin
  if zysyr_private.request_role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if jsonb_typeof(p_report) <> 'object' or jsonb_typeof(p_cells) <> 'array' then
    raise exception 'invalid report registration payload';
  end if;
  v_cell_count := jsonb_array_length(p_cells);
  if v_cell_count < 1 or v_cell_count > 3600 then
    raise exception 'report cell count out of range';
  end if;
  perform zysyr_private.assert_daily_correction_scope(v_actor_id,v_company_id,v_store_id);

  select * into v_prior
  from public.zysyr_report_uploads
  where company_id = v_company_id and store_id = v_store_id
    and report_type = v_report_type and report_date = v_report_date
    and status = 'active'
  order by version desc
  limit 1
  for update;

  insert into public.zysyr_report_uploads (
    company_id, store_id, report_type, report_date, template_code, template_version,
    version, supersedes_report_id, original_filename, mime_type, size_bytes, sha256,
    bucket_id, object_path, display_data, uploaded_by_user_id
  ) values (
    v_company_id, v_store_id, v_report_type, v_report_date,
    p_report->>'template_code', coalesce((p_report->>'template_version')::integer, 1),
    coalesce(v_prior.version, 0) + 1, v_prior.id, p_report->>'original_filename',
    p_report->>'mime_type', (p_report->>'size_bytes')::bigint, p_report->>'sha256',
    p_report->>'bucket_id', p_report->>'object_path', p_report->'display_data', v_actor_id
  ) returning * into v_saved;

  insert into public.zysyr_report_cells (
    company_id, store_id, report_id, sheet_name, cell_address, row_number,
    column_number, cell_kind, display_value, numeric_value, formula,
    precedent_addresses, label
  )
  select v_company_id, v_store_id, v_saved.id,
    cell.sheet_name, upper(cell.cell_address), cell.row_number, cell.column_number,
    cell.cell_kind, coalesce(cell.display_value, ''), cell.numeric_value,
    nullif(btrim(cell.formula), ''), coalesce(cell.precedent_addresses, '[]'::jsonb),
    coalesce(cell.label, '')
  from jsonb_to_recordset(p_cells) as cell(
    sheet_name text, cell_address text, row_number integer, column_number integer,
    cell_kind text, display_value text, numeric_value numeric, formula text,
    precedent_addresses jsonb, label text
  );

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (v_company_id, v_store_id, 'finance_report', v_saved.id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select v_company_id, v_store_id, 'report_cell', cell.id
  from public.zysyr_report_cells cell
  where cell.company_id = v_company_id and cell.report_id = v_saved.id
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_company_id, v_store_id, report_node.id, cell_node.id, 'contains', v_actor_id
  from public.zysyr_trace_nodes report_node
  join public.zysyr_report_cells cell
    on cell.company_id = v_company_id and cell.report_id = v_saved.id
  join public.zysyr_trace_nodes cell_node
    on cell_node.company_id = v_company_id and cell_node.entity_type = 'report_cell'
   and cell_node.entity_id = cell.id
  where report_node.company_id = v_company_id
    and report_node.entity_type = 'finance_report' and report_node.entity_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    source_amount, created_by_user_id
  )
  select v_company_id, v_store_id, target_node.id, source_node.id, 'derived_from',
    source_cell.numeric_value, v_actor_id
  from public.zysyr_report_cells target_cell
  join lateral jsonb_array_elements_text(target_cell.precedent_addresses) precedent on true
  join public.zysyr_report_cells source_cell
    on source_cell.company_id = target_cell.company_id
   and source_cell.report_id = target_cell.report_id
   and source_cell.sheet_name = target_cell.sheet_name
   and source_cell.cell_address = upper(precedent.value)
  join public.zysyr_trace_nodes target_node
    on target_node.company_id = target_cell.company_id
   and target_node.entity_type = 'report_cell' and target_node.entity_id = target_cell.id
  join public.zysyr_trace_nodes source_node
    on source_node.company_id = source_cell.company_id
   and source_node.entity_type = 'report_cell' and source_node.entity_id = source_cell.id
  where target_cell.company_id = v_company_id and target_cell.report_id = v_saved.id
    and target_cell.cell_kind = 'formula'
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  if v_prior.id is not null then
    update public.zysyr_report_uploads
    set status = 'superseded'
    where company_id = v_company_id and id = v_prior.id and status = 'active';
  end if;

  return to_jsonb(v_saved);
end;
$function$;

revoke all on function zysyr_private.admin_correction_register_report_upload(jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_save_daily_report(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_source_report_id uuid, p_is_business_day boolean, p_lines jsonb, p_reason text)
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
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
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

revoke all on function zysyr_private.admin_correction_save_daily_report(uuid,uuid,uuid,uuid,boolean,jsonb,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_finalize_daily_import(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_import_batch_id uuid, p_daily_report_id uuid)
 RETURNS zysyr_reconciliation_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_batch public.zysyr_import_batches; v_report public.zysyr_daily_reports; v_recon public.zysyr_reconciliation_reports;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
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

revoke all on function zysyr_private.admin_correction_finalize_daily_import(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_review_daily_report_core_v429(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_daily_report_id uuid, p_decision text, p_reason text)
 RETURNS zysyr_daily_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before public.zysyr_daily_reports;
  v_after public.zysyr_daily_reports;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
  if p_decision not in ('approved', 'rejected')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_REVIEW_INVALID';
  end if;
  select * into v_before
  from public.zysyr_daily_reports report
  where report.id = p_daily_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_REPORT_NOT_FOUND';
  end if;
  if v_before.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'DAILY_REPORT_NOT_SUBMITTED';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  update public.zysyr_daily_reports
  set status = p_decision,
      reviewed_by_user_id = p_actor_user_id,
      reviewed_at = now(),
      review_reason = btrim(p_reason)
  where id = p_daily_report_id and company_id = p_company_id
  returning * into v_after;

  insert into public.zysyr_income_records (
    company_id, store_id, income_date, category_code, summary, amount,
    daily_report_id, daily_report_line_id, source_report_cell_id,
    approved_by_user_id, approved_at
  )
  select
    line.company_id, line.store_id, v_after.report_date, line.metric_code,
    line.description, line.amount, line.daily_report_id, line.id,
    line.source_report_cell_id, p_actor_user_id, v_after.reviewed_at
  from public.zysyr_daily_report_lines line
  where p_decision = 'approved'
    and line.company_id = p_company_id
    and line.store_id = p_store_id
    and line.daily_report_id = p_daily_report_id
    and line.line_type = 'income'
  on conflict (company_id, daily_report_line_id) do nothing;

  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'daily_report', p_daily_report_id, 'submitted',
    p_decision, case when p_decision = 'approved' then 'approve' else 'reject' end,
    p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_report',
    p_daily_report_id, case when p_decision = 'approved' then 'approve' else 'reject' end,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object(
      'status', v_after.status, 'reviewed_at', v_after.reviewed_at,
      'income_record_count', case when p_decision = 'approved' then (
        select count(*) from public.zysyr_income_records income
        where income.company_id = p_company_id
          and income.daily_report_id = p_daily_report_id
      ) else 0 end
    ), btrim(p_reason), 'financial'
  );
  return v_after;
end
$function$;

revoke all on function zysyr_private.admin_correction_review_daily_report_core_v429(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_review_daily_report(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_daily_report_id uuid, p_decision text, p_reason text)
 RETURNS zysyr_daily_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_saved public.zysyr_daily_reports;
begin
  v_saved:=zysyr_private.admin_correction_review_daily_report_core_v429(p_actor_user_id,p_company_id,p_store_id,p_daily_report_id,p_decision,p_reason);
  if p_decision='approved' then
    insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
    select income.company_id,income.store_id,link.voucher_id,'income_record',income.id,'source_document',p_actor_user_id
    from public.zysyr_income_records income join public.zysyr_voucher_links link on link.company_id=income.company_id and link.business_type='daily_report_line'
      and link.business_id=income.daily_report_line_id and link.unlinked_at is null where income.company_id=p_company_id and income.daily_report_id=p_daily_report_id
    on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  end if; return v_saved;
end $function$;

revoke all on function zysyr_private.admin_correction_review_daily_report(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION zysyr_private.admin_correction_confirm_daily_sheet(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid, p_report jsonb, p_is_business_day boolean, p_reason text)
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
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
  if jsonb_typeof(p_report) <> 'object' or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_CONFIRM_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'confirmed' then raise exception using errcode = '55000', message = 'DAILY_CORRECTION_CONFIRMED_REQUIRED'; end if;
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

  v_batch := zysyr_private.admin_correction_create_photo_import_batch(p_actor_user_id, p_company_id, p_store_id,
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
  v_report_data := zysyr_private.admin_correction_register_report_upload(p_report, v_report_cells);
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

  v_daily := zysyr_private.admin_correction_save_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_report_id, p_is_business_day, v_lines, p_reason);
  v_reconciliation := zysyr_private.admin_correction_finalize_daily_import(p_actor_user_id, p_company_id,
    p_store_id, v_batch.id, v_daily.id);
  if v_reconciliation.status <> 'matched' then raise exception using errcode = '22023', message = 'DAILY_SHEET_RECONCILIATION_FAILED'; end if;
  v_approved := zysyr_private.admin_correction_review_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_daily.id, 'approved', p_reason);

  insert into public.zysyr_daily_sheet_versions(company_id, store_id, draft_id, version,
    source_voucher_id, source_report_id, import_batch_id, daily_report_id,
    validation_result, confirmed_snapshot, confirmed_by_user_id, reason)
  select p_company_id, p_store_id, p_draft_id,
    (select coalesce(max(version),0)+1 from public.zysyr_daily_sheet_versions where company_id=p_company_id and draft_id=p_draft_id),
    v_draft.source_voucher_id, v_report_id,
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
    'confirm', jsonb_build_object('status', 'confirmed', 'edit_revision', v_draft.edit_revision),
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

revoke all on function zysyr_private.admin_correction_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text) from public,anon,authenticated,service_role;


create or replace function public.zysyr_correct_confirmed_daily_sheet(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
  p_expected_revision integer,p_request_id uuid,p_cells jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '5s' set statement_timeout = '20s' as $function$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_old_version public.zysyr_daily_sheet_versions;
  v_old_daily public.zysyr_daily_reports;
  v_source public.zysyr_report_uploads;
  v_date date; v_prior jsonb; v_saved jsonb; v_posted jsonb; v_hash text;
  v_before jsonb; v_display jsonb; v_report jsonb; v_new_revision integer; v_reversed integer;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
  if p_expected_revision is null or p_expected_revision<0 or p_request_id is null
    or p_cells is null or jsonb_typeof(p_cells)<>'array' or jsonb_array_length(p_cells) not between 1 and 1000
    or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception using errcode='22023',message='DAILY_CORRECTION_INPUT_INVALID';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('revision',p_expected_revision,'cells',p_cells,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  select report_date into v_date from public.zysyr_daily_sheet_drafts
    where id=p_draft_id and company_id=p_company_id and store_id=p_store_id;
  if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  -- Lock in month -> draft -> report order, shared with the month rollup.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||date_trunc('month',v_date)::date::text,0));
  select * into v_draft from public.zysyr_daily_sheet_drafts
    where id=p_draft_id and company_id=p_company_id and store_id=p_store_id for update;
  select after_json into v_prior from public.zysyr_audit_events
    where company_id=p_company_id and store_id=p_store_id and actor_user_id=p_actor_user_id
      and entity_type='daily_sheet_draft' and entity_id=p_draft_id and action='correct_confirmed_daily'
      and after_json->>'request_id'=p_request_id::text order by id desc limit 1;
  if found then
    if v_prior->>'payload_hash'<>v_hash then raise exception using errcode='PT409',message='DAILY_CORRECTION_REQUEST_REUSED'; end if;
    return (v_prior->'result')||jsonb_build_object('already_applied',true);
  end if;
  if v_draft.status<>'confirmed' then raise exception using errcode='55000',message='DAILY_CORRECTION_CONFIRMED_REQUIRED'; end if;
  if v_draft.edit_revision<>p_expected_revision then raise exception using errcode='PT409',message='DAILY_SHEET_REVISION_CONFLICT'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  select * into v_old_version from public.zysyr_daily_sheet_versions
    where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id order by version desc limit 1;
  if not found then raise exception using errcode='55000',message='DAILY_CORRECTION_ORIGINAL_VERSION_REQUIRED'; end if;
  select * into v_old_daily from public.zysyr_daily_reports where id=v_old_version.daily_report_id
    and company_id=p_company_id and store_id=p_store_id and report_date=v_date and status='approved' for update;
  if not found or exists(select 1 from public.zysyr_daily_reports where company_id=p_company_id and store_id=p_store_id
    and report_date=v_date and status in ('submitted','approved','locked') and id<>v_old_daily.id) then
    raise exception using errcode='55000',message='DAILY_CORRECTION_LEDGER_CHANGED';
  end if;
  select * into v_source from public.zysyr_report_uploads
    where id=v_old_version.source_report_id and company_id=p_company_id and store_id=p_store_id
      and report_date=v_date and report_type='daily' and status='active' for update;
  if not found or v_draft.source_voucher_id is distinct from v_old_version.source_voucher_id then
    raise exception using errcode='55000',message='DAILY_CORRECTION_SOURCE_CHANGED';
  end if;
  v_before:=jsonb_build_object('version_id',v_old_version.id,'daily_report_id',v_old_daily.id,'edit_revision',v_draft.edit_revision,
    'validation',v_draft.validation_result,'income_count',(select count(*) from public.zysyr_income_records
      where company_id=p_company_id and store_id=p_store_id and daily_report_id=v_old_daily.id and status='approved'));
  -- Preserve confirmed-source semantics and the original immutable snapshot.
  -- Every projection edit, reversal and new posting shares this transaction.
  -- Any failed validation/import/approval rolls back to the old effective ledger.
  v_saved:=zysyr_private.admin_correction_save_daily_sheet_cells(p_actor_user_id,p_company_id,p_store_id,p_draft_id,p_cells,btrim(p_reason));
  select edit_revision into v_new_revision from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id;
  if v_new_revision<=p_expected_revision then raise exception using errcode='22023',message='DAILY_CORRECTION_NO_CHANGES'; end if;
  if coalesce((zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id)->>'valid')::boolean,false) is not true then
    raise exception using errcode='22023',message='DAILY_SHEET_CONTROL_MISMATCH';
  end if;
  update public.zysyr_income_records set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=now(),reverse_reason=btrim(p_reason)
    where company_id=p_company_id and store_id=p_store_id and daily_report_id=v_old_daily.id and status='approved';
  get diagnostics v_reversed=row_count;
  if v_reversed<>(v_before->>'income_count')::integer then raise exception using errcode='PT409',message='DAILY_CORRECTION_LEDGER_CHANGED'; end if;
  update public.zysyr_daily_reports set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=now(),reverse_reason=btrim(p_reason)
    where id=v_old_daily.id and company_id=p_company_id and store_id=p_store_id and status='approved';
  insert into public.zysyr_workflow_events(company_id,store_id,entity_type,entity_id,from_status,to_status,action,actor_user_id,reason)
    values(p_company_id,p_store_id,'daily_report',v_old_daily.id,'approved','reversed','reverse',p_actor_user_id,btrim(p_reason));
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_report',v_old_daily.id,'reverse',
      v_before,jsonb_build_object('status','reversed','income_count',v_reversed,'correction_request_id',p_request_id),btrim(p_reason),'financial');
  select jsonb_agg(to_jsonb(cell)||jsonb_build_object('numeric_value',zysyr_private.daily_sheet_cell_value(cell))
    order by cell.row_number,cell.column_number,cell.section_code,cell.row_key) into v_display
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id;
  v_report:=jsonb_build_object('original_filename',v_source.original_filename,'mime_type',v_source.mime_type,
    'size_bytes',v_source.size_bytes,'sha256',v_source.sha256,'bucket_id',v_source.bucket_id,
    'object_path',v_source.object_path||'.correction-'||p_request_id::text,
    'display_data',v_source.display_data||jsonb_build_object('cells',v_display,'source_voucher_id',v_draft.source_voucher_id,
      'validation',zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id),
      'original_image_preserved',true,'supersedes_daily_version_id',v_old_version.id));
  v_posted:=zysyr_private.admin_correction_confirm_daily_sheet(p_actor_user_id,p_company_id,p_store_id,p_draft_id,
    v_report,case when v_old_daily.business_day_source='manual_override' then v_old_daily.is_business_day else null end,btrim(p_reason));
  v_posted:=v_posted||jsonb_build_object('request_id',p_request_id,'edit_revision',v_new_revision,
    'supersedes_version_id',v_old_version.id,'supersedes_daily_report_id',v_old_daily.id,'corrected',true);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'correct_confirmed_daily',v_before,
      jsonb_build_object('request_id',p_request_id,'payload_hash',v_hash,'result',v_posted),btrim(p_reason),'financial');
  return v_posted;
end
$function$;
revoke all on function public.zysyr_correct_confirmed_daily_sheet(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_correct_confirmed_daily_sheet(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text) to service_role;

-- Account-specific grant, not a role-wide capability. Fail closed if identity is ambiguous.
do $grant$
declare v_account public.zysyr_user_accounts; v_cap uuid;
begin
  if (select count(*) from public.zysyr_user_accounts where login_name='admin' and status='active' and auth_user_id is not null)<>1 then
    raise exception 'Expected exactly one active Auth-bound admin; no grants changed';
  end if;
  select * into v_account from public.zysyr_user_accounts where login_name='admin' and status='active' and auth_user_id is not null;
  if not exists(select 1 from public.zysyr_user_role_grants rg join public.zysyr_roles r on r.id=rg.role_id
    where rg.company_id=v_account.company_id and rg.user_account_id=v_account.id and r.code='shareholder' and r.status='active'
      and rg.scope_type='company' and rg.revoked_at is null and rg.valid_from<=current_date and (rg.valid_to is null or rg.valid_to>=current_date)) then
    raise exception 'Admin must retain its existing company shareholder scope';
  end if;
  insert into public.zysyr_capabilities(code,name,risk_level) values('daily_report.correct_confirmed','更正已入账日报（老板专属）','high')
    on conflict(code) do nothing;
  select id into v_cap from public.zysyr_capabilities where code='daily_report.correct_confirmed';
  if exists(select 1 from public.zysyr_role_capabilities where capability_id=v_cap)
    or exists(select 1 from public.zysyr_user_capability_grants where capability_id=v_cap and revoked_at is null and user_account_id<>v_account.id) then
    raise exception 'Confirmed-daily correction must not be granted to a role or another account';
  end if;
  if not exists(select 1 from public.zysyr_user_capability_grants where company_id=v_account.company_id and user_account_id=v_account.id
    and capability_id=v_cap and scope_type='company' and revoked_at is null and valid_from<=current_date
    and (valid_to is null or valid_to>=current_date)) then
    insert into public.zysyr_user_capability_grants(company_id,user_account_id,capability_id,scope_type,granted_by_user_id)
      values(v_account.company_id,v_account.id,v_cap,'company',v_account.id);
    insert into public.zysyr_audit_events(company_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
      values(v_account.company_id,'user',v_account.id,'migration','user_account',v_account.id,'grant_daily_correction',
        jsonb_build_object('capability','daily_report.correct_confirmed','scope','company'),
        '用户明确授权：只给 admin 增加已入账日报更正权限','financial');
  end if;
end
$grant$;

-- Status reads serialize with corrections; a missing receipt is not guessed success.
create or replace function public.zysyr_daily_correction_status(
 p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $function$
declare v_date date; v_result jsonb;
begin
 perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
 if p_request_id is null then raise exception using errcode='22023',message='DAILY_CORRECTION_INPUT_INVALID'; end if;
 select report_date into v_date from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||date_trunc('month',v_date)::date::text,0));
 select after_json->'result' into v_result from public.zysyr_audit_events where company_id=p_company_id and store_id=p_store_id
   and actor_user_id=p_actor_user_id and entity_type='daily_sheet_draft' and entity_id=p_draft_id and action='correct_confirmed_daily'
   and after_json->>'request_id'=p_request_id::text order by id desc limit 1;
 return jsonb_build_object('applied',found,'saved',v_result);
end
$function$;
revoke all on function public.zysyr_daily_correction_status(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.zysyr_daily_correction_status(uuid,uuid,uuid,uuid,uuid) to service_role;
