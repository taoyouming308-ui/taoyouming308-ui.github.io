-- Include the durable completion timestamp in the immutable checkout lookup
-- receipt so clients can distinguish a committed request from an incomplete one.
create or replace function public.salon_lookup_checkout_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_lookup_key text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_receipt jsonb;v_completed_at timestamptz;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then raise exception '请求核对编号无效';end if;
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select r.response_json,r.completed_at into v_receipt,v_completed_at from public.salon_operation_requests r
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
   'resourceId',v_receipt->>'orderId','completedAt',v_completed_at,'receipt',v_receipt);
end $$;
revoke execute on function public.salon_lookup_checkout_request(bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_checkout_request(bigint,bigint,bigint,text) to service_role;
