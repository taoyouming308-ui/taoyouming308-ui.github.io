-- Scoped production approval: confirmed-owner correction source review only.
-- No role, capability, table ACL/RLS, old proof, financial formula or existing RPC changes.
set lock_timeout='5s';
set statement_timeout='30s';

create or replace function zysyr_private.daily_correction_cash_review_is_current(
 p_company uuid,p_store uuid,p_draft uuid,p_context jsonb
) returns boolean language plpgsql volatile security definer set search_path='' as $owner_proof$
declare v_review record;
begin
 if coalesce((p_context->>'original_ready')::boolean,false) is not true
   or not exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft
     and d.company_id=p_company and d.store_id=p_store and d.status='confirmed') then return false;end if;
 for v_review in
   select r.* from zysyr_private.daily_cash_reviews r
   join public.zysyr_audit_events a on a.company_id=r.company_id and a.store_id=r.store_id
     and a.entity_type='daily_sheet_draft' and a.entity_id=r.draft_id
     and a.actor_user_id=r.reviewer_account_id and a.action='review_cash_sources_for_correction'
     and a.after_json->>'request_id'=r.request_id::text
     and a.after_json->>'cash_review_id'=r.id::text
     and a.after_json->>'edit_revision'=r.edit_revision::text
     and a.after_json->>'source_hash'=r.source_hash and a.after_json->>'cell_hash'=r.cell_hash
     and a.after_json->'reviewed_original'='true'::jsonb
     and a.after_json->'reviewed_channels'='true'::jsonb
     and a.after_json->'reviewed_card_sales'='true'::jsonb
   where r.company_id=p_company and r.store_id=p_store and r.draft_id=p_draft
     and r.edit_revision=(p_context->>'revision')::integer
     and r.source_hash=p_context->>'source_hash' and r.cell_hash=p_context->>'cell_hash'
 loop
   begin
     perform zysyr_private.assert_daily_correction_scope(v_review.reviewer_account_id,p_company,p_store);
   exception when insufficient_privilege then continue;end;
   if exists(select 1 from public.zysyr_user_accounts u where u.id=v_review.reviewer_account_id
     and u.company_id=p_company and u.auth_user_id=v_review.reviewer_auth_user_id and u.status='active') then return true;end if;
 end loop;
 return false;
end $owner_proof$;
revoke all on function zysyr_private.daily_correction_cash_review_is_current(uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role;

-- Preserve the exact finance branch; add only an audited confirmed-owner correction proof.
create or replace function zysyr_private.daily_cash_review_is_current(p_company uuid,p_store uuid,p_draft uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $review_current$
declare c jsonb;
begin
 c:=zysyr_private.daily_cash_review_context(p_company,p_store,p_draft);
 return coalesce((c->>'original_ready')::boolean,false) and (
   exists(select 1 from zysyr_private.daily_cash_reviews r where r.company_id=p_company and r.store_id=p_store
     and r.draft_id=p_draft and r.edit_revision=(c->>'revision')::integer and r.source_hash=c->>'source_hash'
     and r.cell_hash=c->>'cell_hash' and zysyr_private.daily_cash_reviewer_valid(r.reviewer_account_id,
       r.reviewer_auth_user_id,p_company,p_store))
   or zysyr_private.daily_correction_cash_review_is_current(p_company,p_store,p_draft,c));
end $review_current$;
revoke all on function zysyr_private.daily_cash_review_is_current(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;

create or replace function public.zysyr_correct_confirmed_daily_sheet_with_cash_review(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
  p_expected_revision integer,p_request_id uuid,p_cells jsonb,p_reason text,
  p_actor_auth_user_id uuid,p_cash_source_confirmation jsonb
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '5s' set statement_timeout = '20s' as $function$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_old_version public.zysyr_daily_sheet_versions;
  v_old_daily public.zysyr_daily_reports;
  v_source public.zysyr_report_uploads;
  v_date date; v_prior jsonb; v_saved jsonb; v_posted jsonb; v_hash text;
  v_before jsonb; v_display jsonb; v_report jsonb; v_new_revision integer; v_reversed integer;
  v_cash_before jsonb; v_cash_after jsonb; v_cash_review_id uuid;
begin
  perform zysyr_private.assert_daily_correction_scope(p_actor_user_id,p_company_id,p_store_id);
  if p_actor_auth_user_id is null or not exists(select 1 from public.zysyr_user_accounts u
    where u.id=p_actor_user_id and u.company_id=p_company_id and u.auth_user_id=p_actor_auth_user_id and u.status='active') then
    raise exception using errcode='42501',message='ADMIN_DAILY_CORRECTION_AUTH_FORBIDDEN';
  end if;
  if p_cash_source_confirmation is null or jsonb_typeof(p_cash_source_confirmation)<>'object'
    or p_cash_source_confirmation->>'statement' is distinct from 'owner-confirmed-cash-review-v1'
    or p_cash_source_confirmation->'reviewed_original' is distinct from 'true'::jsonb
    or p_cash_source_confirmation->'reviewed_channels' is distinct from 'true'::jsonb
    or p_cash_source_confirmation->'reviewed_card_sales' is distinct from 'true'::jsonb
    or not(coalesce(p_cash_source_confirmation->>'source_token','') ~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='DAILY_CORRECTION_CASH_CONSENT_REQUIRED';
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_request_id is null
    or p_cells is null or jsonb_typeof(p_cells)<>'array' or jsonb_array_length(p_cells) not between 1 and 1000
    or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception using errcode='22023',message='DAILY_CORRECTION_INPUT_INVALID';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('revision',p_expected_revision,'cells',p_cells,'reason',btrim(p_reason),'actor_auth',p_actor_auth_user_id,'cash_confirmation',p_cash_source_confirmation)::text,'UTF8')),'hex');
  select report_date into v_date from public.zysyr_daily_sheet_drafts
    where id=p_draft_id and company_id=p_company_id and store_id=p_store_id;
  if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  -- Lock in month -> draft -> report order, shared with the month rollup.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||date_trunc('month',v_date)::date::text,0));
  select * into v_draft from public.zysyr_daily_sheet_drafts
    where id=p_draft_id and company_id=p_company_id and store_id=p_store_id for update;
  select after_json into v_prior from public.zysyr_audit_events
    where company_id=p_company_id and store_id=p_store_id and actor_user_id=p_actor_user_id
      and entity_type='daily_sheet_draft' and entity_id=p_draft_id and action='correct_confirmed_daily'
      and after_json->>'request_id'=p_request_id::text order by id desc limit 1;
  if found then
    if v_prior->>'payload_hash'<>v_hash then raise exception using errcode='PT409',message='DAILY_CORRECTION_REQUEST_REUSED'; end if;
    return (v_prior->'result')||jsonb_build_object('already_applied',true);
  end if;
  if v_draft.status<>'confirmed' then raise exception using errcode='55000',message='DAILY_CORRECTION_CONFIRMED_REQUIRED'; end if;
  if v_draft.edit_revision<>p_expected_revision then raise exception using errcode='PT409',message='DAILY_SHEET_REVISION_CONFLICT'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  select * into v_old_version from public.zysyr_daily_sheet_versions
    where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id order by version desc limit 1;
  if not found then raise exception using errcode='55000',message='DAILY_CORRECTION_ORIGINAL_VERSION_REQUIRED'; end if;
  select * into v_old_daily from public.zysyr_daily_reports where id=v_old_version.daily_report_id
    and company_id=p_company_id and store_id=p_store_id and report_date=v_date and status='approved' for update;
  if not found or exists(select 1 from public.zysyr_daily_reports where company_id=p_company_id and store_id=p_store_id
    and report_date=v_date and status in ('submitted','approved','locked') and id<>v_old_daily.id) then
    raise exception using errcode='55000',message='DAILY_CORRECTION_LEDGER_CHANGED';
  end if;
  select * into v_source from public.zysyr_report_uploads
    where id=v_old_version.source_report_id and company_id=p_company_id and store_id=p_store_id
      and report_date=v_date and report_type='daily' and status='active' for update;
  if not found or v_draft.source_voucher_id is distinct from v_old_version.source_voucher_id then
    raise exception using errcode='55000',message='DAILY_CORRECTION_SOURCE_CHANGED';
  end if;
  -- Same short source/identity locks used by the existing finance attestation.
  perform zysyr_private.lock_daily_cash_review(p_draft_id,p_actor_user_id);
  v_cash_before:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
  if v_draft.ocr_raw_result#>>'{autofill,cash_receipts,policy}' is distinct from 'operating-external-cash-v1'
    or v_draft.ocr_raw_result#>>'{autofill,cash_receipts,state}' is distinct from 'candidate'
    or coalesce((v_cash_before->>'original_ready')::boolean,false) is not true then
    raise exception using errcode='55000',message='DAILY_CORRECTION_CASH_SOURCE_NOT_READY';
  end if;
  if v_cash_before->>'source_hash' is distinct from p_cash_source_confirmation->>'source_token' then
    raise exception using errcode='PT409',message='DAILY_CORRECTION_CASH_SOURCE_CHANGED';
  end if;
  v_before:=jsonb_build_object('version_id',v_old_version.id,'daily_report_id',v_old_daily.id,'edit_revision',v_draft.edit_revision,
    'validation',v_draft.validation_result,'income_count',(select count(*) from public.zysyr_income_records
      where company_id=p_company_id and store_id=p_store_id and daily_report_id=v_old_daily.id and status='approved'));
  -- Preserve confirmed-source semantics and the original immutable snapshot.
  -- Every projection edit, reversal and new posting shares this transaction.
  -- Any failed validation/import/approval rolls back to the old effective ledger.
  v_saved:=zysyr_private.admin_correction_save_daily_sheet_cells(p_actor_user_id,p_company_id,p_store_id,p_draft_id,p_cells,btrim(p_reason));
  select edit_revision into v_new_revision from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id;
  if v_new_revision<=p_expected_revision then raise exception using errcode='22023',message='DAILY_CORRECTION_NO_CHANGES'; end if;
  v_cash_after:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
  if v_cash_after->>'source_hash' is distinct from v_cash_before->>'source_hash'
    or (v_cash_after->>'revision')::integer is distinct from v_new_revision
    or coalesce((v_cash_after->>'original_ready')::boolean,false) is not true then
    raise exception using errcode='PT409',message='DAILY_CORRECTION_CASH_SOURCE_CHANGED';
  end if;
  -- A new explicit owner review, never a rewrite or an impersonated finance review.
  insert into zysyr_private.daily_cash_reviews(company_id,store_id,draft_id,edit_revision,
    reviewer_account_id,reviewer_auth_user_id,source_hash,cell_hash,request_id,reason)
    values(p_company_id,p_store_id,p_draft_id,v_new_revision,p_actor_user_id,p_actor_auth_user_id,
      v_cash_after->>'source_hash',v_cash_after->>'cell_hash',p_request_id,
      left('老板更正来源核实：'||btrim(p_reason),500)) returning id into v_cash_review_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,
      'review_cash_sources_for_correction',jsonb_build_object('request_id',p_request_id,
        'cash_review_id',v_cash_review_id,'edit_revision',v_new_revision,
        'source_hash',v_cash_after->>'source_hash','cell_hash',v_cash_after->>'cell_hash',
        'reviewed_original',true,'reviewed_channels',true,'reviewed_card_sales',true),btrim(p_reason),'financial');
  -- Keep the original complete monetary/unknown-value validation and rollback boundary.
  if coalesce((zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id)->>'valid')::boolean,false) is not true then
    raise exception using errcode='22023',message='DAILY_SHEET_CONTROL_MISMATCH';
  end if;
  update public.zysyr_income_records set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=now(),reverse_reason=btrim(p_reason)
    where company_id=p_company_id and store_id=p_store_id and daily_report_id=v_old_daily.id and status='approved';
  get diagnostics v_reversed=row_count;
  if v_reversed<>(v_before->>'income_count')::integer then raise exception using errcode='PT409',message='DAILY_CORRECTION_LEDGER_CHANGED'; end if;
  update public.zysyr_daily_reports set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=now(),reverse_reason=btrim(p_reason)
    where id=v_old_daily.id and company_id=p_company_id and store_id=p_store_id and status='approved';
  insert into public.zysyr_workflow_events(company_id,store_id,entity_type,entity_id,from_status,to_status,action,actor_user_id,reason)
    values(p_company_id,p_store_id,'daily_report',v_old_daily.id,'approved','reversed','reverse',p_actor_user_id,btrim(p_reason));
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_report',v_old_daily.id,'reverse',
      v_before,jsonb_build_object('status','reversed','income_count',v_reversed,'correction_request_id',p_request_id),btrim(p_reason),'financial');
  select jsonb_agg(to_jsonb(cell)||jsonb_build_object('numeric_value',zysyr_private.daily_sheet_cell_value(cell))
    order by cell.row_number,cell.column_number,cell.section_code,cell.row_key) into v_display
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id;
  v_report:=jsonb_build_object('original_filename',v_source.original_filename,'mime_type',v_source.mime_type,
    'size_bytes',v_source.size_bytes,'sha256',v_source.sha256,'bucket_id',v_source.bucket_id,
    'object_path',v_source.object_path||'.correction-'||p_request_id::text,
    'display_data',v_source.display_data||jsonb_build_object('cells',v_display,'source_voucher_id',v_draft.source_voucher_id,
      'validation',zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id),
      'original_image_preserved',true,'supersedes_daily_version_id',v_old_version.id));
  v_posted:=zysyr_private.admin_correction_confirm_daily_sheet(p_actor_user_id,p_company_id,p_store_id,p_draft_id,
    v_report,case when v_old_daily.business_day_source='manual_override' then v_old_daily.is_business_day else null end,btrim(p_reason));
  -- The frozen legacy pipeline may not represent some cash/card combinations.
  -- Never let source re-attestation silently alter the validated cash income.
  if (select coalesce(sum(i.amount),0) from public.zysyr_income_records i
       where i.company_id=p_company_id and i.store_id=p_store_id
         and i.daily_report_id=(v_posted->>'daily_report_id')::uuid and i.status='approved')
     is distinct from (v_posted->'validation'->>'cashflow_total')::numeric then
    raise exception using errcode='22023',message='DAILY_CORRECTION_CASH_LEDGER_MISMATCH';
  end if;
  v_posted:=v_posted||jsonb_build_object('request_id',p_request_id,'edit_revision',v_new_revision,
    'supersedes_version_id',v_old_version.id,'supersedes_daily_report_id',v_old_daily.id,'corrected',true,
    'cash_review_id',v_cash_review_id,'cash_source_reviewed',true);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'correct_confirmed_daily',v_before,
      jsonb_build_object('request_id',p_request_id,'payload_hash',v_hash,'result',v_posted),btrim(p_reason),'financial');
  return v_posted;
end
$function$;
revoke all on function public.zysyr_correct_confirmed_daily_sheet_with_cash_review(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.zysyr_correct_confirmed_daily_sheet_with_cash_review(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text,uuid,jsonb) to service_role;
