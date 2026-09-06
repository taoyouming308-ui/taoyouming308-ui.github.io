-- Short-lived server-side sessions for the employee appointment screen.
-- The browser receives only an opaque token. Customer and password data remain
-- behind employee-bookings-api; this table is never exposed to public clients.

create table if not exists public.employee_booking_sessions (
  token_hash text primary key,
  username text not null,
  store text not null,
  position text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists employee_booking_sessions_expiry_idx
  on public.employee_booking_sessions (expires_at);

create index if not exists employee_booking_sessions_staff_idx
  on public.employee_booking_sessions (store, username, expires_at desc);

alter table public.employee_booking_sessions enable row level security;
revoke all on table public.employee_booking_sessions from public, anon, authenticated;
grant all on table public.employee_booking_sessions to service_role;

comment on table public.employee_booking_sessions is
  'Opaque employee-app sessions used by the read-only merged appointment API.';;
