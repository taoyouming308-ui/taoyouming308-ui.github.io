-- ZYSYR v478: let finance attach a new image/PDF directly to one posted
-- historical ledger cell. The original import, posted amount and earlier
-- evidence remain immutable; this only appends evidence and an exact link.
set statement_timeout = '120s';
set lock_timeout = '5s';

create or replace function public.zysyr_attach_history_ledger_evidence(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_ledger_entry_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_bucket_id text,
  p_object_path text,
  p_reason text
) returns public.zysyr_history_import_evidence
language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.zysyr_history_ledger_entries;
  v_saved public.zysyr_history_import_evidence;
  v_link_id uuid;
  v_new_evidence boolean := false;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );

  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes not between 1 and 10485760
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(btrim(p_original_filename), '') is null
     or nullif(btrim(p_object_path), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_LEDGER_EVIDENCE_INVALID';
  end if;

  select entry.* into v_entry
  from public.zysyr_history_ledger_entries entry
  where entry.company_id = p_company_id
    and entry.store_id = p_store_id
    and entry.id = p_ledger_entry_id
    and entry.entry_type = 'monthly_profit_loss'
    and entry.status = 'posted';
  if v_entry.id is null then
    raise exception using errcode = 'P0002', message = 'HISTORY_LEDGER_ENTRY_NOT_FOUND';
  end if;

  select evidence.* into v_saved
  from public.zysyr_history_import_evidence evidence
  where evidence.company_id = p_company_id
    and evidence.store_id = p_store_id
    and evidence.import_batch_id = v_entry.import_batch_id
    and evidence.sha256 = p_sha256;

  if v_saved.id is null then
    insert into public.zysyr_history_import_evidence(
      company_id, store_id, import_batch_id, period_month, evidence_kind,
      original_filename, mime_type, size_bytes, sha256, bucket_id, object_path,
      embedded_asset_count, uploaded_by_user_id
    ) values (
      p_company_id, p_store_id, v_entry.import_batch_id, v_entry.period_month,
      'supporting_document', btrim(p_original_filename), p_mime_type,
      p_size_bytes, p_sha256,
      coalesce(nullif(btrim(p_bucket_id), ''), 'zysyr-reports'),
      btrim(p_object_path), case when p_mime_type like 'image/%' then 1 else 0 end,
      p_actor_user_id
    ) on conflict do nothing
    returning * into v_saved;
    v_new_evidence := v_saved.id is not null;

    if v_saved.id is null then
      select evidence.* into v_saved
      from public.zysyr_history_import_evidence evidence
      where evidence.company_id = p_company_id
        and evidence.store_id = p_store_id
        and evidence.import_batch_id = v_entry.import_batch_id
        and evidence.sha256 = p_sha256;
    end if;

    if v_new_evidence then
      insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, import_row_id, action,
      after_json, reason, actor_user_id
      ) values (
      p_company_id, p_store_id, v_entry.import_batch_id, v_entry.import_row_id,
      'evidence_upload',
      jsonb_build_object(
        'evidence_id', v_saved.id,
        'ledger_entry_id', v_entry.id,
        'period_month', v_entry.period_month,
        'filename', v_saved.original_filename,
        'sha256', v_saved.sha256,
        'link_level', 'page_confirmed'
      ),
      btrim(p_reason), p_actor_user_id
      );
    end if;
  end if;

  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  ) values (
    p_company_id, p_store_id, v_entry.import_batch_id, v_entry.import_row_id,
    v_saved.id, 'manual-upload:' || left(p_sha256, 16), 'page_confirmed',
    p_actor_user_id
  ) on conflict do nothing
  returning id into v_link_id;

  if v_link_id is not null then
    insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, import_row_id, action,
      after_json, reason, actor_user_id
    ) values (
      p_company_id, p_store_id, v_entry.import_batch_id, v_entry.import_row_id,
      'evidence_link',
      jsonb_build_object(
        'evidence_id', v_saved.id,
        'ledger_entry_id', v_entry.id,
        'source_locator', 'manual-upload:' || left(p_sha256, 16),
        'link_level', 'page_confirmed',
        'new_evidence', v_new_evidence
      ),
      btrim(p_reason), p_actor_user_id
    );
  end if;

  return v_saved;
end $$;

revoke execute on function public.zysyr_attach_history_ledger_evidence(
  uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.zysyr_attach_history_ledger_evidence(
  uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text
) to service_role;

comment on function public.zysyr_attach_history_ledger_evidence(
  uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text
) is 'Append an exact finance-uploaded image/PDF to one posted historical ledger cell without rewriting the imported source or amount.';
