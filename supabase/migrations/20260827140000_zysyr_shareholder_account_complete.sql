-- ZYSYR: complete shareholder account creation (company or store scope, read-only capabilities)
create or replace function public.zysyr_admin_complete_shareholder_account(
  p_actor_auth_user_id uuid,
  p_account_id uuid,
  p_auth_user_id uuid,
  p_login_name text,
  p_display_name text,
  p_scope_type text,
  p_store_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_shareholder_role_id uuid;
  v_expected_email text;
  v_auth record;
  v_store record;
begin
  if p_actor_auth_user_id is null
     or p_account_id is null
     or p_auth_user_id is null
     or p_request_id is null then
    raise exception 'required identity is missing';
  end if;

  if p_login_name is null
     or p_login_name <> lower(btrim(p_login_name))
     or p_login_name !~ '^[a-z0-9_一-龥-]{2,40}$' then
    raise exception 'invalid shareholder login name';
  end if;

  if p_display_name is null
     or btrim(p_display_name) = ''
     or char_length(btrim(p_display_name)) > 80 then
    raise exception 'invalid shareholder display name';
  end if;

  if (p_scope_type = 'company' and p_store_id is not null)
     or (p_scope_type = 'store' and p_store_id is null)
     or p_scope_type not in ('company', 'store') then
    raise exception 'invalid shareholder scope';
  end if;

  select ua.id, ua.company_id, ua.login_name
  into v_actor
  from public.zysyr_user_accounts ua
  where ua.auth_user_id = p_actor_auth_user_id
    and ua.status = 'active'
  for update;

  if not found or not exists (
    select 1
    from public.zysyr_user_capability_grants g
    join public.zysyr_capabilities c on c.id = g.capability_id
    where g.company_id = v_actor.company_id
      and g.user_account_id = v_actor.id
      and g.scope_type = 'company'
      and g.store_id is null
      and g.revoked_at is null
      and g.valid_from <= current_date
      and (g.valid_to is null or g.valid_to >= current_date)
      and c.code = 'finance_account.create'
  ) then
    raise exception 'shareholder account creation is not authorized';
  end if;

  select id into strict v_shareholder_role_id
  from public.zysyr_roles
  where code = 'shareholder' and status = 'active';

  if p_scope_type = 'store' then
    select id, name into v_store
    from public.zysyr_stores
    where company_id = v_actor.company_id
      and id = p_store_id
      and status = 'active';
    if not found then
      raise exception 'shareholder store scope is not active';
    end if;
  end if;

  v_expected_email := 'zysyr_account_'
    || replace(p_account_id::text, '-', '')
    || '@auth.zysyr.invalid';

  select id, email, email_confirmed_at, raw_app_meta_data
  into v_auth
  from auth.users
  where id = p_auth_user_id;

  if not found
     or lower(coalesce(v_auth.email, '')) <> v_expected_email
     or v_auth.email_confirmed_at is null
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_account_id', '') <> p_account_id::text
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_company_id', '') <> v_actor.company_id::text
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_login_name', '') <> p_login_name
     or coalesce(v_auth.raw_app_meta_data ->> 'zysyr_role', '') <> 'shareholder' then
    raise exception 'Supabase Auth shareholder identity does not match the request';
  end if;

  if exists (
    select 1
    from public.zysyr_user_accounts ua
    where ua.auth_user_id = p_auth_user_id
       or ua.id = p_account_id
       or (ua.company_id = v_actor.company_id and lower(btrim(ua.login_name)) = p_login_name)
  ) then
    raise exception 'shareholder login name or identity already exists';
  end if;

  insert into public.zysyr_user_accounts (
    id,
    company_id,
    auth_user_id,
    employee_id,
    display_name,
    login_name,
    status,
    activated_at
  ) values (
    p_account_id,
    v_actor.company_id,
    p_auth_user_id,
    null,
    btrim(p_display_name),
    p_login_name,
    'active',
    now()
  );

  insert into public.zysyr_user_role_grants (
    company_id,
    user_account_id,
    role_id,
    scope_type,
    store_id,
    valid_from,
    granted_by_user_id
  ) values (
    v_actor.company_id,
    p_account_id,
    v_shareholder_role_id,
    p_scope_type,
    p_store_id,
    current_date,
    v_actor.id
  );

  insert into public.zysyr_audit_events (
    company_id,
    store_id,
    actor_type,
    actor_user_id,
    request_id,
    channel,
    entity_type,
    entity_id,
    action,
    after_json,
    reason,
    sensitivity
  ) values (
    v_actor.company_id,
    p_store_id,
    'user',
    v_actor.id,
    p_request_id,
    'api',
    'user_account',
    p_account_id,
    'shareholder_account_created',
    jsonb_build_object(
      'login_name', p_login_name,
      'display_name', btrim(p_display_name),
      'role_code', 'shareholder',
      'scope_type', p_scope_type,
      'store_id', p_store_id,
      'password_storage', 'supabase_auth_only',
      'email_exposed', false
    ),
    'Administrator created a shareholder account from the secure operations dashboard entry.',
    'personal'
  );

  return jsonb_build_object(
    'account_id', p_account_id,
    'login_name', p_login_name,
    'display_name', btrim(p_display_name),
    'role_code', 'shareholder',
    'scope_type', p_scope_type,
    'store_id', p_store_id,
    'store_name', case when p_scope_type = 'store' then v_store.name else null end,
    'status', 'active'
  );
end
$$;

grant execute on function public.zysyr_admin_complete_shareholder_account(uuid, uuid, uuid, text, text, text, uuid, uuid) to service_role;
