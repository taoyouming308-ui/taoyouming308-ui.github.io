-- ISOLATED SYNTHETIC PG17 ONLY. No production installation, grants or migration.
-- Existing immutable rows/hashes are never rewritten. This is text/native only.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17
 OR to_regclass('design_identity.transaction_contexts') IS NULL OR to_regclass('design_private.workflow_versions') IS NULL OR to_regclass('design_private.model_candidates') IS NULL OR to_regnamespace('design_workflow_authority') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_WORKFLOW_AUTHORITY_REQUIRED';END IF;
END$$;
CREATE ROLE design_workflow_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_workflow_manifest_issuer_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_workflow_manifest_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_workflow_manifest_issuer;
CREATE SCHEMA design_workflow_authority AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_workflow_authority FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_workflow_authority TO design_identity_runtime,design_workflow_capability,design_workflow_manifest_issuer_capability,design_workflow_manifest_issuer;
GRANT CREATE ON SCHEMA design_workflow_authority TO design_workflow_capability,design_workflow_manifest_issuer_capability;
GRANT USAGE ON SCHEMA design_identity,design_private,public TO design_workflow_capability,design_workflow_manifest_issuer_capability;
GRANT EXECUTE ON FUNCTION design_identity.require_authority() TO design_workflow_capability;
GRANT EXECUTE ON FUNCTION design_identity.resolve_hash(text,jsonb) TO design_workflow_manifest_issuer_capability;
CREATE TABLE design_workflow_authority.operation_authors(scope_key text NOT NULL,revision integer NOT NULL,receipt_key text,authority jsonb NOT NULL,record_sha256 text NOT NULL,previous_sha256 text,manifest_id text,PRIMARY KEY(scope_key,revision),UNIQUE(receipt_key),FOREIGN KEY(scope_key,revision) REFERENCES design_private.workflow_versions(scope_key,revision));
CREATE TABLE design_workflow_authority.manifests(id text PRIMARY KEY,revision bigint NOT NULL CHECK(revision>0),reader jsonb NOT NULL,baseline jsonb NOT NULL,proof jsonb NOT NULL,expires_at timestamptz NOT NULL,active boolean NOT NULL);
CREATE TABLE design_workflow_authority.issuer_requests(request_id text PRIMARY KEY,request jsonb NOT NULL,manifest_id text NOT NULL REFERENCES design_workflow_authority.manifests(id));
ALTER TABLE design_workflow_authority.operation_authors OWNER TO design_identity_owner;
ALTER TABLE design_workflow_authority.operation_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_workflow_authority.operation_authors FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_workflow_authority.operation_authors FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_workflow_authority.operation_authors FOR SELECT TO design_workflow_manifest_issuer_capability USING(true);
ALTER TABLE design_workflow_authority.manifests OWNER TO design_identity_owner;
ALTER TABLE design_workflow_authority.manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_workflow_authority.manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_workflow_authority.manifests FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_workflow_authority.manifests FOR SELECT TO design_workflow_manifest_issuer_capability USING(true);
ALTER TABLE design_workflow_authority.issuer_requests OWNER TO design_identity_owner;
ALTER TABLE design_workflow_authority.issuer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_workflow_authority.issuer_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_workflow_authority.issuer_requests FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_workflow_authority.issuer_requests FOR SELECT TO design_workflow_manifest_issuer_capability USING(true);
GRANT SELECT ON ALL TABLES IN SCHEMA design_workflow_authority TO design_workflow_capability,design_workflow_manifest_issuer_capability;
GRANT INSERT ON design_workflow_authority.operation_authors TO design_workflow_capability;
CREATE POLICY workflow_cap_insert ON design_workflow_authority.operation_authors FOR INSERT TO design_workflow_capability WITH CHECK(true);
GRANT INSERT,UPDATE(active,revision,proof) ON design_workflow_authority.manifests TO design_workflow_manifest_issuer_capability;
CREATE POLICY workflow_issuer_insert ON design_workflow_authority.manifests FOR INSERT TO design_workflow_manifest_issuer_capability WITH CHECK(true);
CREATE POLICY workflow_issuer_update ON design_workflow_authority.manifests FOR UPDATE TO design_workflow_manifest_issuer_capability USING(true) WITH CHECK(true);
GRANT INSERT ON design_workflow_authority.issuer_requests TO design_workflow_manifest_issuer_capability;
CREATE POLICY workflow_issuer_insert ON design_workflow_authority.issuer_requests FOR INSERT TO design_workflow_manifest_issuer_capability WITH CHECK(true);
-- FOR SHARE's minimal column UPDATE privileges are held only by NOLOGIN code owner.
GRANT SELECT,UPDATE(revision) ON design_private.workflow_versions TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.workflow_versions FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.workflow_versions FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(request_key) ON design_private.workflow_receipts TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.workflow_receipts FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.workflow_receipts FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(version) ON design_private.full_versions TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.full_versions FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.full_versions FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(request_key) ON design_private.full_receipts TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.full_receipts FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.full_receipts FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(media_id) ON design_private.media_records TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.media_records FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.media_records FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(candidate_id) ON design_private.model_candidates TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_private.model_candidates FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_private.model_candidates FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(id) ON public.customer_design_versions TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON public.customer_design_versions FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON public.customer_design_versions FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(id) ON public.customer_design_assets TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON public.customer_design_assets FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON public.customer_design_assets FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(visit_id) ON design_identity.visit_bindings TO design_workflow_capability;
CREATE POLICY workflow_authority_read ON design_identity.visit_bindings FOR SELECT TO design_workflow_capability USING(true);
CREATE POLICY workflow_authority_lock ON design_identity.visit_bindings FOR UPDATE TO design_workflow_capability USING(true) WITH CHECK(false);
GRANT INSERT ON design_private.workflow_versions,design_private.workflow_receipts TO design_workflow_capability;
CREATE POLICY workflow_authority_append ON design_private.workflow_versions FOR INSERT TO design_workflow_capability WITH CHECK(true);
CREATE POLICY workflow_authority_append ON design_private.workflow_receipts FOR INSERT TO design_workflow_capability WITH CHECK(true);
CREATE FUNCTION design_workflow_authority.canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE k text;x jsonb;r text;n numeric;BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN
  r:='';FOR k,x IN SELECT key,value FROM jsonb_each(v) ORDER BY key COLLATE "C" LOOP
   IF k !~ '^[ -~]*$' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;
   r:=r||CASE WHEN r='' THEN '' ELSE ',' END||to_jsonb(k)::text||':'||design_workflow_authority.canonical(x);
  END LOOP;RETURN '{'||r||'}';
 WHEN 'array' THEN
  r:='';FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP r:=r||CASE WHEN r='' THEN '' ELSE ',' END||design_workflow_authority.canonical(x);END LOOP;RETURN '['||r||']';
 WHEN 'number' THEN n:=(v::text)::numeric;IF abs(n)>9007199254740991 OR (n<>0 AND abs(n)<0.000001) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;RETURN trim_scale(n)::text;
 WHEN 'string' THEN RETURN to_jsonb(v#>>'{}')::text;
 WHEN 'boolean' THEN RETURN v::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END CASE;
END$$;
CREATE FUNCTION design_workflow_authority.digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT encode(sha256(convert_to(design_workflow_authority.canonical(v),'UTF8')),'hex') $$;
CREATE FUNCTION design_workflow_authority.prefix(a jsonb,b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT jsonb_typeof(a)='array' AND jsonb_typeof(b)='array' AND jsonb_array_length(a)<=jsonb_array_length(b) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) WITH ORDINALITY x(v,n) WHERE x.v IS DISTINCT FROM b->(x.n::integer-1)) $$;
CREATE FUNCTION design_workflow_authority.text_only(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT NOT jsonb_path_exists(v,'$.**.modelCandidates') AND NOT jsonb_path_exists(v,'$.** ? (@.kind == "private_media")') $$;
-- Private raw source loading is usable only from the fixed capability and issuer.
CREATE FUNCTION design_workflow_authority.sources(a jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE sc jsonb:=a->'scope';sk text;vk text;bd date;w jsonb;wr jsonb;f jsonb;fr jsonb;l jsonb;lp jsonb;rawv jsonb;rawp jsonb;authors jsonb;res jsonb;n bigint;sz bigint;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));sk:=design_workflow_authority.digest(sc);
 IF EXISTS(SELECT 1 FROM design_private.media_records WHERE record->'binding'->'scope'=sc) OR EXISTS(SELECT 1 FROM design_private.model_candidates WHERE scope_key=sk OR envelope->'scope'=sc) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_ARTIFACT_DENIED';END IF;
 SELECT business_date INTO STRICT bd FROM design_identity.visit_bindings WHERE assignment_source=sc->>'assignmentSource' AND visit_id=sc->>'visitId' AND customer_profile_id=(sc->>'customerProfileId')::bigint FOR SHARE;
 vk:=CASE WHEN sc->>'assignmentSource'='appointment' THEN sc->>'visitId' ELSE 'manual:'||to_char(bd,'YYYY-MM-DD')||':'||substr(sc->>'visitId',11) END;
 SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,sz FROM design_private.workflow_versions WHERE scope_key=sk;
 IF n>1001 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY revision),'[]') INTO w FROM (SELECT revision,record,sha256,previous_sha256,receipt_key FROM design_private.workflow_versions WHERE scope_key=sk ORDER BY revision FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(receipt::text)),0) INTO n,sz FROM design_private.workflow_receipts WHERE receipt->'scope'=sc OR request_key IN (SELECT value->>'receipt_key' FROM jsonb_array_elements(w));
 IF n>1000 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY request_key),'[]') INTO wr FROM (SELECT request_key,receipt,record_sha256 FROM design_private.workflow_receipts WHERE receipt->'scope'=sc OR request_key IN (SELECT value->>'receipt_key' FROM jsonb_array_elements(w)) ORDER BY request_key FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(to_jsonb(v)::text)),0) INTO n,sz FROM public.customer_design_versions v WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk;
 IF n>1000 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version_no),'[]') INTO rawv FROM (SELECT * FROM public.customer_design_versions WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk ORDER BY version_no FOR SHARE) t;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rawv) v WHERE v->>'archive_url' IS DISTINCT FROM '' OR v->>'store' IS DISTINCT FROM a->'actor'->>'store') THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_LEGACY_DENIED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v->'id','requestId',v->'request_id','versionNumber',v->'version_no','previousVersionId',v->'previous_version_id','createdAt',v->'created_at','actor',jsonb_build_object('username',v->'author','store',v->'store'),'scope',sc,'snapshot',jsonb_build_object('baseline',v->'baseline','optimized',v->'optimized','reasons',v->'reasons','execution',v->'execution','process',v->'process','review',v->'review','status',v->'status','photo_ids',v->'photo_ids','archive_url',null)) ORDER BY (v->>'version_no')::int),'[]') INTO l FROM jsonb_array_elements(rawv) v;
 SELECT count(*),coalesce(sum(octet_length(to_jsonb(v)::text)),0) INTO n,sz FROM public.customer_design_assets v WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk;
 IF n>1000 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') INTO rawp FROM (SELECT * FROM public.customer_design_assets WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk ORDER BY id FOR SHARE) t;
 -- Referenced metadata follows first appearance order, matching the old JS Set.
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind','legacy_asset','assetId',x.id,'scope',sc,'store',a->'actor'->'store','stage',asset->'stage','angle',asset->'angle') ORDER BY x.ord),'[]') INTO lp
 FROM (SELECT ids.id,min(v.n*1000000+ids.n) ord FROM jsonb_array_elements(rawv) WITH ORDINALITY v(row,n) CROSS JOIN LATERAL jsonb_array_elements_text(v.row->'photo_ids') WITH ORDINALITY ids(id,n) GROUP BY ids.id) x
 LEFT JOIN LATERAL (SELECT value AS asset FROM jsonb_array_elements(rawp) WHERE value->>'id'=x.id) z ON true;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lp) v WHERE v->>'stage' NOT IN ('before','after') OR v->>'angle' NOT IN ('front','back','left','right') OR v->>'stage' IS NULL OR v->>'angle' IS NULL)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rawp) v WHERE v->>'store' IS DISTINCT FROM a->'actor'->>'store') THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_LEGACY_DENIED';END IF;
 SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,sz FROM design_private.full_versions WHERE scope_key=sk;
 IF n>100 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version),'[]') INTO f FROM (SELECT version,record,sha256 FROM design_private.full_versions WHERE scope_key=sk ORDER BY version FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(receipt::text)),0) INTO n,sz FROM design_private.full_receipts WHERE receipt->'scope'=sc;
 IF n>100 OR sz>67108864 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY request_key),'[]') INTO fr FROM (SELECT request_key,receipt FROM design_private.full_receipts WHERE receipt->'scope'=sc ORDER BY request_key FOR SHARE) t;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision',revision,'receiptKey',receipt_key,'authority',authority,'recordSha256',record_sha256,'previousSha256',previous_sha256,'manifestId',manifest_id) ORDER BY revision),'[]') INTO authors FROM design_workflow_authority.operation_authors WHERE scope_key=sk;
 IF jsonb_array_length(wr)<>greatest(0,jsonb_array_length(w)-1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(wr) v WHERE v->'receipt'->'scope' IS DISTINCT FROM sc OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w) x WHERE x->'receipt_key'=v->'request_key' AND x->'sha256'=v->'record_sha256')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(authors) v WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w) x WHERE x->'revision'=v->'revision' AND x->'sha256'=v->'recordSha256' AND x->'receipt_key'=v->'receiptKey' AND x->'previous_sha256'=v->'previousSha256')) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CORRUPT';END IF;
 res:=jsonb_build_object('workflowRows',w,'workflowReceipts',wr,'legacyVersions',l,'legacyPhotos',lp,'fullRows',f,'fullReceipts',fr,'rawLegacyVersions',rawv,'rawLegacyPhotos',rawp,'operationAuthors',authors);
 IF jsonb_array_length(lp)>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(f) v WHERE jsonb_array_length(coalesce(v->'record'->'snapshot'->'photoRefs','[]'::jsonb))>0) OR NOT design_workflow_authority.text_only(res) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_ARTIFACT_DENIED';END IF;
 IF octet_length(res::text)>67108864 OR jsonb_array_length(wr)>1000 OR jsonb_array_length(fr)>100 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CAPACITY';END IF;RETURN res;
END$$;
CREATE FUNCTION design_workflow_authority.suffix_owned(src jsonb,base_rev integer,a jsonb,mid text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE row jsonb;proof jsonb;expected integer:=base_rev+1;BEGIN
 FOR row IN SELECT value FROM jsonb_array_elements(src->'workflowRows') WHERE (value->>'revision')::int>base_rev LOOP
  SELECT value INTO proof FROM jsonb_array_elements(src->'operationAuthors') WHERE value->'revision'=row->'revision';
  IF (row->>'revision')::int<>expected OR proof IS NULL OR proof->'authority' IS DISTINCT FROM a OR proof->'recordSha256' IS DISTINCT FROM row->'sha256' OR proof->'previousSha256' IS DISTINCT FROM row->'previous_sha256' OR proof->'receiptKey' IS DISTINCT FROM row->'receipt_key' OR proof->'manifestId' IS DISTINCT FROM to_jsonb(mid) AND NOT(mid IS NULL AND proof->'manifestId'='null'::jsonb) THEN RETURN false;END IF;
  expected:=expected+1;
 END LOOP;RETURN true;
END$$;
CREATE FUNCTION design_workflow_authority.checked_bundle(a jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE src jsonb;m design_workflow_authority.manifests%rowtype;chosen jsonb:=null;base jsonb;valid boolean;field text;r jsonb;BEGIN
 src:=design_workflow_authority.sources(a);
 FOR m IN SELECT * FROM design_workflow_authority.manifests WHERE reader=a AND active AND expires_at>clock_timestamp() ORDER BY id LOOP
  base:=m.baseline;valid:=true;
  FOREACH field IN ARRAY ARRAY['legacyVersions','legacyPhotos','rawLegacyVersions','rawLegacyPhotos','fullRows','fullReceipts'] LOOP IF base->field IS DISTINCT FROM src->field THEN valid:=false;END IF;END LOOP;
  IF NOT design_workflow_authority.prefix(base->'workflowRows',src->'workflowRows') THEN valid:=false;END IF;
  FOREACH field IN ARRAY ARRAY['workflowReceipts','operationAuthors'] LOOP
   FOR r IN SELECT value FROM jsonb_array_elements(base->field) LOOP IF NOT (src->field @> jsonb_build_array(r)) THEN valid:=false;END IF;END LOOP;
  END LOOP;
  IF valid AND design_workflow_authority.suffix_owned(src,(m.proof->>'baseWorkflowRevision')::int,a,m.id) THEN chosen:=m.proof;EXIT;END IF;
 END LOOP;
 IF chosen IS NULL THEN
  IF src->'legacyVersions'<>'[]' OR src->'legacyPhotos'<>'[]' OR src->'rawLegacyPhotos'<>'[]' OR src->'fullRows'<>'[]' OR src->'fullReceipts'<>'[]'
   OR NOT design_workflow_authority.suffix_owned(src,-1,a,null) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_MANIFEST_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('schemaVersion','design-authorized-workflow-bundle-v1','authority',a,'manifest',chosen,'sourceFingerprint',design_workflow_authority.digest(src),'workflowRows',src->'workflowRows','workflowReceipts',src->'workflowReceipts','legacyVersions',src->'legacyVersions','legacyPhotos',src->'legacyPhotos','fullRows',src->'fullRows','fullReceipts',src->'fullReceipts','mediaRows','[]'::jsonb,'candidateRows','[]'::jsonb,'operationAuthors',src->'operationAuthors');
END$$;
CREATE FUNCTION design_workflow_authority.read_bundle() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;b jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();b:=design_workflow_authority.checked_bundle(a);
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_CHANGED';END IF;
 IF b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_EXPIRED';END IF;RETURN b;
END$$;
CREATE FUNCTION design_workflow_authority.issue_manifest(credential text,scope jsonb,request_id text,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;a jsonb;src jsonb;prior design_workflow_authority.issuer_requests%rowtype;m design_workflow_authority.manifests%rowtype;req jsonb;proof jsonb;mid text;deadline timestamptz;lastrow jsonb;BEGIN
 IF session_user<>'design_workflow_manifest_issuer' OR credential IS NULL OR length(credential) NOT BETWEEN 32 AND 200 OR credential ~ '[[:space:][:cntrl:]]' OR request_id IS NULL OR request_id !~ '^[A-Za-z0-9_-]{1,80}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 3600000 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 resolved:=design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope);a:=resolved->'authority';
 req:=jsonb_build_object('reader',a,'ttlMs',ttl_ms);SELECT * INTO prior FROM design_workflow_authority.issuer_requests r WHERE r.request_id=issue_manifest.request_id;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_REQUEST_CONFLICT';END IF;
  SELECT * INTO STRICT m FROM design_workflow_authority.manifests WHERE id=prior.manifest_id;RETURN jsonb_build_object('manifest',m.proof,'replayed',true);
 END IF;
 src:=design_workflow_authority.sources(a);lastrow:=src->'workflowRows'->-1;mid:='manifest-'||design_workflow_authority.digest(jsonb_build_array(a,request_id));deadline:=least(clock_timestamp()+ttl_ms*interval '1 millisecond',(resolved->>'expiresAt')::timestamptz);
 proof:=jsonb_build_object('id',mid,'revision',1,'reader',a,'baseWorkflowRevision',coalesce((lastrow->>'revision')::int,-1),'baseWorkflowSha256',lastrow->'sha256','sourceFingerprint',design_workflow_authority.digest(src),'expiresAt',floor(extract(epoch FROM deadline)*1000)::bigint);
 INSERT INTO design_workflow_authority.manifests VALUES(mid,1,a,src,proof,deadline,true);INSERT INTO design_workflow_authority.issuer_requests VALUES(request_id,req,mid);
 RETURN jsonb_build_object('manifest',proof,'replayed',false);
END$$;
CREATE FUNCTION design_workflow_authority.revoke_manifest(manifest_id text,expected_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m design_workflow_authority.manifests%rowtype;BEGIN
 IF session_user<>'design_workflow_manifest_issuer' OR expected_revision IS NULL OR expected_revision<1 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT * INTO STRICT m FROM design_workflow_authority.manifests WHERE id=manifest_id;
 IF NOT m.active OR m.revision<>expected_revision THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_REVISION_CONFLICT';END IF;
 UPDATE design_workflow_authority.manifests SET active=false,revision=m.revision+1,proof=jsonb_set(m.proof,'{revision}',to_jsonb(m.revision+1)) WHERE id=manifest_id RETURNING * INTO m;RETURN jsonb_build_object('manifest',m.proof);
END$$;
CREATE FUNCTION design_workflow_authority.check_record(r jsonb,b jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb:=b->'authority';BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>8 OR (r-ARRAY['schemaVersion','revision','scope','store','session','archives','photoRefs','legacyVersions'])<>'{}'
 OR r->>'schemaVersion' IS DISTINCT FROM 'design-prepared-workflow-record-v1' OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store'
 OR r->'legacyVersions' IS DISTINCT FROM b->'legacyVersions' OR r->'photoRefs' IS DISTINCT FROM b->'legacyPhotos' OR NOT design_workflow_authority.text_only(r)
 OR jsonb_typeof(r->'session') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r->'session'))<>7 OR ((r->'session')-ARRAY['schemaVersion','scope','revision','phase','sources','entries','journal'])<>'{}'
 OR jsonb_typeof(r->'session'->'schemaVersion') IS DISTINCT FROM 'string' OR r->'session'->>'schemaVersion' NOT IN ('design-pilot-local-v1','design-pilot-local-v2') OR jsonb_typeof(r->'session'->'scope') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r->'session'->'scope'))<>3
 OR r->'session'->'scope'->'customerId' IS DISTINCT FROM a->'scope'->'customerProfileId' OR r->'session'->'scope'->'visitId' IS DISTINCT FROM a->'scope'->'visitId'
 OR jsonb_typeof(r->'session'->'scope'->'sessionId') IS DISTINCT FROM 'string' OR (r->'session'->'scope'->>'sessionId') !~ '^[A-Za-z0-9:_-]{1,160}$'
 OR jsonb_typeof(r->'archives') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'journal') IS DISTINCT FROM 'array'
 OR r->'session'->'revision' IS DISTINCT FROM to_jsonb(jsonb_array_length(r->'session'->'journal')) OR jsonb_array_length(r->'session'->'journal')>1000 OR octet_length(r::text)>33554432 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
END$$;
CREATE FUNCTION design_workflow_authority.initialize_native(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;r jsonb;a jsonb;sha text;sk text;BEGIN
 b:=design_workflow_authority.read_bundle();a:=b->'authority';r:=q->'record';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR (q-ARRAY['expectedSourceFingerprint','record','recordSha256'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR b->'workflowRows'<>'[]' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_REVISION_CONFLICT';END IF;
 PERFORM design_workflow_authority.check_record(r,b);sha:=design_workflow_authority.digest(r);sk:=design_workflow_authority.digest(a->'scope');
 IF q->>'recordSha256' IS DISTINCT FROM sha OR r->'revision' IS DISTINCT FROM '0'::jsonb OR r->'archives'<>'[]' OR r->'session'->'revision' IS DISTINCT FROM '0'::jsonb OR r->'session'->>'phase' IS DISTINCT FROM 'before_analysis' OR r->'session'->'sources'<>'[]' OR r->'session'->'entries'<>'[]' OR r->'session'->'journal'<>'[]' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.workflow_versions VALUES(sk,0,r,sha,null,null);
 INSERT INTO design_workflow_authority.operation_authors VALUES(sk,0,null,a,sha,null,b->'manifest'->>'id');
 PERFORM design_workflow_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_workflow_authority.append_native(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;oldrow jsonb;oldr jsonb;r jsonb;rc jsonb;req jsonb;intent jsonb;kind text;rid text;k text;sha text;sk text;prior integer;cnt integer;j jsonb;event_type text;suffix text;idx integer;entry jsonb;oldentry jsonb;BEGIN
 b:=design_workflow_authority.read_bundle();a:=b->'authority';oldrow:=b->'workflowRows'->-1;oldr:=oldrow->'record';r:=q->'record';rc:=q->'receipt';req:=rc->'request';intent:=req->'intent';kind:=intent->>'type';rid:=req->>'requestId';k:=q->>'receiptKey';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>6 OR (q-ARRAY['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt'])<>'{}'
 OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR oldrow IS NULL OR q->'expectedRevision' IS DISTINCT FROM oldrow->'revision' OR jsonb_array_length(b->'workflowRows')>=1001 THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_REVISION_CONFLICT';END IF;
 PERFORM design_workflow_authority.check_record(r,b);sha:=design_workflow_authority.digest(r);sk:=design_workflow_authority.digest(a->'scope');
 IF q->>'recordSha256' IS DISTINCT FROM sha OR r->'revision' IS DISTINCT FROM to_jsonb((oldr->>'revision')::int+1) OR r->'session'->'scope' IS DISTINCT FROM oldr->'session'->'scope' OR r->'session'->'schemaVersion' IS DISTINCT FROM oldr->'session'->'schemaVersion'
 OR jsonb_typeof(rc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(rc))<>5 OR (rc-ARRAY['fingerprint','scope','actor','appliedRevision','request'])<>'{}'
 OR rc->'scope' IS DISTINCT FROM a->'scope' OR rc->'actor' IS DISTINCT FROM a->'actor' OR rc->'appliedRevision' IS DISTINCT FROM r->'revision'
 OR jsonb_typeof(req) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(req))<>3 OR (req-ARRAY['requestId','expectedRevision','intent'])<>'{}' OR req->'expectedRevision' IS DISTINCT FROM oldr->'revision'
 OR rid IS NULL OR rid !~ '^[A-Za-z0-9_-]{1,80}$' OR k IS DISTINCT FROM design_workflow_authority.digest(jsonb_build_array(a->'actor',rid))
 OR rc->>'fingerprint' IS DISTINCT FROM design_workflow_authority.digest(jsonb_build_object('scope',a->'scope')||req)
 OR kind IS NULL OR kind NOT IN ('record_source','record_note','advance','create_group','record_context','record_technique','record_review','confirm_entry','archive','reopen')
 OR NOT design_workflow_authority.prefix(oldr->'session'->'journal',r->'session'->'journal') OR NOT design_workflow_authority.prefix(oldr->'session'->'sources',r->'session'->'sources') OR NOT design_workflow_authority.prefix(oldr->'archives',r->'archives') THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM design_private.workflow_receipts WHERE request_key=k) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_RECEIPT_CONFLICT';END IF;
 prior:=jsonb_array_length(oldr->'session'->'journal');cnt:=jsonb_array_length(r->'session'->'journal')-prior;
 IF cnt<>(CASE WHEN kind='confirm_entry' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 FOR idx IN 0..cnt-1 LOOP
  j:=r->'session'->'journal'->(prior+idx);event_type:=j->'event'->>'type';
  suffix:=CASE WHEN kind IN ('record_source','record_note') OR kind='confirm_entry' AND idx=0 THEN 'source' WHEN kind IN ('create_group','record_context','record_technique','record_review') THEN 'entry' WHEN kind='advance' THEN 'phase' WHEN kind='confirm_entry' THEN 'confirm' ELSE kind END;
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(j))<>4 OR (j-ARRAY['requestId','expectedRevision','scope','event'])<>'{}' OR j->'scope' IS DISTINCT FROM r->'session'->'scope' OR j->'expectedRevision' IS DISTINCT FROM to_jsonb(prior+idx) OR j->>'requestId' IS DISTINCT FROM rid||'-'||suffix
  OR event_type IS DISTINCT FROM (CASE suffix WHEN 'source' THEN 'source_recorded' WHEN 'entry' THEN 'entry_recorded' WHEN 'phase' THEN 'phase_advanced' WHEN 'confirm' THEN 'entry_confirmed' WHEN 'archive' THEN 'phase_advanced' WHEN 'reopen' THEN 'revision_opened' END) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
  IF suffix='source' THEN
   IF j->'event'->'source' IS DISTINCT FROM jsonb_build_object('messageId',CASE WHEN kind='record_source' THEN 'source:'||rid WHEN kind='record_note' THEN 'note:'||(intent->>'field')||':'||rid ELSE 'confirmation:'||rid END,'kind',CASE WHEN kind='record_source' THEN intent->>'kind' ELSE 'text' END,'actor','employee','text',intent->'text') OR j->'event'->'source'->>'kind' NOT IN ('text','speech_transcript') THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
  ELSIF suffix='entry' THEN
   IF j->'event'->'entry'->>'id' IS DISTINCT FROM 'entry:'||rid OR j->'event'->'entry'->>'origin' IS DISTINCT FROM 'extraction' OR j->'event'->'entry'->>'basis' IS DISTINCT FROM 'said' OR j->'event'->'entry'->>'field' LIKE 'model_%' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
  ELSIF suffix='phase' AND j->'event'->'phase' IS DISTINCT FROM intent->'phase' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';
  ELSIF suffix='archive' AND j->'event'->>'phase' IS DISTINCT FROM 'archive' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';
  ELSIF suffix='confirm' AND j->'event'->'entryId' IS DISTINCT FROM intent->'entryId' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';
  ELSIF suffix='reopen' AND (j->'event'->'resumePhase' IS DISTINCT FROM intent->'resumePhase' OR j->'event'->'reasonSource' IS DISTINCT FROM jsonb_build_object('messageId','revision:'||rid,'kind','text','actor','employee','text',intent->'reason')) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 END LOOP;
 -- Old entries may change only by the explicit confirmation command; original
 -- values, source provenance and all other old entries remain byte-equivalent.
 IF jsonb_array_length(r->'session'->'entries')<>jsonb_array_length(oldr->'session'->'entries')+(CASE WHEN kind IN ('create_group','record_context','record_technique','record_review') THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 FOR oldentry,idx IN SELECT value,ordinality::int-1 FROM jsonb_array_elements(oldr->'session'->'entries') WITH ORDINALITY LOOP
  entry:=r->'session'->'entries'->idx;
  IF kind='confirm_entry' AND oldentry->'id'=intent->'entryId' THEN
   IF (entry-ARRAY['status','confirmation']) IS DISTINCT FROM (oldentry-ARRAY['status','confirmation']) OR entry->>'status' IS DISTINCT FROM 'confirmed' OR oldentry->>'status' IS DISTINCT FROM 'not_confirmed' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
  ELSIF entry IS DISTINCT FROM oldentry THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 END LOOP;
 IF kind='archive' THEN
  IF r->'session'->>'phase' IS DISTINCT FROM 'archive' OR jsonb_array_length(r->'archives')<>jsonb_array_length(oldr->'archives')+1 OR r->'archives'->-1->'snapshot' IS DISTINCT FROM r->'session' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 ELSIF r->'archives' IS DISTINCT FROM oldr->'archives' THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 IF kind='reopen' AND (oldr->'session'->>'phase' IS DISTINCT FROM 'archive' OR r->'session'->'journal'->-1->'event'->'parentArchiveRevision' IS DISTINCT FROM oldr->'session'->'revision') THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.workflow_versions VALUES(sk,(r->>'revision')::int,r,sha,oldrow->>'sha256',k);
 INSERT INTO design_private.workflow_receipts VALUES(k,rc,sha);
 INSERT INTO design_workflow_authority.operation_authors VALUES(sk,(r->>'revision')::int,k,a,sha,oldrow->>'sha256',b->'manifest'->>'id');
 PERFORM design_workflow_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_workflow_authority.guard_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR current_user<>'design_workflow_manifest_issuer_capability' OR NOT OLD.active OR NEW.active OR NEW.revision<>OLD.revision+1 OR (to_jsonb(NEW)-ARRAY['active','revision','proof']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','revision','proof']) OR NEW.proof IS DISTINCT FROM jsonb_set(OLD.proof,'{revision}',to_jsonb(NEW.revision)) THEN RAISE EXCEPTION 'WORKFLOW_AUTHORITY_IMMUTABLE';END IF;RETURN NEW;
END$$;
CREATE TRIGGER workflow_manifest_revoke_only BEFORE UPDATE OR DELETE ON design_workflow_authority.manifests FOR EACH ROW EXECUTE FUNCTION design_workflow_authority.guard_manifest();
CREATE TRIGGER workflow_author_immutable BEFORE UPDATE OR DELETE ON design_workflow_authority.operation_authors FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
CREATE TRIGGER workflow_issuer_request_immutable BEFORE UPDATE OR DELETE ON design_workflow_authority.issuer_requests FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
ALTER FUNCTION design_workflow_authority.canonical(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.digest(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.prefix(jsonb,jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.text_only(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.sources(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.suffix_owned(jsonb,integer,jsonb,text) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.checked_bundle(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.read_bundle() OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.issue_manifest(text,jsonb,text,bigint) OWNER TO design_workflow_manifest_issuer_capability;
ALTER FUNCTION design_workflow_authority.revoke_manifest(text,bigint) OWNER TO design_workflow_manifest_issuer_capability;
ALTER FUNCTION design_workflow_authority.check_record(jsonb,jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.initialize_native(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.append_native(jsonb) OWNER TO design_workflow_capability;
ALTER FUNCTION design_workflow_authority.guard_manifest() OWNER TO design_workflow_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_workflow_authority FROM PUBLIC,anon,authenticated,design_identity_runtime,design_workflow_manifest_issuer;
REVOKE ALL ON ALL TABLES IN SCHEMA design_workflow_authority FROM PUBLIC,anon,authenticated,design_identity_runtime,design_workflow_manifest_issuer;
GRANT EXECUTE ON FUNCTION design_workflow_authority.sources(jsonb),design_workflow_authority.digest(jsonb),design_workflow_authority.canonical(jsonb) TO design_workflow_manifest_issuer_capability;
GRANT EXECUTE ON FUNCTION design_workflow_authority.read_bundle(),design_workflow_authority.initialize_native(jsonb),design_workflow_authority.append_native(jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_workflow_authority.issue_manifest(text,jsonb,text,bigint),design_workflow_authority.revoke_manifest(text,bigint) TO design_workflow_manifest_issuer;
REVOKE CREATE ON SCHEMA design_workflow_authority FROM design_workflow_capability,design_workflow_manifest_issuer_capability;
-- Current-read manifest expiry is verified at each capability return. Existing
-- identity deferred deadlines retain the documented SET CONSTRAINTS limitation.
-- Root's trusted JS still performs complete native replay/transition semantics;
-- SQL additionally binds immutable prefixes, scope, receipt and operation author.
