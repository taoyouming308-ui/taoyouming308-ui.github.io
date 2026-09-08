-- Independent local development: reconciled cash refund quotas, no execution endpoint.
set statement_timeout='30s';
set lock_timeout='5s';
create index salon_refund_order_history_idx on public.salon_refund_requests(organization_id,order_id,id);
create index salon_refund_line_history_idx on public.salon_refund_request_lines(organization_id,order_line_id,refund_request_id);
create or replace function public.salon_get_cash_refund_availability(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_order public.salon_orders;v_payment public.salon_payments;v_refund public.salon_refund_requests;v_line public.salon_order_lines;
 v_count integer;v_done numeric(12,2):=0;v_pending numeric(12,2):=0;v_dq numeric;v_pq numeric;v_da numeric;v_pa numeric;
 v_lines jsonb:='[]';v_reservations jsonb:='[]';v_line_sum numeric:=0;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select * into v_order from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id;
 if not found then raise exception '原订单不存在或不属于当前门店';end if;
 if v_order.status not in ('paid','reversed') or v_order.payable_total<=0 then raise exception '仅支持已支付或已全退的正金额现金订单核对';end if;
 select count(*) into v_count from public.salon_payments where organization_id=p_organization_id and order_id=p_order_id and reversal_of_id is null;
 if v_count<>1 then raise exception '仅支持单笔原现金支付，不支持组合支付';end if;
 select * into v_payment from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id and reversal_of_id is null;
 if not found or v_payment.payment_method<>'cash' or v_payment.member_account_id is not null or v_payment.member_units<>0 or v_payment.refund_request_id is not null or v_payment.amount<>v_order.payable_total or v_payment.status not in ('confirmed','reversed') then raise exception '原现金支付与订单不一致，需人工核对';end if;
 select count(*) into v_count from public.salon_refund_requests where organization_id=p_organization_id and order_id=p_order_id;
 if v_count>500 then raise exception '退款历史超过本页核对上限，不能仅按部分历史计算';end if;
 -- Validate each active/executed allocation before aggregating; cancelled/rejected rows do not reserve.
 for v_refund in select * from public.salon_refund_requests where organization_id=p_organization_id and order_id=p_order_id and status in ('submitted','approved','executed') order by id loop
  if v_refund.store_id<>p_store_id or v_refund.requested_amount<=0 then raise exception '退款历史范围或金额异常，需人工核对';end if;
  select count(*) into v_count from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=v_refund.id;
  if v_count<>1 or not exists(select 1 from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=v_refund.id and original_payment_id=v_payment.id and payment_method='cash' and refund_units=0 and refund_amount=v_refund.requested_amount) then raise exception '退款历史支付分配不完整，需人工核对';end if;
  if not exists(select 1 from public.salon_refund_request_lines where organization_id=p_organization_id and refund_request_id=v_refund.id)
   or (select sum(refund_amount) from public.salon_refund_request_lines where organization_id=p_organization_id and refund_request_id=v_refund.id)<>v_refund.requested_amount
   or exists(select 1 from public.salon_refund_request_lines x left join public.salon_order_lines l on l.organization_id=x.organization_id and l.id=x.order_line_id and l.order_id=p_order_id where x.organization_id=p_organization_id and x.refund_request_id=v_refund.id and (l.id is null or x.item_type<>l.item_type))
   then raise exception '退款历史项目分配不完整，需人工核对';end if;
  if v_refund.status='executed' then
   if not exists(select 1 from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id and p.order_id=p_order_id and p.refund_request_id=v_refund.id and p.reversal_of_id=v_payment.id and p.payment_method='cash' and p.status='confirmed' and p.amount=v_refund.requested_amount and p.member_account_id is null and p.member_units=0) then raise exception '已执行退款缺少匹配反向支付，需人工核对';end if;
   v_done:=v_done+v_refund.requested_amount;
  else v_pending:=v_pending+v_refund.requested_amount;end if;
  v_reservations:=v_reservations||jsonb_build_array(jsonb_build_object('id',v_refund.id,'status',v_refund.status,'amount',v_refund.requested_amount::text));
 end loop;
 -- Every reversal must point to exactly this order's executed request and allocation.
 if exists(select 1 from public.salon_payments p left join public.salon_refund_requests r on r.organization_id=p.organization_id and r.store_id=p.store_id and r.order_id=p.order_id and r.id=p.refund_request_id
  where p.organization_id=p_organization_id and p.order_id=p_order_id and p.id<>v_payment.id and
  (p.store_id<>p_store_id or p.reversal_of_id is distinct from v_payment.id or r.id is null or r.status<>'executed' or p.status<>'confirmed' or p.payment_method<>'cash' or p.member_account_id is not null or p.member_units<>0 or p.amount<>r.requested_amount))
  then raise exception '反向支付与退款申请不一致，需人工核对';end if;
 if v_done<>v_order.refunded_total or v_done<>(select coalesce(sum(amount),0) from public.salon_payments where organization_id=p_organization_id and order_id=p_order_id and id<>v_payment.id)
  or v_done+v_pending>v_payment.amount then raise exception '退款历史合计或在途占用不一致，需人工核对';end if;
 if (v_done=v_payment.amount and (v_payment.status<>'reversed' or v_order.status<>'reversed'))
  or (v_done<v_payment.amount and (v_payment.status<>'confirmed' or v_order.status<>'paid')) then raise exception '订单或支付状态与已退合计不一致，需人工核对';end if;
 select count(*) into v_count from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id;
 if v_count not between 1 and 100 then raise exception '原单明细数量超出核对范围';end if;
 for v_line in select * from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id order by id loop
  if v_line.line_total<=0 then raise exception '零元赠送明细仍不支持，需另行处理';end if;
  select coalesce(sum(x.quantity) filter(where r.status='executed'),0),coalesce(sum(x.quantity) filter(where r.status in ('submitted','approved')),0),
   coalesce(sum(x.refund_amount) filter(where r.status='executed'),0),coalesce(sum(x.refund_amount) filter(where r.status in ('submitted','approved')),0)
   into v_dq,v_pq,v_da,v_pa from public.salon_refund_request_lines x join public.salon_refund_requests r on r.organization_id=x.organization_id and r.id=x.refund_request_id
   where x.organization_id=p_organization_id and x.order_line_id=v_line.id and r.order_id=p_order_id;
  if v_dq+v_pq>v_line.quantity or v_da+v_pa>v_line.line_total then raise exception '退款历史累计数量或金额超过原明细，需人工核对';end if;
  v_line_sum:=v_line_sum+v_line.line_total;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',v_line.id,'name',v_line.item_name,'type',v_line.item_type,'quantity',v_line.quantity::text,'amount',v_line.line_total::text,
   'executedQuantity',v_dq::numeric(12,3)::text,'pendingQuantity',v_pq::numeric(12,3)::text,'availableQuantity',(v_line.quantity-v_dq-v_pq)::numeric(12,3)::text,
   'executedAmount',v_da::numeric(12,2)::text,'pendingAmount',v_pa::numeric(12,2)::text,'availableAmount',(v_line.line_total-v_da-v_pa)::numeric(12,2)::text));
 end loop;
 if v_line_sum<>v_order.payable_total then raise exception '原明细合计与应收不一致，需人工核对';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'orderId',p_order_id,'number',v_order.order_no,'version',v_order.edit_version,'amount',v_order.payable_total::text,'paymentId',v_payment.id,'method','cash',
  'executedAmount',v_done::text,'pendingAmount',v_pending::text,'availableAmount',(v_payment.amount-v_done-v_pending)::numeric(12,2)::text,'lines',v_lines,'reservations',v_reservations);
end $$;
revoke execute on function public.salon_get_cash_refund_availability(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_cash_refund_availability(bigint,bigint,bigint,bigint) to service_role;

create or replace function public.salon_request_partial_cash_refund(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint,p_request_key text,p_reason text,p_expected_snapshot jsonb,p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_req public.salon_operation_requests;v_source jsonb;v_id bigint;v_response jsonb;v_row jsonb;v_available jsonb;v_line public.salon_order_lines;v_seen bigint[]:='{}';v_qty numeric;v_amount numeric;v_total numeric(12,2):=0;v_lines jsonb:='[]';
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
 -- Parent order serializes new allocations; never lock existing refund rows after the order.
 v_source:=public.salon_get_cash_refund_availability(p_actor_staff_id,p_organization_id,p_store_id,p_order_id);
 if v_source<>p_expected_snapshot then raise exception '退款原单核对内容已变化，请重新读取后申请';end if;
 for v_row in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'orderLineId') is distinct from 'number' or coalesce(v_row->>'orderLineId','') !~ '^[1-9][0-9]{0,15}$'
   or jsonb_typeof(v_row->'quantity') is distinct from 'string' or coalesce(v_row->>'quantity','') !~ '^[0-9]{1,9}[.][0-9]{3}$'
   or jsonb_typeof(v_row->'amount') is distinct from 'string' or coalesce(v_row->>'amount','') !~ '^[0-9]{1,10}[.][0-9]{2}$'
   then raise exception '部分退款明细编号、数量或金额格式无效';end if;
  select * into v_line from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id and id=(v_row->>'orderLineId')::bigint;
  if not found or v_line.id=any(v_seen) then raise exception '部分退款明细不属于原单或重复';end if;
  v_seen:=array_append(v_seen,v_line.id);v_qty:=(v_row->>'quantity')::numeric;v_amount:=(v_row->>'amount')::numeric;
  select value into v_available from jsonb_array_elements(v_source->'lines') where (value->>'id')::bigint=v_line.id;
  if v_available is null or v_qty<=0 or v_qty>(v_available->>'availableQuantity')::numeric or v_amount<=0 or v_amount>(v_available->>'availableAmount')::numeric then raise exception '退款数量或金额超过可退范围';end if;
  v_total:=v_total+v_amount;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('orderLineId',v_line.id,'quantity',v_qty::numeric(12,3)::text,'amount',v_amount::numeric(12,2)::text));
 end loop;
 if v_total>(v_source->>'availableAmount')::numeric then raise exception '本次退款超过扣除已执行及在途申请后的可申请金额';end if;
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
