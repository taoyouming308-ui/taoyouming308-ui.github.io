-- v432: frontdesk-only flag for a qualified assistant shampoo.
-- Never touches customer_profiles or Meiguanjia cashier records.

alter table public.frontdesk_today_customers
  add column if not exists shampoo_qualified boolean not null default false;

comment on column public.frontdesk_today_customers.shampoo_qualified is
  'Frontdesk-only flag for a qualified assistant shampoo; does not change customer_profiles or Meiguanjia.';

alter table public.frontdesk_today_customers enable row level security;
revoke all on table public.frontdesk_today_customers from public, anon, authenticated;
grant all on table public.frontdesk_today_customers to service_role;
