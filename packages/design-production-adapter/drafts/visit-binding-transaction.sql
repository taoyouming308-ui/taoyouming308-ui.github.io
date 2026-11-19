-- NON-INSTALLABLE SYNTHETIC BLUEPRINT. Never move this file into migrations.
-- Only scripts/test-design-binding-postgres.mjs creates the required fixture.
-- No public tables, production grants, SECURITY DEFINER, credentials or network.
-- These functions are NOT the transaction(callback) JS adapter implementation.
do $$ begin
  if current_database() <> 'design_binding_synthetic'
    or current_setting('design_binding.synthetic_fixture', true) is distinct from 'offline-stage5-only'
    or current_setting('server_version_num')::integer / 10000 <> 17
    or to_regclass('design_binding_fixture.synthetic_guard') is null
    or to_regclass('public.staff') is not null
    or to_regclass('public.bookings') is not null
    or to_regclass('public.customer_profiles') is not null then
    raise exception 'SYNTHETIC_FIXTURE_REQUIRED';
  end if;
  if (select count(*) from design_binding_fixture.synthetic_guard
      where marker = 'empty-disposable-database-no-real-data') <> 1 then
    raise exception 'SYNTHETIC_FIXTURE_REQUIRED';
  end if;
end $$;

create function design_binding_fixture.assert_fixture() returns void
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if current_database() <> 'design_binding_synthetic'
    or current_setting('design_binding.synthetic_fixture', true) is distinct from 'offline-stage5-only'
    or current_setting('transaction_isolation') <> 'read committed'
    or (select count(*) from design_binding_fixture.synthetic_guard
      where marker = 'empty-disposable-database-no-real-data') <> 1 then
    raise exception 'SYNTHETIC_FIXTURE_REQUIRED';
  end if;
end $$;

create table design_binding_fixture.visit_binding_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  source text not null check (source in ('appointment','frontdesk')),
  visit_id text not null,
  revision integer not null check (revision > 0),
  previous_version_id uuid references design_binding_fixture.visit_binding_versions(id),
  action text not null check (action in ('bind','reassign','revoke','restore')),
  customer_profile_id bigint not null check (customer_profile_id > 0),
  store text not null,
  booking_date date not null,
  visit_key text not null,
  staff_username text not null,
  lifecycle_revision integer,
  approval_id uuid not null references design_binding_fixture.binding_approvals(id),
  author text not null,
  session_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (source,visit_id,revision),
  check ((source='appointment' and visit_id ~ '^booking:[1-9][0-9]*$' and visit_key=visit_id)
    or (source='frontdesk' and visit_id ~ '^frontdesk:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and visit_key='manual:'||booking_date::text||':'||substr(visit_id,11)))
);

-- Archive data is intentionally an opaque SYNTHETIC snapshot here. This does
-- not implement the legacy model validators or a lossless UI persistence map.
create table design_binding_fixture.customer_design_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  customer_profile_id bigint not null,
  visit_key text not null,
  store text not null,
  version_no integer not null check (version_no > 0),
  previous_version_id uuid references design_binding_fixture.customer_design_versions(id),
  binding_id uuid not null references design_binding_fixture.visit_binding_versions(id),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  author text not null,
  session_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(customer_profile_id,visit_key,version_no)
);

create table design_binding_fixture.request_receipts (
  request_id uuid primary key,
  command jsonb not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null
);

create function design_binding_fixture.immutable_record() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin raise exception 'APPEND_ONLY'; end $$;
create trigger binding_immutable before update or delete on design_binding_fixture.visit_binding_versions
for each row execute function design_binding_fixture.immutable_record();
create trigger archive_immutable before update or delete on design_binding_fixture.customer_design_versions
for each row execute function design_binding_fixture.immutable_record();
create trigger receipt_immutable before update or delete on design_binding_fixture.request_receipts
for each row execute function design_binding_fixture.immutable_record();
create trigger approval_immutable before update or delete on design_binding_fixture.binding_approvals
for each row execute function design_binding_fixture.immutable_record();

create function design_binding_fixture.authenticate(p_hash text) returns jsonb
language plpgsql security invoker set search_path = pg_catalog as $$
declare s record; e record;
begin
  perform design_binding_fixture.assert_fixture();
  select * into s from design_binding_fixture.employee_booking_sessions
    where token_hash=p_hash for share;
  if not found or s.expires_at <= clock_timestamp() then raise exception 'SESSION_DENIED'; end if;
  select * into e from design_binding_fixture.staff where username=s.username for share;
  if not found or e.active is distinct from true or e.employment_status <> 'active'
    or e.store <> s.store then raise exception 'STAFF_DENIED'; end if;
  return jsonb_build_object('username',e.username,'store',e.store);
end $$;

-- This reads the actual source-like table and an independent, explicit trusted
-- lifecycle decision. No numeric import whitelist implies authorization.
create function design_binding_fixture.lock_source(
  p_source text, p_visit text, p_store text, p_day date, p_stylist text,
  p_profile bigint, p_lifecycle integer
) returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare s record; decision record; profile record; employee record; raw_status jsonb;
begin
  perform design_binding_fixture.assert_fixture();
  if p_source='appointment' and p_visit ~ '^booking:[1-9][0-9]*$' then
    select shop_name as store,date as day,barber_name,status into s
      from design_binding_fixture.bookings where id=substr(p_visit,9)::bigint for share;
  elsif p_source='frontdesk' and p_visit ~ '^frontdesk:[0-9a-f-]{36}$' then
    select store,business_date as day,barber_name,status into s
      from design_binding_fixture.frontdesk_today_customers where id=substr(p_visit,11)::uuid for share;
  else raise exception 'VISIT_INVALID'; end if;
  if not found then raise exception 'SOURCE_MISSING'; end if;
  raw_status:=to_jsonb(s.status);
  if s.store<>p_store or s.day<>p_day or s.barber_name<>p_stylist then
    raise exception 'ASSIGNMENT_CHANGED';
  end if;
  select * into decision from design_binding_fixture.lifecycle_decisions
    where source=p_source and visit_id=p_visit for share;
  if not found or decision.allowed is distinct from true or decision.revision<>p_lifecycle
    or decision.source_status is distinct from raw_status then raise exception 'LIFECYCLE_DENIED'; end if;
  select * into profile from design_binding_fixture.customer_profiles where id=p_profile for share;
  if not found or profile.shop_name<>p_store then raise exception 'PROFILE_DENIED'; end if;
  select * into employee from design_binding_fixture.staff where username=p_stylist for share;
  if not found or employee.active is distinct from true or employee.employment_status<>'active'
    or employee.store<>p_store then raise exception 'STYLIST_DENIED'; end if;
end $$;

create function design_binding_fixture.apply_binding(p_hash text,p_command jsonb,p_approval uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
<<binding_change>>
declare actor jsonb; approval record; authority record;
  old design_binding_fixture.visit_binding_versions; fresh design_binding_fixture.visit_binding_versions;
  receipt design_binding_fixture.request_receipts; canonical jsonb; result jsonb; req uuid;
  action text; expected integer; source text; visit text; profile bigint; day date;
begin
  perform design_binding_fixture.assert_fixture();
  if p_command is null or jsonb_typeof(p_command)<>'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_command) k) is distinct from
       array['action','bookingDate','customerProfileId','expectedRevision','lifecycleRevision','requestId','source','staffUsername','store','visitId','visitKey']::text[]
    then raise exception 'BINDING_COMMAND_INVALID'; end if;
  req:=(p_command->>'requestId')::uuid; action:=p_command->>'action';
  expected:=(p_command->>'expectedRevision')::integer;
  source:=p_command->>'source'; visit:=p_command->>'visitId';
  profile:=(p_command->>'customerProfileId')::bigint; day:=(p_command->>'bookingDate')::date;
  if req is null or expected is null or expected<0 or profile is null or profile<=0 or day is null
    or action is null or action not in ('bind','reassign','revoke','restore') then raise exception 'BINDING_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic-design-request:'||req::text,0));
  actor:=design_binding_fixture.authenticate(p_hash);
  select * into authority from design_binding_fixture.binding_authorities
    where username=actor->>'username' and store=actor->>'store' for share;
  if not found or authority.can_bind is distinct from true then raise exception 'BINDING_AUTHORITY_DENIED'; end if;
  select * into approval from design_binding_fixture.binding_approvals where id=p_approval for share;
  if not found or approval.author<>actor->>'username' or approval.command is distinct from p_command
    or approval.expires_at<=clock_timestamp()
    then raise exception 'EXPLICIT_APPROVAL_REQUIRED'; end if;
  canonical:=jsonb_build_object('operation','binding','actor',actor,'approval',p_approval,'command',p_command);
  select * into receipt from design_binding_fixture.request_receipts where request_id=req;
  if found then
    if receipt.command is distinct from canonical then raise exception 'REQUEST_REUSED'; end if;
    return receipt.result||jsonb_build_object('alreadyApplied',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic-design-visit:'||source||':'||visit,0));
  select * into old from design_binding_fixture.visit_binding_versions v
    where v.source=binding_change.source and v.visit_id=visit order by revision desc limit 1 for share;
  if coalesce(old.revision,0)<>expected then raise exception 'BINDING_CAS_CONFLICT'; end if;
  if old.id is null and action<>'bind' or old.id is not null and action='bind'
    or old.action='revoke' and action not in ('restore','reassign')
    or old.action is distinct from 'revoke' and action='restore'
    then raise exception 'BINDING_ACTION_INVALID'; end if;
  if old.id is not null and (old.customer_profile_id<>profile or old.store<>p_command->>'store'
    or old.booking_date<>day or old.visit_key<>p_command->>'visitKey') then raise exception 'FIRST_BINDING_IDENTITY_FIXED'; end if;
  if actor->>'store'<>p_command->>'store' then raise exception 'BINDING_STORE_DENIED'; end if;
  if action='restore' and old.staff_username is distinct from p_command->>'staffUsername'
    then raise exception 'RESTORE_IDENTITY_CHANGED'; end if;
  if action='reassign' and old.staff_username is not distinct from p_command->>'staffUsername'
    then raise exception 'REASSIGNMENT_REQUIRED'; end if;
  if action='revoke' then
    -- A deleted/reassigned source must never make revocation impossible.
    if old.staff_username is distinct from p_command->>'staffUsername'
      or old.lifecycle_revision is distinct from (p_command->>'lifecycleRevision')::integer
      then raise exception 'REVOCATION_IDENTITY_CHANGED'; end if;
  else
    if p_command->>'lifecycleRevision' is null then raise exception 'LIFECYCLE_DENIED'; end if;
    perform design_binding_fixture.lock_source(source,visit,p_command->>'store',day,
      p_command->>'staffUsername',profile,(p_command->>'lifecycleRevision')::integer);
  end if;
  insert into design_binding_fixture.visit_binding_versions(request_id,source,visit_id,revision,previous_version_id,
    action,customer_profile_id,store,booking_date,visit_key,staff_username,lifecycle_revision,approval_id,author,session_hash)
  values(req,source,visit,expected+1,old.id,action,profile,p_command->>'store',day,p_command->>'visitKey',
    p_command->>'staffUsername',(p_command->>'lifecycleRevision')::integer,p_approval,actor->>'username',p_hash) returning * into fresh;
  perform design_binding_fixture.authenticate(p_hash);
  result:=jsonb_build_object('id',fresh.id,'revision',fresh.revision,'active',action<>'revoke','alreadyApplied',false);
  insert into design_binding_fixture.request_receipts values(req,canonical,encode(sha256(convert_to(canonical::text,'UTF8')),'hex'),result);
  return result;
end $$;

-- The authorizing manager cannot revoke their own session/authority after the
-- function returns and still commit a new binding. Active changes also keep
-- their source/lifecycle/target-staff proof valid through deferred validation.
create function design_binding_fixture.binding_commit_check() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare actor jsonb; authority record; approval record;
begin
  actor:=design_binding_fixture.authenticate(new.session_hash);
  select * into authority from design_binding_fixture.binding_authorities
    where username=new.author and store=new.store for share;
  if not found or authority.can_bind is distinct from true
    or actor->>'username'<>new.author or actor->>'store'<>new.store then raise exception 'BINDING_AUTHORITY_DENIED'; end if;
  select * into approval from design_binding_fixture.binding_approvals where id=new.approval_id for share;
  if not found or approval.author<>new.author or approval.expires_at<=clock_timestamp()
    then raise exception 'EXPLICIT_APPROVAL_REQUIRED'; end if;
  if new.action<>'revoke' then
    perform design_binding_fixture.lock_source(new.source,new.visit_id,new.store,new.booking_date,
      new.staff_username,new.customer_profile_id,new.lifecycle_revision);
  end if;
  perform design_binding_fixture.authenticate(new.session_hash);
  return new;
end $$;
create constraint trigger binding_commit_authorization
after insert on design_binding_fixture.visit_binding_versions
deferrable initially deferred for each row execute function design_binding_fixture.binding_commit_check();

create function design_binding_fixture.lock_archive_authority(p_hash text,p_binding uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare actor jsonb; binding design_binding_fixture.visit_binding_versions; latest uuid;
begin
  actor:=design_binding_fixture.authenticate(p_hash);
  select * into binding from design_binding_fixture.visit_binding_versions where id=p_binding;
  if not found then raise exception 'BINDING_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic-design-visit:'||binding.source||':'||binding.visit_id,0));
  select id into latest from design_binding_fixture.visit_binding_versions
    where source=binding.source and visit_id=binding.visit_id order by revision desc limit 1;
  if latest<>binding.id or binding.action='revoke' or binding.staff_username<>actor->>'username'
    or binding.store<>actor->>'store' then raise exception 'BINDING_DENIED'; end if;
  perform design_binding_fixture.lock_source(binding.source,binding.visit_id,binding.store,binding.booking_date,
    binding.staff_username,binding.customer_profile_id,binding.lifecycle_revision);
  perform design_binding_fixture.authenticate(p_hash);
end $$;

create function design_binding_fixture.append_archive(p_hash text,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare actor jsonb; binding design_binding_fixture.visit_binding_versions;
  old design_binding_fixture.customer_design_versions; fresh design_binding_fixture.customer_design_versions;
  receipt design_binding_fixture.request_receipts; canonical jsonb; result jsonb; req uuid; expected uuid;
begin
  perform design_binding_fixture.assert_fixture();
  if p_command is null or jsonb_typeof(p_command)<>'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_command) k) is distinct from
       array['customerProfileId','expectedBindingRevision','expectedLatestVersionId','requestId','snapshot','source','visitId']::text[]
    or jsonb_typeof(p_command->'snapshot') is distinct from 'object'
    then raise exception 'ARCHIVE_COMMAND_INVALID'; end if;
  req:=(p_command->>'requestId')::uuid; expected:=(p_command->>'expectedLatestVersionId')::uuid;
  if req is null or (p_command->>'expectedBindingRevision')::integer is null then raise exception 'ARCHIVE_COMMAND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic-design-request:'||req::text,0));
  actor:=design_binding_fixture.authenticate(p_hash);
  canonical:=jsonb_build_object('operation','archive','actor',actor,'command',p_command);
  select * into receipt from design_binding_fixture.request_receipts where request_id=req;
  if found and receipt.command is distinct from canonical then raise exception 'REQUEST_REUSED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic-design-visit:'||
    (p_command->>'source')||':'||(p_command->>'visitId'),0));
  select * into binding from design_binding_fixture.visit_binding_versions
    where source=p_command->>'source' and visit_id=p_command->>'visitId' order by revision desc limit 1;
  if not found or binding.revision is distinct from (p_command->>'expectedBindingRevision')::integer
    or binding.customer_profile_id is distinct from (p_command->>'customerProfileId')::bigint then raise exception 'BINDING_DENIED'; end if;
  perform design_binding_fixture.lock_archive_authority(p_hash,binding.id);
  -- A replay never bypasses current employee/source/binding authorization.
  if receipt.request_id is not null then return receipt.result||jsonb_build_object('alreadyApplied',true); end if;
  select * into old from design_binding_fixture.customer_design_versions
    where customer_profile_id=binding.customer_profile_id and visit_key=binding.visit_key order by version_no desc limit 1;
  if old.id is distinct from expected then raise exception 'ARCHIVE_CAS_CONFLICT'; end if;
  insert into design_binding_fixture.customer_design_versions(request_id,customer_profile_id,visit_key,store,
    version_no,previous_version_id,binding_id,snapshot,author,session_hash)
  values(req,binding.customer_profile_id,binding.visit_key,binding.store,coalesce(old.version_no,0)+1,
    old.id,binding.id,p_command->'snapshot',actor->>'username',p_hash) returning * into fresh;
  result:=jsonb_build_object('id',fresh.id,'versionNumber',fresh.version_no,'previousVersionId',fresh.previous_version_id,'alreadyApplied',false);
  insert into design_binding_fixture.request_receipts values(req,canonical,encode(sha256(convert_to(canonical::text,'UTF8')),'hex'),result);
  return result;
end $$;

-- Deferred check catches same-transaction revocation and expiry after the RPC
-- returned. Retained row/advisory locks prevent competing revocation committing
-- between authorization and our commit. One RPC response is NOT commit evidence.
create function design_binding_fixture.archive_commit_check() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  perform design_binding_fixture.lock_archive_authority(new.session_hash,new.binding_id);
  return new;
end $$;
create constraint trigger archive_commit_authorization
after insert on design_binding_fixture.customer_design_versions
deferrable initially deferred for each row execute function design_binding_fixture.archive_commit_check();

-- Only fixture-owned objects are affected; no production role is mentioned.
revoke all on schema design_binding_fixture from public;
revoke all on all functions in schema design_binding_fixture from public;
