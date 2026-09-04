-- Link only the monthly profit/loss cells that can be verified against an exact
-- image (or an exact group of images) inside the six original DOCX bundles.
-- Ambiguous, combined, cross-month and classification-conflicting images remain
-- bundle-only so the UI never presents an inferred voucher as exact evidence.
set statement_timeout = '60s';
set lock_timeout = '5s';

do $$
declare
  v_company_id constant uuid := '02463a53-dfdb-4291-b04d-dd1d85f9d998';
  v_store_id constant uuid := 'ea7e281f-a254-4664-bb03-cf1acf48d79d';
  v_batch public.zysyr_history_import_batches;
  v_actor uuid;
  v_item record;
  v_row_id uuid;
  v_evidence_id uuid;
  v_current_amount numeric;
  v_before integer;
  v_after integer;
begin
  select * into strict v_batch
  from public.zysyr_history_import_batches batch
  where batch.company_id = v_company_id and batch.store_id = v_store_id
    and batch.import_type = 'monthly_profit_loss' and batch.status = 'completed'
  for update;

  v_actor := coalesce(v_batch.confirmed_by_user_id, v_batch.created_by_user_id);
  if (
    select array_agg(evidence.embedded_asset_count order by evidence.period_month)
    from public.zysyr_history_import_evidence evidence
    where evidence.company_id = v_company_id and evidence.store_id = v_store_id
      and evidence.import_batch_id = v_batch.id
      and evidence.evidence_kind = 'voucher_bundle'
      and evidence.original_filename like '%盈亏表支出凭证%'
  ) <> array[40, 10, 14, 11, 11, 12] then
    raise exception using errcode = '23514', message = 'PROFIT_LOSS_SOURCE_IMAGE_COUNT_CHANGED';
  end if;

  select count(*) into v_before
  from public.zysyr_history_import_row_evidence link
  join public.zysyr_history_import_evidence evidence
    on evidence.company_id = link.company_id and evidence.store_id = link.store_id
   and evidence.id = link.evidence_id
  where link.company_id = v_company_id and link.store_id = v_store_id
    and link.import_batch_id = v_batch.id and link.link_level = 'page_confirmed'
    and evidence.original_filename like '%盈亏表支出凭证%';
  if v_before <> 0 then
    raise exception using errcode = '23514', message = 'PROFIT_LOSS_EXACT_LINKS_ALREADY_EXIST';
  end if;

  for v_item in
    select * from (values
      ('01', 'C18', 300.00::numeric, 2),
      ('01', 'C38', 4279.41::numeric, 12),
      ('02', 'C18', 300.00::numeric, 2),
      ('02', 'C28', 13728.00::numeric, 4),
      ('02', 'C35', 113.43::numeric, 9),
      ('02', 'C38', 1996.37::numeric, 10),
      ('03', 'C10', 139914.72::numeric, 1),
      ('03', 'C11', 6468.66::numeric, 2),
      ('03', 'C18', 300.00::numeric, 4),
      ('03', 'C33', 900.00::numeric, 9),
      ('03', 'C34', 49.90::numeric, 10),
      ('03', 'C38', 2204.19::numeric, 11),
      ('03', 'C50', 390.00::numeric, 13),
      ('03', 'C50', 390.00::numeric, 14),
      ('04', 'C15', 167.20::numeric, 2),
      ('04', 'C16', 3854.78::numeric, 2),
      ('04', 'C18', 300.00::numeric, 3),
      ('04', 'C38', 2700.00::numeric, 10),
      ('04', 'C43', 1300.00::numeric, 11),
      ('05', 'C18', 599.88::numeric, 1),
      ('05', 'C18', 599.88::numeric, 2),
      ('05', 'C38', 2820.00::numeric, 8),
      ('05', 'C43', 1300.00::numeric, 9),
      ('05', 'C50', 575.88::numeric, 10),
      ('05', 'C50', 575.88::numeric, 11),
      ('06', 'C10', 133914.72::numeric, 1),
      ('06', 'C15', 215.60::numeric, 3),
      ('06', 'C16', 3075.87::numeric, 3),
      ('06', 'C38', 1792.66::numeric, 8),
      ('06', 'C39', 2200.00::numeric, 9),
      ('06', 'C40', 5800.00::numeric, 10),
      ('06', 'C50', 500.00::numeric, 11),
      ('06', 'C50', 500.00::numeric, 12)
    ) as mapping(sheet, cell_address, expected_amount, image_no)
    order by mapping.sheet, mapping.cell_address, mapping.image_no
  loop
    select row_item.id into strict v_row_id
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = v_company_id and row_item.store_id = v_store_id
      and row_item.import_batch_id = v_batch.id
      and row_item.source_locator = ltrim(v_item.sheet, '0') || '月!' || v_item.cell_address;

    select (entry.current_payload ->> 'amount')::numeric into strict v_current_amount
    from public.zysyr_history_ledger_entries entry
    where entry.company_id = v_company_id and entry.store_id = v_store_id
      and entry.import_batch_id = v_batch.id and entry.import_row_id = v_row_id
      and entry.entry_type = 'monthly_profit_loss' and entry.status = 'posted';
    if v_current_amount is distinct from v_item.expected_amount then
      raise exception using errcode = '23514', message = 'PROFIT_LOSS_CELL_AMOUNT_CHANGED',
        detail = ltrim(v_item.sheet, '0') || '月!' || v_item.cell_address;
    end if;

    select evidence.id into strict v_evidence_id
    from public.zysyr_history_import_evidence evidence
    where evidence.company_id = v_company_id and evidence.store_id = v_store_id
      and evidence.import_batch_id = v_batch.id
      and evidence.period_month = ('2026-' || v_item.sheet || '-01')::date
      and evidence.evidence_kind = 'voucher_bundle'
      and evidence.original_filename like '%盈亏表支出凭证%';

    insert into public.zysyr_history_import_row_evidence(
      company_id, store_id, import_batch_id, import_row_id, evidence_id,
      source_locator, link_level, linked_by_user_id
    ) values (
      v_company_id, v_store_id, v_batch.id, v_row_id, v_evidence_id,
      'word/media/image' || v_item.image_no || '.jpeg', 'page_confirmed', v_actor
    );

    insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, import_row_id, action,
      after_json, reason, actor_user_id
    ) values (
      v_company_id, v_store_id, v_batch.id, v_row_id, 'evidence_link',
      jsonb_build_object('evidence_id', v_evidence_id,
        'source_locator', 'word/media/image' || v_item.image_no || '.jpeg',
        'link_level', 'page_confirmed', 'verified_amount', v_item.expected_amount),
      '逐张核对原始盈亏表支出凭证，只关联金额、项目及原图能够明确相互验证的资料',
      v_actor
    );
  end loop;

  select count(*) into v_after
  from public.zysyr_history_import_row_evidence link
  join public.zysyr_history_import_evidence evidence
    on evidence.company_id = link.company_id and evidence.store_id = link.store_id
   and evidence.id = link.evidence_id
  where link.company_id = v_company_id and link.store_id = v_store_id
    and link.import_batch_id = v_batch.id and link.link_level = 'page_confirmed'
    and evidence.original_filename like '%盈亏表支出凭证%';
  if v_after <> 33 then
    raise exception using errcode = '23514', message = 'PROFIT_LOSS_EXACT_LINK_COUNT_MISMATCH';
  end if;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    v_company_id, v_store_id, 'user', v_actor, 'import',
    'history_import_batch', v_batch.id, 'evidence_link',
    jsonb_build_object('page_confirmed_links', v_before),
    jsonb_build_object('page_confirmed_links', v_after,
      'verified_monthly_cells', 29, 'verified_original_images', 31,
      'source_bundle_images', 98,
      'kept_for_manual_review', 67,
      'classification_conflicts', jsonb_build_array(
        '3月!C40：原表列为美管加150，原图显示微信公众平台续费150，未做精确关联'
      )),
    '盈亏表支出凭证逐张核对；不明确、合并付款、跨月或分类冲突的原图继续保留整包待人工确认',
    'financial'
  );
end $$;
