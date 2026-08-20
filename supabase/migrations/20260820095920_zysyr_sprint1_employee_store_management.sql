-- ZYSYR V2 Sprint 1: employee and store administration.
-- Existing legacy rows stay valid. New writes require an active Supabase Auth
-- account, an explicit capability grant, and an audit event in one transaction.

set statement_timeout = '30s';

alter table public.zysyr_employees
  add column if not exists created_by_user_id uuid,
  add column if not exists updated_by_user_id uuid,
  add column if not exists deleted_by_user_id uuid;

alter table public.zysyr_stores
  add column if not exists created_by_user_id uuid,
  add column if not exists updated_by_user_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_employees_created_by_user_fkey'
      and conrelid = 'public.zysyr_employees'::regclass
  ) then
    alter table public.zysyr_employees
      add constraint zysyr_employees_created_by_user_fkey
      foreign key (company_id, created_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_employees_updated_by_user_fkey'
      and conrelid = 'public.zysyr_employees'::regclass
  ) then
    alter table public.zysyr_employees
      add constraint zysyr_employees_updated_by_user_fkey
      foreign key (company_id, updated_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_employees_deleted_by_user_fkey'
      and conrelid = 'public.zysyr_employees'::regclass
  ) then
    alter table public.zysyr_employees
      add constraint zysyr_employees_deleted_by_user_fkey
      foreign key (company_id, deleted_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_created_by_user_fkey'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_created_by_user_fkey
      foreign key (company_id, created_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_updated_by_user_fkey'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_updated_by_user_fkey
      foreign key (company_id, updated_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_deleted_by_user_fkey'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_deleted_by_user_fkey
      foreign key (company_id, deleted_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_stores_manager_employee_fkey'
      and conrelid = 'public.zysyr_stores'::regclass
  ) then
    alter table public.zysyr_stores
      add constraint zysyr_stores_manager_employee_fkey
      foreign key (company_id, manager_employee_id)
      references public.zysyr_employees(company_id, id) on delete restrict;
  end if;
end $$;

create index if not exists zysyr_employees_created_by_idx
  on public.zysyr_employees (company_id, created_by_user_id)
  where created_by_user_id is not null;
create index if not exists zysyr_employees_updated_by_idx
  on public.zysyr_employees (company_id, updated_by_user_id)
  where updated_by_user_id is not null;
create index if not exists zysyr_employees_deleted_by_idx
  on public.zysyr_employees (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;
create index if not exists zysyr_stores_created_by_idx
  on public.zysyr_stores (company_id, created_by_user_id)
  where created_by_user_id is not null;
create index if not exists zysyr_stores_updated_by_idx
  on public.zysyr_stores (company_id, updated_by_user_id)
  where updated_by_user_id is not null;
create index if not exists zysyr_stores_deleted_by_idx
  on public.zysyr_stores (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;
create index if not exists zysyr_stores_manager_employee_idx
  on public.zysyr_stores (company_id, manager_employee_id)
  where manager_employee_id is not null;

insert into public.zysyr_capabilities (code, name, risk_level)
values
  ('employee.write', '维护授权范围员工资料', 'sensitive'),
  ('org.store.write', '维护公司门店资料', 'high')
on conflict (code) do update
set name = excluded.name,
    risk_level = excluded.risk_level,
    updated_at = now();

with role_capability(role_code, capability_code) as (
  values
    ('shareholder', 'employee.read'),
    ('finance', 'employee.write'),
    ('store_manager', 'employee.write')
)
insert into public.zysyr_role_capabilities (role_id, capability_id)
select r.id, c.id
from role_capability rc
join public.zysyr_roles r on r.code = rc.role_code
join public.zysyr_capabilities c on c.code = rc.capability_code
on conflict (role_id, capability_id) do nothing;

insert into public.zysyr_user_capability_grants (
  company_id, user_account_id, capability_id, scope_type, store_id,
  valid_from, granted_by_user_id
)
select
  grant_row.company_id,
  grant_row.user_account_id,
  store_capability.id,
  'company',
  null,
  current_date,
  grant_row.user_account_id
from public.zysyr_user_capability_grants grant_row
join public.zysyr_capabilities creator_capability
  on creator_capability.id = grant_row.capability_id
 and creator_capability.code = 'finance_account.create'
join public.zysyr_capabilities store_capability
  on store_capability.code = 'org.store.write'
join public.zysyr_user_accounts account
  on account.id = grant_row.user_account_id
 and account.company_id = grant_row.company_id
 and account.status = 'active'
join public.zysyr_companies company
  on company.id = grant_row.company_id
 and company.status = 'active'
where grant_row.scope_type = 'company'
  and grant_row.store_id is null
  and grant_row.revoked_at is null
  and grant_row.valid_from <= current_date
  and (grant_row.valid_to is null or grant_row.valid_to >= current_date)
on conflict (company_id, user_account_id, capability_id)
  where scope_type = 'company' and store_id is null and revoked_at is null
do nothing;

insert into public.zysyr_audit_events (
  company_id, actor_type, actor_user_id, channel,
  entity_type, entity_id, action, after_json, reason
)
select
  store_grant.company_id,
  'user',
  store_grant.user_account_id,
  'migration',
  'user_capability_grant',
  store_grant.capability_id,
  'store_administrator_enabled',
  jsonb_build_object(
    'capability_code', 'org.store.write',
    'scope_type', 'company',
    'inherited_from', 'finance_account.create'
  ),
  'Reuses the explicitly approved Gate C3 administrator boundary for store maintenance.'
from public.zysyr_user_capability_grants store_grant
join public.zysyr_capabilities store_capability
  on store_capability.id = store_grant.capability_id
 and store_capability.code = 'org.store.write'
where store_grant.scope_type = 'company'
  and store_grant.store_id is null
  and store_grant.revoked_at is null
  and exists (
    select 1
    from public.zysyr_user_capability_grants creator_grant
    join public.zysyr_capabilities creator_capability
      on creator_capability.id = creator_grant.capability_id
     and creator_capability.code = 'finance_account.create'
    where creator_grant.company_id = store_grant.company_id
      and creator_grant.user_account_id = store_grant.user_account_id
      and creator_grant.scope_type = 'company'
      and creator_grant.store_id is null
      and creator_grant.revoked_at is null
      and creator_grant.valid_from <= current_date
      and (creator_grant.valid_to is null or creator_grant.valid_to >= current_date)
  )
  and not exists (
    select 1
    from public.zysyr_audit_events event
    where event.company_id = store_grant.company_id
      and event.actor_user_id = store_grant.user_account_id
      and event.entity_type = 'user_capability_grant'
      and event.entity_id = store_grant.capability_id
      and event.action = 'store_administrator_enabled'
  );

create or replace function zysyr_private.account_has_capability(
  target_user_account_id uuid,
  target_company_id uuid,
  target_store_id uuid,
  target_capability_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_account_id is not null
    and target_company_id is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.zysyr_companies company
      where company.id = target_company_id and company.status = 'active'
    )
    and exists (
      select 1
      from public.zysyr_stores store
      where store.id = target_store_id
        and store.company_id = target_company_id
        and store.status = 'active'
        and store.deleted_at is null
    )
    and exists (
      select 1
      from public.zysyr_user_accounts ua
      where ua.id = target_user_account_id
        and ua.company_id = target_company_id
        and ua.status = 'active'
        and (
          exists (
            select 1
            from public.zysyr_user_role_grants urg
            join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
            join public.zysyr_capabilities c on c.id = rc.capability_id
            where urg.user_account_id = ua.id
              and urg.company_id = target_company_id
              and urg.revoked_at is null
              and urg.valid_from <= current_date
              and (urg.valid_to is null or urg.valid_to >= current_date)
              and c.code = target_capability_code
              and (
                urg.scope_type = 'company'
                or (urg.scope_type = 'store' and urg.store_id = target_store_id)
              )
          )
          or exists (
            select 1
            from public.zysyr_user_capability_grants ucg
            join public.zysyr_capabilities c on c.id = ucg.capability_id
            where ucg.user_account_id = ua.id
              and ucg.company_id = target_company_id
              and ucg.revoked_at is null
              and ucg.valid_from <= current_date
              and (ucg.valid_to is null or ucg.valid_to >= current_date)
              and c.code = target_capability_code
              and (
                ucg.scope_type = 'company'
                or (ucg.scope_type = 'store' and ucg.store_id = target_store_id)
              )
          )
        )
    )
$$;

revoke execute on function zysyr_private.account_has_capability(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function zysyr_private.account_has_company_capability(
  target_user_account_id uuid,
  target_company_id uuid,
  target_capability_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_account_id is not null
    and target_company_id is not null
    and exists (
      select 1
      from public.zysyr_companies company
      where company.id = target_company_id and company.status = 'active'
    )
    and exists (
      select 1
      from public.zysyr_user_accounts ua
      where ua.id = target_user_account_id
        and ua.company_id = target_company_id
        and ua.status = 'active'
        and (
          exists (
            select 1
            from public.zysyr_user_role_grants urg
            join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
            join public.zysyr_capabilities c on c.id = rc.capability_id
            where urg.user_account_id = ua.id
              and urg.company_id = target_company_id
              and urg.scope_type = 'company'
              and urg.revoked_at is null
              and urg.valid_from <= current_date
              and (urg.valid_to is null or urg.valid_to >= current_date)
              and c.code = target_capability_code
          )
          or exists (
            select 1
            from public.zysyr_user_capability_grants ucg
            join public.zysyr_capabilities c on c.id = ucg.capability_id
            where ucg.user_account_id = ua.id
              and ucg.company_id = target_company_id
              and ucg.scope_type = 'company'
              and ucg.revoked_at is null
              and ucg.valid_from <= current_date
              and (ucg.valid_to is null or ucg.valid_to >= current_date)
              and c.code = target_capability_code
          )
        )
    )
$$;

revoke execute on function zysyr_private.account_has_company_capability(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.zysyr_upsert_employee(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_employee_code text,
  p_name text,
  p_position text,
  p_level text,
  p_join_date date,
  p_leave_date date,
  p_employment_status text,
  p_reason text
)
returns public.zysyr_employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_employees;
  v_after public.zysyr_employees;
  v_action text;
begin
  if not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'employee.write'
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_WRITE_FORBIDDEN';
  end if;
  if nullif(btrim(p_employee_code), '') is null
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_position), '') is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_FIELDS_REQUIRED';
  end if;
  if p_employment_status is null
     or p_employment_status not in ('active', 'inactive', 'departed') then
    raise exception using errcode = '22023', message = 'EMPLOYEE_STATUS_INVALID';
  end if;
  if p_leave_date is not null and p_join_date is not null and p_leave_date < p_join_date then
    raise exception using errcode = '22023', message = 'EMPLOYEE_DATE_INVALID';
  end if;

  if p_id is null then
    insert into public.zysyr_employees (
      company_id, store_id, employee_code, name, position, level,
      join_date, leave_date, employment_status,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, p_store_id, btrim(p_employee_code), btrim(p_name),
      btrim(p_position), nullif(btrim(p_level), ''), p_join_date, p_leave_date,
      p_employment_status, p_actor_user_id, p_actor_user_id
    ) returning * into v_after;
    v_action := 'create';
  else
    select * into v_before
    from public.zysyr_employees
    where id = p_id and company_id = p_company_id and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
    end if;
    if v_before.store_id <> p_store_id
       and not zysyr_private.account_has_capability(
         p_actor_user_id, p_company_id, v_before.store_id, 'employee.write'
       ) then
      raise exception using errcode = '42501', message = 'EMPLOYEE_SOURCE_STORE_FORBIDDEN';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
    end if;
    update public.zysyr_employees
    set store_id = p_store_id,
        employee_code = btrim(p_employee_code),
        name = btrim(p_name),
        position = btrim(p_position),
        level = nullif(btrim(p_level), ''),
        join_date = p_join_date,
        leave_date = p_leave_date,
        employment_status = p_employment_status,
        updated_at = now(),
        updated_by_user_id = p_actor_user_id
    where id = p_id and company_id = p_company_id
    returning * into v_after;
    v_action := 'update';
  end if;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'employee', v_after.id, v_action,
    case when v_action = 'update' then to_jsonb(v_before) end,
    to_jsonb(v_after), nullif(btrim(p_reason), ''), 'personal'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_upsert_store(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_id uuid,
  p_name text,
  p_code text,
  p_city text,
  p_address text,
  p_manager_employee_id uuid,
  p_status text,
  p_reason text
)
returns public.zysyr_stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_stores;
  v_after public.zysyr_stores;
  v_action text;
begin
  if not zysyr_private.account_has_company_capability(
    p_actor_user_id, p_company_id, 'org.store.write'
  ) then
    raise exception using errcode = '42501', message = 'STORE_WRITE_FORBIDDEN';
  end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_code), '') is null then
    raise exception using errcode = '22023', message = 'STORE_FIELDS_REQUIRED';
  end if;
  if btrim(p_code) !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
    raise exception using errcode = '22023', message = 'STORE_CODE_INVALID';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'STORE_STATUS_INVALID';
  end if;

  if p_id is null then
    if p_manager_employee_id is not null then
      raise exception using errcode = '22023', message = 'STORE_MANAGER_ON_CREATE_INVALID';
    end if;
    insert into public.zysyr_stores (
      company_id, name, code, city, address, status, created_by,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, btrim(p_name), btrim(p_code), coalesce(btrim(p_city), ''),
      nullif(btrim(p_address), ''), p_status, 'v2_auth:' || p_actor_user_id::text,
      p_actor_user_id, p_actor_user_id
    ) returning * into v_after;
    v_action := 'create';
  else
    select * into v_before
    from public.zysyr_stores
    where id = p_id and company_id = p_company_id and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'STORE_NOT_FOUND';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
    end if;
    if p_manager_employee_id is not null and not exists (
      select 1
      from public.zysyr_employees e
      where e.id = p_manager_employee_id
        and e.company_id = p_company_id
        and e.store_id = p_id
        and e.employment_status = 'active'
        and e.deleted_at is null
    ) then
      raise exception using errcode = '22023', message = 'STORE_MANAGER_INVALID';
    end if;
    update public.zysyr_stores
    set name = btrim(p_name),
        code = btrim(p_code),
        city = coalesce(btrim(p_city), ''),
        address = nullif(btrim(p_address), ''),
        manager_employee_id = p_manager_employee_id,
        status = p_status,
        updated_at = now(),
        updated_by_user_id = p_actor_user_id
    where id = p_id and company_id = p_company_id
    returning * into v_after;
    v_action := 'update';
  end if;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason
  ) values (
    p_company_id, v_after.id, 'user', p_actor_user_id, 'api',
    'store', v_after.id, v_action,
    case when v_action = 'update' then to_jsonb(v_before) end,
    to_jsonb(v_after), nullif(btrim(p_reason), '')
  );
  return v_after;
end
$$;

revoke execute on function public.zysyr_upsert_employee(
  uuid, uuid, uuid, uuid, text, text, text, text, date, date, text, text
) from public, anon, authenticated;
revoke execute on function public.zysyr_upsert_store(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.zysyr_upsert_employee(
  uuid, uuid, uuid, uuid, text, text, text, text, date, date, text, text
) to service_role;
grant execute on function public.zysyr_upsert_store(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) to service_role;

comment on function public.zysyr_upsert_employee(
  uuid, uuid, uuid, uuid, text, text, text, text, date, date, text, text
) is 'Creates or updates an employee in an authorized store and writes an atomic before/after audit event.';
comment on function public.zysyr_upsert_store(
  uuid, uuid, uuid, text, text, text, text, uuid, text, text
) is 'Creates or updates a company store through company-scoped authorization with an atomic audit event.';
