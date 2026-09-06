set statement_timeout='30s';
set lock_timeout='5s';
create table public.salon_booking_change_requests(
 id bigint generated always as identity primary key,organization_id bigint not null,store_id bigint not null,customer_id bigint not null,
 booking_request_id bigint not null,requested_by_auth_id uuid not null,expected_starts_at timestamptz not null,expected_ends_at timestamptz not null,
 expected_version integer not null check(expected_version>=0),new_starts_at timestamptz not null,request_reason text not null,
 status text not null default 'submitted' check(status in('submitted','approved','rejected')),decision_reason text not null default '',
 handled_by_staff_id bigint,handled_at timestamptz,created_at timestamptz not null default now(),unique(organization_id,id),
 check(expected_ends_at>expected_starts_at),check(isfinite(new_starts_at)),
 foreign key(organization_id,store_id) references public.salon_stores(organization_id,id),
 foreign key(organization_id,customer_id) references public.salon_customers(organization_id,id),
 foreign key(organization_id,booking_request_id) references public.salon_customer_booking_requests(organization_id,id),
 foreign key(organization_id,handled_by_staff_id) references public.salon_staff(organization_id,id)
);
create unique index salon_booking_change_pending_idx on public.salon_booking_change_requests(organization_id,store_id,booking_request_id) where status='submitted';
create index salon_booking_change_customer_idx on public.salon_booking_change_requests(organization_id,store_id,customer_id,created_at desc,id desc);
alter table public.salon_booking_change_requests enable row level security;
alter table public.salon_booking_change_requests force row level security;
revoke all on public.salon_booking_change_requests from public,anon,authenticated;
grant select,insert,update on public.salon_booking_change_requests to service_role;
grant usage,select on sequence public.salon_booking_change_requests_id_seq to service_role;

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review','booking_reschedule','booking_change_request','booking_change_review'
));

-- Only extend the allowed action; the new public RPC performs its own locked ownership check before replay.
create or replace function salon_private.claim_customer_request(
 p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_request_key text,
 p_action text,p_payload jsonb
) returns public.salon_operation_requests
language plpgsql security invoker set search_path='' as $$
declare v_customer_id bigint;v_op public.salon_operation_requests;v_digest bytea;
begin
 select i.customer_id into v_customer_id
 from public.salon_customer_auth_identities i
 join public.salon_customers c on c.organization_id=i.organization_id and c.id=i.customer_id
 join public.salon_organizations o on o.id=i.organization_id
 join public.salon_stores s on s.organization_id=o.id and s.id=p_store_id
 where i.organization_id=p_organization_id and i.auth_user_id=p_auth_user_id
 and i.status='active' and c.status='active' and o.status='active' and s.status='active'
 for share of i,c,o,s;
 if not found then raise exception '顾客端账号未绑定或已停用，或门店不可用';end if;
 if p_action='review_create' then
  perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id
   and id=(p_payload->>'p_order_id')::bigint and customer_id=v_customer_id for update;
  if not found then raise exception '仅订单本人可评价已完成服务人员';end if;
 elsif p_action='booking_cancel' then
  perform 1 from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id
   and id=(p_payload->>'p_booking_request_id')::bigint and customer_id=v_customer_id for update;
  if not found then raise exception '预约申请不存在或当前不能取消';end if;
 elsif p_action not in('consent_set','booking_request','booking_change_request') then
  raise exception '不支持的顾客请求';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception '请求参数无效';end if;
 v_digest:=sha256(convert_to(p_payload::text,'UTF8'));
 v_op:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,p_action,'customer_request_v2',v_customer_id);
 select * into v_op from public.salon_operation_requests where id=v_op.id for update;
 if v_op.customer_auth_user_id is not null then
  if v_op.customer_auth_user_id<>p_auth_user_id or v_op.customer_payload_digest is distinct from v_digest
   then raise exception '幂等键已被其他业务使用';end if;
 elsif v_op.completed_at is not null then
  raise exception '旧请求缺少身份校验信息，请核对业务记录';
 else
  update public.salon_operation_requests set customer_auth_user_id=p_auth_user_id,customer_payload_digest=v_digest
   where id=v_op.id returning * into v_op;
 end if;
 return v_op;
end$$;

create function public.salon_customer_request_reschedule(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_expected_starts_at timestamptz,p_expected_ends_at timestamptz,p_expected_version integer,p_new_starts_at timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_customer bigint;v_op public.salon_operation_requests;v_booking public.salon_customer_booking_requests;v_id bigint;v_response jsonb;
begin
 v_customer:=salon_private.assert_customer_read_scope(p_auth_user_id,p_organization_id,p_store_id);
 v_op:=salon_private.claim_customer_request(p_auth_user_id,p_organization_id,p_store_id,p_request_key,'booking_change_request',jsonb_build_object('p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_expected_starts_at',p_expected_starts_at,'p_expected_ends_at',p_expected_ends_at,'p_expected_version',p_expected_version,'p_new_starts_at',p_new_starts_at,'p_reason',p_reason));
 select * into v_booking from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_booking_request_id and customer_id=v_customer for update;
 if not found then raise exception '仅可申请修改本人的预约';end if;
 if v_op.completed_at is not null then return v_op.response_json;end if;
 if v_booking.status<>'confirmed' or v_booking.appointment_id is null then raise exception '仅已确认且未申请取消的预约可以申请改期';end if;
 if v_booking.starts_at is distinct from p_expected_starts_at or v_booking.ends_at is distinct from p_expected_ends_at or v_booking.reschedule_version is distinct from p_expected_version then raise exception '预约已变化，请刷新后重新申请';end if;
 if p_new_starts_at is null or not isfinite(p_new_starts_at) or p_new_starts_at<=now() or p_new_starts_at=v_booking.starts_at or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception '改期时间或原因无效';end if;
 perform 1 from public.salon_appointments where organization_id=p_organization_id and store_id=p_store_id and id=v_booking.appointment_id and customer_id=v_customer and status='confirmed' for update;
 if not found then raise exception '预约已到店或结束，不能申请改期';end if;
 if exists(select 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and appointment_id=v_booking.appointment_id) then raise exception '预约已关联订单，请联系门店';end if;
 if exists(select 1 from public.salon_booking_change_requests where organization_id=p_organization_id and store_id=p_store_id and booking_request_id=v_booking.id and status='submitted') then raise exception '已有待处理改期申请，请等待门店处理';end if;
 insert into public.salon_booking_change_requests(organization_id,store_id,customer_id,booking_request_id,requested_by_auth_id,expected_starts_at,expected_ends_at,expected_version,new_starts_at,request_reason)
 values(p_organization_id,p_store_id,v_customer,v_booking.id,p_auth_user_id,v_booking.starts_at,v_booking.ends_at,v_booking.reschedule_version,p_new_starts_at,btrim(p_reason)) returning id into v_id;
 insert into public.salon_audit_events(organization_id,store_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,'booking_change',v_id::text,'request',jsonb_build_object('bookingRequestId',v_booking.id,'expectedVersion',v_booking.reschedule_version,'newStartsAt',p_new_starts_at),btrim(p_reason));
 v_response:=jsonb_build_object('changeRequestId',v_id,'bookingRequestId',v_booking.id,'status','submitted');
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end$$;

create function public.salon_review_reschedule_request(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_change_request_id bigint,p_request_key text,p_decision text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_op public.salon_operation_requests;v_change public.salon_booking_change_requests;v_applied jsonb;v_response jsonb;v_key text;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'booking_change_review','booking_change',p_change_request_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_change_request_id',p_change_request_id,'p_decision',p_decision,'p_reason',p_reason),'customer_portal','manage');
 if v_op.completed_at is not null then return v_op.response_json;end if;
 if p_decision is null or p_decision not in('approved','rejected') or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception '改期处理决定或原因无效';end if;
 select * into v_change from public.salon_booking_change_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_change_request_id for update;
 if not found or v_change.status<>'submitted' then raise exception '改期申请不存在或已处理';end if;
 if p_decision='approved' then
  if salon_private.assert_customer_read_scope(v_change.requested_by_auth_id,p_organization_id,p_store_id)<>v_change.customer_id then raise exception '顾客身份已变化，不能批准';end if;
  v_key:='change-confirm-'||v_change.id::text||'-'||substr(encode(sha256(convert_to(p_request_key,'UTF8')),'hex'),1,32);
  v_applied:=public.salon_reschedule_booking(p_actor_staff_id,p_organization_id,p_store_id,v_change.booking_request_id,v_key,v_change.expected_starts_at,v_change.expected_ends_at,v_change.expected_version,v_change.new_starts_at,p_reason);
 end if;
 update public.salon_booking_change_requests set status=p_decision,decision_reason=btrim(p_reason),handled_by_staff_id=p_actor_staff_id,handled_at=now() where organization_id=p_organization_id and id=v_change.id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'booking_change',v_change.id::text,'review',jsonb_build_object('status','submitted'),jsonb_build_object('status',p_decision,'bookingRequestId',v_change.booking_request_id),btrim(p_reason));
 v_response:=jsonb_build_object('changeRequestId',v_change.id,'status',p_decision,'booking',v_applied);
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end$$;

create function public.salon_list_reschedule_requests(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_status text default '',p_limit integer default 200)
returns jsonb language plpgsql security invoker set search_path='' as $$declare v_result jsonb;begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customer_portal','manage');
 if p_limit is null or p_limit not between 1 and 200 then raise exception '查询数量无效';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from(select id,booking_request_id,expected_starts_at,expected_ends_at,new_starts_at,request_reason,status,decision_reason,created_at,handled_at from public.salon_booking_change_requests where organization_id=p_organization_id and store_id=p_store_id and (coalesce(p_status,'')='' or status=p_status) order by created_at desc,id desc limit p_limit)x;return v_result;
end$$;
create function public.salon_customer_list_reschedules(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path='' as $$declare v_customer bigint;v_result jsonb;begin
 v_customer:=salon_private.assert_customer_read_scope(p_auth_user_id,p_organization_id,p_store_id);
 if p_limit is null or p_limit not between 1 and 200 then raise exception '查询数量无效';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from(select id,booking_request_id,expected_starts_at,expected_ends_at,new_starts_at,request_reason,status,decision_reason,created_at,handled_at from public.salon_booking_change_requests where organization_id=p_organization_id and store_id=p_store_id and customer_id=v_customer order by created_at desc,id desc limit p_limit)x;return v_result;
end$$;
revoke execute on function public.salon_customer_request_reschedule(uuid,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text),public.salon_review_reschedule_request(bigint,bigint,bigint,bigint,text,text,text),public.salon_list_reschedule_requests(bigint,bigint,bigint,text,integer),public.salon_customer_list_reschedules(uuid,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.salon_customer_request_reschedule(uuid,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text),public.salon_review_reschedule_request(bigint,bigint,bigint,bigint,text,text,text),public.salon_list_reschedule_requests(bigint,bigint,bigint,text,integer),public.salon_customer_list_reschedules(uuid,bigint,bigint,integer) to service_role;
