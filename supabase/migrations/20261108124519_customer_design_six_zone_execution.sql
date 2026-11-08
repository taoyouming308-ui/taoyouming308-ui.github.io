-- Additive six-zone execution, ten-process notes and completion review snapshots.
-- No historical row is updated; original request hashes, photos and ACLs remain intact.
set lock_timeout='5s';
set statement_timeout='30s';

alter table public.customer_design_versions
  add column if not exists execution jsonb not null default '{}'::jsonb check(jsonb_typeof(execution)='object'),
  add column if not exists process jsonb not null default '{}'::jsonb check(jsonb_typeof(process)='object'),
  add column if not exists review jsonb not null default '{}'::jsonb check(jsonb_typeof(review)='object');

-- SQL and Edge normalize the same known-key-only document. Missing fields are blank;
-- explicit nulls, arrays, non-text fields, unknown keys and excessive text are rejected.
create or replace function customer_design_private.optional_text_document(p_value jsonb,p_keys text[],p_keep_blank boolean default false)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare k text; v text; result jsonb:='{}'::jsonb; meaningful boolean:=false;
begin
  if p_value is not null and jsonb_typeof(p_value)<>'object' then
    raise exception 'CUSTOMER_DESIGN_EXTENSION_OBJECT_REQUIRED' using errcode='22023';
  end if;
  if octet_length(coalesce(p_value,'{}'::jsonb)::text)>1048576 then
    raise exception 'CUSTOMER_DESIGN_EXTENSION_TOO_LARGE' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(coalesce(p_value,'{}'::jsonb)) as x(key) where not (x.key=any(p_keys))) then
    raise exception 'CUSTOMER_DESIGN_EXTENSION_UNKNOWN_KEY' using errcode='22023';
  end if;
  foreach k in array p_keys loop
    if p_value ? k and jsonb_typeof(p_value->k)<>'string' then
      raise exception 'CUSTOMER_DESIGN_EXTENSION_TEXT_REQUIRED' using errcode='22023';
    end if;
    if length(coalesce(p_value->>k,''))>4000 then
      raise exception 'CUSTOMER_DESIGN_EXTENSION_TEXT_TOO_LONG' using errcode='22023';
    end if;
    v:=btrim(coalesce(p_value->>k,''));
    meaningful:=meaningful or v<>'';
    result:=result||jsonb_build_object(k,v);
  end loop;
  return case when meaningful or p_keep_blank then result else '{}'::jsonb end;
end;
$$;
revoke all on function customer_design_private.optional_text_document(jsonb,text[],boolean) from public,anon,authenticated;
grant execute on function customer_design_private.optional_text_document(jsonb,text[],boolean) to service_role;

create or replace function customer_design_private.execution_document(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare k text; part jsonb; result jsonb:='{}'::jsonb; meaningful boolean:=false;
  zones constant text[]:=array['bangs','top','ear_front','ear_back','middle','bottom'];
begin
  if p_value is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p_value)<>'object' then raise exception 'CUSTOMER_DESIGN_EXECUTION_OBJECT_REQUIRED' using errcode='22023'; end if;
  if octet_length(p_value::text)>1048576 then raise exception 'CUSTOMER_DESIGN_EXTENSION_TOO_LARGE' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_value) as x(key) where not (x.key=any(zones))) then
    raise exception 'CUSTOMER_DESIGN_EXECUTION_UNKNOWN_ZONE' using errcode='22023';
  end if;
  foreach k in array zones loop
    part:=customer_design_private.optional_text_document(p_value->k,array['issue','target','actions','check'],true);
    if exists(select 1 from jsonb_each_text(part) as x(key,value) where x.value<>'') then meaningful:=true; end if;
    result:=result||jsonb_build_object(k,part);
  end loop;
  return case when meaningful then result else '{}'::jsonb end;
end;
$$;
revoke all on function customer_design_private.execution_document(jsonb) from public,anon,authenticated;
grant execute on function customer_design_private.execution_document(jsonb) to service_role;

create or replace function public.append_customer_design_version(p_payload jsonb,p_actor text,p_source text default 'manual')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c jsonb; req uuid; b jsonb; o jsonb; r jsonb:='{}'; e jsonb; p jsonb; review_doc jsonb; canonical jsonb; h text; k text; reason text; before_text text; after_text text;
  latest public.customer_design_versions; old public.customer_design_versions; v public.customer_design_versions;
  expected uuid; ids uuid[]; photos jsonb; author_name text; url text; stage text; asset_count integer;
begin
  if p_source not in ('manual','chatgpt') then raise exception 'CUSTOMER_DESIGN_SOURCE_INVALID' using errcode='22023'; end if;
  author_name:=case when p_source='chatgpt' then 'ChatGPT' else p_actor end;
  if length(coalesce(author_name,'')) not between 1 and 120 then raise exception 'CUSTOMER_DESIGN_AUTHOR_REQUIRED' using errcode='22023'; end if;
  req:=(p_payload->>'request_id')::uuid;
  if req is null then raise exception 'CUSTOMER_DESIGN_REQUEST_REQUIRED' using errcode='22023'; end if;
  c:=public.customer_design_resolve_context((p_payload->>'customer_profile_id')::bigint,nullif(p_payload->>'booking_id','')::bigint,nullif(p_payload->>'booking_date','')::date,p_payload->>'visit_key');
  e:=customer_design_private.execution_document(p_payload->'execution');
  p:=customer_design_private.optional_text_document(p_payload->'process',array['care_texture','styling','style_feel','application','winding','rod_direction','curl_control','thinning_space','proposal','technique_layers']);
  review_doc:=customer_design_private.optional_text_document(p_payload->'review',array['achieved','pending','next']);
  if octet_length((e||p||review_doc)::text)>1048576 then raise exception 'CUSTOMER_DESIGN_EXTENSION_TOO_LARGE' using errcode='22023'; end if;
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
  -- Empty extensions preserve the exact pre-extension request hash.
  if e<>'{}'::jsonb then canonical:=canonical||jsonb_build_object('execution',e); end if;
  if p<>'{}'::jsonb then canonical:=canonical||jsonb_build_object('process',p); end if;
  if review_doc<>'{}'::jsonb then canonical:=canonical||jsonb_build_object('review',review_doc); end if;
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
  -- Old clients do not know these fields. Never silently erase a newer plan.
  -- Same request replay above remains valid; explicit {} is a deliberate clear.
  if (latest.execution<>'{}'::jsonb and not (p_payload ? 'execution'))
    or (latest.process<>'{}'::jsonb and not (p_payload ? 'process'))
    or (latest.review<>'{}'::jsonb and not (p_payload ? 'review')) then
    raise exception 'CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED' using errcode='22023';
  end if;
  select count(*),coalesce(jsonb_agg(to_jsonb(a)-'request_hash' order by array_position(ids,a.id)),'[]'::jsonb) into asset_count,photos from public.customer_design_assets a
    where a.id=any(ids) and a.customer_profile_id=(c->>'customer_profile_id')::bigint and a.store=c->>'store' and a.visit_key=c->>'visit_key' and a.booking_id is not distinct from (c->>'booking_id')::bigint and a.booking_date=(c->>'booking_date')::date;
  if asset_count<>cardinality(ids) then raise exception 'CUSTOMER_DESIGN_PHOTO_SCOPE_FORBIDDEN' using errcode='42501'; end if;
  insert into public.customer_design_versions(request_id,request_hash,customer_profile_id,booking_id,booking_date,visit_key,store,version_no,previous_version_id,status,baseline,optimized,reasons,execution,process,review,photo_ids,archive_url,source,author)
  values(req,h,(c->>'customer_profile_id')::bigint,(c->>'booking_id')::bigint,(c->>'booking_date')::date,c->>'visit_key',c->>'store',coalesce(latest.version_no,0)+1,latest.id,stage,b,o,r,e,p,review_doc,ids,url,p_source,author_name) returning * into v;
  return jsonb_build_object('saved',true,'version',(to_jsonb(v)-'request_hash')||jsonb_build_object('photos',photos),'latest_version_id',v.id,'already_applied',false);
end;
$$;
revoke all on function public.append_customer_design_version(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.append_customer_design_version(jsonb,text,text) to service_role;


comment on table public.customer_design_versions is 'Append-only eight-step design, six-zone execution, ten-process notes and completion review snapshots with private originals. Never stores ambient conversation.';
