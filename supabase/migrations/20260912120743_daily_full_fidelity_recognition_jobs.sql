-- Full-fidelity Codex candidates and durable, resumable monthly progress.
-- All writes stay behind the existing finance capability boundary; browser
-- roles cannot access these coordination tables directly.

alter table public.zysyr_daily_sheet_cells
  add column if not exists row_label_source_method text not null default 'template'
    check (row_label_source_method in ('template','codex_local_candidate','manual')),
  add column if not exists row_label_confidence numeric(5,4)
    check (row_label_confidence is null or row_label_confidence between 0 and 1);

create or replace function zysyr_private.mark_daily_row_label_manual()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.before_label is distinct from new.after_label then
    update public.zysyr_daily_sheet_cells
       set row_label_source_method='manual',row_label_confidence=null
     where company_id=new.company_id and store_id=new.store_id and draft_id=new.draft_id
       and section_code=(select section_code from public.zysyr_daily_sheet_cells where id=new.cell_id)
       and row_key=(select row_key from public.zysyr_daily_sheet_cells where id=new.cell_id);
  end if;
  return new;
end $$;
revoke all on function zysyr_private.mark_daily_row_label_manual() from public,anon,authenticated,service_role;
drop trigger if exists zysyr_daily_row_label_manual on public.zysyr_daily_sheet_cell_changes;
create trigger zysyr_daily_row_label_manual after insert on public.zysyr_daily_sheet_cell_changes
for each row execute function zysyr_private.mark_daily_row_label_manual();

create table public.zysyr_daily_recognition_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  period_month date not null check (period_month=date_trunc('month',period_month)::date),
  schema_version integer not null default 2 check (schema_version=2),
  status text not null default 'pending' check (status in ('pending','running','paused','completed','completed_with_errors')),
  total_count integer not null default 0 check (total_count>=0),
  success_count integer not null default 0 check (success_count>=0),
  failed_count integer not null default 0 check (failed_count>=0),
  current_report_date date,
  requested_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,requested_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict
);
create unique index zysyr_daily_recognition_one_active_month
  on public.zysyr_daily_recognition_jobs(company_id,store_id,period_month)
  where status in ('pending','running','paused');
create index zysyr_daily_recognition_jobs_scope_idx
  on public.zysyr_daily_recognition_jobs(company_id,store_id,period_month desc,updated_at desc);

create table public.zysyr_daily_recognition_job_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  job_id uuid not null,
  draft_id uuid not null,
  voucher_id uuid not null,
  report_date date not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  candidate_count integer not null default 0 check (candidate_count>=0),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,job_id,draft_id),
  foreign key(company_id,job_id) references public.zysyr_daily_recognition_jobs(company_id,id) on delete restrict,
  foreign key(company_id,store_id,draft_id) references public.zysyr_daily_sheet_drafts(company_id,store_id,id) on delete restrict,
  foreign key(company_id,voucher_id) references public.zysyr_voucher_attachments(company_id,id) on delete restrict
);
create index zysyr_daily_recognition_items_next_idx
  on public.zysyr_daily_recognition_job_items(company_id,store_id,job_id,status,report_date);

alter table public.zysyr_daily_recognition_jobs enable row level security;
alter table public.zysyr_daily_recognition_jobs force row level security;
alter table public.zysyr_daily_recognition_job_items enable row level security;
alter table public.zysyr_daily_recognition_job_items force row level security;
revoke all on table public.zysyr_daily_recognition_jobs,public.zysyr_daily_recognition_job_items from public,anon,authenticated,service_role;
grant select,insert,update on table public.zysyr_daily_recognition_jobs,public.zysyr_daily_recognition_job_items to service_role;

create or replace function public.zysyr_start_daily_recognition_job(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_period_month date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.zysyr_daily_recognition_jobs; v_total integer;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  if p_period_month<>date_trunc('month',p_period_month)::date then raise exception using errcode='22023',message='DAILY_RECOGNITION_MONTH_INVALID'; end if;
  select * into v_job from public.zysyr_daily_recognition_jobs
   where company_id=p_company_id and store_id=p_store_id and period_month=p_period_month
     and status in ('pending','running','paused') order by created_at desc limit 1 for update;
  if found then return to_jsonb(v_job); end if;
  insert into public.zysyr_daily_recognition_jobs(company_id,store_id,period_month,requested_by_user_id)
  values(p_company_id,p_store_id,p_period_month,p_actor_user_id) returning * into v_job;
  insert into public.zysyr_daily_recognition_job_items(company_id,store_id,job_id,draft_id,voucher_id,report_date)
  select p_company_id,p_store_id,v_job.id,d.id,source.voucher_id,d.report_date
    from public.zysyr_daily_sheet_drafts d
    join lateral (
      select a.voucher_id from public.zysyr_daily_sheet_attachments a
      join public.zysyr_voucher_attachments v on v.company_id=a.company_id and v.id=a.voucher_id
      where a.company_id=p_company_id and a.store_id=p_store_id and a.draft_id=d.id
        and a.attachment_kind='original_report' and v.audit_status='approved'
        and v.store_id=p_store_id
        and v.mime_type in ('image/jpeg','image/png') order by a.linked_at desc limit 1
    ) source on true
   where d.company_id=p_company_id and d.store_id=p_store_id and d.status='draft'
     and d.report_date>=p_period_month and d.report_date<(p_period_month+interval '1 month')::date;
  get diagnostics v_total=row_count;
  if v_total=0 then delete from public.zysyr_daily_recognition_jobs where id=v_job.id; raise exception using errcode='P0002',message='DAILY_RECOGNITION_NO_IMAGES'; end if;
  update public.zysyr_daily_recognition_jobs set total_count=v_total,status='running',started_at=now(),updated_at=now() where id=v_job.id returning * into v_job;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_recognition_job',v_job.id,'daily_recognition_job_started',null,
    jsonb_build_object('period_month',p_period_month,'total_count',v_total,'schema_version',2),'财务启动整月日报原图候选识别','financial');
  return to_jsonb(v_job);
end $$;

create or replace function public.zysyr_claim_daily_recognition_item(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_job_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.zysyr_daily_recognition_jobs; v_item public.zysyr_daily_recognition_job_items;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_job from public.zysyr_daily_recognition_jobs where id=p_job_id and company_id=p_company_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_RECOGNITION_JOB_NOT_FOUND'; end if;
  if v_job.status='paused' then return jsonb_build_object('job',to_jsonb(v_job),'item',null); end if;
  if v_job.status not in ('pending','running') then return jsonb_build_object('job',to_jsonb(v_job),'item',null); end if;
  update public.zysyr_daily_recognition_job_items set status='queued',error_message='上次页面离开后自动恢复',updated_at=now()
   where job_id=p_job_id and status='running' and started_at<now()-interval '3 minutes';
  -- A second browser tab may reopen the same month while the first request is
  -- still running. Keep one image in flight so the local Codex bridge is never
  -- fed parallel duplicates.
  if exists(select 1 from public.zysyr_daily_recognition_job_items
    where company_id=p_company_id and store_id=p_store_id and job_id=p_job_id and status='running')
  then return jsonb_build_object('job',to_jsonb(v_job),'item',null); end if;
  select * into v_item from public.zysyr_daily_recognition_job_items
   where company_id=p_company_id and store_id=p_store_id and job_id=p_job_id and status='queued'
   order by report_date for update skip locked limit 1;
  if not found then return jsonb_build_object('job',to_jsonb(v_job),'item',null); end if;
  update public.zysyr_daily_recognition_job_items set status='running',attempt_count=attempt_count+1,started_at=now(),finished_at=null,error_message=null,updated_at=now()
   where id=v_item.id returning * into v_item;
  update public.zysyr_daily_recognition_jobs set status='running',current_report_date=v_item.report_date,updated_at=now() where id=p_job_id returning * into v_job;
  return jsonb_build_object('job',to_jsonb(v_job),'item',to_jsonb(v_item));
end $$;

create or replace function public.zysyr_finish_daily_recognition_item(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_job_id uuid,p_item_id uuid,
  p_succeeded boolean,p_candidate_count integer,p_error_message text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.zysyr_daily_recognition_jobs; v_item public.zysyr_daily_recognition_job_items; v_success integer; v_failed integer; v_done integer;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_job from public.zysyr_daily_recognition_jobs where id=p_job_id and company_id=p_company_id and store_id=p_store_id for update;
  select * into v_item from public.zysyr_daily_recognition_job_items where id=p_item_id and job_id=p_job_id and company_id=p_company_id and store_id=p_store_id for update;
  if v_job.id is null or v_item.id is null then raise exception using errcode='P0002',message='DAILY_RECOGNITION_ITEM_NOT_FOUND'; end if;
  update public.zysyr_daily_recognition_job_items set status=case when p_succeeded then 'succeeded' else 'failed' end,
    candidate_count=greatest(coalesce(p_candidate_count,0),0),error_message=case when p_succeeded then null else left(coalesce(p_error_message,'识别失败'),500) end,
    finished_at=now(),updated_at=now() where id=p_item_id;
  select count(*) filter(where status='succeeded'),count(*) filter(where status='failed'),count(*) filter(where status in ('succeeded','failed','skipped'))
    into v_success,v_failed,v_done from public.zysyr_daily_recognition_job_items where job_id=p_job_id;
  update public.zysyr_daily_recognition_jobs set success_count=v_success,failed_count=v_failed,current_report_date=null,
    status=case when v_done>=total_count then case when v_failed>0 then 'completed_with_errors' else 'completed' end else status end,
    finished_at=case when v_done>=total_count then now() else null end,updated_at=now() where id=p_job_id returning * into v_job;
  return to_jsonb(v_job);
end $$;

create or replace function public.zysyr_control_daily_recognition_job(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_job_id uuid,p_action text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.zysyr_daily_recognition_jobs;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_job from public.zysyr_daily_recognition_jobs where id=p_job_id and company_id=p_company_id and store_id=p_store_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_RECOGNITION_JOB_NOT_FOUND'; end if;
  if p_action='pause' and v_job.status in ('pending','running') then update public.zysyr_daily_recognition_jobs set status='paused',updated_at=now() where id=p_job_id;
  elsif p_action='resume' and v_job.status='paused' then update public.zysyr_daily_recognition_jobs set status='running',updated_at=now() where id=p_job_id;
  elsif p_action='retry_failed' and v_job.status in ('completed_with_errors','paused') then
    update public.zysyr_daily_recognition_job_items set status='queued',error_message=null,finished_at=null,updated_at=now() where job_id=p_job_id and status='failed' and attempt_count<10;
    update public.zysyr_daily_recognition_jobs set status='running',failed_count=0,finished_at=null,updated_at=now() where id=p_job_id;
  else raise exception using errcode='22023',message='DAILY_RECOGNITION_JOB_ACTION_INVALID'; end if;
  select * into v_job from public.zysyr_daily_recognition_jobs where id=p_job_id;
  return to_jsonb(v_job);
end $$;

revoke all on function public.zysyr_start_daily_recognition_job(uuid,uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.zysyr_claim_daily_recognition_item(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.zysyr_finish_daily_recognition_item(uuid,uuid,uuid,uuid,uuid,boolean,integer,text) from public,anon,authenticated;
revoke all on function public.zysyr_control_daily_recognition_job(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.zysyr_start_daily_recognition_job(uuid,uuid,uuid,date) to service_role;
grant execute on function public.zysyr_claim_daily_recognition_item(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.zysyr_finish_daily_recognition_item(uuid,uuid,uuid,uuid,uuid,boolean,integer,text) to service_role;
grant execute on function public.zysyr_control_daily_recognition_job(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.zysyr_apply_daily_sheet_recognition_candidates(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
  p_voucher_id uuid,p_expected_revision integer,p_candidates jsonb,p_model text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_draft public.zysyr_daily_sheet_drafts; v_voucher public.zysyr_voucher_attachments; v_item jsonb; v_cell public.zysyr_daily_sheet_cells;
  v_value numeric; v_confidence numeric; v_text text; v_saved integer:=0; v_text_saved integer:=0; v_names_saved integer:=0; v_manual_skipped integer:=0;
  v_revision integer; v_validation jsonb; v_numeric jsonb; v_texts jsonb; v_names jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  v_numeric:=coalesce(p_candidates->'cells','[]'::jsonb); v_texts:=coalesce(p_candidates->'text_cells','[]'::jsonb); v_names:=coalesce(p_candidates->'row_names','[]'::jsonb);
  if jsonb_typeof(p_candidates)<>'object' or jsonb_typeof(v_numeric)<>'array' or jsonb_typeof(v_texts)<>'array' or jsonb_typeof(v_names)<>'array'
    or jsonb_array_length(v_numeric)+jsonb_array_length(v_texts)+jsonb_array_length(v_names) not between 1 and 1200 or nullif(btrim(p_model),'') is null
  then raise exception using errcode='22023',message='DAILY_RECOGNITION_INPUT_INVALID'; end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status<>'draft' then raise exception using errcode='55000',message='DAILY_SHEET_DRAFT_NOT_EDITABLE'; end if;
  if v_draft.edit_revision<>p_expected_revision then raise exception using errcode='40001',message='DAILY_SHEET_CHANGED_RELOAD'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_draft.report_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  select * into v_voucher from public.zysyr_voucher_attachments where company_id=p_company_id and store_id=p_store_id and id=p_voucher_id and audit_status='approved' and document_type='daily_report';
  if not found then raise exception using errcode='P0002',message='APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  if not(v_draft.source_voucher_id=p_voucher_id or exists(select 1 from public.zysyr_daily_sheet_attachments where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and voucher_id=p_voucher_id and attachment_kind='original_report'))
  then raise exception using errcode='42501',message='DAILY_VOUCHER_NOT_LINKED'; end if;

  -- A new full-table pass replaces only older machine candidates. Human edits stay untouched.
  update public.zysyr_daily_sheet_cells set ocr_numeric=null,ocr_text=null,confidence=null,source_method='blank_template',updated_by_user_id=p_actor_user_id,updated_at=now()
   where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and not manual_override
     and source_method in ('openai_vision_candidate','kimi_vision_candidate','codex_local_candidate');

  for v_item in select value from jsonb_array_elements(v_numeric) loop
    if coalesce(v_item->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_INVALID'; end if;
    select * into v_cell from public.zysyr_daily_sheet_cells where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and id=(v_item->>'id')::uuid for update;
    if not found or v_cell.cell_role in ('signature','unclosed_order','note') then raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_INVALID'; end if;
    v_value:=nullif(v_item->>'value','')::numeric; v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if v_value is null or v_value<0 or v_value>999999999999.99 or v_confidence is null or v_confidence not between 0 and 1 then raise exception using errcode='22023',message='DAILY_RECOGNITION_VALUE_INVALID'; end if;
    if v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_numeric=v_value,ocr_text=v_value::text,confidence=v_confidence,source_method='codex_local_candidate',updated_by_user_id=p_actor_user_id,updated_at=now() where id=v_cell.id;
      v_saved:=v_saved+1;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_texts) loop
    if coalesce(v_item->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='DAILY_RECOGNITION_TEXT_INVALID'; end if;
    select * into v_cell from public.zysyr_daily_sheet_cells where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and id=(v_item->>'id')::uuid for update;
    v_text:=nullif(btrim(v_item->>'value'),''); v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if not found or v_cell.cell_role not in ('unclosed_order','note') or v_text is null or char_length(v_text)>500 or v_confidence is null or v_confidence not between 0 and 1 then raise exception using errcode='22023',message='DAILY_RECOGNITION_TEXT_INVALID'; end if;
    if v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_text=v_text,confidence=v_confidence,source_method='codex_local_candidate',updated_by_user_id=p_actor_user_id,updated_at=now() where id=v_cell.id;
      v_text_saved:=v_text_saved+1;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_names) loop
    v_text:=nullif(btrim(v_item->>'name'),''); v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if (v_item->>'section') not in ('stylist','technician','product') or coalesce(v_item->>'row_key','') !~ '^[a-z0-9_]{1,80}$'
      or v_text is null or char_length(v_text)>120 or v_confidence is null or v_confidence not between 0 and 1
    then raise exception using errcode='22023',message='DAILY_RECOGNITION_NAME_INVALID'; end if;
    if exists(select 1 from public.zysyr_daily_sheet_cell_changes ch join public.zysyr_daily_sheet_cells c on c.id=ch.cell_id
      where ch.company_id=p_company_id and ch.store_id=p_store_id and ch.draft_id=p_draft_id and c.section_code=v_item->>'section' and c.row_key=v_item->>'row_key' and ch.before_label is distinct from ch.after_label)
    then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set row_label=v_text,row_label_source_method='codex_local_candidate',row_label_confidence=v_confidence,updated_by_user_id=p_actor_user_id,updated_at=now()
       where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and section_code=v_item->>'section' and row_key=v_item->>'row_key';
      if found then v_names_saved:=v_names_saved+1; end if;
    end if;
  end loop;
  v_revision:=v_draft.edit_revision+1; v_validation:=zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision=v_revision,validation_result=v_validation,ocr_provider='codex-local',ocr_model=btrim(p_model),updated_by_user_id=p_actor_user_id,updated_at=now() where id=p_draft_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'daily_full_recognition_candidates_saved',jsonb_build_object('revision',v_draft.edit_revision),
    jsonb_build_object('revision',v_revision,'voucher_id',p_voucher_id,'provider','codex-local','model',btrim(p_model),'numeric_cells',v_saved,'text_cells',v_text_saved,'row_names',v_names_saved,'manual_cells_preserved',v_manual_skipped,'validation',v_validation),
    '本机Codex整张原图候选已保存，等待财务逐格核对并最终确认','financial');
  return jsonb_build_object('draft_id',p_draft_id,'revision',v_revision,'saved_cells',v_saved,'saved_text_cells',v_text_saved,'saved_row_names',v_names_saved,'manual_cells_preserved',v_manual_skipped,'validation',v_validation,'provider','codex-local');
end $$;
revoke all on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text) to service_role;
