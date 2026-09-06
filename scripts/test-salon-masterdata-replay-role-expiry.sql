\set ON_ERROR_STOP on
set role service_role;
create function pg_temp.repeat_once(p_sql text) returns jsonb language plpgsql as $$
declare a jsonb;b jsonb;n bigint;begin
 execute p_sql into a;select count(*) into n from public.salon_audit_events;execute p_sql into b;
 if a is distinct from b or (select count(*) from public.salon_audit_events)<>n then raise exception 'duplicate write: %',p_sql;end if;return a;
end$$;
create function pg_temp.reject_call(p_sql text,p_message text) returns void language plpgsql as $$
declare blocked boolean:=false;begin
 begin execute p_sql;exception when others then if position(p_message in sqlerrm)>0 then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'expected rejection: %',p_sql;end if;
end$$;
do $$declare org bigint;st bigint;other bigint;global_role bigint;local_role bigint;self_role bigint;root_staff bigint;manager bigint;self_staff bigint;employee bigint;unassigned bigint;unused bigint;customer bigint;item bigint;ord bigint;r jsonb;begin
 insert into public.salon_organizations(name) values('合成主数据权限测试') returning id into org;
 insert into public.salon_stores(organization_id,code,name) values(org,'MASTER-A','合成甲店') returning id into st;
 insert into public.salon_stores(organization_id,code,name) values(org,'MASTER-B','合成乙店') returning id into other;
 insert into public.salon_roles(organization_id,name,data_scope) values(org,'合成组织管理员','organization') returning id into global_role;
 insert into public.salon_roles(organization_id,name,data_scope) values(org,'合成本店管理员','store') returning id into local_role;
 insert into public.salon_roles(organization_id,name,data_scope) values(org,'合成本人','self') returning id into self_role;
 insert into public.salon_role_permissions select global_role,resource,action from public.salon_permission_catalog;
 insert into public.salon_role_permissions select local_role,resource,action from public.salon_permission_catalog;
 insert into public.salon_role_permissions values(self_role,'payroll','read');
 insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(org,st,global_role,'MASTER-ROOT','合成组织管理员') returning id into root_staff;
 insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(org,st,local_role,'MASTER-MGR','合成店长') returning id into manager;
 insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id) values(org,root_staff,st,global_role),(org,manager,st,local_role);
 -- An expired organization assignment must not elevate an otherwise active store manager.
 insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,effective_from,effective_to) values(org,manager,other,global_role,current_date-5,current_date-1);
 perform pg_temp.reject_call(format('select public.salon_create_role(%s,%s,%s,%L,%L,%L,%L)',manager,org,st,'master-expired-role','非法组织角色','organization','["audit/read"]'),'只有组织级管理员');
 perform pg_temp.reject_call(format('select public.salon_create_staff(%s,%s,%s,%L,%L,%L,%s)',manager,org,st,'master-escalate-staff','ILLEGAL','非法组织员工',global_role),'只有组织级管理员');
 if exists(select 1 from public.salon_staff where organization_id=org and staff_no='ILLEGAL') then raise exception 'unauthorized staff persisted';end if;
 r:=pg_temp.repeat_once(format('select public.salon_create_customer(%s,%s,%s,%L,%L)',root_staff,org,st,'master-customer','合成顾客'));customer:=(r->>'customerId')::bigint;
 perform pg_temp.reject_call(format('select public.salon_create_customer(%s,%s,%s,%L,%L)',manager,org,st,'master-customer','合成顾客'),'幂等键已被其他业务使用');
 perform pg_temp.repeat_once(format('select public.salon_set_customer_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,customer,'master-freeze','frozen','合成冻结'));
 perform pg_temp.reject_call(format('select public.salon_set_customer_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,customer,'master-freeze','frozen','修改原因'),'幂等键已被其他业务使用');
 perform public.salon_set_customer_status(root_staff,org,st,customer,'master-restore','active','合成恢复');
 perform pg_temp.repeat_once(format('select public.salon_update_customer_relation(%s,%s,%s,%s,%L,%s,%L)',root_staff,org,st,customer,'master-relation',root_staff,'walkin'));
 r:=pg_temp.repeat_once(format('select public.salon_create_catalog_item(%s,%s,%s,%L,%L,%L,%L,%L,100)',root_staff,org,st,'master-catalog','MASTER-PRODUCT','product','合成商品','合成分类'));item:=(r->>'catalogItemId')::bigint;
 perform pg_temp.repeat_once(format('select public.salon_enable_catalog_item(%s,%s,%s,%s,%L,true,2)',root_staff,org,other,item,'master-enable'));
 perform pg_temp.reject_call(format('select public.salon_enable_catalog_item(%s,%s,%s,%s,%L,true,3)',root_staff,org,other,item,'master-enable'),'幂等键已被其他业务使用');
 perform pg_temp.repeat_once(format('select public.salon_set_catalog_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,other,item,'master-disable','disabled','合成停售'));
 r:=pg_temp.repeat_once(format('select public.salon_create_order(%s,%s,%s,%L,%s,null,%L)',root_staff,org,st,'master-order',customer,'合成订单'));ord:=(r->>'orderId')::bigint;
 perform pg_temp.repeat_once(format('select public.salon_replace_order_lines(%s,%s,%s,%s,%L,%L)',root_staff,org,st,ord,'master-lines',jsonb_build_array(jsonb_build_object('catalogItemId',item,'quantity',1,'unitPrice',100,'staffId',root_staff))::text));
 perform pg_temp.repeat_once(format('select public.salon_set_order_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,ord,'master-open','opened','合成开单'));
 perform pg_temp.reject_call(format('select public.salon_set_order_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,ord,'master-open','opened','修改说明'),'幂等键已被其他业务使用');
 r:=pg_temp.repeat_once(format('select public.salon_create_staff(%s,%s,%s,%L,%L,%L,%s)',root_staff,org,st,'master-staff','MASTER-EMP','合成员工',local_role));employee:=(r->>'staffId')::bigint;
 if (select count(*) from public.salon_staff_store_roles where staff_id=employee and status='active')<>1 or public.salon_resolve_staff_store(employee,org,st)<>st then raise exception 'initial role assignment missing/duplicated';end if;
 perform pg_temp.repeat_once(format('select public.salon_set_staff_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,employee,'master-leave','leave','合成休假'));
 perform public.salon_set_staff_status(root_staff,org,st,employee,'master-return','active','合成返岗');
 perform pg_temp.repeat_once(format('select public.salon_create_commission_rule(%s,%s,%s,%L,%L,%L,40,current_date,null)',root_staff,org,st,'master-rule','service','合成提成'));
 perform pg_temp.reject_call(format('select public.salon_create_commission_rule(%s,%s,%s,%L,%L,%L,41,current_date,null)',root_staff,org,st,'master-rule','service','合成提成'),'幂等键已被其他业务使用');
 r:=pg_temp.repeat_once(format('select public.salon_create_role(%s,%s,%s,%L,%L,%L,%L)',root_staff,org,st,'master-role','合成临时角色','store','["audit/read"]'));unused:=(r->>'roleId')::bigint;
 perform pg_temp.repeat_once(format('select public.salon_set_role_status(%s,%s,%s,%s,%L,%L,%L)',root_staff,org,st,unused,'master-role-disable','disabled','合成停用'));
 r:=public.salon_create_staff(root_staff,org,st,'master-no-role','MASTER-NONE','合成未分配员工',null);unassigned:=(r->>'staffId')::bigint;
 perform pg_temp.repeat_once(format('select public.salon_assign_staff_store_role(%s,%s,%s,%s,%s,%L,%L)',root_staff,org,st,unassigned,local_role,'master-assignment','合成授权'));
 perform pg_temp.reject_call(format('select public.salon_assign_staff_store_role(%s,%s,%s,%s,%s,%L,%L)',root_staff,org,st,unassigned,local_role,'master-assignment','篡改理由'),'幂等键已被其他业务使用');
 perform pg_temp.repeat_once(format('select public.salon_transfer_staff(%s,%s,%s,%s,%s,%s,%L,current_date,%L)',root_staff,org,st,employee,other,local_role,'master-transfer','合成调店'));
 if (select store_id from public.salon_staff where id=employee)<>other then raise exception 'transfer';end if;
 perform pg_temp.reject_call(format('select public.salon_transfer_staff(%s,%s,%s,%s,%s,%s,%L,current_date,%L)',manager,org,other,employee,st,local_role,'master-transfer-no-source','只有目标门店权限'),'没有该门店操作权限');
 r:=public.salon_create_staff(root_staff,org,st,'master-self','MASTER-SELF','合成本人查询',self_role);self_staff:=(r->>'staffId')::bigint;
 insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,effective_from,effective_to) values(org,self_staff,other,global_role,current_date-5,current_date-1);
 perform public.salon_generate_payroll(root_staff,org,st,self_staff,'master-payroll-self','2026-09-01',0,0,'');
 perform public.salon_generate_payroll(root_staff,org,st,manager,'master-payroll-other','2026-09-01',0,0,'');
 if (select count(*) from public.salon_list_payroll(self_staff,org,st,'2026-09-01'))<>1 then raise exception 'expired role leaked payroll';end if;
 update public.salon_staff_store_roles set effective_from=current_date+1,effective_to=null where staff_id=self_staff and store_id=other;
 if (select count(*) from public.salon_list_payroll(self_staff,org,st,'2026-09-01'))<>1 then raise exception 'future role leaked payroll';end if;
 update public.salon_staff_store_roles set effective_from=current_date+1,effective_to=null where staff_id=manager and store_id=other;
 perform pg_temp.reject_call(format('select public.salon_create_role(%s,%s,%s,%L,%L,%L,%L)',manager,org,st,'master-future-role','非法未来角色','organization','["audit/read"]'),'只有组织级管理员');
 update public.salon_organizations set status='disabled' where id=org;
 perform pg_temp.reject_call(format('select public.salon_list_staff_stores(%s,%s)',root_staff,org),'已停用');
 update public.salon_organizations set status='active' where id=org;
end$$;
reset role;
select 'master-data replay, initial staff assignment, expired/future role isolation passed' as result;
