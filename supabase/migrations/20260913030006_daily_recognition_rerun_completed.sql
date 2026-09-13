-- Allow finance to rerun one completed date whether its previous machine pass
-- succeeded or failed. Manual overrides remain protected by the candidate
-- application function; the job counters are recalculated from scoped items.

create or replace function public.zysyr_retry_daily_recognition_item(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_job_id uuid,
  p_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.zysyr_daily_recognition_jobs;
  v_item public.zysyr_daily_recognition_job_items;
  v_success integer;
  v_failed integer;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id,p_company_id,p_store_id,'daily_report.write'
  );

  select * into v_job
    from public.zysyr_daily_recognition_jobs
   where id=p_job_id and company_id=p_company_id and store_id=p_store_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='DAILY_RECOGNITION_JOB_NOT_FOUND';
  end if;

  select * into v_item
    from public.zysyr_daily_recognition_job_items
   where id=p_item_id and job_id=p_job_id
     and company_id=p_company_id and store_id=p_store_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='DAILY_RECOGNITION_ITEM_NOT_FOUND';
  end if;
  if v_item.status not in ('succeeded','failed') then
    raise exception using errcode='22023',message='DAILY_RECOGNITION_ITEM_NOT_COMPLETED';
  end if;
  if v_item.attempt_count>=10 then
    raise exception using errcode='54000',message='DAILY_RECOGNITION_ITEM_RETRY_LIMIT';
  end if;
  if not exists(
    select 1 from public.zysyr_daily_sheet_drafts
     where company_id=p_company_id and store_id=p_store_id
       and id=v_item.draft_id and status='draft'
  ) then
    raise exception using errcode='55000',message='DAILY_SHEET_DRAFT_NOT_EDITABLE';
  end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_item.report_date) then
    raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED';
  end if;

  update public.zysyr_daily_recognition_job_items
     set status='queued',candidate_count=0,error_message=null,
         finished_at=null,updated_at=now()
   where id=p_item_id;

  select count(*) filter(where status='succeeded'),
         count(*) filter(where status='failed')
    into v_success,v_failed
    from public.zysyr_daily_recognition_job_items
   where company_id=p_company_id and store_id=p_store_id and job_id=p_job_id;

  update public.zysyr_daily_recognition_jobs
     set status='running',success_count=v_success,failed_count=v_failed,
         current_report_date=null,finished_at=null,updated_at=now()
   where id=p_job_id
   returning * into v_job;

  insert into public.zysyr_audit_events(
    company_id,store_id,actor_type,actor_user_id,channel,entity_type,
    entity_id,action,before_json,after_json,reason,sensitivity
  ) values (
    p_company_id,p_store_id,'user',p_actor_user_id,'api',
    'daily_recognition_job_item',p_item_id,'daily_recognition_item_retried',
    jsonb_build_object(
      'status',v_item.status,'report_date',v_item.report_date,
      'attempt_count',v_item.attempt_count,'candidate_count',v_item.candidate_count,
      'error_message',v_item.error_message
    ),
    jsonb_build_object(
      'status','queued','report_date',v_item.report_date,
      'attempt_count',v_item.attempt_count,'candidate_count',0
    ),
    '财务重新识别当天日报原图','financial'
  );

  return to_jsonb(v_job);
end $$;

revoke all on function public.zysyr_retry_daily_recognition_item(uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.zysyr_retry_daily_recognition_item(uuid,uuid,uuid,uuid,uuid)
  to service_role;
