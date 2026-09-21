-- ZYSYR v518: keep mistaken daily-report uploads as immutable evidence while
-- excluding them from the active preview, recognition and formal posting path.

create table public.zysyr_daily_sheet_attachment_voids (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  daily_sheet_attachment_id uuid not null,
  voucher_id uuid not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  voided_by_user_id uuid not null,
  voided_at timestamptz not null default now(),
  unique (company_id, daily_sheet_attachment_id),
  unique (company_id, id),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, daily_sheet_attachment_id)
    references public.zysyr_daily_sheet_attachments(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, voided_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_daily_sheet_attachment_voids_draft_idx
  on public.zysyr_daily_sheet_attachment_voids
  (company_id, store_id, draft_id, voided_at desc);

alter table public.zysyr_daily_sheet_attachment_voids enable row level security;
alter table public.zysyr_daily_sheet_attachment_voids force row level security;

create policy zysyr_daily_sheet_attachment_voids_scope_select
  on public.zysyr_daily_sheet_attachment_voids for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_daily_sheet_attachment_voids
  from public, anon, authenticated, service_role;
grant select on table public.zysyr_daily_sheet_attachment_voids to authenticated;
grant select, insert on table public.zysyr_daily_sheet_attachment_voids to service_role;

create trigger zysyr_daily_sheet_attachment_voids_append_only
  before update or delete on public.zysyr_daily_sheet_attachment_voids
  for each row execute function zysyr_private.protect_report_trace_history();

create or replace function public.zysyr_void_daily_sheet_attachment(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_draft_id uuid,
  p_attachment_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_attachment public.zysyr_daily_sheet_attachments;
  v_voucher public.zysyr_voucher_attachments;
  v_void public.zysyr_daily_sheet_attachment_voids;
  v_replacement public.zysyr_voucher_attachments;
  v_previous_source_id uuid;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_ATTACHMENT_VOID_REASON_REQUIRED';
  end if;

  select * into v_draft
  from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id
    and draft.store_id = p_store_id
    and draft.id = p_draft_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;
  if v_draft.status <> 'draft' then
    raise exception using errcode = '55000', message = 'DAILY_ATTACHMENT_CONFIRMED_REQUIRES_REVERSAL';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_draft.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  select attachment.* into v_attachment
  from public.zysyr_daily_sheet_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.store_id = p_store_id
    and attachment.draft_id = p_draft_id
    and attachment.id = p_attachment_id
  for share;
  if not found or v_attachment.attachment_kind <> 'original_report' then
    raise exception using errcode = 'P0002', message = 'DAILY_ATTACHMENT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.zysyr_daily_sheet_attachment_voids existing
    where existing.company_id = p_company_id
      and existing.daily_sheet_attachment_id = p_attachment_id
  ) then
    raise exception using errcode = '55000', message = 'DAILY_ATTACHMENT_ALREADY_VOIDED';
  end if;

  select * into v_voucher
  from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id
    and voucher.store_id = p_store_id
    and voucher.id = v_attachment.voucher_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_ATTACHMENT_NOT_FOUND';
  end if;

  insert into public.zysyr_daily_sheet_attachment_voids(
    company_id, store_id, draft_id, daily_sheet_attachment_id, voucher_id,
    reason, voided_by_user_id
  ) values (
    p_company_id, p_store_id, p_draft_id, v_attachment.id, v_attachment.voucher_id,
    btrim(p_reason), p_actor_user_id
  ) returning * into v_void;

  v_previous_source_id := v_draft.source_voucher_id;
  if v_draft.source_voucher_id = v_attachment.voucher_id then
    select voucher.* into v_replacement
    from public.zysyr_daily_sheet_attachments attachment
    join public.zysyr_voucher_attachments voucher
      on voucher.company_id = attachment.company_id
     and voucher.store_id = attachment.store_id
     and voucher.id = attachment.voucher_id
    left join public.zysyr_daily_sheet_attachment_voids voided
      on voided.company_id = attachment.company_id
     and voided.daily_sheet_attachment_id = attachment.id
    where attachment.company_id = p_company_id
      and attachment.store_id = p_store_id
      and attachment.draft_id = p_draft_id
      and attachment.attachment_kind = 'original_report'
      and attachment.id <> p_attachment_id
      and voided.id is null
      and voucher.audit_status = 'approved'
      and voucher.document_type = 'daily_report'
    order by attachment.linked_at desc
    limit 1;

    update public.zysyr_daily_sheet_drafts
    set source_voucher_id = v_replacement.id,
        source_sha256 = v_replacement.sha256,
        updated_by_user_id = p_actor_user_id,
        updated_at = now()
    where company_id = p_company_id
      and store_id = p_store_id
      and id = p_draft_id;
  end if;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'daily_sheet_attachment', v_attachment.id, 'mark_mistaken_upload',
    jsonb_build_object(
      'draft_id', p_draft_id,
      'voucher_id', v_attachment.voucher_id,
      'filename', v_voucher.original_filename,
      'active_source_voucher_id', v_previous_source_id
    ),
    jsonb_build_object(
      'void_id', v_void.id,
      'voided', true,
      'active_source_voucher_id', v_replacement.id
    ),
    btrim(p_reason), 'financial'
  );

  return jsonb_build_object(
    'void', to_jsonb(v_void),
    'replacement_source_voucher_id', v_replacement.id,
    'original_preserved', true,
    'formal_ledger_written', false
  );
end
$$;

revoke execute on function public.zysyr_void_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.zysyr_void_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;

comment on table public.zysyr_daily_sheet_attachment_voids is
  'Append-only finance decisions marking an immutable daily-sheet attachment as a mistaken upload; the source file remains retained.';
comment on function public.zysyr_void_daily_sheet_attachment(
  uuid, uuid, uuid, uuid, uuid, text
) is 'Finance-only audited mistaken-upload action for an unconfirmed daily sheet; never deletes immutable source evidence.';
