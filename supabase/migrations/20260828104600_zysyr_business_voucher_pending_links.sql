-- ZYSYR v456: upload a missing voucher beside one formal business record,
-- remember the intended target while review is pending, and create the formal
-- immutable voucher link only after finance approves the voucher.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_business_voucher_link_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  voucher_id uuid not null,
  business_type text not null check (business_type in (
    'income_record', 'expense_record', 'petty_cash_record', 'salary',
    'goods_receipt', 'usage_record', 'employee_purchase'
  )),
  business_id uuid not null,
  relation_type text not null default 'evidence'
    check (relation_type in ('evidence', 'payment_proof', 'source_document', 'replacement')),
  status text not null default 'pending' check (status in ('pending', 'linked', 'rejected')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  requested_by_user_id uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  unique (company_id, id),
  unique (company_id, voucher_id, business_type, business_id, relation_type),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict,
  foreign key (company_id, requested_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, resolved_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (
    (status = 'pending' and resolved_by_user_id is null and resolved_at is null)
    or (status in ('linked', 'rejected') and resolved_by_user_id is not null and resolved_at is not null)
  )
);

create index zysyr_business_voucher_link_requests_voucher_idx
  on public.zysyr_business_voucher_link_requests (company_id, store_id, voucher_id);
create index zysyr_business_voucher_link_requests_pending_idx
  on public.zysyr_business_voucher_link_requests (company_id, store_id, requested_at)
  where status = 'pending';
create index zysyr_business_voucher_link_requests_requester_idx
  on public.zysyr_business_voucher_link_requests (company_id, requested_by_user_id, requested_at desc);
create index zysyr_business_voucher_link_requests_resolver_idx
  on public.zysyr_business_voucher_link_requests (company_id, resolved_by_user_id, resolved_at desc)
  where resolved_by_user_id is not null;

create or replace function zysyr_private.business_record_exists(
  target_company_id uuid,
  target_store_id uuid,
  target_business_type text,
  target_business_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_business_type = 'income_record' then
    return exists (select 1 from public.zysyr_income_records record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status = 'approved');
  elsif target_business_type = 'expense_record' then
    return exists (select 1 from public.zysyr_expense_records record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.deleted_at is null
        and record.workflow_status in ('approved', 'paid'));
  elsif target_business_type = 'petty_cash_record' then
    return exists (select 1 from public.zysyr_petty_cash_records record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status = 'confirmed');
  elsif target_business_type = 'salary' then
    return exists (select 1 from public.zysyr_salaries record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status in ('approved', 'paid'));
  elsif target_business_type = 'goods_receipt' then
    return exists (select 1 from public.zysyr_goods_receipts record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status = 'posted');
  elsif target_business_type = 'usage_record' then
    return exists (select 1 from public.zysyr_usage_records record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status = 'confirmed');
  elsif target_business_type = 'employee_purchase' then
    return exists (select 1 from public.zysyr_employee_purchases record
      where record.company_id = target_company_id and record.store_id = target_store_id
        and record.id = target_business_id and record.status = 'approved');
  end if;
  return false;
end
$$;

create or replace function public.zysyr_request_business_voucher_link(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_business_type text,
  p_business_id uuid,
  p_relation_type text,
  p_reason text
)
returns public.zysyr_business_voucher_link_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.zysyr_business_voucher_link_requests;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.upload'
  );
  if p_business_type not in (
      'income_record', 'expense_record', 'petty_cash_record', 'salary',
      'goods_receipt', 'usage_record', 'employee_purchase'
    ) or p_relation_type not in ('evidence', 'payment_proof', 'source_document', 'replacement')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'BUSINESS_VOUCHER_TARGET_INVALID';
  end if;
  if not exists (
    select 1 from public.zysyr_voucher_attachments voucher
    where voucher.company_id = p_company_id and voucher.store_id = p_store_id
      and voucher.id = p_voucher_id and voucher.audit_status = 'pending'
  ) then
    raise exception using errcode = 'P0002', message = 'PENDING_VOUCHER_NOT_FOUND';
  end if;
  if not zysyr_private.business_record_exists(
    p_company_id, p_store_id, p_business_type, p_business_id
  ) then
    raise exception using errcode = 'P0002', message = 'BUSINESS_RECORD_NOT_FOUND';
  end if;
  insert into public.zysyr_business_voucher_link_requests (
    company_id, store_id, voucher_id, business_type, business_id,
    relation_type, reason, requested_by_user_id
  ) values (
    p_company_id, p_store_id, p_voucher_id, p_business_type, p_business_id,
    p_relation_type, btrim(p_reason), p_actor_user_id
  )
  on conflict (company_id, voucher_id, business_type, business_id, relation_type)
  do update set reason = excluded.reason
  where zysyr_business_voucher_link_requests.status = 'pending'
  returning * into v_saved;
  if not found then
    raise exception using errcode = '55000', message = 'BUSINESS_VOUCHER_REQUEST_ALREADY_RESOLVED';
  end if;
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'business_voucher_link_request', v_saved.id, 'request', to_jsonb(v_saved),
    btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

create or replace function public.zysyr_resolve_business_voucher_links(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.zysyr_business_voucher_link_requests;
  v_count integer := 0;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'voucher.review'
  );
  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'VOUCHER_LINK_DECISION_INVALID';
  end if;
  if not exists (
    select 1 from public.zysyr_voucher_attachments voucher
    where voucher.company_id = p_company_id and voucher.store_id = p_store_id
      and voucher.id = p_voucher_id and voucher.audit_status = p_decision
  ) then
    raise exception using errcode = 'P0002', message = 'REVIEWED_VOUCHER_NOT_FOUND';
  end if;
  for v_request in
    select * from public.zysyr_business_voucher_link_requests request
    where request.company_id = p_company_id and request.store_id = p_store_id
      and request.voucher_id = p_voucher_id and request.status = 'pending'
    order by request.requested_at, request.id
    for update
  loop
    if p_decision = 'approved' then
      perform zysyr_private.link_finance_vouchers(
        p_actor_user_id, p_company_id, p_store_id, v_request.business_type,
        v_request.business_id, array[p_voucher_id], v_request.relation_type,
        v_request.reason
      );
    end if;
    update public.zysyr_business_voucher_link_requests request
    set status = case when p_decision = 'approved' then 'linked' else 'rejected' end,
        resolved_by_user_id = p_actor_user_id,
        resolved_at = clock_timestamp()
    where request.company_id = p_company_id and request.id = v_request.id;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    insert into public.zysyr_audit_events (
      company_id, store_id, actor_type, actor_user_id, channel, entity_type,
      entity_id, action, after_json, reason, sensitivity
    ) values (
      p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
      'voucher', p_voucher_id, 'business_links_resolve',
      jsonb_build_object('decision', p_decision, 'request_count', v_count),
      '凭证审核后自动处理待绑定业务记录', 'financial'
    );
  end if;
  return jsonb_build_object('decision', p_decision, 'request_count', v_count);
end
$$;

create or replace function public.zysyr_review_voucher_and_resolve_links(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_voucher_id uuid,
  p_decision text,
  p_document_type text,
  p_corrected_fields jsonb,
  p_field_confidences jsonb,
  p_report_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voucher public.zysyr_voucher_attachments;
  v_links jsonb;
begin
  v_voucher := public.zysyr_review_voucher(
    p_actor_user_id, p_company_id, p_store_id, p_voucher_id,
    p_decision, p_document_type, p_corrected_fields, p_field_confidences,
    p_report_ids, p_reason
  );
  v_links := public.zysyr_resolve_business_voucher_links(
    p_actor_user_id, p_company_id, p_store_id, p_voucher_id, p_decision
  );
  return jsonb_build_object('voucher', to_jsonb(v_voucher), 'business_links', v_links);
end
$$;

revoke execute on function zysyr_private.business_record_exists(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.zysyr_request_business_voucher_link(uuid, uuid, uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_resolve_business_voucher_links(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_review_voucher_and_resolve_links(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.zysyr_request_business_voucher_link(uuid, uuid, uuid, uuid, text, uuid, text, text)
  to service_role;
grant execute on function public.zysyr_resolve_business_voucher_links(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.zysyr_review_voucher_and_resolve_links(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid[], text)
  to service_role;

alter table public.zysyr_business_voucher_link_requests enable row level security;
alter table public.zysyr_business_voucher_link_requests force row level security;
create policy zysyr_business_voucher_link_requests_scope_select
on public.zysyr_business_voucher_link_requests for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'voucher.read')));

revoke all on table public.zysyr_business_voucher_link_requests
  from public, anon, authenticated, service_role;
grant select on table public.zysyr_business_voucher_link_requests to authenticated;
grant select, insert, update on table public.zysyr_business_voucher_link_requests to service_role;

comment on table public.zysyr_business_voucher_link_requests is
  'Audited pending intent created beside a formal business record; approval atomically promotes it into zysyr_voucher_links.';
