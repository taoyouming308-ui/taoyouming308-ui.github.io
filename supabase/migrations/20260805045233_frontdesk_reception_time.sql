alter table public.frontdesk_today_customers
  add column if not exists arrival_time time without time zone;

create index if not exists frontdesk_today_customers_schedule_idx
  on public.frontdesk_today_customers (store, business_date, barber_name, arrival_time);

comment on column public.frontdesk_today_customers.arrival_time is
  'Frontdesk-only planned/arrival time used by the iPad stylist timeline; does not change customer master data or Meiguanjia bookings.';
