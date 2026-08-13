create table if not exists public.zysyr_report_cells (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  report_id uuid not null,
  sheet_name text not null check (char_length(sheet_name) between 1 and 120),
  cell_address text not null check (cell_address ~ '^[A-Z]{1,3}[1-9][0-9]{0,3}$'),
  row_number integer not null check (row_number between 1 and 120),
  column_number integer not null check (column_number between 1 and 30),
  cell_kind text not null check (cell_kind in ('input', 'formula')),
  display_value text not null default '',
  numeric_value numeric(18,4),
  formula text,
  precedent_addresses jsonb not null default '[]'::jsonb
    check (jsonb_typeof(precedent_addresses) = 'array'),
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, report_id, sheet_name, cell_address),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, report_id)
    references public.zysyr_report_uploads(company_id, id) on delete restrict,
  check ((cell_kind = 'formula' and nullif(btrim(formula), '') is not null)
    or (cell_kind = 'input' and formula is null))
);

create index if not exists zysyr_report_cells_report_position_idx
  on public.zysyr_report_cells (company_id, report_id, sheet_name, row_number, column_number);
create index if not exists zysyr_report_cells_scope_idx
  on public.zysyr_report_cells (company_id, store_id, created_at desc);

create table if not exists public.zysyr_report_cell_trace_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  target_cell_id uuid not null,
  revision integer not null check (revision > 0),
  supersedes_revision_id uuid,
  expected_amount numeric(18,4) not null,
  source_amount numeric(18,4) not null,
  delta numeric(18,4) not null,
  status text not null check (status in ('matched', 'mismatch', 'missing_evidence', 'unlinked')),
  source_count integer not null check (source_count >= 0),
  evidence_count integer not null check (evidence_count >= 0),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, target_cell_id, revision),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, target_cell_id)
    references public.zysyr_report_cells(company_id, id) on delete restrict,
  foreign key (company_id, supersedes_revision_id)
    references public.zysyr_report_cell_trace_revisions(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((revision = 1 and supersedes_revision_id is null)
    or (revision > 1 and supersedes_revision_id is not null))
);

create index if not exists zysyr_report_cell_trace_latest_idx
  on public.zysyr_report_cell_trace_revisions
  (company_id, target_cell_id, revision desc);
create index if not exists zysyr_report_cell_trace_scope_idx
  on public.zysyr_report_cell_trace_revisions
  (company_id, store_id, created_at desc);
create index if not exists zysyr_report_cell_trace_creator_idx
  on public.zysyr_report_cell_trace_revisions
  (company_id, created_by_user_id, created_at desc);

create table if not exists public.zysyr_report_cell_trace_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  trace_revision_id uuid not null,
  source_cell_id uuid not null,
  source_amount numeric(18,4) not null,
  created_at timestamptz not null default now(),
  unique (company_id, trace_revision_id, source_cell_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, trace_revision_id)
    references public.zysyr_report_cell_trace_revisions(company_id, id) on delete restrict,
  foreign key (company_id, source_cell_id)
    references public.zysyr_report_cells(company_id, id) on delete restrict
);

create index if not exists zysyr_report_cell_trace_sources_cell_idx
  on public.zysyr_report_cell_trace_sources (company_id, source_cell_id);

create table if not exists public.zysyr_report_cell_trace_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  trace_revision_id uuid not null,
  voucher_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, trace_revision_id, voucher_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, trace_revision_id)
    references public.zysyr_report_cell_trace_revisions(company_id, id) on delete restrict,
  foreign key (company_id, voucher_id)
    references public.zysyr_voucher_attachments(company_id, id) on delete restrict
);

create index if not exists zysyr_report_cell_trace_evidence_voucher_idx
  on public.zysyr_report_cell_trace_evidence (company_id, voucher_id);

create or replace function zysyr_private.protect_report_trace_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report cell trace history is append-only';
end;
$$;

revoke execute on function zysyr_private.protect_report_trace_history()
  from public, anon, authenticated, service_role;

create trigger zysyr_report_cells_append_only
before update or delete on public.zysyr_report_cells
for each row execute function zysyr_private.protect_report_trace_history();
create trigger zysyr_report_cell_trace_revisions_append_only
before update or delete on public.zysyr_report_cell_trace_revisions
for each row execute function zysyr_private.protect_report_trace_history();
create trigger zysyr_report_cell_trace_sources_append_only
before update or delete on public.zysyr_report_cell_trace_sources
for each row execute function zysyr_private.protect_report_trace_history();
create trigger zysyr_report_cell_trace_evidence_append_only
before update or delete on public.zysyr_report_cell_trace_evidence
for each row execute function zysyr_private.protect_report_trace_history();

create or replace function public.zysyr_register_report_upload(
  p_report jsonb,
  p_cells jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := (p_report->>'company_id')::uuid;
  v_store_id uuid := (p_report->>'store_id')::uuid;
  v_actor_id uuid := (p_report->>'uploaded_by_user_id')::uuid;
  v_report_type text := p_report->>'report_type';
  v_report_date date := (p_report->>'report_date')::date;
  v_prior public.zysyr_report_uploads%rowtype;
  v_saved public.zysyr_report_uploads%rowtype;
  v_cell_count integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if jsonb_typeof(p_report) <> 'object' or jsonb_typeof(p_cells) <> 'array' then
    raise exception 'invalid report registration payload';
  end if;
  v_cell_count := jsonb_array_length(p_cells);
  if v_cell_count < 1 or v_cell_count > 3600 then
    raise exception 'report cell count out of range';
  end if;
  if not exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg
      on urg.company_id = ua.company_id and urg.user_account_id = ua.id
    join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
    join public.zysyr_capabilities cap on cap.id = rc.capability_id
    where ua.id = v_actor_id and ua.company_id = v_company_id and ua.status = 'active'
      and urg.revoked_at is null and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
      and (urg.scope_type = 'company' or (urg.scope_type = 'store' and urg.store_id = v_store_id))
      and cap.code = 'report.upload'
  ) then
    raise exception 'finance report upload scope denied';
  end if;

  select * into v_prior
  from public.zysyr_report_uploads
  where company_id = v_company_id and store_id = v_store_id
    and report_type = v_report_type and report_date = v_report_date
    and status = 'active'
  order by version desc
  limit 1
  for update;

  insert into public.zysyr_report_uploads (
    company_id, store_id, report_type, report_date, template_code, template_version,
    version, supersedes_report_id, original_filename, mime_type, size_bytes, sha256,
    bucket_id, object_path, display_data, uploaded_by_user_id
  ) values (
    v_company_id, v_store_id, v_report_type, v_report_date,
    p_report->>'template_code', coalesce((p_report->>'template_version')::integer, 1),
    coalesce(v_prior.version, 0) + 1, v_prior.id, p_report->>'original_filename',
    p_report->>'mime_type', (p_report->>'size_bytes')::bigint, p_report->>'sha256',
    p_report->>'bucket_id', p_report->>'object_path', p_report->'display_data', v_actor_id
  ) returning * into v_saved;

  insert into public.zysyr_report_cells (
    company_id, store_id, report_id, sheet_name, cell_address, row_number,
    column_number, cell_kind, display_value, numeric_value, formula,
    precedent_addresses, label
  )
  select v_company_id, v_store_id, v_saved.id,
    cell.sheet_name, upper(cell.cell_address), cell.row_number, cell.column_number,
    cell.cell_kind, coalesce(cell.display_value, ''), cell.numeric_value,
    nullif(btrim(cell.formula), ''), coalesce(cell.precedent_addresses, '[]'::jsonb),
    coalesce(cell.label, '')
  from jsonb_to_recordset(p_cells) as cell(
    sheet_name text, cell_address text, row_number integer, column_number integer,
    cell_kind text, display_value text, numeric_value numeric, formula text,
    precedent_addresses jsonb, label text
  );

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (v_company_id, v_store_id, 'finance_report', v_saved.id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select v_company_id, v_store_id, 'report_cell', cell.id
  from public.zysyr_report_cells cell
  where cell.company_id = v_company_id and cell.report_id = v_saved.id
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_company_id, v_store_id, report_node.id, cell_node.id, 'contains', v_actor_id
  from public.zysyr_trace_nodes report_node
  join public.zysyr_report_cells cell
    on cell.company_id = v_company_id and cell.report_id = v_saved.id
  join public.zysyr_trace_nodes cell_node
    on cell_node.company_id = v_company_id and cell_node.entity_type = 'report_cell'
   and cell_node.entity_id = cell.id
  where report_node.company_id = v_company_id
    and report_node.entity_type = 'finance_report' and report_node.entity_id = v_saved.id
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    source_amount, created_by_user_id
  )
  select v_company_id, v_store_id, target_node.id, source_node.id, 'derived_from',
    source_cell.numeric_value, v_actor_id
  from public.zysyr_report_cells target_cell
  join lateral jsonb_array_elements_text(target_cell.precedent_addresses) precedent on true
  join public.zysyr_report_cells source_cell
    on source_cell.company_id = target_cell.company_id
   and source_cell.report_id = target_cell.report_id
   and source_cell.sheet_name = target_cell.sheet_name
   and source_cell.cell_address = upper(precedent.value)
  join public.zysyr_trace_nodes target_node
    on target_node.company_id = target_cell.company_id
   and target_node.entity_type = 'report_cell' and target_node.entity_id = target_cell.id
  join public.zysyr_trace_nodes source_node
    on source_node.company_id = source_cell.company_id
   and source_node.entity_type = 'report_cell' and source_node.entity_id = source_cell.id
  where target_cell.company_id = v_company_id and target_cell.report_id = v_saved.id
    and target_cell.cell_kind = 'formula'
  on conflict (company_id, from_node_id, to_node_id, relation_type) do nothing;

  if v_prior.id is not null then
    update public.zysyr_report_uploads
    set status = 'superseded'
    where company_id = v_company_id and id = v_prior.id and status = 'active';
  end if;

  return to_jsonb(v_saved);
end;
$$;

revoke execute on function public.zysyr_register_report_upload(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.zysyr_register_report_upload(jsonb, jsonb)
  to service_role;

create or replace function public.zysyr_save_report_cell_trace(
  p_target_cell_id uuid,
  p_source_cell_ids uuid[],
  p_voucher_ids uuid[],
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.zysyr_report_cells%rowtype;
  v_target_report public.zysyr_report_uploads%rowtype;
  v_prior public.zysyr_report_cell_trace_revisions%rowtype;
  v_saved public.zysyr_report_cell_trace_revisions%rowtype;
  v_source_count integer;
  v_evidence_count integer;
  v_source_amount numeric(18,4);
  v_delta numeric(18,4);
  v_status text;
  v_source_ids uuid[] := coalesce(p_source_cell_ids, array[]::uuid[]);
  v_voucher_ids uuid[] := coalesce(p_voucher_ids, array[]::uuid[]);
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if cardinality(v_source_ids) > 500 or cardinality(v_voucher_ids) > 200 then
    raise exception 'trace selection exceeds safe limit';
  end if;

  select * into v_target from public.zysyr_report_cells where id = p_target_cell_id;
  if v_target.id is null then raise exception 'target report cell not found'; end if;
  select * into v_target_report from public.zysyr_report_uploads
    where company_id = v_target.company_id and id = v_target.report_id;
  if v_target_report.report_type <> 'monthly_profit_loss'
    or v_target.cell_kind <> 'input' or v_target.numeric_value is null then
    raise exception 'only numeric monthly input cells can be manually traced';
  end if;
  if not exists (
    select 1
    from public.zysyr_user_accounts ua
    join public.zysyr_user_role_grants urg
      on urg.company_id = ua.company_id and urg.user_account_id = ua.id
    join public.zysyr_role_capabilities rc on rc.role_id = urg.role_id
    join public.zysyr_capabilities cap on cap.id = rc.capability_id
    where ua.id = p_actor_user_id and ua.company_id = v_target.company_id and ua.status = 'active'
      and urg.revoked_at is null and urg.valid_from <= current_date
      and (urg.valid_to is null or urg.valid_to >= current_date)
      and (urg.scope_type = 'company' or (urg.scope_type = 'store' and urg.store_id = v_target.store_id))
      and cap.code = 'report.upload'
  ) then raise exception 'finance trace scope denied'; end if;

  select count(distinct source.id), coalesce(sum(source.numeric_value), 0)
  into v_source_count, v_source_amount
  from public.zysyr_report_cells source
  join public.zysyr_report_uploads report
    on report.company_id = source.company_id and report.id = source.report_id
  where source.id = any(v_source_ids)
    and source.company_id = v_target.company_id and source.store_id = v_target.store_id
    and source.numeric_value is not null
    and report.report_type in ('daily', 'performance')
    and date_trunc('month', report.report_date) = date_trunc('month', v_target_report.report_date);
  if v_source_count <> cardinality(v_source_ids) then
    raise exception 'one or more source cells are outside the authorized month or store';
  end if;

  select count(distinct voucher.id) into v_evidence_count
  from public.zysyr_voucher_attachments voucher
  join public.zysyr_report_uploads report
    on report.company_id = voucher.company_id
   and report.id::text = voucher.record_id and voucher.record_type = 'report'
  where voucher.id = any(v_voucher_ids)
    and voucher.company_id = v_target.company_id and voucher.store_id = v_target.store_id
    and date_trunc('month', report.report_date) = date_trunc('month', v_target_report.report_date);
  if v_evidence_count <> cardinality(v_voucher_ids) then
    raise exception 'one or more vouchers are outside the authorized month or store';
  end if;

  v_delta := round(v_source_amount - v_target.numeric_value, 4);
  v_status := case
    when v_source_count = 0 then 'unlinked'
    when abs(v_delta) > 0.01 then 'mismatch'
    when v_evidence_count = 0 then 'missing_evidence'
    else 'matched'
  end;

  select * into v_prior
  from public.zysyr_report_cell_trace_revisions
  where company_id = v_target.company_id and target_cell_id = v_target.id
  order by revision desc limit 1 for update;

  insert into public.zysyr_report_cell_trace_revisions (
    company_id, store_id, target_cell_id, revision, supersedes_revision_id,
    expected_amount, source_amount, delta, status, source_count, evidence_count,
    created_by_user_id
  ) values (
    v_target.company_id, v_target.store_id, v_target.id,
    coalesce(v_prior.revision, 0) + 1, v_prior.id, v_target.numeric_value,
    v_source_amount, v_delta, v_status, v_source_count, v_evidence_count,
    p_actor_user_id
  ) returning * into v_saved;

  insert into public.zysyr_report_cell_trace_sources (
    company_id, store_id, trace_revision_id, source_cell_id, source_amount
  )
  select v_target.company_id, v_target.store_id, v_saved.id, source.id, source.numeric_value
  from public.zysyr_report_cells source
  where source.id = any(v_source_ids);

  insert into public.zysyr_report_cell_trace_evidence (
    company_id, store_id, trace_revision_id, voucher_id
  )
  select v_target.company_id, v_target.store_id, v_saved.id, voucher.id
  from public.zysyr_voucher_attachments voucher
  where voucher.id = any(v_voucher_ids);

  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  values (v_target.company_id, v_target.store_id, 'report_cell_trace_revision', v_saved.id)
  on conflict (company_id, entity_type, entity_id) do nothing;
  insert into public.zysyr_trace_nodes (company_id, store_id, entity_type, entity_id)
  select v_target.company_id, v_target.store_id, 'voucher', voucher.id
  from public.zysyr_voucher_attachments voucher where voucher.id = any(v_voucher_ids)
  on conflict (company_id, entity_type, entity_id) do nothing;

  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, target_node.id, revision_node.id,
    'contains', p_actor_user_id
  from public.zysyr_trace_nodes target_node, public.zysyr_trace_nodes revision_node
  where target_node.company_id = v_target.company_id
    and target_node.entity_type = 'report_cell' and target_node.entity_id = v_target.id
    and revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type,
    source_amount, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, revision_node.id, source_node.id,
    'derived_from', source.numeric_value, p_actor_user_id
  from public.zysyr_trace_nodes revision_node
  join public.zysyr_report_cells source on source.id = any(v_source_ids)
  join public.zysyr_trace_nodes source_node
    on source_node.company_id = source.company_id
   and source_node.entity_type = 'report_cell' and source_node.entity_id = source.id
  where revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;
  insert into public.zysyr_trace_edges (
    company_id, store_id, from_node_id, to_node_id, relation_type, created_by_user_id
  )
  select v_target.company_id, v_target.store_id, revision_node.id, voucher_node.id,
    'evidenced_by', p_actor_user_id
  from public.zysyr_trace_nodes revision_node
  join public.zysyr_voucher_attachments voucher on voucher.id = any(v_voucher_ids)
  join public.zysyr_trace_nodes voucher_node
    on voucher_node.company_id = voucher.company_id
   and voucher_node.entity_type = 'voucher' and voucher_node.entity_id = voucher.id
  where revision_node.company_id = v_target.company_id
    and revision_node.entity_type = 'report_cell_trace_revision' and revision_node.entity_id = v_saved.id;

  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json
  ) values (
    v_target.company_id, v_target.store_id, 'user', p_actor_user_id, 'web',
    'report_cell_trace', v_saved.id, 'revise',
    jsonb_build_object('target_cell_id', v_target.id, 'revision', v_saved.revision,
      'status', v_saved.status, 'expected_amount', v_saved.expected_amount,
      'source_amount', v_saved.source_amount, 'delta', v_saved.delta,
      'source_count', v_saved.source_count, 'evidence_count', v_saved.evidence_count)
  );
  return to_jsonb(v_saved);
end;
$$;

revoke execute on function public.zysyr_save_report_cell_trace(uuid, uuid[], uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.zysyr_save_report_cell_trace(uuid, uuid[], uuid[], uuid)
  to service_role;

alter table public.zysyr_report_cells enable row level security;
alter table public.zysyr_report_cells force row level security;
alter table public.zysyr_report_cell_trace_revisions enable row level security;
alter table public.zysyr_report_cell_trace_revisions force row level security;
alter table public.zysyr_report_cell_trace_sources enable row level security;
alter table public.zysyr_report_cell_trace_sources force row level security;
alter table public.zysyr_report_cell_trace_evidence enable row level security;
alter table public.zysyr_report_cell_trace_evidence force row level security;

create policy zysyr_report_cells_scope_select on public.zysyr_report_cells
for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_report_cell_trace_revisions_scope_select
on public.zysyr_report_cell_trace_revisions for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_report_cell_trace_sources_scope_select
on public.zysyr_report_cell_trace_sources for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_report_cell_trace_evidence_scope_select
on public.zysyr_report_cell_trace_evidence for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_report_cells,
  public.zysyr_report_cell_trace_revisions,
  public.zysyr_report_cell_trace_sources,
  public.zysyr_report_cell_trace_evidence
from public, anon, authenticated, service_role;
grant select on table public.zysyr_report_cells,
  public.zysyr_report_cell_trace_revisions,
  public.zysyr_report_cell_trace_sources,
  public.zysyr_report_cell_trace_evidence
to authenticated;
grant select, insert on table public.zysyr_report_cells,
  public.zysyr_report_cell_trace_revisions,
  public.zysyr_report_cell_trace_sources,
  public.zysyr_report_cell_trace_evidence
to service_role;

comment on table public.zysyr_report_cells is
  'Immutable numeric/formula cells parsed from each uploaded report version, preserving sheet, A1 address, label, value and formula precedents.';
comment on table public.zysyr_report_cell_trace_revisions is
  'Append-only finance-confirmed lineage revisions for monthly input cells. Latest revision determines reconciliation and evidence status.';
