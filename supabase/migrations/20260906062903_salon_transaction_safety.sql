-- Salon transaction safety. Development branch only; do not apply to production
-- before isolated database and API authorization acceptance.

set statement_timeout = '30s';
set lock_timeout = '5s';

create schema if not exists salon_private;
revoke all on schema salon_private from public, anon, authenticated;

create table public.salon_operation_requests (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.salon_organizations(id) on delete restrict,
  store_id bigint not null,
  request_key text not null check (nullif(btrim(request_key), '') is not null),
  action text not null check (action in ('checkout','refund','inventory_move')),
  entity_type text not null,
  entity_id bigint not null,
  response_json jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict
);
create index salon_operation_requests_entity_idx
  on public.salon_operation_requests (organization_id, store_id, entity_type, entity_id, created_at desc);

alter table public.salon_payments
  add column member_account_id bigint,
  add column member_units numeric(12,3) not null default 0 check (member_units >= 0),
  add foreign key (organization_id, member_account_id)
    references public.salon_member_accounts(organization_id, id) on delete restrict;

create table public.salon_inventory_balances (
  organization_id bigint not null,
  store_id bigint not null,
  catalog_item_id bigint not null,
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, store_id, catalog_item_id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, catalog_item_id) references public.salon_catalog_items(organization_id, id) on delete restrict
);

create table public.salon_inventory_ledger (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  catalog_item_id bigint not null,
  movement_type text not null check (movement_type in ('receive','sale','consume','count_adjustment','refund')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_before numeric(14,3) not null check (quantity_before >= 0),
  quantity_after numeric(14,3) not null check (quantity_after >= 0),
  order_id bigint,
  reason text not null check (nullif(btrim(reason), '') is not null),
  occurred_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, store_id, catalog_item_id)
    references public.salon_inventory_balances(organization_id, store_id, catalog_item_id) on delete restrict,
  foreign key (organization_id, order_id) references public.salon_orders(organization_id, id) on delete restrict
);
create index salon_inventory_ledger_scope_idx
  on public.salon_inventory_ledger (organization_id, store_id, catalog_item_id, occurred_at desc);

create or replace function salon_private.assert_staff_permission(
  p_actor_staff_id bigint, p_organization_id bigint, p_store_id bigint,
  p_resource text, p_action text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.salon_staff s
    join public.salon_roles r on r.organization_id=s.organization_id and r.id=s.role_id and r.status='active'
    join public.salon_role_permissions rp on rp.role_id=r.id
    where s.id=p_actor_staff_id and s.organization_id=p_organization_id
      and s.store_id=p_store_id and s.employment_status='active'
      and rp.resource=p_resource and rp.action=p_action
  ) then raise exception '当前员工没有该门店操作权限'; end if;
end $$;

create or replace function salon_private.claim_request(
  p_organization_id bigint, p_store_id bigint, p_request_key text,
  p_action text, p_entity_type text, p_entity_id bigint
) returns public.salon_operation_requests language plpgsql security invoker set search_path = '' as $$
declare v_request public.salon_operation_requests; v_inserted boolean := false;
begin
  if nullif(btrim(p_request_key),'') is null then raise exception '请求幂等键不能为空'; end if;
  insert into public.salon_operation_requests
    (organization_id,store_id,request_key,action,entity_type,entity_id)
  values (p_organization_id,p_store_id,btrim(p_request_key),p_action,p_entity_type,p_entity_id)
  on conflict (organization_id,request_key) do nothing returning * into v_request;
  v_inserted := found;
  if not v_inserted then
    select * into v_request from public.salon_operation_requests
      where organization_id=p_organization_id and request_key=btrim(p_request_key);
    if v_request.store_id<>p_store_id or v_request.action<>p_action
      or v_request.entity_type<>p_entity_type or v_request.entity_id<>p_entity_id
    then raise exception '幂等键已被其他业务使用'; end if;
  end if;
  return v_request;
end $$;

create or replace function public.salon_checkout_order(
  p_actor_staff_id bigint, p_organization_id bigint, p_store_id bigint,
  p_order_id bigint, p_request_key text, p_payments jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.salon_orders; v_request public.salon_operation_requests;
  v_payment jsonb; v_account public.salon_member_accounts;
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

  -- Lock every referenced member account in a stable order before validating balances.
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
      if v_method='member_value' then
        if v_account.account_type<>'stored_value' or v_account.cash_balance<v_amount then raise exception '储值余额不足或卡类型错误'; end if;
        update public.salon_member_accounts set cash_balance=cash_balance-v_amount where organization_id=p_organization_id and id=v_account.id;
        insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,entry_type,cash_delta,reason)
          values(p_organization_id,p_store_id,v_account.id,p_order_id,'consume',-v_amount,'订单收银');
      else
        if v_account.account_type not in ('times_card','package') or v_units<=0 or v_account.remaining_units<v_units then raise exception '次卡余次不足或卡类型错误'; end if;
        update public.salon_member_accounts set remaining_units=remaining_units-v_units where organization_id=p_organization_id and id=v_account.id;
        insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,entry_type,units_delta,reason)
          values(p_organization_id,p_store_id,v_account.id,p_order_id,'consume',-v_units,'订单核销');
      end if;
    end if;
    insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,member_account_id,member_units,status,confirmed_at)
      values(p_organization_id,p_store_id,p_order_id,v_method,v_amount,v_account_id,v_units,'confirmed',now());
  end loop;
  update public.salon_orders set status='paid',paid_at=now() where organization_id=p_organization_id and id=p_order_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason)
    values(p_organization_id,p_store_id,p_actor_staff_id,'order',p_order_id::text,'checkout',jsonb_build_object('total',v_paid,'requestKey',p_request_key),'订单收银');
  v_response:=jsonb_build_object('orderId',p_order_id,'status','paid','paid',v_paid);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;
  return v_response;
end $$;

create or replace function public.salon_move_inventory(
  p_actor_staff_id bigint, p_organization_id bigint, p_store_id bigint,
  p_catalog_item_id bigint, p_request_key text, p_movement_type text,
  p_quantity numeric, p_order_id bigint, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_request public.salon_operation_requests; v_balance public.salon_inventory_balances;
  v_delta numeric(14,3); v_after numeric(14,3); v_ledger_id bigint; v_response jsonb;
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'inventory_move','catalog_item',p_catalog_item_id);
  if v_request.completed_at is not null then return v_request.response_json; end if;
  if p_movement_type not in ('receive','sale','consume','refund') or p_quantity is null or p_quantity<=0 then raise exception '库存操作类型或数量无效'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '库存原因不能为空'; end if;
  if not exists(select 1 from public.salon_catalog_items i where i.organization_id=p_organization_id and i.id=p_catalog_item_id and i.item_type='product' and i.status='active') then raise exception '商品不存在或不可用'; end if;
  insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id)
    values(p_organization_id,p_store_id,p_catalog_item_id) on conflict do nothing;
  select * into v_balance from public.salon_inventory_balances b where b.organization_id=p_organization_id
    and b.store_id=p_store_id and b.catalog_item_id=p_catalog_item_id for update;
  v_delta:=case when p_movement_type in ('receive','refund') then p_quantity else -p_quantity end;
  v_after:=v_balance.quantity+v_delta;
  if v_after<0 then raise exception '库存不足，不能出库'; end if;
  update public.salon_inventory_balances set quantity=v_after,updated_at=now()
    where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=p_catalog_item_id;
  insert into public.salon_inventory_ledger(organization_id,store_id,catalog_item_id,movement_type,quantity_delta,quantity_before,quantity_after,order_id,reason)
    values(p_organization_id,p_store_id,p_catalog_item_id,p_movement_type,v_delta,v_balance.quantity,v_after,p_order_id,btrim(p_reason)) returning id into v_ledger_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason)
    values(p_organization_id,p_store_id,p_actor_staff_id,'inventory_ledger',v_ledger_id::text,'create',jsonb_build_object('before',v_balance.quantity,'after',v_after,'requestKey',p_request_key),btrim(p_reason));
  v_response:=jsonb_build_object('ledgerId',v_ledger_id,'quantityBefore',v_balance.quantity,'quantityAfter',v_after);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;
  return v_response;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['salon_operation_requests','salon_inventory_balances','salon_inventory_ledger'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant all on table public.%I to service_role',table_name);
  end loop;
end $$;

revoke execute on function salon_private.assert_staff_permission(bigint,bigint,bigint,text,text) from public,anon,authenticated;
revoke execute on function salon_private.claim_request(bigint,bigint,text,text,text,bigint) from public,anon,authenticated;
revoke execute on function public.salon_checkout_order(bigint,bigint,bigint,bigint,text,jsonb) from public,anon,authenticated;
revoke execute on function public.salon_move_inventory(bigint,bigint,bigint,bigint,text,text,numeric,bigint,text) from public,anon,authenticated;
grant usage on schema salon_private to service_role;
grant execute on function salon_private.assert_staff_permission(bigint,bigint,bigint,text,text) to service_role;
grant execute on function salon_private.claim_request(bigint,bigint,text,text,text,bigint) to service_role;
grant execute on function public.salon_checkout_order(bigint,bigint,bigint,bigint,text,jsonb) to service_role;
grant execute on function public.salon_move_inventory(bigint,bigint,bigint,bigint,text,text,numeric,bigint,text) to service_role;

comment on table public.salon_operation_requests is 'Store-scoped request idempotency registry; response is persisted only after the same transaction completes.';
comment on function public.salon_checkout_order(bigint,bigint,bigint,bigint,text,jsonb) is 'Service-only atomic checkout with order and member-account row locks.';
comment on function public.salon_move_inventory(bigint,bigint,bigint,bigint,text,text,numeric,bigint,text) is 'Service-only idempotent inventory movement with a locked non-negative balance.';
