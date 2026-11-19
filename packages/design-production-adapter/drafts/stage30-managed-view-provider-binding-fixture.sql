-- OFFLINE PG17 synthetic fixture only. Additive v5, same shared request/attempt ledger.
-- No old function definition, key record, approval or production permission is changed.
-- Fresh check time is not an absolute physical-COMMIT/network-arrival guarantee.
DO $$BEGIN IF (current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regnamespace('design_managed_provider_binding') IS NULL OR to_regnamespace('design_candidate_provider_binding') IS NULL OR to_regnamespace('design_managed_view_provider_binding') IS NOT NULL) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_FIXTURE_REQUIRED';END IF;END$$;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_managed_model_processing_issuer,design_managed_model_cost_issuer,design_managed_model_approval_issuer;
CREATE SCHEMA design_managed_view_provider_binding AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_managed_view_provider_binding FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_managed_view_provider_binding TO design_identity_runtime,design_identity_capability,design_provider_issuer_capability,design_managed_image_capability,design_managed_model_processing_issuer,design_managed_model_cost_issuer,design_managed_model_approval_issuer;
GRANT CREATE ON SCHEMA design_managed_view_provider_binding TO design_identity_capability,design_provider_issuer_capability,design_managed_image_capability;
GRANT USAGE,CREATE ON SCHEMA design_managed_view_provider_binding TO design_candidate_local_capability;
CREATE TABLE design_managed_view_provider_binding.permissions(receipt_id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('processing','cost')),owner_key text NOT NULL,record jsonb NOT NULL,active boolean NOT NULL DEFAULT true,UNIQUE(kind,owner_key));
ALTER TABLE design_managed_view_provider_binding.permissions OWNER TO design_identity_owner;
ALTER TABLE design_managed_view_provider_binding.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_managed_view_provider_binding.permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON design_managed_view_provider_binding.permissions FROM PUBLIC,anon,authenticated,design_identity_runtime,design_managed_model_processing_issuer,design_managed_model_cost_issuer,design_managed_model_approval_issuer;
GRANT SELECT,UPDATE(active) ON design_managed_view_provider_binding.permissions TO design_identity_capability;
GRANT SELECT,INSERT,UPDATE(active) ON design_managed_view_provider_binding.permissions TO design_provider_issuer_capability;
CREATE POLICY managed_permissions_runtime ON design_managed_view_provider_binding.permissions TO design_identity_capability USING(record->'authority'=design_identity.require_authority());
CREATE POLICY managed_permissions_issuer ON design_managed_view_provider_binding.permissions TO design_provider_issuer_capability USING(true) WITH CHECK(true);
CREATE TRIGGER managed_permission_immutable BEFORE UPDATE OR DELETE ON design_managed_view_provider_binding.permissions FOR EACH ROW EXECUTE FUNCTION design_policy_private.reject_authority_mutation();
CREATE FUNCTION design_managed_view_provider_binding.exact(v jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT coalesce(jsonb_typeof(v)='object' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)=(SELECT array_agg(k ORDER BY k) FROM unnest(keys) k),false)$$;
-- This internal capability owns existing managed tables; no LOGIN receives SELECT.
CREATE FUNCTION design_managed_view_provider_binding.image_context(a jsonb,tid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE c jsonb;r jsonb;s jsonb;o jsonb;candidate jsonb;budget jsonb;binding jsonb;maximum integer;BEGIN
 IF (session_user NOT IN ('design_identity_runtime','design_managed_model_processing_issuer','design_managed_model_cost_issuer','design_managed_model_approval_issuer') OR tid IS NULL OR tid!~'^[A-Za-z0-9_-]{1,100}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT report INTO STRICT r FROM design_managed_derived.reports WHERE task_id=tid AND active FOR SHARE;
 IF (r->>'state' IS DISTINCT FROM 'evidence_complete') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_NOT_VERIFIED' USING ERRCODE='42501';END IF;
 c:=design_managed_derived.check_report(a,tid,r);s:=c->'sourceRecord';o:=c->'objectReceipt';
 IF (s->>'stage' NOT IN ('before','after') OR s->>'angle' NOT IN ('front','back','left','right')) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_INPUT_DENIED' USING ERRCODE='42501';END IF;
 maximum:=CASE WHEN c->'response'->'descriptor'->'requestedTransform'->>'maxEdge'='1024' THEN 262144 WHEN c->'response'->'descriptor'->'requestedTransform'->>'maxEdge'='1536' THEN 524288 ELSE 0 END;
 IF (((o->'derivative'->>'byteLength')::bigint BETWEEN 1 AND maximum)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_PROVIDER_INPUT_DENIED' USING ERRCODE='42501';END IF;
 budget:=jsonb_build_object('maxEdge',c->'response'->'descriptor'->'requestedTransform'->'maxEdge','mime',o->'derivative'->'mime','maximumBytes',maximum);
 candidate:=jsonb_build_object('schemaVersion','design-managed-image-candidate-v1','id',design_dependency_authority.digest(jsonb_build_object('sourceRecord',s,'response',c->'response','evidence',r->'evidence')),'sourceRecord',s,'response',c->'response','evidence',r->'evidence','technicalStatus','evidence_complete','budget',budget,'submissionAuthorized',false,'adoptionAuthorized',false,'publicEligible',false);
 binding:=jsonb_build_object('taskId',tid,'candidateDigest',design_dependency_authority.digest(candidate),'objectReceiptDigest',design_dependency_authority.digest(o),'verificationReportDigest',design_dependency_authority.digest(r),'authority',a,'sourceRecordDigest',design_dependency_authority.digest(s),'responseDigest',design_dependency_authority.digest(c->'response'),'evidenceDigest',design_dependency_authority.digest(r->'evidence'),'sourceObject',s->'object','derivativeObject',o->'object','sourceSha256',s->'source'->'sha256','derivativeSha256',o->'derivative'->'sha256','mime',o->'derivative'->'mime','byteLength',o->'derivative'->'byteLength','maxEdge',budget->'maxEdge','stage',s->'stage','angle',s->'angle');
 PERFORM design_managed_derived.check_report(a,tid,r);RETURN binding;END$$;
CREATE FUNCTION design_managed_view_provider_binding.context_for(a jsonb,ck text,sel jsonb,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;w jsonb;r jsonb;o jsonb;k jsonb;ki jsonb;key_receipt text;rev bigint;kb jsonb;wb jsonb;e jsonb;one jsonb;two jsonb;p text:='chat';BEGIN
 IF (session_user NOT IN ('design_identity_runtime','design_managed_model_processing_issuer','design_managed_model_cost_issuer','design_managed_model_approval_issuer') OR rid IS NULL OR rid!~'^[A-Za-z0-9_-]{1,100}$' OR ck IS NULL OR ck NOT IN ('managed_before_view','managed_completion_comparison','managed_completion_synthesis')) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_VIEW_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));b:=design_dependency_authority.checked_bundle(a);w:=b->'workflowRows'->-1;r:=w->'record';
 IF (w IS NULL OR r->'session'->>'phase' IS DISTINCT FROM CASE WHEN ck='managed_before_view' THEN 'before_analysis' ELSE 'completed_review' END OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store' OR w->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(r)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_VIEW_WORKFLOW_DENIED' USING ERRCODE='42501';END IF;PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
 IF ck='managed_before_view' THEN
  IF design_managed_view_provider_binding.exact(sel,ARRAY['taskId']) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_SELECTORS_DENIED';END IF;
  one:=design_managed_view_provider_binding.image_context(a,sel->>'taskId');IF one->>'stage' IS DISTINCT FROM 'before' THEN RAISE EXCEPTION 'MANAGED_VIEW_STAGE_DENIED';END IF;e:=jsonb_build_object('angle',one->'angle','images',jsonb_build_array(one));
 ELSIF ck='managed_completion_comparison' THEN
  IF design_managed_view_provider_binding.exact(sel,ARRAY['beforeTaskId','afterTaskId']) IS DISTINCT FROM true OR sel->>'beforeTaskId' IS NOT DISTINCT FROM sel->>'afterTaskId' THEN RAISE EXCEPTION 'MANAGED_VIEW_SELECTORS_DENIED';END IF;
  one:=design_managed_view_provider_binding.image_context(a,sel->>'beforeTaskId');two:=design_managed_view_provider_binding.image_context(a,sel->>'afterTaskId');
  IF one->>'stage' IS DISTINCT FROM 'before' OR two->>'stage' IS DISTINCT FROM 'after' OR one->'angle' IS DISTINCT FROM two->'angle' OR one->'sourceObject' IS NOT DISTINCT FROM two->'sourceObject' THEN RAISE EXCEPTION 'MANAGED_VIEW_PAIR_DENIED';END IF;e:=jsonb_build_object('angle',one->'angle','images',jsonb_build_array(one,two));
 ELSE
  IF design_managed_view_provider_binding.exact(sel,ARRAY['side']) IS DISTINCT FROM true OR (sel->>'side' IN ('left','right')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_SELECTORS_DENIED';END IF;
  e:=design_managed_view_provider_binding.synthesis_evidence(a,b,sel->>'side');
 END IF;
 IF ck<>'managed_completion_synthesis' OR e->>'generation'<>'deterministic' THEN
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

 END IF;
 wb:=jsonb_build_object('recordRevision',w->'revision','recordDigest',w->'sha256','sessionId',r->'session'->'scope'->'sessionId','sessionRevision',r->'session'->'revision','sessionDigest',design_dependency_authority.digest(r->'session'));
 IF (b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_VIEW_WORKFLOW_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'keyRecord',k,'keyBinding',kb,'workflowBinding',wb,'evidenceBinding',e,'session',r->'session','managedImageHistory',coalesce(r->'managedImageHistory',jsonb_build_object('schemaVersion','design-managed-image-history-v2','inputs','[]'::jsonb,'accepted','[]'::jsonb)));
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'MANAGED_VIEW_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';END$$;
CREATE FUNCTION design_managed_view_provider_binding.authorize(token text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.authorize(token,scope);END$$;
CREATE FUNCTION design_managed_view_provider_binding.recheck() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.require_authority();END$$;
CREATE FUNCTION design_managed_view_provider_binding.read_context(ck text,sel jsonb,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;c jsonb;BEGIN a:=design_identity.require_authority();c:=design_managed_view_provider_binding.context_for(a,ck,sel,rid);IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'MANAGED_VIEW_DENIED' USING ERRCODE='42501';END IF;RETURN c;END$$;
CREATE FUNCTION design_managed_view_provider_binding.selectors(i jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT CASE i->>'candidateKind' WHEN 'managed_before_view' THEN jsonb_build_object('taskId',i->'evidenceBinding'->'images'->0->'taskId') WHEN 'managed_completion_comparison' THEN jsonb_build_object('beforeTaskId',i->'evidenceBinding'->'images'->0->'taskId','afterTaskId',i->'evidenceBinding'->'images'->1->'taskId') WHEN 'managed_completion_synthesis' THEN jsonb_build_object('side',i->'evidenceBinding'->'side') ELSE NULL END$$;
CREATE FUNCTION design_managed_view_provider_binding.valid_intent(i jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE w jsonb;c jsonb;e jsonb;ck text;purpose text;local_body jsonb;choices jsonb;BEGIN
 IF (design_managed_view_provider_binding.exact(i,ARRAY['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost','schemaVersion','keyBinding','workflowBinding','evidenceBinding','candidateKind','promptVersion']) AND i->>'schemaVersion'='design-provider-intent-v5' AND jsonb_typeof(i->'requestId')='string' AND i->>'requestId'~'^[A-Za-z0-9_-]{1,100}$' AND jsonb_typeof(i->'payloadSha256')='string' AND i->>'payloadSha256'~'^[a-f0-9]{64}$' AND jsonb_typeof(i->'byteLength')='number' AND i->>'byteLength'~'^[1-9][0-9]{0,6}$' AND (i->>'byteLength')::numeric<=1048576 AND i->'sourceRefs'='[]'::jsonb AND jsonb_typeof(i->'promptVersion')='string' AND i->>'promptVersion'~'^[A-Za-z0-9._-]{1,100}$') IS DISTINCT FROM true THEN RETURN false;END IF;
 ck:=i->>'candidateKind';e:=i->'evidenceBinding';w:=i->'workflowBinding';c:=i->'cost';purpose:=CASE ck WHEN 'managed_before_view' THEN 'managed_before_view_candidates_for_employee_review' WHEN 'managed_completion_comparison' THEN 'managed_completion_comparison_for_employee_review' WHEN 'managed_completion_synthesis' THEN 'managed_completion_synthesis_for_employee_review' END;
 IF purpose IS NULL OR i->>'purpose' IS DISTINCT FROM purpose OR i->>'inputDigest' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('candidateKind',ck,'promptVersion',i->'promptVersion','evidenceBinding',e)) OR i->'dataKinds' IS DISTINCT FROM (CASE WHEN ck='managed_completion_synthesis' THEN '["accepted_managed_comparison_evidence"]'::jsonb ELSE '["private_verified_managed_image_derivative"]'::jsonb END) THEN RETURN false;END IF;
 IF (design_managed_view_provider_binding.exact(w,ARRAY['recordRevision','recordDigest','sessionId','sessionRevision','sessionDigest']) AND jsonb_typeof(w->'recordRevision')='number' AND w->>'recordRevision'~'^[0-9]{1,4}$' AND (w->>'recordRevision')::numeric<=1000 AND jsonb_typeof(w->'sessionRevision')='number' AND w->>'sessionRevision'~'^[0-9]{1,4}$' AND (w->>'sessionRevision')::numeric<=1000 AND jsonb_typeof(w->'sessionId')='string' AND length(w->>'sessionId') BETWEEN 1 AND 160 AND jsonb_typeof(w->'recordDigest')='string' AND w->>'recordDigest'~'^[a-f0-9]{64}$' AND jsonb_typeof(w->'sessionDigest')='string' AND w->>'sessionDigest'~'^[a-f0-9]{64}$') IS DISTINCT FROM true THEN RETURN false;END IF;
 IF ck='managed_completion_synthesis' THEN
  IF (design_managed_view_provider_binding.exact(e,ARRAY['side','ancestors','missingAngles','uncomparableAngles','conflictingAngles','confirmedAngles','unconfirmedAngles','assessment','generation']) AND e->>'side' IN ('left','right') AND jsonb_typeof(e->'ancestors')='array' AND jsonb_array_length(e->'ancestors') BETWEEN 1 AND 3 AND e->>'generation' IN ('deterministic','model_review_focus')) IS DISTINCT FROM true THEN RETURN false;END IF;
 ELSE
  IF (design_managed_view_provider_binding.exact(e,ARRAY['angle','images']) AND e->>'angle' IN ('front','back','left','right') AND jsonb_typeof(e->'images')='array' AND jsonb_array_length(e->'images')=CASE WHEN ck='managed_before_view' THEN 1 ELSE 2 END AND e->'images'->0->>'stage'='before' AND e->'images'->0->'angle'=e->'angle') IS DISTINCT FROM true THEN RETURN false;END IF;
  IF ck='managed_completion_comparison' AND (e->'images'->1->>'stage'='after' AND e->'images'->1->'angle'=e->'angle' AND e->'images'->1->'taskId'<>e->'images'->0->'taskId' AND e->'images'->1->'sourceObject'<>e->'images'->0->'sourceObject') IS DISTINCT FROM true THEN RETURN false;END IF;
 END IF;
 IF i->>'kind'='local' THEN
  IF (ck='managed_completion_synthesis' AND e->>'generation'='deterministic' AND i->>'operation'='server_synthesis' AND i->>'destination'='local' AND i->>'model'='server-deterministic' AND i->'keyBinding'='null'::jsonb AND c='null'::jsonb AND i->'maxOutputTokens'='0'::jsonb AND i->>'promptVersion'='managed-synthesis-deterministic-v1') IS DISTINCT FROM true THEN RETURN false;END IF;
  choices:=design_managed_view_provider_binding.review_choices(e);IF jsonb_array_length(choices)>1 THEN RETURN false;END IF;
  local_body:=jsonb_build_object('candidateKind',ck,'evidenceBinding',e,'result',jsonb_build_object('reviewFocus',coalesce(choices->0,'null'::jsonb)));
  RETURN i->>'payloadSha256'=design_dependency_authority.digest(local_body) AND (i->>'byteLength')::bigint=octet_length(convert_to(design_dependency_authority.canonical(local_body),'UTF8'));
 END IF;
 RETURN (i->>'kind'='external' AND (ck<>'managed_completion_synthesis' OR e->>'generation'='model_review_focus') AND i->>'operation'='analyze' AND i->>'destination'='https://api.deepseek.com/chat/completions' AND jsonb_typeof(i->'model')='string' AND i->>'model'~'^[A-Za-z0-9._-]{1,80}$' AND jsonb_typeof(i->'maxOutputTokens')='number' AND i->>'maxOutputTokens'~'^[1-9][0-9]{0,3}$' AND (i->>'maxOutputTokens')::numeric<=8192 AND jsonb_typeof(i->'keyBinding')='object' AND design_managed_view_provider_binding.exact(c,ARRAY['currency','maximumMinorUnits','maximumDispatches','commitment']) AND jsonb_typeof(c->'currency')='string' AND c->>'currency'~'^[A-Z]{3}$' AND jsonb_typeof(c->'maximumMinorUnits')='number' AND c->>'maximumMinorUnits'~'^[1-9][0-9]{0,8}$' AND (c->>'maximumMinorUnits')::numeric<=100000000 AND c->'maximumDispatches'='1'::jsonb AND c->>'commitment'='one_time') IS TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;END$$;

CREATE FUNCTION design_managed_view_provider_binding.context_matches(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE c jsonb;BEGIN
 IF design_managed_view_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;
 c:=design_managed_view_provider_binding.context_for(a,i->>'candidateKind',design_managed_view_provider_binding.selectors(i),i->>'requestId');
 RETURN (c->'authority'=a AND c->'keyBinding'=i->'keyBinding' AND c->'workflowBinding'=i->'workflowBinding' AND c->'evidenceBinding'=i->'evidenceBinding' AND (i->>'kind'='local' OR c->'keyBinding'->'destination'=i->'destination' AND c->'keyBinding'->'model'=i->'model')) IS TRUE;
END$$;
CREATE FUNCTION design_managed_view_provider_binding.permissions_rows(a jsonb,i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p design_managed_view_provider_binding.permissions;c design_managed_view_provider_binding.permissions;k text;now_ms bigint;BEGIN
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT * INTO STRICT p FROM design_managed_view_provider_binding.permissions WHERE owner_key=k AND kind='processing' FOR SHARE;
 SELECT * INTO STRICT c FROM design_managed_view_provider_binding.permissions WHERE owner_key=k AND kind='cost' FOR SHARE;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (NOT p.active OR NOT c.active OR p.record->'authority' IS DISTINCT FROM a OR c.record->'authority' IS DISTINCT FROM a OR p.record->'intent' IS DISTINCT FROM i OR c.record->'intent' IS DISTINCT FROM i OR (p.record->>'issuedAt')::bigint>now_ms OR (c.record->>'issuedAt')::bigint>now_ms OR (p.record->>'expiresAt')::bigint<=now_ms OR (c.record->>'expiresAt')::bigint<=now_ms) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_PERMISSION_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('processingReceiptId',p.receipt_id,'costReceiptId',c.receipt_id,'expiresAt',least((p.record->>'expiresAt')::bigint,(c.record->>'expiresAt')::bigint));END$$;
CREATE FUNCTION design_managed_view_provider_binding.permissions_for(a jsonb,i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF i->>'kind' IS DISTINCT FROM 'external' OR design_managed_view_provider_binding.context_matches(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;RETURN design_managed_view_provider_binding.permissions_rows(a,i);END$$;
CREATE FUNCTION design_managed_view_provider_binding.live_binding(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF (a IS DISTINCT FROM design_identity.require_authority()) IS DISTINCT FROM false THEN RETURN false;END IF;IF i->>'kind'='local' THEN IF design_managed_view_provider_binding.context_matches(a,i) IS DISTINCT FROM true THEN RETURN false;END IF;ELSE PERFORM design_managed_view_provider_binding.permissions_for(a,i);END IF;RETURN (design_identity.require_authority() IS NOT DISTINCT FROM a);END$$;
CREATE FUNCTION design_managed_view_provider_binding.verify_request_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF design_managed_view_provider_binding.live_binding(a,i) IS DISTINCT FROM true THEN RETURN false;END IF;RETURN design_policy_private.verify_request_context(a,i) IS TRUE;END$$;
CREATE FUNCTION design_managed_view_provider_binding.issuer_identity(token text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN
 IF (session_user NOT IN ('design_managed_model_processing_issuer','design_managed_model_cost_issuer','design_managed_model_approval_issuer') OR token IS NULL OR length(token) NOT BETWEEN 32 AND 200 OR token~'[[:space:][:cntrl:]]') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));r:=design_identity.resolve_hash(encode(sha256(convert_to(token,'UTF8')),'hex'),scope);
 IF (((r->>'expiresAt')::timestamptz<=clock_timestamp())) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;RETURN r;END$$;
CREATE FUNCTION design_managed_view_provider_binding.issue_permission(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint,permission_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved jsonb;a jsonb;k text;r jsonb;prior jsonb;active_prior boolean;now_ms bigint;deadline_ms bigint;BEGIN
 IF (permission_kind NOT IN ('processing','cost') OR session_user IS DISTINCT FROM ('design_managed_model_'||permission_kind||'_issuer') OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 resolved:=design_managed_view_provider_binding.issuer_identity(token,scope);a:=resolved->'authority';
 IF i->>'kind' IS DISTINCT FROM 'external' OR design_managed_view_provider_binding.context_matches(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT record,active INTO prior,active_prior FROM design_managed_view_provider_binding.permissions x WHERE x.receipt_id=issue_permission.receipt_id FOR SHARE;
 IF FOUND THEN
  IF (NOT active_prior OR prior->>'kind' IS DISTINCT FROM permission_kind OR prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM i OR (prior->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_PERMISSION_CONFLICT' USING ERRCODE='42501';END IF;RETURN prior;
 END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k) OR EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) THEN RAISE EXCEPTION 'MANAGED_PROVIDER_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_managed_view_provider_binding.issuer_identity(token,scope)->'authority' IS DISTINCT FROM a OR design_managed_view_provider_binding.context_matches(a,i) IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);
 IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'MANAGED_PROVIDER_PERMISSION_EXPIRED';END IF;
 r:=jsonb_build_object('receiptId',receipt_id,'kind',permission_kind,'authority',a,'intent',i,'issuedAt',now_ms,'expiresAt',deadline_ms);
 INSERT INTO design_managed_view_provider_binding.permissions VALUES(receipt_id,permission_kind,k,r,true);RETURN r;END$$;
CREATE FUNCTION design_managed_view_provider_binding.issue_processing(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_managed_view_provider_binding.issue_permission(token,scope,receipt_id,i,ttl_ms,'processing')$$;
CREATE FUNCTION design_managed_view_provider_binding.issue_cost(token text,scope jsonb,receipt_id text,i jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_managed_view_provider_binding.issue_permission(token,scope,receipt_id,i,ttl_ms,'cost')$$;
CREATE FUNCTION design_managed_view_provider_binding.issue_approval(token text,scope jsonb,receipt_id text,intent jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved jsonb;a jsonb;k text;lk text;lf text;r jsonb;prior jsonb;active_prior boolean;perms jsonb;now_ms bigint;deadline_ms bigint;BEGIN
 IF (session_user<>'design_managed_model_approval_issuer' OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 resolved:=design_managed_view_provider_binding.issuer_identity(token,scope);a:=resolved->'authority';perms:=design_managed_view_provider_binding.permissions_for(a,intent);
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',intent->'requestId'));
 SELECT record,active INTO prior,active_prior FROM design_policy_private.issued_receipts x WHERE x.receipt_id=issue_approval.receipt_id FOR SHARE;
 IF FOUND THEN
  IF (NOT active_prior OR prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM intent OR (prior->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_APPROVAL_CONFLICT' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('receiptId',prior->'receiptId','authority',a,'intent',intent,'issuedAt',prior->'issuedAt','expiresAt',prior->'expiresAt');
 END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k) OR EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) THEN RAISE EXCEPTION 'MANAGED_PROVIDER_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_managed_view_provider_binding.issuer_identity(token,scope)->'authority' IS DISTINCT FROM a) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_CHANGED' USING ERRCODE='42501';END IF;
 perms:=design_managed_view_provider_binding.permissions_for(a,intent);now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,(perms->>'expiresAt')::bigint,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);
 IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'MANAGED_PROVIDER_PERMISSION_EXPIRED';END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',intent->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 r:=jsonb_build_object('schemaVersion','design-provider-approval-v1','ownerKey',k,'revision',1,'receiptId',receipt_id,'authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms,'active',true,'consumedBy',null);
 INSERT INTO design_policy_private.issued_receipts VALUES(receipt_id,r,true);INSERT INTO design_policy_private.context_permissions VALUES(receipt_id,k,lk,lf,a,intent,true);
 RETURN jsonb_build_object('receiptId',receipt_id,'authority',a,'intent',intent,'issuedAt',now_ms,'expiresAt',deadline_ms);END$$;

-- result_valid is defined by the separately installed Stage30 finite-result helper.
CREATE FUNCTION design_managed_view_provider_binding.registered(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;lk text;lf text;BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() OR design_managed_view_provider_binding.valid_intent(i) IS DISTINCT FROM true OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId')) THEN RETURN false;END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256'));
 IF i->>'kind'='local' THEN RETURN receipt_id IS NULL AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);END IF;
 SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=registered.receipt_id FOR SHARE;
 RETURN r IS NOT NULL AND r->>'schemaVersion'='design-provider-approval-v1' AND r->>'ownerKey'=k AND r->'authority'=a AND r->'intent'=i
 AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE id=receipt_id AND owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);
END$$;
-- Private SELECT-policy helper. Reads scope-RLS approvals, never attempts,
-- avoiding completed-attempt SELECT policy recursion. Terminal tombstones remain stored; only result delivery is denied.
CREATE FUNCTION design_managed_view_provider_binding.completed_read_allowed(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 IF design_managed_view_provider_binding.live_binding(a,i) IS DISTINCT FROM true OR design_managed_view_provider_binding.registered(a,i,k,receipt_id) IS DISTINCT FROM true THEN RETURN false;END IF;
 IF i->>'kind'='local' THEN RETURN design_policy_private.verify_request_context(a,i) IS TRUE;END IF;
 SELECT record,active INTO r,issued_active FROM design_policy_private.issued_receipts x WHERE x.receipt_id=completed_read_allowed.receipt_id FOR SHARE;
 SELECT active INTO context_active FROM design_policy_private.context_permissions x WHERE x.id=completed_read_allowed.receipt_id AND x.owner_key=k AND x.authority=a AND x.intent=i FOR SHARE;
 IF issued_active IS DISTINCT FROM true OR context_active IS DISTINCT FROM true OR r->>'receiptId' IS DISTINCT FROM receipt_id OR r->>'ownerKey' IS DISTINCT FROM k OR r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM i OR r->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(r->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'expiresAt') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
 SELECT record INTO approval FROM design_policy_private.approvals x WHERE x.owner_key=k FOR SHARE;
 IF approval IS NULL OR approval->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR approval->'authority' IS DISTINCT FROM a OR approval->'intent' IS DISTINCT FROM i OR approval->>'receiptId' IS DISTINCT FROM receipt_id OR approval->>'ownerKey' IS DISTINCT FROM k OR approval->'active' IS DISTINCT FROM 'true'::jsonb OR approval->>'consumedBy' IS DISTINCT FROM k OR approval->'issuedAt' IS DISTINCT FROM r->'issuedAt' OR approval->'expiresAt' IS DISTINCT FROM r->'expiresAt' THEN RETURN false;END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RETURN false;END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 RETURN (r->>'issuedAt')::numeric<=now_ms AND (r->>'expiresAt')::numeric>now_ms;
END$$;
CREATE FUNCTION design_managed_view_provider_binding.verify_retained_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k text;selected_receipt text;c jsonb;r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 -- PRIVATE NOLOGIN workflow capability only. Caller proves exact permitted old-head→new-head transition.
 IF session_user<>'design_identity_runtime' OR a IS DISTINCT FROM design_identity.require_authority() OR design_managed_view_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;
 c:=design_managed_view_provider_binding.context_for(a,i->>'candidateKind',design_managed_view_provider_binding.selectors(i),i->>'requestId');
 IF (c->'authority' IS DISTINCT FROM a OR c->'keyBinding' IS DISTINCT FROM i->'keyBinding' OR c->'evidenceBinding' IS DISTINCT FROM i->'evidenceBinding') IS DISTINCT FROM false THEN RETURN false;END IF;
 IF i->>'kind'='local' THEN RETURN design_policy_private.verify_request_context(a,i) IS TRUE;END IF;PERFORM design_managed_view_provider_binding.permissions_rows(a,i);
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT x.record->>'receiptId' INTO STRICT selected_receipt FROM design_policy_private.issued_receipts x WHERE x.record->>'ownerKey'=k AND x.record->'authority'=a AND x.record->'intent'=i;
 IF design_managed_view_provider_binding.registered(a,i,k,selected_receipt) IS DISTINCT FROM true THEN RETURN false;END IF;
 SELECT record,active INTO r,issued_active FROM design_policy_private.issued_receipts x WHERE x.receipt_id=selected_receipt FOR SHARE;
 SELECT active INTO context_active FROM design_policy_private.context_permissions x WHERE x.id=selected_receipt AND x.owner_key=k AND x.authority=a AND x.intent=i FOR SHARE;
 IF issued_active IS DISTINCT FROM true OR context_active IS DISTINCT FROM true OR r->>'receiptId' IS DISTINCT FROM selected_receipt OR r->>'ownerKey' IS DISTINCT FROM k OR r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM i OR r->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(r->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'expiresAt') IS DISTINCT FROM 'number' THEN RETURN false;END IF;
 SELECT record INTO approval FROM design_policy_private.approvals x WHERE x.owner_key=k FOR SHARE;
 IF approval IS NULL OR approval->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' OR approval->'authority' IS DISTINCT FROM a OR approval->'intent' IS DISTINCT FROM i OR approval->>'receiptId' IS DISTINCT FROM selected_receipt OR approval->>'ownerKey' IS DISTINCT FROM k OR approval->'active' IS DISTINCT FROM 'true'::jsonb OR approval->>'consumedBy' IS DISTINCT FROM k OR approval->'issuedAt' IS DISTINCT FROM r->'issuedAt' OR approval->'expiresAt' IS DISTINCT FROM r->'expiresAt' THEN RETURN false;END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RETURN false;END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 RETURN (r->>'issuedAt')::numeric<=now_ms AND (r->>'expiresAt')::numeric>now_ms;
END$$;
CREATE FUNCTION design_managed_view_provider_binding.guard_bound_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n jsonb:=NEW.record;a jsonb;i jsonb;need_live boolean;selected_receipt text;issued jsonb;live boolean;BEGIN
 -- Legacy rows are left intact. A v5 row may never shed its binding version.
 IF TG_OP='UPDATE' AND OLD.record->'intent'->>'schemaVersion'='design-provider-intent-v5' AND n->'intent' IS DISTINCT FROM OLD.record->'intent' THEN RAISE EXCEPTION 'PROVIDER_BINDING_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF n->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v5' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();i:=n->'intent';
 IF n->'authority' IS DISTINCT FROM a OR NEW.owner_key IS DISTINCT FROM n->>'ownerKey' THEN RAISE EXCEPTION 'PROVIDER_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='approvals' THEN
  IF i->>'kind' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'MANAGED_VIEW_LOCAL_NO_APPROVAL';END IF;
  selected_receipt:=n->>'receiptId';need_live:=n->'active'='true'::jsonb;
  IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(n))<>10 OR (n-ARRAY['schemaVersion','ownerKey','revision','receiptId','authority','intent','issuedAt','expiresAt','active','consumedBy'])<>'{}'::jsonb OR n->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
  SELECT record,active INTO issued,live FROM design_policy_private.issued_receipts x WHERE x.receipt_id=selected_receipt FOR SHARE;
  IF issued IS NULL OR (n-ARRAY['revision','active','consumedBy']) IS DISTINCT FROM (issued-ARRAY['revision','active','consumedBy']) OR need_live AND live IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='attempts' THEN
  selected_receipt:=n->>'approvalReceiptId';need_live:=n->>'state' NOT IN ('uncertain','not_sent');
  IF design_policy_private.valid_attempt_shape(n) IS DISTINCT FROM true OR n->>'legacyKey' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId')) OR n->>'legacyFingerprint' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256')) THEN RAISE EXCEPTION 'PROVIDER_ATTEMPT_INVALID' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'PROVIDER_BINDING_INVALID' USING ERRCODE='42501';END IF;
 IF design_managed_view_provider_binding.registered(a,i,n->>'ownerKey',selected_receipt) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 IF need_live AND design_managed_view_provider_binding.verify_request_context(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='attempts' AND n->>'state'='completed' AND design_managed_view_provider_binding.result_valid(a,i,n->'result') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_PROVIDER_RESULT_INVALID' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;

CREATE FUNCTION design_managed_view_provider_binding.read_issued(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;r jsonb;n int;BEGIN
 a:=design_identity.require_authority();SELECT count(*) INTO n FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id;
 IF n<>1 THEN RAISE EXCEPTION 'MANAGED_PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT record INTO STRICT r FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id FOR SHARE;
 IF (design_managed_view_provider_binding.verify_request_context(a,r->'intent') IS DISTINCT FROM true OR (r->>'issuedAt')::bigint>floor(extract(epoch FROM clock_timestamp())*1000) OR (r->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('receiptId',r->'receiptId','authority',a,'intent',r->'intent','issuedAt',r->'issuedAt','expiresAt',r->'expiresAt');END$$;
CREATE FUNCTION design_managed_view_provider_binding.revoke_permission(receipt_id text,permission_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE n int;BEGIN
 IF (permission_kind NOT IN ('processing','cost') OR session_user IS DISTINCT FROM ('design_managed_model_'||permission_kind||'_issuer') OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));UPDATE design_managed_view_provider_binding.permissions x SET active=false WHERE x.receipt_id=revoke_permission.receipt_id AND kind=permission_kind AND active;GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;END$$;
CREATE FUNCTION design_managed_view_provider_binding.revoke_processing(receipt_id text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_managed_view_provider_binding.revoke_permission(receipt_id,'processing')$$;
CREATE FUNCTION design_managed_view_provider_binding.revoke_cost(receipt_id text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT design_managed_view_provider_binding.revoke_permission(receipt_id,'cost')$$;
CREATE FUNCTION design_managed_view_provider_binding.revoke_approval(receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN
 IF (session_user<>'design_managed_model_approval_issuer' OR receipt_id IS NULL OR receipt_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT record INTO STRICT r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=revoke_approval.receipt_id FOR UPDATE;
 IF (r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v5') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_ISSUER_DENIED' USING ERRCODE='42501';END IF;
 UPDATE design_policy_private.issued_receipts x SET active=false WHERE x.receipt_id=revoke_approval.receipt_id;UPDATE design_policy_private.context_permissions x SET active=false WHERE x.id=revoke_approval.receipt_id AND x.owner_key=r->>'ownerKey' AND x.authority=r->'authority' AND x.intent=r->'intent';RETURN true;END$$;
CREATE FUNCTION design_managed_view_provider_binding.verified_input(a jsonb,tid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;c jsonb;BEGIN
 IF (session_user NOT IN ('design_identity_runtime','design_managed_model_processing_issuer','design_managed_model_cost_issuer','design_managed_model_approval_issuer')) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 SELECT report INTO STRICT r FROM design_managed_derived.reports WHERE task_id=tid AND active FOR SHARE;
 IF (r->>'state' IS DISTINCT FROM 'evidence_complete') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_NOT_VERIFIED' USING ERRCODE='42501';END IF;
 c:=design_managed_derived.check_report(a,tid,r);RETURN c||jsonb_build_object('taskId',tid);END$$;
CREATE FUNCTION design_managed_view_provider_binding.read_completed(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a jsonb;k text;r jsonb;inp jsonb:='[]'::jsonb;im jsonb;BEGIN
 IF (session_user<>'design_identity_runtime' OR request_id IS NULL OR request_id!~'^[A-Za-z0-9:_-]{1,160}$') IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',request_id));
 SELECT record INTO STRICT r FROM design_policy_private.attempts WHERE owner_key=k FOR SHARE;
 IF (r->>'state' IS DISTINCT FROM 'completed' OR r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v5' OR r->'authority' IS DISTINCT FROM a OR r->'intent'->>'requestId' IS DISTINCT FROM request_id OR design_managed_view_provider_binding.completed_read_allowed(a,r->'intent',k,r->>'approvalReceiptId') IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_RESULT_DENIED' USING ERRCODE='42501';END IF;
 IF design_managed_view_provider_binding.result_valid(a,r->'intent',r->'result') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_PROVIDER_RESULT_INVALID' USING ERRCODE='42501';END IF;
 FOR im IN SELECT value FROM jsonb_array_elements(coalesce(r->'intent'->'evidenceBinding'->'images','[]'::jsonb)) LOOP inp:=inp||jsonb_build_array(design_managed_view_provider_binding.verified_input(a,im->>'taskId'));END LOOP;
 IF (design_managed_view_provider_binding.completed_read_allowed(a,r->'intent',k,r->>'approvalReceiptId') IS DISTINCT FROM true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MANAGED_PROVIDER_RESULT_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'intent',r->'intent','result',r->'result','inputs',inp);END$$;
CREATE FUNCTION design_managed_view_provider_binding.local_slot_available(a jsonb,k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() THEN RETURN false;END IF;
 RETURN NOT EXISTS(SELECT 1 FROM design_policy_private.issued_receipts WHERE record->>'ownerKey'=k) AND NOT EXISTS(SELECT 1 FROM design_managed_view_provider_binding.permissions WHERE owner_key=k);
END$$;
CREATE FUNCTION design_managed_view_provider_binding.register_local_context(intent jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;k text;lk text;lf text;prior jsonb;BEGIN
 IF session_user<>'design_identity_runtime' OR intent->>'kind' IS DISTINCT FROM 'local' OR design_managed_view_provider_binding.valid_intent(intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_LOCAL_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();
 IF design_managed_view_provider_binding.context_matches(a,intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_CHANGED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',intent->'requestId'));lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',intent->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 SELECT to_jsonb(x) INTO prior FROM design_policy_private.context_permissions x WHERE x.owner_key=k;
 IF prior IS NOT NULL THEN IF (prior->'authority'=a AND prior->'intent'=intent AND prior->>'legacy_key'=lk AND prior->>'legacy_fingerprint'=lf AND prior->'active'='true'::jsonb AND prior->>'id'='managed-view-local:'||k) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_REQUEST_CONFLICT';END IF;RETURN true;END IF;
 IF design_managed_view_provider_binding.local_slot_available(a,k) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_REQUEST_CONFLICT';END IF;
 IF a IS DISTINCT FROM design_identity.require_authority() OR design_managed_view_provider_binding.context_matches(a,intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_CHANGED';END IF;
 INSERT INTO design_policy_private.context_permissions VALUES('managed-view-local:'||k,k,lk,lf,a,intent,true);RETURN true;
END$$;
CREATE FUNCTION design_managed_view_provider_binding.read_registered(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;k text;c jsonb;r jsonb;BEGIN
 IF session_user<>'design_identity_runtime' OR request_id IS NULL OR request_id!~'^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'MANAGED_VIEW_DENIED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',request_id));
 SELECT to_jsonb(x) INTO STRICT c FROM design_policy_private.context_permissions x WHERE x.owner_key=k AND x.authority=a AND x.active;
 IF c->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v5' OR c->'intent'->>'requestId' IS DISTINCT FROM request_id OR design_managed_view_provider_binding.verify_request_context(a,c->'intent') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_CHANGED';END IF;
 IF c->'intent'->>'kind'='local' THEN RETURN jsonb_build_object('authority',a,'intent',c->'intent','receiptId',null);END IF;
 r:=design_managed_view_provider_binding.read_issued(request_id);IF r->'authority' IS DISTINCT FROM a OR r->'intent' IS DISTINCT FROM c->'intent' THEN RAISE EXCEPTION 'MANAGED_VIEW_CHANGED';END IF;RETURN jsonb_build_object('authority',a,'intent',r->'intent','receiptId',r->'receiptId');
END$$;
CREATE TRIGGER provider_v5_approval_binding BEFORE INSERT OR UPDATE ON design_policy_private.approvals FOR EACH ROW EXECUTE FUNCTION design_managed_view_provider_binding.guard_bound_ledger();
CREATE TRIGGER provider_v5_attempt_binding BEFORE INSERT OR UPDATE ON design_policy_private.attempts FOR EACH ROW EXECUTE FUNCTION design_managed_view_provider_binding.guard_bound_ledger();
CREATE POLICY provider_v5_completed_read ON design_policy_private.attempts AS RESTRICTIVE FOR SELECT TO design_identity_capability USING(CASE WHEN record->'intent'->>'schemaVersion'='design-provider-intent-v5' AND record->>'state'='completed' THEN design_managed_view_provider_binding.completed_read_allowed(record->'authority',record->'intent',owner_key,record->>'approvalReceiptId') ELSE true END);
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_managed_view_provider_binding' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.sig,CASE WHEN f.proname='register_local_context' THEN 'design_candidate_local_capability' WHEN f.proname IN ('image_context','verified_input') THEN 'design_managed_image_capability' WHEN f.proname IN ('permissions_for','permissions_rows','issuer_identity','issue_permission','issue_processing','issue_cost','issue_approval','revoke_permission','revoke_processing','revoke_cost','revoke_approval') THEN 'design_provider_issuer_capability' ELSE 'design_identity_capability' END);
END LOOP;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_managed_view_provider_binding FROM PUBLIC,anon,authenticated,design_identity_runtime,design_managed_model_processing_issuer,design_managed_model_cost_issuer,design_managed_model_approval_issuer;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.image_context(jsonb,text),design_managed_view_provider_binding.verified_input(jsonb,text) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.context_for(jsonb,text,jsonb,text),design_managed_view_provider_binding.context_matches(jsonb,jsonb),design_managed_view_provider_binding.valid_intent(jsonb),design_managed_view_provider_binding.exact(jsonb,text[]) TO design_provider_issuer_capability,design_candidate_local_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.local_slot_available(jsonb,text) TO design_candidate_local_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.selectors(jsonb) TO design_provider_issuer_capability,design_candidate_local_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.permissions_for(jsonb,jsonb),design_managed_view_provider_binding.permissions_rows(jsonb,jsonb) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.authorize(text,jsonb),design_managed_view_provider_binding.recheck(),design_managed_view_provider_binding.read_context(text,jsonb,text),design_managed_view_provider_binding.verify_request_context(jsonb,jsonb),design_managed_view_provider_binding.read_issued(text),design_managed_view_provider_binding.read_completed(text),design_managed_view_provider_binding.read_registered(text),design_managed_view_provider_binding.register_local_context(jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.issue_processing(text,jsonb,text,jsonb,bigint),design_managed_view_provider_binding.revoke_processing(text) TO design_managed_model_processing_issuer;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.issue_cost(text,jsonb,text,jsonb,bigint),design_managed_view_provider_binding.revoke_cost(text) TO design_managed_model_cost_issuer;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.issue_approval(text,jsonb,text,jsonb,bigint),design_managed_view_provider_binding.revoke_approval(text) TO design_managed_model_approval_issuer;
REVOKE CREATE ON SCHEMA design_managed_view_provider_binding FROM design_identity_capability,design_provider_issuer_capability,design_managed_image_capability,design_candidate_local_capability;
