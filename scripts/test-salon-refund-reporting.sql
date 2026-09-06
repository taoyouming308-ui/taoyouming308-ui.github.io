\set ON_ERROR_STOP on
set role service_role;
insert into public.salon_organizations(name) values('退款报表测试机构');
insert into public.salon_stores(organization_id,code,name,timezone) values(1,'A','甲店','Asia/Shanghai'),(1,'B','乙店','Asia/Shanghai');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'财务','store');
insert into public.salon_role_permissions(role_id,resource,action) values(1,'reports','read'),(1,'finance','write');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'A01','甲员工'),(1,2,1,'B01','乙员工');
insert into public.salon_catalog_items(organization_id,item_type,code,name,category,list_price) values(1,'service','S1','服务','服务',100);
insert into public.salon_orders(organization_id,store_id,order_no,status,subtotal,payable_total,refunded_total,paid_at) values(1,1,'O1','paid',100,100,50,'2026-09-05 02:00:00+00');
insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,staff_id,quantity,unit_price,line_total,item_code,item_name,item_type) values(1,1,1,1,1,100,100,'S1','服务','service');
insert into public.salon_refund_requests(organization_id,store_id,order_id,refund_type,status,requested_amount,reason,created_by_staff_id,reviewed_by_staff_id,reviewed_at,executed_at) values(1,1,1,'partial','executed',50,'部分退款',1,2,'2026-09-06 01:00:00+00','2026-09-06 02:00:00+00');
insert into public.salon_refund_request_lines values(1,1,1,1,50,'S1','服务','service');
insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,tendered_amount,status,confirmed_at) values(1,1,1,'cash',100,100,'confirmed','2026-09-05 02:00:00+00');
insert into public.salon_refund_request_payments values(1,1,1,50,0,'cash');
insert into public.salon_payments(organization_id,store_id,order_id,payment_method,amount,tendered_amount,status,reversal_of_id,refund_request_id,confirmed_at) values(1,1,1,'cash',50,0,'confirmed',1,1,'2026-09-06 02:00:00+00');
do $$ declare e jsonb;retry jsonb;r jsonb;m jsonb;other_store jsonb;blocked boolean;begin
 e:=public.salon_add_finance_entry(1,1,1,'finance-expense-001','2026-09-06','expense','耗材',10,'退款日耗材');retry:=public.salon_add_finance_entry(1,1,1,'finance-expense-001','2026-09-06','expense','耗材',10,'退款日耗材');if e<>retry or (select count(*) from public.salon_finance_entries)<>1 then raise exception 'finance idempotency failed';end if;
 perform public.salon_add_finance_entry(1,1,1,'finance-income-0001','2026-09-06','income','其他',5,'其他收入');
 r:=public.salon_get_operating_report(1,1,1,'2026-09-06','2026-09-06');
 if (r->>'grossSales')::numeric<>0 or (r->>'refundSales')::numeric<>50 or (r->>'netSales')::numeric<>-50 or (r->>'paymentNet')::numeric<>-50 or (r->'paymentMethods'->>'cash')::numeric<>-50 or (r->>'operatingNet')::numeric<>-55 or (r->>'refundCount')::integer<>1 then raise exception 'refund-day totals failed: %',r;end if;
 if (r->'staffPerformance'->0->>'staffId')::bigint<>1 or (r->'staffPerformance'->0->>'grossAmount')::numeric<>0 or (r->'staffPerformance'->0->>'refundAmount')::numeric<>50 or (r->'staffPerformance'->0->>'netAmount')::numeric<>-50 then raise exception 'staff refund attribution failed: %',r->'staffPerformance';end if;
 m:=public.salon_get_operating_report(1,1,1,'2026-09-01','2026-09-30');if (m->>'grossSales')::numeric<>100 or (m->>'refundSales')::numeric<>50 or (m->>'netSales')::numeric<>50 or (m->>'paymentNet')::numeric<>50 or (m->>'operatingNet')::numeric<>45 then raise exception 'monthly totals failed: %',m;end if;
 other_store:=public.salon_get_operating_report(2,1,2,'2026-09-01','2026-09-30');if (other_store->>'paymentNet')::numeric<>0 or jsonb_array_length(other_store->'staffPerformance')<>0 then raise exception 'cross-store report leak';end if;
 blocked:=false;begin perform public.salon_get_operating_report(1,1,1,'2025-01-01','2026-09-06');exception when others then blocked:=sqlerrm like '%日期范围无效%';end;if not blocked then raise exception 'oversized report range accepted';end if;
end $$;
reset role;
