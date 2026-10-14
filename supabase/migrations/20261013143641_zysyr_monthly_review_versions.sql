-- Additive, service-only workflow. No historical months are published, no old
-- read acknowledgements are promoted, and no financial rows/amounts are written.
set lock_timeout = '5s';
set statement_timeout = '30s';

create table public.zysyr_monthly_review_publications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  period_month date not null check (extract(day from period_month)=1),
  version integer not null check (version>0),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_token text not null check (source_token ~ '^[0-9a-f]{64}$'),
  published_by_user_id uuid not null,
  published_at timestamptz not null default clock_timestamp(),
  unique(company_id,store_id,period_month,version),
  unique(company_id,store_id,id),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id),
  foreign key(company_id,published_by_user_id) references public.zysyr_user_accounts(company_id,id)
);
create index monthly_review_publication_actor_idx on public.zysyr_monthly_review_publications(company_id,published_by_user_id);

create table public.zysyr_monthly_review_recipients (
  company_id uuid not null,
  store_id uuid not null,
  publication_id uuid not null,
  person_key text not null check (person_key ~ '^(account:[0-9a-f-]{36}|staff:[1-9][0-9]*)$'),
  display_name text not null,
  assigned_by_user_id uuid not null,
  assigned_at timestamptz not null default clock_timestamp(),
  primary key(publication_id,person_key),
  unique(company_id,store_id,publication_id,person_key),
  foreign key(company_id,store_id,publication_id) references public.zysyr_monthly_review_publications(company_id,store_id,id),
  foreign key(company_id,assigned_by_user_id) references public.zysyr_user_accounts(company_id,id)
);
create index monthly_review_recipient_inbox_idx on public.zysyr_monthly_review_recipients(company_id,store_id,person_key,publication_id);
create index monthly_review_recipient_assigner_idx on public.zysyr_monthly_review_recipients(company_id,assigned_by_user_id);

create table public.zysyr_monthly_review_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  publication_id uuid not null,
  person_key text not null,
  actor_user_account_id uuid,
  actor_staff_id integer references public.staff(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  statement_code text not null default 'reviewed_no_objection_v1'
    check (statement_code='reviewed_no_objection_v1'),
  unique(publication_id,person_key),
  foreign key(company_id,store_id,publication_id,person_key)
    references public.zysyr_monthly_review_recipients(company_id,store_id,publication_id,person_key),
  foreign key(company_id,actor_user_account_id) references public.zysyr_user_accounts(company_id,id),
  check ((actor_user_account_id is null) <> (actor_staff_id is null))
);
create index monthly_review_receipt_actor_idx on public.zysyr_monthly_review_receipts(company_id,actor_user_account_id);
create index monthly_review_receipt_staff_idx on public.zysyr_monthly_review_receipts(actor_staff_id) where actor_staff_id is not null;
create index monthly_review_receipt_scope_idx on public.zysyr_monthly_review_receipts(company_id,store_id,publication_id,person_key);

create function zysyr_private.monthly_review_record_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'MONTHLY_REVIEW_RECORD_IMMUTABLE'; end $$;
revoke all on function zysyr_private.monthly_review_record_immutable() from public,anon,authenticated,service_role;
create trigger monthly_review_publication_immutable before update or delete on public.zysyr_monthly_review_publications
  for each row execute function zysyr_private.monthly_review_record_immutable();
create trigger monthly_review_recipient_immutable before update or delete on public.zysyr_monthly_review_recipients
  for each row execute function zysyr_private.monthly_review_record_immutable();
create trigger monthly_review_receipt_immutable before update or delete on public.zysyr_monthly_review_receipts
  for each row execute function zysyr_private.monthly_review_record_immutable();
alter table public.zysyr_monthly_review_publications enable row level security;
alter table public.zysyr_monthly_review_publications force row level security;
alter table public.zysyr_monthly_review_recipients enable row level security;
alter table public.zysyr_monthly_review_recipients force row level security;
alter table public.zysyr_monthly_review_receipts enable row level security;
alter table public.zysyr_monthly_review_receipts force row level security;
revoke all on public.zysyr_monthly_review_publications,public.zysyr_monthly_review_recipients,
  public.zysyr_monthly_review_receipts from public,anon,authenticated,service_role;
grant select on public.zysyr_monthly_review_publications,public.zysyr_monthly_review_recipients,
  public.zysyr_monthly_review_receipts to service_role;

-- A scoped optimistic-read token, not a new financial formula. Includes all
-- dependencies of the existing monthly display and confirmed daily rollup.
-- Never returns raw daily sources, customer data, files, credentials or amounts.
create function zysyr_private.monthly_review_assert_scope(p_company_id uuid,p_store_id uuid)
returns void language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.zysyr_stores s join public.zysyr_companies c on c.id=s.company_id
    where s.company_id=p_company_id and s.id=p_store_id and s.status='active' and s.deleted_at is null and c.status='active') then
    raise exception 'MONTHLY_REVIEW_STORE_DENIED';
  end if;
end $$;
revoke all on function zysyr_private.monthly_review_assert_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function zysyr_private.monthly_review_assert_scope(uuid,uuid) to service_role;
create function public.zysyr_monthly_review_source_token(p_company_id uuid,p_store_id uuid,p_period_month date)
returns text language plpgsql stable security invoker set search_path=pg_catalog,public set timezone='UTC' as $$
declare material jsonb;
begin
  if p_period_month is null or extract(day from p_period_month)<>1 then
    raise exception 'MONTHLY_REVIEW_MONTH_INVALID';
  end if;
  perform zysyr_private.monthly_review_assert_scope(p_company_id,p_store_id);
  with reports as (
    select r.* from public.zysyr_report_uploads r where r.company_id=p_company_id and r.store_id=p_store_id
      and r.report_type='monthly_profit_loss' and r.report_date=p_period_month
  ), history as (
    select h.* from public.zysyr_history_ledger_entries h where h.company_id=p_company_id and h.store_id=p_store_id
      and h.entry_type='monthly_profit_loss' and h.period_month=p_period_month and h.status='posted'
  ), days as (
    select d.id,d.report_date,d.edit_revision,d.status,d.confirmed_at from public.zysyr_daily_sheet_drafts d
    where d.company_id=p_company_id and d.store_id=p_store_id and d.status='confirmed'
      and d.report_date>=p_period_month and d.report_date<(p_period_month+interval '1 month')::date
  )
  select jsonb_build_object(
    'scope',jsonb_build_array(p_company_id,p_store_id,p_period_month),
    'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from reports r),
    'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_report_cells c
      where c.company_id=p_company_id and c.store_id=p_store_id and c.report_id in(select id from reports)),
    'amount_revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.zysyr_monthly_cell_revisions r
      where r.company_id=p_company_id and r.store_id=p_store_id and r.report_id in(select id from reports)),
    'text_revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.zysyr_monthly_text_revisions r
      where r.company_id=p_company_id and r.store_id=p_store_id and r.report_id in(select id from reports)),
    'income_adjustments',(select jsonb_agg(to_jsonb(a) order by a.id) from public.zysyr_monthly_income_adjustments a
      where a.company_id=p_company_id and a.store_id=p_store_id and a.period_month=p_period_month),
    'history',(select jsonb_agg(to_jsonb(h) order by h.id) from history h),
    'history_batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.zysyr_history_import_batches b
      where b.company_id=p_company_id and b.store_id=p_store_id and b.id in(select import_batch_id from history)),
    'days',(select jsonb_agg(to_jsonb(d) order by d.id) from days d),
    'day_cells',(select jsonb_agg(jsonb_build_array(c.id,c.draft_id,c.section_code,c.column_code,c.row_key,
        c.cell_role,c.ocr_numeric,c.corrected_numeric,c.manual_override) order by c.id)
      from public.zysyr_daily_sheet_cells c where c.company_id=p_company_id and c.store_id=p_store_id
        and c.draft_id in(select id from days) and c.section_code in('summary','payment')
        and c.column_code in('grand_total','cash_flow','card_consumption','group_buy','alipay','wechat','douyin'))
  ) into material;
  return encode(sha256(convert_to(material::text,'UTF8')),'hex');
end $$;
revoke all on function public.zysyr_monthly_review_source_token(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.zysyr_monthly_review_source_token(uuid,uuid,date) to service_role;

-- Deliberately private definer: the service has NO direct INSERT/UPDATE/DELETE
-- privilege on review tables. This is the only publication mutation gateway;
-- it reuses existing finance authorization without relaxing that helper's ACL.
-- Actor IDs and snapshot must come from authenticated Edge code, NOT payload IDs.
create function zysyr_private.monthly_review_publish(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_period_month date,
  p_snapshot jsonb,p_source_token text,p_expected_publication_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,zysyr_private
set lock_timeout='5s' set statement_timeout='30s' as $$
declare prior public.zysyr_monthly_review_publications; saved public.zysyr_monthly_review_publications;
  digest text; is_new boolean:=false; added integer; recipient_rows jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>2097152
    or p_snapshot->>'schema_version' is distinct from '1'
    or p_snapshot->>'month' is distinct from to_char(p_period_month,'YYYY-MM')
    or p_snapshot->>'store_id' is distinct from p_store_id::text
    or jsonb_typeof(p_snapshot->'report') is distinct from 'object'
    or jsonb_typeof(p_snapshot#>'{report,display_data,values}') is distinct from 'array' then
    raise exception 'MONTHLY_REVIEW_SNAPSHOT_INVALID';
  end if;
  if jsonb_array_length(p_snapshot#>'{report,display_data,values}')=0 then
    raise exception 'MONTHLY_REVIEW_SNAPSHOT_EMPTY';
  end if;
  -- Same month lock as existing manual monthly edits, plus the receipt workflow.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||p_period_month::text,0));
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'report.upload');
  if p_source_token is distinct from public.zysyr_monthly_review_source_token(p_company_id,p_store_id,p_period_month) then
    raise exception 'MONTHLY_REVIEW_SOURCE_CHANGED';
  end if;
  -- An empty month must never become a published "all clear" report.
  if not exists(select 1 from public.zysyr_report_uploads r where r.company_id=p_company_id and r.store_id=p_store_id
      and r.report_type='monthly_profit_loss' and r.report_date=p_period_month and r.status='active')
    and not exists(select 1 from public.zysyr_history_ledger_entries h
      join public.zysyr_history_import_batches b on b.company_id=h.company_id and b.store_id=h.store_id and b.id=h.import_batch_id
      where h.company_id=p_company_id and h.store_id=p_store_id and h.period_month=p_period_month
        and h.entry_type='monthly_profit_loss' and h.status='posted' and b.status='completed') then
    raise exception 'MONTHLY_REVIEW_REPORT_MISSING';
  end if;
  select * into prior from public.zysyr_monthly_review_publications
    where company_id=p_company_id and store_id=p_store_id and period_month=p_period_month order by version desc limit 1;
  digest:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  select jsonb_agg(to_jsonb(r)) into recipient_rows from zysyr_private.monthly_review_recipients(p_company_id,p_store_id) r;
  -- A lost reply/double click with the same content returns the existing version.
  -- A stale tab with DIFFERENT content cannot overwrite the latest publication.
  if prior.id is not null and prior.content_hash=digest then saved:=prior;
  else
    if prior.id is distinct from p_expected_publication_id then raise exception 'MONTHLY_REVIEW_VERSION_CHANGED'; end if;
    if recipient_rows is null then raise exception 'MONTHLY_REVIEW_NO_RECIPIENTS'; end if;
    insert into public.zysyr_monthly_review_publications(company_id,store_id,period_month,version,snapshot,content_hash,source_token,published_by_user_id)
    values(p_company_id,p_store_id,p_period_month,coalesce(prior.version,0)+1,p_snapshot,digest,p_source_token,p_actor_user_id) returning * into saved;
    is_new:=true;
  end if;
  -- Explicit finance re-submit may include newly authorized readers, without
  -- resetting anybody's existing receipt or altering the original snapshot.
  insert into public.zysyr_monthly_review_recipients(company_id,store_id,publication_id,person_key,display_name,assigned_by_user_id)
  select p_company_id,p_store_id,saved.id,r.person_key,r.display_name,p_actor_user_id
  from jsonb_to_recordset(coalesce(recipient_rows,'[]'::jsonb)) as r(person_key text,display_name text)
  on conflict(publication_id,person_key) do nothing;
  get diagnostics added=row_count;
  return (to_jsonb(saved)-'snapshot')||jsonb_build_object('created',is_new,'added_recipients',added);
end $$;
revoke all on function zysyr_private.monthly_review_publish(uuid,uuid,uuid,date,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function zysyr_private.monthly_review_publish(uuid,uuid,uuid,date,jsonb,text,uuid) to service_role;
create function public.zysyr_publish_monthly_review(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_period_month date,
  p_snapshot jsonb,p_source_token text,p_expected_publication_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select zysyr_private.monthly_review_publish(p_actor_user_id,p_company_id,p_store_id,p_period_month,p_snapshot,p_source_token,p_expected_publication_id);
$$;
revoke all on function public.zysyr_publish_monthly_review(uuid,uuid,uuid,date,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.zysyr_publish_monthly_review(uuid,uuid,uuid,date,jsonb,text,uuid) to service_role;

create function zysyr_private.monthly_review_confirm(
  p_company_id uuid,p_store_id uuid,p_publication_id uuid,p_content_hash text,
  p_current_snapshot jsonb,p_source_token text,p_statement_code text,
  p_user_account_id uuid,p_staff_id integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,zysyr_private
set lock_timeout='5s' set statement_timeout='30s' as $$
declare person text; publication public.zysyr_monthly_review_publications;
  receipt public.zysyr_monthly_review_receipts; newest uuid;
begin
  perform zysyr_private.monthly_review_assert_scope(p_company_id,p_store_id);
  person:=public.zysyr_monthly_review_identity(p_company_id,p_store_id,p_user_account_id,p_staff_id);
  if p_statement_code is distinct from 'reviewed_no_objection_v1' then raise exception 'MONTHLY_REVIEW_CONSENT_REQUIRED'; end if;
  select * into publication from public.zysyr_monthly_review_publications
    where company_id=p_company_id and store_id=p_store_id and id=p_publication_id;
  if publication.id is null then raise exception 'MONTHLY_REVIEW_PUBLICATION_NOT_FOUND'; end if;
  if p_content_hash is distinct from publication.content_hash then raise exception 'MONTHLY_REVIEW_CONTENT_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_store_id::text||':'||publication.period_month::text,0));
  perform zysyr_private.monthly_review_assert_scope(p_company_id,p_store_id);
  person:=public.zysyr_monthly_review_identity(p_company_id,p_store_id,p_user_account_id,p_staff_id);
  -- Idempotent readback after a lost response, even if a newer version has since
  -- appeared. It returns the SAME receipt/time, never confirms that newer version.
  select * into receipt from public.zysyr_monthly_review_receipts where publication_id=publication.id and person_key=person;
  if receipt.id is not null then return to_jsonb(receipt)||jsonb_build_object('created',false); end if;
  select id into newest from public.zysyr_monthly_review_publications
    where company_id=p_company_id and store_id=p_store_id and period_month=publication.period_month order by version desc limit 1;
  if newest is distinct from publication.id then raise exception 'MONTHLY_REVIEW_VERSION_CHANGED'; end if;
  if not exists(select 1 from public.zysyr_monthly_review_recipients where publication_id=publication.id and person_key=person) then
    raise exception 'MONTHLY_REVIEW_RECIPIENT_REQUIRED';
  end if;
  -- Edge rebuilds this using the EXISTING server monthly projection between two
  -- source-token reads. Neither the snapshot nor the actor is browser supplied.
  -- If money changes before finance re-submits, confirmation is blocked, not
  -- silently attached to unseen numbers. Metadata-only source changes can pass
  -- after Edge verifies an identical display snapshot.
  if p_source_token is distinct from public.zysyr_monthly_review_source_token(p_company_id,p_store_id,publication.period_month) then
    raise exception 'MONTHLY_REVIEW_SOURCE_CHANGED';
  end if;
  if p_current_snapshot is null or encode(sha256(convert_to(p_current_snapshot::text,'UTF8')),'hex') is distinct from publication.content_hash then
    raise exception 'MONTHLY_REVIEW_REPUBLICATION_REQUIRED';
  end if;
  insert into public.zysyr_monthly_review_receipts(company_id,store_id,publication_id,person_key,actor_user_account_id,actor_staff_id)
  values(p_company_id,p_store_id,publication.id,person,p_user_account_id,p_staff_id) returning * into receipt;
  return to_jsonb(receipt)||jsonb_build_object('created',true);
end $$;
revoke all on function zysyr_private.monthly_review_confirm(uuid,uuid,uuid,text,jsonb,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function zysyr_private.monthly_review_confirm(uuid,uuid,uuid,text,jsonb,text,text,uuid,integer) to service_role;
create function public.zysyr_confirm_monthly_review(p_company_id uuid,p_store_id uuid,p_publication_id uuid,p_content_hash text,
  p_current_snapshot jsonb,p_source_token text,p_statement_code text,p_user_account_id uuid default null,p_staff_id integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select zysyr_private.monthly_review_confirm(p_company_id,p_store_id,p_publication_id,p_content_hash,
    p_current_snapshot,p_source_token,p_statement_code,p_user_account_id,p_staff_id);
$$;
revoke all on function public.zysyr_confirm_monthly_review(uuid,uuid,uuid,text,jsonb,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.zysyr_confirm_monthly_review(uuid,uuid,uuid,text,jsonb,text,text,uuid,integer) to service_role;

-- Lightweight per-store inbox: no report parsing, voucher downloads or one query
-- per month. Identity is resolved afresh, so revoked readers lose access at once.
create function public.zysyr_monthly_review_inbox(p_company_id uuid,p_store_id uuid,
  p_user_account_id uuid default null,p_staff_id integer default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public,zysyr_private as $$
declare person text; result jsonb;
begin
  perform zysyr_private.monthly_review_assert_scope(p_company_id,p_store_id);
  person:=public.zysyr_monthly_review_identity(p_company_id,p_store_id,p_user_account_id,p_staff_id);
  with latest as (
    select distinct on(p.period_month) p.id,p.period_month,p.version,p.content_hash,p.published_at
    from public.zysyr_monthly_review_publications p where p.company_id=p_company_id and p.store_id=p_store_id
    order by p.period_month,p.version desc
  )
  select coalesce(jsonb_agg(to_jsonb(l) order by l.period_month desc),'[]'::jsonb) into result
  from latest l join public.zysyr_monthly_review_recipients r on r.publication_id=l.id and r.person_key=person
  where not exists(select 1 from public.zysyr_monthly_review_receipts c where c.publication_id=l.id and c.person_key=person);
  return jsonb_build_object('pending',result,'count',jsonb_array_length(result));
end $$;
revoke all on function public.zysyr_monthly_review_inbox(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.zysyr_monthly_review_inbox(uuid,uuid,uuid,integer) to service_role;

-- Publication/receipt history is its own immutable audit trail. Existing read
-- acknowledgements, financial audit events, grants and ledgers remain untouched.
create function zysyr_private.monthly_review_status(p_company_id uuid,p_store_id uuid,p_period_month date,
  p_user_account_id uuid,p_staff_id integer,p_as_finance boolean)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,zysyr_private as $$
declare person text; publication public.zysyr_monthly_review_publications; receipt jsonb;
  recipients jsonb; history jsonb;
begin
  if p_period_month is null or extract(day from p_period_month)<>1 then raise exception 'MONTHLY_REVIEW_MONTH_INVALID'; end if;
  perform zysyr_private.monthly_review_assert_scope(p_company_id,p_store_id);
  if p_as_finance is true then
    if p_staff_id is not null then raise exception 'MONTHLY_REVIEW_FINANCE_REQUIRED'; end if;
    perform zysyr_private.assert_finance_scope(p_user_account_id,p_company_id,p_store_id,'report.upload');
  else
    person:=public.zysyr_monthly_review_identity(p_company_id,p_store_id,p_user_account_id,p_staff_id);
  end if;
  select * into publication from public.zysyr_monthly_review_publications where company_id=p_company_id
    and store_id=p_store_id and period_month=p_period_month order by version desc limit 1;
  if publication.id is null then return jsonb_build_object('publication',null,'receipt',null,'history','[]'::jsonb); end if;
  if p_as_finance is true then
    select coalesce(jsonb_agg(jsonb_build_object('person_key',r.person_key,'display_name',r.display_name,
      'confirmed_at',c.confirmed_at,'receipt_id',c.id,'access_active',a.person_key is not null) order by r.person_key),'[]'::jsonb)
      into recipients from public.zysyr_monthly_review_recipients r
      left join public.zysyr_monthly_review_receipts c on c.publication_id=r.publication_id and c.person_key=r.person_key
      left join zysyr_private.monthly_review_recipients(p_company_id,p_store_id) a on a.person_key=r.person_key
      where r.publication_id=publication.id;
  else
    select to_jsonb(c) into receipt from public.zysyr_monthly_review_receipts c
      where c.publication_id=publication.id and c.person_key=person;
  end if;
  -- A reader sees only their own receipt, never other people's login identifiers.
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'content_hash',p.content_hash,
    'published_at',p.published_at,'my_confirmed_at',c.confirmed_at) order by p.version desc),'[]'::jsonb)
    into history from public.zysyr_monthly_review_publications p
    left join public.zysyr_monthly_review_receipts c on c.publication_id=p.id and c.person_key=person
    where p.company_id=p_company_id and p.store_id=p_store_id and p.period_month=p_period_month;
  return jsonb_build_object('publication',to_jsonb(publication),'receipt',receipt,'history',history,
    'assigned',exists(select 1 from public.zysyr_monthly_review_recipients where publication_id=publication.id and person_key=person))
    ||case when p_as_finance is true then jsonb_build_object('recipients',recipients) else '{}'::jsonb end;
end $$;
revoke all on function zysyr_private.monthly_review_status(uuid,uuid,date,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function zysyr_private.monthly_review_status(uuid,uuid,date,uuid,integer,boolean) to service_role;
create function public.zysyr_monthly_review_status(p_company_id uuid,p_store_id uuid,p_period_month date,
  p_user_account_id uuid default null,p_staff_id integer default null,p_as_finance boolean default false)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select zysyr_private.monthly_review_status(p_company_id,p_store_id,p_period_month,p_user_account_id,p_staff_id,p_as_finance);
$$;
revoke all on function public.zysyr_monthly_review_status(uuid,uuid,date,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.zysyr_monthly_review_status(uuid,uuid,date,uuid,integer,boolean) to service_role;
