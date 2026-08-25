-- v433: frontdesk-only first-visit (新客) flag for daily reception rows.
-- Never touches customer_profiles or Meiguanjia cashier records.

alter table public.frontdesk_today_customers
  add column if not exists is_new_customer boolean not null default false;

comment on column public.frontdesk_today_customers.is_new_customer is
  'Frontdesk-only first-visit flag; does not change customer_profiles or Meiguanjia.';

alter table public.frontdesk_today_customers enable row level security;
revoke all on table public.frontdesk_today_customers from public, anon, authenticated;
grant all on table public.frontdesk_today_customers to service_role;
