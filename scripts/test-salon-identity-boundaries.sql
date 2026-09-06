\set ON_ERROR_STOP on
begin;
insert into public.salon_organizations(name) values('合成权限测试');
insert into public.salon_stores(organization_id,code,name) values(1,'A','模拟甲店'),(1,'B','模拟乙店');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'只读','store'),(1,'无读权限','store');
insert into public.salon_role_permissions values(1,'orders','read'),(1,'inventory','read');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name,employment_status)
values(1,1,1,'T1','模拟员工一','active'),(1,1,2,'T2','模拟员工二','active');
insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id)
values(1,1,1,1),(1,2,1,2);
insert into public.salon_orders(organization_id,store_id,order_no,status) values(1,1,'TEST-ONLY','draft');
create function pg_temp.denied(p_sql text,p_message text) returns void language plpgsql as $$
declare blocked boolean:=false;
begin
 begin execute p_sql;exception when others then
  if position(p_message in sqlerrm)>0 then blocked:=true;else raise;end if;
 end;
 if not blocked then raise exception 'expected denial: %',p_sql;end if;
end$$;
set local role service_role;
do $$begin
 if public.salon_resolve_staff_store(1,1,1)<>1 then raise exception 'store resolution';end if;
 if (public.salon_get_order_receipt(1,1,1,1)->'order'->>'order_no')<>'TEST-ONLY' then raise exception 'receipt shape';end if;
 perform * from public.salon_list_inventory_balances(1,1,1,null);
end$$;
select pg_temp.denied('select public.salon_get_order_receipt(2,1,1,1)','没有该门店操作权限');
select pg_temp.denied('select public.salon_list_inventory_balances(2,1,1,null)','没有该门店操作权限');
select pg_temp.denied('select public.salon_get_order_receipt(1,1,2,1)','没有该门店操作权限');
select pg_temp.denied('select public.salon_resolve_staff_store(1,1,2)','不能进入该门店');
update public.salon_staff_store_roles set effective_from=current_date-2,effective_to=current_date-1 where staff_id=1;
select pg_temp.denied('select public.salon_get_order_receipt(1,1,1,1)','没有该门店操作权限');
update public.salon_staff_store_roles set effective_to=null where staff_id=1;
update public.salon_stores set status='disabled' where id=1;
select pg_temp.denied('select public.salon_resolve_staff_store(1,1,1)','不能进入该门店');
update public.salon_stores set status='active' where id=1;
update public.salon_organizations set status='disabled' where id=1;
select pg_temp.denied('select public.salon_get_order_receipt(1,1,1,1)','没有该门店操作权限');
update public.salon_organizations set status='active' where id=1;
update public.salon_staff set employment_status='departed' where id=1;
select pg_temp.denied('select public.salon_resolve_staff_store(1,1,1)','不能进入该门店');
set local role authenticated;
select pg_temp.denied('select public.salon_get_order_receipt(1,1,1,1)','permission denied');
select pg_temp.denied('select * from public.salon_inventory_balances','permission denied');
set local role anon;
select pg_temp.denied('select public.salon_list_inventory_balances(1,1,1,null)','permission denied');
rollback;
