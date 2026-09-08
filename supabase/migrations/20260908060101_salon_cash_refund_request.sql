-- Independent local development: cash full-refund request only, no execution.
set statement_timeout='30s';
set lock_timeout='5s';
create or replace function public.salon_get_cash_refund_source(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_order public.salon_orders;v_payment public.salon_payments;v_lines jsonb;v_count integer;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select * into v_order from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id;
 if not found then raise exception '原订单不存在或不属于当前门店';end if;
 if v_order.status<>'paid' or v_order.payable_total<=0 or v_order.refunded_total<>0 then raise exception '仅支持尚未退款的已支付现金订单全退';end if;
 if exists(select 1 from public.salon_refund_requests where organization_id=p_organization_id and order_id=p_order_id and status in ('submitted','approved','executed')) then raise exception '订单已有待处理或已执行退款，请先核对原申请';end if;
 select count(*) into v_count from public.salon_payments where organization_id=p_organization_id and order_id=p_order_id;
 if v_count<>1 then raise exception '仅支持单笔现金支付全退，不支持组合或已有冲正支付';end if;
 select * into v_payment from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id and payment_method='cash' and status='confirmed' and reversal_of_id is null and member_account_id is null and member_units=0;
 if not found or v_payment.amount<>v_order.payable_total then raise exception '原现金支付与订单应收不匹配';end if;
 if not exists(select 1 from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id) or
  exists(select 1 from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id and line_total<=0) or
  (select sum(line_total) from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id)<>v_order.payable_total
 then raise exception '原单明细或金额无法完整分配，零元/赠送明细需另行处理';end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',item_name,'type',item_type,'quantity',quantity::text,'amount',line_total::text) order by id) into v_lines from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id;
 if jsonb_array_length(v_lines)>100 then raise exception '原单明细超过本页核对上限';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'orderId',p_order_id,'number',v_order.order_no,'version',v_order.edit_version,'amount',v_order.payable_total::text,'paymentId',v_payment.id,'method','cash','lines',v_lines);
end $$;
revoke execute on function public.salon_get_cash_refund_source(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_cash_refund_source(bigint,bigint,bigint,bigint) to service_role;

create or replace function public.salon_request_cash_refund(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint,p_request_key text,p_reason text,p_expected_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_req public.salon_operation_requests;v_source jsonb;v_id bigint;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$' or nullif(btrim(p_reason),'') is null or length(p_reason)>500 or p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot)<>'object' then raise exception '退款原因、请求号或核对快照无效';end if;
 v_req:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_request','cash_full_refund',p_order_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_order_id',p_order_id,'p_reason',p_reason,'p_expected_snapshot',p_expected_snapshot),'orders','refund_request');
 if v_req.completed_at is not null then return v_req.response_json;end if;
 -- Creation owns only its new refund row: existing requests are not locked after the order.
 perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id for update;
 perform 1 from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id order by id for update;
 v_source:=public.salon_get_cash_refund_source(p_actor_staff_id,p_organization_id,p_store_id,p_order_id);
 if v_source<>p_expected_snapshot then raise exception '退款原单核对内容已变化，请重新读取后申请';end if;
 insert into public.salon_refund_requests(organization_id,store_id,order_id,refund_type,requested_amount,reason,created_by_staff_id)
 values(p_organization_id,p_store_id,p_order_id,'full',(v_source->>'amount')::numeric,btrim(p_reason),p_actor_staff_id) returning id into v_id;
 insert into public.salon_refund_request_lines(organization_id,refund_request_id,order_line_id,quantity,refund_amount,item_code,item_name,item_type)
 select p_organization_id,v_id,id,quantity,line_total,item_code,item_name,item_type from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id;
 insert into public.salon_refund_request_payments(organization_id,refund_request_id,original_payment_id,refund_amount,refund_units,payment_method)
 values(p_organization_id,v_id,(v_source->>'paymentId')::bigint,(v_source->>'amount')::numeric,0,'cash');
 v_response:=jsonb_build_object('refundRequestId',v_id,'orderId',p_order_id,'paymentId',v_source->'paymentId','status','submitted','requestedAmount',v_source->>'amount','createdByStaffId',p_actor_staff_id,'requestKey',p_request_key);
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_request',v_id::text,'submit',v_response,btrim(p_reason));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_req.id;
 return v_response;
end $$;
revoke execute on function public.salon_request_cash_refund(bigint,bigint,bigint,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.salon_request_cash_refund(bigint,bigint,bigint,bigint,text,text,jsonb) to service_role;

create or replace function public.salon_lookup_staff_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,
 p_lookup_key text,p_target_operation text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resource text;v_id_field text;v_result jsonb;v_unknown jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then
  raise exception '请求核对编号无效';
 end if;
 if p_target_operation='cash_refund_request' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
  into v_result from public.salon_operation_requests r
  join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id
   and f.id=case when (r.response_json->>'refundRequestId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
   and f.order_id::text=r.response_json->>'orderId' and f.created_by_staff_id=p_actor_staff_id and f.refund_type='full'
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
   and r.action='refund_request' and r.entity_type='cash_full_refund' and r.staff_request_actor_id=p_actor_staff_id
   and r.staff_payload_digest is not null and r.completed_at is not null
   and r.response_json->>'createdByStaffId'=p_actor_staff_id::text and r.response_json->>'requestKey'=p_lookup_key;
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 if p_target_operation='refund_review' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_approve');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request',
   'resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
  into v_result from public.salon_operation_requests r
  join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id
   and f.id=case when (r.response_json->>'refundRequestId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
   and f.order_id::text=r.response_json->>'orderId'
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
   and r.action='refund_review' and r.staff_request_actor_id=p_actor_staff_id
   and r.staff_payload_digest is not null and r.completed_at is not null
   and r.response_json->>'reviewedByStaffId'=p_actor_staff_id::text and r.response_json->>'status' in ('approved','rejected');
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 if p_target_operation='cash_checkout' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','order',
   'resourceId',r.response_json->>'orderId','completedAt',r.completed_at,'receipt',r.response_json,'paymentStatus',p.status)
  into v_result from public.salon_operation_requests r
  join public.salon_payments p on p.organization_id=r.organization_id and p.store_id=r.store_id
   and p.id=case when (r.response_json->>'paymentId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'paymentId')::bigint end
   and p.order_id=case when (r.response_json->>'orderId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'orderId')::bigint end
   and p.payment_method='cash' and p.amount::text=r.response_json->>'paid'
   and p.tendered_amount::text=r.response_json->>'tendered' and p.change_amount::text=r.response_json->>'change'
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
   and r.action='cash_checkout' and r.staff_request_actor_id=p_actor_staff_id
   and r.staff_payload_digest is not null and r.completed_at is not null;
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 case p_target_operation
  when 'customer_create' then v_resource:='customers';v_id_field:='customerId';
  when 'order_create' then v_resource:='orders';v_id_field:='orderId';
  when 'order_status' then v_resource:='orders';v_id_field:='orderId';
  when 'order_lines' then v_resource:='orders';v_id_field:='orderId';
  else raise exception '不支持核对该操作';
 end case;
 -- Recheck current permissions even when an old completed receipt exists.
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'write');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'read');
 v_unknown:=jsonb_build_object('operation',p_target_operation,'status','unconfirmed');
 -- The existing (organization_id, request_key) unique index bounds this exact lookup.
 -- No lock/claim/update: an uncommitted transaction stays indistinguishable from no receipt.
 select jsonb_build_object('operation',p_target_operation,'status','committed',
          'resourceType',case when v_resource='customers' then 'customer' else 'order' end,
          'resourceId',r.response_json->>v_id_field,'completedAt',r.completed_at)
 into v_result
 from public.salon_operation_requests r
 where r.organization_id=p_organization_id and r.store_id=p_store_id
  and r.request_key=p_lookup_key and r.action=p_target_operation
  and r.staff_request_actor_id=p_actor_staff_id
  and r.staff_payload_digest is not null
  and r.completed_at is not null
  and jsonb_typeof(r.response_json)='object'
  and (r.response_json->>v_id_field) ~ '^[1-9][0-9]{0,18}$';
 -- Missing, legacy, wrong actor/store/action and incomplete results reveal no receipt details.
 return coalesce(v_result,v_unknown);
end $$;
revoke execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) to service_role;
comment on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) is
 'Own-store, own-actor minimal historical receipt only. unconfirmed is not failure or authorization to resubmit; committed is not current business status.';
