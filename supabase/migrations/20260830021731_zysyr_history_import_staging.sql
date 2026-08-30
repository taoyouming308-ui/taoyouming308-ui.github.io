-- ZYSYR v461: finance-controlled historical import staging.
-- Source files and raw rows are immutable. Nothing reaches formal ledgers until
-- a finance user reviews the preview and explicitly confirms the batch.
set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_history_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  import_type text not null check (import_type in (
    'monthly_profit_loss', 'salary', 'petty_cash', 'employee_purchase'
  )),
  source_filename text not null check (nullif(btrim(source_filename), '') is not null),
  source_mime_type text not null check (source_mime_type in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  source_size_bytes bigint not null check (source_size_bytes between 1 and 52428800),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bucket_id text not null default 'zysyr-reports',
  source_object_path text not null check (nullif(btrim(source_object_path), '') is not null),
  source_store_label text,
  target_store_label text not null check (nullif(btrim(target_store_label), '') is not null),
  period_start date not null,
  period_end date not null,
  status text not null default 'needs_review' check (status in (
    'needs_review', 'ready', 'importing', 'completed', 'partial', 'failed', 'cancelled'
  )),
  raw_row_count integer not null check (raw_row_count between 1 and 5000),
  valid_row_count integer not null default 0 check (valid_row_count between 0 and 5000),
  warning_row_count integer not null default 0 check (warning_row_count between 0 and 5000),
  invalid_row_count integer not null default 0 check (invalid_row_count between 0 and 5000),
  imported_row_count integer not null default 0 check (imported_row_count between 0 and 5000),
  failed_row_count integer not null default 0 check (failed_row_count between 0 and 5000),
  source_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(source_warnings) = 'array'),
  preview_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(preview_summary) = 'object'),
  reason text not null check (nullif(btrim(reason), '') is not null),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  confirmation_reason text,
  completed_at timestamptz,
  failure_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(failure_summary) = 'object'),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, import_type, source_sha256),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (period_start = date_trunc('month', period_start)::date),
  check (period_end = date_trunc('month', period_end)::date),
  check (period_start <= period_end),
  check (valid_row_count + warning_row_count + invalid_row_count = raw_row_count),
  check ((status in ('ready', 'importing', 'completed', 'partial', 'failed')
      and confirmed_by_user_id is not null and confirmed_at is not null
      and nullif(btrim(confirmation_reason), '') is not null)
    or status in ('needs_review', 'cancelled'))
);

create index zysyr_history_import_batches_scope_idx
  on public.zysyr_history_import_batches
  (company_id, store_id, period_start desc, import_type, created_at desc);
create index zysyr_history_import_batches_status_idx
  on public.zysyr_history_import_batches
  (company_id, store_id, status, created_at desc)
  where status in ('needs_review', 'ready', 'importing', 'partial', 'failed');

create table public.zysyr_history_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  source_sheet text not null check (nullif(btrim(source_sheet), '') is not null),
  source_row_number integer not null check (source_row_number between 1 and 10000),
  source_locator text not null check (nullif(btrim(source_locator), '') is not null),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  raw_json jsonb not null check (jsonb_typeof(raw_json) = 'object'),
  mapped_json jsonb not null check (jsonb_typeof(mapped_json) = 'object'),
  corrected_json jsonb check (corrected_json is null or jsonb_typeof(corrected_json) = 'object'),
  validation_status text not null check (validation_status in ('valid', 'warning', 'invalid')),
  validation_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_issues) = 'array'),
  import_status text not null default 'pending' check (import_status in ('pending', 'imported', 'failed', 'skipped')),
  target_business_type text,
  target_business_id uuid,
  import_error text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, import_batch_id, source_locator),
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  check ((import_status = 'imported' and target_business_type is not null
      and target_business_id is not null and imported_at is not null and import_error is null)
    or (import_status = 'failed' and nullif(btrim(import_error), '') is not null)
    or import_status in ('pending', 'skipped'))
);

create index zysyr_history_import_rows_batch_idx
  on public.zysyr_history_import_rows
  (company_id, store_id, import_batch_id, validation_status, source_row_number);
create index zysyr_history_import_rows_target_idx
  on public.zysyr_history_import_rows
  (company_id, store_id, target_business_type, target_business_id)
  where target_business_id is not null;

create table public.zysyr_history_import_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  period_month date not null,
  evidence_kind text not null check (evidence_kind in ('voucher_bundle', 'supporting_document')),
  original_filename text not null check (nullif(btrim(original_filename), '') is not null),
  mime_type text not null check (mime_type in (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf', 'image/jpeg', 'image/png'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bucket_id text not null default 'zysyr-reports',
  object_path text not null check (nullif(btrim(object_path), '') is not null),
  embedded_asset_count integer not null default 0 check (embedded_asset_count between 0 and 2000),
  uploaded_by_user_id uuid not null,
  uploaded_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, import_batch_id, sha256),
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, uploaded_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date)
);

create index zysyr_history_import_evidence_batch_idx
  on public.zysyr_history_import_evidence
  (company_id, store_id, import_batch_id, period_month, uploaded_at);

create table public.zysyr_history_import_row_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  import_row_id uuid not null,
  evidence_id uuid not null,
  source_locator text not null default '',
  link_level text not null default 'bundle_only'
    check (link_level in ('bundle_only', 'page_confirmed')),
  linked_by_user_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, import_row_id, evidence_id, source_locator),
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_row_id)
    references public.zysyr_history_import_rows(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, evidence_id)
    references public.zysyr_history_import_evidence(company_id, store_id, id) on delete restrict,
  foreign key (company_id, linked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_history_import_row_evidence_batch_idx
  on public.zysyr_history_import_row_evidence
  (company_id, store_id, import_batch_id, linked_at);

create table public.zysyr_history_import_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  import_row_id uuid,
  action text not null check (action in (
    'stage', 'row_correct', 'evidence_upload', 'evidence_link', 'confirm',
    'import_start', 'row_import', 'row_fail', 'complete', 'cancel'
  )),
  before_json jsonb,
  after_json jsonb,
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_row_id)
    references public.zysyr_history_import_rows(company_id, store_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_history_import_events_batch_idx
  on public.zysyr_history_import_events
  (company_id, store_id, import_batch_id, created_at desc);

create or replace function zysyr_private.protect_history_import_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'HISTORY_IMPORT_SOURCE_APPEND_ONLY';
  end if;
  if old.company_id is distinct from new.company_id
     or old.store_id is distinct from new.store_id
     or old.import_type is distinct from new.import_type
     or old.source_filename is distinct from new.source_filename
     or old.source_mime_type is distinct from new.source_mime_type
     or old.source_size_bytes is distinct from new.source_size_bytes
     or old.source_sha256 is distinct from new.source_sha256
     or old.source_bucket_id is distinct from new.source_bucket_id
     or old.source_object_path is distinct from new.source_object_path
     or old.source_store_label is distinct from new.source_store_label
     or old.target_store_label is distinct from new.target_store_label
     or old.period_start is distinct from new.period_start
     or old.period_end is distinct from new.period_end
     or old.raw_row_count is distinct from new.raw_row_count
     or old.created_by_user_id is distinct from new.created_by_user_id
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = '55000', message = 'HISTORY_IMPORT_SOURCE_IMMUTABLE';
  end if;
  return new;
end $$;

revoke execute on function zysyr_private.protect_history_import_source()
  from public, anon, authenticated, service_role;

create trigger zysyr_history_import_batches_source_immutable
  before update or delete on public.zysyr_history_import_batches
  for each row execute function zysyr_private.protect_history_import_source();

create or replace function zysyr_private.protect_history_import_row_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'HISTORY_IMPORT_ROW_APPEND_ONLY';
  end if;
  if old.company_id is distinct from new.company_id
     or old.store_id is distinct from new.store_id
     or old.import_batch_id is distinct from new.import_batch_id
     or old.source_sheet is distinct from new.source_sheet
     or old.source_row_number is distinct from new.source_row_number
     or old.source_locator is distinct from new.source_locator
     or old.row_hash is distinct from new.row_hash
     or old.raw_json is distinct from new.raw_json
     or old.mapped_json is distinct from new.mapped_json
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = '55000', message = 'HISTORY_IMPORT_ROW_SOURCE_IMMUTABLE';
  end if;
  return new;
end $$;

revoke execute on function zysyr_private.protect_history_import_row_source()
  from public, anon, authenticated, service_role;

create trigger zysyr_history_import_rows_source_immutable
  before update or delete on public.zysyr_history_import_rows
  for each row execute function zysyr_private.protect_history_import_row_source();

create or replace function zysyr_private.prevent_history_import_record_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'HISTORY_IMPORT_RECORD_APPEND_ONLY';
end $$;

revoke execute on function zysyr_private.prevent_history_import_record_mutation()
  from public, anon, authenticated, service_role;

create trigger zysyr_history_import_evidence_immutable
  before update or delete on public.zysyr_history_import_evidence
  for each row execute function zysyr_private.prevent_history_import_record_mutation();
create trigger zysyr_history_import_row_evidence_immutable
  before update or delete on public.zysyr_history_import_row_evidence
  for each row execute function zysyr_private.prevent_history_import_record_mutation();
create trigger zysyr_history_import_events_immutable
  before update or delete on public.zysyr_history_import_events
  for each row execute function zysyr_private.prevent_history_import_record_mutation();

create or replace function public.zysyr_stage_history_import(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_type text,
  p_source_filename text,
  p_source_mime_type text,
  p_source_size_bytes bigint,
  p_source_sha256 text,
  p_source_bucket_id text,
  p_source_object_path text,
  p_source_store_label text,
  p_target_store_label text,
  p_period_start date,
  p_period_end date,
  p_rows jsonb,
  p_source_warnings jsonb,
  p_preview_summary jsonb,
  p_reason text
) returns public.zysyr_history_import_batches
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.zysyr_history_import_batches;
  v_row jsonb;
  v_raw jsonb;
  v_mapped jsonb;
  v_issues jsonb;
  v_status text;
  v_sheet text;
  v_row_number integer;
  v_row_hash text;
  v_count integer := 0;
  v_valid_count integer := 0;
  v_warning_count integer := 0;
  v_invalid_count integer := 0;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if p_import_type not in ('monthly_profit_loss', 'salary', 'petty_cash', 'employee_purchase')
     or p_source_mime_type not in (
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     )
     or p_source_size_bytes not between 1 and 52428800
     or p_source_sha256 !~ '^[0-9a-f]{64}$'
     or p_period_start is null or p_period_end is null or p_period_start > p_period_end
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000
     or jsonb_typeof(coalesce(p_source_warnings, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_preview_summary, '{}'::jsonb)) <> 'object'
     or nullif(btrim(p_source_filename), '') is null
     or nullif(btrim(p_source_object_path), '') is null
     or nullif(btrim(p_target_store_label), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_INPUT_INVALID';
  end if;

  -- Validate every preview row before creating the batch so the count invariant
  -- is true at insert time. The following insert loop repeats this extraction
  -- because the original payload must remain byte-for-byte auditable.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_count := v_count + 1;
    v_raw := coalesce(v_row->'raw', '{}'::jsonb);
    v_mapped := coalesce(v_row->'mapped', '{}'::jsonb);
    v_issues := coalesce(v_row->'issues', '[]'::jsonb);
    v_status := coalesce(v_row->>'validation_status', 'invalid');
    v_sheet := nullif(btrim(v_row->>'source_sheet'), '');
    v_row_number := coalesce((v_row->>'source_row_number')::integer, v_count);
    if jsonb_typeof(v_raw) <> 'object' or jsonb_typeof(v_mapped) <> 'object'
       or jsonb_typeof(v_issues) <> 'array' or v_status not in ('valid', 'warning', 'invalid')
       or v_sheet is null or v_row_number < 1 then
      raise exception using errcode = '22023', message = 'HISTORY_IMPORT_ROW_INVALID';
    end if;
    if v_status = 'valid' then
      v_valid_count := v_valid_count + 1;
    elsif v_status = 'warning' then
      v_warning_count := v_warning_count + 1;
    else
      v_invalid_count := v_invalid_count + 1;
    end if;
  end loop;

  insert into public.zysyr_history_import_batches(
    company_id, store_id, import_type, source_filename, source_mime_type,
    source_size_bytes, source_sha256, source_bucket_id, source_object_path,
    source_store_label, target_store_label, period_start, period_end,
    raw_row_count, valid_row_count, warning_row_count, invalid_row_count,
    source_warnings, preview_summary, reason, created_by_user_id
  ) values (
    p_company_id, p_store_id, p_import_type, btrim(p_source_filename),
    p_source_mime_type, p_source_size_bytes, p_source_sha256,
    coalesce(nullif(btrim(p_source_bucket_id), ''), 'zysyr-reports'),
    btrim(p_source_object_path), nullif(btrim(p_source_store_label), ''),
    btrim(p_target_store_label), date_trunc('month', p_period_start)::date,
    date_trunc('month', p_period_end)::date, jsonb_array_length(p_rows),
    v_valid_count, v_warning_count, v_invalid_count,
    coalesce(p_source_warnings, '[]'::jsonb), coalesce(p_preview_summary, '{}'::jsonb),
    btrim(p_reason), p_actor_user_id
  ) returning * into v_batch;

  v_count := 0;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_count := v_count + 1;
    v_raw := coalesce(v_row->'raw', '{}'::jsonb);
    v_mapped := coalesce(v_row->'mapped', '{}'::jsonb);
    v_issues := coalesce(v_row->'issues', '[]'::jsonb);
    v_status := coalesce(v_row->>'validation_status', 'invalid');
    v_sheet := nullif(btrim(v_row->>'source_sheet'), '');
    v_row_number := coalesce((v_row->>'source_row_number')::integer, v_count);
    if jsonb_typeof(v_raw) <> 'object' or jsonb_typeof(v_mapped) <> 'object'
       or jsonb_typeof(v_issues) <> 'array' or v_status not in ('valid', 'warning', 'invalid')
       or v_sheet is null or v_row_number < 1 then
      raise exception using errcode = '22023', message = 'HISTORY_IMPORT_ROW_INVALID';
    end if;
    v_row_hash := coalesce(nullif(v_row->>'row_hash', ''),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw::text, 'UTF8')), 'hex'));
    insert into public.zysyr_history_import_rows(
      company_id, store_id, import_batch_id, source_sheet, source_row_number,
      source_locator, row_hash, raw_json, mapped_json, validation_status, validation_issues
    ) values (
      p_company_id, p_store_id, v_batch.id, v_sheet, v_row_number,
      coalesce(nullif(btrim(v_row->>'source_locator'), ''), v_sheet || '!ROW' || v_row_number::text),
      v_row_hash, v_raw, v_mapped, v_status, v_issues
    );
  end loop;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_batch.id, 'stage',
    jsonb_build_object('source_sha256', v_batch.source_sha256,
      'raw_row_count', v_batch.raw_row_count, 'valid_row_count', v_batch.valid_row_count,
      'warning_row_count', v_batch.warning_row_count, 'invalid_row_count', v_batch.invalid_row_count),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_batch', v_batch.id, 'stage',
    jsonb_build_object('import_type', v_batch.import_type,
      'source_sha256', v_batch.source_sha256, 'row_count', v_batch.raw_row_count),
    btrim(p_reason), 'financial'
  );
  return v_batch;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'HISTORY_IMPORT_SOURCE_ALREADY_STAGED';
end $$;

create or replace function public.zysyr_correct_history_import_row(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_row_id uuid,
  p_corrected_json jsonb,
  p_validation_status text,
  p_validation_issues jsonb,
  p_reason text
) returns public.zysyr_history_import_rows
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.zysyr_history_import_rows;
  v_after public.zysyr_history_import_rows;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if jsonb_typeof(p_corrected_json) <> 'object'
     or p_validation_status not in ('valid', 'warning', 'invalid')
     or jsonb_typeof(coalesce(p_validation_issues, '[]'::jsonb)) <> 'array'
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_CORRECTION_INVALID';
  end if;
  select row_item.* into v_before from public.zysyr_history_import_rows row_item
  join public.zysyr_history_import_batches batch
    on batch.company_id = row_item.company_id and batch.id = row_item.import_batch_id
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.id = p_import_row_id and batch.status = 'needs_review'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_ROW_NOT_EDITABLE'; end if;
  update public.zysyr_history_import_rows set
    corrected_json = p_corrected_json,
    validation_status = p_validation_status,
    validation_issues = coalesce(p_validation_issues, '[]'::jsonb),
    updated_at = now()
  where company_id = p_company_id and id = p_import_row_id
  returning * into v_after;
  update public.zysyr_history_import_batches batch set
    valid_row_count = counts.valid_count,
    warning_row_count = counts.warning_count,
    invalid_row_count = counts.invalid_count
  from (
    select count(*) filter (where validation_status = 'valid')::integer valid_count,
      count(*) filter (where validation_status = 'warning')::integer warning_count,
      count(*) filter (where validation_status = 'invalid')::integer invalid_count
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id and row_item.import_batch_id = v_after.import_batch_id
  ) counts
  where batch.company_id = p_company_id and batch.id = v_after.import_batch_id;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, import_row_id, action,
    before_json, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_after.import_batch_id, v_after.id, 'row_correct',
    jsonb_build_object('corrected_json', v_before.corrected_json,
      'validation_status', v_before.validation_status, 'issues', v_before.validation_issues),
    jsonb_build_object('corrected_json', v_after.corrected_json,
      'validation_status', v_after.validation_status, 'issues', v_after.validation_issues),
    btrim(p_reason), p_actor_user_id
  );
  return v_after;
end $$;

create or replace function public.zysyr_confirm_history_import(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_reason text
) returns public.zysyr_history_import_batches
language plpgsql security definer set search_path = '' as $$
declare v_batch public.zysyr_history_import_batches;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_CONFIRM_REASON_REQUIRED';
  end if;
  select * into v_batch from public.zysyr_history_import_batches batch
  where batch.company_id = p_company_id and batch.store_id = p_store_id
    and batch.id = p_import_batch_id and batch.status = 'needs_review'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_BATCH_NOT_REVIEWABLE'; end if;
  if v_batch.invalid_row_count > 0 then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HAS_INVALID_ROWS';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_batch.source_warnings) warning
    where warning->>'severity' = 'invalid'
  ) then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HAS_INVALID_SOURCE_WARNING';
  end if;
  update public.zysyr_history_import_batches set
    status = 'ready', confirmed_by_user_id = p_actor_user_id,
    confirmed_at = now(), confirmation_reason = btrim(p_reason)
  where company_id = p_company_id and id = p_import_batch_id
  returning * into v_batch;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_batch.id, 'confirm',
    jsonb_build_object('status', v_batch.status, 'warning_row_count', v_batch.warning_row_count),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_batch', v_batch.id, 'confirm',
    jsonb_build_object('status', v_batch.status, 'row_count', v_batch.raw_row_count),
    btrim(p_reason), 'financial'
  );
  return v_batch;
end $$;

create or replace function public.zysyr_register_history_import_evidence(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_period_month date,
  p_evidence_kind text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_bucket_id text,
  p_object_path text,
  p_embedded_asset_count integer,
  p_reason text
) returns public.zysyr_history_import_evidence
language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_history_import_evidence;
  v_link_count integer := 0;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if p_evidence_kind not in ('voucher_bundle', 'supporting_document')
     or p_mime_type not in (
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/pdf', 'image/jpeg', 'image/png'
     ) or p_size_bytes not between 1 and 52428800 or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_embedded_asset_count not between 0 and 2000
     or nullif(btrim(p_original_filename), '') is null
     or nullif(btrim(p_object_path), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_EVIDENCE_INVALID';
  end if;
  if not exists (
    select 1 from public.zysyr_history_import_batches batch
    where batch.company_id = p_company_id and batch.store_id = p_store_id
      and batch.id = p_import_batch_id and batch.status in ('needs_review', 'ready')
      and date_trunc('month', p_period_month)::date between batch.period_start and batch.period_end
  ) then raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_BATCH_NOT_FOUND'; end if;
  insert into public.zysyr_history_import_evidence(
    company_id, store_id, import_batch_id, period_month, evidence_kind,
    original_filename, mime_type, size_bytes, sha256, bucket_id, object_path,
    embedded_asset_count, uploaded_by_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, date_trunc('month', p_period_month)::date,
    p_evidence_kind, btrim(p_original_filename), p_mime_type, p_size_bytes,
    p_sha256, coalesce(nullif(btrim(p_bucket_id), ''), 'zysyr-reports'),
    btrim(p_object_path), p_embedded_asset_count, p_actor_user_id
  ) returning * into v_saved;
  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  )
  select row_item.company_id, row_item.store_id, row_item.import_batch_id,
    row_item.id, v_saved.id,
    'bundle:' || to_char(date_trunc('month', p_period_month), 'YYYY-MM'),
    'bundle_only', p_actor_user_id
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and coalesce(row_item.corrected_json, row_item.mapped_json)->>'period_month'
      = to_char(date_trunc('month', p_period_month), 'YYYY-MM-DD')
  on conflict do nothing;
  get diagnostics v_link_count = row_count;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, 'evidence_upload',
    jsonb_build_object('evidence_id', v_saved.id, 'period_month', v_saved.period_month,
      'filename', v_saved.original_filename, 'sha256', v_saved.sha256,
      'embedded_asset_count', v_saved.embedded_asset_count,
      'link_level', 'bundle_only', 'linked_row_count', v_link_count),
    btrim(p_reason), p_actor_user_id
  );
  return v_saved;
end $$;

create or replace function public.zysyr_link_history_import_evidence(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_row_id uuid,
  p_evidence_id uuid,
  p_source_locator text,
  p_reason text
) returns public.zysyr_history_import_row_evidence
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.zysyr_history_import_rows;
  v_evidence public.zysyr_history_import_evidence;
  v_saved public.zysyr_history_import_row_evidence;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_EVIDENCE_REASON_REQUIRED';
  end if;
  select * into v_row from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.id = p_import_row_id;
  select * into v_evidence from public.zysyr_history_import_evidence evidence
  where evidence.company_id = p_company_id and evidence.store_id = p_store_id
    and evidence.id = p_evidence_id;
  if v_row.id is null or v_evidence.id is null
     or v_row.import_batch_id <> v_evidence.import_batch_id then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_EVIDENCE_SCOPE_MISMATCH';
  end if;
  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  ) values (
    p_company_id, p_store_id, v_row.import_batch_id, p_import_row_id, p_evidence_id,
    coalesce(btrim(p_source_locator), ''),
    case when coalesce(btrim(p_source_locator), '') like 'bundle:%'
      then 'bundle_only' else 'page_confirmed' end,
    p_actor_user_id
  ) returning * into v_saved;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, import_row_id, action,
    after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_row.import_batch_id, v_row.id, 'evidence_link',
    jsonb_build_object('evidence_id', v_evidence.id,
      'source_locator', v_saved.source_locator), btrim(p_reason), p_actor_user_id
  );
  return v_saved;
end $$;

create or replace function public.zysyr_link_history_evidence_month(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_evidence_id uuid,
  p_period_month date,
  p_reason text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_EVIDENCE_REASON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.zysyr_history_import_evidence evidence
    where evidence.company_id = p_company_id and evidence.store_id = p_store_id
      and evidence.import_batch_id = p_import_batch_id and evidence.id = p_evidence_id
      and evidence.period_month = date_trunc('month', p_period_month)::date
  ) then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_EVIDENCE_SCOPE_MISMATCH';
  end if;
  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  )
  select row_item.company_id, row_item.store_id, row_item.import_batch_id,
    row_item.id, p_evidence_id,
    'bundle:' || to_char(date_trunc('month', p_period_month), 'YYYY-MM'),
    'bundle_only', p_actor_user_id
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and coalesce(row_item.corrected_json, row_item.mapped_json)->>'period_month'
      = to_char(date_trunc('month', p_period_month), 'YYYY-MM-DD')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, 'evidence_link',
    jsonb_build_object('evidence_id', p_evidence_id,
      'period_month', date_trunc('month', p_period_month)::date,
      'link_level', 'bundle_only', 'linked_row_count', v_count),
    btrim(p_reason), p_actor_user_id
  );
  return v_count;
end $$;

revoke execute on function public.zysyr_stage_history_import(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text,
  text, text, date, date, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_correct_history_import_row(
  uuid, uuid, uuid, uuid, jsonb, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_confirm_history_import(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_register_history_import_evidence(
  uuid, uuid, uuid, uuid, date, text, text, text, bigint, text, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_link_history_import_evidence(
  uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_link_history_evidence_month(
  uuid, uuid, uuid, uuid, uuid, date, text
) from public, anon, authenticated, service_role;

grant execute on function public.zysyr_stage_history_import(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text,
  text, text, date, date, jsonb, jsonb, jsonb, text
) to service_role;
grant execute on function public.zysyr_correct_history_import_row(
  uuid, uuid, uuid, uuid, jsonb, text, jsonb, text
) to service_role;
grant execute on function public.zysyr_confirm_history_import(
  uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.zysyr_register_history_import_evidence(
  uuid, uuid, uuid, uuid, date, text, text, text, bigint, text, text, text, integer, text
) to service_role;
grant execute on function public.zysyr_link_history_import_evidence(
  uuid, uuid, uuid, uuid, uuid, text, text
) to service_role;
grant execute on function public.zysyr_link_history_evidence_month(
  uuid, uuid, uuid, uuid, uuid, date, text
) to service_role;

alter table public.zysyr_history_import_batches enable row level security;
alter table public.zysyr_history_import_batches force row level security;
alter table public.zysyr_history_import_rows enable row level security;
alter table public.zysyr_history_import_rows force row level security;
alter table public.zysyr_history_import_evidence enable row level security;
alter table public.zysyr_history_import_evidence force row level security;
alter table public.zysyr_history_import_row_evidence enable row level security;
alter table public.zysyr_history_import_row_evidence force row level security;
alter table public.zysyr_history_import_events enable row level security;
alter table public.zysyr_history_import_events force row level security;

create policy zysyr_history_import_batches_scope_select
  on public.zysyr_history_import_batches for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_history_import_rows_scope_select
  on public.zysyr_history_import_rows for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_history_import_evidence_scope_select
  on public.zysyr_history_import_evidence for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_history_import_row_evidence_scope_select
  on public.zysyr_history_import_row_evidence for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_history_import_events_scope_select
  on public.zysyr_history_import_events for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table
  public.zysyr_history_import_batches,
  public.zysyr_history_import_rows,
  public.zysyr_history_import_evidence,
  public.zysyr_history_import_row_evidence,
  public.zysyr_history_import_events
from public, anon, authenticated, service_role;

grant select on table
  public.zysyr_history_import_batches,
  public.zysyr_history_import_rows,
  public.zysyr_history_import_evidence,
  public.zysyr_history_import_row_evidence,
  public.zysyr_history_import_events
to authenticated, service_role;

comment on table public.zysyr_history_import_batches is
  'Historical finance imports staged for preview and explicit confirmation; source metadata is immutable.';
comment on table public.zysyr_history_import_rows is
  'Row-level raw source, mapping, corrections, validation, failure retention and formal target lineage.';
comment on table public.zysyr_history_import_evidence is
  'Immutable Word/PDF/image evidence bundles associated with a historical import batch.';
comment on table public.zysyr_history_import_row_evidence is
  'Append-only row-to-evidence links; bundle_only means the exact page/image still requires finance confirmation.';
