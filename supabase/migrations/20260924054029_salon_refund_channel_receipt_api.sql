-- Read-only, store-scoped receipt status for the staff workbench.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function public.salon_list_refund_channel_receipts(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_refund public.salon_refund_requests;v_rows jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id;
 if not found then raise exception '退款申请不存在或不属于当前门店';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'paymentId',a.original_payment_id,'method',a.payment_method,'amount',a.refund_amount::text,
  'revision',coalesce(latest.revision,0),'status',coalesce(latest.status,'missing'),
  'externalReference',coalesce(latest.external_reference,''),'evidenceNote',coalesce(latest.evidence_note,''),
  'reportedByStaffId',latest.reported_by_staff_id,'verifiedByStaffId',latest.verified_by_staff_id,'recordedAt',latest.created_at
 ) order by a.original_payment_id),'[]') into v_rows
 from public.salon_refund_request_payments a
 join public.salon_payments p on p.organization_id=a.organization_id and p.id=a.original_payment_id and p.order_id=v_refund.order_id and p.store_id=p_store_id and p.reversal_of_id is null
 left join lateral(select c.revision,c.status,c.external_reference,c.evidence_note,c.reported_by_staff_id,c.verified_by_staff_id,c.created_at from public.salon_refund_channel_receipts c where c.organization_id=a.organization_id and c.refund_request_id=a.refund_request_id and c.original_payment_id=a.original_payment_id order by c.revision desc limit 1) latest on true
 where a.organization_id=p_organization_id and a.refund_request_id=p_refund_request_id and a.payment_method not in('member_value','member_units');
 return jsonb_build_object('refundRequestId',p_refund_request_id,'organizationId',p_organization_id,'storeId',p_store_id,'receipts',v_rows);
end $$;
revoke execute on function public.salon_list_refund_channel_receipts(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_list_refund_channel_receipts(bigint,bigint,bigint,bigint) to service_role;

-- A rejected receipt may be replaced as a new revision; verified receipts are final.
create or replace function public.salon_record_refund_channel_receipt(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_refund_request_id bigint,
 p_original_payment_id bigint,p_request_key text,p_expected_revision integer,p_decision text,
 p_external_reference text,p_evidence_note text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_op public.salon_operation_requests;v_refund public.salon_refund_requests;v_alloc public.salon_refund_request_payments;v_payment public.salon_payments;v_latest public.salon_refund_channel_receipts;v_revision integer;v_status text;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,120}$' or p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in('report','verify','reject') or nullif(btrim(p_external_reference),'') is null or length(p_external_reference)>120 or nullif(btrim(p_evidence_note),'') is null or length(p_evidence_note)>500 then raise exception '外部退款回执参数无效';end if;
 v_op:=salon_private.claim_staff_request(p_organization_id,p_store_id,p_request_key,'refund_channel_receipt','refund_request',p_refund_request_id,p_actor_staff_id,jsonb_build_object('actor',p_actor_staff_id,'organization',p_organization_id,'store',p_store_id,'refund',p_refund_request_id,'payment',p_original_payment_id,'expectedRevision',p_expected_revision,'decision',p_decision,'externalReference',btrim(p_external_reference),'evidenceNote',btrim(p_evidence_note)),'orders','refund_execute');if v_op.completed_at is not null then return v_op.response_json;end if;
 select * into v_refund from public.salon_refund_requests where organization_id=p_organization_id and store_id=p_store_id and id=p_refund_request_id for update;
 if not found or v_refund.status<>'approved' then raise exception '仅已批准的退款申请可以登记或复核渠道回执';end if;
 select * into v_alloc from public.salon_refund_request_payments where organization_id=p_organization_id and refund_request_id=p_refund_request_id and original_payment_id=p_original_payment_id;
 if not found then raise exception '退款支付分配不存在';end if;
 select * into v_payment from public.salon_payments where organization_id=p_organization_id and store_id=p_store_id and id=p_original_payment_id and reversal_of_id is null;
 if not found or v_payment.payment_method in('member_value','member_units') then raise exception '该支付不是外部渠道支付';end if;
 select * into v_latest from public.salon_refund_channel_receipts where organization_id=p_organization_id and refund_request_id=p_refund_request_id and original_payment_id=p_original_payment_id order by revision desc limit 1;
 v_revision:=coalesce(v_latest.revision,0);if v_revision<>p_expected_revision then raise exception '回执版本已变化，请刷新后重试';end if;
 if p_decision='report' then
  if v_revision>0 and v_latest.status<>'rejected' then raise exception '回执已经登记，请由其他员工复核';end if;v_status:='reported';
 elsif p_decision in('verify','reject') then
  if not found or v_latest.status<>'reported' or v_latest.reported_by_staff_id=p_actor_staff_id then raise exception '仅其他员工可复核待核验回执';end if;
  if btrim(p_external_reference)<>v_latest.external_reference then raise exception '复核时凭证号必须与登记一致';end if;v_status:=case when p_decision='verify' then 'verified' else 'rejected' end;
 else raise exception '回执决策无效';end if;
 insert into public.salon_refund_channel_receipts(organization_id,store_id,refund_request_id,original_payment_id,revision,refund_amount,status,external_reference,evidence_note,request_key,reported_by_staff_id,verified_by_staff_id)
 values(p_organization_id,p_store_id,p_refund_request_id,p_original_payment_id,v_revision+1,v_alloc.refund_amount,v_status,btrim(p_external_reference),btrim(p_evidence_note),p_request_key,case when p_decision='report' then p_actor_staff_id else v_latest.reported_by_staff_id end,case when p_decision='report' then null else p_actor_staff_id end);
 v_response:=jsonb_build_object('refundRequestId',p_refund_request_id,'paymentId',p_original_payment_id,'revision',v_revision+1,'status',v_status,'amount',v_alloc.refund_amount,'reportedBy',case when p_decision='report' then p_actor_staff_id else v_latest.reported_by_staff_id end,'verifiedBy',case when p_decision='report' then null else p_actor_staff_id end);
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'refund_channel_receipt',p_refund_request_id||':'||p_original_payment_id,p_decision,jsonb_build_object('revision',v_revision),v_response,btrim(p_evidence_note));
 update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_op.id;return v_response;
end $$;
revoke execute on function public.salon_record_refund_channel_receipt(bigint,bigint,bigint,bigint,bigint,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.salon_record_refund_channel_receipt(bigint,bigint,bigint,bigint,bigint,text,integer,text,text,text) to service_role;

create or replace function public.salon_lookup_staff_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_lookup_key text,p_target_operation text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resource text;v_id_field text;v_result jsonb;v_unknown jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then raise exception '请求核对编号无效';end if;
 if p_target_operation='refund_channel_receipt' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_execute');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request','resourceId',r.entity_id,'completedAt',r.completed_at,'receipt',r.response_json)
   into v_result from public.salon_operation_requests r
   join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id and f.id=r.entity_id
   join public.salon_refund_channel_receipts c on c.organization_id=r.organization_id and c.store_id=r.store_id and c.refund_request_id=f.id
    and c.original_payment_id=case when (r.response_json->>'paymentId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'paymentId')::bigint end
    and c.revision=case when (r.response_json->>'revision')~'^[1-9][0-9]{0,8}$' then (r.response_json->>'revision')::integer end
    and c.request_key=r.request_key and c.status=r.response_json->>'status'
   where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key
    and r.action='refund_channel_receipt' and r.entity_type='refund_request' and r.staff_request_actor_id=p_actor_staff_id
    and r.staff_payload_digest is not null and r.completed_at is not null
    and (c.reported_by_staff_id=p_actor_staff_id or c.verified_by_staff_id=p_actor_staff_id);
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 if p_target_operation in('cash_refund_request','partial_cash_refund_request') then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_request');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
   into v_result from public.salon_operation_requests r join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id
    and f.id=case when (r.response_json->>'refundRequestId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
    and f.order_id::text=r.response_json->>'orderId' and f.created_by_staff_id=p_actor_staff_id and f.refund_type=case when p_target_operation='cash_refund_request' then 'full' else 'partial' end
   where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key and r.action='refund_request'
    and r.entity_type=case when p_target_operation='cash_refund_request' then 'cash_full_refund' else 'cash_partial_refund' end and r.staff_request_actor_id=p_actor_staff_id
    and r.staff_payload_digest is not null and r.completed_at is not null and r.response_json->>'createdByStaffId'=p_actor_staff_id::text and r.response_json->>'requestKey'=p_lookup_key;
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 if p_target_operation='refund_review' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_approve');perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','refund_read');perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','refund_request','resourceId',f.id,'completedAt',r.completed_at,'receipt',r.response_json)
   into v_result from public.salon_operation_requests r join public.salon_refund_requests f on f.organization_id=r.organization_id and f.store_id=r.store_id and f.id=case when (r.response_json->>'refundRequestId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'refundRequestId')::bigint end
   where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key and r.action='refund_review' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null and r.completed_at is not null and r.response_json->>'reviewedByStaffId'=p_actor_staff_id::text and r.response_json->>'status' in('approved','rejected');
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 if p_target_operation='cash_checkout' then
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','checkout');perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'orders','read');
  select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType','order','resourceId',r.response_json->>'orderId','completedAt',r.completed_at,'receipt',r.response_json,'paymentStatus',p.status)
   into v_result from public.salon_operation_requests r join public.salon_payments p on p.organization_id=r.organization_id and p.store_id=r.store_id and p.id=case when (r.response_json->>'paymentId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'paymentId')::bigint end and p.order_id=case when (r.response_json->>'orderId')~'^[1-9][0-9]{0,17}$' then (r.response_json->>'orderId')::bigint end and p.payment_method='cash' and p.amount::text=r.response_json->>'paid' and p.tendered_amount::text=r.response_json->>'tendered' and p.change_amount::text=r.response_json->>'change'
   where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key and r.action='cash_checkout' and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null and r.completed_at is not null;
  return coalesce(v_result,jsonb_build_object('operation',p_target_operation,'status','unconfirmed'));
 end if;
 case p_target_operation when 'customer_create' then v_resource:='customers';v_id_field:='customerId';when 'order_create' then v_resource:='orders';v_id_field:='orderId';when 'order_status' then v_resource:='orders';v_id_field:='orderId';when 'order_lines' then v_resource:='orders';v_id_field:='orderId';else raise exception '不支持核对该操作';end case;
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'write');perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'read');
 v_unknown:=jsonb_build_object('operation',p_target_operation,'status','unconfirmed');
 select jsonb_build_object('operation',p_target_operation,'status','committed','resourceType',case when v_resource='customers' then 'customer' else 'order' end,'resourceId',r.response_json->>v_id_field,'completedAt',r.completed_at)
  into v_result from public.salon_operation_requests r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.request_key=p_lookup_key and r.action=p_target_operation and r.staff_request_actor_id=p_actor_staff_id and r.staff_payload_digest is not null and r.completed_at is not null and jsonb_typeof(r.response_json)='object' and (r.response_json->>v_id_field)~'^[1-9][0-9]{0,18}$';
 return coalesce(v_result,v_unknown);
end $$;
revoke execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) to service_role;
