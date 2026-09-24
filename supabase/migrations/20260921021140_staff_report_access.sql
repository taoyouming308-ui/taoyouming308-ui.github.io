-- Staff-report permissions are independent of job titles and financial accounts.
create table public.staff_access_sessions (
  token_hash text primary key,
  staff_id integer not null references public.staff(id),
  credential_hash text not null,
  role text not null,
  store text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index staff_access_sessions_staff_idx on public.staff_access_sessions(staff_id);
create table public.staff_report_grants (
  staff_id integer not null references public.staff(id),
  store_id uuid not null references public.zysyr_stores(id),
  created_at timestamptz not null default now(),
  primary key(staff_id,store_id)
);
create index staff_report_grants_store_idx on public.staff_report_grants(store_id);
create table public.staff_access_audit (
  id bigint generated always as identity primary key,
  actor_id integer not null references public.staff(id),
  target_id integer not null,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.staff_access_rate_limits (
  key_hash text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.staff_access_sessions enable row level security;
alter table public.staff_report_grants enable row level security;
alter table public.staff_access_audit enable row level security;
alter table public.staff_access_rate_limits enable row level security;
revoke all on public.staff_access_sessions,public.staff_report_grants,public.staff_access_audit,public.staff_access_rate_limits from public,anon,authenticated;
grant all on public.staff_access_sessions,public.staff_report_grants,public.staff_access_audit,public.staff_access_rate_limits to service_role;
grant usage,select on sequence public.staff_access_audit_id_seq to service_role;

create function public.staff_access_rate_limit(p_key_hash text,p_max_attempts integer default 20) returns boolean
language plpgsql security invoker set search_path = public,pg_temp as $$
declare n integer;
begin
  insert into public.staff_access_rate_limits(key_hash,window_start,attempts) values(p_key_hash,now(),1)
  on conflict(key_hash) do update set
    attempts=case when staff_access_rate_limits.window_start < now()-interval '15 minutes' then 1 else staff_access_rate_limits.attempts+1 end,
    window_start=case when staff_access_rate_limits.window_start < now()-interval '15 minutes' then now() else staff_access_rate_limits.window_start end
  returning attempts into n;
  return n<=least(120,greatest(1,coalesce(p_max_attempts,20)));
end $$;
revoke all on function public.staff_access_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function public.staff_access_rate_limit(text,integer) to service_role;

-- One transaction: validate the live administrator, update employee and store
-- grants, append the permission audit. No financial data is written here.
create function public.staff_access_manage(p_token_hash text,p_operation text,p_target_id integer,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = public,pg_temp as $$
declare actor public.staff; target public.staff; saved public.staff; sess public.staff_access_sessions;
  old_grants jsonb; new_grants jsonb; grants uuid[]; is_owner boolean; state text;
begin
  select * into sess from public.staff_access_sessions where token_hash=p_token_hash and expires_at>now();
  select * into actor from public.staff where id=sess.staff_id for update;
  if actor.id is null or actor.active is not true or actor.employment_status is distinct from 'active'
     or coalesce(actor.role,'') not in ('admin','store_admin') or actor.role is distinct from sess.role
     or coalesce(actor.store,'')<>sess.store or actor.password_hash is distinct from sess.credential_hash
     or (actor.role='store_admin' and nullif(actor.store,'') is null) then
    raise exception 'ADMIN_SESSION_INVALID';
  end if;
  is_owner:=actor.role='admin';
  if coalesce(p_operation,'') not in ('save','employment','approve','reject','grants') then raise exception 'OPERATION_INVALID'; end if;
  if coalesce(p_target_id,0)>0 then
    select * into target from public.staff where id=p_target_id for update;
    if target.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
    if not is_owner and (target.role is distinct from 'staff' or target.store is distinct from actor.store) then raise exception 'STAFF_FORBIDDEN'; end if;
    if target.id=actor.id and p_operation in ('employment','reject') then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
  elsif p_operation<>'save' then raise exception 'STAFF_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(store_id order by store_id),'[]') into old_grants from public.staff_report_grants where staff_id=target.id;
  if p_operation in ('approve','reject') and target.employment_status is distinct from 'pending' then raise exception 'APPLICATION_CHANGED'; end if;
  if p_operation='reject' then
    -- Retain the rejected application for audit; no irreversible deletion.
    update public.staff set active=false,employment_status='departed' where id=target.id returning * into saved;
  elsif p_operation='employment' then
    state:=p_data->>'employment_status';
    if coalesce(state,'') not in ('active','departed') then raise exception 'STATUS_INVALID'; end if;
    update public.staff set active=(state='active'),employment_status=state where id=target.id returning * into saved;
  elsif p_operation='grants' then saved:=target;
  else
    if nullif(trim(p_data->>'username'),'') is null or nullif(trim(p_data->>'store'),'') is null or nullif(trim(p_data->>'position'),'') is null then raise exception 'STAFF_FIELDS_REQUIRED'; end if;
    if not exists(select 1 from public.zysyr_stores where name=p_data->>'store' and status='active') then raise exception 'STORE_INVALID'; end if;
    if coalesce(p_data->>'role','') not in ('staff','admin','store_admin') then raise exception 'ROLE_INVALID'; end if;
    if not is_owner and ((p_data->>'role')<>'staff' or (p_data->>'store') is distinct from actor.store) then raise exception 'STAFF_FORBIDDEN'; end if;
    if p_operation='approve' and (p_data->>'role')<>'staff' then raise exception 'ROLE_INVALID'; end if;
    if target.id=actor.id and ((p_data->>'role')<>actor.role or (p_data->>'store') is distinct from actor.store) then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
    if target.id is null then
      if nullif(p_data->>'password_hash','') is null then raise exception 'PASSWORD_REQUIRED'; end if;
      insert into public.staff(username,password_hash,role,store,position,active,employment_status)
        values(p_data->>'username',p_data->>'password_hash',p_data->>'role',p_data->>'store',p_data->>'position',true,'active') returning * into saved;
    else
      update public.staff set username=p_data->>'username',role=p_data->>'role',store=p_data->>'store',position=p_data->>'position',
        password_hash=coalesce(nullif(p_data->>'password_hash',''),password_hash),
        active=case when p_operation='approve' then true else active end,
        employment_status=case when p_operation='approve' then 'active' else employment_status end
      where id=target.id returning * into saved;
    end if;
  end if;
  if p_data ? 'report_store_ids' then
    if not is_owner then raise exception 'REPORT_GRANT_FORBIDDEN'; end if;
    if jsonb_typeof(p_data->'report_store_ids')<>'array' then raise exception 'STORE_INVALID'; end if;
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into grants from jsonb_array_elements_text(p_data->'report_store_ids');
    if cardinality(grants)>50 or exists(select 1 from unnest(grants) g where not exists(select 1 from public.zysyr_stores s where s.id=g and s.status='active')) then raise exception 'STORE_INVALID'; end if;
    delete from public.staff_report_grants where staff_id=saved.id;
    insert into public.staff_report_grants(staff_id,store_id) select saved.id,g from unnest(grants) g;
  end if;
  if saved.active is not true or saved.employment_status<>'active' then delete from public.staff_report_grants where staff_id=saved.id; end if;
  if target.id is not null and (saved.password_hash is distinct from target.password_hash or saved.username<>target.username or saved.store is distinct from target.store or saved.role is distinct from target.role or saved.active is not true or saved.employment_status<>'active') then
    delete from public.employee_booking_sessions where username=target.username;
    delete from public.staff_access_sessions where staff_id=saved.id;
    delete from public.zysyr_operations_sessions where username=target.username;
  end if;
  select coalesce(jsonb_agg(store_id order by store_id),'[]') into new_grants from public.staff_report_grants where staff_id=saved.id;
  insert into public.staff_access_audit(actor_id,target_id,operation,before_data,after_data)
    values(actor.id,saved.id,p_operation,(to_jsonb(target)-'password_hash')||jsonb_build_object('report_store_ids',old_grants),
      (to_jsonb(saved)-'password_hash')||jsonb_build_object('report_store_ids',new_grants));
  return (to_jsonb(saved)-'password_hash')||jsonb_build_object('report_store_ids',new_grants);
end $$;
revoke all on function public.staff_access_manage(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.staff_access_manage(text,text,integer,jsonb) to service_role;
