-- Independent immutable monthly evidence; no financial tables, pointers or policies change.
create table public.zysyr_monthly_source_reservations (
 request_id uuid primary key, company_id uuid not null,store_id uuid not null,actor_user_id uuid not null,
 metadata jsonb not null,object_path text not null unique,created_at timestamptz not null default clock_timestamp()
);
create index monthly_source_scope_hash on public.zysyr_monthly_source_reservations(company_id,store_id,(metadata->>'sha256'));
create table public.zysyr_monthly_source_completions (
 request_id uuid primary key references public.zysyr_monthly_source_reservations(request_id),
 completed_by uuid not null,created_at timestamptz not null default clock_timestamp()
);
create table public.zysyr_monthly_source_selections (
 id uuid primary key default gen_random_uuid(),selection_request_id uuid not null,
 company_id uuid not null,store_id uuid not null,period_month date not null check(extract(day from period_month)=1),
 selection_version integer not null check(selection_version>0),previous_selection_id uuid references public.zysyr_monthly_source_selections(id),
 source_request_id uuid not null references public.zysyr_monthly_source_reservations(request_id),
 worksheet_name text not null,reason text not null,actor_user_id uuid not null,request_binding jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(company_id,store_id,period_month,selection_version),unique(company_id,store_id,selection_request_id,period_month)
);
alter table public.zysyr_monthly_source_reservations enable row level security;
alter table public.zysyr_monthly_source_reservations force row level security;
alter table public.zysyr_monthly_source_completions enable row level security;
alter table public.zysyr_monthly_source_completions force row level security;
alter table public.zysyr_monthly_source_selections enable row level security;
alter table public.zysyr_monthly_source_selections force row level security;
revoke all on public.zysyr_monthly_source_reservations,public.zysyr_monthly_source_completions,public.zysyr_monthly_source_selections from public,anon,authenticated,service_role;
create trigger monthly_source_reservation_immutable before update or delete on public.zysyr_monthly_source_reservations for each row execute function zysyr_private.protect_report_trace_history();
create trigger monthly_source_completion_immutable before update or delete on public.zysyr_monthly_source_completions for each row execute function zysyr_private.protect_report_trace_history();
create trigger monthly_source_selection_immutable before update or delete on public.zysyr_monthly_source_selections for each row execute function zysyr_private.protect_report_trace_history();

create function public.zysyr_monthly_source_archive(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_action text,p_request_id uuid,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.zysyr_monthly_source_reservations; prior public.zysyr_monthly_source_selections;
 binding jsonb; normalized jsonb; item jsonb; rows_json jsonb; files_json jsonb; selections_json jsonb;
 current_json jsonb; source_id uuid; expected_id uuid; month_date date; source_hash text;
 page_offset integer; binding_count integer; completed boolean; newly boolean:=false; receipt jsonb;
begin
 if p_action is null or p_action not in ('reserve','complete','status','list','view','select','selection_status') then raise exception 'MONTHLY_SOURCE_ACTION_INVALID'; end if;
 if p_actor_user_id is null or p_company_id is null or p_store_id is null then raise exception using errcode='42501',message='MONTHLY_SOURCE_SCOPE_FORBIDDEN'; end if;
 if p_action in ('list','view','selection_status') then
  if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'dashboard.store.read') then raise exception using errcode='42501',message='MONTHLY_SOURCE_READ_FORBIDDEN'; end if;
 else
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
 end if;
 if p_action='list' then
  if coalesce(p_metadata->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'MONTHLY_SOURCE_MONTH_INVALID'; end if;
  month_date:=(p_metadata->>'month'||'-01')::date;page_offset:=coalesce((p_metadata->>'offset')::integer,0);
  if page_offset<0 then raise exception 'MONTHLY_SOURCE_PAGE_INVALID'; end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.request_id),'[]'::jsonb) into files_json from (
   select a.metadata||jsonb_build_object('request_id',a.request_id,'status',case when c.request_id is null then 'pending' else 'archived' end) as item,a.created_at,a.request_id
   from public.zysyr_monthly_source_reservations a left join public.zysyr_monthly_source_completions c using(request_id)
   where a.company_id=p_company_id and a.store_id=p_store_id and (c.request_id is not null or a.actor_user_id=p_actor_user_id)
   order by a.created_at desc,a.request_id offset page_offset limit 101
  ) x;
  select coalesce(jsonb_agg(to_jsonb(s)-'request_binding' order by selection_version desc),'[]'::jsonb) into selections_json from public.zysyr_monthly_source_selections s
   where s.company_id=p_company_id and s.store_id=p_store_id and s.period_month=month_date;
  current_json:=selections_json->0;
  return jsonb_build_object('sources',case when jsonb_array_length(files_json)>100 then files_json-100 else files_json end,
   'selections',selections_json,'current_selection',current_json,'has_more',jsonb_array_length(files_json)>100,'next_offset',page_offset+100);
 end if;
 if p_request_id is null then raise exception 'MONTHLY_SOURCE_REQUEST_REQUIRED'; end if;
 if p_action in ('select','selection_status') then
  if p_action='select' then
   if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or (select count(*) from jsonb_object_keys(p_metadata))<>5
    or not(p_metadata ?& array['source_request_id','expected_source_sha256','bindings','expected_previous_selection_ids','reason'])
    or jsonb_typeof(p_metadata->'bindings')<>'array' or jsonb_array_length(p_metadata->'bindings') not between 1 and 12
    or jsonb_typeof(p_metadata->'expected_previous_selection_ids')<>'object'
    or (select count(*) from jsonb_object_keys(p_metadata->'expected_previous_selection_ids'))<>jsonb_array_length(p_metadata->'bindings')
    or jsonb_typeof(p_metadata->'reason')<>'string' or length(btrim(p_metadata->>'reason')) not between 1 and 1000 then raise exception 'MONTHLY_SOURCE_SELECTION_INVALID'; end if;
   source_id:=(p_metadata->>'source_request_id')::uuid;source_hash:=p_metadata->>'expected_source_sha256';
   select jsonb_agg(x order by x->>'period_month') into normalized from jsonb_array_elements(p_metadata->'bindings') x;
   binding_count:=jsonb_array_length(normalized);
   if (select count(distinct x->>'period_month') from jsonb_array_elements(normalized)x)<>binding_count then raise exception 'MONTHLY_SOURCE_DUPLICATE_MONTH'; end if;
   select * into r from public.zysyr_monthly_source_reservations where request_id=source_id and company_id=p_company_id and store_id=p_store_id;
   if r.request_id is null or r.metadata->>'sha256' is distinct from source_hash or not exists(select 1 from public.zysyr_monthly_source_completions where request_id=r.request_id) then raise exception 'MONTHLY_SOURCE_NOT_COMPLETE'; end if;
   for item in select * from jsonb_array_elements(normalized) loop
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
     or coalesce(item->>'period_month','') !~ '^\d{4}-(0[1-9]|1[0-2])-01$'
     or jsonb_typeof(item->'worksheet_name')<>'string'
     or not (r.metadata->'worksheet_names' ? (item->>'worksheet_name'))
     or not (p_metadata->'expected_previous_selection_ids' ? (item->>'period_month')) then raise exception 'MONTHLY_SOURCE_BINDING_INVALID'; end if;
    month_date:=(item->>'period_month')::date;
    if p_metadata->'expected_previous_selection_ids'->(item->>'period_month')<>'null'::jsonb then
     expected_id:=(p_metadata->'expected_previous_selection_ids'->>(item->>'period_month'))::uuid;
    end if;
   end loop;
   binding:=jsonb_build_object('actor_user_id',p_actor_user_id,'company_id',p_company_id,'store_id',p_store_id,
    'source_request_id',source_id,'source_sha256',source_hash,'bindings',normalized,
    'expected_previous_selection_ids',p_metadata->'expected_previous_selection_ids','reason',btrim(p_metadata->>'reason'));
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text||'/'||p_store_id::text||'/monthly-source-selection',0));
   -- Permission may be revoked while another selection holds the lock.
   perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
  end if;
  select * into prior from public.zysyr_monthly_source_selections where company_id=p_company_id and store_id=p_store_id and selection_request_id=p_request_id order by period_month limit 1;
  if prior.id is not null then
   if prior.actor_user_id<>p_actor_user_id then raise exception using errcode='42501',message='MONTHLY_SOURCE_REQUEST_SCOPE_MISMATCH'; end if;
   if p_action='select' and prior.request_binding<>binding then raise exception 'MONTHLY_SOURCE_REQUEST_BINDING_MISMATCH'; end if;
   source_id:=prior.source_request_id;source_hash:=prior.request_binding->>'source_sha256';
  elsif p_action='selection_status' then return jsonb_build_object('status','not_found','selection_request_id',p_request_id);
  else
   for item in select * from jsonb_array_elements(normalized) loop
    month_date:=(item->>'period_month')::date;prior:=null;
    select * into prior from public.zysyr_monthly_source_selections where company_id=p_company_id and store_id=p_store_id and period_month=month_date order by selection_version desc limit 1;
    expected_id:=nullif(p_metadata->'expected_previous_selection_ids'->>(item->>'period_month'),'')::uuid;
    if prior.id is distinct from expected_id then raise exception using errcode='PT409',message='MONTHLY_SOURCE_SELECTION_CONFLICT'; end if;
    insert into public.zysyr_monthly_source_selections(selection_request_id,company_id,store_id,period_month,selection_version,previous_selection_id,source_request_id,worksheet_name,reason,actor_user_id,request_binding)
    values(p_request_id,p_company_id,p_store_id,month_date,coalesce(prior.selection_version,0)+1,prior.id,source_id,item->>'worksheet_name',btrim(p_metadata->>'reason'),p_actor_user_id,binding);
   end loop;
  end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'period_month',s.period_month,'selection_version',s.selection_version,'worksheet_name',s.worksheet_name,
   'is_current',not exists(select 1 from public.zysyr_monthly_source_selections newer where newer.company_id=s.company_id and newer.store_id=s.store_id and newer.period_month=s.period_month and newer.selection_version>s.selection_version)) order by s.period_month)
   into receipt from public.zysyr_monthly_source_selections s where s.company_id=p_company_id and s.store_id=p_store_id and s.selection_request_id=p_request_id;
  return jsonb_build_object('status','selected','selection_request_id',p_request_id,'source_request_id',source_id,'source_sha256',source_hash,'selections',receipt);
 end if;
 if p_action not in ('reserve','complete','status','view') then raise exception 'MONTHLY_SOURCE_ACTION_INVALID'; end if;
 -- The same request and the same store/hash are serialized independently of financial locks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 if p_action<>'view' then perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
 elsif not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'dashboard.store.read') then raise exception using errcode='42501',message='MONTHLY_SOURCE_READ_FORBIDDEN'; end if;
 select * into r from public.zysyr_monthly_source_reservations where request_id=p_request_id;
 if r.request_id is not null and (r.company_id<>p_company_id or r.store_id<>p_store_id) then raise exception using errcode='42501',message='MONTHLY_SOURCE_REQUEST_SCOPE_MISMATCH'; end if;
 if p_action in ('reserve','complete') then
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or (select count(*) from jsonb_object_keys(p_metadata))<>6
   or not(p_metadata ?& array['original_filename','mime_type','size_bytes','sha256','worksheet_names','bucket_id'])
   or coalesce(p_metadata->>'original_filename','') !~* '\.xlsx$' or length(p_metadata->>'original_filename')>200
   or p_metadata->>'mime_type' is distinct from 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   or p_metadata->>'bucket_id' is distinct from 'zysyr-reports' or coalesce(p_metadata->>'size_bytes','') !~ '^[0-9]+$'
   or (p_metadata->>'size_bytes')::bigint not between 1 and 10485760
   or coalesce(p_metadata->>'sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_metadata->'worksheet_names')<>'array' or jsonb_array_length(p_metadata->'worksheet_names') not between 1 and 300
   or exists(select 1 from jsonb_array_elements(p_metadata->'worksheet_names')x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 120)
   or (select count(distinct x) from jsonb_array_elements(p_metadata->'worksheet_names')x)<>jsonb_array_length(p_metadata->'worksheet_names') then raise exception 'MONTHLY_SOURCE_METADATA_INVALID'; end if;
  if r.request_id is not null and (r.actor_user_id<>p_actor_user_id or r.metadata<>p_metadata) then raise exception 'MONTHLY_SOURCE_REQUEST_BINDING_MISMATCH'; end if;
 end if;
 if r.request_id is null and p_action='reserve' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text||'/'||p_store_id::text||'/'||(p_metadata->>'sha256'),0));
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
  select a.* into r from public.zysyr_monthly_source_reservations a where a.company_id=p_company_id and a.store_id=p_store_id and a.metadata->>'sha256'=p_metadata->>'sha256' order by a.created_at,a.request_id limit 1;
  if r.request_id is not null then
   if not exists(select 1 from public.zysyr_monthly_source_completions where request_id=r.request_id) and (r.actor_user_id<>p_actor_user_id or r.metadata<>p_metadata) then raise exception 'MONTHLY_SOURCE_PENDING'; end if;
  else
   insert into public.zysyr_monthly_source_reservations(request_id,company_id,store_id,actor_user_id,metadata,object_path)
   values(p_request_id,p_company_id,p_store_id,p_actor_user_id,p_metadata,p_company_id||'/'||p_store_id||'/monthly-source-files/'||p_request_id||'.xlsx') returning * into r;
   newly:=true;
  end if;
 end if;
 if r.request_id is null then
  if p_action in ('status','view') then return jsonb_build_object('status','not_found','request_id',p_request_id); end if;
  raise exception 'MONTHLY_SOURCE_RESERVATION_REQUIRED';
 end if;
 completed:=exists(select 1 from public.zysyr_monthly_source_completions where request_id=r.request_id);
 if (p_action='complete' or not completed) and r.actor_user_id<>p_actor_user_id then raise exception using errcode='42501',message='MONTHLY_SOURCE_REQUEST_SCOPE_MISMATCH'; end if;
 if p_action='complete' then
  insert into public.zysyr_monthly_source_completions(request_id,completed_by) values(r.request_id,p_actor_user_id) on conflict do nothing;completed:=true;
 end if;
 if p_action='view' and not completed then return jsonb_build_object('status','not_found','request_id',p_request_id); end if;
 return jsonb_build_object('status',case when completed then 'archived' else 'pending' end,'newly_reserved',newly,'request_id',r.request_id,
 'archive',r.metadata||jsonb_build_object('request_id',r.request_id,'object_path',r.object_path));
end $$;
revoke all on function public.zysyr_monthly_source_archive(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_monthly_source_archive(uuid,uuid,uuid,text,uuid,jsonb) to service_role;
