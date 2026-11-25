-- An administrator may confirm one completed booking for archive import
-- without moving a customer master or granting any media access.
begin;

create table design_service_private.archive_approval_events (
  booking_id bigint not null, revision bigint not null check(revision>0),
  profile_id bigint not null, business_date date not null, evidence_sha text not null,
  state text not null check(state in ('approved','revoked')),
  admin_id integer not null, admin_created_at timestamptz not null,
  request_id uuid not null unique, request_sha text not null,
  reason text not null check(length(reason) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  primary key(booking_id,revision)
);
alter table design_service_private.archive_approval_events enable row level security;
alter table design_service_private.archive_approval_events force row level security;
revoke all on design_service_private.archive_approval_events from public,anon,authenticated;
grant select,insert on design_service_private.archive_approval_events to service_role;
create trigger immutable_event before update or delete on design_service_private.archive_approval_events
for each row execute function design_service_private.immutable_event();
create trigger immutable_truncate before truncate on design_service_private.archive_approval_events
for each statement execute function design_service_private.immutable_event();

create function design_service_private.cross_archive_snapshot(p_profile bigint,p_booking bigint,p_day date)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare b record; p record; a_phone text; b_phone text; reception_ids uuid[];
begin
  if current_user<>'service_role' or p_day is null then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  select id,name,phone,shop_name into strict p from public.customer_profiles where id=p_profile;
  select id,customer_name,customer_phone,shop_name,date,status,time_label,reservation_time into strict b from public.bookings where id=p_booking;
  a_phone:=regexp_replace(regexp_replace(coalesce(p.phone,''),'\D','','g'),'^86(?=1[0-9]{10}$)','');
  b_phone:=regexp_replace(regexp_replace(coalesce(b.customer_phone,''),'\D','','g'),'^86(?=1[0-9]{10}$)','');
  if p.shop_name is distinct from '向里造型' or b.shop_name is distinct from '自由手艺人'
     or b.date is distinct from p_day::text or b.status is distinct from 3
     or a_phone !~ '^1[0-9]{10}$' or a_phone<>b_phone
     or nullif(regexp_replace(coalesce(p.name,''),'\s','','g'),'') is null
     or lower(regexp_replace(p.name,'\s','','g')) is distinct from lower(regexp_replace(b.customer_name,'\s','','g')) then
    raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
  end if;
  select array_agg(id order by id) into reception_ids from (
    select f.id from public.frontdesk_today_customers f where f.store=b.shop_name and f.business_date=p_day
      and f.status='completed' and regexp_replace(regexp_replace(coalesce(f.customer_phone,''),'\D','','g'),'^86(?=1[0-9]{10}$)','')=a_phone
    limit 2
  ) r;
  if cardinality(reception_ids) is distinct from 1 then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  return jsonb_build_object('profileLabel',left(p.name,80),'bookingLabel',left(b.customer_name,80),'phoneTail',right(a_phone,4),
    'profileStore',p.shop_name,'serviceStore',b.shop_name,'date',p_day,'time',b.time_label,
    'evidenceSha',design_service_private.digest(jsonb_build_array(p.id,p.name,p.phone,p.shop_name,b.id,b.customer_name,b.customer_phone,
      b.shop_name,b.date,b.status,b.time_label,b.reservation_time,reception_ids)));
exception when no_data_found or too_many_rows then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

create function public.design_cross_store_archive_approval(p_credential text,p_input jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog
set statement_timeout='3s' set lock_timeout='100ms' as $$
declare a jsonb; evidence jsonb; op text; fields text[]; booking bigint; profile bigint; day date;
        h design_service_private.archive_approval_events; receipt design_service_private.archive_approval_events;
        req uuid; intent text; why text;
begin
  a:=design_service_private.admin_actor(p_credential);
  op:=p_input->>'action';
  fields:=case op when 'archive_inspect' then array['action','profileId','bookingId','date']
    when 'archive_confirm' then array['action','profileId','bookingId','date','expectedRevision','evidenceSha','requestId','reason']
    when 'archive_revoke' then array['action','profileId','bookingId','date','expectedRevision','requestId','reason']
    when 'archive_status' then array['action','profileId','bookingId','date','requestId'] end;
  if jsonb_typeof(p_input) is distinct from 'object' or fields is null or not(p_input ?& fields) or p_input-fields<>'{}'::jsonb
     or jsonb_typeof(p_input->'profileId') is distinct from 'string' or (p_input->>'profileId') !~ '^[1-9][0-9]{0,15}$'
     or jsonb_typeof(p_input->'bookingId') is distinct from 'string' or (p_input->>'bookingId') !~ '^[1-9][0-9]{0,15}$'
     or jsonb_typeof(p_input->'date') is distinct from 'string' or (p_input->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
  end if;
  booking:=(p_input->>'bookingId')::bigint;profile:=(p_input->>'profileId')::bigint;day:=(p_input->>'date')::date;
  if op in ('archive_confirm','archive_revoke') and not pg_try_advisory_xact_lock(hashtextextended('design-cross-archive:'||booking::text,0)) then
    raise exception 'DESIGN_SERVICE_BUSY' using errcode='55P03';
  end if;
  select * into h from design_service_private.archive_approval_events where booking_id=booking order by revision desc limit 1;
  if h.revision is not null and (profile<>h.profile_id or day<>h.business_date) then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  if op='archive_inspect' then
    evidence:=design_service_private.cross_archive_snapshot(profile,booking,day);
    return evidence||jsonb_build_object('revision',coalesce(h.revision,0),'state',h.state,'current',coalesce(h.state='approved' and h.evidence_sha=evidence->>'evidenceSha',false));
  end if;
  req:=(p_input->>'requestId')::uuid;
  if req is null then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  select * into receipt from design_service_private.archive_approval_events where request_id=req;
  if op='archive_status' then
    return jsonb_build_object('committed',coalesce(receipt.booking_id=booking and receipt.profile_id=profile and receipt.business_date=day
      and receipt.admin_id=(a->>'id')::integer and receipt.admin_created_at=(a->>'createdAt')::timestamptz,false),'state',h.state,'revision',coalesce(h.revision,0));
  end if;
  why:=btrim(p_input->>'reason');intent:=design_service_private.digest(jsonb_build_array(p_input-'requestId',a->'id',a->'createdAt'));
  if receipt.request_id is not null then
    if receipt.request_sha is distinct from intent then raise exception 'DESIGN_SERVICE_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('committed',true,'state',h.state,'revision',h.revision);
  end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,8})$'
    or coalesce(length(why),0) not between 1 and 500 or (p_input->>'expectedRevision')::bigint<>coalesce(h.revision,0) then
    raise exception 'DESIGN_SERVICE_STALE' using errcode='40001';
  end if;
  if op='archive_confirm' then
    evidence:=design_service_private.cross_archive_snapshot(profile,booking,day);
    if p_input->>'evidenceSha' is distinct from evidence->>'evidenceSha' then raise exception 'DESIGN_SERVICE_STALE' using errcode='40001'; end if;
  elsif h.state is distinct from 'approved' then
    raise exception 'DESIGN_SERVICE_STALE' using errcode='40001';
  end if;
  if a is distinct from design_service_private.admin_actor(p_credential) then raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501'; end if;
  insert into design_service_private.archive_approval_events(booking_id,revision,profile_id,business_date,evidence_sha,state,
    admin_id,admin_created_at,request_id,request_sha,reason) values (booking,coalesce(h.revision,0)+1,profile,day,
    coalesce(evidence->>'evidenceSha',h.evidence_sha),case op when 'archive_confirm' then 'approved' else 'revoked' end,
    (a->>'id')::integer,(a->>'createdAt')::timestamptz,req,intent,why) returning * into h;
  return jsonb_build_object('committed',true,'state',h.state,'revision',h.revision);
exception when unique_violation then raise exception 'DESIGN_SERVICE_CONFLICT' using errcode='23505';
when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'DESIGN_SERVICE_DENIED' using errcode='42501';
end $$;

-- Retain the old resolver byte-for-byte. Its success path is unchanged.
alter function public.customer_design_resolve_context(bigint,bigint,date,text)
  rename to customer_design_resolve_same_store_context;
create function public.customer_design_resolve_context(p_customer_profile_id bigint,p_booking_id bigint default null,
  p_booking_date date default null,p_visit_key text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare h design_service_private.archive_approval_events; evidence jsonb; p record; key text;
begin
  if p_booking_id is not null and p_booking_date is not null and current_user='service_role' then
    select * into h from design_service_private.archive_approval_events where booking_id=p_booking_id order by revision desc limit 1;
    key:='booking:'||p_booking_id::text;
    if h.state='approved' and h.profile_id=p_customer_profile_id and h.business_date=p_booking_date
       and (nullif(p_visit_key,'') is null or p_visit_key=key) then
      evidence:=design_service_private.cross_archive_snapshot(p_customer_profile_id,p_booking_id,p_booking_date);
      if h.evidence_sha is distinct from evidence->>'evidenceSha' then raise exception 'CUSTOMER_DESIGN_IDENTITY_MISMATCH' using errcode='42501'; end if;
      select name,phone into strict p from public.customer_profiles where id=p_customer_profile_id;
      return jsonb_build_object('customer_profile_id',p_customer_profile_id,'booking_id',p_booking_id,
        'booking_date',p_booking_date,'visit_key',key,'store','自由手艺人','name',p.name,'phone',p.phone,'cross_store_archive',true);
    end if;
  end if;
  return public.customer_design_resolve_same_store_context(p_customer_profile_id,p_booking_id,p_booking_date,p_visit_key);
end $$;

alter function public.validate_customer_design_ingest_grant(text) rename to validate_customer_design_ingest_grant_base;
create function public.validate_customer_design_ingest_grant(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare g jsonb; ctx jsonb; h design_service_private.archive_approval_events;
begin
  g:=public.validate_customer_design_ingest_grant_base(p_token_hash);
  if g->>'booking_id' is not null then
    select * into h from design_service_private.archive_approval_events where booking_id=(g->>'booking_id')::bigint order by revision desc limit 1;
    if h.revision is not null then
      ctx:=public.customer_design_resolve_context((g->>'customer_profile_id')::bigint,(g->>'booking_id')::bigint,
        (g->>'booking_date')::date,g->>'visit_key');
      if coalesce((ctx->>'cross_store_archive')::boolean,false) and
          ((g->>'created_at')::timestamptz < h.created_at or h.state is distinct from 'approved') then
        raise exception 'CUSTOMER_DESIGN_INGEST_FORBIDDEN' using errcode='42501';
      end if;
    end if;
  end if;
  return g;
end $$;

revoke all on function design_service_private.cross_archive_snapshot(bigint,bigint,date) from public,anon,authenticated;
grant execute on function design_service_private.cross_archive_snapshot(bigint,bigint,date) to service_role;
revoke all on function public.design_cross_store_archive_approval(text,jsonb), public.customer_design_resolve_context(bigint,bigint,date,text),
  public.validate_customer_design_ingest_grant(text) from public,anon,authenticated;
grant execute on function public.design_cross_store_archive_approval(text,jsonb), public.customer_design_resolve_context(bigint,bigint,date,text),
  public.validate_customer_design_ingest_grant(text) to service_role;
commit;
