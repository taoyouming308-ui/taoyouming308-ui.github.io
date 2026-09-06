\set ON_ERROR_STOP on
set role service_role;
insert into public.salon_organizations(name) values('员工工资测试机构');
insert into public.salon_stores(organization_id,code,name,timezone) values(1,'A','甲店','Asia/Shanghai'),(1,'B','乙店','Asia/Shanghai');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'店长','store'),(1,'发型师','self');
insert into public.salon_role_permissions(role_id,resource,action) values(1,'staff','write'),(1,'commission','write'),(1,'payroll','generate'),(1,'payroll','approve'),(1,'payroll','read');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name,position,base_salary) values(1,1,1,'M01','生成店长','店长',5000),(1,1,1,'M02','审批店长','店长',5000),(1,1,2,'S01','发型师甲','发型师',3000),(1,2,1,'B01','乙店店长','店长',5000);
insert into public.salon_catalog_items(organization_id,item_type,code,name,category,list_price) values(1,'service','SVC1','剪发','服务',100);
do $$declare rule_result jsonb;staff_result jsonb;blocked boolean;begin
 rule_result:=public.salon_create_commission_rule(1,1,1,'commission-rule-0001','service','服务提成40%',40,'2026-09-01',null);if (rule_result->>'status')<>'active' then raise exception 'rule create failed';end if;
 blocked:=false;begin perform public.salon_create_commission_rule(1,1,1,'commission-rule-over1','service','重叠规则',50,'2026-09-15',null);exception when others then blocked:=sqlerrm like '%已有提成规则%';end;if not blocked then raise exception 'overlapping rule accepted';end if;
 staff_result:=public.salon_create_staff(1,1,1,'staff-create-test01','A02','新员工',2,'助理','初级',2500);if (staff_result->>'status')<>'active' then raise exception 'staff create failed';end if;perform public.salon_set_staff_status(1,1,1,(staff_result->>'staffId')::bigint,'staff-leave-test01','leave','休假');
end$$;
insert into public.salon_orders(organization_id,store_id,order_no,status,subtotal,payable_total) values(1,1,'O1','awaiting_payment',100,100);
insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,staff_id,quantity,unit_price,line_total,item_code,item_name,item_type) values(1,1,1,3,1,100,100,'SVC1','剪发','service');
update public.salon_orders set status='paid',paid_at='2026-09-05 02:00:00+00' where id=1;
insert into public.salon_refund_requests(organization_id,store_id,order_id,refund_type,status,requested_amount,reason,created_by_staff_id,reviewed_by_staff_id,reviewed_at) values(1,1,1,'partial','approved',25,'部分退款',1,2,'2026-09-06 01:00:00+00');
insert into public.salon_refund_request_lines values(1,1,1,1,25,'SVC1','剪发','service');
update public.salon_refund_requests set status='executed',executed_at='2026-09-06 02:00:00+00' where id=1;
do $$declare generated jsonb;retry jsonb;approved jsonb;payroll_id bigint;blocked boolean;begin
 if (select count(*) from public.salon_performance_ledger)<>2 or (select gross_amount from public.salon_performance_ledger where entry_type='sale')<>100 or (select commission_amount from public.salon_performance_ledger where entry_type='sale')<>40 or (select gross_amount from public.salon_performance_ledger where entry_type='refund')<>-25 or (select commission_amount from public.salon_performance_ledger where entry_type='refund')<>-10 then raise exception 'automatic performance/reversal failed';end if;
 generated:=public.salon_generate_payroll(1,1,1,3,'payroll-generate-001','2026-09-01',200,100,'月度调整');retry:=public.salon_generate_payroll(1,1,1,3,'payroll-generate-001','2026-09-01',200,100,'月度调整');payroll_id:=(generated->>'payrollId')::bigint;
 if generated<>retry or (generated->>'commissionTotal')::numeric<>30 or (generated->>'payableTotal')::numeric<>3130 or (select gross_performance from public.salon_payroll_runs where id=payroll_id)<>100 or (select refund_performance from public.salon_payroll_runs where id=payroll_id)<>25 then raise exception 'payroll totals/idempotency failed';end if;
 blocked:=false;begin perform public.salon_review_payroll(1,1,1,payroll_id,'payroll-self-review1','approved','自己审批');exception when others then blocked:=sqlerrm like '%不能为同一人%';end;if not blocked then raise exception 'self approval accepted';end if;
 approved:=public.salon_review_payroll(2,1,1,payroll_id,'payroll-review-0001','approved','核对通过');if (approved->>'status')<>'approved' or (select reviewed_by_staff_id from public.salon_payroll_runs where id=payroll_id)<>2 then raise exception 'payroll approval failed';end if;
 blocked:=false;begin perform public.salon_generate_payroll(1,1,1,3,'payroll-generate-new','2026-09-01',0,0,'');exception when others then blocked:=sqlerrm like '%已经生成%';end;if not blocked then raise exception 'duplicate payroll accepted';end if;
 if (select count(*) from public.salon_list_payroll(4,1,2,'2026-09-01'))<>0 then raise exception 'cross-store payroll leak';end if;
end$$;
reset role;
