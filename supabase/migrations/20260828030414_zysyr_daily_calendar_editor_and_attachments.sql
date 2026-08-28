-- ZYSYR v457: calendar-first editable daily sheets with immutable source attachments.
-- Formal values remain manual; uploaded files are evidence and never overwrite cells.
set statement_timeout = '30s';
set lock_timeout = '5s';

-- A calendar day may be created before its original report arrives.
alter table public.zysyr_daily_sheet_drafts
  alter column source_sha256 drop not null;

create or replace function zysyr_private.enforce_one_active_daily_sheet_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('draft', 'confirmed') and exists (
    select 1 from public.zysyr_daily_sheet_drafts existing
    where existing.company_id = new.company_id and existing.store_id = new.store_id
      and existing.report_date = new.report_date and existing.status in ('draft', 'confirmed')
      and existing.id <> new.id
  ) then
    raise exception using errcode = '23505', message = 'DAILY_SHEET_DATE_ALREADY_EXISTS';
  end if;
  return new;
end
$$;

revoke execute on function zysyr_private.enforce_one_active_daily_sheet_date()
  from public, anon, authenticated, service_role;

create trigger zysyr_daily_sheet_one_active_date
  before insert or update of company_id, store_id, report_date, status
  on public.zysyr_daily_sheet_drafts
  for each row execute function zysyr_private.enforce_one_active_daily_sheet_date();

alter table public.zysyr_voucher_attachments
  drop constraint if exists zysyr_voucher_attachments_mime_type_check;
alter table public.zysyr_voucher_attachments
  add constraint zysyr_voucher_attachments_mime_type_check check (mime_type in (
    'image/jpeg', 'image/png', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'zysyr-vouchers';

alter table public.zysyr_report_uploads
  drop constraint if exists zysyr_report_uploads_mime_type_check;
alter table public.zysyr_report_uploads
  add constraint zysyr_report_uploads_mime_type_check check (mime_type in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf', 'image/jpeg', 'image/png'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf', 'image/jpeg', 'image/png'
    ]
where id = 'zysyr-reports';

create table public.zysyr_daily_sheet_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  voucher_id uuid not null,
  attachment_kind text not null default 'original_report'
    check (attachment_kind in ('original_report', 'supporting_document')),
  note text not null default '',
  linked_by_user_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, draft_id, voucher_id),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, linked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_daily_sheet_attachments_draft_idx
  on public.zysyr_daily_sheet_attachments (company_id, store_id, draft_id, linked_at desc);
create index zysyr_daily_sheet_attachments_voucher_idx
  on public.zysyr_daily_sheet_attachments (company_id, voucher_id);

alter table public.zysyr_daily_sheet_attachments enable row level security;
alter table public.zysyr_daily_sheet_attachments force row level security;
create policy zysyr_daily_sheet_attachments_scope_select
  on public.zysyr_daily_sheet_attachments for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_daily_sheet_attachments from public, anon, authenticated, service_role;
grant select on table public.zysyr_daily_sheet_attachments to authenticated;
grant select, insert on table public.zysyr_daily_sheet_attachments to service_role;

create trigger zysyr_daily_sheet_attachments_append_only
  before update or delete on public.zysyr_daily_sheet_attachments
  for each row execute function zysyr_private.protect_report_trace_history();

create or replace function zysyr_private.enforce_daily_sheet_change_unlocked()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_report_date date;
begin
  select draft.report_date into v_report_date
  from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = new.company_id
    and draft.store_id = new.store_id
    and draft.id = new.draft_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;
  if zysyr_private.period_is_locked(new.company_id, new.store_id, v_report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;
  return new;
end
$$;

revoke execute on function zysyr_private.enforce_daily_sheet_change_unlocked()
  from public, anon, authenticated, service_role;

create trigger zysyr_daily_sheet_changes_require_unlocked
  before insert on public.zysyr_daily_sheet_cell_changes
  for each row execute function zysyr_private.enforce_daily_sheet_change_unlocked();

create or replace function zysyr_private.link_approved_daily_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.audit_status = 'approved' and new.document_type = 'daily_report'
     and (old.audit_status is distinct from new.audit_status
       or old.document_type is distinct from new.document_type) then
    update public.zysyr_daily_sheet_drafts draft
    set source_voucher_id = new.id,
        source_sha256 = new.sha256,
        updated_by_user_id = coalesce(new.reviewed_by_user_id, new.updated_by_user_id),
        updated_at = now()
    from public.zysyr_daily_sheet_attachments attachment
    where attachment.company_id = new.company_id
      and attachment.voucher_id = new.id
      and draft.company_id = attachment.company_id
      and draft.store_id = attachment.store_id
      and draft.id = attachment.draft_id
      and draft.status = 'draft'
      and draft.source_voucher_id is null;
  end if;
  return new;
end
$$;

revoke execute on function zysyr_private.link_approved_daily_attachment()
  from public, anon, authenticated, service_role;

create trigger zysyr_daily_attachment_review_link
  after update of audit_status, document_type on public.zysyr_voucher_attachments
  for each row execute function zysyr_private.link_approved_daily_attachment();

create or replace function public.zysyr_register_daily_sheet_attachment(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_draft_id uuid,
  p_voucher_id uuid,
  p_object_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_attachment_kind text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_store_name text;
  v_uploader text;
  v_is_finance boolean;
  v_voucher public.zysyr_voucher_attachments;
  v_link public.zysyr_daily_sheet_attachments;
begin
  perform zysyr_private.assert_daily_entry_scope(p_actor_user_id, p_company_id, p_store_id);
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'DAILY_SHEET_CANCELLED';
  end if;
  if p_mime_type not in (
      'image/jpeg', 'image/png', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) or p_size_bytes <= 0 or p_size_bytes > 10485760
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_object_path), '') is null
    or nullif(btrim(p_original_filename), '') is null
    or p_attachment_kind not in ('original_report', 'supporting_document') then
    raise exception using errcode = '22023', message = 'DAILY_ATTACHMENT_INVALID';
  end if;
  select store.name into v_store_name from public.zysyr_stores store
  where store.company_id = p_company_id and store.id = p_store_id
    and store.status = 'active' and store.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'STORE_NOT_FOUND'; end if;
  select coalesce(nullif(account.display_name, ''), account.login_name) into v_uploader
  from public.zysyr_user_accounts account
  where account.company_id = p_company_id and account.id = p_actor_user_id;
  v_is_finance := zysyr_private.account_is_finance_in_scope(p_actor_user_id, p_company_id, p_store_id)
    and zysyr_private.account_has_capability(p_actor_user_id, p_company_id, p_store_id, 'voucher.review');

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_sha256, 0));
  if exists (select 1 from public.zysyr_voucher_attachments existing
    where existing.company_id = p_company_id and existing.sha256 = p_sha256) then
    raise exception using errcode = '23505', message = 'VOUCHER_DUPLICATE_FILE';
  end if;

  insert into public.zysyr_voucher_attachments(
    id, company_id, store_id, store, record_type, record_id, bucket_id, object_path,
    original_filename, mime_type, size_bytes, sha256, immutable_version, note,
    uploaded_by, uploaded_by_user_id, ocr_status, audit_status, document_type,
    reviewed_at, reviewed_by_user_id, updated_by_user_id, updated_at
  ) values (
    p_voucher_id, p_company_id, p_store_id, v_store_name, 'unassigned', null,
    'zysyr-vouchers', btrim(p_object_path), btrim(p_original_filename), p_mime_type,
    p_size_bytes, p_sha256, 1, coalesce(btrim(p_note), ''), v_uploader,
    p_actor_user_id, 'reviewed', case when v_is_finance then 'approved' else 'pending' end,
    'daily_report', case when v_is_finance then now() else null end,
    case when v_is_finance then p_actor_user_id else null end, p_actor_user_id, now()
  ) returning * into v_voucher;

  if v_is_finance then
    insert into public.zysyr_voucher_reviews(
      company_id, store_id, voucher_id, review_version, decision, document_type,
      candidate_fields, corrected_fields, field_confidences, reason, reviewer_user_id
    ) values (
      p_company_id, p_store_id, v_voucher.id, 1, 'approved', 'daily_report',
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      coalesce(nullif(btrim(p_note), ''), '财务上传并确认当天原始日报'), p_actor_user_id
    );
  end if;

  insert into public.zysyr_daily_sheet_attachments(
    company_id, store_id, draft_id, voucher_id, attachment_kind, note, linked_by_user_id
  ) values (
    p_company_id, p_store_id, p_draft_id, v_voucher.id, p_attachment_kind,
    coalesce(btrim(p_note), ''), p_actor_user_id
  ) returning * into v_link;

  if v_is_finance and v_draft.source_voucher_id is null then
    update public.zysyr_daily_sheet_drafts
    set source_voucher_id = v_voucher.id, source_sha256 = v_voucher.sha256,
        updated_by_user_id = p_actor_user_id, updated_at = now()
    where id = v_draft.id;
  end if;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'daily_sheet_attachment', v_link.id, 'upload',
    jsonb_build_object('draft_id', p_draft_id, 'report_date', v_draft.report_date,
      'voucher_id', v_voucher.id, 'filename', v_voucher.original_filename,
      'mime_type', v_voucher.mime_type, 'sha256', v_voucher.sha256,
      'audit_status', v_voucher.audit_status, 'attachment_kind', p_attachment_kind),
    coalesce(nullif(btrim(p_note), ''), '上传并绑定原始日报附件'), 'financial'
  );
  return jsonb_build_object('attachment', to_jsonb(v_link), 'voucher', to_jsonb(v_voucher),
    'auto_approved', v_is_finance);
end
$$;

revoke execute on function public.zysyr_register_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.zysyr_register_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text
) to service_role;

comment on table public.zysyr_daily_sheet_attachments is
  'Append-only links from one electronic daily sheet to every retained original report or supporting file.';
comment on function public.zysyr_register_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text
) is 'Uploads a daily source file in store scope, preserves it as evidence, and never writes recognized values into formal cells.';
