-- Historical imports are duplicate only inside the same store.
-- This changes no customer rows; it replaces the global row_hash uniqueness
-- that could incorrectly drop an identical-looking row from another store.

set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.frontdesk_import_records
  drop constraint if exists frontdesk_import_records_row_hash_key;

alter table public.frontdesk_import_records
  add constraint frontdesk_import_records_store_row_hash_key
  unique (store, row_hash);

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
  if p_batch_id is null
     or coalesce(trim(p_filename), '') = ''
     or coalesce(trim(p_operator), '') = ''
     or coalesce(trim(p_store), '') = '' then
    raise exception 'invalid import metadata';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception 'rows must be an array of at most 250 items';
  end if;

  insert into public.frontdesk_import_batches (
    id, original_filename, imported_by, store
  ) values (
    p_batch_id,
    left(p_filename, 240),
    left(p_operator, 80),
    left(p_store, 100)
  )
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
      left(p_store, 100)
    )
    on conflict (store, row_hash) do nothing;

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

revoke all on function public.import_frontdesk_records(
  uuid, text, text, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.import_frontdesk_records(
  uuid, text, text, text, jsonb, boolean
) to service_role;

comment on constraint frontdesk_import_records_store_row_hash_key
  on public.frontdesk_import_records is
  'Historical import duplicates are scoped to one store; identical rows in different stores remain distinct.';
