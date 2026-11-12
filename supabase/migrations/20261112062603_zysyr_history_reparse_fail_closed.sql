-- Protected preview generations. Financial acceptance and legacy posting stay blocked.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table zysyr_private.history_parse_generations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 batch_id uuid not null, version integer not null check(version>0), request_id uuid not null,
 actor_user_id uuid not null, source_sha256 text not null, state_fingerprint text not null,
 parser_digest text not null, proposal_digest text not null, request_binding jsonb not null,
 before_snapshot jsonb not null, decisions jsonb not null, receipt jsonb not null,
 reason text not null, created_at timestamptz not null default clock_timestamp(),
 unique(batch_id,version), unique(company_id,store_id,request_id),
 foreign key(company_id,store_id,batch_id) references public.zysyr_history_import_batches(company_id,store_id,id),
 foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id)
);
alter table zysyr_private.history_parse_generations enable row level security;
revoke all on zysyr_private.history_parse_generations from public,anon,authenticated,service_role;
create trigger history_parse_generations_immutable before update or delete on zysyr_private.history_parse_generations
 for each row execute function zysyr_private.prevent_history_import_record_mutation();
-- Active generation is the greatest immutable version, not a mutable pointer.
create function zysyr_private.history_reparse_scope(a uuid,c uuid,s uuid,b uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform zysyr_private.assert_finance_scope(a,c,s,'expense.create_submit');
 if not exists(select 1 from public.zysyr_stores st join public.zysyr_companies co on co.id=st.company_id
   join public.zysyr_user_accounts u on u.company_id=co.id and u.id=a
   where st.id=s and st.company_id=c and st.status='active' and st.deleted_at is null
   and co.status='active' and u.status='active') then raise exception 'HISTORY_REPARSE_SCOPE_DENIED'; end if;
 if not exists(select 1 from public.zysyr_history_import_batches where id=b and company_id=c and store_id=s)
 then raise exception 'HISTORY_REPARSE_SCOPE_DENIED'; end if;
end $$;
create function public.zysyr_history_reparse_state(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' set statement_timeout='30s' as $$
declare material jsonb; gen jsonb;
begin
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select to_jsonb(g)-'before_snapshot'-'request_binding' into gen from zysyr_private.history_parse_generations g where batch_id=p_batch_id order by version desc limit 1;
 select jsonb_build_object('batch',to_jsonb(b),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.zysyr_history_import_rows r where r.import_batch_id=b.id),'[]'::jsonb),
 'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.zysyr_history_import_evidence e where e.import_batch_id=b.id),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.zysyr_history_import_row_evidence e where e.import_batch_id=b.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.zysyr_history_import_events e where e.import_batch_id=b.id),'[]'::jsonb),
 'ledger',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.zysyr_history_ledger_entries e where e.import_batch_id=b.id),'[]'::jsonb),
 'active_generation',gen,'source_sha256',b.source_sha256) into material from public.zysyr_history_import_batches b where b.id=p_batch_id;
 return material || jsonb_build_object('state_fingerprint',encode(sha256(convert_to(material::text,'UTF8')),'hex'));
end $$;
create function public.zysyr_history_reparse_status(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 select jsonb_build_object('status','committed','receipt',receipt,'request_binding',jsonb_build_object('expected_state_fingerprint',state_fingerprint,'expected_source_sha256',source_sha256,'parser_digest',parser_digest,'proposal_digest',proposal_digest,'reason',reason)) into result from zysyr_private.history_parse_generations where company_id=p_company_id and store_id=p_store_id and batch_id=p_batch_id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 return coalesce(result,jsonb_build_object('status','not_found','formal_ledger_written',false,'financial_acceptance_performed',false));
end $$;
create function zysyr_private.history_canonical_json(v jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare output text;
begin
 if jsonb_typeof(v)='object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||zysyr_private.history_canonical_json(value),',' order by key collate "C"),'')||'}' into output from jsonb_each(v);
 elsif jsonb_typeof(v)='array' then select '['||coalesce(string_agg(zysyr_private.history_canonical_json(value),',' order by ord),'')||']' into output from jsonb_array_elements(v) with ordinality x(value,ord);
 else output:=v::text; end if;
 return output;
end $$;
revoke all on function zysyr_private.history_canonical_json(jsonb) from public,anon,authenticated,service_role;
create function public.zysyr_history_reparse_apply(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,
 p_request_id uuid,p_expected_state_fingerprint text,p_expected_source_sha256 text,p_parser_digest text,p_proposal_digest text,p_reason text,p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' set statement_timeout='30s' as $$
declare st jsonb; binding jsonb; existing zysyr_private.history_parse_generations; r jsonb; d jsonb; eff jsonb; src jsonb;
 ver integer; gid uuid:=gen_random_uuid(); result jsonb; n integer; excluded integer;
begin
 -- Same global boundary as all wrapped legacy writers, then batch then stable rows.
 perform pg_advisory_xact_lock(724394177001::bigint);
 lock table public.zysyr_user_accounts,public.zysyr_user_role_grants,public.zysyr_user_capability_grants,public.zysyr_role_capabilities,public.zysyr_roles,public.zysyr_capabilities,public.zysyr_stores,public.zysyr_companies in share mode;
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 perform 1 from public.zysyr_history_import_batches where id=p_batch_id for update;
 perform 1 from public.zysyr_history_import_rows where import_batch_id=p_batch_id order by id for update;
 binding:=jsonb_build_object('actor',p_actor_user_id,'company',p_company_id,'store',p_store_id,'batch',p_batch_id,
 'state',p_expected_state_fingerprint,'source',p_expected_source_sha256,'parser',p_parser_digest,'proposal',p_proposal_digest,'reason',p_reason,'decisions',p_decisions);
 select * into existing from zysyr_private.history_parse_generations where company_id=p_company_id and store_id=p_store_id and request_id=p_request_id;
 if found then
  if existing.request_binding is distinct from binding then raise exception 'HISTORY_REPARSE_REQUEST_REUSED'; end if;
  return existing.receipt;
 end if;
 if p_request_id is null or nullif(btrim(p_reason),'') is null or p_parser_digest !~ '^[0-9a-f]{64}$'
 or p_proposal_digest !~ '^[0-9a-f]{64}$' or p_parser_digest is null or p_proposal_digest is null
 or jsonb_typeof(p_decisions) is distinct from 'array' then raise exception 'HISTORY_REPARSE_INPUT_INVALID'; end if;
 if encode(sha256(convert_to(zysyr_private.history_canonical_json(p_decisions),'UTF8')),'hex') is distinct from p_proposal_digest then raise exception 'HISTORY_REPARSE_PROPOSAL_MISMATCH'; end if;
 st:=public.zysyr_history_reparse_state(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 if st->>'state_fingerprint' is distinct from p_expected_state_fingerprint or st->>'source_sha256' is distinct from p_expected_source_sha256 then raise exception 'HISTORY_REPARSE_STATE_CHANGED'; end if;
 if st#>>'{batch,status}' <> 'needs_review' or st#>>'{batch,import_type}' <> 'monthly_profit_loss'
 or st#>>'{batch,confirmed_at}' is not null or (st#>>'{batch,imported_row_count}')::int<>0
 or jsonb_array_length(st->'ledger')<>0 then raise exception 'HISTORY_REPARSE_BATCH_NOT_PRISTINE'; end if;
 if exists(select 1 from jsonb_array_elements(st->'events') e where e->>'action' not in ('stage','evidence_upload','evidence_link')) then raise exception 'HISTORY_REPARSE_PRIOR_ACTIVITY'; end if;
 n:=jsonb_array_length(st->'rows');
 if jsonb_array_length(p_decisions)<>n or n<>(st#>>'{batch,raw_row_count}')::int
 or (select count(distinct x->>'import_row_id') from jsonb_array_elements(p_decisions)x)<>n then raise exception 'HISTORY_REPARSE_ROW_SET_INVALID'; end if;
 for r in select value from jsonb_array_elements(st->'rows') loop
  if r->>'import_status'<>'pending' or r->>'review_status'<>'pending' or r->>'corrected_json' is not null
  or r->>'reviewed_at' is not null or r->>'reviewed_snapshot' is not null or r->>'imported_at' is not null
  or r->>'target_business_id' is not null or r->>'target_business_type' is not null then raise exception 'HISTORY_REPARSE_ROW_NOT_PRISTINE'; end if;
  select value into d from jsonb_array_elements(p_decisions) where value->>'import_row_id'=r->>'id';
  if d is null or d->>'source_locator' is distinct from r->>'source_locator' or d->>'source_row_hash' is distinct from r->>'row_hash'
   or d->'original_raw' is distinct from r->'raw_json' or d->'original_mapped' is distinct from r->'mapped_json'
   then raise exception 'HISTORY_REPARSE_SOURCE_MISMATCH'; end if;
  eff:=d->'effective_mapped'; src:=d->'source_snapshot';
  if jsonb_typeof(eff) is distinct from 'object' or src->>'cell_address' is distinct from r#>>'{mapped_json,cell_address}'
   or d->>'validation_status' is null or jsonb_typeof(d->'validation_issues') is distinct from 'array' or d->>'validation_status' not in ('valid','warning','invalid') or not ((d->'validation_issues') @> (r->'validation_issues'))
   or (r->>'validation_status'='invalid' and d->>'validation_status'<>'invalid')
   or (r->>'validation_status'='warning' and d->>'validation_status'='valid') then raise exception 'HISTORY_REPARSE_VALIDATION_INVALID'; end if;
  if d->>'disposition'='exclude_merged_slave' then
   if eff is distinct from r->'mapped_json' or nullif(src->>'merged_master','') is null or not exists(
    select 1 from jsonb_array_elements(p_decisions) m where m->>'disposition'='include'
    and m->>'source_locator'=(r->>'source_sheet')||'!'||(src->>'merged_master')) then raise exception 'HISTORY_REPARSE_MERGE_INVALID'; end if;
  elsif d->>'disposition'='include' then
   if src->>'merged_master' is not null or (eff-'amount'-'formula') is distinct from ((r->'mapped_json')-'amount'-'formula') then raise exception 'HISTORY_REPARSE_CHANGE_DENIED'; end if;
   if eff->'amount' is distinct from r#>'{mapped_json,amount}' and (
    r#>'{mapped_json,amount}'='null'::jsonb and eff->'amount'='0'::jsonb and src->'cached_value'='0'::jsonb
    and src->'cache_present'='true'::jsonb and nullif(src->>'formula','') is not null) is not true then raise exception 'HISTORY_REPARSE_AMOUNT_DENIED'; end if;
   if eff->'formula' is distinct from r#>'{mapped_json,formula}' and (eff->>'formula' is distinct from src->>'formula' or nullif(src->>'formula','') is null or nullif(src->>'shared_formula_reference','') is null or src->>'shared_formula_reference' is distinct from r#>>'{mapped_json,formula}') then raise exception 'HISTORY_REPARSE_FORMULA_DENIED'; end if;
  else raise exception 'HISTORY_REPARSE_DISPOSITION_INVALID'; end if;
 end loop;
 select count(*) into excluded from jsonb_array_elements(p_decisions) item where item->>'disposition'='exclude_merged_slave';
 select coalesce(max(version),0)+1 into ver from zysyr_private.history_parse_generations where batch_id=p_batch_id;
 result:=jsonb_build_object('status','applied','generation_id',gid,'version',ver,'request_id',p_request_id,
 'source_sha256',p_expected_source_sha256,'proposal_digest',p_proposal_digest,'original_count',n,'effective_count',n-excluded,'excluded_count',excluded,
 'formal_ledger_written',false,'formal_ledger_count',0,'financial_acceptance_performed',false,'legacy_writes_blocked',true);
 perform zysyr_private.history_reparse_scope(p_actor_user_id,p_company_id,p_store_id,p_batch_id);
 -- The append-only generation is also the audit event and idempotent receipt.
 insert into zysyr_private.history_parse_generations(id,company_id,store_id,batch_id,version,request_id,actor_user_id,source_sha256,state_fingerprint,
 parser_digest,proposal_digest,request_binding,before_snapshot,decisions,receipt,reason)
 values(gid,p_company_id,p_store_id,p_batch_id,ver,p_request_id,p_actor_user_id,p_expected_source_sha256,p_expected_state_fingerprint,
 p_parser_digest,p_proposal_digest,binding,st,p_decisions,result,p_reason);
 return result;
end $$;
-- Defense in depth: direct writes cannot silently use obsolete mapped rows.
create function zysyr_private.history_generation_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 if TG_TABLE_NAME='zysyr_history_import_batches' then b:=coalesce(new.id,old.id);
 else b:=coalesce(new.import_batch_id,old.import_batch_id); end if;
 if exists(select 1 from zysyr_private.history_parse_generations where batch_id=b) then
  raise exception 'HISTORY_GENERATION_VERSION_REQUIRED';
 end if;
 return coalesce(new,old);
end $$;
do $$
declare t text;
begin
 foreach t in array array['zysyr_history_import_batches','zysyr_history_import_rows','zysyr_history_import_evidence',
 'zysyr_history_import_row_evidence','zysyr_history_import_events','zysyr_history_ledger_entries','zysyr_history_ledger_revisions'] loop
 execute format('create trigger history_generation_write_guard before insert or update or delete on public.%I for each row execute function zysyr_private.history_generation_write_guard()',t);
 end loop;
end $$;
-- Wrap existing service-only history mutation RPCs without changing signatures.
-- A global lock intentionally serializes historical writes. Lock all affected
-- target batch before entering legacy code (including row-first legacy review).
-- Private originals lose all client/service execution rights.
do $install$
declare f record; args text; sig text; body text; oldname text; target_expr text;
begin
 for f in select p.*,pg_get_function_arguments(p.oid) as declaration,pg_get_function_result(p.oid) as result,
 pg_get_function_identity_arguments(p.oid) as identity_args
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname ~ '^zysyr_.*history'
 and p.proname not like 'zysyr_history_reparse_%' and p.prokind='f'
 and 'p_company_id'=any(p.proargnames) and 'p_store_id'=any(p.proargnames)
 loop
  if f.proretset then raise exception 'Unexpected set-returning history RPC: %',f.proname; end if;
  select string_agg(format('%I',v),',' order by ord) into args from unnest(f.proargnames) with ordinality x(v,ord);
  oldname:=f.proname;
  if 'p_import_batch_id'=any(f.proargnames) then target_expr:='p_import_batch_id';
  elsif 'p_import_row_id'=any(f.proargnames) then target_expr:='(select import_batch_id from public.zysyr_history_import_rows where id=p_import_row_id and company_id=p_company_id and store_id=p_store_id)';
  elsif 'p_ledger_entry_id'=any(f.proargnames) then target_expr:='(select import_batch_id from public.zysyr_history_ledger_entries where id=p_ledger_entry_id and company_id=p_company_id and store_id=p_store_id)';
  elsif oldname='zysyr_stage_history_import' then target_expr:='null::uuid';
  else raise exception 'Unmapped history writer: %',oldname; end if;
  execute format('alter function public.%I(%s) set schema zysyr_private',oldname,f.identity_args);
  execute format('revoke all on function zysyr_private.%I(%s) from public,anon,authenticated,service_role',oldname,f.identity_args);
  body:=format('declare target_batch uuid; begin
    perform pg_advisory_xact_lock(724394177001::bigint);
    target_batch:=%s;
    perform 1 from public.zysyr_history_import_batches where id=target_batch and company_id=p_company_id and store_id=p_store_id for update;
    if exists(select 1 from zysyr_private.history_parse_generations where batch_id=target_batch and company_id=p_company_id and store_id=p_store_id) then
      raise exception ''HISTORY_GENERATION_VERSION_REQUIRED'';
    end if;
    return zysyr_private.%I(%s);
  end',target_expr,oldname,args);
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' set lock_timeout=''5s'' set statement_timeout=''30s'' as %L',oldname,f.declaration,f.result,body);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',oldname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to service_role',oldname,f.identity_args);
 end loop;
end $install$;
do $$
declare f record;
begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname like 'zysyr_history_reparse_%')
 or (n.nspname='zysyr_private' and p.proname in ('history_reparse_scope','history_generation_write_guard')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 if f.sig::text like 'zysyr_history_reparse_%' then execute format('grant execute on function %s to service_role',f.sig); end if;
 end loop;
end $$;
commit;
