-- 独立于客户档案和美管加收银的“当天前台接待记录”。
-- 浏览器不能直接访问，只能由 frontdesk-api 使用 service_role 读写。

create table if not exists public.frontdesk_today_customers (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  store text not null,
  customer_name text not null,
  customer_phone text not null default '',
  barber_name text not null,
  visit_source text not null default 'walkin'
    check (visit_source in ('walkin', 'appointment', 'referral', 'other')),
  service_intent text not null default '',
  reception_notes text not null default '',
  status text not null default 'waiting'
    check (status in ('waiting', 'arrived', 'in_service', 'completed', 'cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists frontdesk_today_customers_store_date_barber_idx
  on public.frontdesk_today_customers (store, business_date desc, barber_name, status);
create index if not exists frontdesk_today_customers_phone_date_idx
  on public.frontdesk_today_customers (customer_phone, business_date desc);

alter table public.frontdesk_today_customers enable row level security;
revoke all on table public.frontdesk_today_customers from public, anon, authenticated;
grant all on table public.frontdesk_today_customers to service_role;

comment on table public.frontdesk_today_customers is
  'Daily reception snapshots for the iPad front desk; not a customer master record and not a cashier ledger.';
