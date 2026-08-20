-- ZYSYR V2 Sprint 1: company-scoped service items, products and suppliers.
-- Existing company/store/user/role/employee tables from Sprint 0 are reused.
-- Browser roles receive read-only RLS access. All writes go through audited,
-- service-role-only RPCs so a catalog mutation and its audit event are atomic.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_service_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null),
  category text not null check (nullif(btrim(category), '') is not null),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  unique (company_id, id),
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, deleted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((deleted_at is null) = (deleted_by_user_id is null))
);

create unique index zysyr_service_items_company_name_uidx
  on public.zysyr_service_items (company_id, lower(name), lower(category))
  where deleted_at is null;
create index zysyr_service_items_company_status_idx
  on public.zysyr_service_items (company_id, status, name)
  where deleted_at is null;
create index zysyr_service_items_creator_idx
  on public.zysyr_service_items (company_id, created_by_user_id);
create index zysyr_service_items_updater_idx
  on public.zysyr_service_items (company_id, updated_by_user_id);
create index zysyr_service_items_deleter_idx
  on public.zysyr_service_items (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;

create table public.zysyr_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null),
  category text not null check (nullif(btrim(category), '') is not null),
  unit text not null check (nullif(btrim(unit), '') is not null),
  default_cost numeric(14,4) check (default_cost is null or default_cost >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  unique (company_id, id),
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, deleted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((deleted_at is null) = (deleted_by_user_id is null))
);

create unique index zysyr_products_company_name_uidx
  on public.zysyr_products (company_id, lower(name), lower(category), lower(unit))
  where deleted_at is null;
create index zysyr_products_company_status_idx
  on public.zysyr_products (company_id, status, name)
  where deleted_at is null;
create index zysyr_products_creator_idx
  on public.zysyr_products (company_id, created_by_user_id);
create index zysyr_products_updater_idx
  on public.zysyr_products (company_id, updated_by_user_id);
create index zysyr_products_deleter_idx
  on public.zysyr_products (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;

create table public.zysyr_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null),
  category text,
  contact text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  unique (company_id, id),
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, deleted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((deleted_at is null) = (deleted_by_user_id is null))
);

create unique index zysyr_suppliers_company_name_uidx
  on public.zysyr_suppliers (company_id, lower(name))
  where deleted_at is null;
create index zysyr_suppliers_company_status_idx
  on public.zysyr_suppliers (company_id, status, name)
  where deleted_at is null;
create index zysyr_suppliers_creator_idx
  on public.zysyr_suppliers (company_id, created_by_user_id);
create index zysyr_suppliers_updater_idx
  on public.zysyr_suppliers (company_id, updated_by_user_id);
create index zysyr_suppliers_deleter_idx
  on public.zysyr_suppliers (company_id, deleted_by_user_id)
  where deleted_by_user_id is not null;

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
      from public.zysyr_stores s
      where s.id = target_store_id
        and s.company_id = target_company_id
        and s.status = 'active'
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

create or replace function zysyr_private.has_company_catalog_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg on urg.user_account_id = ua.id
    join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
    join public.zysyr_capabilities c on c.id = rc.capability_id
    where ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and ua.company_id = target_company_id
      and urg.company_id = target_company_id
      and urg.revoked_at is null
      and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
      and c.code in ('dashboard.group.read', 'dashboard.store.read', 'daily_report.write', 'inventory.write')
  )
$$;

revoke execute on function zysyr_private.account_has_capability(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.has_company_catalog_access(uuid)
  from public, anon, authenticated, service_role;
grant usage on schema zysyr_private to authenticated;
grant execute on function zysyr_private.has_company_catalog_access(uuid) to authenticated;

create or replace function public.zysyr_upsert_service_item(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_name text,
  p_category text,
  p_status text,
  p_reason text
)
returns public.zysyr_service_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_service_items;
  v_after public.zysyr_service_items;
  v_action text;
begin
  if not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  ) then
    raise exception using errcode = '42501', message = 'SERVICE_ITEM_WRITE_FORBIDDEN';
  end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_category), '') is null then
    raise exception using errcode = '22023', message = 'SERVICE_ITEM_FIELDS_REQUIRED';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'SERVICE_ITEM_STATUS_INVALID';
  end if;

  if p_id is null then
    insert into public.zysyr_service_items (
      company_id, name, category, status, created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, btrim(p_name), btrim(p_category), p_status,
      p_actor_user_id, p_actor_user_id
    ) returning * into v_after;
    v_action := 'create';
  else
    select * into v_before
    from public.zysyr_service_items
    where id = p_id and company_id = p_company_id and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'SERVICE_ITEM_NOT_FOUND';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
    end if;
    update public.zysyr_service_items
    set name = btrim(p_name),
        category = btrim(p_category),
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
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'service_item', v_after.id, v_action,
    case when v_action = 'update' then to_jsonb(v_before) end,
    to_jsonb(v_after), nullif(btrim(p_reason), '')
  );
  return v_after;
end
$$;

create or replace function public.zysyr_upsert_product(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_name text,
  p_category text,
  p_unit text,
  p_default_cost numeric,
  p_status text,
  p_reason text
)
returns public.zysyr_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_products;
  v_after public.zysyr_products;
  v_action text;
begin
  if not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'inventory.write'
  ) then
    raise exception using errcode = '42501', message = 'PRODUCT_WRITE_FORBIDDEN';
  end if;
  if nullif(btrim(p_name), '') is null
    or nullif(btrim(p_category), '') is null
    or nullif(btrim(p_unit), '') is null then
    raise exception using errcode = '22023', message = 'PRODUCT_FIELDS_REQUIRED';
  end if;
  if p_default_cost is not null and (p_default_cost < 0 or p_default_cost >= 10000000000) then
    raise exception using errcode = '22023', message = 'PRODUCT_COST_INVALID';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'PRODUCT_STATUS_INVALID';
  end if;

  if p_id is null then
    insert into public.zysyr_products (
      company_id, name, category, unit, default_cost, status,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, btrim(p_name), btrim(p_category), btrim(p_unit),
      p_default_cost, p_status, p_actor_user_id, p_actor_user_id
    ) returning * into v_after;
    v_action := 'create';
  else
    select * into v_before
    from public.zysyr_products
    where id = p_id and company_id = p_company_id and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
    end if;
    update public.zysyr_products
    set name = btrim(p_name),
        category = btrim(p_category),
        unit = btrim(p_unit),
        default_cost = p_default_cost,
        status = p_status,
        updated_at = now(),
        updated_by_user_id = p_actor_user_id
    where id = p_id and company_id = p_company_id
    returning * into v_after;
    v_action := 'update';
  end if;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason,
    sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'product', v_after.id, v_action,
    case when v_action = 'update' then to_jsonb(v_before) end,
    to_jsonb(v_after), nullif(btrim(p_reason), ''), 'normal'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_upsert_supplier(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_name text,
  p_category text,
  p_contact text,
  p_status text,
  p_reason text
)
returns public.zysyr_suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_suppliers;
  v_after public.zysyr_suppliers;
  v_action text;
begin
  if not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'inventory.write'
  ) then
    raise exception using errcode = '42501', message = 'SUPPLIER_WRITE_FORBIDDEN';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'SUPPLIER_NAME_REQUIRED';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'SUPPLIER_STATUS_INVALID';
  end if;

  if p_id is null then
    insert into public.zysyr_suppliers (
      company_id, name, category, contact, status,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, btrim(p_name), nullif(btrim(p_category), ''),
      nullif(btrim(p_contact), ''), p_status, p_actor_user_id, p_actor_user_id
    ) returning * into v_after;
    v_action := 'create';
  else
    select * into v_before
    from public.zysyr_suppliers
    where id = p_id and company_id = p_company_id and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'SUPPLIER_NOT_FOUND';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
    end if;
    update public.zysyr_suppliers
    set name = btrim(p_name),
        category = nullif(btrim(p_category), ''),
        contact = nullif(btrim(p_contact), ''),
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
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'supplier', v_after.id, v_action,
    case when v_action = 'update' then to_jsonb(v_before) end,
    to_jsonb(v_after), nullif(btrim(p_reason), '')
  );
  return v_after;
end
$$;

revoke execute on function public.zysyr_upsert_service_item(uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_upsert_product(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_upsert_supplier(uuid, uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_upsert_service_item(uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;
grant execute on function public.zysyr_upsert_product(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text)
  to service_role;
grant execute on function public.zysyr_upsert_supplier(uuid, uuid, uuid, uuid, text, text, text, text, text)
  to service_role;

alter table public.zysyr_service_items enable row level security;
alter table public.zysyr_service_items force row level security;
alter table public.zysyr_products enable row level security;
alter table public.zysyr_products force row level security;
alter table public.zysyr_suppliers enable row level security;
alter table public.zysyr_suppliers force row level security;

create policy zysyr_service_items_catalog_select
on public.zysyr_service_items for select to authenticated
using (
  deleted_at is null
  and (select zysyr_private.has_company_catalog_access(company_id))
);

create policy zysyr_products_catalog_select
on public.zysyr_products for select to authenticated
using (
  deleted_at is null
  and (select zysyr_private.has_company_catalog_access(company_id))
);

create policy zysyr_suppliers_catalog_select
on public.zysyr_suppliers for select to authenticated
using (
  deleted_at is null
  and (select zysyr_private.has_company_catalog_access(company_id))
);

revoke all on table public.zysyr_service_items from public, anon, authenticated, service_role;
revoke all on table public.zysyr_products from public, anon, authenticated, service_role;
revoke all on table public.zysyr_suppliers from public, anon, authenticated, service_role;

grant select on table
  public.zysyr_service_items,
  public.zysyr_products,
  public.zysyr_suppliers
to authenticated;

grant select, insert, update on table
  public.zysyr_service_items,
  public.zysyr_products,
  public.zysyr_suppliers
to service_role;

comment on table public.zysyr_service_items is
  'V2 company service-item catalog. No Meiguanjia synchronization or cashier data is used.';
comment on table public.zysyr_products is
  'V2 company product catalog. Inventory quantities remain in Sprint 5 transaction tables.';
comment on table public.zysyr_suppliers is
  'V2 company supplier catalog. Writes are service-role RPC only and atomically audited.';
