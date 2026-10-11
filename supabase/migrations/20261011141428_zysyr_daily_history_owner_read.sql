-- Read tightening only. No records, financial functions, write ACLs or existing policies change.
begin;
-- Broker reads for the verified owner remain service_role-only.
revoke select on table public.zysyr_daily_sheet_cell_changes from public, anon, authenticated;
-- Old confirmed snapshots are another direct route to daily modification history.
revoke select on table public.zysyr_daily_sheet_versions from public, anon, authenticated;
-- Preserve ordinary audit visibility, restrict only the daily sheet's audit events.
create policy zysyr_daily_history_owner_only on public.zysyr_audit_events
as restrictive for select to authenticated
using (
  entity_type is distinct from 'daily_sheet_draft'
  or (
    company_id = '02463a53-dfdb-4291-b04d-dd1d85f9d998'::uuid
    and (select auth.uid()) = 'd205de6f-2bbe-46f3-a591-4725a2423777'::uuid
    and (select zysyr_private.has_capability(company_id, null, 'daily_report.correct_confirmed'))
  )
);
commit;
