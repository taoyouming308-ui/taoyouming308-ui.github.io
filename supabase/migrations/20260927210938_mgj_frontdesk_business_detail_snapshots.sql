-- Additive source storage only. No existing reports, ledgers or attachments change.
begin;
create table public.mgj_business_detail_snapshots (
 id uuid primary key default gen_random_uuid(),
 shop_name text not null check (shop_name in ('自由手艺人','向里造型')),
 business_date date not null check (business_date >= date '2026-01-01' and business_date < date '2027-01-01'),
 source_scope text not null default 'project_consumption' check (source_scope='project_consumption'),
 source_count integer not null check(source_count between 0 and 1000),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,
 fetched_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(shop_name,business_date,source_sha256),
 unique(shop_name,business_date,id)
);
create table public.mgj_business_detail_heads (
 shop_name text not null,
 business_date date not null,
 snapshot_id uuid not null,
 last_seen_at timestamptz not null,
 primary key(shop_name,business_date),
 foreign key(shop_name,business_date,snapshot_id)
 references public.mgj_business_detail_snapshots(shop_name,business_date,id)
);
alter table public.mgj_business_detail_snapshots enable row level security;
alter table public.mgj_business_detail_snapshots force row level security;
alter table public.mgj_business_detail_heads enable row level security;
alter table public.mgj_business_detail_heads force row level security;
revoke all on public.mgj_business_detail_snapshots,public.mgj_business_detail_heads from public,anon,authenticated,service_role;

create function public.mgj_ingest_business_details(p_shop text,p_day date,p_fetched_at timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 expected_shop text; n integer; b jsonb; r jsonb; k text; v jsonb;
 live_services jsonb; expected_ids text[]; actual_ids text[]; sha text; sid uuid; existing boolean;
 old_time timestamptz; old_id uuid; source_amount numeric; posted numeric;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'BUSINESS_SERVICE_REQUIRED'; end if;
 expected_shop:=case p_shop when '自由手艺人' then '1009951' when '向里造型' then '1837032' end;
 if expected_shop is null or p_day is null or p_day<date '2026-01-01' or p_day>date '2026-12-31'
 or p_day>(now() at time zone 'Asia/Shanghai')::date
 or p_fetched_at is null or p_fetched_at>now()+interval '10 seconds' or p_fetched_at<now()-interval '2 minutes'
 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>2097152
 or p_payload->>'contract_version' is distinct from 'mgj-business-day-v1'
 or p_payload->>'shop_id' is distinct from expected_shop or p_payload->>'business_date' is distinct from p_day::text
 or p_payload->>'source_scope' is distinct from 'project_consumption'
 or jsonb_typeof(p_payload->'bills') is distinct from 'array'
 then raise exception 'BUSINESS_INVALID_SCOPE'; end if;
 n:=jsonb_array_length(p_payload->'bills');
 if n>1000 then raise exception 'BUSINESS_TOO_LARGE'; end if;
 -- Stable complete source list already verified by the existing signed sync.
 select services into live_services from public.mgj_daily_consumption
 where shop_name=p_shop and business_date=p_day for share;
 if live_services is null then raise exception 'BUSINESS_LIST_MISSING'; end if;
 select coalesce(array_agg(x->>'source_id' order by x->>'source_id'),'{}') into expected_ids
 from jsonb_array_elements(live_services) x;
 select coalesce(array_agg(x->>'source_bill_id' order by x->>'source_bill_id'),'{}') into actual_ids
 from jsonb_array_elements(p_payload->'bills') x;
 if expected_ids is distinct from actual_ids or cardinality(actual_ids)<>(select count(distinct x) from unnest(actual_ids)x)
 then raise exception 'BUSINESS_INCOMPLETE_OR_DUPLICATE'; end if;
 for b in select value from jsonb_array_elements(p_payload->'bills') loop
  if b->>'contract_version' is distinct from 'mgj-business-detail-v1'
  or b->>'shop_id' is distinct from expected_shop or b->>'business_date' is distinct from p_day::text
  or b->'source_scope_verified' is distinct from 'true'::jsonb
  or b->'report_ready' is distinct from 'false'::jsonb
  or jsonb_typeof(b->'items') is distinct from 'array'
  or jsonb_typeof(b->'payments') is distinct from 'array'
  or jsonb_typeof(b->'employee_allocations') is distinct from 'array'
  or jsonb_typeof(b->'gaps') is distinct from 'array'
  then raise exception 'BUSINESS_INVALID_BILL'; end if;
  posted:=(b->>'source_posted_amount_cents')::numeric;
  select (x->>'amount')::numeric*100 into source_amount from jsonb_array_elements(live_services)x
  where x->>'source_id'=b->>'source_bill_id';
  if posted is null or source_amount is null or posted<>source_amount then raise exception 'BUSINESS_POSTED_AMOUNT_MISMATCH'; end if;
  -- Integer cents and bounded arrays protect server-side aggregation from truncation/NaN.
  for r in select value from jsonb_array_elements(b->'items')
   union all select value from jsonb_array_elements(b->'payments')
   union all select value from jsonb_array_elements(b->'employee_allocations')
   union all select b loop
   if jsonb_typeof(r)<>'object' then raise exception 'BUSINESS_INVALID_ROW'; end if;
   for k,v in select key,value from jsonb_each(r) loop
    if k like '%\_cents' escape '\' and v<>'null'::jsonb then
     if jsonb_typeof(v)<>'number' or v::text !~ '^-?[0-9]+$' or abs((v::text)::numeric)>9007199254740991
     then raise exception 'BUSINESS_INVALID_CENTS'; end if;
    end if;
   end loop;
  end loop;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('mgj_business:'||p_shop||':'||p_day,0));
 select last_seen_at,snapshot_id into old_time,old_id from public.mgj_business_detail_heads
 where shop_name=p_shop and business_date=p_day;
 if old_time is not null and old_time>p_fetched_at then
  return jsonb_build_object('accepted',false,'reason','older_snapshot','snapshot_id',old_id,'formal_ledger_amount_changed',false);
 end if;
 sha:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 select id into sid from public.mgj_business_detail_snapshots where shop_name=p_shop and business_date=p_day and source_sha256=sha;
 existing:=sid is not null;
 if sid is null then
  insert into public.mgj_business_detail_snapshots(shop_name,business_date,source_count,source_sha256,payload,fetched_at)
  values(p_shop,p_day,n,sha,p_payload,p_fetched_at) returning id into sid;
 end if;
 insert into public.mgj_business_detail_heads values(p_shop,p_day,sid,p_fetched_at)
 on conflict(shop_name,business_date) do update set snapshot_id=excluded.snapshot_id,last_seen_at=excluded.last_seen_at;
 return jsonb_build_object('accepted',true,'snapshot_id',sid,'source_sha256',sha,'source_count',n,
 'shop',p_shop,'date',p_day,'source_scope','project_consumption','deduplicated',existing,
 'stage','business_details','report_ready',false,'formal_ledger_amount_changed',false);
end $$;
revoke all on function public.mgj_ingest_business_details(text,date,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.mgj_ingest_business_details(text,date,timestamptz,jsonb) to service_role;

create function public.mgj_read_business_details(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.mgj_business_detail_snapshots; last_seen timestamptz; current_list jsonb; snapshot_ids text[]; current_ids text[]; changed boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'BUSINESS_SERVICE_REQUIRED'; end if;
 if p_shop not in ('自由手艺人','向里造型') or p_shop is null or p_day is null
 or p_day<date '2026-01-01' or p_day>date '2026-12-31' then raise exception 'BUSINESS_INVALID_SCOPE'; end if;
 select x.* into s from public.mgj_business_detail_heads h
 join public.mgj_business_detail_snapshots x on x.id=h.snapshot_id
 where h.shop_name=p_shop and h.business_date=p_day;
 if s.id is null then return jsonb_build_object('available',false,'shop',p_shop,'date',p_day,'bills','[]'::jsonb,'report_ready',false); end if;
 select h.last_seen_at into last_seen from public.mgj_business_detail_heads h where h.shop_name=p_shop and h.business_date=p_day;
 select services into current_list from public.mgj_daily_consumption where shop_name=p_shop and business_date=p_day;
 select array_agg(x->>'source_bill_id' order by x->>'source_bill_id') into snapshot_ids from jsonb_array_elements(s.payload->'bills')x;
 select array_agg(x->>'source_id' order by x->>'source_id') into current_ids from jsonb_array_elements(current_list)x;
 changed:=current_list is null or snapshot_ids is distinct from current_ids or exists(
 select 1 from jsonb_array_elements(s.payload->'bills')b join jsonb_array_elements(current_list)x on x->>'source_id'=b->>'source_bill_id'
 where (b->>'source_posted_amount_cents')::numeric is distinct from (x->>'amount')::numeric*100);
 return jsonb_build_object('available',true,'shop',p_shop,'date',p_day,'snapshot_id',s.id,'source_sha256',s.source_sha256,
 'source_count',s.source_count,'source_scope',s.source_scope,'fetched_at',last_seen,
 'source_list_changed',changed,'bills',s.payload->'bills','report_ready',false);
end $$;
revoke all on function public.mgj_read_business_details(text,date) from public,anon,authenticated;
grant execute on function public.mgj_read_business_details(text,date) to service_role;
comment on table public.mgj_business_detail_snapshots is 'Private immutable project-bill payment and staff allocations; not posted financial reports';
commit;
