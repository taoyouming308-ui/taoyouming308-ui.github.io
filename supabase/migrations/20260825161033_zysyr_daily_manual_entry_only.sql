-- ZYSYR: daily sheets are manual-entry accounting records.
-- Historical OCR candidates remain immutable evidence but never participate in
-- validation, report generation, or formal posting unless finance saves a
-- corrected value for the cell.
set statement_timeout = '30s';
set lock_timeout = '5s';

create or replace function zysyr_private.daily_sheet_cell_value(
  p_cell public.zysyr_daily_sheet_cells
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cell.manual_override then p_cell.corrected_numeric
    else null::numeric
  end
$$;

revoke execute on function zysyr_private.daily_sheet_cell_value(public.zysyr_daily_sheet_cells)
  from public, anon, authenticated, service_role;

update public.zysyr_daily_sheet_drafts draft
set validation_result = zysyr_private.daily_sheet_validation(
      draft.company_id, draft.store_id, draft.id
    ),
    updated_at = now()
where draft.status = 'draft';

comment on function zysyr_private.daily_sheet_cell_value(public.zysyr_daily_sheet_cells) is
  'Manual-entry-only value resolver. OCR candidates are retained as evidence but never enter accounting totals.';
