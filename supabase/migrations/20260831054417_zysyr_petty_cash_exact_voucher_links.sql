-- Link each verifiable petty-cash row to the exact image inside its monthly DOCX bundle.
-- Three source rows have no dedicated original image and intentionally remain bundle-only:
-- 03!A14:H14, 04!A15:H15, 06!A15:H15.
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
  v_before integer;
  v_after integer;
begin
  select * into strict v_batch
  from public.zysyr_history_import_batches batch
  where batch.company_id = v_company_id and batch.store_id = v_store_id
    and batch.import_type = 'petty_cash' and batch.status = 'completed'
  for update;

  v_actor := coalesce(v_batch.confirmed_by_user_id, v_batch.created_by_user_id);
  if (
    select array_agg(evidence.embedded_asset_count order by evidence.period_month)
    from public.zysyr_history_import_evidence evidence
    where evidence.company_id = v_company_id and evidence.store_id = v_store_id
      and evidence.import_batch_id = v_batch.id
      and evidence.evidence_kind = 'voucher_bundle'
      and evidence.original_filename like '%备用金支出凭证%'
  ) <> array[23, 18, 18, 16, 17, 18] then
    raise exception using errcode = '23514', message = 'PETTY_SOURCE_IMAGE_COUNT_CHANGED';
  end if;
  select count(*) into v_before
  from public.zysyr_history_import_row_evidence link
  where link.company_id = v_company_id and link.store_id = v_store_id
    and link.import_batch_id = v_batch.id and link.link_level = 'page_confirmed';
  if v_before <> 0 then
    raise exception using errcode = '23514', message = 'PETTY_EXACT_LINKS_ALREADY_EXIST';
  end if;

  for v_item in
    with mapping as (
      select '01'::text sheet, 8 + image_no row_no, image_no from generate_series(1, 23) image_no
      union all select '02', 9 + image_no, image_no from generate_series(1, 18) image_no
      union all select '03', 8 + image_no, image_no from generate_series(1, 5) image_no
      union all select '03', 9 + image_no, image_no from generate_series(6, 18) image_no
      union all select '04', 8 + image_no, image_no from generate_series(1, 6) image_no
      union all select '04', 9 + image_no, image_no from generate_series(7, 15) image_no
      union all select '04', row_no, 16 from unnest(array[25, 26]) row_no
      union all select '05', 9 + image_no, image_no from generate_series(1, 17) image_no
      union all select '06', 8 + image_no, image_no from generate_series(1, 6) image_no
      union all select '06', 9 + image_no, image_no from generate_series(7, 18) image_no
    )
    select mapping.sheet, mapping.row_no, mapping.image_no
    from mapping order by mapping.sheet, mapping.row_no
  loop
    select row_item.id into strict v_row_id
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = v_company_id and row_item.store_id = v_store_id
      and row_item.import_batch_id = v_batch.id
      and row_item.source_locator = v_item.sheet || '!A' || v_item.row_no || ':H' || v_item.row_no;

    select evidence.id into strict v_evidence_id
    from public.zysyr_history_import_evidence evidence
    where evidence.company_id = v_company_id and evidence.store_id = v_store_id
      and evidence.import_batch_id = v_batch.id
      and evidence.period_month = ('2026-' || v_item.sheet || '-01')::date
      and evidence.evidence_kind = 'voucher_bundle'
      and evidence.original_filename like '%备用金支出凭证%';

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
        'link_level', 'page_confirmed'),
      '逐笔核对原始备用金 Excel 与 Word 凭证包，确认日期、金额及原图顺序后建立精确关联',
      v_actor
    );
  end loop;

  select count(*) into v_after
  from public.zysyr_history_import_row_evidence link
  where link.company_id = v_company_id and link.store_id = v_store_id
    and link.import_batch_id = v_batch.id and link.link_level = 'page_confirmed';
  if v_after <> 111 then
    raise exception using errcode = '23514', message = 'PETTY_EXACT_LINK_COUNT_MISMATCH';
  end if;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    v_company_id, v_store_id, 'user', v_actor, 'import',
    'history_import_batch', v_batch.id, 'evidence_link',
    jsonb_build_object('page_confirmed_links', v_before),
    jsonb_build_object('page_confirmed_links', v_after,
      'verified_rows', 111,
      'missing_exact_voucher_rows', jsonb_build_array('03!A14:H14', '04!A15:H15', '06!A15:H15')),
    '备用金逐笔原始凭证精确关联；仅写入人工核对确认的原图，三笔无单张原图继续标记缺失',
    'financial'
  );
end $$;
