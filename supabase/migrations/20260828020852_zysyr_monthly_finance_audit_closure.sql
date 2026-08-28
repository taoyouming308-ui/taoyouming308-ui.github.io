-- ZYSYR V2: audited monthly-cell revisions, cell-specific voucher evidence,
-- and one-time administrator approval for corrections in a locked month.
-- Uploaded report cells remain immutable source evidence.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_monthly_cell_unlock_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  period_month date not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'consumed', 'cancelled')),
  requested_by_user_id uuid not null,
  request_reason text not null check (nullif(btrim(request_reason), '') is not null),
  requested_at timestamptz not null default now(),
  decided_by_user_id uuid,
  decision_reason text,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, requested_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, decided_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date),
  check (
    (status = 'pending' and decided_by_user_id is null and decided_at is null)
    or (status in ('approved', 'rejected', 'consumed')
      and decided_by_user_id is not null and decided_at is not null
      and nullif(btrim(decision_reason), '') is not null)
    or (status = 'cancelled')
  ),
  check ((status = 'consumed') = (consumed_at is not null))
);

create unique index zysyr_monthly_unlock_pending_uidx
  on public.zysyr_monthly_cell_unlock_requests
  (company_id, store_id, period_month, requested_by_user_id)
  where status in ('pending', 'approved');
create index zysyr_monthly_unlock_scope_idx
  on public.zysyr_monthly_cell_unlock_requests
  (company_id, store_id, period_month desc, status, requested_at desc);
create index zysyr_monthly_unlock_decider_idx
  on public.zysyr_monthly_cell_unlock_requests
  (company_id, decided_by_user_id, decided_at desc)
  where decided_by_user_id is not null;

create table public.zysyr_monthly_cell_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  report_id uuid not null,
  source_cell_id uuid not null,
  period_month date not null,
  cell_address text not null check (cell_address ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'),
  cell_label text not null default '',
  revision integer not null check (revision > 0),
  revision_type text not null check (revision_type in ('amount_change', 'evidence_update')),
  supersedes_revision_id uuid,
  before_amount numeric(18,4) not null,
  after_amount numeric(18,4) not null,
  delta numeric(18,4) generated always as (after_amount - before_amount) stored,
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_user_id uuid not null,
  unlock_request_id uuid,
  voucher_count integer not null default 0 check (voucher_count >= 0),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, source_cell_id, revision),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, source_cell_id)
    references public.zysyr_report_cells(company_id, store_id, id) on delete restrict,
  foreign key (company_id, supersedes_revision_id)
    references public.zysyr_monthly_cell_revisions(company_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, unlock_request_id)
    references public.zysyr_monthly_cell_unlock_requests(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date),
  check ((revision = 1 and supersedes_revision_id is null)
    or (revision > 1 and supersedes_revision_id is not null)),
  check ((revision_type = 'amount_change' and before_amount <> after_amount)
    or (revision_type = 'evidence_update' and before_amount = after_amount))
);

create index zysyr_monthly_cell_revision_latest_idx
  on public.zysyr_monthly_cell_revisions
  (company_id, source_cell_id, revision desc);
create index zysyr_monthly_cell_revision_scope_idx
  on public.zysyr_monthly_cell_revisions
  (company_id, store_id, period_month desc, created_at desc);
create index zysyr_monthly_cell_revision_actor_idx
  on public.zysyr_monthly_cell_revisions
  (company_id, actor_user_id, created_at desc);
create index zysyr_monthly_cell_revision_unlock_idx
  on public.zysyr_monthly_cell_revisions
  (company_id, unlock_request_id)
  where unlock_request_id is not null;

create table public.zysyr_monthly_cell_revision_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  revision_id uuid not null,
  voucher_id uuid not null,
  linked_by_user_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, revision_id, voucher_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, revision_id)
    references public.zysyr_monthly_cell_revisions(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, linked_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_monthly_cell_revision_voucher_idx
  on public.zysyr_monthly_cell_revision_vouchers (company_id, voucher_id, linked_at desc);

create or replace function zysyr_private.protect_monthly_cell_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'MONTHLY_CELL_HISTORY_IMMUTABLE';
end
$$;

revoke execute on function zysyr_private.protect_monthly_cell_history()
  from public, anon, authenticated, service_role;

create trigger zysyr_monthly_cell_revisions_append_only
before update or delete on public.zysyr_monthly_cell_revisions
for each row execute function zysyr_private.protect_monthly_cell_history();

create trigger zysyr_monthly_cell_revision_vouchers_append_only
before update or delete on public.zysyr_monthly_cell_revision_vouchers
for each row execute function zysyr_private.protect_monthly_cell_history();

create or replace function zysyr_private.assert_monthly_unlock_approver(
  p_actor_user_id uuid,
  p_company_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not zysyr_private.account_has_company_capability(
    p_actor_user_id, p_company_id, 'finance_account.create'
  ) then
    raise exception using errcode = '42501', message = 'MONTHLY_UNLOCK_APPROVER_REQUIRED';
  end if;
end
$$;

revoke execute on function zysyr_private.assert_monthly_unlock_approver(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.zysyr_request_monthly_cell_unlock(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_period_month date,
  p_reason text
)
returns public.zysyr_monthly_cell_unlock_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.zysyr_monthly_cell_unlock_requests;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if p_period_month is null
     or p_period_month <> date_trunc('month', p_period_month)::date
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_UNLOCK_REQUEST_INVALID';
  end if;
  if not zysyr_private.period_is_locked(p_company_id, p_store_id, p_period_month) then
    raise exception using errcode = '55000', message = 'MONTHLY_PERIOD_NOT_LOCKED';
  end if;
  insert into public.zysyr_monthly_cell_unlock_requests (
    company_id, store_id, period_month, requested_by_user_id, request_reason
  ) values (
    p_company_id, p_store_id, p_period_month, p_actor_user_id, btrim(p_reason)
  ) returning * into v_saved;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'monthly_cell_unlock_request', v_saved.id, 'unlock_request',
    jsonb_build_object('period_month', p_period_month, 'status', v_saved.status),
    btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_decide_monthly_cell_unlock(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns public.zysyr_monthly_cell_unlock_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_monthly_cell_unlock_requests;
  v_after public.zysyr_monthly_cell_unlock_requests;
begin
  perform zysyr_private.assert_monthly_unlock_approver(p_actor_user_id, p_company_id);
  if p_decision not in ('approved', 'rejected')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_UNLOCK_DECISION_INVALID';
  end if;
  select * into v_before
  from public.zysyr_monthly_cell_unlock_requests request
  where request.id = p_request_id and request.company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MONTHLY_UNLOCK_REQUEST_NOT_FOUND';
  end if;
  if v_before.status <> 'pending' then
    raise exception using errcode = '55000', message = 'MONTHLY_UNLOCK_REQUEST_ALREADY_DECIDED';
  end if;
  if v_before.requested_by_user_id = p_actor_user_id then
    raise exception using errcode = '42501', message = 'MONTHLY_UNLOCK_SELF_APPROVAL_FORBIDDEN';
  end if;
  update public.zysyr_monthly_cell_unlock_requests
  set status = p_decision,
      decided_by_user_id = p_actor_user_id,
      decision_reason = btrim(p_reason),
      decided_at = now()
  where company_id = p_company_id and id = p_request_id
  returning * into v_after;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, v_after.store_id, 'user', p_actor_user_id, 'api',
    'monthly_cell_unlock_request', v_after.id,
    case when p_decision = 'approved' then 'unlock_approve' else 'unlock_reject' end,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'period_month', v_after.period_month),
    btrim(p_reason), 'financial'
  );
  return v_after;
end
$$;

create or replace function public.zysyr_revise_monthly_cells(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_report_id uuid,
  p_changes jsonb,
  p_voucher_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.zysyr_report_uploads;
  v_cell public.zysyr_report_cells;
  v_prior public.zysyr_monthly_cell_revisions;
  v_saved public.zysyr_monthly_cell_revisions;
  v_unlock public.zysyr_monthly_cell_unlock_requests;
  v_change jsonb;
  v_address text;
  v_amount_text text;
  v_after numeric(18,4);
  v_before numeric(18,4);
  v_voucher_ids uuid[];
  v_voucher_count integer;
  v_total_voucher_count integer;
  v_result jsonb := '[]'::jsonb;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 1
     or jsonb_array_length(p_changes) > 50
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_CELL_CHANGE_INVALID';
  end if;
  if (select count(*) from jsonb_array_elements(p_changes)) <>
     (select count(distinct upper(item->>'cell_address')) from jsonb_array_elements(p_changes) item) then
    raise exception using errcode = '22023', message = 'MONTHLY_CELL_CHANGE_DUPLICATE';
  end if;
  select * into v_report
  from public.zysyr_report_uploads report
  where report.id = p_report_id
    and report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.report_type = 'monthly_profit_loss'
    and report.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ACTIVE_MONTHLY_REPORT_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_store_id::text || ':' || v_report.report_date::text, 0
  ));
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_report.report_date) then
    select * into v_unlock
    from public.zysyr_monthly_cell_unlock_requests request
    where request.company_id = p_company_id
      and request.store_id = p_store_id
      and request.period_month = v_report.report_date
      and request.requested_by_user_id = p_actor_user_id
      and request.status = 'approved'
    order by request.decided_at asc
    limit 1 for update;
    if not found then
      raise exception using errcode = '55000', message = 'MONTHLY_UNLOCK_APPROVAL_REQUIRED';
    end if;
  end if;
  select coalesce(array_agg(distinct requested.id order by requested.id), array[]::uuid[])
  into v_voucher_ids
  from unnest(coalesce(p_voucher_ids, array[]::uuid[])) requested(id);
  if cardinality(v_voucher_ids) > 20 then
    raise exception using errcode = '22023', message = 'MONTHLY_CELL_VOUCHER_LIMIT';
  end if;
  select count(*) into v_voucher_count
  from public.zysyr_voucher_attachments voucher
  where voucher.company_id = p_company_id and voucher.store_id = p_store_id
    and voucher.id = any(v_voucher_ids);
  if v_voucher_count <> cardinality(v_voucher_ids) then
    raise exception using errcode = 'P0002', message = 'MONTHLY_CELL_VOUCHER_NOT_FOUND';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_address := upper(btrim(coalesce(v_change->>'cell_address', '')));
    v_amount_text := btrim(coalesce(v_change->>'after_amount', ''));
    if v_address !~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'
       or v_amount_text !~ '^-?[0-9]{1,14}([.][0-9]{1,4})?$' then
      raise exception using errcode = '22023', message = 'MONTHLY_CELL_VALUE_INVALID';
    end if;
    v_after := round(v_amount_text::numeric, 4);
    select * into v_cell
    from public.zysyr_report_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id
      and cell.report_id = p_report_id and cell.cell_address = v_address
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'MONTHLY_CELL_NOT_FOUND';
    end if;
    if v_cell.cell_kind = 'formula'
       or coalesce(v_cell.label, '') ~ '(小计|合计|总计|盈亏)' then
      raise exception using errcode = '55000', message = 'MONTHLY_FORMULA_EDIT_FORBIDDEN';
    end if;
    if coalesce((
      select trace.source_count
      from public.zysyr_report_cell_trace_revisions trace
      where trace.company_id = p_company_id and trace.target_cell_id = v_cell.id
      order by trace.revision desc
      limit 1
    ), 0) > 0 then
      raise exception using errcode = '55000', message = 'MONTHLY_CELL_AGGREGATE_EDIT_FORBIDDEN';
    end if;
    select * into v_prior
    from public.zysyr_monthly_cell_revisions revision
    where revision.company_id = p_company_id and revision.source_cell_id = v_cell.id
    order by revision.revision desc limit 1 for update;
    v_before := coalesce(v_prior.after_amount, v_cell.numeric_value, 0);
    if v_before = v_after then
      raise exception using errcode = '22023', message = 'MONTHLY_CELL_AMOUNT_UNCHANGED';
    end if;
    select count(distinct voucher_id) into v_total_voucher_count
    from (
      select old_link.voucher_id
      from public.zysyr_monthly_cell_revision_vouchers old_link
      where old_link.company_id = p_company_id and old_link.revision_id = v_prior.id
      union all
      select requested.voucher_id from unnest(v_voucher_ids) requested(voucher_id)
    ) combined;
    insert into public.zysyr_monthly_cell_revisions (
      company_id, store_id, report_id, source_cell_id, period_month,
      cell_address, cell_label, revision, revision_type, supersedes_revision_id,
      before_amount, after_amount, reason, actor_user_id, unlock_request_id,
      voucher_count
    ) values (
      p_company_id, p_store_id, p_report_id, v_cell.id, v_report.report_date,
      v_address, coalesce(v_cell.label, ''),
      coalesce(v_prior.revision, 0) + 1, 'amount_change', v_prior.id,
      v_before, v_after, btrim(p_reason), p_actor_user_id, v_unlock.id,
      v_total_voucher_count
    ) returning * into v_saved;
    if v_prior.id is not null then
      insert into public.zysyr_monthly_cell_revision_vouchers (
        company_id, store_id, revision_id, voucher_id, linked_by_user_id
      ) select p_company_id, p_store_id, v_saved.id, old_link.voucher_id, p_actor_user_id
        from public.zysyr_monthly_cell_revision_vouchers old_link
        where old_link.company_id = p_company_id and old_link.revision_id = v_prior.id
      on conflict (company_id, revision_id, voucher_id) do nothing;
    end if;
    insert into public.zysyr_monthly_cell_revision_vouchers (
      company_id, store_id, revision_id, voucher_id, linked_by_user_id
    ) select p_company_id, p_store_id, v_saved.id, voucher_id, p_actor_user_id
      from unnest(v_voucher_ids) requested(voucher_id)
    on conflict (company_id, revision_id, voucher_id) do nothing;
    insert into public.zysyr_audit_events (
      company_id, store_id, actor_type, actor_user_id, channel, entity_type,
      entity_id, action, before_json, after_json, reason, sensitivity
    ) values (
      p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
      'monthly_report_cell', v_cell.id, 'amount_change',
      jsonb_build_object('amount', v_before, 'report_id', p_report_id,
        'cell_address', v_address, 'period_month', v_report.report_date),
      jsonb_build_object('amount', v_after, 'delta', v_after - v_before,
        'report_id', p_report_id, 'cell_address', v_address,
        'period_month', v_report.report_date, 'revision_id', v_saved.id,
        'voucher_count', v_total_voucher_count,
        'unlock_request_id', v_unlock.id),
      btrim(p_reason), 'financial'
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_saved.id, 'source_cell_id', v_cell.id,
      'cell_address', v_address, 'before_amount', v_before,
      'after_amount', v_after, 'delta', v_after - v_before
    ));
  end loop;
  if v_unlock.id is not null then
    update public.zysyr_monthly_cell_unlock_requests
    set status = 'consumed', consumed_at = now()
    where company_id = p_company_id and id = v_unlock.id;
  end if;
  return jsonb_build_object('revisions', v_result, 'unlock_request_id', v_unlock.id);
end
$$;

create or replace function public.zysyr_attach_monthly_cell_voucher(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_source_cell_id uuid,
  p_voucher_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell public.zysyr_report_cells;
  v_report public.zysyr_report_uploads;
  v_prior public.zysyr_monthly_cell_revisions;
  v_saved public.zysyr_monthly_cell_revisions;
  v_amount numeric(18,4);
  v_voucher_count integer;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.upload'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_CELL_VOUCHER_REASON_REQUIRED';
  end if;
  select * into v_cell from public.zysyr_report_cells cell
  where cell.id = p_source_cell_id and cell.company_id = p_company_id
    and cell.store_id = p_store_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MONTHLY_CELL_NOT_FOUND';
  end if;
  select * into v_report from public.zysyr_report_uploads report
  where report.id = v_cell.report_id and report.company_id = p_company_id
    and report.store_id = p_store_id and report.report_type = 'monthly_profit_loss';
  if not found then
    raise exception using errcode = 'P0002', message = 'MONTHLY_REPORT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.zysyr_voucher_attachments voucher
    where voucher.id = p_voucher_id and voucher.company_id = p_company_id
      and voucher.store_id = p_store_id
  ) then
    raise exception using errcode = 'P0002', message = 'MONTHLY_CELL_VOUCHER_NOT_FOUND';
  end if;
  select * into v_prior from public.zysyr_monthly_cell_revisions revision
  where revision.company_id = p_company_id and revision.source_cell_id = v_cell.id
  order by revision.revision desc limit 1 for update;
  v_amount := coalesce(v_prior.after_amount, v_cell.numeric_value, 0);
  select count(distinct voucher_id) into v_voucher_count
  from (
    select old_link.voucher_id
    from public.zysyr_monthly_cell_revision_vouchers old_link
    where old_link.company_id = p_company_id and old_link.revision_id = v_prior.id
    union all
    select p_voucher_id
  ) combined;
  insert into public.zysyr_monthly_cell_revisions (
    company_id, store_id, report_id, source_cell_id, period_month,
    cell_address, cell_label, revision, revision_type, supersedes_revision_id,
    before_amount, after_amount, reason, actor_user_id, voucher_count
  ) values (
    p_company_id, p_store_id, v_report.id, v_cell.id, v_report.report_date,
    v_cell.cell_address, v_cell.label, coalesce(v_prior.revision, 0) + 1,
    'evidence_update', v_prior.id, v_amount, v_amount, btrim(p_reason), p_actor_user_id,
    v_voucher_count
  ) returning * into v_saved;
  if v_prior.id is not null then
    insert into public.zysyr_monthly_cell_revision_vouchers (
      company_id, store_id, revision_id, voucher_id, linked_by_user_id
    ) select p_company_id, p_store_id, v_saved.id, old_link.voucher_id, p_actor_user_id
      from public.zysyr_monthly_cell_revision_vouchers old_link
      where old_link.company_id = p_company_id and old_link.revision_id = v_prior.id
    on conflict (company_id, revision_id, voucher_id) do nothing;
  end if;
  insert into public.zysyr_monthly_cell_revision_vouchers (
    company_id, store_id, revision_id, voucher_id, linked_by_user_id
  ) values (p_company_id, p_store_id, v_saved.id, p_voucher_id, p_actor_user_id)
  on conflict (company_id, revision_id, voucher_id) do nothing;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'monthly_report_cell', v_cell.id, 'voucher_link',
    jsonb_build_object('revision_id', v_saved.id, 'voucher_id', p_voucher_id,
      'cell_address', v_cell.cell_address, 'period_month', v_report.report_date),
    btrim(p_reason), 'financial'
  );
  return jsonb_build_object('revision_id', v_saved.id, 'voucher_id', p_voucher_id);
end
$$;

revoke execute on function public.zysyr_request_monthly_cell_unlock(uuid, uuid, uuid, date, text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_decide_monthly_cell_unlock(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_revise_monthly_cells(uuid, uuid, uuid, uuid, jsonb, uuid[], text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_attach_monthly_cell_voucher(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.zysyr_request_monthly_cell_unlock(uuid, uuid, uuid, date, text) to service_role;
grant execute on function public.zysyr_decide_monthly_cell_unlock(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.zysyr_revise_monthly_cells(uuid, uuid, uuid, uuid, jsonb, uuid[], text) to service_role;
grant execute on function public.zysyr_attach_monthly_cell_voucher(uuid, uuid, uuid, uuid, uuid, text) to service_role;

alter table public.zysyr_monthly_cell_unlock_requests enable row level security;
alter table public.zysyr_monthly_cell_unlock_requests force row level security;
alter table public.zysyr_monthly_cell_revisions enable row level security;
alter table public.zysyr_monthly_cell_revisions force row level security;
alter table public.zysyr_monthly_cell_revision_vouchers enable row level security;
alter table public.zysyr_monthly_cell_revision_vouchers force row level security;

create policy zysyr_monthly_unlock_scope_select
on public.zysyr_monthly_cell_unlock_requests for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'audit.read')));
create policy zysyr_monthly_cell_revision_scope_select
on public.zysyr_monthly_cell_revisions for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_monthly_cell_revision_voucher_scope_select
on public.zysyr_monthly_cell_revision_vouchers for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_monthly_cell_unlock_requests,
  public.zysyr_monthly_cell_revisions,
  public.zysyr_monthly_cell_revision_vouchers
from public, anon, authenticated, service_role;
grant select on table public.zysyr_monthly_cell_unlock_requests,
  public.zysyr_monthly_cell_revisions,
  public.zysyr_monthly_cell_revision_vouchers
to authenticated;
grant select, insert, update on table public.zysyr_monthly_cell_unlock_requests
to service_role;
grant select, insert on table public.zysyr_monthly_cell_revisions,
  public.zysyr_monthly_cell_revision_vouchers
to service_role;

comment on table public.zysyr_monthly_cell_revisions is
  'Append-only effective amount and evidence revisions layered over immutable uploaded monthly-report cells.';
comment on table public.zysyr_monthly_cell_unlock_requests is
  'One-time administrator decisions authorizing a finance user to correct cells while the month remains locked.';
