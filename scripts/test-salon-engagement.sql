\set ON_ERROR_STOP on
set client_min_messages=warning;
insert into public.salon_organizations(name) values('互动闭环测试机构');
insert into public.salon_stores(organization_id,code,name) values(1,'A','甲店'),(1,'B','乙店');
insert into public.salon_roles(organization_id,name,data_scope) values(1,'手艺人','store'),(1,'店长','store');
insert into public.salon_role_permissions(role_id,resource,action) values
 (1,'works','read'),(1,'works','write'),
 (2,'works','read'),(2,'works','review'),(2,'reviews','read'),(2,'reviews','moderate'),(2,'marketing','read'),(2,'marketing','write'),
 (2,'customer_portal','manage'),(2,'scheduling','write'),(2,'customers','write');
insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name,position) values(1,1,1,'A01','手艺人甲','发型师'),(1,1,2,'A02','店长甲','店长'),(1,2,2,'B01','店长乙','店长');
insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,reason) values(1,1,1,1,'测试'),(1,2,1,2,'测试'),(1,3,2,2,'测试');
insert into public.salon_customers(organization_id,display_name,status) values(1,'顾客甲','active');
insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
insert into public.salon_catalog_items(organization_id,item_type,code,name,category,list_price,member_price,duration_minutes) values(1,'service','SVC-1','剪发','剪发',100,88,60);
insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id) values(1,1,1),(1,2,1);
insert into public.salon_orders(organization_id,store_id,order_no,customer_id,status,payable_total,paid_at,created_by_staff_id) values(1,1,'PAID-1',1,'paid',100,now(),2);
insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,staff_id,quantity,unit_price,line_total,item_code,item_name,item_type,service_status) values(1,1,1,1,1,100,100,'SVC-1','剪发','service','completed');

do $$declare auth_id uuid:='11111111-1111-4111-8111-111111111111';bind jsonb;consent jsonb;work jsonb;retry jsonb;review jsonb;campaign jsonb;booking jsonb;handled jsonb;blocked boolean;begin
 bind:=public.salon_bind_customer_identity(2,1,1,1,auth_id,'customer-bind-0001','顾客本人核验');
 if bind->>'status'<>'active' then raise exception 'identity bind failed';end if;
 consent:=public.salon_customer_set_consent(auth_id,1,1,'consent-work-0001','work_publication',true,'{"channel":"portfolio"}','customer-confirmation:work-1');
 blocked:=false;begin perform public.salon_customer_set_consent(auth_id,1,1,'consent-work-0001','work_publication',false,'{"channel":"portfolio"}','customer-confirmation:changed');exception when others then blocked:=sqlerrm like '%幂等键已被其他业务使用%';end;if not blocked then raise exception 'changed consent retry accepted';end if;
 work:=public.salon_create_work(1,1,1,'work-create-00001',1,1,(consent->>'consentId')::bigint,'短发层次','服务后作品','private/works/a.jpg');
 retry:=public.salon_create_work(1,1,1,'work-create-00001',1,1,(consent->>'consentId')::bigint,'短发层次','服务后作品','private/works/a.jpg');
 if work<>retry or (select count(*) from public.salon_works)<>1 then raise exception 'work idempotency failed';end if;
 perform public.salon_submit_work(1,1,1,(work->>'workId')::bigint,'work-submit-00001');perform public.salon_review_work(2,1,1,(work->>'workId')::bigint,'work-review-00001','published','授权和内容核对通过');
 if (select status from public.salon_works where id=(work->>'workId')::bigint)<>'published' then raise exception 'work publish failed';end if;
 perform public.salon_customer_set_consent(auth_id,1,1,'consent-revoke-001','work_publication',false,'{"channel":"portfolio"}','customer-confirmation:revoke-1');
 if (select status from public.salon_works where id=(work->>'workId')::bigint)<>'withdrawn' then raise exception 'revoked work remains public';end if;
 work:=public.salon_create_work(1,1,1,'work-create-00002',1,1,null,'无授权作品','','private/works/b.jpg');blocked:=false;begin perform public.salon_submit_work(1,1,1,(work->>'workId')::bigint,'work-submit-00002');exception when others then blocked:=sqlerrm like '%未取得有效顾客公开授权%';end;if not blocked then raise exception 'unconsented work submitted';end if;
 review:=public.salon_customer_create_review(auth_id,1,1,'review-create-0001',1,1,5,'很满意',false,20);
 if review->>'tipStatus'<>'pending' or (select status from public.salon_tip_intents where id=(review->>'tipIntentId')::bigint)<>'pending' or exists(select 1 from public.salon_payments where order_id=1) then raise exception 'tip intent crossed payment boundary';end if;
 blocked:=false;begin perform public.salon_customer_create_review(auth_id,1,1,'review-create-0001',1,1,4,'修改评分',false,20);exception when others then blocked:=sqlerrm like '%幂等键已被其他业务使用%';end;if not blocked then raise exception 'changed review retry accepted';end if;
 blocked:=false;begin perform public.salon_customer_create_review(auth_id,1,1,'review-create-0002',1,1,5,'重复',false,0);exception when others then blocked:=sqlerrm like '%已经评价%';end;if not blocked then raise exception 'duplicate review accepted';end if;
 perform public.salon_moderate_review(2,1,1,(review->>'reviewId')::bigint,'review-hide-00001','hidden','顾客申请隐藏');
 campaign:=public.salon_create_campaign(2,1,1,'campaign-create-01','新客关怀','in_app','{"tag":"新客"}','欢迎预约',current_date,current_date+7);
 blocked:=false;begin perform public.salon_set_campaign_status(2,1,1,(campaign->>'campaignId')::bigint,'campaign-active-01','active','启用活动');exception when others then blocked:=sqlerrm like '%没有有效营销授权%';end;if not blocked then raise exception 'campaign activated without consent';end if;
 perform public.salon_customer_set_consent(auth_id,1,1,'consent-market-001','marketing_messages',true,'{"channel":"in_app"}','customer-confirmation:marketing-1');perform public.salon_set_campaign_status(2,1,1,(campaign->>'campaignId')::bigint,'campaign-active-02','active','授权范围核对通过');
 booking:=public.salon_customer_request_booking(auth_id,1,1,'booking-create-001',1,1,now()+interval '1 day',now()+interval '1 day 1 hour','希望短发');blocked:=false;begin perform public.salon_customer_request_booking(auth_id,1,1,'booking-create-001',1,1,now()+interval '2 days',now()+interval '2 days 1 hour','改期');exception when others then blocked:=sqlerrm like '%幂等键已被其他业务使用%';end;if not blocked then raise exception 'changed booking retry accepted';end if;handled:=public.salon_review_customer_booking(2,1,1,(booking->>'bookingRequestId')::bigint,'booking-review-001','confirmed',1,'档期确认');
 if handled->>'status'<>'confirmed' or (handled->>'appointmentId') is null or (select status from public.salon_appointments where id=(handled->>'appointmentId')::bigint)<>'confirmed' then raise exception 'booking confirmation failed';end if;
 perform public.salon_customer_request_booking_cancel(auth_id,1,1,(booking->>'bookingRequestId')::bigint,'booking-cancel-001','行程变化');if (select status from public.salon_customer_booking_requests where id=(booking->>'bookingRequestId')::bigint)<>'cancel_requested' or (select status from public.salon_appointments where id=(handled->>'appointmentId')::bigint)<>'confirmed' then raise exception 'confirmed booking cancellation bypassed staff review';end if;
 blocked:=false;begin perform public.salon_list_campaigns(2,1,2,'',50);exception when others then blocked:=sqlerrm like '%没有该门店操作权限%';end;if not blocked then raise exception 'cross-store campaign read accepted';end if;
 if jsonb_array_length(public.salon_customer_get_context(auth_id))<>1 or jsonb_array_length(public.salon_customer_list_booking_options(auth_id,1,1)->'services')<>1 or (select count(*) from public.salon_customer_list_bookings(auth_id,1,1,50))<>1 then raise exception 'customer portal reads failed';end if;
 if (select count(*) from public.salon_audit_events where organization_id=1 and store_id=1 and entity_type in('work','review','campaign','customer_booking'))<8 then raise exception 'engagement audit incomplete';end if;
end$$;

do $$begin
 if has_table_privilege('authenticated','public.salon_works','select') or has_table_privilege('authenticated','public.salon_reviews','select') or has_table_privilege('authenticated','public.salon_tip_intents','select') then raise exception 'browser engagement table access';end if;
 if has_function_privilege('authenticated','public.salon_customer_create_review(uuid,bigint,bigint,text,bigint,bigint,integer,text,boolean,numeric)','execute') then raise exception 'browser engagement function access';end if;
end$$;
select 'salon engagement transaction tests passed' as result;
