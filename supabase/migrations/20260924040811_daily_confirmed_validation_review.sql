-- Read-only, bounded revalidation for the daily-report calendar. Old confirmed
-- drafts retain their historical validation snapshot; this function computes
-- today's validator result without updating the draft or any financial row.
create or replace function public.zysyr_admin_current_daily_sheet_validation(
  p_company_id uuid,
  p_store_id uuid,
  p_draft_ids uuid[]
) returns table(draft_id uuid, current_validation jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company_id is null or p_store_id is null or p_draft_ids is null then
    raise exception using errcode = '22023', message = 'DAILY_VALIDATION_SCOPE_REQUIRED';
  end if;
  if cardinality(p_draft_ids) > 100 then
    raise exception using errcode = '22023', message = 'DAILY_VALIDATION_BATCH_TOO_LARGE';
  end if;

  return query
    select draft.id,
      zysyr_private.daily_sheet_validation(draft.company_id, draft.store_id, draft.id)
    from public.zysyr_daily_sheet_drafts as draft
    where draft.company_id = p_company_id
      and draft.store_id = p_store_id
      and draft.status = 'confirmed'
      and draft.id = any(p_draft_ids)
    order by draft.report_date asc, draft.id asc;
end;
$$;

revoke execute on function public.zysyr_admin_current_daily_sheet_validation(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.zysyr_admin_current_daily_sheet_validation(uuid, uuid, uuid[])
  to service_role;
