-- Link a verified archive object in place. No storage, OCR, cell, or ledger writes.
create function public.zysyr_bind_daily_archived_original(
 p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
 p_report_date date,p_expected_revision integer,p_archive_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 d public.zysyr_daily_sheet_drafts;
 a public.zysyr_daily_original_reservations;
 registration jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role'
  or p_actor_user_id is null or p_company_id is null or p_store_id is null then
  raise exception using errcode='42501',message='DAILY_ARCHIVE_BIND_FORBIDDEN';
 end if;
 if p_draft_id is null or p_report_date is null or p_archive_request_id is null
  or p_expected_revision is null or p_expected_revision not between 0 and 2147483646 then
  raise exception using errcode='22023',message='DAILY_ARCHIVE_BIND_INVALID';
 end if;
 perform zysyr_private.assert_daily_entry_scope(p_actor_user_id,p_company_id,p_store_id);
 if not (zysyr_private.account_is_finance_in_scope(p_actor_user_id,p_company_id,p_store_id)
  and zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'daily_report.write')
  and zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'voucher.review')) then
  raise exception using errcode='42501',message='DAILY_ARCHIVE_BIND_FORBIDDEN';
 end if;
 -- Same request lock as independent archive void; never resurrect a voided source.
 perform pg_advisory_xact_lock(hashtextextended(p_archive_request_id::text,0));
 select * into a from public.zysyr_daily_original_reservations
 where request_id=p_archive_request_id and company_id=p_company_id and store_id=p_store_id and report_date=p_report_date;
 if not found or a.object_path is distinct from
  format('%s/%s/daily-originals/%s/%s/%s',p_company_id,p_store_id,to_char(p_report_date,'YYYY-MM'),
   to_char(p_report_date,'YYYY-MM-DD'),p_archive_request_id)
  or coalesce(a.metadata->>'mime_type','') not in ('image/jpeg','image/png')
  or not exists(select 1 from public.zysyr_daily_original_completions where request_id=p_archive_request_id)
  or exists(select 1 from public.zysyr_daily_original_voids where request_id=p_archive_request_id) then
  raise exception using errcode='55000',message='DAILY_ARCHIVE_BIND_SOURCE_UNAVAILABLE';
 end if;
 select * into d from public.zysyr_daily_sheet_drafts
 where id=p_draft_id and company_id=p_company_id and store_id=p_store_id and report_date=p_report_date for update;
 if not found or d.status is distinct from 'draft' or d.edit_revision is distinct from p_expected_revision
  or d.source_voucher_id is not null then
  raise exception using errcode='55000',message='DAILY_ARCHIVE_BIND_DRAFT_CHANGED';
 end if;
 if zysyr_private.period_is_locked(p_company_id,p_store_id,p_report_date) then
  raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED';
 end if;
 if exists(select 1 from public.zysyr_daily_reports where company_id=p_company_id and store_id=p_store_id
       and report_date=p_report_date and status in ('submitted','approved','locked'))
  or exists(select 1 from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id
       and report_date=p_report_date and status='confirmed') then
  raise exception using errcode='55000',message='DAILY_ARCHIVE_BIND_DRAFT_CHANGED';
 end if;
 registration := public.zysyr_register_daily_sheet_attachment(p_actor_user_id,p_company_id,p_store_id,p_draft_id,
  a.request_id,a.object_path,a.metadata->>'original_filename',a.metadata->>'mime_type',
  (a.metadata->>'size_bytes')::bigint,a.metadata->>'sha256','original_report','财务预览确认绑定独立存档原图');
 if registration->'auto_approved' is distinct from 'true'::jsonb
  or registration#>>'{attachment,voucher_id}' is distinct from a.request_id::text then
  raise exception 'DAILY_ARCHIVE_BIND_REGISTRATION_FAILED';
 end if;
 update public.zysyr_daily_sheet_drafts set edit_revision=p_expected_revision+1
 where id=d.id and source_voucher_id=a.request_id and source_sha256=a.metadata->>'sha256';
 if not found then raise exception 'DAILY_ARCHIVE_BIND_REGISTRATION_FAILED'; end if;
 return jsonb_build_object('draft_id',d.id,'archive_request_id',a.request_id,
  'revision',p_expected_revision+1,'bound',true,'amounts_unchanged',true,'posted',false,'recognition_triggered',false);
end $$;
revoke all on function public.zysyr_bind_daily_archived_original(uuid,uuid,uuid,uuid,date,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.zysyr_bind_daily_archived_original(uuid,uuid,uuid,uuid,date,integer,uuid) to service_role;

-- Do not let archive-only void leave a draft pointing at an apparently valid but voided source.
-- The existing draft attachment void clears the primary source first and retains its audit.
create function zysyr_private.guard_daily_archive_void_while_bound()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists (
  select 1 from public.zysyr_daily_original_reservations a
  join public.zysyr_daily_sheet_drafts d on d.company_id=a.company_id and d.store_id=a.store_id
   and d.report_date=a.report_date and d.source_voucher_id=a.request_id and d.status='draft'
  join public.zysyr_voucher_attachments v on v.id=a.request_id and v.object_path=a.object_path
  where a.request_id=new.request_id
 ) then raise exception using errcode='55000',message='DAILY_ARCHIVE_BOUND_TO_DRAFT'; end if;
 return new;
end $$;
revoke all on function zysyr_private.guard_daily_archive_void_while_bound() from public,anon,authenticated,service_role;
create trigger daily_archive_void_while_bound before insert on public.zysyr_daily_original_voids
 for each row execute function zysyr_private.guard_daily_archive_void_while_bound();
