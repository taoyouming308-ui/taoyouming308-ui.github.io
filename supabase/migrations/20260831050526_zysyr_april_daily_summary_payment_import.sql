-- Source-backed April daily report totals and payment breakdown.
-- Values were transcribed from all 26 approved original daily-report photos,
-- cross-footed per day, and reconciled to the April monthly beauty income.
set statement_timeout = '60s';
set lock_timeout = '5s';

do $$
declare
  v_company_id constant uuid := '02463a53-dfdb-4291-b04d-dd1d85f9d998';
  v_store_id constant uuid := 'ea7e281f-a254-4664-bb03-cf1acf48d79d';
  v_item jsonb;
  v_draft public.zysyr_daily_sheet_drafts;
  v_actor uuid;
  v_cells jsonb;
  v_result jsonb;
  v_count integer;
  v_total numeric;
  v_monthly_income numeric;
  v_rows constant jsonb :=
  '[
    {"date":"2026-04-01","total":11838,"alipay":6940,"wechat":3611,"group_buy":1287},
    {"date":"2026-04-02","total":12307,"alipay":12007,"wechat":180,"group_buy":120},
    {"date":"2026-04-03","total":7465,"alipay":2870,"wechat":4296,"group_buy":299},
    {"date":"2026-04-04","total":4252,"alipay":380,"wechat":1977,"group_buy":1895},
    {"date":"2026-04-05","total":6875,"alipay":4784,"wechat":158,"group_buy":1933},
    {"date":"2026-04-07","total":11747,"alipay":6620,"wechat":3432,"group_buy":1695},
    {"date":"2026-04-08","total":9016,"alipay":6531,"wechat":1910,"group_buy":575},
    {"date":"2026-04-09","total":5376,"alipay":3335,"group_buy":2041},
    {"date":"2026-04-10","total":11745,"alipay":5800,"wechat":5182,"group_buy":763},
    {"date":"2026-04-11","total":19761,"cash":500,"alipay":9936,"wechat":4746,"group_buy":4579},
    {"date":"2026-04-12","total":19637,"alipay":16526,"wechat":910,"group_buy":2201},
    {"date":"2026-04-14","total":17261,"alipay":903,"wechat":7468,"group_buy":8890},
    {"date":"2026-04-15","total":3223,"private_qr":60,"alipay":906,"wechat":1248,"group_buy":1009},
    {"date":"2026-04-16","total":5646,"alipay":2276,"wechat":1880,"group_buy":1490},
    {"date":"2026-04-17","total":2050,"alipay":740,"wechat":244,"group_buy":1066},
    {"date":"2026-04-18","total":25328,"alipay":17735,"wechat":5469,"group_buy":2124},
    {"date":"2026-04-19","total":15311,"alipay":3440,"wechat":9340,"group_buy":2531},
    {"date":"2026-04-21","total":6395,"alipay":5430,"wechat":250,"group_buy":715},
    {"date":"2026-04-22","total":8687,"alipay":8036,"wechat":280,"group_buy":371},
    {"date":"2026-04-23","total":7639,"alipay":880,"wechat":5638,"group_buy":1121},
    {"date":"2026-04-24","total":16046,"alipay":11084,"wechat":4200,"group_buy":762},
    {"date":"2026-04-25","total":13884,"alipay":7235,"wechat":5110,"group_buy":1539},
    {"date":"2026-04-26","total":15088,"alipay":7689,"wechat":4792,"group_buy":2607},
    {"date":"2026-04-28","total":8876,"alipay":4709,"wechat":592,"group_buy":3575},
    {"date":"2026-04-29","total":12976,"alipay":8910,"wechat":1228,"group_buy":2838},
    {"date":"2026-04-30","total":12260,"alipay":5013,"wechat":4000,"group_buy":3247}
  ]'::jsonb;
begin
  select jsonb_array_length(v_rows), sum((item->>'total')::numeric)
  into v_count, v_total
  from jsonb_array_elements(v_rows) item;
  if v_count <> 26 or v_total <> 290689 then
    raise exception using errcode = '23514', message = 'APRIL_DAILY_SOURCE_TOTAL_PRECONDITION_FAILED';
  end if;

  select (current_payload->>'amount')::numeric into strict v_monthly_income
  from public.zysyr_history_ledger_entries
  where company_id = v_company_id and store_id = v_store_id
    and entry_type = 'monthly_profit_loss' and period_month = date '2026-04-01'
    and source_locator = '4月!C3' and status = 'posted';
  if v_monthly_income <> v_total then
    raise exception using errcode = '23514', message = 'APRIL_DAILY_MONTHLY_RECONCILIATION_FAILED';
  end if;

  select count(*) into v_count
  from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = v_company_id and draft.store_id = v_store_id
    and draft.report_date between date '2026-04-01' and date '2026-04-30'
    and draft.status = 'draft' and draft.source_voucher_id is not null;
  if v_count <> 26 then
    raise exception using errcode = '23514', message = 'APRIL_DAILY_DRAFT_COUNT_PRECONDITION_FAILED';
  end if;

  select count(*) into v_count
  from public.zysyr_daily_sheet_cells cell
  join public.zysyr_daily_sheet_drafts draft on draft.id = cell.draft_id
  where draft.company_id = v_company_id and draft.store_id = v_store_id
    and draft.report_date between date '2026-04-01' and date '2026-04-30'
    and cell.manual_override;
  if v_count <> 0 then
    raise exception using errcode = '23514', message = 'APRIL_DAILY_MANUAL_DATA_ALREADY_EXISTS';
  end if;

  for v_item in select value from jsonb_array_elements(v_rows) loop
    select * into strict v_draft
    from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = v_company_id and draft.store_id = v_store_id
      and draft.report_date = (v_item->>'date')::date
      and draft.status = 'draft' and draft.source_voucher_id is not null
    for update;
    v_actor := v_draft.created_by_user_id;

    v_cells := jsonb_build_array(
      jsonb_build_object('section_code','summary','row_key','summary','column_code','stylist_total','cell_role','summary_value','value',v_item->'total'),
      jsonb_build_object('section_code','summary','row_key','summary','column_code','actual_total','cell_role','summary_actual','value',v_item->'total'),
      jsonb_build_object('section_code','summary','row_key','summary','column_code','grand_total','cell_role','summary_grand','value',v_item->'total'),
      jsonb_build_object('section_code','payment','row_key','payment','column_code','cash_flow','cell_role','payment_cashflow','value',v_item->'total'),
      jsonb_build_object('section_code','payment','row_key','payment','column_code','total','cell_role','payment_total','value',v_item->'total')
    );
    if v_item ? 'cash' then v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','column_code','cash','cell_role','payment_method','value',v_item->'cash')); end if;
    if v_item ? 'private_qr' then v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','column_code','private_qr','cell_role','payment_method','value',v_item->'private_qr')); end if;
    if v_item ? 'alipay' then v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','column_code','alipay','cell_role','payment_method','value',v_item->'alipay')); end if;
    if v_item ? 'wechat' then v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','column_code','wechat','cell_role','payment_method','value',v_item->'wechat')); end if;
    if v_item ? 'group_buy' then v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','column_code','group_buy','cell_role','payment_method','value',v_item->'group_buy')); end if;

    v_result := public.zysyr_save_daily_sheet_cells(
      v_actor, v_company_id, v_store_id, v_draft.id, v_cells,
      '2026年4月原始日报照片人工逐张核对：录入支付方式、现金流和日报总额；员工项目明细继续复核'
    );
    if coalesce((v_result->>'changed_cells')::integer, 0) < 7 then
      raise exception using errcode = '23514', message = 'APRIL_DAILY_SAVE_RESULT_UNEXPECTED';
    end if;
  end loop;

  select count(*), sum(cell.corrected_numeric)
  into v_count, v_total
  from public.zysyr_daily_sheet_cells cell
  join public.zysyr_daily_sheet_drafts draft on draft.id = cell.draft_id
  where draft.company_id = v_company_id and draft.store_id = v_store_id
    and draft.report_date between date '2026-04-01' and date '2026-04-30'
    and cell.section_code = 'summary' and cell.row_key = 'summary'
    and cell.column_code = 'actual_total' and cell.manual_override;
  if v_count <> 26 or v_total <> 290689 then
    raise exception using errcode = '23514', message = 'APRIL_DAILY_POST_SAVE_RECONCILIATION_FAILED';
  end if;
end $$;
