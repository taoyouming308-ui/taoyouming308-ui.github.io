-- Independent branch only. Withdrawal releases an unreviewed request; it never reverses money or stock.
set statement_timeout='30s';
set lock_timeout='5s';

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'cash_checkout','checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','refund_withdraw','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review','booking_reschedule','booking_change_request','booking_change_review'
));

alter table public.salon_refund_requests
 add column withdrawn_by_staff_id bigint references public.salon_staff(id),
 add column withdrawn_at timestamptz,
 add column withdrawal_reason text;
alter table public.salon_refund_requests add constraint salon_refund_withdrawal_fields_check check(
 (withdrawn_by_staff_id is null and withdrawn_at is null and withdrawal_reason is null)
 or (withdrawn_by_staff_id is not null and withdrawn_at is not null and nullif(btrim(withdrawal_reason),'') is not null and status='cancelled')
);

create or replace function public.salon_get_refund_review(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_refund public.salon_refund_requests;v_order public.salon_orders;v_lines jsonb;v_payments jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id;
 if not found then raise exception '退款申请不存在或不属于当前门店';end if;
 select * into v_order from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=v_refund.order_id;
 if not found then raise exception '退款原订单范围不匹配';end if;
 select coalesce(jsonb_agg(jsonb_build_object('orderLineId',l.order_line_id,'name',l.item_name,'type',l.item_type,'quantity',l.quantity::text,'amount',l.refund_amount::text) order by l.order_line_id),'[]') into v_lines
 from public.salon_refund_request_lines l join public.salon_order_lines o on o.organization_id=l.organization_id and o.id=l.order_line_id and o.order_id=v_order.id
 where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id;
 select coalesce(jsonb_agg(jsonb_build_object('paymentId',l.original_payment_id,'method',l.payment_method,'amount',l.refund_amount::text,'units',l.refund_units::text,'originalMethod',p.payment_method,'originalAmount',p.amount::text,'originalUnits',p.member_units::text,'originalStatus',p.status) order by l.original_payment_id),'[]') into v_payments
 from public.salon_refund_request_payments l join public.salon_payments p on p.organization_id=l.organization_id and p.id=l.original_payment_id and p.order_id=v_order.id and p.store_id=p_store_id and p.reversal_of_id is null
 where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id;
 if jsonb_array_length(v_lines)<>(select count(*) from public.salon_refund_request_lines where organization_id=p_organization_id and refund_request_id=p_refund_request_id) or jsonb_array_length(v_payments)<>(select count(*) from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=p_refund_request_id) then raise exception '退款明细或支付分配范围不匹配';end if;
 return jsonb_build_object('refund',jsonb_build_object('id',v_refund.id,'organizationId',v_refund.organization_id,'storeId',v_refund.store_id,'orderId',v_refund.order_id,'type',v_refund.refund_type,'status',v_refund.status,'amount',v_refund.requested_amount::text,'reason',v_refund.reason,'createdByStaffId',v_refund.created_by_staff_id,'reviewedByStaffId',v_refund.reviewed_by_staff_id,'decisionReason',v_refund.decision_reason,'withdrawnByStaffId',v_refund.withdrawn_by_staff_id,'withdrawalReason',coalesce(v_refund.withdrawal_reason,'')),
  'order',jsonb_build_object('id',v_order.id,'number',v_order.order_no,'status',v_order.status,'payable',v_order.payable_total::text,'refundedTotal',v_order.refunded_total::text,'version',v_order.edit_version),'lines',v_lines,'payments',v_payments);
end $$;
revoke execute on function public.salon_get_refund_review(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_refund_review(bigint,bigint,bigint,bigint) to service_role;

create or replace function public.salon_withdraw_refund_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,
 p_request_key text,p_reason text,p_expected_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_req public.salon_operation_requests;v_refund public.salon_refund_requests;v_current jsonb;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 if p_refund_request_id is null or p_refund_request_id<=0 or p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$'
  or nullif(btrim(coalesce(p_reason,'')),'') is null or length(p_reason)>500
  or p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot)<>'object' then raise exception '撤回原因、请求号或核对快照无效';end if;
 v_req:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_withdraw','refund_request',p_refund_request_id,p_actor_staff_id,
  jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_refund_request_id',p_refund_request_id,'p_reason',p_reason,'p_expected_snapshot',p_expected_snapshot),'orders','refund_request');
 if v_req.completed_at is not null then return v_req.response_json;end if;
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id for update;
 if not found or v_refund.status<>'submitted' then raise exception '退款申请不存在或已审批，当前不可撤回';end if;
 if v_refund.created_by_staff_id<>p_actor_staff_id then raise exception '只能撤回本人提交的退款申请';end if;
 perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=v_refund.order_id for update;
 perform 1 from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=v_refund.order_id order by id for update;
 v_current:=public.salon_get_refund_review(p_actor_staff_id,p_organization_id,p_store_id,p_refund_request_id);
 if v_current<>p_expected_snapshot then raise exception '退款核对内容已变化，请重新载入后撤回';end if;
 update public.salon_refund_requests set status='cancelled',withdrawn_by_staff_id=p_actor_staff_id,withdrawn_at=now(),withdrawal_reason=btrim(p_reason)
  where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id and status='submitted';
 if not found then raise exception '退款申请状态已变化，请重新读取';end if;
 v_response:=jsonb_build_object('refundRequestId',p_refund_request_id,'orderId',v_refund.order_id,'status','cancelled','withdrawnByStaffId',p_actor_staff_id,'withdrawalReason',btrim(p_reason));
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason)
 values(p_organization_id,p_store_id,p_actor_staff_id,'refund_request',p_refund_request_id::text,'withdraw',jsonb_build_object('status','submitted'),v_response,btrim(p_reason));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_req.id;
 return v_response;
end $$;
revoke execute on function public.salon_withdraw_refund_request(bigint,bigint,bigint,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.salon_withdraw_refund_request(bigint,bigint,bigint,bigint,text,text,jsonb) to service_role;

create or replace function public.salon_lookup_refund_withdraw(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_lookup_key text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then raise exception '请求核对编号无效';end if;
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select jsonb_build_object('operation','refund_withdraw','status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
 into v_result from public.salon_operation_requests r join public.salon_refund_requests f
  on f.organization_id=r.organization_id and f.store_id=r.store_id and f.id=case when (r.response_json->>'refundRequestId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
  and f.order_id=case when (r.response_json->>'orderId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'orderId')::bigint end
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
  and r.action='refund_withdraw' and r.entity_type='refund_request' and r.staff_request_actor_id=p_actor_staff_id
  and r.staff_payload_digest is not null and r.completed_at is not null
  and r.response_json->>'status'='cancelled' and f.withdrawn_by_staff_id=p_actor_staff_id and f.status='cancelled';
 return coalesce(v_result,jsonb_build_object('operation','refund_withdraw','status','unconfirmed'));
end $$;
revoke execute on function public.salon_lookup_refund_withdraw(bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_refund_withdraw(bigint,bigint,bigint,text) to service_role;
