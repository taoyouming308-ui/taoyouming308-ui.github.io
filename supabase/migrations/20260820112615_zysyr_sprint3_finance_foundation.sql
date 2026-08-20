-- ZYSYR V2 Sprint 3 finance foundation.
-- Raw XLSX uploads/cells remain immutable evidence. These tables are the
-- formal business-record layer and never read or write Meiguanjia turnover.

set statement_timeout = '30s';
set lock_timeout = '5s';

-- Sprint 0 predates the formal finance layer. Preserve its existing labels and
-- add the explicit finance classification used by Sprint 2/3 audit events.
alter table public.zysyr_audit_events
  drop constraint if exists zysyr_audit_events_sensitivity_check;
alter table public.zysyr_audit_events
  add constraint zysyr_audit_events_sensitivity_check
  check (sensitivity in ('normal', 'personal', 'payroll', 'financial'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_report_uploads_company_store_id_key'
      and conrelid = 'public.zysyr_report_uploads'::regclass
  ) then
    alter table public.zysyr_report_uploads
      add constraint zysyr_report_uploads_company_store_id_key
      unique (company_id, store_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_report_cells_company_store_id_key'
      and conrelid = 'public.zysyr_report_cells'::regclass
  ) then
    alter table public.zysyr_report_cells
      add constraint zysyr_report_cells_company_store_id_key
      unique (company_id, store_id, id);
  end if;
end $$;

create table public.zysyr_expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name text not null check (nullif(btrim(name), '') is not null),
  report_section text not null check (nullif(btrim(report_section), '') is not null),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, code),
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_expense_categories_company_status_idx
  on public.zysyr_expense_categories (company_id, status, sort_order, name);
create index zysyr_expense_categories_creator_idx
  on public.zysyr_expense_categories (company_id, created_by_user_id);
create index zysyr_expense_categories_updater_idx
  on public.zysyr_expense_categories (company_id, updated_by_user_id);

create table public.zysyr_daily_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  report_date date not null,
  is_business_day boolean not null,
  business_day_source text not null default 'monday_rule'
    check (business_day_source in ('monday_rule', 'manual_override')),
  version integer not null check (version > 0),
  supersedes_daily_report_id uuid,
  source_report_id uuid not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'reversed')),
  submitted_by_user_id uuid not null,
  submitted_at timestamptz not null default now(),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, report_date, version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, supersedes_daily_report_id)
    references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, submitted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reviewed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((version = 1 and supersedes_daily_report_id is null)
    or (version > 1 and supersedes_daily_report_id is not null)),
  check ((status = 'submitted' and reviewed_by_user_id is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by_user_id is not null and reviewed_at is not null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null)),
  check (status <> 'rejected' or nullif(btrim(review_reason), '') is not null),
  check (status <> 'reversed' or nullif(btrim(reverse_reason), '') is not null)
);

create unique index zysyr_daily_reports_current_uidx
  on public.zysyr_daily_reports (company_id, store_id, report_date)
  where status in ('submitted', 'approved');
create index zysyr_daily_reports_scope_date_idx
  on public.zysyr_daily_reports (company_id, store_id, report_date desc, version desc);
create index zysyr_daily_reports_source_idx
  on public.zysyr_daily_reports (company_id, store_id, source_report_id);
create index zysyr_daily_reports_supersedes_idx
  on public.zysyr_daily_reports (company_id, store_id, supersedes_daily_report_id)
  where supersedes_daily_report_id is not null;
create index zysyr_daily_reports_submitter_idx
  on public.zysyr_daily_reports (company_id, submitted_by_user_id, submitted_at desc);
create index zysyr_daily_reports_reviewer_idx
  on public.zysyr_daily_reports (company_id, reviewed_by_user_id, reviewed_at desc)
  where reviewed_by_user_id is not null;
create index zysyr_daily_reports_reverser_idx
  on public.zysyr_daily_reports (company_id, reversed_by_user_id, reversed_at desc)
  where reversed_by_user_id is not null;

create table public.zysyr_daily_report_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  daily_report_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_type text not null
    check (line_type in ('income', 'expense', 'petty_cash', 'payment', 'note')),
  metric_code text not null check (metric_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  description text not null check (nullif(btrim(description), '') is not null),
  amount numeric(14,2),
  quantity numeric(14,4),
  source_report_cell_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, daily_report_id, line_number),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_id)
    references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  check (amount is null or amount >= 0),
  check (quantity is null or quantity >= 0),
  check ((line_type = 'note' and amount is null)
    or (line_type <> 'note' and amount is not null and source_report_cell_id is not null))
);

create index zysyr_daily_report_lines_report_idx
  on public.zysyr_daily_report_lines (company_id, store_id, daily_report_id, line_number);
create index zysyr_daily_report_lines_source_cell_idx
  on public.zysyr_daily_report_lines (company_id, store_id, source_report_cell_id)
  where source_report_cell_id is not null;
create index zysyr_daily_report_lines_metric_idx
  on public.zysyr_daily_report_lines (company_id, store_id, metric_code, daily_report_id);

create table public.zysyr_income_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  income_date date not null,
  category_code text not null check (category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  summary text not null check (nullif(btrim(summary), '') is not null),
  amount numeric(14,2) not null check (amount >= 0),
  payment_method text not null default '',
  daily_report_id uuid not null,
  daily_report_line_id uuid not null,
  source_report_cell_id uuid not null,
  status text not null default 'approved' check (status in ('approved', 'reversed')),
  approved_by_user_id uuid not null,
  approved_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, daily_report_line_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_id)
    references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_line_id)
    references public.zysyr_daily_report_lines(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, approved_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'approved' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_income_records_scope_date_idx
  on public.zysyr_income_records (company_id, store_id, income_date desc, status);
create index zysyr_income_records_report_idx
  on public.zysyr_income_records (company_id, store_id, daily_report_id);
create index zysyr_income_records_line_idx
  on public.zysyr_income_records (company_id, store_id, daily_report_line_id);
create index zysyr_income_records_cell_idx
  on public.zysyr_income_records (company_id, store_id, source_report_cell_id);
create index zysyr_income_records_approver_idx
  on public.zysyr_income_records (company_id, approved_by_user_id, approved_at desc);
create index zysyr_income_records_reverser_idx
  on public.zysyr_income_records (company_id, reversed_by_user_id)
  where reversed_by_user_id is not null;

alter table public.zysyr_expense_records
  alter column amount type numeric(14,2),
  add column if not exists expense_category_id uuid,
  add column if not exists operator_employee_id uuid,
  add column if not exists daily_report_id uuid,
  add column if not exists daily_report_line_id uuid,
  add column if not exists source_report_cell_id uuid,
  add column if not exists paid_by_user_id uuid,
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_company_id_id_key'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_company_id_id_key unique (company_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_category_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_category_fkey
      foreign key (company_id, expense_category_id)
      references public.zysyr_expense_categories(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_operator_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_operator_fkey
      foreign key (company_id, store_id, operator_employee_id)
      references public.zysyr_employees(company_id, store_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_daily_report_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_daily_report_fkey
      foreign key (company_id, store_id, daily_report_id)
      references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_daily_line_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_daily_line_fkey
      foreign key (company_id, store_id, daily_report_line_id)
      references public.zysyr_daily_report_lines(company_id, store_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_source_cell_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_source_cell_fkey
      foreign key (company_id, store_id, source_report_cell_id)
      references public.zysyr_report_cells(company_id, store_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_paid_by_fkey'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_paid_by_fkey
      foreign key (company_id, paid_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_expense_records_paid_state_check'
      and conrelid = 'public.zysyr_expense_records'::regclass
  ) then
    alter table public.zysyr_expense_records
      add constraint zysyr_expense_records_paid_state_check
      check ((workflow_status <> 'paid') or (paid_by_user_id is not null and paid_at is not null));
  end if;
end $$;

create index if not exists zysyr_expense_records_category_idx
  on public.zysyr_expense_records (company_id, expense_category_id, expense_date desc)
  where expense_category_id is not null and deleted_at is null;
create index if not exists zysyr_expense_records_operator_idx
  on public.zysyr_expense_records (company_id, store_id, operator_employee_id)
  where operator_employee_id is not null and deleted_at is null;
create index if not exists zysyr_expense_records_daily_report_idx
  on public.zysyr_expense_records (company_id, store_id, daily_report_id)
  where daily_report_id is not null and deleted_at is null;
create index if not exists zysyr_expense_records_daily_line_idx
  on public.zysyr_expense_records (company_id, store_id, daily_report_line_id)
  where daily_report_line_id is not null and deleted_at is null;
create index if not exists zysyr_expense_records_source_cell_idx
  on public.zysyr_expense_records (company_id, store_id, source_report_cell_id)
  where source_report_cell_id is not null and deleted_at is null;
create index if not exists zysyr_expense_records_paid_by_idx
  on public.zysyr_expense_records (company_id, paid_by_user_id, paid_at desc)
  where paid_by_user_id is not null and deleted_at is null;

create table public.zysyr_petty_cash_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  transaction_date date not null,
  direction text not null check (direction in ('inflow', 'outflow')),
  category text not null check (nullif(btrim(category), '') is not null),
  summary text not null check (nullif(btrim(summary), '') is not null),
  amount numeric(14,2) not null check (amount > 0),
  daily_report_id uuid,
  daily_report_line_id uuid,
  source_report_cell_id uuid,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  confirmed_by_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_id)
    references public.zysyr_daily_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, daily_report_line_id)
    references public.zysyr_daily_report_lines(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null)),
  check (daily_report_line_id is null or daily_report_id is not null)
);

create index zysyr_petty_cash_scope_date_idx
  on public.zysyr_petty_cash_records (company_id, store_id, transaction_date desc, status);
create index zysyr_petty_cash_report_idx
  on public.zysyr_petty_cash_records (company_id, store_id, daily_report_id)
  where daily_report_id is not null;
create index zysyr_petty_cash_line_idx
  on public.zysyr_petty_cash_records (company_id, store_id, daily_report_line_id)
  where daily_report_line_id is not null;
create index zysyr_petty_cash_cell_idx
  on public.zysyr_petty_cash_records (company_id, store_id, source_report_cell_id)
  where source_report_cell_id is not null;
create index zysyr_petty_cash_confirmer_idx
  on public.zysyr_petty_cash_records (company_id, confirmed_by_user_id, confirmed_at desc);
create index zysyr_petty_cash_reverser_idx
  on public.zysyr_petty_cash_records (company_id, reversed_by_user_id)
  where reversed_by_user_id is not null;

create table public.zysyr_payment_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  payment_date date not null,
  business_type text not null
    check (business_type in ('expense', 'petty_cash', 'purchase', 'salary', 'other')),
  business_id uuid not null,
  payee text not null check (nullif(btrim(payee), '') is not null),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (nullif(btrim(payment_method), '') is not null),
  payment_reference text,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  confirmed_by_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_payment_records_scope_date_idx
  on public.zysyr_payment_records (company_id, store_id, payment_date desc, status);
create index zysyr_payment_records_business_idx
  on public.zysyr_payment_records (company_id, store_id, business_type, business_id);
create index zysyr_payment_records_confirmer_idx
  on public.zysyr_payment_records (company_id, confirmed_by_user_id, confirmed_at desc);
create index zysyr_payment_records_reverser_idx
  on public.zysyr_payment_records (company_id, reversed_by_user_id)
  where reversed_by_user_id is not null;

create table public.zysyr_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name text not null check (nullif(btrim(name), '') is not null),
  report_section text not null check (nullif(btrim(report_section), '') is not null),
  source_kind text not null
    check (source_kind in ('income', 'expense', 'petty_cash', 'payment', 'formula', 'manual')),
  formula_expression text,
  display_order integer not null default 0,
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, code, effective_from),
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  check ((source_kind = 'formula' and nullif(btrim(formula_expression), '') is not null)
    or source_kind <> 'formula')
);

create index zysyr_metric_definitions_effective_idx
  on public.zysyr_metric_definitions
  (company_id, status, effective_from, effective_to, display_order);
create index zysyr_metric_definitions_creator_idx
  on public.zysyr_metric_definitions (company_id, created_by_user_id);
create index zysyr_metric_definitions_updater_idx
  on public.zysyr_metric_definitions (company_id, updated_by_user_id);

create table public.zysyr_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  period_month date not null,
  version integer not null check (version > 0),
  supersedes_monthly_report_id uuid,
  source_report_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'locked', 'reversed')),
  generated_by_user_id uuid not null,
  generated_at timestamptz not null default now(),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  locked_by_user_id uuid,
  locked_at timestamptz,
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, period_month, version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, supersedes_monthly_report_id)
    references public.zysyr_monthly_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, generated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reviewed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, locked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date),
  check ((version = 1 and supersedes_monthly_report_id is null)
    or (version > 1 and supersedes_monthly_report_id is not null)),
  check (status <> 'reviewed' or (reviewed_by_user_id is not null and reviewed_at is not null)),
  check (status <> 'locked' or (locked_by_user_id is not null and locked_at is not null)),
  check (status <> 'reversed' or (reversed_by_user_id is not null and reversed_at is not null
    and nullif(btrim(reverse_reason), '') is not null))
);

create unique index zysyr_monthly_reports_current_uidx
  on public.zysyr_monthly_reports (company_id, store_id, period_month)
  where status in ('draft', 'reviewed', 'locked');
create index zysyr_monthly_reports_scope_period_idx
  on public.zysyr_monthly_reports (company_id, store_id, period_month desc, version desc);
create index zysyr_monthly_reports_source_idx
  on public.zysyr_monthly_reports (company_id, store_id, source_report_id)
  where source_report_id is not null;
create index zysyr_monthly_reports_supersedes_idx
  on public.zysyr_monthly_reports (company_id, store_id, supersedes_monthly_report_id)
  where supersedes_monthly_report_id is not null;
create index zysyr_monthly_reports_generator_idx
  on public.zysyr_monthly_reports (company_id, generated_by_user_id, generated_at desc);
create index zysyr_monthly_reports_reviewer_idx
  on public.zysyr_monthly_reports (company_id, reviewed_by_user_id)
  where reviewed_by_user_id is not null;
create index zysyr_monthly_reports_locker_idx
  on public.zysyr_monthly_reports (company_id, locked_by_user_id)
  where locked_by_user_id is not null;
create index zysyr_monthly_reports_reverser_idx
  on public.zysyr_monthly_reports (company_id, reversed_by_user_id)
  where reversed_by_user_id is not null;

create table public.zysyr_monthly_report_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  monthly_report_id uuid not null,
  metric_definition_id uuid,
  line_number integer not null check (line_number > 0),
  metric_code text not null check (metric_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  metric_name text not null check (nullif(btrim(metric_name), '') is not null),
  amount numeric(14,2) not null,
  calculation_method text not null
    check (calculation_method in ('sum', 'formula', 'manual')),
  calculation_expression text,
  source_count integer not null default 0 check (source_count >= 0),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, monthly_report_id, line_number),
  unique (company_id, monthly_report_id, metric_code),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, monthly_report_id)
    references public.zysyr_monthly_reports(company_id, store_id, id) on delete restrict,
  foreign key (company_id, metric_definition_id)
    references public.zysyr_metric_definitions(company_id, id) on delete restrict,
  check (calculation_method <> 'formula'
    or nullif(btrim(calculation_expression), '') is not null)
);

create index zysyr_monthly_report_lines_report_idx
  on public.zysyr_monthly_report_lines (company_id, store_id, monthly_report_id, line_number);
create index zysyr_monthly_report_lines_definition_idx
  on public.zysyr_monthly_report_lines (company_id, metric_definition_id)
  where metric_definition_id is not null;

create or replace function zysyr_private.assert_finance_scope(
  target_user_account_id uuid,
  target_company_id uuid,
  target_store_id uuid,
  target_capability_code text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not zysyr_private.account_is_finance_in_scope(
    target_user_account_id, target_company_id, target_store_id
  ) or not zysyr_private.account_has_capability(
    target_user_account_id, target_company_id, target_store_id, target_capability_code
  ) then
    raise exception using errcode = '42501', message = 'FINANCE_SCOPE_FORBIDDEN';
  end if;
end
$$;

create or replace function zysyr_private.period_is_locked(
  target_company_id uuid,
  target_store_id uuid,
  target_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.zysyr_period_locks period_lock
    where period_lock.company_id = target_company_id
      and period_lock.period_month = date_trunc('month', target_date)::date
      and period_lock.status = 'locked'
      and (
        period_lock.scope_type = 'company'
        or (period_lock.scope_type = 'store' and period_lock.store_id = target_store_id)
      )
  )
$$;

create or replace function zysyr_private.prevent_finance_line_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'FINANCE_LINE_IMMUTABLE';
end
$$;

create trigger zysyr_daily_report_lines_immutable
before update or delete on public.zysyr_daily_report_lines
for each row execute function zysyr_private.prevent_finance_line_mutation();
create trigger zysyr_monthly_report_lines_immutable
before update or delete on public.zysyr_monthly_report_lines
for each row execute function zysyr_private.prevent_finance_line_mutation();

create or replace function public.zysyr_save_daily_report(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_source_report_id uuid,
  p_is_business_day boolean,
  p_lines jsonb,
  p_reason text
)
returns public.zysyr_daily_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.zysyr_report_uploads;
  v_previous public.zysyr_daily_reports;
  v_saved public.zysyr_daily_reports;
  v_version integer;
  v_line jsonb;
  v_line_number integer := 0;
  v_cell_id uuid;
  v_business_day boolean;
  v_business_day_source text;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_REPORT_INPUT_INVALID';
  end if;

  select * into v_source
  from public.zysyr_report_uploads report
  where report.id = p_source_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_type = 'daily'
    and report.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SOURCE_REPORT_NOT_FOUND';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_source.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' || v_source.report_date::text, 0
  ));
  select * into v_previous
  from public.zysyr_daily_reports report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_date = v_source.report_date
  order by report.version desc
  limit 1
  for update;
  if found and v_previous.status = 'approved' then
    raise exception using errcode = '55000', message = 'APPROVED_DAILY_REPORT_REQUIRES_REVERSAL';
  end if;
  if found and v_previous.status = 'submitted' then
    update public.zysyr_daily_reports
    set status = 'reversed',
        reversed_by_user_id = p_actor_user_id,
        reversed_at = now(),
        reverse_reason = btrim(p_reason)
    where id = v_previous.id and company_id = p_company_id;
  end if;

  select coalesce(max(report.version), 0) + 1 into v_version
  from public.zysyr_daily_reports report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_date = v_source.report_date;
  v_business_day := coalesce(p_is_business_day, extract(isodow from v_source.report_date) <> 1);
  v_business_day_source := case when p_is_business_day is null then 'monday_rule' else 'manual_override' end;

  insert into public.zysyr_daily_reports (
    company_id, store_id, report_date, is_business_day, business_day_source,
    version, supersedes_daily_report_id, source_report_id, submitted_by_user_id
  ) values (
    p_company_id, p_store_id, v_source.report_date, v_business_day,
    v_business_day_source, v_version, v_previous.id, p_source_report_id,
    p_actor_user_id
  ) returning * into v_saved;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(v_line->>'line_type', '') not in ('income', 'expense', 'petty_cash', 'payment', 'note')
       or coalesce(v_line->>'metric_code', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
       or nullif(btrim(v_line->>'description'), '') is null then
      raise exception using errcode = '22023', message = 'DAILY_REPORT_LINE_INVALID';
    end if;
    v_cell_id := nullif(v_line->>'source_report_cell_id', '')::uuid;
    if v_line->>'line_type' <> 'note' then
      if v_line->>'amount' is null or (v_line->>'amount')::numeric < 0 or v_cell_id is null then
        raise exception using errcode = '22023', message = 'DAILY_REPORT_AMOUNT_SOURCE_REQUIRED';
      end if;
      if not exists (
        select 1 from public.zysyr_report_cells cell
        where cell.id = v_cell_id
          and cell.company_id = p_company_id
          and cell.store_id = p_store_id
          and cell.report_id = p_source_report_id
      ) then
        raise exception using errcode = 'P0002', message = 'DAILY_REPORT_SOURCE_CELL_NOT_FOUND';
      end if;
    end if;
    insert into public.zysyr_daily_report_lines (
      company_id, store_id, daily_report_id, line_number, line_type,
      metric_code, description, amount, quantity, source_report_cell_id
    ) values (
      p_company_id, p_store_id, v_saved.id, v_line_number, v_line->>'line_type',
      v_line->>'metric_code', btrim(v_line->>'description'),
      nullif(v_line->>'amount', '')::numeric,
      nullif(v_line->>'quantity', '')::numeric,
      v_cell_id
    );
  end loop;

  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'daily_report', v_saved.id, null, 'submitted',
    'submit', p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import', 'daily_report',
    v_saved.id, 'submit',
    case when v_previous.id is null then null else jsonb_build_object(
      'id', v_previous.id, 'version', v_previous.version, 'status', v_previous.status
    ) end,
    jsonb_build_object(
      'id', v_saved.id, 'report_date', v_saved.report_date,
      'is_business_day', v_saved.is_business_day, 'version', v_saved.version,
      'source_report_id', v_saved.source_report_id,
      'line_count', jsonb_array_length(p_lines), 'status', v_saved.status
    ), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_review_daily_report(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_daily_report_id uuid,
  p_decision text,
  p_reason text
)
returns public.zysyr_daily_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_daily_reports;
  v_after public.zysyr_daily_reports;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );
  if p_decision not in ('approved', 'rejected')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_REVIEW_INVALID';
  end if;
  select * into v_before
  from public.zysyr_daily_reports report
  where report.id = p_daily_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_REPORT_NOT_FOUND';
  end if;
  if v_before.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'DAILY_REPORT_NOT_SUBMITTED';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  update public.zysyr_daily_reports
  set status = p_decision,
      reviewed_by_user_id = p_actor_user_id,
      reviewed_at = now(),
      review_reason = btrim(p_reason)
  where id = p_daily_report_id and company_id = p_company_id
  returning * into v_after;

  insert into public.zysyr_income_records (
    company_id, store_id, income_date, category_code, summary, amount,
    daily_report_id, daily_report_line_id, source_report_cell_id,
    approved_by_user_id, approved_at
  )
  select
    line.company_id, line.store_id, v_after.report_date, line.metric_code,
    line.description, line.amount, line.daily_report_id, line.id,
    line.source_report_cell_id, p_actor_user_id, v_after.reviewed_at
  from public.zysyr_daily_report_lines line
  where p_decision = 'approved'
    and line.company_id = p_company_id
    and line.store_id = p_store_id
    and line.daily_report_id = p_daily_report_id
    and line.line_type = 'income'
  on conflict (company_id, daily_report_line_id) do nothing;

  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'daily_report', p_daily_report_id, 'submitted',
    p_decision, case when p_decision = 'approved' then 'approve' else 'reject' end,
    p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_report',
    p_daily_report_id, case when p_decision = 'approved' then 'approve' else 'reject' end,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object(
      'status', v_after.status, 'reviewed_at', v_after.reviewed_at,
      'income_record_count', case when p_decision = 'approved' then (
        select count(*) from public.zysyr_income_records income
        where income.company_id = p_company_id
          and income.daily_report_id = p_daily_report_id
      ) else 0 end
    ), btrim(p_reason), 'financial'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_link_finance_voucher(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_business_type text,
  p_business_id uuid,
  p_relation_type text,
  p_reason text
)
returns public.zysyr_voucher_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.zysyr_voucher_links;
  v_exists boolean := false;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.review'
  );
  if p_business_type not in (
      'daily_report', 'daily_report_line', 'income_record', 'expense_record',
      'petty_cash_record', 'payment_record', 'monthly_report', 'monthly_report_line'
    ) or p_relation_type not in ('evidence', 'payment_proof', 'source_document', 'replacement')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_VOUCHER_LINK_INVALID';
  end if;
  if not exists (
    select 1 from public.zysyr_voucher_attachments voucher
    where voucher.id = p_voucher_id
      and voucher.company_id = p_company_id
      and voucher.store_id = p_store_id
      and voucher.audit_status = 'approved'
  ) then
    raise exception using errcode = 'P0002', message = 'APPROVED_VOUCHER_NOT_FOUND';
  end if;

  if p_business_type = 'daily_report' then
    select exists (select 1 from public.zysyr_daily_reports r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'daily_report_line' then
    select exists (select 1 from public.zysyr_daily_report_lines r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'income_record' then
    select exists (select 1 from public.zysyr_income_records r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'expense_record' then
    select exists (select 1 from public.zysyr_expense_records r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id and r.deleted_at is null) into v_exists;
  elsif p_business_type = 'petty_cash_record' then
    select exists (select 1 from public.zysyr_petty_cash_records r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'payment_record' then
    select exists (select 1 from public.zysyr_payment_records r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'monthly_report' then
    select exists (select 1 from public.zysyr_monthly_reports r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  elsif p_business_type = 'monthly_report_line' then
    select exists (select 1 from public.zysyr_monthly_report_lines r where r.id = p_business_id and r.company_id = p_company_id and r.store_id = p_store_id) into v_exists;
  end if;
  if not v_exists then
    raise exception using errcode = 'P0002', message = 'FINANCE_BUSINESS_RECORD_NOT_FOUND';
  end if;

  insert into public.zysyr_voucher_links (
    company_id, store_id, voucher_id, business_type, business_id,
    relation_type, linked_by_user_id
  ) values (
    p_company_id, p_store_id, p_voucher_id, p_business_type, p_business_id,
    p_relation_type, p_actor_user_id
  )
  on conflict (company_id, voucher_id, business_type, business_id, relation_type)
    where unlinked_at is null do update
      set linked_at = public.zysyr_voucher_links.linked_at
  returning * into v_link;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    p_business_type, p_business_id, 'voucher_link',
    jsonb_build_object(
      'voucher_id', p_voucher_id, 'relation_type', p_relation_type,
      'link_id', v_link.id
    ), btrim(p_reason), 'financial'
  );
  return v_link;
end
$$;

revoke execute on function zysyr_private.assert_finance_scope(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.period_is_locked(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.prevent_finance_line_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_save_daily_report(
  uuid, uuid, uuid, uuid, boolean, jsonb, text
) from public, anon, authenticated;
revoke execute on function public.zysyr_review_daily_report(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.zysyr_link_finance_voucher(
  uuid, uuid, uuid, uuid, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.zysyr_save_daily_report(
  uuid, uuid, uuid, uuid, boolean, jsonb, text
) to service_role;
grant execute on function public.zysyr_review_daily_report(
  uuid, uuid, uuid, uuid, text, text
) to service_role;
grant execute on function public.zysyr_link_finance_voucher(
  uuid, uuid, uuid, uuid, text, uuid, text, text
) to service_role;

alter table public.zysyr_expense_categories enable row level security;
alter table public.zysyr_expense_categories force row level security;
alter table public.zysyr_daily_reports enable row level security;
alter table public.zysyr_daily_reports force row level security;
alter table public.zysyr_daily_report_lines enable row level security;
alter table public.zysyr_daily_report_lines force row level security;
alter table public.zysyr_income_records enable row level security;
alter table public.zysyr_income_records force row level security;
alter table public.zysyr_expense_records force row level security;
alter table public.zysyr_petty_cash_records enable row level security;
alter table public.zysyr_petty_cash_records force row level security;
alter table public.zysyr_payment_records enable row level security;
alter table public.zysyr_payment_records force row level security;
alter table public.zysyr_metric_definitions enable row level security;
alter table public.zysyr_metric_definitions force row level security;
alter table public.zysyr_monthly_reports enable row level security;
alter table public.zysyr_monthly_reports force row level security;
alter table public.zysyr_monthly_report_lines enable row level security;
alter table public.zysyr_monthly_report_lines force row level security;

create policy zysyr_expense_categories_company_select
on public.zysyr_expense_categories for select to authenticated
using ((select zysyr_private.has_company_membership(company_id)));
create policy zysyr_daily_reports_scope_select
on public.zysyr_daily_reports for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_daily_report_lines_scope_select
on public.zysyr_daily_report_lines for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_income_records_scope_select
on public.zysyr_income_records for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
drop policy if exists zysyr_expense_records_scope_select on public.zysyr_expense_records;
create policy zysyr_expense_records_scope_select
on public.zysyr_expense_records for select to authenticated
using (
  company_id is not null and store_id is not null and deleted_at is null
  and (select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read'))
);
create policy zysyr_petty_cash_records_scope_select
on public.zysyr_petty_cash_records for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_payment_records_scope_select
on public.zysyr_payment_records for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_metric_definitions_company_select
on public.zysyr_metric_definitions for select to authenticated
using ((select zysyr_private.has_company_membership(company_id)));
create policy zysyr_monthly_reports_scope_select
on public.zysyr_monthly_reports for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_monthly_report_lines_scope_select
on public.zysyr_monthly_report_lines for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table
  public.zysyr_expense_categories,
  public.zysyr_daily_reports,
  public.zysyr_daily_report_lines,
  public.zysyr_income_records,
  public.zysyr_expense_records,
  public.zysyr_petty_cash_records,
  public.zysyr_payment_records,
  public.zysyr_metric_definitions,
  public.zysyr_monthly_reports,
  public.zysyr_monthly_report_lines
from public, anon, authenticated, service_role;

grant select on table
  public.zysyr_expense_categories,
  public.zysyr_daily_reports,
  public.zysyr_daily_report_lines,
  public.zysyr_income_records,
  public.zysyr_expense_records,
  public.zysyr_petty_cash_records,
  public.zysyr_payment_records,
  public.zysyr_metric_definitions,
  public.zysyr_monthly_reports,
  public.zysyr_monthly_report_lines
to authenticated, service_role;

comment on table public.zysyr_daily_reports is
  'Formal daily-report headers created only from immutable finance-uploaded daily XLSX evidence.';
comment on table public.zysyr_daily_report_lines is
  'Immutable formal daily-report numbers; every non-note line points to its exact source workbook cell.';
comment on table public.zysyr_income_records is
  'Approved formal income facts materialized only by finance review of a submitted daily report; never sourced from Meiguanjia.';
comment on table public.zysyr_expense_records is
  'Existing expense history reused and extended for V2 formal categories, daily-line provenance and payment actors.';
comment on table public.zysyr_metric_definitions is
  'Versioned company metric definitions preserve the original paper monthly-report order and calculation explanations.';
comment on function public.zysyr_save_daily_report(uuid, uuid, uuid, uuid, boolean, jsonb, text) is
  'Finance-only atomic daily-report submission from exact immutable XLSX cells, with Monday business-day default and audit.';
comment on function public.zysyr_review_daily_report(uuid, uuid, uuid, uuid, text, text) is
  'Finance-only daily-report approval/rejection. Approval materializes formal income facts from income lines.';
comment on function public.zysyr_link_finance_voucher(uuid, uuid, uuid, uuid, text, uuid, text, text) is
  'Finance-only validated link from an approved voucher to an in-scope formal finance record, with audit reason.';
