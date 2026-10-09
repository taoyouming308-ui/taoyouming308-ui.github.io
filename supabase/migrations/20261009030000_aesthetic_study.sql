create table public.aesthetic_study_cases (
 case_id text not null, content_version text not null, title text not null, published_date date not null,
 primary key(case_id,content_version)
);
alter table public.aesthetic_study_cases enable row level security;
revoke all on public.aesthetic_study_cases from public,anon,authenticated;
grant select,insert on public.aesthetic_study_cases to service_role;
-- Independent, private learning telemetry. Existing business/auth tables untouched.
create table public.aesthetic_study_events (
 event_id uuid primary key, employee_id integer not null, username text not null, store text not null,
 case_id text not null, content_version text not null, visit_id uuid not null,
 kind text not null check(kind in ('visit','time','answer_view','complete','uncomplete')),
 occurred_at timestamptz not null, received_at timestamptz not null default now(),
 start_ms bigint, end_ms bigint
);
create index aesthetic_study_events_employee_idx on public.aesthetic_study_events(employee_id,received_at desc);
create table public.aesthetic_study_progress (
 employee_id integer not null, username text not null, store text not null, case_id text not null, content_version text not null,
 first_view_at timestamptz, last_view_at timestamptz, visits integer not null default 0,
 active_ms bigint not null default 0, answer_viewed_at timestamptz, self_completed boolean not null default false,
 completion_changed_at timestamptz,
 primary key(employee_id,case_id,content_version)
);
create table public.aesthetic_study_time_union (
 employee_id integer not null, business_date date not null, spans int8multirange not null default '{}',
 primary key(employee_id,business_date)
);
create table public.aesthetic_study_candidate_archive (
 candidate_id uuid primary key references public.aesthetic_knowledge_candidates(id),
 before_status text not null, before_version integer not null, archived_version integer not null,
 archived_by text not null, archived_at timestamptz not null default now(), restored_at timestamptz, restored_by text
);
-- No browser grants or policies: only the custom-auth Edge service may access these.
alter table public.aesthetic_study_events enable row level security;
alter table public.aesthetic_study_progress enable row level security;
alter table public.aesthetic_study_time_union enable row level security;
alter table public.aesthetic_study_candidate_archive enable row level security;
revoke all on public.aesthetic_study_events,public.aesthetic_study_progress,public.aesthetic_study_time_union,public.aesthetic_study_candidate_archive from public,anon,authenticated;
grant select,insert,update on public.aesthetic_study_events,public.aesthetic_study_progress,public.aesthetic_study_time_union,public.aesthetic_study_candidate_archive to service_role;
grant delete on public.aesthetic_study_events,public.aesthetic_study_time_union to service_role;

create function public.aesthetic_study_ingest(p_employee_id integer,p_username text,p_store text,p_events jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare e jsonb; t timestamptz; lo bigint; hi bigint; day date; added bigint; available int8multirange; old_spans int8multirange; inserted uuid; accepted jsonb='[]';
begin
 if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events)>60 then raise exception 'invalid batch'; end if;
 -- Serialize all devices/cases for this employee. Count overlapping intervals once.
 perform pg_advisory_xact_lock(6100900,p_employee_id);
 -- Keep only the deduplication window; aggregate progress remains available.
 delete from aesthetic_study_events where employee_id=p_employee_id and received_at<now()-interval '8 days';
 delete from aesthetic_study_time_union where employee_id=p_employee_id and business_date<(now() at time zone 'Asia/Shanghai')::date-9;
 for e in select value from jsonb_array_elements(p_events) loop
  t := (e->>'at')::timestamptz;
  if t>now()+interval '2 minutes' or t<now()-interval '7 days' then raise exception 'event time outside retention window'; end if;
  if e->>'kind' not in ('visit','time','answer_view','complete','uncomplete') then raise exception 'invalid kind'; end if;
  lo:=null;hi:=null;
  if e->>'kind'='time' then
   lo:=(e->>'start_ms')::bigint;hi:=(e->>'end_ms')::bigint;
   if lo is null or hi is null or hi<=lo or hi-lo>25000 or abs(hi-extract(epoch from t)*1000)>1000 then raise exception 'invalid interval'; end if;
   if (to_timestamp(lo/1000.0) at time zone 'Asia/Shanghai')::date <> (to_timestamp((hi-1)/1000.0) at time zone 'Asia/Shanghai')::date then raise exception 'split midnight interval'; end if;
  end if;
  inserted:=null;
  insert into aesthetic_study_events(event_id,employee_id,username,store,case_id,content_version,visit_id,kind,occurred_at,start_ms,end_ms)
   values((e->>'event_id')::uuid,p_employee_id,p_username,p_store,e->>'case_id',e->>'content_version',(e->>'visit_id')::uuid,e->>'kind',t,lo,hi)
   on conflict do nothing returning event_id into inserted;
  if inserted is null then
   if not exists(select 1 from aesthetic_study_events where event_id=(e->>'event_id')::uuid and employee_id=p_employee_id) then raise exception 'event owner mismatch';end if;
   accepted:=accepted || jsonb_build_array(e->>'event_id'); continue;
  end if;
  insert into aesthetic_study_progress(employee_id,username,store,case_id,content_version)
   values(p_employee_id,p_username,p_store,e->>'case_id',e->>'content_version') on conflict do nothing;
  added:=0;
  if lo is not null then
   day:=(t at time zone 'Asia/Shanghai')::date;
   insert into aesthetic_study_time_union(employee_id,business_date) values(p_employee_id,day) on conflict do nothing;
   select spans into old_spans from aesthetic_study_time_union where employee_id=p_employee_id and business_date=day for update;
   available:=int8multirange(int8range(lo,hi,'[)'))-old_spans;
   select coalesce(sum(upper(r)-lower(r)),0) into added from unnest(available) r;
   update aesthetic_study_time_union set spans=spans+int8multirange(int8range(lo,hi,'[)')) where employee_id=p_employee_id and business_date=day;
  end if;
  update aesthetic_study_progress set
   username=p_username,store=p_store,
   first_view_at=case when e->>'kind'='visit' then least(coalesce(first_view_at,t),t) else first_view_at end,
   last_view_at=greatest(coalesce(last_view_at,t),t),
   visits=visits+case when e->>'kind'='visit' and not exists(select 1 from aesthetic_study_events where employee_id=p_employee_id and case_id=e->>'case_id' and content_version=e->>'content_version' and visit_id=(e->>'visit_id')::uuid and kind='visit' and event_id<>inserted) then 1 else 0 end,
   active_ms=active_ms+added,
   answer_viewed_at=case when e->>'kind'='answer_view' then greatest(coalesce(answer_viewed_at,t),t) else answer_viewed_at end,
   self_completed=case when e->>'kind' in ('complete','uncomplete') and (completion_changed_at is null or t>completion_changed_at) then e->>'kind'='complete' else self_completed end,
   completion_changed_at=case when e->>'kind' in ('complete','uncomplete') then greatest(coalesce(completion_changed_at,t),t) else completion_changed_at end
  where employee_id=p_employee_id and case_id=e->>'case_id' and content_version=e->>'content_version';
  accepted:=accepted||jsonb_build_array(e->>'event_id');
 end loop;
 return jsonb_build_object('accepted',accepted);
end $$;
revoke all on function public.aesthetic_study_ingest(integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.aesthetic_study_ingest(integer,text,text,jsonb) to service_role;

create function public.aesthetic_study_restore_candidate(p_id uuid,p_operator text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare a aesthetic_study_candidate_archive%rowtype;
begin
 select * into a from aesthetic_study_candidate_archive where candidate_id=p_id and restored_at is null for update;
 if not found then raise exception 'no active archive';end if;
 update aesthetic_knowledge_candidates set status=a.before_status,version=version+1,updated_at=now()
  where id=p_id and status='archived' and version=a.archived_version;
 if not found then raise exception 'candidate changed; manual review required';end if;
 update aesthetic_study_candidate_archive set restored_at=now(),restored_by=p_operator where candidate_id=p_id;
 return true;
end $$;
revoke all on function public.aesthetic_study_restore_candidate(uuid,text) from public,anon,authenticated;
grant execute on function public.aesthetic_study_restore_candidate(uuid,text) to service_role;
