-- ISOLATED SYNTHETIC PG17 FIXTURE ONLY. Never a production migration/installer.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only'
 OR current_setting('server_version_num')::integer/10000<>17 OR to_regclass('design_identity.transaction_contexts') IS NULL
 OR to_regclass('design_private.model_candidates') IS NULL OR to_regnamespace('design_artifact') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_ARTIFACT_FIXTURE_REQUIRED';END IF;
END$$;
CREATE ROLE design_artifact_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_artifact_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_artifact_issuer_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- No password: this LOGIN is usable only in the disposable trust fixture.
CREATE ROLE design_artifact_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_artifact_issuer;
CREATE SCHEMA design_artifact AUTHORIZATION design_artifact_owner;
REVOKE ALL ON SCHEMA design_artifact FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_artifact TO design_identity_runtime,design_artifact_capability,design_artifact_issuer_capability,design_artifact_issuer;
GRANT CREATE ON SCHEMA design_artifact TO design_artifact_capability,design_artifact_issuer_capability;
CREATE TABLE design_artifact.attestations (
 id text PRIMARY KEY CHECK(id ~ '^att-[A-Za-z0-9_-]{1,100}$'),
 artifact jsonb NOT NULL CHECK(jsonb_typeof(artifact)='object'),
 reader jsonb NOT NULL CHECK(jsonb_typeof(reader)='object'),
 source_item jsonb NOT NULL CHECK(jsonb_typeof(source_item)='object'),
 proof jsonb NOT NULL CHECK(jsonb_typeof(proof)='object'),
 UNIQUE(artifact,reader)
);
CREATE TABLE design_artifact.issuer_requests (request_id text PRIMARY KEY, request jsonb NOT NULL, attestation_id text NOT NULL REFERENCES design_artifact.attestations(id));
ALTER TABLE design_artifact.attestations OWNER TO design_artifact_owner;
ALTER TABLE design_artifact.issuer_requests OWNER TO design_artifact_owner;
ALTER TABLE design_artifact.attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_artifact.attestations FORCE ROW LEVEL SECURITY;
ALTER TABLE design_artifact.issuer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_artifact.issuer_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA design_artifact FROM PUBLIC,anon,authenticated,design_identity_runtime,design_artifact_issuer;
GRANT SELECT,UPDATE(id) ON design_artifact.attestations TO design_artifact_capability;
GRANT SELECT,INSERT,UPDATE(proof) ON design_artifact.attestations TO design_artifact_issuer_capability;
GRANT SELECT,INSERT,UPDATE(request_id) ON design_artifact.issuer_requests TO design_artifact_issuer_capability;
CREATE POLICY artifact_issuer ON design_artifact.attestations TO design_artifact_issuer_capability USING(true) WITH CHECK(true);
CREATE POLICY artifact_issuer_requests ON design_artifact.issuer_requests TO design_artifact_issuer_capability USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA design_identity,design_private TO design_artifact_capability,design_artifact_issuer_capability;
GRANT EXECUTE ON FUNCTION design_identity.require_authority() TO design_artifact_capability;
-- Function owners are neither table owners nor BYPASSRLS. Runtime gets no direct source-table grants.
GRANT SELECT,UPDATE(media_id) ON design_private.media_records,design_private.media_access TO design_artifact_capability;
GRANT SELECT,UPDATE(candidate_id) ON design_private.model_candidates,design_private.model_candidate_access TO design_artifact_capability;
GRANT SELECT,UPDATE(version) ON design_private.full_versions TO design_artifact_capability;
GRANT SELECT,UPDATE(subject_id) ON design_identity.subjects TO design_artifact_issuer_capability;
GRANT SELECT,UPDATE(employment_id) ON design_identity.employments TO design_artifact_issuer_capability;
GRANT SELECT,UPDATE(membership_id) ON design_identity.memberships TO design_artifact_issuer_capability;
GRANT SELECT,UPDATE(store_id) ON design_identity.stores TO design_artifact_issuer_capability;
GRANT SELECT,UPDATE(visit_id) ON design_identity.visit_bindings TO design_artifact_issuer_capability;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['subjects','employments','memberships','stores','visit_bindings'] LOOP
 EXECUTE format('CREATE POLICY artifact_issuer_read ON design_identity.%I FOR SELECT TO design_artifact_issuer_capability USING(true)',t);
 EXECUTE format('CREATE POLICY artifact_issuer_lock ON design_identity.%I FOR UPDATE TO design_artifact_issuer_capability USING(true) WITH CHECK(true)',t);
END LOOP;END$$;
CREATE FUNCTION design_artifact.reader_of(a jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('subjectId',a->'subjectId','employmentId',a->'employmentId','membershipId',a->'membershipId','storeId',a->'storeId','securityEpoch',a->'securityEpoch','membershipRevision',a->'membershipRevision','bindingRevision',a->'bindingRevision')
$$;
CREATE FUNCTION design_artifact.proof_visible(a jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_authority jsonb;BEGIN current_authority:=design_identity.require_authority();RETURN a->'scope'=current_authority->'scope' AND r=design_artifact.reader_of(current_authority);END$$;
CREATE POLICY artifact_runtime_read ON design_artifact.attestations FOR SELECT TO design_artifact_capability USING(design_artifact.proof_visible(artifact,reader));
CREATE POLICY artifact_runtime_lock ON design_artifact.attestations FOR UPDATE TO design_artifact_capability USING(design_artifact.proof_visible(artifact,reader)) WITH CHECK(false);
CREATE FUNCTION design_artifact.immutable_proof() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR current_user<>'design_artifact_issuer_capability' THEN RAISE EXCEPTION 'ARTIFACT_IMMUTABLE';END IF;
 IF (to_jsonb(NEW)-'proof') IS DISTINCT FROM (to_jsonb(OLD)-'proof') OR OLD.proof->'active' IS DISTINCT FROM 'true'::jsonb OR NEW.proof->'active' IS DISTINCT FROM 'false'::jsonb
 OR NEW.proof->>'revision' IS DISTINCT FROM (((OLD.proof->>'revision')::bigint+1)::text)
 OR (NEW.proof-ARRAY['active','revision']) IS DISTINCT FROM (OLD.proof-ARRAY['active','revision']) THEN RAISE EXCEPTION 'ARTIFACT_IMMUTABLE';END IF;RETURN NEW;
END$$;
CREATE TRIGGER artifact_revoke_only BEFORE UPDATE OR DELETE ON design_artifact.attestations FOR EACH ROW EXECUTE FUNCTION design_artifact.immutable_proof();
CREATE TRIGGER artifact_requests_immutable BEFORE UPDATE OR DELETE ON design_artifact.issuer_requests FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
CREATE FUNCTION design_artifact.valid_locator(l jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_typeof(l)='object' AND (SELECT count(*) FROM jsonb_object_keys(l))=4 AND l ?& ARRAY['kind','id','version','scope']
 AND jsonb_typeof(l->'id')='string' AND l->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' AND jsonb_typeof(l->'version')='number' AND l->>'version' ~ '^[1-9][0-9]{0,2}$'
 AND (l->>'version')::integer<=100 AND l->>'kind' IN ('private_media','candidate','full_version')
 AND (l->>'kind'='full_version' OR l->>'version'='1') AND jsonb_typeof(l->'scope')='object'
 AND (SELECT count(*) FROM jsonb_object_keys(l->'scope'))=3 AND l->'scope' ?& ARRAY['customerProfileId','visitId','assignmentSource']
$$;
-- Internal source loader is NOT executable by runtime/issuer LOGIN directly.
CREATE FUNCTION design_artifact.source_item(l jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;live boolean;n integer;b bigint;BEGIN
 IF design_artifact.valid_locator(l) IS DISTINCT FROM true THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 IF l->>'kind'='private_media' THEN
  SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,b FROM design_private.media_records WHERE media_id=l->>'id' AND record->'binding'->'scope'=l->'scope';
  IF n<>1 OR b>16384 THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_DENIED';END IF;
  SELECT record INTO STRICT r FROM design_private.media_records WHERE media_id=l->>'id' AND record->'binding'->'scope'=l->'scope' FOR SHARE;
  SELECT a.active INTO STRICT live FROM design_private.media_access a JOIN design_private.media_records m USING(binding_key,media_id) WHERE m.record=r FOR SHARE OF a;
  IF live IS DISTINCT FROM true THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_DENIED';END IF;
 ELSIF l->>'kind'='candidate' THEN
  SELECT octet_length(envelope::text) INTO STRICT b FROM design_private.model_candidates WHERE candidate_id=l->>'id' AND envelope->'scope'=l->'scope' AND expires_at>clock_timestamp() FOR SHARE;
  IF b>524288 THEN RAISE EXCEPTION 'ARTIFACT_LIMIT';END IF;
  SELECT envelope INTO STRICT r FROM design_private.model_candidates WHERE candidate_id=l->>'id' AND envelope->'scope'=l->'scope' FOR SHARE;
  SELECT active INTO STRICT live FROM design_private.model_candidate_access WHERE candidate_id=l->>'id' FOR SHARE;
  IF live IS DISTINCT FROM true THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_DENIED';END IF;
 ELSE
  SELECT octet_length(record::text) INTO STRICT b FROM design_private.full_versions WHERE version=(l->>'version')::integer AND record->>'requestId'=l->>'id' AND record->'scope'=l->'scope' FOR SHARE;
  IF b>33554432+65536 THEN RAISE EXCEPTION 'ARTIFACT_LIMIT';END IF;
  SELECT record INTO STRICT r FROM design_private.full_versions WHERE version=(l->>'version')::integer AND record->>'requestId'=l->>'id' AND record->'scope'=l->'scope' FOR SHARE;
 END IF;
 RETURN l||jsonb_build_object('payload',r);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_DENIED';END$$;
CREATE FUNCTION design_artifact.require_issuer_reader(r jsonb,s jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p design_identity.subjects%rowtype;e design_identity.employments%rowtype;m design_identity.memberships%rowtype;st design_identity.stores%rowtype;v design_identity.visit_bindings%rowtype;BEGIN
 IF session_user<>'design_artifact_issuer' OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>7 OR NOT r ?& ARRAY['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','bindingRevision'] OR EXISTS(SELECT 1 FROM jsonb_each(r) kv WHERE kv.key IN ('subjectId','employmentId','membershipId','storeId','bindingRevision') AND jsonb_typeof(kv.value)<>'string') THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END IF;
 SELECT * INTO STRICT p FROM design_identity.subjects WHERE subject_id=r->>'subjectId' FOR SHARE;
 SELECT * INTO STRICT e FROM design_identity.employments WHERE employment_id=r->>'employmentId' FOR SHARE;
 SELECT * INTO STRICT m FROM design_identity.memberships WHERE membership_id=r->>'membershipId' FOR SHARE;
 SELECT * INTO STRICT st FROM design_identity.stores WHERE store_id=r->>'storeId' FOR SHARE;
 SELECT * INTO STRICT v FROM design_identity.visit_bindings WHERE assignment_source=s->>'assignmentSource' AND visit_id=s->>'visitId' FOR SHARE;
 IF NOT(p.active AND e.active AND m.active AND st.active AND v.active) OR e.subject_id IS DISTINCT FROM p.subject_id OR m.employment_id IS DISTINCT FROM e.employment_id OR m.store_id IS DISTINCT FROM st.store_id OR v.membership_id IS DISTINCT FROM m.membership_id OR v.store_id IS DISTINCT FROM st.store_id
 OR v.customer_profile_id::text IS DISTINCT FROM s->>'customerProfileId' OR to_jsonb(p.security_epoch) IS DISTINCT FROM r->'securityEpoch' OR to_jsonb(m.membership_revision) IS DISTINCT FROM r->'membershipRevision' OR to_jsonb(v.binding_revision::text) IS DISTINCT FROM r->'bindingRevision' THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END IF;RETURN true;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END$$;
CREATE FUNCTION design_artifact.issuer_source(l jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));PERFORM design_artifact.require_issuer_reader(r,l->'scope');RETURN design_artifact.source_item(l);END$$;
CREATE FUNCTION design_artifact.issue_attestation(q jsonb,item jsonb,a jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior design_artifact.issuer_requests%rowtype;p jsonb;original jsonb;actor jsonb;now_ms bigint;ident text;BEGIN
 IF session_user<>'design_artifact_issuer' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>5 OR NOT q ?& ARRAY['requestId','expectedRevision','locator','reader','expiresAt'] OR q->>'requestId' !~ '^[A-Za-z0-9_-]{1,80}$' OR q->'expectedRevision' IS DISTINCT FROM '0'::jsonb OR jsonb_typeof(q->'expiresAt') IS DISTINCT FROM 'number' OR q->>'expiresAt' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 PERFORM design_artifact.require_issuer_reader(q->'reader',q->'locator'->'scope');
 original:=design_artifact.source_item(q->'locator');
 IF original IS DISTINCT FROM item OR (a-'sha256') IS DISTINCT FROM q->'locator' OR jsonb_typeof(a->'sha256') IS DISTINCT FROM 'string' OR a->>'sha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_CHANGED';END IF;
 SELECT * INTO prior FROM design_artifact.issuer_requests WHERE request_id=q->>'requestId' FOR SHARE;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM jsonb_build_object('action','issue','input',q) THEN RAISE EXCEPTION 'ARTIFACT_REQUEST_CONFLICT';END IF;
  SELECT proof INTO STRICT p FROM design_artifact.attestations WHERE id=prior.attestation_id FOR SHARE;
  RETURN jsonb_build_object('attestation',p,'replayed',true);
 END IF;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 IF (q->>'expiresAt')::bigint<=now_ms OR (q->>'expiresAt')::bigint>now_ms+3600000 THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_EXPIRY';END IF;
 ident:='att-'||(q->>'requestId');actor:=CASE WHEN item->>'kind'='private_media' THEN jsonb_build_object('username',item->'payload'->'binding'->'owner','store',item->'payload'->'binding'->'store') ELSE item->'payload'->'actor' END;
 p:=jsonb_build_object('schemaVersion','design-artifact-access-attestation-v1','id',ident,'revision',1,'issuerId',session_user::text,'active',true,'issuedAt',now_ms,'expiresAt',(q->>'expiresAt')::bigint,'artifact',a,'reader',q->'reader','authorship',jsonb_build_object('status','unresolved','legacyActor',actor));
 INSERT INTO design_artifact.attestations VALUES(ident,a,q->'reader',item,p);
 INSERT INTO design_artifact.issuer_requests VALUES(q->>'requestId',jsonb_build_object('action','issue','input',q),ident);
 RETURN jsonb_build_object('attestation',p,'replayed',false);
END$$;
CREATE FUNCTION design_artifact.revoke_attestation(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior design_artifact.issuer_requests%rowtype;p jsonb;BEGIN
 IF session_user<>'design_artifact_issuer' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR NOT q ?& ARRAY['requestId','attestationId','expectedRevision'] OR q->>'requestId' !~ '^[A-Za-z0-9_-]{1,80}$' OR q->>'attestationId' !~ '^att-[A-Za-z0-9_-]{1,100}$' OR jsonb_typeof(q->'expectedRevision') IS DISTINCT FROM 'number' OR q->>'expectedRevision' !~ '^[1-9][0-9]{0,14}$' THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 SELECT * INTO prior FROM design_artifact.issuer_requests WHERE request_id=q->>'requestId' FOR SHARE;
 IF FOUND THEN IF prior.request IS DISTINCT FROM jsonb_build_object('action','revoke','input',q) THEN RAISE EXCEPTION 'ARTIFACT_REQUEST_CONFLICT';END IF;
  SELECT proof INTO STRICT p FROM design_artifact.attestations WHERE id=prior.attestation_id FOR SHARE;RETURN jsonb_build_object('attestation',p,'replayed',true);END IF;
 SELECT proof INTO STRICT p FROM design_artifact.attestations WHERE id=q->>'attestationId' FOR UPDATE;
 IF p->'active' IS DISTINCT FROM 'true'::jsonb OR p->>'revision' IS DISTINCT FROM q->>'expectedRevision' THEN RAISE EXCEPTION 'ARTIFACT_CAS_CONFLICT';END IF;
 p:=jsonb_set(jsonb_set(p,'{active}','false'),'{revision}',to_jsonb((p->>'revision')::bigint+1));
 UPDATE design_artifact.attestations SET proof=p WHERE id=q->>'attestationId';INSERT INTO design_artifact.issuer_requests VALUES(q->>'requestId',jsonb_build_object('action','revoke','input',q),q->>'attestationId');
 RETURN jsonb_build_object('attestation',p,'replayed',false);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'ARTIFACT_ISSUER_DENIED';END$$;
CREATE FUNCTION design_artifact.read_attestations(a jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_authority jsonb;result jsonb;BEGIN
 current_authority:=design_identity.require_authority();IF a->'scope' IS DISTINCT FROM current_authority->'scope' OR r IS DISTINCT FROM design_artifact.reader_of(current_authority) THEN RAISE EXCEPTION 'ARTIFACT_ACCESS_DENIED';END IF;
 SELECT coalesce(jsonb_agg(proof),'[]'::jsonb) INTO result FROM (SELECT proof FROM design_artifact.attestations WHERE artifact=a AND reader=r LIMIT 2 FOR SHARE) locked;
 RETURN result;
END$$;
CREATE FUNCTION design_artifact.verify_attestation(p jsonb,a jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rows jsonb;BEGIN rows:=design_artifact.read_attestations(a,r);RETURN jsonb_array_length(rows)=1 AND rows->0=p AND p->>'issuerId'='design_artifact_issuer' AND p->'active'='true'::jsonb AND (p->>'issuedAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) AND (p->>'expiresAt')::bigint>floor(extract(epoch from clock_timestamp())*1000);END$$;
CREATE FUNCTION design_artifact.attested_source(l jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved design_artifact.attestations%rowtype;item jsonb;BEGIN
 SELECT * INTO STRICT saved FROM design_artifact.attestations WHERE artifact-'sha256'=l AND reader=r FOR SHARE;
 IF NOT design_artifact.verify_attestation(saved.proof,saved.artifact,r) THEN RAISE EXCEPTION 'ARTIFACT_ACCESS_DENIED';END IF;
 item:=design_artifact.source_item(l);IF item IS DISTINCT FROM saved.source_item THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_CHANGED';END IF;RETURN item;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'ARTIFACT_ACCESS_DENIED';END$$;
CREATE FUNCTION design_artifact.load_artifacts(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;r jsonb;kind text;result jsonb:='[]';ident text;loc jsonb;row_value record;n integer;b bigint;BEGIN
 a:=design_identity.require_authority();r:=design_artifact.reader_of(a);
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR NOT q ?& ARRAY['operation','scope','ids'] OR q->'scope' IS DISTINCT FROM a->'scope' OR jsonb_typeof(q->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'ids')>30 THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 IF q->>'operation'='history_load' THEN
  IF q->'ids'<>'[]'::jsonb THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
  SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,b FROM design_private.full_versions WHERE record->'scope'=q->'scope';
  IF n<1 OR n>100 OR b>67108864 THEN RAISE EXCEPTION 'ARTIFACT_LIMIT';END IF;
  FOR row_value IN SELECT version,record->>'requestId' AS id FROM design_private.full_versions WHERE record->'scope'=q->'scope' ORDER BY version FOR SHARE LOOP
   loc:=jsonb_build_object('kind','full_version','id',row_value.id,'version',row_value.version,'scope',q->'scope');result:=result||jsonb_build_array(design_artifact.attested_source(loc,r));
  END LOOP;
 ELSE
  kind:=CASE WHEN q->>'operation' IN ('media_read','media_references') THEN 'private_media' WHEN q->>'operation'='candidate_load' THEN 'candidate' ELSE NULL END;
  IF kind IS NULL OR jsonb_array_length(q->'ids')<1 OR (q->>'operation' IN ('media_read','candidate_load') AND jsonb_array_length(q->'ids')<>1) THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
  FOR ident IN SELECT jsonb_array_elements_text(q->'ids') LOOP loc:=jsonb_build_object('kind',kind,'id',ident,'version',1,'scope',q->'scope');result:=result||jsonb_build_array(design_artifact.attested_source(loc,r));END LOOP;
 END IF;
 PERFORM design_identity.require_authority();RETURN result;
END$$;
-- Explicit ownership and EXECUTE whitelist. No runtime role membership/CREATE/issuance.
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS fn,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_artifact' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.fn,CASE WHEN f.proname IN ('require_issuer_reader','issuer_source','issue_attestation','revoke_attestation') THEN 'design_artifact_issuer_capability' ELSE 'design_artifact_capability' END);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,design_identity_runtime,design_artifact_issuer',f.fn);
END LOOP;END$$;
GRANT EXECUTE ON FUNCTION design_artifact.reader_of(jsonb),design_artifact.valid_locator(jsonb),design_artifact.source_item(jsonb) TO design_artifact_issuer_capability;
GRANT EXECUTE ON FUNCTION design_artifact.load_artifacts(jsonb),design_artifact.read_attestations(jsonb,jsonb),design_artifact.verify_attestation(jsonb,jsonb,jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_artifact.issuer_source(jsonb,jsonb),design_artifact.issue_attestation(jsonb,jsonb,jsonb),design_artifact.revoke_attestation(jsonb) TO design_artifact_issuer;
REVOKE CREATE ON SCHEMA design_artifact FROM design_artifact_capability,design_artifact_issuer_capability;
