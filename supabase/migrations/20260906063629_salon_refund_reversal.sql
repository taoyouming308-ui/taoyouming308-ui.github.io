-- Exact, append-only whole-order refund reversal for the independent Salon app.

set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.salon_account_ledger
  add column payment_id bigint,
  add foreign key (organization_id, payment_id)
    references public.salon_payments(organization_id, id) on delete restrict;

alter table public.salon_inventory_ledger
  add column reversal_of_id bigint,
  add foreign key (organization_id, reversal_of_id)
    references public.salon_inventory_ledger(organization_id, id) on delete restrict;

create unique index salon_payments_one_reversal_idx
  on public.salon_payments(organization_id,reversal_of_id) where reversal_of_id is not null;
create unique index salon_account_ledger_one_reversal_idx
  on public.salon_account_ledger(organization_id,reversal_of_id) where reversal_of_id is not null;
create unique index salon_account_ledger_payment_idx
  on public.salon_account_ledger(organization_id,payment_id) where payment_id is not null;
create unique index salon_inventory_ledger_one_reversal_idx
  on public.salon_inventory_ledger(organization_id,reversal_of_id) where reversal_of_id is not null;

create or replace function public.salon_checkout_order(
  p_actor_staff_id bigint, p_organization_id bigint, p_store_id bigint,
  p_order_id bigint, p_request_key text, p_payments jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.salon_orders; v_request public.salon_operation_requests;
  v_payment jsonb; v_account public.salon_member_accounts; v_payment_id bigint;
  v_method text; v_amount numeric(12,2); v_units numeric(12,3); v_account_id bigint;
  v_paid numeric(12,2); v_response jsonb;
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'checkout','order',p_order_id);
  if v_request.completed_at is not null then return v_request.response_json; end if;
  select * into v_order from public.salon_orders o where o.organization_id=p_organization_id
    and o.store_id=p_store_id and o.id=p_order_id for update;
  if not found then raise exception '订单不存在或不属于当前门店'; end if;
  if v_order.status not in ('opened','in_service','awaiting_payment') then raise exception '订单当前状态不能收银'; end if;
  if jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments)=0 then raise exception '请添加支付方式'; end if;
  select round(coalesce(sum((x->>'amount')::numeric),0),2) into v_paid from jsonb_array_elements(p_payments) x;
  if v_paid<>v_order.payable_total then raise exception '支付合计必须等于应收金额'; end if;
  perform 1 from public.salon_member_accounts a where a.organization_id=p_organization_id
    and a.id in (select distinct nullif(x->>'accountId','')::bigint from jsonb_array_elements(p_payments) x)
    order by a.id for update;
  for v_payment in select value from jsonb_array_elements(p_payments) loop
    v_method:=v_payment->>'method'; v_amount:=round((v_payment->>'amount')::numeric,2);
    v_units:=coalesce((v_payment->>'units')::numeric,0); v_account_id:=nullif(v_payment->>'accountId','')::bigint;
    if v_method not in ('cash','wechat','alipay','member_value','member_units') or v_amount<=0 then raise exception '支付方式或金额无效'; end if;
    if v_method in ('member_value','member_units') then
      select * into v_account from public.salon_member_accounts a where a.organization_id=p_organization_id
        and a.id=v_account_id and a.customer_id=v_order.customer_id and a.status='active';
      if not found or (v_account.expires_on is not null and v_account.expires_on<current_date) then raise exception '会员账户不可核销'; end if;
      if v_method='member_value' and (v_account.account_type<>'stored_value' or v_account.cash_balance<v_amount) then raise exception '储值余额不足或卡类型错误'; end if;
      if v_method='member_units' and (v_account.account_type not in ('times_card','package') or v_units<=0 or v_account.remaining_units<v_units) then raise exception '次卡余次不足或卡类型错误'; end if;
    end if;
    insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,member_account_id,member_units,status,confirmed_at)
      values(p_organization_id,p_store_id,p_order_id,v_method,v_amount,v_account_id,v_units,'confirmed',now()) returning id into v_payment_id;
    if v_method='member_value' then
      update public.salon_member_accounts set cash_balance=cash_balance-v_amount where organization_id=p_organization_id and id=v_account.id;
      insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,payment_id,entry_type,cash_delta,reason)
        values(p_organization_id,p_store_id,v_account.id,p_order_id,v_payment_id,'consume',-v_amount,'订单收银');
    elsif v_method='member_units' then
      update public.salon_member_accounts set remaining_units=remaining_units-v_units where organization_id=p_organization_id and id=v_account.id;
      insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,payment_id,entry_type,units_delta,reason)
        values(p_organization_id,p_store_id,v_account.id,p_order_id,v_payment_id,'consume',-v_units,'订单核销');
    end if;
  end loop;
  update public.salon_orders set status='paid',paid_at=now() where organization_id=p_organization_id and id=p_order_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason)
    values(p_organization_id,p_store_id,p_actor_staff_id,'order',p_order_id::text,'checkout',jsonb_build_object('total',v_paid,'requestKey',p_request_key),'订单收银');
  v_response:=jsonb_build_object('orderId',p_order_id,'status','paid','paid',v_paid);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;
  return v_response;
end $$;

create or replace function public.salon_refund_order(
  p_actor_staff_id bigint, p_organization_id bigint, p_store_id bigint,
  p_order_id bigint, p_request_key text, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.salon_orders; v_request public.salon_operation_requests;
  v_payment public.salon_payments; v_original_ledger public.salon_account_ledger;
  v_stock_tx public.salon_inventory_ledger; v_balance public.salon_inventory_balances;
  v_reversal_payment_id bigint; v_reversal_stock_id bigint; v_response jsonb;
  v_payment_count integer:=0; v_stock_count integer:=0;
begin
  if nullif(btrim(p_reason),'') is null then raise exception '退款原因不能为空'; end if;
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund');
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'refund','order',p_order_id);
  if v_request.completed_at is not null then return v_request.response_json; end if;
  select * into v_order from public.salon_orders o where o.organization_id=p_organization_id
    and o.store_id=p_store_id and o.id=p_order_id for update;
  if not found then raise exception '订单不存在或不属于当前门店'; end if;
  if v_order.status<>'paid' then raise exception '只有已支付订单可以退款'; end if;
  if exists(select 1 from public.salon_inventory_ledger l where l.organization_id=p_organization_id and l.store_id=p_store_id and l.order_id=p_order_id and l.movement_type='sale' and l.reversal_of_id is null) then
    perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
  end if;
  perform 1 from public.salon_member_accounts a where a.organization_id=p_organization_id
    and a.id in (select distinct p.member_account_id from public.salon_payments p where p.organization_id=p_organization_id and p.order_id=p_order_id and p.reversal_of_id is null and p.member_account_id is not null)
    order by a.id for update;
  for v_payment in select p.* from public.salon_payments p where p.organization_id=p_organization_id
      and p.store_id=p_store_id and p.order_id=p_order_id and p.reversal_of_id is null order by p.id for update loop
    insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,member_account_id,member_units,status,reversal_of_id,confirmed_at)
      values(p_organization_id,p_store_id,p_order_id,v_payment.payment_method,v_payment.amount,v_payment.member_account_id,v_payment.member_units,'confirmed',v_payment.id,now()) returning id into v_reversal_payment_id;
    if v_payment.member_account_id is not null then
      select * into v_original_ledger from public.salon_account_ledger l where l.organization_id=p_organization_id and l.payment_id=v_payment.id for update;
      if not found then raise exception '原会员扣款流水不存在，不能自动冲正'; end if;
      update public.salon_member_accounts set cash_balance=cash_balance-v_original_ledger.cash_delta,
        bonus_balance=bonus_balance-v_original_ledger.bonus_delta,
        remaining_units=case when remaining_units is null then null else remaining_units-v_original_ledger.units_delta end
        where organization_id=p_organization_id and id=v_payment.member_account_id;
      insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,payment_id,entry_type,cash_delta,bonus_delta,units_delta,reversal_of_id,reason)
        values(p_organization_id,p_store_id,v_payment.member_account_id,p_order_id,v_reversal_payment_id,'refund',-v_original_ledger.cash_delta,-v_original_ledger.bonus_delta,-v_original_ledger.units_delta,v_original_ledger.id,btrim(p_reason));
    end if;
    update public.salon_payments set status='reversed' where organization_id=p_organization_id and id=v_payment.id;
    v_payment_count:=v_payment_count+1;
  end loop;
  for v_stock_tx in select l.* from public.salon_inventory_ledger l where l.organization_id=p_organization_id
      and l.store_id=p_store_id and l.order_id=p_order_id and l.movement_type='sale' and l.reversal_of_id is null order by l.catalog_item_id,l.id for update loop
    select * into v_balance from public.salon_inventory_balances b where b.organization_id=p_organization_id
      and b.store_id=p_store_id and b.catalog_item_id=v_stock_tx.catalog_item_id for update;
    update public.salon_inventory_balances set quantity=quantity-v_stock_tx.quantity_delta,updated_at=now()
      where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=v_stock_tx.catalog_item_id;
    insert into public.salon_inventory_ledger(organization_id,store_id,catalog_item_id,movement_type,quantity_delta,quantity_before,quantity_after,order_id,reversal_of_id,reason)
      values(p_organization_id,p_store_id,v_stock_tx.catalog_item_id,'refund',-v_stock_tx.quantity_delta,v_balance.quantity,v_balance.quantity-v_stock_tx.quantity_delta,p_order_id,v_stock_tx.id,btrim(p_reason)) returning id into v_reversal_stock_id;
    v_stock_count:=v_stock_count+1;
  end loop;
  update public.salon_orders set status='reversed' where organization_id=p_organization_id and id=p_order_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason)
    values(p_organization_id,p_store_id,p_actor_staff_id,'order',p_order_id::text,'refund',jsonb_build_object('status','paid'),jsonb_build_object('status','reversed','requestKey',p_request_key,'payments',v_payment_count,'stockReturns',v_stock_count),btrim(p_reason));
  v_response:=jsonb_build_object('orderId',p_order_id,'status','reversed','reversedPayments',v_payment_count,'returnedStock',v_stock_count);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;
  return v_response;
end $$;

revoke execute on function public.salon_refund_order(bigint,bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.salon_refund_order(bigint,bigint,bigint,bigint,text,text) to service_role;
comment on function public.salon_refund_order(bigint,bigint,bigint,bigint,text,text) is 'Service-only idempotent whole-order reversal with exact payment, member-ledger, and sold-stock lineage.';
