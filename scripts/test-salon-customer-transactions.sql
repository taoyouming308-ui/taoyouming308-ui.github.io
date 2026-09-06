\set ON_ERROR_STOP on
set role service_role;

insert into public.salon_organizations(name) values('顾客事务测试机构');
insert into public.salon_stores(organization_id,code,name) values(1,'A','甲店'),(1,'B','乙店');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'顾客管理员','store');
insert into public.salon_role_permissions(role_id,resource,action) values(1,'customers','read'),(1,'customers','write');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'A01','甲员工'),(1,2,1,'B01','乙员工');

do $$
declare first_result jsonb;retry_result jsonb;v_customer_id bigint;blocked boolean;
begin
  first_result:=public.salon_create_customer(1,1,1,'customer-create-0001',' 测试顾客 ','138 0000 0000',null,1,'walkin',array['新客','新客']);
  retry_result:=public.salon_create_customer(1,1,1,'customer-create-0001','测试顾客','13800000000',null,1,'walkin',array['新客']);
  if first_result<>retry_result or (select count(*) from public.salon_customers)<>1 then raise exception 'create idempotency failed';end if;
  v_customer_id:=(first_result->>'customerId')::bigint;
  if (select c.phone_normalized from public.salon_customers c where c.id=v_customer_id)<>'13800000000' then raise exception 'phone normalization failed';end if;
  if (select count(*) from public.salon_customer_store_relations r where r.store_id=1 and r.customer_id=v_customer_id)<>1 or (select count(*) from public.salon_customer_store_relations r where r.store_id=2 and r.customer_id=v_customer_id)<>0 then raise exception 'store relation isolation failed';end if;
  blocked:=false;begin perform public.salon_create_customer(1,1,1,'customer-create-0002','重复号码','13800000000');exception when others then blocked:=sqlerrm like '%手机号已存在%';end;
  if not blocked or (select count(*) from public.salon_operation_requests where request_key='customer-create-0002')<>0 then raise exception 'duplicate phone rollback failed';end if;
  blocked:=false;begin perform public.salon_set_customer_status(2,1,2,v_customer_id,'customer-cross-store','frozen','越权测试');exception when others then blocked:=sqlerrm like '%不属于当前门店%';end;
  if not blocked then raise exception 'cross-store customer write accepted';end if;
  perform public.salon_set_customer_status(1,1,1,v_customer_id,'customer-freeze-01','frozen','顾客申请');
  perform public.salon_set_customer_status(1,1,1,v_customer_id,'customer-restore-1','active','顾客恢复');
  if (select c.status from public.salon_customers c where c.id=v_customer_id)<>'active' or (select count(*) from public.salon_audit_events e where e.entity_type='customer' and e.entity_id=v_customer_id::text and e.action='status_change')<>2 then raise exception 'status or audit failed';end if;
  blocked:=false;begin perform public.salon_update_customer_relation(1,1,1,v_customer_id,'customer-owner-bad',2,'referral',array['重点']);exception when others then blocked:=sqlerrm like '%负责人不是当前门店%';end;
  if not blocked then raise exception 'cross-store owner accepted';end if;
  perform public.salon_update_customer_relation(1,1,1,v_customer_id,'customer-relation-01',1,'referral',array['重点','染发']);
  if (select x.phone_masked from public.salon_list_customers(1,1,1,'13800000000','active',100) x where x.customer_id=v_customer_id)<>'138****0000' then raise exception 'masked customer read failed';end if;
  if exists(select 1 from public.salon_list_customers(2,1,2,'','',100) x where x.customer_id=v_customer_id) then raise exception 'cross-store read leak';end if;
end $$;

reset role;

do $$ begin
  if has_table_privilege('anon','public.salon_customers','select') or has_table_privilege('authenticated','public.salon_customers','select') then raise exception 'browser role can read customer table';end if;
  if has_function_privilege('authenticated','public.salon_list_customers(bigint,bigint,bigint,text,text,integer)','execute') then raise exception 'authenticated can execute customer list';end if;
  if not has_function_privilege('service_role','public.salon_list_customers(bigint,bigint,bigint,text,text,integer)','execute') then raise exception 'service role cannot execute customer list';end if;
end $$;
