CREATE OR REPLACE FUNCTION public.zysyr_review_daily_report_core_v429(p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_daily_report_id uuid, p_decision text, p_reason text)
 RETURNS zysyr_daily_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before public.zysyr_daily_reports;
  v_after public.zysyr_daily_reports;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );
  if p_decision not in ('approved', 'rejected')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_REVIEW_INVALID';
  end if;
  select * into v_before
  from public.zysyr_daily_reports report
  where report.id = p_daily_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_REPORT_NOT_FOUND';
  end if;
  if v_before.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'DAILY_REPORT_NOT_SUBMITTED';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  update public.zysyr_daily_reports
  set status = p_decision,
      reviewed_by_user_id = p_actor_user_id,
      reviewed_at = now(),
      review_reason = btrim(p_reason)
  where id = p_daily_report_id and company_id = p_company_id
  returning * into v_after;

  insert into public.zysyr_income_records (
    company_id, store_id, income_date, category_code, summary, amount,
    daily_report_id, daily_report_line_id, source_report_cell_id,
    approved_by_user_id, approved_at
  )
  select
    line.company_id, line.store_id, v_after.report_date, line.metric_code,
    line.description, line.amount, line.daily_report_id, line.id,
    line.source_report_cell_id, p_actor_user_id, v_after.reviewed_at
  from public.zysyr_daily_report_lines line
  where p_decision = 'approved'
    and line.company_id = p_company_id
    and line.store_id = p_store_id
    and line.daily_report_id = p_daily_report_id
    and line.line_type = 'income'
  on conflict (company_id, daily_report_line_id) do nothing;

  insert into public.zysyr_workflow_events (
    company_id, store_id, entity_type, entity_id, from_status, to_status,
    action, actor_user_id, reason
  ) values (
    p_company_id, p_store_id, 'daily_report', p_daily_report_id, 'submitted',
    p_decision, case when p_decision = 'approved' then 'approve' else 'reject' end,
    p_actor_user_id, btrim(p_reason)
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_report',
    p_daily_report_id, case when p_decision = 'approved' then 'approve' else 'reject' end,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object(
      'status', v_after.status, 'reviewed_at', v_after.reviewed_at,
      'income_record_count', case when p_decision = 'approved' then (
        select count(*) from public.zysyr_income_records income
        where income.company_id = p_company_id
          and income.daily_report_id = p_daily_report_id
      ) else 0 end
    ), btrim(p_reason), 'financial'
  );
  return v_after;
end
$function$;
