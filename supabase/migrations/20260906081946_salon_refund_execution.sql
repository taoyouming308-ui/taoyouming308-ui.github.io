-- Execute approved refund snapshots atomically. Development branch only.
set statement_timeout='30s';set lock_timeout='5s';

alter table public.salon_orders add column refunded_total numeric(12,2) not null default 0 check(refunded_total>=0 and refunded_total<=payable_total);
alter table public.salon_payments add column refund_request_id bigint,add foreign key(organization_id,refund_request_id) references public.salon_refund_requests(organization_id,id) on delete restrict;
alter table public.salon_account_ledger add column refund_request_id bigint,add foreign key(organization_id,refund_request_id) references public.salon_refund_requests(organization_id,id) on delete restrict;
alter table public.salon_inventory_ledger add column refund_request_id bigint,add foreign key(organization_id,refund_request_id) references public.salon_refund_requests(organization_id,id) on delete restrict;

drop index public.salon_payments_one_reversal_idx;
drop index public.salon_account_ledger_one_reversal_idx;
drop index public.salon_inventory_ledger_one_reversal_idx;
create unique index salon_payments_refund_request_reversal_idx on public.salon_payments(organization_id,refund_request_id,reversal_of_id) where refund_request_id is not null and reversal_of_id is not null;
create unique index salon_account_ledger_refund_request_reversal_idx on public.salon_account_ledger(organization_id,refund_request_id,reversal_of_id) where refund_request_id is not null and reversal_of_id is not null;
create unique index salon_inventory_ledger_refund_request_reversal_idx on public.salon_inventory_ledger(organization_id,refund_request_id,reversal_of_id) where refund_request_id is not null and reversal_of_id is not null;

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in ('checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count','member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute'));

create or replace function public.salon_execute_refund_request(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,p_request_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_order public.salon_orders;v_alloc record;v_payment public.salon_payments;v_original_ledger public.salon_account_ledger;v_reversal_payment_id bigint;v_paid_refunded numeric(12,2);v_stock record;v_sale public.salon_inventory_ledger;v_balance public.salon_inventory_balances;v_stock_refunded numeric(14,3);v_new_total numeric(12,2);v_status text;v_payment_count integer:=0;v_stock_count integer:=0;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
 v_op:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'refund_execute','refund_request',p_refund_request_id);if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '退款申请不存在或当前不可执行';end if;
 select * into v_order from public.salon_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=v_refund.order_id for update;
 if not found or v_order.status<>'paid' then raise exception '原订单不是可退款的已支付状态';end if;
 if v_order.refunded_total+v_refund.requested_amount>v_order.payable_total then raise exception '累计退款金额超过订单实收';end if;
 if exists(select 1 from public.salon_refund_request_lines l where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id and l.item_type='product') then perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');end if;
 perform 1 from public.salon_member_accounts a where a.organization_id=p_organization_id and a.id in(select distinct p.member_account_id from public.salon_refund_request_payments x join public.salon_payments p on p.organization_id=x.organization_id and p.id=x.original_payment_id where x.organization_id=p_organization_id and x.refund_request_id=p_refund_request_id and p.member_account_id is not null) order by a.id for update;
 for v_alloc in select x.* from public.salon_refund_request_payments x where x.organization_id=p_organization_id and x.refund_request_id=p_refund_request_id order by x.original_payment_id loop
  select * into v_payment from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id and p.order_id=v_order.id and p.id=v_alloc.original_payment_id and p.reversal_of_id is null for update;if not found then raise exception '退款支付分配不属于原订单';end if;
  select coalesce(sum(x.refund_amount),0) into v_paid_refunded from public.salon_refund_request_payments x join public.salon_refund_requests r on r.organization_id=x.organization_id and r.id=x.refund_request_id where x.organization_id=p_organization_id and x.original_payment_id=v_payment.id and r.status='executed';
  if v_paid_refunded+v_alloc.refund_amount>v_payment.amount then raise exception '支付渠道累计退款超过原支付金额';end if;
  insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,tendered_amount,change_amount,external_reference,member_account_id,member_units,status,reversal_of_id,refund_request_id,confirmed_at) values(p_organization_id,p_store_id,v_order.id,v_payment.payment_method,v_alloc.refund_amount,0,0,'',v_payment.member_account_id,v_alloc.refund_units,'confirmed',v_payment.id,p_refund_request_id,now()) returning id into v_reversal_payment_id;
  if v_payment.member_account_id is not null then
   select * into v_original_ledger from public.salon_account_ledger l where l.organization_id=p_organization_id and l.payment_id=v_payment.id for update;if not found then raise exception '原会员扣款流水不存在，不能自动返还';end if;
   if v_payment.payment_method='member_value' then update public.salon_member_accounts set cash_balance=cash_balance+v_alloc.refund_amount where organization_id=p_organization_id and id=v_payment.member_account_id;insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,payment_id,entry_type,cash_delta,reversal_of_id,refund_request_id,reason) values(p_organization_id,p_store_id,v_payment.member_account_id,v_order.id,v_reversal_payment_id,'refund',v_alloc.refund_amount,v_original_ledger.id,p_refund_request_id,v_refund.reason);
   elsif v_payment.payment_method='member_units' then update public.salon_member_accounts set remaining_units=remaining_units+v_alloc.refund_units where organization_id=p_organization_id and id=v_payment.member_account_id;insert into public.salon_account_ledger(organization_id,store_id,account_id,order_id,payment_id,entry_type,units_delta,reversal_of_id,refund_request_id,reason) values(p_organization_id,p_store_id,v_payment.member_account_id,v_order.id,v_reversal_payment_id,'refund',v_alloc.refund_units,v_original_ledger.id,p_refund_request_id,v_refund.reason);end if;
  end if;
  if v_paid_refunded+v_alloc.refund_amount=v_payment.amount then update public.salon_payments set status='reversed' where organization_id=p_organization_id and id=v_payment.id;end if;v_payment_count:=v_payment_count+1;
 end loop;
 for v_stock in select ol.catalog_item_id,sum(rl.quantity)::numeric(14,3) quantity from public.salon_refund_request_lines rl join public.salon_order_lines ol on ol.organization_id=rl.organization_id and ol.id=rl.order_line_id where rl.organization_id=p_organization_id and rl.refund_request_id=p_refund_request_id and rl.item_type='product' group by ol.catalog_item_id order by ol.catalog_item_id loop
  select * into v_sale from public.salon_inventory_ledger l where l.organization_id=p_organization_id and l.store_id=p_store_id and l.order_id=v_order.id and l.catalog_item_id=v_stock.catalog_item_id and l.movement_type='sale' and l.reversal_of_id is null order by l.id limit 1 for update;if not found then raise exception '原商品销售出库流水不存在';end if;
  select coalesce(sum(l.quantity_delta),0) into v_stock_refunded from public.salon_inventory_ledger l where l.organization_id=p_organization_id and l.reversal_of_id=v_sale.id and l.movement_type='refund';if v_stock_refunded+v_stock.quantity>-v_sale.quantity_delta then raise exception '商品累计退回数量超过原销售数量';end if;
  select * into v_balance from public.salon_inventory_balances b where b.organization_id=p_organization_id and b.store_id=p_store_id and b.catalog_item_id=v_stock.catalog_item_id for update;if not found then raise exception '商品库存余额不存在';end if;
  update public.salon_inventory_balances set quantity=quantity+v_stock.quantity,updated_at=now() where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=v_stock.catalog_item_id;
  insert into public.salon_inventory_ledger(organization_id,store_id,catalog_item_id,movement_type,quantity_delta,quantity_before,quantity_after,order_id,reversal_of_id,refund_request_id,reason) values(p_organization_id,p_store_id,v_stock.catalog_item_id,'refund',v_stock.quantity,v_balance.quantity,v_balance.quantity+v_stock.quantity,v_order.id,v_sale.id,p_refund_request_id,v_refund.reason);v_stock_count:=v_stock_count+1;
 end loop;
 v_new_total:=v_order.refunded_total+v_refund.requested_amount;v_status:=case when v_new_total=v_order.payable_total then 'reversed' else 'paid' end;
 update public.salon_orders set refunded_total=v_new_total,status=v_status,updated_at=now() where organization_id=p_organization_id and id=v_order.id;
 update public.salon_refund_requests set status='executed',executed_at=now() where organization_id=p_organization_id and id=p_refund_request_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_request',p_refund_request_id::text,'execute',jsonb_build_object('status','approved','orderRefundedTotal',v_order.refunded_total),jsonb_build_object('status','executed','orderStatus',v_status,'orderRefundedTotal',v_new_total,'payments',v_payment_count,'stockReturns',v_stock_count),v_refund.reason);
 v_response:=jsonb_build_object('refundRequestId',p_refund_request_id,'status','executed','orderId',v_order.id,'orderStatus',v_status,'refundedAmount',v_refund.requested_amount,'orderRefundedTotal',v_new_total,'reversedPayments',v_payment_count,'returnedStock',v_stock_count);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end $$;

revoke execute on function public.salon_refund_order(bigint,bigint,bigint,bigint,text,text) from service_role;
comment on function public.salon_refund_order(bigint,bigint,bigint,bigint,text,text) is 'Deprecated: direct refund bypass is disabled; submit, approve, then execute a refund request.';
revoke execute on function public.salon_execute_refund_request(bigint,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_execute_refund_request(bigint,bigint,bigint,bigint,text) to service_role;
comment on function public.salon_execute_refund_request(bigint,bigint,bigint,bigint,text) is 'Service-only atomic execution of an approved refund snapshot with partial-refund support.';
