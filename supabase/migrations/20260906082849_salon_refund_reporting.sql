-- Refund-aware operating reports and append-only manual finance entries.
-- Development branch only; this does not read or write the ZYSYR ledger.
set statement_timeout='30s';set lock_timeout='5s';

create table public.salon_finance_entries(
 id bigint generated always as identity primary key,organization_id bigint not null,store_id bigint not null,
 entry_date date not null,entry_type text not null check(entry_type in('income','expense')),
 category text not null check(nullif(btrim(category),'') is not null),amount numeric(12,2) not null check(amount>0),
 note text not null check(nullif(btrim(note),'') is not null),created_by_staff_id bigint not null,created_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
 foreign key(organization_id,created_by_staff_id) references public.salon_staff(organization_id,id) on delete restrict
);
create index salon_finance_entries_scope_date_idx on public.salon_finance_entries(organization_id,store_id,entry_date,id);
alter table public.salon_finance_entries enable row level security;alter table public.salon_finance_entries force row level security;
revoke all on table public.salon_finance_entries from public,anon,authenticated;grant all on table public.salon_finance_entries to service_role;

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in ('checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count','member_open','member_recharge','member_status','order_create','order_lines','order_status','refund_request','refund_review','refund_execute','finance_entry'));

create or replace function public.salon_add_finance_entry(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_request_key text,p_entry_date date,p_entry_type text,p_category text,p_amount numeric,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_id bigint;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'finance','write');
 if p_entry_date is null or p_entry_type not in('income','expense') or p_amount is null or round(p_amount,2)<=0 or nullif(btrim(coalesce(p_category,'')),'') is null or nullif(btrim(coalesce(p_note,'')),'') is null then raise exception '收支记录参数无效';end if;
 v_op:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'finance_entry','finance_payload',hashtextextended(jsonb_build_object('date',p_entry_date,'type',p_entry_type,'category',btrim(p_category),'amount',round(p_amount,2),'note',btrim(p_note))::text,0));if v_op.completed_at is not null then return v_op.response_json;end if;
 insert into public.salon_finance_entries(organization_id,store_id,entry_date,entry_type,category,amount,note,created_by_staff_id) values(p_organization_id,p_store_id,p_entry_date,p_entry_type,btrim(p_category),round(p_amount,2),btrim(p_note),p_actor_staff_id) returning id into v_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'finance_entry',v_id::text,'create',jsonb_build_object('date',p_entry_date,'type',p_entry_type,'category',btrim(p_category),'amount',round(p_amount,2)),btrim(p_note));
 v_response:=jsonb_build_object('financeEntryId',v_id,'status','recorded');update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end $$;

create or replace function public.salon_get_operating_report(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_date_from date,p_date_to date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_timezone text;v_payment_methods jsonb;v_payment_net numeric(14,2);v_gross numeric(14,2);v_refunds numeric(14,2);v_income numeric(14,2);v_expense numeric(14,2);v_order_count integer;v_refund_count integer;v_staff jsonb;v_entries jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'reports','read');
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>366 then raise exception '报表日期范围无效';end if;
 select timezone into v_timezone from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active';if not found then raise exception '门店不存在或已停用';end if;
 with methods(method) as(values('cash'),('wechat'),('alipay'),('member_value'),('member_units')),amounts as(select p.payment_method method,round(sum(case when p.reversal_of_id is null then p.amount else -p.amount end),2) amount from public.salon_payments p where p.organization_id=p_organization_id and p.store_id=p_store_id and p.status in('confirmed','reversed') and (p.confirmed_at at time zone v_timezone)::date between p_date_from and p_date_to group by p.payment_method) select jsonb_object_agg(m.method,coalesce(a.amount,0)),coalesce(sum(a.amount),0) into v_payment_methods,v_payment_net from methods m left join amounts a using(method);
 select coalesce(round(sum(o.payable_total),2),0),count(*) into v_gross,v_order_count from public.salon_orders o where o.organization_id=p_organization_id and o.store_id=p_store_id and o.paid_at is not null and (o.paid_at at time zone v_timezone)::date between p_date_from and p_date_to;
 select coalesce(round(sum(r.requested_amount),2),0),count(*) into v_refunds,v_refund_count from public.salon_refund_requests r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.status='executed' and (r.executed_at at time zone v_timezone)::date between p_date_from and p_date_to;
 select coalesce(round(sum(amount) filter(where entry_type='income'),2),0),coalesce(round(sum(amount) filter(where entry_type='expense'),2),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'date',entry_date,'type',entry_type,'category',category,'amount',amount,'note',note) order by entry_date,id),'[]'::jsonb) into v_income,v_expense,v_entries from public.salon_finance_entries where organization_id=p_organization_id and store_id=p_store_id and entry_date between p_date_from and p_date_to;
 with events as(
  select l.staff_id,l.item_type category,l.line_total gross_amount,0::numeric refund_amount from public.salon_order_lines l join public.salon_orders o on o.organization_id=l.organization_id and o.id=l.order_id where l.organization_id=p_organization_id and o.store_id=p_store_id and l.staff_id is not null and o.paid_at is not null and (o.paid_at at time zone v_timezone)::date between p_date_from and p_date_to
  union all
  select l.staff_id,l.item_type,0::numeric,rl.refund_amount from public.salon_refund_request_lines rl join public.salon_refund_requests r on r.organization_id=rl.organization_id and r.id=rl.refund_request_id join public.salon_order_lines l on l.organization_id=rl.organization_id and l.id=rl.order_line_id where rl.organization_id=p_organization_id and r.store_id=p_store_id and r.status='executed' and l.staff_id is not null and (r.executed_at at time zone v_timezone)::date between p_date_from and p_date_to
 ),totals as(select staff_id,category,round(sum(gross_amount),2) gross_amount,round(sum(refund_amount),2) refund_amount from events group by staff_id,category)
 select coalesce(jsonb_agg(jsonb_build_object('staffId',t.staff_id,'staffName',s.display_name,'category',t.category,'grossAmount',t.gross_amount,'refundAmount',t.refund_amount,'netAmount',t.gross_amount-t.refund_amount) order by s.display_name,t.category),'[]'::jsonb) into v_staff from totals t join public.salon_staff s on s.organization_id=p_organization_id and s.id=t.staff_id;
 return jsonb_build_object('storeId',p_store_id,'dateFrom',p_date_from,'dateTo',p_date_to,'orderCount',v_order_count,'refundCount',v_refund_count,'grossSales',v_gross,'refundSales',v_refunds,'netSales',v_gross-v_refunds,'paymentMethods',v_payment_methods,'paymentNet',v_payment_net,'manualIncome',v_income,'manualExpense',v_expense,'operatingNet',v_payment_net+v_income-v_expense,'staffPerformance',v_staff,'financeEntries',v_entries);
end $$;

revoke execute on function public.salon_add_finance_entry(bigint,bigint,bigint,text,date,text,text,numeric,text) from public,anon,authenticated;
revoke execute on function public.salon_get_operating_report(bigint,bigint,bigint,date,date) from public,anon,authenticated;
grant execute on function public.salon_add_finance_entry(bigint,bigint,bigint,text,date,text,text,numeric,text) to service_role;
grant execute on function public.salon_get_operating_report(bigint,bigint,bigint,date,date) to service_role;
