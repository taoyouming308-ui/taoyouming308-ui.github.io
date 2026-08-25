-- v432: frontdesk-only note attached to the first-visit (新客) flag.
-- Never touches customer_profiles or Meiguanjia cashier records.

alter table public.frontdesk_today_customers
  add column if not exists new_customer_note text not null default '';

comment on column public.frontdesk_today_customers.new_customer_note is
  'Frontdesk-only note for first-visit customers; does not change customer_profiles or Meiguanjia.';

alter table public.frontdesk_today_customers enable row level security;
revoke all on table public.frontdesk_today_customers from public, anon, authenticated;
grant all on table public.frontdesk_today_customers to service_role;
