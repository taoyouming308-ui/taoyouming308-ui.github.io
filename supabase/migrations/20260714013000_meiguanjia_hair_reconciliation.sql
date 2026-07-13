create table if not exists public.mgj_service_records (
  source_id text primary key,
  bill_no text not null default '',
  customer_phone text not null default '',
  customer_name text not null default '',
  shop_name text not null default '',
  service_date date not null,
  service_time text,
  staff text[] not null default '{}',
  items jsonb not null default '[]'::jsonb,
  service_types text[] not null default '{}',
  amount numeric not null default 0,
  source text not null default 'meiguanjia',
  synced_at timestamptz not null default now(),
  constraint mgj_service_records_types_check
    check (service_types <@ array['perm','dye','care']::text[])
);

create index if not exists mgj_service_records_date_idx
  on public.mgj_service_records (service_date desc);
create index if not exists mgj_service_records_phone_idx
  on public.mgj_service_records (customer_phone, service_date desc);
create index if not exists mgj_service_records_shop_idx
  on public.mgj_service_records (shop_name, service_date desc);

alter table public.mgj_service_records enable row level security;

drop policy if exists "mgj service records readable" on public.mgj_service_records;
create policy "mgj service records readable"
  on public.mgj_service_records for select to anon, authenticated
  using (true);

drop policy if exists "mgj service records sync insert" on public.mgj_service_records;
create policy "mgj service records sync insert"
  on public.mgj_service_records for insert to anon, authenticated
  with check (source = 'meiguanjia');

drop policy if exists "mgj service records sync update" on public.mgj_service_records;
create policy "mgj service records sync update"
  on public.mgj_service_records for update to anon, authenticated
  using (source = 'meiguanjia')
  with check (source = 'meiguanjia');
