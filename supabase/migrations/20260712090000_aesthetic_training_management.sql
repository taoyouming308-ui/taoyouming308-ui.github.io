create table if not exists public.aesthetic_training_policies (
  username text primary key,
  store text not null default '',
  daily_limit integer not null default 1 check (daily_limit between 0 and 20),
  access_status text not null default 'enabled' check (access_status in ('enabled','paused','disabled')),
  reason text not null default '',
  disabled_until timestamptz,
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aesthetic_training_admin_sessions (
  token_hash text primary key,
  username text not null,
  role text not null check (role in ('admin','store_admin')),
  store text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.aesthetic_training_admin_audit (
  id uuid primary key default gen_random_uuid(),
  operator text not null,
  operator_role text not null,
  operator_store text not null default '',
  username text not null,
  action text not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table public.aesthetic_training_sessions
  drop constraint if exists aesthetic_training_sessions_username_business_date_key;

create index if not exists aesthetic_training_policies_store_idx
  on public.aesthetic_training_policies(store, username);
create index if not exists aesthetic_training_admin_sessions_expiry_idx
  on public.aesthetic_training_admin_sessions(expires_at);
create index if not exists aesthetic_training_admin_audit_user_idx
  on public.aesthetic_training_admin_audit(username, created_at desc);

alter table public.aesthetic_training_policies enable row level security;
alter table public.aesthetic_training_admin_sessions enable row level security;
alter table public.aesthetic_training_admin_audit enable row level security;

revoke all on public.aesthetic_training_policies from anon, authenticated;
revoke all on public.aesthetic_training_admin_sessions from anon, authenticated;
revoke all on public.aesthetic_training_admin_audit from anon, authenticated;

grant all on public.aesthetic_training_policies to service_role;
grant all on public.aesthetic_training_admin_sessions to service_role;
grant all on public.aesthetic_training_admin_audit to service_role;
