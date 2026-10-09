-- Synthetic schema fixture extracted from production catalog, 2026-10-09.
-- No financial records, customers, tokens or production identifiers.
create role anon; create role authenticated; create role service_role bypassrls;
create schema zysyr_private;
create table public.zysyr_audit_events (
  id bigint generated always as identity not null,
  event_uuid uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid,
  actor_type text not null,
  actor_user_id uuid,
  service_actor text,
  request_id uuid,
  transaction_id bigint default txid_current() not null,
  channel text default 'api'::text not null,
  entity_type text not null,
  entity_id uuid,
  entity_key text,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  sensitivity text default 'normal'::text not null,
  created_at timestamp with time zone default now() not null,
CHECK ((actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))),
CHECK ((channel = ANY (ARRAY['api'::text, 'import'::text, 'ocr'::text, 'system'::text, 'migration'::text]))),
CHECK (((entity_id IS NOT NULL) OR (NULLIF(btrim(entity_key), ''::text) IS NOT NULL))),
CHECK ((((actor_type = 'user'::text) AND (actor_user_id IS NOT NULL)) OR ((actor_type = ANY (ARRAY['service'::text, 'system'::text])) AND (NULLIF(btrim(service_actor), ''::text) IS NOT NULL)))),
CHECK (((action <> ALL (ARRAY['amount_change'::text, 'approve'::text, 'reverse'::text, 'unlock'::text, 'voucher_relink'::text, 'payroll_change'::text, 'inventory_cost_change'::text])) OR (NULLIF(btrim(reason), ''::text) IS NOT NULL))),
UNIQUE (event_uuid),
PRIMARY KEY (id),
CHECK ((sensitivity = ANY (ARRAY['normal'::text, 'personal'::text, 'payroll'::text, 'financial'::text])))
);
create table public.zysyr_capabilities (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  risk_level text default 'normal'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
CHECK ((code ~ '^[a-z][a-z0-9_.-]{2,95}$'::text)),
UNIQUE (code),
PRIMARY KEY (id),
CHECK ((risk_level = ANY (ARRAY['normal'::text, 'sensitive'::text, 'high'::text])))
);
create table public.zysyr_companies (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
CHECK ((code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'::text)),
UNIQUE (code),
UNIQUE (id, code),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);
create table public.zysyr_daily_report_lines (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  daily_report_id uuid not null,
  line_number integer not null,
  line_type text not null,
  metric_code text not null,
  description text not null,
  amount numeric(14,2),
  quantity numeric(14,4),
  source_report_cell_id uuid,
  created_at timestamp with time zone default now() not null,
CHECK (((amount IS NULL) OR (amount >= (0)::numeric))),
CHECK ((((line_type = 'note'::text) AND (amount IS NULL)) OR ((line_type <> 'note'::text) AND (amount IS NOT NULL) AND (source_report_cell_id IS NOT NULL)))),
UNIQUE (company_id, daily_report_id, line_number),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
CHECK ((NULLIF(btrim(description), ''::text) IS NOT NULL)),
CHECK ((line_number > 0)),
CHECK ((line_type = ANY (ARRAY['income'::text, 'expense'::text, 'petty_cash'::text, 'payment'::text, 'note'::text]))),
CHECK ((metric_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)),
PRIMARY KEY (id),
CHECK (((quantity IS NULL) OR (quantity >= (0)::numeric)))
);
create table public.zysyr_daily_reports (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  report_date date not null,
  is_business_day boolean not null,
  business_day_source text default 'monday_rule'::text not null,
  version integer not null,
  supersedes_daily_report_id uuid,
  source_report_id uuid not null,
  status text default 'submitted'::text not null,
  submitted_by_user_id uuid not null,
  submitted_at timestamp with time zone default now() not null,
  reviewed_by_user_id uuid,
  reviewed_at timestamp with time zone,
  review_reason text,
  reversed_by_user_id uuid,
  reversed_at timestamp with time zone,
  reverse_reason text,
  created_at timestamp with time zone default now() not null,
CHECK ((business_day_source = ANY (ARRAY['monday_rule'::text, 'manual_override'::text]))),
CHECK ((((version = 1) AND (supersedes_daily_report_id IS NULL)) OR ((version > 1) AND (supersedes_daily_report_id IS NOT NULL)))),
CHECK ((((status = 'submitted'::text) AND (reviewed_by_user_id IS NULL) AND (reviewed_at IS NULL)) OR ((status = ANY (ARRAY['approved'::text, 'rejected'::text])) AND (reviewed_by_user_id IS NOT NULL) AND (reviewed_at IS NOT NULL)) OR ((status = 'reversed'::text) AND (reversed_by_user_id IS NOT NULL) AND (reversed_at IS NOT NULL)))),
CHECK (((status <> 'rejected'::text) OR (NULLIF(btrim(review_reason), ''::text) IS NOT NULL))),
CHECK (((status <> 'reversed'::text) OR (NULLIF(btrim(reverse_reason), ''::text) IS NOT NULL))),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
UNIQUE (company_id, store_id, report_date, version),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'reversed'::text]))),
CHECK ((version > 0))
);
CREATE UNIQUE INDEX zysyr_daily_reports_current_uidx ON public.zysyr_daily_reports USING btree (company_id, store_id, report_date) WHERE (status = ANY (ARRAY['submitted'::text, 'approved'::text]));
create table public.zysyr_daily_sheet_cell_changes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  cell_id uuid not null,
  revision integer not null,
  before_value numeric(14,2),
  after_value numeric(14,2),
  changed_by_user_id uuid not null,
  changed_at timestamp with time zone default now() not null,
  reason text not null,
  before_text text,
  after_text text,
  before_label text,
  after_label text,
  row_label_reviewed boolean default false not null,
  value_reviewed boolean default false not null,
UNIQUE (company_id, cell_id, revision),
UNIQUE (company_id, id),
PRIMARY KEY (id),
CHECK ((NULLIF(btrim(reason), ''::text) IS NOT NULL)),
CHECK ((revision > 0))
);
create table public.zysyr_daily_sheet_cells (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  section_code text not null,
  row_key text not null,
  row_label text not null,
  column_code text not null,
  column_label text not null,
  row_number integer not null,
  column_number integer not null,
  cell_role text not null,
  ocr_text text,
  ocr_numeric numeric(14,2),
  corrected_numeric numeric(14,2),
  manual_override boolean default false not null,
  confidence numeric(5,4),
  bbox jsonb,
  source_method text not null,
  created_at timestamp with time zone default now() not null,
  updated_by_user_id uuid,
  updated_at timestamp with time zone default now() not null,
  manual_text text,
  row_label_source_method text default 'template'::text not null,
  row_label_confidence numeric(5,4),
CHECK (((bbox IS NULL) OR (jsonb_typeof(bbox) = 'array'::text))),
CHECK ((cell_role = ANY (ARRAY['staff_value'::text, 'staff_total'::text, 'staff_count'::text, 'category_total'::text, 'technician_value'::text, 'technician_total'::text, 'technician_category_total'::text, 'product_value'::text, 'product_total'::text, 'summary_value'::text, 'summary_actual'::text, 'summary_grand'::text, 'payment_method'::text, 'payment_cashflow'::text, 'payment_card_consumption'::text, 'payment_total'::text, 'signature'::text, 'unclosed_order'::text, 'note'::text, 'payment_nail'::text, 'payment_product'::text, 'payment_subtotal'::text]))),
CHECK ((column_code ~ '^[a-z0-9_]{1,80}$'::text)),
CHECK (((char_length(column_label) >= 1) AND (char_length(column_label) <= 120))),
CHECK (((column_number >= 1) AND (column_number <= 30))),
UNIQUE (company_id, draft_id, section_code, row_key, column_code),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
CHECK (((corrected_numeric IS NULL) OR (corrected_numeric >= (0)::numeric))),
CHECK (((ocr_numeric IS NULL) OR (ocr_numeric >= (0)::numeric))),
PRIMARY KEY (id),
CHECK ((row_key ~ '^[a-z0-9_]{1,80}$'::text)),
CHECK (((char_length(row_label) >= 1) AND (char_length(row_label) <= 120))),
CHECK (((row_label_confidence IS NULL) OR ((row_label_confidence >= (0)::numeric) AND (row_label_confidence <= (1)::numeric)))),
CHECK ((row_label_source_method = ANY (ARRAY['template'::text, 'codex_local_candidate'::text, 'manual'::text]))),
CHECK (((row_number >= 1) AND (row_number <= 120))),
CHECK ((section_code = ANY (ARRAY['stylist'::text, 'technician'::text, 'product'::text, 'summary'::text, 'payment'::text]))),
CHECK ((source_method = ANY (ARRAY['openai_vision'::text, 'openai_vision_candidate'::text, 'codex_local_candidate'::text, 'kimi_vision'::text, 'kimi_vision_candidate'::text, 'paddle_ocr'::text, 'blank_template'::text, 'frontdesk_autofill'::text])))
);
create table public.zysyr_daily_sheet_drafts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  source_voucher_id uuid,
  report_date date not null,
  template_code text default 'zysyr_daily_performance_photo'::text not null,
  template_version integer default 1 not null,
  status text default 'draft'::text not null,
  source_sha256 text,
  ocr_provider text not null,
  ocr_model text not null,
  ocr_raw_result jsonb default '{}'::jsonb not null,
  validation_result jsonb default '{}'::jsonb not null,
  edit_revision integer default 0 not null,
  created_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_by_user_id uuid,
  updated_at timestamp with time zone default now() not null,
  confirmed_by_user_id uuid,
  confirmed_at timestamp with time zone,
  confirm_reason text,
CHECK (((created_by_user_id IS NOT NULL) OR (ocr_provider = 'frontdesk-autofill'::text))),
CHECK ((((status = 'confirmed'::text) AND (confirmed_by_user_id IS NOT NULL) AND (confirmed_at IS NOT NULL) AND (NULLIF(btrim(confirm_reason), ''::text) IS NOT NULL)) OR ((status <> 'confirmed'::text) AND (confirmed_by_user_id IS NULL) AND (confirmed_at IS NULL) AND (confirm_reason IS NULL)))),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
CHECK ((edit_revision >= 0)),
CHECK ((jsonb_typeof(ocr_raw_result) = 'object'::text)),
PRIMARY KEY (id),
CHECK ((source_sha256 ~ '^[0-9a-f]{64}$'::text)),
CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text]))),
CHECK ((template_version > 0)),
CHECK ((jsonb_typeof(validation_result) = 'object'::text))
);
CREATE UNIQUE INDEX zysyr_daily_sheet_one_open_voucher_uidx ON public.zysyr_daily_sheet_drafts USING btree (company_id, store_id, source_voucher_id) WHERE (status = ANY (ARRAY['draft'::text, 'confirmed'::text]));
create table public.zysyr_daily_sheet_versions (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  version integer not null,
  source_voucher_id uuid not null,
  source_report_id uuid not null,
  import_batch_id uuid not null,
  daily_report_id uuid not null,
  validation_result jsonb not null,
  confirmed_snapshot jsonb not null,
  confirmed_by_user_id uuid not null,
  confirmed_at timestamp with time zone default now() not null,
  reason text not null,
UNIQUE (company_id, draft_id, version),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
CHECK ((jsonb_typeof(confirmed_snapshot) = 'array'::text)),
PRIMARY KEY (id),
CHECK ((NULLIF(btrim(reason), ''::text) IS NOT NULL)),
CHECK ((jsonb_typeof(validation_result) = 'object'::text)),
CHECK ((version > 0))
);
create table public.zysyr_import_batches (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  import_type text not null,
  report_date date not null,
  source_voucher_id uuid not null,
  source_report_id uuid,
  status text default 'validated'::text not null,
  raw_row_count integer not null,
  mapped_row_count integer default 0 not null,
  payload_sha256 text not null,
  reason text not null,
  created_by_user_id uuid not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  error_message text,
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
CHECK ((import_type = ANY (ARRAY['daily_photo'::text, 'performance_photo'::text, 'payroll_photo'::text, 'inventory_photo'::text]))),
CHECK (((mapped_row_count >= 0) AND (mapped_row_count <= 1000))),
CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'::text)),
PRIMARY KEY (id),
CHECK (((raw_row_count >= 1) AND (raw_row_count <= 1000))),
CHECK ((NULLIF(btrim(reason), ''::text) IS NOT NULL)),
CHECK ((status = ANY (ARRAY['validated'::text, 'conflict'::text, 'importing'::text, 'reconciled'::text, 'failed'::text, 'cancelled'::text])))
);
create table public.zysyr_import_conflicts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  conflict_type text not null,
  existing_entity_type text,
  existing_entity_id uuid,
  details jsonb default '{}'::jsonb not null,
  resolution_status text default 'open'::text not null,
  created_at timestamp with time zone default now() not null,
UNIQUE (company_id, id),
CHECK ((conflict_type = ANY (ARRAY['existing_daily_report'::text, 'duplicate_source'::text, 'row_validation'::text, 'amount_mismatch'::text]))),
CHECK ((jsonb_typeof(details) = 'object'::text)),
PRIMARY KEY (id),
CHECK ((resolution_status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text])))
);
create table public.zysyr_import_rows (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  row_number integer not null,
  raw_json jsonb not null,
  mapped_json jsonb not null,
  validation_status text not null,
  validation_errors jsonb default '[]'::jsonb not null,
  source_report_cell_id uuid,
  business_type text,
  business_id uuid,
  created_at timestamp with time zone default now() not null,
UNIQUE (company_id, id),
UNIQUE (company_id, import_batch_id, row_number),
UNIQUE (company_id, store_id, id),
CHECK ((jsonb_typeof(mapped_json) = 'object'::text)),
PRIMARY KEY (id),
CHECK ((jsonb_typeof(raw_json) = 'object'::text)),
CHECK ((row_number > 0)),
CHECK ((jsonb_typeof(validation_errors) = 'array'::text)),
CHECK ((validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'invalid'::text])))
);
create table public.zysyr_income_records (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  income_date date not null,
  category_code text not null,
  summary text not null,
  amount numeric(14,2) not null,
  payment_method text default ''::text not null,
  daily_report_id uuid not null,
  daily_report_line_id uuid not null,
  source_report_cell_id uuid not null,
  status text default 'approved'::text not null,
  approved_by_user_id uuid not null,
  approved_at timestamp with time zone default now() not null,
  reversed_by_user_id uuid,
  reversed_at timestamp with time zone,
  reverse_reason text,
  created_at timestamp with time zone default now() not null,
CHECK ((amount >= (0)::numeric)),
CHECK ((category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)),
CHECK ((((status = 'approved'::text) AND (reversed_by_user_id IS NULL) AND (reversed_at IS NULL)) OR ((status = 'reversed'::text) AND (reversed_by_user_id IS NOT NULL) AND (reversed_at IS NOT NULL) AND (NULLIF(btrim(reverse_reason), ''::text) IS NOT NULL)))),
UNIQUE (company_id, daily_report_line_id),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, id),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['approved'::text, 'reversed'::text]))),
CHECK ((NULLIF(btrim(summary), ''::text) IS NOT NULL))
);
create table public.zysyr_reconciliation_lines (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  reconciliation_report_id uuid not null,
  import_row_id uuid not null,
  business_type text,
  business_id uuid,
  source_amount numeric(14,2),
  business_amount numeric(14,2),
  delta numeric(14,2),
  status text not null,
  details jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
UNIQUE (company_id, id),
UNIQUE (company_id, reconciliation_report_id, import_row_id),
CHECK ((jsonb_typeof(details) = 'object'::text)),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['matched'::text, 'mismatch'::text, 'missing'::text])))
);
create table public.zysyr_reconciliation_reports (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  import_batch_id uuid not null,
  daily_report_id uuid,
  status text not null,
  source_row_count integer not null,
  business_row_count integer not null,
  source_amount numeric(14,2) not null,
  business_amount numeric(14,2) not null,
  delta numeric(14,2) not null,
  generated_by_user_id uuid not null,
  generated_at timestamp with time zone default now() not null,
UNIQUE (company_id, id),
UNIQUE (company_id, import_batch_id),
UNIQUE (company_id, store_id, id),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['matched'::text, 'mismatch'::text, 'incomplete'::text])))
);
create table public.zysyr_report_cells (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  report_id uuid not null,
  sheet_name text not null,
  cell_address text not null,
  row_number integer not null,
  column_number integer not null,
  cell_kind text not null,
  display_value text default ''::text not null,
  numeric_value numeric(18,4),
  formula text,
  precedent_addresses jsonb default '[]'::jsonb not null,
  label text default ''::text not null,
  created_at timestamp with time zone default now() not null,
CHECK ((cell_address ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'::text)),
CHECK ((cell_kind = ANY (ARRAY['input'::text, 'formula'::text]))),
CHECK ((((cell_kind = 'formula'::text) AND (NULLIF(btrim(formula), ''::text) IS NOT NULL)) OR ((cell_kind = 'input'::text) AND (formula IS NULL)))),
CHECK (((column_number >= 1) AND (column_number <= 30))),
UNIQUE (company_id, id),
UNIQUE (company_id, report_id, sheet_name, cell_address),
UNIQUE (company_id, store_id, id),
PRIMARY KEY (id),
CHECK ((jsonb_typeof(precedent_addresses) = 'array'::text)),
CHECK (((row_number >= 1) AND (row_number <= 120))),
CHECK (((char_length(sheet_name) >= 1) AND (char_length(sheet_name) <= 120)))
);
create table public.zysyr_report_uploads (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid not null,
  report_type text not null,
  report_date date not null,
  template_code text not null,
  template_version integer default 1 not null,
  version integer default 1 not null,
  supersedes_report_id uuid,
  status text default 'active'::text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  bucket_id text default 'zysyr-reports'::text not null,
  object_path text not null,
  display_data jsonb default '{}'::jsonb not null,
  uploaded_by_user_id uuid not null,
  uploaded_at timestamp with time zone default now() not null,
CHECK ((bucket_id = 'zysyr-reports'::text)),
CHECK (((supersedes_report_id IS NULL) OR (version > 1))),
UNIQUE (company_id, id),
UNIQUE (company_id, store_id, report_type, report_date, version),
UNIQUE (company_id, store_id, id),
CHECK ((jsonb_typeof(display_data) = 'object'::text)),
CHECK ((mime_type = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/pdf'::text, 'image/jpeg'::text, 'image/png'::text]))),
CHECK (((report_type <> ALL (ARRAY['salary'::text, 'monthly_profit_loss'::text])) OR (report_date = (date_trunc('month'::text, (report_date)::timestamp with time zone))::date))),
PRIMARY KEY (id),
CHECK ((report_type = ANY (ARRAY['daily'::text, 'performance'::text, 'salary'::text, 'monthly_profit_loss'::text]))),
CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
CHECK (((COALESCE((display_data ->> 'source_object_reused'::text), 'false'::text) <> 'true'::text) OR (report_type = 'monthly_profit_loss'::text))),
CHECK (((size_bytes > 0) AND (size_bytes <= 10485760))),
CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text]))),
CHECK ((template_version > 0)),
CHECK ((version > 0))
);
CREATE UNIQUE INDEX zysyr_report_uploads_owned_object_path_key ON public.zysyr_report_uploads USING btree (object_path) WHERE (COALESCE((display_data ->> 'source_object_reused'::text), 'false'::text) <> 'true'::text);
create table public.zysyr_role_capabilities (
  role_id uuid not null,
  capability_id uuid not null,
  created_at timestamp with time zone default now() not null,
PRIMARY KEY (role_id, capability_id)
);
create table public.zysyr_roles (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
CHECK ((code ~ '^[a-z][a-z0-9_.-]{1,63}$'::text)),
UNIQUE (code),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);
create table public.zysyr_stores (
  id uuid default gen_random_uuid() not null,
  name text not null,
  city text default ''::text not null,
  status text default 'active'::text not null,
  created_by text default 'system'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_id uuid,
  code text,
  address text,
  manager_employee_id uuid,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  deleted_at timestamp with time zone,
  deleted_by_user_id uuid,
UNIQUE (company_id, id),
UNIQUE (name),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);
CREATE UNIQUE INDEX zysyr_stores_company_code_uidx ON public.zysyr_stores USING btree (company_id, code) WHERE ((company_id IS NOT NULL) AND (code IS NOT NULL));
create table public.zysyr_trace_edges (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid,
  from_node_id uuid not null,
  to_node_id uuid not null,
  relation_type text not null,
  source_amount numeric(14,2),
  source_quantity numeric(14,4),
  created_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
CHECK ((from_node_id <> to_node_id)),
UNIQUE (company_id, from_node_id, to_node_id, relation_type),
PRIMARY KEY (id),
CHECK ((relation_type = ANY (ARRAY['derived_from'::text, 'allocated_to'::text, 'evidenced_by'::text, 'reversed_by'::text, 'contains'::text])))
);
create table public.zysyr_trace_nodes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamp with time zone default now() not null,
UNIQUE (company_id, entity_type, entity_id),
UNIQUE (company_id, id),
PRIMARY KEY (id)
);
create table public.zysyr_user_accounts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  auth_user_id uuid not null,
  employee_id uuid,
  display_name text not null,
  phone text,
  email text,
  status text default 'invited'::text not null,
  activated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  login_name text,
UNIQUE (auth_user_id),
UNIQUE (company_id, id),
PRIMARY KEY (id),
CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'disabled'::text])))
);
CREATE UNIQUE INDEX zysyr_user_accounts_company_employee_uidx ON public.zysyr_user_accounts USING btree (company_id, employee_id) WHERE (employee_id IS NOT NULL);
CREATE UNIQUE INDEX zysyr_user_accounts_company_login_name_uidx ON public.zysyr_user_accounts USING btree (company_id, lower(btrim(login_name))) WHERE (login_name IS NOT NULL);
create table public.zysyr_user_capability_grants (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_account_id uuid not null,
  capability_id uuid not null,
  scope_type text not null,
  store_id uuid,
  valid_from date default CURRENT_DATE not null,
  valid_to date,
  granted_by_user_id uuid,
  granted_at timestamp with time zone default now() not null,
  revoked_at timestamp with time zone,
  revoked_by_user_id uuid,
  revoke_reason text,
CHECK ((((scope_type = 'company'::text) AND (store_id IS NULL)) OR ((scope_type = 'store'::text) AND (store_id IS NOT NULL)))),
CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
CHECK (((revoked_at IS NULL) OR (NULLIF(btrim(revoke_reason), ''::text) IS NOT NULL))),
PRIMARY KEY (id),
CHECK ((scope_type = ANY (ARRAY['company'::text, 'store'::text])))
);
CREATE UNIQUE INDEX zysyr_user_capability_store_active_uidx ON public.zysyr_user_capability_grants USING btree (company_id, store_id, user_account_id, capability_id) WHERE ((scope_type = 'store'::text) AND (revoked_at IS NULL));
CREATE UNIQUE INDEX zysyr_user_capability_company_active_uidx ON public.zysyr_user_capability_grants USING btree (company_id, user_account_id, capability_id) WHERE ((scope_type = 'company'::text) AND (store_id IS NULL) AND (revoked_at IS NULL));
create table public.zysyr_user_role_grants (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_account_id uuid not null,
  role_id uuid not null,
  scope_type text not null,
  store_id uuid,
  valid_from date default CURRENT_DATE not null,
  valid_to date,
  granted_by_user_id uuid,
  granted_at timestamp with time zone default now() not null,
  revoked_at timestamp with time zone,
  revoked_by_user_id uuid,
  revoke_reason text,
CHECK ((((scope_type = 'company'::text) AND (store_id IS NULL)) OR ((scope_type = 'store'::text) AND (store_id IS NOT NULL)))),
CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
CHECK (((revoked_at IS NULL) OR (NULLIF(btrim(revoke_reason), ''::text) IS NOT NULL))),
PRIMARY KEY (id),
CHECK ((scope_type = ANY (ARRAY['company'::text, 'store'::text])))
);
CREATE UNIQUE INDEX zysyr_user_role_store_active_uidx ON public.zysyr_user_role_grants USING btree (company_id, store_id, user_account_id, role_id) WHERE ((scope_type = 'store'::text) AND (revoked_at IS NULL));
CREATE UNIQUE INDEX zysyr_user_role_company_active_uidx ON public.zysyr_user_role_grants USING btree (company_id, user_account_id, role_id) WHERE ((scope_type = 'company'::text) AND (store_id IS NULL) AND (revoked_at IS NULL));
create table public.zysyr_voucher_attachments (
  id uuid default gen_random_uuid() not null,
  store text not null,
  record_type text not null,
  record_id text,
  bucket_id text default 'zysyr-vouchers'::text not null,
  object_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  note text default ''::text not null,
  uploaded_by text not null,
  uploaded_at timestamp with time zone default now() not null,
  company_id uuid,
  store_id uuid,
  sha256 text,
  storage_etag text,
  object_version text,
  immutable_version integer,
  supersedes_voucher_id uuid,
  uploaded_by_user_id uuid,
  ocr_status text default 'pending'::text not null,
  audit_status text default 'pending'::text not null,
  document_type text default 'unclassified'::text not null,
  reviewed_at timestamp with time zone,
  reviewed_by_user_id uuid,
  updated_at timestamp with time zone default now() not null,
  updated_by_user_id uuid,
CHECK ((audit_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
UNIQUE (company_id, id),
CHECK ((document_type = ANY (ARRAY['unclassified'::text, 'daily_report'::text, 'performance_report'::text, 'expense'::text, 'purchase'::text, 'salary'::text, 'petty_cash'::text, 'attendance_check'::text, 'payment'::text, 'other'::text]))),
CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'application/pdf'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text]))),
UNIQUE (object_path),
CHECK ((ocr_status = ANY (ARRAY['pending'::text, 'processing'::text, 'reviewed'::text, 'failed'::text]))),
PRIMARY KEY (id),
CHECK ((record_type = ANY (ARRAY['unassigned'::text, 'expense'::text, 'income'::text, 'report'::text]))),
CHECK ((((audit_status = 'pending'::text) AND (reviewed_at IS NULL) AND (reviewed_by_user_id IS NULL)) OR ((audit_status = ANY (ARRAY['approved'::text, 'rejected'::text])) AND (reviewed_at IS NOT NULL) AND (reviewed_by_user_id IS NOT NULL)))),
CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text))),
CHECK (((size_bytes > 0) AND (size_bytes <= 10485760))),
CHECK (((immutable_version IS NULL) OR (immutable_version > 0)))
);
create table public.zysyr_voucher_links (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid,
  voucher_id uuid not null,
  business_type text not null,
  business_id uuid not null,
  relation_type text default 'evidence'::text not null,
  linked_by_user_id uuid,
  linked_at timestamp with time zone default now() not null,
  unlinked_at timestamp with time zone,
  unlink_reason text,
CHECK (((unlinked_at IS NULL) OR (NULLIF(btrim(unlink_reason), ''::text) IS NOT NULL))),
PRIMARY KEY (id),
CHECK ((relation_type = ANY (ARRAY['evidence'::text, 'payment_proof'::text, 'source_document'::text, 'replacement'::text])))
);
CREATE UNIQUE INDEX zysyr_voucher_links_active_uidx ON public.zysyr_voucher_links USING btree (company_id, voucher_id, business_type, business_id, relation_type) WHERE (unlinked_at IS NULL);
create table public.zysyr_workflow_events (
  id bigint generated always as identity not null,
  event_uuid uuid default gen_random_uuid() not null,
  company_id uuid not null,
  store_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  action text not null,
  actor_user_id uuid,
  service_actor text,
  reason text,
  request_id uuid,
  created_at timestamp with time zone default now() not null,
CHECK ((action = ANY (ARRAY['submit'::text, 'approve'::text, 'reject'::text, 'confirm'::text, 'reverse'::text, 'void'::text]))),
CHECK (((actor_user_id IS NOT NULL) OR (NULLIF(btrim(service_actor), ''::text) IS NOT NULL))),
CHECK (((action <> ALL (ARRAY['reject'::text, 'reverse'::text, 'void'::text])) OR (NULLIF(btrim(reason), ''::text) IS NOT NULL))),
UNIQUE (event_uuid),
PRIMARY KEY (id)
);
CREATE OR REPLACE FUNCTION zysyr_private.account_has_capability(target_user_account_id uuid, target_company_id uuid, target_store_id uuid, target_capability_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select target_user_account_id is not null
    and target_company_id is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.zysyr_companies company
      where company.id = target_company_id and company.status = 'active'
    )
    and exists (
      select 1
      from public.zysyr_stores store
      where store.id = target_store_id
        and store.company_id = target_company_id
        and store.status = 'active'
        and store.deleted_at is null
    )
    and exists (
      select 1
      from public.zysyr_user_accounts ua
      where ua.id = target_user_account_id
        and ua.company_id = target_company_id
        and ua.status = 'active'
        and (
          exists (
            select 1
            from public.zysyr_user_role_grants urg
            join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
            join public.zysyr_capabilities c on c.id = rc.capability_id
            where urg.user_account_id = ua.id
              and urg.company_id = target_company_id
              and urg.revoked_at is null
              and urg.valid_from <= current_date
              and (urg.valid_to is null or urg.valid_to >= current_date)
              and c.code = target_capability_code
              and (
                urg.scope_type = 'company'
                or (urg.scope_type = 'store' and urg.store_id = target_store_id)
              )
          )
          or exists (
            select 1
            from public.zysyr_user_capability_grants ucg
            join public.zysyr_capabilities c on c.id = ucg.capability_id
            where ucg.user_account_id = ua.id
              and ucg.company_id = target_company_id
              and ucg.revoked_at is null
              and ucg.valid_from <= current_date
              and (ucg.valid_to is null or ucg.valid_to >= current_date)
              and c.code = target_capability_code
              and (
                ucg.scope_type = 'company'
                or (ucg.scope_type = 'store' and ucg.store_id = target_store_id)
              )
          )
        )
    )
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.daily_sheet_cell_value(p_cell zysyr_daily_sheet_cells)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_cell.manual_override then p_cell.corrected_numeric
    else null::numeric
  end
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.daily_sheet_validation(p_company_id uuid, p_store_id uuid, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff_atomic numeric := 0;
  v_staff_reported numeric := 0;
  v_category_reported numeric := 0;
  v_stylist_subtotal numeric;
  v_stylist_subtotal_count integer := 0;
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
  v_earned_mode boolean:=false; v_cash_mode boolean:=false; v_card_sales numeric; v_cash_metadata jsonb; v_cash_source_current boolean:=false;
begin
  if not exists (select 1 from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id) then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;

  select draft.ocr_raw_result#>'{autofill,cash_receipts}' into v_cash_metadata
  from public.zysyr_daily_sheet_drafts draft where draft.company_id=p_company_id and draft.store_id=p_store_id and draft.id=p_draft_id;
  v_cash_mode:=coalesce(v_cash_metadata->>'policy'='operating-external-cash-v1' and v_cash_metadata->>'state'='candidate',false);
  select coalesce(d.ocr_raw_result#>>'{autofill,daily_total_policy}'='cash-plus-earned-card-v1',false) into v_earned_mode
  from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id;
  if v_cash_mode then
    select zysyr_private.daily_sheet_cell_value(cell) into v_card_sales
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id
      and cell.section_code='summary' and cell.row_key='summary' and cell.column_code='card_subtotal';
    v_cash_source_current:=exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id and d.status='confirmed')
      or v_cash_metadata is not distinct from (zysyr_daily_electronic_private.cash_receipt_projection(p_company_id,p_store_id,
        (select report_date from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id and store_id=p_store_id))->'metadata');
  end if;

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0),
    count(*) filter (where zysyr_private.daily_sheet_cell_value(cell) is not null)
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

  select max(zysyr_private.daily_sheet_cell_value(cell)), count(*)
    into v_stylist_subtotal, v_stylist_subtotal_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.section_code = 'stylist' and cell.row_key = 'stylist_category_total'
    and cell.column_code = 'subtotal' and cell.cell_role = 'summary_value';

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
  select case when v_earned_mode then zysyr_private.daily_sheet_cell_value(cell) else coalesce(zysyr_private.daily_sheet_cell_value(cell),0) end into v_card_consumption
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_card_consumption' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_payment_total
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_total' limit 1;

  if v_earned_mode and v_card_consumption is null then v_missing_controls:=array_append(v_missing_controls,'实际获得卡金业绩'); end if;
  if v_actual is null then v_missing_controls := array_append(v_missing_controls, '实做'); end if;
  if v_grand is null then v_missing_controls := array_append(v_missing_controls, '总计'); end if;
  if v_cashflow is null then v_missing_controls := array_append(v_missing_controls, '现金流'); end if;
  if v_payment_total is null then v_missing_controls := array_append(v_missing_controls, '支付总计'); end if;
  if v_atomic_count = 0 then v_missing_controls := array_append(v_missing_controls, '员工明细'); end if;
  if v_stylist_subtotal_count <> 1 or v_stylist_subtotal is null then
    v_missing_controls := array_append(v_missing_controls, '造型区总小计');
  end if;

  if v_cash_mode and v_card_sales is null then v_missing_controls:=array_append(v_missing_controls,'卡类新收款小计'); end if;
  if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb) then
    v_missing_controls:=array_append(v_missing_controls,'现金收款来源核对');
  end if;
  v_valid := cardinality(v_missing_controls) = 0
    and v_row_mismatches = 0 and v_category_mismatches = 0
    and v_staff_atomic > 0
    and abs(v_staff_atomic - v_staff_reported) <= 0.01
    and abs(v_staff_atomic - v_category_reported) <= 0.01
    and abs(v_staff_atomic - v_stylist_subtotal) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and (case when v_cash_mode then
      abs(v_actual-v_cashflow-(case when v_earned_mode then v_card_consumption else 0 end))<=0.01 and abs(v_actual+v_card_sales-v_grand)<=0.01
      and abs(v_grand-v_payment_total)<=0.01
    else abs(v_staff_atomic-v_actual)<=0.01 and abs(v_staff_atomic-v_grand)<=0.01
      and abs(v_cashflow+v_card_consumption-v_payment_total)<=0.01 and abs(v_staff_atomic-v_payment_total)<=0.01 end);

  return jsonb_build_object(
    'valid', v_valid,
    'staff_atomic_total', round(v_staff_atomic, 2),
    'staff_reported_total', round(v_staff_reported, 2),
    'category_reported_total', round(v_category_reported, 2),
    'stylist_subtotal', v_stylist_subtotal,
    'stylist_subtotal_mismatch', v_stylist_subtotal is null or abs(v_staff_atomic - v_stylist_subtotal) > 0.01,
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
    'daily_total_policy',case when v_earned_mode then 'cash-plus-earned-card-v1' else null end,
    'cash_policy',case when v_cash_mode then 'operating-external-cash-v1' else null end,
    'income_source',case when v_cash_mode then 'operating_external_cash_receipts' else 'nonzero_stylist_atomic_cells_only' end
  );
end
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.enforce_one_active_daily_sheet_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status in ('draft', 'confirmed') and exists (
    select 1 from public.zysyr_daily_sheet_drafts existing
    where existing.company_id = new.company_id and existing.store_id = new.store_id
      and existing.report_date = new.report_date and existing.status in ('draft', 'confirmed')
      and existing.id <> new.id
  ) then
    raise exception using errcode = '23505', message = 'DAILY_SHEET_DATE_ALREADY_EXISTS';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.lock_daily_rollup_month()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||new.store_id::text||':'||date_trunc('month',new.report_date)::date::text,0));
  return new;
end $function$;

CREATE OR REPLACE FUNCTION zysyr_private.request_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_legacy_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_claims_text text := coalesce(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
begin
  if v_legacy_role <> '' then return v_legacy_role; end if;
  if v_claims_text = '' then return ''; end if;
  begin
    v_claims := v_claims_text::jsonb;
  exception when others then
    return '';
  end;
  return coalesce(v_claims->>'role', '');
end
$function$;

CREATE OR REPLACE FUNCTION zysyr_private.sheet_column_name(p_column integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_column between 1 and 26
    then pg_catalog.chr(64 + p_column)
    when p_column between 27 and 30
    then 'A' || pg_catalog.chr(64 + p_column - 26)
    else null end
$function$;
