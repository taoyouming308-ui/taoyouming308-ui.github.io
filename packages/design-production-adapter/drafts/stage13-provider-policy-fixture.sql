-- ISOLATED SYNTHETIC FIXTURE ONLY. Not a production migration or installation authority.
DO $$BEGIN IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' THEN RAISE EXCEPTION 'SYNTHETIC_FIXTURE_REQUIRED'; END IF; END$$;
CREATE SCHEMA design_policy_private AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_policy_private FROM PUBLIC;
GRANT USAGE ON SCHEMA design_policy_private TO design_identity_capability,design_identity_runtime;
-- Installer-only ownership transfer prerequisite, revoked before runtime use.
GRANT CREATE ON SCHEMA design_policy_private TO design_identity_capability;
CREATE TABLE design_policy_private.issued_receipts(receipt_id text PRIMARY KEY, record jsonb NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE design_policy_private.context_permissions(id text PRIMARY KEY, owner_key text NOT NULL, legacy_key text NOT NULL, legacy_fingerprint text NOT NULL, authority jsonb NOT NULL, intent jsonb NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE design_policy_private.approvals(owner_key text PRIMARY KEY,receipt_id text UNIQUE NOT NULL,record jsonb NOT NULL);
CREATE TABLE design_policy_private.attempts(owner_key text PRIMARY KEY,record jsonb NOT NULL);
CREATE UNIQUE INDEX attempt_principal_request ON design_policy_private.attempts((record->'authority'->>'subjectId'),(record->'authority'->>'employmentId'),(record->'authority'->>'membershipId'),(record->'authority'->>'storeId'),(record->'intent'->>'requestId'));
-- Only installation owner/independent fixture issuer can create or revoke receipts/context grants.
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['issued_receipts','context_permissions','approvals','attempts'] LOOP
 EXECUTE format('ALTER TABLE design_policy_private.%I OWNER TO design_identity_owner',t);
 EXECUTE format('ALTER TABLE design_policy_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE design_policy_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON design_policy_private.%I FROM PUBLIC,design_identity_runtime',t);
END LOOP;END$$;
CREATE POLICY issued_scope ON design_policy_private.issued_receipts TO design_identity_capability USING(record->'authority'=design_identity.require_authority());
CREATE POLICY context_scope ON design_policy_private.context_permissions TO design_identity_capability USING(authority=design_identity.require_authority());
CREATE POLICY approvals_scope ON design_policy_private.approvals TO design_identity_capability USING(record->'authority'=design_identity.require_authority()) WITH CHECK(record->'authority'=design_identity.require_authority());
CREATE POLICY attempts_scope ON design_policy_private.attempts TO design_identity_capability USING(record->'authority'=design_identity.require_authority()) WITH CHECK(record->'authority'=design_identity.require_authority());
GRANT SELECT ON design_policy_private.issued_receipts,design_policy_private.context_permissions TO design_identity_capability;
-- Locking SELECT needs an UPDATE privilege. An immutable trigger denies capability-owner writes.
GRANT UPDATE(active) ON design_policy_private.issued_receipts,design_policy_private.context_permissions TO design_identity_capability;
GRANT SELECT,INSERT ON design_policy_private.approvals,design_policy_private.attempts TO design_identity_capability;
GRANT UPDATE(record) ON design_policy_private.approvals,design_policy_private.attempts TO design_identity_capability;
CREATE FUNCTION design_policy_private.reject_authority_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN IF current_user='design_identity_capability' THEN RAISE EXCEPTION 'POLICY_ISSUER_WRITE_DENIED';END IF;RETURN NEW;END$$;
ALTER FUNCTION design_policy_private.reject_authority_mutation() OWNER TO design_identity_owner;
REVOKE ALL ON FUNCTION design_policy_private.reject_authority_mutation() FROM PUBLIC;
CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON design_policy_private.issued_receipts FOR EACH ROW EXECUTE FUNCTION design_policy_private.reject_authority_mutation();
CREATE TRIGGER context_immutable BEFORE UPDATE OR DELETE ON design_policy_private.context_permissions FOR EACH ROW EXECUTE FUNCTION design_policy_private.reject_authority_mutation();
CREATE FUNCTION design_policy_private.check_approval_commit_expiry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.record->'active'='true'::jsonb AND ((NEW.record->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) OR (NEW.record->>'issuedAt')::bigint>floor(extract(epoch from clock_timestamp())*1000)) THEN RAISE EXCEPTION 'POLICY_APPROVAL_EXPIRED';END IF;RETURN NULL;
END$$;
ALTER FUNCTION design_policy_private.check_approval_commit_expiry() OWNER TO design_identity_owner;
REVOKE ALL ON FUNCTION design_policy_private.check_approval_commit_expiry() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER approval_commit_expiry AFTER INSERT OR UPDATE ON design_policy_private.approvals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION design_policy_private.check_approval_commit_expiry();
CREATE FUNCTION design_policy_private.valid_attempt_shape(n jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_typeof(n)='object' AND (SELECT count(*) FROM jsonb_object_keys(n))=12
 AND n ?& ARRAY['schemaVersion','ownerKey','revision','authority','intent','legacyKey','legacyFingerprint','approvalReceiptId','state','result','createdAt','updatedAt']
 AND n->>'ownerKey' ~ '^[a-f0-9]{64}$' AND n->>'legacyKey' ~ '^[a-f0-9]{64}$' AND n->>'legacyFingerprint' ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof(n->'revision')='number' AND n->>'revision' ~ '^[1-9][0-9]{0,14}$'
 AND jsonb_typeof(n->'createdAt')='number' AND n->>'createdAt' ~ '^[0-9]{1,16}$'
 AND jsonb_typeof(n->'updatedAt')='number' AND n->>'updatedAt' ~ '^[0-9]{1,16}$'
 AND jsonb_typeof(n->'state')='string' AND n->>'state' IN ('pending','dispatch_claimed','completed','uncertain','not_sent')
 AND jsonb_typeof(n->'authority')='object' AND jsonb_typeof(n->'intent')='object'
 AND jsonb_typeof(n->'approvalReceiptId') IN ('string','null') AND octet_length(n::text)<=1048576
$$;
CREATE FUNCTION design_policy_private.verify_request_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() THEN RETURN false; END IF;
 FOR r IN SELECT active FROM design_policy_private.context_permissions WHERE authority=a AND intent=i FOR SHARE LOOP
  IF r.active THEN RETURN true; END IF;
 END LOOP;RETURN false;END$$;
CREATE FUNCTION design_policy_private.read_approval(k text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;active_receipt boolean;BEGIN
 PERFORM design_identity.require_authority();
 SELECT record INTO r FROM design_policy_private.approvals WHERE owner_key=k FOR UPDATE;
 IF r IS NULL THEN RETURN NULL; END IF;
 SELECT active INTO active_receipt FROM design_policy_private.issued_receipts WHERE receipt_id=r->>'receiptId' FOR SHARE;
 IF active_receipt IS DISTINCT FROM true THEN RETURN jsonb_set(r,'{active}','false');END IF;
 RETURN r;END$$;
CREATE FUNCTION design_policy_private.insert_approval(k text,n jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE issued jsonb;live boolean;c integer;BEGIN
 IF n->'authority' IS DISTINCT FROM design_identity.require_authority() OR n->>'ownerKey' IS DISTINCT FROM k OR n->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR n->>'revision' IS DISTINCT FROM '1' OR n->'consumedBy' IS DISTINCT FROM 'null'::jsonb OR n->'active' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'POLICY_APPROVAL_DENIED';END IF;
 SELECT record,active INTO issued,live FROM design_policy_private.issued_receipts WHERE receipt_id=n->>'receiptId' FOR SHARE;
 IF live IS DISTINCT FROM true OR issued IS DISTINCT FROM n OR (n->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) THEN RAISE EXCEPTION 'POLICY_APPROVAL_DENIED';END IF;
 INSERT INTO design_policy_private.approvals VALUES(k,n->>'receiptId',n) ON CONFLICT DO NOTHING;GET DIAGNOSTICS c=ROW_COUNT;RETURN c=1;END$$;
CREATE FUNCTION design_policy_private.cas_approval(k text,v bigint,n jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior jsonb;c integer;BEGIN
 prior:=design_policy_private.read_approval(k);IF prior IS NULL OR (prior->>'revision')::bigint<>v THEN RETURN false;END IF;
 IF prior->'active' IS DISTINCT FROM 'true'::jsonb OR (n->>'revision')::bigint IS DISTINCT FROM v+1 THEN RAISE EXCEPTION 'POLICY_APPROVAL_IMMUTABLE';END IF;
 IF n->'active'='false'::jsonb THEN
  IF (n-ARRAY['revision','active']) IS DISTINCT FROM (prior-ARRAY['revision','active']) THEN RAISE EXCEPTION 'POLICY_APPROVAL_IMMUTABLE';END IF;
 ELSE
  IF n->'active' IS DISTINCT FROM 'true'::jsonb OR (n-ARRAY['revision','consumedBy']) IS DISTINCT FROM (prior-ARRAY['revision','consumedBy']) OR prior->'consumedBy' IS DISTINCT FROM 'null'::jsonb OR n->>'consumedBy' IS DISTINCT FROM k THEN RAISE EXCEPTION 'POLICY_APPROVAL_IMMUTABLE';END IF;
 END IF;
 IF n->'active'='true'::jsonb AND (prior->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) THEN RAISE EXCEPTION 'POLICY_APPROVAL_EXPIRED';END IF;
 UPDATE design_policy_private.approvals SET record=n WHERE owner_key=k AND (record->>'revision')::bigint=v;GET DIAGNOSTICS c=ROW_COUNT;RETURN c=1;END$$;
CREATE FUNCTION design_policy_private.read_attempt(k text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;BEGIN PERFORM design_identity.require_authority();SELECT record INTO r FROM design_policy_private.attempts WHERE owner_key=k FOR UPDATE;RETURN r;END$$;
CREATE FUNCTION design_policy_private.insert_attempt(k text,n jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;c integer;BEGIN
 IF design_policy_private.valid_attempt_shape(n) IS DISTINCT FROM true OR n->'authority' IS DISTINCT FROM design_identity.require_authority() OR n->>'ownerKey' IS DISTINCT FROM k OR n->>'schemaVersion' IS DISTINCT FROM 'design-provider-attempt-v1' OR n->>'revision' IS DISTINCT FROM '1' OR n->>'state' IS DISTINCT FROM 'pending' OR n->'result' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'POLICY_ATTEMPT_DENIED';END IF;
 IF NOT design_policy_private.verify_request_context(n->'authority',n->'intent') OR NOT EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE active AND authority=n->'authority' AND intent=n->'intent' AND owner_key=k AND legacy_key=n->>'legacyKey' AND legacy_fingerprint=n->>'legacyFingerprint') THEN RAISE EXCEPTION 'POLICY_CONTEXT_DENIED';END IF;
 IF n->'intent'->>'kind'='external' THEN
  a:=design_policy_private.read_approval(k);
  IF a IS NULL OR a->'active' IS DISTINCT FROM 'true'::jsonb OR a->'intent' IS DISTINCT FROM n->'intent' OR a->'authority' IS DISTINCT FROM n->'authority' OR a->>'receiptId' IS DISTINCT FROM n->>'approvalReceiptId' OR a->'consumedBy' IS DISTINCT FROM 'null'::jsonb OR (a->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) THEN RAISE EXCEPTION 'POLICY_APPROVAL_DENIED';END IF;
 ELSIF n->'intent'->>'kind'='local' THEN
  IF n->'approvalReceiptId' IS DISTINCT FROM 'null'::jsonb OR n->'intent'->>'operation'<>'server_synthesis' OR n->'intent'->>'destination'<>'local' OR n->'intent'->'cost' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'POLICY_LOCAL_DENIED';END IF;
 ELSE RAISE EXCEPTION 'POLICY_INTENT_DENIED';END IF;
 INSERT INTO design_policy_private.attempts VALUES(k,n) ON CONFLICT DO NOTHING;GET DIAGNOSTICS c=ROW_COUNT;RETURN c=1;END$$;
CREATE FUNCTION design_policy_private.cas_attempt(k text,v bigint,n jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior jsonb;a jsonb;oldstate text;newstate text;c integer;BEGIN
 prior:=design_policy_private.read_attempt(k);IF prior IS NULL OR (prior->>'revision')::bigint<>v THEN RETURN false;END IF;
 oldstate:=prior->>'state';newstate:=n->>'state';
 IF design_policy_private.valid_attempt_shape(n) IS DISTINCT FROM true OR (n->>'revision')::bigint IS DISTINCT FROM v+1 OR (n-ARRAY['revision','state','result','updatedAt']) IS DISTINCT FROM (prior-ARRAY['revision','state','result','updatedAt']) OR (n->>'updatedAt')::bigint<(prior->>'updatedAt')::bigint THEN RAISE EXCEPTION 'POLICY_ATTEMPT_IMMUTABLE';END IF;
 IF ((oldstate='pending' AND newstate IN ('dispatch_claimed','uncertain','not_sent')) OR (oldstate='dispatch_claimed' AND newstate IN ('completed','uncertain')) OR (oldstate='pending' AND newstate='completed' AND prior->'intent'->>'kind'='local')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'POLICY_ATTEMPT_TRANSITION';END IF;
 IF (newstate='completed' AND (n->'result' IS NULL OR n->'result'='null'::jsonb)) OR (newstate<>'completed' AND n->'result' IS DISTINCT FROM 'null'::jsonb) OR octet_length(n::text)>1048576 THEN RAISE EXCEPTION 'POLICY_RESULT_DENIED';END IF;
 IF newstate='dispatch_claimed' THEN
  IF NOT design_policy_private.verify_request_context(n->'authority',n->'intent') OR NOT EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE active AND authority=n->'authority' AND intent=n->'intent' AND owner_key=k AND legacy_key=n->>'legacyKey' AND legacy_fingerprint=n->>'legacyFingerprint') THEN RAISE EXCEPTION 'POLICY_CONTEXT_DENIED';END IF;
  a:=design_policy_private.read_approval(k);
  IF a IS NULL OR a->'active' IS DISTINCT FROM 'true'::jsonb OR a->>'consumedBy' IS DISTINCT FROM k OR a->'intent' IS DISTINCT FROM n->'intent' OR (a->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp())*1000) THEN RAISE EXCEPTION 'POLICY_APPROVAL_DENIED';END IF;
 END IF;
 UPDATE design_policy_private.attempts SET record=n WHERE owner_key=k AND (record->>'revision')::bigint=v;GET DIAGNOSTICS c=ROW_COUNT;RETURN c=1;END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_policy_private' AND p.proname NOT IN ('reject_authority_mutation','check_approval_commit_expiry') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO design_identity_capability',f.sig);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO design_identity_runtime',f.sig);
END LOOP;END$$;

REVOKE CREATE ON SCHEMA design_policy_private FROM design_identity_capability;
