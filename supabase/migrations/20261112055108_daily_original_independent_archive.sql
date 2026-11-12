-- Independent evidence only. No financial records or storage policies are mutated.
create table public.zysyr_daily_original_reservations (
 request_id uuid primary key,
 company_id uuid not null, store_id uuid not null, actor_user_id uuid not null,
 metadata jsonb not null,
 report_date date not null,
 object_path text not null unique,
 created_at timestamptz not null default clock_timestamp()
);
create index daily_original_archive_scope_date on public.zysyr_daily_original_reservations(company_id,store_id,report_date,created_at,request_id);
create table public.zysyr_daily_original_completions (
 request_id uuid primary key references public.zysyr_daily_original_reservations(request_id),
 completed_by uuid not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.zysyr_daily_original_reservations enable row level security;
alter table public.zysyr_daily_original_reservations force row level security;
alter table public.zysyr_daily_original_completions enable row level security;
alter table public.zysyr_daily_original_completions force row level security;
revoke all on public.zysyr_daily_original_reservations, public.zysyr_daily_original_completions from public, anon, authenticated, service_role;
create trigger daily_original_reservations_immutable before update or delete on public.zysyr_daily_original_reservations for each row execute function zysyr_private.protect_report_trace_history();
create trigger daily_original_completions_immutable before update or delete on public.zysyr_daily_original_completions for each row execute function zysyr_private.protect_report_trace_history();

create function public.zysyr_daily_original_archive(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_action text,p_request_id uuid,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 r public.zysyr_daily_original_reservations;
 fresh boolean := false; completed boolean; result jsonb; rows_json jsonb;
 d date; month_start date; page_offset integer; page_limit integer;
begin
 -- EXECUTE is service-role-only. Identity comes from the authenticated API, never the client.
 if p_actor_user_id is null or p_company_id is null or p_store_id is null then
  raise exception using errcode='42501',message='ARCHIVE_SCOPE_FORBIDDEN';
 end if;
 perform zysyr_private.assert_daily_entry_scope(p_actor_user_id,p_company_id,p_store_id);
 if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.write') then
  raise exception using errcode='42501',message='ARCHIVE_SCOPE_FORBIDDEN';
 end if;
 if p_action='list' then
  if coalesce(p_metadata->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'ARCHIVE_MONTH_INVALID'; end if;
  month_start := (p_metadata->>'month' || '-01')::date;
  page_offset := coalesce((p_metadata->>'offset')::integer,0);
  page_limit := least(coalesce((p_metadata->>'limit')::integer,200),200);
  if page_offset<0 or page_limit<1 then raise exception 'ARCHIVE_PAGE_INVALID'; end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.request_id),'[]'::jsonb) into rows_json from (
   select a.metadata || jsonb_build_object('request_id',a.request_id,'object_path',a.object_path,'created_at',a.created_at,'status',case when c.request_id is null then 'pending' else 'archived' end) item,a.created_at,a.request_id
   from public.zysyr_daily_original_reservations a left join public.zysyr_daily_original_completions c using(request_id)
   where a.company_id=p_company_id and a.store_id=p_store_id and (c.request_id is not null or a.actor_user_id=p_actor_user_id) and a.report_date>=month_start and a.report_date<month_start+interval '1 month'
   order by a.created_at desc,a.request_id offset page_offset limit page_limit+1
  ) x;
  return jsonb_build_object('archives',case when jsonb_array_length(rows_json)>page_limit then rows_json-page_limit else rows_json end,'has_more',jsonb_array_length(rows_json)>page_limit,'next_offset',page_offset+page_limit);
 end if;
 if p_action not in ('reserve','complete','status','view') or p_action is null or p_request_id is null then raise exception 'ARCHIVE_ACTION_INVALID'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 -- Re-evaluate current authorization after waiting for a competing reservation.
 perform zysyr_private.assert_daily_entry_scope(p_actor_user_id,p_company_id,p_store_id);
 if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.write') then
  raise exception using errcode='42501',message='ARCHIVE_SCOPE_FORBIDDEN';
 end if;
 select * into r from public.zysyr_daily_original_reservations where request_id=p_request_id;
 if found and (r.company_id<>p_company_id or r.store_id<>p_store_id or (p_action<>'view' and r.actor_user_id<>p_actor_user_id)) then
  raise exception using errcode='42501',message='ARCHIVE_REQUEST_SCOPE_MISMATCH';
 end if;
 if p_action in ('reserve','complete') then
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or not (p_metadata ?& array['report_date','original_filename','mime_type','size_bytes','sha256','note'])
   or (select count(*) from jsonb_object_keys(p_metadata))<>6
   or coalesce(p_metadata->>'report_date','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(length(p_metadata->>'original_filename'),0) not between 1 and 255
   or coalesce(p_metadata->>'mime_type','') not in ('image/jpeg','image/png')
   or coalesce(p_metadata->>'size_bytes','') !~ '^[0-9]+$'
   or (p_metadata->>'size_bytes')::bigint not between 1 and 10485760
   or coalesce(p_metadata->>'sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_metadata->'note')<>'string' or length(p_metadata->>'note')>1000 then raise exception 'ARCHIVE_METADATA_INVALID'; end if;
  d := (p_metadata->>'report_date')::date;
  if r.request_id is not null and r.metadata<>p_metadata then raise exception 'ARCHIVE_REQUEST_BINDING_MISMATCH'; end if;
 end if;
 if r.request_id is null then
  if p_action in ('status','view') then return jsonb_build_object('status','not_found','request_id',p_request_id); end if;
  if p_action='complete' then raise exception 'ARCHIVE_RESERVATION_REQUIRED'; end if;
  insert into public.zysyr_daily_original_reservations(request_id,company_id,store_id,actor_user_id,metadata,report_date,object_path)
  values(p_request_id,p_company_id,p_store_id,p_actor_user_id,p_metadata,d,p_company_id||'/'||p_store_id||'/daily-originals/'||to_char(d,'YYYY-MM')||'/'||d||'/'||p_request_id) returning * into r;
  fresh := true;
 end if;
 if p_action='complete' then
  -- The API verifies private object bytes/hash before this call. This row is the immutable completion audit.
  insert into public.zysyr_daily_original_completions(request_id,completed_by) values(p_request_id,p_actor_user_id) on conflict do nothing;
 end if;
 select exists(select 1 from public.zysyr_daily_original_completions where request_id=p_request_id) into completed;
 if p_action='view' and not completed then return jsonb_build_object('status','not_found','request_id',p_request_id); end if;
 result := r.metadata || jsonb_build_object('request_id',r.request_id,'object_path',r.object_path,'created_at',r.created_at);
 return jsonb_build_object('status',case when completed then 'archived' else 'pending' end,'newly_reserved',fresh,'request_id',p_request_id,'archive',result);
end $$;
revoke all on function public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb) to service_role;
