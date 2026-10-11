-- Additive, opt-in electronic evidence path. No existing rows or functions rewritten.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function public.zysyr_daily_electronic_post_context(p_company_id uuid,p_store_id uuid,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; s public.mgj_business_detail_snapshots%rowtype;
 st text; services jsonb; source_ids text[]; list_ids text[]; c jsonb; evidence jsonb;
begin
 if zysyr_private.request_role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='ELECTRONIC_POST_SERVICE_ONLY'; end if;
 select * into d from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 if d.status<>'draft' or d.source_voucher_id is not null or d.template_code<>'zysyr_frontdesk_project_draft'
  or d.ocr_raw_result#>>'{autofill,cash_receipts,policy}' is distinct from 'operating-external-cash-v1' then
  return jsonb_build_object('ready',false,'reason','非电子来源草稿或已有原件，请按原流程核对'); end if;
 select name into st from public.zysyr_stores where id=p_store_id and company_id=p_company_id and status='active' and deleted_at is null;
 select x.* into s from public.mgj_business_detail_heads h join public.mgj_business_detail_snapshots x
  on x.id=h.snapshot_id and x.shop_name=h.shop_name and x.business_date=h.business_date
  where h.shop_name=st and h.business_date=d.report_date;
 if s.id is null or s.id::text is distinct from d.ocr_raw_result#>>'{autofill,snapshot_id}' then
  return jsonb_build_object('ready',false,'reason','电子明细来源缺失或已更新，请重新核对来源'); end if;
 select x.services into services from public.mgj_daily_consumption x where x.shop_name=st and x.business_date=d.report_date;
 select array_agg(x->>'source_bill_id' order by x->>'source_bill_id') into source_ids from jsonb_array_elements(s.payload->'bills') x;
 select array_agg(x->>'source_id' order by x->>'source_id') into list_ids from jsonb_array_elements(services) x;
 if services is null or source_ids is null or source_ids is distinct from list_ids or exists(
  select 1 from jsonb_array_elements(s.payload->'bills') b join jsonb_array_elements(services) x on x->>'source_id'=b->>'source_bill_id'
  where (b->>'source_posted_amount_cents')::numeric is distinct from (x->>'amount')::numeric*100) then
  return jsonb_build_object('ready',false,'reason','电子明细与来源清单尚未同步一致，请核对后再入账'); end if;
 c:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
 evidence:=jsonb_build_object('kind','finance-reviewed-electronic-v1','company_id',p_company_id,'store_id',p_store_id,
  'report_date',d.report_date,'detail_snapshot_id',s.id,'detail_sha256',s.source_sha256,
  'source_count',s.source_count,'source_token',c->>'source_hash','cell_hash',c->>'cell_hash','revision',d.edit_revision,
  'cash_sources',coalesce((select jsonb_agg(jsonb_build_object('scope',h.source_scope,'snapshot_id',h.snapshot_id,'sha256',x.source_sha256) order by h.source_scope)
   from public.zysyr_daily_electronic_heads h join public.zysyr_daily_electronic_snapshots x on x.id=h.snapshot_id
   where h.company_id=p_company_id and h.store_id=p_store_id and h.business_date=d.report_date),'[]'::jsonb));
 return jsonb_build_object('ready',true,'source_token',c->>'source_hash','cell_hash',c->>'cell_hash','evidence',evidence);
end $$;
revoke all on function public.zysyr_daily_electronic_post_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.zysyr_daily_electronic_post_context(uuid,uuid,uuid) to service_role;

create or replace function public.zysyr_confirm_daily_electronic_sheet(p_actor_user_id uuid,p_actor_auth_user_id uuid,
 p_company_id uuid,p_store_id uuid,p_draft_id uuid,p_expected_revision integer,p_source_token text,
 p_cell_hash text,p_request_id uuid,p_statement text,p_report jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; c jsonb; linked jsonb; result jsonb;
begin
 if zysyr_private.request_role() is distinct from 'service_role' or not
  zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='ELECTRONIC_POST_FINANCE_FORBIDDEN'; end if;
 if p_statement is distinct from 'electronic-channels-sales-v1' or p_request_id is null then
  raise exception using errcode='22023',message='ELECTRONIC_POST_EXPLICIT_CONFIRMATION_REQUIRED'; end if;
 select * into d from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id for update;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 if d.status<>'draft' then raise exception using errcode='55000',message='DAILY_SHEET_ALREADY_CONFIRMED'; end if;
 if p_expected_revision is null or d.edit_revision<>p_expected_revision then
  raise exception using errcode='PT409',message='DAILY_SHEET_REVISION_CONFLICT'; end if;
 if zysyr_private.period_is_locked(p_company_id,p_store_id,d.report_date) then
  raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
 perform zysyr_private.lock_daily_cash_review(p_draft_id,p_actor_user_id);
 if not zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='ELECTRONIC_POST_FINANCE_FORBIDDEN'; end if;
 c:=public.zysyr_daily_electronic_post_context(p_company_id,p_store_id,p_draft_id);
 if c->'ready' is distinct from 'true'::jsonb then raise exception using errcode='55000',message='ELECTRONIC_SOURCE_NOT_READY',detail=c->>'reason'; end if;
 if c->>'source_token' is distinct from p_source_token or c->>'cell_hash' is distinct from p_cell_hash then
  raise exception using errcode='PT409',message='ELECTRONIC_SOURCE_OR_CELLS_CHANGED'; end if;
 if p_report#>'{display_data,electronic_source}' is distinct from c->'evidence'
  or p_report->>'mime_type' is distinct from 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  or p_report->>'bucket_id' is distinct from 'zysyr-reports'
  or p_report->>'object_path' is distinct from (p_company_id::text||'/'||p_store_id::text||'/daily/'||d.report_date::text||'/electronic-'||p_draft_id::text||'-'||p_request_id::text||'.xlsx') then
  raise exception using errcode='22023',message='ELECTRONIC_ARCHIVE_CONTEXT_INVALID'; end if;
 linked:=public.zysyr_register_daily_sheet_attachment(p_actor_user_id,p_company_id,p_store_id,p_draft_id,p_request_id,
  p_report->>'object_path',p_report->>'original_filename',p_report->>'mime_type',(p_report->>'size_bytes')::bigint,
  p_report->>'sha256','supporting_document','电子来源及财务核对归档（非纸质日报照片）；'||p_reason);
 if linked->'auto_approved' is distinct from 'true'::jsonb then
  raise exception using errcode='42501',message='ELECTRONIC_ARCHIVE_REVIEW_FORBIDDEN'; end if;
 insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
 values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'review_electronic_source',
  jsonb_build_object('evidence',c->'evidence','archive_voucher_id',p_request_id,'auth_user_id',p_actor_auth_user_id),p_reason,'financial');
 -- The new archive, explicit proof and existing final ledger pipeline share one transaction.
 -- No totals are assigned here, and a downstream failure rolls everything back.
 c:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
 result:=public.zysyr_confirm_daily_sheet_reviewed(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id,p_draft_id,
  p_report,null,p_reason,p_expected_revision,c->>'source_hash',p_request_id,'cash-original-channels-sales-v1');
 return result;
end $$;
revoke all on function public.zysyr_confirm_daily_electronic_sheet(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_confirm_daily_electronic_sheet(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid,text,jsonb,text) to service_role;
