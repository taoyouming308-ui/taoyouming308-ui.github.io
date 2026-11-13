-- Read facade only: keep archive tables, writer RPC, financial rows and storage policies intact.
create function public.zysyr_daily_original_references(
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
 -- The existing company/store/date index and completion PK bound this to one month/day.
 select coalesce(jsonb_agg(to_jsonb(x) order by x.report_date),'[]'::jsonb) into days_json from (
  select r.report_date,count(*)::integer as count
  from public.zysyr_daily_original_reservations r
  join public.zysyr_daily_original_completions c using(request_id)
  where r.company_id=p_company_id and r.store_id=p_store_id
   and r.report_date>=p_start_date and r.report_date<p_end_date group by r.report_date
 ) x;
 if p_detail then
  if coalesce((days_json->0->>'count')::integer,0)>200 then raise exception 'DAILY_ORIGINAL_READ_LIMIT_EXCEEDED'; end if;
  select coalesce(jsonb_agg(x.item order by x.completed_at,x.request_id),'[]'::jsonb) into archives_json from (
   select r.request_id,c.created_at as completed_at,
    jsonb_build_object('request_id',r.request_id,'report_date',r.report_date,
     'original_filename',r.metadata->>'original_filename','mime_type',r.metadata->>'mime_type',
     'size_bytes',(r.metadata->>'size_bytes')::bigint,'sha256',r.metadata->>'sha256',
     'completed_at',c.created_at,'object_path',r.object_path) as item
   from public.zysyr_daily_original_reservations r
   join public.zysyr_daily_original_completions c using(request_id)
   where r.company_id=p_company_id and r.store_id=p_store_id
    and r.report_date>=p_start_date and r.report_date<p_end_date
  ) x;
 end if;
 return jsonb_build_object('days',days_json,'archives',archives_json);
end $$;
revoke all on function public.zysyr_daily_original_references(uuid,integer,uuid,uuid,date,date,boolean) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_daily_original_references(uuid,integer,uuid,uuid,date,date,boolean) to service_role;
