-- Independent synthetic-local development; request creation only, no execution.
set statement_timeout='30s';
set lock_timeout='5s';
create or replace function public.salon_request_partial_cash_refund(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint,p_request_key text,p_reason text,p_expected_snapshot jsonb,p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_req public.salon_operation_requests;v_source jsonb;v_id bigint;v_response jsonb;v_row jsonb;v_line public.salon_order_lines;v_seen bigint[]:='{}';v_qty numeric;v_amount numeric;v_total numeric(12,2):=0;v_lines jsonb:='[]';
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$' or nullif(btrim(p_reason),'') is null or length(p_reason)>500 or p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot)<>'object' then raise exception '退款原因、请求号或核对快照无效';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception '部分退款明细无效';end if;
 if jsonb_array_length(p_lines) not between 1 and 100 then raise exception '部分退款明细数量无效';end if;
 v_req:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_request','cash_partial_refund',p_order_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_order_id',p_order_id,'p_reason',p_reason,'p_expected_snapshot',p_expected_snapshot,'p_lines',p_lines),'orders','refund_request');
 if v_req.completed_at is not null then return v_req.response_json;end if;
 perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id for update;
 perform 1 from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id order by id for update;
 -- First request only: reject all active or executed allocations, reversals and mixed payments.
 v_source:=public.salon_get_cash_refund_source(p_actor_staff_id,p_organization_id,p_store_id,p_order_id);
 if v_source<>p_expected_snapshot then raise exception '退款原单核对内容已变化，请重新读取后申请';end if;
 for v_row in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'orderLineId') is distinct from 'number' or coalesce(v_row->>'orderLineId','') !~ '^[1-9][0-9]{0,15}$'
   or jsonb_typeof(v_row->'quantity') is distinct from 'string' or coalesce(v_row->>'quantity','') !~ '^[0-9]{1,9}[.][0-9]{3}$'
   or jsonb_typeof(v_row->'amount') is distinct from 'string' or coalesce(v_row->>'amount','') !~ '^[0-9]{1,10}[.][0-9]{2}$'
   then raise exception '部分退款明细编号、数量或金额格式无效';end if;
  select * into v_line from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id and id=(v_row->>'orderLineId')::bigint;
  if not found or v_line.id=any(v_seen) then raise exception '部分退款明细不属于原单或重复';end if;
  v_seen:=array_append(v_seen,v_line.id);v_qty:=(v_row->>'quantity')::numeric;v_amount:=(v_row->>'amount')::numeric;
  if v_qty<=0 or v_qty>v_line.quantity or v_amount<=0 or v_amount>v_line.line_total then raise exception '退款数量或金额超过可退范围';end if;
  v_total:=v_total+v_amount;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('orderLineId',v_line.id,'quantity',v_qty::numeric(12,3)::text,'amount',v_amount::numeric(12,2)::text));
 end loop;
 if v_total<=0 or v_total>=(v_source->>'amount')::numeric then raise exception '部分退款合计须小于原单应收；全额请使用全退入口';end if;
 insert into public.salon_refund_requests(organization_id,store_id,order_id,refund_type,requested_amount,reason,created_by_staff_id)
 values(p_organization_id,p_store_id,p_order_id,'partial',v_total,btrim(p_reason),p_actor_staff_id) returning id into v_id;
 insert into public.salon_refund_request_lines(organization_id,refund_request_id,order_line_id,quantity,refund_amount,item_code,item_name,item_type)
 select p_organization_id,v_id,l.id,(x->>'quantity')::numeric,(x->>'amount')::numeric,l.item_code,l.item_name,l.item_type
 from jsonb_array_elements(v_lines) x join public.salon_order_lines l on l.organization_id=p_organization_id and l.order_id=p_order_id and l.id=(x->>'orderLineId')::bigint;
 insert into public.salon_refund_request_payments(organization_id,refund_request_id,original_payment_id,refund_amount,refund_units,payment_method)
 values(p_organization_id,v_id,(v_source->>'paymentId')::bigint,v_total,0,'cash');
 v_response:=jsonb_build_object('refundRequestId',v_id,'orderId',p_order_id,'paymentId',v_source->'paymentId','status','submitted','refundType','partial','requestedAmount',v_total::text,'originalAmount',v_source->>'amount','createdByStaffId',p_actor_staff_id,'requestKey',p_request_key,'lines',v_lines);
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_request',v_id::text,'submit',v_response,btrim(p_reason));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_req.id;
 return v_response;
end $$;
revoke execute on function public.salon_request_partial_cash_refund(bigint,bigint,bigint,bigint,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.salon_request_partial_cash_refund(bigint,bigint,bigint,bigint,text,text,jsonb,jsonb) to service_role;

create or replace function public.salon_lookup_staff_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,
 p_lookup_key text,p_target_operation text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resource text;v_id_field text;v_result jsonb;v_unknown jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then
  raise exception '请求核对编号无效';
 end if;
 if p_target_operation in ('cash_refund_request','partial_cash_refund_request') then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
  into v_result from public.salon_operation_requests r
  join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id
   and f.id=case when (r.response_json->>'refundRequestId') ~ '^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
   and f.order_id::text=r.response_json->>'orderId' and f.created_by_staff_id=p_actor_staff_id and f.refund_type=case when p_target_operation='cash_refund_request' then 'full' else 'partial' end
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
   and r.action='refund_request' and r.entity_type=case when p_target_operation='cash_refund_request' then 'cash_full_refund' else 'cash_partial_refund' end and r.staff_request_actor_id=p_actor_staff_id
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
