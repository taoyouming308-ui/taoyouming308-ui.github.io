-- External-channel refund evidence is recorded and reviewed separately from
-- the internal refund ledger. This is isolated branch SQL; never apply remotely.
set statement_timeout='30s';
set lock_timeout='5s';

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in(
 'cash_checkout','checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count',
 'member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','refund_withdraw','refund_stock_inspect','refund_channel_receipt','finance_entry',
 'staff_create','staff_status','commission_rule','payroll_generate','payroll_review','role_create','role_status','staff_assign','staff_transfer',
 'customer_bind','consent_set','work_create','work_submit','work_review','review_create','review_moderate','campaign_create','campaign_status','booking_request','booking_review','booking_cancel','booking_cancel_review','booking_reschedule','booking_change_request','booking_change_review'
));

alter table public.salon_refund_request_payments add constraint salon_refund_request_payments_org_allocation_unique unique(organization_id,refund_request_id,original_payment_id);
create table public.salon_refund_channel_receipts(
 id bigint generated always as identity primary key,
 organization_id bigint not null,
 store_id bigint not null,
 refund_request_id bigint not null,
 original_payment_id bigint not null,
 revision integer not null check(revision>0),
 refund_amount numeric(12,2) not null check(refund_amount>0),
 status text not null check(status in('reported','verified','rejected')),
 external_reference text not null check(nullif(btrim(external_reference),'') is not null and length(external_reference)<=120),
 evidence_note text not null check(nullif(btrim(evidence_note),'') is not null and length(evidence_note)<=500),
 request_key text not null check(request_key ~ '^[A-Za-z0-9._:-]{16,120}$'),
 reported_by_staff_id bigint not null,
 verified_by_staff_id bigint,
 created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,request_key),
 unique(organization_id,refund_request_id,original_payment_id,revision),
 foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
 foreign key(organization_id,refund_request_id,original_payment_id) references public.salon_refund_request_payments(organization_id,refund_request_id,original_payment_id) on delete restrict,
 foreign key(organization_id,reported_by_staff_id) references public.salon_staff(organization_id,id) on delete restrict,
 foreign key(organization_id,verified_by_staff_id) references public.salon_staff(organization_id,id) on delete restrict,
 check((status='reported' and verified_by_staff_id is null) or (status in('verified','rejected') and verified_by_staff_id is not null and verified_by_staff_id<>reported_by_staff_id))
);
create index salon_refund_channel_receipt_latest_idx on public.salon_refund_channel_receipts(organization_id,refund_request_id,original_payment_id,revision desc);
alter table public.salon_refund_channel_receipts enable row level security;
revoke all on public.salon_refund_channel_receipts from public,anon,authenticated;
grant select,insert on public.salon_refund_channel_receipts to service_role;
grant usage,select on sequence public.salon_refund_channel_receipts_id_seq to service_role;

create or replace function public.salon_record_refund_channel_receipt(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,
 p_original_payment_id bigint,p_request_key text,p_expected_revision integer,p_decision text,
 p_external_reference text,p_evidence_note text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_alloc public.salon_refund_request_payments;v_payment public.salon_payments;v_latest public.salon_refund_channel_receipts;v_revision integer;v_status text;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$' or p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in('report','verify','reject') or nullif(btrim(p_external_reference),'') is null or length(p_external_reference)>120 or nullif(btrim(p_evidence_note),'') is null or length(p_evidence_note)>500 then raise exception '外部退款回执参数无效';end if;
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_channel_receipt','refund_request',p_refund_request_id,p_actor_staff_id,jsonb_build_object('actor',p_actor_staff_id,'organization',p_organization_id,'store',p_store_id,'refund',p_refund_request_id,'payment',p_original_payment_id,'expectedRevision',p_expected_revision,'decision',p_decision,'externalReference',btrim(p_external_reference),'evidenceNote',btrim(p_evidence_note)),'orders','refund_execute');if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '仅已批准的退款申请可以登记或复核渠道回执';end if;
 select * into v_alloc from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=p_refund_request_id and original_payment_id=p_original_payment_id;
 if not found then raise exception '退款支付分配不存在';end if;
 select * into v_payment from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and id=p_original_payment_id and reversal_of_id is null;
 if not found or v_payment.payment_method in('member_value','member_units') then raise exception '该支付不是外部渠道支付';end if;
 select * into v_latest from public.salon_refund_channel_receipts where organization_id=p_organization_id and refund_request_id=p_refund_request_id and original_payment_id=p_original_payment_id order by revision desc limit 1;
 v_revision:=coalesce(v_latest.revision,0);
 if v_revision<>p_expected_revision then raise exception '回执版本已变化，请刷新后重试';end if;
 if p_decision='report' then
  if v_revision<>0 then raise exception '回执已经登记，请由其他员工复核';end if;v_status:='reported';
 elsif p_decision in('verify','reject') then
  if not found or v_latest.status<>'reported' or v_latest.reported_by_staff_id=p_actor_staff_id then raise exception '仅其他员工可复核待核验回执';end if;
  if btrim(p_external_reference)<>v_latest.external_reference then raise exception '复核时凭证号必须与登记一致';end if;v_status:=case when p_decision='verify' then 'verified' else 'rejected' end;
 else raise exception '回执决策无效';end if;
 insert into public.salon_refund_channel_receipts(organization_id,store_id,refund_request_id,original_payment_id,revision,refund_amount,status,external_reference,evidence_note,request_key,reported_by_staff_id,verified_by_staff_id)
 values(p_organization_id,p_store_id,p_refund_request_id,p_original_payment_id,v_revision+1,v_alloc.refund_amount,v_status,btrim(p_external_reference),btrim(p_evidence_note),p_request_key,case when p_decision='report' then p_actor_staff_id else v_latest.reported_by_staff_id end,case when p_decision='report' then null else p_actor_staff_id end);
 v_response:=jsonb_build_object('refundRequestId',p_refund_request_id,'paymentId',p_original_payment_id,'revision',v_revision+1,'status',v_status,'amount',v_alloc.refund_amount,'reportedBy',case when p_decision='report' then p_actor_staff_id else v_latest.reported_by_staff_id end,'verifiedBy',case when p_decision='report' then null else p_actor_staff_id end);
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_channel_receipt',p_refund_request_id||':'||p_original_payment_id,p_decision,jsonb_build_object('revision',v_revision),v_response,btrim(p_evidence_note));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end $$;
revoke execute on function public.salon_record_refund_channel_receipt(bigint,bigint,bigint,bigint,bigint,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.salon_record_refund_channel_receipt(bigint,bigint,bigint,bigint,bigint,text,integer,text,text,text) to service_role;

create or replace function public.salon_execute_refund_request(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,p_request_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_order public.salon_orders;v_alloc record;v_payment public.salon_payments;v_original_ledger public.salon_account_ledger;v_reversal_payment_id bigint;v_paid_refunded numeric(12,2);v_stock record;v_sale public.salon_inventory_ledger;v_balance public.salon_inventory_balances;v_stock_refunded numeric(14,3);v_new_total numeric(12,2);v_status text;v_payment_count integer:=0;v_stock_count integer:=0;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_execute','refund_request',p_refund_request_id,p_actor_staff_id,jsonb_build_object('p_actor_staff_id',p_actor_staff_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_refund_request_id',p_refund_request_id),'orders','refund_execute');if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '退款申请不存在或当前不可执行';end if;
 if exists(select 1 from public.salon_refund_request_payments a join public.salon_payments p on p.organization_id=a.organization_id and p.id=a.original_payment_id where a.organization_id=p_organization_id and a.refund_request_id=p_refund_request_id and p.payment_method not in('member_value','member_units') and not exists(select 1 from public.salon_refund_channel_receipts c where c.organization_id=a.organization_id and c.refund_request_id=a.refund_request_id and c.original_payment_id=a.original_payment_id and c.status='verified' and c.refund_amount=a.refund_amount and c.revision=(select max(x.revision) from public.salon_refund_channel_receipts x where x.organization_id=c.organization_id and x.refund_request_id=c.refund_request_id and x.original_payment_id=c.original_payment_id))) then raise exception '存在尚未复核通过的外部渠道退款回执，未执行任何退款或库存操作';end if;
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
 for v_stock in select ol.catalog_item_id,sum(i.accepted_quantity)::numeric(14,3) quantity from public.salon_refund_request_lines rl join public.salon_order_lines ol on ol.organization_id=rl.organization_id and ol.id=rl.order_line_id join lateral(select si.accepted_quantity from public.salon_refund_stock_inspections si where si.organization_id=rl.organization_id and si.refund_request_id=rl.refund_request_id and si.order_line_id=rl.order_line_id order by si.revision desc limit 1)i on true where rl.organization_id=p_organization_id and rl.refund_request_id=p_refund_request_id and rl.item_type='product' and i.accepted_quantity>0 group by ol.catalog_item_id order by ol.catalog_item_id loop
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
