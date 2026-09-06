-- Synthetic fixture: run after test-salon-engagement.sql and customer-request-ownership.sql.
\set ON_ERROR_STOP on
set role service_role;
create function pg_temp.reject_call(p_sql text,p_message text) returns void language plpgsql as $$
declare blocked boolean:=false;begin
 begin execute p_sql;exception when others then
  if position(p_message in sqlerrm)>0 then blocked:=true;else raise;end if;
 end;
 if not blocked then raise exception 'expected rejection: %',p_sql;end if;
end$$;
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name)
values(1,1,2,'TEST-MANAGER-2','合成店长二');
insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id) values(1,4,1,2);
do $$declare n bigint;v jsonb;begin
 select count(*) into n from public.salon_audit_events;
 v:=public.salon_review_work(2,1,1,1,'work-review-00001','published','授权和内容核对通过');
 if v->>'status'<>'published' or (select count(*) from public.salon_audit_events)<>n then raise exception 'review replay wrote twice';end if;
 v:=public.salon_review_customer_booking(2,1,1,1,'booking-review-001','confirmed',1,'档期确认');
 if v->>'status'<>'confirmed' or (select count(*) from public.salon_appointments)<>1 then raise exception 'booking review replay duplicated';end if;
end$$;
select pg_temp.reject_call($q$select public.salon_review_work(2,1,1,1,'work-review-00001','rejected','授权和内容核对通过')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_review_work(4,1,1,1,'work-review-00001','published','授权和内容核对通过')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_review_customer_booking(2,1,1,1,'booking-review-001','rejected',1,'档期确认')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_moderate_review(2,1,1,1,'review-hide-00001','published','顾客申请隐藏')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_create_campaign(2,1,1,'campaign-create-01','新客关怀','in_app','{"tag":"改变人群"}','改变文案',current_date,current_date+7)$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_set_campaign_status(2,1,1,1,'campaign-active-02','paused','授权范围核对通过')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_bind_customer_identity(2,1,1,1,'11111111-1111-4111-8111-111111111111','customer-bind-0001','篡改原因')$q$,'幂等键已被其他业务使用');
select pg_temp.reject_call($q$select public.salon_create_work(1,1,1,'work-create-00002',1,1,null,'无授权作品','篡改描述','private/works/b.jpg')$q$,'幂等键已被其他业务使用');
update public.salon_staff_store_roles set status='ended' where staff_id=2;
select pg_temp.reject_call($q$select public.salon_review_work(2,1,1,1,'work-review-00001','published','授权和内容核对通过')$q$,'没有该门店操作权限');
update public.salon_staff_store_roles set status='active' where staff_id=2;
select pg_temp.reject_call($q$select public.salon_set_campaign_status(2,1,1,1,'staff-failed-001','draft','非法回退')$q$,'状态变更无效');
do $$begin
 if exists(select 1 from public.salon_operation_requests where request_key='staff-failed-001') then raise exception 'failed staff operation persisted';end if;
 if exists(select 1 from public.salon_operation_requests where staff_request_actor_id is not null and octet_length(staff_payload_digest)<>32) then raise exception 'staff digest missing';end if;
end$$;
-- Public browsing is allowed across active stores within the customer's organization;
-- private bookings stay scoped to the current customer and selected store.
do $$declare a uuid:='11111111-1111-4111-8111-111111111111';begin
 if jsonb_array_length(public.salon_customer_get_context(a))<>1 then raise exception 'context';end if;
 if (select count(*) from public.salon_customer_list_bookings(a,1,1,100))<>1 then raise exception 'own bookings';end if;
 if (select count(*) from public.salon_customer_list_bookings('22222222-2222-4222-8222-222222222222',1,1,100))<>0 then raise exception 'another customer bookings exposed';end if;
 perform public.salon_customer_list_booking_options(a,1,2);
end$$;
update public.salon_customers set status='frozen' where id=1;
select pg_temp.reject_call($q$select public.salon_customer_list_bookings('11111111-1111-4111-8111-111111111111',1,1,100)$q$,'已停用');
select pg_temp.reject_call($q$select public.salon_customer_list_public_works('11111111-1111-4111-8111-111111111111',1,1,100)$q$,'已停用');
select pg_temp.reject_call($q$select public.salon_customer_list_booking_options('11111111-1111-4111-8111-111111111111',1,1)$q$,'已停用');
select pg_temp.reject_call($q$select public.salon_customer_get_context('11111111-1111-4111-8111-111111111111')$q$,'已停用');
update public.salon_customers set status='active' where id=1;
update public.salon_organizations set status='disabled' where id=1;
select pg_temp.reject_call($q$select public.salon_customer_get_context('11111111-1111-4111-8111-111111111111')$q$,'已停用');
select pg_temp.reject_call($q$select public.salon_customer_list_bookings('11111111-1111-4111-8111-111111111111',1,1,100)$q$,'已停用');
update public.salon_organizations set status='active' where id=1;
update public.salon_stores set status='disabled' where id=1;
select pg_temp.reject_call($q$select public.salon_customer_list_public_works('11111111-1111-4111-8111-111111111111',1,1,100)$q$,'门店不可用');
update public.salon_stores set status='active' where id=1;
set role authenticated;
select pg_temp.reject_call($q$select public.salon_review_work(2,1,1,1,'work-review-00001','published','授权和内容核对通过')$q$,'permission denied');
select pg_temp.reject_call($q$select public.salon_customer_get_context('11111111-1111-4111-8111-111111111111')$q$,'permission denied');
reset role;
select 'staff replay and customer reads passed' as result;
