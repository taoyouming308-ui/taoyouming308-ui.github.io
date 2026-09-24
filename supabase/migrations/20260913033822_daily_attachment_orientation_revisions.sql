-- Persist the display orientation of each immutable daily-report image.
-- The source object is never rewritten; every change appends a revision.
set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_daily_attachment_orientation_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  draft_id uuid not null,
  daily_sheet_attachment_id uuid not null,
  voucher_id uuid not null,
  revision integer not null check (revision > 0),
  supersedes_revision_id uuid,
  degrees smallint not null check (degrees in (0, 90, 180, 270)),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  changed_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, daily_sheet_attachment_id, revision),
  check ((revision = 1 and supersedes_revision_id is null)
    or (revision > 1 and supersedes_revision_id is not null)),
  foreign key (company_id, store_id, draft_id)
    references public.zysyr_daily_sheet_drafts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, daily_sheet_attachment_id)
    references public.zysyr_daily_sheet_attachments(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, supersedes_revision_id)
    references public.zysyr_daily_attachment_orientation_revisions(company_id, id) on delete restrict,
  foreign key (company_id, changed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_daily_attachment_orientation_latest_idx
  on public.zysyr_daily_attachment_orientation_revisions
  (company_id, store_id, daily_sheet_attachment_id, revision desc);

alter table public.zysyr_daily_attachment_orientation_revisions enable row level security;
alter table public.zysyr_daily_attachment_orientation_revisions force row level security;

create policy zysyr_daily_attachment_orientation_select
  on public.zysyr_daily_attachment_orientation_revisions for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_daily_attachment_orientation_revisions
  from public, anon, authenticated, service_role;
grant select on table public.zysyr_daily_attachment_orientation_revisions to authenticated;
grant select, insert on table public.zysyr_daily_attachment_orientation_revisions to service_role;

create trigger zysyr_daily_attachment_orientation_append_only
  before update or delete on public.zysyr_daily_attachment_orientation_revisions
  for each row execute function zysyr_private.protect_report_trace_history();

create or replace function public.zysyr_save_daily_attachment_orientation(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_draft_id uuid,
  p_attachment_id uuid,
  p_degrees smallint,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attachment public.zysyr_daily_sheet_attachments;
  v_voucher public.zysyr_voucher_attachments;
  v_previous public.zysyr_daily_attachment_orientation_revisions;
  v_saved public.zysyr_daily_attachment_orientation_revisions;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  perform zysyr_private.assert_daily_entry_scope(
    p_actor_user_id, p_company_id, p_store_id
  );
  if p_degrees not in (0, 90, 180, 270) or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode = '22023', message = 'DAILY_ATTACHMENT_ORIENTATION_INVALID';
  end if;

  select * into v_attachment
  from public.zysyr_daily_sheet_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.store_id = p_store_id
    and attachment.draft_id = p_draft_id
    and attachment.id = p_attachment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_ATTACHMENT_NOT_FOUND';
  end if;

  select * into v_voucher
  from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id
    and voucher.store_id = p_store_id
    and voucher.id = v_attachment.voucher_id;
  if not found or v_voucher.mime_type not in ('image/jpeg', 'image/png') then
    raise exception using errcode = '22023', message = 'DAILY_ATTACHMENT_NOT_IMAGE';
  end if;

  select * into v_previous
  from public.zysyr_daily_attachment_orientation_revisions revision
  where revision.company_id = p_company_id
    and revision.store_id = p_store_id
    and revision.daily_sheet_attachment_id = p_attachment_id
  order by revision.revision desc
  limit 1;

  if found and v_previous.degrees = p_degrees then
    return to_jsonb(v_previous);
  end if;

  insert into public.zysyr_daily_attachment_orientation_revisions(
    company_id, store_id, draft_id, daily_sheet_attachment_id, voucher_id,
    revision, supersedes_revision_id, degrees, reason, changed_by_user_id
  ) values (
    p_company_id, p_store_id, p_draft_id, p_attachment_id, v_attachment.voucher_id,
    coalesce(v_previous.revision, 0) + 1, v_previous.id, p_degrees, v_reason, p_actor_user_id
  ) returning * into v_saved;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'daily_sheet_attachment_orientation', v_saved.id, 'save_orientation',
    case when v_previous.id is null then null else jsonb_build_object(
      'revision', v_previous.revision, 'degrees', v_previous.degrees
    ) end,
    jsonb_build_object(
      'draft_id', p_draft_id, 'attachment_id', p_attachment_id,
      'voucher_id', v_attachment.voucher_id, 'revision', v_saved.revision,
      'degrees', v_saved.degrees, 'source_object_unchanged', true
    ),
    v_reason, 'financial'
  );
  return to_jsonb(v_saved);
end
$$;

revoke execute on function public.zysyr_save_daily_attachment_orientation(
  uuid, uuid, uuid, uuid, uuid, smallint, text
) from public, anon, authenticated, service_role;
grant execute on function public.zysyr_save_daily_attachment_orientation(
  uuid, uuid, uuid, uuid, uuid, smallint, text
) to service_role;

comment on table public.zysyr_daily_attachment_orientation_revisions is
  'Append-only display-orientation revisions for immutable daily-report images.';
comment on function public.zysyr_save_daily_attachment_orientation(
  uuid, uuid, uuid, uuid, uuid, smallint, text
) is 'Saves one image display direction without rewriting the original evidence object.';
