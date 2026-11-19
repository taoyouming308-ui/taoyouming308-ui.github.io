-- TEST-ONLY additive identity/capability slice. Never install as a migration.
-- Existing legacy/workflow/candidate rows and their hashes are not rewritten.
do $$ begin
  if current_database()<>'design_executor_synthetic'
    or current_setting('design_executor.synthetic_fixture',true) is distinct from 'offline-stage6-only'
    or current_setting('server_version_num')::integer/10000<>17
    or to_regclass('design_private.runtime_contract') is null
    or to_regclass('public.bookings') is null
    or to_regclass('public.frontdesk_today_customers') is null
    or exists(select 1 from pg_catalog.pg_namespace where nspname='design_identity')
    or exists(select 1 from pg_catalog.pg_roles where rolname in ('design_identity_runtime','design_identity_capability','design_identity_owner')) then
    raise exception 'SYNTHETIC_IDENTITY_FIXTURE_REQUIRED';
  end if;
end $$;

-- No password is created. LOGIN works only inside the disposable trust fixture.
create role design_identity_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role design_identity_capability nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role design_identity_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
revoke create,temporary on database design_executor_synthetic from public;
revoke create on schema public from public;
grant connect on database design_executor_synthetic to design_identity_runtime;
create schema design_identity authorization design_identity_owner;
revoke all on schema design_identity from public,anon,authenticated;
grant usage on schema design_identity to design_identity_runtime,design_identity_capability;
-- Installation-only ownership transfer prerequisite, revoked at the end.
grant create on schema design_identity to design_identity_capability;

create table design_identity.subjects (
  subject_id text primary key check(length(subject_id) between 1 and 160),
  security_epoch bigint not null check(security_epoch between 1 and 9007199254740991),
  active boolean not null
);
create table design_identity.employments (
  employment_id text primary key check(length(employment_id) between 1 and 160),
  subject_id text not null references design_identity.subjects(subject_id),
  active boolean not null,
  unique(employment_id,subject_id)
);
create table design_identity.stores (
  store_id text primary key check(length(store_id) between 1 and 160),
  label text not null unique check(length(label) between 1 and 100),
  active boolean not null
);
create table design_identity.memberships (
  membership_id text primary key check(length(membership_id) between 1 and 160),
  employment_id text not null references design_identity.employments(employment_id),
  store_id text not null references design_identity.stores(store_id),
  membership_revision bigint not null check(membership_revision between 1 and 9007199254740991),
  active boolean not null,
  unique(membership_id,employment_id),unique(membership_id,store_id)
);
create table design_identity.aliases (
  alias_id text primary key check(length(alias_id) between 1 and 160),
  membership_id text not null,
  store_id text not null,
  username text not null check(length(username) between 1 and 80),
  active boolean not null,
  foreign key(membership_id,store_id) references design_identity.memberships(membership_id,store_id)
);
create unique index identity_active_alias_per_membership on design_identity.aliases(membership_id) where active;
create unique index identity_active_alias_per_store on design_identity.aliases(username,store_id) where active;
create table design_identity.sessions (
  session_hash text primary key check(session_hash ~ '^[a-f0-9]{64}$'),
  subject_id text not null,
  employment_id text not null,
  membership_id text not null,
  security_epoch bigint not null check(security_epoch between 1 and 9007199254740991),
  membership_revision bigint not null check(membership_revision between 1 and 9007199254740991),
  expires_at timestamptz not null,
  revoked boolean not null,
  foreign key(employment_id,subject_id) references design_identity.employments(employment_id,subject_id),
  foreign key(membership_id,employment_id) references design_identity.memberships(membership_id,employment_id)
);
-- Current explicit binding head. The existing v1 binding history is not an ID
-- mapping, so no row is imported or associated by matching a username/phone.
create table design_identity.visit_bindings (
  assignment_source text not null check(assignment_source in ('appointment','frontdesk')),
  visit_id text not null,
  customer_profile_id bigint not null references public.customer_profiles(id),
  membership_id text not null,
  store_id text not null,
  business_date date not null,
  binding_revision bigint not null check(binding_revision between 1 and 9007199254740991),
  active boolean not null,
  primary key(assignment_source,visit_id),
  foreign key(membership_id,store_id) references design_identity.memberships(membership_id,store_id)
);
create table design_identity.transaction_contexts (
  session_login name not null,
  backend_pid integer not null,
  transaction_id bigint not null,
  session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  authority jsonb not null check(jsonb_typeof(authority)='object'),
  expires_at timestamptz not null,
  primary key(session_login,backend_pid,transaction_id)
);
create table design_identity.scope_records (
  record_id text primary key,
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  store_id text not null references design_identity.stores(store_id),
  payload jsonb not null
);

alter table design_identity.subjects owner to design_identity_owner;
alter table design_identity.employments owner to design_identity_owner;
alter table design_identity.stores owner to design_identity_owner;
alter table design_identity.memberships owner to design_identity_owner;
alter table design_identity.aliases owner to design_identity_owner;
alter table design_identity.sessions owner to design_identity_owner;
alter table design_identity.visit_bindings owner to design_identity_owner;
alter table design_identity.transaction_contexts owner to design_identity_owner;
alter table design_identity.scope_records owner to design_identity_owner;
alter table design_identity.subjects enable row level security;
alter table design_identity.subjects force row level security;
alter table design_identity.employments enable row level security;
alter table design_identity.employments force row level security;
alter table design_identity.stores enable row level security;
alter table design_identity.stores force row level security;
alter table design_identity.memberships enable row level security;
alter table design_identity.memberships force row level security;
alter table design_identity.aliases enable row level security;
alter table design_identity.aliases force row level security;
alter table design_identity.sessions enable row level security;
alter table design_identity.sessions force row level security;
alter table design_identity.visit_bindings enable row level security;
alter table design_identity.visit_bindings force row level security;
alter table design_identity.transaction_contexts enable row level security;
alter table design_identity.transaction_contexts force row level security;
alter table design_identity.scope_records enable row level security;
alter table design_identity.scope_records force row level security;

-- Authority metadata is inaccessible to the caller. Static capability-role
-- policies avoid recursive RLS; fixed functions perform exact token/scope checks.
create policy identity_subject_read on design_identity.subjects for select to design_identity_capability using(true);
create policy identity_subject_lock on design_identity.subjects for update to design_identity_capability using(true) with check(true);
create policy identity_employment_read on design_identity.employments for select to design_identity_capability using(true);
create policy identity_employment_lock on design_identity.employments for update to design_identity_capability using(true) with check(true);
create policy identity_store_read on design_identity.stores for select to design_identity_capability using(true);
create policy identity_store_lock on design_identity.stores for update to design_identity_capability using(true) with check(true);
create policy identity_membership_read on design_identity.memberships for select to design_identity_capability using(true);
create policy identity_membership_lock on design_identity.memberships for update to design_identity_capability using(true) with check(true);
create policy identity_alias_read on design_identity.aliases for select to design_identity_capability using(true);
create policy identity_alias_lock on design_identity.aliases for update to design_identity_capability using(true) with check(true);
create policy identity_session_read on design_identity.sessions for select to design_identity_capability using(true);
create policy identity_session_lock on design_identity.sessions for update to design_identity_capability using(true) with check(true);
create policy identity_binding_read on design_identity.visit_bindings for select to design_identity_capability using(true);
create policy identity_binding_lock on design_identity.visit_bindings for update to design_identity_capability using(true) with check(true);
create policy identity_context_control on design_identity.transaction_contexts for all to design_identity_capability using(true) with check(true);

grant select on design_identity.subjects,design_identity.employments,design_identity.stores,design_identity.memberships,design_identity.aliases,design_identity.sessions,design_identity.visit_bindings to design_identity_capability;
-- PostgreSQL locking SELECT requires UPDATE on at least one column. These
-- identifier-only grants belong to the non-login function role, never runtime.
grant update(subject_id) on design_identity.subjects to design_identity_capability;
grant update(employment_id) on design_identity.employments to design_identity_capability;
grant update(store_id) on design_identity.stores to design_identity_capability;
grant update(membership_id) on design_identity.memberships to design_identity_capability;
grant update(alias_id) on design_identity.aliases to design_identity_capability;
grant update(session_hash) on design_identity.sessions to design_identity_capability;
grant update(visit_id) on design_identity.visit_bindings to design_identity_capability;
grant select,insert,update,delete on design_identity.transaction_contexts to design_identity_capability;
grant select,update(record_id) on design_identity.scope_records to design_identity_capability;

grant usage on schema public,design_private to design_identity_capability;
grant select(token_hash,username,store,expires_at),update(token_hash) on public.employee_booking_sessions to design_identity_capability;
grant select(username,store,active,employment_status),update(username) on public.staff to design_identity_capability;
grant select(id,barber_name,shop_name,date,status),update(id) on public.bookings to design_identity_capability;
grant select(id,barber_name,store,business_date,status),update(id) on public.frontdesk_today_customers to design_identity_capability;
grant select(id,shop_name),update(id) on public.customer_profiles to design_identity_capability;
grant select(assignment_source,visit_id,row_sha256,allowed,policy_revision,expires_at),update(visit_id) on design_private.lifecycle_decisions to design_identity_capability;
-- frontdesk already enables RLS in the unchanged fixture migration.
create policy identity_frontdesk_read on public.frontdesk_today_customers for select to design_identity_capability using(true);
create policy identity_frontdesk_lock on public.frontdesk_today_customers for update to design_identity_capability using(true) with check(true);
create policy identity_legacy_session_read on public.employee_booking_sessions for select to design_identity_capability using(true);
create policy identity_legacy_session_lock on public.employee_booking_sessions for update to design_identity_capability using(true) with check(true);

create function design_identity.guard_identity_rewrite() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  if tg_table_name='subjects' then
    if new.subject_id is distinct from old.subject_id or new.security_epoch<old.security_epoch or (not old.active and new.active) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='employments' then
    if (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') or (not old.active and new.active) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='memberships' then
    if (to_jsonb(new)-'active'-'membership_revision') is distinct from (to_jsonb(old)-'active'-'membership_revision') or new.membership_revision<old.membership_revision or (not old.active and new.active) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='stores' then
    if new.store_id is distinct from old.store_id or (not old.active and new.active) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='aliases' then
    if (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active') or (not old.active and new.active) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='sessions' then
    if (to_jsonb(new)-'revoked') is distinct from (to_jsonb(old)-'revoked') or (old.revoked and not new.revoked) then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  elsif tg_table_name='visit_bindings' then
    if (to_jsonb(new)-'active'-'membership_id'-'binding_revision') is distinct from (to_jsonb(old)-'active'-'membership_id'-'binding_revision') or new.binding_revision<=old.binding_revision then raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  else raise exception 'IDENTITY_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
create trigger identity_subject_guard before update or delete on design_identity.subjects for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_employment_guard before update or delete on design_identity.employments for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_store_guard before update or delete on design_identity.stores for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_membership_guard before update or delete on design_identity.memberships for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_alias_guard before update or delete on design_identity.aliases for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_session_guard before update or delete on design_identity.sessions for each row execute function design_identity.guard_identity_rewrite();
create trigger identity_binding_guard before update or delete on design_identity.visit_bindings for each row execute function design_identity.guard_identity_rewrite();

create function design_identity.reject_evidence_rewrite() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'IDENTITY_IMMUTABLE' using errcode='42501'; end $$;
create trigger identity_evidence_immutable before update or delete on design_identity.scope_records for each row execute function design_identity.reject_evidence_rewrite();

-- Private fresh resolution. No caller-controlled GUC or claimed actor is used.
create function design_identity.resolve_hash(p_hash text,p_scope jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s design_identity.sessions%rowtype; p design_identity.subjects%rowtype;
  e design_identity.employments%rowtype; m design_identity.memberships%rowtype;
  st design_identity.stores%rowtype; a design_identity.aliases%rowtype;
  b design_identity.visit_bindings%rowtype; lc design_private.lifecycle_decisions%rowtype;
  legacy_session record; employee record; source_row record; profile_row record;
  source_kind text; v_visit_id text; profile_id bigint; source_id text;
  source_store text; source_staff text; source_date date; source_status jsonb;
  canonical_source text; source_hash text; grant_value jsonb;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_scope) is distinct from 'object'
    or (p_scope-array['customerProfileId','visitId','assignmentSource'])<>'{}'::jsonb
    or jsonb_typeof(p_scope->'customerProfileId') is distinct from 'string'
    or jsonb_typeof(p_scope->'visitId') is distinct from 'string'
    or jsonb_typeof(p_scope->'assignmentSource') is distinct from 'string'
    or (p_scope->>'customerProfileId') !~ '^[1-9][0-9]{0,15}$' then
    raise exception 'IDENTITY_INVALID_REQUEST' using errcode='42501';
  end if;
  profile_id:=(p_scope->>'customerProfileId')::bigint;
  if profile_id>9007199254740991 then raise exception 'IDENTITY_INVALID_REQUEST' using errcode='42501'; end if;
  source_kind:=p_scope->>'assignmentSource';v_visit_id:=p_scope->>'visitId';
  if source_kind='appointment' and v_visit_id ~ '^booking:[1-9][0-9]{0,15}$' then
    source_id:=substr(v_visit_id,9);
    if source_id::bigint>9007199254740991 then raise exception 'IDENTITY_INVALID_REQUEST' using errcode='42501'; end if;
  elsif source_kind='frontdesk' and v_visit_id ~ '^frontdesk:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then source_id:=substr(v_visit_id,11);
  else raise exception 'IDENTITY_INVALID_REQUEST' using errcode='42501'; end if;

  -- The sidecar never grants a second login path: existing logout/expiry still
  -- applies to this exact hashed opaque session, on the same locked connection.
  select token_hash,username,store,expires_at into strict legacy_session from public.employee_booking_sessions where token_hash=p_hash for share;
  select * into strict s from design_identity.sessions where session_hash=p_hash for share;
  select * into strict p from design_identity.subjects where subject_id=s.subject_id for share;
  select * into strict e from design_identity.employments where employment_id=s.employment_id for share;
  select * into strict m from design_identity.memberships where membership_id=s.membership_id for share;
  select * into strict st from design_identity.stores where store_id=m.store_id for share;
  select * into strict a from design_identity.aliases where membership_id=m.membership_id and active for share;
  if s.revoked is distinct from false or s.expires_at is null or legacy_session.expires_at is null or s.expires_at<=clock_timestamp() or legacy_session.expires_at<=clock_timestamp() or p.active is distinct from true or e.active is distinct from true or m.active is distinct from true or st.active is distinct from true
    or e.subject_id<>p.subject_id or m.employment_id<>e.employment_id or a.store_id<>m.store_id
    or legacy_session.username is distinct from a.username or legacy_session.store is distinct from st.label
    or s.security_epoch<>p.security_epoch or s.membership_revision<>m.membership_revision then
    raise exception 'IDENTITY_DENIED' using errcode='42501';
  end if;
  -- Existing staff is a consistency/lifecycle check, not the immutable ID key.
  select username,store,active,employment_status into strict employee from public.staff where username=a.username for share;
  if employee.store is distinct from st.label or employee.active is distinct from true or employee.employment_status is distinct from 'active' then raise exception 'IDENTITY_DENIED' using errcode='42501'; end if;
  select * into strict b from design_identity.visit_bindings where assignment_source=source_kind and design_identity.visit_bindings.visit_id=v_visit_id for share;
  if not b.active or b.customer_profile_id<>profile_id or b.membership_id<>m.membership_id or b.store_id<>m.store_id then raise exception 'IDENTITY_DENIED' using errcode='42501'; end if;
  if source_kind='appointment' then
    select id,barber_name,shop_name,date,status into strict source_row from public.bookings where id=source_id::bigint for share;
    source_store:=source_row.shop_name;source_staff:=source_row.barber_name;source_date:=source_row.date;source_status:=to_jsonb(source_row.status);
  else
    select id,barber_name,store,business_date,status into strict source_row from public.frontdesk_today_customers where id=source_id::uuid for share;
    source_store:=source_row.store;source_staff:=source_row.barber_name;source_date:=source_row.business_date;source_status:=to_jsonb(source_row.status);
  end if;
  if source_store is distinct from st.label or source_staff is distinct from a.username or source_date is distinct from b.business_date or source_status is null or source_status='null'::jsonb then raise exception 'IDENTITY_DENIED' using errcode='42501'; end if;
  select id,shop_name into strict profile_row from public.customer_profiles where id=profile_id for share;
  if profile_row.shop_name is distinct from st.label then raise exception 'IDENTITY_DENIED' using errcode='42501'; end if;
  -- Match the existing reviewed JS canonical source digest exactly, without
  -- treating status/import admission as lifecycle permission.
  canonical_source:='{"bookingDate":'||to_jsonb(to_char(source_date,'YYYY-MM-DD'))::text||',"id":'||to_jsonb(source_id)::text||',"source":'||to_jsonb(source_kind)::text||',"staffUsername":'||to_jsonb(source_staff)::text||',"status":'||source_status::text||',"store":'||to_jsonb(source_store)::text||',"visitId":'||to_jsonb(v_visit_id)::text||'}';
  source_hash:=encode(sha256(convert_to(canonical_source,'UTF8')),'hex');
  select * into strict lc from design_private.lifecycle_decisions where assignment_source=source_kind and design_private.lifecycle_decisions.visit_id=v_visit_id for share;
  if lc.allowed is distinct from true or lc.row_sha256 is distinct from source_hash or lc.policy_revision is distinct from 'synthetic-explicit-lifecycle-v1' or lc.expires_at is null or lc.expires_at<=clock_timestamp() then raise exception 'IDENTITY_LIFECYCLE_DENIED' using errcode='42501'; end if;
  if least(s.expires_at,legacy_session.expires_at,lc.expires_at)<=clock_timestamp() then raise exception 'IDENTITY_AUTHORITY_EXPIRED' using errcode='42501'; end if;
  grant_value:=jsonb_build_object('schemaVersion','design-immutable-authority-v1','subjectId',p.subject_id,'employmentId',e.employment_id,'membershipId',m.membership_id,'securityEpoch',p.security_epoch,'membershipRevision',m.membership_revision,'storeId',st.store_id,'actor',jsonb_build_object('username',a.username,'store',st.label),'scope',p_scope,'bindingRevision',b.binding_revision::text);
  return jsonb_build_object('authority',grant_value,'expiresAt',least(s.expires_at,legacy_session.expires_at,lc.expires_at));
exception when no_data_found or too_many_rows then raise exception 'IDENTITY_DENIED' using errcode='42501';
end $$;

create function design_identity.authorize(p_credential text,p_scope jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare resolved jsonb; hash_value text;
begin
  if session_user<>'design_identity_runtime' or p_credential is null or length(p_credential) not between 32 and 200 or p_credential ~ '[[:space:][:cntrl:]]' then raise exception 'IDENTITY_DENIED' using errcode='42501'; end if;
  -- Do not sweep other backends: bounded connection-local cleanup only.
  -- Abandoned other-backend rows need a separate restricted GC, never authority reuse.
  delete from design_identity.transaction_contexts where session_login=session_user and backend_pid=pg_backend_pid();
  hash_value:=encode(sha256(convert_to(p_credential,'UTF8')),'hex');
  resolved:=design_identity.resolve_hash(hash_value,p_scope);
  insert into design_identity.transaction_contexts(session_login,backend_pid,transaction_id,session_hash,scope,authority,expires_at)
    values(session_user,pg_backend_pid(),txid_current(),hash_value,p_scope,resolved->'authority',(resolved->>'expiresAt')::timestamptz);
  return resolved->'authority';
end $$;

create function design_identity.require_authority() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare ctx design_identity.transaction_contexts%rowtype; resolved jsonb;
begin
  if session_user<>'design_identity_runtime' then raise exception 'IDENTITY_CONTEXT_REQUIRED' using errcode='42501'; end if;
  select * into strict ctx from design_identity.transaction_contexts where session_login=session_user and backend_pid=pg_backend_pid() and transaction_id=txid_current() for share;
  if ctx.expires_at<=clock_timestamp() then raise exception 'IDENTITY_AUTHORITY_EXPIRED' using errcode='42501'; end if;
  resolved:=design_identity.resolve_hash(ctx.session_hash,ctx.scope);
  if resolved->'authority' is distinct from ctx.authority then raise exception 'IDENTITY_AUTHORITY_CHANGED' using errcode='42501'; end if;
  if ctx.expires_at<=clock_timestamp() then raise exception 'IDENTITY_AUTHORITY_EXPIRED' using errcode='42501'; end if;
  return ctx.authority;
exception when no_data_found or too_many_rows then raise exception 'IDENTITY_CONTEXT_REQUIRED' using errcode='42501';
end $$;
create function design_identity.recheck_authority() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin return design_identity.require_authority(); end $$;
create function design_identity.clear_context() returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if session_user<>'design_identity_runtime' then raise exception 'IDENTITY_CONTEXT_REQUIRED' using errcode='42501'; end if;
  delete from design_identity.transaction_contexts where session_login=session_user and backend_pid=pg_backend_pid() and transaction_id=txid_current();
end $$;
create function design_identity.check_context_deadline() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  -- NEW retains the original minimum deadline even if clear_context deleted the
  -- row or another authorize call installed a later context before COMMIT.
  if new.expires_at<=clock_timestamp() then raise exception 'IDENTITY_AUTHORITY_EXPIRED' using errcode='42501'; end if;
  return new;
end $$;
create constraint trigger identity_context_deadline after insert or update on design_identity.transaction_contexts
  deferrable initially deferred for each row execute function design_identity.check_context_deadline();

create function design_identity.scope_record_visible(p_scope jsonb,p_store text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare authority_value jsonb;
begin
  authority_value:=design_identity.require_authority();
  return p_scope=authority_value->'scope' and p_store=authority_value->>'storeId';
end $$;
create policy identity_scoped_evidence_read on design_identity.scope_records for select to design_identity_capability using(design_identity.scope_record_visible(scope,store_id));
create policy identity_scoped_evidence_lock on design_identity.scope_records for update to design_identity_capability using(design_identity.scope_record_visible(scope,store_id)) with check(design_identity.scope_record_visible(scope,store_id));
create function design_identity.read_scope_records() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  perform design_identity.require_authority();
  -- Intentionally no scope WHERE: the actual non-owner role is subject to RLS.
  select coalesce(jsonb_agg(jsonb_build_object('recordId',r.record_id,'scope',r.scope,'storeId',r.store_id,'payload',r.payload) order by r.record_id),'[]'::jsonb)
    into result from (select record_id,scope,store_id,payload from design_identity.scope_records order by record_id limit 51 for share) r;
  if jsonb_array_length(result)>50 then raise exception 'IDENTITY_CAPACITY' using errcode='42501'; end if;
  perform design_identity.require_authority();
  return result;
end $$;

alter function design_identity.guard_identity_rewrite() owner to design_identity_capability;
alter function design_identity.reject_evidence_rewrite() owner to design_identity_capability;
alter function design_identity.resolve_hash(text,jsonb) owner to design_identity_capability;
alter function design_identity.authorize(text,jsonb) owner to design_identity_capability;
alter function design_identity.require_authority() owner to design_identity_capability;
alter function design_identity.recheck_authority() owner to design_identity_capability;
alter function design_identity.clear_context() owner to design_identity_capability;
alter function design_identity.check_context_deadline() owner to design_identity_capability;
alter function design_identity.scope_record_visible(jsonb,text) owner to design_identity_capability;
alter function design_identity.read_scope_records() owner to design_identity_capability;
revoke all on all tables in schema design_identity from public,anon,authenticated,design_identity_runtime;
revoke all on all functions in schema design_identity from public,anon,authenticated,design_identity_runtime;
grant execute on function design_identity.authorize(text,jsonb),design_identity.recheck_authority(),design_identity.clear_context(),design_identity.read_scope_records() to design_identity_runtime;
revoke create on schema design_identity from design_identity_capability;
-- No issuer/revoker service is installed. Only the isolated fixture administrator
-- seeds or changes synthetic authority rows. This does not prove production
-- issuance, revocation permissions, all legacy executor privileges or migration.
