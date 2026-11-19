-- ISOLATED SYNTHETIC PG17 ONLY. No production installation, grants or migration.
-- Existing immutable rows/hashes are never rewritten. Dependencies retain original authors.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17
 OR to_regclass('design_workflow_authority.operation_authors') IS NULL OR to_regclass('design_identity.transaction_contexts') IS NULL OR to_regclass('design_private.workflow_versions') IS NULL OR to_regclass('design_private.model_candidates') IS NULL OR to_regnamespace('design_dependency_authority') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_DEPENDENCY_AUTHORITY_REQUIRED';END IF;
END$$;
CREATE ROLE design_dependency_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_dependency_issuer_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Reuse the separate manifest issuer LOGIN, never runtime or a role member.
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_workflow_manifest_issuer;
CREATE SCHEMA design_dependency_authority AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_dependency_authority FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_dependency_authority TO design_identity_runtime,design_dependency_capability,design_dependency_issuer_capability,design_workflow_manifest_issuer;
GRANT CREATE ON SCHEMA design_dependency_authority TO design_dependency_capability,design_dependency_issuer_capability;
GRANT USAGE ON SCHEMA design_identity,design_private,public TO design_dependency_capability,design_dependency_issuer_capability;
GRANT EXECUTE ON FUNCTION design_identity.require_authority() TO design_dependency_capability;
GRANT EXECUTE ON FUNCTION design_identity.resolve_hash(text,jsonb) TO design_dependency_issuer_capability;
CREATE TABLE design_dependency_authority.operation_authors(scope_key text NOT NULL,revision integer NOT NULL,receipt_key text,authority jsonb NOT NULL,record_sha256 text NOT NULL,previous_sha256 text,manifest_id text,PRIMARY KEY(scope_key,revision),UNIQUE(receipt_key),FOREIGN KEY(scope_key,revision) REFERENCES design_private.workflow_versions(scope_key,revision));
CREATE TABLE design_dependency_authority.dependency_authors(scope_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('media','candidate','full')),id text NOT NULL,authority jsonb NOT NULL,sha256 text NOT NULL,manifest_id text,PRIMARY KEY(scope_key,kind,id));
CREATE TABLE design_dependency_authority.manifests(id text PRIMARY KEY,revision bigint NOT NULL CHECK(revision>0),reader jsonb NOT NULL,baseline jsonb NOT NULL,proof jsonb NOT NULL,expires_at timestamptz NOT NULL,active boolean NOT NULL);
CREATE TABLE design_dependency_authority.issuer_requests(request_id text PRIMARY KEY,request jsonb NOT NULL,manifest_id text NOT NULL REFERENCES design_dependency_authority.manifests(id));
ALTER TABLE design_dependency_authority.operation_authors OWNER TO design_identity_owner;
ALTER TABLE design_dependency_authority.operation_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_dependency_authority.operation_authors FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_dependency_authority.operation_authors FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_dependency_authority.operation_authors FOR SELECT TO design_dependency_issuer_capability USING(true);
ALTER TABLE design_dependency_authority.manifests OWNER TO design_identity_owner;
ALTER TABLE design_dependency_authority.manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_dependency_authority.manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_dependency_authority.manifests FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_dependency_authority.manifests FOR SELECT TO design_dependency_issuer_capability USING(true);
ALTER TABLE design_dependency_authority.issuer_requests OWNER TO design_identity_owner;
ALTER TABLE design_dependency_authority.issuer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_dependency_authority.issuer_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_cap_read ON design_dependency_authority.issuer_requests FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY workflow_issuer_read ON design_dependency_authority.issuer_requests FOR SELECT TO design_dependency_issuer_capability USING(true);
GRANT SELECT ON ALL TABLES IN SCHEMA design_dependency_authority TO design_dependency_capability,design_dependency_issuer_capability;
GRANT INSERT ON design_dependency_authority.operation_authors TO design_dependency_capability;
CREATE POLICY workflow_cap_insert ON design_dependency_authority.operation_authors FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT,UPDATE(active,revision,proof) ON design_dependency_authority.manifests TO design_dependency_issuer_capability;
CREATE POLICY workflow_issuer_insert ON design_dependency_authority.manifests FOR INSERT TO design_dependency_issuer_capability WITH CHECK(true);
CREATE POLICY workflow_issuer_update ON design_dependency_authority.manifests FOR UPDATE TO design_dependency_issuer_capability USING(true) WITH CHECK(true);
GRANT INSERT ON design_dependency_authority.issuer_requests TO design_dependency_issuer_capability;
CREATE POLICY workflow_issuer_insert ON design_dependency_authority.issuer_requests FOR INSERT TO design_dependency_issuer_capability WITH CHECK(true);
-- FOR SHARE's minimal column UPDATE privileges are held only by NOLOGIN code owner.
GRANT SELECT,UPDATE(revision) ON design_private.workflow_versions TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.workflow_versions FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.workflow_versions FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(request_key) ON design_private.workflow_receipts TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.workflow_receipts FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.workflow_receipts FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(version) ON design_private.full_versions TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.full_versions FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.full_versions FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(request_key) ON design_private.full_receipts TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.full_receipts FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.full_receipts FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(media_id) ON design_private.media_records TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.media_records FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.media_records FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(candidate_id) ON design_private.model_candidates TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.model_candidates FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.model_candidates FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(id) ON public.customer_design_versions TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON public.customer_design_versions FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON public.customer_design_versions FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(id) ON public.customer_design_assets TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON public.customer_design_assets FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON public.customer_design_assets FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(visit_id) ON design_identity.visit_bindings TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_identity.visit_bindings FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_identity.visit_bindings FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT INSERT ON design_private.workflow_versions,design_private.workflow_receipts TO design_dependency_capability;
CREATE POLICY dependency_authority_append ON design_private.workflow_versions FOR INSERT TO design_dependency_capability WITH CHECK(true);
CREATE POLICY dependency_authority_append ON design_private.workflow_receipts FOR INSERT TO design_dependency_capability WITH CHECK(true);
ALTER TABLE design_dependency_authority.dependency_authors OWNER TO design_identity_owner;
ALTER TABLE design_dependency_authority.dependency_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_dependency_authority.dependency_authors FORCE ROW LEVEL SECURITY;
CREATE POLICY dependency_author_cap ON design_dependency_authority.dependency_authors TO design_dependency_capability USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON design_dependency_authority.dependency_authors TO design_dependency_capability;
GRANT USAGE ON SCHEMA design_workflow_authority TO design_dependency_capability;
GRANT SELECT ON design_workflow_authority.operation_authors TO design_dependency_capability;
CREATE POLICY dependency_old_authors_read ON design_workflow_authority.operation_authors FOR SELECT TO design_dependency_capability USING(true);
GRANT SELECT,UPDATE(media_id) ON design_private.media_access TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.media_access FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.media_access FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(candidate_id) ON design_private.model_candidate_access TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.model_candidate_access FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.model_candidate_access FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(candidate_id) ON design_private.model_candidate_acceptances TO design_dependency_capability;
CREATE POLICY dependency_authority_read ON design_private.model_candidate_acceptances FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY dependency_authority_lock ON design_private.model_candidate_acceptances FOR UPDATE TO design_dependency_capability USING(true) WITH CHECK(false);
GRANT INSERT ON design_private.media_records TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.media_records FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.media_access TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.media_access FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.model_candidates TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.model_candidates FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.model_candidate_access TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.model_candidate_access FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.model_candidate_acceptances TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.model_candidate_acceptances FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.full_versions TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.full_versions FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.full_receipts TO design_dependency_capability;
CREATE POLICY dependency_authority_insert ON design_private.full_receipts FOR INSERT TO design_dependency_capability WITH CHECK(true);
GRANT INSERT ON design_private.commit_checks TO design_dependency_capability;
CREATE POLICY dependency_authority_deadline ON design_private.commit_checks FOR INSERT TO design_dependency_capability WITH CHECK(true);
CREATE FUNCTION design_dependency_authority.canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE k text;x jsonb;r text;n numeric;BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN
  r:='';FOR k,x IN SELECT key,value FROM jsonb_each(v) ORDER BY key COLLATE "C" LOOP
   IF k !~ '^[ -~]*$' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;
   r:=r||CASE WHEN r='' THEN '' ELSE ',' END||to_jsonb(k)::text||':'||design_dependency_authority.canonical(x);
  END LOOP;RETURN '{'||r||'}';
 WHEN 'array' THEN
  r:='';FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP r:=r||CASE WHEN r='' THEN '' ELSE ',' END||design_dependency_authority.canonical(x);END LOOP;RETURN '['||r||']';
 WHEN 'number' THEN n:=(v::text)::numeric;IF abs(n)>9007199254740991 OR (n<>0 AND abs(n)<0.000001) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;RETURN trim_scale(n)::text;
 WHEN 'string' THEN RETURN to_jsonb(v#>>'{}')::text;
 WHEN 'boolean' THEN RETURN v::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END CASE;
END$$;
CREATE FUNCTION design_dependency_authority.digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT encode(sha256(convert_to(design_dependency_authority.canonical(v),'UTF8')),'hex') $$;
CREATE FUNCTION design_dependency_authority.prefix(a jsonb,b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT jsonb_typeof(a)='array' AND jsonb_typeof(b)='array' AND jsonb_array_length(a)<=jsonb_array_length(b) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) WITH ORDINALITY x(v,n) WHERE x.v IS DISTINCT FROM b->(x.n::integer-1)) $$;
CREATE FUNCTION design_dependency_authority.text_only(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT NOT jsonb_path_exists(v,'$.**.modelCandidates') AND NOT jsonb_path_exists(v,'$.** ? (@.kind == "private_media")') $$;
-- Private raw source loading is usable only from the fixed capability and issuer.
CREATE FUNCTION design_dependency_authority.sources(a jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE sc jsonb:=a->'scope';sk text;vk text;bd date;w jsonb;wr jsonb;f jsonb;fr jsonb;l jsonb;lp jsonb;rawv jsonb;rawp jsonb;authors jsonb;deps jsonb;mr jsonb;cr jsonb;res jsonb;n bigint;sz bigint;total_bytes bigint:=0;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));sk:=design_dependency_authority.digest(sc);
 SELECT business_date INTO STRICT bd FROM design_identity.visit_bindings WHERE assignment_source=sc->>'assignmentSource' AND visit_id=sc->>'visitId' AND customer_profile_id=(sc->>'customerProfileId')::bigint FOR SHARE;
 vk:=CASE WHEN sc->>'assignmentSource'='appointment' THEN sc->>'visitId' ELSE 'manual:'||to_char(bd,'YYYY-MM-DD')||':'||substr(sc->>'visitId',11) END;
 SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,sz FROM design_private.workflow_versions WHERE scope_key=sk;
 total_bytes:=total_bytes+sz;IF n>1001 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY revision),'[]') INTO w FROM (SELECT revision,record,sha256,previous_sha256,receipt_key FROM design_private.workflow_versions WHERE scope_key=sk ORDER BY revision FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(receipt::text)),0) INTO n,sz FROM design_private.workflow_receipts WHERE receipt->'scope'=sc OR request_key IN (SELECT value->>'receipt_key' FROM jsonb_array_elements(w));
 total_bytes:=total_bytes+sz;IF n>1000 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY request_key),'[]') INTO wr FROM (SELECT request_key,receipt,record_sha256 FROM design_private.workflow_receipts WHERE receipt->'scope'=sc OR request_key IN (SELECT value->>'receipt_key' FROM jsonb_array_elements(w)) ORDER BY request_key FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(to_jsonb(v)::text)),0) INTO n,sz FROM public.customer_design_versions v WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk;
 total_bytes:=total_bytes+sz;IF n>1000 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version_no),'[]') INTO rawv FROM (SELECT * FROM public.customer_design_versions WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk ORDER BY version_no FOR SHARE) t;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rawv) v WHERE v->>'archive_url' IS DISTINCT FROM '' OR v->>'store' IS DISTINCT FROM a->'actor'->>'store') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_LEGACY_DENIED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v->'id','requestId',v->'request_id','versionNumber',v->'version_no','previousVersionId',v->'previous_version_id','createdAt',v->'created_at','actor',jsonb_build_object('username',v->'author','store',v->'store'),'scope',sc,'snapshot',jsonb_build_object('baseline',v->'baseline','optimized',v->'optimized','reasons',v->'reasons','execution',v->'execution','process',v->'process','review',v->'review','status',v->'status','photo_ids',v->'photo_ids','archive_url',null)) ORDER BY (v->>'version_no')::int),'[]') INTO l FROM jsonb_array_elements(rawv) v;
 SELECT count(*),coalesce(sum(octet_length(to_jsonb(v)::text)),0) INTO n,sz FROM public.customer_design_assets v WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk;
 total_bytes:=total_bytes+sz;IF n>1000 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') INTO rawp FROM (SELECT * FROM public.customer_design_assets WHERE customer_profile_id=(sc->>'customerProfileId')::bigint AND visit_key=vk ORDER BY id FOR SHARE) t;
 -- Referenced metadata follows first appearance order, matching the old JS Set.
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind','legacy_asset','assetId',x.id,'scope',sc,'store',a->'actor'->'store','stage',asset->'stage','angle',asset->'angle') ORDER BY x.ord),'[]') INTO lp
 FROM (SELECT ids.id,min(v.n*1000000+ids.n) ord FROM jsonb_array_elements(rawv) WITH ORDINALITY v(row,n) CROSS JOIN LATERAL jsonb_array_elements_text(v.row->'photo_ids') WITH ORDINALITY ids(id,n) GROUP BY ids.id) x
 LEFT JOIN LATERAL (SELECT value AS asset FROM jsonb_array_elements(rawp) WHERE value->>'id'=x.id) z ON true;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lp) v WHERE v->>'stage' NOT IN ('before','after') OR v->>'angle' NOT IN ('front','back','left','right') OR v->>'stage' IS NULL OR v->>'angle' IS NULL)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rawp) v WHERE v->>'store' IS DISTINCT FROM a->'actor'->>'store') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_LEGACY_DENIED';END IF;
 SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,sz FROM design_private.full_versions WHERE scope_key=sk;
 total_bytes:=total_bytes+sz;IF n>100 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version),'[]') INTO f FROM (SELECT version,record,sha256 FROM design_private.full_versions WHERE scope_key=sk ORDER BY version FOR SHARE) t;
 SELECT count(*),coalesce(sum(octet_length(receipt::text)),0) INTO n,sz FROM design_private.full_receipts WHERE receipt->'scope'=sc;
 total_bytes:=total_bytes+sz;IF n>100 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY request_key),'[]') INTO fr FROM (SELECT request_key,receipt FROM design_private.full_receipts WHERE receipt->'scope'=sc ORDER BY request_key FOR SHARE) t;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision',revision,'receiptKey',receipt_key,'authority',authority,'recordSha256',record_sha256,'previousSha256',previous_sha256,'manifestId',manifest_id) ORDER BY revision),'[]') INTO authors FROM (SELECT * FROM design_dependency_authority.operation_authors WHERE scope_key=sk UNION ALL SELECT * FROM design_workflow_authority.operation_authors WHERE scope_key=sk) operation_authors;
 IF jsonb_array_length(wr)<>greatest(0,jsonb_array_length(w)-1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(wr) v WHERE v->'receipt'->'scope' IS DISTINCT FROM sc OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w) x WHERE x->'receipt_key'=v->'request_key' AND x->'sha256'=v->'record_sha256')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(authors) v WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w) x WHERE x->'revision'=v->'revision' AND x->'sha256'=v->'recordSha256' AND x->'receipt_key'=v->'receiptKey' AND x->'previous_sha256'=v->'previousSha256')) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CORRUPT';END IF;
 SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,sz FROM design_private.media_records WHERE record->'binding'->'scope'=sc;
 total_bytes:=total_bytes+sz;IF n>300 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY binding_key,media_id),'[]') INTO mr FROM (SELECT m.binding_key,m.media_id,m.record,m.record_sha256,a.active,a.revision AS access_revision FROM design_private.media_records m JOIN design_private.media_access a USING(binding_key,media_id) WHERE m.record->'binding'->'scope'=sc ORDER BY m.binding_key,m.media_id FOR SHARE OF m,a) t;
 IF jsonb_array_length(mr)<>n THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CORRUPT';END IF;
 SELECT count(*),coalesce(sum(octet_length(receipt::text)),0) INTO n,sz FROM design_private.model_candidate_acceptances z JOIN design_private.model_candidates c USING(candidate_id) WHERE c.scope_key=sk OR c.envelope->'scope'=sc;
 total_bytes:=total_bytes+sz;IF n>1000 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT count(*),coalesce(sum(octet_length(envelope::text)),0) INTO n,sz FROM design_private.model_candidates WHERE scope_key=sk OR envelope->'scope'=sc;
 total_bytes:=total_bytes+sz;IF n>1000 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY candidate_id),'[]') INTO cr FROM (SELECT c.candidate_id,c.scope_key,c.envelope,c.sha256,floor(extract(epoch FROM c.expires_at)*1000)::bigint AS "expiresAt",a.active,a.revision AS access_revision,(SELECT receipt FROM design_private.model_candidate_acceptances z WHERE z.candidate_id=c.candidate_id) AS consumed FROM design_private.model_candidates c JOIN design_private.model_candidate_access a USING(candidate_id) WHERE c.scope_key=sk OR c.envelope->'scope'=sc ORDER BY c.candidate_id FOR SHARE OF c,a) t;
 IF jsonb_array_length(cr)<>n OR EXISTS(SELECT 1 FROM jsonb_array_elements(cr) c WHERE c->>'scope_key'<>sk OR c->'envelope'->'scope' IS DISTINCT FROM sc) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CORRUPT';END IF;
 SELECT count(*),coalesce(sum(octet_length(to_jsonb(z)::text)),0) INTO n,sz FROM design_dependency_authority.dependency_authors z WHERE scope_key=sk;
 total_bytes:=total_bytes+sz;IF n>1400 OR total_bytes>67108864 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'authority',authority,'sha256',sha256,'manifestId',manifest_id) ORDER BY kind COLLATE "C",id COLLATE "C"),'[]') INTO deps FROM design_dependency_authority.dependency_authors WHERE scope_key=sk;
 res:=jsonb_build_object('workflowRows' ,w,'workflowReceipts',wr,'legacyVersions',l,'legacyPhotos',lp,'fullRows',f,'fullReceipts',fr,'rawLegacyVersions',rawv,'rawLegacyPhotos',rawp,'operationAuthors',authors,'dependencyAuthors',deps,'mediaRows',mr,'candidateRows',cr);
 IF octet_length(res::text)>67108864 OR jsonb_array_length(wr)>1000 OR jsonb_array_length(fr)>100 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CAPACITY';END IF;RETURN res;
END$$;
CREATE FUNCTION design_dependency_authority.suffix_owned(src jsonb,base_rev integer,a jsonb,mid text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE row jsonb;proof jsonb;expected integer:=base_rev+1;BEGIN
 FOR row IN SELECT value FROM jsonb_array_elements(src->'workflowRows') WHERE (value->>'revision')::int>base_rev LOOP
  SELECT value INTO proof FROM jsonb_array_elements(src->'operationAuthors') WHERE value->'revision'=row->'revision';
  IF (row->>'revision')::int<>expected OR proof IS NULL OR proof->'authority' IS DISTINCT FROM a OR proof->'recordSha256' IS DISTINCT FROM row->'sha256' OR proof->'previousSha256' IS DISTINCT FROM row->'previous_sha256' OR proof->'receiptKey' IS DISTINCT FROM row->'receipt_key' OR proof->'manifestId' IS DISTINCT FROM to_jsonb(mid) AND NOT(mid IS NULL AND proof->'manifestId'='null'::jsonb) THEN RETURN false;END IF;
  expected:=expected+1;
 END LOOP;RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.dependency_digests(src jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'sha256',sha) ORDER BY kind COLLATE "C",id COLLATE "C"),'[]') FROM (
 SELECT 'media' kind,(v->>'binding_key')||':'||(v->>'media_id') id,v->'record_sha256' sha FROM jsonb_array_elements(src->'mediaRows') v
 UNION ALL SELECT 'candidate',v->>'candidate_id',v->'sha256' FROM jsonb_array_elements(src->'candidateRows') v
 UNION ALL SELECT 'full',v->>'version',v->'sha256' FROM jsonb_array_elements(src->'fullRows') v) d
$$;
CREATE FUNCTION design_dependency_authority.dependencies_owned(src jsonb,base jsonb,a jsonb,mid text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE d jsonb;p jsonb;old jsonb;nowrow jsonb;accepted jsonb;op jsonb;w jsonb;BEGIN
 FOR d IN SELECT value FROM jsonb_array_elements(design_dependency_authority.dependency_digests(src)) LOOP
  SELECT value INTO old FROM jsonb_array_elements(design_dependency_authority.dependency_digests(base)) v WHERE v->'kind'=d->'kind' AND v->'id'=d->'id';
  IF old IS NOT NULL THEN IF old IS DISTINCT FROM d THEN RETURN false;END IF;CONTINUE;END IF;
  SELECT value INTO p FROM jsonb_array_elements(src->'dependencyAuthors') v WHERE v->'kind'=d->'kind' AND v->'id'=d->'id';
  IF p IS NULL OR p->'authority' IS DISTINCT FROM a OR p->'sha256' IS DISTINCT FROM d->'sha256' OR p->'manifestId' IS DISTINCT FROM coalesce(to_jsonb(mid),'null'::jsonb) THEN RETURN false;END IF;
 END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(base->'mediaRows') LOOP
  SELECT value INTO nowrow FROM jsonb_array_elements(src->'mediaRows') v WHERE v->'binding_key'=old->'binding_key' AND v->'media_id'=old->'media_id';
  IF nowrow IS NULL OR (nowrow-ARRAY['active','access_revision']) IS DISTINCT FROM (old-ARRAY['active','access_revision']) THEN RETURN false;END IF;
 END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(base->'candidateRows') LOOP
  SELECT value INTO nowrow FROM jsonb_array_elements(src->'candidateRows') v WHERE v->'candidate_id'=old->'candidate_id';
  IF nowrow IS NULL OR (nowrow-ARRAY['active','access_revision','consumed']) IS DISTINCT FROM (old-ARRAY['active','access_revision','consumed']) THEN RETURN false;END IF;
  IF old->'consumed'<>'null'::jsonb AND nowrow->'consumed' IS DISTINCT FROM old->'consumed' THEN RETURN false;END IF;
  IF old->'consumed'='null'::jsonb AND nowrow->'consumed'<>'null'::jsonb THEN
   SELECT value INTO op FROM jsonb_array_elements(src->'operationAuthors') v WHERE v->'receiptKey'=nowrow->'consumed'->'receiptKey';
   IF op IS NULL OR op->'authority' IS DISTINCT FROM a OR op->'manifestId' IS DISTINCT FROM coalesce(to_jsonb(mid),'null'::jsonb) THEN RETURN false;END IF;
  END IF;
 END LOOP;
 -- All consumption metadata must be the exact receipt/lane produced by a native
 -- append, not a free-standing acceptance or a changed historical receipt.
 FOR nowrow IN SELECT value FROM jsonb_array_elements(src->'candidateRows') WHERE value->'consumed'<>'null'::jsonb LOOP
  accepted:=nowrow->'consumed'->'acceptance';
  SELECT value INTO w FROM jsonb_array_elements(src->'workflowRows') v WHERE v->'revision'=accepted->'workflowRevision';
  IF w IS NULL OR w->'receipt_key' IS DISTINCT FROM nowrow->'consumed'->'receiptKey'
  OR nowrow->'consumed' IS DISTINCT FROM jsonb_build_object('scope',a->'scope','candidateId',nowrow->'candidate_id','candidateDigest',nowrow->'sha256','receiptKey',w->'receipt_key','acceptance',accepted)
  OR NOT(w->'record'->'modelCandidates' @> jsonb_build_array(jsonb_build_object('candidate',nowrow->'envelope','acceptance',accepted))) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.checked_bundle(a jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE src jsonb;m design_dependency_authority.manifests%rowtype;chosen jsonb:=null;base jsonb;valid boolean;field text;r jsonb;emptybase jsonb:=jsonb_build_object('mediaRows','[]'::jsonb,'candidateRows','[]'::jsonb,'fullRows','[]'::jsonb);BEGIN
 src:=design_dependency_authority.sources(a);
 FOR m IN SELECT * FROM design_dependency_authority.manifests WHERE reader=a AND active AND expires_at>clock_timestamp() ORDER BY id LOOP
  base:=m.baseline;valid:=true;
  FOREACH field IN ARRAY ARRAY['legacyVersions','legacyPhotos','rawLegacyVersions','rawLegacyPhotos'] LOOP IF base->field IS DISTINCT FROM src->field THEN valid:=false;END IF;END LOOP;
  IF NOT design_dependency_authority.prefix(base->'workflowRows',src->'workflowRows') OR NOT design_dependency_authority.prefix(base->'fullRows',src->'fullRows') THEN valid:=false;END IF;
  FOREACH field IN ARRAY ARRAY['workflowReceipts','operationAuthors','fullReceipts','dependencyAuthors'] LOOP
   FOR r IN SELECT value FROM jsonb_array_elements(base->field) LOOP IF NOT (src->field @> jsonb_build_array(r)) THEN valid:=false;END IF;END LOOP;
  END LOOP;
  IF valid AND design_dependency_authority.suffix_owned(src,(m.proof->>'baseWorkflowRevision')::int,a,m.id) AND design_dependency_authority.dependencies_owned(src,base,a,m.id) THEN chosen:=m.proof;EXIT;END IF;
 END LOOP;
 IF chosen IS NULL THEN
  IF src->'legacyVersions'<>'[]' OR src->'legacyPhotos'<>'[]' OR src->'rawLegacyPhotos'<>'[]'
   OR NOT design_dependency_authority.suffix_owned(src,-1,a,null) OR NOT design_dependency_authority.dependencies_owned(src,emptybase,a,null) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MANIFEST_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('schemaVersion','design-authorized-dependency-bundle-v1','authority',a,'manifest',chosen,'sourceFingerprint',design_dependency_authority.digest(src),'workflowRows',src->'workflowRows','workflowReceipts',src->'workflowReceipts','legacyVersions',src->'legacyVersions','legacyPhotos',src->'legacyPhotos','fullRows',src->'fullRows','fullReceipts',src->'fullReceipts','mediaRows',src->'mediaRows','candidateRows',src->'candidateRows','operationAuthors',src->'operationAuthors','dependencyAuthors',src->'dependencyAuthors');
END$$;
CREATE FUNCTION design_dependency_authority.verify_refs(b jsonb,refs jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;m jsonb;n integer;BEGIN
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>300 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(refs) LOOP
  IF r->'scope' IS DISTINCT FROM b->'authority'->'scope' OR r->'store' IS DISTINCT FROM b->'authority'->'actor'->'store' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
  IF r->>'kind'='legacy_asset' THEN
   IF NOT (b->'legacyPhotos' @> jsonb_build_array(r)) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
  ELSIF r->>'kind'='private_media' THEN
   SELECT count(*) INTO n FROM jsonb_array_elements(b->'mediaRows') x WHERE x->>'media_id'=r->'reference'->>'mediaId';
   SELECT value INTO m FROM jsonb_array_elements(b->'mediaRows') x WHERE x->>'media_id'=r->'reference'->>'mediaId';
   IF n<>1 OR m->'active' IS DISTINCT FROM 'true'::jsonb OR ((m->'record')-ARRAY['requestId','binding','sha256','active']) IS DISTINCT FROM r->'reference' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
  ELSE RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
 END LOOP;
END$$;
CREATE FUNCTION design_dependency_authority.verify_candidate(b jsonb,c jsonb,r jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE ref jsonb;m jsonb;n integer;ancestor jsonb;ev jsonb;before_row jsonb;after_row jsonb;BEGIN
 IF c->'scope' IS DISTINCT FROM b->'authority'->'scope' OR c->'store' IS DISTINCT FROM b->'authority'->'actor'->'store'
 OR c->'sessionId' IS DISTINCT FROM r->'session'->'scope'->'sessionId' OR c->'baseRevision' IS DISTINCT FROM r->'session'->'revision' OR c->>'inputDigest' IS DISTINCT FROM design_dependency_authority.digest(r->'session') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
 IF jsonb_typeof(c->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'sourceRefs')>30 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(c->'sourceRefs') LOOP
  SELECT count(*) INTO n FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=ref->'mediaId';SELECT value INTO m FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=ref->'mediaId';
  IF n<>1 OR m->'active' IS DISTINCT FROM 'true'::jsonb OR m->'record'->'sha256' IS DISTINCT FROM ref->'sourceSha256' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'photoRefs') x WHERE x->>'kind'='private_media' AND x->'reference'->'mediaId'=ref->'mediaId') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
 END LOOP;
 IF c->>'kind'='completion_comparison' THEN
  SELECT value INTO before_row FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=c->'comparison'->'beforeMediaId';
  SELECT value INTO after_row FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=c->'comparison'->'afterMediaId';
  IF before_row IS NULL OR after_row IS NULL OR before_row->'record'->>'stage' IS DISTINCT FROM 'before' OR after_row->'record'->>'stage' IS DISTINCT FROM 'after' OR before_row->'record'->'angle' IS DISTINCT FROM c->'comparison'->'angle' OR after_row->'record'->'angle' IS DISTINCT FROM c->'comparison'->'angle' OR c->'comparison'->>'angle' NOT IN ('front','back','left','right') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_MEDIA_DENIED';END IF;
 ELSIF c->>'kind'='completion_synthesis' THEN
  IF jsonb_typeof(c->'synthesis'->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'synthesis'->'evidence') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  FOR ev IN SELECT value FROM jsonb_array_elements(c->'synthesis'->'evidence') LOOP
   SELECT value INTO ancestor FROM jsonb_array_elements(b->'candidateRows') x WHERE x->'candidate_id'=ev->'candidateId';
   IF ancestor IS NULL OR ancestor->'active' IS DISTINCT FROM 'true'::jsonb OR ancestor->'sha256' IS DISTINCT FROM ev->'candidateDigest' OR ancestor->'consumed'='null'::jsonb OR ancestor->'envelope'->>'kind' IS DISTINCT FROM 'completion_comparison' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'modelCandidates') x WHERE x->'candidate'=ancestor->'envelope' AND x->'acceptance'=ancestor->'consumed'->'acceptance') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  END LOOP;
 END IF;
 PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
END$$;

CREATE FUNCTION design_dependency_authority.read_bundle() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;b jsonb;f jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();b:=design_dependency_authority.checked_bundle(a);
 IF jsonb_array_length(b->'workflowRows')>0 THEN PERFORM design_dependency_authority.verify_refs(b,b->'workflowRows'->-1->'record'->'photoRefs');END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(b->'fullRows') LOOP PERFORM design_dependency_authority.verify_refs(b,f->'record'->'snapshot'->'photoRefs');END LOOP;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CHANGED';END IF;
 IF b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_EXPIRED';END IF;RETURN b;
END$$;
CREATE FUNCTION design_dependency_authority.issue_manifest(credential text,scope jsonb,request_id text,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;a jsonb;src jsonb;prior design_dependency_authority.issuer_requests%rowtype;m design_dependency_authority.manifests%rowtype;req jsonb;proof jsonb;mid text;deadline timestamptz;lastrow jsonb;BEGIN
 IF session_user<>'design_workflow_manifest_issuer' OR credential IS NULL OR length(credential) NOT BETWEEN 32 AND 200 OR credential ~ '[[:space:][:cntrl:]]' OR request_id IS NULL OR request_id !~ '^[A-Za-z0-9_-]{1,80}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 3600000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 resolved:=design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope);a:=resolved->'authority';
 req:=jsonb_build_object('reader',a,'ttlMs',ttl_ms);SELECT * INTO prior FROM design_dependency_authority.issuer_requests r WHERE r.request_id=issue_manifest.request_id;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REQUEST_CONFLICT';END IF;
  SELECT * INTO STRICT m FROM design_dependency_authority.manifests WHERE id=prior.manifest_id;RETURN jsonb_build_object('manifest',m.proof,'replayed',true);
 END IF;
 src:=design_dependency_authority.sources(a);lastrow:=src->'workflowRows'->-1;mid:='manifest-'||design_dependency_authority.digest(jsonb_build_array(a,request_id));deadline:=least(clock_timestamp()+ttl_ms*interval '1 millisecond',(resolved->>'expiresAt')::timestamptz);
 proof:=jsonb_build_object('id',mid,'revision',1,'reader',a,'baseWorkflowRevision',coalesce((lastrow->>'revision')::int,-1),'baseWorkflowSha256',lastrow->'sha256','sourceFingerprint',design_dependency_authority.digest(src),'expiresAt',floor(extract(epoch FROM deadline)*1000)::bigint,'baseDependencyDigests',design_dependency_authority.dependency_digests(src));
 INSERT INTO design_dependency_authority.manifests VALUES(mid,1,a,src,proof,deadline,true);INSERT INTO design_dependency_authority.issuer_requests VALUES(request_id,req,mid);
 RETURN jsonb_build_object('manifest',proof,'replayed',false);
END$$;
CREATE FUNCTION design_dependency_authority.revoke_manifest(manifest_id text,expected_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m design_dependency_authority.manifests%rowtype;BEGIN
 IF session_user<>'design_workflow_manifest_issuer' OR expected_revision IS NULL OR expected_revision<1 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT * INTO STRICT m FROM design_dependency_authority.manifests WHERE id=manifest_id;
 IF NOT m.active OR m.revision<>expected_revision THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 UPDATE design_dependency_authority.manifests SET active=false,revision=m.revision+1,proof=jsonb_set(m.proof,'{revision}',to_jsonb(m.revision+1)) WHERE id=manifest_id RETURNING * INTO m;RETURN jsonb_build_object('manifest',m.proof);
END$$;
CREATE FUNCTION design_dependency_authority.check_record(r jsonb,b jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb:=b->'authority';BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>(CASE WHEN r ? 'modelCandidates' THEN 9 ELSE 8 END) OR (r-ARRAY['schemaVersion','revision','scope','store','session','archives','photoRefs','legacyVersions','modelCandidates'])<>'{}'
 OR coalesce(r->>'schemaVersion','') NOT IN ('design-prepared-workflow-record-v1','design-prepared-workflow-record-v2') OR (r->>'schemaVersion'='design-prepared-workflow-record-v2') IS DISTINCT FROM (r ? 'modelCandidates') OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store'
 OR r->'legacyVersions' IS DISTINCT FROM b->'legacyVersions' OR jsonb_typeof(r->'photoRefs') IS DISTINCT FROM 'array'
 OR jsonb_typeof(r->'session') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r->'session'))<>7 OR ((r->'session')-ARRAY['schemaVersion','scope','revision','phase','sources','entries','journal'])<>'{}'
 OR jsonb_typeof(r->'session'->'schemaVersion') IS DISTINCT FROM 'string' OR r->'session'->>'schemaVersion' NOT IN ('design-pilot-local-v1','design-pilot-local-v2') OR jsonb_typeof(r->'session'->'scope') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r->'session'->'scope'))<>3
 OR r->'session'->'scope'->'customerId' IS DISTINCT FROM a->'scope'->'customerProfileId' OR r->'session'->'scope'->'visitId' IS DISTINCT FROM a->'scope'->'visitId'
 OR jsonb_typeof(r->'session'->'scope'->'sessionId') IS DISTINCT FROM 'string' OR (r->'session'->'scope'->>'sessionId') !~ '^[A-Za-z0-9:_-]{1,160}$'
 OR jsonb_typeof(r->'archives') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'session'->'journal') IS DISTINCT FROM 'array'
 OR r->'session'->'revision' IS DISTINCT FROM to_jsonb(jsonb_array_length(r->'session'->'journal')) OR jsonb_array_length(r->'session'->'journal')>1000 OR octet_length(r::text)>33554432 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
END$$;
CREATE FUNCTION design_dependency_authority.initialize_native(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;r jsonb;a jsonb;sha text;sk text;BEGIN
 b:=design_dependency_authority.read_bundle();a:=b->'authority';r:=q->'record';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR (q-ARRAY['expectedSourceFingerprint','record','recordSha256'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR b->'workflowRows'<>'[]' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 PERFORM design_dependency_authority.check_record(r,b);sha:=design_dependency_authority.digest(r);sk:=design_dependency_authority.digest(a->'scope');
 IF r ? 'modelCandidates' OR r->'photoRefs' IS DISTINCT FROM b->'legacyPhotos' OR q->>'recordSha256' IS DISTINCT FROM sha OR r->'revision' IS DISTINCT FROM '0'::jsonb OR r->'archives'<>'[]' OR r->'session'->'revision' IS DISTINCT FROM '0'::jsonb OR r->'session'->>'phase' IS DISTINCT FROM 'before_analysis' OR r->'session'->'sources'<>'[]' OR r->'session'->'entries'<>'[]' OR r->'session'->'journal'<>'[]' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.workflow_versions VALUES(sk,0,r,sha,null,null);
 INSERT INTO design_dependency_authority.operation_authors VALUES(sk,0,null,a,sha,null,b->'manifest'->>'id');
 PERFORM design_dependency_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.append_text(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;oldrow jsonb;oldr jsonb;r jsonb;rc jsonb;req jsonb;intent jsonb;kind text;rid text;k text;sha text;sk text;prior integer;cnt integer;j jsonb;event_type text;suffix text;idx integer;entry jsonb;oldentry jsonb;BEGIN
 b:=design_dependency_authority.read_bundle();a:=b->'authority';oldrow:=b->'workflowRows'->-1;oldr:=oldrow->'record';r:=q->'record';rc:=q->'receipt';req:=rc->'request';intent:=req->'intent';kind:=intent->>'type';rid:=req->>'requestId';k:=q->>'receiptKey';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>6 OR (q-ARRAY['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt'])<>'{}'
 OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR oldrow IS NULL OR q->'expectedRevision' IS DISTINCT FROM oldrow->'revision' OR jsonb_array_length(b->'workflowRows')>=1001 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 PERFORM design_dependency_authority.check_record(r,b);
 IF r->'photoRefs' IS DISTINCT FROM oldr->'photoRefs' OR r->'modelCandidates' IS DISTINCT FROM oldr->'modelCandidates' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 sha:=design_dependency_authority.digest(r);sk:=design_dependency_authority.digest(a->'scope');
 IF q->>'recordSha256' IS DISTINCT FROM sha OR r->'revision' IS DISTINCT FROM to_jsonb((oldr->>'revision')::int+1) OR r->'session'->'scope' IS DISTINCT FROM oldr->'session'->'scope' OR r->'session'->'schemaVersion' IS DISTINCT FROM oldr->'session'->'schemaVersion'
 OR jsonb_typeof(rc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(rc))<>5 OR (rc-ARRAY['fingerprint','scope','actor','appliedRevision','request'])<>'{}'
 OR rc->'scope' IS DISTINCT FROM a->'scope' OR rc->'actor' IS DISTINCT FROM a->'actor' OR rc->'appliedRevision' IS DISTINCT FROM r->'revision'
 OR jsonb_typeof(req) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(req))<>3 OR (req-ARRAY['requestId','expectedRevision','intent'])<>'{}' OR req->'expectedRevision' IS DISTINCT FROM oldr->'revision'
 OR rid IS NULL OR rid !~ '^[A-Za-z0-9_-]{1,80}$' OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'actor',rid))
 OR rc->>'fingerprint' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('scope',a->'scope')||req)
 OR kind IS NULL OR kind NOT IN ('record_source','record_note','advance','create_group','record_context','record_technique','record_review','confirm_entry','archive','reopen')
 OR NOT design_dependency_authority.prefix(oldr->'session'->'journal',r->'session'->'journal') OR NOT design_dependency_authority.prefix(oldr->'session'->'sources',r->'session'->'sources') OR NOT design_dependency_authority.prefix(oldr->'archives',r->'archives') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM design_private.workflow_receipts WHERE request_key=k) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_RECEIPT_CONFLICT';END IF;
 prior:=jsonb_array_length(oldr->'session'->'journal');cnt:=jsonb_array_length(r->'session'->'journal')-prior;
 IF cnt<>(CASE WHEN kind='confirm_entry' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 FOR idx IN 0..cnt-1 LOOP
  j:=r->'session'->'journal'->(prior+idx);event_type:=j->'event'->>'type';
  suffix:=CASE WHEN kind IN ('record_source','record_note') OR kind='confirm_entry' AND idx=0 THEN 'source' WHEN kind IN ('create_group','record_context','record_technique','record_review') THEN 'entry' WHEN kind='advance' THEN 'phase' WHEN kind='confirm_entry' THEN 'confirm' ELSE kind END;
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(j))<>4 OR (j-ARRAY['requestId','expectedRevision','scope','event'])<>'{}' OR j->'scope' IS DISTINCT FROM r->'session'->'scope' OR j->'expectedRevision' IS DISTINCT FROM to_jsonb(prior+idx) OR j->>'requestId' IS DISTINCT FROM rid||'-'||suffix
  OR event_type IS DISTINCT FROM (CASE suffix WHEN 'source' THEN 'source_recorded' WHEN 'entry' THEN 'entry_recorded' WHEN 'phase' THEN 'phase_advanced' WHEN 'confirm' THEN 'entry_confirmed' WHEN 'archive' THEN 'phase_advanced' WHEN 'reopen' THEN 'revision_opened' END) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  IF suffix='source' THEN
   IF j->'event'->'source' IS DISTINCT FROM jsonb_build_object('messageId',CASE WHEN kind='record_source' THEN 'source:'||rid WHEN kind='record_note' THEN 'note:'||(intent->>'field')||':'||rid ELSE 'confirmation:'||rid END,'kind',CASE WHEN kind='record_source' THEN intent->>'kind' ELSE 'text' END,'actor','employee','text',intent->'text') OR j->'event'->'source'->>'kind' NOT IN ('text','speech_transcript') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  ELSIF suffix='entry' THEN
   IF j->'event'->'entry'->>'id' IS DISTINCT FROM 'entry:'||rid OR j->'event'->'entry'->>'origin' IS DISTINCT FROM 'extraction' OR j->'event'->'entry'->>'basis' IS DISTINCT FROM 'said' OR j->'event'->'entry'->>'field' LIKE 'model_%' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  ELSIF suffix='phase' AND j->'event'->'phase' IS DISTINCT FROM intent->'phase' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';
  ELSIF suffix='archive' AND j->'event'->>'phase' IS DISTINCT FROM 'archive' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';
  ELSIF suffix='confirm' AND j->'event'->'entryId' IS DISTINCT FROM intent->'entryId' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';
  ELSIF suffix='reopen' AND (j->'event'->'resumePhase' IS DISTINCT FROM intent->'resumePhase' OR j->'event'->'reasonSource' IS DISTINCT FROM jsonb_build_object('messageId','revision:'||rid,'kind','text','actor','employee','text',intent->'reason')) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 END LOOP;
 -- Old entries may change only by the explicit confirmation command; original
 -- values, source provenance and all other old entries remain byte-equivalent.
 IF jsonb_array_length(r->'session'->'entries')<>jsonb_array_length(oldr->'session'->'entries')+(CASE WHEN kind IN ('create_group','record_context','record_technique','record_review') THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 FOR oldentry,idx IN SELECT value,ordinality::int-1 FROM jsonb_array_elements(oldr->'session'->'entries') WITH ORDINALITY LOOP
  entry:=r->'session'->'entries'->idx;
  IF kind='confirm_entry' AND oldentry->'id'=intent->'entryId' THEN
   IF (entry-ARRAY['status','confirmation']) IS DISTINCT FROM (oldentry-ARRAY['status','confirmation']) OR entry->>'status' IS DISTINCT FROM 'confirmed' OR oldentry->>'status' IS DISTINCT FROM 'not_confirmed' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  ELSIF entry IS DISTINCT FROM oldentry THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 END LOOP;
 IF kind='archive' THEN
  IF r->'session'->>'phase' IS DISTINCT FROM 'archive' OR jsonb_array_length(r->'archives')<>jsonb_array_length(oldr->'archives')+1 OR r->'archives'->-1->'snapshot' IS DISTINCT FROM r->'session' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 ELSIF r->'archives' IS DISTINCT FROM oldr->'archives' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 IF kind='reopen' AND (oldr->'session'->>'phase' IS DISTINCT FROM 'archive' OR r->'session'->'journal'->-1->'event'->'parentArchiveRevision' IS DISTINCT FROM oldr->'session'->'revision') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.workflow_versions VALUES(sk,(r->>'revision')::int,r,sha,oldrow->>'sha256',k);
 INSERT INTO design_private.workflow_receipts VALUES(k,rc,sha);
 INSERT INTO design_dependency_authority.operation_authors VALUES(sk,(r->>'revision')::int,k,a,sha,oldrow->>'sha256',b->'manifest'->>'id');
 PERFORM design_dependency_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.guard_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR current_user<>'design_dependency_issuer_capability' OR NOT OLD.active OR NEW.active OR NEW.revision<>OLD.revision+1 OR (to_jsonb(NEW)-ARRAY['active','revision','proof']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','revision','proof']) OR NEW.proof IS DISTINCT FROM jsonb_set(OLD.proof,'{revision}',to_jsonb(NEW.revision)) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_IMMUTABLE';END IF;RETURN NEW;
END$$;
CREATE TRIGGER workflow_manifest_revoke_only BEFORE UPDATE OR DELETE ON design_dependency_authority.manifests FOR EACH ROW EXECUTE FUNCTION design_dependency_authority.guard_manifest();
CREATE TRIGGER workflow_author_immutable BEFORE UPDATE OR DELETE ON design_dependency_authority.operation_authors FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
CREATE TRIGGER workflow_issuer_request_immutable BEFORE UPDATE OR DELETE ON design_dependency_authority.issuer_requests FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
CREATE FUNCTION design_dependency_authority.insert_media(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;r jsonb;a jsonb;sk text;bk text;sha text;BEGIN
 b:=design_dependency_authority.read_bundle();a:=b->'authority';r:=q->'record';sk:=design_dependency_authority.digest(a->'scope');
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR (q-ARRAY['expectedSourceFingerprint','record','recordSha256'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>11 OR (r-ARRAY['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active'])<>'{}' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 IF r->'binding' IS DISTINCT FROM jsonb_build_object('owner',a->'actor'->'username','store',a->'actor'->'store','scope',a->'scope') OR r->'requestId' IS DISTINCT FROM r->'mediaId' OR jsonb_typeof(r->'mediaId') IS DISTINCT FROM 'string' OR r->>'mediaId' !~ '^[A-Za-z0-9_-]{1,100}$'
 OR r->'active' IS DISTINCT FROM 'true'::jsonb OR coalesce(r->>'stage','') NOT IN ('before','after','reference') OR coalesce(r->>'angle','') NOT IN ('front','back','left','right','detail') OR coalesce(r->>'mime','') NOT IN ('image/jpeg','image/png','image/webp') OR coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$'
 OR jsonb_typeof(r->'byteLength') IS DISTINCT FROM 'number' OR r->>'byteLength' !~ '^[1-9][0-9]{0,7}$' OR (r->>'byteLength')::bigint>8388608 OR jsonb_typeof(r->'width') IS DISTINCT FROM 'number' OR r->>'width' !~ '^[1-9][0-9]{0,4}$' OR (r->>'width')::bigint>16384 OR jsonb_typeof(r->'height') IS DISTINCT FROM 'number' OR r->>'height' !~ '^[1-9][0-9]{0,4}$' OR (r->>'height')::bigint>16384 OR (r->>'width')::bigint*(r->>'height')::bigint>40000000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 sha:=design_dependency_authority.digest(r);bk:=design_dependency_authority.digest(r->'binding');IF q->>'recordSha256' IS DISTINCT FROM sha THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.media_records VALUES(bk,r->>'mediaId',r,sha);INSERT INTO design_private.media_access VALUES(bk,r->>'mediaId',true,1);
 INSERT INTO design_dependency_authority.dependency_authors VALUES(sk,'media',bk||':'||(r->>'mediaId'),a,sha,b->'manifest'->>'id');PERFORM design_dependency_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.publish_candidate(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;c jsonb;r jsonb;sha text;sk text;deadline timestamptz;BEGIN
 b:=design_dependency_authority.read_bundle();a:=b->'authority';c:=q->'candidate';r:=b->'workflowRows'->-1->'record';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>4 OR (q-ARRAY['expectedSourceFingerprint','candidate','candidateSha256','ttlMs'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR r IS NULL THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 IF jsonb_typeof(q->'ttlMs') IS DISTINCT FROM 'number' OR q->>'ttlMs' !~ '^[1-9][0-9]{0,6}$' OR (q->>'ttlMs')::bigint>3600000 OR c->'actor' IS DISTINCT FROM a->'actor' OR coalesce(c->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' OR c->>'schemaVersion' IS DISTINCT FROM 'design-model-candidate-v1' OR coalesce(c->>'kind','') NOT IN ('text_extraction','visual_description','completion_comparison','completion_synthesis') OR octet_length(c::text)>524288 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>(CASE WHEN c->>'kind' IN ('completion_comparison','completion_synthesis') THEN 16 ELSE 15 END) OR (c-ARRAY['schemaVersion','id','kind','scope','store','actor','sessionId','baseRevision','inputDigest','payloadDigest','model','promptVersion','sourceRefs','descriptionSources','candidate',CASE WHEN c->>'kind'='completion_comparison' THEN 'comparison' WHEN c->>'kind'='completion_synthesis' THEN 'synthesis' ELSE 'schemaVersion' END])<>'{}' OR jsonb_typeof(c->'descriptionSources') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'candidate'->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'candidate'->'entries')>100 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 PERFORM design_dependency_authority.verify_candidate(b,c,r);sha:=design_dependency_authority.digest(c);sk:=design_dependency_authority.digest(a->'scope');IF q->>'candidateSha256' IS DISTINCT FROM sha THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 deadline:=clock_timestamp()+(q->>'ttlMs')::bigint*interval '1 millisecond';
 INSERT INTO design_private.model_candidates VALUES(c->>'id',sk,c,sha,deadline);INSERT INTO design_private.model_candidate_access VALUES(c->>'id',true,1);
 INSERT INTO design_dependency_authority.dependency_authors VALUES(sk,'candidate',c->>'id',a,sha,b->'manifest'->>'id');PERFORM design_dependency_authority.read_bundle();RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.append_native(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;r jsonb;oldr jsonb;oldrow jsonb;rc jsonb;req jsonb;intent jsonb;kind text;k text;sha text;sk text;added jsonb;c jsonb;accepted jsonb;proof jsonb;consumed jsonb;j jsonb;idx integer;prior integer;selected jsonb;expected_session jsonb;source jsonb;entry jsonb;ev jsonb;expected_journal jsonb;BEGIN
 kind:=q->'receipt'->'request'->'intent'->>'type';
 IF coalesce(kind,'') NOT IN ('attach_media','accept_model_candidate') THEN RETURN design_dependency_authority.append_text(q);END IF;
 b:=design_dependency_authority.read_bundle();a:=b->'authority';oldrow:=b->'workflowRows'->-1;oldr:=oldrow->'record';r:=q->'record';rc:=q->'receipt';req:=rc->'request';intent:=req->'intent';k:=q->>'receiptKey';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>6 OR (q-ARRAY['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR oldrow IS NULL OR q->'expectedRevision' IS DISTINCT FROM oldrow->'revision' OR jsonb_array_length(b->'workflowRows')>=1001 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 PERFORM design_dependency_authority.check_record(r,b);sha:=design_dependency_authority.digest(r);sk:=design_dependency_authority.digest(a->'scope');
 IF q->>'recordSha256' IS DISTINCT FROM sha OR r->'revision' IS DISTINCT FROM to_jsonb((oldr->>'revision')::int+1) OR r->'session'->'scope' IS DISTINCT FROM oldr->'session'->'scope' OR r->'archives' IS DISTINCT FROM oldr->'archives'
 OR jsonb_typeof(rc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(rc))<>5 OR (rc-ARRAY['fingerprint','scope','actor','appliedRevision','request'])<>'{}' OR rc->'scope' IS DISTINCT FROM a->'scope' OR rc->'actor' IS DISTINCT FROM a->'actor' OR rc->'appliedRevision' IS DISTINCT FROM r->'revision'
 OR jsonb_typeof(req) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(req))<>3 OR (req-ARRAY['requestId','expectedRevision','intent'])<>'{}' OR req->'expectedRevision' IS DISTINCT FROM oldr->'revision' OR coalesce(req->>'requestId','') !~ '^[A-Za-z0-9_-]{1,80}$'
 OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'actor',req->'requestId')) OR rc->>'fingerprint' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('scope',a->'scope')||req)
 OR NOT design_dependency_authority.prefix(oldr->'session'->'journal',r->'session'->'journal') OR NOT design_dependency_authority.prefix(oldr->'session'->'sources',r->'session'->'sources') OR NOT design_dependency_authority.prefix(oldr->'session'->'entries',r->'session'->'entries') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM design_private.workflow_receipts WHERE request_key=k) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_RECEIPT_CONFLICT';END IF;
 IF kind='attach_media' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(intent))<>2 OR (intent-ARRAY['type','mediaIds'])<>'{}' OR r->'session' IS DISTINCT FROM oldr->'session' OR r->'modelCandidates' IS DISTINCT FROM oldr->'modelCandidates' OR NOT design_dependency_authority.prefix(oldr->'photoRefs',r->'photoRefs') OR jsonb_typeof(intent->'mediaIds') IS DISTINCT FROM 'array' OR jsonb_array_length(intent->'mediaIds')<1 OR jsonb_array_length(r->'photoRefs')-jsonb_array_length(oldr->'photoRefs')<>jsonb_array_length(intent->'mediaIds') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  FOR idx IN 0..jsonb_array_length(intent->'mediaIds')-1 LOOP
   added:=r->'photoRefs'->(jsonb_array_length(oldr->'photoRefs')+idx);
   IF added->>'kind' IS DISTINCT FROM 'private_media' OR added->'reference'->'mediaId' IS DISTINCT FROM intent->'mediaIds'->idx THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  END LOOP;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(intent))<>3 OR (intent-ARRAY['type','candidateId','selectedIndices'])<>'{}' OR r->'photoRefs' IS DISTINCT FROM oldr->'photoRefs' OR r->>'schemaVersion' IS DISTINCT FROM 'design-prepared-workflow-record-v2' OR NOT design_dependency_authority.prefix(coalesce(oldr->'modelCandidates','[]'),r->'modelCandidates') OR jsonb_array_length(r->'modelCandidates')<>jsonb_array_length(coalesce(oldr->'modelCandidates','[]'))+1 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  SELECT value INTO c FROM jsonb_array_elements(b->'candidateRows') x WHERE x->'candidate_id'=intent->'candidateId';
  SELECT value INTO proof FROM jsonb_array_elements(b->'dependencyAuthors') x WHERE x->>'kind'='candidate' AND x->'id'=intent->'candidateId';
  -- A read manifest is never an ownership grant for an old pending candidate.
  IF c IS NULL OR proof IS NULL OR proof->'authority' IS DISTINCT FROM a OR proof->'sha256' IS DISTINCT FROM c->'sha256' OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->'consumed' IS DISTINCT FROM 'null'::jsonb OR (c->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  PERFORM design_dependency_authority.verify_candidate(b,c->'envelope',oldr);accepted:=r->'modelCandidates'->-1;
  IF accepted->'candidate' IS DISTINCT FROM c->'envelope' OR accepted->'acceptance'->'workflowRevision' IS DISTINCT FROM r->'revision' OR accepted->'acceptance'->'requestId' IS DISTINCT FROM req->'requestId'
  OR accepted->'acceptance'->'receipt'->'candidateId' IS DISTINCT FROM c->'candidate_id' OR accepted->'acceptance'->'receipt'->'candidateDigest' IS DISTINCT FROM c->'sha256' OR accepted->'acceptance'->'receipt'->'baseRevision' IS DISTINCT FROM oldr->'session'->'revision' OR accepted->'acceptance'->'receipt'->'resultRevision' IS DISTINCT FROM r->'session'->'revision' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  IF jsonb_typeof(intent->'selectedIndices') IS DISTINCT FROM 'array' OR jsonb_array_length(intent->'selectedIndices') NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(intent->'selectedIndices') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'number' OR x::text !~ '^(0|[1-9][0-9]{0,2})$' OR (x::text)::int>=jsonb_array_length(c->'envelope'->'candidate'->'entries')) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  SELECT jsonb_agg(x ORDER BY (x::text)::int) INTO selected FROM jsonb_array_elements(intent->'selectedIndices') x;
  IF (SELECT count(DISTINCT x) FROM jsonb_array_elements(selected) x)<>jsonb_array_length(selected) OR accepted->'acceptance'->'receipt'->'selectedIndices' IS DISTINCT FROM selected THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  expected_session:=oldr->'session';
  FOR idx IN SELECT (value::text)::int FROM jsonb_array_elements(selected) LOOP
   source:=c->'envelope'->'descriptionSources'->idx;
   IF source IS NOT NULL THEN
    ev:=jsonb_build_object('type','source_recorded','source',source);
    j:=jsonb_build_object('requestId',(req->>'requestId')||'-source-'||idx,'expectedRevision',expected_session->'revision','scope',expected_session->'scope','event',ev);
    expected_session:=jsonb_set(jsonb_set(jsonb_set(expected_session,'{sources}',(expected_session->'sources')||jsonb_build_array(source)),'{journal}',(expected_session->'journal')||jsonb_build_array(j)),'{revision}',to_jsonb((expected_session->>'revision')::int+1));
   END IF;
   entry:=c->'envelope'->'candidate'->'entries'->idx;
   IF coalesce(entry->>'status','') NOT IN ('unknown','not_confirmed') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
   ev:=jsonb_build_object('type','entry_recorded','entry',entry);j:=jsonb_build_object('requestId',(req->>'requestId')||'-entry-'||idx,'expectedRevision',expected_session->'revision','scope',expected_session->'scope','event',ev);
   expected_session:=jsonb_set(jsonb_set(jsonb_set(expected_session,'{entries}',(expected_session->'entries')||jsonb_build_array(entry||jsonb_build_object('confirmation',null))),'{journal}',(expected_session->'journal')||jsonb_build_array(j)),'{revision}',to_jsonb((expected_session->>'revision')::int+1));
  END LOOP;
  IF r->'session' IS DISTINCT FROM expected_session THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  consumed:=jsonb_build_object('scope',a->'scope','candidateId',c->'candidate_id','candidateDigest',c->'sha256','receiptKey',k,'acceptance',accepted->'acceptance');
  prior:=jsonb_array_length(oldr->'session'->'journal');
  IF jsonb_array_length(r->'session'->'journal')<=prior THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  FOR idx IN prior..jsonb_array_length(r->'session'->'journal')-1 LOOP
   j:=r->'session'->'journal'->idx;
   IF j->'scope' IS DISTINCT FROM oldr->'session'->'scope' OR j->'expectedRevision' IS DISTINCT FROM to_jsonb(idx) OR coalesce(j->>'requestId','') NOT LIKE (req->>'requestId')||'-%' OR coalesce(j->'event'->>'type','') NOT IN ('source_recorded','entry_recorded') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
  END LOOP;
 END IF;
 PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
 INSERT INTO design_private.workflow_versions VALUES(sk,(r->>'revision')::int,r,sha,oldrow->>'sha256',k);INSERT INTO design_private.workflow_receipts VALUES(k,rc,sha);
 INSERT INTO design_dependency_authority.operation_authors VALUES(sk,(r->>'revision')::int,k,a,sha,oldrow->>'sha256',b->'manifest'->>'id');
 IF kind='accept_model_candidate' THEN
  IF (c->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  INSERT INTO design_private.model_candidate_acceptances VALUES(c->>'candidate_id',consumed);
  INSERT INTO design_private.commit_checks VALUES(gen_random_uuid(),to_timestamp((c->>'expiresAt')::numeric/1000));
 END IF;
 b:=design_dependency_authority.read_bundle();
 IF kind='accept_model_candidate' THEN
  IF (c->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'candidateRows') x WHERE x->'candidate_id'=c->'candidate_id' AND x->'active'='true'::jsonb) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
  PERFORM design_dependency_authority.verify_candidate(b,c->'envelope',oldr);
  IF (c->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANDIDATE_DENIED';END IF;
 END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CHANGED';END IF;RETURN true;
END$$;
CREATE FUNCTION design_dependency_authority.append_full(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;v jsonb;rc jsonb;head jsonb;r jsonb;sn jsonb;k text;sha text;sk text;expected_rc jsonb;BEGIN
 b:=design_dependency_authority.read_bundle();a:=b->'authority';v:=q->'version';rc:=q->'receipt';head:=b->'fullRows'->-1;r:=b->'workflowRows'->-1->'record';sn:=v->'snapshot';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>5 OR (q-ARRAY['expectedSourceFingerprint','expectedVersion','expectedParentDigest','version','receipt'])<>'{}' OR q->'expectedSourceFingerprint' IS DISTINCT FROM b->'sourceFingerprint' OR r IS NULL OR q->'expectedVersion' IS DISTINCT FROM coalesce(head->'version','0') OR q->'expectedParentDigest' IS DISTINCT FROM coalesce(head->'sha256','null') OR jsonb_array_length(b->'fullRows')>=100 THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_REVISION_CONFLICT';END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>10 OR (v-ARRAY['schemaVersion','version','previous','scope','actor','requestId','createdAt','bindingRevision','snapshot','sha256'])<>'{}'
 OR v->>'schemaVersion' IS DISTINCT FROM 'design-full-workflow-version-v1' OR coalesce(sn->>'schemaVersion','') NOT IN ('design-full-workflow-snapshot-v1','design-full-workflow-snapshot-v2') OR sn->>'mappingPolicy' IS DISTINCT FROM 'parallel-native-snapshots-no-inference' OR v->'scope' IS DISTINCT FROM a->'scope' OR v->'actor' IS DISTINCT FROM a->'actor' OR v->'bindingRevision' IS DISTINCT FROM a->'bindingRevision' OR v->'version' IS DISTINCT FROM to_jsonb(coalesce((head->>'version')::int,0)+1)
 OR v->'previous' IS DISTINCT FROM (CASE WHEN head IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('version',head->'version','sha256',head->'sha256') END) OR coalesce(v->>'requestId','') !~ '^[A-Za-z0-9_-]{1,80}$'
 OR sn->'scope' IS DISTINCT FROM a->'scope' OR sn->'store' IS DISTINCT FROM a->'actor'->'store' OR sn->'evidence' IS DISTINCT FROM jsonb_build_object('session',r->'session','archives',r->'archives') OR sn->'ui' IS DISTINCT FROM 'null'::jsonb OR sn->'bindings' IS DISTINCT FROM jsonb_build_object('uiScope',null,'evidenceScope',r->'session'->'scope') OR sn->'legacyVersions' IS DISTINCT FROM r->'legacyVersions' OR sn->'photoRefs' IS DISTINCT FROM r->'photoRefs' OR sn->'modelCandidates' IS DISTINCT FROM r->'modelCandidates'
 OR sn->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(sn-'sha256') THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 sha:=design_dependency_authority.digest(v-'sha256');IF v->>'sha256' IS DISTINCT FROM sha THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 PERFORM design_dependency_authority.verify_refs(b,sn->'photoRefs');k:=design_dependency_authority.digest(jsonb_build_array(a->'actor',v->'requestId'));sk:=design_dependency_authority.digest(a->'scope');
 expected_rc:=jsonb_build_object('requestKey',k,'fingerprint',design_dependency_authority.digest(jsonb_build_object('actor',a->'actor','scope',a->'scope','requestId',v->'requestId','expectedVersion',q->'expectedVersion','expectedParentDigest',q->'expectedParentDigest','snapshotSha256',sn->'sha256')),'scope',a->'scope','version',v->'version','sha256',v->'sha256');
 IF rc IS DISTINCT FROM expected_rc THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END IF;
 INSERT INTO design_private.full_versions VALUES(sk,(v->>'version')::int,v,sha);INSERT INTO design_private.full_receipts VALUES(k,rc);
 INSERT INTO design_dependency_authority.dependency_authors VALUES(sk,'full',v->>'version',a,sha,b->'manifest'->>'id');PERFORM design_dependency_authority.read_bundle();RETURN true;
END$$;
CREATE TRIGGER dependency_author_immutable BEFORE UPDATE OR DELETE ON design_dependency_authority.dependency_authors FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
ALTER FUNCTION design_dependency_authority.canonical(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.digest(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.prefix(jsonb,jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.text_only(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.sources(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.suffix_owned(jsonb,integer,jsonb,text) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.dependency_digests(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.dependencies_owned(jsonb,jsonb,jsonb,text) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.checked_bundle(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.verify_refs(jsonb,jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.verify_candidate(jsonb,jsonb,jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.read_bundle() OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.issue_manifest(text,jsonb,text,bigint) OWNER TO design_dependency_issuer_capability;
ALTER FUNCTION design_dependency_authority.revoke_manifest(text,bigint) OWNER TO design_dependency_issuer_capability;
ALTER FUNCTION design_dependency_authority.check_record(jsonb,jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.initialize_native(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.append_text(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.guard_manifest() OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.insert_media(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.publish_candidate(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.append_native(jsonb) OWNER TO design_dependency_capability;
ALTER FUNCTION design_dependency_authority.append_full(jsonb) OWNER TO design_dependency_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_dependency_authority FROM PUBLIC,anon,authenticated,design_identity_runtime,design_workflow_manifest_issuer;
REVOKE ALL ON ALL TABLES IN SCHEMA design_dependency_authority FROM PUBLIC,anon,authenticated,design_identity_runtime,design_workflow_manifest_issuer;
GRANT EXECUTE ON FUNCTION design_dependency_authority.sources(jsonb),design_dependency_authority.digest(jsonb),design_dependency_authority.canonical(jsonb),design_dependency_authority.dependency_digests(jsonb) TO design_dependency_issuer_capability;
GRANT EXECUTE ON FUNCTION design_dependency_authority.read_bundle(),design_dependency_authority.initialize_native(jsonb),design_dependency_authority.append_native(jsonb),design_dependency_authority.insert_media(jsonb),design_dependency_authority.publish_candidate(jsonb),design_dependency_authority.append_full(jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_dependency_authority.issue_manifest(text,jsonb,text,bigint),design_dependency_authority.revoke_manifest(text,bigint) TO design_workflow_manifest_issuer;
REVOKE CREATE ON SCHEMA design_dependency_authority FROM design_dependency_capability,design_dependency_issuer_capability;
-- First-accept deadline uses the existing same-transaction deferred check. The
-- documented arbitrary-SQL SET CONSTRAINTS early-check limitation remains.
-- Complete pure replay/provenance validators remain mandatory in trusted JS;
-- this SQL never asserts a model result is true or rewrites historical authors.
