-- Transactional customer master and store relationship operations.
-- Development branch only. Phone numbers remain server-side and list results
-- expose masked values only.

set statement_timeout='30s';
set lock_timeout='5s';

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check
  check(action in ('checkout','refund','inventory_move','customer_create','customer_status','customer_relation'));

create or replace function public.salon_create_customer(
  p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_request_key text,
  p_display_name text,p_phone text default null,p_birthday date default null,
  p_owner_staff_id bigint default null,p_source text default 'walkin',p_tags text[] default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_customer_id bigint;v_phone text;v_name text:=btrim(coalesce(p_display_name,''));
  v_source text:=btrim(coalesce(p_source,''));v_tags text[];v_response jsonb;
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customers','write');
  if v_name='' or length(v_name)>100 then raise exception '顾客姓名不能为空且不能超过100字';end if;
  v_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if v_phone='' then v_phone:=null;elsif v_phone !~ '^1[0-9]{10}$' then raise exception '手机号必须为11位';end if;
  if v_source not in ('walkin','appointment','referral','online','import','other') then raise exception '顾客来源无效';end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)) filter(where btrim(x)<>''),'{}'::text[]) into v_tags from unnest(coalesce(p_tags,'{}')) x;
  if cardinality(v_tags)>20 or exists(select 1 from unnest(v_tags) x where length(x)>30) then raise exception '顾客标签最多20个且每个不超过30字';end if;
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'customer_create','customer_payload',hashtextextended(jsonb_build_object('name',v_name,'phone',v_phone,'birthday',p_birthday,'owner',p_owner_staff_id,'source',v_source,'tags',v_tags)::text,0));
  if v_request.completed_at is not null then return v_request.response_json;end if;
  if p_owner_staff_id is not null and not exists(select 1 from public.salon_staff s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_owner_staff_id and s.employment_status='active') then raise exception '负责人不是当前门店在职员工';end if;
  begin
    insert into public.salon_customers(organization_id,display_name,phone_normalized,birthday)
      values(p_organization_id,v_name,v_phone,p_birthday) returning id into v_customer_id;
  exception when unique_violation then raise exception '该手机号已存在顾客档案';end;
  insert into public.salon_customer_store_relations(organization_id,store_id,customer_id,owner_staff_id,source,tags,first_visit_at)
    values(p_organization_id,p_store_id,v_customer_id,p_owner_staff_id,v_source,v_tags,now());
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json)
    values(p_organization_id,p_store_id,p_actor_staff_id,'customer',v_customer_id::text,'create',jsonb_build_object('displayName',v_name,'source',v_source,'tags',v_tags));
  v_response:=jsonb_build_object('customerId',v_customer_id,'status','active');
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;
  return v_response;
end $$;

create or replace function public.salon_set_customer_status(
  p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_customer_id bigint,
  p_request_key text,p_status text,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_customer public.salon_customers;v_reason text:=btrim(coalesce(p_reason,''));v_response jsonb;
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customers','write');
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'customer_status','customer_status_'||coalesce(p_status,''),p_customer_id);
  if v_request.completed_at is not null then return v_request.response_json;end if;
  if p_status not in ('active','frozen') or v_reason='' or length(v_reason)>500 then raise exception '顾客状态或变更原因无效';end if;
  select c.* into v_customer from public.salon_customers c join public.salon_customer_store_relations r on r.organization_id=c.organization_id and r.customer_id=c.id
    where c.organization_id=p_organization_id and c.id=p_customer_id and r.store_id=p_store_id for update of c;
  if not found then raise exception '顾客不存在或不属于当前门店';end if;
  if v_customer.status=p_status then raise exception '顾客已经是目标状态';end if;
  update public.salon_customers set status=p_status,updated_at=now() where organization_id=p_organization_id and id=p_customer_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason)
    values(p_organization_id,p_store_id,p_actor_staff_id,'customer',p_customer_id::text,'status_change',jsonb_build_object('status',v_customer.status),jsonb_build_object('status',p_status),v_reason);
  v_response:=jsonb_build_object('customerId',p_customer_id,'status',p_status);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_update_customer_relation(
  p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_customer_id bigint,
  p_request_key text,p_owner_staff_id bigint default null,p_source text default 'walkin',p_tags text[] default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_before public.salon_customer_store_relations;v_source text:=btrim(coalesce(p_source,''));v_tags text[];v_response jsonb;
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customers','write');
  if v_source not in ('walkin','appointment','referral','online','import','other') then raise exception '顾客来源无效';end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)) filter(where btrim(x)<>''),'{}'::text[]) into v_tags from unnest(coalesce(p_tags,'{}')) x;
  if cardinality(v_tags)>20 or exists(select 1 from unnest(v_tags) x where length(x)>30) then raise exception '顾客标签最多20个且每个不超过30字';end if;
  v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'customer_relation','customer_relation_payload',hashtextextended(jsonb_build_object('customerId',p_customer_id,'owner',p_owner_staff_id,'source',v_source,'tags',v_tags)::text,0));
  if v_request.completed_at is not null then return v_request.response_json;end if;
  if p_owner_staff_id is not null and not exists(select 1 from public.salon_staff s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.id=p_owner_staff_id and s.employment_status='active') then raise exception '负责人不是当前门店在职员工';end if;
  select * into v_before from public.salon_customer_store_relations r where r.organization_id=p_organization_id and r.store_id=p_store_id and r.customer_id=p_customer_id for update;
  if not found then raise exception '顾客不存在或不属于当前门店';end if;
  update public.salon_customer_store_relations set owner_staff_id=p_owner_staff_id,source=v_source,tags=v_tags where organization_id=p_organization_id and store_id=p_store_id and customer_id=p_customer_id;
  insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json)
    values(p_organization_id,p_store_id,p_actor_staff_id,'customer_relation',p_customer_id::text,'update',jsonb_build_object('ownerStaffId',v_before.owner_staff_id,'source',v_before.source,'tags',v_before.tags),jsonb_build_object('ownerStaffId',p_owner_staff_id,'source',v_source,'tags',v_tags));
  v_response:=jsonb_build_object('customerId',p_customer_id,'ownerStaffId',p_owner_staff_id,'source',v_source,'tags',v_tags);
  update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_list_customers(
  p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_query text default '',p_status text default '',p_limit integer default 100
) returns table(customer_id bigint,display_name text,phone_masked text,birthday date,status text,owner_staff_id bigint,source text,tags text[],first_visit_at timestamptz,last_visit_at timestamptz)
language plpgsql security invoker set search_path='' as $$
begin
  perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customers','read');
  if p_status not in ('','active','frozen') or p_limit not between 1 and 200 then raise exception '顾客查询参数无效';end if;
  return query select c.id,c.display_name,case when c.phone_normalized is null then null else left(c.phone_normalized,3)||'****'||right(c.phone_normalized,4) end,c.birthday,c.status,r.owner_staff_id,r.source,r.tags,r.first_visit_at,r.last_visit_at
    from public.salon_customer_store_relations r join public.salon_customers c on c.organization_id=r.organization_id and c.id=r.customer_id
    where r.organization_id=p_organization_id and r.store_id=p_store_id and c.status<>'anonymized'
      and (p_status='' or c.status=p_status) and (btrim(coalesce(p_query,''))='' or c.display_name ilike '%'||btrim(p_query)||'%' or c.phone_normalized=regexp_replace(p_query,'[^0-9]','','g'))
    order by c.updated_at desc,c.id desc limit p_limit;
end $$;

revoke execute on function public.salon_create_customer(bigint,bigint,bigint,text,text,text,date,bigint,text,text[]) from public,anon,authenticated;
revoke execute on function public.salon_set_customer_status(bigint,bigint,bigint,bigint,text,text,text) from public,anon,authenticated;
revoke execute on function public.salon_update_customer_relation(bigint,bigint,bigint,bigint,text,bigint,text,text[]) from public,anon,authenticated;
revoke execute on function public.salon_list_customers(bigint,bigint,bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.salon_create_customer(bigint,bigint,bigint,text,text,text,date,bigint,text,text[]) to service_role;
grant execute on function public.salon_set_customer_status(bigint,bigint,bigint,bigint,text,text,text) to service_role;
grant execute on function public.salon_update_customer_relation(bigint,bigint,bigint,bigint,text,bigint,text,text[]) to service_role;
grant execute on function public.salon_list_customers(bigint,bigint,bigint,text,text,integer) to service_role;

comment on function public.salon_list_customers(bigint,bigint,bigint,text,text,integer) is 'Store-scoped customer list; never returns an unmasked phone number.';
