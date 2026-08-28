-- ZYSYR v458: paper-format electronic salary sheet, immutable originals,
-- employee-level trace, full edit history and approval-gated revisions.
set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.zysyr_voucher_attachments
  drop constraint if exists zysyr_voucher_attachments_mime_type_check;
alter table public.zysyr_voucher_attachments
  add constraint zysyr_voucher_attachments_mime_type_check check (mime_type in (
    'image/jpeg', 'image/png', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'zysyr-vouchers';

create table public.zysyr_salary_sheet_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  salary_month date not null,
  version integer not null check (version > 0),
  supersedes_sheet_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'locked', 'reversed')),
  edit_revision integer not null default 0 check (edit_revision >= 0),
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  confirmation_reason text,
  locked_by_user_id uuid,
  locked_at timestamptz,
  lock_reason text,
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, salary_month, version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, supersedes_sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, locked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (salary_month = date_trunc('month', salary_month)::date),
  check ((version = 1 and supersedes_sheet_id is null)
    or (version > 1 and supersedes_sheet_id is not null)),
  check (status <> 'locked' or (
    confirmed_by_user_id is not null and confirmed_at is not null
    and locked_by_user_id is not null and locked_at is not null
    and nullif(btrim(confirmation_reason), '') is not null
    and nullif(btrim(lock_reason), '') is not null
  )),
  check (status <> 'reversed' or (
    reversed_by_user_id is not null and reversed_at is not null
    and nullif(btrim(reverse_reason), '') is not null
  ))
);

create unique index zysyr_salary_sheet_one_active_uidx
  on public.zysyr_salary_sheet_drafts (company_id, store_id, salary_month)
  where status in ('draft', 'locked');
create index zysyr_salary_sheet_scope_month_idx
  on public.zysyr_salary_sheet_drafts
  (company_id, store_id, salary_month desc, version desc, status);

create table public.zysyr_salary_sheet_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  sheet_id uuid not null,
  row_number integer not null check (row_number > 0),
  employee_id uuid,
  position text not null default '',
  employee_name text not null default '',
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  seniority_salary numeric(14,2) not null default 0 check (seniority_salary >= 0),
  position_salary numeric(14,2) not null default 0 check (position_salary >= 0),
  meal_allowance numeric(14,2) not null default 0 check (meal_allowance >= 0),
  performance_commission numeric(14,2) not null default 0 check (performance_commission >= 0),
  delivery_card_commission numeric(14,2) not null default 0 check (delivery_card_commission >= 0),
  overtime_activity_allowance numeric(14,2) not null default 0 check (overtime_activity_allowance >= 0),
  supplemental_adjustment numeric(14,2) not null default 0,
  gross_pay numeric(14,2) generated always as (round(
    base_salary + seniority_salary + position_salary + meal_allowance
    + performance_commission + delivery_card_commission
    + overtime_activity_allowance + supplemental_adjustment, 2
  )) stored,
  product_cost numeric(14,2) not null default 0 check (product_cost >= 0),
  late_early_deduction numeric(14,2) not null default 0 check (late_early_deduction >= 0),
  shooting_deduction numeric(14,2) not null default 0 check (shooting_deduction >= 0),
  leave_deduction numeric(14,2) not null default 0 check (leave_deduction >= 0),
  growth_deduction numeric(14,2) not null default 0 check (growth_deduction >= 0),
  employee_purchase numeric(14,2) not null default 0 check (employee_purchase >= 0),
  employee_social_security numeric(14,2) not null default 0 check (employee_social_security >= 0),
  total_deductions numeric(14,2) generated always as (round(
    product_cost + late_early_deduction + shooting_deduction + leave_deduction
    + growth_deduction + employee_purchase + employee_social_security, 2
  )) stored,
  net_pay numeric(14,2) generated always as (round(
    base_salary + seniority_salary + position_salary + meal_allowance
    + performance_commission + delivery_card_commission
    + overtime_activity_allowance + supplemental_adjustment
    - product_cost - late_early_deduction - shooting_deduction - leave_deduction
    - growth_deduction - employee_purchase - employee_social_security, 2
  )) stored,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, sheet_id, row_number),
  foreign key (company_id, store_id, sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, employee_id)
    references public.zysyr_employees(company_id, store_id, id) on delete restrict
);

create index zysyr_salary_sheet_rows_sheet_idx
  on public.zysyr_salary_sheet_rows (company_id, store_id, sheet_id, row_number);
create index zysyr_salary_sheet_rows_employee_idx
  on public.zysyr_salary_sheet_rows (company_id, store_id, employee_id)
  where employee_id is not null;

create table public.zysyr_salary_sheet_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  sheet_id uuid not null,
  row_id uuid not null,
  revision integer not null check (revision > 0),
  field_code text not null,
  before_text text,
  after_text text,
  before_amount numeric(14,2),
  after_amount numeric(14,2),
  changed_by_user_id uuid not null,
  changed_at timestamptz not null default now(),
  reason text not null check (nullif(btrim(reason), '') is not null),
  unique (company_id, id),
  foreign key (company_id, store_id, sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, row_id)
    references public.zysyr_salary_sheet_rows(company_id, store_id, id) on delete restrict,
  foreign key (company_id, changed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((before_amount is not null or after_amount is not null)
    or (before_text is not null or after_text is not null))
);

create index zysyr_salary_sheet_changes_sheet_idx
  on public.zysyr_salary_sheet_changes
  (company_id, store_id, sheet_id, revision desc, changed_at desc);
create index zysyr_salary_sheet_changes_row_idx
  on public.zysyr_salary_sheet_changes (company_id, row_id, changed_at desc);

create table public.zysyr_salary_sheet_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  sheet_id uuid not null,
  voucher_id uuid not null,
  attachment_kind text not null default 'original_report'
    check (attachment_kind in ('original_report', 'supporting_document', 'payment_proof')),
  note text not null default '',
  linked_by_user_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, sheet_id, voucher_id),
  foreign key (company_id, store_id, sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, linked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_salary_sheet_attachments_sheet_idx
  on public.zysyr_salary_sheet_attachments (company_id, store_id, sheet_id, linked_at desc);
create index zysyr_salary_sheet_attachments_voucher_idx
  on public.zysyr_salary_sheet_attachments (company_id, voucher_id);

create table public.zysyr_salary_sheet_unlock_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  sheet_id uuid not null,
  requested_by_user_id uuid not null,
  request_reason text not null check (nullif(btrim(request_reason), '') is not null),
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'consumed')),
  decided_by_user_id uuid,
  decision_reason text,
  decided_at timestamptz,
  consumed_at timestamptz,
  unique (company_id, id),
  foreign key (company_id, store_id, sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, requested_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, decided_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'pending' and decided_by_user_id is null and decided_at is null)
    or (status in ('approved', 'rejected', 'consumed')
      and decided_by_user_id is not null and decided_at is not null)),
  check (status <> 'consumed' or consumed_at is not null)
);

create unique index zysyr_salary_sheet_unlock_pending_uidx
  on public.zysyr_salary_sheet_unlock_requests
  (company_id, store_id, sheet_id, requested_by_user_id)
  where status = 'pending';
create index zysyr_salary_sheet_unlock_scope_idx
  on public.zysyr_salary_sheet_unlock_requests
  (company_id, store_id, status, requested_at desc);

alter table public.zysyr_salary_sheet_drafts
  add column revision_request_id uuid,
  add constraint zysyr_salary_sheet_revision_request_fkey
    foreign key (company_id, revision_request_id)
    references public.zysyr_salary_sheet_unlock_requests(company_id, id) on delete restrict;

alter table public.zysyr_salaries
  add column source_salary_sheet_id uuid,
  add column source_salary_sheet_row_id uuid,
  add constraint zysyr_salaries_source_sheet_fkey
    foreign key (company_id, store_id, source_salary_sheet_id)
    references public.zysyr_salary_sheet_drafts(company_id, store_id, id) on delete restrict,
  add constraint zysyr_salaries_source_sheet_row_fkey
    foreign key (company_id, store_id, source_salary_sheet_row_id)
    references public.zysyr_salary_sheet_rows(company_id, store_id, id) on delete restrict;

create index zysyr_salaries_source_sheet_idx
  on public.zysyr_salaries (company_id, store_id, source_salary_sheet_id)
  where source_salary_sheet_id is not null;

alter table public.zysyr_salary_details
  drop constraint if exists zysyr_salary_details_source_type_check;
alter table public.zysyr_salary_details
  add constraint zysyr_salary_details_source_type_check check (source_type in (
    'performance', 'commission_rule', 'penalty_reward', 'attendance',
    'manual', 'report_cell', 'salary_sheet_row'
  ));

create or replace function zysyr_private.protect_salary_sheet_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'SALARY_SHEET_HISTORY_IMMUTABLE';
end
$$;

revoke execute on function zysyr_private.protect_salary_sheet_history()
  from public, anon, authenticated, service_role;

create trigger zysyr_salary_sheet_changes_append_only
  before update or delete on public.zysyr_salary_sheet_changes
  for each row execute function zysyr_private.protect_salary_sheet_history();
create trigger zysyr_salary_sheet_attachments_append_only
  before update or delete on public.zysyr_salary_sheet_attachments
  for each row execute function zysyr_private.protect_salary_sheet_history();

create or replace function zysyr_private.enforce_salary_sheet_row_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_ROW_DELETE_FORBIDDEN';
  end if;
  select sheet.status into v_status from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = new.company_id and sheet.store_id = new.store_id
    and sheet.id = new.sheet_id;
  if v_status <> 'draft' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_LOCKED';
  end if;
  return new;
end
$$;

revoke execute on function zysyr_private.enforce_salary_sheet_row_draft()
  from public, anon, authenticated, service_role;
create trigger zysyr_salary_sheet_rows_draft_only
  before insert or update or delete on public.zysyr_salary_sheet_rows
  for each row execute function zysyr_private.enforce_salary_sheet_row_draft();

create or replace function public.zysyr_create_salary_sheet(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_salary_month date,
  p_reason text
) returns public.zysyr_salary_sheet_drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_salary_sheet_drafts;
  v_version integer;
  v_slots integer;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  if p_salary_month is null
     or p_salary_month <> date_trunc('month', p_salary_month)::date
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_salary_month) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' || p_salary_month::text, 0
  ));
  select * into v_saved from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.salary_month = p_salary_month and sheet.status in ('draft', 'locked')
  order by sheet.version desc limit 1;
  if found then return v_saved; end if;
  select coalesce(max(sheet.version), 0) + 1 into v_version
  from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.salary_month = p_salary_month;
  insert into public.zysyr_salary_sheet_drafts(
    company_id, store_id, salary_month, version,
    created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, p_store_id, p_salary_month, v_version,
    p_actor_user_id, p_actor_user_id
  ) returning * into v_saved;
  select greatest(15, count(*))::integer into v_slots
  from public.zysyr_employees employee
  where employee.company_id = p_company_id and employee.store_id = p_store_id
    and employee.employment_status = 'active' and employee.deleted_at is null;
  insert into public.zysyr_salary_sheet_rows(
    company_id, store_id, sheet_id, row_number,
    employee_id, position, employee_name
  )
  select p_company_id, p_store_id, v_saved.id, slots.row_number,
    employee.id, coalesce(employee.position, ''), coalesce(employee.name, '')
  from generate_series(1, v_slots) slots(row_number)
  left join (
    select e.*, row_number() over (order by e.employee_code, e.name, e.id) as slot
    from public.zysyr_employees e
    where e.company_id = p_company_id and e.store_id = p_store_id
      and e.employment_status = 'active' and e.deleted_at is null
  ) employee on employee.slot = slots.row_number;
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet', v_saved.id, 'create',
    jsonb_build_object('salary_month', p_salary_month, 'version', v_version,
      'template', '自由手艺人工资表-21列', 'slots', v_slots),
    btrim(p_reason), 'payroll'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_save_salary_sheet(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_sheet_id uuid,
  p_rows jsonb,
  p_reason text
) returns public.zysyr_salary_sheet_drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.zysyr_salary_sheet_drafts;
  v_before public.zysyr_salary_sheet_rows;
  v_after public.zysyr_salary_sheet_rows;
  v_item jsonb;
  v_revision integer;
  v_field text;
  v_before_json jsonb;
  v_after_json jsonb;
  v_numeric_fields text[] := array[
    'base_salary','seniority_salary','position_salary','meal_allowance',
    'performance_commission','delivery_card_commission','overtime_activity_allowance',
    'supplemental_adjustment','product_cost','late_early_deduction',
    'shooting_deduction','leave_deduction','growth_deduction',
    'employee_purchase','employee_social_security'
  ];
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_SAVE_INVALID';
  end if;
  select * into v_sheet from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.id = p_sheet_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_NOT_FOUND'; end if;
  if v_sheet.status <> 'draft' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_LOCKED';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_sheet.salary_month)
     and not exists (
       select 1 from public.zysyr_salary_sheet_unlock_requests request
       where request.company_id = p_company_id and request.id = v_sheet.revision_request_id
         and request.status = 'consumed'
     ) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  v_revision := v_sheet.edit_revision + 1;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    select * into v_before from public.zysyr_salary_sheet_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.sheet_id = p_sheet_id and row_item.id = (v_item->>'id')::uuid
    for update;
    if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_ROW_NOT_FOUND'; end if;
    if coalesce((v_item->>'base_salary')::numeric, 0) < 0
       or coalesce((v_item->>'seniority_salary')::numeric, 0) < 0
       or coalesce((v_item->>'position_salary')::numeric, 0) < 0
       or coalesce((v_item->>'meal_allowance')::numeric, 0) < 0
       or coalesce((v_item->>'performance_commission')::numeric, 0) < 0
       or coalesce((v_item->>'delivery_card_commission')::numeric, 0) < 0
       or coalesce((v_item->>'overtime_activity_allowance')::numeric, 0) < 0
       or coalesce((v_item->>'product_cost')::numeric, 0) < 0
       or coalesce((v_item->>'late_early_deduction')::numeric, 0) < 0
       or coalesce((v_item->>'shooting_deduction')::numeric, 0) < 0
       or coalesce((v_item->>'leave_deduction')::numeric, 0) < 0
       or coalesce((v_item->>'growth_deduction')::numeric, 0) < 0
       or coalesce((v_item->>'employee_purchase')::numeric, 0) < 0
       or coalesce((v_item->>'employee_social_security')::numeric, 0) < 0 then
      raise exception using errcode = '22023', message = 'SALARY_SHEET_NEGATIVE_COMPONENT';
    end if;
    if nullif(v_item->>'employee_id', '') is not null and not exists (
      select 1 from public.zysyr_employees employee
      where employee.company_id = p_company_id and employee.store_id = p_store_id
        and employee.id = (v_item->>'employee_id')::uuid
        and employee.deleted_at is null
    ) then
      raise exception using errcode = 'P0002', message = 'SALARY_SHEET_EMPLOYEE_NOT_FOUND';
    end if;
    update public.zysyr_salary_sheet_rows set
      employee_id = nullif(v_item->>'employee_id', '')::uuid,
      position = left(coalesce(v_item->>'position', ''), 120),
      employee_name = left(coalesce(v_item->>'employee_name', ''), 160),
      base_salary = round(coalesce((v_item->>'base_salary')::numeric, 0), 2),
      seniority_salary = round(coalesce((v_item->>'seniority_salary')::numeric, 0), 2),
      position_salary = round(coalesce((v_item->>'position_salary')::numeric, 0), 2),
      meal_allowance = round(coalesce((v_item->>'meal_allowance')::numeric, 0), 2),
      performance_commission = round(coalesce((v_item->>'performance_commission')::numeric, 0), 2),
      delivery_card_commission = round(coalesce((v_item->>'delivery_card_commission')::numeric, 0), 2),
      overtime_activity_allowance = round(coalesce((v_item->>'overtime_activity_allowance')::numeric, 0), 2),
      supplemental_adjustment = round(coalesce((v_item->>'supplemental_adjustment')::numeric, 0), 2),
      product_cost = round(coalesce((v_item->>'product_cost')::numeric, 0), 2),
      late_early_deduction = round(coalesce((v_item->>'late_early_deduction')::numeric, 0), 2),
      shooting_deduction = round(coalesce((v_item->>'shooting_deduction')::numeric, 0), 2),
      leave_deduction = round(coalesce((v_item->>'leave_deduction')::numeric, 0), 2),
      growth_deduction = round(coalesce((v_item->>'growth_deduction')::numeric, 0), 2),
      employee_purchase = round(coalesce((v_item->>'employee_purchase')::numeric, 0), 2),
      employee_social_security = round(coalesce((v_item->>'employee_social_security')::numeric, 0), 2),
      notes = left(coalesce(v_item->>'notes', ''), 1000),
      updated_at = now()
    where company_id = p_company_id and store_id = p_store_id
      and sheet_id = p_sheet_id and id = v_before.id
    returning * into v_after;
    v_before_json := to_jsonb(v_before);
    v_after_json := to_jsonb(v_after);
    foreach v_field in array array[
      'employee_id','position','employee_name','base_salary','seniority_salary',
      'position_salary','meal_allowance','performance_commission',
      'delivery_card_commission','overtime_activity_allowance',
      'supplemental_adjustment','product_cost','late_early_deduction',
      'shooting_deduction','leave_deduction','growth_deduction',
      'employee_purchase','employee_social_security','notes'
    ]
    loop
      if (v_before_json->v_field) is distinct from (v_after_json->v_field) then
        insert into public.zysyr_salary_sheet_changes(
          company_id, store_id, sheet_id, row_id, revision, field_code,
          before_text, after_text, before_amount, after_amount,
          changed_by_user_id, reason
        ) values (
          p_company_id, p_store_id, p_sheet_id, v_before.id, v_revision, v_field,
          case when v_field = any(v_numeric_fields) then null else v_before_json->>v_field end,
          case when v_field = any(v_numeric_fields) then null else v_after_json->>v_field end,
          case when v_field = any(v_numeric_fields) then (v_before_json->>v_field)::numeric else null end,
          case when v_field = any(v_numeric_fields) then (v_after_json->>v_field)::numeric else null end,
          p_actor_user_id, btrim(p_reason)
        );
      end if;
    end loop;
  end loop;
  update public.zysyr_salary_sheet_drafts
  set edit_revision = v_revision, updated_by_user_id = p_actor_user_id, updated_at = now()
  where company_id = p_company_id and id = p_sheet_id
  returning * into v_sheet;
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet', p_sheet_id, 'save',
    jsonb_build_object('revision', v_revision - 1),
    jsonb_build_object('revision', v_revision,
      'changed_fields', (select count(*) from public.zysyr_salary_sheet_changes change_item
        where change_item.company_id = p_company_id and change_item.sheet_id = p_sheet_id
          and change_item.revision = v_revision)),
    btrim(p_reason), 'payroll'
  );
  return v_sheet;
end
$$;

create or replace function public.zysyr_register_salary_sheet_attachment(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_sheet_id uuid,
  p_voucher_id uuid,
  p_object_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_attachment_kind text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.zysyr_salary_sheet_drafts;
  v_store_name text;
  v_uploader text;
  v_voucher public.zysyr_voucher_attachments;
  v_link public.zysyr_salary_sheet_attachments;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  select * into v_sheet from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.id = p_sheet_id;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_NOT_FOUND'; end if;
  if v_sheet.status = 'reversed' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_REVERSED';
  end if;
  if p_mime_type not in (
      'image/jpeg','image/png','application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) or p_size_bytes <= 0 or p_size_bytes > 10485760
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_object_path), '') is null
    or nullif(btrim(p_original_filename), '') is null
    or p_attachment_kind not in ('original_report','supporting_document','payment_proof') then
    raise exception using errcode = '22023', message = 'SALARY_ATTACHMENT_INVALID';
  end if;
  select store.name into v_store_name from public.zysyr_stores store
  where store.company_id = p_company_id and store.id = p_store_id
    and store.status = 'active' and store.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'STORE_NOT_FOUND'; end if;
  select coalesce(nullif(account.display_name, ''), account.login_name) into v_uploader
  from public.zysyr_user_accounts account
  where account.company_id = p_company_id and account.id = p_actor_user_id;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_sha256, 0));
  if exists (select 1 from public.zysyr_voucher_attachments existing
    where existing.company_id = p_company_id and existing.sha256 = p_sha256) then
    raise exception using errcode = '23505', message = 'VOUCHER_DUPLICATE_FILE';
  end if;
  insert into public.zysyr_voucher_attachments(
    id, company_id, store_id, store, record_type, record_id, bucket_id, object_path,
    original_filename, mime_type, size_bytes, sha256, immutable_version, note,
    uploaded_by, uploaded_by_user_id, ocr_status, audit_status, document_type,
    reviewed_at, reviewed_by_user_id, updated_by_user_id, updated_at
  ) values (
    p_voucher_id, p_company_id, p_store_id, v_store_name, 'unassigned', null,
    'zysyr-vouchers', btrim(p_object_path), btrim(p_original_filename), p_mime_type,
    p_size_bytes, p_sha256, 1, coalesce(btrim(p_note), ''), v_uploader,
    p_actor_user_id, 'reviewed', 'approved', 'salary', now(), p_actor_user_id,
    p_actor_user_id, now()
  ) returning * into v_voucher;
  insert into public.zysyr_voucher_reviews(
    company_id, store_id, voucher_id, review_version, decision, document_type,
    candidate_fields, corrected_fields, field_confidences, reason, reviewer_user_id
  ) values (
    p_company_id, p_store_id, v_voucher.id, 1, 'approved', 'salary',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    coalesce(nullif(btrim(p_note), ''), '财务上传并确认原始工资报表'), p_actor_user_id
  );
  insert into public.zysyr_salary_sheet_attachments(
    company_id, store_id, sheet_id, voucher_id, attachment_kind, note, linked_by_user_id
  ) values (
    p_company_id, p_store_id, p_sheet_id, v_voucher.id, p_attachment_kind,
    coalesce(btrim(p_note), ''), p_actor_user_id
  ) returning * into v_link;
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet_attachment', v_link.id, 'upload',
    jsonb_build_object('sheet_id', p_sheet_id, 'salary_month', v_sheet.salary_month,
      'voucher_id', v_voucher.id, 'filename', v_voucher.original_filename,
      'mime_type', v_voucher.mime_type, 'sha256', v_voucher.sha256,
      'attachment_kind', p_attachment_kind),
    coalesce(nullif(btrim(p_note), ''), '上传并绑定原始工资报表'), 'payroll'
  );
  return jsonb_build_object('attachment', to_jsonb(v_link), 'voucher', to_jsonb(v_voucher));
end
$$;

create or replace function public.zysyr_confirm_and_lock_salary_sheet(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_sheet_id uuid,
  p_reason text
) returns public.zysyr_salary_sheet_drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.zysyr_salary_sheet_drafts;
  v_row public.zysyr_salary_sheet_rows;
  v_previous public.zysyr_salaries;
  v_salary public.zysyr_salaries;
  v_salary_version integer;
  v_source_report_id uuid;
  v_voucher_ids uuid[];
  v_component record;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_CONFIRM_REASON_REQUIRED';
  end if;
  select * into v_sheet from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.id = p_sheet_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_NOT_FOUND'; end if;
  if v_sheet.status <> 'draft' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_NOT_DRAFT';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_sheet.salary_month)
     and not exists (
       select 1 from public.zysyr_salary_sheet_unlock_requests request
       where request.company_id = p_company_id and request.id = v_sheet.revision_request_id
         and request.status = 'consumed'
     ) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  select array_agg(attachment.voucher_id order by attachment.linked_at)
  into v_voucher_ids
  from public.zysyr_salary_sheet_attachments attachment
  join public.zysyr_voucher_attachments voucher
    on voucher.company_id = attachment.company_id and voucher.id = attachment.voucher_id
  where attachment.company_id = p_company_id and attachment.store_id = p_store_id
    and attachment.sheet_id = p_sheet_id and attachment.attachment_kind = 'original_report'
    and voucher.audit_status = 'approved';
  if cardinality(coalesce(v_voucher_ids, array[]::uuid[])) = 0 then
    raise exception using errcode = '22023', message = 'SALARY_ORIGINAL_REPORT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.zysyr_salary_sheet_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.sheet_id = p_sheet_id
      and (row_item.employee_id is not null or nullif(btrim(row_item.employee_name), '') is not null)
  ) then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_EMPTY';
  end if;
  if exists (
    select 1 from public.zysyr_salary_sheet_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.sheet_id = p_sheet_id
      and (
        (nullif(btrim(row_item.employee_name), '') is not null and row_item.employee_id is null)
        or row_item.net_pay < 0
      )
  ) then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_EMPLOYEE_OR_TOTAL_INVALID';
  end if;
  if exists (
    select row_item.employee_id from public.zysyr_salary_sheet_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.sheet_id = p_sheet_id and row_item.employee_id is not null
    group by row_item.employee_id having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'SALARY_SHEET_DUPLICATE_EMPLOYEE';
  end if;
  select report.id into v_source_report_id
  from public.zysyr_report_uploads report
  where report.company_id = p_company_id and report.store_id = p_store_id
    and report.report_type = 'salary' and report.report_date = v_sheet.salary_month
    and report.status = 'active'
  order by report.version desc limit 1;
  for v_row in
    select * from public.zysyr_salary_sheet_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.sheet_id = p_sheet_id and row_item.employee_id is not null
    order by row_item.row_number
  loop
    select * into v_previous from public.zysyr_salaries salary
    where salary.company_id = p_company_id and salary.store_id = p_store_id
      and salary.employee_id = v_row.employee_id and salary.salary_month = v_sheet.salary_month
      and salary.status in ('draft','approved','paid')
    order by salary.version desc limit 1 for update;
    if found and v_previous.status = 'paid' then
      raise exception using errcode = '55000', message = 'SALARY_PAID_REVERSAL_REQUIRED';
    end if;
    if found then
      update public.zysyr_salaries set status = 'reversed',
        reversed_by_user_id = p_actor_user_id, reversed_at = now(),
        reverse_reason = '由原纸质格式电子工资表确认版本替代'
      where id = v_previous.id;
    end if;
    if not found then
      select * into v_previous from public.zysyr_salaries salary
      where salary.company_id = p_company_id and salary.store_id = p_store_id
        and salary.employee_id = v_row.employee_id
        and salary.salary_month = v_sheet.salary_month
      order by salary.version desc limit 1;
    end if;
    select coalesce(max(salary.version), 0) + 1 into v_salary_version
    from public.zysyr_salaries salary
    where salary.company_id = p_company_id and salary.store_id = p_store_id
      and salary.employee_id = v_row.employee_id and salary.salary_month = v_sheet.salary_month;
    insert into public.zysyr_salaries(
      company_id, store_id, employee_id, salary_month, version, supersedes_salary_id,
      source_report_id, source_salary_sheet_id, source_salary_sheet_row_id,
      base_salary, commission_amount, bonus_amount, deduction_amount,
      social_security, other_adjustment, final_salary, status,
      generated_by_user_id, approved_by_user_id, approved_at, approval_reason
    ) values (
      p_company_id, p_store_id, v_row.employee_id, v_sheet.salary_month,
      v_salary_version, v_previous.id, v_source_report_id, p_sheet_id, v_row.id,
      round(v_row.base_salary + v_row.seniority_salary + v_row.position_salary, 2),
      round(v_row.performance_commission + v_row.delivery_card_commission, 2),
      round(v_row.meal_allowance + v_row.overtime_activity_allowance, 2),
      round(v_row.product_cost + v_row.late_early_deduction + v_row.shooting_deduction
        + v_row.leave_deduction + v_row.growth_deduction + v_row.employee_purchase, 2),
      v_row.employee_social_security, v_row.supplemental_adjustment,
      v_row.net_pay, 'approved', p_actor_user_id, p_actor_user_id, now(), btrim(p_reason)
    ) returning * into v_salary;
    insert into public.zysyr_salary_details(
      company_id, store_id, salary_id, line_number, line_type,
      source_type, source_id, amount, note
    )
    select p_company_id, p_store_id, v_salary.id,
      row_number() over (order by component.ordinal)::integer,
      component.line_type, 'salary_sheet_row', v_row.id,
      component.amount, component.label
    from (values
      (1, 'base', v_row.base_salary, '基本工资'),
      (2, 'base', v_row.seniority_salary, '工龄工资'),
      (3, 'base', v_row.position_salary, '岗位工资'),
      (4, 'bonus', v_row.meal_allowance, '饭补'),
      (5, 'commission', v_row.performance_commission, '业绩提成'),
      (6, 'commission', v_row.delivery_card_commission, '外卖办卡提成'),
      (7, 'bonus', v_row.overtime_activity_allowance, '加班费／活动津贴'),
      (8, 'other', v_row.supplemental_adjustment, '补发补扣'),
      (9, 'penalty', -v_row.product_cost, '成本'),
      (10, 'penalty', -v_row.late_early_deduction, '迟到／早退'),
      (11, 'penalty', -v_row.shooting_deduction, '拍摄'),
      (12, 'penalty', -v_row.leave_deduction, '请假'),
      (13, 'penalty', -v_row.growth_deduction, '成长'),
      (14, 'penalty', -v_row.employee_purchase, '自购'),
      (15, 'social_security', -v_row.employee_social_security, '社保（员工缴）')
    ) component(ordinal, line_type, amount, label)
    where component.amount <> 0;
    perform zysyr_private.link_finance_vouchers(
      p_actor_user_id, p_company_id, p_store_id, 'salary', v_salary.id,
      v_voucher_ids, 'source_document', p_reason
    );
    perform zysyr_private.payroll_trace_edge(
      p_company_id, p_store_id, 'salary', v_salary.id,
      'salary_sheet_row', v_row.id, 'derived_from', v_salary.final_salary, p_actor_user_id
    );
    perform zysyr_private.payroll_trace_edge(
      p_company_id, p_store_id, 'salary', v_salary.id,
      'employee', v_row.employee_id, 'allocated_to', v_salary.final_salary, p_actor_user_id
    );
    for v_component in
      select detail.id, detail.amount from public.zysyr_salary_details detail
      where detail.company_id = p_company_id and detail.salary_id = v_salary.id
    loop
      perform zysyr_private.payroll_trace_edge(
        p_company_id, p_store_id, 'salary_detail', v_component.id,
        'salary_sheet_row', v_row.id, 'derived_from', abs(v_component.amount), p_actor_user_id
      );
    end loop;
  end loop;
  update public.zysyr_salary_sheet_drafts
  set status = 'locked', confirmed_by_user_id = p_actor_user_id, confirmed_at = now(),
      confirmation_reason = btrim(p_reason), locked_by_user_id = p_actor_user_id,
      locked_at = now(), lock_reason = btrim(p_reason),
      updated_by_user_id = p_actor_user_id, updated_at = now()
  where company_id = p_company_id and id = p_sheet_id
  returning * into v_sheet;
  perform zysyr_private.payroll_trace_edge(
    p_company_id, p_store_id, 'salary_sheet', p_sheet_id,
    'salary', salary.id, 'contains', salary.final_salary, p_actor_user_id
  ) from public.zysyr_salaries salary
  where salary.company_id = p_company_id and salary.store_id = p_store_id
    and salary.source_salary_sheet_id = p_sheet_id and salary.status = 'approved';
  insert into public.zysyr_workflow_events(
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'salary_sheet', p_sheet_id,
    'draft', 'locked', 'lock', p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet', p_sheet_id, 'confirm_lock',
    jsonb_build_object('status', 'draft', 'revision', v_sheet.edit_revision),
    jsonb_build_object('status', 'locked', 'salary_count', (
      select count(*) from public.zysyr_salaries salary
      where salary.company_id = p_company_id and salary.source_salary_sheet_id = p_sheet_id
        and salary.status = 'approved'
    ), 'original_voucher_ids', to_jsonb(v_voucher_ids)),
    btrim(p_reason), 'payroll'
  );
  return v_sheet;
end
$$;

create or replace function public.zysyr_request_salary_sheet_unlock(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_sheet_id uuid,
  p_reason text
) returns public.zysyr_salary_sheet_unlock_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.zysyr_salary_sheet_drafts;
  v_saved public.zysyr_salary_sheet_unlock_requests;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_UNLOCK_REASON_REQUIRED';
  end if;
  select * into v_sheet from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.id = p_sheet_id;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_NOT_FOUND'; end if;
  if v_sheet.status <> 'locked' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_NOT_LOCKED';
  end if;
  insert into public.zysyr_salary_sheet_unlock_requests(
    company_id, store_id, sheet_id, requested_by_user_id, request_reason
  ) values (
    p_company_id, p_store_id, p_sheet_id, p_actor_user_id, btrim(p_reason)
  ) returning * into v_saved;
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet_unlock_request', v_saved.id, 'unlock_request',
    jsonb_build_object('sheet_id', p_sheet_id, 'salary_month', v_sheet.salary_month,
      'status', v_saved.status), btrim(p_reason), 'payroll'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_decide_salary_sheet_unlock(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text
) returns public.zysyr_salary_sheet_unlock_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.zysyr_salary_sheet_unlock_requests;
  v_after public.zysyr_salary_sheet_unlock_requests;
begin
  perform zysyr_private.assert_monthly_unlock_approver(p_actor_user_id, p_company_id);
  if p_decision not in ('approved','rejected')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_UNLOCK_DECISION_INVALID';
  end if;
  select * into v_before from public.zysyr_salary_sheet_unlock_requests request
  where request.company_id = p_company_id and request.id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_UNLOCK_REQUEST_NOT_FOUND'; end if;
  if v_before.status <> 'pending' then
    raise exception using errcode = '55000', message = 'SALARY_UNLOCK_REQUEST_ALREADY_DECIDED';
  end if;
  if v_before.requested_by_user_id = p_actor_user_id then
    raise exception using errcode = '42501', message = 'SALARY_UNLOCK_SELF_APPROVAL_FORBIDDEN';
  end if;
  update public.zysyr_salary_sheet_unlock_requests
  set status = p_decision, decided_by_user_id = p_actor_user_id,
      decision_reason = btrim(p_reason), decided_at = now()
  where company_id = p_company_id and id = p_request_id
  returning * into v_after;
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, v_after.store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet_unlock_request', v_after.id,
    case when p_decision = 'approved' then 'unlock_approve' else 'unlock_reject' end,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'sheet_id', v_after.sheet_id),
    btrim(p_reason), 'payroll'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_begin_salary_sheet_revision(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_sheet_id uuid,
  p_reason text
) returns public.zysyr_salary_sheet_drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.zysyr_salary_sheet_drafts;
  v_request public.zysyr_salary_sheet_unlock_requests;
  v_new public.zysyr_salary_sheet_drafts;
  v_version integer;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'salary.write_approve'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'SALARY_REVISION_REASON_REQUIRED';
  end if;
  select * into v_old from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.id = p_sheet_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALARY_SHEET_NOT_FOUND'; end if;
  if v_old.status <> 'locked' then
    raise exception using errcode = '55000', message = 'SALARY_SHEET_NOT_LOCKED';
  end if;
  select * into v_request from public.zysyr_salary_sheet_unlock_requests request
  where request.company_id = p_company_id and request.store_id = p_store_id
    and request.sheet_id = p_sheet_id and request.requested_by_user_id = p_actor_user_id
    and request.status = 'approved'
  order by request.decided_at, request.id limit 1 for update;
  if not found then
    raise exception using errcode = '42501', message = 'SALARY_REVISION_APPROVAL_REQUIRED';
  end if;
  if exists (
    select 1 from public.zysyr_salaries salary
    where salary.company_id = p_company_id and salary.store_id = p_store_id
      and salary.source_salary_sheet_id = p_sheet_id and salary.status = 'paid'
  ) then
    raise exception using errcode = '55000', message = 'SALARY_PAID_REVERSAL_REQUIRED';
  end if;
  update public.zysyr_salaries set status = 'reversed',
    reversed_by_user_id = p_actor_user_id, reversed_at = now(),
    reverse_reason = btrim(p_reason)
  where company_id = p_company_id and store_id = p_store_id
    and source_salary_sheet_id = p_sheet_id and status in ('draft','approved');
  update public.zysyr_salary_sheet_drafts set status = 'reversed',
    reversed_by_user_id = p_actor_user_id, reversed_at = now(),
    reverse_reason = btrim(p_reason), updated_by_user_id = p_actor_user_id, updated_at = now()
  where company_id = p_company_id and id = p_sheet_id;
  select coalesce(max(sheet.version), 0) + 1 into v_version
  from public.zysyr_salary_sheet_drafts sheet
  where sheet.company_id = p_company_id and sheet.store_id = p_store_id
    and sheet.salary_month = v_old.salary_month;
  insert into public.zysyr_salary_sheet_drafts(
    company_id, store_id, salary_month, version, supersedes_sheet_id,
    revision_request_id, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, p_store_id, v_old.salary_month, v_version, v_old.id,
    v_request.id, p_actor_user_id, p_actor_user_id
  ) returning * into v_new;
  insert into public.zysyr_salary_sheet_rows(
    company_id, store_id, sheet_id, row_number, employee_id, position, employee_name,
    base_salary, seniority_salary, position_salary, meal_allowance,
    performance_commission, delivery_card_commission, overtime_activity_allowance,
    supplemental_adjustment, product_cost, late_early_deduction, shooting_deduction,
    leave_deduction, growth_deduction, employee_purchase, employee_social_security, notes
  ) select
    row_item.company_id, row_item.store_id, v_new.id, row_item.row_number,
    row_item.employee_id, row_item.position, row_item.employee_name,
    row_item.base_salary, row_item.seniority_salary, row_item.position_salary,
    row_item.meal_allowance, row_item.performance_commission,
    row_item.delivery_card_commission, row_item.overtime_activity_allowance,
    row_item.supplemental_adjustment, row_item.product_cost,
    row_item.late_early_deduction, row_item.shooting_deduction,
    row_item.leave_deduction, row_item.growth_deduction,
    row_item.employee_purchase, row_item.employee_social_security, row_item.notes
  from public.zysyr_salary_sheet_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.sheet_id = p_sheet_id order by row_item.row_number;
  insert into public.zysyr_salary_sheet_attachments(
    company_id, store_id, sheet_id, voucher_id, attachment_kind, note, linked_by_user_id
  ) select
    attachment.company_id, attachment.store_id, v_new.id, attachment.voucher_id,
    attachment.attachment_kind, '继承自工资表 v' || v_old.version::text || '：' || attachment.note,
    p_actor_user_id
  from public.zysyr_salary_sheet_attachments attachment
  where attachment.company_id = p_company_id and attachment.store_id = p_store_id
    and attachment.sheet_id = p_sheet_id;
  update public.zysyr_salary_sheet_unlock_requests
  set status = 'consumed', consumed_at = now()
  where company_id = p_company_id and id = v_request.id;
  insert into public.zysyr_workflow_events(
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'salary_sheet', v_new.id,
    'locked', 'draft', 'unlock', p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'salary_sheet', v_new.id, 'revision_begin',
    jsonb_build_object('supersedes_sheet_id', v_old.id, 'version', v_old.version,
      'unlock_request_id', v_request.id),
    jsonb_build_object('version', v_new.version, 'status', v_new.status),
    btrim(p_reason), 'payroll'
  );
  return v_new;
end
$$;

revoke execute on function public.zysyr_create_salary_sheet(uuid,uuid,uuid,date,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_save_salary_sheet(uuid,uuid,uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_register_salary_sheet_attachment(
  uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_confirm_and_lock_salary_sheet(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_request_salary_sheet_unlock(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_decide_salary_sheet_unlock(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_begin_salary_sheet_revision(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function public.zysyr_create_salary_sheet(uuid,uuid,uuid,date,text)
  to service_role;
grant execute on function public.zysyr_save_salary_sheet(uuid,uuid,uuid,uuid,jsonb,text)
  to service_role;
grant execute on function public.zysyr_register_salary_sheet_attachment(
  uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text
) to service_role;
grant execute on function public.zysyr_confirm_and_lock_salary_sheet(uuid,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.zysyr_request_salary_sheet_unlock(uuid,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.zysyr_decide_salary_sheet_unlock(uuid,uuid,uuid,text,text)
  to service_role;
grant execute on function public.zysyr_begin_salary_sheet_revision(uuid,uuid,uuid,uuid,text)
  to service_role;

alter table public.zysyr_salary_sheet_drafts enable row level security;
alter table public.zysyr_salary_sheet_drafts force row level security;
alter table public.zysyr_salary_sheet_rows enable row level security;
alter table public.zysyr_salary_sheet_rows force row level security;
alter table public.zysyr_salary_sheet_changes enable row level security;
alter table public.zysyr_salary_sheet_changes force row level security;
alter table public.zysyr_salary_sheet_attachments enable row level security;
alter table public.zysyr_salary_sheet_attachments force row level security;
alter table public.zysyr_salary_sheet_unlock_requests enable row level security;
alter table public.zysyr_salary_sheet_unlock_requests force row level security;

create policy zysyr_salary_sheet_drafts_scope_select
  on public.zysyr_salary_sheet_drafts for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'salary.read')));
create policy zysyr_salary_sheet_rows_scope_select
  on public.zysyr_salary_sheet_rows for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'salary.read')));
create policy zysyr_salary_sheet_changes_scope_select
  on public.zysyr_salary_sheet_changes for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'salary.read')));
create policy zysyr_salary_sheet_attachments_scope_select
  on public.zysyr_salary_sheet_attachments for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'salary.read')));
create policy zysyr_salary_sheet_unlock_scope_select
  on public.zysyr_salary_sheet_unlock_requests for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'salary.read')));

revoke all on table public.zysyr_salary_sheet_drafts,
  public.zysyr_salary_sheet_rows, public.zysyr_salary_sheet_changes,
  public.zysyr_salary_sheet_attachments, public.zysyr_salary_sheet_unlock_requests
from public, anon, authenticated, service_role;
grant select on table public.zysyr_salary_sheet_drafts,
  public.zysyr_salary_sheet_rows, public.zysyr_salary_sheet_changes,
  public.zysyr_salary_sheet_attachments, public.zysyr_salary_sheet_unlock_requests
to authenticated;
grant select, insert, update on table public.zysyr_salary_sheet_drafts,
  public.zysyr_salary_sheet_rows, public.zysyr_salary_sheet_unlock_requests
to service_role;
grant select, insert on table public.zysyr_salary_sheet_changes,
  public.zysyr_salary_sheet_attachments
to service_role;

comment on table public.zysyr_salary_sheet_drafts is
  'Versioned electronic salary sheets matching the original 21-column paper layout. Locked versions are revised only by creating a new approved version.';
comment on table public.zysyr_salary_sheet_rows is
  'One employee row from the original salary template. Gross pay, deductions and net pay are generated from approved component formulas.';
comment on table public.zysyr_salary_sheet_changes is
  'Append-only field history containing before value, after value, actor, time, reason, store, month and salary row.';
comment on table public.zysyr_salary_sheet_attachments is
  'Append-only original salary reports and supporting evidence bound to one store, month and electronic salary sheet.';
