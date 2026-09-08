-- Income adjustments are an additional, append-only layer. Never rewrite a
-- daily report, salary sheet, source cell, imported ledger or voucher.
set lock_timeout = '5s';
set statement_timeout = '30s';

create table public.zysyr_monthly_income_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id),
  store_id uuid not null,
  period_month date not null check (extract(day from period_month) = 1),
  source_kind text not null check (source_kind in ('history','report')),
  source_id uuid not null,
  source_report_id uuid not null,
  cell_address text not null,
  revision integer not null check (revision > 0),
  base_amount numeric(18,4) not null,
  before_amount numeric(18,4) not null,
  after_amount numeric(18,4) not null,
  adjustment_delta numeric(18,4) not null,
  reason text not null check (nullif(btrim(reason),'') is not null),
  actor_user_id uuid not null,
  unlock_request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id,store_id,source_kind,source_id,revision),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id),
  foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id),
  foreign key(company_id,unlock_request_id) references public.zysyr_monthly_cell_unlock_requests(company_id,id),
  check (after_amount <> before_amount),
  check (adjustment_delta = after_amount - base_amount)
);
create index zysyr_monthly_income_adjustments_scope_idx
on public.zysyr_monthly_income_adjustments(company_id,store_id,period_month,source_kind,source_id,revision desc);
create trigger zysyr_monthly_income_adjustments_immutable
before update or delete on public.zysyr_monthly_income_adjustments
for each row execute function zysyr_private.protect_monthly_cell_history();
alter table public.zysyr_monthly_income_adjustments enable row level security;
alter table public.zysyr_monthly_income_adjustments force row level security;
revoke all on public.zysyr_monthly_income_adjustments from public,anon,authenticated,service_role;
grant select,insert on public.zysyr_monthly_income_adjustments to service_role;
grant select on public.zysyr_monthly_income_adjustments to authenticated;
create policy zysyr_monthly_income_adjustments_read
on public.zysyr_monthly_income_adjustments for select to authenticated
using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));

create function public.zysyr_save_monthly_income_adjustment(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_source_kind text, p_source_id uuid, p_period_month date,
  p_expected_versions jsonb, p_expected_adjustments jsonb,
  p_base_amount numeric, p_before_amount numeric, p_after_amount numeric,
  p_reason text
) returns public.zysyr_monthly_income_adjustments
language plpgsql security definer set search_path = ''
as $$
declare
  v_source jsonb; v_report uuid; v_label text; v_address text;
  v_versions jsonb; v_adjustments jsonb;
  v_prior public.zysyr_monthly_income_adjustments;
  v_saved public.zysyr_monthly_income_adjustments;
  v_unlock public.zysyr_monthly_cell_unlock_requests;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'confirmed_finance.adjust');
  if p_period_month is null or extract(day from p_period_month) <> 1
    or p_before_amount is null or p_after_amount is null or p_base_amount is null
    or p_after_amount::text in ('NaN','Infinity','-Infinity')
    or p_base_amount::text in ('NaN','Infinity','-Infinity')
    or p_before_amount::text in ('NaN','Infinity','-Infinity')
    or abs(p_after_amount) > 99999999999999.9999
    or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception 'MONTHLY_ADJUSTMENT_INVALID';
  end if;
  -- Same scope lock used by month edits and lock/unlock operations.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||p_period_month::text,0));
  if p_source_kind = 'history' then
    select entry.current_payload,entry.import_batch_id into v_source,v_report
    from public.zysyr_history_ledger_entries entry
    where entry.company_id=p_company_id and entry.store_id=p_store_id
      and entry.id=p_source_id and entry.period_month=p_period_month
      and entry.entry_type='monthly_profit_loss' and entry.status='posted';
    select coalesce(jsonb_object_agg(entry.id::text,entry.version),'{}'::jsonb) into v_versions
    from public.zysyr_history_ledger_entries entry
    where entry.company_id=p_company_id and entry.store_id=p_store_id
      and entry.period_month=p_period_month and entry.entry_type='monthly_profit_loss' and entry.status='posted';
  elsif p_source_kind = 'report' then
    select to_jsonb(cell),report.id into v_source,v_report
    from public.zysyr_report_cells cell join public.zysyr_report_uploads report
      on report.company_id=cell.company_id and report.store_id=cell.store_id and report.id=cell.report_id
    where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.id=p_source_id
      and report.report_date=p_period_month and report.report_type='monthly_profit_loss' and report.status='active';
    select coalesce(jsonb_object_agg(rev.id::text,rev.revision),'{}'::jsonb) into v_versions
    from public.zysyr_monthly_cell_revisions rev
    where rev.company_id=p_company_id and rev.store_id=p_store_id and rev.report_id=v_report;
  else raise exception 'MONTHLY_ADJUSTMENT_SOURCE_INVALID';
  end if;
  if v_source is null then raise exception 'MONTHLY_ADJUSTMENT_SOURCE_NOT_FOUND'; end if;
  v_label := regexp_replace(coalesce(v_source->>'label',''),'[[:space:]]','','g');
  v_address := v_source->>'cell_address';
  if v_label ~ '(编号|序号|员工号)' or v_label ~ '^(小计|合计|总计|盈亏)([/／·]|$)'
    or v_label !~ '(^主营|美发收入|营业收入|产品收入|其他收入|总收入)' then
    raise exception 'ONLY_INCOME_CAN_HAVE_MONTHLY_ADJUSTMENT';
  end if;
  select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) into v_adjustments
  from public.zysyr_monthly_income_adjustments
  where company_id=p_company_id and store_id=p_store_id and period_month=p_period_month;
  if v_versions is distinct from p_expected_versions or v_adjustments is distinct from p_expected_adjustments then
    raise exception using errcode='40001', message='MONTHLY_DATA_CHANGED_RELOAD';
  end if;
  select * into v_prior from public.zysyr_monthly_income_adjustments
  where company_id=p_company_id and store_id=p_store_id and source_kind=p_source_kind and source_id=p_source_id
  order by revision desc limit 1;
  if round(p_before_amount,4) <> round(p_base_amount+coalesce(v_prior.adjustment_delta,0),4)
    or round(p_before_amount,4) = round(p_after_amount,4) then
    raise exception 'MONTHLY_ADJUSTMENT_AMOUNT_CONFLICT';
  end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,p_period_month) then
    select * into v_unlock from public.zysyr_monthly_cell_unlock_requests
    where company_id=p_company_id and store_id=p_store_id and period_month=p_period_month
      and requested_by_user_id=p_actor_user_id and status='approved'
    order by decided_at asc limit 1 for update;
    if not found then raise exception 'MONTHLY_UNLOCK_APPROVAL_REQUIRED'; end if;
  end if;
  insert into public.zysyr_monthly_income_adjustments
    (company_id,store_id,period_month,source_kind,source_id,source_report_id,cell_address,revision,
     base_amount,before_amount,after_amount,adjustment_delta,reason,actor_user_id,unlock_request_id)
  values(p_company_id,p_store_id,p_period_month,p_source_kind,p_source_id,v_report,v_address,coalesce(v_prior.revision,0)+1,
    round(p_base_amount,4),round(p_before_amount,4),round(p_after_amount,4),round(p_after_amount,4)-round(p_base_amount,4),
    btrim(p_reason),p_actor_user_id,v_unlock.id) returning * into v_saved;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,
    action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','monthly_income_adjustment',v_saved.id,
    'monthly_income_adjustment',jsonb_build_object('amount',p_before_amount,'base_amount',p_base_amount),
    to_jsonb(v_saved),btrim(p_reason),'financial');
  if v_unlock.id is not null then
    update public.zysyr_monthly_cell_unlock_requests set status='consumed',consumed_at=clock_timestamp()
    where company_id=p_company_id and id=v_unlock.id;
  end if;
  return v_saved;
end $$;
revoke execute on function public.zysyr_save_monthly_income_adjustment(uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text)
from public,anon,authenticated;
grant execute on function public.zysyr_save_monthly_income_adjustment(uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text) to service_role;
comment on table public.zysyr_monthly_income_adjustments is 'Monthly-only income delta; source reports and vouchers remain immutable. Latest delta per source is added once to the current source amount.';
