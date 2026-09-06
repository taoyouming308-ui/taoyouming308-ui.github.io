-- Minimal API outcome log. Deliberately excludes tokens, request bodies,
-- customer names, phones, payment details and financial amounts.
set statement_timeout='30s';set lock_timeout='5s';
create table public.salon_api_request_logs(
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  auth_user_id uuid,
  organization_id bigint,
  store_id bigint,
  staff_id bigint,
  operation text not null default '',
  outcome text not null check(outcome in ('success','rejected','failed')),
  http_status integer not null check(http_status between 200 and 599),
  error_code text,
  duration_ms integer not null check(duration_ms>=0),
  occurred_at timestamptz not null default now(),
  foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
  foreign key(organization_id,staff_id) references public.salon_staff(organization_id,id) on delete restrict
);
create index salon_api_request_logs_scope_idx on public.salon_api_request_logs(organization_id,store_id,occurred_at desc);
alter table public.salon_api_request_logs enable row level security;
alter table public.salon_api_request_logs force row level security;
revoke all on table public.salon_api_request_logs from public,anon,authenticated;
grant all on table public.salon_api_request_logs to service_role;
comment on table public.salon_api_request_logs is 'Metadata-only request outcomes for correlation; never store credentials, payloads, customer PII or amounts.';
