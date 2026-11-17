-- TEST FIXTURE ONLY. Not a migration, installer, production schema or policy.
-- The integration runner loads this only into its empty, disposable PG17 DB,
-- then loads the unchanged legacy session/frontdesk/archive migrations there.
do $$
begin
  if current_database() <> 'design_executor_synthetic'
    or current_setting('design_executor.synthetic_fixture',true) is distinct from 'offline-stage6-only'
    or current_setting('server_version_num')::integer / 10000 <> 17
    or exists(select 1 from pg_tables where schemaname='public')
    or exists(select 1 from pg_namespace where nspname='design_private') then
    raise exception 'SYNTHETIC_FIXTURE_REQUIRED';
  end if;
end $$;

create role anon;
create role authenticated;
create role service_role;
-- Only the bucket metadata columns used by the unchanged archive migration.
-- No object storage service, upload route or actual image data exists here.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null,
  file_size_limit bigint, allowed_mime_types text[]
);

-- Column-compatible synthetic subsets of existing source tables. The repository
-- does not contain their original full CREATE TABLE definitions. No rows, keys,
-- data, triggers or lifecycle meaning are inferred from a real database.
create table public.staff (
  id bigint generated always as identity primary key,
  username text not null,
  store text not null,
  position text not null default '',
  active boolean not null default true,
  employment_status text not null default 'active'
);
create table public.bookings (
  id bigint primary key,
  barber_name text not null,
  shop_name text not null,
  date date not null,
  status integer not null,
  customer_name text not null,
  customer_phone text not null
);
create table public.customer_profiles (
  id bigint primary key,
  name text not null,
  phone text not null,
  shop_name text not null,
  card_packages jsonb not null default '[]',
  service_history jsonb not null default '[]'
);

-- This private contract is an uninstalled proposal, not an existing live table.
create schema design_private;
revoke all on schema design_private from public,anon,authenticated;
create table design_private.runtime_contract (
  id boolean primary key check(id), version text not null
);
insert into design_private.runtime_contract values(true,'design-postgres-v1');
create table design_private.binding_versions (
  assignment_source text not null check(assignment_source in ('appointment','frontdesk')),
  visit_id text not null,
  revision integer not null check(revision between 1 and 256),
  request_id uuid not null unique,
  record jsonb not null check(jsonb_typeof(record)='object'),
  primary key(assignment_source,visit_id,revision),
  check(record->'visit'->>'assignmentSource'=assignment_source),
  check(record->'visit'->>'visitId'=visit_id),
  check((record->>'revision')::integer=revision),
  check((record->>'requestId')::uuid=request_id)
);
create table design_private.binding_requests (
  request_id uuid primary key,
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  check((receipt->>'requestId')::uuid=request_id)
);
create table design_private.binding_authorities (
  username text not null, store text not null,
  action text not null check(action in ('bind','reassign','revoke','restore')),
  allowed boolean not null,
  primary key(username,store,action)
);
create table design_private.binding_approvals (
  approval_hash text primary key check(approval_hash ~ '^[0-9a-f]{64}$'),
  receipt_id uuid not null unique,
  intent_sha256 text not null check(intent_sha256 ~ '^[0-9a-f]{64}$'),
  intent jsonb not null check(jsonb_typeof(intent)='object'),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  consumed_request_id uuid unique
);
create table design_private.lifecycle_decisions (
  assignment_source text not null check(assignment_source in ('appointment','frontdesk')),
  visit_id text not null,
  row_sha256 text not null check(row_sha256 ~ '^[0-9a-f]{64}$'),
  allowed boolean not null,
  policy_revision text not null,
  expires_at timestamptz not null,
  primary key(assignment_source,visit_id)
);
create table design_private.commit_checks (
  id uuid primary key, expires_at timestamptz not null
);
create function design_private.reject_rewrite() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'DESIGN_APPEND_ONLY' using errcode='42501'; end $$;
create trigger binding_versions_immutable before update or delete on design_private.binding_versions
  for each row execute function design_private.reject_rewrite();
create trigger binding_requests_immutable before update or delete on design_private.binding_requests
  for each row execute function design_private.reject_rewrite();
create trigger commit_checks_immutable before update or delete on design_private.commit_checks
  for each row execute function design_private.reject_rewrite();

create function design_private.check_commit_deadline() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.expires_at <= clock_timestamp() then
    raise exception 'DESIGN_COMMIT_DEADLINE_EXPIRED' using errcode='42501';
  end if;
  return new;
end $$;
create constraint trigger design_commit_deadline
  after insert on design_private.commit_checks deferrable initially deferred
  for each row execute function design_private.check_commit_deadline();

-- Restrict approval mutation to explicit revocation or one-time consumption.
create function design_private.guard_approval_update() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or
    (to_jsonb(old)-'revoked'-'consumed_request_id') is distinct from
    (to_jsonb(new)-'revoked'-'consumed_request_id') or
    (old.revoked and not new.revoked) or
    (old.consumed_request_id is not null and
      old.consumed_request_id is distinct from new.consumed_request_id) then
    raise exception 'DESIGN_APPROVAL_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
create trigger binding_approvals_guard before update or delete on design_private.binding_approvals
  for each row execute function design_private.guard_approval_update();

revoke all on all tables in schema design_private from public,anon,authenticated;
revoke all on all functions in schema design_private from public,anon,authenticated;
