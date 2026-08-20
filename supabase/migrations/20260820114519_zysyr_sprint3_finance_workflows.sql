-- ZYSYR V2 Sprint 3 finance workflows: expense, petty cash, payment,
-- formal monthly aggregation, period locking and complete voucher trace.

set statement_timeout = '30s';
set lock_timeout = '5s';

create or replace function zysyr_private.assert_approved_vouchers(
  target_company_id uuid,
  target_store_id uuid,
  target_voucher_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  select coalesce(array_agg(distinct requested.id order by requested.id), array[]::uuid[])
  into v_ids from unnest(coalesce(target_voucher_ids, array[]::uuid[])) requested(id);
  if cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = 'APPROVED_VOUCHER_REQUIRED';
  end if;
  select count(*) into v_count
  from public.zysyr_voucher_attachments voucher
  where voucher.company_id = target_company_id
    and voucher.store_id = target_store_id
    and voucher.audit_status = 'approved'
    and voucher.id = any(v_ids);
  if v_count <> cardinality(v_ids) then
    raise exception using errcode = 'P0002', message = 'APPROVED_VOUCHER_NOT_FOUND';
  end if;
end
$$;

create or replace function zysyr_private.link_finance_vouchers(
  target_actor_user_id uuid,
  target_company_id uuid,
  target_store_id uuid,
  target_business_type text,
  target_business_id uuid,
  target_voucher_ids uuid[],
  target_relation_type text,
  target_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  perform zysyr_private.assert_approved_vouchers(
    target_company_id, target_store_id, target_voucher_ids
  );
  select array_agg(distinct requested.id order by requested.id)
  into v_ids from unnest(target_voucher_ids) requested(id);

  insert into public.zysyr_voucher_links (
    company_id, store_id, voucher_id, business_type, business_id,
    relation_type, linked_by_user_id
  )
  select target_company_id, target_store_id, voucher_id,
    target_business_type, target_business_id, target_relation_type,
    target_actor_user_id
  from unnest(v_ids) requested(voucher_id)
  on conflict (company_id, voucher_id, business_type, business_id, relation_type)
    where unlinked_at is null do nothing;

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (target_company_id, target_store_id, target_business_type, target_business_id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select target_company_id, target_store_id, 'voucher', voucher_id
  from unnest(v_ids) requested(voucher_id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    created_by_user_id
  )
  select target_company_id, target_store_id, business_node.id, voucher_node.id,
    'evidenced_by', target_actor_user_id
  from public.zysyr_trace_nodes business_node
  join public.zysyr_trace_nodes voucher_node
    on voucher_node.company_id = target_company_id
   and voucher_node.entity_type = 'voucher'
   and voucher_node.entity_id = any(v_ids)
  where business_node.company_id = target_company_id
    and business_node.entity_type = target_business_type
    and business_node.entity_id = target_business_id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  get diagnostics v_count = row_count;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    target_company_id, target_store_id, 'user', target_actor_user_id, 'api',
    target_business_type, target_business_id, 'voucher_link',
    jsonb_build_object('voucher_ids', to_jsonb(v_ids), 'relation_type', target_relation_type),
    btrim(target_reason), 'financial'
  );
  return cardinality(v_ids);
end
$$;

create or replace function public.zysyr_upsert_expense_category(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_code text,
  p_name text,
  p_report_section text,
  p_sort_order integer,
  p_status text,
  p_reason text
)
returns public.zysyr_expense_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_expense_categories;
  v_saved public.zysyr_expense_categories;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if upper(coalesce(btrim(p_code), '')) !~ '^[A-Z][A-Z0-9_]{1,63}$'
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_report_section), '') is null
     or coalesce(p_status, '') not in ('active', 'inactive')
     or (p_id is not null and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'EXPENSE_CATEGORY_INVALID';
  end if;
  if p_id is not null then
    select * into v_before from public.zysyr_expense_categories category
    where category.id = p_id and category.company_id = p_company_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_CATEGORY_NOT_FOUND'; end if;
    update public.zysyr_expense_categories
    set code = upper(btrim(p_code)), name = btrim(p_name),
        report_section = btrim(p_report_section), sort_order = coalesce(p_sort_order, 0),
        status = p_status, updated_by_user_id = p_actor_user_id, updated_at = now()
    where id = p_id and company_id = p_company_id returning * into v_saved;
  else
    insert into public.zysyr_expense_categories (
      company_id, code, name, report_section, sort_order, status,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, upper(btrim(p_code)), btrim(p_name), btrim(p_report_section),
      coalesce(p_sort_order, 0), p_status, p_actor_user_id, p_actor_user_id
    ) returning * into v_saved;
  end if;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'expense_category', v_saved.id, case when p_id is null then 'create' else 'update' end,
    case when p_id is null then null else to_jsonb(v_before) end, to_jsonb(v_saved),
    coalesce(nullif(btrim(p_reason), ''), '财务新增支出分类。'), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_submit_expense(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_expense_date date,
  p_expense_category_id uuid,
  p_counterparty text,
  p_summary text,
  p_amount numeric,
  p_payment_method text,
  p_operator_employee_id uuid,
  p_daily_report_line_id uuid,
  p_voucher_ids uuid[],
  p_reason text
)
returns public.zysyr_expense_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.zysyr_expense_categories;
  v_line public.zysyr_daily_report_lines;
  v_store_name text;
  v_actor_name text;
  v_saved public.zysyr_expense_records;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if p_expense_date is null or p_amount <= 0
     or nullif(btrim(p_summary), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'EXPENSE_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_expense_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  select * into v_category from public.zysyr_expense_categories category
  where category.id = p_expense_category_id and category.company_id = p_company_id
    and category.status = 'active';
  if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_CATEGORY_NOT_FOUND'; end if;
  if p_operator_employee_id is not null and not exists (
    select 1 from public.zysyr_employees employee
    where employee.id = p_operator_employee_id and employee.company_id = p_company_id
      and employee.store_id = p_store_id and employee.deleted_at is null
  ) then raise exception using errcode = 'P0002', message = 'EXPENSE_OPERATOR_NOT_FOUND'; end if;
  if p_daily_report_line_id is not null then
    select line.* into v_line
    from public.zysyr_daily_report_lines line
    join public.zysyr_daily_reports report
      on report.id = line.daily_report_id and report.company_id = line.company_id
    where line.id = p_daily_report_line_id and line.company_id = p_company_id
      and line.store_id = p_store_id and line.line_type = 'expense'
      and report.status = 'approved';
    if not found or v_line.amount <> p_amount then
      raise exception using errcode = '22023', message = 'EXPENSE_DAILY_LINE_INVALID';
    end if;
  end if;
  select store.name into v_store_name from public.zysyr_stores store
  where store.id = p_store_id and store.company_id = p_company_id;
  select coalesce(nullif(account.display_name, ''), account.login_name) into v_actor_name
  from public.zysyr_user_accounts account
  where account.id = p_actor_user_id and account.company_id = p_company_id;

  insert into public.zysyr_expense_records (
    company_id, store_id, store, expense_date, expense_category_id, category,
    counterparty, summary, amount, payment_method, operator_employee_id,
    daily_report_id, daily_report_line_id, source_report_cell_id,
    source, workflow_status, submitted_at, submitted_by_user_id,
    created_by, updated_by, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, p_store_id, v_store_name, p_expense_date, v_category.id, v_category.name,
    coalesce(btrim(p_counterparty), ''), btrim(p_summary), p_amount,
    coalesce(btrim(p_payment_method), ''), p_operator_employee_id,
    v_line.daily_report_id, v_line.id, v_line.source_report_cell_id,
    'manual', 'submitted', now(), p_actor_user_id,
    v_actor_name, v_actor_name, p_actor_user_id, p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(
    p_actor_user_id, p_company_id, p_store_id, 'expense_record', v_saved.id,
    p_voucher_ids, 'evidence', p_reason
  );
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (p_company_id, p_store_id, 'expense_record', v_saved.id, null, 'submitted', 'submit', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'expense_record',
    v_saved.id, 'submit', jsonb_build_object(
      'expense_date', v_saved.expense_date, 'category_id', v_saved.expense_category_id,
      'amount', v_saved.amount, 'status', v_saved.workflow_status,
      'daily_report_line_id', v_saved.daily_report_line_id
    ), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_review_expense(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_expense_id uuid,
  p_decision text,
  p_reason text
)
returns public.zysyr_expense_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_expense_records;
  v_after public.zysyr_expense_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'expense.approve');
  if p_decision not in ('approved', 'rejected') or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'EXPENSE_REVIEW_INVALID';
  end if;
  select * into v_before from public.zysyr_expense_records expense
  where expense.id = p_expense_id and expense.company_id = p_company_id
    and expense.store_id = p_store_id and expense.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND'; end if;
  if v_before.workflow_status <> 'submitted' then raise exception using errcode = '55000', message = 'EXPENSE_NOT_SUBMITTED'; end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.expense_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  update public.zysyr_expense_records
  set workflow_status = case when p_decision = 'approved' then 'approved' else 'reversed' end,
      approved_at = case when p_decision = 'approved' then now() else null end,
      approved_by_user_id = case when p_decision = 'approved' then p_actor_user_id else null end,
      reversed_at = case when p_decision = 'rejected' then now() else null end,
      reversed_by_user_id = case when p_decision = 'rejected' then p_actor_user_id else null end,
      reverse_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end,
      updated_at = now(), updated_by_user_id = p_actor_user_id
  where id = p_expense_id and company_id = p_company_id returning * into v_after;
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'expense_record', p_expense_id, 'submitted',
    v_after.workflow_status, case when p_decision = 'approved' then 'approve' else 'reject' end,
    p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'expense_record',
    p_expense_id, case when p_decision = 'approved' then 'approve' else 'reject' end,
    jsonb_build_object('status', v_before.workflow_status),
    jsonb_build_object('status', v_after.workflow_status), btrim(p_reason), 'financial'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_record_petty_cash(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_transaction_date date,
  p_direction text,
  p_category text,
  p_summary text,
  p_amount numeric,
  p_daily_report_line_id uuid,
  p_voucher_ids uuid[],
  p_reason text
)
returns public.zysyr_petty_cash_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.zysyr_daily_report_lines;
  v_saved public.zysyr_petty_cash_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit');
  if p_transaction_date is null or p_direction not in ('inflow', 'outflow')
    or p_amount <= 0 or nullif(btrim(p_category), '') is null
    or nullif(btrim(p_summary), '') is null or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PETTY_CASH_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_transaction_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  if p_daily_report_line_id is not null then
    select line.* into v_line from public.zysyr_daily_report_lines line
    join public.zysyr_daily_reports report on report.id = line.daily_report_id and report.company_id = line.company_id
    where line.id = p_daily_report_line_id and line.company_id = p_company_id
      and line.store_id = p_store_id and line.line_type = 'petty_cash'
      and line.amount = p_amount and report.status = 'approved';
    if not found then raise exception using errcode = '22023', message = 'PETTY_CASH_DAILY_LINE_INVALID'; end if;
  end if;
  insert into public.zysyr_petty_cash_records (
    company_id, store_id, transaction_date, direction, category, summary,
    amount, daily_report_id, daily_report_line_id, source_report_cell_id,
    confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_transaction_date, p_direction, btrim(p_category),
    btrim(p_summary), p_amount, v_line.daily_report_id, v_line.id,
    v_line.source_report_cell_id, p_actor_user_id
  ) returning * into v_saved;
  perform zysyr_private.link_finance_vouchers(
    p_actor_user_id, p_company_id, p_store_id, 'petty_cash_record', v_saved.id,
    p_voucher_ids, 'evidence', p_reason
  );
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (p_company_id, p_store_id, 'petty_cash_record', v_saved.id, null, 'confirmed', 'confirm', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'petty_cash_record',
    v_saved.id, 'confirm', jsonb_build_object('direction', v_saved.direction, 'amount', v_saved.amount),
    btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_confirm_expense_payment(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_expense_id uuid,
  p_payment_date date,
  p_payee text,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text,
  p_voucher_ids uuid[],
  p_reason text
)
returns public.zysyr_payment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.zysyr_expense_records;
  v_paid numeric(14,2);
  v_saved public.zysyr_payment_records;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'payment.confirm');
  if p_payment_date is null or p_amount <= 0 or nullif(btrim(p_payee), '') is null
     or nullif(btrim(p_payment_method), '') is null or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PAYMENT_INPUT_INVALID';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, p_payment_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id, p_store_id, p_voucher_ids);
  select * into v_expense from public.zysyr_expense_records expense
  where expense.id = p_expense_id and expense.company_id = p_company_id
    and expense.store_id = p_store_id and expense.workflow_status in ('approved', 'paid')
    and expense.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'APPROVED_EXPENSE_NOT_FOUND'; end if;
  select coalesce(sum(payment.amount), 0) into v_paid
  from public.zysyr_payment_records payment
  where payment.company_id = p_company_id and payment.store_id = p_store_id
    and payment.business_type = 'expense' and payment.business_id = p_expense_id
    and payment.status = 'confirmed';
  if v_paid + p_amount > v_expense.amount then
    raise exception using errcode = '22023', message = 'PAYMENT_EXCEEDS_EXPENSE';
  end if;
  insert into public.zysyr_payment_records (
    company_id, store_id, payment_date, business_type, business_id, payee,
    amount, payment_method, payment_reference, confirmed_by_user_id
  ) values (
    p_company_id, p_store_id, p_payment_date, 'expense', p_expense_id,
    btrim(p_payee), p_amount, btrim(p_payment_method), nullif(btrim(p_payment_reference), ''),
    p_actor_user_id
  ) returning * into v_saved;
  if v_paid + p_amount = v_expense.amount then
    update public.zysyr_expense_records
    set workflow_status = 'paid', paid_by_user_id = p_actor_user_id, paid_at = now(),
        updated_by_user_id = p_actor_user_id, updated_at = now()
    where id = p_expense_id and company_id = p_company_id;
  end if;
  perform zysyr_private.link_finance_vouchers(
    p_actor_user_id, p_company_id, p_store_id, 'payment_record', v_saved.id,
    p_voucher_ids, 'payment_proof', p_reason
  );
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (p_company_id, p_store_id, 'payment_record', v_saved.id, null, 'confirmed', 'confirm', p_actor_user_id, btrim(p_reason));
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'payment_record',
    v_saved.id, 'confirm', jsonb_build_object(
      'expense_id', p_expense_id, 'amount', v_saved.amount,
      'expense_paid_total', v_paid + p_amount
    ), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_reverse_finance_record(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_record_type text,
  p_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_before jsonb;
  v_after jsonb;
  v_expense_id uuid;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust');
  if p_record_type not in ('income_record', 'expense_record', 'petty_cash_record', 'payment_record')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_REVERSAL_INVALID';
  end if;
  if p_record_type = 'income_record' then
    select income.income_date, to_jsonb(income) into v_date, v_before
    from public.zysyr_income_records income where income.id = p_record_id
      and income.company_id = p_company_id and income.store_id = p_store_id
      and income.status = 'approved' for update;
    if not found then raise exception using errcode = 'P0002', message = 'INCOME_RECORD_NOT_FOUND'; end if;
    update public.zysyr_income_records set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason)
    where id = p_record_id and company_id = p_company_id returning to_jsonb(zysyr_income_records.*) into v_after;
  elsif p_record_type = 'expense_record' then
    select expense.expense_date, to_jsonb(expense) into v_date, v_before
    from public.zysyr_expense_records expense where expense.id = p_record_id
      and expense.company_id = p_company_id and expense.store_id = p_store_id
      and expense.workflow_status in ('approved', 'paid') and expense.deleted_at is null for update;
    if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND'; end if;
    if exists (select 1 from public.zysyr_payment_records payment where payment.company_id = p_company_id
      and payment.business_type = 'expense' and payment.business_id = p_record_id and payment.status = 'confirmed') then
      raise exception using errcode = '55000', message = 'EXPENSE_HAS_CONFIRMED_PAYMENT';
    end if;
    update public.zysyr_expense_records set workflow_status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason), updated_by_user_id = p_actor_user_id, updated_at = now()
    where id = p_record_id and company_id = p_company_id returning to_jsonb(zysyr_expense_records.*) into v_after;
  elsif p_record_type = 'petty_cash_record' then
    select cash.transaction_date, to_jsonb(cash) into v_date, v_before
    from public.zysyr_petty_cash_records cash where cash.id = p_record_id
      and cash.company_id = p_company_id and cash.store_id = p_store_id and cash.status = 'confirmed' for update;
    if not found then raise exception using errcode = 'P0002', message = 'PETTY_CASH_RECORD_NOT_FOUND'; end if;
    update public.zysyr_petty_cash_records set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason)
    where id = p_record_id and company_id = p_company_id returning to_jsonb(zysyr_petty_cash_records.*) into v_after;
  else
    select payment.payment_date, payment.business_id, to_jsonb(payment)
    into v_date, v_expense_id, v_before
    from public.zysyr_payment_records payment where payment.id = p_record_id
      and payment.company_id = p_company_id and payment.store_id = p_store_id and payment.status = 'confirmed' for update;
    if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_RECORD_NOT_FOUND'; end if;
    update public.zysyr_payment_records set status = 'reversed', reversed_by_user_id = p_actor_user_id,
      reversed_at = now(), reverse_reason = btrim(p_reason)
    where id = p_record_id and company_id = p_company_id returning to_jsonb(zysyr_payment_records.*) into v_after;
    update public.zysyr_expense_records set workflow_status = 'approved', paid_by_user_id = null,
      paid_at = null, updated_by_user_id = p_actor_user_id, updated_at = now()
    where id = v_expense_id and company_id = p_company_id and workflow_status = 'paid';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, p_record_type, p_record_id,
    coalesce(v_before->>'status', v_before->>'workflow_status'),
    'reversed', 'reverse', p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', p_record_type,
    p_record_id, 'reverse', v_before, v_after, btrim(p_reason), 'financial');
  return v_after;
end
$$;

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
  ) values
    (p_company_id, p_store_id, v_saved.id, v_line_offset + 1, 'TOTAL_INCOME', '收入合计',
      coalesce((select sum(amount) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code like 'INCOME_%'), 0),
      'formula', 'SUM(INCOME_*)', (select count(*) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id and metric_code like 'INCOME_%')),
    (p_company_id, p_store_id, v_saved.id, v_line_offset + 2, 'TOTAL_EXPENSE', '支出合计',
      coalesce((select sum(amount) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id
        and (metric_code like 'EXPENSE_%' or metric_code = 'PETTY_CASH_OUT')), 0),
      'formula', 'SUM(EXPENSE_*,PETTY_CASH_OUT)', (select count(*) from public.zysyr_monthly_report_lines
        where monthly_report_id = v_saved.id and (metric_code like 'EXPENSE_%' or metric_code = 'PETTY_CASH_OUT')));
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

  -- Preserve the original monthly-report reading path as explicit graph edges:
  -- report -> lines; profit -> totals; totals -> category lines; categories -> records -> vouchers.
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
        and (component.metric_code like 'EXPENSE_%' or component.metric_code = 'PETTY_CASH_OUT'))
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
      'source_report_id', p_source_report_id, 'line_count', (select count(*) from public.zysyr_monthly_report_lines where monthly_report_id = v_saved.id)),
    btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_transition_monthly_report(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_monthly_report_id uuid,
  p_action text,
  p_reason text
)
returns public.zysyr_monthly_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_monthly_reports;
  v_after public.zysyr_monthly_reports;
  v_period_lock_id uuid;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id,
    case when p_action = 'reverse' then 'confirmed_finance.adjust' else 'report.lock' end);
  if p_action not in ('review', 'lock', 'reverse') or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_TRANSITION_INVALID';
  end if;
  select * into v_before from public.zysyr_monthly_reports report
  where report.id = p_monthly_report_id and report.company_id = p_company_id and report.store_id = p_store_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MONTHLY_REPORT_NOT_FOUND'; end if;
  if (p_action = 'review' and v_before.status <> 'draft')
    or (p_action = 'lock' and v_before.status <> 'reviewed')
    or (p_action = 'reverse' and v_before.status not in ('draft', 'reviewed', 'locked')) then
    raise exception using errcode = '55000', message = 'MONTHLY_TRANSITION_NOT_ALLOWED';
  end if;
  update public.zysyr_monthly_reports
  set status = case p_action when 'review' then 'reviewed' when 'lock' then 'locked' else 'reversed' end,
      reviewed_by_user_id = case when p_action = 'review' then p_actor_user_id else reviewed_by_user_id end,
      reviewed_at = case when p_action = 'review' then now() else reviewed_at end,
      review_reason = case when p_action = 'review' then btrim(p_reason) else review_reason end,
      locked_by_user_id = case when p_action = 'lock' then p_actor_user_id else locked_by_user_id end,
      locked_at = case when p_action = 'lock' then now() else locked_at end,
      reversed_by_user_id = case when p_action = 'reverse' then p_actor_user_id else reversed_by_user_id end,
      reversed_at = case when p_action = 'reverse' then now() else reversed_at end,
      reverse_reason = case when p_action = 'reverse' then btrim(p_reason) else reverse_reason end
  where id = p_monthly_report_id and company_id = p_company_id returning * into v_after;
  if p_action = 'lock' then
    insert into public.zysyr_period_locks (
      company_id, scope_type, store_id, period_month, status,
      locked_by_user_id, locked_at, updated_at
    ) values (p_company_id, 'store', p_store_id, v_before.period_month, 'locked', p_actor_user_id, now(), now())
    on conflict (company_id, store_id, period_month) where scope_type = 'store'
    do update set status = 'locked', locked_by_user_id = excluded.locked_by_user_id,
      locked_at = excluded.locked_at, unlocked_by_user_id = null, unlocked_at = null,
      unlock_reason = null, updated_at = now();
    insert into public.zysyr_period_lock_events (
      company_id, store_id, period_lock_id, action, actor_user_id, reason
    ) select p_company_id, p_store_id, lock.id, 'lock', p_actor_user_id, btrim(p_reason)
      from public.zysyr_period_locks lock where lock.company_id = p_company_id
        and lock.store_id = p_store_id and lock.period_month = v_before.period_month and lock.scope_type = 'store';
  elsif p_action = 'reverse' and v_before.status = 'locked' then
    update public.zysyr_period_locks set status = 'unlocked', unlocked_by_user_id = p_actor_user_id,
      unlocked_at = now(), unlock_reason = btrim(p_reason), updated_at = now()
    where company_id = p_company_id and store_id = p_store_id
      and period_month = v_before.period_month and scope_type = 'store' returning id into v_period_lock_id;
    insert into public.zysyr_period_lock_events (
      company_id, store_id, period_lock_id, action, actor_user_id, reason
    ) values (p_company_id, p_store_id, v_period_lock_id, 'unlock', p_actor_user_id, btrim(p_reason));
  end if;
  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'monthly_report', v_after.id, v_before.status, v_after.status,
    case p_action when 'review' then 'approve' when 'lock' then 'confirm' else 'reverse' end,
    p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'monthly_report',
    v_after.id, p_action, to_jsonb(v_before), to_jsonb(v_after), btrim(p_reason), 'financial');
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
  v_exists boolean := false;
  v_link public.zysyr_voucher_links;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'voucher.review');
  if p_business_type not in ('daily_report', 'daily_report_line', 'income_record', 'expense_record',
      'petty_cash_record', 'payment_record', 'monthly_report', 'monthly_report_line')
    or p_relation_type not in ('evidence', 'payment_proof', 'source_document', 'replacement')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_VOUCHER_LINK_INVALID';
  end if;
  if p_business_type = 'daily_report' then select exists(select 1 from public.zysyr_daily_reports r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  elsif p_business_type = 'daily_report_line' then select exists(select 1 from public.zysyr_daily_report_lines r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  elsif p_business_type = 'income_record' then select exists(select 1 from public.zysyr_income_records r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  elsif p_business_type = 'expense_record' then select exists(select 1 from public.zysyr_expense_records r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id and r.deleted_at is null) into v_exists;
  elsif p_business_type = 'petty_cash_record' then select exists(select 1 from public.zysyr_petty_cash_records r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  elsif p_business_type = 'payment_record' then select exists(select 1 from public.zysyr_payment_records r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  elsif p_business_type = 'monthly_report' then select exists(select 1 from public.zysyr_monthly_reports r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  else select exists(select 1 from public.zysyr_monthly_report_lines r where r.id=p_business_id and r.company_id=p_company_id and r.store_id=p_store_id) into v_exists;
  end if;
  if not v_exists then raise exception using errcode = 'P0002', message = 'FINANCE_BUSINESS_RECORD_NOT_FOUND'; end if;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id, p_company_id, p_store_id,
    p_business_type, p_business_id, array[p_voucher_id], p_relation_type, p_reason);
  select * into v_link from public.zysyr_voucher_links link
  where link.company_id = p_company_id and link.voucher_id = p_voucher_id
    and link.business_type = p_business_type and link.business_id = p_business_id
    and link.relation_type = p_relation_type and link.unlinked_at is null;
  return v_link;
end
$$;

revoke execute on function zysyr_private.assert_approved_vouchers(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke execute on function zysyr_private.link_finance_vouchers(uuid, uuid, uuid, text, uuid, uuid[], text, text) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_upsert_expense_category(uuid, uuid, uuid, uuid, text, text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.zysyr_submit_expense(uuid, uuid, uuid, date, uuid, text, text, numeric, text, uuid, uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function public.zysyr_review_expense(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.zysyr_record_petty_cash(uuid, uuid, uuid, date, text, text, text, numeric, uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function public.zysyr_confirm_expense_payment(uuid, uuid, uuid, uuid, date, text, numeric, text, text, uuid[], text) from public, anon, authenticated;
revoke execute on function public.zysyr_reverse_finance_record(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.zysyr_generate_monthly_report(uuid, uuid, uuid, date, uuid, text) from public, anon, authenticated;
revoke execute on function public.zysyr_transition_monthly_report(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.zysyr_link_finance_voucher(uuid, uuid, uuid, uuid, text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.zysyr_upsert_expense_category(uuid, uuid, uuid, uuid, text, text, text, integer, text, text) to service_role;
grant execute on function public.zysyr_submit_expense(uuid, uuid, uuid, date, uuid, text, text, numeric, text, uuid, uuid, uuid[], text) to service_role;
grant execute on function public.zysyr_review_expense(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.zysyr_record_petty_cash(uuid, uuid, uuid, date, text, text, text, numeric, uuid, uuid[], text) to service_role;
grant execute on function public.zysyr_confirm_expense_payment(uuid, uuid, uuid, uuid, date, text, numeric, text, text, uuid[], text) to service_role;
grant execute on function public.zysyr_reverse_finance_record(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.zysyr_generate_monthly_report(uuid, uuid, uuid, date, uuid, text) to service_role;
grant execute on function public.zysyr_transition_monthly_report(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.zysyr_link_finance_voucher(uuid, uuid, uuid, uuid, text, uuid, text, text) to service_role;

comment on function public.zysyr_submit_expense(uuid, uuid, uuid, date, uuid, text, text, numeric, text, uuid, uuid, uuid[], text) is
  'Finance-only formal expense submission requiring an active category and approved voucher evidence.';
comment on function public.zysyr_confirm_expense_payment(uuid, uuid, uuid, uuid, date, text, numeric, text, text, uuid[], text) is
  'Finance-only partial/full expense payment confirmation with approved payment-proof vouchers and overpayment prevention.';
comment on function public.zysyr_generate_monthly_report(uuid, uuid, uuid, date, uuid, text) is
  'Builds a versioned formal monthly report only from approved income, approved/paid expense and confirmed petty-cash facts.';
