-- ZYSYR v463: formal ledger for approved historical imports.
-- The immutable staging source remains the evidence of what was uploaded.
-- Formal entries keep a posting snapshot and append-only revisions so later
-- finance corrections never rewrite the original workbook or voucher links.
set statement_timeout = '120s';
set lock_timeout = '5s';

create table public.zysyr_history_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  import_batch_id uuid not null,
  import_row_id uuid not null,
  entry_type text not null check (entry_type in (
    'monthly_profit_loss', 'salary', 'petty_cash', 'employee_purchase'
  )),
  period_month date not null,
  source_sheet text not null check (nullif(btrim(source_sheet), '') is not null),
  source_locator text not null check (nullif(btrim(source_locator), '') is not null),
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  posted_payload jsonb not null check (jsonb_typeof(posted_payload) = 'object'),
  current_payload jsonb not null check (jsonb_typeof(current_payload) = 'object'),
  posted_validation_status text not null check (
    posted_validation_status in ('valid', 'warning')
  ),
  posted_validation_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(posted_validation_issues) = 'array'),
  posted_review_status text not null check (
    posted_review_status in ('pending', 'confirmed', 'needs_correction')
  ),
  posted_with_warning boolean not null default false,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  version integer not null default 1 check (version >= 1),
  posted_by_user_id uuid not null,
  posted_at timestamptz not null default now(),
  last_modified_by_user_id uuid not null,
  last_modified_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reversal_reason text,
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, import_row_id),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_row_id)
    references public.zysyr_history_import_rows(company_id, store_id, id) on delete restrict,
  foreign key (company_id, posted_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, last_modified_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (period_month = date_trunc('month', period_month)::date),
  check (
    (status = 'posted' and reversed_by_user_id is null and reversed_at is null
      and reversal_reason is null)
    or (status = 'reversed' and reversed_by_user_id is not null
      and reversed_at is not null and nullif(btrim(reversal_reason), '') is not null)
  )
);

create index zysyr_history_ledger_entries_scope_idx
  on public.zysyr_history_ledger_entries
  (company_id, store_id, period_month desc, entry_type, status);
create index zysyr_history_ledger_entries_batch_idx
  on public.zysyr_history_ledger_entries
  (company_id, store_id, import_batch_id, source_sheet, source_locator);

create table public.zysyr_history_ledger_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  ledger_entry_id uuid not null,
  import_batch_id uuid not null,
  import_row_id uuid not null,
  version integer not null check (version >= 1),
  action text not null check (action in ('post', 'revise', 'reverse')),
  before_payload jsonb check (
    before_payload is null or jsonb_typeof(before_payload) = 'object'
  ),
  after_payload jsonb not null check (jsonb_typeof(after_payload) = 'object'),
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, ledger_entry_id, version),
  foreign key (company_id, store_id, ledger_entry_id)
    references public.zysyr_history_ledger_entries(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_batch_id)
    references public.zysyr_history_import_batches(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, import_row_id)
    references public.zysyr_history_import_rows(company_id, store_id, id) on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((action = 'post' and version = 1 and before_payload is null)
    or (action in ('revise', 'reverse') and version > 1 and before_payload is not null))
);

create index zysyr_history_ledger_revisions_entry_idx
  on public.zysyr_history_ledger_revisions
  (company_id, store_id, ledger_entry_id, version desc);

create or replace function zysyr_private.protect_history_ledger_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'HISTORY_LEDGER_APPEND_ONLY';
  end if;
  if old.company_id is distinct from new.company_id
     or old.store_id is distinct from new.store_id
     or old.import_batch_id is distinct from new.import_batch_id
     or old.import_row_id is distinct from new.import_row_id
     or old.entry_type is distinct from new.entry_type
     or old.period_month is distinct from new.period_month
     or old.source_sheet is distinct from new.source_sheet
     or old.source_locator is distinct from new.source_locator
     or old.source_row_hash is distinct from new.source_row_hash
     or old.posted_payload is distinct from new.posted_payload
     or old.posted_validation_status is distinct from new.posted_validation_status
     or old.posted_validation_issues is distinct from new.posted_validation_issues
     or old.posted_review_status is distinct from new.posted_review_status
     or old.posted_with_warning is distinct from new.posted_with_warning
     or old.posted_by_user_id is distinct from new.posted_by_user_id
     or old.posted_at is distinct from new.posted_at then
    raise exception using errcode = '55000', message = 'HISTORY_LEDGER_POSTING_IMMUTABLE';
  end if;
  return new;
end $$;

revoke all on function zysyr_private.protect_history_ledger_entry() from public;

create trigger zysyr_history_ledger_entries_protect
before update or delete on public.zysyr_history_ledger_entries
for each row execute function zysyr_private.protect_history_ledger_entry();

create trigger zysyr_history_ledger_revisions_immutable
before update or delete on public.zysyr_history_ledger_revisions
for each row execute function zysyr_private.prevent_history_import_record_mutation();

alter table public.zysyr_history_import_events
  drop constraint if exists zysyr_history_import_events_action_check;
alter table public.zysyr_history_import_events
  add constraint zysyr_history_import_events_action_check check (action in (
    'stage', 'row_correct', 'row_review', 'month_review',
    'evidence_upload', 'evidence_link', 'confirm',
    'import_start', 'row_import', 'row_fail', 'complete', 'cancel',
    'formal_post', 'ledger_revise', 'ledger_reverse'
  ));

create or replace function public.zysyr_post_history_import_batch(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_import_batch_id uuid,
  p_allow_unreviewed boolean,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.zysyr_history_import_batches;
  v_inserted integer := 0;
  v_imported integer := 0;
  v_warning integer := 0;
  v_unreviewed integer := 0;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_LEDGER_POST_REASON_REQUIRED';
  end if;

  select * into v_batch
  from public.zysyr_history_import_batches batch
  where batch.company_id = p_company_id and batch.store_id = p_store_id
    and batch.id = p_import_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_IMPORT_BATCH_NOT_FOUND';
  end if;

  if v_batch.status = 'completed' then
    select count(*)::integer into v_imported
    from public.zysyr_history_ledger_entries entry
    where entry.company_id = p_company_id and entry.store_id = p_store_id
      and entry.import_batch_id = p_import_batch_id;
    return jsonb_build_object(
      'batch_id', p_import_batch_id, 'status', 'completed',
      'inserted_count', 0, 'imported_count', v_imported,
      'already_completed', true, 'formal_ledger_written', v_imported > 0
    );
  end if;
  if v_batch.status not in ('needs_review', 'ready', 'partial', 'failed') then
    raise exception using errcode = '55000', message = 'HISTORY_IMPORT_BATCH_NOT_POSTABLE';
  end if;
  if v_batch.invalid_row_count > 0 or exists (
    select 1 from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.import_batch_id = p_import_batch_id
      and row_item.validation_status = 'invalid'
  ) then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HAS_INVALID_ROWS';
  end if;
  if exists (
    select 1 from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.import_batch_id = p_import_batch_id
      and (
        coalesce(row_item.reviewed_snapshot, row_item.corrected_json, row_item.mapped_json)
          ->>'period_month' is null
        or coalesce(row_item.reviewed_snapshot, row_item.corrected_json, row_item.mapped_json)
          ->>'period_month' !~ '^[0-9]{4}-[0-9]{2}-01$'
      )
  ) then
    raise exception using errcode = '22007', message = 'HISTORY_IMPORT_PERIOD_MONTH_INVALID';
  end if;

  select count(*) filter (where row_item.review_status <> 'confirmed')::integer,
    count(*) filter (where row_item.validation_status = 'warning')::integer
  into v_unreviewed, v_warning
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id;
  if v_unreviewed > 0 and not coalesce(p_allow_unreviewed, false) then
    raise exception using errcode = '23514', message = 'HISTORY_IMPORT_HUMAN_REVIEW_INCOMPLETE';
  end if;

  update public.zysyr_history_import_batches set
    status = 'importing',
    confirmed_by_user_id = coalesce(confirmed_by_user_id, p_actor_user_id),
    confirmed_at = coalesce(confirmed_at, now()),
    confirmation_reason = coalesce(confirmation_reason, btrim(p_reason)),
    failure_summary = '{}'::jsonb
  where company_id = p_company_id and id = p_import_batch_id;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, 'import_start',
    jsonb_build_object('allow_unreviewed', coalesce(p_allow_unreviewed, false),
      'unreviewed_count', v_unreviewed, 'warning_count', v_warning),
    btrim(p_reason), p_actor_user_id
  );

  with inserted as (
    insert into public.zysyr_history_ledger_entries(
      company_id, store_id, import_batch_id, import_row_id, entry_type,
      period_month, source_sheet, source_locator, source_row_hash,
      posted_payload, current_payload, posted_validation_status,
      posted_validation_issues, posted_review_status, posted_with_warning,
      posted_by_user_id, last_modified_by_user_id
    )
    select row_item.company_id, row_item.store_id, row_item.import_batch_id,
      row_item.id, v_batch.import_type,
      (coalesce(row_item.reviewed_snapshot, row_item.corrected_json, row_item.mapped_json)
        ->>'period_month')::date,
      row_item.source_sheet, row_item.source_locator, row_item.row_hash,
      coalesce(row_item.reviewed_snapshot, row_item.corrected_json, row_item.mapped_json),
      coalesce(row_item.reviewed_snapshot, row_item.corrected_json, row_item.mapped_json),
      row_item.validation_status, row_item.validation_issues, row_item.review_status,
      row_item.validation_status = 'warning' or row_item.review_status <> 'confirmed',
      p_actor_user_id, p_actor_user_id
    from public.zysyr_history_import_rows row_item
    where row_item.company_id = p_company_id and row_item.store_id = p_store_id
      and row_item.import_batch_id = p_import_batch_id
      and row_item.import_status <> 'skipped'
    on conflict (company_id, store_id, import_row_id) do nothing
    returning *
  ), revision_rows as (
    insert into public.zysyr_history_ledger_revisions(
      company_id, store_id, ledger_entry_id, import_batch_id, import_row_id,
      version, action, before_payload, after_payload, reason, actor_user_id
    )
    select entry.company_id, entry.store_id, entry.id, entry.import_batch_id,
      entry.import_row_id, 1, 'post', null, entry.posted_payload,
      btrim(p_reason), p_actor_user_id
    from inserted entry
    returning 1
  )
  select count(*)::integer into v_inserted from revision_rows;

  update public.zysyr_history_import_rows row_item set
    import_status = 'imported', target_business_type = 'history_ledger',
    target_business_id = entry.id, import_error = null,
    imported_at = coalesce(row_item.imported_at, entry.posted_at), updated_at = now()
  from public.zysyr_history_ledger_entries entry
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and entry.company_id = row_item.company_id and entry.store_id = row_item.store_id
    and entry.import_row_id = row_item.id;

  select count(*)::integer into v_imported
  from public.zysyr_history_import_rows row_item
  where row_item.company_id = p_company_id and row_item.store_id = p_store_id
    and row_item.import_batch_id = p_import_batch_id
    and row_item.import_status = 'imported';
  if v_imported <> v_batch.raw_row_count then
    raise exception using errcode = '23514', message = 'HISTORY_LEDGER_ROW_COUNT_MISMATCH';
  end if;

  update public.zysyr_history_import_batches set
    status = 'completed', imported_row_count = v_imported,
    failed_row_count = 0, completed_at = now(), failure_summary = '{}'::jsonb
  where company_id = p_company_id and id = p_import_batch_id;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, action, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, p_import_batch_id, 'complete',
    jsonb_build_object('inserted_count', v_inserted, 'imported_count', v_imported,
      'warning_count', v_warning, 'unreviewed_count', v_unreviewed,
      'formal_ledger_written', true),
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_import_batch', p_import_batch_id, 'formal_post',
    jsonb_build_object('inserted_count', v_inserted, 'imported_count', v_imported,
      'warning_count', v_warning, 'unreviewed_count', v_unreviewed),
    btrim(p_reason), 'financial'
  );

  return jsonb_build_object(
    'batch_id', p_import_batch_id, 'status', 'completed',
    'inserted_count', v_inserted, 'imported_count', v_imported,
    'warning_count', v_warning, 'unreviewed_count', v_unreviewed,
    'already_completed', false, 'formal_ledger_written', true
  );
end $$;

create or replace function public.zysyr_revise_history_ledger_entry(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_ledger_entry_id uuid,
  p_current_payload jsonb,
  p_reason text
) returns public.zysyr_history_ledger_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.zysyr_history_ledger_entries;
  v_after public.zysyr_history_ledger_entries;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if jsonb_typeof(p_current_payload) <> 'object'
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_LEDGER_REVISION_INVALID';
  end if;
  select * into v_before
  from public.zysyr_history_ledger_entries entry
  where entry.company_id = p_company_id and entry.store_id = p_store_id
    and entry.id = p_ledger_entry_id and entry.status = 'posted'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_LEDGER_ENTRY_NOT_EDITABLE';
  end if;
  if p_current_payload->>'period_month' is distinct from to_char(v_before.period_month, 'YYYY-MM-DD') then
    raise exception using errcode = '23514', message = 'HISTORY_LEDGER_PERIOD_IMMUTABLE';
  end if;
  if p_current_payload = v_before.current_payload then
    raise exception using errcode = '22023', message = 'HISTORY_LEDGER_NO_CHANGES';
  end if;

  insert into public.zysyr_history_ledger_revisions(
    company_id, store_id, ledger_entry_id, import_batch_id, import_row_id,
    version, action, before_payload, after_payload, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.id, v_before.import_batch_id,
    v_before.import_row_id, v_before.version + 1, 'revise',
    v_before.current_payload, p_current_payload, btrim(p_reason), p_actor_user_id
  );
  update public.zysyr_history_ledger_entries set
    current_payload = p_current_payload, version = v_before.version + 1,
    last_modified_by_user_id = p_actor_user_id, last_modified_at = now()
  where company_id = p_company_id and id = v_before.id
  returning * into v_after;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, import_row_id, action,
    before_json, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.import_batch_id, v_before.import_row_id,
    'ledger_revise', v_before.current_payload, v_after.current_payload,
    btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_ledger_entry', v_after.id, 'revise',
    v_before.current_payload, v_after.current_payload, btrim(p_reason), 'financial'
  );
  return v_after;
end $$;

create or replace function public.zysyr_reverse_history_ledger_entry(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_ledger_entry_id uuid,
  p_reason text
) returns public.zysyr_history_ledger_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.zysyr_history_ledger_entries;
  v_after public.zysyr_history_ledger_entries;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'expense.create_submit'
  );
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'HISTORY_LEDGER_REVERSAL_REASON_REQUIRED';
  end if;
  select * into v_before
  from public.zysyr_history_ledger_entries entry
  where entry.company_id = p_company_id and entry.store_id = p_store_id
    and entry.id = p_ledger_entry_id and entry.status = 'posted'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HISTORY_LEDGER_ENTRY_NOT_REVERSIBLE';
  end if;

  insert into public.zysyr_history_ledger_revisions(
    company_id, store_id, ledger_entry_id, import_batch_id, import_row_id,
    version, action, before_payload, after_payload, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.id, v_before.import_batch_id,
    v_before.import_row_id, v_before.version + 1, 'reverse',
    v_before.current_payload, v_before.current_payload, btrim(p_reason), p_actor_user_id
  );
  update public.zysyr_history_ledger_entries set
    status = 'reversed', version = v_before.version + 1,
    last_modified_by_user_id = p_actor_user_id, last_modified_at = now(),
    reversed_by_user_id = p_actor_user_id, reversed_at = now(),
    reversal_reason = btrim(p_reason)
  where company_id = p_company_id and id = v_before.id
  returning * into v_after;

  insert into public.zysyr_history_import_events(
    company_id, store_id, import_batch_id, import_row_id, action,
    before_json, after_json, reason, actor_user_id
  ) values (
    p_company_id, p_store_id, v_before.import_batch_id, v_before.import_row_id,
    'ledger_reverse', jsonb_build_object('status', v_before.status,
      'version', v_before.version), jsonb_build_object('status', v_after.status,
      'version', v_after.version), btrim(p_reason), p_actor_user_id
  );
  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel, entity_type,
    entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'import',
    'history_ledger_entry', v_after.id, 'reverse',
    jsonb_build_object('status', v_before.status, 'version', v_before.version),
    jsonb_build_object('status', v_after.status, 'version', v_after.version),
    btrim(p_reason), 'financial'
  );
  return v_after;
end $$;

revoke all on function public.zysyr_post_history_import_batch(
  uuid, uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.zysyr_revise_history_ledger_entry(
  uuid, uuid, uuid, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.zysyr_reverse_history_ledger_entry(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.zysyr_post_history_import_batch(
  uuid, uuid, uuid, uuid, boolean, text
) to service_role;
grant execute on function public.zysyr_revise_history_ledger_entry(
  uuid, uuid, uuid, uuid, jsonb, text
) to service_role;
grant execute on function public.zysyr_reverse_history_ledger_entry(
  uuid, uuid, uuid, uuid, text
) to service_role;

alter table public.zysyr_history_ledger_entries enable row level security;
alter table public.zysyr_history_ledger_entries force row level security;
alter table public.zysyr_history_ledger_revisions enable row level security;
alter table public.zysyr_history_ledger_revisions force row level security;

create policy zysyr_history_ledger_entries_scope_select
  on public.zysyr_history_ledger_entries for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));
create policy zysyr_history_ledger_revisions_scope_select
  on public.zysyr_history_ledger_revisions for select to authenticated
  using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table
  public.zysyr_history_ledger_entries,
  public.zysyr_history_ledger_revisions
from public, anon, authenticated, service_role;
grant select on table
  public.zysyr_history_ledger_entries,
  public.zysyr_history_ledger_revisions
to authenticated, service_role;

comment on table public.zysyr_history_ledger_entries is
  'Formal historical accounting entries linked one-to-one to immutable import rows and their original evidence.';
comment on table public.zysyr_history_ledger_revisions is
  'Append-only posting, correction and reversal history for formal historical accounting entries.';
