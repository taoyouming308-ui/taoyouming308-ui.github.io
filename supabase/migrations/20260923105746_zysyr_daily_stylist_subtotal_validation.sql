-- The stylist section's displayed grand subtotal is an independent control.
-- Previously it could disagree with the employee detail while validation passed.
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
begin
  if not exists (select 1 from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id) then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
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
  select coalesce(zysyr_private.daily_sheet_cell_value(cell), 0) into v_card_consumption
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_card_consumption' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_payment_total
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_total' limit 1;

  if v_actual is null then v_missing_controls := array_append(v_missing_controls, '实做'); end if;
  if v_grand is null then v_missing_controls := array_append(v_missing_controls, '总计'); end if;
  if v_cashflow is null then v_missing_controls := array_append(v_missing_controls, '现金流'); end if;
  if v_payment_total is null then v_missing_controls := array_append(v_missing_controls, '支付总计'); end if;
  if v_atomic_count = 0 then v_missing_controls := array_append(v_missing_controls, '员工明细'); end if;
  if v_stylist_subtotal_count <> 1 or v_stylist_subtotal is null then
    v_missing_controls := array_append(v_missing_controls, '造型区总小计');
  end if;

  v_valid := cardinality(v_missing_controls) = 0
    and v_row_mismatches = 0 and v_category_mismatches = 0
    and v_staff_atomic > 0
    and abs(v_staff_atomic - v_staff_reported) <= 0.01
    and abs(v_staff_atomic - v_category_reported) <= 0.01
    and abs(v_staff_atomic - v_stylist_subtotal) <= 0.01
    and abs(v_staff_atomic - v_actual) <= 0.01
    and abs(v_staff_atomic - v_grand) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and abs(v_cashflow + v_card_consumption - v_payment_total) <= 0.01
    and abs(v_staff_atomic - v_payment_total) <= 0.01;

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
    'income_source', 'nonzero_stylist_atomic_cells_only'
  );
end
$$;

revoke execute on function zysyr_private.daily_sheet_validation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
