-- Staff review of a customer's cancellation request. No payment or notification side effects.
set statement_timeout='30s';
set lock_timeout='5s';

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review'
));

create index salon_orders_appointment_lookup_idx on public.salon_orders(organization_id,store_id,appointment_id) where appointment_id is not null;

create function public.salon_review_booking_cancel(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_decision text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_booking public.salon_customer_booking_requests;v_appointment public.salon_appointments;v_response jsonb;v_status text;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'booking_cancel_review','booking_request',p_booking_request_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_decision',p_decision,'p_reason',p_reason),'customer_portal','manage');
 if v_op.completed_at is not null then return v_op.response_json;end if;
 if p_decision is null or p_decision not in('approved','rejected') or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception '取消复核决定或原因无效';end if;
 select * into v_booking from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_booking_request_id for update;
 if not found or v_booking.status<>'cancel_requested' or v_booking.appointment_id is null then raise exception '没有待复核的正式预约取消申请';end if;
 select * into v_appointment from public.salon_appointments where organization_id=p_organization_id and store_id=p_store_id and id=v_booking.appointment_id for update;
 if not found or v_appointment.customer_id is distinct from v_booking.customer_id or v_appointment.status<>'confirmed' then raise exception '预约已到店、结束或归属不一致，请人工核对';end if;
 perform 1 from public.salon_schedule_blocks where organization_id=p_organization_id and store_id=p_store_id and id=v_appointment.schedule_block_id and staff_id=v_appointment.staff_id and block_type='appointment' and status='active' for update;
 if not found then raise exception '预约档期归属或状态不一致，请人工核对';end if;
 if exists(select 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and appointment_id=v_appointment.id) then raise exception '预约已关联订单，请先人工处理订单';end if;
 if p_decision='approved' then
  perform public.salon_set_appointment_status(p_actor_staff_id,p_organization_id,p_store_id,v_appointment.id,'cancelled',p_reason);
  v_status:='cancelled';
 else v_status:='confirmed';end if;
 update public.salon_customer_booking_requests set status=v_status,handled_by_staff_id=p_actor_staff_id,handled_at=now(),handle_reason=btrim(p_reason),updated_at=now() where organization_id=p_organization_id and id=v_booking.id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason)
 values(p_organization_id,p_store_id,p_actor_staff_id,'customer_booking',v_booking.id::text,'cancel_review',jsonb_build_object('status',v_booking.status,'requestReason',v_booking.handle_reason),jsonb_build_object('status',v_status,'decision',p_decision,'appointmentId',v_appointment.id),btrim(p_reason));
 v_response:=jsonb_build_object('bookingRequestId',v_booking.id,'appointmentId',v_appointment.id,'status',v_status,'decision',p_decision);
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;
 return v_response;
end$$;
revoke execute on function public.salon_review_booking_cancel(bigint,bigint,bigint,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.salon_review_booking_cancel(bigint,bigint,bigint,bigint,text,text,text) to service_role;

-- Serialize linked order creation with cancellation: claim request, then lock appointment.
-- A late order cannot link to an already cancelled appointment. Existing completed retries remain valid.
create or replace function public.salon_create_order(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_request_key text,p_customer_id bigint default null,p_appointment_id bigint default null,p_notes text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_id bigint;v_no text;v_hash bigint;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','write');
 if p_customer_id is not null and not exists(select 1 from public.salon_customers c join public.salon_customer_store_relations r on r.organization_id=c.organization_id and r.customer_id=c.id where c.organization_id=p_organization_id and c.id=p_customer_id and c.status='active' and r.store_id=p_store_id) then raise exception '顾客不存在、已冻结或不属于当前门店';end if;
 v_hash:=hashtextextended(jsonb_build_object('customer',p_customer_id,'appointment',p_appointment_id,'notes',btrim(coalesce(p_notes,'')))::text,0);
 v_request:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'order_create','order_payload',v_hash,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_customer_id',p_customer_id,'p_appointment_id',p_appointment_id,'p_notes',p_notes),'orders','write');
 if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_appointment_id is not null then
  perform 1 from public.salon_appointments a where a.organization_id=p_organization_id and a.store_id=p_store_id and a.id=p_appointment_id and a.status in('confirmed','arrived') and (p_customer_id is null or a.customer_id=p_customer_id) for update;
  if not found then raise exception '预约不存在、已结束、跨店或顾客不一致';end if;
 end if;
 v_no:='S'||p_store_id::text||'-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.salon_order_number_seq')::text,8,'0');
 insert into public.salon_orders(organization_id,store_id,order_no,customer_id,appointment_id,status,created_by_staff_id,notes) values(p_organization_id,p_store_id,v_no,p_customer_id,p_appointment_id,'draft',p_actor_staff_id,btrim(coalesce(p_notes,''))) returning id into v_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json) values(p_organization_id,p_store_id,p_actor_staff_id,'order',v_id::text,'create',jsonb_build_object('orderNo',v_no,'customerId',p_customer_id,'appointmentId',p_appointment_id));
 v_response:=jsonb_build_object('orderId',v_id,'orderNo',v_no,'status','draft');
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end$$;
