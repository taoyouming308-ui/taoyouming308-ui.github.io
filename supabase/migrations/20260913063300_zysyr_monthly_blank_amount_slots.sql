-- Materialize amount positions that are intentionally blank in the original
-- monthly workbook. They become real report cells only when finance enters
-- edit mode, so the visible input boundary and the audited save path agree.
set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function public.zysyr_prepare_monthly_editable_slots(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_report_id uuid,
  p_cells jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.zysyr_report_uploads%rowtype;
  v_requested integer;
  v_valid integer;
  v_prepared integer;
begin
  if zysyr_private.request_role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if jsonb_typeof(p_cells) <> 'array' then
    raise exception 'MONTHLY_EDITABLE_SLOT_PAYLOAD_INVALID';
  end if;
  v_requested := jsonb_array_length(p_cells);
  if v_requested < 1 or v_requested > 1000 then
    raise exception 'MONTHLY_EDITABLE_SLOT_PAYLOAD_INVALID';
  end if;

  select report.* into v_report
  from public.zysyr_report_uploads report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.id = p_report_id
    and report.report_type = 'monthly_profit_loss'
    and report.status = 'active'
  for update;
  if not found then
    raise exception 'MONTHLY_EDITABLE_SLOT_REPORT_NOT_FOUND';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, date_trunc('month', v_report.report_date)::date) then
    raise exception 'FINANCE_PERIOD_LOCKED';
  end if;

  select count(*) into v_valid
  from jsonb_to_recordset(p_cells) as cell(
    sheet_name text, cell_address text, row_number integer, column_number integer,
    cell_kind text, display_value text, numeric_value numeric, formula text,
    precedent_addresses jsonb, label text
  )
  where cell.sheet_name = coalesce(v_report.display_data->>'sheet_name', cell.sheet_name)
    and upper(cell.cell_address) ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'
    and cell.row_number between 1 and 120
    and cell.column_number between 1 and 30
    and cell.cell_kind = 'input'
    and coalesce(cell.display_value, '') = ''
    and cell.numeric_value = 0
    and cell.formula is null
    and coalesce(jsonb_typeof(cell.precedent_addresses), 'array') = 'array'
    and nullif(btrim(cell.label), '') is not null
    and cell.label !~ '(编号|序号|员工号)';
  if v_valid <> v_requested then
    raise exception 'MONTHLY_EDITABLE_SLOT_PAYLOAD_INVALID';
  end if;

  insert into public.zysyr_report_cells(
    company_id, store_id, report_id, sheet_name, cell_address, row_number,
    column_number, cell_kind, display_value, numeric_value, formula,
    precedent_addresses, label
  )
  select p_company_id, p_store_id, p_report_id, cell.sheet_name,
    upper(cell.cell_address), cell.row_number, cell.column_number, 'input', '', 0,
    null, coalesce(cell.precedent_addresses, '[]'::jsonb), btrim(cell.label)
  from jsonb_to_recordset(p_cells) as cell(
    sheet_name text, cell_address text, row_number integer, column_number integer,
    cell_kind text, display_value text, numeric_value numeric, formula text,
    precedent_addresses jsonb, label text
  )
  on conflict (company_id, report_id, sheet_name, cell_address) do nothing;
  get diagnostics v_prepared = row_count;

  insert into public.zysyr_trace_nodes(company_id, store_id, entity_type, entity_id)
  select p_company_id, p_store_id, 'report_cell', report_cell.id
  from public.zysyr_report_cells report_cell
  join jsonb_to_recordset(p_cells) as requested(sheet_name text, cell_address text)
    on requested.sheet_name = report_cell.sheet_name
   and upper(requested.cell_address) = report_cell.cell_address
  where report_cell.company_id = p_company_id
    and report_cell.store_id = p_store_id
    and report_cell.report_id = p_report_id
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges(
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select p_company_id, p_store_id, report_node.id, cell_node.id, 'contains', p_actor_user_id
  from public.zysyr_trace_nodes report_node
  join public.zysyr_report_cells report_cell
    on report_cell.company_id = p_company_id
   and report_cell.store_id = p_store_id
   and report_cell.report_id = p_report_id
  join jsonb_to_recordset(p_cells) as requested(sheet_name text, cell_address text)
    on requested.sheet_name = report_cell.sheet_name
   and upper(requested.cell_address) = report_cell.cell_address
  join public.zysyr_trace_nodes cell_node
    on cell_node.company_id = p_company_id
   and cell_node.entity_type = 'report_cell'
   and cell_node.entity_id = report_cell.id
  where report_node.company_id = p_company_id
    and report_node.entity_type = 'finance_report'
    and report_node.entity_id = p_report_id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'finance_report', p_report_id, 'monthly_editable_slots_prepare',
    jsonb_build_object('registered_amount_cells', 'before'),
    jsonb_build_object('requested', v_requested, 'prepared', v_prepared),
    '补齐原表空白金额位', 'financial'
  );

  return jsonb_build_object('prepared', v_prepared, 'requested', v_requested);
end
$$;

revoke execute on function public.zysyr_prepare_monthly_editable_slots(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.zysyr_prepare_monthly_editable_slots(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;

comment on function public.zysyr_prepare_monthly_editable_slots(
  uuid, uuid, uuid, uuid, jsonb
) is 'Materializes original monthly-sheet blank monetary positions as auditable zero-base input cells; fixed labels, names and identifiers remain unchanged.';
