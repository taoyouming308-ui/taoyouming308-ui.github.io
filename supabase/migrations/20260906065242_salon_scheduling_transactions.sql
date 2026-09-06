-- Unified schedule occupancy and auditable queue transitions.
set statement_timeout='30s';set lock_timeout='5s';
create extension if not exists btree_gist;

create table public.salon_schedule_blocks(
 id bigint generated always as identity primary key,organization_id bigint not null,store_id bigint not null,staff_id bigint not null,
 block_type text not null check(block_type in('appointment','leave')),starts_at timestamptz not null,ends_at timestamptz not null,
 status text not null default 'active' check(status in('active','cancelled')),reason text not null default '',created_at timestamptz not null default now(),
 check(ends_at>starts_at),unique(organization_id,id),
 foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
 foreign key(organization_id,staff_id) references public.salon_staff(organization_id,id) on delete restrict,
 exclude using gist(organization_id with =,store_id with =,staff_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status='active')
);
alter table public.salon_appointments add column schedule_block_id bigint,
 add foreign key(organization_id,schedule_block_id) references public.salon_schedule_blocks(organization_id,id) on delete restrict;
create unique index salon_appointments_schedule_block_idx on public.salon_appointments(organization_id,schedule_block_id) where schedule_block_id is not null;

create table public.salon_queue_entries(
 id bigint generated always as identity primary key,organization_id bigint not null,store_id bigint not null,appointment_id bigint,staff_id bigint not null,
 status text not null default 'waiting' check(status in('waiting','away','serving','completed','cancelled')),is_specified boolean not null default false,
 round_no integer not null default 1 check(round_no>0),joined_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
 foreign key(organization_id,appointment_id) references public.salon_appointments(organization_id,id) on delete restrict,
 foreign key(organization_id,staff_id) references public.salon_staff(organization_id,id) on delete restrict
);
create unique index salon_queue_active_appointment_idx on public.salon_queue_entries(organization_id,appointment_id) where appointment_id is not null and status<>'cancelled';
create index salon_queue_order_idx on public.salon_queue_entries(organization_id,store_id,status,is_specified desc,joined_at,id);

create or replace function public.salon_create_appointment(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_staff_id bigint,p_customer_id bigint,p_starts_at timestamptz,p_ends_at timestamptz,p_source text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_block_id bigint;v_id bigint;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 if p_ends_at<=p_starts_at then raise exception '预约结束时间必须晚于开始时间';end if;
 if not exists(select 1 from public.salon_staff s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_staff_id and s.employment_status='active') then raise exception '手艺人不存在或不在当前门店';end if;
 insert into public.salon_schedule_blocks(organization_id,store_id,staff_id,block_type,starts_at,ends_at,reason)
 values(p_organization_id,p_store_id,p_staff_id,'appointment',p_starts_at,p_ends_at,'预约占用') returning id into v_block_id;
 insert into public.salon_appointments(organization_id,store_id,customer_id,staff_id,starts_at,ends_at,status,source,notes,schedule_block_id)
 values(p_organization_id,p_store_id,p_customer_id,p_staff_id,p_starts_at,p_ends_at,'confirmed',coalesce(nullif(btrim(p_source),''),'staff'),coalesce(p_notes,''),v_block_id) returning id into v_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason)
 values(p_organization_id,p_store_id,p_actor_staff_id,'appointment',v_id::text,'create',jsonb_build_object('staffId',p_staff_id,'startsAt',p_starts_at,'endsAt',p_ends_at),'创建预约');
 return jsonb_build_object('appointmentId',v_id,'status','confirmed');
exception when exclusion_violation then raise exception '该手艺人此时段已有预约或休假';end $$;

create or replace function public.salon_set_appointment_status(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_appointment_id bigint,p_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.salon_appointments;v_queue bigint;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 select * into v from public.salon_appointments a where a.organization_id=p_organization_id and a.store_id=p_store_id and a.id=p_appointment_id for update;
 if not found then raise exception '预约不存在或不属于当前门店';end if;
 if not ((v.status in('pending','confirmed') and p_status in('arrived','cancelled','no_show')) or (v.status='arrived' and p_status in('completed','cancelled'))) then raise exception '预约状态变更无效';end if;
 update public.salon_appointments set status=p_status where organization_id=p_organization_id and id=v.id;
 if p_status in('cancelled','no_show') then update public.salon_schedule_blocks set status='cancelled' where organization_id=p_organization_id and id=v.schedule_block_id;end if;
 if p_status='arrived' then insert into public.salon_queue_entries(organization_id,store_id,appointment_id,staff_id,is_specified) values(p_organization_id,p_store_id,v.id,v.staff_id,true) returning id into v_queue;end if;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'appointment',v.id::text,'status',jsonb_build_object('status',v.status),jsonb_build_object('status',p_status),coalesce(p_reason,''));
 return jsonb_build_object('appointmentId',v.id,'status',p_status,'queueId',v_queue);
end $$;

create or replace function public.salon_set_queue_status(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_queue_id bigint,p_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.salon_queue_entries;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 select * into v from public.salon_queue_entries q where q.organization_id=p_organization_id and q.store_id=p_store_id and q.id=p_queue_id for update;
 if not found then raise exception '轮牌记录不存在或不属于当前门店';end if;
 if not ((v.status='waiting' and p_status in('away','serving','cancelled')) or(v.status='away' and p_status in('waiting','cancelled'))or(v.status='serving' and p_status='completed')or(v.status='completed' and p_status='waiting')) then raise exception '轮牌状态变更无效';end if;
 update public.salon_queue_entries set status=p_status,round_no=case when v.status='completed' and p_status='waiting' then round_no+1 else round_no end,joined_at=case when v.status='completed' and p_status='waiting' then now() else joined_at end,updated_at=now() where organization_id=p_organization_id and id=v.id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'queue',v.id::text,'status',jsonb_build_object('status',v.status),jsonb_build_object('status',p_status),coalesce(p_reason,''));
 return jsonb_build_object('queueId',v.id,'status',p_status);
end $$;

do $$declare n text;begin foreach n in array array['salon_schedule_blocks','salon_queue_entries'] loop execute format('alter table public.%I enable row level security',n);execute format('alter table public.%I force row level security',n);execute format('revoke all on table public.%I from public,anon,authenticated',n);execute format('grant all on table public.%I to service_role',n);end loop;end$$;
revoke execute on function public.salon_create_appointment(bigint,bigint,bigint,bigint,bigint,timestamptz,timestamptz,text,text) from public,anon,authenticated;
revoke execute on function public.salon_set_appointment_status(bigint,bigint,bigint,bigint,text,text) from public,anon,authenticated;
revoke execute on function public.salon_set_queue_status(bigint,bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.salon_create_appointment(bigint,bigint,bigint,bigint,bigint,timestamptz,timestamptz,text,text) to service_role;
grant execute on function public.salon_set_appointment_status(bigint,bigint,bigint,bigint,text,text) to service_role;
grant execute on function public.salon_set_queue_status(bigint,bigint,bigint,bigint,text,text) to service_role;
