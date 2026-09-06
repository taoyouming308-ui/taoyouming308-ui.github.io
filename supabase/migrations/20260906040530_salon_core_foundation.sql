-- Independent salon operating-system foundation.
-- Local/test only until the full parity suite is accepted. Browser roles receive
-- no direct table grants; a later salon-api will enforce sessions and store scope.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.salon_organizations (
  id bigint generated always as identity primary key,
  name text not null check (nullif(btrim(name), '') is not null),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);

create table public.salon_stores (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.salon_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, id)
);
create index salon_stores_org_status_idx on public.salon_stores (organization_id, status);

create table public.salon_roles (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.salon_organizations(id) on delete restrict,
  name text not null,
  data_scope text not null check (data_scope in ('self','store','organization')),
  status text not null default 'active' check (status in ('active','disabled')),
  unique (organization_id, name), unique (organization_id, id)
);
create index salon_roles_org_idx on public.salon_roles (organization_id);

create table public.salon_role_permissions (
  role_id bigint not null references public.salon_roles(id) on delete cascade,
  resource text not null,
  action text not null,
  primary key (role_id, resource, action)
);

create table public.salon_staff (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  role_id bigint,
  staff_no text not null,
  display_name text not null,
  position text not null default '',
  level_name text not null default '',
  employment_status text not null default 'active'
    check (employment_status in ('pending','active','leave','transferred','departed')),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (organization_id, staff_no), unique (organization_id, id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, role_id) references public.salon_roles(organization_id, id) on delete restrict
);
create index salon_staff_store_status_idx on public.salon_staff (organization_id, store_id, employment_status);

create table public.salon_customers (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.salon_organizations(id) on delete restrict,
  display_name text not null default '',
  phone_normalized text,
  birthday date,
  status text not null default 'active' check (status in ('active','frozen','anonymized')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index salon_customers_phone_active_idx
  on public.salon_customers (organization_id, phone_normalized)
  where phone_normalized is not null and status <> 'anonymized';

create table public.salon_customer_store_relations (
  organization_id bigint not null,
  store_id bigint not null,
  customer_id bigint not null,
  owner_staff_id bigint,
  source text not null default 'walkin',
  tags text[] not null default '{}',
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  primary key (store_id, customer_id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.salon_customers(organization_id, id) on delete restrict,
  foreign key (organization_id, owner_staff_id) references public.salon_staff(organization_id, id) on delete restrict
);
create index salon_customer_rel_customer_idx on public.salon_customer_store_relations (organization_id, customer_id);

create table public.salon_catalog_items (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.salon_organizations(id) on delete restrict,
  item_type text not null check (item_type in ('service','product','package','year_card')),
  code text not null,
  name text not null,
  category text not null default '',
  list_price numeric(12,2) not null default 0 check (list_price >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 1440),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, id)
);
create index salon_catalog_type_status_idx on public.salon_catalog_items (organization_id, item_type, status);

create table public.salon_appointments (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  customer_id bigint,
  staff_id bigint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','arrived','completed','cancelled','no_show')),
  source text not null default 'staff',
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at), unique (organization_id, id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.salon_customers(organization_id, id) on delete restrict,
  foreign key (organization_id, staff_id) references public.salon_staff(organization_id, id) on delete restrict
);
create index salon_appointments_schedule_idx on public.salon_appointments (organization_id, store_id, staff_id, starts_at);
create index salon_appointments_open_idx on public.salon_appointments (organization_id, store_id, starts_at)
  where status in ('pending','confirmed','arrived');

create table public.salon_orders (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  order_no text not null,
  customer_id bigint,
  appointment_id bigint,
  status text not null default 'draft'
    check (status in ('draft','opened','in_service','awaiting_payment','paid','cancelled','reversed')),
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  payable_total numeric(12,2) not null default 0,
  opened_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, order_no), unique (organization_id, id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.salon_customers(organization_id, id) on delete restrict,
  foreign key (organization_id, appointment_id) references public.salon_appointments(organization_id, id) on delete restrict
);
create index salon_orders_store_created_idx on public.salon_orders (organization_id, store_id, created_at desc);
create index salon_orders_customer_idx on public.salon_orders (organization_id, customer_id, created_at desc);
create index salon_orders_open_idx on public.salon_orders (organization_id, store_id, status, created_at) where status not in ('paid','cancelled','reversed');

create table public.salon_order_lines (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  order_id bigint not null,
  catalog_item_id bigint not null,
  staff_id bigint,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  service_status text not null default 'pending'
    check (service_status in ('pending','in_service','completed','cancelled')),
  unique (organization_id, id),
  foreign key (organization_id, order_id) references public.salon_orders(organization_id, id) on delete restrict,
  foreign key (organization_id, catalog_item_id) references public.salon_catalog_items(organization_id, id) on delete restrict,
  foreign key (organization_id, staff_id) references public.salon_staff(organization_id, id) on delete restrict
);
create index salon_order_lines_order_idx on public.salon_order_lines (organization_id, order_id);

create table public.salon_member_accounts (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  customer_id bigint not null,
  account_type text not null check (account_type in ('stored_value','package','times_card')),
  account_no text not null,
  status text not null default 'active' check (status in ('pending','active','frozen','expired','closed')),
  cash_balance numeric(12,2) not null default 0,
  bonus_balance numeric(12,2) not null default 0,
  remaining_units numeric(12,3),
  expires_on date,
  unique (organization_id, account_no), unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.salon_customers(organization_id, id) on delete restrict
);
create index salon_member_accounts_customer_idx on public.salon_member_accounts (organization_id, customer_id, status);

create table public.salon_account_ledger (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  account_id bigint not null,
  order_id bigint,
  entry_type text not null check (entry_type in ('open','recharge','bonus','consume','refund','expire','reverse')),
  cash_delta numeric(12,2) not null default 0,
  bonus_delta numeric(12,2) not null default 0,
  units_delta numeric(12,3) not null default 0,
  reversal_of_id bigint,
  reason text not null default '',
  occurred_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, account_id) references public.salon_member_accounts(organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.salon_orders(organization_id, id) on delete restrict,
  foreign key (organization_id, reversal_of_id) references public.salon_account_ledger(organization_id, id) on delete restrict
);
create index salon_account_ledger_account_idx on public.salon_account_ledger (organization_id, account_id, occurred_at desc);

create table public.salon_payments (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint not null,
  order_id bigint not null,
  payment_method text not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'confirmed' check (status in ('pending','confirmed','failed','reversed')),
  reversal_of_id bigint,
  confirmed_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.salon_orders(organization_id, id) on delete restrict,
  foreign key (organization_id, reversal_of_id) references public.salon_payments(organization_id, id) on delete restrict
);
create index salon_payments_order_idx on public.salon_payments (organization_id, order_id);

create table public.salon_audit_events (
  id bigint generated always as identity primary key,
  organization_id bigint not null,
  store_id bigint,
  actor_staff_id bigint,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  reason text not null default '',
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, store_id) references public.salon_stores(organization_id, id) on delete restrict,
  foreign key (organization_id, actor_staff_id) references public.salon_staff(organization_id, id) on delete restrict
);
create index salon_audit_scope_idx on public.salon_audit_events (organization_id, store_id, occurred_at desc);
create index salon_audit_entity_idx on public.salon_audit_events (organization_id, entity_type, entity_id, occurred_at desc);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'salon_organizations','salon_stores','salon_roles','salon_role_permissions','salon_staff',
    'salon_customers','salon_customer_store_relations','salon_catalog_items','salon_appointments',
    'salon_orders','salon_order_lines','salon_member_accounts','salon_account_ledger',
    'salon_payments','salon_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
