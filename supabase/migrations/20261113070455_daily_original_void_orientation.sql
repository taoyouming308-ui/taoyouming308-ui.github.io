-- Reversible presentation correction: preserve original bytes and immutable upload audit.
create table public.zysyr_daily_original_voids (
 request_id uuid primary key references public.zysyr_daily_original_reservations(request_id),
 voided_by uuid not null, reason text not null check (length(btrim(reason)) between 4 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create table public.zysyr_daily_original_orientation_revisions (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.zysyr_daily_original_reservations(request_id),
 revision integer not null check (revision > 0),
 degrees integer not null check (degrees in (0,90,180,270)),
 changed_by uuid not null,
 reason text not null check (length(btrim(reason)) between 4 and 500),
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,revision)
);
create index daily_original_orientation_latest on public.zysyr_daily_original_orientation_revisions(request_id,revision desc);
alter table public.zysyr_daily_original_voids enable row level security;
alter table public.zysyr_daily_original_voids force row level security;
alter table public.zysyr_daily_original_orientation_revisions enable row level security;
alter table public.zysyr_daily_original_orientation_revisions force row level security;
revoke all on public.zysyr_daily_original_voids,public.zysyr_daily_original_orientation_revisions from public,anon,authenticated,service_role;
create trigger daily_original_voids_immutable before update or delete on public.zysyr_daily_original_voids for each row execute function zysyr_private.protect_report_trace_history();
create trigger daily_original_orientation_immutable before update or delete on public.zysyr_daily_original_orientation_revisions for each row execute function zysyr_private.protect_report_trace_history();

create function public.zysyr_daily_original_manage(
 p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_action text,
 p_request_ids uuid[],p_degrees integer,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid; r public.zysyr_daily_original_reservations; wanted integer; changed integer := 0; next_revision integer; states jsonb;
begin
 if p_actor_user_id is null or p_company_id is null or p_store_id is null
  or p_action not in ('void','rotate','status') or p_action is null
  or p_request_ids is null or cardinality(p_request_ids) not between 1 and (case when p_action='status' then 201 else 100 end)
  or array_position(p_request_ids,null) is not null
  or (p_action<>'status' and coalesce(length(btrim(p_reason)),0) not between 4 and 500) then
  raise exception 'DAILY_ORIGINAL_MANAGE_INVALID';
 end if;
 select count(distinct id) into wanted from unnest(p_request_ids) as u(id);
 if wanted<>cardinality(p_request_ids) then raise exception 'DAILY_ORIGINAL_DUPLICATE_REQUEST'; end if;
 if p_action='rotate' and (wanted<>1 or p_degrees not in (0,90,180,270) or p_degrees is null) then
  raise exception 'DAILY_ORIGINAL_ORIENTATION_INVALID';
 end if;
 perform zysyr_private.assert_daily_entry_scope(p_actor_user_id,p_company_id,p_store_id);
 if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.write') then
  raise exception using errcode='42501',message='DAILY_ORIGINAL_MANAGE_FORBIDDEN';
 end if;
 if p_action='status' then
  select coalesce(jsonb_agg(jsonb_build_object('request_id',r.request_id,'voided',v.request_id is not null,
   'display_rotation_degrees',coalesce(o.degrees,0))),'[]'::jsonb) into states
  from public.zysyr_daily_original_reservations r
  left join public.zysyr_daily_original_voids v using(request_id)
  left join lateral (select degrees from public.zysyr_daily_original_orientation_revisions
    where request_id=r.request_id order by revision desc limit 1) o on true
  where r.company_id=p_company_id and r.store_id=p_store_id and r.request_id=any(p_request_ids);
  if jsonb_array_length(states)<>wanted then raise exception using errcode='42501',message='DAILY_ORIGINAL_REQUEST_SCOPE_MISMATCH'; end if;
  return jsonb_build_object('states',states);
 end if;
 foreach rid in array p_request_ids loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(rid::text,0));
  select * into r from public.zysyr_daily_original_reservations where request_id=rid;
  if r.request_id is null or r.company_id<>p_company_id or r.store_id<>p_store_id
   or not exists(select 1 from public.zysyr_daily_original_completions c where c.request_id=rid) then
   raise exception using errcode='42501',message='DAILY_ORIGINAL_REQUEST_SCOPE_MISMATCH';
  end if;
  if p_action='void' then
   insert into public.zysyr_daily_original_voids(request_id,voided_by,reason)
   values(rid,p_actor_user_id,btrim(p_reason)) on conflict do nothing;
   if found then changed:=changed+1; end if;
  else
   if exists(select 1 from public.zysyr_daily_original_voids v where v.request_id=rid) then
    raise exception 'DAILY_ORIGINAL_ALREADY_VOIDED';
   end if;
   select coalesce(max(revision),0)+1 into next_revision from public.zysyr_daily_original_orientation_revisions where request_id=rid;
   insert into public.zysyr_daily_original_orientation_revisions(request_id,revision,degrees,changed_by,reason)
   values(rid,next_revision,p_degrees,p_actor_user_id,btrim(p_reason));
   changed:=1;
  end if;
 end loop;
 return jsonb_build_object('action',p_action,'requested',wanted,'changed',changed,'financial_records_unchanged',true);
end $$;
revoke all on function public.zysyr_daily_original_manage(uuid,uuid,uuid,text,uuid[],integer,text) from public,anon,authenticated;
grant execute on function public.zysyr_daily_original_manage(uuid,uuid,uuid,text,uuid[],integer,text) to service_role;

-- The report-facing projection excludes voided photos while keeping the immutable audit rows.
create or replace function public.zysyr_daily_original_references(
 p_actor_user_id uuid, p_staff_id integer, p_company_id uuid, p_store_id uuid,
 p_start_date date, p_end_date date, p_detail boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare days_json jsonb; archives_json jsonb := '[]'::jsonb;
begin
 if p_company_id is null or p_store_id is null
  or (p_actor_user_id is null) = (p_staff_id is null)
  or (p_staff_id is not null and p_staff_id <= 0) then
  raise exception using errcode='42501',message='DAILY_ORIGINAL_READ_SCOPE_FORBIDDEN';
 end if;
 if p_start_date is null or p_end_date is null or p_detail is null
  or p_end_date-p_start_date not between 1 and 31
  or (p_detail and p_end_date-p_start_date<>1) then
  raise exception 'DAILY_ORIGINAL_READ_RANGE_INVALID';
 end if;
 if not exists(select 1 from public.zysyr_companies c where c.id=p_company_id and c.status='active')
  or not exists(select 1 from public.zysyr_stores s where s.id=p_store_id and s.company_id=p_company_id
    and s.status='active' and s.deleted_at is null) then
  raise exception using errcode='42501',message='DAILY_ORIGINAL_READ_SCOPE_FORBIDDEN';
 end if;
 if p_actor_user_id is not null then
  if not (zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'voucher.read')
   or zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.write')) then
   raise exception using errcode='42501',message='DAILY_ORIGINAL_READ_SCOPE_FORBIDDEN';
  end if;
 elsif not exists(select 1 from public.staff f join public.staff_report_grants g on g.staff_id=f.id
   where f.id=p_staff_id and f.active is true and f.employment_status='active' and g.store_id=p_store_id) then
  raise exception using errcode='42501',message='DAILY_ORIGINAL_READ_SCOPE_FORBIDDEN';
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.report_date),'[]'::jsonb) into days_json from (
  select r.report_date,count(*)::integer as count
  from public.zysyr_daily_original_reservations r
  join public.zysyr_daily_original_completions c using(request_id)
  left join public.zysyr_daily_original_voids v using(request_id)
  where r.company_id=p_company_id and r.store_id=p_store_id and v.request_id is null
   and r.report_date>=p_start_date and r.report_date<p_end_date group by r.report_date
 ) x;
 if p_detail then
  if coalesce((days_json->0->>'count')::integer,0)>200 then raise exception 'DAILY_ORIGINAL_READ_LIMIT_EXCEEDED'; end if;
  select coalesce(jsonb_agg(x.item order by x.completed_at,x.request_id),'[]'::jsonb) into archives_json from (
   select r.request_id,c.created_at as completed_at,
    jsonb_build_object('request_id',r.request_id,'report_date',r.report_date,
     'original_filename',r.metadata->>'original_filename','mime_type',r.metadata->>'mime_type',
     'size_bytes',(r.metadata->>'size_bytes')::bigint,'sha256',r.metadata->>'sha256',
     'completed_at',c.created_at,'object_path',r.object_path,
     'display_rotation_degrees',o.degrees) as item
   from public.zysyr_daily_original_reservations r
   join public.zysyr_daily_original_completions c using(request_id)
   left join public.zysyr_daily_original_voids v using(request_id)
   left join lateral (select degrees from public.zysyr_daily_original_orientation_revisions
     where request_id=r.request_id order by revision desc limit 1) o on true
   where r.company_id=p_company_id and r.store_id=p_store_id and v.request_id is null
    and r.report_date>=p_start_date and r.report_date<p_end_date
  ) x;
 end if;
 return jsonb_build_object('days',days_json,'archives',archives_json);
end $$;
