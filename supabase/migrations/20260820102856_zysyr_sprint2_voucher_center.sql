-- ZYSYR V2 Sprint 2: first-class voucher center, OCR candidate lifecycle,
-- human review, duplicate protection and audited report linkage.
-- OCR output remains candidate data. This migration does not create approved
-- income, expense, payroll or inventory facts.

set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.zysyr_voucher_attachments
  alter column record_id drop not null,
  add column if not exists ocr_status text not null default 'pending',
  add column if not exists audit_status text not null default 'pending',
  add column if not exists document_type text not null default 'unclassified',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid;

alter table public.zysyr_voucher_attachments
  drop constraint if exists zysyr_voucher_attachments_record_type_check;
alter table public.zysyr_voucher_attachments
  add constraint zysyr_voucher_attachments_record_type_check
  check (record_type in ('unassigned', 'expense', 'income', 'report'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_ocr_status_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_ocr_status_check
      check (ocr_status in ('pending', 'processing', 'reviewed', 'failed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_audit_status_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_audit_status_check
      check (audit_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_document_type_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_document_type_check
      check (document_type in (
        'unclassified', 'daily_report', 'performance_report', 'expense',
        'purchase', 'salary', 'petty_cash', 'attendance_check', 'payment', 'other'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_review_state_check'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_review_state_check
      check (
        (audit_status = 'pending' and reviewed_at is null and reviewed_by_user_id is null)
        or (audit_status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by_user_id is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_reviewer_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_reviewer_fkey
      foreign key (company_id, reviewed_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'zysyr_voucher_attachments_updated_by_fkey'
      and conrelid = 'public.zysyr_voucher_attachments'::regclass
  ) then
    alter table public.zysyr_voucher_attachments
      add constraint zysyr_voucher_attachments_updated_by_fkey
      foreign key (company_id, updated_by_user_id)
      references public.zysyr_user_accounts(company_id, id) on delete restrict;
  end if;
end $$;

create index if not exists zysyr_voucher_attachments_review_queue_idx
  on public.zysyr_voucher_attachments
  (company_id, store_id, audit_status, uploaded_at desc)
  where company_id is not null;
create index if not exists zysyr_voucher_attachments_reviewer_idx
  on public.zysyr_voucher_attachments (company_id, reviewed_by_user_id, reviewed_at desc)
  where reviewed_by_user_id is not null;
create index if not exists zysyr_voucher_attachments_updated_by_idx
  on public.zysyr_voucher_attachments (company_id, updated_by_user_id)
  where updated_by_user_id is not null;

create table public.zysyr_voucher_ocr_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  voucher_id uuid not null,
  provider text not null default 'pending_provider',
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 1 check (attempt > 0),
  raw_result jsonb,
  candidate_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(candidate_fields) = 'object'),
  field_confidences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_confidences) = 'object'),
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid not null,
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (completed_at is null or completed_at >= queued_at)
);

create index zysyr_voucher_ocr_tasks_queue_idx
  on public.zysyr_voucher_ocr_tasks (status, queued_at, id)
  where status in ('queued', 'processing');
create index zysyr_voucher_ocr_tasks_voucher_idx
  on public.zysyr_voucher_ocr_tasks (company_id, voucher_id, attempt desc);
create index zysyr_voucher_ocr_tasks_store_idx
  on public.zysyr_voucher_ocr_tasks (company_id, store_id, queued_at desc);
create index zysyr_voucher_ocr_tasks_creator_idx
  on public.zysyr_voucher_ocr_tasks (company_id, created_by_user_id);

create table public.zysyr_voucher_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  voucher_id uuid not null,
  review_version integer not null check (review_version > 0),
  decision text not null check (decision in ('approved', 'rejected')),
  document_type text not null check (document_type in (
    'daily_report', 'performance_report', 'expense', 'purchase', 'salary',
    'petty_cash', 'attendance_check', 'payment', 'other'
  )),
  candidate_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(candidate_fields) = 'object'),
  corrected_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(corrected_fields) = 'object'),
  field_confidences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_confidences) = 'object'),
  reason text not null check (nullif(btrim(reason), '') is not null),
  reviewer_user_id uuid not null,
  reviewed_at timestamptz not null default now(),
  unique (company_id, voucher_id, review_version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, reviewer_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_voucher_reviews_store_idx
  on public.zysyr_voucher_reviews (company_id, store_id, reviewed_at desc);
create index zysyr_voucher_reviews_reviewer_idx
  on public.zysyr_voucher_reviews (company_id, reviewer_user_id, reviewed_at desc);

insert into public.zysyr_capabilities (code, name, risk_level)
values ('voucher.review', '人工审核凭证与OCR候选字段', 'high')
on conflict (code) do update
set name = excluded.name,
    risk_level = excluded.risk_level,
    updated_at = now();

insert into public.zysyr_role_capabilities (role_id, capability_id)
select role.id, capability.id
from public.zysyr_roles role
join public.zysyr_capabilities capability on capability.code = 'voucher.review'
where role.code = 'finance'
on conflict (role_id, capability_id) do nothing;

create or replace function zysyr_private.account_is_finance_in_scope(
  target_user_account_id uuid,
  target_company_id uuid,
  target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_account_id is not null
    and target_company_id is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.zysyr_user_accounts account
      join public.zysyr_user_role_grants grant_row
        on grant_row.user_account_id = account.id
       and grant_row.company_id = account.company_id
      join public.zysyr_roles role on role.id = grant_row.role_id
      where account.id = target_user_account_id
        and account.company_id = target_company_id
        and account.status = 'active'
        and role.code = 'finance'
        and grant_row.revoked_at is null
        and grant_row.valid_from <= current_date
        and (grant_row.valid_to is null or grant_row.valid_to >= current_date)
        and (
          grant_row.scope_type = 'company'
          or (grant_row.scope_type = 'store' and grant_row.store_id = target_store_id)
        )
    )
$$;

revoke execute on function zysyr_private.account_is_finance_in_scope(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function zysyr_private.prevent_voucher_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'VOUCHER_REVIEW_HISTORY_IMMUTABLE';
end
$$;

revoke execute on function zysyr_private.prevent_voucher_review_mutation()
  from public, anon, authenticated, service_role;

create trigger zysyr_voucher_reviews_immutable
before update or delete on public.zysyr_voucher_reviews
for each row execute function zysyr_private.prevent_voucher_review_mutation();

create or replace function public.zysyr_register_voucher(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_id uuid,
  p_record_type text,
  p_record_id uuid,
  p_object_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_note text
)
returns public.zysyr_voucher_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_name text;
  v_uploader text;
  v_voucher public.zysyr_voucher_attachments;
begin
  if not zysyr_private.account_is_finance_in_scope(
    p_actor_user_id, p_company_id, p_store_id
  ) or not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.upload'
  ) then
    raise exception using errcode = '42501', message = 'VOUCHER_UPLOAD_FORBIDDEN';
  end if;
  if p_record_type not in ('unassigned', 'report') then
    raise exception using errcode = '22023', message = 'VOUCHER_TARGET_TYPE_INVALID';
  end if;
  if (p_record_type = 'unassigned' and p_record_id is not null)
     or (p_record_type = 'report' and p_record_id is null) then
    raise exception using errcode = '22023', message = 'VOUCHER_TARGET_INVALID';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'application/pdf')
     or p_size_bytes <= 0 or p_size_bytes > 10485760
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(btrim(p_object_path), '') is null
     or nullif(btrim(p_original_filename), '') is null then
    raise exception using errcode = '22023', message = 'VOUCHER_FILE_INVALID';
  end if;

  select store.name into v_store_name
  from public.zysyr_stores store
  where store.id = p_store_id
    and store.company_id = p_company_id
    and store.status = 'active'
    and store.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'STORE_NOT_FOUND';
  end if;
  select coalesce(nullif(account.display_name, ''), account.login_name) into v_uploader
  from public.zysyr_user_accounts account
  where account.id = p_actor_user_id and account.company_id = p_company_id;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_sha256, 0));
  if exists (
    select 1 from public.zysyr_voucher_attachments existing
    where existing.company_id = p_company_id and existing.sha256 = p_sha256
  ) then
    raise exception using errcode = '23505', message = 'VOUCHER_DUPLICATE_FILE';
  end if;
  if p_record_type = 'report' and not exists (
    select 1 from public.zysyr_report_uploads report
    where report.id = p_record_id
      and report.company_id = p_company_id
      and report.store_id = p_store_id
  ) then
    raise exception using errcode = 'P0002', message = 'REPORT_NOT_FOUND';
  end if;

  insert into public.zysyr_voucher_attachments (
    id, company_id, store_id, store, record_type, record_id,
    bucket_id, object_path, original_filename, mime_type, size_bytes,
    sha256, immutable_version, note, uploaded_by, uploaded_by_user_id,
    updated_by_user_id
  ) values (
    p_id, p_company_id, p_store_id, v_store_name, p_record_type,
    case when p_record_id is null then null else p_record_id::text end,
    'zysyr-vouchers', btrim(p_object_path), btrim(p_original_filename),
    p_mime_type, p_size_bytes, p_sha256, 1, coalesce(btrim(p_note), ''),
    v_uploader, p_actor_user_id, p_actor_user_id
  ) returning * into v_voucher;

  insert into public.zysyr_voucher_ocr_tasks (
    company_id, store_id, voucher_id, created_by_user_id
  ) values (
    p_company_id, p_store_id, v_voucher.id, p_actor_user_id
  );

  if p_record_type = 'report' then
    insert into public.zysyr_voucher_links (
      company_id, store_id, voucher_id, business_type, business_id,
      relation_type, linked_by_user_id
    ) values (
      p_company_id, p_store_id, v_voucher.id, 'report_upload', p_record_id,
      'source_document', p_actor_user_id
    );
  end if;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'voucher_attachment', v_voucher.id, 'upload',
    jsonb_build_object(
      'id', v_voucher.id,
      'original_filename', v_voucher.original_filename,
      'mime_type', v_voucher.mime_type,
      'size_bytes', v_voucher.size_bytes,
      'sha256', v_voucher.sha256,
      'record_type', v_voucher.record_type,
      'record_id', v_voucher.record_id,
      'ocr_status', v_voucher.ocr_status,
      'audit_status', v_voucher.audit_status
    ), '财务上传原始凭证，进入OCR候选与人工审核队列。', 'financial'
  );
  return v_voucher;
end
$$;

create or replace function public.zysyr_review_voucher(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_decision text,
  p_document_type text,
  p_corrected_fields jsonb,
  p_field_confidences jsonb,
  p_report_ids uuid[],
  p_reason text
)
returns public.zysyr_voucher_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_voucher_attachments;
  v_after public.zysyr_voucher_attachments;
  v_task public.zysyr_voucher_ocr_tasks;
  v_candidate jsonb := '{}'::jsonb;
  v_confidences jsonb := '{}'::jsonb;
  v_review_version integer;
  v_report_ids uuid[] := array[]::uuid[];
begin
  if not zysyr_private.account_is_finance_in_scope(
    p_actor_user_id, p_company_id, p_store_id
  ) or not zysyr_private.account_has_capability(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.review'
  ) then
    raise exception using errcode = '42501', message = 'VOUCHER_REVIEW_FORBIDDEN';
  end if;
  if p_decision not in ('approved', 'rejected')
     or p_document_type not in (
       'daily_report', 'performance_report', 'expense', 'purchase', 'salary',
       'petty_cash', 'attendance_check', 'payment', 'other'
     )
     or jsonb_typeof(coalesce(p_corrected_fields, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_field_confidences, '{}'::jsonb)) <> 'object'
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'VOUCHER_REVIEW_INVALID';
  end if;

  select * into v_before
  from public.zysyr_voucher_attachments voucher
  where voucher.id = p_voucher_id
    and voucher.company_id = p_company_id
    and voucher.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'VOUCHER_NOT_FOUND';
  end if;

  select * into v_task
  from public.zysyr_voucher_ocr_tasks task
  where task.company_id = p_company_id and task.voucher_id = p_voucher_id
  order by task.attempt desc
  limit 1
  for update;
  if found then
    v_candidate := coalesce(v_task.candidate_fields, '{}'::jsonb);
    v_confidences := coalesce(p_field_confidences, v_task.field_confidences, '{}'::jsonb);
    if v_task.status in ('queued', 'processing') then
      update public.zysyr_voucher_ocr_tasks
      set status = 'cancelled',
          error_message = '人工复核已完成；本次未等待自动OCR。',
          completed_at = now()
      where id = v_task.id;
    end if;
  end if;

  select coalesce(
    array_agg(distinct requested.report_id order by requested.report_id),
    array[]::uuid[]
  )
  into v_report_ids
  from unnest(coalesce(p_report_ids, array[]::uuid[])) requested(report_id);

  if exists (
    select 1
    from unnest(v_report_ids) requested(report_id)
    where not exists (
      select 1 from public.zysyr_report_uploads report
      where report.id = requested.report_id
        and report.company_id = p_company_id
        and report.store_id = p_store_id
    )
  ) then
    raise exception using errcode = 'P0002', message = 'REPORT_NOT_FOUND';
  end if;

  update public.zysyr_voucher_links
  set unlinked_at = now(), unlink_reason = btrim(p_reason)
  where company_id = p_company_id
    and store_id = p_store_id
    and voucher_id = p_voucher_id
    and business_type = 'report_upload'
    and unlinked_at is null
    and not (business_id = any(v_report_ids));

  insert into public.zysyr_voucher_links (
    company_id, store_id, voucher_id, business_type, business_id,
    relation_type, linked_by_user_id
  )
  select
    p_company_id, p_store_id, p_voucher_id, 'report_upload', report_id,
    'source_document', p_actor_user_id
  from unnest(v_report_ids) requested(report_id)
  on conflict (company_id, voucher_id, business_type, business_id, relation_type)
    where unlinked_at is null do nothing;

  select coalesce(max(review.review_version), 0) + 1 into v_review_version
  from public.zysyr_voucher_reviews review
  where review.company_id = p_company_id and review.voucher_id = p_voucher_id;

  insert into public.zysyr_voucher_reviews (
    company_id, store_id, voucher_id, review_version, decision, document_type,
    candidate_fields, corrected_fields, field_confidences, reason,
    reviewer_user_id
  ) values (
    p_company_id, p_store_id, p_voucher_id, v_review_version, p_decision,
    p_document_type, v_candidate, coalesce(p_corrected_fields, '{}'::jsonb),
    v_confidences, btrim(p_reason), p_actor_user_id
  );

  update public.zysyr_voucher_attachments
  set ocr_status = 'reviewed',
      audit_status = p_decision,
      document_type = p_document_type,
      reviewed_at = now(),
      reviewed_by_user_id = p_actor_user_id,
      updated_at = now(),
      updated_by_user_id = p_actor_user_id,
      record_type = case when cardinality(v_report_ids) = 0 then 'unassigned' else 'report' end,
      record_id = case when cardinality(v_report_ids) = 0 then null else v_report_ids[1]::text end
  where id = p_voucher_id and company_id = p_company_id
  returning * into v_after;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'voucher_attachment', p_voucher_id, 'review',
    jsonb_build_object(
      'ocr_status', v_before.ocr_status,
      'audit_status', v_before.audit_status,
      'document_type', v_before.document_type,
      'record_type', v_before.record_type,
      'record_id', v_before.record_id
    ),
    jsonb_build_object(
      'ocr_status', v_after.ocr_status,
      'audit_status', v_after.audit_status,
      'document_type', v_after.document_type,
      'record_type', v_after.record_type,
      'record_id', v_after.record_id,
      'report_ids', to_jsonb(v_report_ids),
      'corrected_fields', coalesce(p_corrected_fields, '{}'::jsonb),
      'field_confidences', v_confidences,
      'review_version', v_review_version
    ), btrim(p_reason), 'financial'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_record_voucher_ocr_result(
  p_task_id uuid,
  p_provider text,
  p_succeeded boolean,
  p_raw_result jsonb,
  p_candidate_fields jsonb,
  p_field_confidences jsonb,
  p_error_message text
)
returns public.zysyr_voucher_ocr_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.zysyr_voucher_ocr_tasks;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_provider), '') is null
     or jsonb_typeof(coalesce(p_candidate_fields, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_field_confidences, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'OCR_RESULT_INVALID';
  end if;
  select * into v_task
  from public.zysyr_voucher_ocr_tasks task
  where task.id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'OCR_TASK_NOT_FOUND';
  end if;
  if v_task.status not in ('queued', 'processing') then
    raise exception using errcode = '55000', message = 'OCR_TASK_ALREADY_FINISHED';
  end if;

  update public.zysyr_voucher_ocr_tasks
  set provider = btrim(p_provider),
      status = case when p_succeeded then 'succeeded' else 'failed' end,
      raw_result = p_raw_result,
      candidate_fields = coalesce(p_candidate_fields, '{}'::jsonb),
      field_confidences = coalesce(p_field_confidences, '{}'::jsonb),
      error_message = nullif(btrim(p_error_message), ''),
      started_at = coalesce(started_at, now()),
      completed_at = now()
  where id = p_task_id
  returning * into v_task;

  update public.zysyr_voucher_attachments
  set ocr_status = case when p_succeeded then 'processing' else 'failed' end,
      updated_at = now(),
      updated_by_user_id = v_task.created_by_user_id
  where id = v_task.voucher_id and company_id = v_task.company_id;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, channel, entity_type, entity_id,
    action, after_json, reason, sensitivity
  ) values (
    v_task.company_id, v_task.store_id, 'system', 'api',
    'voucher_attachment', v_task.voucher_id, 'ocr_candidate_recorded',
    jsonb_build_object(
      'task_id', v_task.id,
      'provider', v_task.provider,
      'status', v_task.status,
      'candidate_fields', v_task.candidate_fields,
      'field_confidences', v_task.field_confidences
    ), case when p_succeeded then 'OCR候选字段已生成，等待财务人工复核。'
            else coalesce(nullif(btrim(p_error_message), ''), 'OCR识别失败。') end,
    'financial'
  );
  return v_task;
end
$$;

revoke execute on function public.zysyr_register_voucher(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text
) from public, anon, authenticated;
revoke execute on function public.zysyr_review_voucher(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid[], text
) from public, anon, authenticated;
revoke execute on function public.zysyr_record_voucher_ocr_result(
  uuid, text, boolean, jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.zysyr_register_voucher(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text
) to service_role;
grant execute on function public.zysyr_review_voucher(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid[], text
) to service_role;
grant execute on function public.zysyr_record_voucher_ocr_result(
  uuid, text, boolean, jsonb, jsonb, jsonb, text
) to service_role;

insert into public.zysyr_voucher_links (
  company_id, store_id, voucher_id, business_type, business_id,
  relation_type, linked_by_user_id, linked_at
)
select
  voucher.company_id, voucher.store_id, voucher.id, 'report_upload',
  case
    when voucher.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then voucher.record_id::uuid
  end,
  'source_document', voucher.uploaded_by_user_id,
  voucher.uploaded_at
from public.zysyr_voucher_attachments voucher
join public.zysyr_report_uploads report
  on report.id = case
    when voucher.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then voucher.record_id::uuid
  end
 and report.company_id = voucher.company_id
 and report.store_id = voucher.store_id
where voucher.record_type = 'report'
  and voucher.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and voucher.company_id is not null
  and voucher.store_id is not null
on conflict (company_id, voucher_id, business_type, business_id, relation_type)
  where unlinked_at is null do nothing;

alter table public.zysyr_voucher_attachments enable row level security;
alter table public.zysyr_voucher_attachments force row level security;
alter table public.zysyr_voucher_links enable row level security;
alter table public.zysyr_voucher_links force row level security;
alter table public.zysyr_voucher_ocr_tasks enable row level security;
alter table public.zysyr_voucher_ocr_tasks force row level security;
alter table public.zysyr_voucher_reviews enable row level security;
alter table public.zysyr_voucher_reviews force row level security;

drop policy if exists zysyr_voucher_attachments_scope_select on public.zysyr_voucher_attachments;
create policy zysyr_voucher_attachments_scope_select
on public.zysyr_voucher_attachments for select to authenticated
using (
  company_id is not null and store_id is not null
  and (select zysyr_private.has_capability(company_id, store_id, 'voucher.read'))
);
drop policy if exists zysyr_voucher_links_scope_select on public.zysyr_voucher_links;
create policy zysyr_voucher_links_scope_select
on public.zysyr_voucher_links for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'voucher.read')));
create policy zysyr_voucher_ocr_tasks_scope_select
on public.zysyr_voucher_ocr_tasks for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'voucher.read')));
create policy zysyr_voucher_reviews_scope_select
on public.zysyr_voucher_reviews for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'voucher.read')));

revoke all on table public.zysyr_voucher_attachments from public, anon, authenticated, service_role;
revoke all on table public.zysyr_voucher_links from public, anon, authenticated, service_role;
revoke all on table public.zysyr_voucher_ocr_tasks from public, anon, authenticated, service_role;
revoke all on table public.zysyr_voucher_reviews from public, anon, authenticated, service_role;
grant select on table
  public.zysyr_voucher_attachments,
  public.zysyr_voucher_links,
  public.zysyr_voucher_ocr_tasks,
  public.zysyr_voucher_reviews
to authenticated;
grant select, insert, update on table
  public.zysyr_voucher_attachments,
  public.zysyr_voucher_links,
  public.zysyr_voucher_ocr_tasks,
  public.zysyr_voucher_reviews
to service_role;

comment on table public.zysyr_voucher_ocr_tasks is
  'Provider-neutral OCR jobs. Raw output and confidence stay candidate-only until a finance review is appended.';
comment on table public.zysyr_voucher_reviews is
  'Immutable human review history. Approval confirms the voucher metadata only; Sprint 3 creates formal financial records.';
comment on function public.zysyr_register_voucher(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, bigint, text, text
) is 'Registers a private voucher, blocks duplicate bytes per company, queues OCR and writes an atomic audit event.';
comment on function public.zysyr_review_voucher(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid[], text
) is 'Appends a finance review with candidate/corrected fields and zero or more validated report links.';
