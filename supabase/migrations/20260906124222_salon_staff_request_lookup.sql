-- Independent development only. A receipt lookup never replays a mutation.
set statement_timeout='30s';
set lock_timeout='5s';

create function public.salon_lookup_staff_request(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,
 p_lookup_key text,p_target_operation text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resource text;v_id_field text;v_result jsonb;v_unknown jsonb;
begin
 if p_lookup_key is null or p_lookup_key !~ '^[A-Za-z0-9._:-]{16,120}$' then
  raise exception '请求核对编号无效';
 end if;
 case p_target_operation
  when 'customer_create' then v_resource:='customers';v_id_field:='customerId';
  when 'order_create' then v_resource:='orders';v_id_field:='orderId';
  when 'order_lines' then v_resource:='orders';v_id_field:='orderId';
  else raise exception '不支持核对该操作';
 end case;
 -- Recheck current permissions even when an old completed receipt exists.
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'write');
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,v_resource,'read');
 v_unknown:=jsonb_build_object('operation',p_target_operation,'status','unconfirmed');
 -- The existing (organization_id, request_key) unique index bounds this exact lookup.
 -- No lock/claim/update: an uncommitted transaction stays indistinguishable from no receipt.
 select jsonb_build_object('operation',p_target_operation,'status','committed',
          'resourceType',case when v_resource='customers' then 'customer' else 'order' end,
          'resourceId',r.response_json->>v_id_field,'completedAt',r.completed_at)
 into v_result
 from public.salon_operation_requests r
 where r.organization_id=p_organization_id and r.store_id=p_store_id
  and r.request_key=p_lookup_key and r.action=p_target_operation
  and r.staff_request_actor_id=p_actor_staff_id
  and r.staff_payload_digest is not null
  and r.completed_at is not null
  and jsonb_typeof(r.response_json)='object'
  and (r.response_json->>v_id_field) ~ '^[1-9][0-9]{0,18}$';
 -- Missing, legacy, wrong actor/store/action and incomplete results reveal no receipt details.
 return coalesce(v_result,v_unknown);
end $$;
revoke execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) to service_role;
comment on function public.salon_lookup_staff_request(bigint,bigint,bigint,text,text) is
 'Own-store, own-actor minimal historical receipt only. unconfirmed is not failure or authorization to resubmit; committed is not current business status.';
