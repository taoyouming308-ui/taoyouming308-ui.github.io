-- LOCAL CANDIDATE: preserve salary unknowns and explicitly partial petty-cash scope.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.zysyr_history_reparse_apply(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid,
 p_request_id uuid,p_expected_state_fingerprint text,p_expected_source_sha256 text,p_parser_digest text,p_proposal_digest text,p_reason text,p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' set statement_timeout='30s' as $$
declare st jsonb; binding jsonb; existing zysyr_private.history_parse_generations; r jsonb; d jsonb; eff jsonb; src jsonb;
 prov jsonb; item jsonb; fields text[]; field_name text; import_type text; ver integer; gid uuid:=gen_random_uuid(); result jsonb; n integer; excluded integer;
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
 if st#>>'{batch,status}' <> 'needs_review' or st#>>'{batch,import_type}' not in ('monthly_profit_loss','salary','petty_cash')
 or st#>>'{batch,confirmed_at}' is not null or (st#>>'{batch,imported_row_count}')::int<>0
 or jsonb_array_length(st->'ledger')<>0 then raise exception 'HISTORY_REPARSE_BATCH_NOT_PRISTINE'; end if;
 if exists(select 1 from jsonb_array_elements(st->'events') e where e->>'action' not in ('stage','evidence_upload','evidence_link')) then raise exception 'HISTORY_REPARSE_PRIOR_ACTIVITY'; end if;
 import_type:=st#>>'{batch,import_type}';
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
  if jsonb_typeof(eff) is distinct from 'object' or (import_type='monthly_profit_loss' and src->>'cell_address' is distinct from r#>>'{mapped_json,cell_address}')
   or d->>'validation_status' is null or jsonb_typeof(d->'validation_issues') is distinct from 'array' or d->>'validation_status' not in ('valid','warning','invalid') or not ((d->'validation_issues') @> (r->'validation_issues'))
   or (r->>'validation_status'='invalid' and d->>'validation_status'<>'invalid')
   or (r->>'validation_status'='warning' and d->>'validation_status'='valid') then raise exception 'HISTORY_REPARSE_VALIDATION_INVALID'; end if;
  if import_type in ('salary','petty_cash') then
   prov:=src->'source_provenance';
   if d->>'disposition' is distinct from 'include' or src->>'import_type' is distinct from import_type
    or jsonb_typeof(prov) is distinct from 'object' or prov->>'status' is distinct from 'verified'
    or eff->'_source_provenance' is distinct from (prov-'status') or (r->'mapped_json') ? '_source_provenance'
    then raise exception 'HISTORY_REPARSE_PROVENANCE_INVALID';end if;
   if import_type='salary' then
    if (prov-array['status','fields'])<>'{}'::jsonb or jsonb_typeof(prov->'fields') is distinct from 'array' then raise exception 'HISTORY_REPARSE_PROVENANCE_INVALID';end if;
    select coalesce(array_agg(x->>'field'),array[]::text[]) into fields from jsonb_array_elements(prov->'fields')x;
    if cardinality(fields)<>(select count(distinct x) from unnest(fields)x) then raise exception 'HISTORY_REPARSE_PROVENANCE_INVALID';end if;
    for item in select value from jsonb_array_elements(prov->'fields') loop
     field_name:=item->>'field';
     if field_name is null or field_name<>all(array['base_salary','seniority_salary','position_salary','meal_allowance','performance_commission','delivery_card_commission','overtime_activity_allowance','supplemental_adjustment','gross_pay','product_cost','late_early_deduction','shooting_deduction','leave_deduction','growth_deduction','employee_purchase_deduction','social_security','total_deduction','net_pay'])
      or coalesce(item->>'status','') not in ('missing_column','blank','missing_formula_cache')
      or (item-array['field','status','source_locator'])<>'{}'::jsonb
      or ((r->'mapped_json')->field_name not in ('0'::jsonb,'null'::jsonb)) is not false
      or eff->field_name is distinct from 'null'::jsonb then raise exception 'HISTORY_REPARSE_MISSING_AMOUNT_INVALID';end if;
     if item->>'status'='missing_column' then
      if item->'source_locator' is distinct from 'null'::jsonb then raise exception 'HISTORY_REPARSE_PROVENANCE_LOCATOR_INVALID';end if;
     elsif nullif(item->>'source_locator','') is null or split_part(item->>'source_locator','!',1) is distinct from r->>'source_sheet'
      or coalesce(substring(item->>'source_locator' from '[0-9]+$'),'0')::integer<>(r->>'source_row_number')::integer
      then raise exception 'HISTORY_REPARSE_PROVENANCE_LOCATOR_INVALID';end if;
     if not exists(select 1 from jsonb_array_elements(d->'validation_issues')i where i->>'code'='source_amount_unprovided' and i->>'field'=field_name) then raise exception 'HISTORY_REPARSE_PROVENANCE_WARNING_REQUIRED';end if;
    end loop;
    if (eff-'_source_provenance'-fields) is distinct from ((r->'mapped_json')-fields) then raise exception 'HISTORY_REPARSE_CHANGE_DENIED';end if;
    if cardinality(fields)>0 and d->>'validation_status'='valid' then raise exception 'HISTORY_REPARSE_PROVENANCE_WARNING_REQUIRED';end if;
    if (jsonb_typeof(eff->'gross_pay') is distinct from 'number' or jsonb_typeof(eff->'total_deduction') is distinct from 'number' or jsonb_typeof(eff->'net_pay') is distinct from 'number')
     and d->>'validation_status'<>'invalid' then raise exception 'HISTORY_REPARSE_CRITICAL_SALARY_INVALID';end if;
   else
    if (prov-array['status','scope'])<>'{}'::jsonb or jsonb_typeof(prov->'scope') is distinct from 'object'
     or prov#>>'{scope,kind}' is distinct from 'dated_details_only' or prov#>'{scope,complete}' is distinct from 'false'::jsonb
     or jsonb_typeof(prov#>'{scope,excluded_items}') is distinct from 'array'
     or ((prov->'scope')-array['kind','complete','excluded_items'])<>'{}'::jsonb
     or (eff-'_source_provenance') is distinct from r->'mapped_json'
     or prov->'scope' is distinct from p_decisions#>'{0,source_snapshot,source_provenance,scope}' then raise exception 'HISTORY_REPARSE_PETTY_SCOPE_INVALID';end if;
    if d->>'validation_status'='valid' or not exists(select 1 from jsonb_array_elements(d->'validation_issues')i where i->>'code'='dated_details_only') then raise exception 'HISTORY_REPARSE_PROVENANCE_WARNING_REQUIRED';end if;
    if jsonb_array_length(prov#>'{scope,excluded_items}')<>(select count(distinct x->>'source_locator') from jsonb_array_elements(prov#>'{scope,excluded_items}')x) then raise exception 'HISTORY_REPARSE_PETTY_EXCLUSION_INVALID';end if;
    for item in select value from jsonb_array_elements(prov#>'{scope,excluded_items}') loop
     if item->'transaction_date' is distinct from 'null'::jsonb or coalesce(item->>'kind','') not in ('opening_balance','undated_reimbursement','undated_movement')
      or nullif(item->>'summary','') is null or nullif(item->>'source_locator','') is null
      or coalesce(item->>'period_month','') !~ '^[0-9]{4}-[0-9]{2}-01$'
      or (item->>'period_month')::date not between (st#>>'{batch,period_start}')::date and (st#>>'{batch,period_end}')::date
      or exists(select 1 from jsonb_array_elements(st->'rows') rr where rr->>'source_locator'=item->>'source_locator')
      then raise exception 'HISTORY_REPARSE_PETTY_EXCLUSION_INVALID';end if;
     foreach field_name in array array['amount','inflow','outflow'] loop
      if coalesce(jsonb_typeof(item->field_name),'missing') not in ('number','null') then raise exception 'HISTORY_REPARSE_PETTY_EXCLUSION_INVALID';end if;
     end loop;
    end loop;
   end if;
   continue;
  end if;
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
 select count(*) into excluded from jsonb_array_elements(p_decisions) decision_item where decision_item->>'disposition'='exclude_merged_slave';
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
 if st#>>'{batch,status}'<>'needs_review' or st#>>'{batch,import_type}' not in ('monthly_profit_loss','salary','petty_cash')
 or jsonb_array_length(st->'ledger')<>0 then raise exception 'HISTORY_GENERATION_BATCH_NOT_PRISTINE'; end if;
 if exists(select 1 from zysyr_private.history_generation_finance_actions where generation_id=p_expected_generation_id and operation=p_action) then raise exception 'HISTORY_GENERATION_ACTION_ALREADY_RECORDED'; end if;
 select jsonb_agg(item order by item->>'import_row_id') into included from jsonb_array_elements(st#>'{active_generation,decisions}')item where item->>'disposition'='include';
 count_included:=coalesce(jsonb_array_length(included),0);
 if count_included=0 then raise exception 'HISTORY_GENERATION_EMPTY'; end if;
 for d in select value from jsonb_array_elements(included) loop
  if d->>'validation_status' not in ('valid','warning') or d->>'validation_status' is null
  or ((st#>>'{batch,import_type}') in ('monthly_profit_loss','petty_cash') and jsonb_typeof(d#>'{effective_mapped,amount}') is distinct from 'number')
  or ((st#>>'{batch,import_type}')='salary' and (jsonb_typeof(d#>'{effective_mapped,gross_pay}') is distinct from 'number' or jsonb_typeof(d#>'{effective_mapped,total_deduction}') is distinct from 'number' or jsonb_typeof(d#>'{effective_mapped,net_pay}') is distinct from 'number'))
  or coalesce(d#>>'{effective_mapped,period_month}','') !~ '^[0-9]{4}-[0-9]{2}-01$'
  or (d#>>'{effective_mapped,period_month}')::date not between (st#>>'{batch,period_start}')::date and (st#>>'{batch,period_end}')::date
  then raise exception 'HISTORY_GENERATION_INVALID_INCLUDED_ROW'; end if;
  if st#>>'{batch,import_type}'='petty_cash' and (coalesce(d#>>'{effective_mapped,transaction_date}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or date_trunc('month',(d#>>'{effective_mapped,transaction_date}')::date)::date<>(d#>>'{effective_mapped,period_month}')::date
   or (d#>>'{effective_mapped,amount}')::numeric<=0 or coalesce(d#>>'{effective_mapped,direction}','') not in ('inflow','outflow')
   or nullif(btrim(d#>>'{effective_mapped,summary}'),'') is null) then raise exception 'HISTORY_GENERATION_INVALID_INCLUDED_ROW';end if;
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
     select p_company_id,p_store_id,p_batch_id,r.id,st#>>'{batch,import_type}',(d#>>'{effective_mapped,period_month}')::date,r.source_sheet,r.source_locator,r.row_hash,
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
   or new.company_id<>source_row.company_id or new.store_id<>source_row.store_id or new.entry_type is distinct from (select import_type from public.zysyr_history_import_batches where id=b)
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

create or replace function zysyr_private.history_generation_finance_state_v1(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_batch_id uuid)
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
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('import_row_id',d->'import_row_id','validation_status',d->'validation_status','validation_issues',d->'validation_issues','source_provenance',d#>'{effective_mapped,_source_provenance}') order by d->>'import_row_id'),'[]'::jsonb) from jsonb_array_elements(included)d));
 finance:=jsonb_build_object('included_count',jsonb_array_length(included),'issue_material',issue_material,
 'issue_digest',encode(sha256(convert_to(zysyr_private.history_canonical_json(issue_material),'UTF8')),'hex'),
 'reviewed_count',coalesce(jsonb_array_length(review),0),'review_fingerprint',case when review is null then null else encode(sha256(convert_to(zysyr_private.history_canonical_json(review),'UTF8')),'hex') end,
 'confirmation_id',confirmation,'posted_count',coalesce(posted,0),'actions',actions,
 'effective_status',case when posted is not null then 'posted' when confirmation is not null then 'confirmed' when review is not null then 'reviewed' else 'needs_review' end,
 'original_rows_are_parser_snapshot',true);
 return base||jsonb_build_object('finance',finance,'state_fingerprint',encode(sha256(convert_to((jsonb_build_object('source_state',base->'state_fingerprint','finance',finance))::text,'UTF8')),'hex'));
end $$;
commit;
