-- Same-staff, same-duration rescheduling with optimistic version and occupancy checks.
set statement_timeout='30s';
set lock_timeout='5s';
alter table public.salon_customer_booking_requests add column reschedule_version integer not null default 0 check(reschedule_version>=0);
alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review','booking_reschedule'
));

create function public.salon_reschedule_booking(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_expected_starts_at timestamptz,p_expected_ends_at timestamptz,p_expected_version integer,p_new_starts_at timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare v_op public.salon_operation_requests;v_booking public.salon_customer_booking_requests;v_appointment public.salon_appointments;v_end timestamptz;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'scheduling','write');
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'booking_reschedule','booking_request',p_booking_request_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_expected_starts_at',p_expected_starts_at,'p_expected_ends_at',p_expected_ends_at,'p_expected_version',p_expected_version,'p_new_starts_at',p_new_starts_at,'p_reason',p_reason),'customer_portal','manage');
 if v_op.completed_at is not null then return v_op.response_json;end if;
 if p_new_starts_at is null or not isfinite(p_new_starts_at) or p_new_starts_at<=now() or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception '改期时间必须在未来且必须填写原因';end if;
 select * into v_booking from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_booking_request_id for update;
 if not found or v_booking.status<>'confirmed' or v_booking.appointment_id is null then raise exception '仅已确认且未申请取消的预约可以改期';end if;
 if v_booking.reschedule_version is distinct from p_expected_version or v_booking.starts_at is distinct from p_expected_starts_at or v_booking.ends_at is distinct from p_expected_ends_at then raise exception '预约时间已变化，请刷新后重新确认';end if;
 if p_new_starts_at=v_booking.starts_at then raise exception '新时间与原预约相同，无需改期';end if;
 select * into v_appointment from public.salon_appointments where organization_id=p_organization_id and store_id=p_store_id and id=v_booking.appointment_id for update;
 if not found or v_appointment.status<>'confirmed' or v_appointment.customer_id is distinct from v_booking.customer_id or v_appointment.staff_id is distinct from v_booking.staff_id or v_appointment.starts_at is distinct from v_booking.starts_at or v_appointment.ends_at is distinct from v_booking.ends_at then raise exception '预约已到店、结束或记录不一致，请人工核对';end if;
 if exists(select 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and appointment_id=v_appointment.id) then raise exception '预约已关联订单，不能直接改期';end if;
 -- Serialize moves for the same staff without upgrading foreign-key KEY SHARE locks.
 perform 1 from public.salon_staff where organization_id=p_organization_id and store_id=p_store_id and id=v_appointment.staff_id and employment_status='active' for no key update;
 if not found then raise exception '原手艺人已停用或不在本店，请人工处理';end if;
 perform 1 from public.salon_schedule_blocks where organization_id=p_organization_id and store_id=p_store_id and id=v_appointment.schedule_block_id and staff_id=v_appointment.staff_id and status='active' and block_type='appointment' and starts_at=v_appointment.starts_at and ends_at=v_appointment.ends_at for update;
 if not found then raise exception '预约档期归属或状态不一致，请人工核对';end if;
 v_end:=p_new_starts_at+(v_booking.ends_at-v_booking.starts_at);
 -- The exclusion constraint checks the replacement interval against every other active block.
 -- Any conflict rolls back this entire function, including the claimed request and audit.
 update public.salon_schedule_blocks set starts_at=p_new_starts_at,ends_at=v_end where organization_id=p_organization_id and id=v_appointment.schedule_block_id;
 update public.salon_appointments set starts_at=p_new_starts_at,ends_at=v_end where organization_id=p_organization_id and id=v_appointment.id;
 update public.salon_customer_booking_requests set starts_at=p_new_starts_at,ends_at=v_end,reschedule_version=reschedule_version+1,handled_by_staff_id=p_actor_staff_id,handled_at=now(),handle_reason=btrim(p_reason),updated_at=now() where organization_id=p_organization_id and id=v_booking.id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason)
 values(p_organization_id,p_store_id,p_actor_staff_id,'customer_booking',v_booking.id::text,'reschedule',jsonb_build_object('startsAt',v_booking.starts_at,'endsAt',v_booking.ends_at,'appointmentId',v_appointment.id,'staffId',v_appointment.staff_id,'rescheduleVersion',v_booking.reschedule_version),jsonb_build_object('startsAt',p_new_starts_at,'endsAt',v_end,'appointmentId',v_appointment.id,'staffId',v_appointment.staff_id,'rescheduleVersion',v_booking.reschedule_version+1),btrim(p_reason));
 v_response:=jsonb_build_object('bookingRequestId',v_booking.id,'appointmentId',v_appointment.id,'status','confirmed','startsAt',p_new_starts_at,'endsAt',v_end,'rescheduleVersion',v_booking.reschedule_version+1);
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;
 return v_response;
exception when exclusion_violation then raise exception '新档期与预约或休假冲突，原预约保持不变';
end$$;
revoke execute on function public.salon_reschedule_booking(bigint,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.salon_reschedule_booking(bigint,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text) to service_role;
