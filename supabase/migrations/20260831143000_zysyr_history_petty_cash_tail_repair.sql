-- Repair 13 petty-cash tail rows omitted by the old ExcelJS actualRowCount boundary.
-- The source workbook remains unchanged and is identified by its immutable SHA-256.
set statement_timeout = '60s';
set lock_timeout = '5s';

do $$
declare
  v_company_id constant uuid := '02463a53-dfdb-4291-b04d-dd1d85f9d998';
  v_store_id constant uuid := 'ea7e281f-a254-4664-bb03-cf1acf48d79d';
  v_source_sha constant text := '0f08dd65042f6c4cb48fc7e3794a74ffadda9d86c58692ccdfeb768cba4d3d2d';
  v_batch public.zysyr_history_import_batches;
  v_actor uuid;
  v_item jsonb;
  v_raw jsonb;
  v_mapped jsonb;
  v_issues jsonb;
  v_status text;
  v_row_id uuid;
  v_ledger_id uuid;
  v_evidence_id uuid;
  v_before_count integer;
  v_after_count integer;
  v_rows constant jsonb :=
  '[
    {"sheet":"01","row":30,"title":"[ 太合中心店]  备用金 收支记录","date":"2026-01-30","sequence":"22","sequence_raw":"22","summary":"小白心里软","amount":39,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"01","row":31,"title":"[ 太合中心店]  备用金 收支记录","date":"2026-01-30","sequence":"23","sequence_raw":"23","summary":"吸管","amount":16.72,"category":"日用品","handled_by":"小爱","notes":null},
    {"sheet":"02","row":25,"title":"[太合中心店] 备用金 收支记录","date":"2026-02-25","sequence":"16","sequence_raw":"16","summary":"文件夹","amount":28.98,"category":"日用品","handled_by":"小爱","notes":null},
    {"sheet":"02","row":26,"title":"[太合中心店] 备用金 收支记录","date":"2026-02-27","sequence":"17","sequence_raw":"17","summary":"咖啡豆","amount":231.8,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"02","row":27,"title":"[太合中心店] 备用金 收支记录","date":"2026-02-28","sequence":"18","sequence_raw":"18","summary":"水","amount":30,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"03","row":26,"title":"[太合中心店]  备用金 收支记录","date":"2026-03-28","sequence":"18","sequence_raw":"18","summary":"矾根盆栽","amount":77.04,"category":"绿植","handled_by":"小爱","notes":null},
    {"sheet":"03","row":27,"title":"[太合中心店]  备用金 收支记录","date":"2026-03-29","sequence":"19","sequence_raw":"19","summary":"柠檬","amount":21.8,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"04","row":25,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-04-30","sequence":"16","sequence_raw":16,"summary":"水","amount":30,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"04","row":26,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-04-30","sequence":"8630","sequence_raw":8630,"summary":"除锈剂","amount":20,"category":"日用品","handled_by":"冰洲","notes":"小爱","warning":"sequence_unusual"},
    {"sheet":"05","row":25,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-05-27","sequence":"16","sequence_raw":"16","summary":"梅饼","amount":45.8,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"05","row":26,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-05-29","sequence":"17","sequence_raw":"17","summary":"水","amount":24,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"06","row":26,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-06-27","sequence":"17","sequence_raw":"17","summary":"海苔米饼","amount":18.81,"category":"食品","handled_by":"小爱","notes":null},
    {"sheet":"06","row":27,"title":"[太合中心店] 现金 / 备用金 收支记录","date":"2026-06-28","sequence":"18","sequence_raw":"18","summary":"水","amount":30,"category":"食品","handled_by":"小爱","notes":null}
  ]'::jsonb;
begin
  select * into strict v_batch
  from public.zysyr_history_import_batches batch
  where batch.company_id = v_company_id and batch.store_id = v_store_id
    and batch.import_type = 'petty_cash' and batch.source_sha256 = v_source_sha
    and batch.status = 'completed'
  for update;

  v_actor := coalesce(v_batch.confirmed_by_user_id, v_batch.created_by_user_id);
  select count(*) into v_before_count
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = v_company_id and row_item.store_id = v_store_id
    and row_item.import_batch_id = v_batch.id;
  if v_before_count <> 101 or v_batch.raw_row_count <> 101 or v_batch.imported_row_count <> 101 then
    raise exception using errcode = '23514', message = 'PETTY_CASH_TAIL_REPAIR_PRECONDITION_FAILED';
  end if;

  for v_item in select value from jsonb_array_elements(v_rows) loop
    if exists (
      select 1 from public.zysyr_history_import_rows row_item
      where row_item.company_id = v_company_id and row_item.store_id = v_store_id
        and row_item.import_batch_id = v_batch.id
        and row_item.source_locator = (v_item->>'sheet') || '!A' || (v_item->>'row') || ':H' || (v_item->>'row')
    ) then
      raise exception using errcode = '23505', message = 'PETTY_CASH_TAIL_ROW_ALREADY_EXISTS';
    end if;

    v_status := case when v_item ? 'warning' then 'warning' else 'valid' end;
    v_issues := case when v_item ? 'warning' then jsonb_build_array(jsonb_build_object(
      'code', 'sequence_unusual', 'field', 'source_sequence',
      'message', format('原表编号“%s”异常，已原样保留', v_item->>'sequence'), 'severity', 'warning'
    )) else '[]'::jsonb end;
    v_raw := jsonb_build_object(
      'cells', jsonb_build_array(
        jsonb_build_object('value', v_item->>'date', 'address', 'A' || (v_item->>'row'), 'formula', null),
        jsonb_build_object('value', v_item->'sequence_raw', 'address', 'B' || (v_item->>'row'), 'formula', null),
        jsonb_build_object('value', v_item->>'summary', 'address', 'C' || (v_item->>'row'), 'formula', null),
        jsonb_build_object('value', v_item->'amount', 'address', 'E' || (v_item->>'row'), 'formula', null),
        jsonb_build_object('value', v_item->>'category', 'address', 'F' || (v_item->>'row'), 'formula', null),
        jsonb_build_object('value', v_item->>'handled_by', 'address', 'G' || (v_item->>'row'), 'formula', null),
        case when v_item->>'notes' is null then null else jsonb_build_object('value', v_item->>'notes', 'address', 'H' || (v_item->>'row'), 'formula', null) end
      ),
      'row_number', (v_item->>'row')::integer,
      'sheet_name', v_item->>'sheet',
      'sheet_title', v_item->>'title'
    );
    -- Keep formula:null exactly like the original parser and remove only the
    -- optional H-cell placeholder when the source cell is blank.
    v_raw := jsonb_set(v_raw, '{cells}', (
      select jsonb_agg(cell)
      from jsonb_array_elements(v_raw->'cells') cell
      where cell <> 'null'::jsonb
    ));
    v_mapped := jsonb_build_object(
      'notes', v_item->'notes', 'amount', v_item->'amount', 'summary', v_item->>'summary',
      'category', v_item->>'category', 'direction', 'outflow',
      'period_month', left(v_item->>'date', 7) || '-01',
      'handled_by_name', v_item->>'handled_by', 'source_sequence', v_item->>'sequence',
      'transaction_date', v_item->>'date'
    );

    insert into public.zysyr_history_import_rows(
      company_id, store_id, import_batch_id, source_sheet, source_row_number,
      source_locator, row_hash, raw_json, mapped_json, validation_status,
      validation_issues, review_status
    ) values (
      v_company_id, v_store_id, v_batch.id, v_item->>'sheet', (v_item->>'row')::integer,
      (v_item->>'sheet') || '!A' || (v_item->>'row') || ':H' || (v_item->>'row'),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw::text, 'UTF8')), 'hex'),
      v_raw, v_mapped, v_status, v_issues, 'pending'
    ) returning id into v_row_id;

    insert into public.zysyr_history_ledger_entries(
      company_id, store_id, import_batch_id, import_row_id, entry_type,
      period_month, source_sheet, source_locator, source_row_hash,
      posted_payload, current_payload, posted_validation_status,
      posted_validation_issues, posted_review_status, posted_with_warning,
      posted_by_user_id, last_modified_by_user_id
    ) values (
      v_company_id, v_store_id, v_batch.id, v_row_id, 'petty_cash',
      (v_mapped->>'period_month')::date, v_item->>'sheet',
      (v_item->>'sheet') || '!A' || (v_item->>'row') || ':H' || (v_item->>'row'),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw::text, 'UTF8')), 'hex'),
      v_mapped, v_mapped, v_status, v_issues, 'pending', true, v_actor, v_actor
    ) returning id into v_ledger_id;

    insert into public.zysyr_history_ledger_revisions(
      company_id, store_id, ledger_entry_id, import_batch_id, import_row_id,
      version, action, before_payload, after_payload, reason, actor_user_id
    ) values (
      v_company_id, v_store_id, v_ledger_id, v_batch.id, v_row_id,
      1, 'post', null, v_mapped,
      '修复历史备用金导入尾部漏行；逐项对照原始 Excel', v_actor
    );

    update public.zysyr_history_import_rows set
      import_status = 'imported', target_business_type = 'history_ledger',
      target_business_id = v_ledger_id, imported_at = now(), updated_at = now()
    where company_id = v_company_id and store_id = v_store_id and id = v_row_id;

    select evidence.id into v_evidence_id
    from public.zysyr_history_import_evidence evidence
    where evidence.company_id = v_company_id and evidence.store_id = v_store_id
      and evidence.import_batch_id = v_batch.id
      and evidence.period_month = (v_mapped->>'period_month')::date
      and evidence.evidence_kind = 'voucher_bundle'
    order by evidence.uploaded_at desc limit 1;
    if v_evidence_id is not null then
      insert into public.zysyr_history_import_row_evidence(
        company_id, store_id, import_batch_id, import_row_id, evidence_id,
        source_locator, link_level, linked_by_user_id
      ) values (
        v_company_id, v_store_id, v_batch.id, v_row_id, v_evidence_id,
        'bundle:' || left(v_item->>'date', 7), 'bundle_only', v_actor
      );
    end if;

    insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, import_row_id, action,
      after_json, reason, actor_user_id
    ) values (
      v_company_id, v_store_id, v_batch.id, v_row_id, 'row_import',
      jsonb_build_object('target_business_type', 'history_ledger',
        'target_business_id', v_ledger_id, 'source_locator',
        (v_item->>'sheet') || '!A' || (v_item->>'row') || ':H' || (v_item->>'row')),
      '修复历史备用金导入尾部漏行；逐项对照原始 Excel', v_actor
    );
  end loop;

  select count(*) into v_after_count
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = v_company_id and row_item.store_id = v_store_id
    and row_item.import_batch_id = v_batch.id;
  if v_after_count <> 114 then
    raise exception using errcode = '23514', message = 'PETTY_CASH_TAIL_REPAIR_COUNT_MISMATCH';
  end if;

  execute 'alter table public.zysyr_history_import_batches disable trigger zysyr_history_import_batches_source_immutable';
  update public.zysyr_history_import_batches batch set
    raw_row_count = counts.total_count,
    valid_row_count = counts.valid_count,
    warning_row_count = counts.warning_count,
    invalid_row_count = counts.invalid_count,
    imported_row_count = counts.imported_count,
    preview_summary = batch.preview_summary || jsonb_build_object(
      'tail_row_repair', jsonb_build_object(
        'repaired_at', now(), 'source_sha256', v_source_sha,
        'previous_count', v_before_count, 'repaired_count', counts.total_count,
        'added_count', counts.total_count - v_before_count
      )
    )
  from (
    select count(*)::integer total_count,
      count(*) filter (where validation_status = 'valid')::integer valid_count,
      count(*) filter (where validation_status = 'warning')::integer warning_count,
      count(*) filter (where validation_status = 'invalid')::integer invalid_count,
      count(*) filter (where import_status = 'imported')::integer imported_count
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = v_company_id and row_item.store_id = v_store_id
      and row_item.import_batch_id = v_batch.id
  ) counts
  where batch.company_id = v_company_id and batch.store_id = v_store_id and batch.id = v_batch.id;
  execute 'alter table public.zysyr_history_import_batches enable trigger zysyr_history_import_batches_source_immutable';

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    v_company_id, v_store_id, 'user', v_actor, 'import',
    'history_import_batch', v_batch.id, 'formal_post',
    jsonb_build_object('raw_row_count', v_before_count),
    jsonb_build_object('raw_row_count', v_after_count, 'added_count', v_after_count - v_before_count,
      'source_sha256', v_source_sha, 'repair_kind', 'petty_cash_tail_rows'),
    '修复历史备用金导入尾部漏行；逐项对照原始 Excel', 'financial'
  );
end $$;
