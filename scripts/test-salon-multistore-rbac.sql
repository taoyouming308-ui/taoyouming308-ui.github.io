\set ON_ERROR_STOP on
set role service_role;
insert into public.salon_organizations(name) values('多门店权限测试机构');
insert into public.salon_stores(organization_id,code,name) values(1,'A','甲店'),(1,'B','乙店');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'组织管理员','organization'),(1,'门店管理员','store'),(1,'员工本人','self');
insert into public.salon_role_permissions(role_id,resource,action) values(1,'settings','role_write'),(1,'settings','assignment_write'),(1,'audit','read'),(1,'payroll','read'),(2,'settings','role_write'),(2,'settings','assignment_write'),(2,'audit','read'),(2,'payroll','read'),(3,'payroll','read');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'OA','组织管理员'),(1,1,2,'MA','甲店管理员'),(1,1,3,'S1','甲店员工'),(1,2,2,'MB','乙店管理员');
insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,reason) values(1,1,1,1,'组织授权'),(1,2,1,2,'甲店授权'),(1,3,1,3,'本人授权'),(1,4,2,2,'乙店授权');
insert into public.salon_payroll_runs(organization_id,store_id,staff_id,payroll_month,status,base_salary,gross_performance,refund_performance,net_performance,commission_total,bonus,deduction,payable_total,generated_by_staff_id) values(1,1,2,'2026-09-01','draft',3000,100,0,100,40,0,0,3040,1),(1,1,3,'2026-09-01','draft',3000,200,0,200,80,0,0,3080,1);
do $$declare store_role jsonb;org_role jsonb;unused_role jsonb;transfer jsonb;blocked boolean;begin
 if public.salon_resolve_staff_store(1,1,2)<>2 or (select count(*) from public.salon_list_staff_stores(1,1))<>2 then raise exception 'organization store scope failed';end if;
 blocked:=false;begin perform public.salon_resolve_staff_store(2,1,2);exception when others then blocked:=sqlerrm like '%不能进入该门店%';end;if not blocked or (select count(*) from public.salon_list_staff_stores(2,1))<>1 then raise exception 'store scope failed';end if;
 if (select count(*) from public.salon_list_payroll(3,1,1,'2026-09-01'))<>1 or (select staff_id from public.salon_list_payroll(3,1,1,'2026-09-01'))<>3 then raise exception 'self payroll scope failed';end if;
 store_role:=public.salon_create_role(2,1,1,'role-store-create01','甲店收银','store','["orders/checkout"]');
 blocked:=false;begin perform public.salon_create_role(2,1,1,'role-org-escalate1','非法区域经理','organization','["reports/read"]');exception when others then blocked:=sqlerrm like '%只有组织级管理员%';end;if not blocked then raise exception 'store admin created organization role';end if;
 org_role:=public.salon_create_role(1,1,2,'role-org-create001','区域审计','organization','["audit/read"]');
 blocked:=false;begin perform public.salon_assign_staff_store_role(2,1,1,3,(org_role->>'roleId')::bigint,'assign-org-escalate','越权');exception when others then blocked:=sqlerrm like '%只有组织级管理员%';end;if not blocked then raise exception 'store admin assigned organization role';end if;
 perform public.salon_assign_staff_store_role(1,1,2,2,(store_role->>'roleId')::bigint,'assign-second-store','跨店支援');if public.salon_resolve_staff_store(2,1,2)<>2 then raise exception 'multi-store assignment failed';end if;
 blocked:=false;begin perform public.salon_transfer_staff(2,1,1,3,2,2,'transfer-denied-01',current_date,'跨店');exception when others then blocked:=sqlerrm like '%没有该门店操作权限%';end;if not blocked then raise exception 'store admin transferred across stores';end if;
 transfer:=public.salon_transfer_staff(1,1,1,3,2,3,'transfer-approved01',current_date,'正式调店');if (transfer->>'storeId')::bigint<>2 or (select store_id from public.salon_staff where id=3)<>2 or not exists(select 1 from public.salon_staff_store_roles where staff_id=3 and store_id=1 and status='ended') then raise exception 'transfer/history failed';end if;
 unused_role:=public.salon_create_role(2,1,1,'role-unused-create','临时角色','store','["audit/read"]');perform public.salon_set_role_status(2,1,1,(unused_role->>'roleId')::bigint,'role-unused-disable','disabled','停止使用');
 blocked:=false;begin perform public.salon_set_role_status(2,1,1,2,'role-active-disable','disabled','尝试停用');exception when others then blocked:=sqlerrm like '%仍有在用员工%';end;if not blocked then raise exception 'active role disabled';end if;
 if not exists(select 1 from public.salon_list_audit_events(1,1,2,'staff',100) where action='transfer') then raise exception 'transfer audit missing';end if;
end$$;
reset role;
