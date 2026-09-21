-- Apply only after staff-access-api and compatible clients are deployed.
-- Public clients retain the existing non-sensitive directory, never credentials.
alter table public.staff enable row level security;
revoke all on public.staff from public,anon,authenticated;
revoke all(id,username,password_hash,role,store,position,active,employment_status,created_at) on public.staff from public,anon,authenticated;
grant select(id,username,role,store,position,active,employment_status,created_at) on public.staff to anon,authenticated;
create policy staff_directory_read on public.staff for select to anon,authenticated using (true);
grant all on public.staff to service_role;
