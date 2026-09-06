-- D1: trusted store selection and explicit sensitive-read permissions.
set statement_timeout='30s';
set lock_timeout='5s';

insert into public.salon_permission_catalog(resource,action,label)
values ('inventory','read','查看库存') on conflict do nothing;
-- Do not automatically broaden existing roles; administrators explicitly grant read.

create or replace function public.salon_resolve_staff_store(
 p_actor_staff_id bigint,p_organization_id bigint,p_requested_store_id bigint
) returns bigint language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.salon_stores st join public.salon_organizations o
   on o.id=st.organization_id where st.organization_id=p_organization_id
   and st.id=p_requested_store_id and st.status='active' and o.status='active')
 or not exists(select 1 from public.salon_staff s
   join public.salon_staff_store_roles a on a.organization_id=s.organization_id and a.staff_id=s.id
   join public.salon_roles r on r.organization_id=a.organization_id and r.id=a.role_id
   where s.organization_id=p_organization_id and s.id=p_actor_staff_id and s.employment_status='active'
   and a.status='active' and a.effective_from<=current_date
   and (a.effective_to is null or a.effective_to>=current_date) and r.status='active'
   and (r.data_scope='organization' or a.store_id=p_requested_store_id))
 then raise exception '当前员工不能进入该门店';end if;
 return p_requested_store_id;
end$$;

create or replace function salon_private.assert_staff_permission(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_resource text,p_action text
) returns void language plpgsql security invoker set search_path='' as $$
begin
 begin
  perform public.salon_resolve_staff_store(p_actor_staff_id,p_organization_id,p_store_id);
 exception when raise_exception then raise exception '当前员工没有该门店操作权限';end;
 if not exists(select 1 from public.salon_staff_store_roles a
   join public.salon_roles r on r.organization_id=a.organization_id and r.id=a.role_id
   join public.salon_role_permissions rp on rp.role_id=r.id
   where a.organization_id=p_organization_id and a.staff_id=p_actor_staff_id
   and a.status='active' and a.effective_from<=current_date
   and (a.effective_to is null or a.effective_to>=current_date) and r.status='active'
   and (r.data_scope='organization' or a.store_id=p_store_id)
   and (r.data_scope<>'self' or (p_resource='payroll' and p_action='read'))
   and rp.resource=p_resource and rp.action=p_action)
 then raise exception '当前员工没有该门店操作权限';end if;
end$$;

create function public.salon_get_order_receipt(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_order_id bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_order jsonb;v_payments jsonb;v_ledger jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
 select to_jsonb(x) into v_order from (select id,order_no,status,subtotal,discount_total,payable_total,paid_at
   from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id) x;
 if v_order is null then raise exception '订单不存在或不属于当前门店';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into v_payments from (
   select id,payment_method,amount,tendered_amount,change_amount,external_reference,member_units,status,reversal_of_id,confirmed_at
   from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into v_ledger from (
   select id,entry_type,cash_delta,bonus_delta,units_delta,reversal_of_id,occurred_at
   from public.salon_account_ledger where organization_id=p_organization_id and store_id=p_store_id and order_id=p_order_id) x;
 return jsonb_build_object('order',v_order,'payments',v_payments,'memberLedger',v_ledger);
end$$;

create function public.salon_list_inventory_balances(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_catalog_item_id bigint default null
) returns table(catalog_item_id bigint,quantity numeric,updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','read');
 return query select b.catalog_item_id,b.quantity,b.updated_at from public.salon_inventory_balances b
 where b.organization_id=p_organization_id and b.store_id=p_store_id
 and (p_catalog_item_id is null or b.catalog_item_id=p_catalog_item_id)
 order by b.catalog_item_id limit 500;
end$$;

revoke execute on function public.salon_get_order_receipt(bigint,bigint,bigint,bigint),
 public.salon_list_inventory_balances(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_order_receipt(bigint,bigint,bigint,bigint),
 public.salon_list_inventory_balances(bigint,bigint,bigint,bigint) to service_role;
