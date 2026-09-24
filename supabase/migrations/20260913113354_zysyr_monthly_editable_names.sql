-- Keep the uploaded monthly workbook immutable while allowing finance users to
-- correct or add business item, employee and detail names. Every change is an
-- append-only revision protected by store scope, lock approval and audit.
set lock_timeout = '5s';
set statement_timeout = '30s';

create table public.zysyr_monthly_text_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  report_id uuid not null,
  period_month date not null,
  cell_address text not null check (cell_address ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'),
  cell_role text not null check (cell_role in ('income_item','expense_item','staff_name','detail_name')),
  revision integer not null check (revision > 0),
  supersedes_revision_id uuid,
  base_text text not null default '' check (length(base_text) <= 80 and base_text !~ '[[:cntrl:]]'),
  before_text text not null default '' check (length(before_text) <= 80 and before_text !~ '[[:cntrl:]]'),
  after_text text not null default '' check (length(after_text) <= 80 and after_text !~ '[[:cntrl:]]'),
  reason text not null check (nullif(btrim(reason), '') is not null and length(reason) <= 500),
  actor_user_id uuid not null,
  unlock_request_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, report_id, cell_address, revision),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, report_id)
    references public.zysyr_report_uploads(company_id, store_id, id) on delete restrict,
  foreign key (company_id, supersedes_revision_id)
    references public.zysyr_monthly_text_revisions(company_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, unlock_request_id)
    references public.zysyr_monthly_cell_unlock_requests(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date),
  check (before_text <> after_text),
  check ((revision = 1 and supersedes_revision_id is null)
    or (revision > 1 and supersedes_revision_id is not null))
);

create index zysyr_monthly_text_revision_latest_idx
  on public.zysyr_monthly_text_revisions (company_id, store_id, report_id, cell_address, revision desc);
create index zysyr_monthly_text_revision_scope_idx
  on public.zysyr_monthly_text_revisions (company_id, store_id, period_month desc, created_at desc);
create index zysyr_monthly_text_revision_actor_idx
  on public.zysyr_monthly_text_revisions (company_id, actor_user_id, created_at desc);
create index zysyr_monthly_text_revision_supersedes_idx
  on public.zysyr_monthly_text_revisions (company_id, supersedes_revision_id)
  where supersedes_revision_id is not null;
create index zysyr_monthly_text_revision_unlock_idx
  on public.zysyr_monthly_text_revisions (company_id, unlock_request_id)
  where unlock_request_id is not null;

alter table public.zysyr_monthly_text_revisions enable row level security;
alter table public.zysyr_monthly_text_revisions force row level security;
revoke all on table public.zysyr_monthly_text_revisions from public, anon, authenticated;
grant select, insert on table public.zysyr_monthly_text_revisions to service_role;

create policy zysyr_monthly_text_revisions_service_select
on public.zysyr_monthly_text_revisions for select to service_role
using ((select auth.role()) = 'service_role');

create policy zysyr_monthly_text_revisions_service_insert
on public.zysyr_monthly_text_revisions for insert to service_role
with check ((select auth.role()) = 'service_role');

create trigger zysyr_monthly_text_revisions_append_only
before update or delete on public.zysyr_monthly_text_revisions
for each row execute function zysyr_private.protect_monthly_cell_history();

create or replace function public.zysyr_revise_monthly_text_cells(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_report_id uuid,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.zysyr_report_uploads%rowtype;
  v_unlock public.zysyr_monthly_cell_unlock_requests%rowtype;
  v_prior public.zysyr_monthly_text_revisions%rowtype;
  v_saved public.zysyr_monthly_text_revisions%rowtype;
  v_change jsonb;
  v_address text;
  v_role text;
  v_base text;
  v_before text;
  v_after text;
  v_expected integer;
  v_result jsonb := '[]'::jsonb;
begin
  if zysyr_private.request_role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'confirmed_finance.adjust'
  );
  if jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 1
     or jsonb_array_length(p_changes) > 50
     or nullif(btrim(p_reason), '') is null
     or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'MONTHLY_TEXT_CHANGE_INVALID';
  end if;
  if (select count(*) from jsonb_array_elements(p_changes)) <>
     (select count(distinct upper(item->>'cell_address')) from jsonb_array_elements(p_changes) item) then
    raise exception using errcode = '22023', message = 'MONTHLY_TEXT_CHANGE_DUPLICATE';
  end if;

  select report.* into v_report
  from public.zysyr_report_uploads report
  where report.company_id = p_company_id
    and report.store_id = p_store_id
    and report.id = p_report_id
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

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_address := upper(btrim(coalesce(v_change->>'cell_address', '')));
    v_role := btrim(coalesce(v_change->>'cell_role', ''));
    v_base := btrim(coalesce(v_change->>'base_text', ''));
    v_before := btrim(coalesce(v_change->>'before_text', ''));
    v_after := btrim(coalesce(v_change->>'after_text', ''));
    if coalesce(v_change->>'expected_revision', '') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'MONTHLY_TEXT_REVISION_INVALID';
    end if;
    v_expected := (v_change->>'expected_revision')::integer;
    if v_address !~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'
       or v_role not in ('income_item','expense_item','staff_name','detail_name')
       or length(v_base) > 80 or length(v_before) > 80 or length(v_after) > 80
       or v_base ~ '[[:cntrl:]]' or v_before ~ '[[:cntrl:]]' or v_after ~ '[[:cntrl:]]'
       or v_before = v_after then
      raise exception using errcode = '22023', message = 'MONTHLY_TEXT_VALUE_INVALID';
    end if;

    select * into v_prior
    from public.zysyr_monthly_text_revisions revision
    where revision.company_id = p_company_id
      and revision.store_id = p_store_id
      and revision.report_id = p_report_id
      and revision.cell_address = v_address
    order by revision.revision desc
    limit 1 for update;
    if found then
      if v_expected <> v_prior.revision
         or v_base <> v_prior.base_text
         or v_before <> v_prior.after_text
         or v_role <> v_prior.cell_role then
        raise exception using errcode = '40001', message = 'MONTHLY_TEXT_CHANGED_RELOAD';
      end if;
    elsif v_expected <> 0 or v_before <> v_base then
      raise exception using errcode = '40001', message = 'MONTHLY_TEXT_CHANGED_RELOAD';
    end if;

    insert into public.zysyr_monthly_text_revisions(
      company_id, store_id, report_id, period_month, cell_address, cell_role,
      revision, supersedes_revision_id, base_text, before_text, after_text,
      reason, actor_user_id, unlock_request_id
    ) values (
      p_company_id, p_store_id, p_report_id, date_trunc('month', v_report.report_date)::date,
      v_address, v_role, coalesce(v_prior.revision, 0) + 1, v_prior.id,
      v_base, v_before, v_after, btrim(p_reason), p_actor_user_id, v_unlock.id
    ) returning * into v_saved;

    insert into public.zysyr_audit_events(
      company_id, store_id, actor_type, actor_user_id, channel, entity_type,
      entity_id, action, before_json, after_json, reason, sensitivity
    ) values (
      p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
      'monthly_text_revision', v_saved.id, 'monthly_text_change',
      jsonb_build_object('cell_address', v_address, 'cell_role', v_role, 'text', v_before),
      jsonb_build_object('cell_address', v_address, 'cell_role', v_role, 'text', v_after, 'revision', v_saved.revision),
      btrim(p_reason), 'financial'
    );
    v_result := v_result || jsonb_build_array(to_jsonb(v_saved));
  end loop;

  if v_unlock.id is not null then
    update public.zysyr_monthly_cell_unlock_requests
    set status = 'consumed', consumed_at = clock_timestamp()
    where company_id = p_company_id and id = v_unlock.id;
  end if;
  return jsonb_build_object('saved', v_result, 'count', jsonb_array_length(v_result));
end
$$;

revoke execute on function public.zysyr_revise_monthly_text_cells(
  uuid, uuid, uuid, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.zysyr_revise_monthly_text_cells(
  uuid, uuid, uuid, uuid, jsonb, text
) to service_role;

comment on table public.zysyr_monthly_text_revisions is
  'Append-only finance corrections for editable monthly item, staff and detail names; original workbook text remains immutable.';
comment on function public.zysyr_revise_monthly_text_cells(
  uuid, uuid, uuid, uuid, jsonb, text
) is 'Service-only audited batch writer for monthly editable names with finance scope, optimistic concurrency and lock approval.';
