-- Serialize confirmed daily changes with monthly adjustments; reject stale previews.
create or replace function zysyr_private.lock_daily_rollup_month()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||new.store_id::text||':'||date_trunc('month',new.report_date)::date::text,0));
  return new;
end $$;
create trigger daily_rollup_month_lock before insert or update on public.zysyr_daily_sheet_drafts
for each row execute function zysyr_private.lock_daily_rollup_month();
revoke all on function zysyr_private.lock_daily_rollup_month() from public,anon,authenticated;

create or replace function public.zysyr_save_daily_linked_monthly_adjustment(
 p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_source_kind text,p_source_id uuid,p_period_month date,
 p_expected_versions jsonb,p_expected_adjustments jsonb,p_base_amount numeric,p_before_amount numeric,p_after_amount numeric,p_reason text,
 p_daily_versions jsonb
) returns public.zysyr_monthly_income_adjustments language plpgsql security definer set search_path='' as $$
declare v_daily jsonb;
begin
 perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'confirmed_finance.adjust');
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||p_period_month::text,0));
 select coalesce(jsonb_object_agg(id::text,edit_revision),'{}'::jsonb) into v_daily from public.zysyr_daily_sheet_drafts
 where company_id=p_company_id and store_id=p_store_id and status='confirmed'
 and report_date>=p_period_month and report_date<(p_period_month+interval '1 month');
 if v_daily is distinct from p_daily_versions then raise exception using errcode='40001',message='MONTHLY_DATA_CHANGED_RELOAD';end if;
 return public.zysyr_save_monthly_income_adjustment(p_actor_user_id,p_company_id,p_store_id,p_source_kind,p_source_id,p_period_month,
 p_expected_versions,p_expected_adjustments,p_base_amount,p_before_amount,p_after_amount,p_reason);
end $$;
revoke all on function public.zysyr_save_daily_linked_monthly_adjustment(uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_save_daily_linked_monthly_adjustment(uuid,uuid,uuid,text,uuid,date,jsonb,jsonb,numeric,numeric,numeric,text,jsonb) to service_role;
