-- OFFLINE SYNTHETIC PG17 ONLY. Additive candidate provider capability slice.
-- No production migration, real approval authority, provider transport or credentials.
-- Private decoder/final independent approval binds derivative bytes; SQL validates hashes,
-- provenance and authority, not image content. No absolute COMMIT/network expiry promise.
DO $$BEGIN IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::integer/10000<>17 OR to_regnamespace('design_provider_binding') IS NULL OR to_regnamespace('design_candidate_provider_binding') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_CANDIDATE_PROVIDER_REQUIRED';END IF;END$$;
CREATE SCHEMA design_candidate_provider_binding AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_candidate_provider_binding FROM PUBLIC,anon,authenticated;
CREATE ROLE design_candidate_local_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA design_candidate_provider_binding TO design_identity_runtime,design_identity_capability,design_provider_approval_issuer,design_provider_issuer_capability,design_candidate_local_capability;
GRANT USAGE ON SCHEMA design_candidate_provider_binding TO design_dependency_capability;
GRANT CREATE ON SCHEMA design_candidate_provider_binding TO design_identity_capability,design_provider_issuer_capability,design_candidate_local_capability,design_dependency_capability;
GRANT USAGE ON SCHEMA design_policy_private,design_identity,design_dependency_authority TO design_candidate_local_capability;
GRANT EXECUTE ON FUNCTION design_identity.require_authority(),design_dependency_authority.digest(jsonb),design_dependency_authority.canonical(jsonb) TO design_candidate_local_capability;
GRANT SELECT,INSERT ON design_policy_private.context_permissions TO design_candidate_local_capability;
CREATE POLICY candidate_local_context ON design_policy_private.context_permissions TO design_candidate_local_capability USING(authority=design_identity.require_authority()) WITH CHECK(authority=design_identity.require_authority());
-- Processing grants authorize only local private derivative processing; no cost/dispatch.
CREATE TABLE design_candidate_provider_binding.processing_receipts(receipt_id text PRIMARY KEY,owner_key text UNIQUE NOT NULL,record jsonb NOT NULL,active boolean NOT NULL DEFAULT true);
ALTER TABLE design_candidate_provider_binding.processing_receipts OWNER TO design_identity_owner;
ALTER TABLE design_candidate_provider_binding.processing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_candidate_provider_binding.processing_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON design_candidate_provider_binding.processing_receipts FROM PUBLIC,anon,authenticated,design_identity_runtime,design_provider_approval_issuer;
GRANT SELECT,UPDATE(active) ON design_candidate_provider_binding.processing_receipts TO design_identity_capability;
GRANT SELECT,INSERT,UPDATE(active) ON design_candidate_provider_binding.processing_receipts TO design_provider_issuer_capability;
CREATE POLICY candidate_processing_reader ON design_candidate_provider_binding.processing_receipts TO design_identity_capability USING(record->'authority'=design_identity.require_authority());
CREATE POLICY candidate_processing_issuer ON design_candidate_provider_binding.processing_receipts TO design_provider_issuer_capability USING(true) WITH CHECK(true);
CREATE TRIGGER candidate_processing_immutable BEFORE UPDATE OR DELETE ON design_candidate_provider_binding.processing_receipts FOR EACH ROW EXECUTE FUNCTION design_policy_private.reject_authority_mutation();
CREATE FUNCTION design_candidate_provider_binding.exact(v jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT CASE WHEN jsonb_typeof(v)='object' THEN (v-keys)='{}'::jsonb AND v ?& keys AND (SELECT count(*) FROM jsonb_object_keys(v))=cardinality(keys) ELSE false END $$;
CREATE FUNCTION design_candidate_provider_binding.purpose(k text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT CASE k WHEN 'visual_description' THEN 'private_image_basic_shape_candidates' WHEN 'completion_comparison' THEN 'private_completion_photo_comparison' WHEN 'completion_synthesis' THEN 'accepted_angle_ai_judgment_synthesis' END $$;
CREATE FUNCTION design_candidate_provider_binding.data_kinds(k text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT CASE k WHEN 'visual_description' THEN '["private_image_metadata_stripped_derivative"]'::jsonb WHEN 'completion_comparison' THEN '["private_before_after_metadata_stripped_derivatives"]'::jsonb WHEN 'completion_synthesis' THEN '["accepted_angle_ai_judgments_no_images"]'::jsonb END $$;
-- Rebuild comparison ancestry from the current native entries and immutable accepted lane.
-- Entries are selected by the same category/field/zone/track/group/service/side key as JS.
CREATE FUNCTION design_candidate_provider_binding.synthesis_evidence(b jsonb,r jsonb,s jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE angle text;entry jsonb;lane jsonb;c jsonb;cr jsonb;src jsonb;receipt jsonb;j jsonb;change text;reason text;description text;ev jsonb;refs jsonb:='[]';evidence jsonb:='[]';missing jsonb:='[]';nc jsonb:='[]';conflicts jsonb:='[]';choices jsonb:='[]';comparable jsonb:='[]';assessment text;generation text;distinct_changes integer;has_up boolean:=false;has_down boolean:=false;n integer;actual jsonb;
BEGIN
 IF design_candidate_provider_binding.exact(s,ARRAY['side','evidence','missingAngles','uncomparableAngles','conflictingAngles','assessment','generation','reviewFocus']) IS DISTINCT FROM true OR s->>'side' NOT IN ('left','right') OR s->>'side' IS NULL OR r->'session'->>'phase' IS DISTINCT FROM 'completed_review' THEN RAISE EXCEPTION 'CANDIDATE_SYNTHESIS_INVALID' USING ERRCODE='42501';END IF;
 FOREACH angle IN ARRAY ARRAY['front','back',s->>'side'] LOOP
  SELECT x.value INTO entry FROM jsonb_array_elements(r->'session'->'entries') WITH ORDINALITY x(value,n) WHERE x.value->>'category'='result_review' AND x.value->>'field'='model_photo_comparison_'||angle AND x.value->>'track'='actual' AND x.value->'zone'='null'::jsonb ORDER BY x.n DESC LIMIT 1;
  IF entry IS NULL THEN missing:=missing||to_jsonb(angle);CONTINUE;END IF;
  IF entry->>'origin' IS DISTINCT FROM 'extraction' OR entry->>'basis' IS DISTINCT FROM 'observable' OR entry->>'status' NOT IN ('confirmed','not_confirmed') OR entry->>'status' IS NULL OR coalesce(entry->'groupId','null')<>'null'::jsonb OR coalesce(entry->'service','null')<>'null'::jsonb OR coalesce(entry->'side','null')<>'null'::jsonb THEN RAISE EXCEPTION 'CANDIDATE_SYNTHESIS_INVALID' USING ERRCODE='42501';END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'modelCandidates') x WHERE x->'candidate'->>'kind'='completion_comparison' AND x->'candidate'->'candidate'->'entries'->0->'id'=entry->'id' AND (x->'acceptance'->'receipt'->>'resultRevision')::bigint<=(r->'session'->>'revision')::bigint;
  IF n<>1 THEN RAISE EXCEPTION 'CANDIDATE_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  SELECT value INTO lane FROM jsonb_array_elements(r->'modelCandidates') x WHERE x->'candidate'->>'kind'='completion_comparison' AND x->'candidate'->'candidate'->'entries'->0->'id'=entry->'id' AND (x->'acceptance'->'receipt'->>'resultRevision')::bigint<=(r->'session'->>'revision')::bigint;
  c:=lane->'candidate';receipt:=lane->'acceptance'->'receipt';
  SELECT value INTO cr FROM jsonb_array_elements(b->'candidateRows') x WHERE x->'candidate_id'=c->'id';
  IF cr IS NULL OR cr->'active' IS DISTINCT FROM 'true'::jsonb OR cr->'envelope' IS DISTINCT FROM c OR cr->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(c) OR cr->'consumed'->'acceptance' IS DISTINCT FROM lane->'acceptance'
   OR c->'scope' IS DISTINCT FROM b->'authority'->'scope' OR c->'sessionId' IS DISTINCT FROM r->'session'->'scope'->'sessionId' OR c->'comparison'->>'angle' IS DISTINCT FROM angle OR receipt->'candidateId' IS DISTINCT FROM c->'id' OR receipt->>'kind' IS DISTINCT FROM 'completion_comparison' OR receipt->>'candidateDigest' IS DISTINCT FROM design_dependency_authority.digest(c) OR receipt->'selectedIndices' IS DISTINCT FROM '[0]'::jsonb OR receipt->'sourceRefs' IS DISTINCT FROM c->'sourceRefs' OR jsonb_array_length(c->'sourceRefs')<>2 OR entry->>'id' IS DISTINCT FROM 'comparison-entry:'||(c->>'id')||':0' THEN RAISE EXCEPTION 'CANDIDATE_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  j:=NULL;
  FOREACH change IN ARRAY ARRAY['发型外轮廓看起来有变化','卷曲形态看起来更明显','卷曲形态看起来较不明显','未见明确外观变化'] LOOP
   description:='模型完成照视觉判断，未确认、非测量或执行事实：'||change||'。不证明达标或操作因果。';
   IF entry->>'value'=description THEN j:=jsonb_build_object('comparability','comparable','reason',null,'change',change);END IF;
  END LOOP;
  FOREACH reason IN ARRAY ARRAY['遮挡影响比较','清晰度不足','姿态或取景差异','光线差异','无法确定可比性'] LOOP
   description:='模型完成照视觉判断，未确认、非测量或执行事实：无法比较：'||reason||'。不证明达标或操作因果。';
   IF entry->>'value'=description THEN j:=jsonb_build_object('comparability','not_comparable','reason',reason,'change',null);END IF;
  END LOOP;
  SELECT value INTO src FROM jsonb_array_elements(r->'session'->'sources') x WHERE x->>'messageId'='comparison:'||(c->>'id')||':0';
  IF j IS NULL OR src IS NULL OR src->>'kind' IS DISTINCT FROM 'image_description' OR src->>'actor' IS DISTINCT FROM 'model' OR src->'text' IS DISTINCT FROM entry->'value' OR entry->'sources' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('messageId',src->'messageId','quote',src->'text')) THEN RAISE EXCEPTION 'CANDIDATE_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  ev:=jsonb_build_object('candidateId',c->'id','candidateDigest',cr->'sha256','angle',angle,'entryId',entry->'id','acceptanceRequestId',lane->'acceptance'->'requestId','entryStatus',entry->'status','judgment',j);
  evidence:=evidence||jsonb_build_array(ev);refs:=refs||(c->'sourceRefs');
  IF j->>'comparability'='not_comparable' THEN nc:=nc||to_jsonb(angle);ELSE comparable:=comparable||to_jsonb(angle);END IF;
  has_up:=has_up OR j->>'change'='卷曲形态看起来更明显';has_down:=has_down OR j->>'change'='卷曲形态看起来较不明显';
 END LOOP;
 IF jsonb_array_length(evidence) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'CANDIDATE_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
 IF has_up AND has_down THEN SELECT coalesce(jsonb_agg(x->'angle'),'[]') INTO conflicts FROM jsonb_array_elements(evidence) x WHERE x->'judgment'->>'change' IN ('卷曲形态看起来更明显','卷曲形态看起来较不明显');END IF;
 SELECT count(DISTINCT x->'judgment'->'change') INTO distinct_changes FROM jsonb_array_elements(evidence) x;
 assessment:=CASE WHEN jsonb_array_length(missing)>0 OR jsonb_array_length(nc)>0 THEN 'limited_evidence' WHEN jsonb_array_length(conflicts)>0 THEN 'potential_conflict' WHEN distinct_changes=1 THEN 'consistent_judgments' ELSE 'mixed_judgments' END;
 IF jsonb_array_length(missing)>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','missing_views','angles',missing));END IF;
 IF jsonb_array_length(nc)>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','noncomparable_views','angles',nc));END IF;
 IF jsonb_array_length(conflicts)>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','opposing_judgments','angles',conflicts));END IF;
 SELECT count(DISTINCT x->'judgment'->'change') INTO distinct_changes FROM jsonb_array_elements(evidence) x WHERE x->'judgment'->>'comparability'='comparable';
 IF distinct_changes>1 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','cross_view_differences','angles',comparable));END IF;
 FOR ev IN SELECT value FROM jsonb_array_elements(evidence) x WHERE x->>'entryStatus'='not_confirmed' LOOP choices:=choices||jsonb_build_array(jsonb_build_object('kind','confirm_angle_judgment','angles',jsonb_build_array(ev->'angle')));END LOOP;
 IF missing='[]'::jsonb AND nc='[]'::jsonb AND distinct_changes=1 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','capture_conditions','angles',comparable));END IF;
 generation:=CASE WHEN jsonb_array_length(choices)>1 THEN 'model_review_focus' ELSE 'deterministic' END;
 IF (jsonb_array_length(choices)=0 AND s->'reviewFocus' IS DISTINCT FROM 'null'::jsonb) OR (jsonb_array_length(choices)>0 AND NOT choices @> jsonb_build_array(s->'reviewFocus')) THEN RAISE EXCEPTION 'CANDIDATE_SYNTHESIS_INVALID' USING ERRCODE='42501';END IF;
 actual:=jsonb_build_object('side',s->'side','evidence',evidence,'missingAngles',missing,'uncomparableAngles',nc,'conflictingAngles',conflicts,'assessment',assessment,'generation',generation,'reviewFocus',s->'reviewFocus');
 IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'CANDIDATE_SYNTHESIS_INVALID' USING ERRCODE='42501';END IF;
 RETURN refs;
END$$;
CREATE FUNCTION design_candidate_provider_binding.check_evidence(b jsonb,r jsonb,ck text,mode text,e jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE ref jsonb;m jsonb;before_row jsonb;after_row jsonb;expected jsonb;n integer;derivatives integer:=0;BEGIN
 IF ck IS NULL OR ck NOT IN ('visual_description','completion_comparison','completion_synthesis') OR mode IS NULL OR mode NOT IN ('external','local') OR design_candidate_provider_binding.exact(e,ARRAY['sourceRefs','comparison','synthesis']) IS DISTINCT FROM true OR jsonb_typeof(e->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'sourceRefs') NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
 IF (SELECT count(DISTINCT x->>'mediaId') FROM jsonb_array_elements(e->'sourceRefs') x)<>jsonb_array_length(e->'sourceRefs') THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
 PERFORM design_dependency_authority.verify_refs(b,r->'photoRefs');
 FOR ref IN SELECT value FROM jsonb_array_elements(e->'sourceRefs') LOOP
  IF design_candidate_provider_binding.exact(ref,ARRAY['mediaId','sourceSha256']) IS DISTINCT FROM true AND design_candidate_provider_binding.exact(ref,ARRAY['mediaId','sourceSha256','derivativeSha256']) IS DISTINCT FROM true THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
  IF ref->>'mediaId' IS NULL OR ref->>'mediaId' !~ '^[A-Za-z0-9:_-]{1,160}$' OR ref->>'sourceSha256' IS NULL OR ref->>'sourceSha256' !~ '^[a-f0-9]{64}$' OR ref ? 'derivativeSha256' AND (ref->>'derivativeSha256' IS NULL OR ref->>'derivativeSha256' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
  IF ref ? 'derivativeSha256' THEN derivatives:=derivatives+1;END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=ref->'mediaId';SELECT value INTO m FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=ref->'mediaId';
  IF n<>1 OR m->'active' IS DISTINCT FROM 'true'::jsonb OR m->'record'->'sha256' IS DISTINCT FROM ref->'sourceSha256' OR m->'record'->'binding'->'scope' IS DISTINCT FROM b->'authority'->'scope' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'photoRefs') x WHERE x->>'kind'='private_media' AND x->'reference'->'mediaId'=ref->'mediaId') THEN RAISE EXCEPTION 'CANDIDATE_MEDIA_DENIED' USING ERRCODE='42501';END IF;
 END LOOP;
 IF derivatives<>0 AND derivatives<>jsonb_array_length(e->'sourceRefs') THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
 IF ck='visual_description' THEN
  IF mode<>'external' OR r->'session'->>'phase' IS DISTINCT FROM 'before_analysis' OR jsonb_array_length(e->'sourceRefs')<>1 OR e->'comparison' IS DISTINCT FROM 'null'::jsonb OR e->'synthesis' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
 ELSIF ck='completion_comparison' THEN
  IF mode<>'external' OR r->'session'->>'phase' IS DISTINCT FROM 'completed_review' OR jsonb_array_length(e->'sourceRefs')<>2 OR e->'synthesis' IS DISTINCT FROM 'null'::jsonb OR design_candidate_provider_binding.exact(e->'comparison',ARRAY['beforeMediaId','afterMediaId','angle']) IS DISTINCT FROM true OR e->'comparison'->>'angle' IS NULL OR e->'comparison'->>'angle' NOT IN ('front','back','left','right') OR e->'comparison'->'beforeMediaId' IS DISTINCT FROM e->'sourceRefs'->0->'mediaId' OR e->'comparison'->'afterMediaId' IS DISTINCT FROM e->'sourceRefs'->1->'mediaId' OR e->'comparison'->'beforeMediaId'=e->'comparison'->'afterMediaId' THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
  SELECT value INTO before_row FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=e->'comparison'->'beforeMediaId';SELECT value INTO after_row FROM jsonb_array_elements(b->'mediaRows') x WHERE x->'media_id'=e->'comparison'->'afterMediaId';
  IF before_row->'record'->>'stage' IS DISTINCT FROM 'before' OR after_row->'record'->>'stage' IS DISTINCT FROM 'after' OR before_row->'record'->'angle' IS DISTINCT FROM e->'comparison'->'angle' OR after_row->'record'->'angle' IS DISTINCT FROM e->'comparison'->'angle' THEN RAISE EXCEPTION 'CANDIDATE_MEDIA_DENIED' USING ERRCODE='42501';END IF;
 ELSE
  IF e->'comparison' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='42501';END IF;
  expected:=design_candidate_provider_binding.synthesis_evidence(b,r,e->'synthesis');
  IF e->'sourceRefs' IS DISTINCT FROM expected OR e->'synthesis'->>'generation' IS DISTINCT FROM (CASE mode WHEN 'local' THEN 'deterministic' ELSE 'model_review_focus' END) THEN RAISE EXCEPTION 'CANDIDATE_SYNTHESIS_INVALID' USING ERRCODE='42501';END IF;
 END IF;
END$$;
-- Private namespace collision check. Credential-resolved authority is supplied
-- only by context_for; no LOGIN can enumerate global candidates through this helper.
CREATE FUNCTION design_candidate_provider_binding.assert_candidate_namespace(a jsonb,rid text,ck text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate_kind text;cid text;sk text;stored_scope text;stored jsonb;BEGIN
 IF session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer') OR rid IS NULL OR rid !~ '^[A-Za-z0-9:_-]{1,160}$' OR ck IS NULL OR ck NOT IN ('text_extraction','visual_description','completion_comparison','completion_synthesis') THEN RAISE EXCEPTION 'CANDIDATE_NAMESPACE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));sk:=design_dependency_authority.digest(a->'scope');
 FOREACH candidate_kind IN ARRAY ARRAY['text_extraction','visual_description','completion_comparison','completion_synthesis'] LOOP
  cid:=design_dependency_authority.digest(jsonb_build_array(a->'actor',rid,candidate_kind));
  SELECT scope_key,envelope INTO stored_scope,stored FROM design_private.model_candidates WHERE candidate_id=cid FOR SHARE;
  IF FOUND AND (candidate_kind<>ck OR stored_scope IS DISTINCT FROM sk OR stored->'scope' IS DISTINCT FROM a->'scope' OR stored->'actor' IS DISTINCT FROM a->'actor' OR stored->>'kind' IS DISTINCT FROM ck OR stored->>'id' IS DISTINCT FROM cid) THEN RAISE EXCEPTION 'CANDIDATE_NAMESPACE_DENIED' USING ERRCODE='42501';END IF;
 END LOOP;
END$$;
CREATE FUNCTION design_candidate_provider_binding.context_for(a jsonb,rid text,ck text,mode text,e jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;w jsonb;r jsonb;o jsonb;k jsonb:='null';ki jsonb;key_receipt text;rev bigint;kb jsonb:='null';sb jsonb;cid text;otherkind text;existing jsonb;author jsonb;
BEGIN
 IF session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer') OR rid IS NULL OR rid !~ '^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'CANDIDATE_BINDING_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 b:=design_dependency_authority.checked_bundle(a);w:=b->'workflowRows'->-1;r:=w->'record';
 PERFORM design_candidate_provider_binding.assert_candidate_namespace(a,rid,ck);
 IF w IS NULL OR r->'scope' IS DISTINCT FROM a->'scope' OR r->'store' IS DISTINCT FROM a->'actor'->'store' OR w->>'sha256' IS DISTINCT FROM design_dependency_authority.digest(r) THEN RAISE EXCEPTION 'CANDIDATE_SOURCE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_candidate_provider_binding.check_evidence(b,r,ck,mode,e);
 IF mode='external' THEN
 o:=design_key_private.owner_of(a);PERFORM design_key_private.lock_slot(o,'chat');
 SELECT h.revision,v.record,v.receipt_id INTO STRICT rev,k,key_receipt FROM design_key_private.key_heads h JOIN design_key_private.key_versions v USING(owner,purpose,revision) WHERE h.owner=o AND h.purpose='chat' FOR SHARE OF h;
 SELECT ap.intent INTO STRICT ki FROM design_key_private.approvals ap JOIN design_key_private.consumptions c USING(receipt_id) WHERE ap.receipt_id=key_receipt AND c.owner=o AND c.purpose='chat' AND c.target_revision=rev;
 IF k->>'schemaVersion' IS DISTINCT FROM 'design-key-record-v2' OR k->'owner' IS DISTINCT FROM o OR k->'enabled' IS DISTINCT FROM 'true'::jsonb OR k->'revision' IS DISTINCT FROM to_jsonb(rev) OR k->>'purpose' IS DISTINCT FROM 'chat'
 OR k->'securityEpoch' IS DISTINCT FROM a->'securityEpoch' OR k->'membershipRevision' IS DISTINCT FROM a->'membershipRevision'
 OR ki->>'action' IS DISTINCT FROM 'persist-design-key' OR design_key_private.owner_of(ki) IS DISTINCT FROM o OR ki->'securityEpoch' IS DISTINCT FROM a->'securityEpoch' OR ki->'membershipRevision' IS DISTINCT FROM a->'membershipRevision'
 OR ki->>'purpose' IS DISTINCT FROM 'chat' OR ki->'expectedRevision' IS DISTINCT FROM to_jsonb(rev-1) OR ki->'destination' IS DISTINCT FROM k->'destination' OR ki->'model' IS DISTINCT FROM k->'model'
 OR jsonb_typeof(ki->'keyDigest') IS DISTINCT FROM 'string' OR ki->>'keyDigest' !~ '^[A-Za-z0-9+/]{43}=$' THEN RAISE EXCEPTION 'PROVIDER_KEY_DENIED' USING ERRCODE='42501';END IF;
 IF octet_length(decode(ki->>'keyDigest','base64'))<>32 OR encode(decode(ki->>'keyDigest','base64'),'base64') IS DISTINCT FROM ki->>'keyDigest'
 OR (true AND (k->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/chat/completions' OR jsonb_typeof(k->'model') IS DISTINCT FROM 'string' OR k->>'model' !~ '^[A-Za-z0-9._-]{1,80}$'))
 OR (false AND (k->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/v1/tools/asr' OR k->'model' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'PROVIDER_KEY_DENIED' USING ERRCODE='42501';END IF;
 kb:=jsonb_build_object('owner',o,'securityEpoch',a->'securityEpoch','membershipRevision',a->'membershipRevision','purpose','chat','revision',rev,'destination',k->'destination','model',k->'model','keyDigest',ki->'keyDigest');
 END IF;
 sb:=jsonb_build_object('workflowRevision',w->'revision','workflowSha256',w->'sha256','sessionId',r->'session'->'scope'->'sessionId','sessionRevision',r->'session'->'revision','sessionDigest',design_dependency_authority.digest(r->'session'),'manifestId',b->'manifest'->'id','manifestFingerprint',b->'manifest'->'sourceFingerprint');
 FOREACH otherkind IN ARRAY ARRAY['text_extraction','visual_description','completion_comparison','completion_synthesis'] LOOP
  cid:=design_dependency_authority.digest(jsonb_build_array(a->'actor',rid,otherkind));
  SELECT value INTO existing FROM jsonb_array_elements(b->'candidateRows') x WHERE x->>'candidate_id'=cid;
  IF existing IS NOT NULL THEN
   SELECT value INTO author FROM jsonb_array_elements(b->'dependencyAuthors') x WHERE x->>'kind'='candidate' AND x->>'id'=cid;
   IF otherkind<>ck OR author IS NULL OR author->'authority' IS DISTINCT FROM a OR author->'sha256' IS DISTINCT FROM existing->'sha256' OR existing->'envelope'->>'kind' IS DISTINCT FROM ck OR existing->'envelope'->'actor' IS DISTINCT FROM a->'actor' OR existing->'active' IS DISTINCT FROM 'true'::jsonb OR existing->'consumed' IS DISTINCT FROM 'null'::jsonb OR (existing->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) OR existing->'envelope'->'scope' IS DISTINCT FROM a->'scope' OR existing->'envelope'->'sessionId' IS DISTINCT FROM r->'session'->'scope'->'sessionId' OR existing->'envelope'->'baseRevision' IS DISTINCT FROM r->'session'->'revision' OR existing->'envelope'->>'inputDigest' IS DISTINCT FROM design_dependency_authority.digest(r->'session') THEN RAISE EXCEPTION 'CANDIDATE_OWNERSHIP_DENIED' USING ERRCODE='42501';END IF;
   -- Initial processing has no derivative yet; it must still match originals.
   IF (SELECT jsonb_agg(x- 'derivativeSha256') FROM jsonb_array_elements(existing->'envelope'->'sourceRefs') x) IS DISTINCT FROM (SELECT jsonb_agg(x- 'derivativeSha256') FROM jsonb_array_elements(e->'sourceRefs') x) OR coalesce(existing->'envelope'->'comparison','null') IS DISTINCT FROM e->'comparison' OR (ck<>'completion_synthesis' AND coalesce(existing->'envelope'->'synthesis','null') IS DISTINCT FROM e->'synthesis') THEN RAISE EXCEPTION 'CANDIDATE_OWNERSHIP_DENIED' USING ERRCODE='42501';END IF;
   IF ck='completion_synthesis' THEN
    -- Model may choose another allowed focus, never change approval facts.
    PERFORM design_candidate_provider_binding.synthesis_evidence(b,r,existing->'envelope'->'synthesis');
    IF ((existing->'envelope'->'synthesis')-'reviewFocus') IS DISTINCT FROM ((e->'synthesis')-'reviewFocus') THEN RAISE EXCEPTION 'CANDIDATE_OWNERSHIP_DENIED' USING ERRCODE='42501';END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(e->'sourceRefs') x WHERE x ? 'derivativeSha256') AND existing->'envelope'->'sourceRefs' IS DISTINCT FROM e->'sourceRefs' THEN RAISE EXCEPTION 'CANDIDATE_OWNERSHIP_DENIED' USING ERRCODE='42501';END IF;
  END IF;
 END LOOP;
 IF b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'CANDIDATE_SOURCE_DENIED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('authority',a,'keyRecord',k,'keyBinding',kb,'sourceBinding',sb,'evidenceBinding',e);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'CANDIDATE_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
END$$;
CREATE FUNCTION design_candidate_provider_binding.valid_intent(i jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF design_candidate_provider_binding.exact(i,ARRAY['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost','schemaVersion','keyBinding','sourceBinding','candidateKind','evidenceBinding']) IS DISTINCT FROM true OR i->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v3' OR i->>'requestId' IS NULL OR i->>'requestId' !~ '^[A-Za-z0-9:_-]{1,160}$' OR i->>'payloadSha256' IS NULL OR i->>'payloadSha256' !~ '^[a-f0-9]{64}$' OR i->>'inputDigest' IS NULL OR i->>'inputDigest' !~ '^[a-f0-9]{64}$' OR i->'inputDigest' IS DISTINCT FROM i->'sourceBinding'->'sessionDigest'
 OR jsonb_typeof(i->'byteLength') IS DISTINCT FROM 'number' OR i->>'byteLength' !~ '^[1-9][0-9]{0,7}$' OR (i->>'byteLength')::numeric>8388608 OR i->'purpose' IS DISTINCT FROM to_jsonb(design_candidate_provider_binding.purpose(i->>'candidateKind')) OR i->'dataKinds' IS DISTINCT FROM design_candidate_provider_binding.data_kinds(i->>'candidateKind') OR jsonb_typeof(i->'sourceRefs') IS DISTINCT FROM 'array' OR i->'sourceRefs' IS DISTINCT FROM i->'evidenceBinding'->'sourceRefs' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(i->'sourceRefs') x WHERE design_candidate_provider_binding.exact(x,ARRAY['mediaId','sourceSha256','derivativeSha256']) IS DISTINCT FROM true) THEN RETURN false;END IF;
 IF i->>'kind'='local' THEN RETURN i->>'candidateKind'='completion_synthesis' AND i->>'operation'='server_synthesis' AND i->>'destination'='local' AND i->>'model'='server-deterministic' AND i->'maxOutputTokens'='0'::jsonb AND i->'cost'='null'::jsonb AND i->'keyBinding'='null'::jsonb AND i->'evidenceBinding'->'synthesis'->>'generation'='deterministic';END IF;
 IF i->>'kind' IS DISTINCT FROM 'external' OR i->>'operation' IS DISTINCT FROM 'analyze' OR i->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/chat/completions' OR i->>'model' IS NULL OR i->>'model' !~ '^[A-Za-z0-9._-]{1,80}$' OR jsonb_typeof(i->'maxOutputTokens') IS DISTINCT FROM 'number' OR i->>'maxOutputTokens' !~ '^[1-9][0-9]{0,3}$' OR (i->>'maxOutputTokens')::numeric>8192 OR design_candidate_provider_binding.exact(i->'cost',ARRAY['currency','maximumMinorUnits','commitment']) IS DISTINCT FROM true OR i->'cost'->>'currency' IS NULL OR i->'cost'->>'currency' !~ '^[A-Z]{3}$' OR i->'cost'->>'commitment' IS DISTINCT FROM 'one_time' OR jsonb_typeof(i->'cost'->'maximumMinorUnits') IS DISTINCT FROM 'number' OR i->'cost'->>'maximumMinorUnits' !~ '^[1-9][0-9]{0,15}$' OR (i->'cost'->>'maximumMinorUnits')::numeric>9007199254740991 THEN RETURN false;END IF;
 RETURN true;
END$$;
CREATE FUNCTION design_candidate_provider_binding.authorize(credential text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.authorize(credential,scope);END$$;
CREATE FUNCTION design_candidate_provider_binding.recheck() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));RETURN design_identity.require_authority();END$$;
CREATE FUNCTION design_candidate_provider_binding.read_context(candidate_kind text,mode text,request_id text,evidence jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;v jsonb;BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();v:=design_candidate_provider_binding.context_for(a,request_id,candidate_kind,mode,evidence);IF a IS DISTINCT FROM design_identity.require_authority() THEN RAISE EXCEPTION 'CANDIDATE_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;RETURN v;END$$;
-- Private lookup shared by runtime/issuer fixed wrappers, never exposed to LOGIN.
-- Processing revocation/expiry also stops claim, completion and old result delivery.
CREATE FUNCTION design_candidate_provider_binding.processing_live(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected jsonb;originals jsonb;pr jsonb;live boolean;k text;BEGIN
 IF i->>'candidateKind'='completion_synthesis' THEN RETURN true;END IF;
 IF session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer') THEN RETURN false;END IF;
 SELECT jsonb_agg(x.value-'derivativeSha256' ORDER BY x.n) INTO originals FROM jsonb_array_elements(i->'evidenceBinding'->'sourceRefs') WITH ORDINALITY x(value,n);
 expected:=jsonb_build_object('requestId',i->'requestId','candidateKind',i->'candidateKind','sourceBinding',i->'sourceBinding','evidenceBinding',jsonb_set(i->'evidenceBinding','{sourceRefs}',originals),'destination',i->'destination','model',i->'model','maxOutputTokens',i->'maxOutputTokens');
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId'));
 SELECT record,active INTO pr,live FROM design_candidate_provider_binding.processing_receipts WHERE owner_key=k FOR SHARE;
 RETURN live IS TRUE AND pr->'authority'=a AND (pr-ARRAY['receiptId','authority','purpose','issuedAt','expiresAt'])=expected AND pr->>'purpose'=design_candidate_provider_binding.purpose(i->>'candidateKind') AND (pr->>'issuedAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) AND (pr->>'expiresAt')::numeric>floor(extract(epoch FROM clock_timestamp())*1000);
END$$;
CREATE FUNCTION design_candidate_provider_binding.live_binding(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));IF a IS DISTINCT FROM design_identity.require_authority() OR design_candidate_provider_binding.valid_intent(i) IS DISTINCT FROM true THEN RETURN false;END IF;
 c:=design_candidate_provider_binding.context_for(a,i->>'requestId',i->>'candidateKind',i->>'kind',i->'evidenceBinding');
 RETURN design_candidate_provider_binding.processing_live(a,i) IS TRUE AND c->'authority'=a AND c->'sourceBinding'=i->'sourceBinding' AND c->'evidenceBinding'=i->'evidenceBinding' AND c->'keyBinding'=i->'keyBinding' AND (i->>'kind'='local' OR c->'keyBinding'->'destination'=i->'destination' AND c->'keyBinding'->'model'=i->'model') AND a=design_identity.require_authority();
END$$;
CREATE FUNCTION design_candidate_provider_binding.verify_request_context(a jsonb,i jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN IF design_candidate_provider_binding.live_binding(a,i) IS DISTINCT FROM true THEN RETURN false;END IF;RETURN design_policy_private.verify_request_context(a,i) IS TRUE;END$$;
CREATE FUNCTION design_candidate_provider_binding.read_issued(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;r jsonb;n integer;BEGIN
 a:=design_identity.require_authority();
 SELECT count(*) INTO n FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id;
 IF n<>1 THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT record INTO STRICT r FROM design_policy_private.issued_receipts WHERE active AND record->'authority'=a AND record->'intent'->>'requestId'=request_id FOR SHARE;
 IF design_candidate_provider_binding.verify_request_context(a,r->'intent') IS DISTINCT FROM true OR (r->>'issuedAt')::numeric>floor(extract(epoch FROM clock_timestamp())*1000) OR (r->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('receiptId',r->'receiptId','authority',r->'authority','intent',r->'intent','issuedAt',r->'issuedAt','expiresAt',r->'expiresAt');
END$$;
-- Independent issuer inserts into the SAME immutable approval/attempt ledger.
CREATE FUNCTION design_candidate_provider_binding.issue_approval(credential text,scope jsonb,receipt_id text,intent jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;a jsonb;c jsonb;prior jsonb;active_prior boolean;k text;lk text;lf text;r jsonb;now_ms bigint;deadline_ms bigint;
BEGIN
 IF session_user<>'design_provider_approval_issuer' OR credential IS NULL OR length(credential) NOT BETWEEN 32 AND 200 OR credential ~ '[[:space:][:cntrl:]]' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000 OR design_candidate_provider_binding.valid_intent(intent) IS DISTINCT FROM true OR intent->>'kind' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 resolved:=design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope);a:=resolved->'authority';
 c:=design_candidate_provider_binding.context_for(a,intent->>'requestId',intent->>'candidateKind','external',intent->'evidenceBinding');
 IF c->'authority' IS DISTINCT FROM a OR c->'keyBinding' IS DISTINCT FROM intent->'keyBinding' OR c->'sourceBinding' IS DISTINCT FROM intent->'sourceBinding' OR c->'evidenceBinding' IS DISTINCT FROM intent->'evidenceBinding' OR intent->'destination' IS DISTINCT FROM c->'keyBinding'->'destination' OR intent->'model' IS DISTINCT FROM c->'keyBinding'->'model' THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 IF design_candidate_provider_binding.processing_live(a,intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_REQUIRED' USING ERRCODE='42501';END IF;
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
CREATE FUNCTION design_candidate_provider_binding.revoke_approval(receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;BEGIN
 IF session_user<>'design_provider_approval_issuer' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=revoke_approval.receipt_id FOR UPDATE;
 IF r IS NULL THEN RETURN false;END IF;
 IF r->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v3' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 UPDATE design_policy_private.issued_receipts x SET active=false WHERE x.receipt_id=revoke_approval.receipt_id;
 UPDATE design_policy_private.context_permissions SET active=false WHERE id=receipt_id AND owner_key=r->>'ownerKey' AND authority=r->'authority' AND intent=r->'intent';RETURN true;
END$$;
-- Verify exact issued/context mapping even for terminal tombstones. These two
-- rows contain no secret and remain immutable except independent issuer revocation.
CREATE FUNCTION design_candidate_provider_binding.registered(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;lk text;lf text;BEGIN
 IF a IS DISTINCT FROM design_identity.require_authority() OR design_candidate_provider_binding.valid_intent(i) IS DISTINCT FROM true OR k IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId')) THEN RETURN false;END IF;
 lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256'));
 IF i->>'kind'='local' THEN RETURN receipt_id IS NULL AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);END IF;
 SELECT record INTO r FROM design_policy_private.issued_receipts x WHERE x.receipt_id=registered.receipt_id FOR SHARE;
 RETURN r IS NOT NULL AND r->>'schemaVersion'='design-provider-approval-v1' AND r->>'ownerKey'=k AND r->'authority'=a AND r->'intent'=i
 AND EXISTS(SELECT 1 FROM design_policy_private.context_permissions WHERE id=receipt_id AND owner_key=k AND legacy_key=lk AND legacy_fingerprint=lf AND authority=a AND intent=i);
END$$;
-- Private SELECT-policy helper. Reads scope-RLS approvals, never attempts,
-- avoiding completed-attempt SELECT policy recursion. Terminal tombstones remain stored; only result delivery is denied.
CREATE FUNCTION design_candidate_provider_binding.completed_read_allowed(a jsonb,i jsonb,k text,receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;approval jsonb;issued_active boolean;context_active boolean;now_ms numeric;BEGIN
 IF design_candidate_provider_binding.live_binding(a,i) IS DISTINCT FROM true OR design_candidate_provider_binding.registered(a,i,k,receipt_id) IS DISTINCT FROM true THEN RETURN false;END IF;
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
CREATE FUNCTION design_candidate_provider_binding.guard_bound_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n jsonb:=NEW.record;a jsonb;i jsonb;need_live boolean;selected_receipt text;issued jsonb;live boolean;BEGIN
 -- Legacy rows are left intact. A v2 row may never shed its binding version.
 IF TG_OP='UPDATE' AND OLD.record->'intent'->>'schemaVersion'='design-provider-intent-v3' AND n->'intent' IS DISTINCT FROM OLD.record->'intent' THEN RAISE EXCEPTION 'PROVIDER_BINDING_IMMUTABLE' USING ERRCODE='42501';END IF;
 -- Additive v2 text namespace preflight; original v2 trigger still performs
 -- its complete key/source/receipt checks. Never block terminal audit settlement
 -- solely because a later namespace collision makes a new dispatch impossible.
 IF n->'intent'->>'schemaVersion'='design-provider-intent-v2' AND n->'intent'->>'operation'='analyze' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();
  IF n->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'CANDIDATE_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
  IF (TG_TABLE_NAME='attempts' AND n->>'state' NOT IN ('uncertain','not_sent')) OR (TG_TABLE_NAME='approvals' AND n->'active'='true'::jsonb) THEN
   PERFORM design_candidate_provider_binding.assert_candidate_namespace(a,n->'intent'->>'requestId','text_extraction');
  END IF;
  RETURN NEW;
 END IF;
 IF n->'intent'->>'schemaVersion' IS DISTINCT FROM 'design-provider-intent-v3' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();i:=n->'intent';
 IF n->'authority' IS DISTINCT FROM a OR NEW.owner_key IS DISTINCT FROM n->>'ownerKey' THEN RAISE EXCEPTION 'PROVIDER_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='approvals' THEN
  IF i->>'kind' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'CANDIDATE_LOCAL_APPROVAL_DENIED' USING ERRCODE='42501';END IF;
  selected_receipt:=n->>'receiptId';need_live:=n->'active'='true'::jsonb;
  IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(n))<>10 OR (n-ARRAY['schemaVersion','ownerKey','revision','receiptId','authority','intent','issuedAt','expiresAt','active','consumedBy'])<>'{}'::jsonb OR n->>'schemaVersion' IS DISTINCT FROM 'design-provider-approval-v1' THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
  SELECT record,active INTO issued,live FROM design_policy_private.issued_receipts x WHERE x.receipt_id=selected_receipt FOR SHARE;
  IF issued IS NULL OR (n-ARRAY['revision','active','consumedBy']) IS DISTINCT FROM (issued-ARRAY['revision','active','consumedBy']) OR need_live AND live IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_INVALID' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='attempts' THEN
  selected_receipt:=n->>'approvalReceiptId';need_live:=n->>'state' NOT IN ('uncertain','not_sent');
  IF design_policy_private.valid_attempt_shape(n) IS DISTINCT FROM true OR n->>'legacyKey' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_array(a->'actor',i->'requestId')) OR n->>'legacyFingerprint' IS DISTINCT FROM design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',i->'operation','model',i->'model','endpoint',i->'destination','payloadSha256',i->'payloadSha256')) THEN RAISE EXCEPTION 'PROVIDER_ATTEMPT_INVALID' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'PROVIDER_BINDING_INVALID' USING ERRCODE='42501';END IF;
 IF design_candidate_provider_binding.registered(a,i,n->>'ownerKey',selected_receipt) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_APPROVAL_REQUIRED' USING ERRCODE='42501';END IF;
 IF need_live AND design_candidate_provider_binding.verify_request_context(a,i) IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROVIDER_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE FUNCTION design_candidate_provider_binding.register_local(intent jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;c jsonb;k text;lk text;lf text;prior jsonb;n integer;BEGIN
 IF session_user<>'design_identity_runtime' OR design_candidate_provider_binding.valid_intent(intent) IS DISTINCT FROM true OR intent->>'kind' IS DISTINCT FROM 'local' THEN RAISE EXCEPTION 'CANDIDATE_LOCAL_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();
 c:=design_candidate_provider_binding.context_for(a,intent->>'requestId',intent->>'candidateKind','local',intent->'evidenceBinding');
 IF c->'authority' IS DISTINCT FROM a OR c->'keyBinding' IS DISTINCT FROM 'null'::jsonb OR c->'sourceBinding' IS DISTINCT FROM intent->'sourceBinding' OR c->'evidenceBinding' IS DISTINCT FROM intent->'evidenceBinding' THEN RAISE EXCEPTION 'CANDIDATE_BINDING_CHANGED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',intent->'requestId'));lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',intent->'requestId'));lf:=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope','operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 SELECT to_jsonb(x) INTO prior FROM design_policy_private.context_permissions x WHERE x.owner_key=k;
 IF prior IS NOT NULL THEN IF prior->'authority' IS DISTINCT FROM a OR prior->'intent' IS DISTINCT FROM intent OR prior->>'legacy_key' IS DISTINCT FROM lk OR prior->>'legacy_fingerprint' IS DISTINCT FROM lf OR prior->'active' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CANDIDATE_REQUEST_CONFLICT' USING ERRCODE='42501';END IF;RETURN true;END IF;
 IF a IS DISTINCT FROM design_identity.require_authority() THEN RAISE EXCEPTION 'CANDIDATE_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 INSERT INTO design_policy_private.context_permissions VALUES('candidate-local:'||k,k,lk,lf,a,intent,true);RETURN true;
END$$;
CREATE FUNCTION design_candidate_provider_binding.processing_context(a jsonb,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;BEGIN
 IF design_candidate_provider_binding.exact(q,ARRAY['requestId','candidateKind','sourceBinding','evidenceBinding','destination','model','maxOutputTokens']) IS DISTINCT FROM true OR q->>'candidateKind' IS NULL OR q->>'candidateKind' NOT IN ('visual_description','completion_comparison') OR q->>'destination' IS DISTINCT FROM 'https://api.deepseek.com/chat/completions' OR jsonb_typeof(q->'maxOutputTokens') IS DISTINCT FROM 'number' OR q->>'maxOutputTokens' !~ '^[1-9][0-9]{0,3}$' OR (q->>'maxOutputTokens')::numeric>8192 THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_INVALID' USING ERRCODE='42501';END IF;
 c:=design_candidate_provider_binding.context_for(a,q->>'requestId',q->>'candidateKind','external',q->'evidenceBinding');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(q->'evidenceBinding'->'sourceRefs') x WHERE x ? 'derivativeSha256') OR c->'sourceBinding' IS DISTINCT FROM q->'sourceBinding' OR c->'keyBinding'->'destination' IS DISTINCT FROM q->'destination' OR c->'keyBinding'->'model' IS DISTINCT FROM q->'model' THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_INVALID' USING ERRCODE='42501';END IF;
 RETURN c;
END$$;
CREATE FUNCTION design_candidate_provider_binding.issue_processing(credential text,scope jsonb,receipt_id text,q jsonb,ttl_ms bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;a jsonb;c jsonb;k text;r jsonb;prior jsonb;live boolean;now_ms bigint;deadline_ms bigint;BEGIN
 IF session_user<>'design_provider_approval_issuer' OR credential IS NULL OR length(credential) NOT BETWEEN 32 AND 200 OR credential ~ '[[:space:][:cntrl:]]' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' OR ttl_ms IS NULL OR ttl_ms NOT BETWEEN 1 AND 900000 THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_INVALID' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));resolved:=design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope);a:=resolved->'authority';c:=design_candidate_provider_binding.processing_context(a,q);
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',q->'requestId'));
 SELECT record,active INTO prior,live FROM design_candidate_provider_binding.processing_receipts x WHERE x.receipt_id=issue_processing.receipt_id FOR SHARE;
 IF FOUND THEN
  IF live IS DISTINCT FROM true OR prior->'authority' IS DISTINCT FROM a OR (prior-ARRAY['receiptId','authority','purpose','issuedAt','expiresAt']) IS DISTINCT FROM q OR (prior->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_CONFLICT' USING ERRCODE='42501';END IF;RETURN prior;
 END IF;
 IF EXISTS(SELECT 1 FROM design_candidate_provider_binding.processing_receipts WHERE owner_key=k) THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_CONFLICT' USING ERRCODE='42501';END IF;
 IF (design_identity.resolve_hash(encode(sha256(convert_to(credential,'UTF8')),'hex'),scope))->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'CANDIDATE_AUTHORITY_CHANGED' USING ERRCODE='42501';END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;deadline_ms:=least(now_ms+ttl_ms,floor(extract(epoch FROM (resolved->>'expiresAt')::timestamptz)*1000)::bigint);IF deadline_ms<=now_ms THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_EXPIRED' USING ERRCODE='42501';END IF;
 r:=q||jsonb_build_object('receiptId',receipt_id,'authority',a,'purpose',design_candidate_provider_binding.purpose(q->>'candidateKind'),'issuedAt',now_ms,'expiresAt',deadline_ms);
 INSERT INTO design_candidate_provider_binding.processing_receipts VALUES(receipt_id,k,r,true);RETURN r;
END$$;
CREATE FUNCTION design_candidate_provider_binding.read_processing(request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;r jsonb;c jsonb;n integer;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));a:=design_identity.require_authority();
 SELECT count(*) INTO n FROM design_candidate_provider_binding.processing_receipts x WHERE x.active AND x.record->'authority'=a AND x.record->>'requestId'=request_id;
 IF n<>1 THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT record INTO r FROM design_candidate_provider_binding.processing_receipts x WHERE x.active AND x.record->'authority'=a AND x.record->>'requestId'=request_id FOR SHARE;
 c:=design_candidate_provider_binding.processing_context(a,r-ARRAY['receiptId','authority','purpose','issuedAt','expiresAt']);
 IF a IS DISTINCT FROM design_identity.require_authority() OR r->>'purpose' IS DISTINCT FROM design_candidate_provider_binding.purpose(r->>'candidateKind') OR (r->>'issuedAt')::numeric>floor(extract(epoch FROM clock_timestamp())*1000) OR (r->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_EXPIRED' USING ERRCODE='42501';END IF;RETURN r;
END$$;
CREATE FUNCTION design_candidate_provider_binding.revoke_processing(receipt_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n integer;BEGIN IF session_user<>'design_provider_approval_issuer' OR receipt_id IS NULL OR receipt_id !~ '^[A-Za-z0-9:_-]{1,160}$' THEN RAISE EXCEPTION 'CANDIDATE_PROCESSING_INVALID' USING ERRCODE='42501';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));UPDATE design_candidate_provider_binding.processing_receipts x SET active=false WHERE x.receipt_id=revoke_processing.receipt_id;GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;END$$;
CREATE TRIGGER provider_v3_approval_binding BEFORE INSERT OR UPDATE ON design_policy_private.approvals FOR EACH ROW EXECUTE FUNCTION design_candidate_provider_binding.guard_bound_ledger();
CREATE TRIGGER provider_v3_attempt_binding BEFORE INSERT OR UPDATE ON design_policy_private.attempts FOR EACH ROW EXECUTE FUNCTION design_candidate_provider_binding.guard_bound_ledger();
CREATE POLICY provider_v3_completed_read ON design_policy_private.attempts AS RESTRICTIVE FOR SELECT TO design_identity_capability
 USING(CASE WHEN record->'intent'->>'schemaVersion'='design-provider-intent-v3' AND record->>'state'='completed' THEN design_candidate_provider_binding.completed_read_allowed(record->'authority',record->'intent',owner_key,record->>'approvalReceiptId') ELSE true END);
-- Fixed functions only; no runtime direct table/role/issuance grants.
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_candidate_provider_binding' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.sig,CASE WHEN f.proname IN ('issue_approval','revoke_approval','issue_processing','revoke_processing','processing_live') THEN 'design_provider_issuer_capability' WHEN f.proname='assert_candidate_namespace' THEN 'design_dependency_capability' WHEN f.proname='register_local' THEN 'design_candidate_local_capability' ELSE 'design_identity_capability' END);
END LOOP;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_candidate_provider_binding FROM PUBLIC,anon,authenticated,design_identity_runtime,design_provider_approval_issuer;
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.context_for(jsonb,text,text,text,jsonb),design_candidate_provider_binding.valid_intent(jsonb),design_candidate_provider_binding.exact(jsonb,text[]),design_candidate_provider_binding.purpose(text),design_candidate_provider_binding.data_kinds(text) TO design_provider_issuer_capability,design_candidate_local_capability;
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.assert_candidate_namespace(jsonb,text,text),design_candidate_provider_binding.processing_live(jsonb,jsonb) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.processing_context(jsonb,jsonb) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.authorize(text,jsonb),design_candidate_provider_binding.recheck(),design_candidate_provider_binding.read_context(text,text,text,jsonb),design_candidate_provider_binding.verify_request_context(jsonb,jsonb),design_candidate_provider_binding.read_issued(text),design_candidate_provider_binding.read_processing(text),design_candidate_provider_binding.register_local(jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.issue_approval(text,jsonb,text,jsonb,bigint),design_candidate_provider_binding.revoke_approval(text),design_candidate_provider_binding.issue_processing(text,jsonb,text,jsonb,bigint),design_candidate_provider_binding.revoke_processing(text) TO design_provider_approval_issuer;
REVOKE CREATE ON SCHEMA design_candidate_provider_binding FROM design_identity_capability,design_provider_issuer_capability,design_candidate_local_capability,design_dependency_capability;
