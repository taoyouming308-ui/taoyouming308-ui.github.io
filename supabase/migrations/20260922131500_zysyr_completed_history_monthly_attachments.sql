set check_function_bodies = off;

create or replace function public.zysyr_attach_completed_history_monthly_evidence(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_period_month date,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_bucket_id text,
  p_object_path text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_history_import_evidence;
  v_link_count integer := 0;
  v_created boolean := false;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'report.upload'
  );

  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes not between 1 and 10485760
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(btrim(p_original_filename), '') is null
     or nullif(btrim(p_object_path), '') is null
     or nullif(btrim(p_reason), '') is null
     or p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception using errcode = '22023', message = 'HISTORY_MONTHLY_ATTACHMENT_INVALID';
  end if;

  if not exists (
    select 1
    from public.zysyr_history_import_batches batch
    where batch.company_id = p_company_id
      and batch.store_id = p_store_id
      and batch.id = p_import_batch_id
      and batch.import_type = 'monthly_profit_loss'
      and batch.status = 'completed'
      and p_period_month between batch.period_start and batch.period_end
  ) then
    raise exception using errcode = 'P0002', message = 'COMPLETED_HISTORY_MONTHLY_REPORT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.zysyr_history_ledger_entries entry
    where entry.company_id = p_company_id
      and entry.store_id = p_store_id
      and entry.import_batch_id = p_import_batch_id
      and entry.entry_type = 'monthly_profit_loss'
      and entry.period_month = p_period_month
      and entry.status = 'posted'
  ) then
    raise exception using errcode = 'P0002', message = 'POSTED_HISTORY_MONTHLY_REPORT_NOT_FOUND';
  end if;

  select evidence.* into v_saved
  from public.zysyr_history_import_evidence evidence
  where evidence.company_id = p_company_id
    and evidence.store_id = p_store_id
    and evidence.import_batch_id = p_import_batch_id
    and evidence.sha256 = p_sha256;

  if v_saved.id is not null and v_saved.period_month <> p_period_month then
    raise exception using errcode = '23505', message = 'HISTORY_MONTHLY_ATTACHMENT_ALREADY_USED_OTHER_MONTH';
  end if;

  if v_saved.id is null then
    insert into public.zysyr_history_import_evidence(
      company_id, store_id, import_batch_id, period_month, evidence_kind,
      original_filename, mime_type, size_bytes, sha256, bucket_id, object_path,
      embedded_asset_count, uploaded_by_user_id
    ) values (
      p_company_id, p_store_id, p_import_batch_id, p_period_month,
      'supporting_document', btrim(p_original_filename), p_mime_type,
      p_size_bytes, p_sha256, coalesce(nullif(btrim(p_bucket_id), ''), 'zysyr-reports'),
      btrim(p_object_path), case when p_mime_type like 'image/%' then 1 else 0 end,
      p_actor_user_id
    ) returning * into v_saved;
    v_created := true;
  end if;

  insert into public.zysyr_history_import_row_evidence(
    company_id, store_id, import_batch_id, import_row_id, evidence_id,
    source_locator, link_level, linked_by_user_id
  )
  select distinct entry.company_id, entry.store_id, entry.import_batch_id,
    entry.import_row_id, v_saved.id,
    'monthly-report:' || to_char(p_period_month, 'YYYY-MM'),
    'bundle_only', p_actor_user_id
  from public.zysyr_history_ledger_entries entry
  where entry.company_id = p_company_id
    and entry.store_id = p_store_id
    and entry.import_batch_id = p_import_batch_id
    and entry.entry_type = 'monthly_profit_loss'
    and entry.period_month = p_period_month
    and entry.status = 'posted'
    and entry.import_row_id is not null
  on conflict do nothing;
  get diagnostics v_link_count = row_count;

  if v_created or v_link_count > 0 then
    insert into public.zysyr_history_import_events(
      company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
    ) values (
      p_company_id, p_store_id, p_import_batch_id, 'evidence_upload',
      jsonb_build_object(
        'evidence_id', v_saved.id,
        'period_month', p_period_month,
        'filename', v_saved.original_filename,
        'sha256', v_saved.sha256,
        'link_level', 'bundle_only',
        'linked_row_count', v_link_count,
        'scope', 'completed_monthly_report'
      ),
      btrim(p_reason), p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'evidence', to_jsonb(v_saved),
    'linked_rows', v_link_count,
    'created', v_created,
    'formal_ledger_amount_changed', false
  );
end $$;

revoke execute on function public.zysyr_attach_completed_history_monthly_evidence(
  uuid, uuid, uuid, uuid, date, text, text, bigint, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.zysyr_attach_completed_history_monthly_evidence(
  uuid, uuid, uuid, uuid, date, text, text, bigint, text, text, text, text
) to service_role;

comment on function public.zysyr_attach_completed_history_monthly_evidence(
  uuid, uuid, uuid, uuid, date, text, text, bigint, text, text, text, text
) is 'Append a photo or PDF to one completed historical monthly report without changing posted ledger amounts.';
