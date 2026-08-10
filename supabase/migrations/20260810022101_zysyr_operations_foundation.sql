create table if not exists public.zysyr_stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zysyr_operations_sessions (
  token_hash text primary key,
  username text not null,
  role text not null,
  position text not null default '',
  store text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create table if not exists public.zysyr_expense_records (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  expense_date date not null,
  category text not null,
  counterparty text not null default '',
  summary text not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text not null default '',
  source text not null default 'manual' check (source in ('manual', 'history_import')),
  source_ref text unique,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zysyr_voucher_attachments (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  record_type text not null check (record_type in ('expense', 'income')),
  record_id text not null,
  bucket_id text not null default 'zysyr-vouchers',
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  note text not null default '',
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists zysyr_operations_sessions_expiry_idx
  on public.zysyr_operations_sessions (expires_at);
create index if not exists zysyr_expense_records_store_date_idx
  on public.zysyr_expense_records (store, expense_date desc);
create index if not exists zysyr_voucher_attachments_record_idx
  on public.zysyr_voucher_attachments (store, record_type, record_id);

insert into public.zysyr_stores (name, created_by)
select distinct trim(store), 'existing_staff'
from public.staff
where nullif(trim(store), '') is not null
on conflict (name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zysyr-vouchers',
  'zysyr-vouchers',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.zysyr_stores enable row level security;
alter table public.zysyr_operations_sessions enable row level security;
alter table public.zysyr_expense_records enable row level security;
alter table public.zysyr_voucher_attachments enable row level security;

revoke all on table public.zysyr_stores from public, anon, authenticated;
revoke all on table public.zysyr_operations_sessions from public, anon, authenticated;
revoke all on table public.zysyr_expense_records from public, anon, authenticated;
revoke all on table public.zysyr_voucher_attachments from public, anon, authenticated;

grant select, insert, update, delete on table public.zysyr_stores to service_role;
grant select, insert, update, delete on table public.zysyr_operations_sessions to service_role;
grant select, insert, update, delete on table public.zysyr_expense_records to service_role;
grant select, insert, update, delete on table public.zysyr_voucher_attachments to service_role;

comment on table public.zysyr_expense_records is
  'ZYSYR operating expenses only. This table never creates or changes a Meiguanjia cashier transaction.';
comment on table public.zysyr_voucher_attachments is
  'Private voucher metadata. Files stay in the private zysyr-vouchers Storage bucket and are opened with short-lived signed URLs.';
