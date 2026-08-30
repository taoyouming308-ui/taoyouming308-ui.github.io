-- ZYSYR v462: human review is distinct from automatic validation.
-- Imported source data stays immutable; a finance reviewer confirms the
-- corrected snapshot cell-by-cell/row-by-row before a month or batch is ready.
set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.zysyr_history_import_rows
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed', 'needs_correction')),
  add column reviewed_by_user_id uuid,
  add column reviewed_at timestamptz,
  add column review_note text,
  add column reviewed_snapshot jsonb
    check (reviewed_snapshot is null or jsonb_typeof(reviewed_snapshot) = 'object'),
  add foreign key (company_id, reviewed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  add check (
    (review_status = 'pending' and reviewed_by_user_id is null and reviewed_at is null
      and review_note is null and reviewed_snapshot is null)
    or (review_status in ('confirmed', 'needs_correction')
      and reviewed_by_user_id is not null and reviewed_at is not null
      and nullif(btrim(review_note), '') is not null and reviewed_snapshot is not null)
  );

create index zysyr_history_import_rows_review_idx
  on public.zysyr_history_import_rows
  (company_id, store_id, import_batch_id, source_sheet, review_status, source_row_number);

create or replace function zysyr_private.reset_history_import_review_after_correction()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (
    new.corrected_json is distinct from old.corrected_json
    or new.validation_status is distinct from old.validation_status
    or new.validation_issues is distinct from old.validation_issues
  ) and new.review_status is not distinct from old.review_status then
    new.review_status := 'pending';
    new.reviewed_by_user_id := null;
    new.reviewed_at := null;
    new.review_note := null;
    new.reviewed_snapshot := null;
  end if;
  return new;
end $$;

revoke all on function zysyr_private.reset_history_import_review_after_correction()
  from public;

drop trigger if exists zysyr_history_import_rows_reset_review
  on public.zysyr_history_import_rows;
create trigger zysyr_history_import_rows_reset_review
before update of corrected_json, validation_status, validation_issues, review_status
on public.zysyr_history_import_rows
for each row execute function zysyr_private.reset_history_import_review_after_correction();

alter table public.zysyr_history_import_events
  drop constraint if exists zysyr_history_import_events_action_check;
alter table public.zysyr_history_import_events
  add constraint zysyr_history_import_events_action_check check (action in (
    'stage', 'row_correct', 'row_review', 'month_review',
    'evidence_upload', 'evidence_link', 'confirm',
    'import_start', 'row_import', 'row_fail', 'complete', 'cancel'
  ));

create or replace function public.zysyr_review_history_import_row(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_row_id uuid,
  p_corrected_json jsonb,
  p_review_status text,
  p_reason text
) returns public.zysyr_history_import_rows
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.zysyr_history_import_rows;
  v_after public.zysyr_history_import_rows;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if jsonb_typeof(p_corrected_json) <> 'object'
     or p_review_status not in ('confirmed', 'needs_correction')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_REVIEW_INVALID';
  end if;
  select row_item.* into v_before
  from public.zysyr_history_import_rows row_item
  join public.zysyr_history_import_batches batch
    on batch.company_id = row_item.company_id and batch.id = row_item.import_batch_id
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.id = p_import_row_id and batch.status = 'needs_review'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_ROW_NOT_REVIEWABLE';
  end if;

  update public.zysyr_history_import_rows set
    corrected_json = p_corrected_json,
    validation_status = case when p_review_status = 'confirmed' then 'valid' else 'warning' end,
    validation_issues = case when p_review_status = 'confirmed' then '[]'::jsonb else validation_issues end,
    review_status = p_review_status,
    reviewed_by_user_id = p_actor_user_id,
    reviewed_at = now(),
    review_note = btrim(p_reason),
    reviewed_snapshot = p_corrected_json,
    updated_at = now()
  where company_id = p_company_id and id = p_import_row_id
  returning * into v_after;

  update public.zysyr_history_import_batches batch set
    valid_row_count = counts.valid_count,
    warning_row_count = counts.warning_count,
    invalid_row_count = counts.invalid_count
  from (
    select count(*) filter (where validation_status = 'valid')::integer valid_count,
      count(*) filter (where validation_status = 'warning')::integer warning_count,
      count(*) filter (where validation_status = 'invalid')::integer invalid_count
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id
      and row_item.import_batch_id = v_after.import_batch_id
  ) counts
  where batch.company_id = p_company_id and batch.id = v_after.import_batch_id;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, import_row_id, action,
    before_json, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_after.import_batch_id, v_after.id, 'row_review',
    jsonb_build_object('review_status', v_before.review_status,
      'corrected_json', v_before.corrected_json),
    jsonb_build_object('review_status', v_after.review_status,
      'reviewed_snapshot', v_after.reviewed_snapshot),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_row', v_after.id, 'review',
    jsonb_build_object('review_status', v_before.review_status),
    jsonb_build_object('review_status', v_after.review_status,
      'source_locator', v_after.source_locator),
    btrim(p_reason), 'financial'
  );
  return v_after;
end $$;

create or replace function public.zysyr_confirm_history_import_month(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_period_month date,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_period_month)::date;
  v_total integer;
  v_confirmed integer;
  v_invalid integer;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_MONTH_REVIEW_REASON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.zysyr_history_import_batches batch
    where batch.company_id = p_company_id and batch.store_id = p_store_id
      and batch.id = p_import_batch_id and batch.status = 'needs_review'
      and v_month between batch.period_start and batch.period_end
  ) then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_MONTH_NOT_REVIEWABLE';
  end if;
  select count(*)::integer,
    count(*) filter (where validation_status = 'invalid')::integer
  into v_total, v_invalid
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and coalesce(row_item.corrected_json, row_item.mapped_json)->>'period_month'
      = to_char(v_month, 'YYYY-MM-DD');
  if v_total = 0 then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_MONTH_HAS_NO_ROWS';
  end if;
  if v_invalid > 0 then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_MONTH_HAS_INVALID_ROWS';
  end if;

  update public.zysyr_history_import_rows row_item set
    corrected_json = coalesce(row_item.corrected_json, row_item.mapped_json),
    validation_status = 'valid',
    validation_issues = '[]'::jsonb,
    review_status = 'confirmed',
    reviewed_by_user_id = p_actor_user_id,
    reviewed_at = now(),
    review_note = btrim(p_reason),
    reviewed_snapshot = coalesce(row_item.corrected_json, row_item.mapped_json),
    updated_at = now()
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and coalesce(row_item.corrected_json, row_item.mapped_json)->>'period_month'
      = to_char(v_month, 'YYYY-MM-DD');
  get diagnostics v_confirmed = row_count;

  update public.zysyr_history_import_batches batch set
    valid_row_count = counts.valid_count,
    warning_row_count = counts.warning_count,
    invalid_row_count = counts.invalid_count
  from (
    select count(*) filter (where validation_status = 'valid')::integer valid_count,
      count(*) filter (where validation_status = 'warning')::integer warning_count,
      count(*) filter (where validation_status = 'invalid')::integer invalid_count
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id
      and row_item.import_batch_id = p_import_batch_id
  ) counts
  where batch.company_id = p_company_id and batch.id = p_import_batch_id;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, 'month_review',
    jsonb_build_object('period_month', v_month, 'confirmed_rows', v_confirmed,
      'total_rows', v_total, 'review_mode', 'whole_source_sheet'),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_batch', p_import_batch_id, 'month_review',
    jsonb_build_object('period_month', v_month, 'confirmed_rows', v_confirmed,
      'review_mode', 'whole_source_sheet'),
    btrim(p_reason), 'financial'
  );
  return jsonb_build_object('period_month', v_month, 'confirmed_rows', v_confirmed,
    'total_rows', v_total, 'review_mode', 'whole_source_sheet',
    'formal_ledger_written', false);
end $$;

create or replace function public.zysyr_confirm_history_import(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_reason text
) returns public.zysyr_history_import_batches
language plpgsql security definer set search_path = '' as $$
declare v_batch public.zysyr_history_import_batches;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_IMPORT_CONFIRM_REASON_REQUIRED';
  end if;
  select * into v_batch from public.zysyr_history_import_batches batch
  where batch.company_id = p_company_id and batch.store_id = p_store_id
    and batch.id = p_import_batch_id and batch.status = 'needs_review'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_BATCH_NOT_REVIEWABLE';
  end if;
  if v_batch.invalid_row_count > 0 then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HAS_INVALID_ROWS';
  end if;
  if exists (
    select 1 from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.import_batch_id = p_import_batch_id
      and row_item.review_status <> 'confirmed'
  ) then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HUMAN_REVIEW_INCOMPLETE';
  end if;
  update public.zysyr_history_import_batches set
    status = 'ready', confirmed_by_user_id = p_actor_user_id,
    confirmed_at = now(), confirmation_reason = btrim(p_reason)
  where company_id = p_company_id and id = p_import_batch_id
  returning * into v_batch;
  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_batch.id, 'confirm',
    jsonb_build_object('status', v_batch.status,
      'human_review_complete', true, 'row_count', v_batch.raw_row_count),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_batch', v_batch.id, 'confirm',
    jsonb_build_object('status', v_batch.status, 'row_count', v_batch.raw_row_count,
      'human_review_complete', true), btrim(p_reason), 'financial'
  );
  return v_batch;
end $$;

revoke execute on function public.zysyr_review_history_import_row(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_confirm_history_import_month(
  uuid, uuid, uuid, uuid, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.zysyr_review_history_import_row(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to service_role;
grant execute on function public.zysyr_confirm_history_import_month(
  uuid, uuid, uuid, uuid, date, text
) to service_role;

comment on column public.zysyr_history_import_rows.review_status is
  'Finance human review state, independent from automatic parser validation.';
