-- LOCAL CANDIDATE: explicit version-bound correction/reversal, no legacy bypass.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table zysyr_private.history_generation_ledger_actions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,batch_id uuid not null,
 generation_id uuid not null references zysyr_private.history_parse_generations(id),generation_version integer not null,
 ledger_entry_id uuid not null,previous_ledger_version integer not null,ledger_version integer not null,
 operation text not null check(operation in('revise','reverse')),actor_user_id uuid not null,request_id uuid not null,
 request_binding jsonb not null,before_snapshot jsonb not null,after_snapshot jsonb not null,receipt jsonb not null,
 reason text not null,created_at timestamptz not null default clock_timestamp(),
 unique(company_id,store_id,request_id),unique(ledger_entry_id,ledger_version),check(ledger_version=previous_ledger_version+1),
 foreign key(company_id,store_id,ledger_entry_id) references public.zysyr_history_ledger_entries(company_id,store_id,id),
 foreign key(company_id,store_id,batch_id) references public.zysyr_history_import_batches(company_id,store_id,id),
 foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id)
);
create table zysyr_private.history_generation_adjustment_context (
 transaction_id bigint primary key,batch_id uuid not null,generation_id uuid not null,ledger_entry_id uuid not null,
 operation text not null,actor_user_id uuid not null,before_snapshot jsonb not null,after_payload jsonb not null,reason text not null
);
alter table zysyr_private.history_generation_ledger_actions enable row level security;
alter table zysyr_private.history_generation_adjustment_context enable row level security;
revoke all on zysyr_private.history_generation_ledger_actions,zysyr_private.history_generation_adjustment_context from public,anon,authenticated,service_role;
create trigger history_generation_ledger_action_immutable before update or delete on zysyr_private.history_generation_ledger_actions
 for each row execute function zysyr_private.prevent_history_import_record_mutation();

alter function public.zysyr_history_generation_finance_state(uuid,uuid,uuid,uuid) set schema zysyr_private;
alter function zysyr_private.zysyr_history_generation_finance_state(uuid,uuid,uuid,uuid) rename to history_generation_finance_state_v1;
revoke all on function zysyr_private.history_generation_finance_state_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.zysyr_history_generation_finance_state(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare base jsonb; actions jsonb; finance jsonb;
begin
 base:=zysyr_private.history_generation_finance_state_v1(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]'::jsonb) into actions from zysyr_private.history_generation_ledger_actions a where batch_id=p_batch_id;
 finance:=(base->'finance')||jsonb_build_object('ledger_actions',actions,
  'current_posted_count',(select count(*) from public.zysyr_history_ledger_entries where import_batch_id=p_batch_id and status='posted'),
  'reversed_count',(select count(*) from public.zysyr_history_ledger_entries where import_batch_id=p_batch_id and status='reversed'));
 return base||jsonb_build_object('finance',finance,'state_fingerprint',encode(sha256(convert_to(jsonb_build_object('previous_state',base->'state_fingerprint','finance',finance)::text,'UTF8')),'hex'));
end $$;
alter function public.zysyr_history_generation_finance_status(uuid,uuid,uuid,uuid,uuid) set schema zysyr_private;
alter function zysyr_private.zysyr_history_generation_finance_status(uuid,uuid,uuid,uuid,uuid) rename to history_generation_finance_status_v1;
revoke all on function zysyr_private.history_generation_finance_status_v1(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.zysyr_history_generation_finance_status(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select jsonb_build_object('status','committed','receipt',receipt,'request_binding',request_binding) into result
 from zysyr_private.history_generation_ledger_actions where company_id=p_company_id and store_id=p_store_id and batch_id=p_batch_id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 if result is not null then return result;end if;
 return zysyr_private.history_generation_finance_status_v1(p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_request_id);
end $$;

create or replace function zysyr_private.history_generation_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare ac zysyr_private.history_generation_adjustment_context; allowed text[]; b uuid; ctx zysyr_private.history_generation_post_context; decision jsonb; source_row public.zysyr_history_import_rows; entry public.zysyr_history_ledger_entries;
begin
 if TG_TABLE_NAME='zysyr_history_import_batches' then b:=coalesce(new.id,old.id);
 else b:=coalesce(new.import_batch_id,old.import_batch_id); end if;
 if not exists(select 1 from zysyr_private.history_parse_generations where batch_id=b) then return coalesce(new,old); end if;
 select * into ac from zysyr_private.history_generation_adjustment_context where transaction_id=txid_current() and batch_id=b;
 if found then
  if TG_TABLE_NAME='zysyr_history_ledger_entries' and TG_OP='UPDATE' then
   allowed:=case when ac.operation='revise' then array['current_payload','version','last_modified_by_user_id','last_modified_at']
    else array['status','version','last_modified_by_user_id','last_modified_at','reversed_by_user_id','reversed_at','reversal_reason'] end;
   if old.id<>ac.ledger_entry_id or to_jsonb(old) is distinct from ac.before_snapshot
    or old.status<>'posted' or new.version<>old.version+1 or new.last_modified_by_user_id<>ac.actor_user_id
    or new.last_modified_at is null or (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed)
    or (ac.operation='revise' and new.current_payload is distinct from ac.after_payload)
    or (ac.operation='reverse' and (new.status<>'reversed' or new.reversed_by_user_id<>ac.actor_user_id or new.reversed_at is null or new.reversal_reason is distinct from ac.reason))
    then raise exception 'HISTORY_GENERATION_ADJUSTMENT_CONTEXT_INVALID'; end if;
   return new;
  elsif TG_TABLE_NAME='zysyr_history_ledger_revisions' and TG_OP='INSERT' then
   if new.ledger_entry_id<>ac.ledger_entry_id or new.company_id is distinct from (ac.before_snapshot->>'company_id')::uuid
    or new.store_id is distinct from (ac.before_snapshot->>'store_id')::uuid or new.import_row_id is distinct from (ac.before_snapshot->>'import_row_id')::uuid
    or new.version<>(ac.before_snapshot->>'version')::int+1 or new.action<>ac.operation
    or new.before_payload is distinct from ac.before_snapshot->'current_payload' or new.after_payload is distinct from ac.after_payload
    or new.reason is distinct from ac.reason or new.actor_user_id<>ac.actor_user_id then raise exception 'HISTORY_GENERATION_ADJUSTMENT_CONTEXT_INVALID'; end if;
   return new;
  end if;
  raise exception 'HISTORY_GENERATION_ADJUSTMENT_CONTEXT_INVALID';
 end if;

 select * into ctx from zysyr_private.history_generation_post_context where transaction_id=txid_current() and batch_id=b;
 if not found then raise exception 'HISTORY_GENERATION_VERSION_REQUIRED'; end if;
 if TG_TABLE_NAME='zysyr_history_ledger_entries' and TG_OP='INSERT' then
  select d into decision from zysyr_private.history_parse_generations g cross join lateral jsonb_array_elements(g.decisions)d
   where g.id=ctx.generation_id and d->>'import_row_id'=new.import_row_id::text and d->>'disposition'='include';
  select * into source_row from public.zysyr_history_import_rows where id=new.import_row_id and import_batch_id=b;
  if decision is null or source_row.id is null or new.posted_payload is distinct from decision->'effective_mapped'
   or new.current_payload is distinct from new.posted_payload or new.source_row_hash is distinct from source_row.row_hash
   or new.source_sheet is distinct from source_row.source_sheet or new.source_locator is distinct from source_row.source_locator
   or new.posted_review_status<>'confirmed' or new.posted_validation_status is distinct from decision->>'validation_status'
   or new.posted_validation_issues is distinct from decision->'validation_issues' or new.posted_by_user_id<>ctx.actor_user_id
   or new.last_modified_by_user_id<>ctx.actor_user_id or new.status<>'posted' or new.version<>1
   or new.company_id<>source_row.company_id or new.store_id<>source_row.store_id or new.entry_type<>'monthly_profit_loss'
   or new.period_month is distinct from (decision#>>'{effective_mapped,period_month}')::date
   or new.posted_with_warning is distinct from (decision->>'validation_status'='warning' or jsonb_array_length(decision->'validation_issues')>0)
   then raise exception 'HISTORY_GENERATION_POST_CONTEXT_INVALID'; end if;
  return new;
 elsif TG_TABLE_NAME='zysyr_history_ledger_revisions' and TG_OP='INSERT' then
  select * into entry from public.zysyr_history_ledger_entries where id=new.ledger_entry_id and import_batch_id=b;
  if entry.id is null or new.import_row_id<>entry.import_row_id or new.company_id<>entry.company_id or new.store_id<>entry.store_id
   or new.version<>1 or new.action<>'post' or new.before_payload is not null or new.after_payload is distinct from entry.posted_payload
   or new.actor_user_id<>ctx.actor_user_id then raise exception 'HISTORY_GENERATION_POST_CONTEXT_INVALID'; end if;
  return new;
 elsif TG_TABLE_NAME='zysyr_history_import_batches' and TG_OP='UPDATE' then
  if old.status<>'needs_review' or new.status<>'completed' or new.confirmed_by_user_id is distinct from (select actor_user_id from zysyr_private.history_generation_finance_actions where id=ctx.confirmation_id)
   or new.confirmed_at is null or new.completed_at is null or new.imported_row_count<>ctx.effective_count
   or (to_jsonb(new)-array['status','confirmed_by_user_id','confirmed_at','confirmation_reason','completed_at','imported_row_count'])
    is distinct from (to_jsonb(old)-array['status','confirmed_by_user_id','confirmed_at','confirmation_reason','completed_at','imported_row_count'])
   then raise exception 'HISTORY_GENERATION_POST_CONTEXT_INVALID'; end if;
  return new;
 end if;
 raise exception 'HISTORY_GENERATION_VERSION_REQUIRED';
end $$;
create function zysyr_private.history_generation_adjust(
 p_action text,p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,
 p_expected_state_fingerprint text,p_request_id uuid,p_ledger_entry_id uuid,p_expected_ledger_version integer,p_current_payload jsonb,p_confirm_reverse boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' set statement_timeout='30s' as $$
declare st jsonb; binding jsonb; previous zysyr_private.history_generation_ledger_actions; before_row public.zysyr_history_ledger_entries; after_row public.zysyr_history_ledger_entries;
 allowed text[]; money text[]; k text; payload jsonb; result jsonb; aid uuid:=gen_random_uuid(); decision jsonb;
begin
 perform pg_advisory_xact_lock(724394177001::bigint);
 lock table public.zysyr_user_accounts,public.zysyr_user_role_grants,public.zysyr_user_capability_grants,public.zysyr_role_capabilities,public.zysyr_roles,public.zysyr_capabilities,public.zysyr_stores,public.zysyr_companies in share mode;
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'confirmed_finance.adjust');
 perform 1 from public.zysyr_history_import_batches where id=p_batch_id for update;
 select * into before_row from public.zysyr_history_ledger_entries where id=p_ledger_entry_id and company_id=p_company_id and store_id=p_store_id and import_batch_id=p_batch_id for update;
 if not found then raise exception 'HISTORY_GENERATION_LEDGER_NOT_FOUND'; end if;
 binding:=jsonb_build_object('action',p_action,'expected_generation_id',p_expected_generation_id,'expected_generation_version',p_expected_generation_version,
 'expected_state_fingerprint',p_expected_state_fingerprint,'acknowledged_issue_digest',null,'expected_review_fingerprint',null,'expected_confirmation_id',null,
 'financial_acceptance',false,'confirm_formal_post',false,'ledger_entry_id',p_ledger_entry_id,'expected_ledger_version',p_expected_ledger_version,
 'current_payload',p_current_payload,'confirm_reverse',p_confirm_reverse,'reason',p_reason);
 select * into previous from zysyr_private.history_generation_ledger_actions where company_id=p_company_id and store_id=p_store_id and request_id=p_request_id;
 if found then
  if previous.actor_user_id<>p_actor_user_id or previous.batch_id<>p_batch_id or previous.request_binding is distinct from binding then raise exception 'HISTORY_GENERATION_REQUEST_REUSED';end if;
  return previous.receipt;
 end if;
 if exists(select 1 from zysyr_private.history_generation_finance_actions where company_id=p_company_id and store_id=p_store_id and request_id=p_request_id) then raise exception 'HISTORY_GENERATION_REQUEST_REUSED'; end if;
 if p_request_id is null or p_action not in('revise','reverse') or nullif(btrim(p_reason),'') is null then raise exception 'HISTORY_GENERATION_INPUT_INVALID'; end if;
 st:=public.zysyr_history_generation_finance_state(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 if p_expected_generation_id is null or (st#>>'{active_generation,id}')::uuid is distinct from p_expected_generation_id
 or (st#>>'{active_generation,version}')::int is distinct from p_expected_generation_version or st->>'state_fingerprint' is distinct from p_expected_state_fingerprint
 or before_row.version is distinct from p_expected_ledger_version then raise exception 'HISTORY_GENERATION_STATE_CHANGED'; end if;
 if before_row.status<>'posted' or st#>>'{batch,status}'<>'completed' or (st#>>'{finance,posted_count}')::int<1 then raise exception 'HISTORY_GENERATION_LEDGER_NOT_ADJUSTABLE'; end if;
 select d into decision from jsonb_array_elements(st#>'{active_generation,decisions}') d where d->>'import_row_id'=before_row.import_row_id::text and d->>'disposition'='include';
 if decision is null or before_row.posted_payload is distinct from decision->'effective_mapped' then raise exception 'HISTORY_GENERATION_LEDGER_LINEAGE_MISMATCH'; end if;
 lock table public.zysyr_period_locks in share mode;
 if zysyr_private.period_is_locked(p_company_id,p_store_id,before_row.period_month) then raise exception 'FINANCE_PERIOD_LOCKED'; end if;
 if p_action='reverse' then
  if p_confirm_reverse is distinct from true or p_current_payload is not null then raise exception 'HISTORY_GENERATION_REVERSAL_CONFIRMATION_REQUIRED'; end if;
  payload:=before_row.current_payload;
 else
  if p_confirm_reverse or jsonb_typeof(p_current_payload) is distinct from 'object' then raise exception 'HISTORY_GENERATION_PAYLOAD_INVALID';end if;
  money:=case before_row.entry_type when 'monthly_profit_loss' then array['amount'] when 'petty_cash' then array['amount'] when 'salary' then
   array['base_salary','seniority_salary','position_salary','meal_allowance','performance_commission','delivery_card_commission','overtime_activity_allowance','supplemental_adjustment','gross_pay','product_cost','late_early_deduction','shooting_deduction','leave_deduction','growth_deduction','employee_purchase_deduction','social_security','total_deduction','net_pay'] else null end;
  allowed:=case before_row.entry_type when 'monthly_profit_loss' then array['amount','notes'] when 'petty_cash' then array['amount','transaction_date','summary','direction','category','handled_by_name','notes'] when 'salary' then money||array['position','notes'] else null end;
  if allowed is null or (p_current_payload-allowed) is distinct from (before_row.current_payload-allowed)
   or p_current_payload->>'period_month' is distinct from before_row.current_payload->>'period_month' then raise exception 'HISTORY_GENERATION_IMMUTABLE_FIELD';end if;
  foreach k in array money loop
   if p_current_payload->k is distinct from before_row.current_payload->k and jsonb_typeof(p_current_payload->k) is distinct from 'number' then raise exception 'HISTORY_GENERATION_AMOUNT_INVALID';end if;
  end loop;
  if before_row.entry_type in('monthly_profit_loss','petty_cash') and jsonb_typeof(p_current_payload->'amount') is distinct from 'number' then raise exception 'HISTORY_GENERATION_AMOUNT_INVALID';end if;
  if before_row.entry_type='salary' and (jsonb_typeof(p_current_payload->'gross_pay') is distinct from 'number' or jsonb_typeof(p_current_payload->'total_deduction') is distinct from 'number' or jsonb_typeof(p_current_payload->'net_pay') is distinct from 'number') then raise exception 'HISTORY_GENERATION_AMOUNT_INVALID';end if;
  foreach k in array array['notes','position','summary','category','handled_by_name'] loop
   if k=any(allowed) and p_current_payload ? k and jsonb_typeof(p_current_payload->k) not in('string','null') then raise exception 'HISTORY_GENERATION_TEXT_INVALID';end if;
  end loop;
  if before_row.entry_type='petty_cash' and (coalesce(p_current_payload->>'transaction_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or date_trunc('month',(p_current_payload->>'transaction_date')::date)::date<>before_row.period_month
   or coalesce(p_current_payload->>'direction','') not in('inflow','outflow') or nullif(btrim(p_current_payload->>'summary'),'') is null
   or (p_current_payload->>'amount')::numeric<=0) then raise exception 'HISTORY_GENERATION_PETTY_PAYLOAD_INVALID'; end if;
  if p_current_payload=before_row.current_payload then raise exception 'HISTORY_GENERATION_NO_CHANGE';end if;
  payload:=p_current_payload;
 end if;
 insert into zysyr_private.history_generation_adjustment_context values(txid_current(),p_batch_id,p_expected_generation_id,p_ledger_entry_id,p_action,p_actor_user_id,to_jsonb(before_row),payload,p_reason);
 insert into public.zysyr_history_ledger_revisions(company_id,store_id,ledger_entry_id,import_batch_id,import_row_id,version,action,before_payload,after_payload,reason,actor_user_id)
 values(p_company_id,p_store_id,p_ledger_entry_id,p_batch_id,before_row.import_row_id,before_row.version+1,p_action,before_row.current_payload,payload,p_reason,p_actor_user_id);
 if p_action='revise' then
  update public.zysyr_history_ledger_entries set current_payload=payload,version=version+1,last_modified_by_user_id=p_actor_user_id,last_modified_at=clock_timestamp() where id=p_ledger_entry_id returning * into after_row;
 else
  update public.zysyr_history_ledger_entries set status='reversed',version=version+1,last_modified_by_user_id=p_actor_user_id,last_modified_at=clock_timestamp(),reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reversal_reason=p_reason where id=p_ledger_entry_id returning * into after_row;
 end if;
 delete from zysyr_private.history_generation_adjustment_context where transaction_id=txid_current();
 result:=jsonb_build_object('status','committed','action',p_action,'action_id',aid,'request_id',p_request_id,'generation_id',p_expected_generation_id,'generation_version',p_expected_generation_version,
 'source_sha256',st->'source_sha256','ledger_entry_id',p_ledger_entry_id,'previous_ledger_version',before_row.version,'ledger_version',after_row.version,
 'formal_ledger_written',true,'formal_ledger_changed',true,'financial_acceptance_performed',false,'posted_count',0);
 insert into zysyr_private.history_generation_ledger_actions(id,company_id,store_id,batch_id,generation_id,generation_version,ledger_entry_id,previous_ledger_version,ledger_version,operation,actor_user_id,request_id,request_binding,before_snapshot,after_snapshot,receipt,reason)
 values(aid,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_ledger_entry_id,before_row.version,after_row.version,p_action,p_actor_user_id,p_request_id,binding,to_jsonb(before_row),to_jsonb(after_row),result,p_reason);
 return result;
end $$;
revoke all on function zysyr_private.history_generation_adjust(text,uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid,integer,jsonb,boolean,text) from public,anon,authenticated,service_role;
create function public.zysyr_history_generation_revise(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,p_ledger_entry_id uuid,p_expected_ledger_version integer,p_current_payload jsonb,p_reason text)
returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
 select zysyr_private.history_generation_adjust('revise',p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_expected_state_fingerprint,p_request_id,p_ledger_entry_id,p_expected_ledger_version,p_current_payload,false,p_reason);
$$;
create function public.zysyr_history_generation_reverse(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,p_ledger_entry_id uuid,p_expected_ledger_version integer,p_confirm_reverse boolean,p_reason text)
returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
 select zysyr_private.history_generation_adjust('reverse',p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_expected_state_fingerprint,p_request_id,p_ledger_entry_id,p_expected_ledger_version,null,p_confirm_reverse,p_reason);
$$;
do $$
declare f record;
begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('zysyr_history_generation_revise','zysyr_history_generation_reverse','zysyr_history_generation_finance_state','zysyr_history_generation_finance_status') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
create or replace function zysyr_private.history_generation_finance_execute(
 p_action text,p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,
 p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,
 p_acknowledged_issue_digest text,p_expected_review_fingerprint text,p_expected_confirmation_id uuid,
 p_financial_acceptance boolean,p_confirm_formal_post boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' set statement_timeout='30s' as $$
declare st jsonb; binding jsonb; previous zysyr_private.history_generation_finance_actions; included jsonb; d jsonb;
 snapshot jsonb; result jsonb; action_id uuid:=gen_random_uuid(); entry_id uuid; count_included integer; confirmation uuid; actor_confirmation uuid;
begin
 perform pg_advisory_xact_lock(724394177001::bigint);
 lock table public.zysyr_user_accounts,public.zysyr_user_role_grants,public.zysyr_user_capability_grants,public.zysyr_role_capabilities,public.zysyr_roles,public.zysyr_capabilities,public.zysyr_stores,public.zysyr_companies in share mode;
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 perform 1 from public.zysyr_history_import_batches where id=p_batch_id for update;
 perform 1 from public.zysyr_history_import_rows where import_batch_id=p_batch_id order by id for update;
 binding:=jsonb_build_object('action',p_action,'expected_generation_id',p_expected_generation_id,'expected_generation_version',p_expected_generation_version,
 'expected_state_fingerprint',p_expected_state_fingerprint,'acknowledged_issue_digest',p_acknowledged_issue_digest,
 'expected_review_fingerprint',p_expected_review_fingerprint,'expected_confirmation_id',p_expected_confirmation_id,
 'financial_acceptance',p_financial_acceptance,'confirm_formal_post',p_confirm_formal_post,'reason',p_reason);
 select * into previous from zysyr_private.history_generation_finance_actions where company_id=p_company_id and store_id=p_store_id and request_id=p_request_id;
 if found then
  if previous.actor_user_id<>p_actor_user_id or previous.batch_id<>p_batch_id or previous.request_binding is distinct from binding then raise exception 'HISTORY_GENERATION_REQUEST_REUSED'; end if;
  return previous.receipt;
 end if;
 if exists(select 1 from zysyr_private.history_generation_ledger_actions where company_id=p_company_id and store_id=p_store_id and request_id=p_request_id) then raise exception 'HISTORY_GENERATION_REQUEST_REUSED';end if;
 if p_action not in ('review','confirm','post') or p_request_id is null or nullif(btrim(p_reason),'') is null then raise exception 'HISTORY_GENERATION_INPUT_INVALID'; end if;
 st:=public.zysyr_history_generation_finance_state(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 if p_expected_generation_id is null or (st#>>'{active_generation,id}')::uuid is distinct from p_expected_generation_id
 or (st#>>'{active_generation,version}')::integer is distinct from p_expected_generation_version
 or st->>'state_fingerprint' is distinct from p_expected_state_fingerprint then raise exception 'HISTORY_GENERATION_STATE_CHANGED'; end if;
 if st#>>'{batch,status}'<>'needs_review' or st#>>'{batch,import_type}'<>'monthly_profit_loss'
 or jsonb_array_length(st->'ledger')<>0 then raise exception 'HISTORY_GENERATION_BATCH_NOT_PRISTINE'; end if;
 if exists(select 1 from zysyr_private.history_generation_finance_actions where generation_id=p_expected_generation_id and operation=p_action) then raise exception 'HISTORY_GENERATION_ACTION_ALREADY_RECORDED'; end if;
 select jsonb_agg(item order by item->>'import_row_id') into included from jsonb_array_elements(st#>'{active_generation,decisions}')item where item->>'disposition'='include';
 count_included:=coalesce(jsonb_array_length(included),0);
 if count_included=0 then raise exception 'HISTORY_GENERATION_EMPTY'; end if;
 for d in select value from jsonb_array_elements(included) loop
  if d->>'validation_status' not in ('valid','warning') or d->>'validation_status' is null
  or jsonb_typeof(d#>'{effective_mapped,amount}') is distinct from 'number'
  or coalesce(d#>>'{effective_mapped,period_month}','') !~ '^[0-9]{4}-[0-9]{2}-01$'
  or (d#>>'{effective_mapped,period_month}')::date not between (st#>>'{batch,period_start}')::date and (st#>>'{batch,period_end}')::date
  then raise exception 'HISTORY_GENERATION_INVALID_INCLUDED_ROW'; end if;
 end loop;
 if p_action='review' then
  if p_acknowledged_issue_digest is distinct from st#>>'{finance,issue_digest}' then raise exception 'HISTORY_GENERATION_ISSUES_NOT_ACKNOWLEDGED'; end if;
  snapshot:=included;
 else
  if p_expected_review_fingerprint is null or p_expected_review_fingerprint is distinct from st#>>'{finance,review_fingerprint}'
   or (st#>>'{finance,reviewed_count}')::int<>count_included then raise exception 'HISTORY_GENERATION_REVIEW_REQUIRED'; end if;
  if p_action='confirm' then
   if p_financial_acceptance is distinct from true then raise exception 'HISTORY_GENERATION_FINANCIAL_ACCEPTANCE_REQUIRED'; end if;
   snapshot:=jsonb_build_object('review_fingerprint',p_expected_review_fingerprint,'included_count',count_included,'issue_digest',st#>'{finance,issue_digest}');
  else
   confirmation:=(st#>>'{finance,confirmation_id}')::uuid;
   if p_confirm_formal_post is distinct from true or confirmation is null or confirmation is distinct from p_expected_confirmation_id then raise exception 'HISTORY_GENERATION_CONFIRMATION_REQUIRED'; end if;
   -- Lock period policy against concurrent changes, and enforce every included month.
   lock table public.zysyr_period_locks in share mode;
   for d in select value from jsonb_array_elements(included) loop
    if zysyr_private.period_is_locked(p_company_id,p_store_id,(d#>>'{effective_mapped,period_month}')::date) then raise exception 'FINANCE_PERIOD_LOCKED'; end if;
   end loop;
   insert into zysyr_private.history_generation_post_context values(txid_current(),p_batch_id,p_expected_generation_id,p_actor_user_id,confirmation,count_included);
   for d in select value from jsonb_array_elements(included) loop
    insert into public.zysyr_history_ledger_entries(company_id,store_id,import_batch_id,import_row_id,entry_type,period_month,
      source_sheet,source_locator,source_row_hash,posted_payload,current_payload,posted_validation_status,posted_validation_issues,posted_review_status,posted_with_warning,posted_by_user_id,last_modified_by_user_id)
     select p_company_id,p_store_id,p_batch_id,r.id,'monthly_profit_loss',(d#>>'{effective_mapped,period_month}')::date,r.source_sheet,r.source_locator,r.row_hash,
      d->'effective_mapped',d->'effective_mapped',d->>'validation_status',d->'validation_issues','confirmed',
      d->>'validation_status'='warning' or jsonb_array_length(d->'validation_issues')>0,p_actor_user_id,p_actor_user_id
     from public.zysyr_history_import_rows r where r.id=(d->>'import_row_id')::uuid and r.import_batch_id=p_batch_id returning id into entry_id;
    if entry_id is null then raise exception 'HISTORY_GENERATION_ROW_MISSING'; end if;
    insert into public.zysyr_history_ledger_revisions(company_id,store_id,ledger_entry_id,import_batch_id,import_row_id,version,action,before_payload,after_payload,reason,actor_user_id)
     values(p_company_id,p_store_id,entry_id,p_batch_id,(d->>'import_row_id')::uuid,1,'post',null,d->'effective_mapped',p_reason,p_actor_user_id);
   end loop;
   if (select count(*) from public.zysyr_history_ledger_entries where import_batch_id=p_batch_id)<>count_included or (select count(*) from public.zysyr_history_ledger_revisions where import_batch_id=p_batch_id)<>count_included then raise exception 'HISTORY_GENERATION_LEDGER_COUNT_MISMATCH'; end if;
   update public.zysyr_history_import_batches set status='completed',confirmed_by_user_id=(select actor_user_id from zysyr_private.history_generation_finance_actions where id=confirmation),confirmed_at=(select created_at from zysyr_private.history_generation_finance_actions where id=confirmation),confirmation_reason=(select reason from zysyr_private.history_generation_finance_actions where id=confirmation),
    completed_at=clock_timestamp(),imported_row_count=count_included where id=p_batch_id;
   delete from zysyr_private.history_generation_post_context where transaction_id=txid_current();
   snapshot:=jsonb_build_object('review_fingerprint',p_expected_review_fingerprint,'confirmation_id',confirmation,'posted_count',count_included,
    'source_sha256',st->'source_sha256','original_count',st#>'{batch,raw_row_count}');
  end if;
 end if;
 result:=jsonb_build_object('status','committed','action',p_action,'action_id',action_id,'request_id',p_request_id,'generation_id',p_expected_generation_id,
 'generation_version',p_expected_generation_version,'source_sha256',st->'source_sha256','effective_count',count_included,
 'review_fingerprint',case when p_action='review' then encode(sha256(convert_to(zysyr_private.history_canonical_json(included),'UTF8')),'hex') else p_expected_review_fingerprint end,
 'confirmation_id',case when p_action='confirm' then action_id else p_expected_confirmation_id end,
 'posted_count',case when p_action='post' then count_included else 0 end,'formal_ledger_written',p_action='post','financial_acceptance_performed',p_action='confirm');
 insert into zysyr_private.history_generation_finance_actions(id,company_id,store_id,batch_id,generation_id,generation_version,operation,actor_user_id,request_id,request_binding,snapshot,receipt,reason)
 values(action_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_action,p_actor_user_id,p_request_id,binding,snapshot,result,p_reason);
 return result;
end $$;
commit;
