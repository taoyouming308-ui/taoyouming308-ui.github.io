-- Evidence associations only. No approval, amount revision or posting writes.
set lock_timeout='5s';
create table public.zysyr_expense_voucher_matches (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,period_month date not null check(extract(day from period_month)=1),
 voucher_id uuid not null,component_index integer not null check(component_index between 0 and 11),source_task_id uuid not null,
 target_kind text not null check(target_kind in ('formal','history','draft','source_petty','monthly_source')),
 target_id text not null,target_snapshot jsonb not null,corrected_fields jsonb not null,
 mode text not null check(mode in ('auto','manual')),status text not null default 'active' check(status in ('active','void')),
 actor_user_id uuid not null,reason text not null check(length(btrim(reason))>0),created_at timestamptz not null default now(),
 foreign key(company_id,store_id) references public.zysyr_stores(company_id,id),
 foreign key(company_id,voucher_id) references public.zysyr_voucher_attachments(company_id,id),
 foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id)
);
create unique index zysyr_expense_voucher_match_active on public.zysyr_expense_voucher_matches(company_id,store_id,voucher_id,component_index) where status='active';
create index zysyr_expense_voucher_match_month on public.zysyr_expense_voucher_matches(company_id,store_id,period_month,status);
alter table public.zysyr_expense_voucher_matches enable row level security;
revoke all on public.zysyr_expense_voucher_matches from public,anon,authenticated,service_role;
grant select on public.zysyr_expense_voucher_matches to service_role;

create function public.zysyr_save_expense_voucher_matches(p_actor uuid,p_company uuid,p_store uuid,p_month date,p_mode text,p_matches jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;v public.zysyr_voucher_attachments;t public.zysyr_voucher_ocr_tasks;f jsonb;c jsonb;target_valid boolean;inserted integer:=0; saved_id uuid;source_id uuid;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 if p_mode not in ('auto','manual') or extract(day from p_month)<>1 or jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches) not between 1 and 20 then raise exception 'INVALID_EXPENSE_MATCH_REQUEST';end if;
 for r in select value from jsonb_array_elements(p_matches) loop
  select * into v from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store and id=(r->>'voucher_id')::uuid for update;
  if v.id is null or v.note not like 'petty_cash_batch|'||to_char(p_month,'YYYY-MM')||'|%' or v.audit_status<>'pending' then raise exception 'EXPENSE_VOUCHER_SCOPE_OR_REVIEW_CHANGED';end if;
  if exists(select 1 from public.zysyr_expense_voucher_matches where company_id=p_company and store_id=p_store and voucher_id=v.id and component_index=(r->>'component_index')::int and status='active') then continue;end if;
  select * into t from public.zysyr_voucher_ocr_tasks where company_id=p_company and store_id=p_store and voucher_id=v.id order by attempt desc limit 1;
  if t.id is null or t.id<>(r->>'task_id')::uuid then raise exception 'EXPENSE_RECOGNITION_CHANGED';end if;
  f:=r->'corrected_fields';
  if coalesce((f->>'amount')::numeric,0)<=0 or (f->>'amount')::numeric<>round((f->>'amount')::numeric,2) or nullif(btrim(r->>'reason'),'') is null then raise exception 'EXPENSE_MATCH_FIELDS_REQUIRED';end if;
  if f->>'evidence_kind'='monthly_summary' then
   if r->>'target_kind'<>'monthly_source' or f->>'document_date' is not null or f->>'period_month' is distinct from to_char(p_month,'YYYY-MM') then raise exception 'EXPENSE_SUMMARY_PERIOD_REQUIRED';end if;
  elsif f->>'document_date' is null or date_trunc('month',(f->>'document_date')::date)::date<>p_month then raise exception 'EXPENSE_MATCH_FIELDS_REQUIRED';end if;
  if p_mode='auto' then
   if exists(select 1 from public.zysyr_expense_voucher_matches where company_id=p_company and store_id=p_store and voucher_id=v.id and component_index=(r->>'component_index')::int and status='void') then raise exception 'EXPENSE_HUMAN_CORRECTION_PRESERVED';end if;
   if t.status<>'succeeded' then raise exception 'EXPENSE_RECOGNITION_NOT_READY';end if;
   if f->>'evidence_kind'='monthly_summary' then
    c:=t.candidate_fields->'monthly_summary';
    if (r->>'component_index')::int<>0 or c->>'evidence_kind' is distinct from 'monthly_summary' or c->>'period_month' is distinct from f->>'period_month'
      or coalesce((c->'confidence'->>'period_month')::numeric,0) not between 0.95 and 1 or coalesce((c->'confidence'->>'amount')::numeric,0) not between 0.98 and 1
      or coalesce(c->'evidence'->>'period_month','')='' then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   elsif jsonb_array_length(coalesce(t.candidate_fields->'transactions','[]'::jsonb))>0 then
    c:=t.candidate_fields->'transactions'->(r->>'component_index')::int;f:=r->'corrected_fields';
    if coalesce((c->'confidence'->>'document_date')::numeric,0)<0.95 or coalesce((c->'confidence'->>'amount')::numeric,0)<0.98 then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   else
    c:=t.candidate_fields;
    if (r->>'component_index')::int<>0 or c->>'document_kind'<>'receipt' or coalesce((t.field_confidences->>'document_date')::numeric,0)<0.95 or coalesce((t.field_confidences->>'amount')::numeric,0)<0.98 then raise exception 'EXPENSE_RECOGNITION_CONFIDENCE';end if;
   end if;
   if (f->>'evidence_kind' is distinct from 'monthly_summary' and (coalesce(c->'evidence'->>'document_date','')='' or c->>'document_date' is distinct from f->>'document_date'))
     or coalesce(c->'evidence'->>'amount','')='' or (c->>'amount')::numeric is distinct from (f->>'amount')::numeric
     or (r->'target_snapshot'->>'amount')::numeric is distinct from (f->>'amount')::numeric then raise exception 'EXPENSE_RECOGNITION_EVIDENCE';end if;
   if r->>'target_kind'='monthly_source' and (coalesce(c->'evidence'->>'expense_category','')='' or coalesce((coalesce(c->'confidence',t.field_confidences)->>'expense_category')::numeric,0) not between 0.95 and 1 or c->>'expense_category' is distinct from f->>'expense_category') then raise exception 'EXPENSE_CATEGORY_EVIDENCE_REQUIRED';end if;
  end if;
  target_valid:=false;
  case r->>'target_kind'
   when 'monthly_source' then
    source_id:=split_part(r->>'target_id','~',1)::uuid;
    select exists(select 1 from public.zysyr_monthly_source_selections s where s.company_id=p_company and s.store_id=p_store and s.period_month=p_month and s.id=source_id and s.source_request_id=(r->'target_snapshot'->>'source_request_id')::uuid
      and not exists(select 1 from public.zysyr_monthly_source_selections newer where newer.company_id=p_company and newer.store_id=p_store and newer.period_month=p_month and newer.selection_version>s.selection_version)) into target_valid;
    if split_part(r->>'target_id','~',2) !~ '^C[1-9][0-9]{0,2}$' or r->'target_snapshot'->>'source_locator' is distinct from split_part(r->>'target_id','~',2) then target_valid:=false;end if;
   when 'source_petty' then
    select exists(select 1 from public.zysyr_history_import_rows h join public.zysyr_history_import_batches b on b.id=h.import_batch_id where h.id=(r->>'target_id')::uuid and b.company_id=p_company and b.store_id=p_store and h.mapped_json->>'period_month'=p_month::text) into target_valid;
   when 'draft' then
    select exists(select 1 from public.zysyr_petty_detail_drafts where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and date_trunc('month',transaction_date)::date=p_month and amount=(r->'target_snapshot'->>'amount')::numeric and transaction_date=(r->'target_snapshot'->>'transaction_date')::date) into target_valid;
   when 'formal' then
    select exists(select 1 from public.zysyr_petty_cash_records where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and date_trunc('month',transaction_date)::date=p_month and direction='outflow' and status='confirmed' and amount=(r->'target_snapshot'->>'amount')::numeric and transaction_date=(r->'target_snapshot'->>'transaction_date')::date) into target_valid;
   when 'history' then
    select exists(select 1 from public.zysyr_history_ledger_entries where company_id=p_company and store_id=p_store and id=(r->>'target_id')::uuid and current_payload->>'period_month'=p_month::text) into target_valid;
   else null;
  end case;
  if not target_valid then raise exception 'EXPENSE_TARGET_SOURCE_CHANGED';end if;
  insert into public.zysyr_expense_voucher_matches(company_id,store_id,period_month,voucher_id,component_index,source_task_id,target_kind,target_id,target_snapshot,corrected_fields,mode,actor_user_id,reason)
  values(p_company,p_store,p_month,v.id,(r->>'component_index')::int,t.id,r->>'target_kind',r->>'target_id',r->'target_snapshot',r->'corrected_fields',p_mode,p_actor,r->>'reason') returning id into saved_id;
  inserted:=inserted+1;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company,p_store,'user',p_actor,'api','voucher_attachment',v.id,'expense_voucher_match',jsonb_build_object('match_id',saved_id,'mode',p_mode,'target_kind',r->>'target_kind','target_id',r->>'target_id'),r->>'reason','financial');
 end loop;
 return jsonb_build_object('inserted',inserted,'posted',false,'amount_changed',false,'voucher_approved',false);
end $$;
revoke execute on function public.zysyr_save_expense_voucher_matches(uuid,uuid,uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_save_expense_voucher_matches(uuid,uuid,uuid,date,text,jsonb) to service_role;

create function public.zysyr_void_expense_voucher_match(p_actor uuid,p_company uuid,p_store uuid,p_match uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.zysyr_expense_voucher_matches;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 if nullif(btrim(p_reason),'') is null then raise exception 'EXPENSE_MATCH_REASON_REQUIRED';end if;
 select * into m from public.zysyr_expense_voucher_matches where id=p_match and company_id=p_company and store_id=p_store for update;
 if m.id is null then raise exception 'EXPENSE_MATCH_NOT_FOUND';end if;
 update public.zysyr_expense_voucher_matches set status='void' where id=m.id;
 insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
 values(p_company,p_store,'user',p_actor,'api','voucher_attachment',m.voucher_id,'expense_voucher_match_void',jsonb_build_object('match_id',m.id),p_reason,'financial');
 return jsonb_build_object('id',m.id,'status','void','original_preserved',true,'posted',false);
end $$;
revoke execute on function public.zysyr_void_expense_voucher_match(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.zysyr_void_expense_voucher_match(uuid,uuid,uuid,uuid,text) to service_role;
