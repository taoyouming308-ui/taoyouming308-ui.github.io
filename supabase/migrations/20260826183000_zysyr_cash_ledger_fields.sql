-- ZYSYR v446: cash ledger manual fields + opening balance
alter table public.zysyr_petty_cash_records
  add column if not exists voucher_number text,
  add column if not exists recipient text;

create table if not exists public.zysyr_cash_opening_balances (
  company_id uuid not null,
  store_id uuid not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, store_id, month),
  foreign key (company_id) references public.zysyr_companies(id) on delete restrict,
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict
);

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
  p_reason text,
  p_voucher_number text,
  p_recipient text
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
    confirmed_by_user_id, voucher_number, recipient
  ) values (
    p_company_id, p_store_id, p_transaction_date, p_direction, btrim(p_category),
    btrim(p_summary), p_amount, v_line.daily_report_id, v_line.id,
    v_line.source_report_cell_id, p_actor_user_id,
    nullif(btrim(p_voucher_number), ''), nullif(btrim(p_recipient), '')
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

create or replace function public.zysyr_upsert_cash_opening_balance(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_month text,
  p_amount numeric
)
returns public.zysyr_cash_opening_balances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.zysyr_cash_opening_balances;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit');
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' or p_amount < 0 then
    raise exception using errcode = '22023', message = 'OPENING_BALANCE_INVALID';
  end if;
  insert into public.zysyr_cash_opening_balances (company_id, store_id, month, amount, updated_by_user_id)
  values (p_company_id, p_store_id, p_month, p_amount, p_actor_user_id)
  on conflict (company_id, store_id, month)
  do update set amount = excluded.amount, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
  returning * into v_saved;
  return v_saved;
end
$$;

grant execute on function public.zysyr_record_petty_cash(uuid, uuid, uuid, date, text, text, text, numeric, uuid, uuid[], text, text, text) to service_role;
grant execute on function public.zysyr_upsert_cash_opening_balance(uuid, uuid, uuid, text, numeric) to service_role;
