-- ZYSYR v520: finance may review a monthly batch of receipt candidates and
-- atomically attach each approved receipt to exactly one current or historical
-- petty-cash item. No posted amount or imported source row is rewritten.
set statement_timeout = '120s';
set lock_timeout = '5s';

create or replace function public.zysyr_review_and_link_petty_cash_voucher(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_corrected_fields jsonb,
  p_field_confidences jsonb,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_voucher public.zysyr_voucher_attachments;
  v_reviewed public.zysyr_voucher_attachments;
  v_entry public.zysyr_history_ledger_entries;
  v_record public.zysyr_petty_cash_records;
  v_evidence public.zysyr_history_import_evidence;
  v_existing_target uuid;
  v_link_id uuid;
  v_target_month text;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.review'
  );
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if p_target_kind not in ('formal', 'history')
     or jsonb_typeof(coalesce(p_corrected_fields, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_field_confidences, '{}'::jsonb)) <> 'object'
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PETTY_BATCH_LINK_INVALID';
  end if;

  select voucher.* into v_voucher
  from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id
    and voucher.store_id = p_store_id
    and voucher.id = p_voucher_id
  for update;
  if v_voucher.id is null then
    raise exception using errcode = 'P0002', message = 'VOUCHER_NOT_FOUND';
  end if;
  if v_voucher.note not like 'petty_cash_batch|____-__|%' then
    raise exception using errcode = '22023', message = 'PETTY_BATCH_VOUCHER_REQUIRED';
  end if;
  if v_voucher.audit_status = 'rejected' then
    raise exception using errcode = '55000', message = 'VOUCHER_ALREADY_REJECTED';
  end if;

  if p_target_kind = 'formal' then
    select record.* into v_record
    from public.zysyr_petty_cash_records record
    where record.company_id = p_company_id
      and record.store_id = p_store_id
      and record.id = p_target_id
      and record.direction = 'outflow'
      and record.status = 'confirmed'
    for update;
    if v_record.id is null then
      raise exception using errcode = 'P0002', message = 'PETTY_CASH_TARGET_NOT_FOUND';
    end if;
    v_target_month := to_char(v_record.transaction_date, 'YYYY-MM');

    select link.business_id into v_existing_target
    from public.zysyr_voucher_links link
    where link.company_id = p_company_id and link.store_id = p_store_id
      and link.voucher_id = p_voucher_id and link.business_type = 'petty_cash_record'
      and link.unlinked_at is null
    order by link.linked_at limit 1;
    if v_existing_target is not null and v_existing_target <> p_target_id then
      raise exception using errcode = '23505', message = 'VOUCHER_ALREADY_LINKED_TO_OTHER_ITEM';
    end if;
  else
    select entry.* into v_entry
    from public.zysyr_history_ledger_entries entry
    where entry.company_id = p_company_id
      and entry.store_id = p_store_id
      and entry.id = p_target_id
      and entry.entry_type = 'petty_cash'
      and entry.status = 'posted'
    for update;
    if v_entry.id is null then
      raise exception using errcode = 'P0002', message = 'PETTY_CASH_TARGET_NOT_FOUND';
    end if;
    v_target_month := to_char(v_entry.period_month, 'YYYY-MM');

    select ledger.id into v_existing_target
    from public.zysyr_history_import_evidence evidence
    join public.zysyr_history_import_row_evidence row_link
      on row_link.company_id = evidence.company_id
     and row_link.store_id = evidence.store_id
     and row_link.evidence_id = evidence.id
     and row_link.link_level = 'page_confirmed'
    join public.zysyr_history_ledger_entries ledger
      on ledger.company_id = row_link.company_id
     and ledger.store_id = row_link.store_id
     and ledger.import_row_id = row_link.import_row_id
     and ledger.status = 'posted'
    where evidence.company_id = p_company_id and evidence.store_id = p_store_id
      and evidence.sha256 = v_voucher.sha256
    order by row_link.linked_at limit 1;
    if v_existing_target is not null and v_existing_target <> p_target_id then
      raise exception using errcode = '23505', message = 'VOUCHER_ALREADY_LINKED_TO_OTHER_ITEM';
    end if;
  end if;

  if split_part(v_voucher.note, '|', 2) <> v_target_month then
    raise exception using errcode = '22023', message = 'PETTY_BATCH_MONTH_MISMATCH';
  end if;

  if v_voucher.audit_status = 'pending' then
    v_reviewed := public.zysyr_review_voucher(
      p_actor_user_id, p_company_id, p_store_id, p_voucher_id,
      'approved', 'petty_cash', coalesce(p_corrected_fields, '{}'::jsonb),
      coalesce(p_field_confidences, '{}'::jsonb), array[]::uuid[], btrim(p_reason)
    );
  else
    v_reviewed := v_voucher;
    if v_reviewed.audit_status <> 'approved' or v_reviewed.document_type <> 'petty_cash' then
      raise exception using errcode = '55000', message = 'VOUCHER_REVIEW_STATE_INVALID';
    end if;
  end if;

  if p_target_kind = 'formal' then
    perform zysyr_private.link_finance_vouchers(
      p_actor_user_id, p_company_id, p_store_id, 'petty_cash_record',
      p_target_id, array[p_voucher_id], 'evidence', btrim(p_reason)
    );
    return jsonb_build_object(
      'voucher', to_jsonb(v_reviewed), 'target_kind', 'formal',
      'target_id', p_target_id, 'linked', true, 'amount_changed', false
    );
  end if;

  select evidence.* into v_evidence
  from public.zysyr_history_import_evidence evidence
  where evidence.company_id = p_company_id
    and evidence.store_id = p_store_id
    and evidence.import_batch_id = v_entry.import_batch_id
    and evidence.sha256 = v_reviewed.sha256;
  if v_evidence.id is null then
    insert into public.zysyr_history_import_evidence(
      company_id, store_id, import_batch_id, period_month, evidence_kind,
      original_filename, mime_type, size_bytes, sha256, bucket_id, object_path,
      embedded_asset_count, uploaded_by_user_id
    ) values (
      p_company_id, p_store_id, v_entry.import_batch_id, v_entry.period_month,
      'supporting_document', v_reviewed.original_filename, v_reviewed.mime_type,
      v_reviewed.size_bytes, v_reviewed.sha256, v_reviewed.bucket_id,
      v_reviewed.object_path, case when v_reviewed.mime_type like 'image/%' then 1 else 0 end,
      p_actor_user_id
    ) returning * into v_evidence;
  end if;

  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  ) select
    p_company_id, p_store_id, v_entry.import_batch_id, v_entry.import_row_id,
    v_evidence.id, 'voucher-center:' || p_voucher_id::text,
    'page_confirmed', p_actor_user_id
  where not exists (
    select 1
    from public.zysyr_history_import_row_evidence existing
    where existing.company_id = p_company_id
      and existing.store_id = p_store_id
      and existing.import_row_id = v_entry.import_row_id
      and existing.evidence_id = v_evidence.id
      and existing.link_level = 'page_confirmed'
  )
  on conflict do nothing returning id into v_link_id;

  if v_link_id is not null then
    insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, import_row_id, action,
      after_json, reason, actor_user_id
    ) values (
      p_company_id, p_store_id, v_entry.import_batch_id, v_entry.import_row_id,
      'evidence_link', jsonb_build_object(
        'evidence_id', v_evidence.id, 'voucher_id', p_voucher_id,
        'ledger_entry_id', v_entry.id, 'entry_type', 'petty_cash',
        'source_locator', 'voucher-center:' || p_voucher_id::text,
        'link_level', 'page_confirmed'
      ), btrim(p_reason), p_actor_user_id
    );
    insert into public.zysyr_audit_events(
      company_id, store_id, actor_type, actor_user_id, channel,
      entity_type, entity_id, action, after_json, reason, sensitivity
    ) values (
      p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
      'history_petty_cash', p_target_id, 'voucher_link',
      jsonb_build_object('voucher_id', p_voucher_id, 'evidence_id', v_evidence.id),
      btrim(p_reason), 'financial'
    );
  end if;

  return jsonb_build_object(
    'voucher', to_jsonb(v_reviewed), 'target_kind', 'history',
    'target_id', p_target_id, 'evidence_id', v_evidence.id,
    'linked', true, 'amount_changed', false
  );
end $$;

revoke execute on function public.zysyr_review_and_link_petty_cash_voucher(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.zysyr_review_and_link_petty_cash_voucher(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb, text
) to service_role;

comment on function public.zysyr_review_and_link_petty_cash_voucher(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb, text
) is 'Human-confirm one OCR candidate from a monthly petty-cash receipt batch and append its exact evidence link without changing finance amounts.';
