-- Version-guarded member tender checkout; underlying payment, account, stock,
-- order, audit and idempotency writes remain one transaction.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function public.salon_checkout_order_versioned(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint,
 p_request_key text,p_expected_version integer,p_payments jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_order public.salon_orders;v_result jsonb;v_request public.salon_operation_requests;v_lines jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');
 if p_expected_version is null or p_expected_version<0 then raise exception '订单版本无效';end if;
 -- Completed retries reach the original idempotency guard after the order is paid.
 select * into v_request from public.salon_operation_requests r
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_request_key
   and r.action='checkout' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null;
 if found and v_request.completed_at is not null then
  return public.salon_checkout_order(p_actor_staff_id,p_organization_id,p_store_id,p_order_id,p_request_key,p_payments);
 elsif found then raise exception '原收银请求仍在处理中，请核对原请求';end if;
 select * into v_order from public.salon_orders o
  where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=p_order_id for update;
 if not found then raise exception '订单不存在或不属于当前门店';end if;
 if v_order.status<>'awaiting_payment' or v_order.edit_version<>p_expected_version then
  -- A same-key concurrent winner may have committed while this call waited
  -- on the order lock. Re-enter the legacy request guard to compare payload.
  select * into v_request from public.salon_operation_requests r
   where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_request_key
    and r.action='checkout' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null
    and r.completed_at is not null;
  if found then return public.salon_checkout_order(p_actor_staff_id,p_organization_id,p_store_id,p_order_id,p_request_key,p_payments);end if;
  if v_order.status<>'awaiting_payment' then raise exception '只有待收银订单可以确认收款';end if;
  raise exception '订单版本已变化，请重新读取后确认';
 end if;
 v_result:=public.salon_checkout_order(p_actor_staff_id,p_organization_id,p_store_id,p_order_id,p_request_key,p_payments);
 select coalesce(jsonb_agg(jsonb_build_object('paymentId',p.id,'method',p.payment_method,'amount',p.amount::text,
   'tendered',p.tendered_amount::text,'change',p.change_amount::text,'accountId',p.member_account_id,'units',p.member_units::text)
   order by p.id),'[]'::jsonb) into v_lines
  from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id
   and p.order_id=p_order_id and p.status='confirmed' and p.reversal_of_id is null;
 if jsonb_array_length(v_lines)=0 then raise exception '收银支付记录未能回读';end if;
 v_result:=v_result||jsonb_build_object('paymentLines',v_lines,'expectedVersion',p_expected_version);
 update public.salon_operation_requests r set response_json=v_result
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_request_key
   and r.action='checkout' and r.staff_request_actor_id=p_actor_staff_id and r.completed_at is not null;
 if not found then raise exception '原收银请求回读失败';end if;
 return v_result;
end $$;

revoke execute on function public.salon_checkout_order_versioned(bigint,bigint,bigint,bigint,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.salon_checkout_order_versioned(bigint,bigint,bigint,bigint,text,integer,jsonb) to service_role;

create or replace function public.salon_lookup_checkout_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_lookup_key text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;v_receipt jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then raise exception '请求核对编号无效';end if;
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select r.response_json into v_receipt from public.salon_operation_requests r
  where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
   and r.action='checkout' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null
   and r.completed_at is not null and jsonb_typeof(r.response_json)='object'
   and r.response_json->>'status'='paid' and jsonb_typeof(r.response_json->'paymentLines')='array';
 if v_receipt is null then return jsonb_build_object('operation','checkout','status','unconfirmed');end if;
 if not exists(select 1 from public.salon_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id
   and o.id=case when (v_receipt->>'orderId')~'^[1-9][0-9]{0,17}$' then (v_receipt->>'orderId')::bigint end) then
  return jsonb_build_object('operation','checkout','status','unconfirmed');
 end if;
 if (select count(*) from jsonb_array_elements(v_receipt->'paymentLines')) < 1
   or exists(select 1 from jsonb_array_elements(v_receipt->'paymentLines') x
    where not exists(select 1 from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id
     and p.order_id=(v_receipt->>'orderId')::bigint and p.id=(x->>'paymentId')::bigint
     and p.payment_method=x->>'method' and p.amount::text=x->>'amount'
     and p.tendered_amount::text=x->>'tendered' and p.change_amount::text=x->>'change'
     and coalesce(p.member_account_id,0)=coalesce(nullif(x->>'accountId','')::bigint,0)
     and coalesce(p.member_units,0)::text=coalesce(x->>'units','0')))
   or (select count(*) from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id
    and p.order_id=(v_receipt->>'orderId')::bigint and p.reversal_of_id is null and p.status in('confirmed','reversed'))
    <> (select count(*) from jsonb_array_elements(v_receipt->'paymentLines')) then
  return jsonb_build_object('operation','checkout','status','unconfirmed');
 end if;
 return jsonb_build_object('operation','checkout','status','committed','resourceType','order',
   'resourceId',v_receipt->>'orderId','receipt',v_receipt);
end $$;
revoke execute on function public.salon_lookup_checkout_request(bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_checkout_request(bigint,bigint,bigint,text) to service_role;
