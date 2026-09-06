set statement_timeout='30s';
set lock_timeout='5s';
create function public.salon_get_store_time_context(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_zone text;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'customer_portal','manage');
 select timezone into v_zone from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active';
 if v_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception '门店时区配置无效';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'timeZone',v_zone);
end$$;
create function public.salon_customer_get_store_time_context(p_auth_user_id uuid,p_organization_id bigint,p_store_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_zone text;
begin
 perform salon_private.assert_customer_read_scope(p_auth_user_id,p_organization_id,p_store_id);
 select timezone into v_zone from public.salon_stores where organization_id=p_organization_id and id=p_store_id and status='active';
 if v_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception '门店时区配置无效';end if;
 return jsonb_build_object('organizationId',p_organization_id,'storeId',p_store_id,'timeZone',v_zone);
end$$;
revoke execute on function public.salon_get_store_time_context(bigint,bigint,bigint),public.salon_customer_get_store_time_context(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.salon_get_store_time_context(bigint,bigint,bigint),public.salon_customer_get_store_time_context(uuid,bigint,bigint) to service_role;
