-- v410: editable amount and amount explanation in the independent frontdesk ledger.
-- The imported raw_row and all Meiguanjia/customer master records remain untouched.

alter table public.frontdesk_today_customers
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists payment_summary text not null default '';

comment on column public.frontdesk_today_customers.amount is
  'Frontdesk-only amount; does not create or change a Meiguanjia cashier transaction.';
comment on column public.frontdesk_today_customers.payment_summary is
  'Frontdesk-only amount explanation such as payment method, discount, or package usage.';
comment on column public.frontdesk_import_records.amount is
  'Editable frontdesk ledger amount; the original imported value remains in raw_row.';
comment on column public.frontdesk_import_records.payment_summary is
  'Editable frontdesk ledger amount explanation; the original imported value remains in raw_row.';

alter table public.frontdesk_today_customers enable row level security;
revoke all on table public.frontdesk_today_customers from public, anon, authenticated;
grant all on table public.frontdesk_today_customers to service_role;
