-- Customer mutation retries: authorize before replay, bind identity and every argument.
set statement_timeout='30s';
set lock_timeout='5s';
alter table public.salon_operation_requests
 add column customer_auth_user_id uuid,
 add column customer_payload_digest bytea;

create function salon_private.claim_customer_request(
 p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_request_key text,
 p_action text,p_payload jsonb
) returns public.salon_operation_requests
language plpgsql security invoker set search_path='' as $$
declare v_customer_id bigint;v_op public.salon_operation_requests;v_digest bytea;
begin
 -- Shared locks prevent identity revocation, freezing or store closure mid-transaction.
 select i.customer_id into v_customer_id
 from public.salon_customer_auth_identities i
 join public.salon_customers c on c.organization_id=i.organization_id and c.id=i.customer_id
 join public.salon_organizations o on o.id=i.organization_id
 join public.salon_stores s on s.organization_id=o.id and s.id=p_store_id
 where i.organization_id=p_organization_id and i.auth_user_id=p_auth_user_id
 and i.status='active' and c.status='active' and o.status='active' and s.status='active'
 for share of i,c,o,s;
 if not found then raise exception '顾客端账号未绑定或已停用，或门店不可用';end if;
 if p_action='review_create' then
  perform 1 from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id
   and id=(p_payload->>'p_order_id')::bigint and customer_id=v_customer_id for update;
  if not found then raise exception '仅订单本人可评价已完成服务人员';end if;
 elsif p_action='booking_cancel' then
  perform 1 from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id
   and id=(p_payload->>'p_booking_request_id')::bigint and customer_id=v_customer_id for update;
  if not found then raise exception '预约申请不存在或当前不能取消';end if;
 elsif p_action not in('consent_set','booking_request') then
  raise exception '不支持的顾客请求';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception '请求参数无效';end if;
 v_digest:=sha256(convert_to(p_payload::text,'UTF8'));
 -- Legacy request keys cannot be adopted: their ownership was not recorded.
 v_op:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,p_action,'customer_request_v2',v_customer_id);
 select * into v_op from public.salon_operation_requests where id=v_op.id for update;
 if v_op.customer_auth_user_id is not null then
  if v_op.customer_auth_user_id<>p_auth_user_id or v_op.customer_payload_digest is distinct from v_digest
   then raise exception '幂等键已被其他业务使用';end if;
 elsif v_op.completed_at is not null then
  raise exception '旧请求缺少身份校验信息，请核对业务记录';
 else
  update public.salon_operation_requests set customer_auth_user_id=p_auth_user_id,customer_payload_digest=v_digest
   where id=v_op.id returning * into v_op;
 end if;
 return v_op;
end$$;
revoke execute on function salon_private.claim_customer_request(uuid,bigint,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function salon_private.claim_customer_request(uuid,bigint,bigint,text,text,jsonb) to service_role;


create or replace function public.salon_customer_set_consent(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_request_key text,p_consent_type text,p_granted boolean,p_scope_json jsonb,p_evidence_ref text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$declare v_identity public.salon_customer_auth_identities;v_op public.salon_operation_requests;v_id bigint;v_response jsonb;begin
 v_op:=salon_private.claim_customer_request(p_auth_user_id,p_organization_id,p_store_id,p_request_key,'consent_set',jsonb_build_object('p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_consent_type',p_consent_type,'p_granted',p_granted,'p_scope_json',p_scope_json,'p_evidence_ref',p_evidence_ref));if v_op.completed_at is not null then return v_op.response_json;end if;
 select i.* into v_identity from public.salon_customer_auth_identities i join public.salon_customers c on c.organization_id=i.organization_id and c.id=i.customer_id and c.status='active' where i.organization_id=p_organization_id and i.auth_user_id=p_auth_user_id and i.status='active';if not found then raise exception '顾客端账号未绑定或已停用';end if;
 if p_consent_type not in('work_publication','marketing_messages') or jsonb_typeof(coalesce(p_scope_json,'{}'))<>'object' or nullif(btrim(coalesce(p_evidence_ref,'')),'') is null then raise exception '授权参数无效';end if;

 if not exists(select 1 from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active') then raise exception '门店不存在或已停用';end if;
 if not p_granted and p_consent_type='work_publication' then update public.salon_works set status='withdrawn',updated_at=now(),review_reason='顾客撤回公开授权' where organization_id=p_organization_id and store_id=p_store_id and customer_id=v_identity.customer_id and status in('pending_review','published');end if;
 insert into public.salon_customer_consents(organization_id,store_id,customer_id,consent_type,status,scope_json,evidence_ref,captured_via,granted_at,revoked_at) values(p_organization_id,p_store_id,v_identity.customer_id,p_consent_type,case when p_granted then 'granted' else 'revoked' end,coalesce(p_scope_json,'{}'),btrim(p_evidence_ref),'customer_portal',case when p_granted then now() end,case when not p_granted then now() end) returning id into v_id;
 insert into public.salon_audit_events(organization_id,store_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,'customer_consent',v_id::text,case when p_granted then 'grant' else 'revoke' end,jsonb_build_object('customerId',v_identity.customer_id,'type',p_consent_type),case when p_granted then '顾客端授权' else '顾客端撤回授权' end);
 v_response:=jsonb_build_object('consentId',v_id,'customerId',v_identity.customer_id,'status',case when p_granted then 'granted' else 'revoked' end);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;end$$;


create or replace function public.salon_customer_create_review(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_request_key text,p_order_id bigint,p_staff_id bigint,p_rating integer,p_comment text,p_is_anonymous boolean,p_tip_amount numeric)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$declare v_identity public.salon_customer_auth_identities;v_order public.salon_orders;v_op public.salon_operation_requests;v_id bigint;v_tip_id bigint;v_response jsonb;begin
 v_op:=salon_private.claim_customer_request(p_auth_user_id,p_organization_id,p_store_id,p_request_key,'review_create',jsonb_build_object('p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_order_id',p_order_id,'p_staff_id',p_staff_id,'p_rating',p_rating,'p_comment',p_comment,'p_is_anonymous',p_is_anonymous,'p_tip_amount',p_tip_amount));if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_identity from public.salon_customer_auth_identities where organization_id=p_organization_id and auth_user_id=p_auth_user_id and status='active';if not found then raise exception '顾客端账号未绑定或已停用';end if;if p_rating not between 1 and 5 or p_tip_amount is null or p_tip_amount<0 then raise exception '评分或打赏意向金额无效';end if;
 select * into v_order from public.salon_orders where organization_id=p_organization_id and store_id=p_store_id and id=p_order_id and customer_id=v_identity.customer_id and status='paid' for update;if not found or not exists(select 1 from public.salon_order_lines where organization_id=p_organization_id and order_id=p_order_id and staff_id=p_staff_id and service_status<>'cancelled') then raise exception '仅订单本人可评价已完成服务人员';end if;
 begin insert into public.salon_reviews(organization_id,store_id,order_id,customer_id,staff_id,rating,comment,is_anonymous) values(p_organization_id,p_store_id,p_order_id,v_identity.customer_id,p_staff_id,p_rating,coalesce(p_comment,''),coalesce(p_is_anonymous,false)) returning id into v_id;exception when unique_violation then raise exception '该订单已经评价过此服务人员';end;
 if p_tip_amount>0 then insert into public.salon_tip_intents(organization_id,store_id,review_id,customer_id,staff_id,amount) values(p_organization_id,p_store_id,v_id,v_identity.customer_id,p_staff_id,round(p_tip_amount,2)) returning id into v_tip_id;end if;
 insert into public.salon_audit_events(organization_id,store_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,'review',v_id::text,'create',jsonb_build_object('orderId',p_order_id,'staffId',p_staff_id,'rating',p_rating,'tipIntentId',v_tip_id),'顾客端评价');v_response:=jsonb_build_object('reviewId',v_id,'status','published','tipIntentId',v_tip_id,'tipStatus',case when v_tip_id is null then null else 'pending' end);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;end$$;


create or replace function public.salon_customer_request_booking(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_request_key text,p_catalog_item_id bigint,p_staff_id bigint,p_starts_at timestamptz,p_ends_at timestamptz,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$declare v_identity public.salon_customer_auth_identities;v_op public.salon_operation_requests;v_id bigint;v_response jsonb;begin
 v_op:=salon_private.claim_customer_request(p_auth_user_id,p_organization_id,p_store_id,p_request_key,'booking_request',jsonb_build_object('p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_catalog_item_id',p_catalog_item_id,'p_staff_id',p_staff_id,'p_starts_at',p_starts_at,'p_ends_at',p_ends_at,'p_notes',p_notes));if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_identity from public.salon_customer_auth_identities where organization_id=p_organization_id and auth_user_id=p_auth_user_id and status='active';if not found then raise exception '顾客端账号未绑定或已停用';end if;if p_ends_at<=p_starts_at or p_starts_at<now() or not exists(select 1 from public.salon_catalog_items i join public.salon_catalog_store_settings s on s.organization_id=i.organization_id and s.catalog_item_id=i.id where i.organization_id=p_organization_id and i.id=p_catalog_item_id and i.item_type='service' and i.status='active' and s.store_id=p_store_id and s.status='active') or (p_staff_id is not null and not exists(select 1 from public.salon_staff where organization_id=p_organization_id and store_id=p_store_id and id=p_staff_id and employment_status='active')) then raise exception '自助预约项目、手艺人或时间无效';end if;
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id,source) values(p_organization_id,p_store_id,v_identity.customer_id,'customer_portal') on conflict(store_id,customer_id) do nothing;insert into public.salon_customer_booking_requests(organization_id,store_id,customer_id,catalog_item_id,staff_id,starts_at,ends_at,notes) values(p_organization_id,p_store_id,v_identity.customer_id,p_catalog_item_id,p_staff_id,p_starts_at,p_ends_at,coalesce(p_notes,'')) returning id into v_id;insert into public.salon_audit_events(organization_id,store_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,'customer_booking',v_id::text,'submit',jsonb_build_object('customerId',v_identity.customer_id,'catalogItemId',p_catalog_item_id,'staffId',p_staff_id,'startsAt',p_starts_at,'endsAt',p_ends_at),'顾客端提交预约');v_response:=jsonb_build_object('bookingRequestId',v_id,'status','submitted');update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;end$$;


create or replace function public.salon_customer_request_booking_cancel(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint,p_booking_request_id bigint,p_request_key text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$declare v_identity public.salon_customer_auth_identities;v public.salon_customer_booking_requests;v_op public.salon_operation_requests;v_status text;v_response jsonb;begin
 v_op:=salon_private.claim_customer_request(p_auth_user_id,p_organization_id,p_store_id,p_request_key,'booking_cancel',jsonb_build_object('p_auth_user_id',p_auth_user_id,'p_organization_id',p_organization_id,'p_store_id',p_store_id,'p_booking_request_id',p_booking_request_id,'p_reason',p_reason));if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_identity from public.salon_customer_auth_identities where organization_id=p_organization_id and auth_user_id=p_auth_user_id and status='active';if not found or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception '取消预约参数无效';end if;select * into v from public.salon_customer_booking_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_booking_request_id and customer_id=v_identity.customer_id for update;if not found or v.status not in('submitted','confirmed') then raise exception '预约申请不存在或当前不能取消';end if;v_status:=case when v.status='submitted' then 'cancelled' else 'cancel_requested' end;update public.salon_customer_booking_requests set status=v_status,handle_reason=btrim(p_reason),updated_at=now() where organization_id=p_organization_id and id=p_booking_request_id;insert into public.salon_audit_events(organization_id,store_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,'customer_booking',p_booking_request_id::text,'cancel_request',jsonb_build_object('status',v.status),jsonb_build_object('status',v_status),btrim(p_reason));v_response:=jsonb_build_object('bookingRequestId',p_booking_request_id,'status',v_status);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;end$$;
