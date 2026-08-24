-- ZYSYR v432: image-aligned daily sheet draft, cell audit, independent controls,
-- immutable finance confirmation, and atomic income import.
set statement_timeout = '30s';
set lock_timeout = '5s';

update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png'
  ]
where id = 'zysyr-reports';

create table public.zysyr_daily_sheet_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  source_voucher_id uuid not null,
  report_date date not null,
  template_code text not null default 'zysyr_daily_performance_photo',
  template_version integer not null default 1 check (template_version > 0),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  ocr_provider text not null,
  ocr_model text not null,
  ocr_raw_result jsonb not null default '{}'::jsonb check (jsonb_typeof(ocr_raw_result) = 'object'),
  validation_result jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_result) = 'object'),
  edit_revision integer not null default 0 check (edit_revision >= 0),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  confirm_reason text,
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, source_voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and confirmed_by_user_id is not null and confirmed_at is not null and nullif(btrim(confirm_reason), '') is not null)
    or (status <> 'confirmed' and confirmed_by_user_id is null and confirmed_at is null and confirm_reason is null))
);

create unique index zysyr_daily_sheet_one_open_voucher_uidx
  on public.zysyr_daily_sheet_drafts (company_id, store_id, source_voucher_id)
  where status in ('draft', 'confirmed');
create index zysyr_daily_sheet_scope_date_idx
  on public.zysyr_daily_sheet_drafts (company_id, store_id, report_date desc, created_at desc);
create index zysyr_daily_sheet_creator_idx
  on public.zysyr_daily_sheet_drafts (company_id, created_by_user_id, created_at desc);

create table public.zysyr_daily_sheet_cells (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  section_code text not null check (section_code in ('stylist', 'technician', 'product', 'summary', 'payment')),
  row_key text not null check (row_key ~ '^[a-z0-9_]{1,80}$'),
  row_label text not null check (char_length(row_label) between 1 and 120),
  column_code text not null check (column_code ~ '^[a-z0-9_]{1,80}$'),
  column_label text not null check (char_length(column_label) between 1 and 120),
  row_number integer not null check (row_number between 1 and 120),
  column_number integer not null check (column_number between 1 and 30),
  cell_role text not null check (cell_role in (
    'staff_value', 'staff_total', 'staff_count', 'category_total',
    'technician_value', 'technician_total', 'technician_category_total',
    'product_value', 'product_total', 'summary_value', 'summary_actual',
    'summary_grand', 'payment_method', 'payment_cashflow',
    'payment_card_consumption', 'payment_total'
  )),
  ocr_text text,
  ocr_numeric numeric(14,2),
  corrected_numeric numeric(14,2),
  manual_override boolean not null default false,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  bbox jsonb check (bbox is null or jsonb_typeof(bbox) = 'array'),
  source_method text not null check (source_method in ('openai_vision', 'paddle_ocr', 'blank_template')),
  created_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, draft_id, section_code, row_key, column_code),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (ocr_numeric is null or ocr_numeric >= 0),
  check (corrected_numeric is null or corrected_numeric >= 0)
);

create index zysyr_daily_sheet_cells_draft_position_idx
  on public.zysyr_daily_sheet_cells (company_id, store_id, draft_id, row_number, column_number);
create index zysyr_daily_sheet_cells_draft_role_idx
  on public.zysyr_daily_sheet_cells (company_id, draft_id, cell_role, row_key, column_code);
create index zysyr_daily_sheet_cells_updater_idx
  on public.zysyr_daily_sheet_cells (company_id, updated_by_user_id, updated_at desc);

create table public.zysyr_daily_sheet_cell_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  cell_id uuid not null,
  revision integer not null check (revision > 0),
  before_value numeric(14,2),
  after_value numeric(14,2),
  changed_by_user_id uuid not null,
  changed_at timestamptz not null default now(),
  reason text not null check (nullif(btrim(reason), '') is not null),
  unique (company_id, id),
  unique (company_id, cell_id, revision),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, cell_id)
    references public.zysyr_daily_sheet_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, changed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_daily_sheet_changes_draft_idx
  on public.zysyr_daily_sheet_cell_changes (company_id, store_id, draft_id, changed_at desc);
create index zysyr_daily_sheet_changes_actor_idx
  on public.zysyr_daily_sheet_cell_changes (company_id, changed_by_user_id, changed_at desc);

create table public.zysyr_daily_sheet_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  version integer not null check (version > 0),
  source_voucher_id uuid not null,
  source_report_id uuid not null,
  import_batch_id uuid not null,
  daily_report_id uuid not null,
  validation_result jsonb not null check (jsonb_typeof(validation_result) = 'object'),
  confirmed_snapshot jsonb not null check (jsonb_typeof(confirmed_snapshot) = 'array'),
  confirmed_by_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  reason text not null check (nullif(btrim(reason), '') is not null),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, draft_id, version),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, source_voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_id)
    references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_daily_sheet_versions_scope_idx
  on public.zysyr_daily_sheet_versions (company_id, store_id, confirmed_at desc);
create index zysyr_daily_sheet_versions_source_report_idx
  on public.zysyr_daily_sheet_versions (company_id, store_id, source_report_id);
create index zysyr_daily_sheet_versions_daily_report_idx
  on public.zysyr_daily_sheet_versions (company_id, store_id, daily_report_id);

create or replace function zysyr_private.daily_sheet_cell_value(p_cell public.zysyr_daily_sheet_cells)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_cell.manual_override then p_cell.corrected_numeric else p_cell.ocr_numeric end
$$;

revoke execute on function zysyr_private.daily_sheet_cell_value(public.zysyr_daily_sheet_cells)
  from public, anon, authenticated, service_role;

create or replace function zysyr_private.sheet_column_name(p_column integer)
returns text language sql immutable set search_path = '' as $$
  select case when p_column between 1 and 26
    then pg_catalog.chr(64 + p_column)
    when p_column between 27 and 30
    then 'A' || pg_catalog.chr(64 + p_column - 26)
    else null end
$$;

revoke execute on function zysyr_private.sheet_column_name(integer)
  from public, anon, authenticated, service_role;

create or replace function zysyr_private.daily_sheet_validation(
  p_company_id uuid, p_store_id uuid, p_draft_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_atomic numeric := 0;
  v_staff_reported numeric := 0;
  v_category_reported numeric := 0;
  v_actual numeric;
  v_grand numeric;
  v_payment_methods numeric := 0;
  v_cashflow numeric;
  v_card_consumption numeric := 0;
  v_payment_total numeric;
  v_row_mismatches integer := 0;
  v_category_mismatches integer := 0;
  v_atomic_count integer := 0;
  v_missing_controls text[] := array[]::text[];
  v_valid boolean;
begin
  if not exists (select 1 from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id) then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0), count(*) filter (where zysyr_private.daily_sheet_cell_value(cell) is not null)
    into v_staff_atomic, v_atomic_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_value';

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_staff_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_total';

  select count(*) into v_row_mismatches from (
    select cell.row_key,
      coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_value'), 0) as atomic_total,
      max(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_total') as reported_total
    from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.section_code = 'stylist'
    group by cell.row_key
  ) row_control
  where (row_control.atomic_total <> 0 or row_control.reported_total is not null)
    and (row_control.reported_total is null or abs(row_control.atomic_total - row_control.reported_total) > 0.01);

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_category_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'category_total';

  select count(*) into v_category_mismatches from (
    select category.column_code, coalesce(atomic.atomic_total, 0) as atomic_total,
      zysyr_private.daily_sheet_cell_value(category) as reported_total
    from public.zysyr_daily_sheet_cells category
    left join lateral (
      select sum(zysyr_private.daily_sheet_cell_value(cell)) as atomic_total
      from public.zysyr_daily_sheet_cells cell
      where cell.company_id = category.company_id and cell.store_id = category.store_id
        and cell.draft_id = category.draft_id and cell.cell_role = 'staff_value'
        and cell.column_code = category.column_code
    ) atomic on true
    where category.company_id = p_company_id and category.store_id = p_store_id
      and category.draft_id = p_draft_id and category.cell_role = 'category_total'
  ) category_control
  where (category_control.atomic_total <> 0 or category_control.reported_total is not null)
    and (category_control.reported_total is null or abs(category_control.atomic_total - category_control.reported_total) > 0.01);

  select zysyr_private.daily_sheet_cell_value(cell) into v_actual
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_actual' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_grand
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_grand' limit 1;
  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_payment_methods
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_method';
  select zysyr_private.daily_sheet_cell_value(cell) into v_cashflow
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_cashflow' limit 1;
  select coalesce(zysyr_private.daily_sheet_cell_value(cell), 0) into v_card_consumption
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_card_consumption' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_payment_total
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_total' limit 1;

  if v_actual is null then v_missing_controls := array_append(v_missing_controls, '实做'); end if;
  if v_grand is null then v_missing_controls := array_append(v_missing_controls, '总计'); end if;
  if v_cashflow is null then v_missing_controls := array_append(v_missing_controls, '现金流'); end if;
  if v_payment_total is null then v_missing_controls := array_append(v_missing_controls, '支付总计'); end if;
  if v_atomic_count = 0 then v_missing_controls := array_append(v_missing_controls, '员工明细'); end if;

  v_valid := cardinality(v_missing_controls) = 0
    and v_row_mismatches = 0 and v_category_mismatches = 0
    and v_staff_atomic > 0
    and abs(v_staff_atomic - v_staff_reported) <= 0.01
    and abs(v_staff_atomic - v_category_reported) <= 0.01
    and abs(v_staff_atomic - v_actual) <= 0.01
    and abs(v_staff_atomic - v_grand) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and abs(v_cashflow + v_card_consumption - v_payment_total) <= 0.01
    and abs(v_staff_atomic - v_payment_total) <= 0.01;

  return jsonb_build_object(
    'valid', v_valid,
    'staff_atomic_total', round(v_staff_atomic, 2),
    'staff_reported_total', round(v_staff_reported, 2),
    'category_reported_total', round(v_category_reported, 2),
    'actual_total', v_actual,
    'grand_total', v_grand,
    'payment_method_total', round(v_payment_methods, 2),
    'cashflow_total', v_cashflow,
    'card_consumption', round(v_card_consumption, 2),
    'payment_total', v_payment_total,
    'staff_row_mismatches', v_row_mismatches,
    'category_mismatches', v_category_mismatches,
    'missing_controls', to_jsonb(v_missing_controls),
    'tolerance', 0.01,
    'income_source', 'nonzero_stylist_atomic_cells_only'
  );
end
$$;

revoke execute on function zysyr_private.daily_sheet_validation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.zysyr_create_daily_sheet_draft(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_report_date date,
  p_source_voucher_id uuid, p_ocr_provider text, p_ocr_model text,
  p_ocr_raw_result jsonb, p_cells jsonb, p_reason text
) returns public.zysyr_daily_sheet_drafts language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_daily_sheet_drafts;
  v_source_sha text;
  v_cell jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if p_report_date is null or nullif(btrim(p_ocr_provider), '') is null or nullif(btrim(p_ocr_model), '') is null
    or jsonb_typeof(p_ocr_raw_result) <> 'object' or jsonb_typeof(p_cells) <> 'array'
    or jsonb_array_length(p_cells) not between 1 and 1000 or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_DRAFT_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  select voucher.sha256 into v_source_sha from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id and voucher.store_id = p_store_id and voucher.id = p_source_voucher_id
    and voucher.audit_status = 'approved' and voucher.document_type = 'daily_report';
  if not found then raise exception using errcode = 'P0002', message = 'APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  select * into v_saved from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.source_voucher_id = p_source_voucher_id
    and draft.status in ('draft', 'confirmed') order by draft.created_at desc limit 1;
  if found then return v_saved; end if;

  insert into public.zysyr_daily_sheet_drafts(
    company_id, store_id, source_voucher_id, report_date, source_sha256,
    ocr_provider, ocr_model, ocr_raw_result, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, p_store_id, p_source_voucher_id, p_report_date, v_source_sha,
    btrim(p_ocr_provider), btrim(p_ocr_model), p_ocr_raw_result, p_actor_user_id, p_actor_user_id
  ) returning * into v_saved;

  for v_cell in select value from jsonb_array_elements(p_cells) loop
    insert into public.zysyr_daily_sheet_cells(
      company_id, store_id, draft_id, section_code, row_key, row_label,
      column_code, column_label, row_number, column_number, cell_role,
      ocr_text, ocr_numeric, confidence, bbox, source_method, updated_by_user_id
    ) values (
      p_company_id, p_store_id, v_saved.id, v_cell->>'section_code', v_cell->>'row_key', v_cell->>'row_label',
      v_cell->>'column_code', v_cell->>'column_label', (v_cell->>'row_number')::integer,
      (v_cell->>'column_number')::integer, v_cell->>'cell_role', nullif(v_cell->>'ocr_text', ''),
      nullif(v_cell->>'ocr_numeric', '')::numeric, nullif(v_cell->>'confidence', '')::numeric,
      v_cell->'bbox', coalesce(nullif(v_cell->>'source_method', ''), 'blank_template'), p_actor_user_id
    );
  end loop;
  v_saved.validation_result := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, v_saved.id);
  update public.zysyr_daily_sheet_drafts set validation_result = v_saved.validation_result where id = v_saved.id
    returning * into v_saved;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', v_saved.id,
    'create', jsonb_build_object('report_date', p_report_date, 'source_voucher_id', p_source_voucher_id,
      'source_sha256', v_source_sha, 'ocr_provider', p_ocr_provider, 'ocr_model', p_ocr_model,
      'cell_count', jsonb_array_length(p_cells)), btrim(p_reason), 'financial');
  return v_saved;
end
$$;

create or replace function public.zysyr_save_daily_sheet_cells(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_cells jsonb, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_item jsonb;
  v_cell public.zysyr_daily_sheet_cells;
  v_before numeric;
  v_after numeric;
  v_revision integer;
  v_changed integer := 0;
  v_validation jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) not between 1 and 1000
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_EDIT_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_DRAFT_NOT_EDITABLE'; end if;
  v_revision := v_draft.edit_revision + 1;

  for v_item in select value from jsonb_array_elements(p_cells) loop
    select * into v_cell from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.id = (v_item->>'id')::uuid for update;
    if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_CELL_NOT_FOUND'; end if;
    v_before := zysyr_private.daily_sheet_cell_value(v_cell);
    v_after := nullif(v_item->>'value', '')::numeric;
    if v_after is not null and v_after < 0 then raise exception using errcode = '22023', message = 'DAILY_SHEET_VALUE_INVALID'; end if;
    if v_before is distinct from v_after or not v_cell.manual_override then
      update public.zysyr_daily_sheet_cells set corrected_numeric = v_after, manual_override = true,
        updated_by_user_id = p_actor_user_id, updated_at = now() where id = v_cell.id;
      insert into public.zysyr_daily_sheet_cell_changes(company_id, store_id, draft_id, cell_id,
        revision, before_value, after_value, changed_by_user_id, reason)
      values(p_company_id, p_store_id, p_draft_id, v_cell.id, v_revision,
        v_before, v_after, p_actor_user_id, btrim(p_reason));
      v_changed := v_changed + 1;
    end if;
  end loop;
  v_validation := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision = v_revision, validation_result = v_validation,
    updated_by_user_id = p_actor_user_id, updated_at = now() where id = p_draft_id;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', p_draft_id,
    'edit', jsonb_build_object('revision', v_draft.edit_revision),
    jsonb_build_object('revision', v_revision, 'changed_cells', v_changed, 'validation', v_validation),
    btrim(p_reason), 'financial');
  return jsonb_build_object('draft_id', p_draft_id, 'revision', v_revision,
    'changed_cells', v_changed, 'validation', v_validation);
end
$$;

create or replace function public.zysyr_confirm_daily_sheet(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_report jsonb, p_is_business_day boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_validation jsonb;
  v_lines jsonb;
  v_report_cells jsonb;
  v_report_data jsonb;
  v_report_id uuid;
  v_batch public.zysyr_import_batches;
  v_daily public.zysyr_daily_reports;
  v_approved public.zysyr_daily_reports;
  v_reconciliation public.zysyr_reconciliation_reports;
  v_version public.zysyr_daily_sheet_versions;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'daily_report.write');
  if jsonb_typeof(p_report) <> 'object' or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_CONFIRM_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_ALREADY_CONFIRMED'; end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_draft.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if exists(select 1 from public.zysyr_daily_reports report where report.company_id = p_company_id
    and report.store_id = p_store_id and report.report_date = v_draft.report_date
    and report.status in ('submitted', 'approved')) then
    raise exception using errcode = '55000', message = 'EXISTING_DAILY_REPORT_REQUIRES_REVERSAL';
  end if;
  v_validation := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, p_draft_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_CONTROL_MISMATCH', detail = v_validation::text;
  end if;

  select jsonb_agg(jsonb_build_object(
    'line_type', 'income',
    'metric_code', 'SERVICE_' || upper(cell.column_code),
    'description', cell.row_label || ' · ' || cell.column_label,
    'amount', zysyr_private.daily_sheet_cell_value(cell),
    'quantity', null
  ) order by cell.row_number, cell.column_number) into v_lines
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_value' and zysyr_private.daily_sheet_cell_value(cell) > 0;
  if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'DAILY_SHEET_ATOMIC_INCOME_REQUIRED'; end if;

  v_batch := public.zysyr_create_photo_import_batch(p_actor_user_id, p_company_id, p_store_id,
    v_draft.report_date, v_draft.source_voucher_id, v_lines, p_reason);
  if v_batch.status <> 'validated' then raise exception using errcode = '55000', message = 'DAILY_SHEET_IMPORT_CONFLICT'; end if;

  select jsonb_agg(jsonb_build_object(
    'sheet_name', '原图电子日报',
    'cell_address', zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text,
    'row_number', cell.row_number,
    'column_number', cell.column_number,
    'cell_kind', 'input',
    'display_value', coalesce(zysyr_private.daily_sheet_cell_value(cell)::text, ''),
    'numeric_value', zysyr_private.daily_sheet_cell_value(cell),
    'formula', null,
    'precedent_addresses', '[]'::jsonb,
    'label', cell.section_code || ' / ' || cell.row_label || ' / ' || cell.column_label
  ) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id;

  p_report := p_report || jsonb_build_object(
    'company_id', p_company_id, 'store_id', p_store_id, 'report_type', 'daily',
    'report_date', v_draft.report_date, 'template_code', v_draft.template_code,
    'template_version', v_draft.template_version, 'uploaded_by_user_id', p_actor_user_id
  );
  v_report_data := public.zysyr_register_report_upload(p_report, v_report_cells);
  v_report_id := (v_report_data->>'id')::uuid;

  update public.zysyr_import_batches set source_report_id = v_report_id, status = 'importing'
    where id = v_batch.id and company_id = p_company_id and store_id = p_store_id;
  insert into public.zysyr_voucher_links(company_id, store_id, voucher_id, business_type,
    business_id, relation_type, linked_by_user_id)
  values(p_company_id, p_store_id, v_draft.source_voucher_id, 'report_upload', v_report_id,
    'source_document', p_actor_user_id)
  on conflict(company_id, voucher_id, business_type, business_id, relation_type)
    where unlinked_at is null do nothing;

  with atomic as (
    select row_number() over(order by cell.row_number, cell.column_number) as line_number,
      zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text as cell_address
    from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.cell_role = 'staff_value' and zysyr_private.daily_sheet_cell_value(cell) > 0
  )
  update public.zysyr_import_rows import_row set source_report_cell_id = report_cell.id
  from atomic join public.zysyr_report_cells report_cell
    on report_cell.company_id = p_company_id and report_cell.store_id = p_store_id
    and report_cell.report_id = v_report_id and report_cell.sheet_name = '原图电子日报'
    and report_cell.cell_address = atomic.cell_address
  where import_row.company_id = p_company_id and import_row.store_id = p_store_id
    and import_row.import_batch_id = v_batch.id and import_row.row_number = atomic.line_number;

  select jsonb_agg(import_row.mapped_json || jsonb_build_object('source_report_cell_id', import_row.source_report_cell_id)
    order by import_row.row_number) into v_lines
  from public.zysyr_import_rows import_row
  where import_row.company_id = p_company_id and import_row.store_id = p_store_id
    and import_row.import_batch_id = v_batch.id;
  if exists(select 1 from public.zysyr_import_rows import_row where import_row.import_batch_id = v_batch.id
    and import_row.source_report_cell_id is null) then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_SOURCE_CELL_MAPPING_FAILED';
  end if;

  v_daily := public.zysyr_save_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_report_id, p_is_business_day, v_lines, p_reason);
  v_reconciliation := public.zysyr_finalize_daily_import(p_actor_user_id, p_company_id,
    p_store_id, v_batch.id, v_daily.id);
  if v_reconciliation.status <> 'matched' then raise exception using errcode = '22023', message = 'DAILY_SHEET_RECONCILIATION_FAILED'; end if;
  v_approved := public.zysyr_review_daily_report(p_actor_user_id, p_company_id, p_store_id,
    v_daily.id, 'approved', p_reason);

  insert into public.zysyr_daily_sheet_versions(company_id, store_id, draft_id, version,
    source_voucher_id, source_report_id, import_batch_id, daily_report_id,
    validation_result, confirmed_snapshot, confirmed_by_user_id, reason)
  select p_company_id, p_store_id, p_draft_id, 1, v_draft.source_voucher_id, v_report_id,
    v_batch.id, v_daily.id, v_validation,
    jsonb_agg(jsonb_build_object(
      'cell_id', cell.id, 'section_code', cell.section_code, 'row_key', cell.row_key,
      'row_label', cell.row_label, 'column_code', cell.column_code, 'column_label', cell.column_label,
      'row_number', cell.row_number, 'column_number', cell.column_number, 'cell_role', cell.cell_role,
      'ocr_text', cell.ocr_text, 'ocr_numeric', cell.ocr_numeric,
      'confirmed_numeric', zysyr_private.daily_sheet_cell_value(cell), 'manual_override', cell.manual_override,
      'confidence', cell.confidence, 'bbox', cell.bbox, 'source_method', cell.source_method
    ) order by cell.row_number, cell.column_number), p_actor_user_id, btrim(p_reason)
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
  returning * into v_version;

  update public.zysyr_daily_sheet_drafts set status = 'confirmed', validation_result = v_validation,
    updated_by_user_id = p_actor_user_id, updated_at = now(), confirmed_by_user_id = p_actor_user_id,
    confirmed_at = v_version.confirmed_at, confirm_reason = btrim(p_reason) where id = p_draft_id;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', p_draft_id,
    'confirm', jsonb_build_object('status', 'draft', 'edit_revision', v_draft.edit_revision),
    jsonb_build_object('status', 'confirmed', 'version_id', v_version.id,
      'source_report_id', v_report_id, 'daily_report_id', v_daily.id,
      'import_batch_id', v_batch.id, 'validation', v_validation), btrim(p_reason), 'financial');
  return jsonb_build_object('draft_id', p_draft_id, 'version_id', v_version.id,
    'source_report_id', v_report_id, 'import_batch_id', v_batch.id,
    'daily_report_id', v_daily.id, 'daily_report_status', v_approved.status,
    'reconciliation', to_jsonb(v_reconciliation), 'validation', v_validation,
    'formal_source', 'confirmed_daily_sheet_atomic_cells', 'meiguanjia_used', false);
end
$$;

revoke execute on function public.zysyr_create_daily_sheet_draft(uuid, uuid, uuid, date, uuid, text, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_create_daily_sheet_draft(uuid, uuid, uuid, date, uuid, text, text, jsonb, jsonb, text)
  to service_role;
grant execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.zysyr_confirm_daily_sheet(uuid, uuid, uuid, uuid, jsonb, boolean, text)
  to service_role;

alter table public.zysyr_daily_sheet_drafts enable row level security;
alter table public.zysyr_daily_sheet_drafts force row level security;
alter table public.zysyr_daily_sheet_cells enable row level security;
alter table public.zysyr_daily_sheet_cells force row level security;
alter table public.zysyr_daily_sheet_cell_changes enable row level security;
alter table public.zysyr_daily_sheet_cell_changes force row level security;
alter table public.zysyr_daily_sheet_versions enable row level security;
alter table public.zysyr_daily_sheet_versions force row level security;

create policy zysyr_daily_sheet_drafts_scope_select on public.zysyr_daily_sheet_drafts
  for select to authenticated using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_daily_sheet_cells_scope_select on public.zysyr_daily_sheet_cells
  for select to authenticated using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_daily_sheet_changes_scope_select on public.zysyr_daily_sheet_cell_changes
  for select to authenticated using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_daily_sheet_versions_scope_select on public.zysyr_daily_sheet_versions
  for select to authenticated using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_daily_sheet_drafts, public.zysyr_daily_sheet_cells,
  public.zysyr_daily_sheet_cell_changes, public.zysyr_daily_sheet_versions
from public, anon, authenticated, service_role;
grant select on table public.zysyr_daily_sheet_drafts, public.zysyr_daily_sheet_cells,
  public.zysyr_daily_sheet_cell_changes, public.zysyr_daily_sheet_versions to authenticated;
grant select, insert, update on table public.zysyr_daily_sheet_drafts, public.zysyr_daily_sheet_cells to service_role;
grant select, insert on table public.zysyr_daily_sheet_cell_changes, public.zysyr_daily_sheet_versions to service_role;

create trigger zysyr_daily_sheet_changes_append_only before update or delete on public.zysyr_daily_sheet_cell_changes
  for each row execute function zysyr_private.protect_report_trace_history();
create trigger zysyr_daily_sheet_versions_append_only before update or delete on public.zysyr_daily_sheet_versions
  for each row execute function zysyr_private.protect_report_trace_history();

comment on table public.zysyr_daily_sheet_drafts is
  'Editable finance-only projection of an immutable approved daily-report image; OCR values are candidates until explicit confirmation.';
comment on table public.zysyr_daily_sheet_cells is
  'Exact-position daily template cells with OCR candidate, manual correction, confidence, bbox, and independent control roles.';
comment on table public.zysyr_daily_sheet_cell_changes is
  'Append-only before/after audit for every finance correction made in the image-aligned daily sheet.';
comment on table public.zysyr_daily_sheet_versions is
  'Immutable confirmed daily sheet snapshot linked to original voucher, report cells, import batch, and approved daily report.';
