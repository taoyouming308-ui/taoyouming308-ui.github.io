-- Phase 1 only: immutable private source evidence and source-only candidates.
-- No legacy draft, voucher, confirmation function, income or monthly row changes.
set statement_timeout = '30s';
set lock_timeout = '5s';

-- Separate schema avoids broadening access to any legacy private functions.
create schema zysyr_daily_electronic_private;
revoke all on schema zysyr_daily_electronic_private from public,anon,authenticated,service_role;

create table public.zysyr_daily_electronic_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  business_date date not null check (business_date between date '2026-01-01' and date '2026-12-31'),
  source_scope text not null check (source_scope in ('projects_daily_summary','all_business_daily_summary')),
  version integer not null check (version > 0),
  source_shop_id text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  fetched_at timestamptz not null,
  scope_verified boolean not null default false check (scope_verified = false),
  scope_verification text not null default 'request_only' check (scope_verification = 'request_only'),
  created_at timestamptz not null default now(),
  unique(company_id,store_id,id),
  unique(company_id,store_id,business_date,source_scope,version),
  unique(company_id,store_id,business_date,source_scope,source_sha256),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  check (company_id = '02463a53-dfdb-4291-b04d-dd1d85f9d998'::uuid and
    ((store_id = 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid and source_shop_id = '1009951') or
     (store_id = '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid and source_shop_id = '1837032')))
);

create table public.zysyr_daily_electronic_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  snapshot_id uuid not null,
  mapping_version text not null check (mapping_version = 'mgj-summary-source-only-v1'),
  status text not null default 'needs_review' check (status = 'needs_review'),
  stage text not null default 'source_only' check (stage = 'source_only'),
  candidate_payload jsonb not null check (jsonb_typeof(candidate_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique(company_id,store_id,id),
  unique(snapshot_id,mapping_version),
  foreign key(company_id,store_id,snapshot_id)
    references public.zysyr_daily_electronic_snapshots(company_id,store_id,id) on delete restrict
);

-- Mutable ingestion cursor, never a financial record. A repeated source with a
-- later fetched_at advances this watermark without mutating its old evidence.
create table public.zysyr_daily_electronic_heads (
  company_id uuid not null,
  store_id uuid not null,
  business_date date not null,
  source_scope text not null,
  snapshot_id uuid not null,
  candidate_id uuid not null,
  latest_fetched_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(company_id,store_id,business_date,source_scope),
  foreign key(company_id,store_id,snapshot_id)
    references public.zysyr_daily_electronic_snapshots(company_id,store_id,id) on delete restrict,
  foreign key(company_id,store_id,candidate_id)
    references public.zysyr_daily_electronic_candidates(company_id,store_id,id) on delete restrict
);

create table public.zysyr_daily_electronic_ingest_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  snapshot_id uuid not null,
  candidate_id uuid not null,
  action text not null check (action in ('source_created','watermark_advanced')),
  source_sha256 text not null,
  prior_snapshot_id uuid,
  prior_fetched_at timestamptz,
  fetched_at timestamptz not null,
  actor_type text not null default 'service' check (actor_type = 'service'),
  channel text not null default 'mgj-daily-report-sync' check (channel = 'mgj-daily-report-sync'),
  created_at timestamptz not null default now(),
  foreign key(company_id,store_id,snapshot_id)
    references public.zysyr_daily_electronic_snapshots(company_id,store_id,id) on delete restrict,
  foreign key(company_id,store_id,candidate_id)
    references public.zysyr_daily_electronic_candidates(company_id,store_id,id) on delete restrict
);

alter table public.zysyr_daily_electronic_snapshots enable row level security;
alter table public.zysyr_daily_electronic_snapshots force row level security;
alter table public.zysyr_daily_electronic_candidates enable row level security;
alter table public.zysyr_daily_electronic_candidates force row level security;
alter table public.zysyr_daily_electronic_heads enable row level security;
alter table public.zysyr_daily_electronic_heads force row level security;
alter table public.zysyr_daily_electronic_ingest_events enable row level security;
alter table public.zysyr_daily_electronic_ingest_events force row level security;
revoke all on public.zysyr_daily_electronic_snapshots, public.zysyr_daily_electronic_candidates,
  public.zysyr_daily_electronic_heads, public.zysyr_daily_electronic_ingest_events
  from public, anon, authenticated, service_role;

create function zysyr_daily_electronic_private.protect_daily_electronic_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'DAILY_ELECTRONIC_EVIDENCE_IMMUTABLE';
end
$$;
revoke all on function zysyr_daily_electronic_private.protect_daily_electronic_evidence() from public,anon,authenticated,service_role;
create trigger daily_electronic_snapshot_immutable before update or delete
  on public.zysyr_daily_electronic_snapshots for each row execute function zysyr_daily_electronic_private.protect_daily_electronic_evidence();
create trigger daily_electronic_candidate_immutable before update or delete
  on public.zysyr_daily_electronic_candidates for each row execute function zysyr_daily_electronic_private.protect_daily_electronic_evidence();
create trigger daily_electronic_event_immutable before update or delete
  on public.zysyr_daily_electronic_ingest_events for each row execute function zysyr_daily_electronic_private.protect_daily_electronic_evidence();

create function zysyr_daily_electronic_private.daily_electronic_shop(p_company_id uuid,p_store_id uuid)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_company_id is distinct from '02463a53-dfdb-4291-b04d-dd1d85f9d998'::uuid then
    raise exception using errcode='42501',message='DAILY_ELECTRONIC_SCOPE_FORBIDDEN';
  end if;
  if p_store_id = 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid then return '1009951'; end if;
  if p_store_id = '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid then return '1837032'; end if;
  raise exception using errcode='42501',message='DAILY_ELECTRONIC_SCOPE_FORBIDDEN';
end
$$;
revoke all on function zysyr_daily_electronic_private.daily_electronic_shop(uuid,uuid) from public,anon,authenticated,service_role;

create function zysyr_daily_electronic_private.daily_electronic_cents(p_value jsonb)
returns bigint language plpgsql immutable set search_path = '' as $$
declare v_text text; v_amount numeric;
begin
  if p_value = 'null'::jsonb or p_value = '""'::jsonb then return null; end if;
  if p_value is null or jsonb_typeof(p_value) not in ('string','number') then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_AMOUNT_INVALID';
  end if;
  v_text := p_value #>> '{}';
  if length(v_text) > 24 or v_text !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_AMOUNT_INVALID';
  end if;
  v_amount := v_text::numeric;
  if v_amount > 999999999999.99 or v_amount*100 <> trunc(v_amount*100) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_AMOUNT_INVALID';
  end if;
  return (v_amount*100)::bigint;
end
$$;
revoke all on function zysyr_daily_electronic_private.daily_electronic_cents(jsonb) from public,anon,authenticated,service_role;

-- Pure, deterministic source-reference generator. It never maps the all-business
-- cash total to the old cash_flow revenue column, or uses employee role totals.
create function zysyr_daily_electronic_private.daily_electronic_summary_candidate(
  p_company_id uuid,p_store_id uuid,p_business_date date,p_source_scope text,p_source jsonb
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_shop text := zysyr_daily_electronic_private.daily_electronic_shop(p_company_id,p_store_id);
  v_content jsonb; v_query jsonb; v_row jsonb; v_top jsonb; v_period text;
  v_headers jsonb := '["日期","总额","现金","银联","支付宝","微信支付","大众点评","商场卡","合作券","口碑","抖音","总额","划卡","划赠送金","划分期赠送金","总额","代金券","欠款","免单","红包","优惠券","商城订单","线上积分抵扣","门店积分抵扣"]';
  v_codes text[] := array['cash_total','cash','unionpay','alipay','wechat','dianpin','mall','cooperation','koubei','douyin',
    'card_total','card_principal','card_present','card_installment_present','noncash_total','voucher','debt','free_order','red_packet','coupon','mall_order','online_points','offline_points'];
  v_cents bigint[] := array[]::bigint[];
  v_cells jsonb := '[]'; v_groups jsonb := '[]'; v_unknown jsonb := '[]';
  v_gaps jsonb := '[{"code":"source_shop_not_echoed","blocking":true},{"code":"employee_detail_unavailable","blocking":true},{"code":"project_mapping_unavailable","blocking":true},{"code":"financial_review_required","blocking":true}]';
  v_i integer; v_j integer; v_group integer; v_start integer; v_finish integer; v_sum numeric;
  v_missing integer; v_total bigint; v_delta numeric; v_section text; v_value bigint;
begin
  if p_source_scope is null or p_source_scope not in ('projects_daily_summary','all_business_daily_summary') then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_source) is distinct from 'object' or
    not (p_source ?& array['shop_id','business_date','query','content']) or
    (p_source - array['shop_id','business_date','query','content']) <> '{}'::jsonb or
    jsonb_typeof(p_source->'shop_id') is distinct from 'string' or
    p_source->>'shop_id' is distinct from v_shop or
    p_source->>'business_date' is distinct from p_business_date::text then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_ENVELOPE_INVALID';
  end if;
  v_query := p_source->'query'; v_content := p_source->'content';
  v_period := ((extract(epoch from (p_business_date::timestamp at time zone 'UTC'))*1000)::bigint)::text;
  if jsonb_typeof(v_query) is distinct from 'object' or
    not (v_query ?& array['parentShopId','shopId','shopIds','period','incomeType','depcode']) or
    (v_query - array['parentShopId','shopId','shopIds','period','incomeType','depcode']) <> '{}'::jsonb or
    v_query->>'parentShopId' is distinct from '1103470' or
    coalesce(v_query->>'shopId','') not in ('1103470','1009951','1837032') or
    v_query->'shopIds' is distinct from jsonb_build_array(v_shop) or
    v_query->>'period' is distinct from v_period || '_' || v_period or
    v_query->>'depcode' is distinct from '-1' or
    v_query->'incomeType' is distinct from (case when p_source_scope='projects_daily_summary'
      then '["1"]'::jsonb else '["1","2","3","4","5"]'::jsonb end) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH';
  end if;
  if jsonb_typeof(v_content) is distinct from 'object' or
    not (v_content ?& array['head','headTop','data','columns','config']) or
    (v_content - array['head','headTop','data','columns','config']) <> '{}'::jsonb or
    v_content->'head' is distinct from v_headers or
    v_content->'config' is distinct from '{"title":"门店营业日汇总"}'::jsonb then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_typeof(v_content->'headTop') is distinct from 'array' or
    jsonb_array_length(v_content->'headTop') <> 4 or
    jsonb_typeof(v_content->'columns') is distinct from 'array' or
    jsonb_array_length(v_content->'columns') <> 24 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  for v_i in 0..3 loop
    v_top := v_content->'headTop'->v_i;
    if jsonb_typeof(v_top) is distinct from 'object' or
      (v_top - array['text',case when v_i=0 then 'rowspan' else 'colspan' end]) <> '{}'::jsonb or
      v_top->>'text' is distinct from (array['日期','现金类','划卡类','其他非现类'])[v_i+1] or
      v_top->>(case when v_i=0 then 'rowspan' else 'colspan' end) is distinct from (array['2','10','4','9'])[v_i+1] then
      raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_content->'columns') column_value
    where jsonb_typeof(column_value) not in ('null','object')) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_typeof(v_content->'data') is distinct from 'array' then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_array_length(v_content->'data')=0 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_NO_ROWS';
  end if;
  if jsonb_array_length(v_content->'data')<>1 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_MULTIPLE_ROWS';
  end if;
  v_row := v_content->'data'->0;
  if jsonb_typeof(v_row) is distinct from 'array' or jsonb_array_length(v_row)<>24 or
    v_row->>0 is distinct from p_business_date::text then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_DATE_MISMATCH';
  end if;
  for v_i in 1..23 loop
    v_value := zysyr_daily_electronic_private.daily_electronic_cents(v_row->v_i);
    v_cents := array_append(v_cents,v_value);
    v_section := case when v_i <= 10 then 'source_cash' when v_i <= 14 then 'source_card' else 'source_noncash' end;
    v_cells := v_cells || jsonb_build_array(jsonb_build_object(
      'section_code',v_section,'column_code',v_codes[v_i],'label',v_headers->>v_i,
      'value_cents',v_value,'value',v_value::numeric/100,'unit','CNY',
      'status',case when v_value is null then 'unknown' else 'source_reference' end,
      'lineage',jsonb_build_object('json_pointer','/content/data/0/'||v_i::text,'source_header',v_headers->>v_i,
        'source_column_index',v_i,'source_scope',p_source_scope),
      'formal_cell_target',null));
    if v_value is null then v_unknown := v_unknown || to_jsonb(v_codes[v_i]); end if;
  end loop;
  foreach v_section in array array['public_card','public_qr','private_card','private_qr'] loop
    v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','column_code',v_section,
      'value',null,'value_cents',null,'status','not_applicable','blocking',false,
      'lineage',jsonb_build_object('policy','user_excluded_four_account_columns'),'formal_cell_target',null));
  end loop;
  for v_group in 1..3 loop
    v_start := (array[1,11,15])[v_group]; v_finish := (array[10,14,23])[v_group];
    v_total := v_cents[v_start]; v_sum := 0; v_missing := case when v_total is null then 1 else 0 end;
    for v_j in v_start+1..v_finish loop
      if v_cents[v_j] is null then v_missing:=v_missing+1; else v_sum:=v_sum+v_cents[v_j]; end if;
    end loop;
    v_delta := case when v_missing=0 then v_total-v_sum else null end;
    v_groups := v_groups || jsonb_build_array(jsonb_build_object('group',(array['cash','card','noncash'])[v_group],
      'total_cents',v_total,'known_component_sum_cents',v_sum,'unknown_count',v_missing,
      'delta_cents',v_delta,'matched',case when v_missing=0 then v_delta=0 else null end));
    if v_delta is not null and v_delta<>0 then
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object('code','source_group_mismatch',
        'group',(array['cash','card','noncash'])[v_group],'blocking',true,'delta_cents',v_delta));
    end if;
  end loop;
  if jsonb_array_length(v_unknown)>0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object('code','source_fields_unknown','blocking',true,'fields',v_unknown));
  end if;
  if p_source_scope='all_business_daily_summary' then
    v_gaps := v_gaps || '[{"code":"all_business_total_is_not_cash_performance","blocking":true}]'::jsonb;
  end if;
  return jsonb_build_object('status','needs_review','stage','source_only','mapping_version','mgj-summary-source-only-v1',
    'scope_verified',false,'scope_verification','request_only','source_scope',p_source_scope,
    'source_shape_valid',true,'financially_complete',false,'automatic_posting_allowed',false,
    'cash_total_reference_cents',v_cents[1],'cells',v_cells,'controls',v_groups,'gaps',v_gaps);
end
$$;
revoke all on function zysyr_daily_electronic_private.daily_electronic_summary_candidate(uuid,uuid,date,text,jsonb)
  from public,anon,authenticated,service_role;

-- Service-only capability boundary. The private definer is intentionally not
-- user-session based: the signed Edge authenticates the machine, then PostgREST
-- selects service_role. There is no client supplied actor/reviewer identity.
create function zysyr_daily_electronic_private.ingest_daily_electronic_source(
  p_company_id uuid,p_store_id uuid,p_business_date date,p_source_scope text,p_fetched_at timestamptz,p_source jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_shop text; v_candidate_payload jsonb; v_sha text;
  v_snapshot public.zysyr_daily_electronic_snapshots;
  v_candidate public.zysyr_daily_electronic_candidates;
  v_head public.zysyr_daily_electronic_heads;
  v_had_head boolean; v_inserted boolean:=false; v_advanced boolean:=false; v_version integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='DAILY_ELECTRONIC_SERVICE_REQUIRED';
  end if;
  v_shop := zysyr_daily_electronic_private.daily_electronic_shop(p_company_id,p_store_id);
  if p_business_date is null or p_business_date < date '2026-01-01' or p_business_date > date '2026-12-31'
    or p_business_date > (clock_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_DATE_INVALID';
  end if;
  if p_fetched_at is null or not isfinite(p_fetched_at) or p_fetched_at > clock_timestamp()+interval '5 minutes'
    or p_fetched_at < (p_business_date::timestamp at time zone 'Asia/Shanghai') then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_FETCH_TIME_INVALID';
  end if;
  if p_source is null or octet_length(p_source::text)>131072 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_SIZE_INVALID';
  end if;
  v_candidate_payload := zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company_id,p_store_id,p_business_date,p_source_scope,p_source);
  v_sha := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_source::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('daily-electronic:'||p_company_id::text||':'||p_store_id::text||':'||p_business_date::text||':'||p_source_scope,0));
  select * into v_head from public.zysyr_daily_electronic_heads
    where company_id=p_company_id and store_id=p_store_id and business_date=p_business_date and source_scope=p_source_scope for update;
  v_had_head := found;
  select * into v_snapshot from public.zysyr_daily_electronic_snapshots
    where company_id=p_company_id and store_id=p_store_id and business_date=p_business_date and source_scope=p_source_scope and source_sha256=v_sha;
  if v_had_head and p_fetched_at=v_head.latest_fetched_at and v_snapshot.id is distinct from v_head.snapshot_id then
    raise exception using errcode='40001',message='DAILY_ELECTRONIC_SAME_TIME_CONFLICT';
  end if;
  if v_snapshot.id is null then
    if v_had_head and p_fetched_at<v_head.latest_fetched_at then
      raise exception using errcode='40001',message='DAILY_ELECTRONIC_STALE_SOURCE';
    end if;
    select coalesce(max(version),0)+1 into v_version from public.zysyr_daily_electronic_snapshots
      where company_id=p_company_id and store_id=p_store_id and business_date=p_business_date and source_scope=p_source_scope;
    insert into public.zysyr_daily_electronic_snapshots(company_id,store_id,business_date,source_scope,version,source_shop_id,source_sha256,source_payload,fetched_at)
      values(p_company_id,p_store_id,p_business_date,p_source_scope,v_version,v_shop,v_sha,p_source,p_fetched_at) returning * into v_snapshot;
    insert into public.zysyr_daily_electronic_candidates(company_id,store_id,snapshot_id,mapping_version,candidate_payload)
      values(p_company_id,p_store_id,v_snapshot.id,'mgj-summary-source-only-v1',v_candidate_payload) returning * into v_candidate;
    v_inserted:=true;
  else
    select * into v_candidate from public.zysyr_daily_electronic_candidates
      where snapshot_id=v_snapshot.id and mapping_version='mgj-summary-source-only-v1';
    if not found then raise exception using errcode='55000',message='DAILY_ELECTRONIC_CANDIDATE_MISSING'; end if;
  end if;
  if not v_had_head or p_fetched_at>v_head.latest_fetched_at then
    insert into public.zysyr_daily_electronic_heads(company_id,store_id,business_date,source_scope,snapshot_id,candidate_id,latest_fetched_at)
      values(p_company_id,p_store_id,p_business_date,p_source_scope,v_snapshot.id,v_candidate.id,p_fetched_at)
      on conflict(company_id,store_id,business_date,source_scope) do update
        set snapshot_id=excluded.snapshot_id,candidate_id=excluded.candidate_id,latest_fetched_at=excluded.latest_fetched_at,updated_at=now();
    insert into public.zysyr_daily_electronic_ingest_events(company_id,store_id,snapshot_id,candidate_id,action,source_sha256,prior_snapshot_id,prior_fetched_at,fetched_at)
      values(p_company_id,p_store_id,v_snapshot.id,v_candidate.id,case when v_inserted then 'source_created' else 'watermark_advanced' end,
        v_sha,v_head.snapshot_id,v_head.latest_fetched_at,p_fetched_at);
    v_advanced:=true;
  end if;
  select * into v_head from public.zysyr_daily_electronic_heads
    where company_id=p_company_id and store_id=p_store_id and business_date=p_business_date and source_scope=p_source_scope;
  return jsonb_build_object('snapshot_id',v_snapshot.id,'candidate_id',v_candidate.id,'source_sha256',v_sha,
    'version',v_snapshot.version,'status','needs_review','stage','source_only','inserted',v_inserted,
    'latest',v_head.snapshot_id=v_snapshot.id,'watermark_advanced',v_advanced,'fetched_at',v_snapshot.fetched_at,
    'latest_fetched_at',v_head.latest_fetched_at,'source_scope',p_source_scope,'scope_verified',false,'formal_ledger_amount_changed',false);
end
$$;
revoke all on function zysyr_daily_electronic_private.ingest_daily_electronic_source(uuid,uuid,date,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant usage on schema zysyr_daily_electronic_private to service_role;
grant execute on function zysyr_daily_electronic_private.ingest_daily_electronic_source(uuid,uuid,date,text,timestamptz,jsonb) to service_role;

create function public.zysyr_ingest_daily_electronic_source(
  p_company_id uuid,p_store_id uuid,p_business_date date,p_source_scope text,p_fetched_at timestamptz,p_source jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select zysyr_daily_electronic_private.ingest_daily_electronic_source(p_company_id,p_store_id,p_business_date,p_source_scope,p_fetched_at,p_source)
$$;
revoke all on function public.zysyr_ingest_daily_electronic_source(uuid,uuid,date,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_ingest_daily_electronic_source(uuid,uuid,date,text,timestamptz,jsonb) to service_role;

create function zysyr_daily_electronic_private.read_daily_electronic_source(
  p_company_id uuid,p_store_id uuid,p_date_from date,p_date_to date,p_source_scope text,p_candidate_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='DAILY_ELECTRONIC_SERVICE_REQUIRED';
  end if;
  perform zysyr_daily_electronic_private.daily_electronic_shop(p_company_id,p_store_id);
  if p_date_from is null or p_date_to is null or p_date_from<date '2026-01-01' or p_date_to>date '2026-12-31'
    or p_date_to<p_date_from or p_date_to-p_date_from>30 or
    (p_source_scope is not null and p_source_scope not in ('projects_daily_summary','all_business_daily_summary')) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_READ_RANGE_INVALID';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_id',s.id,'candidate_id',c.id,'business_date',s.business_date,
    'source_scope',s.source_scope,'source_sha256',s.source_sha256,'version',s.version,'fetched_at',s.fetched_at,
    'latest_fetched_at',h.latest_fetched_at,'latest',h.snapshot_id=s.id,'status',c.status,'stage',c.stage,
    'mapping_version',c.mapping_version,'scope_verified',false,'scope_verification','request_only',
    'cash_total_reference_cents',c.candidate_payload->'cash_total_reference_cents',
    'controls',c.candidate_payload->'controls','gaps',c.candidate_payload->'gaps') ||
    case when p_candidate_id is not null then jsonb_build_object('source_payload',s.source_payload,'candidate_payload',c.candidate_payload)
      else '{}'::jsonb end order by s.business_date,s.source_scope),'[]'::jsonb) into v_items
  from public.zysyr_daily_electronic_snapshots s
  join public.zysyr_daily_electronic_candidates c on c.snapshot_id=s.id and c.company_id=s.company_id and c.store_id=s.store_id
  join public.zysyr_daily_electronic_heads h on h.company_id=s.company_id and h.store_id=s.store_id and h.business_date=s.business_date and h.source_scope=s.source_scope
  where s.company_id=p_company_id and s.store_id=p_store_id and s.business_date between p_date_from and p_date_to
    and (p_source_scope is null or s.source_scope=p_source_scope)
    and ((p_candidate_id is null and h.candidate_id=c.id) or c.id=p_candidate_id);
  if p_candidate_id is not null and jsonb_array_length(v_items)=0 then
    raise exception using errcode='P0002',message='DAILY_ELECTRONIC_CANDIDATE_NOT_FOUND';
  end if;
  return jsonb_build_object('items',v_items,'stage','source_only','formal_ledger_amount_changed',false);
end
$$;
revoke all on function zysyr_daily_electronic_private.read_daily_electronic_source(uuid,uuid,date,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function zysyr_daily_electronic_private.read_daily_electronic_source(uuid,uuid,date,date,text,uuid) to service_role;
create function public.zysyr_read_daily_electronic_source(
  p_company_id uuid,p_store_id uuid,p_date_from date,p_date_to date,p_source_scope text default null,p_candidate_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
  select zysyr_daily_electronic_private.read_daily_electronic_source(p_company_id,p_store_id,p_date_from,p_date_to,p_source_scope,p_candidate_id)
$$;
revoke all on function public.zysyr_read_daily_electronic_source(uuid,uuid,date,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_read_daily_electronic_source(uuid,uuid,date,date,text,uuid) to service_role;
