-- Explicit finance attestation; no source flag, amount or ledger rewrite.
set statement_timeout='30s';
set lock_timeout='5s';
create table if not exists zysyr_private.daily_cash_reviews (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 draft_id uuid not null references public.zysyr_daily_sheet_drafts(id), edit_revision integer not null,
 reviewer_account_id uuid not null, reviewer_auth_user_id uuid not null,
 source_hash text not null, cell_hash text not null, request_id uuid not null,
 reason text not null check(length(btrim(reason)) between 5 and 500), reviewed_at timestamptz not null default now(),
 unique(company_id,store_id,request_id)
);
alter table zysyr_private.daily_cash_reviews enable row level security;
revoke all on zysyr_private.daily_cash_reviews from public,anon,authenticated,service_role;
create index if not exists daily_cash_reviews_context on zysyr_private.daily_cash_reviews(draft_id,edit_revision,reviewed_at desc);
drop trigger if exists immutable_daily_cash_review on zysyr_private.daily_cash_reviews;
create trigger immutable_daily_cash_review before update or delete on zysyr_private.daily_cash_reviews
 for each row execute function zysyr_private.protect_report_trace_history();

create or replace function zysyr_private.daily_cash_reviewer_valid(p_actor uuid,p_auth uuid,p_company uuid,p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.zysyr_user_accounts u where u.id=p_actor and u.company_id=p_company
  and u.auth_user_id=p_auth and u.status='active')
 and zysyr_private.account_has_capability(p_actor,p_company,p_store,'daily_report.write')
 and exists(select 1 from public.zysyr_user_role_grants g join public.zysyr_roles r on r.id=g.role_id
  where g.company_id=p_company and g.user_account_id=p_actor and r.code='finance' and r.status='active' and g.revoked_at is null
  and g.valid_from<=current_date and (g.valid_to is null or g.valid_to>=current_date)
  and (g.scope_type='company' or (g.scope_type='store' and g.store_id=p_store)))
$$;
revoke all on function zysyr_private.daily_cash_reviewer_valid(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Short transaction locks protect absent heads/voids and existing proof inputs.
-- No collector code or source values change. Lock timeout fails closed.
create or replace function zysyr_private.lock_daily_cash_review(p_draft uuid,p_actor uuid default null)
returns void language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype;
begin
 select * into d from public.zysyr_daily_sheet_drafts where id=p_draft;
 lock table public.zysyr_daily_electronic_heads in share mode;
 lock table public.zysyr_daily_sheet_attachment_voids in share mode;
 perform 1 from public.zysyr_daily_electronic_heads h where h.store_id=d.store_id and h.business_date=d.report_date order by h.source_scope for share;
 perform 1 from public.zysyr_daily_electronic_snapshots s join public.zysyr_daily_electronic_heads h on h.snapshot_id=s.id
  where h.store_id=d.store_id and h.business_date=d.report_date for share of s;
 perform 1 from public.zysyr_daily_sheet_cells c where c.draft_id=p_draft order by c.id for share;
 perform 1 from public.zysyr_voucher_attachments v where v.id=d.source_voucher_id for share;
 perform 1 from public.zysyr_companies c where c.id=d.company_id for share;
 perform 1 from public.zysyr_stores s where s.id=d.store_id for share;
 perform 1 from public.zysyr_user_accounts u where u.id=p_actor or u.id in
  (select r.reviewer_account_id from zysyr_private.daily_cash_reviews r where r.draft_id=p_draft) order by u.id for share;
 perform 1 from public.zysyr_user_role_grants g where g.user_account_id=p_actor or g.user_account_id in
  (select r.reviewer_account_id from zysyr_private.daily_cash_reviews r where r.draft_id=p_draft) order by g.id for share;
 perform 1 from public.zysyr_user_capability_grants g where g.user_account_id=p_actor or g.user_account_id in
  (select r.reviewer_account_id from zysyr_private.daily_cash_reviews r where r.draft_id=p_draft) order by g.id for share;
 perform 1 from public.zysyr_roles r join public.zysyr_user_role_grants g on g.role_id=r.id
  where g.user_account_id=p_actor or g.user_account_id in
  (select x.reviewer_account_id from zysyr_private.daily_cash_reviews x where x.draft_id=p_draft) for share of r;
 perform 1 from public.zysyr_role_capabilities c join public.zysyr_user_role_grants g on g.role_id=c.role_id
  where g.user_account_id=p_actor or g.user_account_id in
  (select x.reviewer_account_id from zysyr_private.daily_cash_reviews x where x.draft_id=p_draft) for share of c;
end $$;
revoke all on function zysyr_private.lock_daily_cash_review(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function zysyr_private.daily_cash_review_context(p_company uuid,p_store uuid,p_draft uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; v jsonb; heads jsonb; cells jsonb; original_ready boolean;
begin
 select * into d from public.zysyr_daily_sheet_drafts where id=p_draft and company_id=p_company and store_id=p_store;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 select to_jsonb(x) into v from public.zysyr_voucher_attachments x
  where x.id=d.source_voucher_id and x.company_id=p_company and x.store_id=p_store;
 original_ready:=coalesce(v->>'audit_status'='approved' and v->>'document_type'='daily_report',false)
  and not exists(select 1 from public.zysyr_daily_sheet_attachment_voids x where x.draft_id=p_draft
   and x.company_id=p_company and x.store_id=p_store and x.voucher_id=d.source_voucher_id);
 select coalesce(jsonb_agg(jsonb_build_object('scope',h.source_scope,'snapshot',h.snapshot_id,
  'fetched',h.latest_fetched_at,'hash',s.source_sha256) order by h.source_scope),'[]'::jsonb) into heads
 from public.zysyr_daily_electronic_heads h join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
 where h.store_id=p_store and h.business_date=d.report_date and h.source_scope in
 ('operating_daily_summary','card_sales_daily_summary','all_business_daily_summary');
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'section',c.section_code,'row',c.row_key,
  'column',c.column_code,'role',c.cell_role,'label',c.row_label,'manual',c.manual_override,
  'corrected',c.corrected_numeric,'text',c.manual_text,'ocr',c.ocr_numeric,'ocr_text',c.ocr_text,
  'method',c.source_method) order by c.id),'[]'::jsonb) into cells from public.zysyr_daily_sheet_cells c
 where c.company_id=p_company and c.store_id=p_store and c.draft_id=p_draft;
 return jsonb_build_object('revision',d.edit_revision,'status',d.status,'original_ready',original_ready,
  'source_hash',encode(sha256(convert_to(jsonb_build_object('company',p_company,'store',p_store,'draft',p_draft,
   'day',d.report_date,'voucher',v,'original_ready',original_ready,'draft_source',d.source_sha256,
   'template',d.template_code,'policy',d.ocr_raw_result#>'{autofill,daily_total_policy}',
   'detail',d.ocr_raw_result#>'{autofill,snapshot_id}','cash',d.ocr_raw_result#>'{autofill,cash_receipts}',
   'heads',heads)::text,'UTF8')),'hex'),
  'cell_hash',encode(sha256(convert_to(cells::text,'UTF8')),'hex'));
end $$;
revoke all on function zysyr_private.daily_cash_review_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function zysyr_private.daily_cash_review_is_current(p_company uuid,p_store uuid,p_draft uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;
begin
 c:=zysyr_private.daily_cash_review_context(p_company,p_store,p_draft);
 return coalesce((c->>'original_ready')::boolean,false) and exists(
  select 1 from zysyr_private.daily_cash_reviews r where r.company_id=p_company and r.store_id=p_store
   and r.draft_id=p_draft and r.edit_revision=(c->>'revision')::integer and r.source_hash=c->>'source_hash'
   and r.cell_hash=c->>'cell_hash' and zysyr_private.daily_cash_reviewer_valid(r.reviewer_account_id,
    r.reviewer_auth_user_id,p_company,p_store));
end $$;
revoke all on function zysyr_private.daily_cash_review_is_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Keep every existing numerical, unknown-value and financial guard. Only the
-- machine-source completeness guard may be satisfied by a current attestation.
do $$ declare definition text; old text; replacement text; begin
 old:=$old$if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb) then$old$;
 replacement:=$new$if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb)
    and not zysyr_private.daily_cash_review_is_current(p_company_id,p_store_id,p_draft_id) then$new$;
 definition:=pg_get_functiondef('zysyr_private.daily_sheet_validation(uuid,uuid,uuid)'::regprocedure);
 if position(replacement in definition)>0 then return; end if;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'DAILY_CASH_REVIEW_VALIDATION_BASELINE_CHANGED'; end if;
 execute replace(definition,old,replacement);
end $$;

create or replace function public.zysyr_daily_cash_review_status(p_company_id uuid,p_store_id uuid,p_draft_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c jsonb; r zysyr_private.daily_cash_reviews%rowtype; current_review boolean;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='DAILY_CASH_REVIEW_SERVICE_ONLY'; end if;
 c:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
 current_review:=zysyr_private.daily_cash_review_is_current(p_company_id,p_store_id,p_draft_id);
 if current_review then select * into r from zysyr_private.daily_cash_reviews x where x.company_id=p_company_id
  and x.store_id=p_store_id and x.draft_id=p_draft_id and x.edit_revision=(c->>'revision')::integer
  and x.source_hash=c->>'source_hash' and x.cell_hash=c->>'cell_hash'
  and zysyr_private.daily_cash_reviewer_valid(x.reviewer_account_id,x.reviewer_auth_user_id,p_company_id,p_store_id)
  order by x.reviewed_at desc limit 1; end if;
 return jsonb_build_object('status',case when current_review then 'current' else 'required' end,
  'revision',(c->>'revision')::integer,'source_token',c->>'source_hash','original_ready',c->'original_ready',
  'reviewed_at',r.reviewed_at,'reason',r.reason,'review_id',r.id);
end $$;
revoke all on function public.zysyr_daily_cash_review_status(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.zysyr_daily_cash_review_status(uuid,uuid,uuid) to service_role;

create or replace function public.zysyr_review_daily_cash_sources(p_actor_user_id uuid,p_actor_auth_user_id uuid,
 p_company_id uuid,p_store_id uuid,p_draft_id uuid,p_expected_revision integer,p_source_token text,
 p_request_id uuid,p_reviewed_original boolean,p_reviewed_channels boolean,p_reviewed_card_sales boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d public.zysyr_daily_sheet_drafts%rowtype; c jsonb; v jsonb; r zysyr_private.daily_cash_reviews%rowtype;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  or not zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='DAILY_CASH_REVIEW_FINANCE_FORBIDDEN'; end if;
 if p_reviewed_original is distinct from true or p_reviewed_channels is distinct from true
  or p_reviewed_card_sales is distinct from true or length(btrim(coalesce(p_reason,''))) not between 5 and 500
  or p_expected_revision is null or p_request_id is null then
  raise exception using errcode='22023',message='DAILY_CASH_REVIEW_EXPLICIT_CONFIRMATION_REQUIRED'; end if;
 select * into d from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id and store_id=p_store_id for update;
 if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
 if d.status<>'draft' then raise exception using errcode='55000',message='DAILY_CASH_REVIEW_DRAFT_REQUIRED'; end if;
 if d.edit_revision<>p_expected_revision then raise exception using errcode='PT409',message='DAILY_SHEET_REVISION_CONFLICT'; end if;
 if zysyr_private.period_is_locked(p_company_id,p_store_id,d.report_date) then
  raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
 if d.ocr_raw_result#>>'{autofill,cash_receipts,policy}' is distinct from 'operating-external-cash-v1' then
  raise exception using errcode='22023',message='DAILY_CASH_REVIEW_POLICY_REQUIRED'; end if;
 perform zysyr_private.lock_daily_cash_review(p_draft_id,p_actor_user_id);
 if not zysyr_private.daily_cash_reviewer_valid(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id) then
  raise exception using errcode='42501',message='DAILY_CASH_REVIEW_FINANCE_FORBIDDEN'; end if;
 c:=zysyr_private.daily_cash_review_context(p_company_id,p_store_id,p_draft_id);
 if c->>'source_hash' is distinct from p_source_token then
  raise exception using errcode='PT409',message='DAILY_CASH_REVIEW_SOURCE_CHANGED'; end if;
 if c->'original_ready' is distinct from 'true'::jsonb then
  raise exception using errcode='55000',message='DAILY_CASH_REVIEW_APPROVED_ORIGINAL_REQUIRED'; end if;
 select * into r from zysyr_private.daily_cash_reviews x where x.company_id=p_company_id and x.store_id=p_store_id and x.request_id=p_request_id;
 if found then
  if r.draft_id<>p_draft_id or r.reviewer_account_id<>p_actor_user_id or r.reviewer_auth_user_id<>p_actor_auth_user_id
   or r.edit_revision<>p_expected_revision or r.source_hash<>p_source_token or r.cell_hash<>c->>'cell_hash' or r.reason<>btrim(p_reason) then
   raise exception using errcode='PT409',message='DAILY_CASH_REVIEW_REQUEST_REUSED'; end if;
 else
  insert into zysyr_private.daily_cash_reviews(company_id,store_id,draft_id,edit_revision,reviewer_account_id,reviewer_auth_user_id,
   source_hash,cell_hash,request_id,reason) values(p_company_id,p_store_id,p_draft_id,p_expected_revision,
   p_actor_user_id,p_actor_auth_user_id,c->>'source_hash',c->>'cell_hash',p_request_id,btrim(p_reason)) returning * into r;
  v:=zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id);
  if v->'valid' is distinct from 'true'::jsonb then
   raise exception using errcode='22023',message='DAILY_CASH_REVIEW_VALUES_INCOMPLETE',detail=v::text; end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
   values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'review_cash_sources',
   jsonb_build_object('review_id',r.id,'revision',p_expected_revision,'source_hash',r.source_hash,'cell_hash',r.cell_hash,
    'reviewed_original',true,'reviewed_channels',true,'reviewed_card_sales',true,'reviewer_auth_user_id',p_actor_auth_user_id),btrim(p_reason),'financial');
 end if;
 v:=zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id);
 if v->'valid' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='DAILY_CASH_REVIEW_VALUES_INCOMPLETE'; end if;
 update public.zysyr_daily_sheet_drafts set validation_result=v,updated_at=now(),updated_by_user_id=p_actor_user_id where id=p_draft_id and validation_result is distinct from v;
 return public.zysyr_daily_cash_review_status(p_company_id,p_store_id,p_draft_id);
end $$;
revoke all on function public.zysyr_review_daily_cash_sources(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.zysyr_review_daily_cash_sources(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,boolean,boolean,boolean,text) to service_role;

-- Recheck under source locks at the actual posting boundary. A source change
-- between validation and confirmation rolls the entire posting transaction back.
create or replace function zysyr_private.guard_daily_cash_review_post()
returns trigger language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v jsonb;
begin
 if old.status='draft' and new.status='confirmed' and exists(select 1 from zysyr_private.daily_cash_reviews r where r.draft_id=old.id) then
  perform zysyr_private.lock_daily_cash_review(old.id);
  v:=zysyr_private.daily_sheet_validation(old.company_id,old.store_id,old.id);
  if v->'valid' is distinct from 'true'::jsonb then raise exception using errcode='PT409',message='DAILY_CASH_REVIEW_CHANGED_BEFORE_POST'; end if;
 end if;
 return new;
end $$;
revoke all on function zysyr_private.guard_daily_cash_review_post() from public,anon,authenticated,service_role;
drop trigger if exists daily_cash_review_post_guard on public.zysyr_daily_sheet_drafts;
create trigger daily_cash_review_post_guard before update of status on public.zysyr_daily_sheet_drafts
 for each row execute function zysyr_private.guard_daily_cash_review_post();
