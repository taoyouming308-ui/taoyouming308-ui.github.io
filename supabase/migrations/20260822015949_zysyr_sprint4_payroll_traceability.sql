-- ZYSYR V2 Sprint 4: attendance, reward/penalty, hairstylist performance,
-- payroll calculation and source-level traceability.

set statement_timeout = '30s';
set lock_timeout = '5s';

-- Salary sheets are first-class immutable report evidence, alongside daily,
-- performance and the original monthly profit/loss workbook.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_name.conname
    from pg_constraint constraint_name
    where constraint_name.conrelid = 'public.zysyr_report_uploads'::regclass
      and constraint_name.contype = 'c'
      and pg_get_constraintdef(constraint_name.oid) like '%report_type%'
  loop
    execute format('alter table public.zysyr_report_uploads drop constraint %I', constraint_row.conname);
  end loop;
end $$;
alter table public.zysyr_report_uploads
  add constraint zysyr_report_uploads_report_type_check
    check (report_type in ('daily', 'performance', 'salary', 'monthly_profit_loss')),
  add constraint zysyr_report_uploads_month_date_check
    check (report_type not in ('salary', 'monthly_profit_loss')
      or report_date = date_trunc('month', report_date)::date);

-- Store managers have read-only salary access in their assigned store. Finance
-- remains the only standard role allowed to create, approve, pay or reverse it.
insert into public.zysyr_role_capabilities (role_id, capability_id)
select role.id, capability.id
from public.zysyr_roles role
join public.zysyr_capabilities capability on capability.code = 'salary.read'
where role.code = 'store_manager'
on conflict (role_id, capability_id) do nothing;

-- Creating a workforce login is a separate high-risk privilege. It is granted
-- only to the exact company administrators already approved for finance-account
-- creation; it is not inherited by shareholder, finance or manager roles.
insert into public.zysyr_capabilities (code, name, risk_level)
values ('workforce_account.create', '创建店长和员工账号', 'high')
on conflict (code) do update set name=excluded.name, risk_level=excluded.risk_level, updated_at=now();

insert into public.zysyr_user_capability_grants (
  company_id, user_account_id, capability_id, scope_type, store_id,
  valid_from, granted_by_user_id
)
select grant_row.company_id, grant_row.user_account_id, workforce_capability.id,
  'company', null, current_date, grant_row.user_account_id
from public.zysyr_user_capability_grants grant_row
join public.zysyr_capabilities creator_capability
  on creator_capability.id=grant_row.capability_id and creator_capability.code='finance_account.create'
join public.zysyr_capabilities workforce_capability
  on workforce_capability.code='workforce_account.create'
where grant_row.scope_type='company' and grant_row.store_id is null
  and grant_row.revoked_at is null and grant_row.valid_from <= current_date
  and (grant_row.valid_to is null or grant_row.valid_to >= current_date)
on conflict (company_id, user_account_id, capability_id)
  where scope_type='company' and store_id is null and revoked_at is null
do nothing;

create table public.zysyr_attendance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  attendance_date date not null,
  attendance_type text not null
    check (attendance_type in ('normal', 'late', 'leave', 'absent', 'early_leave')),
  minutes integer not null default 0 check (minutes >= 0),
  note text not null default '',
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
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((attendance_type in ('late', 'early_leave') and minutes > 0)
    or attendance_type not in ('late', 'early_leave')),
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_attendance_scope_date_idx
  on public.zysyr_attendance_records (company_id, store_id, attendance_date desc, status);
create index zysyr_attendance_employee_date_idx
  on public.zysyr_attendance_records (company_id, employee_id, attendance_date desc, status);
create index zysyr_attendance_confirmer_idx
  on public.zysyr_attendance_records (company_id, confirmed_by_user_id, confirmed_at desc);
create unique index zysyr_attendance_current_uidx
  on public.zysyr_attendance_records
  (company_id, store_id, employee_id, attendance_date, attendance_type)
  where status = 'confirmed';

create table public.zysyr_check_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  check_date date not null,
  check_type text not null
    check (check_type in ('appearance', 'hygiene', 'service_discipline', 'other')),
  item_name text not null check (nullif(btrim(item_name), '') is not null),
  result text not null check (result in ('pass', 'fail')),
  note text not null default '',
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
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_check_scope_date_idx
  on public.zysyr_check_records (company_id, store_id, check_date desc, status);
create index zysyr_check_employee_date_idx
  on public.zysyr_check_records (company_id, employee_id, check_date desc, status);

create table public.zysyr_penalty_reward_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  record_date date not null,
  record_type text not null check (record_type in ('reward', 'penalty')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  amount numeric(14,2) not null check (amount > 0),
  source_type text not null check (source_type in ('attendance', 'check', 'manual')),
  source_id uuid,
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
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((source_type = 'manual' and source_id is null)
    or (source_type <> 'manual' and source_id is not null)),
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_penalty_reward_scope_date_idx
  on public.zysyr_penalty_reward_records (company_id, store_id, record_date desc, status);
create index zysyr_penalty_reward_employee_date_idx
  on public.zysyr_penalty_reward_records (company_id, employee_id, record_date desc, status);
create index zysyr_penalty_reward_source_idx
  on public.zysyr_penalty_reward_records (company_id, source_type, source_id)
  where source_id is not null;

create table public.zysyr_performance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  business_date date not null,
  service_item_code text,
  revenue_amount numeric(14,2) not null check (revenue_amount >= 0),
  customer_count integer not null default 0 check (customer_count >= 0),
  source_type text not null check (source_type in ('daily_report', 'service_order', 'import')),
  source_report_cell_id uuid not null,
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
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create index zysyr_performance_scope_date_idx
  on public.zysyr_performance_records (company_id, store_id, business_date desc, status);
create index zysyr_performance_employee_date_idx
  on public.zysyr_performance_records (company_id, employee_id, business_date desc, status);
create index zysyr_performance_source_cell_idx
  on public.zysyr_performance_records (company_id, store_id, source_report_cell_id);
create unique index zysyr_performance_current_uidx
  on public.zysyr_performance_records
  (company_id, store_id, employee_id, business_date, source_report_cell_id)
  where status = 'confirmed';

create table public.zysyr_commission_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid,
  position text,
  service_item_code text,
  rate numeric(8,4) not null check (rate >= 0 and rate <= 1),
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from)
);

create index zysyr_commission_rules_match_idx
  on public.zysyr_commission_rules
  (company_id, store_id, status, effective_from, effective_to, position, service_item_code);

create table public.zysyr_salaries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  salary_month date not null,
  version integer not null check (version > 0),
  supersedes_salary_id uuid,
  source_report_id uuid,
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  bonus_amount numeric(14,2) not null default 0 check (bonus_amount >= 0),
  deduction_amount numeric(14,2) not null default 0 check (deduction_amount >= 0),
  social_security numeric(14,2) not null default 0 check (social_security >= 0),
  other_adjustment numeric(14,2) not null default 0,
  final_salary numeric(14,2) not null check (final_salary >= 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'reversed')),
  generated_by_user_id uuid not null,
  generated_at timestamptz not null default now(),
  approved_by_user_id uuid,
  approved_at timestamptz,
  approval_reason text,
  paid_by_user_id uuid,
  paid_at timestamptz,
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, employee_id, salary_month, version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, supersedes_salary_id)
    references public.zysyr_salaries(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, generated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, approved_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, paid_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (salary_month = date_trunc('month', salary_month)::date),
  check ((version = 1 and supersedes_salary_id is null)
    or (version > 1 and supersedes_salary_id is not null)),
  check (final_salary = round(base_salary + commission_amount + bonus_amount
    - deduction_amount - social_security + other_adjustment, 2)),
  check (status <> 'approved' or (approved_by_user_id is not null and approved_at is not null)),
  check (status <> 'paid' or (approved_by_user_id is not null and approved_at is not null
    and paid_by_user_id is not null and paid_at is not null)),
  check (status <> 'reversed' or (reversed_by_user_id is not null and reversed_at is not null
    and nullif(btrim(reverse_reason), '') is not null))
);

create unique index zysyr_salaries_current_uidx
  on public.zysyr_salaries (company_id, store_id, employee_id, salary_month)
  where status in ('draft', 'approved', 'paid');
create index zysyr_salaries_scope_month_idx
  on public.zysyr_salaries (company_id, store_id, salary_month desc, status);
create index zysyr_salaries_employee_month_idx
  on public.zysyr_salaries (company_id, employee_id, salary_month desc, version desc);
create index zysyr_salaries_source_report_idx
  on public.zysyr_salaries (company_id, store_id, source_report_id)
  where source_report_id is not null;

create table public.zysyr_salary_details (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  salary_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_type text not null
    check (line_type in ('base', 'commission', 'bonus', 'penalty', 'social_security', 'other')),
  source_type text not null
    check (source_type in ('performance', 'commission_rule', 'penalty_reward', 'attendance', 'manual', 'report_cell')),
  source_id uuid,
  commission_rule_id uuid,
  source_report_cell_id uuid,
  amount numeric(14,2) not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, salary_id, line_number),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, salary_id)
    references public.zysyr_salaries(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_report_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, commission_rule_id)
    references public.zysyr_commission_rules(company_id, id) on delete restrict,
  check ((line_type in ('penalty', 'social_security') and amount <= 0)
    or (line_type not in ('penalty', 'social_security'))),
  check (source_type <> 'manual' or source_id is null)
);

create index zysyr_salary_details_salary_idx
  on public.zysyr_salary_details (company_id, store_id, salary_id, line_number);
create index zysyr_salary_details_source_idx
  on public.zysyr_salary_details (company_id, source_type, source_id)
  where source_id is not null;
create index zysyr_salary_details_source_cell_idx
  on public.zysyr_salary_details (company_id, store_id, source_report_cell_id)
  where source_report_cell_id is not null;
create index zysyr_salary_details_rule_idx
  on public.zysyr_salary_details (company_id, commission_rule_id)
  where commission_rule_id is not null;

create trigger zysyr_salary_details_immutable
before update or delete on public.zysyr_salary_details
for each row execute function zysyr_private.prevent_finance_line_mutation();

create or replace function zysyr_private.payroll_trace_edge(
  target_company_id uuid,
  target_store_id uuid,
  target_from_type text,
  target_from_id uuid,
  target_to_type text,
  target_to_id uuid,
  target_relation_type text,
  target_amount numeric,
  target_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_node uuid;
  v_to_node uuid;
begin
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (target_company_id, target_store_id, target_from_type, target_from_id)
  on conflict (company_id, entity_type, entity_id) do update set entity_type = excluded.entity_type
  returning id into v_from_node;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (target_company_id, target_store_id, target_to_type, target_to_id)
  on conflict (company_id, entity_type, entity_id) do update set entity_type = excluded.entity_type
  returning id into v_to_node;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    source_amount, created_by_user_id
  ) values (
    target_company_id, target_store_id, v_from_node, v_to_node,
    target_relation_type, target_amount, target_actor_user_id
  ) on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;
end
$$;

create or replace function public.zysyr_record_attendance(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_employee_id uuid, p_attendance_date date, p_attendance_type text,
  p_minutes integer, p_note text, p_voucher_ids uuid[], p_reason text
)
returns public.zysyr_attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare v_saved public.zysyr_attendance_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_attendance_date is null or p_attendance_type not in ('normal','late','leave','absent','early_leave')
    or coalesce(p_minutes, 0) < 0 or (p_attendance_type in ('late','early_leave') and coalesce(p_minutes, 0) = 0)
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_attendance_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if not exists (select 1 from public.zysyr_employees employee where employee.id = p_employee_id
    and employee.company_id = p_company_id and employee.store_id = p_store_id and employee.deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  insert into public.zysyr_attendance_records (
    company_id, store_id, employee_id, attendance_date, attendance_type,
    minutes, note, confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_employee_id, p_attendance_date, p_attendance_type,
    coalesce(p_minutes, 0), coalesce(btrim(p_note), ''), p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
    'attendance_record', v_saved.id, p_voucher_ids, 'source_document', p_reason);
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id, p_store_id, 'attendance_record', v_saved.id, null, 'confirmed',
    'confirm', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'attendance_record',
    v_saved.id, 'confirm', to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_record_check(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_employee_id uuid, p_check_date date, p_check_type text,
  p_item_name text, p_result text, p_note text,
  p_voucher_ids uuid[], p_reason text
)
returns public.zysyr_check_records
language plpgsql
security definer
set search_path = ''
as $$
declare v_saved public.zysyr_check_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_check_date is null
    or p_check_type not in ('appearance','hygiene','service_discipline','other')
    or p_result not in ('pass','fail')
    or nullif(btrim(p_item_name), '') is null
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'CHECK_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_check_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if not exists (select 1 from public.zysyr_employees employee where employee.id = p_employee_id
    and employee.company_id = p_company_id and employee.store_id = p_store_id
    and employee.employment_status = 'active' and employee.deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  insert into public.zysyr_check_records (
    company_id, store_id, employee_id, check_date, check_type,
    item_name, result, note, confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_employee_id, p_check_date, p_check_type,
    btrim(p_item_name), p_result, coalesce(btrim(p_note), ''), p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
    'check_record', v_saved.id, p_voucher_ids, 'source_document', p_reason);
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id, p_store_id, 'check_record', v_saved.id, null, 'confirmed',
    'confirm', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'check_record',
    v_saved.id, 'confirm', to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_record_penalty_reward(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_employee_id uuid, p_record_date date, p_record_type text,
  p_record_reason text, p_amount numeric, p_source_type text, p_source_id uuid,
  p_voucher_ids uuid[], p_reason text
)
returns public.zysyr_penalty_reward_records
language plpgsql
security definer
set search_path = ''
as $$
declare v_saved public.zysyr_penalty_reward_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_record_date is null or p_record_type not in ('reward','penalty') or coalesce(p_amount, 0) <= 0
    or p_source_type not in ('attendance','check','manual') or nullif(btrim(p_record_reason), '') is null
    or nullif(btrim(p_reason), '') is null
    or (p_source_type = 'manual' and p_source_id is not null)
    or (p_source_type <> 'manual' and p_source_id is null) then
    raise exception using errcode = '22023', message = 'PENALTY_REWARD_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_record_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if not exists (select 1 from public.zysyr_employees employee where employee.id = p_employee_id
    and employee.company_id = p_company_id and employee.store_id = p_store_id and employee.deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if p_source_type = 'attendance' and not exists (
    select 1 from public.zysyr_attendance_records attendance where attendance.id = p_source_id
      and attendance.company_id = p_company_id and attendance.store_id = p_store_id
      and attendance.employee_id = p_employee_id and attendance.status = 'confirmed'
  ) then raise exception using errcode = 'P0002', message = 'ATTENDANCE_SOURCE_NOT_FOUND'; end if;
  if p_source_type = 'check' and not exists (
    select 1 from public.zysyr_check_records check_record where check_record.id = p_source_id
      and check_record.company_id = p_company_id and check_record.store_id = p_store_id
      and check_record.employee_id = p_employee_id and check_record.status = 'confirmed'
  ) then raise exception using errcode = 'P0002', message = 'CHECK_SOURCE_NOT_FOUND'; end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  insert into public.zysyr_penalty_reward_records (
    company_id, store_id, employee_id, record_date, record_type, reason,
    amount, source_type, source_id, confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_employee_id, p_record_date, p_record_type,
    btrim(p_record_reason), round(p_amount, 2), p_source_type, p_source_id, p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
    'penalty_reward', v_saved.id, p_voucher_ids, 'source_document', p_reason);
  if p_source_type in ('attendance','check') then
    perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'penalty_reward',
      v_saved.id, case p_source_type when 'attendance' then 'attendance_record' else 'check_record' end,
      p_source_id, 'derived_from', v_saved.amount, p_actor_user_id);
  end if;
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id, p_store_id, 'penalty_reward', v_saved.id, null, 'confirmed',
    'confirm', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'penalty_reward',
    v_saved.id, 'confirm', to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_record_performance(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_employee_id uuid, p_business_date date, p_service_item_code text,
  p_revenue_amount numeric, p_customer_count integer, p_source_type text,
  p_source_report_cell_id uuid, p_reason text
)
returns public.zysyr_performance_records
language plpgsql
security definer
set search_path = ''
as $$
declare v_saved public.zysyr_performance_records; v_employee public.zysyr_employees;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_business_date is null or coalesce(p_revenue_amount, -1) < 0 or coalesce(p_customer_count, -1) < 0
    or p_source_type not in ('daily_report','service_order','import') or p_source_report_cell_id is null
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PERFORMANCE_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_business_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  select * into v_employee from public.zysyr_employees employee where employee.id = p_employee_id
    and employee.company_id = p_company_id and employee.store_id = p_store_id
    and employee.employment_status = 'active' and employee.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND'; end if;
  if v_employee.position !~ '发型师' then
    raise exception using errcode = '22023', message = 'PERFORMANCE_HAIRSTYLIST_ONLY';
  end if;
  if not exists (select 1 from public.zysyr_report_cells cell where cell.id = p_source_report_cell_id
    and cell.company_id = p_company_id and cell.store_id = p_store_id) then
    raise exception using errcode = 'P0002', message = 'PERFORMANCE_SOURCE_CELL_NOT_FOUND';
  end if;
  insert into public.zysyr_performance_records (
    company_id, store_id, employee_id, business_date, service_item_code,
    revenue_amount, customer_count, source_type, source_report_cell_id, confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_employee_id, p_business_date,
    nullif(btrim(p_service_item_code), ''), round(p_revenue_amount, 2), p_customer_count,
    p_source_type, p_source_report_cell_id, p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'performance_record',
    v_saved.id, 'report_cell', p_source_report_cell_id, 'derived_from', v_saved.revenue_amount, p_actor_user_id);
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'import', 'performance_record',
    v_saved.id, 'confirm', to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_upsert_commission_rule(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_rule_store_id uuid,
  p_rule_id uuid, p_position text, p_service_item_code text, p_rate numeric,
  p_effective_from date, p_effective_to date, p_status text, p_reason text
)
returns public.zysyr_commission_rules
language plpgsql
security definer
set search_path = ''
as $$
declare v_saved public.zysyr_commission_rules; v_before jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if (p_rule_store_id is not null and p_rule_store_id <> p_store_id)
    or coalesce(p_rate, -1) < 0 or p_rate > 1 or p_effective_from is null
    or (p_effective_to is not null and p_effective_to < p_effective_from)
    or p_status not in ('active','inactive') or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'COMMISSION_RULE_INPUT_INVALID';
  end if;
  if p_rule_id is not null then
    select to_jsonb(rule) into v_before from public.zysyr_commission_rules rule
    where rule.id = p_rule_id and rule.company_id = p_company_id
      and (rule.store_id is null or rule.store_id = p_store_id) for update;
    if v_before is null then raise exception using errcode = 'P0002', message = 'COMMISSION_RULE_NOT_FOUND'; end if;
  end if;
  insert into public.zysyr_commission_rules (
    id, company_id, store_id, position, service_item_code, rate,
    effective_from, effective_to, status, created_by_user_id, updated_by_user_id
  ) values (
    coalesce(p_rule_id, gen_random_uuid()), p_company_id, p_rule_store_id,
    nullif(btrim(p_position), ''), nullif(btrim(p_service_item_code), ''),
    round(p_rate, 4), p_effective_from, p_effective_to, p_status,
    p_actor_user_id, p_actor_user_id
  ) on conflict (id) do update set
    store_id = excluded.store_id, position = excluded.position,
    service_item_code = excluded.service_item_code, rate = excluded.rate,
    effective_from = excluded.effective_from, effective_to = excluded.effective_to,
    status = excluded.status, updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now()
  returning * into v_saved;
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values (p_company_id, p_rule_store_id, 'user', p_actor_user_id, 'api', 'commission_rule',
    v_saved.id, case when p_rule_id is null then 'create' else 'update' end,
    v_before, to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_generate_salary(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_employee_id uuid,
  p_salary_month date, p_source_report_id uuid, p_base_salary numeric,
  p_base_source_cell_id uuid, p_social_security numeric,
  p_social_security_source_cell_id uuid, p_other_adjustment numeric,
  p_other_adjustment_source_cell_id uuid,
  p_voucher_ids uuid[], p_reason text
)
returns public.zysyr_salaries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.zysyr_employees;
  v_previous public.zysyr_salaries;
  v_saved public.zysyr_salaries;
  v_performance public.zysyr_performance_records;
  v_rule public.zysyr_commission_rules;
  v_rule_count integer;
  v_line integer := 0;
  v_commission numeric(14,2) := 0;
  v_bonus numeric(14,2) := 0;
  v_deduction numeric(14,2) := 0;
  v_version integer;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_salary_month is null or p_salary_month <> date_trunc('month', p_salary_month)::date
    or coalesce(p_base_salary, -1) < 0 or coalesce(p_social_security, -1) < 0
    or p_source_report_id is null
    or (p_base_salary <> 0 and p_base_source_cell_id is null)
    or (p_social_security <> 0 and p_social_security_source_cell_id is null)
    or (coalesce(p_other_adjustment,0) <> 0 and p_other_adjustment_source_cell_id is null)
    or p_base_salary - p_social_security + coalesce(p_other_adjustment,0) < 0
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_salary_month) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  select * into v_employee from public.zysyr_employees employee where employee.id = p_employee_id
    and employee.company_id = p_company_id and employee.store_id = p_store_id and employee.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.zysyr_report_uploads report where report.id = p_source_report_id
      and report.company_id = p_company_id and report.store_id = p_store_id
      and report.report_type = 'salary' and report.report_date = p_salary_month
      and report.status = 'active'
  ) then raise exception using errcode = 'P0002', message = 'SALARY_SOURCE_REPORT_NOT_FOUND'; end if;
  if p_base_source_cell_id is not null and not exists (
    select 1 from public.zysyr_report_cells cell where cell.id = p_base_source_cell_id
      and cell.company_id = p_company_id and cell.store_id = p_store_id
      and cell.report_id = p_source_report_id
      and round(cell.numeric_value, 2) = round(p_base_salary, 2)
  ) then raise exception using errcode = '22023', message = 'SALARY_BASE_SOURCE_CELL_MISMATCH'; end if;
  if p_social_security_source_cell_id is not null and not exists (
    select 1 from public.zysyr_report_cells cell where cell.id = p_social_security_source_cell_id
      and cell.company_id = p_company_id and cell.store_id = p_store_id
      and cell.report_id = p_source_report_id
      and round(cell.numeric_value, 2) = round(p_social_security, 2)
  ) then raise exception using errcode = '22023', message = 'SALARY_SOCIAL_SOURCE_CELL_MISMATCH'; end if;
  if p_other_adjustment_source_cell_id is not null and not exists (
    select 1 from public.zysyr_report_cells cell where cell.id = p_other_adjustment_source_cell_id
      and cell.company_id = p_company_id and cell.store_id = p_store_id
      and cell.report_id = p_source_report_id
      and round(cell.numeric_value, 2) = round(coalesce(p_other_adjustment,0), 2)
  ) then raise exception using errcode = '22023', message = 'SALARY_OTHER_SOURCE_CELL_MISMATCH'; end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_store_id::text
    || ':' || p_employee_id::text || ':' || p_salary_month::text, 0));
  select * into v_previous from public.zysyr_salaries salary where salary.company_id = p_company_id
    and salary.store_id = p_store_id and salary.employee_id = p_employee_id
    and salary.salary_month = p_salary_month and salary.status in ('draft','approved','paid')
  order by salary.version desc limit 1 for update;
  if found and v_previous.status <> 'draft' then
    raise exception using errcode = '55000', message = 'SALARY_CONFIRMED_REVERSE_REQUIRED';
  end if;
  if found then
    update public.zysyr_salaries set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason) where id = v_previous.id;
  end if;
  select coalesce(max(salary.version), 0) + 1 into v_version from public.zysyr_salaries salary
  where salary.company_id = p_company_id and salary.store_id = p_store_id
    and salary.employee_id = p_employee_id and salary.salary_month = p_salary_month;
  insert into public.zysyr_salaries (
    company_id, store_id, employee_id, salary_month, version, supersedes_salary_id,
    source_report_id, base_salary, commission_amount, bonus_amount, deduction_amount,
    social_security, other_adjustment, final_salary, generated_by_user_id
  ) values (
    p_company_id, p_store_id, p_employee_id, p_salary_month, v_version, v_previous.id,
    p_source_report_id, round(p_base_salary,2), 0, 0, 0, round(p_social_security,2),
    round(coalesce(p_other_adjustment,0),2),
    round(p_base_salary - p_social_security + coalesce(p_other_adjustment,0),2),
    p_actor_user_id
  ) returning * into v_saved;

  if p_base_salary <> 0 then
    v_line := v_line + 1;
    insert into public.zysyr_salary_details (company_id, store_id, salary_id, line_number,
      line_type, source_type, source_id, source_report_cell_id, amount, note)
    values (p_company_id, p_store_id, v_saved.id, v_line, 'base', 'report_cell',
      p_base_source_cell_id, p_base_source_cell_id, round(p_base_salary,2), '底薪');
  end if;
  for v_performance in select * from public.zysyr_performance_records performance
    where performance.company_id = p_company_id and performance.store_id = p_store_id
      and performance.employee_id = p_employee_id and performance.status = 'confirmed'
      and performance.business_date >= p_salary_month
      and performance.business_date < (p_salary_month + interval '1 month')::date
    order by performance.business_date, performance.id
  loop
    select count(*) into v_rule_count
    from public.zysyr_commission_rules rule
    where rule.company_id = p_company_id and rule.status = 'active'
      and (rule.store_id is null or rule.store_id = p_store_id)
      and (rule.position is null or rule.position = v_employee.position)
      and (rule.service_item_code is null or rule.service_item_code = v_performance.service_item_code)
      and rule.effective_from <= v_performance.business_date
      and (rule.effective_to is null or rule.effective_to >= v_performance.business_date);
    if v_rule_count = 0 then raise exception using errcode = '55000', message = 'COMMISSION_RULE_REQUIRED'; end if;
    select * into v_rule
    from public.zysyr_commission_rules rule
    where rule.company_id = p_company_id and rule.status = 'active'
      and (rule.store_id is null or rule.store_id = p_store_id)
      and (rule.position is null or rule.position = v_employee.position)
      and (rule.service_item_code is null or rule.service_item_code = v_performance.service_item_code)
      and rule.effective_from <= v_performance.business_date
      and (rule.effective_to is null or rule.effective_to >= v_performance.business_date)
    order by (rule.store_id is not null)::integer desc,
      (rule.position is not null)::integer desc,
      (rule.service_item_code is not null)::integer desc,
      rule.effective_from desc
    limit 1;
    if exists (
      select 1 from public.zysyr_commission_rules other
      where other.company_id = v_rule.company_id and other.id <> v_rule.id and other.status = 'active'
        and coalesce(other.store_id::text,'') = coalesce(v_rule.store_id::text,'')
        and coalesce(other.position,'') = coalesce(v_rule.position,'')
        and coalesce(other.service_item_code,'') = coalesce(v_rule.service_item_code,'')
        and other.effective_from <= v_performance.business_date
        and (other.effective_to is null or other.effective_to >= v_performance.business_date)
    ) then raise exception using errcode = '55000', message = 'COMMISSION_RULE_AMBIGUOUS'; end if;
    v_line := v_line + 1;
    insert into public.zysyr_salary_details (company_id, store_id, salary_id, line_number,
      line_type, source_type, source_id, commission_rule_id, source_report_cell_id, amount, note)
    values (p_company_id, p_store_id, v_saved.id, v_line, 'commission', 'performance',
      v_performance.id, v_rule.id, v_performance.source_report_cell_id,
      round(v_performance.revenue_amount * v_rule.rate,2),
      '业绩 ' || v_performance.revenue_amount::text || ' × ' || v_rule.rate::text);
    v_commission := v_commission + round(v_performance.revenue_amount * v_rule.rate,2);
  end loop;
  insert into public.zysyr_salary_details (company_id, store_id, salary_id, line_number,
    line_type, source_type, source_id, amount, note)
  select p_company_id, p_store_id, v_saved.id, v_line + row_number() over (order by item.record_date, item.id),
    case item.record_type when 'reward' then 'bonus' else 'penalty' end,
    'penalty_reward', item.id,
    case item.record_type when 'reward' then item.amount else -item.amount end,
    item.reason
  from public.zysyr_penalty_reward_records item
  where item.company_id = p_company_id and item.store_id = p_store_id
    and item.employee_id = p_employee_id and item.status = 'confirmed'
    and item.record_date >= p_salary_month
    and item.record_date < (p_salary_month + interval '1 month')::date;
  select coalesce(sum(case when item.record_type='reward' then item.amount else 0 end),0),
    coalesce(sum(case when item.record_type='penalty' then item.amount else 0 end),0), count(*)
  into v_bonus, v_deduction, v_rule_count
  from public.zysyr_penalty_reward_records item
  where item.company_id = p_company_id and item.store_id = p_store_id
    and item.employee_id = p_employee_id and item.status = 'confirmed'
    and item.record_date >= p_salary_month
    and item.record_date < (p_salary_month + interval '1 month')::date;
  v_line := v_line + v_rule_count;
  if p_social_security <> 0 then
    v_line := v_line + 1;
    insert into public.zysyr_salary_details (company_id, store_id, salary_id, line_number,
      line_type, source_type, source_id, source_report_cell_id, amount, note)
    values (p_company_id, p_store_id, v_saved.id, v_line, 'social_security', 'report_cell',
      p_social_security_source_cell_id, p_social_security_source_cell_id,
      -round(p_social_security,2), '社保');
  end if;
  if coalesce(p_other_adjustment,0) <> 0 then
    v_line := v_line + 1;
    insert into public.zysyr_salary_details (company_id, store_id, salary_id, line_number,
      line_type, source_type, source_id, source_report_cell_id, amount, note)
    values (p_company_id, p_store_id, v_saved.id, v_line, 'other', 'report_cell',
      p_other_adjustment_source_cell_id, p_other_adjustment_source_cell_id,
      round(p_other_adjustment,2), '其他调整');
  end if;
  if p_base_salary + v_commission + v_bonus - v_deduction
      - p_social_security + coalesce(p_other_adjustment,0) < 0 then
    raise exception using errcode = '22023', message = 'SALARY_NEGATIVE_FINAL';
  end if;
  update public.zysyr_salaries set commission_amount = v_commission, bonus_amount = v_bonus,
    deduction_amount = v_deduction,
    final_salary = round(base_salary + v_commission + v_bonus - v_deduction
      - social_security + other_adjustment,2)
  where id = v_saved.id returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
    'salary', v_saved.id, p_voucher_ids, 'source_document', p_reason);
  perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'salary', v_saved.id,
    'employee', p_employee_id, 'allocated_to', v_saved.final_salary, p_actor_user_id);
  perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'salary', v_saved.id,
    'salary_detail', detail.id, 'contains', detail.amount, p_actor_user_id)
    from public.zysyr_salary_details detail where detail.salary_id = v_saved.id;
  perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'salary_detail', detail.id,
    case detail.source_type when 'performance' then 'performance_record'
      when 'penalty_reward' then 'penalty_reward' else detail.source_type end,
    detail.source_id, 'derived_from', abs(detail.amount), p_actor_user_id)
    from public.zysyr_salary_details detail
    where detail.salary_id = v_saved.id and detail.source_id is not null;
  perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'salary_detail', detail.id,
    'commission_rule', detail.commission_rule_id, 'derived_from', abs(detail.amount), p_actor_user_id)
    from public.zysyr_salary_details detail
    where detail.salary_id = v_saved.id and detail.commission_rule_id is not null;
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id, p_store_id, 'salary', v_saved.id, null, 'draft', 'submit',
    p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'salary', v_saved.id,
    'generate', case when v_previous.id is null then null else to_jsonb(v_previous) end,
    to_jsonb(v_saved), btrim(p_reason), 'payroll');
  return v_saved;
end
$$;

create or replace function public.zysyr_transition_salary(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_salary_id uuid, p_action text, p_payment_date date, p_payment_method text,
  p_payment_reference text, p_voucher_ids uuid[], p_reason text
)
returns public.zysyr_salaries
language plpgsql
security definer
set search_path = ''
as $$
declare v_before public.zysyr_salaries; v_after public.zysyr_salaries; v_payment public.zysyr_payment_records; v_employee_name text;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_action not in ('approve','pay','reverse') or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_TRANSITION_INVALID';
  end if;
  select * into v_before from public.zysyr_salaries salary where salary.id = p_salary_id
    and salary.company_id = p_company_id and salary.store_id = p_store_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_NOT_FOUND'; end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.salary_month) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if (p_action='approve' and v_before.status <> 'draft')
    or (p_action='pay' and v_before.status <> 'approved')
    or (p_action='reverse' and v_before.status not in ('draft','approved','paid')) then
    raise exception using errcode = '55000', message = 'SALARY_TRANSITION_NOT_ALLOWED';
  end if;
  if p_action = 'pay' then
    if p_payment_date is null or nullif(btrim(p_payment_method), '') is null then
      raise exception using errcode = '22023', message = 'SALARY_PAYMENT_INPUT_INVALID';
    end if;
    perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  end if;
  update public.zysyr_salaries set
    status = case p_action when 'approve' then 'approved' when 'pay' then 'paid' else 'reversed' end,
    approved_by_user_id = case when p_action='approve' then p_actor_user_id else approved_by_user_id end,
    approved_at = case when p_action='approve' then now() else approved_at end,
    approval_reason = case when p_action='approve' then btrim(p_reason) else approval_reason end,
    paid_by_user_id = case when p_action='pay' then p_actor_user_id else paid_by_user_id end,
    paid_at = case when p_action='pay' then now() else paid_at end,
    reversed_by_user_id = case when p_action='reverse' then p_actor_user_id else reversed_by_user_id end,
    reversed_at = case when p_action='reverse' then now() else reversed_at end,
    reverse_reason = case when p_action='reverse' then btrim(p_reason) else reverse_reason end
  where id = p_salary_id returning * into v_after;
  if p_action = 'pay' then
    select employee.name into v_employee_name from public.zysyr_employees employee
    where employee.id = v_before.employee_id and employee.company_id = p_company_id;
    insert into public.zysyr_payment_records (company_id, store_id, payment_date, business_type,
      business_id, payee, amount, payment_method, payment_reference, confirmed_by_user_id)
    values (p_company_id, p_store_id, p_payment_date, 'salary', p_salary_id,
      v_employee_name, v_before.final_salary, btrim(p_payment_method),
      nullif(btrim(p_payment_reference), ''), p_actor_user_id)
    returning * into v_payment;
    perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
      'payment_record', v_payment.id, p_voucher_ids, 'payment_proof', p_reason);
    perform zysyr_private.payroll_trace_edge(p_company_id, p_store_id, 'payment_record',
      v_payment.id, 'salary', p_salary_id, 'allocated_to', v_payment.amount, p_actor_user_id);
  elsif p_action = 'reverse' and v_before.status = 'paid' then
    update public.zysyr_payment_records set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason)
    where company_id = p_company_id and store_id = p_store_id and business_type = 'salary'
      and business_id = p_salary_id and status = 'confirmed';
  end if;
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id, p_store_id, 'salary', p_salary_id, v_before.status, v_after.status,
    case p_action when 'approve' then 'approve' when 'pay' then 'confirm' else 'reverse' end,
    p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (company_id, store_id, actor_type, actor_user_id,
    channel, entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'salary', p_salary_id,
    p_action, to_jsonb(v_before), to_jsonb(v_after), btrim(p_reason), 'payroll');
  return v_after;
end
$$;

create or replace function public.zysyr_reverse_payroll_record(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_entity_type text, p_entity_id uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_before jsonb; v_after jsonb; v_record_date date;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve');
  if p_entity_type not in ('attendance_record','check_record','penalty_reward','performance_record')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PAYROLL_REVERSE_INPUT_INVALID';
  end if;
  if p_entity_type = 'attendance_record' then
    select to_jsonb(record), record.attendance_date into v_before, v_record_date
    from public.zysyr_attendance_records record where record.id=p_entity_id and record.company_id=p_company_id
      and record.store_id=p_store_id and record.status='confirmed' for update;
    if v_before is null then raise exception using errcode='P0002', message='ATTENDANCE_RECORD_NOT_FOUND'; end if;
    if exists (select 1 from public.zysyr_penalty_reward_records item where item.company_id=p_company_id
      and item.source_type='attendance' and item.source_id=p_entity_id and item.status='confirmed') then
      raise exception using errcode='55000', message='PAYROLL_DEPENDENCY_REVERSE_FIRST';
    end if;
    update public.zysyr_attendance_records set status='reversed', reversed_by_user_id=p_actor_user_id,
      reversed_at=now(), reverse_reason=btrim(p_reason) where id=p_entity_id returning to_jsonb(zysyr_attendance_records) into v_after;
  elsif p_entity_type = 'check_record' then
    select to_jsonb(record), record.check_date into v_before, v_record_date
    from public.zysyr_check_records record where record.id=p_entity_id and record.company_id=p_company_id
      and record.store_id=p_store_id and record.status='confirmed' for update;
    if v_before is null then raise exception using errcode='P0002', message='CHECK_RECORD_NOT_FOUND'; end if;
    if exists (select 1 from public.zysyr_penalty_reward_records item where item.company_id=p_company_id
      and item.source_type='check' and item.source_id=p_entity_id and item.status='confirmed') then
      raise exception using errcode='55000', message='PAYROLL_DEPENDENCY_REVERSE_FIRST';
    end if;
    update public.zysyr_check_records set status='reversed', reversed_by_user_id=p_actor_user_id,
      reversed_at=now(), reverse_reason=btrim(p_reason) where id=p_entity_id returning to_jsonb(zysyr_check_records) into v_after;
  elsif p_entity_type = 'penalty_reward' then
    select to_jsonb(record), record.record_date into v_before, v_record_date
    from public.zysyr_penalty_reward_records record where record.id=p_entity_id and record.company_id=p_company_id
      and record.store_id=p_store_id and record.status='confirmed' for update;
    if v_before is null then raise exception using errcode='P0002', message='PENALTY_REWARD_NOT_FOUND'; end if;
    if exists (select 1 from public.zysyr_salary_details detail join public.zysyr_salaries salary on salary.id=detail.salary_id
      where detail.company_id=p_company_id and detail.source_type='penalty_reward' and detail.source_id=p_entity_id
        and salary.status in ('approved','paid')) then raise exception using errcode='55000', message='SALARY_REVERSE_REQUIRED'; end if;
    update public.zysyr_penalty_reward_records set status='reversed', reversed_by_user_id=p_actor_user_id,
      reversed_at=now(), reverse_reason=btrim(p_reason) where id=p_entity_id returning to_jsonb(zysyr_penalty_reward_records) into v_after;
  else
    select to_jsonb(record), record.business_date into v_before, v_record_date
    from public.zysyr_performance_records record where record.id=p_entity_id and record.company_id=p_company_id
      and record.store_id=p_store_id and record.status='confirmed' for update;
    if v_before is null then raise exception using errcode='P0002', message='PERFORMANCE_RECORD_NOT_FOUND'; end if;
    if exists (select 1 from public.zysyr_salary_details detail join public.zysyr_salaries salary on salary.id=detail.salary_id
      where detail.company_id=p_company_id and detail.source_type='performance' and detail.source_id=p_entity_id
        and salary.status in ('approved','paid')) then raise exception using errcode='55000', message='SALARY_REVERSE_REQUIRED'; end if;
    update public.zysyr_performance_records set status='reversed', reversed_by_user_id=p_actor_user_id,
      reversed_at=now(), reverse_reason=btrim(p_reason) where id=p_entity_id returning to_jsonb(zysyr_performance_records) into v_after;
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_record_date) then
    raise exception using errcode='55000', message='FINANCE_PERIOD_LOCKED';
  end if;
  insert into public.zysyr_workflow_events (company_id, store_id, entity_type, entity_id,
    from_status, to_status, action, actor_user_id, reason)
  values (p_company_id,p_store_id,p_entity_type,p_entity_id,'confirmed','reversed','reverse',p_actor_user_id,btrim(p_reason));
  insert into public.zysyr_audit_events (company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values (p_company_id,p_store_id,'user',p_actor_user_id,'api',p_entity_type,p_entity_id,
    'reverse',v_before,v_after,btrim(p_reason),'payroll');
  return v_after;
end
$$;

create or replace function public.zysyr_admin_complete_workforce_account(
  p_actor_auth_user_id uuid, p_account_id uuid, p_auth_user_id uuid,
  p_login_name text, p_display_name text, p_role_code text,
  p_store_id uuid, p_employee_id uuid, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.zysyr_user_accounts;
  v_role_id uuid;
  v_expected_email text;
  v_auth record;
  v_employee public.zysyr_employees;
  v_store public.zysyr_stores;
begin
  if p_actor_auth_user_id is null or p_account_id is null or p_auth_user_id is null
    or p_store_id is null or p_employee_id is null or p_request_id is null
    or p_role_code not in ('store_manager','employee')
    or p_login_name is null or p_login_name <> lower(btrim(p_login_name))
    or p_login_name !~ '^[a-z0-9_一-龥-]{2,40}$'
    or nullif(btrim(p_display_name), '') is null or char_length(btrim(p_display_name)) > 80 then
    raise exception 'invalid workforce account request';
  end if;
  select * into v_actor from public.zysyr_user_accounts account
  where account.auth_user_id=p_actor_auth_user_id and account.status='active' for update;
  if not found or not exists (
    select 1 from public.zysyr_user_capability_grants grant_row
    join public.zysyr_capabilities capability on capability.id=grant_row.capability_id
    where grant_row.company_id=v_actor.company_id and grant_row.user_account_id=v_actor.id
      and grant_row.scope_type='company' and grant_row.store_id is null
      and grant_row.revoked_at is null and grant_row.valid_from <= current_date
      and (grant_row.valid_to is null or grant_row.valid_to >= current_date)
      and capability.code='workforce_account.create'
  ) then raise exception 'workforce account creation is not authorized'; end if;
  select * into v_store from public.zysyr_stores store
  where store.company_id=v_actor.company_id and store.id=p_store_id and store.status='active';
  if not found then raise exception 'workforce store is not active'; end if;
  select * into v_employee from public.zysyr_employees employee
  where employee.company_id=v_actor.company_id and employee.store_id=p_store_id
    and employee.id=p_employee_id and employee.employment_status='active' and employee.deleted_at is null;
  if not found then raise exception 'workforce employee is not active in the selected store'; end if;
  if exists (select 1 from public.zysyr_user_accounts account
    where account.auth_user_id=p_auth_user_id or account.id=p_account_id
      or (account.company_id=v_actor.company_id and lower(btrim(account.login_name))=p_login_name)
      or (account.company_id=v_actor.company_id and account.employee_id=p_employee_id)) then
    raise exception 'workforce login, identity or employee account already exists';
  end if;
  v_expected_email := 'zysyr_account_' || replace(p_account_id::text,'-','') || '@auth.zysyr.invalid';
  select id,email,email_confirmed_at,raw_app_meta_data into v_auth from auth.users where id=p_auth_user_id;
  if not found or lower(coalesce(v_auth.email,''))<>v_expected_email or v_auth.email_confirmed_at is null
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_account_id','')<>p_account_id::text
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_company_id','')<>v_actor.company_id::text
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_login_name','')<>p_login_name
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_role','')<>p_role_code
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_store_id','')<>p_store_id::text
    or coalesce(v_auth.raw_app_meta_data->>'zysyr_employee_id','')<>p_employee_id::text then
    raise exception 'Supabase Auth workforce identity does not match the request';
  end if;
  select id into strict v_role_id from public.zysyr_roles where code=p_role_code and status='active';
  insert into public.zysyr_user_accounts (id,company_id,auth_user_id,employee_id,display_name,login_name,status,activated_at)
  values (p_account_id,v_actor.company_id,p_auth_user_id,p_employee_id,btrim(p_display_name),p_login_name,'active',now());
  insert into public.zysyr_user_role_grants (company_id,user_account_id,role_id,scope_type,store_id,valid_from,granted_by_user_id)
  values (v_actor.company_id,p_account_id,v_role_id,'store',p_store_id,current_date,v_actor.id);
  insert into public.zysyr_audit_events (company_id,store_id,actor_type,actor_user_id,request_id,channel,
    entity_type,entity_id,action,after_json,reason,sensitivity)
  values (v_actor.company_id,p_store_id,'user',v_actor.id,p_request_id,'api','user_account',p_account_id,
    'workforce_account_created',jsonb_build_object('login_name',p_login_name,'display_name',btrim(p_display_name),
      'role_code',p_role_code,'scope_type','store','store_id',p_store_id,'employee_id',p_employee_id,
      'password_storage','supabase_auth_only','email_exposed',false),
    'Administrator created a store-scoped workforce account from the secure operations dashboard entry.','personal');
  return jsonb_build_object('account_id',p_account_id,'login_name',p_login_name,
    'display_name',btrim(p_display_name),'role_code',p_role_code,'scope_type','store',
    'store_id',p_store_id,'store_name',v_store.name,'employee_id',p_employee_id,
    'employee_name',v_employee.name,'status','active');
end
$$;

revoke execute on function zysyr_private.payroll_trace_edge(uuid,uuid,text,uuid,text,uuid,text,numeric,uuid)
  from public, anon, authenticated, service_role;

revoke execute on function public.zysyr_record_attendance(uuid,uuid,uuid,uuid,date,text,integer,text,uuid[],text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_record_check(uuid,uuid,uuid,uuid,date,text,text,text,text,uuid[],text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_record_penalty_reward(uuid,uuid,uuid,uuid,date,text,text,numeric,text,uuid,uuid[],text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_record_performance(uuid,uuid,uuid,uuid,date,text,numeric,integer,text,uuid,text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_upsert_commission_rule(uuid,uuid,uuid,uuid,uuid,text,text,numeric,date,date,text,text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_generate_salary(uuid,uuid,uuid,uuid,date,uuid,numeric,uuid,numeric,uuid,numeric,uuid,uuid[],text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_transition_salary(uuid,uuid,uuid,uuid,text,date,text,text,uuid[],text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_reverse_payroll_record(uuid,uuid,uuid,text,uuid,text)
  from public, anon, authenticated;

grant execute on function public.zysyr_record_attendance(uuid,uuid,uuid,uuid,date,text,integer,text,uuid[],text) to service_role;
grant execute on function public.zysyr_record_check(uuid,uuid,uuid,uuid,date,text,text,text,text,uuid[],text) to service_role;
grant execute on function public.zysyr_record_penalty_reward(uuid,uuid,uuid,uuid,date,text,text,numeric,text,uuid,uuid[],text) to service_role;
grant execute on function public.zysyr_record_performance(uuid,uuid,uuid,uuid,date,text,numeric,integer,text,uuid,text) to service_role;
grant execute on function public.zysyr_upsert_commission_rule(uuid,uuid,uuid,uuid,uuid,text,text,numeric,date,date,text,text) to service_role;
grant execute on function public.zysyr_generate_salary(uuid,uuid,uuid,uuid,date,uuid,numeric,uuid,numeric,uuid,numeric,uuid,uuid[],text) to service_role;
grant execute on function public.zysyr_transition_salary(uuid,uuid,uuid,uuid,text,date,text,text,uuid[],text) to service_role;
grant execute on function public.zysyr_reverse_payroll_record(uuid,uuid,uuid,text,uuid,text) to service_role;
revoke execute on function public.zysyr_admin_complete_workforce_account(uuid,uuid,uuid,text,text,text,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_admin_complete_workforce_account(uuid,uuid,uuid,text,text,text,uuid,uuid,uuid)
  to service_role;

alter table public.zysyr_attendance_records enable row level security;
alter table public.zysyr_attendance_records force row level security;
alter table public.zysyr_check_records enable row level security;
alter table public.zysyr_check_records force row level security;
alter table public.zysyr_penalty_reward_records enable row level security;
alter table public.zysyr_penalty_reward_records force row level security;
alter table public.zysyr_performance_records enable row level security;
alter table public.zysyr_performance_records force row level security;
alter table public.zysyr_commission_rules enable row level security;
alter table public.zysyr_commission_rules force row level security;
alter table public.zysyr_salaries enable row level security;
alter table public.zysyr_salaries force row level security;
alter table public.zysyr_salary_details enable row level security;
alter table public.zysyr_salary_details force row level security;

create policy zysyr_attendance_salary_or_self_select on public.zysyr_attendance_records
for select to authenticated using (
  (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
  or (select zysyr_private.is_self_employee(employee_id))
);
create policy zysyr_check_salary_or_self_select on public.zysyr_check_records
for select to authenticated using (
  (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
  or (select zysyr_private.is_self_employee(employee_id))
);
create policy zysyr_penalty_reward_salary_or_self_select on public.zysyr_penalty_reward_records
for select to authenticated using (
  (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
  or (select zysyr_private.is_self_employee(employee_id))
);
create policy zysyr_performance_salary_or_self_select on public.zysyr_performance_records
for select to authenticated using (
  (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
  or (select zysyr_private.is_self_employee(employee_id))
);
create policy zysyr_commission_rules_salary_select on public.zysyr_commission_rules
for select to authenticated using (
  store_id is null and (select zysyr_private.has_company_membership(company_id))
  or store_id is not null and (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
);
create policy zysyr_salaries_salary_or_self_select on public.zysyr_salaries
for select to authenticated using (
  (select zysyr_private.has_capability(company_id, store_id, 'salary.read'))
  or (select zysyr_private.is_self_employee(employee_id))
);
create policy zysyr_salary_details_salary_or_self_select on public.zysyr_salary_details
for select to authenticated using (exists (
  select 1 from public.zysyr_salaries salary
  where salary.id = public.zysyr_salary_details.salary_id
    and salary.company_id = public.zysyr_salary_details.company_id
    and ((select zysyr_private.has_capability(salary.company_id, salary.store_id, 'salary.read'))
      or (select zysyr_private.is_self_employee(salary.employee_id)))
));

revoke all on table public.zysyr_attendance_records, public.zysyr_check_records, public.zysyr_penalty_reward_records,
  public.zysyr_performance_records, public.zysyr_commission_rules,
  public.zysyr_salaries, public.zysyr_salary_details
from public, anon, authenticated, service_role;
grant select on table public.zysyr_attendance_records, public.zysyr_check_records, public.zysyr_penalty_reward_records,
  public.zysyr_performance_records, public.zysyr_commission_rules,
  public.zysyr_salaries, public.zysyr_salary_details
to authenticated, service_role;

comment on table public.zysyr_salaries is
  'Versioned payroll header. Final salary is always decomposed into base, commission, reward, penalty, social security and other adjustment.';
comment on table public.zysyr_salary_details is
  'Immutable payroll detail lines linking each amount to performance, reward/penalty, attendance, exact report cell and approved voucher evidence.';
comment on function public.zysyr_record_performance(uuid,uuid,uuid,uuid,date,text,numeric,integer,text,uuid,text) is
  'Finance-only formal performance entry from an exact uploaded report cell. Employees whose position is not hairstylist are rejected.';
comment on table public.zysyr_check_records is
  'Formal immutable appearance, hygiene and service-discipline checks. Failed checks may be referenced by structured payroll penalties.';
comment on function public.zysyr_generate_salary(uuid,uuid,uuid,uuid,date,uuid,numeric,uuid,numeric,uuid,numeric,uuid,uuid[],text) is
  'Finance-only payroll generation. Base, social security and non-zero adjustments must match exact cells in the active salary workbook.';

-- Replace the Sprint 3 monthly generator so approved/paid payroll becomes the
-- original report's 人工成本 line. Draft payroll blocks generation; a locked
-- monthly report can therefore never silently omit unfinished salaries.
create or replace function public.zysyr_generate_monthly_report(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_period_month date,
  p_source_report_id uuid,
  p_reason text
)
returns public.zysyr_monthly_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.zysyr_monthly_reports;
  v_saved public.zysyr_monthly_reports;
  v_version integer;
  v_line_offset integer := 0;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'report.lock');
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_REPORT_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_period_month) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  if not exists (
    select 1 from public.zysyr_daily_reports daily
    where daily.company_id = p_company_id and daily.store_id = p_store_id
      and daily.report_date >= p_period_month
      and daily.report_date < (p_period_month + interval '1 month')::date
      and daily.status = 'approved'
  ) then raise exception using errcode = '55000', message = 'MONTHLY_APPROVED_DAILY_REQUIRED'; end if;
  if exists (
    select 1 from public.zysyr_daily_reports daily
    where daily.company_id = p_company_id and daily.store_id = p_store_id
      and daily.report_date >= p_period_month
      and daily.report_date < (p_period_month + interval '1 month')::date
      and daily.status = 'submitted'
  ) then raise exception using errcode = '55000', message = 'MONTHLY_HAS_UNREVIEWED_DAILY'; end if;
  if exists (
    select 1 from public.zysyr_salaries salary
    where salary.company_id = p_company_id and salary.store_id = p_store_id
      and salary.salary_month = p_period_month and salary.status = 'draft'
  ) then raise exception using errcode = '55000', message = 'MONTHLY_HAS_DRAFT_SALARY'; end if;
  if p_source_report_id is not null and not exists (
    select 1 from public.zysyr_report_uploads report where report.id = p_source_report_id
      and report.company_id = p_company_id and report.store_id = p_store_id
      and report.report_type = 'monthly_profit_loss' and report.report_date = p_period_month
      and report.status = 'active'
  ) then raise exception using errcode = 'P0002', message = 'MONTHLY_SOURCE_REPORT_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_store_id::text || ':' || p_period_month::text, 0));
  select * into v_latest from public.zysyr_monthly_reports report
  where report.company_id = p_company_id and report.store_id = p_store_id
    and report.period_month = p_period_month order by report.version desc limit 1 for update;
  if found and v_latest.status = 'locked' then raise exception using errcode = '55000', message = 'MONTHLY_REPORT_LOCKED'; end if;
  if found and v_latest.status in ('draft', 'reviewed') then
    update public.zysyr_monthly_reports set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason)
    where id = v_latest.id and company_id = p_company_id;
  end if;
  select coalesce(max(report.version), 0) + 1 into v_version from public.zysyr_monthly_reports report
  where report.company_id = p_company_id and report.store_id = p_store_id and report.period_month = p_period_month;
  insert into public.zysyr_monthly_reports (
    company_id, store_id, period_month, version, supersedes_monthly_report_id,
    source_report_id, generated_by_user_id
  ) values (p_company_id, p_store_id, p_period_month, v_version, v_latest.id, p_source_report_id, p_actor_user_id)
  returning * into v_saved;

  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, source_count
  )
  select p_company_id, p_store_id, v_saved.id,
    row_number() over (order by income.category_code),
    left('INCOME_' || income.category_code, 64),
    coalesce(definition.name, income.category_code),
    sum(income.amount), 'sum', count(*)
  from public.zysyr_income_records income
  left join lateral (
    select metric.name from public.zysyr_metric_definitions metric
    where metric.company_id = p_company_id and metric.code = income.category_code
      and metric.status = 'active' and metric.effective_from <= p_period_month
      and (metric.effective_to is null or metric.effective_to >= p_period_month)
    order by metric.effective_from desc limit 1
  ) definition on true
  where income.company_id = p_company_id and income.store_id = p_store_id
    and income.income_date >= p_period_month
    and income.income_date < (p_period_month + interval '1 month')::date
    and income.status = 'approved'
  group by income.category_code, definition.name;

  select count(*) into v_line_offset from public.zysyr_monthly_report_lines line where line.monthly_report_id = v_saved.id;
  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, source_count
  )
  select p_company_id, p_store_id, v_saved.id,
    v_line_offset + row_number() over (order by category.sort_order, category.code),
    left('EXPENSE_' || category.code, 64), category.name, sum(expense.amount), 'sum', count(*)
  from public.zysyr_expense_records expense
  join public.zysyr_expense_categories category
    on category.id = expense.expense_category_id and category.company_id = expense.company_id
  where expense.company_id = p_company_id and expense.store_id = p_store_id
    and expense.expense_date >= p_period_month
    and expense.expense_date < (p_period_month + interval '1 month')::date
    and expense.workflow_status in ('approved', 'paid') and expense.deleted_at is null
  group by category.code, category.name, category.sort_order;

  select count(*) into v_line_offset from public.zysyr_monthly_report_lines line where line.monthly_report_id = v_saved.id;
  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, source_count
  )
  select p_company_id, p_store_id, v_saved.id,
    v_line_offset + row_number() over (order by cash.direction),
    case cash.direction when 'inflow' then 'PETTY_CASH_IN' else 'PETTY_CASH_OUT' end,
    case cash.direction when 'inflow' then '备用金流入' else '备用金支出' end,
    sum(cash.amount), 'sum', count(*)
  from public.zysyr_petty_cash_records cash
  where cash.company_id = p_company_id and cash.store_id = p_store_id
    and cash.transaction_date >= p_period_month
    and cash.transaction_date < (p_period_month + interval '1 month')::date
    and cash.status = 'confirmed'
  group by cash.direction;

  select count(*) into v_line_offset from public.zysyr_monthly_report_lines line where line.monthly_report_id = v_saved.id;
  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, calculation_expression, source_count
  )
  select p_company_id, p_store_id, v_saved.id, v_line_offset + 1,
    'LABOR_COST', '人工成本', sum(salary.final_salary), 'sum',
    'SUM(APPROVED_OR_PAID_SALARY)', count(*)
  from public.zysyr_salaries salary
  where salary.company_id = p_company_id and salary.store_id = p_store_id
    and salary.salary_month = p_period_month and salary.status in ('approved', 'paid')
  having count(*) > 0;

  select count(*) into v_line_offset from public.zysyr_monthly_report_lines line where line.monthly_report_id = v_saved.id;
  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, calculation_expression, source_count
  ) values
    (p_company_id, p_store_id, v_saved.id, v_line_offset + 1, 'TOTAL_INCOME', '收入合计',
      coalesce((select sum(amount) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code like 'INCOME_%'), 0),
      'formula', 'SUM(INCOME_*)', (select count(*) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code like 'INCOME_%')),
    (p_company_id, p_store_id, v_saved.id, v_line_offset + 2, 'TOTAL_EXPENSE', '支出合计',
      coalesce((select sum(amount) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id
        and (metric_code like 'EXPENSE_%' or metric_code in ('PETTY_CASH_OUT', 'LABOR_COST'))), 0),
      'formula', 'SUM(EXPENSE_*,PETTY_CASH_OUT,LABOR_COST)', (select count(*) from public.zysyr_monthly_report_lines
        where monthly_report_id = v_saved.id and (metric_code like 'EXPENSE_%' or metric_code in ('PETTY_CASH_OUT', 'LABOR_COST'))));
  insert into public.zysyr_monthly_report_lines (
    company_id, store_id, monthly_report_id, line_number, metric_code,
    metric_name, amount, calculation_method, calculation_expression, source_count
  ) values
    (p_company_id, p_store_id, v_saved.id, v_line_offset + 3, 'NET_PROFIT', '盈亏',
      coalesce((select amount from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code = 'TOTAL_INCOME'), 0)
      - coalesce((select amount from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code = 'TOTAL_EXPENSE'), 0),
      'formula', 'TOTAL_INCOME-TOTAL_EXPENSE', 2);

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (p_company_id, p_store_id, 'monthly_report', v_saved.id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select line.company_id, line.store_id, 'monthly_report_line', line.id
  from public.zysyr_monthly_report_lines line where line.monthly_report_id = v_saved.id
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select income.company_id, income.store_id, 'income_record', income.id
  from public.zysyr_income_records income where income.company_id = p_company_id and income.store_id = p_store_id
    and income.income_date >= p_period_month and income.income_date < (p_period_month + interval '1 month')::date and income.status = 'approved'
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select expense.company_id, expense.store_id, 'expense_record', expense.id
  from public.zysyr_expense_records expense where expense.company_id = p_company_id and expense.store_id = p_store_id
    and expense.expense_date >= p_period_month and expense.expense_date < (p_period_month + interval '1 month')::date
    and expense.workflow_status in ('approved', 'paid') and expense.deleted_at is null
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select cash.company_id, cash.store_id, 'petty_cash_record', cash.id
  from public.zysyr_petty_cash_records cash where cash.company_id = p_company_id and cash.store_id = p_store_id
    and cash.transaction_date >= p_period_month and cash.transaction_date < (p_period_month + interval '1 month')::date and cash.status = 'confirmed'
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select salary.company_id, salary.store_id, 'salary', salary.id
  from public.zysyr_salaries salary where salary.company_id = p_company_id and salary.store_id = p_store_id
    and salary.salary_month = p_period_month and salary.status in ('approved', 'paid')
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges (company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id)
  select p_company_id, p_store_id, line_node.id, source_node.id, 'derived_from', income.amount, p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id = p_company_id and line_node.entity_type = 'monthly_report_line' and line_node.entity_id = line.id
  join public.zysyr_income_records income on left('INCOME_' || income.category_code, 64) = line.metric_code and income.company_id = p_company_id and income.store_id = p_store_id
    and income.income_date >= p_period_month and income.income_date < (p_period_month + interval '1 month')::date and income.status = 'approved'
  join public.zysyr_trace_nodes source_node on source_node.company_id = p_company_id and source_node.entity_type = 'income_record' and source_node.entity_id = income.id
  where line.monthly_report_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;
  insert into public.zysyr_trace_edges (company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id)
  select p_company_id, p_store_id, line_node.id, source_node.id, 'derived_from', expense.amount, p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id = p_company_id and line_node.entity_type = 'monthly_report_line' and line_node.entity_id = line.id
  join public.zysyr_expense_categories category on left('EXPENSE_' || category.code, 64) = line.metric_code and category.company_id = p_company_id
  join public.zysyr_expense_records expense on expense.expense_category_id = category.id and expense.company_id = p_company_id and expense.store_id = p_store_id
    and expense.expense_date >= p_period_month and expense.expense_date < (p_period_month + interval '1 month')::date
    and expense.workflow_status in ('approved', 'paid') and expense.deleted_at is null
  join public.zysyr_trace_nodes source_node on source_node.company_id = p_company_id and source_node.entity_type = 'expense_record' and source_node.entity_id = expense.id
  where line.monthly_report_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;
  insert into public.zysyr_trace_edges (company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id)
  select p_company_id, p_store_id, line_node.id, source_node.id, 'derived_from', cash.amount, p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id = p_company_id and line_node.entity_type = 'monthly_report_line' and line_node.entity_id = line.id
  join public.zysyr_petty_cash_records cash on line.metric_code = case cash.direction when 'inflow' then 'PETTY_CASH_IN' else 'PETTY_CASH_OUT' end
    and cash.company_id = p_company_id and cash.store_id = p_store_id
    and cash.transaction_date >= p_period_month and cash.transaction_date < (p_period_month + interval '1 month')::date and cash.status = 'confirmed'
  join public.zysyr_trace_nodes source_node on source_node.company_id = p_company_id and source_node.entity_type = 'petty_cash_record' and source_node.entity_id = cash.id
  where line.monthly_report_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;
  insert into public.zysyr_trace_edges (company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id)
  select p_company_id, p_store_id, line_node.id, salary_node.id, 'derived_from', salary.final_salary, p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id = p_company_id and line_node.entity_type = 'monthly_report_line' and line_node.entity_id = line.id
  join public.zysyr_salaries salary on salary.company_id = p_company_id and salary.store_id = p_store_id
    and salary.salary_month = p_period_month and salary.status in ('approved', 'paid')
  join public.zysyr_trace_nodes salary_node on salary_node.company_id = p_company_id and salary_node.entity_type = 'salary' and salary_node.entity_id = salary.id
  where line.monthly_report_id = v_saved.id and line.metric_code = 'LABOR_COST'
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id
  )
  select p_company_id, p_store_id, report_node.id, line_node.id, 'contains', line.amount, p_actor_user_id
  from public.zysyr_trace_nodes report_node
  join public.zysyr_monthly_report_lines line on line.monthly_report_id = v_saved.id
  join public.zysyr_trace_nodes line_node on line_node.company_id = p_company_id
    and line_node.entity_type = 'monthly_report_line' and line_node.entity_id = line.id
  where report_node.company_id = p_company_id and report_node.entity_type = 'monthly_report'
    and report_node.entity_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, source_amount, created_by_user_id
  )
  select p_company_id, p_store_id, total_node.id, component_node.id, 'derived_from', component.amount, p_actor_user_id
  from public.zysyr_monthly_report_lines total
  join public.zysyr_trace_nodes total_node on total_node.company_id = p_company_id
    and total_node.entity_type = 'monthly_report_line' and total_node.entity_id = total.id
  join public.zysyr_monthly_report_lines component on component.monthly_report_id = total.monthly_report_id
    and ((total.metric_code = 'TOTAL_INCOME' and component.metric_code like 'INCOME_%')
      or (total.metric_code = 'TOTAL_EXPENSE'
        and (component.metric_code like 'EXPENSE_%' or component.metric_code in ('PETTY_CASH_OUT', 'LABOR_COST')))
      or (total.metric_code = 'NET_PROFIT' and component.metric_code in ('TOTAL_INCOME', 'TOTAL_EXPENSE')))
  join public.zysyr_trace_nodes component_node on component_node.company_id = p_company_id
    and component_node.entity_type = 'monthly_report_line' and component_node.entity_id = component.id
  where total.monthly_report_id = v_saved.id
    and total.metric_code in ('TOTAL_INCOME', 'TOTAL_EXPENSE', 'NET_PROFIT')
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'monthly_report',
    v_saved.id, 'generate', case when v_latest.id is null then null else to_jsonb(v_latest) end,
    jsonb_build_object('period_month', p_period_month, 'version', v_version,
      'source_report_id', p_source_report_id, 'line_count', (select count(*) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id),
      'labor_cost', coalesce((select amount from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code = 'LABOR_COST'), 0)),
    btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

comment on function public.zysyr_generate_monthly_report(uuid, uuid, uuid, date, uuid, text) is
  'Builds versioned formal monthly reporting from approved operational facts; approved/paid salary is included as traceable labor cost and draft salary blocks generation.';
