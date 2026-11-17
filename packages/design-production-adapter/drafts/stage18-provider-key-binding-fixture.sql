-- OFFLINE SYNTHETIC PG17 ONLY. Additive fixed provider/key/source binding.
-- No production migration, transport, plaintext key, or credential provisioning.
-- Call-time checks do not promise absolute wall-clock expiry at COMMIT/network arrival.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only'
 OR current_setting('server_version_num')::integer/10000<>17 OR to_regclass('design_policy_private.attempts') IS NULL
 OR to_regclass('design_key_private.key_versions') IS NULL OR to_regnamespace('design_dependency_authority') IS NULL
 OR to_regnamespace('design_provider_binding') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_PROVIDER_BINDING_REQUIRED';END IF;
END$$;
CREATE ROLE design_provider_approval_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_provider_issuer_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_provider_approval_issuer;
CREATE SCHEMA design_provider_binding AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_provider_binding FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_provider_binding TO design_identity_runtime,design_identity_capability,design_provider_approval_issuer,design_provider_issuer_capability;
GRANT CREATE ON SCHEMA design_provider_binding TO design_identity_capability,design_provider_issuer_capability;
GRANT USAGE ON SCHEMA design_policy_private,design_identity,design_key_private,design_dependency_authority TO design_provider_issuer_capability;
GRANT USAGE ON SCHEMA design_dependency_authority TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_identity.resolve_hash(text,jsonb) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_dependency_authority.checked_bundle(jsonb),design_dependency_authority.verify_refs(jsonb,jsonb),design_dependency_authority.canonical(jsonb),design_dependency_authority.digest(jsonb) TO design_identity_capability;
GRANT SELECT,INSERT,UPDATE(active) ON design_policy_private.issued_receipts,design_policy_private.context_permissions TO design_provider_issuer_capability;
CREATE POLICY provider_issuer_receipts ON design_policy_private.issued_receipts TO design_provider_issuer_capability USING(true) WITH CHECK(true);
CREATE POLICY provider_issuer_context ON design_policy_private.context_permissions TO design_provider_issuer_capability USING(true) WITH CHECK(true);

-- This helper is NOT executable by runtime. Only credential-resolved issuer or
-- the fixed runtime wrappers may supply authority. No caller-supplied authority channel.
CREATE FUNCTION design_provider_binding.context_for(a jsonb,p text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;w jsonb;r jsonb;o jsonb;k jsonb;ki jsonb;key_receipt text;rev bigint;kb jsonb;sb jsonb;cid text;existing jsonb;author jsonb;
BEGIN
 IF session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer') OR p IS NULL OR p NOT IN ('chat','speech') OR rid IS NULL OR rid !~ '^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'PROVIDER_BINDING_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 b:=design_dependency_authority.checked_bundle(a);w:=b->'workflowRows'->-1;r:=w->'record';
 IF w IS NULL OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store' OR w->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(r) THEN RAISE EXCEPTION 'PROVIDER_SOURCE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
 o:=design_key_private.owner_of(a);PERFORM design_key_private.lock_slot(o,p);
 SELECT h.revision,v.record,v.receipt_id INTO STRICT rev,k,key_receipt FROM design_key_private.key_heads h JOIN design_key_private.key_versions v USING(owner,purpose,revision) WHERE h.owner=o AND h.purpose=p FOR SHARE OF h;
 SELECT ap.intent INTO STRICT ki FROM design_key_private.approvals ap JOIN design_key_private.consumptions c USING(receipt_id) WHERE ap.receipt_id=key_receipt AND c.owner=o AND c.purpose=p AND c.target_revision=rev;
 IF k->>'schemaVersion' IS DISTINCT FROM 'design-key-record-v2' OR k->'owner' IS DISTINCT FROM o OR k->'enabled' IS DISTINCT FROM 'true'::jsonb OR k->'revision' IS DISTINCT FROM to_jsonb(rev) OR k->>'purpose' IS DISTINCT FROM p
 OR k->'securityEpoch' IS DISTINCT FROM a->'securityEpoch' OR k->'membershipRevision' IS DISTINCT FROM a->'membershipRevision'
 OR ki->>'action' IS DISTINCT FROM 'persist-design-key' OR design_key_private.owner_of(ki) IS DISTINCT FROM o OR ki->'securityEpoch' IS DISTINCT FROM a->'securityEpoch' OR ki->'membershipRevision' IS DISTINCT FROM a->'membershipRevision'
 OR ki->>'purpose' IS DISTINCT FROM p OR ki->'expectedRevision' IS DISTINCT FROM to_jsonb(rev-1) OR ki->'destination' IS DISTINCT FROM k->'destination' OR ki->'model' IS DISTINCT FROM k->'model'
 OR jsonb_typeof(ki->'keyDigest') IS DISTINCT FROM 'string' OR ki->>'keyDigest' !~ '^[A-Za-z0-9+/]{43}=$' THEN RAISE EXCEPTION 'PROVIDER_KEY_DENIED' USING ERRCODE='42501';END IF;
 IF octet_length(decode(ki->>'keyDigest','base64'))<>32 OR encode(decode(ki->>'keyDigest','base64'),'base64') IS DISTINCT FROM ki->>'keyDigest'
 OR (p='chat' AND (k->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/chat/completions' OR jsonb_typeof(k->'model') IS DISTINCT FROM 'string' OR k->>'model' !~ '^[A-Za-z0-9._-]{1,80}$'))
 OR (p='speech' AND (k->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/v1/tools/asr' OR k->'model' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'PROVIDER_KEY_DENIED' USING ERRCODE='42501';END IF;
 kb:=jsonb_build_object('owner',o,'securityEpoch',a->'securityEpoch','membershipRevision',a->'membershipRevision','purpose',p,'revision',rev,'destination',k->'destination','model',k->'model','keyDigest',ki->'keyDigest');
 sb:=jsonb_build_object('workflowRevision',w->'revision','workflowSha256',w->'sha256','sessionId',r->'session'->'scope'->'sessionId','sessionRevision',r->'session'->'revision','sessionDigest',design_dependency_authority.digest(r->'session'),'manifestId',b->'manifest'->'id','manifestFingerprint',b->'manifest'->'sourceFingerprint');
 IF p='chat' THEN
  cid:=design_dependency_authority.digest(jsonb_build_array(a->'actor',rid,'text_extraction'));
  SELECT value INTO existing FROM jsonb_array_elements(b->'candidateRows') WHERE value->>'candidate_id'=cid;
  IF existing IS NOT NULL THEN
   SELECT value INTO author FROM jsonb_array_elements(b->'dependencyAuthors') WHERE value->>'kind'='candidate' AND value->>'id'=cid;
   IF author IS NULL OR author->'authority' IS DISTINCT FROM a OR author->'sha256' IS DISTINCT FROM existing->'sha256' OR existing->'envelope'->>'kind' IS DISTINCT FROM 'text_extraction' OR existing->'envelope'->'actor' IS DISTINCT FROM a->'actor' OR existing->'active' IS DISTINCT FROM 'true'::jsonb OR existing->'consumed' IS DISTINCT FROM 'null'::jsonb OR (existing->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) OR existing->'envelope'->'scope' IS DISTINCT FROM a->'scope' OR existing->'envelope'->'sessionId' IS DISTINCT FROM r->'session'->'scope'->'sessionId' OR existing->'envelope'->'baseRevision' IS DISTINCT FROM r->'session'->'revision' OR existing->'envelope'->>'inputDigest' IS DISTINCT FROM design_dependency_authority.digest(r->'session') THEN RAISE EXCEPTION 'PROVIDER_CANDIDATE_OWNERSHIP_DENIED' USING ERRCODE='42501';END IF;
  END IF;
 END IF;
 IF b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'PROVIDER_SOURCE_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'keyRecord',k,'keyBinding',kb,'sourceBinding',sb);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'PROVIDER_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
END$$;
CREATE FUNCTION design_provider_binding.authorize(credential text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.authorize(credential,scope);END$$;
CREATE FUNCTION design_provider_binding.recheck() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.require_authority();END$$;
CREATE FUNCTION design_provider_binding.read_context(purpose text,request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;v jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();v:=design_provider_binding.context_for(a,purpose,request_id);
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'PROVIDER_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;RETURN v;
END$$;
CREATE FUNCTION design_provider_binding.valid_intent(i jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;BEGIN
 IF jsonb_typeof(i) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(i))<>16 OR (i-ARRAY['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost','schemaVersion','keyBinding','sourceBinding'])<>'{}'::jsonb
 OR i->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v2' OR i->>'kind' IS DISTINCT FROM 'external' OR i->>'requestId' IS NULL OR i->>'requestId' !~ '^[A-Za-z0-9:_-]{1,160}$'
 OR i->>'payloadSha256' IS NULL OR i->>'payloadSha256' !~ '^[a-f0-9]{64}$' OR i->>'inputDigest' IS NULL OR i->>'inputDigest' !~ '^[a-f0-9]{64}$'
 OR jsonb_typeof(i->'byteLength') IS DISTINCT FROM 'number' OR i->>'byteLength' !~ '^[1-9][0-9]{0,7}$' OR (i->>'byteLength')::numeric>8388608
 OR jsonb_typeof(i->'dataKinds') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'dataKinds') NOT BETWEEN 1 AND 8 OR i->'sourceRefs' IS DISTINCT FROM '[]'::jsonb
 OR jsonb_typeof(i->'cost') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(i->'cost'))<>3 OR ((i->'cost')-ARRAY['currency','maximumMinorUnits','commitment'])<>'{}'::jsonb
 OR i->'cost'->>'currency' IS NULL OR i->'cost'->>'currency' !~ '^[A-Z]{3}$' OR i->'cost'->>'commitment' IS DISTINCT FROM 'one_time' OR jsonb_typeof(i->'cost'->'maximumMinorUnits') IS DISTINCT FROM 'number' OR i->'cost'->>'maximumMinorUnits' !~ '^[1-9][0-9]{0,15}$' OR (i->'cost'->>'maximumMinorUnits')::numeric>9007199254740991 THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(i->'dataKinds'))<>jsonb_array_length(i->'dataKinds') THEN RETURN false;END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(i->'dataKinds') LOOP IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 160 OR (v#>>'{}')<>btrim(v#>>'{}') OR (v#>>'{}') ~ '[[:cntrl:]]' THEN RETURN false;END IF;END LOOP;
 IF i->>'operation'='analyze' THEN
  IF i->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/chat/completions' OR jsonb_typeof(i->'model') IS DISTINCT FROM 'string' OR i->>'model' !~ '^[A-Za-z0-9._-]{1,80}$' OR i->>'purpose' IS DISTINCT FROM 'verbatim_design_text_extraction'
  OR jsonb_typeof(i->'maxOutputTokens') IS DISTINCT FROM 'number' OR i->>'maxOutputTokens' !~ '^[1-9][0-9]{0,3}$' OR (i->>'maxOutputTokens')::numeric>8192 OR i->'inputDigest' IS DISTINCT FROM i->'sourceBinding'->'sessionDigest' OR i->'dataKinds' IS DISTINCT FROM '["scoped_human_text","speech_transcript_if_present"]'::jsonb THEN RETURN false;END IF;
 ELSIF i->>'operation'='speech' THEN
  IF i->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/v1/tools/asr' OR i->'model' IS DISTINCT FROM 'null'::jsonb OR i->'maxOutputTokens' IS DISTINCT FROM 'null'::jsonb OR i->>'purpose' IS DISTINCT FROM 'transcribe_for_employee_review' OR i->'inputDigest' IS DISTINCT FROM i->'payloadSha256' OR i->'dataKinds' IS DISTINCT FROM '["mono_pcm16_wav"]'::jsonb THEN RETURN false;END IF;
 ELSE RETURN false;END IF;
 RETURN true;
END$$;
-- No policy-table reads here: safe for the completed-attempt restrictive SELECT policy.
CREATE FUNCTION design_provider_binding.live_binding(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 IF design_provider_binding.valid_intent(i) IS DISTINCT FROM true OR a IS DISTINCT FROM design_identity.require_authority() THEN RETURN false;END IF;
 c:=design_provider_binding.read_context(CASE WHEN i->>'operation'='speech' THEN 'speech' ELSE 'chat' END,i->>'requestId');
 RETURN c->'authority'=a AND c->'keyBinding'=i->'keyBinding' AND c->'sourceBinding'=i->'sourceBinding' AND c->'keyBinding'->'destination'=i->'destination' AND c->'keyBinding'->'model'=i->'model';
END$$;
CREATE FUNCTION design_provider_binding.verify_request_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF design_provider_binding.live_binding(a,i) IS DISTINCT FROM true THEN RETURN false;END IF;
 RETURN design_policy_private.verify_request_context(a,i) IS TRUE;
END$$;
CREATE FUNCTION design_provider_binding.read_issued(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;r jsonb;n integer;BEGIN
 a:=design_identity.require_authority();
 SELECT count(*) INTO n FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id;
 IF n<>1 THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT record INTO STRICT r FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id FOR SHARE;
 IF design_provider_binding.verify_request_context(a,r->'intent') IS DISTINCT FROM true OR (r->>'issuedAt')::numeric>floor(extract(epoch FROM clock_timestamp())*1000) OR (r->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('receiptId',r->'receiptId','authority',r->'authority','intent',r->'intent','issuedAt',r->'issuedAt','expiresAt',r->'expiresAt');
END$$;
-- Independent issuer inserts into the SAME immutable approval/attempt ledger.
CREATE FUNCTION design_provider_binding.issue_approval(credential text,scope jsonb,receipt_id text,intent jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;a jsonb;c jsonb;prior jsonb;active_prior boolean;k text;lk text;lf text;r jsonb;now_ms bigint;deadline_ms bigint;
BEGIN
 IF session_user<>'design_provider_approval_issuer' OR credential IS NULL OR length(credential) NOT BETWEEN 32 AND 200 OR credential ~ '[[:space:][:cntrl:]]' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000 OR design_provider_binding.valid_intent(intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 resolved:=design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope);a:=resolved->'authority';
 c:=design_provider_binding.context_for(a,CASE WHEN intent->>'operation'='speech' THEN 'speech' ELSE 'chat' END,intent->>'requestId');
 IF c->'authority' IS DISTINCT FROM a OR c->'keyBinding' IS DISTINCT FROM intent->'keyBinding' OR c->'sourceBinding' IS DISTINCT FROM intent->'sourceBinding' OR intent->'destination' IS DISTINCT FROM c->'keyBinding'->'destination' OR intent->'model' IS DISTINCT FROM c->'keyBinding'->'model' THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',intent->'requestId'));
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',intent->'requestId'));
 lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 SELECT record,active INTO prior,active_prior FROM design_policy_private.issued_receipts x WHERE x.receipt_id=issue_approval.receipt_id FOR SHARE;
 IF FOUND THEN
  IF active_prior IS DISTINCT FROM true OR prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM intent OR prior->>'ownerKey' IS DISTINCT FROM k OR (prior->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_CONFLICT' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('receiptId',prior->'receiptId','authority',prior->'authority','intent',prior->'intent','issuedAt',prior->'issuedAt','expiresAt',prior->'expiresAt');
 END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k) OR EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) THEN RAISE EXCEPTION 'PROVIDER_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope))->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'PROVIDER_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);
 IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_EXPIRED' USING ERRCODE='42501';END IF;
 r:=jsonb_build_object('schemaVersion','design-provider-approval-v1','ownerKey',k,'revision',1,'receiptId',receipt_id,'authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms,'active',true,'consumedBy',null);
 INSERT INTO design_policy_private.issued_receipts VALUES(receipt_id,r,true);
 INSERT INTO design_policy_private.context_permissions VALUES(receipt_id,k,lk,lf,a,intent,true);
 RETURN jsonb_build_object('receiptId',r->'receiptId','authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms);
END$$;
CREATE FUNCTION design_provider_binding.revoke_approval(receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;BEGIN
 IF session_user<>'design_provider_approval_issuer' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=revoke_approval.receipt_id FOR UPDATE;
 IF r IS NULL THEN RETURN false;END IF;
 IF r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v2' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 UPDATE design_policy_private.issued_receipts x SET active=false WHERE x.receipt_id=revoke_approval.receipt_id;
 UPDATE design_policy_private.context_permissions SET active=false WHERE id=receipt_id AND owner_key=r->>'ownerKey' AND authority=r->'authority' AND intent=r->'intent';RETURN true;
END$$;
-- Verify exact issued/context mapping even for terminal tombstones. These two
-- rows contain no secret and remain immutable except independent issuer revocation.
CREATE FUNCTION design_provider_binding.registered(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;lk text;lf text;BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() OR design_provider_binding.valid_intent(i) IS DISTINCT FROM true OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId')) THEN RETURN false;END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256'));
 SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=registered.receipt_id FOR SHARE;
 RETURN r IS NOT NULL AND r->>'schemaVersion'='design-provider-approval-v1' AND r->>'ownerKey'=k AND r->'authority'=a AND r->'intent'=i
 AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE id=receipt_id AND owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);
END$$;
-- Private SELECT-policy helper. Reads scope-RLS approvals, never attempts,
-- avoiding completed-attempt SELECT policy recursion. Terminal tombstones remain stored; only result delivery is denied.
CREATE FUNCTION design_provider_binding.completed_read_allowed(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 IF design_provider_binding.live_binding(a,i) IS DISTINCT FROM true OR design_provider_binding.registered(a,i,k,receipt_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT record,active INTO r,issued_active FROM design_policy_private.issued_receipts x WHERE x.receipt_id=completed_read_allowed.receipt_id FOR SHARE;
 SELECT active INTO context_active FROM design_policy_private.context_permissions x WHERE x.id=completed_read_allowed.receipt_id AND x.owner_key=k AND x.authority=a AND x.intent=i FOR SHARE;
 IF issued_active IS DISTINCT FROM true OR context_active IS DISTINCT FROM true OR r->>'receiptId' IS DISTINCT FROM receipt_id OR r->>'ownerKey' IS DISTINCT FROM k OR r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM i OR r->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(r->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'expiresAt') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
 SELECT record INTO approval FROM design_policy_private.approvals x WHERE x.owner_key=k FOR SHARE;
 IF approval IS NULL OR approval->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR approval->'authority' IS DISTINCT FROM a OR approval->'intent' IS DISTINCT FROM i OR approval->>'receiptId' IS DISTINCT FROM receipt_id OR approval->>'ownerKey' IS DISTINCT FROM k OR approval->'active' IS DISTINCT FROM 'true'::jsonb OR approval->>'consumedBy' IS DISTINCT FROM k OR approval->'issuedAt' IS DISTINCT FROM r->'issuedAt' OR approval->'expiresAt' IS DISTINCT FROM r->'expiresAt' THEN RETURN false;END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RETURN false;END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 RETURN (r->>'issuedAt')::numeric<=now_ms AND (r->>'expiresAt')::numeric>now_ms;
END$$;
CREATE FUNCTION design_provider_binding.guard_bound_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n jsonb:=NEW.record;a jsonb;i jsonb;need_live boolean;selected_receipt text;issued jsonb;live boolean;BEGIN
 -- Legacy rows are left intact. A v2 row may never shed its binding version.
 IF TG_OP='UPDATE' AND OLD.record->'intent'->>'schemaVersion'='design-provider-intent-v2' AND n->'intent' IS DISTINCT FROM OLD.record->'intent' THEN RAISE EXCEPTION 'PROVIDER_BINDING_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF n->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v2' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();i:=n->'intent';
 IF n->'authority' IS DISTINCT FROM a OR NEW.owner_key IS DISTINCT FROM n->>'ownerKey' THEN RAISE EXCEPTION 'PROVIDER_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='approvals' THEN
  selected_receipt:=n->>'receiptId';need_live:=n->'active'='true'::jsonb;
  IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(n))<>10 OR (n-ARRAY['schemaVersion','ownerKey','revision','receiptId','authority','intent','issuedAt','expiresAt','active','consumedBy'])<>'{}'::jsonb OR n->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
  SELECT record,active INTO issued,live FROM design_policy_private.issued_receipts x WHERE x.receipt_id=selected_receipt FOR SHARE;
  IF issued IS NULL OR (n-ARRAY['revision','active','consumedBy']) IS DISTINCT FROM (issued-ARRAY['revision','active','consumedBy']) OR need_live AND live IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='attempts' THEN
  selected_receipt:=n->>'approvalReceiptId';need_live:=n->>'state' NOT IN ('uncertain','not_sent');
  IF design_policy_private.valid_attempt_shape(n) IS DISTINCT FROM true OR n->>'legacyKey' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId')) OR n->>'legacyFingerprint' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256')) THEN RAISE EXCEPTION 'PROVIDER_ATTEMPT_INVALID' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'PROVIDER_BINDING_INVALID' USING ERRCODE='42501';END IF;
 IF design_provider_binding.registered(a,i,n->>'ownerKey',selected_receipt) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 IF need_live AND design_provider_binding.verify_request_context(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER provider_v2_approval_binding BEFORE INSERT OR UPDATE ON design_policy_private.approvals FOR EACH ROW EXECUTE FUNCTION design_provider_binding.guard_bound_ledger();
CREATE TRIGGER provider_v2_attempt_binding BEFORE INSERT OR UPDATE ON design_policy_private.attempts FOR EACH ROW EXECUTE FUNCTION design_provider_binding.guard_bound_ledger();
-- A completed result must not be exposed through old read_attempt after key,
-- workflow, manifest, media or approval revocation/expiry. No result exists in pending/uncertain.
-- The helper raises on unavailable context rather than concealing an old attempt
-- as a new one. A false exact-binding comparison filters it; UNIQUE still denies reinsert.
CREATE POLICY provider_v2_completed_read ON design_policy_private.attempts AS RESTRICTIVE FOR SELECT TO design_identity_capability
 USING(CASE WHEN record->'intent'->>'schemaVersion'='design-provider-intent-v2' AND record->>'state'='completed' THEN design_provider_binding.completed_read_allowed(record->'authority',record->'intent',owner_key,record->>'approvalReceiptId') ELSE true END);

ALTER FUNCTION design_provider_binding.context_for(jsonb,text,text) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.authorize(text,jsonb) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.recheck() OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.read_context(text,text) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.valid_intent(jsonb) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.live_binding(jsonb,jsonb) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.verify_request_context(jsonb,jsonb) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.read_issued(text) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.issue_approval(text,jsonb,text,jsonb,bigint) OWNER TO design_provider_issuer_capability;
ALTER FUNCTION design_provider_binding.revoke_approval(text) OWNER TO design_provider_issuer_capability;
ALTER FUNCTION design_provider_binding.registered(jsonb,jsonb,text,text) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.completed_read_allowed(jsonb,jsonb,text,text) OWNER TO design_identity_capability;
ALTER FUNCTION design_provider_binding.guard_bound_ledger() OWNER TO design_identity_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_provider_binding FROM PUBLIC,anon,authenticated,design_identity_runtime,design_provider_approval_issuer;
GRANT EXECUTE ON FUNCTION design_provider_binding.context_for(jsonb,text,text),design_provider_binding.valid_intent(jsonb) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_dependency_authority.digest(jsonb),design_dependency_authority.canonical(jsonb) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_provider_binding.authorize(text,jsonb),design_provider_binding.recheck(),design_provider_binding.read_context(text,text),design_provider_binding.verify_request_context(jsonb,jsonb),design_provider_binding.read_issued(text) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_provider_binding.issue_approval(text,jsonb,text,jsonb,bigint),design_provider_binding.revoke_approval(text) TO design_provider_approval_issuer;
REVOKE CREATE ON SCHEMA design_provider_binding FROM design_identity_capability,design_provider_issuer_capability;
-- No old hashes/rows rewritten; no second ledger; no runtime table privileges.
-- SQL does not parse WAV or provider prompt: exact payload hash/cost approval and
-- trusted facade/decoder are separate mandatory preconditions, not inferred here.
