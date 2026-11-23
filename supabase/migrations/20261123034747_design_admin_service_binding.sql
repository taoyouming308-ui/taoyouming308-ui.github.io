-- Administrative service binding only. No source-table writes, locks, triggers,
-- identity bootstrap, photo/model permission, Storage operation or old archive changes.
begin;
-- This existing App already has the independent read-only employee verifier.
-- Pin its measured source and ACL; never silently replace an unexpected verifier.
do $$ begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.design_employee_verify_session(text,uuid)')
  and not p.prosecdef and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='71f806e757e9cbe1576261781dcadf4c8f3e9ba58f2355c69a1d2130fa5c9af4'
  and has_function_privilege('service_role',p.oid,'execute')
  and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')) then
  raise exception 'DESIGN_SERVICE_EMPLOYEE_DEPENDENCY_MISMATCH'; end if;
end $$;
create schema design_service_private;
revoke all on schema design_service_private from public,anon,authenticated;
grant usage on schema design_service_private to service_role;

create table design_service_private.binding_events (
  visit_key text not null, revision bigint not null check(revision>0),
  request_id uuid not null unique, intent_sha text not null check(intent_sha ~ '^[a-f0-9]{64}$'),
  state text not null check(state in ('active','revoked')),
  customer_profile_id bigint not null, staff_id integer not null,
  staff_created_at timestamptz not null, store text not null,
  business_date date not null, source_sha text not null, profile_sha text not null, staff_sha text not null,
  admin_id integer not null, admin_created_at timestamptz not null,
  admin_session_sha text not null, reason text not null check(length(reason) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(), primary key(visit_key,revision)
);
alter table design_service_private.binding_events enable row level security;
alter table design_service_private.binding_events force row level security;
revoke all on design_service_private.binding_events from public,anon,authenticated;
grant select,insert on design_service_private.binding_events to service_role;
create function design_service_private.immutable_event() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'DESIGN_SERVICE_IMMUTABLE' using errcode='42501'; end $$;
create trigger immutable_event before update or delete on design_service_private.binding_events
for each row execute function design_service_private.immutable_event();
create trigger immutable_truncate before truncate on design_service_private.binding_events
for each statement execute function design_service_private.immutable_event();
create function design_service_private.digest(p_value jsonb) returns text
language sql immutable strict security invoker set search_path=pg_catalog as $$
select encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;

create function design_service_private.admin_actor(p_credential text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare s record; a record; stamp timestamptz:=clock_timestamp();
begin
 if current_user<>'service_role' or p_credential is null or p_credential !~ '^[a-fA-F0-9-]{72}$' then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 select * into strict s from public.staff_access_sessions where token_hash=encode(sha256(convert_to(p_credential,'UTF8')),'hex');
 select id,created_at,role,store,active,employment_status,password_hash into strict a from public.staff where id=s.staff_id;
 if a.role is distinct from 'admin' or s.role is distinct from 'admin' or a.active is distinct from true
  or a.employment_status is distinct from 'active' or a.created_at is null or s.created_at<a.created_at
  or s.created_at>stamp or s.expires_at<=stamp or coalesce(a.store,'') is distinct from s.store
  or a.password_hash is distinct from s.credential_hash then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('id',a.id::text,'createdAt',a.created_at,'sessionSha',encode(sha256(convert_to(p_credential,'UTF8')),'hex'));
exception when no_data_found or too_many_rows then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

create function design_service_private.source_snapshot(p_visit text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare b jsonb; fingerprint jsonb; shop text; day date;
begin
 if current_user<>'service_role' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 if p_visit ~ '^booking:[1-9][0-9]{0,15}$' then
  select to_jsonb(t) into strict b from public.bookings t where id=substring(p_visit from 9)::bigint;
  if (b->>'status')::integer not in (0,1,3,4) or b->>'status' is null then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  shop:=b->>'shop_name'; day:=(b->>'date')::date;
  fingerprint:=jsonb_build_array('booking',b->'id',b->'shop_id',b->'shop_name',b->'date',b->'status',b->'barber_id',b->'barber_name',b->'customer_name',b->'customer_phone',b->'service_name',b->'reservation_time');
 elsif p_visit ~ '^frontdesk:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  select to_jsonb(t) into strict b from public.frontdesk_today_customers t where id=substring(p_visit from 11)::uuid;
  if b->>'status' not in ('waiting','arrived','in_service','completed') then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  shop:=b->>'store'; day:=(b->>'business_date')::date;
  fingerprint:=jsonb_build_array('frontdesk',b->'id',b->'created_at',b->'store',b->'business_date',b->'status',b->'barber_name',b->'customer_name',b->'customer_phone',b->'service_intent',b->'arrival_time');
 else raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 if shop is null or shop not in ('自由手艺人','向里造型') or day is null then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('visitKey',p_visit,'store',shop,'date',day,'sourceSha',design_service_private.digest(fingerprint),
  'customerLabel',left(coalesce(b->>'customer_name',''),80),'phoneTail',right(regexp_replace(coalesce(b->>'customer_phone',''),'[^0-9]','','g'),4),'barberLabel',left(coalesce(b->>'barber_name',''),80),'status',b->'status');
exception when no_data_found or too_many_rows or invalid_text_representation or datetime_field_overflow then
 raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

create function design_service_private.target_snapshot(p_profile bigint,p_staff integer,p_store text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare p record; s record; identity jsonb;
begin
 if current_user<>'service_role' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 select id,name,phone,shop_name into strict p from public.customer_profiles where id=p_profile;
 select id,username,created_at,store,active,employment_status into strict s from public.staff where id=p_staff;
 if p.id<=0 or p.shop_name is distinct from p_store or s.store is distinct from p_store or s.active is distinct from true
  or s.employment_status is distinct from 'active' or s.created_at is null or s.created_at>clock_timestamp() then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 identity:=jsonb_build_object('staffId',s.id::text,'staffCreatedAt',s.created_at,'username',s.username,'store',s.store,'active',s.active,'employmentStatus',s.employment_status);
 return jsonb_build_object('profileId',p.id::text,'profileLabel',left(coalesce(p.name,''),80),'profilePhoneTail',right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),4),
  'profileSha',design_service_private.digest(jsonb_build_array(p.id,p.name,p.phone,p.shop_name)),
  'staffId',s.id::text,'staffCreatedAt',s.created_at,'staffLabel',s.username,'staffSha',design_service_private.digest(identity));
exception when no_data_found or too_many_rows then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

create function public.design_service_binding(p_credential text,p_input jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog
set statement_timeout='3s' set lock_timeout='100ms' as $$
declare op text; allowed text[]; visit text; a jsonb; source jsonb; target jsonb; identity jsonb; old_identity jsonb;
 h design_service_private.binding_events; receipt design_service_private.binding_events;
 profile_id bigint; staff_id integer; expected bigint; req uuid; intent text; why text; day date; shop text; choices jsonb; staff_choices jsonb; person jsonb;
begin
 if current_user<>'service_role' or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>12000 then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 op:=p_input->>'action'; visit:=p_input->>'visitKey';
 allowed:=case op when 'choices' then array['action','profileId','date']
 when 'inspect' then array['action','visitKey','profileId','staffId']
 when 'confirm' then array['action','visitKey','profileId','staffId','expectedRevision','sourceSha','profileSha','staffSha','requestId','reason']
 when 'revoke' then array['action','visitKey','profileId','expectedRevision','requestId','reason']
 when 'status' then array['action','visitKey','profileId','requestId']
 when 'resolve' then array['action','visitKey','profileId','nonce'] else null end;
 if allowed is null or not(p_input ?& allowed) or p_input-allowed<>'{}'::jsonb or (op<>'choices' and (visit is null or length(visit)>60
  or visit !~ '^(booking:[1-9][0-9]{0,15}|frontdesk:[a-f0-9-]{36})$')) then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 if op='resolve' then
  identity:=public.design_employee_verify_session(p_credential,(p_input->>'nonce')::uuid);
 else a:=design_service_private.admin_actor(p_credential); end if;
 if op='choices' then
  if jsonb_typeof(p_input->'profileId') is distinct from 'string' or (p_input->>'profileId') !~ '^[1-9][0-9]{0,15}$'
   or jsonb_typeof(p_input->'date') is distinct from 'string' or (p_input->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  day:=(p_input->>'date')::date;
  select jsonb_build_object('id',id::text,'label',left(coalesce(name,''),80),'store',shop_name,'phoneTail',right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4)),shop_name into strict person,shop
   from public.customer_profiles where id=(p_input->>'profileId')::bigint;
  if shop is null or shop not in ('自由手艺人','向里造型') then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(q.v order by q.k),'[]') into choices from (
   select k,v from (
    select 'booking:'||id::text k,jsonb_build_object('visitKey','booking:'||id::text,'label',left(coalesce(customer_name,''),80),'phoneTail',right(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g'),4),'barberLabel',left(barber_name,80),'time',time_label,'kind','预约') v
     from public.bookings where shop_name=shop and date=day::text and status in (0,1,3,4)
    union all
    select 'frontdesk:'||id::text,jsonb_build_object('visitKey','frontdesk:'||id::text,'label',left(customer_name,80),'phoneTail',right(regexp_replace(customer_phone,'[^0-9]','','g'),4),'barberLabel',left(barber_name,80),'time',arrival_time,'kind','前台到店')
     from public.frontdesk_today_customers where store=shop and business_date=day and status in ('waiting','arrived','in_service','completed')
   ) all_services order by k limit 201
  ) q;
  select coalesce(jsonb_agg(q.v order by q.id),'[]') into staff_choices from (
   select id,jsonb_build_object('staffId',id::text,'label',username) v from public.staff
    where store=shop and active is true and employment_status='active' and created_at is not null and created_at<=clock_timestamp() order by id limit 101
  ) q;
  if jsonb_array_length(choices)>200 or jsonb_array_length(staff_choices)>100 then raise exception 'DESIGN_SERVICE_TOO_MANY' using errcode='54000'; end if;
  return jsonb_build_object('profile',person,'visits',choices,'staff',staff_choices);
 end if;
 if jsonb_typeof(p_input->'profileId') is distinct from 'string' or (p_input->>'profileId') !~ '^[1-9][0-9]{0,15}$' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 profile_id:=(p_input->>'profileId')::bigint;
 select * into h from design_service_private.binding_events where visit_key=visit order by revision desc limit 1;
 if h.revision is not null and h.customer_profile_id<>profile_id then raise exception 'DESIGN_SERVICE_SCOPE_IMMUTABLE' using errcode='42501'; end if;
 if op='status' then
  select * into receipt from design_service_private.binding_events where request_id=(p_input->>'requestId')::uuid and visit_key=visit
   and admin_id=(a->>'id')::integer and admin_created_at=(a->>'createdAt')::timestamptz;
  return jsonb_build_object('committed',receipt.revision is not null,'savedRevision',receipt.revision,'revision',coalesce(h.revision,0),'state',h.state);
 end if;
 if op in ('confirm','revoke') then
  if not pg_try_advisory_xact_lock(hashtextextended('design-service-binding:'||visit,0)) then raise exception 'DESIGN_SERVICE_BUSY' using errcode='55P03'; end if;
  -- Only the new private ledger is serialized. Never lock source/sync rows.
  select * into h from design_service_private.binding_events where visit_key=visit order by revision desc limit 1;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,8})$'
   or jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 500 then
   raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  expected:=(p_input->>'expectedRevision')::bigint;req:=(p_input->>'requestId')::uuid;why:=btrim(p_input->>'reason');
  intent:=design_service_private.digest(jsonb_build_array(p_input-'requestId',a->'id',a->'createdAt'));
  select * into receipt from design_service_private.binding_events where request_id=req;
  if receipt.revision is not null then
   if receipt.intent_sha<>intent or receipt.visit_key<>visit then raise exception 'DESIGN_SERVICE_CONFLICT' using errcode='23505'; end if;
   return jsonb_build_object('committed',true,'savedRevision',receipt.revision,'revision',h.revision,'state',h.state);
  end if;
  if expected<>coalesce(h.revision,0) then raise exception 'DESIGN_SERVICE_STALE' using errcode='40001'; end if;
 end if;
 if op='revoke' then
  if h.revision is null or h.state<>'active' then raise exception 'DESIGN_SERVICE_STALE' using errcode='40001'; end if;
  perform design_service_private.admin_actor(p_credential);
  insert into design_service_private.binding_events select h.visit_key,h.revision+1,req,intent,'revoked',h.customer_profile_id,h.staff_id,h.staff_created_at,h.store,h.business_date,h.source_sha,h.profile_sha,h.staff_sha,(a->>'id')::integer,(a->>'createdAt')::timestamptz,a->>'sessionSha',why,clock_timestamp();
  return jsonb_build_object('committed',true,'savedRevision',h.revision+1,'revision',h.revision+1,'state','revoked');
 end if;
 if jsonb_typeof(p_input->'profileId') is distinct from 'string' or (p_input->>'profileId') !~ '^[1-9][0-9]{0,15}$' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
 profile_id:=(p_input->>'profileId')::bigint;
 if op='resolve' then
  if h.state is distinct from 'active' or h.customer_profile_id<>profile_id or h.staff_id::text is distinct from identity->>'staffId'
   or h.staff_created_at is distinct from (identity->>'staffCreatedAt')::timestamptz then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  staff_id:=h.staff_id;
 else
  if jsonb_typeof(p_input->'staffId') is distinct from 'string' or (p_input->>'staffId') !~ '^[1-9][0-9]{0,9}$' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  staff_id:=(p_input->>'staffId')::integer;
 end if;
 source:=design_service_private.source_snapshot(visit);
 target:=design_service_private.target_snapshot(profile_id,staff_id,source->>'store');
 if op='inspect' then return jsonb_build_object('source',source,'target',target,'revision',coalesce(h.revision,0),'state',h.state,'boundStaffId',h.staff_id::text,
  'bindingMatches',coalesce(h.state='active' and h.source_sha=source->>'sourceSha' and h.profile_sha=target->>'profileSha' and h.staff_sha=target->>'staffSha',false)); end if;
 if op='resolve' then
  if h.source_sha is distinct from source->>'sourceSha' or h.profile_sha is distinct from target->>'profileSha' or h.staff_sha is distinct from target->>'staffSha'
   or h.store is distinct from identity->'actor'->>'store' then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  old_identity:=identity;identity:=public.design_employee_verify_session(p_credential,(p_input->>'nonce')::uuid);
  if old_identity->'sourceRevision' is distinct from identity->'sourceRevision'
   or source is distinct from design_service_private.source_snapshot(visit)
   or target is distinct from design_service_private.target_snapshot(profile_id,staff_id,h.store)
   or h.revision<>(select max(revision) from design_service_private.binding_events where visit_key=visit) then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  -- Fresh binding evidence only, not an upload/view/processing/model receipt.
  return jsonb_build_object('schemaVersion','design-live-service-binding-v1','nonce',p_input->>'nonce','visitKey',visit,'profileId',profile_id::text,'staffId',staff_id::text,
   'staffCreatedAt',identity->>'staffCreatedAt','actor',identity->'actor','store',h.store,'date',h.business_date,'revision',h.revision,
   'sourceSha',h.source_sha,'profileSha',h.profile_sha,'staffSha',h.staff_sha,'sessionBinding',identity->'sessionBinding','checkedAt',identity->'checkedAt','validUntil',identity->'validUntil');
 end if;
 if op='confirm' then
  if p_input->>'sourceSha' is distinct from source->>'sourceSha' or p_input->>'profileSha' is distinct from target->>'profileSha' or p_input->>'staffSha' is distinct from target->>'staffSha' then raise exception 'DESIGN_SERVICE_STALE' using errcode='40001'; end if;
  if h.revision is not null and (h.customer_profile_id<>profile_id or h.store<>source->>'store' or h.business_date<>(source->>'date')::date) then raise exception 'DESIGN_SERVICE_SCOPE_IMMUTABLE' using errcode='42501'; end if;
  if a is distinct from design_service_private.admin_actor(p_credential) or source is distinct from design_service_private.source_snapshot(visit)
   or target is distinct from design_service_private.target_snapshot(profile_id,staff_id,source->>'store') then raise exception 'DESIGN_SERVICE_STALE' using errcode='40001'; end if;
  insert into design_service_private.binding_events values(visit,expected+1,req,intent,'active',profile_id,staff_id,(target->>'staffCreatedAt')::timestamptz,source->>'store',(source->>'date')::date,
   source->>'sourceSha',target->>'profileSha',target->>'staffSha',(a->>'id')::integer,(a->>'createdAt')::timestamptz,a->>'sessionSha',why,clock_timestamp());
  return jsonb_build_object('committed',true,'savedRevision',expected+1,'revision',expected+1,'state','active');
 end if;
 raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
exception when unique_violation then raise exception 'DESIGN_SERVICE_CONFLICT' using errcode='23505';
 when no_data_found or too_many_rows or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
 raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

revoke all on all functions in schema design_service_private from public,anon,authenticated;
grant execute on all functions in schema design_service_private to service_role;
revoke all on function public.design_service_binding(text,jsonb) from public,anon,authenticated;
grant execute on function public.design_service_binding(text,jsonb) to service_role;
comment on function public.design_service_binding(text,jsonb) is 'Admin-confirmed stable service binding; fresh responsible employee resolution only. No photo, Storage or model permission is issued.';
commit;
