-- Extend the existing append-only monthly adjustment layer to salary cells and
-- formula-based expense details. Original reports, formulas and vouchers remain
-- unchanged; totals continue to recalculate from their effective inputs.
set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function public.zysyr_save_monthly_income_adjustment(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid,
  p_source_kind text, p_source_id uuid, p_period_month date,
  p_expected_versions jsonb, p_expected_adjustments jsonb,
  p_base_amount numeric, p_before_amount numeric, p_after_amount numeric,
  p_reason text
) returns public.zysyr_monthly_income_adjustments
language plpgsql security definer set search_path = ''
as $$
declare
  v_source jsonb; v_report uuid; v_label text; v_address text; v_kind text;
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
  else
    raise exception 'MONTHLY_ADJUSTMENT_SOURCE_INVALID';
  end if;
  if v_source is null then raise exception 'MONTHLY_ADJUSTMENT_SOURCE_NOT_FOUND'; end if;
  v_label := regexp_replace(coalesce(v_source->>'label',''),'[[:space:]]','','g');
  v_address := v_source->>'cell_address';
  v_kind := coalesce(v_source->>'cell_kind','');
  if v_label ~ '(编号|序号|员工号)'
    or v_label ~ '^(小计|合计|总计|盈亏)([/／·]|$)'
    or v_label ~ '^产品成本[/／·]产品进货([/／·]|$)'
    or not (
      v_label ~ '(^主营|美发收入|营业收入|产品收入|其他收入|总收入)'
      or v_label ~ '(^技术人员|^后勤|^发型师[/／·]|^人工[/／·]|工资|底薪|提成|饭补|薪酬|社保)'
      or (v_kind='formula' and v_label ~ '(房租|物业|广告|空调|水费|电费|煤气|电话|宽带|采购|进货|产品成本|产品消耗|零售产品成本|市场|备用金|保险|税|手续费|宿舍|培训|维修|聚餐|杂项|支出|费用|鲜花)')
    ) then
    raise exception 'MONTHLY_ADJUSTMENT_TARGET_READ_ONLY';
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
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','monthly_value_adjustment',v_saved.id,
    'monthly_value_adjustment',jsonb_build_object('amount',p_before_amount,'base_amount',p_base_amount,'label',v_label),
    to_jsonb(v_saved),btrim(p_reason),'financial');
  if v_unlock.id is not null then
    update public.zysyr_monthly_cell_unlock_requests set status='consumed',consumed_at=clock_timestamp()
    where company_id=p_company_id and id=v_unlock.id;
  end if;
  return v_saved;
end $$;

revoke execute on function public.zysyr_save_monthly_income_adjustment(
  uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text
) from public,anon,authenticated;
grant execute on function public.zysyr_save_monthly_income_adjustment(
  uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text
) to service_role;

comment on table public.zysyr_monthly_income_adjustments is
  'Append-only monthly value adjustments for editable report cells; source reports, formulas and vouchers remain immutable.';

-- A formula can still represent one editable expense row (for example a card
-- fee entered as several additions). Permit the finance user to waive evidence
-- for that one row, while keeping identifiers and every subtotal read-only.
create or replace function public.zysyr_save_business_evidence_rule(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_business_type text,
  p_business_id uuid,
  p_evidence_required boolean,
  p_reason text
)
returns public.zysyr_business_evidence_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_business_evidence_rules;
  v_saved public.zysyr_business_evidence_rules;
  v_exists boolean := false;
  v_history_type text;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if p_business_id is null
     or nullif(btrim(p_business_type), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'BUSINESS_EVIDENCE_RULE_INVALID';
  end if;

  if p_business_type in (
    'income_record', 'expense_record', 'petty_cash_record', 'salary',
    'goods_receipt', 'usage_record', 'employee_purchase'
  ) then
    v_exists := zysyr_private.business_record_exists(
      p_company_id, p_store_id, p_business_type, p_business_id
    );
  elsif p_business_type = 'daily_sheet' then
    select exists (
      select 1 from public.zysyr_daily_sheet_drafts record
      where record.company_id = p_company_id
        and record.store_id = p_store_id
        and record.id = p_business_id
    ) into v_exists;
  elsif p_business_type = 'report_cell' then
    select exists (
      select 1
      from public.zysyr_report_cells cell
      join public.zysyr_report_uploads report
        on report.company_id = cell.company_id
       and report.id = cell.report_id
      where cell.company_id = p_company_id
        and cell.store_id = p_store_id
        and cell.id = p_business_id
        and report.store_id = p_store_id
        and report.report_type = 'monthly_profit_loss'
        and coalesce(cell.label, '') !~ '(编号|序号|员工号)'
        and coalesce(cell.label, '') !~ '^[[:space:]]*(小计|合计|总计|盈亏)([[:space:]]*[/／·]|$)'
        and coalesce(cell.label, '') !~ '^产品成本[[:space:]]*[/／·][[:space:]]*产品进货([/／·]|$)'
    ) into v_exists;
  elsif p_business_type ~ '^history_[a-z_]{1,50}$' then
    v_history_type := substring(p_business_type from 9);
    select exists (
      select 1 from public.zysyr_history_ledger_entries record
      where record.company_id = p_company_id
        and record.store_id = p_store_id
        and record.id = p_business_id
        and record.entry_type = v_history_type
        and record.status = 'posted'
    ) into v_exists;
  end if;
  if not v_exists then
    raise exception using errcode = 'P0002', message = 'BUSINESS_EVIDENCE_RECORD_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' ||
    p_business_type || ':' || p_business_id::text, 0
  ));
  select * into v_before
  from public.zysyr_business_evidence_rules rule_row
  where rule_row.company_id = p_company_id
    and rule_row.store_id = p_store_id
    and rule_row.business_type = p_business_type
    and rule_row.business_id = p_business_id
  for update;

  insert into public.zysyr_business_evidence_rules (
    company_id, store_id, business_type, business_id, evidence_policy,
    reason, updated_by_user_id
  ) values (
    p_company_id, p_store_id, p_business_type, p_business_id,
    case when p_evidence_required then 'voucher_required' else 'none' end,
    btrim(p_reason), p_actor_user_id
  )
  on conflict (company_id, store_id, business_type, business_id)
  do update set
    evidence_policy = excluded.evidence_policy,
    reason = excluded.reason,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = clock_timestamp()
  returning * into v_saved;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    p_business_type, p_business_id, 'save_evidence_requirement',
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_saved), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

revoke execute on function public.zysyr_save_business_evidence_rule(
  uuid, uuid, uuid, text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.zysyr_save_business_evidence_rule(
  uuid, uuid, uuid, text, uuid, boolean, text
) to service_role;
