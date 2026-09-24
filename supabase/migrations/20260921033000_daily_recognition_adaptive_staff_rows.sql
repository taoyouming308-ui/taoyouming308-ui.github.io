-- Expand legacy daily-sheet staff grids before image recognition.
-- Blank rows are copied from the existing section template; no manual value or
-- machine candidate is overwritten. The function stays behind operations-api.
set statement_timeout = '30s';
set lock_timeout = '5s';

create or replace function public.zysyr_expand_daily_sheet_staff_rows(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_draft_id uuid,
  p_expected_revision integer,
  p_stylist_rows integer,
  p_technician_rows integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_section text;
  v_target integer;
  v_existing integer;
  v_next_index integer;
  v_template_key text;
  v_added integer := 0;
  v_stylist_added integer := 0;
  v_technician_added integer := 0;
  v_revision integer;
  v_validation jsonb;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );

  if p_stylist_rows not between 1 and 20
    or p_technician_rows not between 1 and 20 then
    raise exception using errcode = '22023', message = 'DAILY_STAFF_ROW_TARGET_INVALID';
  end if;

  select * into v_draft
  from public.zysyr_daily_sheet_drafts
  where company_id = p_company_id
    and store_id = p_store_id
    and id = p_draft_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;
  if v_draft.status <> 'draft' then
    raise exception using errcode = '55000', message = 'DAILY_SHEET_DRAFT_NOT_EDITABLE';
  end if;
  if v_draft.edit_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'DAILY_SHEET_CHANGED_RELOAD';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_draft.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  for v_section, v_target in
    select * from (values
      ('stylist'::text, p_stylist_rows),
      ('technician'::text, p_technician_rows)
    ) as targets(section_code, target_rows)
  loop
    select count(distinct row_key),
           max(nullif((pg_catalog.regexp_match(row_key, '_(\d+)$'))[1], '')::integer),
           (array_agg(row_key order by row_number, row_key))[1]
      into v_existing, v_next_index, v_template_key
    from public.zysyr_daily_sheet_cells
    where company_id = p_company_id
      and store_id = p_store_id
      and draft_id = p_draft_id
      and section_code = v_section
      and row_key not in ('stylist_category_total', 'technician_category_total', 'company');

    if v_template_key is null then
      raise exception using errcode = 'P0002', message = 'DAILY_STAFF_ROW_TEMPLATE_NOT_FOUND';
    end if;

    v_existing := coalesce(v_existing, 0);
    v_next_index := greatest(coalesce(v_next_index, 0), v_existing);

    while v_existing < v_target loop
      v_next_index := v_next_index + 1;

      insert into public.zysyr_daily_sheet_cells(
        company_id, store_id, draft_id, section_code, row_key, row_label,
        column_code, column_label, row_number, column_number, cell_role,
        ocr_text, ocr_numeric, corrected_numeric, manual_override, confidence,
        bbox, source_method, updated_by_user_id, updated_at, manual_text,
        row_label_source_method, row_label_confidence
      )
      select
        p_company_id, p_store_id, p_draft_id, v_section,
        v_section || '_' || v_next_index::text,
        '第' || v_next_index::text || '行',
        column_code, column_label,
        case when v_section = 'stylist' then 2 + v_next_index else 14 + v_next_index end,
        column_number, cell_role,
        null, null, null, false, null,
        null, 'blank_template', p_actor_user_id, now(), null,
        'template', null
      from public.zysyr_daily_sheet_cells
      where company_id = p_company_id
        and store_id = p_store_id
        and draft_id = p_draft_id
        and section_code = v_section
        and row_key = v_template_key;

      if not found then
        raise exception using errcode = 'P0002', message = 'DAILY_STAFF_ROW_TEMPLATE_NOT_FOUND';
      end if;

      v_existing := v_existing + 1;
      v_added := v_added + 1;
      if v_section = 'stylist' then
        v_stylist_added := v_stylist_added + 1;
      else
        v_technician_added := v_technician_added + 1;
      end if;
    end loop;
  end loop;

  if v_added = 0 then
    return jsonb_build_object(
      'draft_id', p_draft_id,
      'revision', v_draft.edit_revision,
      'added_rows', 0,
      'added_stylist_rows', 0,
      'added_technician_rows', 0
    );
  end if;

  update public.zysyr_daily_sheet_cells
  set row_number = 4 + p_stylist_rows,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and draft_id = p_draft_id
    and section_code = 'stylist'
    and row_key = 'stylist_category_total';

  update public.zysyr_daily_sheet_cells
  set row_number = 15 + p_technician_rows,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and draft_id = p_draft_id
    and section_code = 'technician'
    and row_key = 'technician_category_total';

  v_revision := v_draft.edit_revision + 1;
  v_validation := zysyr_private.daily_sheet_validation(
    p_company_id, p_store_id, p_draft_id
  );

  update public.zysyr_daily_sheet_drafts
  set edit_revision = v_revision,
      validation_result = v_validation,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and id = p_draft_id;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'daily_sheet_draft', p_draft_id, 'daily_staff_rows_auto_expanded',
    jsonb_build_object('revision', v_draft.edit_revision),
    jsonb_build_object(
      'revision', v_revision,
      'added_rows', v_added,
      'added_stylist_rows', v_stylist_added,
      'added_technician_rows', v_technician_added,
      'stylist_target_rows', p_stylist_rows,
      'technician_target_rows', p_technician_rows,
      'validation', v_validation
    ),
    '识别前按当前门店在职岗位人数自动补充空白员工行',
    'financial'
  );

  return jsonb_build_object(
    'draft_id', p_draft_id,
    'revision', v_revision,
    'added_rows', v_added,
    'added_stylist_rows', v_stylist_added,
    'added_technician_rows', v_technician_added,
    'validation', v_validation
  );
end
$$;

revoke all on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) to service_role;

comment on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) is 'Service-only adaptive staff-row expansion before candidate recognition; inserts blanks only and preserves manual edits.';
