CREATE OR REPLACE FUNCTION zysyr_private.account_is_finance_in_scope(target_user_account_id uuid, target_company_id uuid, target_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select target_user_account_id is not null
    and target_company_id is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.zysyr_user_accounts account
      join public.zysyr_user_role_grants grant_row
        on grant_row.user_account_id = account.id
       and grant_row.company_id = account.company_id
      join public.zysyr_roles role on role.id = grant_row.role_id
      where account.id = target_user_account_id
        and account.company_id = target_company_id
        and account.status = 'active'
        and role.code = 'finance'
        and grant_row.revoked_at is null
        and grant_row.valid_from <= current_date
        and (grant_row.valid_to is null or grant_row.valid_to >= current_date)
        and (
          grant_row.scope_type = 'company'
          or (grant_row.scope_type = 'store' and grant_row.store_id = target_store_id)
        )
    )
$function$;

CREATE OR REPLACE FUNCTION public.zysyr_register_report_upload(p_report jsonb, p_cells jsonb)
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
  if not exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg
      on urg.company_id = ua.company_id and urg.user_account_id = ua.id
    join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
    join public.zysyr_capabilities cap on cap.id = rc.capability_id
    where ua.id = v_actor_id and ua.company_id = v_company_id and ua.status = 'active'
      and urg.revoked_at is null and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
      and (urg.scope_type = 'company' or (urg.scope_type = 'store' and urg.store_id = v_store_id))
      and cap.code = 'report.upload'
  ) then
    raise exception 'finance report upload scope denied';
  end if;

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
