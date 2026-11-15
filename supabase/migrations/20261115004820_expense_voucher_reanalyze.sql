-- Append-only model upgrade for explicitly selected, unassociated expense images.
set lock_timeout='5s';
alter table public.zysyr_voucher_ocr_tasks add column if not exists review_only boolean not null default false;
create or replace function public.zysyr_reanalyze_expense_vouchers(p_actor uuid,p_company uuid,p_store uuid,p_month date,p_items jsonb,p_model text,p_mode text,p_reason text,p_settings_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;v public.zysyr_voucher_attachments;t public.zysyr_voucher_ocr_tasks;saved public.zysyr_voucher_ocr_tasks;queued integer:=0;review_only boolean;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'voucher.review');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voucher-ai-settings|'||p_company::text||'|'||p_store::text,0));
 if p_settings_revision is null or coalesce((select revision from public.zysyr_voucher_ai_settings where company_id=p_company and store_id=p_store),0)<>p_settings_revision then raise exception 'VOUCHER_AI_SETTINGS_CHANGED';end if;
 if p_mode is null or p_mode not in ('upgrade','single') or nullif(btrim(p_model),'') is null then raise exception 'INVALID_REANALYSIS_MODE';end if;
 if p_month is null or extract(day from p_month)<>1 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 or nullif(btrim(p_reason),'') is null then raise exception 'INVALID_EXPENSE_REANALYSIS';end if;
 if p_mode='single' and jsonb_array_length(p_items)<>1 then raise exception 'SINGLE_REANALYSIS_REQUIRED';end if;
 if (select count(distinct value->>'voucher_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_EXPENSE_REANALYSIS';end if;
 for r in select value from jsonb_array_elements(p_items) order by value->>'voucher_id' loop
  select * into v from public.zysyr_voucher_attachments where id=(r->>'voucher_id')::uuid and company_id=p_company and store_id=p_store for update;
  if v.id is null or v.note is null or v.note not like 'petty_cash_batch|'||to_char(p_month,'YYYY-MM')||'|%' then raise exception 'EXPENSE_REANALYSIS_SCOPE';end if;
  if v.mime_type not like 'image/%' then continue;end if;
  review_only:=v.audit_status<>'pending' or v.ocr_status='reviewed'
   or exists(select 1 from public.zysyr_voucher_reviews where voucher_id=v.id)
   or exists(select 1 from public.zysyr_expense_voucher_matches where voucher_id=v.id)
   or exists(select 1 from public.zysyr_petty_detail_links where voucher_id=v.id)
   or exists(select 1 from public.zysyr_voucher_links where voucher_id=v.id and unlinked_at is null);
  if review_only and p_mode<>'single' then continue;end if;
  select * into t from public.zysyr_voucher_ocr_tasks where voucher_id=v.id and company_id=p_company and store_id=p_store order by attempt desc limit 1 for update;
  if t.id is null or t.id is distinct from (r->>'task_id')::uuid or t.status not in ('succeeded','failed','dead_letter','cancelled') or (p_mode='upgrade' and t.model=p_model) then continue;end if;
  insert into public.zysyr_voucher_ocr_tasks(company_id,store_id,voucher_id,attempt,max_attempts,created_by_user_id,review_only)
   values(p_company,p_store,v.id,t.attempt+1,least(10,greatest(t.max_attempts,t.attempt+3)),p_actor,review_only) returning * into saved;
  if not review_only then update public.zysyr_voucher_attachments set ocr_status='pending',updated_at=now(),updated_by_user_id=p_actor where id=v.id and company_id=p_company and store_id=p_store;end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
   values(p_company,p_store,'user',p_actor,'api','voucher_attachment',v.id,'expense_voucher_model_upgrade',jsonb_build_object('previous_task_id',t.id,'new_task_id',saved.id,'model',p_model,'review_only',review_only),btrim(p_reason),'financial');
  queued:=queued+1;
 end loop;
 return jsonb_build_object('queued',queued,'posted',false,'previous_attempts_preserved',true);
end $$;
revoke execute on function public.zysyr_reanalyze_expense_vouchers(uuid,uuid,uuid,date,jsonb,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.zysyr_reanalyze_expense_vouchers(uuid,uuid,uuid,date,jsonb,text,text,text,integer) to service_role;

-- Preserve automatic association guards and serialize competing image claims.
create or replace function public.zysyr_save_expense_voucher_matches(p_actor uuid,p_company uuid,p_store uuid,p_month date,p_mode text,p_matches jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;v public.zysyr_voucher_attachments;t public.zysyr_voucher_ocr_tasks;f jsonb;c jsonb;effective_conf jsonb;raw_date text;target_valid boolean;inserted integer:=0; saved_id uuid;source_id uuid;lock_key text;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 if p_mode not in ('auto','manual') or extract(day from p_month)<>1 or jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches) not between 1 and 20 then raise exception 'INVALID_EXPENSE_MATCH_REQUEST';end if;
 if p_mode='auto' then for lock_key in select distinct (value->>'target_kind')||':'||(value->>'target_id') from jsonb_array_elements(p_matches) order by 1 loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company::text||':'||p_store::text||':'||p_month::text||':'||lock_key,0));end loop;end if;
 for r in select value from jsonb_array_elements(p_matches) loop
  select * into v from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store and id=(r->>'voucher_id')::uuid for update;
  if v.id is null or v.note is null or v.note not like 'petty_cash_batch|'||to_char(p_month,'YYYY-MM')||'|%' or v.audit_status<>'pending' then raise exception 'EXPENSE_VOUCHER_SCOPE_OR_REVIEW_CHANGED';end if;
  if exists(select 1 from public.zysyr_expense_voucher_matches where company_id=p_company and store_id=p_store and voucher_id=v.id and component_index=(r->>'component_index')::int and status='active') then continue;end if;
  select * into t from public.zysyr_voucher_ocr_tasks where company_id=p_company and store_id=p_store and voucher_id=v.id and not review_only order by attempt desc limit 1;
  if t.id is null or t.id<>(r->>'task_id')::uuid then raise exception 'EXPENSE_RECOGNITION_CHANGED';end if;
  f:=r->'corrected_fields';
  if coalesce((f->>'amount')::numeric,0)<=0 or (f->>'amount')::numeric<>round((f->>'amount')::numeric,2) or nullif(btrim(r->>'reason'),'') is null then raise exception 'EXPENSE_MATCH_FIELDS_REQUIRED';end if;
  if f->>'evidence_kind'='monthly_summary' then
   if r->>'target_kind'<>'monthly_source' or f->>'document_date' is not null or f->>'period_month' is distinct from to_char(p_month,'YYYY-MM') then raise exception 'EXPENSE_SUMMARY_PERIOD_REQUIRED';end if;
  elsif f->>'document_date' is null or date_trunc('month',(f->>'document_date')::date)::date<>p_month then raise exception 'EXPENSE_MATCH_FIELDS_REQUIRED';end if;
  if p_mode='auto' then
   if exists(select 1 from public.zysyr_expense_voucher_matches where company_id=p_company and store_id=p_store and voucher_id=v.id and component_index=(r->>'component_index')::int and status='void') then raise exception 'EXPENSE_HUMAN_CORRECTION_PRESERVED';end if;
   if exists(select 1 from public.zysyr_expense_voucher_matches other where other.company_id=p_company and other.store_id=p_store and other.period_month=p_month and other.target_kind=r->>'target_kind' and other.target_id=r->>'target_id' and other.status='active' and (other.voucher_id<>v.id or other.component_index<>(r->>'component_index')::int)) then raise exception 'EXPENSE_TARGET_ALREADY_HAS_EVIDENCE';end if;
   if t.status<>'succeeded' then raise exception 'EXPENSE_RECOGNITION_NOT_READY';end if;
   if f->>'evidence_kind'='monthly_summary' then
    c:=t.candidate_fields->'monthly_summary';
    if (r->>'component_index')::int<>0 or c->>'evidence_kind' is distinct from 'monthly_summary' or c->>'period_month' is distinct from f->>'period_month'
      or coalesce((c->'confidence'->>'period_month')::numeric,0) not between 0.95 and 1 or coalesce((c->'confidence'->>'amount')::numeric,0) not between 0.98 and 1
      or coalesce(c->'evidence'->>'period_month','')='' then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   elsif jsonb_array_length(coalesce(t.candidate_fields->'transactions','[]'::jsonb))>0 then
    c:=t.candidate_fields->'transactions'->(r->>'component_index')::int;f:=r->'corrected_fields';
    if coalesce((c->'confidence'->>'document_date')::numeric,0)<0.95 or coalesce((c->'confidence'->>'amount')::numeric,0)<0.98 then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   else
    c:=t.candidate_fields;effective_conf:=t.field_confidences;
    raw_date:=btrim(t.raw_result->'provider_response'->'fields'->>'document_date');
    if c->>'document_date' is null and c->>'document_kind'='receipt' and c->>'recognition_schema_version'='expense-voucher-v2'
      and t.raw_result->'provider_response'->>'schema_version'='expense-voucher-v2'
      and t.raw_result->'provider_response'->>'document_kind'='receipt'
      and c->>'recognition_provider'=t.raw_result->'provider_response'->>'provider'
      and raw_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$'
      and coalesce((t.raw_result->'provider_response'->'confidences'->>'document_date')::numeric,0) between 0.95 and 1 then
     c:=jsonb_set(c,'{document_date}',to_jsonb(left(raw_date,10)));
     effective_conf:=jsonb_set(coalesce(effective_conf,'{}'::jsonb),'{document_date}',t.raw_result->'provider_response'->'confidences'->'document_date');
    end if;
    if (r->>'component_index')::int<>0 or c->>'document_kind'<>'receipt' or coalesce((effective_conf->>'document_date')::numeric,0)<0.95 or coalesce((effective_conf->>'amount')::numeric,0)<0.98 then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   end if;
   if (f->>'evidence_kind' is distinct from 'monthly_summary' and (coalesce(c->'evidence'->>'document_date','')='' or c->>'document_date' is distinct from f->>'document_date'))
     or coalesce(c->'evidence'->>'amount','')='' or (c->>'amount')::numeric is distinct from (f->>'amount')::numeric
     or (r->'target_snapshot'->>'amount')::numeric is distinct from (f->>'amount')::numeric then raise exception 'EXPENSE_RECOGNITION_EVIDENCE';end if;
   if r->>'target_kind'='monthly_source' and (coalesce(c->'evidence'->>'expense_category','')='' or not (coalesce((coalesce(c->'confidence',t.field_confidences)->>'expense_category')::numeric,0) between 0.95 and 1 or (coalesce((coalesce(c->'confidence',t.field_confidences)->>'expense_category')::numeric,0) between 0.90 and 1 and c->>'expense_category' ~ '固话|宽带|电话' and c->'evidence'->>'expense_category' ~ '固话|宽带|电话费' and c->'evidence'->>'expense_category' !~ '依据|判断|归类|推测')) or c->>'expense_category' is distinct from f->>'expense_category') then raise exception 'EXPENSE_CATEGORY_EVIDENCE_REQUIRED';end if;
  end if;
  target_valid:=false;
  case r->>'target_kind'
   when 'monthly_source' then
    source_id:=split_part(r->>'target_id','~',1)::uuid;
    select exists(select 1 from public.zysyr_monthly_source_selections s where s.company_id=p_company and s.store_id=p_store and s.period_month=p_month and s.id=source_id and s.source_request_id=(r->'target_snapshot'->>'source_request_id')::uuid
      and not exists(select 1 from public.zysyr_monthly_source_selections newer where newer.company_id=p_company and newer.store_id=p_store and newer.period_month=p_month and newer.selection_version>s.selection_version)) into target_valid;
    if split_part(r->>'target_id','~',2) !~ '^C[1-9][0-9]{0,2}$' or r->'target_snapshot'->>'source_locator' is distinct from split_part(r->>'target_id','~',2) then target_valid:=false;end if;
   when 'source_petty' then
    select exists(select 1 from public.zysyr_history_import_rows h join public.zysyr_history_import_batches b on b.id=h.import_batch_id where h.id=(r->>'target_id')::uuid and b.company_id=p_company and b.store_id=p_store and h.mapped_json->>'period_month'=p_month::text) into target_valid;
   when 'draft' then
    select exists(select 1 from public.zysyr_petty_detail_drafts where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and date_trunc('month',transaction_date)::date=p_month and amount=(r->'target_snapshot'->>'amount')::numeric and transaction_date=(r->'target_snapshot'->>'transaction_date')::date) into target_valid;
   when 'formal' then
    select exists(select 1 from public.zysyr_petty_cash_records where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and date_trunc('month',transaction_date)::date=p_month and direction='outflow' and status='confirmed' and amount=(r->'target_snapshot'->>'amount')::numeric and transaction_date=(r->'target_snapshot'->>'transaction_date')::date) into target_valid;
   when 'history' then
    select exists(select 1 from public.zysyr_history_ledger_entries where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and current_payload->>'period_month'=p_month::text) into target_valid;
   else null;
  end case;
  if not target_valid then raise exception 'EXPENSE_TARGET_SOURCE_CHANGED';end if;
  insert into public.zysyr_expense_voucher_matches(company_id,store_id,period_month,voucher_id,component_index,source_task_id,target_kind,target_id,target_snapshot,corrected_fields,mode,actor_user_id,reason)
  values(p_company,p_store,p_month,v.id,(r->>'component_index')::int,t.id,r->>'target_kind',r->>'target_id',r->'target_snapshot',r->'corrected_fields',p_mode,p_actor,r->>'reason') returning id into saved_id;
  inserted:=inserted+1;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company,p_store,'user',p_actor,'api','voucher_attachment',v.id,'expense_voucher_match',jsonb_build_object('match_id',saved_id,'mode',p_mode,'target_kind',r->>'target_kind','target_id',r->>'target_id'),r->>'reason','financial');
 end loop;
 return jsonb_build_object('inserted',inserted,'posted',false,'amount_changed',false,'voucher_approved',false);
end $$;
revoke execute on function public.zysyr_save_expense_voucher_matches(uuid,uuid,uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_save_expense_voucher_matches(uuid,uuid,uuid,date,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.zysyr_complete_voucher_ocr_task(p_task_id uuid, p_lease_token uuid, p_succeeded boolean, p_retryable boolean, p_raw_result jsonb, p_candidate_fields jsonb, p_field_confidences jsonb, p_error_message text)
 RETURNS zysyr_voucher_ocr_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_task public.zysyr_voucher_ocr_tasks; v_next_status text; v_delay integer;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_candidate_fields,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_field_confidences,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='OCR_RESULT_INVALID'; end if;
  select * into v_task from public.zysyr_voucher_ocr_tasks task where task.id=p_task_id and task.status='processing'
    and task.lease_token=p_lease_token and task.leased_until>=now() for update;
  if not found then raise exception using errcode='55000',message='OCR_TASK_LEASE_INVALID'; end if;
  if p_succeeded then v_next_status:='succeeded';
  elsif p_retryable and v_task.attempt<v_task.max_attempts then v_next_status:='queued';
  else v_next_status:='dead_letter'; end if;
  v_delay:=least(900,30*(2^least(5,v_task.attempt-1))::integer);
  update public.zysyr_voucher_ocr_tasks set status=v_next_status,raw_result=p_raw_result,
    candidate_fields=coalesce(p_candidate_fields,'{}'::jsonb),field_confidences=coalesce(p_field_confidences,'{}'::jsonb),
    error_message=nullif(btrim(p_error_message),''),completed_at=case when v_next_status in ('succeeded','dead_letter') then now() else null end,
    attempt=case when v_next_status='queued' then attempt+1 else attempt end,
    next_attempt_at=case when v_next_status='queued' then now()+make_interval(secs=>v_delay) else next_attempt_at end,
    lease_token=null,leased_until=null,dead_lettered_at=case when v_next_status='dead_letter' then now() else null end
  where id=v_task.id returning * into v_task;
  if not v_task.review_only then update public.zysyr_voucher_attachments set ocr_status=case when v_next_status='succeeded' then 'processing'
      when v_next_status='dead_letter' then 'failed' else 'pending' end,updated_at=now(),updated_by_user_id=v_task.created_by_user_id
    where company_id=v_task.company_id and id=v_task.voucher_id;end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,service_actor,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(v_task.company_id,v_task.store_id,'system','voucher-ocr-worker','ocr','voucher_attachment',v_task.voucher_id,
    case v_next_status when 'succeeded' then 'ocr_candidate_recorded' when 'queued' then 'ocr_retry_scheduled' else 'ocr_dead_lettered' end,
    jsonb_build_object('task_id',v_task.id,'provider',v_task.provider,'model',v_task.model,'attempt',v_task.attempt,'status',v_next_status,
      'candidate_fields',v_task.candidate_fields,'field_confidences',v_task.field_confidences),
    coalesce(nullif(btrim(p_error_message),''),'OCR候选已生成，等待财务对照原图复核。'),'financial');
  return v_task;
end $function$
