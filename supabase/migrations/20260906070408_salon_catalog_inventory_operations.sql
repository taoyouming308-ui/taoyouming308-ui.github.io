-- Store-scoped catalog and inventory operations. Development branch only.
set statement_timeout='30s';set lock_timeout='5s';

alter table public.salon_catalog_items
  add column member_price numeric(12,2) not null default 0 check(member_price>=0),
  add column cost_price numeric(12,2) not null default 0 check(cost_price>=0),
  add column unit text not null default '次' check(nullif(btrim(unit),'') is not null);

create table public.salon_catalog_store_settings(
  organization_id bigint not null,store_id bigint not null,catalog_item_id bigint not null,
  status text not null default 'active' check(status in ('active','disabled')),
  stock_tracked boolean not null default false,safety_stock numeric(14,3) not null default 0 check(safety_stock>=0),
  updated_at timestamptz not null default now(),primary key(organization_id,store_id,catalog_item_id),
  foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,
  foreign key(organization_id,catalog_item_id) references public.salon_catalog_items(organization_id,id) on delete restrict
);
create index salon_catalog_store_active_idx on public.salon_catalog_store_settings(organization_id,store_id,status,catalog_item_id);
alter table public.salon_catalog_store_settings enable row level security;
alter table public.salon_catalog_store_settings force row level security;
revoke all on table public.salon_catalog_store_settings from public,anon,authenticated;
grant all on table public.salon_catalog_store_settings to service_role;

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in
 ('checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count'));

create or replace function public.salon_create_catalog_item(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_request_key text,
 p_code text,p_item_type text,p_name text,p_category text default '',p_list_price numeric default 0,
 p_member_price numeric default 0,p_cost_price numeric default 0,p_unit text default '次',
 p_duration_minutes integer default null,p_stock_tracked boolean default false,p_safety_stock numeric default 0
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_id bigint;v_code text:=upper(btrim(coalesce(p_code,'')));v_name text:=btrim(coalesce(p_name,''));v_response jsonb;v_hash bigint;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'catalog','write');
 if v_code='' or length(v_code)>40 or v_name='' or length(v_name)>100 then raise exception '项目商品编号或名称无效';end if;
 if p_item_type not in ('service','product','package','year_card') then raise exception '项目商品类型无效';end if;
 if p_list_price<0 or p_member_price<0 or p_cost_price<0 or p_safety_stock<0 then raise exception '价格或安全库存不能为负数';end if;
 if p_duration_minutes is not null and p_duration_minutes not between 5 and 1440 then raise exception '服务时长无效';end if;
 if p_item_type<>'product' and (p_stock_tracked or p_safety_stock<>0) then raise exception '只有商品可以启用库存';end if;
 if nullif(btrim(coalesce(p_unit,'')),'') is null then raise exception '单位不能为空';end if;
 v_hash:=hashtextextended(jsonb_build_object('code',v_code,'type',p_item_type,'name',v_name,'category',btrim(coalesce(p_category,'')),'price',p_list_price,'memberPrice',p_member_price,'cost',p_cost_price,'unit',btrim(p_unit),'duration',p_duration_minutes,'tracked',p_stock_tracked,'safety',p_safety_stock)::text,0);
 v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'catalog_create','catalog_payload',v_hash);
 if v_request.completed_at is not null then return v_request.response_json;end if;
 begin
  insert into public.salon_catalog_items(organization_id,item_type,code,name,category,list_price,member_price,cost_price,unit,duration_minutes)
   values(p_organization_id,p_item_type,v_code,v_name,btrim(coalesce(p_category,'')),round(p_list_price,2),round(p_member_price,2),round(p_cost_price,2),btrim(p_unit),p_duration_minutes) returning id into v_id;
 exception when unique_violation then raise exception '该项目商品编号已经存在';end;
 insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id,stock_tracked,safety_stock) values(p_organization_id,p_store_id,v_id,p_item_type='product' and p_stock_tracked,round(p_safety_stock,3));
 if p_item_type='product' and p_stock_tracked then insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id) values(p_organization_id,p_store_id,v_id);end if;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json)
  values(p_organization_id,p_store_id,p_actor_staff_id,'catalog_item',v_id::text,'create',jsonb_build_object('code',v_code,'type',p_item_type,'name',v_name,'stockTracked',p_stock_tracked,'safetyStock',p_safety_stock));
 v_response:=jsonb_build_object('catalogItemId',v_id,'code',v_code,'status','active');update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_enable_catalog_item(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_catalog_item_id bigint,p_request_key text,p_stock_tracked boolean default false,p_safety_stock numeric default 0
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_type text;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'catalog','write');
 v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'catalog_enable','catalog_item',p_catalog_item_id);if v_request.completed_at is not null then return v_request.response_json;end if;
 select item_type into v_type from public.salon_catalog_items where organization_id=p_organization_id and id=p_catalog_item_id and status='active';if not found then raise exception '项目商品不存在或已停用';end if;
 if p_safety_stock<0 or (v_type<>'product' and (p_stock_tracked or p_safety_stock<>0)) then raise exception '库存设置无效';end if;
 begin insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id,stock_tracked,safety_stock) values(p_organization_id,p_store_id,p_catalog_item_id,v_type='product' and p_stock_tracked,round(p_safety_stock,3));exception when unique_violation then raise exception '当前门店已经启用该项目商品';end;
 if v_type='product' and p_stock_tracked then insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id) values(p_organization_id,p_store_id,p_catalog_item_id);end if;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json) values(p_organization_id,p_store_id,p_actor_staff_id,'catalog_store',p_catalog_item_id::text,'enable',jsonb_build_object('stockTracked',p_stock_tracked,'safetyStock',p_safety_stock));
 v_response:=jsonb_build_object('catalogItemId',p_catalog_item_id,'storeId',p_store_id,'status','active');update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_set_catalog_status(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_catalog_item_id bigint,p_request_key text,p_status text,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_before text;v_reason text:=btrim(coalesce(p_reason,''));v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'catalog','write');
 v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'catalog_status','catalog_status_'||coalesce(p_status,''),p_catalog_item_id);
 if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_status not in ('active','disabled') or v_reason='' then raise exception '项目商品状态或原因无效';end if;
 select status into v_before from public.salon_catalog_store_settings where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=p_catalog_item_id for update;
 if not found then raise exception '项目商品不存在或不属于当前门店';end if;if v_before=p_status then raise exception '项目商品已经是目标状态';end if;
 update public.salon_catalog_store_settings set status=p_status,updated_at=now() where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=p_catalog_item_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'catalog_store',p_catalog_item_id::text,'status_change',jsonb_build_object('status',v_before),jsonb_build_object('status',p_status),v_reason);
 v_response:=jsonb_build_object('catalogItemId',p_catalog_item_id,'status',p_status);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_count_inventory(
 p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_catalog_item_id bigint,p_request_key text,p_counted numeric,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_balance public.salon_inventory_balances;v_ledger_id bigint;v_reason text:=btrim(coalesce(p_reason,''));v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');
 v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'inventory_count','catalog_item',p_catalog_item_id);
 if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_counted is null or p_counted<0 or v_reason='' then raise exception '盘点数量或原因无效';end if;
 if not exists(select 1 from public.salon_catalog_store_settings s where s.organization_id=p_organization_id and s.store_id=p_store_id and s.catalog_item_id=p_catalog_item_id and s.status='active' and s.stock_tracked) then raise exception '当前门店未启用该商品库存';end if;
 select * into v_balance from public.salon_inventory_balances b where b.organization_id=p_organization_id and b.store_id=p_store_id and b.catalog_item_id=p_catalog_item_id for update;
 if not found then raise exception '库存余额不存在';end if;
 if round(p_counted,3)=v_balance.quantity then raise exception '盘点数量与当前库存一致';end if;
 insert into public.salon_inventory_ledger(organization_id,store_id,catalog_item_id,movement_type,quantity_delta,quantity_before,quantity_after,reason) values(p_organization_id,p_store_id,p_catalog_item_id,'count_adjustment',round(p_counted,3)-v_balance.quantity,v_balance.quantity,round(p_counted,3),v_reason) returning id into v_ledger_id;
 update public.salon_inventory_balances set quantity=round(p_counted,3),updated_at=now() where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=p_catalog_item_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'inventory_ledger',v_ledger_id::text,'count',jsonb_build_object('before',v_balance.quantity,'after',round(p_counted,3),'requestKey',p_request_key),v_reason);
 v_response:=jsonb_build_object('ledgerId',v_ledger_id,'quantityBefore',v_balance.quantity,'quantityAfter',round(p_counted,3));update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_list_catalog_inventory(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_item_type text default '',p_status text default '',p_query text default '',p_limit integer default 200)
returns table(catalog_item_id bigint,code text,item_type text,name text,category text,list_price numeric,member_price numeric,cost_price numeric,unit text,duration_minutes integer,status text,stock_tracked boolean,safety_stock numeric,quantity numeric,low_stock boolean)
language plpgsql security invoker set search_path='' as $$ begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'catalog','read');
 if p_item_type not in ('','service','product','package','year_card') or p_status not in ('','active','disabled') or p_limit not between 1 and 500 then raise exception '项目商品查询参数无效';end if;
 return query select i.id,i.code,i.item_type,i.name,i.category,i.list_price,i.member_price,i.cost_price,i.unit,i.duration_minutes,s.status,s.stock_tracked,s.safety_stock,b.quantity,(s.stock_tracked and coalesce(b.quantity,0)<=s.safety_stock)
 from public.salon_catalog_store_settings s join public.salon_catalog_items i on i.organization_id=s.organization_id and i.id=s.catalog_item_id left join public.salon_inventory_balances b on b.organization_id=s.organization_id and b.store_id=s.store_id and b.catalog_item_id=s.catalog_item_id
 where s.organization_id=p_organization_id and s.store_id=p_store_id and (p_item_type='' or i.item_type=p_item_type) and (p_status='' or s.status=p_status) and (btrim(coalesce(p_query,''))='' or i.code ilike '%'||btrim(p_query)||'%' or i.name ilike '%'||btrim(p_query)||'%') order by i.item_type,i.code limit p_limit;
end $$;

-- Tighten the existing movement function to require a current-store inventory setting.
create or replace function public.salon_move_inventory(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_catalog_item_id bigint,p_request_key text,p_movement_type text,p_quantity numeric,p_order_id bigint,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_balance public.salon_inventory_balances;v_delta numeric(14,3);v_after numeric(14,3);v_ledger_id bigint;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'inventory','write');v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'inventory_move','catalog_item',p_catalog_item_id);if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_movement_type not in ('receive','sale','consume','refund') or p_quantity is null or p_quantity<=0 then raise exception '库存操作类型或数量无效';end if;if nullif(btrim(p_reason),'') is null then raise exception '库存原因不能为空';end if;
 if not exists(select 1 from public.salon_catalog_store_settings s join public.salon_catalog_items i on i.organization_id=s.organization_id and i.id=s.catalog_item_id where s.organization_id=p_organization_id and s.store_id=p_store_id and s.catalog_item_id=p_catalog_item_id and s.status='active' and s.stock_tracked and i.item_type='product' and i.status='active') then raise exception '当前门店未启用该商品库存';end if;
 select * into v_balance from public.salon_inventory_balances b where b.organization_id=p_organization_id and b.store_id=p_store_id and b.catalog_item_id=p_catalog_item_id for update;if not found then raise exception '库存余额不存在';end if;
 v_delta:=case when p_movement_type in ('receive','refund') then round(p_quantity,3) else -round(p_quantity,3) end;v_after:=v_balance.quantity+v_delta;if v_after<0 then raise exception '库存不足，不能出库';end if;
 update public.salon_inventory_balances set quantity=v_after,updated_at=now() where organization_id=p_organization_id and store_id=p_store_id and catalog_item_id=p_catalog_item_id;
 insert into public.salon_inventory_ledger(organization_id,store_id,catalog_item_id,movement_type,quantity_delta,quantity_before,quantity_after,order_id,reason) values(p_organization_id,p_store_id,p_catalog_item_id,p_movement_type,v_delta,v_balance.quantity,v_after,p_order_id,btrim(p_reason)) returning id into v_ledger_id;
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'inventory_ledger',v_ledger_id::text,'create',jsonb_build_object('before',v_balance.quantity,'after',v_after,'requestKey',p_request_key),btrim(p_reason));
 v_response:=jsonb_build_object('ledgerId',v_ledger_id,'quantityBefore',v_balance.quantity,'quantityAfter',v_after);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

revoke execute on function public.salon_create_catalog_item(bigint,bigint,bigint,text,text,text,text,text,numeric,numeric,numeric,text,integer,boolean,numeric) from public,anon,authenticated;
revoke execute on function public.salon_enable_catalog_item(bigint,bigint,bigint,bigint,text,boolean,numeric) from public,anon,authenticated;
revoke execute on function public.salon_set_catalog_status(bigint,bigint,bigint,bigint,text,text,text) from public,anon,authenticated;
revoke execute on function public.salon_count_inventory(bigint,bigint,bigint,bigint,text,numeric,text) from public,anon,authenticated;
revoke execute on function public.salon_list_catalog_inventory(bigint,bigint,bigint,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.salon_create_catalog_item(bigint,bigint,bigint,text,text,text,text,text,numeric,numeric,numeric,text,integer,boolean,numeric) to service_role;
grant execute on function public.salon_enable_catalog_item(bigint,bigint,bigint,bigint,text,boolean,numeric) to service_role;
grant execute on function public.salon_set_catalog_status(bigint,bigint,bigint,bigint,text,text,text) to service_role;
grant execute on function public.salon_count_inventory(bigint,bigint,bigint,bigint,text,numeric,text) to service_role;
grant execute on function public.salon_list_catalog_inventory(bigint,bigint,bigint,text,text,text,integer) to service_role;
