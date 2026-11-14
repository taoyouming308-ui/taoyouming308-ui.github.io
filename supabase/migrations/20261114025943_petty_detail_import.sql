-- Matching drafts only: never creates financial records or posts history.
set lock_timeout = '5s';
-- Keep the existing private bucket/size boundary; add only the required CSV type.
update storage.buckets set allowed_mime_types = array_append(allowed_mime_types,'text/csv')
where id='zysyr-reports' and allowed_mime_types is not null and not ('text/csv'=any(allowed_mime_types));
create table public.zysyr_petty_detail_imports (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 month date not null check (extract(day from month)=1), source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 selection_hash text not null check(selection_hash ~ '^[0-9a-f]{64}$'), source_filename text not null, source_object_path text not null, mapping jsonb not null,
 created_by_user_id uuid not null, created_at timestamptz not null default now(),
 unique(company_id,store_id,id), unique(company_id,store_id,month,selection_hash),
 foreign key(company_id,store_id) references public.zysyr_stores(company_id,id),
 foreign key(company_id,created_by_user_id) references public.zysyr_user_accounts(company_id,id)
);
create table public.zysyr_petty_detail_drafts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 import_id uuid not null, transaction_date date not null, amount numeric(14,2) not null check(amount>0),
 summary text not null check(length(btrim(summary))>0), category text, recipient text, voucher_number text,
 source_row integer not null check(source_row>=2), row_key text not null check(row_key ~ '^[0-9a-f]{64}$'), raw jsonb not null,
 unique(company_id,store_id,id), unique(company_id,store_id,row_key),
 foreign key(company_id,store_id,import_id) references public.zysyr_petty_detail_imports(company_id,store_id,id)
);
create table public.zysyr_petty_detail_links (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
 draft_id uuid not null, voucher_id uuid not null, actor_user_id uuid not null,
 corrected_fields jsonb not null, reason text not null check(length(btrim(reason))>0), created_at timestamptz not null default now(),
 unique(company_id,store_id,voucher_id),
 foreign key(company_id,store_id,draft_id) references public.zysyr_petty_detail_drafts(company_id,store_id,id),
 foreign key(company_id,voucher_id) references public.zysyr_voucher_attachments(company_id,id),
 foreign key(company_id,actor_user_id) references public.zysyr_user_accounts(company_id,id)
);
alter table public.zysyr_petty_detail_imports enable row level security;
alter table public.zysyr_petty_detail_drafts enable row level security;
alter table public.zysyr_petty_detail_links enable row level security;
revoke all on public.zysyr_petty_detail_imports, public.zysyr_petty_detail_drafts, public.zysyr_petty_detail_links from public, anon, authenticated, service_role;
grant select on public.zysyr_petty_detail_imports, public.zysyr_petty_detail_drafts, public.zysyr_petty_detail_links to service_role;
create function public.zysyr_save_petty_detail_import(p_actor uuid,p_company uuid,p_store uuid,p_month date,p_source jsonb,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch_id uuid; r jsonb; inserted integer := 0;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 if extract(day from p_month)<>1 or coalesce(jsonb_typeof(p_rows),'null')<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'INVALID_DETAIL_IMPORT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_store::text||p_month::text,0));
 select id into batch_id from public.zysyr_petty_detail_imports where company_id=p_company and store_id=p_store and month=p_month and selection_hash=p_source->>'selection_hash';
 if batch_id is not null then return jsonb_build_object('id',batch_id,'duplicate',true,'inserted',0); end if;
 insert into public.zysyr_petty_detail_imports(company_id,store_id,month,source_sha256,selection_hash,source_filename,source_object_path,mapping,created_by_user_id)
 values(p_company,p_store,p_month,p_source->>'sha256',p_source->>'selection_hash',p_source->>'filename',p_source->>'object_path',p_mapping,p_actor) returning id into batch_id;
 for r in select value from jsonb_array_elements(p_rows) loop
  if date_trunc('month',(r->>'transaction_date')::date)::date<>p_month or (r->>'amount')::numeric<=0 or nullif(btrim(r->>'summary'),'') is null then raise exception 'INVALID_DETAIL_ROW'; end if;
  insert into public.zysyr_petty_detail_drafts(company_id,store_id,import_id,transaction_date,amount,summary,category,recipient,voucher_number,source_row,row_key,raw)
  values(p_company,p_store,batch_id,(r->>'transaction_date')::date,(r->>'amount')::numeric,r->>'summary',r->>'category',r->>'recipient',r->>'voucher_number',(r->>'source_row')::integer,r->>'row_key',r->'raw');
  inserted := inserted+1;
 end loop;
 return jsonb_build_object('id',batch_id,'inserted',inserted,'posted',false);
end $$;
create function public.zysyr_link_petty_detail_draft(p_actor uuid,p_company uuid,p_store uuid,p_month date,p_draft uuid,p_voucher uuid,p_fields jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.zysyr_petty_detail_drafts; v public.zysyr_voucher_attachments; reviewed public.zysyr_voucher_attachments; link_id uuid;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'voucher.review');
 select * into d from public.zysyr_petty_detail_drafts where company_id=p_company and store_id=p_store and id=p_draft for update;
 select * into v from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store and id=p_voucher for update;
 if d.id is null or v.id is null or date_trunc('month',d.transaction_date)::date<>p_month or v.note not like 'petty_cash_batch|'||to_char(p_month,'YYYY-MM')||'|%' then raise exception 'DETAIL_SCOPE_MISMATCH'; end if;
 if v.audit_status<>'pending' then raise exception 'VOUCHER_REVIEW_CHANGED_REFRESH_REQUIRED'; end if;
 if nullif(btrim(p_reason),'') is null or coalesce((p_fields->>'amount')::numeric,0)<=0 or (p_fields->>'document_date')::date is null then raise exception 'REVIEW_FIELDS_REQUIRED'; end if;
 if exists(select 1 from public.zysyr_voucher_links where company_id=p_company and store_id=p_store and voucher_id=p_voucher and unlinked_at is null) then raise exception 'VOUCHER_ALREADY_LINKED'; end if;
 reviewed := public.zysyr_review_voucher(p_actor,p_company,p_store,p_voucher,'approved','petty_cash',p_fields,'{}'::jsonb,array[]::uuid[],p_reason);
 insert into public.zysyr_petty_detail_links(company_id,store_id,draft_id,voucher_id,actor_user_id,corrected_fields,reason)
 values(p_company,p_store,p_draft,p_voucher,p_actor,p_fields,p_reason) returning id into link_id;
 return jsonb_build_object('id',link_id,'posted',false);
end $$;
revoke execute on function public.zysyr_save_petty_detail_import(uuid,uuid,uuid,date,jsonb,jsonb,jsonb), public.zysyr_link_petty_detail_draft(uuid,uuid,uuid,date,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.zysyr_save_petty_detail_import(uuid,uuid,uuid,date,jsonb,jsonb,jsonb), public.zysyr_link_petty_detail_draft(uuid,uuid,uuid,date,uuid,uuid,jsonb,text) to service_role;
