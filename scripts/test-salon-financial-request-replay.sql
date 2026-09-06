\set ON_ERROR_STOP on
set role service_role;
create function pg_temp.repeat_once(p_sql text) returns jsonb language plpgsql as $$
declare a jsonb;b jsonb;n bigint;begin
 execute p_sql into a;select count(*) into n from public.salon_audit_events;
 execute p_sql into b;
 if a is distinct from b or (select count(*) from public.salon_audit_events)<>n then raise exception 'retry duplicated effects: %',p_sql;end if;
 return a;
end$$;
create function pg_temp.conflict(p_sql text) returns void language plpgsql as $$
declare blocked boolean:=false;begin
 begin execute p_sql;exception when others then
  if sqlerrm like '%幂等键已被其他业务使用%' then blocked:=true;else raise;end if;
 end;
 if not blocked then raise exception 'changed request accepted: %',p_sql;end if;
end$$;
do $$declare org bigint;st bigint;role_id bigint;a bigint;b bigint;c bigint;item bigint;account bigint;ord bigint;refund bigint;payroll bigint;r jsonb;blocked boolean;begin
 insert into public.salon_organizations(name) values('合成资金重试测试') returning id into org;
 insert into public.salon_stores(organization_id,code,name) values(org,'FIN-REPLAY','合成测试店') returning id into st;
 insert into public.salon_roles(organization_id,name,data_scope) values(org,'合成管理权限','store') returning id into role_id;
 insert into public.salon_role_permissions select role_id,resource,action from public.salon_permission_catalog;
 insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(org,st,role_id,'FIN-A','合成经办人') returning id into a;
 insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(org,st,role_id,'FIN-B','合成复核人') returning id into b;
 insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id) values(org,a,st,role_id),(org,b,st,role_id);
 insert into public.salon_customers(organization_id,display_name) values(org,'合成会员') returning id into c;
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(org,st,c);
 insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price) values(org,'product','FIN-ITEM','合成商品',100) returning id into item;
 insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id,stock_tracked) values(org,st,item,true);
 insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id,quantity) values(org,st,item,0);
 perform pg_temp.repeat_once(format('select public.salon_move_inventory(%s,%s,%s,%s,%L,%L,10,null,%L)',a,org,st,item,'fin-stock-receive','receive','合成入库'));
 perform pg_temp.conflict(format('select public.salon_move_inventory(%s,%s,%s,%s,%L,%L,11,null,%L)',a,org,st,item,'fin-stock-receive','receive','合成入库'));
 perform pg_temp.repeat_once(format('select public.salon_count_inventory(%s,%s,%s,%s,%L,8,%L)',a,org,st,item,'fin-stock-count','合成盘点'));
 perform pg_temp.conflict(format('select public.salon_count_inventory(%s,%s,%s,%s,%L,9,%L)',a,org,st,item,'fin-stock-count','合成盘点'));
 r:=pg_temp.repeat_once(format('select public.salon_open_member_account(%s,%s,%s,%s,%L,%L,%L,%L,%L,null)',a,org,st,c,'fin-member-open','stored_value','FIN-CARD','合成储值卡','store'));account:=(r->>'accountId')::bigint;
 perform pg_temp.conflict(format('select public.salon_open_member_account(%s,%s,%s,%s,%L,%L,%L,%L,%L,null)',b,org,st,c,'fin-member-open','stored_value','FIN-CARD','合成储值卡','store'));
 perform pg_temp.repeat_once(format('select public.salon_recharge_member_account(%s,%s,%s,%s,%L,500,500,0,0,%L,%L,%L)',a,org,st,account,'fin-recharge','cash','','合成充值'));
 perform pg_temp.conflict(format('select public.salon_recharge_member_account(%s,%s,%s,%s,%L,500,500,0,0,%L,%L,%L)',b,org,st,account,'fin-recharge','cash','','合成充值'));
 perform pg_temp.conflict(format('select public.salon_recharge_member_account(%s,%s,%s,%s,%L,600,600,0,0,%L,%L,%L)',a,org,st,account,'fin-recharge','cash','','合成充值'));
 perform pg_temp.repeat_once(format('select public.salon_set_member_status(%s,%s,%s,%s,%L,%L,%L)',a,org,st,account,'fin-freeze','frozen','合成冻结'));
 perform pg_temp.conflict(format('select public.salon_set_member_status(%s,%s,%s,%s,%L,%L,%L)',a,org,st,account,'fin-freeze','frozen','改写原因'));
 perform public.salon_set_member_status(a,org,st,account,'fin-restore','active','合成恢复');
 insert into public.salon_orders(organization_id,store_id,order_no,customer_id,status,subtotal,payable_total) values(org,st,'FIN-ORDER',c,'awaiting_payment',100,100) returning id into ord;
 insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,staff_id,quantity,unit_price,line_total,item_code,item_name,item_type) values(org,ord,item,a,1,100,100,'FIN-ITEM','合成商品','product');
 perform pg_temp.repeat_once(format('select public.salon_checkout_order(%s,%s,%s,%s,%L,%L)',a,org,st,ord,'fin-checkout',jsonb_build_array(jsonb_build_object('method','member_value','amount',100,'accountId',account))::text));
 perform pg_temp.conflict(format('select public.salon_checkout_order(%s,%s,%s,%s,%L,%L)',b,org,st,ord,'fin-checkout',jsonb_build_array(jsonb_build_object('method','member_value','amount',100,'accountId',account))::text));
 perform pg_temp.conflict(format('select public.salon_checkout_order(%s,%s,%s,%s,%L,%L)',a,org,st,ord,'fin-checkout','[{"method":"cash","amount":100}]'));
 if (select cash_balance from public.salon_member_accounts where id=account)<>400 or (select quantity from public.salon_inventory_balances where store_id=st and catalog_item_id=item)<>7 or (select count(*) from public.salon_payments where order_id=ord)<>1 then raise exception 'checkout balance/stock duplicated';end if;
 r:=pg_temp.repeat_once(format('select public.salon_submit_refund_request(%s,%s,%s,%s,%L,%L,%L)',a,org,st,ord,'fin-refund-request','full','合成全退'));refund:=(r->>'refundRequestId')::bigint;
 perform pg_temp.conflict(format('select public.salon_submit_refund_request(%s,%s,%s,%s,%L,%L,%L)',b,org,st,ord,'fin-refund-request','full','合成全退'));
 perform pg_temp.repeat_once(format('select public.salon_review_refund_request(%s,%s,%s,%s,%L,%L,%L)',b,org,st,refund,'fin-refund-review','approved','合成核对'));
 perform pg_temp.conflict(format('select public.salon_review_refund_request(%s,%s,%s,%s,%L,%L,%L)',b,org,st,refund,'fin-refund-review','approved','改写意见'));
 perform pg_temp.repeat_once(format('select public.salon_execute_refund_request(%s,%s,%s,%s,%L)',a,org,st,refund,'fin-refund-execute'));
 perform pg_temp.conflict(format('select public.salon_execute_refund_request(%s,%s,%s,%s,%L)',b,org,st,refund,'fin-refund-execute'));
 if (select cash_balance from public.salon_member_accounts where id=account)<>500 or (select quantity from public.salon_inventory_balances where store_id=st and catalog_item_id=item)<>8 or (select refunded_total from public.salon_orders where id=ord)<>100 then raise exception 'refund balance/stock duplicated';end if;
 perform pg_temp.repeat_once(format('select public.salon_add_finance_entry(%s,%s,%s,%L,current_date,%L,%L,50,%L)',a,org,st,'fin-expense','expense','合成费用','合成凭据'));
 perform pg_temp.conflict(format('select public.salon_add_finance_entry(%s,%s,%s,%L,current_date,%L,%L,50,%L)',b,org,st,'fin-expense','expense','合成费用','合成凭据'));
 r:=pg_temp.repeat_once(format('select public.salon_generate_payroll(%s,%s,%s,%s,%L,%L,10,0,%L)',a,org,st,a,'fin-payroll','2026-09-01','合成奖金'));payroll:=(r->>'payrollId')::bigint;
 perform pg_temp.conflict(format('select public.salon_generate_payroll(%s,%s,%s,%s,%L,%L,20,0,%L)',a,org,st,a,'fin-payroll','2026-09-01','合成奖金'));
 perform pg_temp.repeat_once(format('select public.salon_review_payroll(%s,%s,%s,%s,%L,%L,%L)',b,org,st,payroll,'fin-payroll-review','approved','合成核对'));
 perform pg_temp.conflict(format('select public.salon_review_payroll(%s,%s,%s,%s,%L,%L,%L)',b,org,st,payroll,'fin-payroll-review','approved','篡改意见'));
 -- An inventory failure must not leave an operation record or change stock.
 blocked:=false;begin perform public.salon_move_inventory(a,org,st,item,'fin-rollback-stock','consume',999,null,'合成超库存');exception when others then blocked:=sqlerrm like '%库存不足%';end;
 if not blocked or exists(select 1 from public.salon_operation_requests where organization_id=org and request_key='fin-rollback-stock') or (select quantity from public.salon_inventory_balances where store_id=st and catalog_item_id=item)<>8 then raise exception 'inventory failure not atomic';end if;
end$$;
reset role;
select 'financial replay: 12 operations, actor/payload conflicts, balances and inventory verified' as result;
