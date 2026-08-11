-- ZYSYR V2 Sprint 0 foundation.
-- This migration is deliberately additive: v415 keeps reading the legacy columns
-- until company/store mappings and Supabase Auth accounts have been reconciled.

set statement_timeout = '30s';

create schema if not exists zysyr_private;
revoke all on schema zysyr_private from public, anon, authenticated, service_role;

create table if not exists public.zysyr_companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, code)
);

alter table public.zysyr_stores
  add column if not exists company_id uuid,
  add column if not exists code text,
  add column if not exists address text,
  add column if not exists manager_employee_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_company_id_fkey'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_company_id_fkey
      foreign key (company_id) references public.zysyr_companies(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_company_id_id_key'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_company_id_id_key unique (company_id, id);
  end if;
end $$;

create unique index if not exists zysyr_stores_company_code_uidx
  on public.zysyr_stores (company_id, code)
  where company_id is not null and code is not null;

create index if not exists zysyr_stores_company_status_idx
  on public.zysyr_stores (company_id, status, name)
  where company_id is not null;

create table if not exists public.zysyr_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zysyr_capabilities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  name text not null,
  risk_level text not null default 'normal' check (risk_level in ('normal', 'sensitive', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zysyr_role_capabilities (
  role_id uuid not null references public.zysyr_roles(id) on delete cascade,
  capability_id uuid not null references public.zysyr_capabilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, capability_id)
);

create index if not exists zysyr_role_capabilities_capability_idx
  on public.zysyr_role_capabilities (capability_id, role_id);

create table if not exists public.zysyr_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_code text not null,
  name text not null,
  position text not null,
  level text,
  join_date date,
  leave_date date,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive', 'departed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, employee_code),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  check (leave_date is null or join_date is null or leave_date >= join_date)
);

create index if not exists zysyr_employees_store_status_idx
  on public.zysyr_employees (company_id, store_id, employment_status, name)
  where deleted_at is null;

create table if not exists public.zysyr_user_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  employee_id uuid,
  display_name text not null,
  phone text,
  email text,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'disabled')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, employee_id)
    references public.zysyr_employees(company_id, id) on delete restrict
);

create unique index if not exists zysyr_user_accounts_company_employee_uidx
  on public.zysyr_user_accounts (company_id, employee_id)
  where employee_id is not null;

create index if not exists zysyr_user_accounts_company_status_idx
  on public.zysyr_user_accounts (company_id, status, display_name);

create table if not exists public.zysyr_user_role_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  user_account_id uuid not null,
  role_id uuid not null references public.zysyr_roles(id) on delete restrict,
  scope_type text not null check (scope_type in ('company', 'store')),
  store_id uuid,
  valid_from date not null default current_date,
  valid_to date,
  granted_by_user_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revoke_reason text,
  foreign key (company_id, user_account_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, granted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, revoked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (
    (scope_type = 'company' and store_id is null)
    or (scope_type = 'store' and store_id is not null)
  ),
  check (valid_to is null or valid_to >= valid_from),
  check (revoked_at is null or nullif(btrim(revoke_reason), '') is not null)
);

create unique index if not exists zysyr_user_role_company_active_uidx
  on public.zysyr_user_role_grants (company_id, user_account_id, role_id)
  where scope_type = 'company' and store_id is null and revoked_at is null;

create unique index if not exists zysyr_user_role_store_active_uidx
  on public.zysyr_user_role_grants (company_id, store_id, user_account_id, role_id)
  where scope_type = 'store' and revoked_at is null;

create index if not exists zysyr_user_role_scope_lookup_idx
  on public.zysyr_user_role_grants
  (user_account_id, company_id, store_id, valid_from, valid_to)
  where revoked_at is null;

create index if not exists zysyr_user_role_granted_by_idx
  on public.zysyr_user_role_grants (company_id, granted_by_user_id)
  where granted_by_user_id is not null;

create index if not exists zysyr_user_role_revoked_by_idx
  on public.zysyr_user_role_grants (company_id, revoked_by_user_id)
  where revoked_by_user_id is not null;

create table if not exists public.zysyr_user_capability_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  user_account_id uuid not null,
  capability_id uuid not null references public.zysyr_capabilities(id) on delete restrict,
  scope_type text not null check (scope_type in ('company', 'store')),
  store_id uuid,
  valid_from date not null default current_date,
  valid_to date,
  granted_by_user_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revoke_reason text,
  foreign key (company_id, user_account_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, granted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, revoked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (
    (scope_type = 'company' and store_id is null)
    or (scope_type = 'store' and store_id is not null)
  ),
  check (valid_to is null or valid_to >= valid_from),
  check (revoked_at is null or nullif(btrim(revoke_reason), '') is not null)
);

create unique index if not exists zysyr_user_capability_company_active_uidx
  on public.zysyr_user_capability_grants
  (company_id, user_account_id, capability_id)
  where scope_type = 'company' and store_id is null and revoked_at is null;

create unique index if not exists zysyr_user_capability_store_active_uidx
  on public.zysyr_user_capability_grants
  (company_id, store_id, user_account_id, capability_id)
  where scope_type = 'store' and revoked_at is null;

create index if not exists zysyr_user_capability_scope_lookup_idx
  on public.zysyr_user_capability_grants
  (user_account_id, company_id, store_id, valid_from, valid_to)
  where revoked_at is null;

create index if not exists zysyr_user_capability_granted_by_idx
  on public.zysyr_user_capability_grants (company_id, granted_by_user_id)
  where granted_by_user_id is not null;

create index if not exists zysyr_user_capability_revoked_by_idx
  on public.zysyr_user_capability_grants (company_id, revoked_by_user_id)
  where revoked_by_user_id is not null;

create table if not exists public.zysyr_employee_store_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  assignment_type text not null default 'primary'
    check (assignment_type in ('primary', 'secondary', 'temporary')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, employee_id)
    references public.zysyr_employees(company_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists zysyr_employee_store_assignment_uidx
  on public.zysyr_employee_store_assignments
  (company_id, store_id, employee_id, assignment_type, effective_from);

create index if not exists zysyr_employee_store_assignment_employee_idx
  on public.zysyr_employee_store_assignments
  (company_id, employee_id, effective_from, effective_to);

create table if not exists public.zysyr_audit_events (
  id bigint generated always as identity primary key,
  event_uuid uuid not null default gen_random_uuid() unique,
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  actor_type text not null check (actor_type in ('user', 'service', 'system')),
  actor_user_id uuid,
  service_actor text,
  request_id uuid,
  transaction_id bigint not null default txid_current(),
  channel text not null default 'api'
    check (channel in ('api', 'import', 'ocr', 'system', 'migration')),
  entity_type text not null,
  entity_id uuid,
  entity_key text,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  sensitivity text not null default 'normal'
    check (sensitivity in ('normal', 'personal', 'payroll')),
  created_at timestamptz not null default now(),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (entity_id is not null or nullif(btrim(entity_key), '') is not null),
  check (
    (actor_type = 'user' and actor_user_id is not null)
    or (actor_type in ('service', 'system') and nullif(btrim(service_actor), '') is not null)
  ),
  check (
    action not in ('amount_change', 'approve', 'reverse', 'unlock', 'voucher_relink', 'payroll_change', 'inventory_cost_change')
    or nullif(btrim(reason), '') is not null
  )
);

create index if not exists zysyr_audit_events_entity_idx
  on public.zysyr_audit_events (company_id, entity_type, entity_id, created_at desc);

create index if not exists zysyr_audit_events_scope_time_idx
  on public.zysyr_audit_events (company_id, store_id, created_at desc);

create index if not exists zysyr_audit_events_actor_idx
  on public.zysyr_audit_events (company_id, actor_user_id, created_at desc)
  where actor_user_id is not null;

create table if not exists public.zysyr_workflow_events (
  id bigint generated always as identity primary key,
  event_uuid uuid not null default gen_random_uuid() unique,
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  action text not null check (action in ('submit', 'approve', 'reject', 'confirm', 'reverse', 'void')),
  actor_user_id uuid,
  service_actor text,
  reason text,
  request_id uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (actor_user_id is not null or nullif(btrim(service_actor), '') is not null),
  check (action not in ('reject', 'reverse', 'void') or nullif(btrim(reason), '') is not null)
);

create index if not exists zysyr_workflow_events_entity_idx
  on public.zysyr_workflow_events (company_id, entity_type, entity_id, created_at desc);

create index if not exists zysyr_workflow_events_scope_idx
  on public.zysyr_workflow_events (company_id, store_id, created_at desc);

create index if not exists zysyr_workflow_events_actor_idx
  on public.zysyr_workflow_events (company_id, actor_user_id, created_at desc)
  where actor_user_id is not null;

create table if not exists public.zysyr_period_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  scope_type text not null check (scope_type in ('company', 'store')),
  store_id uuid,
  period_month date not null,
  status text not null default 'locked' check (status in ('locked', 'unlocked')),
  locked_by_user_id uuid,
  locked_at timestamptz,
  unlocked_by_user_id uuid,
  unlocked_at timestamptz,
  unlock_reason text,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, locked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, unlocked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (
    (scope_type = 'company' and store_id is null)
    or (scope_type = 'store' and store_id is not null)
  ),
  check (period_month = date_trunc('month', period_month)::date),
  check (status <> 'unlocked' or nullif(btrim(unlock_reason), '') is not null)
);

create unique index if not exists zysyr_period_lock_company_uidx
  on public.zysyr_period_locks (company_id, period_month)
  where scope_type = 'company' and store_id is null;

create unique index if not exists zysyr_period_lock_store_uidx
  on public.zysyr_period_locks (company_id, store_id, period_month)
  where scope_type = 'store';

create index if not exists zysyr_period_locks_locked_by_idx
  on public.zysyr_period_locks (company_id, locked_by_user_id)
  where locked_by_user_id is not null;

create index if not exists zysyr_period_locks_unlocked_by_idx
  on public.zysyr_period_locks (company_id, unlocked_by_user_id)
  where unlocked_by_user_id is not null;

create table if not exists public.zysyr_period_lock_events (
  id bigint generated always as identity primary key,
  event_uuid uuid not null default gen_random_uuid() unique,
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  period_lock_id uuid not null,
  action text not null check (action in ('lock', 'unlock')),
  actor_user_id uuid,
  service_actor text,
  reason text,
  request_id uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, period_lock_id)
    references public.zysyr_period_locks(company_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (actor_user_id is not null or nullif(btrim(service_actor), '') is not null),
  check (action <> 'unlock' or nullif(btrim(reason), '') is not null)
);

create index if not exists zysyr_period_lock_events_lock_idx
  on public.zysyr_period_lock_events (period_lock_id, created_at desc);

create index if not exists zysyr_period_lock_events_scope_idx
  on public.zysyr_period_lock_events (company_id, store_id, created_at desc);

create index if not exists zysyr_period_lock_events_actor_idx
  on public.zysyr_period_lock_events (company_id, actor_user_id, created_at desc)
  where actor_user_id is not null;

create table if not exists public.zysyr_trace_nodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, entity_type, entity_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict
);

create index if not exists zysyr_trace_nodes_scope_idx
  on public.zysyr_trace_nodes (company_id, store_id, entity_type);

create table if not exists public.zysyr_trace_edges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  from_node_id uuid not null,
  to_node_id uuid not null,
  relation_type text not null
    check (relation_type in ('derived_from', 'allocated_to', 'evidenced_by', 'reversed_by', 'contains')),
  source_amount numeric(14,2),
  source_quantity numeric(14,4),
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, from_node_id)
    references public.zysyr_trace_nodes(company_id, id) on delete restrict,
  foreign key (company_id, to_node_id)
    references public.zysyr_trace_nodes(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  unique (company_id, from_node_id, to_node_id, relation_type),
  check (from_node_id <> to_node_id)
);

create index if not exists zysyr_trace_edges_to_node_idx
  on public.zysyr_trace_edges (company_id, to_node_id, relation_type);

create index if not exists zysyr_trace_edges_scope_idx
  on public.zysyr_trace_edges (company_id, store_id, created_at desc);

create index if not exists zysyr_trace_edges_creator_idx
  on public.zysyr_trace_edges (company_id, created_by_user_id)
  where created_by_user_id is not null;

create table if not exists public.zysyr_legacy_id_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.zysyr_companies(id) on delete restrict,
  source_table text not null,
  source_key text not null,
  target_table text not null,
  target_id uuid not null,
  mapping_status text not null default 'mapped'
    check (mapping_status in ('mapped', 'ambiguous', 'quarantined')),
  note text,
  created_at timestamptz not null default now(),
  unique (source_table, source_key, target_table)
);

create index if not exists zysyr_legacy_id_map_target_idx
  on public.zysyr_legacy_id_map (target_table, target_id);

create index if not exists zysyr_legacy_id_map_company_status_idx
  on public.zysyr_legacy_id_map (company_id, mapping_status)
  where company_id is not null;

alter table public.zysyr_expense_records
  add column if not exists company_id uuid,
  add column if not exists store_id uuid,
  add column if not exists workflow_status text,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by_user_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_user_id uuid,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by_user_id uuid,
  add column if not exists reverse_reason text,
  add column if not exists created_by_user_id uuid,
  add column if not exists updated_by_user_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table public.zysyr_voucher_attachments
  add column if not exists company_id uuid,
  add column if not exists store_id uuid,
  add column if not exists sha256 text,
  add column if not exists storage_etag text,
  add column if not exists object_version text,
  add column if not exists immutable_version integer,
  add column if not exists supersedes_voucher_id uuid,
  add column if not exists uploaded_by_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_company_id_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_company_id_fkey
      foreign key (company_id) references public.zysyr_companies(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_company_store_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_company_store_fkey
      foreign key (company_id, store_id)
      references public.zysyr_stores(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_workflow_status_check'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_workflow_status_check
      check (workflow_status is null or workflow_status in ('draft', 'submitted', 'approved', 'paid', 'reversed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_submitted_by_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_submitted_by_fkey
      foreign key (company_id, submitted_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_approved_by_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_approved_by_fkey
      foreign key (company_id, approved_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_reversed_by_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_reversed_by_fkey
      foreign key (company_id, reversed_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_creator_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_creator_fkey
      foreign key (company_id, created_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_updater_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_updater_fkey
      foreign key (company_id, updated_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_deleter_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_deleter_fkey
      foreign key (company_id, deleted_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_company_id_id_key'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_company_id_id_key unique (company_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_company_id_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_company_id_fkey
      foreign key (company_id) references public.zysyr_companies(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_company_store_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_company_store_fkey
      foreign key (company_id, store_id)
      references public.zysyr_stores(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_supersedes_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_supersedes_fkey
      foreign key (company_id, supersedes_voucher_id)
      references public.zysyr_voucher_attachments(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_uploader_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_uploader_fkey
      foreign key (company_id, uploaded_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_sha256_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_sha256_check
      check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_version_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_version_check
      check (immutable_version is null or immutable_version > 0);
  end if;
end $$;

create index if not exists zysyr_expense_records_tenant_date_idx
  on public.zysyr_expense_records (company_id, store_id, expense_date desc)
  where company_id is not null and deleted_at is null;

create index if not exists zysyr_expense_records_tenant_status_idx
  on public.zysyr_expense_records (company_id, store_id, workflow_status, created_at desc)
  where company_id is not null and deleted_at is null;

create index if not exists zysyr_expense_records_submitted_by_idx
  on public.zysyr_expense_records (company_id, submitted_by_user_id)
  where submitted_by_user_id is not null;

create index if not exists zysyr_expense_records_approved_by_idx
  on public.zysyr_expense_records (company_id, approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists zysyr_expense_records_reversed_by_idx
  on public.zysyr_expense_records (company_id, reversed_by_user_id)
  where reversed_by_user_id is not null;

create index if not exists zysyr_expense_records_creator_idx
  on public.zysyr_expense_records (company_id, created_by_user_id)
  where created_by_user_id is not null;

create index if not exists zysyr_expense_records_updater_idx
  on public.zysyr_expense_records (company_id, updated_by_user_id)
  where updated_by_user_id is not null;

create index if not exists zysyr_expense_records_deleter_idx
  on public.zysyr_expense_records (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;

create index if not exists zysyr_voucher_attachments_tenant_uploaded_idx
  on public.zysyr_voucher_attachments (company_id, store_id, uploaded_at desc)
  where company_id is not null;

create index if not exists zysyr_voucher_attachments_company_sha_idx
  on public.zysyr_voucher_attachments (company_id, sha256)
  where company_id is not null and sha256 is not null;

create index if not exists zysyr_voucher_attachments_supersedes_idx
  on public.zysyr_voucher_attachments (company_id, supersedes_voucher_id)
  where supersedes_voucher_id is not null;

create index if not exists zysyr_voucher_attachments_uploader_idx
  on public.zysyr_voucher_attachments (company_id, uploaded_by_user_id)
  where uploaded_by_user_id is not null;

create table if not exists public.zysyr_voucher_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  voucher_id uuid not null,
  business_type text not null,
  business_id uuid not null,
  relation_type text not null default 'evidence'
    check (relation_type in ('evidence', 'payment_proof', 'source_document', 'replacement')),
  linked_by_user_id uuid,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlink_reason text,
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, linked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (unlinked_at is null or nullif(btrim(unlink_reason), '') is not null)
);

create unique index if not exists zysyr_voucher_links_active_uidx
  on public.zysyr_voucher_links
  (company_id, voucher_id, business_type, business_id, relation_type)
  where unlinked_at is null;

create index if not exists zysyr_voucher_links_business_idx
  on public.zysyr_voucher_links
  (company_id, store_id, business_type, business_id)
  where unlinked_at is null;

create index if not exists zysyr_voucher_links_linked_by_idx
  on public.zysyr_voucher_links (company_id, linked_by_user_id)
  where linked_by_user_id is not null;

insert into public.zysyr_roles (code, name)
values
  ('shareholder', '股东'),
  ('finance', '财务'),
  ('store_manager', '店长'),
  ('employee', '员工')
on conflict (code) do update set name = excluded.name, updated_at = now();

insert into public.zysyr_capabilities (code, name, risk_level)
values
  ('dashboard.group.read', '查看集团经营汇总', 'sensitive'),
  ('dashboard.store.read', '查看门店经营数据', 'sensitive'),
  ('voucher.read', '查看授权范围凭证', 'sensitive'),
  ('voucher.upload', '上传授权范围凭证', 'sensitive'),
  ('daily_report.write', '录入和提交日报', 'sensitive'),
  ('expense.create_submit', '录入和提交支出', 'sensitive'),
  ('expense.approve', '审核支出', 'high'),
  ('payment.confirm', '确认付款', 'high'),
  ('salary.read', '查看工资', 'high'),
  ('salary.write_approve', '维护和审核工资', 'high'),
  ('inventory.write', '维护采购库存', 'sensitive'),
  ('ai_insight.read', '查看AI经营分析', 'sensitive'),
  ('confirmed_finance.adjust', '调整已确认财务数据', 'high'),
  ('audit.read', '查看审计轨迹', 'high'),
  ('org.user.read', '查看组织账号与授权', 'high'),
  ('org.admin', '管理组织账号与授权', 'high'),
  ('employee.read', '查看授权范围员工资料', 'sensitive'),
  ('employee.self.read', '查看本人资料', 'normal'),
  ('report.lock', '锁账与受控解锁', 'high'),
  ('question.create', '发起经营数据问题', 'normal'),
  ('question.respond', '回复经营数据问题', 'sensitive')
on conflict (code) do update
set name = excluded.name, risk_level = excluded.risk_level, updated_at = now();

with role_capability(role_code, capability_code) as (
  values
    ('shareholder', 'dashboard.group.read'),
    ('shareholder', 'dashboard.store.read'),
    ('shareholder', 'voucher.read'),
    ('shareholder', 'salary.read'),
    ('shareholder', 'ai_insight.read'),
    ('shareholder', 'audit.read'),
    ('shareholder', 'question.create'),
    ('finance', 'dashboard.group.read'),
    ('finance', 'dashboard.store.read'),
    ('finance', 'voucher.read'),
    ('finance', 'voucher.upload'),
    ('finance', 'daily_report.write'),
    ('finance', 'expense.create_submit'),
    ('finance', 'expense.approve'),
    ('finance', 'payment.confirm'),
    ('finance', 'salary.read'),
    ('finance', 'salary.write_approve'),
    ('finance', 'inventory.write'),
    ('finance', 'ai_insight.read'),
    ('finance', 'confirmed_finance.adjust'),
    ('finance', 'audit.read'),
    ('finance', 'org.user.read'),
    ('finance', 'employee.read'),
    ('finance', 'report.lock'),
    ('finance', 'question.respond'),
    ('store_manager', 'dashboard.store.read'),
    ('store_manager', 'voucher.read'),
    ('store_manager', 'voucher.upload'),
    ('store_manager', 'daily_report.write'),
    ('store_manager', 'expense.create_submit'),
    ('store_manager', 'inventory.write'),
    ('store_manager', 'employee.read'),
    ('store_manager', 'question.create'),
    ('employee', 'employee.self.read')
)
insert into public.zysyr_role_capabilities (role_id, capability_id)
select r.id, c.id
from role_capability rc
join public.zysyr_roles r on r.code = rc.role_code
join public.zysyr_capabilities c on c.code = rc.capability_code
on conflict (role_id, capability_id) do nothing;

create or replace function zysyr_private.current_user_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ua.id
  from public.zysyr_user_accounts ua
  where (select auth.uid()) is not null
    and ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
  limit 1
$$;

create or replace function zysyr_private.has_company_membership(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg on urg.user_account_id = ua.id
    where ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and ua.company_id = target_company_id
      and urg.company_id = target_company_id
      and urg.revoked_at is null
      and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
  )
$$;

create or replace function zysyr_private.has_store_scope(
  target_company_id uuid,
  target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.zysyr_user_accounts ua
      join public.zysyr_user_role_grants urg on urg.user_account_id = ua.id
      where ua.auth_user_id = (select auth.uid())
        and ua.status = 'active'
        and ua.company_id = target_company_id
        and urg.company_id = target_company_id
        and urg.revoked_at is null
        and urg.valid_from <= current_date
        and (urg.valid_to is null or urg.valid_to >= current_date)
        and (
          urg.scope_type = 'company'
          or (urg.scope_type = 'store' and urg.store_id = target_store_id)
        )
    )
$$;

create or replace function zysyr_private.has_capability(
  target_company_id uuid,
  target_store_id uuid,
  target_capability_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.zysyr_user_accounts ua
    where ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and ua.company_id = target_company_id
      and (
        exists (
          select 1
          from public.zysyr_user_role_grants urg
          join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
          join public.zysyr_capabilities c on c.id = rc.capability_id
          where urg.user_account_id = ua.id
            and urg.company_id = target_company_id
            and urg.revoked_at is null
            and urg.valid_from <= current_date
            and (urg.valid_to is null or urg.valid_to >= current_date)
            and c.code = target_capability_code
            and (
              (target_store_id is null and urg.scope_type = 'company')
              or (target_store_id is not null and (
                urg.scope_type = 'company'
                or (urg.scope_type = 'store' and urg.store_id = target_store_id)
              ))
            )
        )
        or exists (
          select 1
          from public.zysyr_user_capability_grants ucg
          join public.zysyr_capabilities c on c.id = ucg.capability_id
          where ucg.user_account_id = ua.id
            and ucg.company_id = target_company_id
            and ucg.revoked_at is null
            and ucg.valid_from <= current_date
            and (ucg.valid_to is null or ucg.valid_to >= current_date)
            and c.code = target_capability_code
            and (
              (target_store_id is null and ucg.scope_type = 'company')
              or (target_store_id is not null and (
                ucg.scope_type = 'company'
                or (ucg.scope_type = 'store' and ucg.store_id = target_store_id)
              ))
            )
        )
      )
  )
$$;

create or replace function zysyr_private.is_self_employee(target_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.zysyr_user_accounts ua
    where ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and ua.employee_id = target_employee_id
  )
$$;

create or replace function zysyr_private.prevent_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ZYSYR event tables are append-only';
end
$$;

revoke execute on function zysyr_private.current_user_account_id() from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.has_company_membership(uuid) from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.has_store_scope(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.has_capability(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.is_self_employee(uuid) from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.prevent_event_mutation() from public, anon, authenticated, service_role;

grant usage on schema zysyr_private to authenticated;
grant execute on function zysyr_private.current_user_account_id() to authenticated;
grant execute on function zysyr_private.has_company_membership(uuid) to authenticated;
grant execute on function zysyr_private.has_store_scope(uuid, uuid) to authenticated;
grant execute on function zysyr_private.has_capability(uuid, uuid, text) to authenticated;
grant execute on function zysyr_private.is_self_employee(uuid) to authenticated;

drop trigger if exists zysyr_audit_events_immutable on public.zysyr_audit_events;
create trigger zysyr_audit_events_immutable
before update or delete on public.zysyr_audit_events
for each row execute function zysyr_private.prevent_event_mutation();

drop trigger if exists zysyr_workflow_events_immutable on public.zysyr_workflow_events;
create trigger zysyr_workflow_events_immutable
before update or delete on public.zysyr_workflow_events
for each row execute function zysyr_private.prevent_event_mutation();

drop trigger if exists zysyr_period_lock_events_immutable on public.zysyr_period_lock_events;
create trigger zysyr_period_lock_events_immutable
before update or delete on public.zysyr_period_lock_events
for each row execute function zysyr_private.prevent_event_mutation();

alter table public.zysyr_companies enable row level security;
alter table public.zysyr_stores enable row level security;
alter table public.zysyr_roles enable row level security;
alter table public.zysyr_capabilities enable row level security;
alter table public.zysyr_role_capabilities enable row level security;
alter table public.zysyr_employees enable row level security;
alter table public.zysyr_user_accounts enable row level security;
alter table public.zysyr_user_role_grants enable row level security;
alter table public.zysyr_user_capability_grants enable row level security;
alter table public.zysyr_employee_store_assignments enable row level security;
alter table public.zysyr_audit_events enable row level security;
alter table public.zysyr_workflow_events enable row level security;
alter table public.zysyr_period_locks enable row level security;
alter table public.zysyr_period_lock_events enable row level security;
alter table public.zysyr_trace_nodes enable row level security;
alter table public.zysyr_trace_edges enable row level security;
alter table public.zysyr_legacy_id_map enable row level security;
alter table public.zysyr_voucher_links enable row level security;

alter table public.zysyr_companies force row level security;
alter table public.zysyr_roles force row level security;
alter table public.zysyr_capabilities force row level security;
alter table public.zysyr_role_capabilities force row level security;
alter table public.zysyr_employees force row level security;
alter table public.zysyr_user_accounts force row level security;
alter table public.zysyr_user_role_grants force row level security;
alter table public.zysyr_user_capability_grants force row level security;
alter table public.zysyr_employee_store_assignments force row level security;
alter table public.zysyr_audit_events force row level security;
alter table public.zysyr_workflow_events force row level security;
alter table public.zysyr_period_locks force row level security;
alter table public.zysyr_period_lock_events force row level security;
alter table public.zysyr_trace_nodes force row level security;
alter table public.zysyr_trace_edges force row level security;
alter table public.zysyr_legacy_id_map force row level security;
alter table public.zysyr_voucher_links force row level security;

drop policy if exists zysyr_companies_member_select on public.zysyr_companies;
create policy zysyr_companies_member_select
on public.zysyr_companies for select to authenticated
using ((select zysyr_private.has_company_membership(id)));

drop policy if exists zysyr_stores_scope_select on public.zysyr_stores;
create policy zysyr_stores_scope_select
on public.zysyr_stores for select to authenticated
using ((select zysyr_private.has_store_scope(company_id, id)));

drop policy if exists zysyr_roles_authenticated_select on public.zysyr_roles;
create policy zysyr_roles_authenticated_select
on public.zysyr_roles for select to authenticated
using ((select auth.uid()) is not null);

drop policy if exists zysyr_capabilities_authenticated_select on public.zysyr_capabilities;
create policy zysyr_capabilities_authenticated_select
on public.zysyr_capabilities for select to authenticated
using ((select auth.uid()) is not null);

drop policy if exists zysyr_role_capabilities_authenticated_select on public.zysyr_role_capabilities;
create policy zysyr_role_capabilities_authenticated_select
on public.zysyr_role_capabilities for select to authenticated
using ((select auth.uid()) is not null);

drop policy if exists zysyr_user_accounts_self_or_org_select on public.zysyr_user_accounts;
create policy zysyr_user_accounts_self_or_org_select
on public.zysyr_user_accounts for select to authenticated
using (
  (select auth.uid()) = auth_user_id
  or (select zysyr_private.has_capability(company_id, null, 'org.user.read'))
);

drop policy if exists zysyr_user_role_grants_self_or_org_select on public.zysyr_user_role_grants;
create policy zysyr_user_role_grants_self_or_org_select
on public.zysyr_user_role_grants for select to authenticated
using (
  user_account_id = (select zysyr_private.current_user_account_id())
  or (select zysyr_private.has_capability(company_id, null, 'org.user.read'))
);

drop policy if exists zysyr_user_capability_grants_self_or_org_select on public.zysyr_user_capability_grants;
create policy zysyr_user_capability_grants_self_or_org_select
on public.zysyr_user_capability_grants for select to authenticated
using (
  user_account_id = (select zysyr_private.current_user_account_id())
  or (select zysyr_private.has_capability(company_id, null, 'org.user.read'))
);

drop policy if exists zysyr_employees_scope_select on public.zysyr_employees;
create policy zysyr_employees_scope_select
on public.zysyr_employees for select to authenticated
using (
  (select zysyr_private.is_self_employee(id))
  or (select zysyr_private.has_capability(company_id, store_id, 'employee.read'))
);

drop policy if exists zysyr_employee_assignments_scope_select on public.zysyr_employee_store_assignments;
create policy zysyr_employee_assignments_scope_select
on public.zysyr_employee_store_assignments for select to authenticated
using (
  (select zysyr_private.is_self_employee(employee_id))
  or (select zysyr_private.has_capability(company_id, store_id, 'employee.read'))
);

drop policy if exists zysyr_audit_events_scope_select on public.zysyr_audit_events;
create policy zysyr_audit_events_scope_select
on public.zysyr_audit_events for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'audit.read')));

drop policy if exists zysyr_workflow_events_scope_select on public.zysyr_workflow_events;
create policy zysyr_workflow_events_scope_select
on public.zysyr_workflow_events for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'audit.read')));

drop policy if exists zysyr_period_locks_scope_select on public.zysyr_period_locks;
create policy zysyr_period_locks_scope_select
on public.zysyr_period_locks for select to authenticated
using (
  (scope_type = 'company' and (select zysyr_private.has_company_membership(company_id)))
  or (scope_type = 'store' and (select zysyr_private.has_store_scope(company_id, store_id)))
);

drop policy if exists zysyr_period_lock_events_scope_select on public.zysyr_period_lock_events;
create policy zysyr_period_lock_events_scope_select
on public.zysyr_period_lock_events for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'audit.read')));

revoke all on table public.zysyr_companies from public, anon, authenticated, service_role;
revoke all on table public.zysyr_roles from public, anon, authenticated, service_role;
revoke all on table public.zysyr_capabilities from public, anon, authenticated, service_role;
revoke all on table public.zysyr_role_capabilities from public, anon, authenticated, service_role;
revoke all on table public.zysyr_employees from public, anon, authenticated, service_role;
revoke all on table public.zysyr_user_accounts from public, anon, authenticated, service_role;
revoke all on table public.zysyr_user_role_grants from public, anon, authenticated, service_role;
revoke all on table public.zysyr_user_capability_grants from public, anon, authenticated, service_role;
revoke all on table public.zysyr_employee_store_assignments from public, anon, authenticated, service_role;
revoke all on table public.zysyr_audit_events from public, anon, authenticated, service_role;
revoke all on table public.zysyr_workflow_events from public, anon, authenticated, service_role;
revoke all on table public.zysyr_period_locks from public, anon, authenticated, service_role;
revoke all on table public.zysyr_period_lock_events from public, anon, authenticated, service_role;
revoke all on table public.zysyr_trace_nodes from public, anon, authenticated, service_role;
revoke all on table public.zysyr_trace_edges from public, anon, authenticated, service_role;
revoke all on table public.zysyr_legacy_id_map from public, anon, authenticated, service_role;
revoke all on table public.zysyr_voucher_links from public, anon, authenticated, service_role;

grant select on table
  public.zysyr_companies,
  public.zysyr_stores,
  public.zysyr_roles,
  public.zysyr_capabilities,
  public.zysyr_role_capabilities,
  public.zysyr_employees,
  public.zysyr_user_accounts,
  public.zysyr_user_role_grants,
  public.zysyr_user_capability_grants,
  public.zysyr_employee_store_assignments,
  public.zysyr_audit_events,
  public.zysyr_workflow_events,
  public.zysyr_period_locks,
  public.zysyr_period_lock_events
to authenticated;

grant select, insert, update, delete on table
  public.zysyr_companies,
  public.zysyr_roles,
  public.zysyr_capabilities,
  public.zysyr_role_capabilities,
  public.zysyr_employees,
  public.zysyr_user_accounts,
  public.zysyr_user_role_grants,
  public.zysyr_user_capability_grants,
  public.zysyr_employee_store_assignments,
  public.zysyr_legacy_id_map
to service_role;

grant select, insert, update on table public.zysyr_period_locks to service_role;
grant select, insert on table
  public.zysyr_audit_events,
  public.zysyr_workflow_events,
  public.zysyr_period_lock_events
to service_role;

grant select on table
  public.zysyr_trace_nodes,
  public.zysyr_trace_edges,
  public.zysyr_voucher_links
to service_role;

grant usage, select on sequence public.zysyr_audit_events_id_seq to service_role;
grant usage, select on sequence public.zysyr_workflow_events_id_seq to service_role;
grant usage, select on sequence public.zysyr_period_lock_events_id_seq to service_role;

comment on table public.zysyr_user_accounts is
  'Supabase Auth identity mapping. Authorization comes from server-managed role/capability grants, never user_metadata.';
comment on table public.zysyr_audit_events is
  'Append-only audit trail. Application and service roles have no UPDATE or DELETE privilege.';
comment on table public.zysyr_trace_edges is
  'Trace graph foundation. Direct writes remain disabled until tenant-validating RPC functions are introduced.';
comment on column public.zysyr_expense_records.company_id is
  'V2 additive tenant key. Remains nullable until the reviewed legacy store mapping is backfilled.';
comment on column public.zysyr_voucher_attachments.sha256 is
  'V2 immutable-file digest. Remains nullable only for legacy objects pending a verified storage inventory.';
