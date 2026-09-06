-- ZYSYR monthly workbench: administrator-controlled evidence rules.
-- A rule changes whether an image/PDF voucher is required; it never removes
-- source lineage, uploaded originals, amount revisions, or audit history.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_monthly_evidence_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  template_code text not null,
  cell_address text not null check (cell_address ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'),
  cell_label text not null default '',
  evidence_policy text not null
    check (evidence_policy in ('voucher_required', 'source_report', 'none')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, template_code, cell_address),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index zysyr_monthly_evidence_rules_scope_idx
  on public.zysyr_monthly_evidence_rules
  (company_id, store_id, template_code, cell_address);

create or replace function public.zysyr_save_monthly_evidence_rule(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_template_code text,
  p_cell_address text,
  p_cell_label text,
  p_evidence_policy text,
  p_reason text
)
returns public.zysyr_monthly_evidence_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.zysyr_monthly_evidence_rules;
  v_saved public.zysyr_monthly_evidence_rules;
  v_address text := upper(btrim(coalesce(p_cell_address, '')));
  v_template text := btrim(coalesce(p_template_code, ''));
begin
  if not zysyr_private.account_has_company_capability(
    p_actor_user_id, p_company_id, 'finance_account.create'
  ) then
    raise exception using errcode = '42501', message = 'MONTHLY_EVIDENCE_RULE_ADMIN_REQUIRED';
  end if;
  if not exists (
    select 1 from public.zysyr_stores store_row
    where store_row.company_id = p_company_id
      and store_row.id = p_store_id
      and store_row.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'MONTHLY_EVIDENCE_RULE_STORE_INVALID';
  end if;
  if v_template = '' or v_address !~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'
     or p_evidence_policy not in ('voucher_required', 'source_report', 'none')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MONTHLY_EVIDENCE_RULE_INVALID';
  end if;

  select * into v_before
  from public.zysyr_monthly_evidence_rules rule_row
  where rule_row.company_id = p_company_id
    and rule_row.store_id = p_store_id
    and rule_row.template_code = v_template
    and rule_row.cell_address = v_address;

  insert into public.zysyr_monthly_evidence_rules (
    company_id, store_id, template_code, cell_address, cell_label,
    evidence_policy, reason, updated_by_user_id
  ) values (
    p_company_id, p_store_id, v_template, v_address,
    left(coalesce(p_cell_label, ''), 300), p_evidence_policy,
    btrim(p_reason), p_actor_user_id
  )
  on conflict (company_id, store_id, template_code, cell_address)
  do update set
    cell_label = excluded.cell_label,
    evidence_policy = excluded.evidence_policy,
    reason = excluded.reason,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now()
  returning * into v_saved;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'monthly_evidence_rule', v_saved.id, 'save_evidence_policy',
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_saved), btrim(p_reason), 'financial'
  );
  return v_saved;
end
$$;

revoke execute on function public.zysyr_save_monthly_evidence_rule(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.zysyr_save_monthly_evidence_rule(
  uuid, uuid, uuid, text, text, text, text, text
) to service_role;

alter table public.zysyr_monthly_evidence_rules enable row level security;
alter table public.zysyr_monthly_evidence_rules force row level security;

create policy zysyr_monthly_evidence_rules_scope_select
on public.zysyr_monthly_evidence_rules for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_monthly_evidence_rules
from public, anon, authenticated, service_role;
grant select on table public.zysyr_monthly_evidence_rules to authenticated;
grant select, insert, update on table public.zysyr_monthly_evidence_rules to service_role;

comment on table public.zysyr_monthly_evidence_rules is
  'Store- and template-scoped policy for whether a monthly amount needs a voucher, a source report, or no separate evidence. Source lineage and audit are always retained.';
