-- Run after test-salon-engagement.sql in an isolated database only.
\set ON_ERROR_STOP on
set role service_role;
insert into public.salon_customers(organization_id,display_name,status) values(1,'合成顾客乙','active');
insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id)
values(1,2,'22222222-2222-4222-8222-222222222222');
create function pg_temp.denied(p_sql text,p_message text) returns void language plpgsql as $$
declare blocked boolean:=false;begin
 begin execute p_sql;exception when others then
  if position(p_message in sqlerrm)>0 then blocked:=true;else raise;end if;
 end;
 if not blocked then raise exception 'expected rejection: %',p_sql;end if;
end$$;
do $$declare a uuid:='11111111-1111-4111-8111-111111111111';r jsonb;b jsonb;n bigint;begin
 select count(*) into n from public.salon_reviews;
 r:=public.salon_customer_create_review(a,1,1,'review-create-0001',1,1,5,'很满意',false,20);
 if (select count(*) from public.salon_reviews)<>n or r->>'reviewId' is null then raise exception 'review duplicated';end if;
 select count(*) into n from public.salon_audit_events where action='cancel_request';
 b:=public.salon_customer_request_booking_cancel(a,1,1,1,'booking-cancel-001','行程变化');
 if b->>'status'<>'cancel_requested' or (select count(*) from public.salon_audit_events where action='cancel_request')<>n then raise exception 'cancel retry duplicated';end if;
end$$;
select pg_temp.denied($q$select public.salon_customer_create_review('22222222-2222-4222-8222-222222222222',1,1,'review-create-0001',1,1,5,'很满意',false,20)$q$,'仅订单本人');
select pg_temp.denied($q$select public.salon_customer_request_booking_cancel('22222222-2222-4222-8222-222222222222',1,1,1,'booking-cancel-001','行程变化')$q$,'预约申请不存在');
select pg_temp.denied($q$select public.salon_customer_request_booking_cancel('11111111-1111-4111-8111-111111111111',1,1,1,'booking-cancel-001','篡改原因')$q$,'幂等键已被其他业务使用');
select pg_temp.denied($q$select public.salon_customer_set_consent('22222222-2222-4222-8222-222222222222',1,1,'consent-market-001','marketing_messages',true,'{"channel":"in_app"}','customer-confirmation:marketing-1')$q$,'幂等键已被其他业务使用');
-- Rebinding the SAME customer to a different login cannot replay the old login's result.
update public.salon_customer_auth_identities set auth_user_id='33333333-3333-4333-8333-333333333333' where customer_id=1;
select pg_temp.denied($q$select public.salon_customer_request_booking_cancel('33333333-3333-4333-8333-333333333333',1,1,1,'booking-cancel-001','行程变化')$q$,'幂等键已被其他业务使用');
update public.salon_customer_auth_identities set auth_user_id='11111111-1111-4111-8111-111111111111' where customer_id=1;
update public.salon_customers set status='frozen' where id=1;
select pg_temp.denied($q$select public.salon_customer_create_review('11111111-1111-4111-8111-111111111111',1,1,'review-create-0001',1,1,5,'很满意',false,20)$q$,'已停用');
update public.salon_customers set status='active' where id=1;
update public.salon_stores set status='disabled' where id=1;
select pg_temp.denied($q$select public.salon_customer_request_booking_cancel('11111111-1111-4111-8111-111111111111',1,1,1,'booking-cancel-001','行程变化')$q$,'门店不可用');
update public.salon_stores set status='active' where id=1;
-- A failed request and its fingerprint must roll back together.
select pg_temp.denied($q$select public.salon_customer_set_consent('11111111-1111-4111-8111-111111111111',1,1,'failed-consent-001','invalid',true,'{}','test-only')$q$,'授权参数无效');
do $$begin
 if exists(select 1 from public.salon_operation_requests where request_key='failed-consent-001') then raise exception 'failed request persisted';end if;
 if exists(select 1 from public.salon_operation_requests where entity_type='customer_request_v2' and (customer_auth_user_id is null or octet_length(customer_payload_digest)<>32)) then raise exception 'identity or full digest missing';end if;
end$$;
reset role;
select 'customer request ownership regression passed' as result;
