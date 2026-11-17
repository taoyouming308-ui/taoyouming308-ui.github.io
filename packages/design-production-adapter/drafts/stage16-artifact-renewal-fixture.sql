-- TEST-ONLY additive PG17 fixture; never production migration or authorization.
DO $$BEGIN IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::integer/10000<>17 OR to_regclass('design_artifact.attestations') IS NULL OR to_regnamespace('design_artifact_renewal') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_RENEWAL_FIXTURE_REQUIRED';END IF;END$$;
CREATE ROLE design_artifact_authorizer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_artifact_authorizer_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_artifact_authorizer;
CREATE SCHEMA design_artifact_renewal AUTHORIZATION design_artifact_owner;
REVOKE ALL ON SCHEMA design_artifact_renewal FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_artifact_renewal TO design_identity_runtime,design_artifact_issuer,design_artifact_authorizer,design_artifact_capability,design_artifact_issuer_capability,design_artifact_authorizer_capability;
GRANT CREATE ON SCHEMA design_artifact_renewal TO design_artifact_capability,design_artifact_issuer_capability,design_artifact_authorizer_capability;
CREATE TABLE design_artifact_renewal.chains(base_id text PRIMARY KEY REFERENCES design_artifact.attestations(id),genesis jsonb NOT NULL,base_tombstone jsonb NOT NULL,artifact jsonb NOT NULL,reader jsonb NOT NULL,source_item jsonb NOT NULL);
CREATE TABLE design_artifact_renewal.revisions(base_id text NOT NULL REFERENCES design_artifact_renewal.chains(base_id),revision integer NOT NULL,previous_digest text NOT NULL,node jsonb NOT NULL,digest text NOT NULL,PRIMARY KEY(base_id,revision),UNIQUE(digest));
CREATE TABLE design_artifact_renewal.heads(base_id text PRIMARY KEY REFERENCES design_artifact_renewal.chains(base_id),revision integer NOT NULL,digest text NOT NULL,FOREIGN KEY(base_id,revision) REFERENCES design_artifact_renewal.revisions(base_id,revision));
CREATE TABLE design_artifact_renewal.authorizations(id text PRIMARY KEY,intent jsonb NOT NULL,base_artifact jsonb NOT NULL,base_reader jsonb NOT NULL,issued_at bigint NOT NULL,expires_at bigint NOT NULL,active boolean NOT NULL,consumed_by text);
CREATE TABLE design_artifact_renewal.requests(request_id text PRIMARY KEY,input jsonb NOT NULL,base_id text NOT NULL,revision integer NOT NULL,digest text NOT NULL,FOREIGN KEY(base_id,revision) REFERENCES design_artifact_renewal.revisions(base_id,revision));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['chains','revisions','heads','authorizations','requests'] LOOP
 EXECUTE format('ALTER TABLE design_artifact_renewal.%I OWNER TO design_artifact_owner',t);EXECUTE format('ALTER TABLE design_artifact_renewal.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE design_artifact_renewal.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON design_artifact_renewal.%I FROM PUBLIC,anon,authenticated,design_identity_runtime,design_artifact_issuer,design_artifact_authorizer',t);
 EXECUTE format('CREATE POLICY renewal_issuer ON design_artifact_renewal.%I TO design_artifact_issuer_capability USING(true) WITH CHECK(true)',t);
END LOOP;END$$;
GRANT SELECT,INSERT ON design_artifact_renewal.chains,design_artifact_renewal.revisions,design_artifact_renewal.requests TO design_artifact_issuer_capability;
GRANT UPDATE(base_id) ON design_artifact_renewal.chains,design_artifact_renewal.revisions,design_artifact_renewal.requests TO design_artifact_issuer_capability;
GRANT SELECT,INSERT,UPDATE ON design_artifact_renewal.heads TO design_artifact_issuer_capability;
GRANT SELECT,UPDATE(consumed_by) ON design_artifact_renewal.authorizations TO design_artifact_issuer_capability;
GRANT SELECT,INSERT,UPDATE(active) ON design_artifact_renewal.authorizations TO design_artifact_authorizer_capability;
CREATE POLICY renewal_authorizer ON design_artifact_renewal.authorizations TO design_artifact_authorizer_capability USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE(base_id) ON design_artifact_renewal.chains,design_artifact_renewal.revisions,design_artifact_renewal.heads TO design_artifact_capability,design_artifact_authorizer_capability;
GRANT USAGE ON SCHEMA design_artifact TO design_artifact_authorizer_capability;
GRANT SELECT,UPDATE(id) ON design_artifact.attestations TO design_artifact_authorizer_capability;
CREATE POLICY renewal_authorizer_base ON design_artifact.attestations FOR SELECT TO design_artifact_authorizer_capability USING(true);
CREATE POLICY renewal_authorizer_base_lock ON design_artifact.attestations FOR UPDATE TO design_artifact_authorizer_capability USING(true) WITH CHECK(false);
CREATE POLICY renewal_chain_reader ON design_artifact_renewal.chains TO design_artifact_capability USING(design_artifact.proof_visible(artifact,reader));
CREATE POLICY renewal_revision_reader ON design_artifact_renewal.revisions TO design_artifact_capability USING(EXISTS(SELECT 1 FROM design_artifact_renewal.chains c WHERE c.base_id=revisions.base_id));
CREATE POLICY renewal_head_reader ON design_artifact_renewal.heads TO design_artifact_capability USING(EXISTS(SELECT 1 FROM design_artifact_renewal.chains c WHERE c.base_id=heads.base_id));
CREATE POLICY renewal_chain_authorizer ON design_artifact_renewal.chains TO design_artifact_authorizer_capability USING(true);
CREATE POLICY renewal_revision_authorizer ON design_artifact_renewal.revisions TO design_artifact_authorizer_capability USING(true);
CREATE POLICY renewal_head_authorizer ON design_artifact_renewal.heads TO design_artifact_authorizer_capability USING(true);
CREATE FUNCTION design_artifact_renewal.hash_node(n jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$SELECT encode(sha256(convert_to('design-artifact-renewal-pg17-v1:'||n::text,'UTF8')),'hex')$$;
CREATE FUNCTION design_artifact_renewal.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$BEGIN RAISE EXCEPTION 'RENEWAL_IMMUTABLE';END$$;
CREATE TRIGGER renewal_chain_immutable BEFORE UPDATE OR DELETE ON design_artifact_renewal.chains FOR EACH ROW EXECUTE FUNCTION design_artifact_renewal.immutable();
CREATE TRIGGER renewal_revision_immutable BEFORE UPDATE OR DELETE ON design_artifact_renewal.revisions FOR EACH ROW EXECUTE FUNCTION design_artifact_renewal.immutable();
CREATE TRIGGER renewal_request_immutable BEFORE UPDATE OR DELETE ON design_artifact_renewal.requests FOR EACH ROW EXECUTE FUNCTION design_artifact_renewal.immutable();
CREATE FUNCTION design_artifact_renewal.authorization_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['active','consumed_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','consumed_by']) THEN RAISE EXCEPTION 'RENEWAL_AUTH_IMMUTABLE';END IF;
 IF current_user='design_artifact_authorizer_capability' THEN IF OLD.active IS DISTINCT FROM true OR NEW.active IS DISTINCT FROM false OR NEW.consumed_by IS DISTINCT FROM OLD.consumed_by THEN RAISE EXCEPTION 'RENEWAL_AUTH_IMMUTABLE';END IF;
 ELSIF current_user='design_artifact_issuer_capability' THEN IF OLD.active IS DISTINCT FROM true OR NEW.active IS DISTINCT FROM true OR OLD.consumed_by IS NOT NULL OR NEW.consumed_by IS DISTINCT FROM OLD.intent->>'requestId' THEN RAISE EXCEPTION 'RENEWAL_AUTH_IMMUTABLE';END IF;
 ELSE RAISE EXCEPTION 'RENEWAL_AUTH_IMMUTABLE';END IF;RETURN NEW;END$$;
CREATE TRIGGER renewal_authorization_guard BEFORE UPDATE OR DELETE ON design_artifact_renewal.authorizations FOR EACH ROW EXECUTE FUNCTION design_artifact_renewal.authorization_guard();
CREATE FUNCTION design_artifact_renewal.head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$BEGIN
 IF TG_OP='DELETE' OR current_user<>'design_artifact_issuer_capability' OR NEW.base_id IS DISTINCT FROM OLD.base_id OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN RAISE EXCEPTION 'RENEWAL_HEAD_IMMUTABLE';END IF;RETURN NEW;END$$;
CREATE TRIGGER renewal_head_guard BEFORE UPDATE OR DELETE ON design_artifact_renewal.heads FOR EACH ROW EXECUTE FUNCTION design_artifact_renewal.head_guard();
CREATE FUNCTION design_artifact_renewal.valid_intent(q jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_typeof(q)='object' AND (SELECT count(*) FROM jsonb_object_keys(q))=7 AND q ?& ARRAY['authorizationId','requestId','baseAttestationId','expectedRevision','expectedHeadDigest','action','expiresAt']
 AND jsonb_typeof(q->'authorizationId')='string' AND q->>'authorizationId' ~ '^[A-Za-z0-9_-]{1,100}$' AND jsonb_typeof(q->'requestId')='string' AND q->>'requestId' ~ '^[A-Za-z0-9_-]{1,80}$'
 AND jsonb_typeof(q->'baseAttestationId')='string' AND q->>'baseAttestationId' ~ '^att-[A-Za-z0-9_-]{1,80}$' AND jsonb_typeof(q->'expectedRevision')='number' AND q->>'expectedRevision' ~ '^[1-9][0-9]{0,3}$' AND (q->>'expectedRevision')::integer<=1000
 AND jsonb_typeof(q->'expectedHeadDigest')='string' AND q->>'expectedHeadDigest' ~ '^[a-f0-9]{64}$' AND q->>'action' IN ('renew','regrant','revoke') AND jsonb_typeof(q->'expiresAt')='number' AND q->>'expiresAt' ~ '^[1-9][0-9]{0,15}$'
$$;
-- Internal: validates the entire bounded append-only chain and exact permanently revoked base.
CREATE FUNCTION design_artifact_renewal.head_value(id text,allow_base boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE base design_artifact.attestations%rowtype;c design_artifact_renewal.chains%rowtype;h design_artifact_renewal.heads%rowtype;r record;p jsonb;d text;v integer;n integer;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT * INTO STRICT base FROM design_artifact.attestations WHERE attestations.id=head_value.id FOR SHARE;
 SELECT * INTO c FROM design_artifact_renewal.chains WHERE base_id=head_value.id FOR SHARE;
 IF NOT FOUND THEN IF allow_base IS DISTINCT FROM true THEN RAISE EXCEPTION 'RENEWAL_NOT_ENROLLED';END IF;RETURN jsonb_build_object('proof',base.proof,'revision',(base.proof->>'revision')::integer,'digest',design_artifact_renewal.hash_node(base.proof),'artifact',base.artifact,'reader',base.reader,'sourceItem',base.source_item,'enrolled',false,'nodeCount',0);END IF;
 IF base.proof IS DISTINCT FROM c.base_tombstone OR base.proof->'active' IS DISTINCT FROM 'false'::jsonb OR base.artifact IS DISTINCT FROM c.artifact OR base.reader IS DISTINCT FROM c.reader OR base.source_item IS DISTINCT FROM c.source_item THEN RAISE EXCEPTION 'RENEWAL_BASE_CHANGED';END IF;
 p:=c.genesis;v:=(p->>'revision')::integer;d:=design_artifact_renewal.hash_node(p);n:=0;
 FOR r IN SELECT * FROM design_artifact_renewal.revisions WHERE base_id=head_value.id ORDER BY revision LIMIT 101 FOR SHARE LOOP
  n:=n+1;IF n>100 OR r.revision<>v+1 OR r.previous_digest IS DISTINCT FROM d OR r.digest IS DISTINCT FROM design_artifact_renewal.hash_node(r.node) OR r.node->>'previousDigest' IS DISTINCT FROM d OR r.node->>'baseAttestationId' IS DISTINCT FROM id OR r.node->'proof'->>'revision' IS DISTINCT FROM r.revision::text
  OR ((r.node->'proof')-ARRAY['revision','active','issuedAt','expiresAt']) IS DISTINCT FROM (p-ARRAY['revision','active','issuedAt','expiresAt']) THEN RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
  IF r.node->>'action'='renew' THEN IF p->'active' IS DISTINCT FROM 'true'::jsonb OR r.node->'proof'->'active' IS DISTINCT FROM 'true'::jsonb OR (r.node->'proof'->>'expiresAt')::bigint<=(p->>'expiresAt')::bigint THEN RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
  ELSIF r.node->>'action'='regrant' THEN IF p->'active' IS DISTINCT FROM 'false'::jsonb OR r.node->'proof'->'active' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
  ELSIF r.node->>'action'='revoke' THEN IF p->'active' IS DISTINCT FROM 'true'::jsonb OR r.node->'proof'->'active' IS DISTINCT FROM 'false'::jsonb OR ((r.node->'proof')-ARRAY['revision','active']) IS DISTINCT FROM (p-ARRAY['revision','active']) THEN RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
  ELSE RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
  p:=r.node->'proof';v:=r.revision;d:=r.digest;
 END LOOP;
 SELECT * INTO STRICT h FROM design_artifact_renewal.heads WHERE base_id=head_value.id FOR SHARE;
 IF n<1 OR h.revision<>v OR h.digest IS DISTINCT FROM d THEN RAISE EXCEPTION 'RENEWAL_CHAIN_CORRUPT';END IF;
 RETURN jsonb_build_object('proof',p,'revision',v,'digest',d,'artifact',c.artifact,'reader',c.reader,'sourceItem',c.source_item,'enrolled',true,'nodeCount',n);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'RENEWAL_DENIED';END$$;
CREATE FUNCTION design_artifact_renewal.issuer_head(id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h jsonb;BEGIN IF session_user<>'design_artifact_issuer' THEN RAISE EXCEPTION 'RENEWAL_ISSUER_DENIED';END IF;h:=design_artifact_renewal.head_value(id,true);PERFORM design_artifact.require_issuer_reader(h->'reader',h->'artifact'->'scope');RETURN h-ARRAY['sourceItem'];END$$;
CREATE FUNCTION design_artifact_renewal.authorize_intent(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE intent jsonb;h jsonb;prior design_artifact_renewal.authorizations%rowtype;now_ms bigint;BEGIN
 IF session_user<>'design_artifact_authorizer' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>8 OR design_artifact_renewal.valid_intent(q-'authorizationExpiresAt') IS DISTINCT FROM true OR jsonb_typeof(q->'authorizationExpiresAt') IS DISTINCT FROM 'number' OR q->>'authorizationExpiresAt' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'RENEWAL_AUTHORIZER_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));intent:=q-'authorizationExpiresAt';h:=design_artifact_renewal.head_value(q->>'baseAttestationId',true);
 SELECT * INTO prior FROM design_artifact_renewal.authorizations WHERE id=q->>'authorizationId' FOR SHARE;
 IF FOUND THEN IF prior.intent IS DISTINCT FROM intent OR prior.expires_at IS DISTINCT FROM (q->>'authorizationExpiresAt')::bigint THEN RAISE EXCEPTION 'RENEWAL_REQUEST_CONFLICT';END IF;RETURN jsonb_build_object('authorizationId',prior.id,'active',prior.active,'consumedBy',prior.consumed_by,'replayed',true);END IF;
 IF h->>'revision' IS DISTINCT FROM q->>'expectedRevision' OR h->>'digest' IS DISTINCT FROM q->>'expectedHeadDigest' THEN RAISE EXCEPTION 'RENEWAL_CAS_CONFLICT';END IF;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;IF (q->>'authorizationExpiresAt')::bigint<=now_ms OR (q->>'authorizationExpiresAt')::bigint>now_ms+300000 THEN RAISE EXCEPTION 'RENEWAL_AUTH_EXPIRED';END IF;
 INSERT INTO design_artifact_renewal.authorizations VALUES(q->>'authorizationId',intent,h->'artifact',h->'reader',now_ms,(q->>'authorizationExpiresAt')::bigint,true,NULL);
 RETURN jsonb_build_object('authorizationId',q->>'authorizationId','active',true,'consumedBy',NULL,'replayed',false);
END$$;
CREATE FUNCTION design_artifact_renewal.revoke_intent(id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN IF session_user<>'design_artifact_authorizer' THEN RAISE EXCEPTION 'RENEWAL_AUTHORIZER_DENIED';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));UPDATE design_artifact_renewal.authorizations SET active=false WHERE authorizations.id=revoke_intent.id AND active;RETURN FOUND;END$$;
CREATE FUNCTION design_artifact_renewal.apply_revision(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h jsonb;p jsonb;tomb jsonb;a design_artifact_renewal.authorizations%rowtype;receipt design_artifact_renewal.requests%rowtype;n jsonb;d text;now_ms bigint;v integer;original jsonb;enrolled boolean;BEGIN
 IF session_user<>'design_artifact_issuer' OR design_artifact_renewal.valid_intent(q) IS DISTINCT FROM true THEN RAISE EXCEPTION 'RENEWAL_ISSUER_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));h:=design_artifact_renewal.head_value(q->>'baseAttestationId',true);p:=h->'proof';
 IF q->>'action'<>'revoke' THEN original:=design_artifact.issuer_source((h->'artifact')-'sha256',h->'reader');IF original IS DISTINCT FROM h->'sourceItem' THEN RAISE EXCEPTION 'RENEWAL_SOURCE_CHANGED';END IF;END IF;
 SELECT * INTO receipt FROM design_artifact_renewal.requests WHERE request_id=q->>'requestId' FOR SHARE;
 IF FOUND THEN IF receipt.input IS DISTINCT FROM q THEN RAISE EXCEPTION 'RENEWAL_REQUEST_CONFLICT';END IF;SELECT node INTO STRICT n FROM design_artifact_renewal.revisions WHERE base_id=receipt.base_id AND revision=receipt.revision FOR SHARE;RETURN jsonb_build_object('revision',n,'digest',receipt.digest,'replayed',true,'currentRevision',h->'revision','currentDigest',h->'digest');END IF;
 IF h->>'revision' IS DISTINCT FROM q->>'expectedRevision' OR h->>'digest' IS DISTINCT FROM q->>'expectedHeadDigest' OR (h->>'revision')::integer>=1000 OR (h->>'nodeCount')::integer>=100 THEN RAISE EXCEPTION 'RENEWAL_CAS_CONFLICT';END IF;
 SELECT * INTO STRICT a FROM design_artifact_renewal.authorizations WHERE id=q->>'authorizationId' FOR UPDATE;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 IF a.intent IS DISTINCT FROM q OR a.active IS DISTINCT FROM true OR a.consumed_by IS NOT NULL OR a.expires_at<=now_ms OR a.issued_at>now_ms OR a.base_artifact IS DISTINCT FROM h->'artifact' OR a.base_reader IS DISTINCT FROM h->'reader' THEN RAISE EXCEPTION 'RENEWAL_AUTH_DENIED';END IF;
 IF q->>'action'='revoke' THEN
  IF p->'active' IS DISTINCT FROM 'true'::jsonb OR q->>'expiresAt' IS DISTINCT FROM p->>'expiresAt' THEN RAISE EXCEPTION 'RENEWAL_TRANSITION_DENIED';END IF;
 ELSE
  IF (q->>'action'='renew' AND (p->'active' IS DISTINCT FROM 'true'::jsonb OR (q->>'expiresAt')::bigint<=(p->>'expiresAt')::bigint)) OR (q->>'action'='regrant' AND p->'active' IS DISTINCT FROM 'false'::jsonb) OR (q->>'expiresAt')::bigint<=now_ms OR (q->>'expiresAt')::bigint>now_ms+3600000 THEN RAISE EXCEPTION 'RENEWAL_TRANSITION_DENIED';END IF;
  -- Same reader tuple only. Changed employment/epoch/binding needs new independent initial issuance.
  original:=design_artifact.issuer_source((h->'artifact')-'sha256',h->'reader');IF original IS DISTINCT FROM h->'sourceItem' THEN RAISE EXCEPTION 'RENEWAL_SOURCE_CHANGED';END IF;
 END IF;
 enrolled:=(h->>'enrolled')::boolean;
 IF NOT enrolled THEN
  tomb:=p;IF p->'active'='true'::jsonb THEN tomb:=jsonb_set(jsonb_set(p,'{active}','false'),'{revision}',to_jsonb((p->>'revision')::integer+1));UPDATE design_artifact.attestations SET proof=tomb WHERE id=q->>'baseAttestationId';END IF;
  INSERT INTO design_artifact_renewal.chains VALUES(q->>'baseAttestationId',p,tomb,h->'artifact',h->'reader',h->'sourceItem');
 END IF;
 v:=(p->>'revision')::integer+1;
 IF q->>'action'='revoke' THEN p:=jsonb_set(jsonb_set(p,'{active}','false'),'{revision}',to_jsonb(v));
 ELSE p:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(p,'{active}','true'),'{revision}',to_jsonb(v)),'{issuedAt}',to_jsonb(now_ms)),'{expiresAt}',q->'expiresAt');END IF;
 n:=jsonb_build_object('schemaVersion','design-artifact-renewal-revision-v1','baseAttestationId',q->>'baseAttestationId','revision',v,'previousDigest',h->>'digest','action',q->>'action','requestId',q->>'requestId','authorizationId',q->>'authorizationId','createdAt',now_ms,'proof',p);d:=design_artifact_renewal.hash_node(n);
 INSERT INTO design_artifact_renewal.revisions VALUES(q->>'baseAttestationId',v,h->>'digest',n,d);
 IF enrolled THEN UPDATE design_artifact_renewal.heads SET revision=v,digest=d WHERE base_id=q->>'baseAttestationId' AND revision=(q->>'expectedRevision')::integer AND digest=q->>'expectedHeadDigest';IF NOT FOUND THEN RAISE EXCEPTION 'RENEWAL_CAS_CONFLICT';END IF;
 ELSE INSERT INTO design_artifact_renewal.heads VALUES(q->>'baseAttestationId',v,d);END IF;
 UPDATE design_artifact_renewal.authorizations SET consumed_by=q->>'requestId' WHERE id=a.id;
 INSERT INTO design_artifact_renewal.requests VALUES(q->>'requestId',q,q->>'baseAttestationId',v,d);
 IF q->>'action'<>'revoke' THEN PERFORM design_artifact.require_issuer_reader(h->'reader',h->'artifact'->'scope');END IF;
 IF a.expires_at<=floor(extract(epoch from clock_timestamp())*1000) THEN RAISE EXCEPTION 'RENEWAL_AUTH_EXPIRED';END IF;
 RETURN jsonb_build_object('revision',n,'digest',d,'replayed',false,'currentRevision',v,'currentDigest',d);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'RENEWAL_DENIED';END$$;
-- Read owner runs its own current-authority policy. No base fallback, even for an expired head.
CREATE FUNCTION design_artifact_renewal.read_attestations(a jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_authority jsonb;id text;h jsonb;BEGIN
 current_authority:=design_identity.require_authority();IF a->'scope' IS DISTINCT FROM current_authority->'scope' OR r IS DISTINCT FROM design_artifact.reader_of(current_authority) THEN RAISE EXCEPTION 'RENEWAL_ACCESS_DENIED';END IF;
 SELECT base_id INTO STRICT id FROM design_artifact_renewal.chains WHERE artifact=a AND reader=r FOR SHARE;h:=design_artifact_renewal.head_value(id,false);RETURN jsonb_build_array(h->'proof');
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'RENEWAL_ACCESS_DENIED';END$$;
CREATE FUNCTION design_artifact_renewal.verify_attestation(p jsonb,a jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE values_ jsonb;BEGIN values_:=design_artifact_renewal.read_attestations(a,r);RETURN jsonb_array_length(values_)=1 AND values_->0=p AND p->'active'='true'::jsonb AND (p->>'issuedAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) AND (p->>'expiresAt')::bigint>floor(extract(epoch from clock_timestamp())*1000);END$$;
CREATE FUNCTION design_artifact_renewal.attested_source(l jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE id text;h jsonb;item jsonb;BEGIN
 SELECT base_id INTO STRICT id FROM design_artifact_renewal.chains WHERE artifact-'sha256'=l AND reader=r FOR SHARE;h:=design_artifact_renewal.head_value(id,false);
 IF NOT design_artifact_renewal.verify_attestation(h->'proof',h->'artifact',r) THEN RAISE EXCEPTION 'RENEWAL_ACCESS_DENIED';END IF;
 item:=design_artifact.source_item(l);IF item IS DISTINCT FROM h->'sourceItem' THEN RAISE EXCEPTION 'RENEWAL_SOURCE_CHANGED';END IF;RETURN item;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'RENEWAL_ACCESS_DENIED';END$$;
CREATE FUNCTION design_artifact_renewal.load_artifacts(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;r jsonb;kind text;result jsonb:='[]';ident text;loc jsonb;row_value record;n integer;b bigint;BEGIN
 a:=design_identity.require_authority();r:=design_artifact.reader_of(a);
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 OR NOT q ?& ARRAY['operation','scope','ids'] OR q->'scope' IS DISTINCT FROM a->'scope' OR jsonb_typeof(q->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'ids')>30 THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 IF q->>'operation'='history_load' THEN
  IF q->'ids'<>'[]'::jsonb THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
  SELECT count(*),coalesce(sum(octet_length(record::text)),0) INTO n,b FROM design_private.full_versions WHERE record->'scope'=q->'scope';
  IF n<1 OR n>100 OR b>67108864 THEN RAISE EXCEPTION 'ARTIFACT_LIMIT';END IF;
  FOR row_value IN SELECT version,record->>'requestId' AS id FROM design_private.full_versions WHERE record->'scope'=q->'scope' ORDER BY version FOR SHARE LOOP
   loc:=jsonb_build_object('kind','full_version','id',row_value.id,'version',row_value.version,'scope',q->'scope');result:=result||jsonb_build_array(design_artifact_renewal.attested_source(loc,r));
  END LOOP;
 ELSE
  kind:=CASE WHEN q->>'operation' IN ('media_read','media_references') THEN 'private_media' WHEN q->>'operation'='candidate_load' THEN 'candidate' ELSE NULL END;
  IF kind IS NULL OR jsonb_array_length(q->'ids')<1 OR (q->>'operation' IN ('media_read','candidate_load') AND jsonb_array_length(q->'ids')<>1) THEN RAISE EXCEPTION 'ARTIFACT_INVALID';END IF;
  FOR ident IN SELECT jsonb_array_elements_text(q->'ids') LOOP loc:=jsonb_build_object('kind',kind,'id',ident,'version',1,'scope',q->'scope');result:=result||jsonb_build_array(design_artifact_renewal.attested_source(loc,r));END LOOP;
 END IF;
 PERFORM design_identity.require_authority();RETURN result;
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS fn,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_artifact_renewal' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.fn,CASE WHEN f.proname IN ('authorize_intent','revoke_intent') THEN 'design_artifact_authorizer_capability' WHEN f.proname IN ('issuer_head','apply_revision') THEN 'design_artifact_issuer_capability' ELSE 'design_artifact_capability' END);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,design_identity_runtime,design_artifact_issuer,design_artifact_authorizer',f.fn);
END LOOP;END$$;
-- head_value is SECURITY INVOKER so its table RLS follows the designated fixed-function caller.
ALTER FUNCTION design_artifact_renewal.head_value(text,boolean) SECURITY INVOKER;
GRANT EXECUTE ON FUNCTION design_artifact_renewal.hash_node(jsonb),design_artifact_renewal.valid_intent(jsonb),design_artifact_renewal.head_value(text,boolean) TO design_artifact_issuer_capability,design_artifact_authorizer_capability;
GRANT EXECUTE ON FUNCTION design_artifact_renewal.issuer_head(text),design_artifact_renewal.apply_revision(jsonb) TO design_artifact_issuer;
GRANT EXECUTE ON FUNCTION design_artifact_renewal.authorize_intent(jsonb),design_artifact_renewal.revoke_intent(text) TO design_artifact_authorizer;
GRANT EXECUTE ON FUNCTION design_artifact_renewal.load_artifacts(jsonb),design_artifact_renewal.read_attestations(jsonb,jsonb),design_artifact_renewal.verify_attestation(jsonb,jsonb,jsonb) TO design_identity_runtime;
REVOKE CREATE ON SCHEMA design_artifact_renewal FROM design_artifact_capability,design_artifact_issuer_capability,design_artifact_authorizer_capability;
-- Stage15 functions remain unchanged. Enrolled base proofs are permanently false,
-- so direct calls through the old fixed functions cannot bypass a revoked new head.
