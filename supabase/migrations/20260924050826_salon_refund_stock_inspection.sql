-- Independent Salon refund product inspection; never applied to a remote database.
set statement_timeout='30s';
set lock_timeout='5s';

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'cash_checkout','checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','refund_withdraw','refund_stock_inspect','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review','booking_reschedule','booking_change_request','booking_change_review'
));

create table public.salon_refund_stock_inspections(
 id bigint generated always as identity primary key,
 organization_id bigint not null,
 store_id bigint not null,
 refund_request_id bigint not null,
 order_line_id bigint not null,
 revision integer not null check(revision>0),
 requested_quantity numeric(12,3) not null check(requested_quantity>0),
 accepted_quantity numeric(12,3) not null check(accepted_quantity>=0 and accepted_quantity<=requested_quantity),
 condition text not null check(condition in('sealed','opened','damaged','not_returnable')),
 check(condition not in('damaged','not_returnable') or accepted_quantity=0),
 reason text not null check(nullif(btrim(reason),'') is not null and length(reason)<=500),
 request_key text not null check(request_key ~ '^[A-Za-z0-9._:-]{16,120}$'),
 inspected_by_staff_id bigint not null,
 inspected_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,refund_request_id,order_line_id,revision),
 unique(organization_id,request_key),
 foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
 foreign key(organization_id,refund_request_id) references public.salon_refund_requests(organization_id,id) on delete restrict,
 foreign key(organization_id,order_line_id) references public.salon_order_lines(organization_id,id) on delete restrict,
 foreign key(organization_id,inspected_by_staff_id) references public.salon_staff(organization_id,id) on delete restrict
);
create index salon_refund_stock_inspection_latest_idx on public.salon_refund_stock_inspections(organization_id,refund_request_id,order_line_id,revision desc);
alter table public.salon_refund_stock_inspections enable row level security;
revoke all on public.salon_refund_stock_inspections from public,anon,authenticated;
grant select,insert on public.salon_refund_stock_inspections to service_role;
grant usage,select on sequence public.salon_refund_stock_inspections_id_seq to service_role;

create or replace function public.salon_inspect_refund_product_line(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,
 p_order_line_id bigint,p_request_key text,p_expected_quantity numeric,p_expected_revision integer,p_accepted_quantity numeric,
 p_condition text,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_line public.salon_refund_request_lines;v_order_line public.salon_order_lines;v_revision integer;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$' or p_expected_quantity is null or p_expected_revision is null or p_expected_revision<0 or p_accepted_quantity is null or p_expected_quantity<=0 or p_accepted_quantity<0 or p_accepted_quantity>p_expected_quantity or p_expected_quantity<>round(p_expected_quantity,3) or p_accepted_quantity<>round(p_accepted_quantity,3) or p_condition is null or p_condition not in('sealed','opened','damaged','not_returnable') or (p_condition in('damaged','not_returnable') and p_accepted_quantity<>0) or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception '商品验收参数无效';end if;
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_stock_inspect','refund_stock_line',p_order_line_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_refund_request_id',p_refund_request_id,'p_order_line_id',p_order_line_id,'p_expected_quantity',p_expected_quantity,'p_expected_revision',p_expected_revision,'p_accepted_quantity',p_accepted_quantity,'p_condition',p_condition,'p_reason',btrim(p_reason)),'inventory','write');
 if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '仅已批准的退款申请可以验收商品';end if;
 perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=v_refund.order_id for update;
 select * into v_line from public.salon_refund_request_lines where organization_id=p_organization_id and refund_request_id=p_refund_request_id and order_line_id=p_order_line_id for update;
 select * into v_order_line from public.salon_order_lines where organization_id=p_organization_id and order_id=v_refund.order_id and id=p_order_line_id;
 if not found or v_line.item_type<>'product' or v_order_line.item_type<>'product' or v_order_line.catalog_item_id is null then raise exception '验收明细不是原订单可追溯商品';end if;
 if v_line.quantity<>p_expected_quantity then raise exception '申请商品数量已变化，请重新读取';end if;
 select coalesce(max(revision),0) into v_revision from public.salon_refund_stock_inspections where organization_id=p_organization_id and refund_request_id=p_refund_request_id and order_line_id=p_order_line_id;
 if v_revision<>p_expected_revision then raise exception '商品验收记录已变化，请重新读取后复核';end if;
 v_revision:=v_revision+1;
 insert into public.salon_refund_stock_inspections(organization_id,store_id,refund_request_id,order_line_id,revision,requested_quantity,accepted_quantity,condition,reason,request_key,inspected_by_staff_id)
 values(p_organization_id,p_store_id,p_refund_request_id,p_order_line_id,v_revision,v_line.quantity,p_accepted_quantity,p_condition,btrim(p_reason),p_request_key,p_actor_staff_id);
 v_response:=jsonb_build_object('refundRequestId',p_refund_request_id,'orderLineId',p_order_line_id,'revision',v_revision,'requestedQuantity',to_char(v_line.quantity,'FM999999999990.000'),'acceptedQuantity',to_char(p_accepted_quantity,'FM999999999990.000'),'condition',p_condition,'status','recorded');
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_request',p_refund_request_id::text,'stock_inspect',v_response,btrim(p_reason));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;
 return v_response;
end $$;
revoke execute on function public.salon_inspect_refund_product_line(bigint,bigint,bigint,bigint,bigint,text,numeric,integer,numeric,text,text) from public,anon,authenticated;
grant execute on function public.salon_inspect_refund_product_line(bigint,bigint,bigint,bigint,bigint,text,numeric,integer,numeric,text,text) to service_role;

create or replace function public.salon_lookup_refund_stock_inspection(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_lookup_key text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then raise exception '请求核对编号无效';end if;
 select jsonb_build_object('operation','refund_stock_inspect','status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
 into v_result from public.salon_operation_requests r join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id
  and f.id=case when (r.response_json->>'refundRequestId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
 where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key and r.action='refund_stock_inspect'
  and r.entity_type='refund_stock_line' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null and r.completed_at is not null
  and r.response_json->>'orderLineId' ~ '^[1-9][0-9]{0,17}$'
  and r.response_json->>'revision' ~ '^[1-9][0-9]{0,8}$'
  and exists(select 1 from public.salon_refund_stock_inspections i where i.organization_id=r.organization_id and i.store_id=r.store_id and i.refund_request_id=f.id and i.order_line_id=(r.response_json->>'orderLineId')::bigint and i.request_key=r.request_key and i.inspected_by_staff_id=p_actor_staff_id and i.revision=(r.response_json->>'revision')::integer);
 return coalesce(v_result,jsonb_build_object('operation','refund_stock_inspect','status','unconfirmed'));
end $$;
revoke execute on function public.salon_lookup_refund_stock_inspection(bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_refund_stock_inspection(bigint,bigint,bigint,text) to service_role;

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
 select coalesce(jsonb_agg(jsonb_build_object('orderLineId',l.order_line_id,'name',l.item_name,'type',l.item_type,'quantity',l.quantity::text,'amount',l.refund_amount::text,'stockInspection',(select jsonb_build_object('revision',i.revision,'requestedQuantity',to_char(i.requested_quantity,'FM999999999990.000'),'acceptedQuantity',to_char(i.accepted_quantity,'FM999999999990.000'),'condition',i.condition,'reason',i.reason,'inspectedByStaffId',i.inspected_by_staff_id,'inspectedAt',i.inspected_at) from public.salon_refund_stock_inspections i where i.organization_id=l.organization_id and i.refund_request_id=l.refund_request_id and i.order_line_id=l.order_line_id order by i.revision desc limit 1)) order by l.order_line_id),'[]') into v_lines
 from public.salon_refund_request_lines l join public.salon_order_lines o on o.organization_id=l.organization_id and o.id=l.order_line_id and o.order_id=v_order.id
 where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id;
 select coalesce(jsonb_agg(jsonb_build_object('paymentId',l.original_payment_id,'method',l.payment_method,'amount',l.refund_amount::text,'units',l.refund_units::text,'originalMethod',p.payment_method,'originalAmount',p.amount::text,'originalUnits',p.member_units::text,'originalStatus',p.status) order by l.original_payment_id),'[]') into v_payments
 from public.salon_refund_request_payments l join public.salon_payments p on p.organization_id=l.organization_id and p.id=l.original_payment_id and p.order_id=v_order.id and p.store_id=p_store_id and p.reversal_of_id is null
 where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id;
 if jsonb_array_length(v_lines)<>(select count(*) from public.salon_refund_request_lines where organization_id=p_organization_id and refund_request_id=p_refund_request_id) or jsonb_array_length(v_payments)<>(select count(*) from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=p_refund_request_id) then raise exception '退款明细或支付分配范围不匹配';end if;
 return jsonb_build_object('refund',jsonb_build_object('id',v_refund.id,'organizationId',v_refund.organization_id,'storeId',v_refund.store_id,'orderId',v_refund.order_id,'type',v_refund.refund_type,'status',v_refund.status,'amount',v_refund.requested_amount::text,'reason',v_refund.reason,'createdByStaffId',v_refund.created_by_staff_id,'reviewedByStaffId',v_refund.reviewed_by_staff_id,'decisionReason',v_refund.decision_reason,'withdrawnByStaffId',v_refund.withdrawn_by_staff_id,'withdrawalReason',coalesce(v_refund.withdrawal_reason,'')),'order',jsonb_build_object('id',v_order.id,'number',v_order.order_no,'status',v_order.status,'payable',v_order.payable_total::text,'refundedTotal',v_order.refunded_total::text,'version',v_order.edit_version),'lines',v_lines,'payments',v_payments);
end $$;
revoke execute on function public.salon_get_refund_review(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_refund_review(bigint,bigint,bigint,bigint) to service_role;

-- Replace the pre-inspection executor: every product line needs a final inspection;
-- only the accepted quantity returns to saleable stock. Money refund allocations remain separate.
create or replace function public.salon_execute_refund_request(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,p_request_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_order public.salon_orders;v_alloc record;v_payment public.salon_payments;v_original_ledger public.salon_account_ledger;v_reversal_payment_id bigint;v_paid_refunded numeric(12,2);v_stock record;v_sale public.salon_inventory_ledger;v_balance public.salon_inventory_balances;v_stock_refunded numeric(14,3);v_new_total numeric(12,2);v_status text;v_payment_count integer:=0;v_stock_count integer:=0;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_execute','refund_request',p_refund_request_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_refund_request_id',p_refund_request_id),'orders','refund_execute');if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '退款申请不存在或当前不可执行';end if;
 select * into v_order from public.salon_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id and o.id=v_refund.order_id for update;
 if not found or v_order.status<>'paid' then raise exception '原订单不是可退款的已支付状态';end if;
 if v_order.refunded_total+v_refund.requested_amount>v_order.payable_total then raise exception '累计退款金额超过订单实收';end if;
 if exists(select 1 from public.salon_refund_request_lines l where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id and l.item_type='product') then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
  if exists(select 1 from public.salon_refund_request_lines l where l.organization_id=p_organization_id and l.refund_request_id=p_refund_request_id and l.item_type='product' and not exists(select 1 from public.salon_refund_stock_inspections i where i.organization_id=l.organization_id and i.refund_request_id=l.refund_request_id and i.order_line_id=l.order_line_id and i.revision=(select max(latest.revision) from public.salon_refund_stock_inspections latest where latest.organization_id=l.organization_id and latest.refund_request_id=l.refund_request_id and latest.order_line_id=l.order_line_id) and i.requested_quantity=l.quantity and i.accepted_quantity<=l.quantity)) then raise exception '退款商品尚未逐项验收，或验收快照已变化，不能执行';end if;
 end if;
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
 for v_stock in
  select ol.catalog_item_id,sum(i.accepted_quantity)::numeric(14,3) quantity
  from public.salon_refund_request_lines rl join public.salon_order_lines ol on ol.organization_id=rl.organization_id and ol.id=rl.order_line_id
  join lateral(select si.accepted_quantity from public.salon_refund_stock_inspections si where si.organization_id=rl.organization_id and si.refund_request_id=rl.refund_request_id and si.order_line_id=rl.order_line_id order by si.revision desc limit 1)i on true
  where rl.organization_id=p_organization_id and rl.refund_request_id=p_refund_request_id and rl.item_type='product' and i.accepted_quantity>0
  group by ol.catalog_item_id order by ol.catalog_item_id loop
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
revoke execute on function public.salon_execute_refund_request(bigint,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.salon_execute_refund_request(bigint,bigint,bigint,bigint,text) to service_role;
