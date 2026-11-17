-- OFFLINE PG17 synthetic fixture only. Additive v6, same shared request/attempt ledger.
-- No old function definition, key record, approval or production permission is changed.
-- Fresh check time is not an absolute physical-COMMIT/network-arrival guarantee.
DO $$BEGIN IF (current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regnamespace('design_canonical_verification') IS NULL OR to_regnamespace('design_candidate_provider_binding') IS NULL OR to_regnamespace('design_normalized_provider_binding') IS NOT NULL) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_FIXTURE_REQUIRED';END IF;END$$;
CREATE ROLE design_normalized_model_processing_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_normalized_model_cost_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE design_normalized_model_approval_issuer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_normalized_model_processing_issuer,design_normalized_model_cost_issuer,design_normalized_model_approval_issuer;
CREATE SCHEMA design_normalized_provider_binding AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_normalized_provider_binding FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_normalized_provider_binding TO design_identity_runtime,design_identity_capability,design_provider_issuer_capability,design_managed_image_capability,design_normalized_model_processing_issuer,design_normalized_model_cost_issuer,design_normalized_model_approval_issuer;
GRANT CREATE ON SCHEMA design_normalized_provider_binding TO design_identity_capability,design_provider_issuer_capability,design_managed_image_capability;
CREATE TABLE design_normalized_provider_binding.permissions(receipt_id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('processing','cost')),owner_key text NOT NULL,record jsonb NOT NULL,active boolean NOT NULL DEFAULT true,UNIQUE(kind,owner_key));
ALTER TABLE design_normalized_provider_binding.permissions OWNER TO design_identity_owner;
ALTER TABLE design_normalized_provider_binding.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_normalized_provider_binding.permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON design_normalized_provider_binding.permissions FROM PUBLIC,anon,authenticated,design_identity_runtime,design_normalized_model_processing_issuer,design_normalized_model_cost_issuer,design_normalized_model_approval_issuer;
GRANT SELECT,UPDATE(active) ON design_normalized_provider_binding.permissions TO design_identity_capability;
GRANT SELECT,INSERT,UPDATE(active) ON design_normalized_provider_binding.permissions TO design_provider_issuer_capability;
CREATE POLICY managed_permissions_runtime ON design_normalized_provider_binding.permissions TO design_identity_capability USING(record->'authority'=design_identity.require_authority());
CREATE POLICY managed_permissions_issuer ON design_normalized_provider_binding.permissions TO design_provider_issuer_capability USING(true) WITH CHECK(true);
CREATE TRIGGER managed_permission_immutable BEFORE UPDATE OR DELETE ON design_normalized_provider_binding.permissions FOR EACH ROW EXECUTE FUNCTION design_policy_private.reject_authority_mutation();
CREATE FUNCTION design_normalized_provider_binding.exact(v jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT coalesce(jsonb_typeof(v)='object' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)=(SELECT array_agg(k ORDER BY k) FROM unnest(keys) k),false)$$;
-- This internal capability owns existing managed tables; no LOGIN receives SELECT.
CREATE FUNCTION design_normalized_provider_binding.verified_context(a jsonb,tid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t jsonb;r jsonb;src jsonb;inp jsonb;BEGIN
 IF (session_user NOT IN ('design_identity_runtime','design_normalized_model_processing_issuer','design_normalized_model_cost_issuer','design_normalized_model_approval_issuer') OR tid IS NULL OR tid!~'^[A-Za-z0-9_-]{1,100}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 t:=design_canonical_verification.context(a,tid);
 SELECT report INTO STRICT r FROM design_canonical_verification.reports WHERE task_id=tid AND active FOR SHARE;
 IF r->>'state' IS DISTINCT FROM 'evidence_complete' THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_NOT_VERIFIED' USING ERRCODE='42501';END IF;
 PERFORM design_canonical_verification.check_report(t,r);src:=t->'claimedArtifact'->'artifact'->'sourceRecord';
 IF (src->'owner'=a AND src->>'stage'='before' AND src->>'angle' IN ('front','back','left','right') AND t->'policy'->>'scope'='synthetic_fixture_only' AND t->'policy'->>'id'='synthetic-pinned-producer-rgb8-v1' AND t->'claimedArtifact'->'artifact'->'parentResponse'->'descriptor'->'requestedTransform'->'maxEdge'='1024'::jsonb) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_INPUT_DENIED' USING ERRCODE='42501';END IF;
 inp:=jsonb_build_object('schemaVersion','design-normalized-strict-input-v1','taskId',t->'taskId','taskDigest',design_dependency_authority.digest(t),'verificationBinding',r->'verificationBinding','verificationReportDigest',design_dependency_authority.digest(r),'policyId',t->'policy'->'id','stage','before','angle',src->'angle','maxEdge',1024);
 IF t IS DISTINCT FROM design_canonical_verification.context(a,tid) THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_INPUT_CHANGED' USING ERRCODE='42501';END IF;
 PERFORM design_canonical_verification.check_report(t,r);RETURN jsonb_build_object('task',t,'report',r,'input',inp);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_INPUT_UNAVAILABLE' USING ERRCODE='42501';END$$;
CREATE FUNCTION design_normalized_provider_binding.context_for(a jsonb,tid text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;w jsonb;r jsonb;o jsonb;k jsonb;ki jsonb;key_receipt text;rev bigint;kb jsonb;wb jsonb;image jsonb;p text:='chat';BEGIN
 IF (session_user NOT IN ('design_identity_runtime','design_normalized_model_processing_issuer','design_normalized_model_cost_issuer','design_normalized_model_approval_issuer') OR rid IS NULL OR rid!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));b:=design_dependency_authority.checked_bundle(a);w:=b->'workflowRows'->-1;r:=w->'record';
 IF (w IS NULL OR r->'session'->>'phase' IS DISTINCT FROM 'before_analysis' OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store' OR w->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(r)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_WORKFLOW_DENIED' USING ERRCODE='42501';END IF;PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
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

 wb:=jsonb_build_object('recordRevision',w->'revision','recordDigest',w->'sha256','sessionId',r->'session'->'scope'->'sessionId','sessionRevision',r->'session'->'revision','sessionDigest',design_dependency_authority.digest(r->'session'));
 image:=design_normalized_provider_binding.verified_context(a,tid);
 IF (b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_WORKFLOW_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'keyRecord',k,'keyBinding',kb,'workflowBinding',wb,'normalizedInputBinding',image->'input','session',r->'session','task',image->'task','report',image->'report');
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';END$$;
CREATE FUNCTION design_normalized_provider_binding.authorize(token text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.authorize(token,scope);END$$;
CREATE FUNCTION design_normalized_provider_binding.recheck() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.require_authority();END$$;
CREATE FUNCTION design_normalized_provider_binding.read_context(tid text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;c jsonb;BEGIN a:=design_identity.require_authority();c:=design_normalized_provider_binding.context_for(a,tid,rid);IF (design_identity.require_authority() IS DISTINCT FROM a) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;RETURN c;END$$;
CREATE FUNCTION design_normalized_provider_binding.valid_intent(i jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE b jsonb;w jsonb;c jsonb;BEGIN
 IF (NOT design_normalized_provider_binding.exact(i,ARRAY['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost','schemaVersion','keyBinding','workflowBinding','normalizedBinding']) OR i->>'schemaVersion'<>'design-provider-intent-v6' OR i->>'kind'<>'external' OR i->>'operation'<>'analyze' OR i->>'destination'<>'https://api.deepseek.com/chat/completions' OR jsonb_typeof(i->'model') IS DISTINCT FROM 'string' OR i->>'model'!~'^[A-Za-z0-9._-]{1,80}$' OR jsonb_typeof(i->'requestId') IS DISTINCT FROM 'string' OR i->>'requestId'!~'^[A-Za-z0-9_-]{1,100}$' OR jsonb_typeof(i->'payloadSha256') IS DISTINCT FROM 'string' OR i->>'payloadSha256'!~'^[a-f0-9]{64}$' OR jsonb_typeof(i->'inputDigest') IS DISTINCT FROM 'string' OR i->>'inputDigest'!~'^[a-f0-9]{64}$' OR jsonb_typeof(i->'byteLength') IS DISTINCT FROM 'number' OR i->>'byteLength'!~'^[1-9][0-9]{0,6}$' OR (i->>'byteLength')::numeric>1048576 OR i->'dataKinds' IS DISTINCT FROM '["synthetic_verified_normalized_image"]'::jsonb OR i->'sourceRefs' IS DISTINCT FROM '[]'::jsonb OR i->>'purpose'<>'synthetic_normalized_before_candidates_for_employee_review' OR jsonb_typeof(i->'maxOutputTokens') IS DISTINCT FROM 'number' OR i->>'maxOutputTokens'!~'^[1-9][0-9]{0,3}$' OR (i->>'maxOutputTokens')::numeric>8192) IS DISTINCT FROM false THEN RETURN false;END IF;
 b:=i->'normalizedBinding';w:=i->'workflowBinding';c:=i->'cost';
 IF (NOT design_normalized_provider_binding.exact(b,ARRAY['promptVersion','input']) OR jsonb_typeof(b->'promptVersion') IS DISTINCT FROM 'string' OR b->>'promptVersion'!~'^[A-Za-z0-9._-]{1,100}$' OR jsonb_typeof(b->'input') IS DISTINCT FROM 'object' OR i->>'inputDigest' IS DISTINCT FROM design_dependency_authority.digest(b)
 OR NOT design_normalized_provider_binding.exact(w,ARRAY['recordRevision','recordDigest','sessionId','sessionRevision','sessionDigest']) OR jsonb_typeof(w->'recordRevision') IS DISTINCT FROM 'number' OR w->>'recordRevision'!~'^[0-9]{1,4}$' OR (w->>'recordRevision')::numeric>1000 OR jsonb_typeof(w->'sessionRevision') IS DISTINCT FROM 'number' OR w->>'sessionRevision'!~'^[0-9]{1,4}$' OR (w->>'sessionRevision')::numeric>1000 OR jsonb_typeof(w->'sessionId') IS DISTINCT FROM 'string' OR length(w->>'sessionId') NOT BETWEEN 1 AND 160 OR w->>'sessionId'~'[[:space:][:cntrl:]]' OR jsonb_typeof(w->'recordDigest') IS DISTINCT FROM 'string' OR w->>'recordDigest'!~'^[a-f0-9]{64}$' OR jsonb_typeof(w->'sessionDigest') IS DISTINCT FROM 'string' OR w->>'sessionDigest'!~'^[a-f0-9]{64}$'
 OR NOT design_normalized_provider_binding.exact(c,ARRAY['currency','maximumMinorUnits','maximumDispatches','commitment']) OR jsonb_typeof(c->'currency') IS DISTINCT FROM 'string' OR c->>'currency'!~'^[A-Z]{3}$' OR jsonb_typeof(c->'maximumMinorUnits') IS DISTINCT FROM 'number' OR c->>'maximumMinorUnits'!~'^[1-9][0-9]{0,8}$' OR (c->>'maximumMinorUnits')::numeric>100000000 OR c->'maximumDispatches' IS DISTINCT FROM '1'::jsonb OR c->>'commitment'<>'one_time' OR jsonb_typeof(i->'keyBinding') IS DISTINCT FROM 'object') IS DISTINCT FROM false THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;END$$;
CREATE FUNCTION design_normalized_provider_binding.context_matches(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE c jsonb;BEGIN
 IF design_normalized_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;
 c:=design_normalized_provider_binding.context_for(a,i->'normalizedBinding'->'input'->>'taskId',i->>'requestId');
 RETURN (c->'authority'=a AND c->'keyBinding'=i->'keyBinding' AND c->'workflowBinding'=i->'workflowBinding' AND c->'normalizedInputBinding'=i->'normalizedBinding'->'input' AND c->'keyBinding'->'destination'=i->'destination' AND c->'keyBinding'->'model'=i->'model') IS TRUE;
END$$;
CREATE FUNCTION design_normalized_provider_binding.permissions_rows(a jsonb,i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p design_normalized_provider_binding.permissions;c design_normalized_provider_binding.permissions;k text;now_ms bigint;BEGIN
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT * INTO STRICT p FROM design_normalized_provider_binding.permissions WHERE owner_key=k AND kind='processing' FOR SHARE;
 SELECT * INTO STRICT c FROM design_normalized_provider_binding.permissions WHERE owner_key=k AND kind='cost' FOR SHARE;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (NOT p.active OR NOT c.active OR p.record->'authority' IS DISTINCT FROM a OR c.record->'authority' IS DISTINCT FROM a OR p.record->'intent' IS DISTINCT FROM i OR c.record->'intent' IS DISTINCT FROM i OR (p.record->>'issuedAt')::bigint>now_ms OR (c.record->>'issuedAt')::bigint>now_ms OR (p.record->>'expiresAt')::bigint<=now_ms OR (c.record->>'expiresAt')::bigint<=now_ms) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_PERMISSION_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('processingReceiptId',p.receipt_id,'costReceiptId',c.receipt_id,'expiresAt',least((p.record->>'expiresAt')::bigint,(c.record->>'expiresAt')::bigint));END$$;
CREATE FUNCTION design_normalized_provider_binding.permissions_for(a jsonb,i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF design_normalized_provider_binding.context_matches(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;RETURN design_normalized_provider_binding.permissions_rows(a,i);END$$;
CREATE FUNCTION design_normalized_provider_binding.live_binding(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF (a IS DISTINCT FROM design_identity.require_authority()) IS DISTINCT FROM false THEN RETURN false;END IF;PERFORM design_normalized_provider_binding.permissions_for(a,i);RETURN (design_identity.require_authority() IS NOT DISTINCT FROM a);END$$;
CREATE FUNCTION design_normalized_provider_binding.verify_request_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF design_normalized_provider_binding.live_binding(a,i) IS DISTINCT FROM true THEN RETURN false;END IF;RETURN design_policy_private.verify_request_context(a,i) IS TRUE;END$$;
CREATE FUNCTION design_normalized_provider_binding.issuer_identity(token text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN
 IF (session_user NOT IN ('design_normalized_model_processing_issuer','design_normalized_model_cost_issuer','design_normalized_model_approval_issuer') OR token IS NULL OR length(token) NOT BETWEEN 32 AND 200 OR token~'[[:space:][:cntrl:]]') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));r:=design_identity.resolve_hash(encode(sha256(convert_to(token,'UTF8')),'hex'),scope);
 IF (((r->>'expiresAt')::timestamptz<=clock_timestamp())) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;RETURN r;END$$;
CREATE FUNCTION design_normalized_provider_binding.issue_permission(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint,permission_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved jsonb;a jsonb;k text;r jsonb;prior jsonb;active_prior boolean;now_ms bigint;deadline_ms bigint;BEGIN
 IF (permission_kind NOT IN ('processing','cost') OR session_user IS DISTINCT FROM ('design_normalized_model_'||permission_kind||'_issuer') OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 resolved:=design_normalized_provider_binding.issuer_identity(token,scope);a:=resolved->'authority';
 IF design_normalized_provider_binding.context_matches(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT record,active INTO prior,active_prior FROM design_normalized_provider_binding.permissions x WHERE x.receipt_id=issue_permission.receipt_id FOR SHARE;
 IF FOUND THEN
  IF (NOT active_prior OR prior->>'kind' IS DISTINCT FROM permission_kind OR prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM i OR (prior->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_PERMISSION_CONFLICT' USING ERRCODE='42501';END IF;RETURN prior;
 END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k) OR EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_normalized_provider_binding.issuer_identity(token,scope)->'authority' IS DISTINCT FROM a OR design_normalized_provider_binding.context_matches(a,i) IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);
 IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_PERMISSION_EXPIRED';END IF;
 r:=jsonb_build_object('receiptId',receipt_id,'kind',permission_kind,'authority',a,'intent',i,'issuedAt',now_ms,'expiresAt',deadline_ms);
 INSERT INTO design_normalized_provider_binding.permissions VALUES(receipt_id,permission_kind,k,r,true);RETURN r;END$$;
CREATE FUNCTION design_normalized_provider_binding.issue_processing(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_normalized_provider_binding.issue_permission(token,scope,receipt_id,i,ttl_ms,'processing')$$;
CREATE FUNCTION design_normalized_provider_binding.issue_cost(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_normalized_provider_binding.issue_permission(token,scope,receipt_id,i,ttl_ms,'cost')$$;
CREATE FUNCTION design_normalized_provider_binding.issue_approval(token text,scope jsonb,receipt_id text,intent jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved jsonb;a jsonb;k text;lk text;lf text;r jsonb;prior jsonb;active_prior boolean;perms jsonb;now_ms bigint;deadline_ms bigint;BEGIN
 IF (session_user<>'design_normalized_model_approval_issuer' OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 resolved:=design_normalized_provider_binding.issuer_identity(token,scope);a:=resolved->'authority';perms:=design_normalized_provider_binding.permissions_for(a,intent);
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',intent->'requestId'));
 SELECT record,active INTO prior,active_prior FROM design_policy_private.issued_receipts x WHERE x.receipt_id=issue_approval.receipt_id FOR SHARE;
 IF FOUND THEN
  IF (NOT active_prior OR prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM intent OR (prior->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_APPROVAL_CONFLICT' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('receiptId',prior->'receiptId','authority',a,'intent',intent,'issuedAt',prior->'issuedAt','expiresAt',prior->'expiresAt');
 END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k) OR EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_normalized_provider_binding.issuer_identity(token,scope)->'authority' IS DISTINCT FROM a) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 perms:=design_normalized_provider_binding.permissions_for(a,intent);now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,(perms->>'expiresAt')::bigint,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);
 IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_PERMISSION_EXPIRED';END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',intent->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 r:=jsonb_build_object('schemaVersion','design-provider-approval-v1','ownerKey',k,'revision',1,'receiptId',receipt_id,'authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms,'active',true,'consumedBy',null);
 INSERT INTO design_policy_private.issued_receipts VALUES(receipt_id,r,true);INSERT INTO design_policy_private.context_permissions VALUES(receipt_id,k,lk,lf,a,intent,true);
 RETURN jsonb_build_object('receiptId',receipt_id,'authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms);END$$;

CREATE FUNCTION design_normalized_provider_binding.result_valid(a jsonb,i jsonb,v jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;s jsonb;cid text;rb jsonb;e jsonb;field text;value jsonb;idx int:=0;seen text[]:=ARRAY[]::text[];sources jsonb:='[]'::jsonb;entries jsonb:='[]'::jsonb;src jsonb;expected_entry jsonb;expected_candidate jsonb;description text;previous jsonb;owner_key text;receipt_id text;native_field text;angle text;label text;BEGIN
 IF design_normalized_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;c:=design_normalized_provider_binding.context_for(a,i->'normalizedBinding'->'input'->>'taskId',i->>'requestId');s:=c->'session';
 cid:='normalized-'||design_dependency_authority.digest(jsonb_build_object('authority',a,'requestId',i->'requestId'));
 owner_key:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));SELECT x.receipt_id INTO STRICT receipt_id FROM design_policy_private.issued_receipts x WHERE x.record->>'ownerKey'=owner_key AND x.record->'authority'=a AND x.record->'intent'=i AND x.active;
 rb:=jsonb_build_object('requestId',i->'requestId','intentDigest',design_dependency_authority.digest(i),'payloadSha256',i->'payloadSha256','model',i->'model','promptVersion',i->'normalizedBinding'->'promptVersion','approvalReceiptId',receipt_id,'ownerKey',owner_key);
 angle:=i->'normalizedBinding'->'input'->>'angle';label:=CASE angle WHEN 'front' THEN '正面' WHEN 'back' THEN '背面' WHEN 'left' THEN '左侧' WHEN 'right' THEN '右侧' END;
 IF (NOT design_normalized_provider_binding.exact(v,ARRAY['schemaVersion','id','kind','generation','authority','scope','workflowBinding','requestBinding','normalizedBinding','descriptionSources','candidate']) OR v->>'schemaVersion'<>'design-managed-model-candidate-v4' OR v->>'id' IS DISTINCT FROM cid OR v->>'kind'<>'managed_normalized_before_view' OR v->>'generation' IS DISTINCT FROM 'synthetic_mock_model' OR v->'authority' IS DISTINCT FROM a OR v->'scope' IS DISTINCT FROM a->'scope' OR v->'workflowBinding' IS DISTINCT FROM i->'workflowBinding' OR v->'workflowBinding' IS DISTINCT FROM c->'workflowBinding' OR v->'requestBinding' IS DISTINCT FROM rb OR v->'normalizedBinding' IS DISTINCT FROM i->'normalizedBinding' OR s->>'phase' IS DISTINCT FROM 'before_analysis' OR jsonb_typeof(v->'candidate'->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'candidate'->'entries') NOT BETWEEN 1 AND 2 OR octet_length(v::text)>262144) IS DISTINCT FROM false THEN RETURN false;END IF;
 FOR e IN SELECT x FROM jsonb_array_elements(v->'candidate'->'entries') x LOOP
  native_field:=e->>'field';field:=CASE WHEN native_field='managed_before_outline_'||angle THEN 'visible_outline' WHEN native_field='managed_before_hair_shape_'||angle THEN 'visible_hair_shape' END;value:=e->'value';
  IF (field IS NULL OR field NOT IN ('visible_outline','visible_hair_shape') OR field=ANY(seen) OR value IS NULL OR (value<>'null'::jsonb AND (jsonb_typeof(value) IS DISTINCT FROM 'string' OR CASE WHEN field='visible_outline' THEN value#>>'{}' NOT IN ('轮廓偏圆','轮廓偏长','轮廓偏方','轮廓偏椭圆') ELSE value#>>'{}' NOT IN ('短发轮廓','中长发轮廓','长发轮廓','直线发丝形态','波浪发丝形态','卷曲发丝形态') END))) IS DISTINCT FROM false THEN RETURN false;END IF;
  seen:=array_append(seen,field);description:='合成演练，mock 响应，未调用真实模型；剪前'||label||'描述，未确认、非测量或实际操作：'||field||'：'||CASE WHEN value='null'::jsonb THEN '未知' ELSE value#>>'{}' END||'。';
  src:=jsonb_build_object('messageId','synthetic-normalized:'||cid||':'||idx,'kind','synthetic_image_description','actor','system','text',description);
  SELECT x.entry->'id' INTO previous FROM jsonb_array_elements(s->'entries') WITH ORDINALITY x(entry,ord)
   WHERE x.entry->>'category'='person_style' AND x.entry->>'field'=native_field AND x.entry->'zone'='null'::jsonb AND x.entry->>'track'='context' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(s->'entries') WITH ORDINALITY y(entry,ord) WHERE y.ord>x.ord AND
    jsonb_build_array(y.entry->'category',y.entry->'field',y.entry->'zone',y.entry->'track',y.entry->'groupId',y.entry->'service',y.entry->'side')=jsonb_build_array(x.entry->'category',x.entry->'field',x.entry->'zone',x.entry->'track',x.entry->'groupId',x.entry->'service',x.entry->'side')) ORDER BY x.ord LIMIT 1;
  expected_entry:=jsonb_build_object('id','synthetic-normalized-entry:'||cid||':'||idx,'category','person_style','field',native_field,'zone',null,'groupId',null,'service',null,'side',null,'track','context','origin','extraction','basis','observable','value',value,'status',CASE WHEN value='null'::jsonb THEN 'unknown' ELSE 'not_confirmed' END,'sources',CASE WHEN value='null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('messageId',src->'messageId','quote',description)) END,'replacesEntryId',previous);
  IF e IS DISTINCT FROM expected_entry THEN RETURN false;END IF;sources:=sources||jsonb_build_array(src);entries:=entries||jsonb_build_array(expected_entry);idx:=idx+1;
 END LOOP;
 expected_candidate:=jsonb_build_object('phase','before_analysis','entries',entries,'questions','[]'::jsonb,'warnings',jsonb_build_array('仅合成演练的 mock 响应，未调用真实模型，不可用于真实客户或生产；采纳不等于员工确认，更不代表实际操作。'));
 RETURN (v->'descriptionSources'=sources AND v->'candidate'=expected_candidate) IS TRUE;
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;END$$;
CREATE FUNCTION design_normalized_provider_binding.registered(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;lk text;lf text;BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() OR design_normalized_provider_binding.valid_intent(i) IS DISTINCT FROM true OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId')) THEN RETURN false;END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256'));
 SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=registered.receipt_id FOR SHARE;
 RETURN r IS NOT NULL AND r->>'schemaVersion'='design-provider-approval-v1' AND r->>'ownerKey'=k AND r->'authority'=a AND r->'intent'=i
 AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE id=receipt_id AND owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);
END$$;
-- Private SELECT-policy helper. Reads scope-RLS approvals, never attempts,
-- avoiding completed-attempt SELECT policy recursion. Terminal tombstones remain stored; only result delivery is denied.
CREATE FUNCTION design_normalized_provider_binding.completed_read_allowed(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 IF design_normalized_provider_binding.live_binding(a,i) IS DISTINCT FROM true OR design_normalized_provider_binding.registered(a,i,k,receipt_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT record,active INTO r,issued_active FROM design_policy_private.issued_receipts x WHERE x.receipt_id=completed_read_allowed.receipt_id FOR SHARE;
 SELECT active INTO context_active FROM design_policy_private.context_permissions x WHERE x.id=completed_read_allowed.receipt_id AND x.owner_key=k AND x.authority=a AND x.intent=i FOR SHARE;
 IF issued_active IS DISTINCT FROM true OR context_active IS DISTINCT FROM true OR r->>'receiptId' IS DISTINCT FROM receipt_id OR r->>'ownerKey' IS DISTINCT FROM k OR r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM i OR r->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(r->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'expiresAt') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
 SELECT record INTO approval FROM design_policy_private.approvals x WHERE x.owner_key=k FOR SHARE;
 IF approval IS NULL OR approval->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR approval->'authority' IS DISTINCT FROM a OR approval->'intent' IS DISTINCT FROM i OR approval->>'receiptId' IS DISTINCT FROM receipt_id OR approval->>'ownerKey' IS DISTINCT FROM k OR approval->'active' IS DISTINCT FROM 'true'::jsonb OR approval->>'consumedBy' IS DISTINCT FROM k OR approval->'issuedAt' IS DISTINCT FROM r->'issuedAt' OR approval->'expiresAt' IS DISTINCT FROM r->'expiresAt' THEN RETURN false;END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RETURN false;END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 RETURN (r->>'issuedAt')::numeric<=now_ms AND (r->>'expiresAt')::numeric>now_ms;
END$$;
CREATE FUNCTION design_normalized_provider_binding.verify_retained_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k text;selected_receipt text;c jsonb;r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 -- PRIVATE NOLOGIN workflow capability only. Caller proves exact permitted old-head→new-head transition.
 IF session_user<>'design_identity_runtime' OR a IS DISTINCT FROM design_identity.require_authority() OR design_normalized_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;
 c:=design_normalized_provider_binding.context_for(a,i->'normalizedBinding'->'input'->>'taskId',i->>'requestId');
 IF (c->'authority' IS DISTINCT FROM a OR c->'keyBinding' IS DISTINCT FROM i->'keyBinding' OR c->'normalizedInputBinding' IS DISTINCT FROM i->'normalizedBinding'->'input') IS DISTINCT FROM false THEN RETURN false;END IF;
 PERFORM design_normalized_provider_binding.permissions_rows(a,i);
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT x.record->>'receiptId' INTO STRICT selected_receipt FROM design_policy_private.issued_receipts x WHERE x.record->>'ownerKey'=k AND x.record->'authority'=a AND x.record->'intent'=i;
 IF design_normalized_provider_binding.registered(a,i,k,selected_receipt) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT record,active INTO r,issued_active FROM design_policy_private.issued_receipts x WHERE x.receipt_id=selected_receipt FOR SHARE;
 SELECT active INTO context_active FROM design_policy_private.context_permissions x WHERE x.id=selected_receipt AND x.owner_key=k AND x.authority=a AND x.intent=i FOR SHARE;
 IF issued_active IS DISTINCT FROM true OR context_active IS DISTINCT FROM true OR r->>'receiptId' IS DISTINCT FROM selected_receipt OR r->>'ownerKey' IS DISTINCT FROM k OR r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM i OR r->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(r->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'expiresAt') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
 SELECT record INTO approval FROM design_policy_private.approvals x WHERE x.owner_key=k FOR SHARE;
 IF approval IS NULL OR approval->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR approval->'authority' IS DISTINCT FROM a OR approval->'intent' IS DISTINCT FROM i OR approval->>'receiptId' IS DISTINCT FROM selected_receipt OR approval->>'ownerKey' IS DISTINCT FROM k OR approval->'active' IS DISTINCT FROM 'true'::jsonb OR approval->>'consumedBy' IS DISTINCT FROM k OR approval->'issuedAt' IS DISTINCT FROM r->'issuedAt' OR approval->'expiresAt' IS DISTINCT FROM r->'expiresAt' THEN RETURN false;END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RETURN false;END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 RETURN (r->>'issuedAt')::numeric<=now_ms AND (r->>'expiresAt')::numeric>now_ms;
END$$;
CREATE FUNCTION design_normalized_provider_binding.guard_bound_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n jsonb:=NEW.record;a jsonb;i jsonb;need_live boolean;selected_receipt text;issued jsonb;live boolean;BEGIN
 -- Legacy rows are left intact. A v6 row may never shed its binding version.
 IF TG_OP='UPDATE' AND OLD.record->'intent'->>'schemaVersion'='design-provider-intent-v6' AND n->'intent' IS DISTINCT FROM OLD.record->'intent' THEN RAISE EXCEPTION 'PROVIDER_BINDING_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF n->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v6' THEN RETURN NEW;END IF;
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
 IF design_normalized_provider_binding.registered(a,i,n->>'ownerKey',selected_receipt) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 IF need_live AND design_normalized_provider_binding.verify_request_context(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='attempts' AND n->>'state'='completed' AND design_normalized_provider_binding.result_valid(a,i,n->'result') IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_RESULT_INVALID' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;

CREATE FUNCTION design_normalized_provider_binding.read_issued(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;r jsonb;n int;BEGIN
 a:=design_identity.require_authority();SELECT count(*) INTO n FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id;
 IF n<>1 THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT record INTO STRICT r FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id FOR SHARE;
 IF (design_normalized_provider_binding.verify_request_context(a,r->'intent') IS DISTINCT FROM true OR (r->>'issuedAt')::bigint>floor(extract(epoch FROM clock_timestamp())*1000) OR (r->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('receiptId',r->'receiptId','authority',a,'intent',r->'intent','issuedAt',r->'issuedAt','expiresAt',r->'expiresAt');END$$;
CREATE FUNCTION design_normalized_provider_binding.revoke_permission(receipt_id text,permission_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE n int;BEGIN
 IF (permission_kind NOT IN ('processing','cost') OR session_user IS DISTINCT FROM ('design_normalized_model_'||permission_kind||'_issuer') OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));UPDATE design_normalized_provider_binding.permissions x SET active=false WHERE x.receipt_id=revoke_permission.receipt_id AND kind=permission_kind AND active;GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;END$$;
CREATE FUNCTION design_normalized_provider_binding.revoke_processing(receipt_id text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_normalized_provider_binding.revoke_permission(receipt_id,'processing')$$;
CREATE FUNCTION design_normalized_provider_binding.revoke_cost(receipt_id text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_normalized_provider_binding.revoke_permission(receipt_id,'cost')$$;
CREATE FUNCTION design_normalized_provider_binding.revoke_approval(receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN
 IF (session_user<>'design_normalized_model_approval_issuer' OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT record INTO STRICT r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=revoke_approval.receipt_id FOR UPDATE;
 IF (r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v6') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 UPDATE design_policy_private.issued_receipts x SET active=false WHERE x.receipt_id=revoke_approval.receipt_id;UPDATE design_policy_private.context_permissions x SET active=false WHERE x.id=revoke_approval.receipt_id AND x.owner_key=r->>'ownerKey' AND x.authority=r->'authority' AND x.intent=r->'intent';RETURN true;END$$;
CREATE FUNCTION design_normalized_provider_binding.verified_input(a jsonb,tid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE c jsonb;BEGIN c:=design_normalized_provider_binding.verified_context(a,tid);RETURN jsonb_build_object('taskId',tid,'task',c->'task','report',c->'report');END$$;
CREATE FUNCTION design_normalized_provider_binding.read_completed(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;k text;r jsonb;inp jsonb;BEGIN
 IF (session_user<>'design_identity_runtime' OR request_id IS NULL OR request_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',request_id));
 SELECT record INTO STRICT r FROM design_policy_private.attempts WHERE owner_key=k FOR SHARE;
 IF (r->>'state' IS DISTINCT FROM 'completed' OR r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v6' OR r->'authority' IS DISTINCT FROM a OR r->'intent'->>'requestId' IS DISTINCT FROM request_id OR design_normalized_provider_binding.completed_read_allowed(a,r->'intent',k,r->>'approvalReceiptId') IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_RESULT_DENIED' USING ERRCODE='42501';END IF;
 IF design_normalized_provider_binding.result_valid(a,r->'intent',r->'result') IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_RESULT_INVALID' USING ERRCODE='42501';END IF;
 inp:=design_normalized_provider_binding.verified_input(a,r->'intent'->'normalizedBinding'->'input'->>'taskId');
 IF (design_normalized_provider_binding.completed_read_allowed(a,r->'intent',k,r->>'approvalReceiptId') IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'NORMALIZED_PROVIDER_RESULT_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'intent',r->'intent','result',r->'result','input',inp);END$$;
CREATE TRIGGER provider_v6_approval_binding BEFORE INSERT OR UPDATE ON design_policy_private.approvals FOR EACH ROW EXECUTE FUNCTION design_normalized_provider_binding.guard_bound_ledger();
CREATE TRIGGER provider_v6_attempt_binding BEFORE INSERT OR UPDATE ON design_policy_private.attempts FOR EACH ROW EXECUTE FUNCTION design_normalized_provider_binding.guard_bound_ledger();
CREATE POLICY provider_v6_completed_read ON design_policy_private.attempts AS RESTRICTIVE FOR SELECT TO design_identity_capability USING(CASE WHEN record->'intent'->>'schemaVersion'='design-provider-intent-v6' AND record->>'state'='completed' THEN design_normalized_provider_binding.completed_read_allowed(record->'authority',record->'intent',owner_key,record->>'approvalReceiptId') ELSE true END);
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_normalized_provider_binding' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.sig,CASE WHEN f.proname IN ('verified_context','verified_input') THEN 'design_managed_image_capability' WHEN f.proname IN ('permissions_for','permissions_rows','issuer_identity','issue_permission','issue_processing','issue_cost','issue_approval','revoke_permission','revoke_processing','revoke_cost','revoke_approval') THEN 'design_provider_issuer_capability' ELSE 'design_identity_capability' END);
END LOOP;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_normalized_provider_binding FROM PUBLIC,anon,authenticated,design_identity_runtime,design_normalized_model_processing_issuer,design_normalized_model_cost_issuer,design_normalized_model_approval_issuer;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.verified_context(jsonb,text),design_normalized_provider_binding.verified_input(jsonb,text) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.context_for(jsonb,text,text),design_normalized_provider_binding.context_matches(jsonb,jsonb),design_normalized_provider_binding.valid_intent(jsonb),design_normalized_provider_binding.exact(jsonb,text[]) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.permissions_for(jsonb,jsonb),design_normalized_provider_binding.permissions_rows(jsonb,jsonb) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.authorize(text,jsonb),design_normalized_provider_binding.recheck(),design_normalized_provider_binding.read_context(text,text),design_normalized_provider_binding.verify_request_context(jsonb,jsonb),design_normalized_provider_binding.read_issued(text),design_normalized_provider_binding.read_completed(text) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.issue_processing(text,jsonb,text,jsonb,bigint),design_normalized_provider_binding.revoke_processing(text) TO design_normalized_model_processing_issuer;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.issue_cost(text,jsonb,text,jsonb,bigint),design_normalized_provider_binding.revoke_cost(text) TO design_normalized_model_cost_issuer;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.issue_approval(text,jsonb,text,jsonb,bigint),design_normalized_provider_binding.revoke_approval(text) TO design_normalized_model_approval_issuer;
REVOKE CREATE ON SCHEMA design_normalized_provider_binding FROM design_identity_capability,design_provider_issuer_capability,design_managed_image_capability;
