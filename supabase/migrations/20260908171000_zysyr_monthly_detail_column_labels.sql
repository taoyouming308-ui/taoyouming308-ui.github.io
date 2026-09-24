-- A detail column named 合计 is not a subtotal row. Preserve all existing
-- authorization, locking, revision and audit checks.
set lock_timeout = '5s';
set statement_timeout = '30s';
create or replace function public.zysyr_revise_history_monthly_cell(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_ledger_entry_id uuid,
  p_after_amount numeric,
  p_reason text
)
returns public.zysyr_history_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_history_ledger_entries;
  v_after public.zysyr_history_ledger_entries;
  v_payload jsonb;
  v_unlock public.zysyr_monthly_cell_unlock_requests;
  v_cell_kind text;
  v_label text;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if p_after_amount is null
     or abs(p_after_amount) > 99999999999999.9999
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_MONTHLY_CELL_CHANGE_INVALID';
  end if;

  select * into v_before
  from public.zysyr_history_ledger_entries entry
  where entry.company_id = p_company_id
    and entry.store_id = p_store_id
    and entry.id = p_ledger_entry_id
    and entry.entry_type = 'monthly_profit_loss'
    and entry.status = 'posted'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_MONTHLY_CELL_NOT_EDITABLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' || v_before.period_month::text, 0
  ));
  v_cell_kind := coalesce(v_before.current_payload->>'cell_kind', '');
  v_label := coalesce(v_before.current_payload->>'label', '');
  if v_cell_kind = 'formula' or v_label ~ '(编号|序号|员工号)' or v_label ~ '^[[:space:]]*(小计|合计|总计|盈亏)([[:space:]]*[/／·]|[[:space:]]*$)' then
    raise exception using errcode = '55000', message = 'HISTORY_MONTHLY_CELL_EDIT_FORBIDDEN';
  end if;
  if coalesce(v_before.current_payload->>'amount', '') !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception using errcode = '55000', message = 'HISTORY_MONTHLY_CELL_AMOUNT_MISSING';
  end if;
  if round((v_before.current_payload->>'amount')::numeric, 4) = round(p_after_amount, 4) then
    raise exception using errcode = '22023', message = 'HISTORY_MONTHLY_CELL_AMOUNT_UNCHANGED';
  end if;

  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_before.period_month) then
    select * into v_unlock
    from public.zysyr_monthly_cell_unlock_requests request
    where request.company_id = p_company_id
      and request.store_id = p_store_id
      and request.period_month = v_before.period_month
      and request.requested_by_user_id = p_actor_user_id
      and request.status = 'approved'
    order by request.decided_at asc
    limit 1 for update;
    if not found then
      raise exception using errcode = '55000', message = 'MONTHLY_UNLOCK_APPROVAL_REQUIRED';
    end if;
  end if;

  v_payload := jsonb_set(
    v_before.current_payload, '{amount}', to_jsonb(round(p_after_amount, 4)), true
  );
  insert into public.zysyr_history_ledger_revisions (
    company_id, store_id, ledger_entry_id, import_batch_id, import_row_id,
    version, action, before_payload, after_payload, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.id, v_before.import_batch_id,
    v_before.import_row_id, v_before.version + 1, 'revise_monthly_amount',
    v_before.current_payload, v_payload, btrim(p_reason), p_actor_user_id
  );
  update public.zysyr_history_ledger_entries set
    current_payload = v_payload, version = v_before.version + 1,
    last_modified_by_user_id = p_actor_user_id, last_modified_at = clock_timestamp()
  where company_id = p_company_id and id = v_before.id
  returning * into v_after;

  insert into public.zysyr_history_import_events (
    company_id, store_id, import_batch_id, import_row_id, action,
    before_json, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.import_batch_id, v_before.import_row_id,
    'ledger_revise_monthly_amount', v_before.current_payload, v_after.current_payload,
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'history_monthly_cell', v_after.id, 'amount_change',
    jsonb_build_object('amount', v_before.current_payload->'amount',
      'period_month', v_before.period_month,
      'cell_address', v_before.current_payload->>'cell_address'),
    jsonb_build_object('amount', v_after.current_payload->'amount',
      'period_month', v_after.period_month,
      'cell_address', v_after.current_payload->>'cell_address',
      'version', v_after.version, 'unlock_request_id', v_unlock.id),
    btrim(p_reason), 'financial'
  );
  if v_unlock.id is not null then
    update public.zysyr_monthly_cell_unlock_requests
    set status = 'consumed', consumed_at = clock_timestamp()
    where company_id = p_company_id and id = v_unlock.id;
  end if;
  return v_after;
end
$$;
