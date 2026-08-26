-- ZYSYR v436: DOCX table reports, salary-to-monthly trace sources, and
-- immutable text evidence for manually completed daily sheets.
set statement_timeout = '30s';
set lock_timeout = '5s';

-- Keep this migration independently safe even when an earlier local v435 file
-- has a future timestamp and therefore runs after this file.
alter table public.zysyr_daily_sheet_cells
  add column if not exists manual_text text;

alter table public.zysyr_report_uploads
  drop constraint if exists zysyr_report_uploads_mime_type_check;
alter table public.zysyr_report_uploads
  add constraint zysyr_report_uploads_mime_type_check check (mime_type in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png'
    ]
where id = 'zysyr-reports';

create or replace function zysyr_private.assert_daily_entry_scope(
  target_user_account_id uuid,
  target_company_id uuid,
  target_store_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not zysyr_private.account_has_capability(
    target_user_account_id, target_company_id, target_store_id, 'daily_report.write'
  ) then
    raise exception using errcode = '42501', message = 'DAILY_ENTRY_SCOPE_FORBIDDEN';
  end if;
end
$$;

revoke execute on function zysyr_private.assert_daily_entry_scope(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

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
  perform zysyr_private.assert_daily_entry_scope(p_actor_user_id, p_company_id, p_store_id);
  if p_report_date is null or nullif(btrim(p_ocr_provider), '') is null or nullif(btrim(p_ocr_model), '') is null
    or jsonb_typeof(p_ocr_raw_result) <> 'object' or jsonb_typeof(p_cells) <> 'array'
    or jsonb_array_length(p_cells) not between 1 and 1000 or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_DRAFT_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  select voucher.sha256 into v_source_sha from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id and voucher.store_id = p_store_id and voucher.id = p_source_voucher_id
    and voucher.audit_status = 'approved' and voucher.document_type = 'daily_report';
  if not found then raise exception using errcode = 'P0002', message = 'APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  select * into v_saved from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.source_voucher_id = p_source_voucher_id
    and draft.status in ('draft', 'confirmed') order by draft.created_at desc limit 1;
  if found then return v_saved; end if;

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

revoke execute on function public.zysyr_create_daily_sheet_draft(uuid, uuid, uuid, date, uuid, text, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_create_daily_sheet_draft(uuid, uuid, uuid, date, uuid, text, text, jsonb, jsonb, text)
  to service_role;

create or replace function zysyr_private.daily_sheet_version_text_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select coalesce(jsonb_agg(
    item.value || jsonb_build_object(
      'manual_text', cell.manual_text,
      'confirmed_display', case
        when cell.cell_role in ('signature', 'unclosed_order', 'note') then cell.manual_text
        else zysyr_private.daily_sheet_cell_value(cell)::text
      end
    ) order by item.ordinality
  ), '[]'::jsonb)
  into new.confirmed_snapshot
  from jsonb_array_elements(new.confirmed_snapshot) with ordinality item(value, ordinality)
  left join public.zysyr_daily_sheet_cells cell
    on cell.company_id = new.company_id
   and cell.store_id = new.store_id
   and cell.draft_id = new.draft_id
   and cell.id = (item.value->>'cell_id')::uuid;
  return new;
end
$$;

revoke execute on function zysyr_private.daily_sheet_version_text_snapshot()
  from public, anon, authenticated, service_role;
drop trigger if exists zysyr_daily_sheet_version_text_snapshot
  on public.zysyr_daily_sheet_versions;
create trigger zysyr_daily_sheet_version_text_snapshot
before insert on public.zysyr_daily_sheet_versions
for each row execute function zysyr_private.daily_sheet_version_text_snapshot();

create or replace function public.zysyr_save_report_cell_trace(
  p_target_cell_id uuid,
  p_source_cell_ids uuid[],
  p_voucher_ids uuid[],
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.zysyr_report_cells%rowtype;
  v_target_report public.zysyr_report_uploads%rowtype;
  v_prior public.zysyr_report_cell_trace_revisions%rowtype;
  v_saved public.zysyr_report_cell_trace_revisions%rowtype;
  v_source_count integer;
  v_evidence_count integer;
  v_source_amount numeric(18,4);
  v_delta numeric(18,4);
  v_status text;
  v_source_ids uuid[] := coalesce(p_source_cell_ids, array[]::uuid[]);
  v_voucher_ids uuid[] := coalesce(p_voucher_ids, array[]::uuid[]);
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if cardinality(v_source_ids) > 500 or cardinality(v_voucher_ids) > 200 then
    raise exception 'trace selection exceeds safe limit';
  end if;

  select * into v_target from public.zysyr_report_cells where id = p_target_cell_id;
  if v_target.id is null then raise exception 'target report cell not found'; end if;
  select * into v_target_report from public.zysyr_report_uploads
    where company_id = v_target.company_id and id = v_target.report_id;
  if v_target_report.report_type <> 'monthly_profit_loss'
    or v_target.cell_kind <> 'input' or v_target.numeric_value is null then
    raise exception 'only numeric monthly input cells can be manually traced';
  end if;
  if not exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg
      on urg.company_id = ua.company_id and urg.user_account_id = ua.id
    join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
    join public.zysyr_capabilities cap on cap.id = rc.capability_id
    where ua.id = p_actor_user_id and ua.company_id = v_target.company_id and ua.status = 'active'
      and urg.revoked_at is null and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
      and (urg.scope_type = 'company' or (urg.scope_type = 'store' and urg.store_id = v_target.store_id))
      and cap.code = 'report.upload'
  ) then raise exception 'finance trace scope denied'; end if;

  select count(distinct source.id), coalesce(sum(source.numeric_value), 0)
  into v_source_count, v_source_amount
  from public.zysyr_report_cells source
  join public.zysyr_report_uploads report
    on report.company_id = source.company_id and report.id = source.report_id
  where source.id = any(v_source_ids)
    and source.company_id = v_target.company_id and source.store_id = v_target.store_id
    and source.numeric_value is not null
    and report.report_type in ('daily', 'performance', 'salary')
    and date_trunc('month', report.report_date) = date_trunc('month', v_target_report.report_date);
  if v_source_count <> cardinality(v_source_ids) then
    raise exception 'one or more source cells are outside the authorized month or store';
  end if;

  select count(distinct voucher.id) into v_evidence_count
  from public.zysyr_voucher_attachments voucher
  join public.zysyr_report_uploads report
    on report.company_id = voucher.company_id
   and report.id::text = voucher.record_id and voucher.record_type = 'report'
  where voucher.id = any(v_voucher_ids)
    and voucher.company_id = v_target.company_id and voucher.store_id = v_target.store_id
    and date_trunc('month', report.report_date) = date_trunc('month', v_target_report.report_date);
  if v_evidence_count <> cardinality(v_voucher_ids) then
    raise exception 'one or more vouchers are outside the authorized month or store';
  end if;

  v_delta := round(v_source_amount - v_target.numeric_value, 4);
  v_status := case
    when v_source_count = 0 then 'unlinked'
    when abs(v_delta) > 0.01 then 'mismatch'
    when v_evidence_count = 0 then 'missing_evidence'
    else 'matched'
  end;

  select * into v_prior
  from public.zysyr_report_cell_trace_revisions
  where company_id = v_target.company_id and target_cell_id = v_target.id
  order by revision desc limit 1 for update;

  insert into public.zysyr_report_cell_trace_revisions (
    company_id, store_id, target_cell_id, revision, supersedes_revision_id,
    expected_amount, source_amount, delta, status, source_count, evidence_count,
    created_by_user_id
  ) values (
    v_target.company_id, v_target.store_id, v_target.id,
    coalesce(v_prior.revision, 0) + 1, v_prior.id, v_target.numeric_value,
    v_source_amount, v_delta, v_status, v_source_count, v_evidence_count,
    p_actor_user_id
  ) returning * into v_saved;

  insert into public.zysyr_report_cell_trace_sources (
    company_id, store_id, trace_revision_id, source_cell_id, source_amount
  )
  select v_target.company_id, v_target.store_id, v_saved.id, source.id, source.numeric_value
  from public.zysyr_report_cells source
  where source.id = any(v_source_ids);

  insert into public.zysyr_report_cell_trace_evidence (
    company_id, store_id, trace_revision_id, voucher_id
  )
  select v_target.company_id, v_target.store_id, v_saved.id, voucher.id
  from public.zysyr_voucher_attachments voucher
  where voucher.id = any(v_voucher_ids);

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (v_target.company_id, v_target.store_id, 'report_cell_trace_revision', v_saved.id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select v_target.company_id, v_target.store_id, 'voucher', voucher.id
  from public.zysyr_voucher_attachments voucher where voucher.id = any(v_voucher_ids)
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, target_node.id, revision_node.id,
    'contains', p_actor_user_id
  from public.zysyr_trace_nodes target_node, public.zysyr_trace_nodes revision_node
  where target_node.company_id = v_target.company_id
    and target_node.entity_type = 'report_cell' and target_node.entity_id = v_target.id
    and revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    source_amount, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, revision_node.id, source_node.id,
    'derived_from', source.numeric_value, p_actor_user_id
  from public.zysyr_trace_nodes revision_node
  join public.zysyr_report_cells source on source.id = any(v_source_ids)
  join public.zysyr_trace_nodes source_node
    on source_node.company_id = source.company_id
   and source_node.entity_type = 'report_cell' and source_node.entity_id = source.id
  where revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, revision_node.id, voucher_node.id,
    'evidenced_by', p_actor_user_id
  from public.zysyr_trace_nodes revision_node
  join public.zysyr_voucher_attachments voucher on voucher.id = any(v_voucher_ids)
  join public.zysyr_trace_nodes voucher_node
    on voucher_node.company_id = voucher.company_id
   and voucher_node.entity_type = 'voucher' and voucher_node.entity_id = voucher.id
  where revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json
  ) values (
    v_target.company_id, v_target.store_id, 'user', p_actor_user_id, 'api',
    'report_cell_trace', v_saved.id, 'revise',
    jsonb_build_object('target_cell_id', v_target.id, 'revision', v_saved.revision,
      'status', v_saved.status, 'expected_amount', v_saved.expected_amount,
      'source_amount', v_saved.source_amount, 'delta', v_saved.delta,
      'source_count', v_saved.source_count, 'evidence_count', v_saved.evidence_count)
  );
  return to_jsonb(v_saved);
end
$$;

revoke execute on function public.zysyr_save_report_cell_trace(uuid, uuid[], uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_save_report_cell_trace(uuid, uuid[], uuid[], uuid)
  to service_role;
