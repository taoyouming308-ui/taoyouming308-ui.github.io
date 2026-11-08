-- Additive customer design archive. Original appointment/customer/finance data is never rewritten.
-- All access is through the employee-session Edge API or explicitly privileged ingestion RPCs.
set lock_timeout = '5s';
set statement_timeout = '30s';

create schema if not exists customer_design_private;
revoke all on schema customer_design_private from public, anon, authenticated;
grant usage on schema customer_design_private to service_role;

create table if not exists public.customer_design_assets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  customer_profile_id bigint not null,
  booking_id bigint,
  booking_date date not null,
  visit_key text not null,
  store text not null check (store in ('自由手艺人','向里造型')),
  stage text not null check (stage in ('before','after','reference')),
  angle text not null check (angle in ('front','back','left','right','detail')),
  bucket text not null default 'customer-design-photos' check (bucket = 'customer-design-photos'),
  path text not null unique check (length(path) between 10 and 500 and path !~ '(^/|\.\.|[?#])'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  filename text not null default '',
  caption text not null default '' check (length(caption) <= 500),
  source text not null check (source in ('manual','chatgpt')),
  author text not null check (length(author) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists customer_design_assets_visit_idx
  on public.customer_design_assets(customer_profile_id,visit_key,created_at,id);

create table if not exists public.customer_design_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  customer_profile_id bigint not null,
  booking_id bigint,
  booking_date date not null,
  visit_key text not null,
  store text not null check (store in ('自由手艺人','向里造型')),
  version_no integer not null check (version_no > 0),
  previous_version_id uuid references public.customer_design_versions(id),
  status text not null check (status in ('baseline','optimizing','confirmed','completed','followup')),
  baseline jsonb not null check (jsonb_typeof(baseline) = 'object'),
  optimized jsonb not null check (jsonb_typeof(optimized) = 'object'),
  reasons jsonb not null check (jsonb_typeof(reasons) = 'object'),
  photo_ids uuid[] not null default '{}',
  archive_url text not null default '' check (archive_url = '' or archive_url ~ '^https://chatgpt\.com/space/[A-Za-z0-9_-]+/?$'),
  source text not null check (source in ('manual','chatgpt')),
  author text not null check (length(author) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  unique(customer_profile_id,visit_key,version_no),
  check (cardinality(photo_ids) <= 30)
);
create index if not exists customer_design_versions_customer_idx
  on public.customer_design_versions(customer_profile_id,created_at desc,id desc);
create index if not exists customer_design_versions_visit_idx
  on public.customer_design_versions(customer_profile_id,visit_key,version_no desc);

create table if not exists public.customer_design_ingest_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  customer_profile_id bigint not null,
  booking_id bigint,
  booking_date date not null,
  visit_key text not null,
  store text not null check (store in ('自由手艺人','向里造型')),
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

alter table public.customer_design_assets enable row level security;
alter table public.customer_design_versions enable row level security;
alter table public.customer_design_ingest_grants enable row level security;
revoke all on public.customer_design_assets,public.customer_design_versions,public.customer_design_ingest_grants from public,anon,authenticated;
grant select,insert on public.customer_design_assets,public.customer_design_versions to service_role;
grant select,insert on public.customer_design_ingest_grants to service_role;
grant update(revoked_at) on public.customer_design_ingest_grants to service_role;

create or replace function customer_design_private.immutable_record()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'CUSTOMER_DESIGN_IMMUTABLE' using errcode='55000';
end;
$$;
revoke all on function customer_design_private.immutable_record() from public,anon,authenticated;
drop trigger if exists customer_design_versions_immutable on public.customer_design_versions;
create trigger customer_design_versions_immutable before update or delete on public.customer_design_versions
  for each row execute function customer_design_private.immutable_record();
drop trigger if exists customer_design_assets_immutable on public.customer_design_assets;
create trigger customer_design_assets_immutable before update or delete on public.customer_design_assets
  for each row execute function customer_design_private.immutable_record();

-- Context is resolved against original records; names/phones/shops are never accepted as overrides.
create or replace function public.customer_design_resolve_context(
  p_customer_profile_id bigint,
  p_booking_id bigint default null,
  p_booking_date date default null,
  p_visit_key text default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p record; b record; d date; k text; phone_a text; phone_b text;
begin
  select id,name,phone,shop_name into p from public.customer_profiles where id=p_customer_profile_id;
  if not found or p.shop_name not in ('自由手艺人','向里造型') then
    raise exception 'CUSTOMER_DESIGN_CUSTOMER_NOT_FOUND' using errcode='P0002';
  end if;
  if p_booking_id is not null then
    select id,customer_name,customer_phone,shop_name,date into b from public.bookings where id=p_booking_id;
    if not found then raise exception 'CUSTOMER_DESIGN_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
    phone_a:=regexp_replace(coalesce(p.phone,''),'\D','','g');
    phone_b:=regexp_replace(coalesce(b.customer_phone,''),'\D','','g');
    if length(phone_a)=13 and left(phone_a,2)='86' then phone_a:=substr(phone_a,3); end if;
    if length(phone_b)=13 and left(phone_b,2)='86' then phone_b:=substr(phone_b,3); end if;
    if length(phone_a)<>11 or phone_a<>phone_b
      or lower(regexp_replace(coalesce(p.name,''),'\s','','g'))<>lower(regexp_replace(coalesce(b.customer_name,''),'\s','','g'))
      or p.shop_name<>b.shop_name then
      raise exception 'CUSTOMER_DESIGN_IDENTITY_MISMATCH' using errcode='42501';
    end if;
    d:=b.date::date; k:='booking:'||p_booking_id::text;
    if (p_booking_date is not null and p_booking_date<>d) or (nullif(p_visit_key,'') is not null and p_visit_key<>k) then
      raise exception 'CUSTOMER_DESIGN_VISIT_MISMATCH' using errcode='42501';
    end if;
  else
    d:=p_booking_date;
    if d is null then raise exception 'CUSTOMER_DESIGN_DATE_REQUIRED' using errcode='22023'; end if;
    k:=coalesce(nullif(p_visit_key,''),'manual:'||d::text);
    if k<>('manual:'||d::text) and k !~ ('^manual:'||d::text||':[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
      raise exception 'CUSTOMER_DESIGN_VISIT_MISMATCH' using errcode='42501';
    end if;
  end if;
  return jsonb_build_object('customer_profile_id',p.id,'booking_id',p_booking_id,'booking_date',d,'visit_key',k,'store',p.shop_name,'name',p.name,'phone',p.phone);
end;
$$;
revoke all on function public.customer_design_resolve_context(bigint,bigint,date,text) from public,anon,authenticated;
grant execute on function public.customer_design_resolve_context(bigint,bigint,date,text) to service_role;

create or replace function customer_design_private.model_document(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb:='{}'; steps jsonb:='{}'; k text; v jsonb; s text;
begin
  if p_value is null then p_value:='{}'; end if;
  if jsonb_typeof(p_value)<>'object' or (p_value ? 'steps' and jsonb_typeof(p_value->'steps')<>'object') then
    raise exception 'CUSTOMER_DESIGN_MODEL_INVALID' using errcode='22023';
  end if;
  foreach k in array array['outline','root_flow'] loop
    v:=p_value->k;
    if v is not null and jsonb_typeof(v) not in ('string','null') then raise exception 'CUSTOMER_DESIGN_TEXT_INVALID' using errcode='22023'; end if;
    s:=btrim(coalesce(p_value->>k,''));
    if length(s)>4000 then raise exception 'CUSTOMER_DESIGN_TEXT_TOO_LONG' using errcode='22023'; end if;
    result:=result||jsonb_build_object(k,s);
  end loop;
  foreach k in array array['style','person','length','features','layers','bangs','curls','care'] loop
    v:=p_value->'steps'->k;
    if v is not null and jsonb_typeof(v) not in ('string','null') then raise exception 'CUSTOMER_DESIGN_TEXT_INVALID' using errcode='22023'; end if;
    s:=btrim(coalesce(p_value->'steps'->>k,''));
    if length(s)>4000 then raise exception 'CUSTOMER_DESIGN_TEXT_TOO_LONG' using errcode='22023'; end if;
    steps:=steps||jsonb_build_object(k,s);
  end loop;
  return result||jsonb_build_object('steps',steps);
end;
$$;
revoke all on function customer_design_private.model_document(jsonb) from public,anon,authenticated;
grant execute on function customer_design_private.model_document(jsonb) to service_role;

create or replace function public.register_customer_design_ingest_grant(
  p_token_hash text,
  p_customer_profile_id bigint,
  p_booking_id bigint default null,
  p_booking_date date default null,
  p_created_by text default 'ChatGPT',
  p_expires_minutes integer default 15,
  p_visit_key text default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c jsonb; g public.customer_design_ingest_grants; stamp timestamptz:=clock_timestamp();
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_minutes not between 1 and 15 or length(coalesce(p_created_by,'')) not between 1 and 120 then
    raise exception 'CUSTOMER_DESIGN_GRANT_INVALID' using errcode='22023';
  end if;
  c:=public.customer_design_resolve_context(p_customer_profile_id,p_booking_id,p_booking_date,p_visit_key);
  insert into public.customer_design_ingest_grants(token_hash,customer_profile_id,booking_id,booking_date,visit_key,store,created_by,created_at,expires_at)
    values(p_token_hash,p_customer_profile_id,p_booking_id,(c->>'booking_date')::date,c->>'visit_key',c->>'store',p_created_by,stamp,stamp+make_interval(mins=>p_expires_minutes)) returning * into g;
  return to_jsonb(g)-'token_hash';
end;
$$;
revoke all on function public.register_customer_design_ingest_grant(text,bigint,bigint,date,text,integer,text) from public,anon,authenticated;
grant execute on function public.register_customer_design_ingest_grant(text,bigint,bigint,date,text,integer,text) to service_role;

create or replace function public.validate_customer_design_ingest_grant(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare g public.customer_design_ingest_grants; c jsonb;
begin
  select * into g from public.customer_design_ingest_grants where token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'CUSTOMER_DESIGN_INGEST_FORBIDDEN' using errcode='42501'; end if;
  c:=public.customer_design_resolve_context(g.customer_profile_id,g.booking_id,g.booking_date,g.visit_key);
  if c->>'store'<>g.store then raise exception 'CUSTOMER_DESIGN_INGEST_FORBIDDEN' using errcode='42501'; end if;
  return (to_jsonb(g)-'token_hash')||jsonb_build_object('source','chatgpt','author','ChatGPT');
end;
$$;
revoke all on function public.validate_customer_design_ingest_grant(text) from public,anon,authenticated;
grant execute on function public.validate_customer_design_ingest_grant(text) to service_role;

create or replace function public.register_customer_design_asset(p_payload jsonb,p_actor text,p_source text default 'manual')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c jsonb; req uuid; a public.customer_design_assets; old public.customer_design_assets; h text; canonical jsonb; author_name text;
begin
  if p_source not in ('manual','chatgpt') then raise exception 'CUSTOMER_DESIGN_SOURCE_INVALID' using errcode='22023'; end if;
  author_name:=case when p_source='chatgpt' then 'ChatGPT' else p_actor end;
  if length(coalesce(author_name,'')) not between 1 and 120 then raise exception 'CUSTOMER_DESIGN_AUTHOR_REQUIRED' using errcode='22023'; end if;
  req:=(p_payload->>'request_id')::uuid;
  if req is null then raise exception 'CUSTOMER_DESIGN_REQUEST_REQUIRED' using errcode='22023'; end if;
  c:=public.customer_design_resolve_context((p_payload->>'customer_profile_id')::bigint,nullif(p_payload->>'booking_id','')::bigint,nullif(p_payload->>'booking_date','')::date,p_payload->>'visit_key');
  canonical:=c||jsonb_build_object('stage',p_payload->>'stage','angle',p_payload->>'angle','mime_type',p_payload->>'mime_type','byte_size',(p_payload->>'byte_size')::integer,'sha256',p_payload->>'sha256','filename',coalesce(p_payload->>'filename',''),'caption',coalesce(p_payload->>'caption',''),'source',p_source,'author',author_name);
  h:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));
  select * into old from public.customer_design_assets where request_id=req;
  if found then
    if old.request_hash<>h then raise exception 'CUSTOMER_DESIGN_REQUEST_REUSED' using errcode='22023'; end if;
    return jsonb_build_object('asset',to_jsonb(old)-'request_hash','already_applied',true);
  end if;
  if p_payload->>'bucket'<>'customer-design-photos' or coalesce(p_payload->>'path','') not like ((c->>'customer_profile_id')||'/%') then
    raise exception 'CUSTOMER_DESIGN_ASSET_PATH_INVALID' using errcode='22023';
  end if;
  insert into public.customer_design_assets(id,request_id,request_hash,customer_profile_id,booking_id,booking_date,visit_key,store,stage,angle,bucket,path,mime_type,byte_size,sha256,filename,caption,source,author)
  values(coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid()),req,h,(c->>'customer_profile_id')::bigint,(c->>'booking_id')::bigint,(c->>'booking_date')::date,c->>'visit_key',c->>'store',p_payload->>'stage',p_payload->>'angle',p_payload->>'bucket',p_payload->>'path',p_payload->>'mime_type',(p_payload->>'byte_size')::integer,p_payload->>'sha256',coalesce(p_payload->>'filename',''),coalesce(p_payload->>'caption',''),p_source,author_name) returning * into a;
  return jsonb_build_object('asset',to_jsonb(a)-'request_hash','already_applied',false);
end;
$$;
revoke all on function public.register_customer_design_asset(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.register_customer_design_asset(jsonb,text,text) to service_role;

create or replace function public.append_customer_design_version(p_payload jsonb,p_actor text,p_source text default 'manual')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c jsonb; req uuid; b jsonb; o jsonb; r jsonb:='{}'; canonical jsonb; h text; k text; reason text; before_text text; after_text text;
  latest public.customer_design_versions; old public.customer_design_versions; v public.customer_design_versions;
  expected uuid; ids uuid[]; photos jsonb; author_name text; url text; stage text; asset_count integer;
begin
  if p_source not in ('manual','chatgpt') then raise exception 'CUSTOMER_DESIGN_SOURCE_INVALID' using errcode='22023'; end if;
  author_name:=case when p_source='chatgpt' then 'ChatGPT' else p_actor end;
  if length(coalesce(author_name,'')) not between 1 and 120 then raise exception 'CUSTOMER_DESIGN_AUTHOR_REQUIRED' using errcode='22023'; end if;
  req:=(p_payload->>'request_id')::uuid;
  if req is null then raise exception 'CUSTOMER_DESIGN_REQUEST_REQUIRED' using errcode='22023'; end if;
  c:=public.customer_design_resolve_context((p_payload->>'customer_profile_id')::bigint,nullif(p_payload->>'booking_id','')::bigint,nullif(p_payload->>'booking_date','')::date,p_payload->>'visit_key');
  b:=customer_design_private.model_document(p_payload->'baseline');
  o:=customer_design_private.model_document(p_payload->'optimized');
  if p_payload ? 'reasons' and jsonb_typeof(p_payload->'reasons')<>'object' then raise exception 'CUSTOMER_DESIGN_REASONS_INVALID' using errcode='22023'; end if;
  foreach k in array array['outline','root_flow','style','person','length','features','layers','bangs','curls','care'] loop
    if p_payload->'reasons'->k is not null and jsonb_typeof(p_payload->'reasons'->k) not in ('string','null') then raise exception 'CUSTOMER_DESIGN_REASON_INVALID' using errcode='22023'; end if;
    reason:=btrim(coalesce(p_payload->'reasons'->>k,''));
    if length(reason)>4000 then raise exception 'CUSTOMER_DESIGN_TEXT_TOO_LONG' using errcode='22023'; end if;
    before_text:=case when k in ('outline','root_flow') then b->>k else b->'steps'->>k end;
    after_text:=case when k in ('outline','root_flow') then o->>k else o->'steps'->>k end;
    if btrim(after_text)<>'' and after_text is distinct from before_text and btrim(reason)='' then raise exception 'CUSTOMER_DESIGN_REASON_REQUIRED:%',k using errcode='22023'; end if;
    r:=r||jsonb_build_object(k,reason);
  end loop;
  if jsonb_typeof(coalesce(p_payload->'photo_ids','[]'))<>'array' then raise exception 'CUSTOMER_DESIGN_PHOTOS_INVALID' using errcode='22023'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(coalesce(p_payload->'photo_ids','[]'));
  if cardinality(ids)>30 or cardinality(ids)<>(select count(distinct i) from unnest(ids) i) then raise exception 'CUSTOMER_DESIGN_PHOTOS_INVALID' using errcode='22023'; end if;
  expected:=nullif(p_payload->>'expected_latest_version_id','')::uuid;
  stage:=coalesce(nullif(p_payload->>'status',''),'baseline'); url:=coalesce(p_payload->>'archive_url','');
  canonical:=c||jsonb_build_object('baseline',b,'optimized',o,'reasons',r,'status',stage,'photo_ids',to_jsonb(ids),'archive_url',url,'expected_latest_version_id',expected,'source',p_source,'author',author_name);
  h:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('design-request:'||req::text,0));
  select * into old from public.customer_design_versions where request_id=req;
  if found then
    if old.request_hash<>h then raise exception 'CUSTOMER_DESIGN_REQUEST_REUSED' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(a)-'request_hash' order by array_position(old.photo_ids,a.id)),'[]'::jsonb) into photos from public.customer_design_assets a where a.id=any(old.photo_ids);
    return jsonb_build_object('saved',true,'version',(to_jsonb(old)-'request_hash')||jsonb_build_object('photos',photos),'latest_version_id',old.id,'already_applied',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('design-visit:'||(c->>'customer_profile_id')||':'||(c->>'visit_key'),0));
  select * into latest from public.customer_design_versions where customer_profile_id=(c->>'customer_profile_id')::bigint and visit_key=c->>'visit_key' order by version_no desc limit 1;
  if expected is distinct from latest.id then raise exception 'CUSTOMER_DESIGN_VERSION_CONFLICT' using errcode='40001'; end if;
  select count(*),coalesce(jsonb_agg(to_jsonb(a)-'request_hash' order by array_position(ids,a.id)),'[]'::jsonb) into asset_count,photos from public.customer_design_assets a
    where a.id=any(ids) and a.customer_profile_id=(c->>'customer_profile_id')::bigint and a.store=c->>'store' and a.visit_key=c->>'visit_key' and a.booking_id is not distinct from (c->>'booking_id')::bigint and a.booking_date=(c->>'booking_date')::date;
  if asset_count<>cardinality(ids) then raise exception 'CUSTOMER_DESIGN_PHOTO_SCOPE_FORBIDDEN' using errcode='42501'; end if;
  insert into public.customer_design_versions(request_id,request_hash,customer_profile_id,booking_id,booking_date,visit_key,store,version_no,previous_version_id,status,baseline,optimized,reasons,photo_ids,archive_url,source,author)
  values(req,h,(c->>'customer_profile_id')::bigint,(c->>'booking_id')::bigint,(c->>'booking_date')::date,c->>'visit_key',c->>'store',coalesce(latest.version_no,0)+1,latest.id,stage,b,o,r,ids,url,p_source,author_name) returning * into v;
  return jsonb_build_object('saved',true,'version',(to_jsonb(v)-'request_hash')||jsonb_build_object('photos',photos),'latest_version_id',v.id,'already_applied',false);
end;
$$;
revoke all on function public.append_customer_design_version(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.append_customer_design_version(jsonb,text,text) to service_role;

-- Private originals; immutable random object names are generated by the authenticated Edge API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('customer-design-photos','customer-design-photos',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

comment on table public.customer_design_versions is 'Append-only complete service design snapshots, eight-step comparisons, reasons, status and immutable photo references. Never stores ambient conversation.';
comment on table public.customer_design_assets is 'Original private photo bytes in Storage; immutable scoped metadata and SHA-256. No canvas recompression.';
