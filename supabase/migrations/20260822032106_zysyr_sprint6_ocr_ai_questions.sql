-- ZYSYR V2 Sprint 6: production-ready OCR queue, immutable AI evidence
-- snapshots and contextual shareholder questions.

set statement_timeout='30s';
set lock_timeout='5s';

alter table public.zysyr_voucher_ocr_tasks
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists max_attempts integer not null default 3 check(max_attempts between 1 and 10),
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_token uuid,
  add column if not exists leased_until timestamptz,
  add column if not exists dead_lettered_at timestamptz;

-- Old versions had no lease. Safely requeue any in-flight legacy task before
-- enforcing the new state invariant; the original attempt and raw evidence stay intact.
update public.zysyr_voucher_ocr_tasks
set status='queued',next_attempt_at=now(),lease_token=null,leased_until=null,
  error_message=coalesce(error_message,'v428 升级时重新排队：旧任务没有租约。')
where status='processing' and (lease_token is null or leased_until is null);

create or replace function zysyr_private.normalize_ocr_task_lease()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status<>'processing' then new.lease_token:=null; new.leased_until:=null; end if;
  return new;
end $$;
create trigger zysyr_voucher_ocr_tasks_normalize_lease before insert or update on public.zysyr_voucher_ocr_tasks
for each row execute function zysyr_private.normalize_ocr_task_lease();

alter table public.zysyr_voucher_ocr_tasks drop constraint if exists zysyr_voucher_ocr_tasks_status_check;
alter table public.zysyr_voucher_ocr_tasks add constraint zysyr_voucher_ocr_tasks_status_check
  check(status in ('queued','processing','succeeded','failed','cancelled','dead_letter'));
alter table public.zysyr_voucher_ocr_tasks add constraint zysyr_voucher_ocr_tasks_lease_check
  check((status='processing' and lease_token is not null and leased_until is not null)
    or (status<>'processing' and lease_token is null and leased_until is null));
create index zysyr_voucher_ocr_tasks_retry_queue_idx on public.zysyr_voucher_ocr_tasks(next_attempt_at,queued_at,id)
  where status='queued';
create index zysyr_voucher_ocr_tasks_expired_lease_idx on public.zysyr_voucher_ocr_tasks(leased_until,id)
  where status='processing';

create or replace function public.zysyr_claim_voucher_ocr_task(
  p_provider text,p_model text,p_prompt_version text,p_lease_seconds integer default 120
) returns table(task_id uuid,lease_token uuid,company_id uuid,store_id uuid,voucher_id uuid,
  object_path text,mime_type text,original_filename text,attempt integer,max_attempts integer)
language plpgsql security definer set search_path='' as $$
declare v_task public.zysyr_voucher_ocr_tasks; v_token uuid:=gen_random_uuid();
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if nullif(btrim(p_provider),'') is null or nullif(btrim(p_model),'') is null or nullif(btrim(p_prompt_version),'') is null
    or p_lease_seconds not between 30 and 600 then raise exception using errcode='22023',message='OCR_CLAIM_INPUT_INVALID'; end if;
  select * into v_task from public.zysyr_voucher_ocr_tasks task
  where (task.status='queued' and task.next_attempt_at<=now())
    or (task.status='processing' and task.leased_until<now())
  order by case when task.status='processing' then 0 else 1 end,task.next_attempt_at,task.queued_at,task.id
  limit 1 for update skip locked;
  if not found then return; end if;
  update public.zysyr_voucher_ocr_tasks set status='processing',provider=btrim(p_provider),model=btrim(p_model),
    prompt_version=btrim(p_prompt_version),lease_token=v_token,leased_until=now()+make_interval(secs=>p_lease_seconds),
    started_at=coalesce(started_at,now()),error_message=null where id=v_task.id returning * into v_task;
  return query select v_task.id,v_token,v_task.company_id,v_task.store_id,v_task.voucher_id,
    voucher.object_path,voucher.mime_type,voucher.original_filename,v_task.attempt,v_task.max_attempts
  from public.zysyr_voucher_attachments voucher where voucher.company_id=v_task.company_id and voucher.id=v_task.voucher_id;
end $$;

create or replace function public.zysyr_complete_voucher_ocr_task(
  p_task_id uuid,p_lease_token uuid,p_succeeded boolean,p_retryable boolean,
  p_raw_result jsonb,p_candidate_fields jsonb,p_field_confidences jsonb,p_error_message text
) returns public.zysyr_voucher_ocr_tasks language plpgsql security definer set search_path='' as $$
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
  v_delay:=least(900,30*(2^(v_task.attempt-1))::integer);
  update public.zysyr_voucher_ocr_tasks set status=v_next_status,raw_result=p_raw_result,
    candidate_fields=coalesce(p_candidate_fields,'{}'::jsonb),field_confidences=coalesce(p_field_confidences,'{}'::jsonb),
    error_message=nullif(btrim(p_error_message),''),completed_at=case when v_next_status in ('succeeded','dead_letter') then now() else null end,
    attempt=case when v_next_status='queued' then attempt+1 else attempt end,
    next_attempt_at=case when v_next_status='queued' then now()+make_interval(secs=>v_delay) else next_attempt_at end,
    lease_token=null,leased_until=null,dead_lettered_at=case when v_next_status='dead_letter' then now() else null end
  where id=v_task.id returning * into v_task;
  update public.zysyr_voucher_attachments set ocr_status=case when v_next_status='succeeded' then 'processing'
      when v_next_status='dead_letter' then 'failed' else 'pending' end,updated_at=now(),updated_by_user_id=v_task.created_by_user_id
    where company_id=v_task.company_id and id=v_task.voucher_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,service_actor,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(v_task.company_id,v_task.store_id,'system','voucher-ocr-worker','ocr','voucher_attachment',v_task.voucher_id,
    case v_next_status when 'succeeded' then 'ocr_candidate_recorded' when 'queued' then 'ocr_retry_scheduled' else 'ocr_dead_lettered' end,
    jsonb_build_object('task_id',v_task.id,'provider',v_task.provider,'model',v_task.model,'attempt',v_task.attempt,'status',v_next_status,
      'candidate_fields',v_task.candidate_fields,'field_confidences',v_task.field_confidences),
    coalesce(nullif(btrim(p_error_message),''),'OCR候选已生成，等待财务对照原图复核。'),'financial');
  return v_task;
end $$;

create or replace function public.zysyr_retry_voucher_ocr(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_voucher_id uuid,p_reason text
) returns public.zysyr_voucher_ocr_tasks language plpgsql security definer set search_path='' as $$
declare v_latest public.zysyr_voucher_ocr_tasks; v_saved public.zysyr_voucher_ocr_tasks;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'voucher.review');
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='OCR_RETRY_REASON_REQUIRED'; end if;
  if exists(select 1 from public.zysyr_voucher_attachments voucher where voucher.company_id=p_company_id and voucher.store_id=p_store_id
    and voucher.id=p_voucher_id and (voucher.audit_status<>'pending' or voucher.ocr_status='reviewed')) then
    raise exception using errcode='55000',message='OCR_ALREADY_HUMAN_REVIEWED'; end if;
  select * into v_latest from public.zysyr_voucher_ocr_tasks task where task.company_id=p_company_id and task.store_id=p_store_id
    and task.voucher_id=p_voucher_id order by task.attempt desc,task.queued_at desc limit 1 for update;
  if not found or v_latest.status not in ('failed','dead_letter','cancelled') then raise exception using errcode='55000',message='OCR_RETRY_NOT_ALLOWED'; end if;
  insert into public.zysyr_voucher_ocr_tasks(company_id,store_id,voucher_id,attempt,max_attempts,created_by_user_id)
  values(p_company_id,p_store_id,p_voucher_id,v_latest.attempt+1,least(10,greatest(v_latest.max_attempts,v_latest.attempt+3)),p_actor_user_id)
  returning * into v_saved;
  update public.zysyr_voucher_attachments set ocr_status='pending',updated_at=now(),updated_by_user_id=p_actor_user_id
    where company_id=p_company_id and store_id=p_store_id and id=p_voucher_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','voucher_attachment',p_voucher_id,'ocr_retry_requested',to_jsonb(v_saved),btrim(p_reason),'financial');
  return v_saved;
end $$;

create table public.zysyr_ai_analysis_runs(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,monthly_report_id uuid not null,analysis_type text not null default 'monthly_operations'
    check(analysis_type in ('monthly_operations','variance','voucher_completeness')),
  status text not null default 'queued' check(status in ('queued','processing','succeeded','failed','dead_letter','cancelled')),
  provider text,model text,prompt_version text,attempt integer not null default 1 check(attempt>0),max_attempts integer not null default 3,
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),snapshot_sha256 text not null check(snapshot_sha256~'^[0-9a-f]{64}$'),
  output_json jsonb,error_message text,lease_token uuid,leased_until timestamptz,next_attempt_at timestamptz not null default now(),
  requested_by_user_id uuid not null,requested_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,
  unique(company_id,id),unique(company_id,store_id,id),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,store_id,monthly_report_id) references public.zysyr_monthly_reports(company_id,store_id,id) on delete restrict,
  foreign key(company_id,requested_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict,
  check((status='processing' and lease_token is not null and leased_until is not null) or (status<>'processing' and lease_token is null and leased_until is null))
);
create index zysyr_ai_analysis_runs_queue_idx on public.zysyr_ai_analysis_runs(next_attempt_at,requested_at,id) where status='queued';
create index zysyr_ai_analysis_runs_scope_idx on public.zysyr_ai_analysis_runs(company_id,store_id,requested_at desc);

create table public.zysyr_questions(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,monthly_report_id uuid,title text not null check(nullif(btrim(title),'') is not null),
  body text not null check(nullif(btrim(body),'') is not null),status text not null default 'open' check(status in ('open','answered','closed')),
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),created_by_user_id uuid not null,created_at timestamptz not null default now(),
  answered_at timestamptz,closed_at timestamptz,unique(company_id,id),unique(company_id,store_id,id),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,store_id,monthly_report_id) references public.zysyr_monthly_reports(company_id,store_id,id) on delete restrict,
  foreign key(company_id,created_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict
);
create table public.zysyr_question_messages(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,question_id uuid not null,sender_user_id uuid not null,sender_role text not null,
  body text not null check(nullif(btrim(body),'') is not null),evidence_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence_snapshot)='object'),
  created_at timestamptz not null default now(),unique(company_id,id),
  foreign key(company_id,store_id,question_id) references public.zysyr_questions(company_id,store_id,id) on delete restrict,
  foreign key(company_id,sender_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict
);
create index zysyr_questions_scope_idx on public.zysyr_questions(company_id,store_id,created_at desc,status);
create index zysyr_question_messages_question_idx on public.zysyr_question_messages(company_id,question_id,created_at,id);
create trigger zysyr_question_messages_immutable before update or delete on public.zysyr_question_messages
for each row execute function zysyr_private.prevent_finance_line_mutation();

create or replace function zysyr_private.monthly_evidence_snapshot(p_company_id uuid,p_store_id uuid,p_monthly_report_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('monthly_report',jsonb_build_object('id',report.id,'period_month',report.period_month,'version',report.version,'status',report.status),
    'metrics',coalesce((select jsonb_agg(jsonb_build_object('line_id',line.id,'metric_code',line.metric_code,'metric_name',line.metric_name,
      'amount',line.amount,'calculation_method',line.calculation_method,'calculation_expression',line.calculation_expression,'source_count',line.source_count,
      'source_node_ids',coalesce((select jsonb_agg(target.entity_id order by target.entity_id) from public.zysyr_trace_nodes line_node
        join public.zysyr_trace_edges edge on edge.company_id=p_company_id and edge.from_node_id=line_node.id and edge.relation_type='derived_from'
        join public.zysyr_trace_nodes target on target.id=edge.to_node_id where line_node.company_id=p_company_id and line_node.entity_type='monthly_report_line' and line_node.entity_id=line.id),'[]'::jsonb)) order by line.line_number)
      from public.zysyr_monthly_report_lines line where line.company_id=p_company_id and line.store_id=p_store_id and line.monthly_report_id=report.id),'[]'::jsonb))
  from public.zysyr_monthly_reports report where report.company_id=p_company_id and report.store_id=p_store_id and report.id=p_monthly_report_id
$$;

create or replace function public.zysyr_request_ai_analysis(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_monthly_report_id uuid,p_analysis_type text,p_reason text
) returns public.zysyr_ai_analysis_runs language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_saved public.zysyr_ai_analysis_runs;
begin
  if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'ai_insight.read') then raise exception using errcode='42501',message='AI_ANALYSIS_FORBIDDEN'; end if;
  if p_analysis_type not in ('monthly_operations','variance','voucher_completeness') or nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='AI_ANALYSIS_INPUT_INVALID'; end if;
  v_snapshot:=zysyr_private.monthly_evidence_snapshot(p_company_id,p_store_id,p_monthly_report_id);
  if v_snapshot is null then raise exception using errcode='P0002',message='MONTHLY_REPORT_NOT_FOUND'; end if;
  insert into public.zysyr_ai_analysis_runs(company_id,store_id,monthly_report_id,analysis_type,evidence_snapshot,snapshot_sha256,requested_by_user_id)
  values(p_company_id,p_store_id,p_monthly_report_id,p_analysis_type,v_snapshot,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_snapshot::text,'UTF8')),'hex'),p_actor_user_id)
  returning * into v_saved;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','ai_analysis_run',v_saved.id,'request',jsonb_build_object('snapshot_sha256',v_saved.snapshot_sha256,'analysis_type',p_analysis_type),btrim(p_reason),'financial');
  return v_saved;
end $$;

create or replace function public.zysyr_claim_ai_analysis(p_provider text,p_model text,p_prompt_version text,p_lease_seconds integer default 180)
returns public.zysyr_ai_analysis_runs language plpgsql security definer set search_path='' as $$
declare v_saved public.zysyr_ai_analysis_runs;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into v_saved from public.zysyr_ai_analysis_runs run where (run.status='queued' and run.next_attempt_at<=now())
    or (run.status='processing' and run.leased_until<now()) order by run.next_attempt_at,run.requested_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.zysyr_ai_analysis_runs set status='processing',provider=btrim(p_provider),model=btrim(p_model),prompt_version=btrim(p_prompt_version),
    lease_token=gen_random_uuid(),leased_until=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(started_at,now())
    where id=v_saved.id returning * into v_saved; return v_saved;
end $$;

create or replace function public.zysyr_complete_ai_analysis(
  p_run_id uuid,p_lease_token uuid,p_succeeded boolean,p_retryable boolean,p_output_json jsonb,p_error_message text
) returns public.zysyr_ai_analysis_runs language plpgsql security definer set search_path='' as $$
declare v_run public.zysyr_ai_analysis_runs; v_citation jsonb; v_status text; v_delay integer;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into v_run from public.zysyr_ai_analysis_runs run where run.id=p_run_id and run.status='processing' and run.lease_token=p_lease_token and run.leased_until>=now() for update;
  if not found then raise exception using errcode='55000',message='AI_ANALYSIS_LEASE_INVALID'; end if;
  if p_succeeded then
    if jsonb_typeof(p_output_json)<>'object' or jsonb_typeof(p_output_json->'citations')<>'array' then raise exception using errcode='22023',message='AI_OUTPUT_INVALID'; end if;
    for v_citation in select value from jsonb_array_elements(p_output_json->'citations') loop
      if not exists(select 1 from jsonb_array_elements(v_run.evidence_snapshot->'metrics') metric
        where metric->>'line_id'=v_citation->>'metric_line_id' and (metric->>'amount')::numeric=(v_citation->>'amount')::numeric) then
        raise exception using errcode='22023',message='AI_CITATION_NOT_IN_SNAPSHOT'; end if;
    end loop;
    v_status:='succeeded';
  elsif p_retryable and v_run.attempt<v_run.max_attempts then v_status:='queued'; else v_status:='dead_letter'; end if;
  v_delay:=least(1800,60*(2^(v_run.attempt-1))::integer);
  update public.zysyr_ai_analysis_runs set status=v_status,output_json=case when v_status='succeeded' then p_output_json else null end,
    error_message=nullif(btrim(p_error_message),''),attempt=case when v_status='queued' then attempt+1 else attempt end,
    next_attempt_at=case when v_status='queued' then now()+make_interval(secs=>v_delay) else next_attempt_at end,
    lease_token=null,leased_until=null,completed_at=case when v_status in ('succeeded','dead_letter') then now() else null end
  where id=v_run.id returning * into v_run;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,service_actor,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(v_run.company_id,v_run.store_id,'system','operations-ai-worker','api','ai_analysis_run',v_run.id,'complete',jsonb_build_object('status',v_status,'snapshot_sha256',v_run.snapshot_sha256),
    coalesce(nullif(btrim(p_error_message),''),'AI分析只读完成，引用均已通过快照校验。'),'financial'); return v_run;
end $$;

create or replace function public.zysyr_create_question(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_monthly_report_id uuid,p_title text,p_body text
) returns public.zysyr_questions language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_saved public.zysyr_questions; v_role text;
begin
  if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'question.create') then raise exception using errcode='42501',message='QUESTION_CREATE_FORBIDDEN'; end if;
  if nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null then raise exception using errcode='22023',message='QUESTION_INPUT_INVALID'; end if;
  v_snapshot:=zysyr_private.monthly_evidence_snapshot(p_company_id,p_store_id,p_monthly_report_id);
  if v_snapshot is null then raise exception using errcode='P0002',message='MONTHLY_REPORT_NOT_FOUND'; end if;
  select role.code into v_role from public.zysyr_user_role_grants grant_row join public.zysyr_roles role on role.id=grant_row.role_id
    where grant_row.company_id=p_company_id and grant_row.user_account_id=p_actor_user_id and grant_row.revoked_at is null order by role.code limit 1;
  insert into public.zysyr_questions(company_id,store_id,monthly_report_id,title,body,evidence_snapshot,created_by_user_id)
  values(p_company_id,p_store_id,p_monthly_report_id,btrim(p_title),btrim(p_body),v_snapshot,p_actor_user_id) returning * into v_saved;
  insert into public.zysyr_question_messages(company_id,store_id,question_id,sender_user_id,sender_role,body,evidence_snapshot)
  values(p_company_id,p_store_id,v_saved.id,p_actor_user_id,coalesce(v_role,'authorized_user'),btrim(p_body),v_snapshot);
  return v_saved;
end $$;

create or replace function public.zysyr_respond_question(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_question_id uuid,p_body text
) returns public.zysyr_question_messages language plpgsql security definer set search_path='' as $$
declare v_question public.zysyr_questions; v_saved public.zysyr_question_messages;
begin
  if not zysyr_private.account_has_capability(p_actor_user_id,p_company_id,p_store_id,'question.respond') then raise exception using errcode='42501',message='QUESTION_RESPOND_FORBIDDEN'; end if;
  if nullif(btrim(p_body),'') is null then raise exception using errcode='22023',message='QUESTION_RESPONSE_INVALID'; end if;
  select * into v_question from public.zysyr_questions question where question.company_id=p_company_id and question.store_id=p_store_id and question.id=p_question_id and question.status<>'closed' for update;
  if not found then raise exception using errcode='P0002',message='OPEN_QUESTION_NOT_FOUND'; end if;
  insert into public.zysyr_question_messages(company_id,store_id,question_id,sender_user_id,sender_role,body,evidence_snapshot)
  values(p_company_id,p_store_id,p_question_id,p_actor_user_id,'finance',btrim(p_body),v_question.evidence_snapshot) returning * into v_saved;
  update public.zysyr_questions set status='answered',answered_at=coalesce(answered_at,now()) where id=p_question_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','question',p_question_id,'respond',jsonb_build_object('message_id',v_saved.id),'回复经营数据问题，证据快照保持不变。','financial');
  return v_saved;
end $$;

revoke execute on function public.zysyr_claim_voucher_ocr_task(text,text,text,integer) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_complete_voucher_ocr_task(uuid,uuid,boolean,boolean,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_retry_voucher_ocr(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_request_ai_analysis(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_claim_ai_analysis(text,text,text,integer) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_complete_ai_analysis(uuid,uuid,boolean,boolean,jsonb,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_create_question(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_respond_question(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_claim_voucher_ocr_task(text,text,text,integer) to service_role;
grant execute on function public.zysyr_complete_voucher_ocr_task(uuid,uuid,boolean,boolean,jsonb,jsonb,jsonb,text) to service_role;
grant execute on function public.zysyr_retry_voucher_ocr(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.zysyr_request_ai_analysis(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.zysyr_claim_ai_analysis(text,text,text,integer) to service_role;
grant execute on function public.zysyr_complete_ai_analysis(uuid,uuid,boolean,boolean,jsonb,text) to service_role;
grant execute on function public.zysyr_create_question(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.zysyr_respond_question(uuid,uuid,uuid,uuid,text) to service_role;
revoke execute on function zysyr_private.normalize_ocr_task_lease() from public,anon,authenticated,service_role;

alter table public.zysyr_ai_analysis_runs enable row level security;
alter table public.zysyr_ai_analysis_runs force row level security;
alter table public.zysyr_questions enable row level security;
alter table public.zysyr_questions force row level security;
alter table public.zysyr_question_messages enable row level security;
alter table public.zysyr_question_messages force row level security;
create policy zysyr_ai_analysis_runs_scope_select on public.zysyr_ai_analysis_runs for select to authenticated using (
  (select zysyr_private.has_capability(company_id,store_id,'ai_insight.read'))
);
create policy zysyr_questions_scope_select on public.zysyr_questions for select to authenticated using (
  (select zysyr_private.has_capability(company_id,store_id,'question.create'))
  or (select zysyr_private.has_capability(company_id,store_id,'question.respond'))
);
create policy zysyr_question_messages_scope_select on public.zysyr_question_messages for select to authenticated using (
  (select zysyr_private.has_capability(company_id,store_id,'question.create'))
  or (select zysyr_private.has_capability(company_id,store_id,'question.respond'))
);
revoke all on table public.zysyr_ai_analysis_runs,public.zysyr_questions,public.zysyr_question_messages
  from public,anon,authenticated,service_role;
grant select on table public.zysyr_ai_analysis_runs,public.zysyr_questions,public.zysyr_question_messages
  to authenticated,service_role;

comment on function public.zysyr_complete_ai_analysis(uuid,uuid,boolean,boolean,jsonb,text) is
  'Accepts read-only AI output only when every cited metric line and amount exactly matches the immutable request snapshot.';
comment on table public.zysyr_question_messages is
  'Append-only contextual questions and responses; every message preserves the monthly evidence snapshot visible at creation.';
