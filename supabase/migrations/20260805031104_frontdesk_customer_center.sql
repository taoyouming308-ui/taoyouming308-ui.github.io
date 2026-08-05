-- iPad 前台客户中心：自有登录会话与历史消费导入。
-- 所有表均只允许 service_role 访问；浏览器必须经过 frontdesk-api Edge Function。

create table if not exists public.frontdesk_sessions (
  token_hash text primary key,
  username text not null,
  role text not null default 'staff',
  position text not null default '',
  store text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists frontdesk_sessions_expiry_idx
  on public.frontdesk_sessions (expires_at);

create table if not exists public.frontdesk_import_batches (
  id uuid primary key,
  original_filename text not null,
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  imported_by text not null,
  store text not null default '',
  status text not null default 'importing' check (status in ('importing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.frontdesk_import_records (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.frontdesk_import_batches(id) on delete restrict,
  row_hash text not null unique,
  source_file text not null,
  source_row integer not null check (source_row > 0),
  visit_date date not null,
  coupon_code text not null default '',
  customer_name text not null,
  customer_phone text not null default '',
  service_items text not null default '',
  barber_name text not null default '',
  technician_name text not null default '',
  assistant_name text not null default '',
  amount numeric(12,2) not null default 0,
  payment_summary text not null default '',
  package_note text not null default '',
  raw_row jsonb not null default '{}'::jsonb,
  imported_by text not null,
  store text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists frontdesk_import_records_phone_date_idx
  on public.frontdesk_import_records (customer_phone, visit_date desc);
create index if not exists frontdesk_import_records_name_date_idx
  on public.frontdesk_import_records (lower(customer_name), visit_date desc);
create index if not exists frontdesk_import_records_store_date_idx
  on public.frontdesk_import_records (store, visit_date desc);

alter table public.frontdesk_sessions enable row level security;
alter table public.frontdesk_import_batches enable row level security;
alter table public.frontdesk_import_records enable row level security;

revoke all on table public.frontdesk_sessions from public, anon, authenticated;
revoke all on table public.frontdesk_import_batches from public, anon, authenticated;
revoke all on table public.frontdesk_import_records from public, anon, authenticated;
revoke all on sequence public.frontdesk_import_records_id_seq from public, anon, authenticated;

grant all on table public.frontdesk_sessions to service_role;
grant all on table public.frontdesk_import_batches to service_role;
grant all on table public.frontdesk_import_records to service_role;
grant usage, select on sequence public.frontdesk_import_records_id_seq to service_role;

create or replace function public.import_frontdesk_records(
  p_batch_id uuid,
  p_filename text,
  p_operator text,
  p_store text,
  p_rows jsonb,
  p_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_hash text;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_affected integer := 0;
  v_total integer := 0;
begin
  if p_batch_id is null or coalesce(trim(p_filename), '') = '' or coalesce(trim(p_operator), '') = '' then
    raise exception 'invalid import metadata';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception 'rows must be an array of at most 250 items';
  end if;

  insert into public.frontdesk_import_batches (id, original_filename, imported_by, store)
  values (p_batch_id, left(p_filename, 240), left(p_operator, 80), left(coalesce(p_store, ''), 100))
  on conflict (id) do nothing;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_total := v_total + 1;
    v_hash := md5(concat_ws('|',
      coalesce(v_row->>'visit_date', ''),
      regexp_replace(coalesce(v_row->>'customer_phone', ''), '[^0-9]', '', 'g'),
      coalesce(v_row->>'customer_name', ''),
      coalesce(v_row->>'service_items', ''),
      coalesce(v_row->>'amount', '0'),
      coalesce(v_row->>'coupon_code', '')
    ));

    insert into public.frontdesk_import_records (
      batch_id, row_hash, source_file, source_row, visit_date, coupon_code,
      customer_name, customer_phone, service_items, barber_name,
      technician_name, assistant_name, amount, payment_summary, package_note,
      raw_row, imported_by, store
    ) values (
      p_batch_id,
      v_hash,
      left(p_filename, 240),
      greatest(1, coalesce((v_row->>'source_row')::integer, 1)),
      (v_row->>'visit_date')::date,
      left(coalesce(v_row->>'coupon_code', ''), 160),
      left(coalesce(v_row->>'customer_name', ''), 160),
      left(regexp_replace(coalesce(v_row->>'customer_phone', ''), '[^0-9]', '', 'g'), 40),
      left(coalesce(v_row->>'service_items', ''), 500),
      left(coalesce(v_row->>'barber_name', ''), 120),
      left(coalesce(v_row->>'technician_name', ''), 120),
      left(coalesce(v_row->>'assistant_name', ''), 120),
      coalesce((v_row->>'amount')::numeric, 0),
      left(coalesce(v_row->>'payment_summary', ''), 500),
      left(coalesce(v_row->>'package_note', ''), 500),
      coalesce(v_row->'raw_row', '{}'::jsonb),
      left(p_operator, 80),
      left(coalesce(p_store, ''), 100)
    )
    on conflict (row_hash) do nothing;

    get diagnostics v_affected = row_count;
    if v_affected = 1 then
      v_inserted := v_inserted + 1;
    else
      v_duplicates := v_duplicates + 1;
    end if;
  end loop;

  update public.frontdesk_import_batches
  set total_rows = total_rows + v_total,
      imported_rows = imported_rows + v_inserted,
      duplicate_rows = duplicate_rows + v_duplicates,
      status = case when p_complete then 'completed' else 'importing' end,
      completed_at = case when p_complete then now() else completed_at end
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'received', v_total,
    'imported', v_inserted,
    'duplicates', v_duplicates,
    'completed', p_complete
  );
end;
$$;

revoke all on function public.import_frontdesk_records(uuid, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_frontdesk_records(uuid, text, text, text, jsonb, boolean)
  to service_role;

comment on table public.frontdesk_import_records is
  'Legacy front-desk consumption rows imported from CSV; live cashier remains in Meiguanjia.';
