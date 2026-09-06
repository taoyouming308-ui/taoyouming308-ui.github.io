\set ON_ERROR_STOP on

insert into public.salon_organizations(name) values('事务测试组织');
insert into public.salon_stores(organization_id,code,name) values(1,'S1','测试一店'),(1,'S2','测试二店');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'测试店长','store');
insert into public.salon_role_permissions(role_id,resource,action) values(1,'orders','checkout'),(1,'inventory','write');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'E1','测试员工');
insert into public.salon_customers(organization_id,display_name,phone_normalized) values(1,'测试顾客','13800000000');
insert into public.salon_member_accounts(organization_id,customer_id,account_type,account_no,cash_balance,status)
  values(1,1,'stored_value','C1',500,'active');
insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price) values(1,'service','SV1','剪发',120),(1,'product','P1','造型品',80);
insert into public.salon_orders(organization_id,store_id,order_no,customer_id,status,subtotal,payable_total)
  values(1,1,'T-1',1,'awaiting_payment',120,120);
insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,quantity,unit_price,line_total)
  values(1,1,1,1,120,120);

set role service_role;
select public.salon_checkout_order(1,1,1,1,'checkout-T-1','[{"method":"member_value","amount":100,"accountId":1},{"method":"cash","amount":20}]');
select public.salon_checkout_order(1,1,1,1,'checkout-T-1','[{"method":"cash","amount":120}]');
select public.salon_move_inventory(1,1,1,2,'receive-P1','receive',10,null,'测试入库');
select public.salon_move_inventory(1,1,1,2,'receive-P1','receive',10,null,'网络重试');
select public.salon_move_inventory(1,1,1,2,'sale-P1','sale',4,1,'订单销售');
reset role;

do $$ begin
  if (select cash_balance from public.salon_member_accounts where id=1)<>400 then raise exception 'member balance was deducted more than once'; end if;
  if (select count(*) from public.salon_payments where order_id=1)<>2 then raise exception 'payments were duplicated'; end if;
  if (select count(*) from public.salon_operation_requests)<>3 then raise exception 'idempotency registry mismatch'; end if;
  if (select quantity from public.salon_inventory_balances where store_id=1 and catalog_item_id=2)<>6 then raise exception 'inventory retry deducted twice'; end if;
  if (select count(*) from public.salon_inventory_ledger)<>2 then raise exception 'inventory ledger duplicated'; end if;
  if has_function_privilege('anon','public.salon_checkout_order(bigint,bigint,bigint,bigint,text,jsonb)','EXECUTE') then raise exception 'anon can execute checkout'; end if;
  if has_function_privilege('authenticated','public.salon_move_inventory(bigint,bigint,bigint,bigint,text,text,numeric,bigint,text)','EXECUTE') then raise exception 'authenticated can execute inventory movement'; end if;
  if not has_function_privilege('service_role','public.salon_checkout_order(bigint,bigint,bigint,bigint,text,jsonb)','EXECUTE') then raise exception 'service role cannot execute checkout'; end if;
end $$;

do $$ begin
  begin
    perform public.salon_move_inventory(1,1,2,2,'cross-store-key','sale',1,null,'跨店尝试');
    raise exception 'cross-store permission unexpectedly allowed';
  exception when others then
    if sqlerrm='cross-store permission unexpectedly allowed' then raise; end if;
  end;
  begin
    perform public.salon_move_inventory(1,1,1,2,'oversell-P1','sale',7,null,'超卖尝试');
    raise exception 'oversell unexpectedly allowed';
  exception when others then
    if sqlerrm='oversell unexpectedly allowed' then raise; end if;
  end;
end $$;

select 'salon database transaction test passed' as result;
