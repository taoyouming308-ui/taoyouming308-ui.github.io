-- ZYSYR V2 Gate C local foundation: rolling username/password migration.
-- No user is allowlisted by this migration, so deploying the schema alone
-- cannot create an Auth user or grant access. Approved principals are added
-- later in a separate, exact data migration.

set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.zysyr_user_accounts
  add column if not exists login_name text;

create unique index if not exists zysyr_user_accounts_company_login_name_uidx
  on public.zysyr_user_accounts (company_id, lower(btrim(login_name)))
  where login_name is not null;

comment on column public.zysyr_user_accounts.login_name is
  'User-facing sign-in name. Supabase Auth internal email identifiers are never shown as business contact details.';

create table if not exists public.zysyr_auth_migration_allowlist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  employee_id uuid not null,
  legacy_staff_id integer not null references public.staff(id) on delete restrict,
  login_name text not null check (btrim(login_name) <> '' and char_length(login_name) <= 80),
  role_id uuid not null references public.zysyr_roles(id) on delete restrict,
  scope_type text not null check (scope_type in ('company', 'store')),
  store_id uuid,
  status text not null default 'approved' check (status in ('approved', 'disabled')),
  approved_by text not null check (btrim(approved_by) <> '' and char_length(approved_by) <= 120),
  approval_reason text not null check (btrim(approval_reason) <> ''),
  approval_reference text check (approval_reference is null or btrim(approval_reference) <> ''),
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, employee_id),
  unique (legacy_staff_id),
  foreign key (company_id, employee_id)
    references public.zysyr_employees(company_id, id) on delete restrict,
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  check (
    (scope_type = 'company' and store_id is null)
    or (scope_type = 'store' and store_id is not null)
  ),
  check (expires_at is null or expires_at > approved_at)
);

create unique index if not exists zysyr_auth_migration_allowlist_company_login_uidx
  on public.zysyr_auth_migration_allowlist (company_id, lower(btrim(login_name)));

create index if not exists zysyr_auth_migration_allowlist_role_idx
  on public.zysyr_auth_migration_allowlist (role_id);

create index if not exists zysyr_auth_migration_allowlist_store_idx
  on public.zysyr_auth_migration_allowlist (company_id, store_id)
  where store_id is not null;

comment on table public.zysyr_auth_migration_allowlist is
  'Explicit approvals for rolling legacy-password migration. Empty by default; position names and user metadata never grant access.';

create table if not exists public.zysyr_auth_migration_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  identity_hash text not null check (identity_hash ~ '^[0-9a-f]{64}$'),
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  event_type text not null check (event_type in ('attempt', 'blocked', 'failure', 'success')),
  reason_code text not null check (btrim(reason_code) <> '' and char_length(reason_code) <= 80),
  created_at timestamptz not null default now(),
  unique (request_id, event_type)
);

create index if not exists zysyr_auth_migration_events_identity_time_idx
  on public.zysyr_auth_migration_events (identity_hash, created_at desc)
  where event_type = 'attempt';

create index if not exists zysyr_auth_migration_events_client_time_idx
  on public.zysyr_auth_migration_events (client_hash, created_at desc)
  where event_type = 'attempt';

comment on table public.zysyr_auth_migration_events is
  'Append-only pre-authentication rate-limit telemetry. Usernames and client addresses are HMAC-SHA256 values, never plaintext.';

drop trigger if exists zysyr_auth_migration_events_immutable on public.zysyr_auth_migration_events;
create trigger zysyr_auth_migration_events_immutable
before update or delete on public.zysyr_auth_migration_events
for each row execute function zysyr_private.prevent_event_mutation();

create or replace function public.zysyr_begin_auth_migration(
  p_identity_hash text,
  p_client_hash text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity_attempts integer;
  v_client_attempts integer;
begin
  if p_identity_hash !~ '^[0-9a-f]{64}$'
     or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid authentication migration fingerprint';
  end if;

  -- Serialize both dimensions independently so concurrent requests cannot
  -- evade either the per-identity or per-client window by changing the other.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('identity:' || p_identity_hash, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('client:' || p_client_hash, 0)
  );

  select count(*) into v_identity_attempts
  from public.zysyr_auth_migration_events
  where identity_hash = p_identity_hash
    and event_type = 'attempt'
    and created_at >= now() - interval '15 minutes';

  select count(*) into v_client_attempts
  from public.zysyr_auth_migration_events
  where client_hash = p_client_hash
    and event_type = 'attempt'
    and created_at >= now() - interval '15 minutes';

  if v_identity_attempts >= 5 or v_client_attempts >= 30 then
    insert into public.zysyr_auth_migration_events (
      request_id, identity_hash, client_hash, event_type, reason_code
    ) values (
      p_request_id, p_identity_hash, p_client_hash, 'blocked', 'rate_limit'
    );
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 900);
  end if;

  insert into public.zysyr_auth_migration_events (
    request_id, identity_hash, client_hash, event_type, reason_code
  ) values (
    p_request_id, p_identity_hash, p_client_hash, 'attempt', 'started'
  );

  return jsonb_build_object('allowed', true);
end
$$;

create or replace function public.zysyr_record_auth_migration_result(
  p_identity_hash text,
  p_client_hash text,
  p_request_id uuid,
  p_event_type text,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_identity_hash !~ '^[0-9a-f]{64}$'
     or p_client_hash !~ '^[0-9a-f]{64}$'
     or p_event_type not in ('failure', 'success')
     or nullif(btrim(p_reason_code), '') is null
     or char_length(p_reason_code) > 80 then
    raise exception 'invalid authentication migration result';
  end if;

  insert into public.zysyr_auth_migration_events (
    request_id, identity_hash, client_hash, event_type, reason_code
  ) values (
    p_request_id, p_identity_hash, p_client_hash, p_event_type, p_reason_code
  );
end
$$;

create or replace function public.zysyr_complete_auth_migration(
  p_allowlist_id uuid,
  p_auth_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approved record;
  v_auth record;
  v_account record;
  v_account_count integer;
  v_account_id uuid;
  v_expected_email text;
begin
  select
    a.*,
    e.employee_code,
    e.name as employee_name,
    e.employment_status as employee_status,
    s.username as legacy_username,
    s.active as legacy_active,
    s.employment_status as legacy_employment_status,
    r.code as role_code,
    st.code as store_code
  into v_approved
  from public.zysyr_auth_migration_allowlist a
  join public.zysyr_employees e
    on e.company_id = a.company_id and e.id = a.employee_id
  join public.staff s
    on s.id = a.legacy_staff_id
  join public.zysyr_legacy_id_map m
    on m.company_id = a.company_id
   and m.source_table = 'staff'
   and m.source_key = a.legacy_staff_id::text
   and m.target_table = 'zysyr_employees'
   and m.target_id = a.employee_id
   and m.mapping_status = 'mapped'
  join public.zysyr_roles r
    on r.id = a.role_id and r.status = 'active'
  left join public.zysyr_stores st
    on st.company_id = a.company_id and st.id = a.store_id
  where a.id = p_allowlist_id
  for update of a;

  if not found
     or v_approved.status <> 'approved'
     or (v_approved.expires_at is not null and v_approved.expires_at <= now())
     or not coalesce(v_approved.legacy_active, false)
     or v_approved.legacy_employment_status <> 'active'
     or v_approved.employee_status <> 'active'
     or lower(btrim(v_approved.legacy_username)) <> lower(btrim(v_approved.login_name)) then
    raise exception 'authentication migration approval is not active';
  end if;

  v_expected_email := 'legacy_staff_' || v_approved.legacy_staff_id::text || '@auth.zysyr.invalid';

  select id, email, email_confirmed_at, raw_app_meta_data
  into v_auth
  from auth.users
  where id = p_auth_user_id;

  if not found
     or lower(coalesce(v_auth.email, '')) <> v_expected_email
     or v_auth.email_confirmed_at is null
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_employee_id', '') <> v_approved.employee_id::text
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_allowlist_id', '') <> v_approved.id::text then
    raise exception 'Supabase Auth identity does not match the approved employee';
  end if;

  select count(*) into v_account_count
  from public.zysyr_user_accounts
  where auth_user_id = p_auth_user_id
     or employee_id = v_approved.employee_id;

  if v_account_count > 1 then
    raise exception 'conflicting ZYSYR account mappings found';
  end if;

  select * into v_account
  from public.zysyr_user_accounts
  where auth_user_id = p_auth_user_id
     or employee_id = v_approved.employee_id
  limit 1
  for update;

  if found then
    if v_account.auth_user_id <> p_auth_user_id
       or v_account.company_id <> v_approved.company_id
       or v_account.employee_id <> v_approved.employee_id
       or lower(btrim(coalesce(v_account.login_name, ''))) <> lower(btrim(v_approved.login_name)) then
      raise exception 'existing ZYSYR account mapping conflicts with approval';
    end if;
    if v_account.status not in ('invited', 'active') then
      raise exception 'existing ZYSYR account is not eligible for activation';
    end if;
    v_account_id := v_account.id;
    if v_account.status = 'invited' then
      update public.zysyr_user_accounts
      set status = 'active', activated_at = coalesce(activated_at, now())
      where id = v_account_id;
    end if;
  else
    insert into public.zysyr_user_accounts (
      company_id,
      auth_user_id,
      employee_id,
      display_name,
      login_name,
      status,
      activated_at
    ) values (
      v_approved.company_id,
      p_auth_user_id,
      v_approved.employee_id,
      v_approved.employee_name,
      v_approved.login_name,
      'active',
      now()
    ) returning id into v_account_id;
  end if;

  if not exists (
    select 1
    from public.zysyr_user_role_grants g
    where g.company_id = v_approved.company_id
      and g.user_account_id = v_account_id
      and g.role_id = v_approved.role_id
      and g.scope_type = v_approved.scope_type
      and g.store_id is not distinct from v_approved.store_id
      and g.revoked_at is null
      and g.valid_from <= current_date
      and (g.valid_to is null or g.valid_to >= current_date)
  ) then
    insert into public.zysyr_user_role_grants (
      company_id,
      user_account_id,
      role_id,
      scope_type,
      store_id,
      valid_from
    ) values (
      v_approved.company_id,
      v_account_id,
      v_approved.role_id,
      v_approved.scope_type,
      v_approved.store_id,
      current_date
    );
  end if;

  if not exists (
    select 1
    from public.zysyr_audit_events
    where company_id = v_approved.company_id
      and entity_type = 'user_account'
      and entity_id = v_account_id
      and action = 'legacy_password_auth_activated'
  ) then
    insert into public.zysyr_audit_events (
      company_id,
      store_id,
      actor_type,
      service_actor,
      request_id,
      channel,
      entity_type,
      entity_id,
      action,
      after_json,
      reason,
      sensitivity
    ) values (
      v_approved.company_id,
      v_approved.store_id,
      'system',
      'operations_auth_migrate',
      p_request_id,
      'api',
      'user_account',
      v_account_id,
      'legacy_password_auth_activated',
      jsonb_build_object(
        'employee_id', v_approved.employee_id,
        'legacy_staff_id', v_approved.legacy_staff_id,
        'role_code', v_approved.role_code,
        'scope_type', v_approved.scope_type,
        'store_id', v_approved.store_id,
        'allowlist_id', v_approved.id,
        'approved_by', v_approved.approved_by,
        'approval_reference', v_approved.approval_reference,
        'password_source', 'verified_once_then_rehashed_by_supabase_auth'
      ),
      v_approved.approval_reason,
      'personal'
    );
  end if;

  return jsonb_build_object(
    'account_id', v_account_id,
    'company_id', v_approved.company_id,
    'employee_id', v_approved.employee_id,
    'display_name', v_approved.employee_name,
    'login_name', v_approved.login_name,
    'status', 'active',
    'role_code', v_approved.role_code,
    'scope_type', v_approved.scope_type,
    'store_id', v_approved.store_id,
    'store_code', v_approved.store_code
  );
end
$$;

alter table public.zysyr_auth_migration_allowlist enable row level security;
alter table public.zysyr_auth_migration_allowlist force row level security;
alter table public.zysyr_auth_migration_events enable row level security;
alter table public.zysyr_auth_migration_events force row level security;

revoke all on table public.zysyr_auth_migration_allowlist from public, anon, authenticated, service_role;
revoke all on table public.zysyr_auth_migration_events from public, anon, authenticated, service_role;
grant select on table public.zysyr_auth_migration_allowlist to service_role;
grant select, insert on table public.zysyr_auth_migration_events to service_role;

revoke execute on function public.zysyr_begin_auth_migration(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_record_auth_migration_result(text, text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_complete_auth_migration(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.zysyr_begin_auth_migration(text, text, uuid) to service_role;
grant execute on function public.zysyr_record_auth_migration_result(text, text, uuid, text, text) to service_role;
grant execute on function public.zysyr_complete_auth_migration(uuid, uuid, uuid) to service_role;
