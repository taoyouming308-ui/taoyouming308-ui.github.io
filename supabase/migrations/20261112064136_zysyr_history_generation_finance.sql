-- LOCAL CANDIDATE ONLY. Version-bound financial acceptance, never implicit reparse.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table zysyr_private.history_generation_finance_actions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 batch_id uuid not null, generation_id uuid not null references zysyr_private.history_parse_generations(id),
 generation_version integer not null, operation text not null check(operation in ('review','confirm','post')),
 actor_user_id uuid not null, request_id uuid not null, request_binding jsonb not null,
 snapshot jsonb not null, receipt jsonb not null, reason text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(company_id,store_id,request_id), unique(generation_id,operation),
 foreign key(company_id,store_id,batch_id) references public.zysyr_history_import_batches(company_id,store_id,id),
 foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id)
);
alter table zysyr_private.history_generation_finance_actions enable row level security;
revoke all on zysyr_private.history_generation_finance_actions from public,anon,authenticated,service_role;
create trigger history_generation_finance_immutable before update or delete on zysyr_private.history_generation_finance_actions
 for each row execute function zysyr_private.prevent_history_import_record_mutation();
-- Not a caller-settable GUC: clients cannot read or write this authorization.
-- Inserts/deletes occur only inside the controlled posting transaction.
create table zysyr_private.history_generation_post_context (
 transaction_id bigint primary key, batch_id uuid not null, generation_id uuid not null,
 actor_user_id uuid not null, confirmation_id uuid not null, effective_count integer not null
);
alter table zysyr_private.history_generation_post_context enable row level security;
revoke all on zysyr_private.history_generation_post_context from public,anon,authenticated,service_role;
create function zysyr_private.history_generation_prevent_reparse_after_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from zysyr_private.history_generation_finance_actions where batch_id=new.batch_id) then
 raise exception 'HISTORY_GENERATION_FINANCE_ALREADY_STARTED'; end if;
 return new;
end $$;
revoke all on function zysyr_private.history_generation_prevent_reparse_after_review() from public,anon,authenticated,service_role;
create trigger history_generation_finance_freezes_parse before insert on zysyr_private.history_parse_generations
 for each row execute function zysyr_private.history_generation_prevent_reparse_after_review();

create function public.zysyr_history_generation_finance_state(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare base jsonb; actions jsonb; review jsonb; confirmation uuid; posted integer; included jsonb; issue_material jsonb; finance jsonb;
begin
 base:=public.zysyr_history_reparse_state(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into actions
 from zysyr_private.history_generation_finance_actions a where a.batch_id=p_batch_id and a.generation_id=(base#>>'{active_generation,id}')::uuid;
 select snapshot into review from zysyr_private.history_generation_finance_actions where batch_id=p_batch_id and generation_id=(base#>>'{active_generation,id}')::uuid and operation='review';
 select id into confirmation from zysyr_private.history_generation_finance_actions where batch_id=p_batch_id and generation_id=(base#>>'{active_generation,id}')::uuid and operation='confirm';
 select (receipt->>'posted_count')::integer into posted from zysyr_private.history_generation_finance_actions where batch_id=p_batch_id and generation_id=(base#>>'{active_generation,id}')::uuid and operation='post';
 select coalesce(jsonb_agg(d order by d->>'import_row_id'),'[]'::jsonb) into included from jsonb_array_elements(coalesce(base#>'{active_generation,decisions}','[]'::jsonb)) d where d->>'disposition'='include';
 issue_material:=jsonb_build_object('source_warnings',base#>'{batch,source_warnings}','reason',base#>'{batch,reason}',
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('import_row_id',d->'import_row_id','validation_status',d->'validation_status','validation_issues',d->'validation_issues') order by d->>'import_row_id'),'[]'::jsonb) from jsonb_array_elements(included)d));
 finance:=jsonb_build_object('included_count',jsonb_array_length(included),'issue_material',issue_material,
 'issue_digest',encode(sha256(convert_to(zysyr_private.history_canonical_json(issue_material),'UTF8')),'hex'),
 'reviewed_count',coalesce(jsonb_array_length(review),0),'review_fingerprint',case when review is null then null else encode(sha256(convert_to(zysyr_private.history_canonical_json(review),'UTF8')),'hex') end,
 'confirmation_id',confirmation,'posted_count',coalesce(posted,0),'actions',actions,
 'effective_status',case when posted is not null then 'posted' when confirmation is not null then 'confirmed' when review is not null then 'reviewed' else 'needs_review' end,
 'original_rows_are_parser_snapshot',true);
 return base||jsonb_build_object('finance',finance,'state_fingerprint',encode(sha256(convert_to((jsonb_build_object('source_state',base->'state_fingerprint','finance',finance))::text,'UTF8')),'hex'));
end $$;
create function public.zysyr_history_generation_finance_status(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select jsonb_build_object('status','committed','receipt',receipt,'request_binding',request_binding) into result
 from zysyr_private.history_generation_finance_actions where company_id=p_company_id and store_id=p_store_id and batch_id=p_batch_id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 return coalesce(result,jsonb_build_object('status','not_found'));
end $$;

-- Only controlled post may enter the ledger. Original rows remain untouched.
create or replace function zysyr_private.history_generation_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare b uuid; ctx zysyr_private.history_generation_post_context; decision jsonb; source_row public.zysyr_history_import_rows; entry public.zysyr_history_ledger_entries;
begin
 if TG_TABLE_NAME='zysyr_history_import_batches' then b:=coalesce(new.id,old.id);
 else b:=coalesce(new.import_batch_id,old.import_batch_id); end if;
 if not exists(select 1 from zysyr_private.history_parse_generations where batch_id=b) then return coalesce(new,old); end if;
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

create function zysyr_private.history_generation_finance_execute(
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
revoke all on function zysyr_private.history_generation_finance_execute(text,uuid,uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,boolean,boolean,text) from public,anon,authenticated,service_role;

create function public.zysyr_history_generation_review(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,p_acknowledged_issue_digest text,p_reason text) returns jsonb
language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
 select zysyr_private.history_generation_finance_execute('review',p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_expected_state_fingerprint,p_request_id,p_acknowledged_issue_digest,null,null,false,false,p_reason);
$$;

create function public.zysyr_history_generation_confirm(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,p_expected_review_fingerprint text,p_financial_acceptance boolean,p_reason text) returns jsonb
language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
 select zysyr_private.history_generation_finance_execute('confirm',p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_expected_state_fingerprint,p_request_id,null,p_expected_review_fingerprint,null,p_financial_acceptance,false,p_reason);
$$;

create function public.zysyr_history_generation_post(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_expected_generation_id uuid,p_expected_generation_version integer,p_expected_state_fingerprint text,p_request_id uuid,p_expected_review_fingerprint text,p_expected_confirmation_id uuid,p_confirm_formal_post boolean,p_reason text) returns jsonb
language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
 select zysyr_private.history_generation_finance_execute('post',p_actor_user_id,p_company_id,p_store_id,p_batch_id,p_expected_generation_id,p_expected_generation_version,p_expected_state_fingerprint,p_request_id,null,p_expected_review_fingerprint,p_expected_confirmation_id,false,p_confirm_formal_post,p_reason);
$$;
do $$
declare f record;
begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('zysyr_history_generation_review','zysyr_history_generation_confirm','zysyr_history_generation_post','zysyr_history_generation_finance_state','zysyr_history_generation_finance_status') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
commit;
