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

-- Kimi vision results are persisted as review candidates. They never set
-- manual_override and therefore remain distinguishable from finance edits.
alter table public.zysyr_daily_sheet_cells
  drop constraint if exists zysyr_daily_sheet_cells_source_method_check;
alter table public.zysyr_daily_sheet_cells
  add constraint zysyr_daily_sheet_cells_source_method_check check (
    source_method in ('openai_vision','paddle_ocr','blank_template','kimi_vision_candidate')
  );

create or replace function public.zysyr_apply_daily_sheet_recognition_candidates(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
  p_voucher_id uuid,p_expected_revision integer,p_candidates jsonb,p_model text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_voucher public.zysyr_voucher_attachments;
  v_item jsonb;
  v_cell public.zysyr_daily_sheet_cells;
  v_value numeric;
  v_confidence numeric;
  v_saved integer := 0;
  v_manual_skipped integer := 0;
  v_revision integer;
  v_validation jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 1000
    or nullif(btrim(p_model),'') is null then
    raise exception using errcode='22023',message='DAILY_RECOGNITION_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts d
  where d.company_id=p_company_id and d.store_id=p_store_id and d.id=p_draft_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND';end if;
  if v_draft.status <> 'draft' then raise exception using errcode='55000',message='DAILY_SHEET_DRAFT_NOT_EDITABLE';end if;
  if v_draft.edit_revision <> p_expected_revision then raise exception using errcode='40001',message='DAILY_SHEET_CHANGED_RELOAD';end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_draft.report_date) then
    raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED';
  end if;
  select * into v_voucher from public.zysyr_voucher_attachments v
  where v.company_id=p_company_id and v.store_id=p_store_id and v.id=p_voucher_id
    and v.audit_status='approved' and v.document_type='daily_report';
  if not found then raise exception using errcode='P0002',message='APPROVED_DAILY_VOUCHER_REQUIRED';end if;
  if not (v_draft.source_voucher_id=p_voucher_id or exists(
    select 1 from public.zysyr_daily_sheet_attachments a where a.company_id=p_company_id
      and a.store_id=p_store_id and a.draft_id=p_draft_id and a.voucher_id=p_voucher_id
      and a.attachment_kind='original_report'
  )) then raise exception using errcode='42501',message='DAILY_VOUCHER_NOT_LINKED';end if;

  for v_item in select value from jsonb_array_elements(p_candidates) loop
    if coalesce(v_item->>'id','') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_INVALID';
    end if;
    select * into v_cell from public.zysyr_daily_sheet_cells c
    where c.company_id=p_company_id and c.store_id=p_store_id and c.draft_id=p_draft_id
      and c.id=(v_item->>'id')::uuid for update;
    if not found then raise exception using errcode='P0002',message='DAILY_SHEET_CELL_NOT_FOUND';end if;
    if v_cell.cell_role in ('signature','unclosed_order','note') then
      raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_ROLE_INVALID';
    end if;
    v_value := nullif(v_item->>'value','')::numeric;
    v_confidence := nullif(v_item->>'confidence','')::numeric;
    if v_value is null or v_value < 0 or v_value > 999999999999.99
      or v_confidence is null or v_confidence < 0 or v_confidence > 1 then
      raise exception using errcode='22023',message='DAILY_RECOGNITION_VALUE_INVALID';
    end if;
    if v_cell.manual_override then
      v_manual_skipped := v_manual_skipped + 1;
    else
      update public.zysyr_daily_sheet_cells set ocr_numeric=v_value,ocr_text=v_value::text,
        confidence=v_confidence,source_method='kimi_vision_candidate',bbox=null,
        updated_by_user_id=p_actor_user_id,updated_at=now() where id=v_cell.id;
      v_saved := v_saved + 1;
    end if;
  end loop;
  v_revision := v_draft.edit_revision + 1;
  v_validation := zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision=v_revision,validation_result=v_validation,
    ocr_provider='moonshot',ocr_model=btrim(p_model),updated_by_user_id=p_actor_user_id,updated_at=now()
  where id=p_draft_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,
    'daily_recognition_candidates_saved',jsonb_build_object('revision',v_draft.edit_revision),
    jsonb_build_object('revision',v_revision,'voucher_id',p_voucher_id,'model',btrim(p_model),
      'candidate_count',jsonb_array_length(p_candidates),'saved_cells',v_saved,
      'manual_cells_preserved',v_manual_skipped,'validation',v_validation),
    '原图识别候选已保存，等待财务逐格核对并最终确认','financial');
  return jsonb_build_object('draft_id',p_draft_id,'revision',v_revision,'saved_cells',v_saved,
    'manual_cells_preserved',v_manual_skipped,'validation',v_validation);
end $$;
revoke all on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text)
  to service_role;
