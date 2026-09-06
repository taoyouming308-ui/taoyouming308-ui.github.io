-- Bind an authenticated Supabase user to exactly one active Salon staff identity
-- per organization. No browser grants are added.

set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.salon_staff add column auth_user_id uuid;
create unique index salon_staff_auth_user_org_idx
  on public.salon_staff(organization_id,auth_user_id) where auth_user_id is not null;
create index salon_staff_auth_lookup_idx
  on public.salon_staff(auth_user_id,employment_status) where auth_user_id is not null;

comment on column public.salon_staff.auth_user_id is
  'Server-resolved Supabase Auth user id. Never authorize from user_metadata or client-supplied staff/store ids.';
