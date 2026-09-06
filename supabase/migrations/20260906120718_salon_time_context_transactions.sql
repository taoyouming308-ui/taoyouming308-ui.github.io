set statement_timeout='30s';
set lock_timeout='5s';
alter table public.salon_stores add column timezone_version integer not null default 0 check(timezone_version>=0);
create function salon_private.version_store_timezone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.timezone_version:=old.timezone_version+case when new.timezone is distinct from old.timezone then 1 else 0 end;
 return new;
end$$;
create trigger salon_store_timezone_version before update on public.salon_stores for each row execute function salon_private.version_store_timezone();
revoke execute on function salon_private.version_store_timezone() from public,anon,authenticated;
grant execute on function salon_private.version_store_timezone() to service_role;

create table public.salon_time_context_requests(
 organization_id bigint not null,store_id bigint not null,request_key text not null,
 payload_digest bytea not null,time_zone text not null,time_version integer not null check(time_version>=0),
 completed boolean not null default false,created_at timestamptz not null default now(),
 primary key(organization_id,store_id,request_key),
 foreign key(organization_id,store_id) references public.salon_stores(organization_id,id)
);
alter table public.salon_time_context_requests enable row level security;
alter table public.salon_time_context_requests force row level security;
revoke all on public.salon_time_context_requests from public,anon,authenticated;
grant select,insert,update on public.salon_time_context_requests to service_role;

create function salon_private.claim_time_context(p_org bigint,p_store bigint,p_key text,p_zone text,p_version integer,p_payload jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_zone text;v_version integer;v_guard public.salon_time_context_requests;v_digest bytea;
begin
 if p_key is null or length(p_key) not between 16 and 120 or p_key !~ '^[A-Za-z0-9._:-]+$' or p_zone is null or p_version is null or p_version<0 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception '时区请求参数无效';end if;
 -- Held until transaction end; timezone UPDATE cannot pass this row's SHARE lock.
 select timezone,timezone_version into v_zone,v_version from public.salon_stores where organization_id=p_org and id=p_store and status='active' for share;
 if not found then raise exception '门店不存在或已停用';end if;
 v_digest:=sha256(convert_to(p_payload::text,'UTF8'));
 if not exists(select 1 from public.salon_time_context_requests where organization_id=p_org and store_id=p_store and request_key=p_key)
 and exists(select 1 from public.salon_operation_requests where organization_id=p_org and store_id=p_store and request_key=p_key and completed_at is not null)
 then raise exception '旧请求缺少时区上下文，请核对原业务记录';end if;
 insert into public.salon_time_context_requests(organization_id,store_id,request_key,payload_digest,time_zone,time_version)
 values(p_org,p_store,p_key,v_digest,p_zone,p_version) on conflict do nothing;
 select * into v_guard from public.salon_time_context_requests where organization_id=p_org and store_id=p_store and request_key=p_key for update;
 if v_guard.payload_digest is distinct from v_digest or v_guard.time_zone is distinct from p_zone or v_guard.time_version is distinct from p_version then raise exception '幂等键已被其他业务使用';end if;
 if not v_guard.completed and (v_zone is distinct from p_zone or v_version is distinct from p_version) then raise exception '门店时区版本已变化，请刷新后重新填写';end if;
 if not v_guard.completed and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception '门店时区配置无效';end if;
end$$;
revoke execute on function salon_private.claim_time_context(bigint,bigint,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function salon_private.claim_time_context(bigint,bigint,text,text,integer,jsonb) to service_role;

create function public.salon_reschedule_booking_with_time(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_expected_starts_at timestamptz,p_expected_ends_at timestamptz,p_expected_version integer,p_new_starts_at timestamptz,p_reason text,p_expected_time_zone text,p_expected_time_version integer) returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customer_portal','manage'); perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 perform salon_private.claim_time_context(p_organization_id,p_store_id,p_request_key,p_expected_time_zone,p_expected_time_version,jsonb_build_object('operation','salon_reschedule_booking_with_time','p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_expected_starts_at',p_expected_starts_at,'p_expected_ends_at',p_expected_ends_at,'p_expected_version',p_expected_version,'p_new_starts_at',p_new_starts_at,'p_reason',p_reason,'p_expected_time_zone',p_expected_time_zone,'p_expected_time_version',p_expected_time_version));
 v_response:=public.salon_reschedule_booking(p_actor_staff_id,p_organization_id,p_store_id,p_booking_request_id,p_request_key,p_expected_starts_at,p_expected_ends_at,p_expected_version,p_new_starts_at,p_reason);
 update public.salon_time_context_requests set completed=true where organization_id=p_organization_id and store_id=p_store_id and request_key=p_request_key;
 return v_response;
end$$;
revoke execute on function public.salon_reschedule_booking_with_time(bigint,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.salon_reschedule_booking_with_time(bigint,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text,text,integer) to service_role;

create function public.salon_customer_reschedule_with_time(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_expected_starts_at timestamptz,p_expected_ends_at timestamptz,p_expected_version integer,p_new_starts_at timestamptz,p_reason text,p_expected_time_zone text,p_expected_time_version integer) returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_response jsonb;
begin
 perform salon_private.assert_customer_read_scope(p_auth_user_id,p_organization_id,p_store_id);
 perform salon_private.claim_time_context(p_organization_id,p_store_id,p_request_key,p_expected_time_zone,p_expected_time_version,jsonb_build_object('operation','salon_customer_reschedule_with_time','p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_expected_starts_at',p_expected_starts_at,'p_expected_ends_at',p_expected_ends_at,'p_expected_version',p_expected_version,'p_new_starts_at',p_new_starts_at,'p_reason',p_reason,'p_expected_time_zone',p_expected_time_zone,'p_expected_time_version',p_expected_time_version));
 v_response:=public.salon_customer_request_reschedule(p_auth_user_id,p_organization_id,p_store_id,p_booking_request_id,p_request_key,p_expected_starts_at,p_expected_ends_at,p_expected_version,p_new_starts_at,p_reason);
 update public.salon_time_context_requests set completed=true where organization_id=p_organization_id and store_id=p_store_id and request_key=p_request_key;
 return v_response;
end$$;
revoke execute on function public.salon_customer_reschedule_with_time(uuid,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.salon_customer_reschedule_with_time(uuid,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text,text,integer) to service_role;

create function public.salon_review_reschedule_with_time(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_change_request_id bigint,p_request_key text,p_decision text,p_reason text,p_expected_time_zone text,p_expected_time_version integer) returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customer_portal','manage'); perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 perform salon_private.claim_time_context(p_organization_id,p_store_id,p_request_key,p_expected_time_zone,p_expected_time_version,jsonb_build_object('operation','salon_review_reschedule_with_time','p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_change_request_id',p_change_request_id,'p_decision',p_decision,'p_reason',p_reason,'p_expected_time_zone',p_expected_time_zone,'p_expected_time_version',p_expected_time_version));
 v_response:=public.salon_review_reschedule_request(p_actor_staff_id,p_organization_id,p_store_id,p_change_request_id,p_request_key,p_decision,p_reason);
 update public.salon_time_context_requests set completed=true where organization_id=p_organization_id and store_id=p_store_id and request_key=p_request_key;
 return v_response;
end$$;
revoke execute on function public.salon_review_reschedule_with_time(bigint,bigint,bigint,bigint,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.salon_review_reschedule_with_time(bigint,bigint,bigint,bigint,text,text,text,text,integer) to service_role;

set statement_timeout='30s';
set lock_timeout='5s';
create or replace function public.salon_get_store_time_context(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_zone text;v_version integer;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customer_portal','manage');
 select timezone,timezone_version into v_zone,v_version from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active';
 if v_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception '门店时区配置无效';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'timeZone',v_zone,'timeVersion',v_version);
end$$;
create or replace function public.salon_customer_get_store_time_context(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_zone text;v_version integer;
begin
 perform salon_private.assert_customer_read_scope(p_auth_user_id,p_organization_id,p_store_id);
 select timezone,timezone_version into v_zone,v_version from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active';
 if v_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception '门店时区配置无效';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'timeZone',v_zone,'timeVersion',v_version);
end$$;
revoke execute on function public.salon_get_store_time_context(bigint,bigint,bigint),public.salon_customer_get_store_time_context(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_store_time_context(bigint,bigint,bigint),public.salon_customer_get_store_time_context(uuid,bigint,bigint) to service_role;
