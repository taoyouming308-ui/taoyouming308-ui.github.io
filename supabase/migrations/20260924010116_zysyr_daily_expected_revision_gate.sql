-- Production migration version: 20260924010116.
-- Bind finance edits and final confirmation to the revision reviewed by the
-- browser. The old implementations remain private because these wrappers call
-- them under the same transaction and keep their existing atomic business logic.
-- No existing draft, confirmed report, amount, formula or audit row is rewritten.

create or replace function public.zysyr_save_daily_sheet_cells(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_cells jsonb, p_reason text, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
begin
  perform zysyr_private.assert_daily_entry_scope(p_actor_user_id, p_company_id, p_store_id);
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_EXPECTED_REVISION_REQUIRED';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_DRAFT_NOT_EDITABLE'; end if;
  if v_draft.edit_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'DAILY_SHEET_REVISION_CONFLICT',
      detail = json_build_object('expected_revision', p_expected_revision,
        'current_revision', v_draft.edit_revision)::text;
  end if;
  return public.zysyr_save_daily_sheet_cells(
    p_actor_user_id, p_company_id, p_store_id, p_draft_id, p_cells, p_reason
  );
end
$$;

create or replace function public.zysyr_confirm_daily_sheet(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_report jsonb, p_is_business_day boolean, p_reason text, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
    raise exception using errcode = '40001', message = 'DAILY_SHEET_REVISION_CONFLICT',
      detail = json_build_object('expected_revision', p_expected_revision,
        'current_revision', v_draft.edit_revision)::text;
  end if;
  return public.zysyr_confirm_daily_sheet(
    p_actor_user_id, p_company_id, p_store_id, p_draft_id,
    p_report, p_is_business_day, p_reason
  );
end
$$;

-- Keep the legacy overload available to the still-deployed v529 UI during the
-- staged rollout. New clients include p_expected_revision and use the guarded
-- overload; revoke this compatibility grant only after the old client window
-- is retired in a separate, explicit migration.
revoke execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  to service_role;
revoke execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text, integer)
  to service_role;

revoke execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  to service_role;
revoke execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text, integer)
  from public, anon, authenticated;
grant execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text, integer)
  to service_role;
