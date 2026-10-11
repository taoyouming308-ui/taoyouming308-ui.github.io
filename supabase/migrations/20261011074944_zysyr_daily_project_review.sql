-- Additive human review contract. No financial rows, formulas or RLS changed.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function public.zysyr_daily_project_review_context(p_company_id uuid,p_store_id uuid,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; s public.mgj_business_detail_snapshots%rowtype;
 projected jsonb; refs jsonb; cash jsonb; token text;
begin
 if zysyr_private.request_role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PROJECT_REVIEW_SERVICE_ONLY'; end if;
 select * into d from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 if d.status<>'draft' or d.template_code<>'zysyr_frontdesk_project_draft' then
  return jsonb_build_object('required',false); end if;
 select x.* into s from public.mgj_business_detail_snapshots x join public.zysyr_stores st on st.name=x.shop_name
  where st.company_id=p_company_id and st.id=p_store_id and x.business_date=d.report_date
  and x.id::text=d.ocr_raw_result#>>'{autofill,snapshot_id}';
 if s.id is null or jsonb_typeof(s.payload->'bills') is distinct from 'array' then
  return jsonb_build_object('required',true,'ready',false,'reason','项目来源版本缺失，请先核对来源；填写内容未改动'); end if;
 -- Re-project the same immutable source with current classification only for
 -- comparison. Never merge it into cells or replace the finance-entered amount.
 projected:=zysyr_daily_electronic_private.autofill_cells(s.payload);
 if exists(select 1 from jsonb_array_elements(projected) x where x->>'cell_role'='staff_value'
  and (x->>'value')::numeric>0 and not exists(select 1 from public.zysyr_daily_sheet_cells c
   where c.company_id=p_company_id and c.store_id=p_store_id and c.draft_id=p_draft_id
   and c.section_code=x->>'section_code' and c.row_key=x->>'row_key' and c.column_code=x->>'column_code')) then
  return jsonb_build_object('required',true,'ready',false,'reason','有来源项目尚未在日报行列中呈现，请先核对项目行；未自动补填'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',c.id,'row_key',c.row_key,'row_label',c.row_label,
  'column_code',c.column_code,'column_label',c.column_label,
  'source_value',(x->>'value')::numeric,
  'value',case when c.manual_override then c.corrected_numeric else c.ocr_numeric end,
  'unknown',c.column_code in('dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment') and x->>'value' is null)
  order by c.row_number,c.column_number,c.id),'[]'::jsonb) into refs
 from public.zysyr_daily_sheet_cells c
 left join lateral (select j from jsonb_array_elements(projected) j where j->>'section_code'=c.section_code
  and j->>'row_key'=c.row_key and j->>'column_code'=c.column_code) projected_cell on true
 cross join lateral (select projected_cell.j x) reference
 where c.company_id=p_company_id and c.store_id=p_store_id and c.draft_id=p_draft_id
  and c.cell_role='staff_value' and c.section_code='stylist'
  and exists(select 1 from jsonb_array_elements(projected) row_ref where row_ref->>'row_key'=c.row_key);
 cash:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
 -- Source-only token survives saving the explicitly reviewed values. Revision
 -- and per-cell values are checked separately inside the final transaction.
 token:=encode(sha256(convert_to(jsonb_build_object('company',p_company_id,'store',p_store_id,'draft',p_draft_id,
  'snapshot',s.id,'sha256',s.source_sha256,'projection',projected,'source',cash->>'source_hash')::text,'UTF8')),'hex');
 return jsonb_build_object('required',true,'ready',true,'source_token',token,'cells',refs);
end $$;
revoke all on function public.zysyr_daily_project_review_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.zysyr_daily_project_review_context(uuid,uuid,uuid) to service_role;

create or replace function zysyr_private.daily_project_review_items(p_context jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(x order by x->>'cell_id'),'[]'::jsonb)
 from jsonb_array_elements(p_context->'cells') x
 where x->'value' is distinct from x->'source_value' or x->'unknown'='true'::jsonb
$$;
revoke all on function zysyr_private.daily_project_review_items(jsonb) from public,anon,authenticated,service_role;

create or replace function public.zysyr_confirm_daily_project_review(p_actor_user_id uuid,p_actor_auth_user_id uuid,
 p_company_id uuid,p_store_id uuid,p_draft_id uuid,p_expected_revision integer,p_report jsonb,
 p_is_business_day boolean,p_reason text,p_project_confirmation jsonb,p_cash_confirmation jsonb,p_electronic_cell_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; context jsonb; items jsonb; ack jsonb; expected jsonb; proof jsonb;
begin
 if zysyr_private.request_role() is distinct from 'service_role' or not
  zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='PROJECT_REVIEW_FINANCE_FORBIDDEN'; end if;
 select * into d from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id for update;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 if d.status<>'draft' then raise exception using errcode='55000',message='DAILY_SHEET_ALREADY_CONFIRMED'; end if;
 if p_expected_revision is null or d.edit_revision<>p_expected_revision then
  raise exception using errcode='PT409',message='DAILY_SHEET_REVISION_CONFLICT'; end if;
 if zysyr_private.period_is_locked(p_company_id,p_store_id,d.report_date) then
  raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
 perform zysyr_private.lock_daily_cash_review(p_draft_id,p_actor_user_id);
 -- Include the draft's frozen source even if it is no longer the head.
 perform 1 from public.mgj_business_detail_snapshots s where s.id::text=d.ocr_raw_result#>>'{autofill,snapshot_id}' for share;
 if not zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='PROJECT_REVIEW_FINANCE_FORBIDDEN'; end if;
 context:=public.zysyr_daily_project_review_context(p_company_id,p_store_id,p_draft_id);
 if context->'ready' is distinct from 'true'::jsonb then
  raise exception using errcode='55000',message='PROJECT_REVIEW_NOT_READY',detail=context->>'reason'; end if;
 if p_project_confirmation->>'statement' is distinct from 'finance-project-review-v1'
  or jsonb_typeof(p_project_confirmation->'items') is distinct from 'array' then
  raise exception using errcode='22023',message='PROJECT_REVIEW_EXPLICIT_ITEMS_REQUIRED'; end if;
 if p_project_confirmation->>'source_token' is distinct from context->>'source_token' then
  raise exception using errcode='PT409',message='PROJECT_REVIEW_SOURCE_CHANGED'; end if;
 items:=zysyr_private.daily_project_review_items(context);
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',x->>'cell_id','value',x->'value','acknowledged',true) order by x->>'cell_id'),'[]'::jsonb)
  into expected from jsonb_array_elements(items) x;
 select coalesce(jsonb_agg(x order by x->>'cell_id'),'[]'::jsonb) into ack from jsonb_array_elements(p_project_confirmation->'items') x;
 if ack is distinct from expected then
  raise exception using errcode='PT409',message='PROJECT_REVIEW_ITEMS_CHANGED',detail='请逐项复核来源差异与当前填写值，不能仅凭合计相等入账'; end if;
 proof:=jsonb_build_object('statement','finance-project-review-v1','source_token',context->>'source_token',
  'revision',d.edit_revision,'actor_id',p_actor_user_id,'auth_user_id',p_actor_auth_user_id,'items',items,
  'blank_policy','explicitly-reviewed-no-business-preserve-null','reviewed_at',clock_timestamp());
 p_report:=jsonb_set(p_report,'{display_data,project_review}',proof,true);
 insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
 values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'review_project_sources',proof,p_reason,'financial');
 -- Existing numeric, permission, source, archival and ledger guards still run.
 -- Their failure rolls back this proof too. This wrapper assigns no cell value.
 if p_cash_confirmation->>'statement'='electronic-channels-sales-v1' then
  return public.zysyr_confirm_daily_electronic_sheet(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id,p_draft_id,
   p_expected_revision,p_cash_confirmation->>'source_token',p_electronic_cell_hash,(p_cash_confirmation->>'request_id')::uuid,
   p_cash_confirmation->>'statement',p_report,p_reason);
 elsif p_cash_confirmation is not null and p_cash_confirmation<>'null'::jsonb then
  return public.zysyr_confirm_daily_sheet_reviewed(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id,p_draft_id,
   p_report,p_is_business_day,p_reason,p_expected_revision,p_cash_confirmation->>'source_token',
   (p_cash_confirmation->>'request_id')::uuid,p_cash_confirmation->>'statement');
 else
  return public.zysyr_confirm_daily_sheet(p_actor_user_id,p_company_id,p_store_id,p_draft_id,p_report,p_is_business_day,p_reason,p_expected_revision);
 end if;
end $$;
revoke all on function public.zysyr_confirm_daily_project_review(uuid,uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_confirm_daily_project_review(uuid,uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,jsonb,jsonb,text) to service_role;
