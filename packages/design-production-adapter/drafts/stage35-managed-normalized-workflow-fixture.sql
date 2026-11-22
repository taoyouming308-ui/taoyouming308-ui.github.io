-- ISOLATED FIXTURE ONLY. No production migration or role grants authorized.
-- Installs after Stage35 provider binding. No independent attempt ledger.
BEGIN;
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regprocedure('design_normalized_provider_binding.read_completed(text)') IS NULL OR to_regprocedure('design_normalized_provider_binding.verify_retained_context(jsonb,jsonb)') IS NULL OR to_regnamespace('design_managed_normalized_workflow') IS NOT NULL THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PREREQUISITE';END IF;
END$$;
CREATE ROLE design_managed_normalized_workflow_capability NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA design_managed_normalized_workflow AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_managed_normalized_workflow FROM PUBLIC;
GRANT CREATE ON SCHEMA design_managed_normalized_workflow TO design_managed_normalized_workflow_capability;
GRANT USAGE ON SCHEMA design_managed_normalized_workflow TO design_identity_runtime,design_managed_normalized_workflow_capability,design_dependency_capability;
GRANT USAGE ON SCHEMA design_normalized_provider_binding,design_identity,design_private,design_dependency_authority TO design_managed_normalized_workflow_capability;
GRANT EXECUTE ON FUNCTION design_normalized_provider_binding.read_completed(text),design_normalized_provider_binding.verify_retained_context(jsonb,jsonb),design_identity.require_authority(),design_dependency_authority.read_bundle(),design_dependency_authority.check_record(jsonb,jsonb),design_dependency_authority.digest(jsonb),design_dependency_authority.canonical(jsonb),design_dependency_authority.prefix(jsonb,jsonb) TO design_managed_normalized_workflow_capability;
CREATE TABLE design_managed_normalized_workflow.candidates(candidate_id text PRIMARY KEY,scope_key text NOT NULL,request_id text NOT NULL,authority jsonb NOT NULL,intent jsonb NOT NULL,candidate jsonb NOT NULL,input jsonb NOT NULL,manifest_id text,UNIQUE(scope_key,request_id));
CREATE TABLE design_managed_normalized_workflow.consumptions(candidate_id text PRIMARY KEY REFERENCES design_managed_normalized_workflow.candidates,authority jsonb NOT NULL,acceptance jsonb NOT NULL,record_sha256 text NOT NULL,previous_sha256 text NOT NULL,receipt_key text NOT NULL UNIQUE,record_revision integer NOT NULL,transaction_id bigint NOT NULL);
ALTER TABLE design_managed_normalized_workflow.candidates OWNER TO design_identity_owner;
ALTER TABLE design_managed_normalized_workflow.consumptions OWNER TO design_identity_owner;
ALTER TABLE design_managed_normalized_workflow.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_managed_normalized_workflow.candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE design_managed_normalized_workflow.consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_managed_normalized_workflow.consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY cap_read ON design_managed_normalized_workflow.candidates FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY cap_insert ON design_managed_normalized_workflow.candidates FOR INSERT TO design_managed_normalized_workflow_capability WITH CHECK(true);
CREATE POLICY cap_read ON design_managed_normalized_workflow.consumptions FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY cap_insert ON design_managed_normalized_workflow.consumptions FOR INSERT TO design_managed_normalized_workflow_capability WITH CHECK(true);
GRANT SELECT,INSERT ON design_managed_normalized_workflow.candidates,design_managed_normalized_workflow.consumptions TO design_managed_normalized_workflow_capability;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON design_managed_normalized_workflow.candidates FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON design_managed_normalized_workflow.consumptions FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();
GRANT SELECT,INSERT ON design_private.workflow_versions,design_private.workflow_receipts,design_dependency_authority.operation_authors TO design_managed_normalized_workflow_capability;
CREATE POLICY normalized_read ON design_private.workflow_versions FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_insert ON design_private.workflow_versions FOR INSERT TO design_managed_normalized_workflow_capability WITH CHECK(true);
CREATE POLICY normalized_read ON design_private.workflow_receipts FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_insert ON design_private.workflow_receipts FOR INSERT TO design_managed_normalized_workflow_capability WITH CHECK(true);
CREATE POLICY normalized_read ON design_dependency_authority.operation_authors FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_insert ON design_dependency_authority.operation_authors FOR INSERT TO design_managed_normalized_workflow_capability WITH CHECK(true);
CREATE FUNCTION design_managed_normalized_workflow.publish(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;v jsonb;c design_managed_normalized_workflow.candidates;BEGIN
 IF session_user<>'design_identity_runtime' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (q-ARRAY['requestId'])<>'{}' OR coalesce(q->>'requestId','')!~'^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 b:=design_dependency_authority.read_bundle();v:=design_normalized_provider_binding.read_completed(q->>'requestId');
 IF v->'authority' IS DISTINCT FROM b->'authority' OR v->'result'->'authority' IS DISTINCT FROM b->'authority' OR v->'result'->'requestBinding'->'requestId' IS DISTINCT FROM q->'requestId' OR coalesce(v->'result'->>'id','')!~'^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 SELECT * INTO c FROM design_managed_normalized_workflow.candidates WHERE candidate_id=v->'result'->>'id';
 IF FOUND THEN IF c.authority IS DISTINCT FROM v->'authority' OR c.intent IS DISTINCT FROM v->'intent' OR c.candidate IS DISTINCT FROM v->'result' OR c.input IS DISTINCT FROM v->'input' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CONFLICT';END IF;
 ELSE
 IF (SELECT count(*) FROM design_managed_normalized_workflow.candidates WHERE scope_key=design_dependency_authority.digest(b->'authority'->'scope'))>=1000 OR (SELECT coalesce(sum(octet_length(candidate::text)+octet_length(input::text)),0) FROM design_managed_normalized_workflow.candidates WHERE scope_key=design_dependency_authority.digest(b->'authority'->'scope'))+octet_length((v->'result')::text)+octet_length((v->'input')::text)>33554432 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CAPACITY';END IF;
 INSERT INTO design_managed_normalized_workflow.candidates VALUES(v->'result'->>'id',design_dependency_authority.digest(b->'authority'->'scope'),q->>'requestId',v->'authority',v->'intent',v->'result',v->'input',b->'manifest'->>'id');END IF;
 RETURN jsonb_build_object('candidate',v->'result','input',v->'input');END$$;
CREATE FUNCTION design_managed_normalized_workflow.read_candidate(q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;v jsonb;c design_managed_normalized_workflow.candidates;BEGIN
 IF session_user<>'design_identity_runtime' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (q-ARRAY['candidateId'])<>'{}' OR coalesce(q->>'candidateId','')!~'^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 b:=design_dependency_authority.read_bundle();SELECT * INTO c FROM design_managed_normalized_workflow.candidates WHERE candidate_id=q->>'candidateId';
 IF NOT FOUND OR c.authority IS DISTINCT FROM b->'authority' OR c.scope_key IS DISTINCT FROM design_dependency_authority.digest(b->'authority'->'scope') THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 -- Accepted history is read through workflow snapshots, never by reviving expired fee receipts here.
 IF EXISTS(SELECT 1 FROM design_managed_normalized_workflow.consumptions WHERE candidate_id=c.candidate_id) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CONSUMED';END IF;
 v:=design_normalized_provider_binding.read_completed(c.request_id);
 IF v IS DISTINCT FROM jsonb_build_object('authority',c.authority,'intent',c.intent,'result',c.candidate,'input',c.input) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;
 RETURN jsonb_build_object('candidate',c.candidate,'input',c.input);END$$;
CREATE FUNCTION design_managed_normalized_workflow.append_managed(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;oldrow jsonb;o jsonb;r jsonb;rc jsonb;req jsonb;i jsonb;v jsonb;c design_managed_normalized_workflow.candidates;h jsonb;ac jsonb;receipt jsonb;selected jsonb;idx integer;s jsonb;src jsonb;e jsonb;j jsonb;sk text;sha text;rk text;BEGIN
 IF session_user<>'design_identity_runtime' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 b:=design_dependency_authority.read_bundle();a:=b->'authority';oldrow:=b->'workflowRows'->-1;o:=oldrow->'record';r:=q->'record';rc:=q->'receipt';req:=rc->'request';i:=req->'intent';rk:=q->>'receiptKey';
 IF (jsonb_typeof(q)='object' AND (SELECT count(*) FROM jsonb_object_keys(q))=6 AND (q-ARRAY['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt'])='{}' AND q->'expectedSourceFingerprint'=b->'sourceFingerprint' AND q->'expectedRevision'=oldrow->'revision' AND jsonb_array_length(b->'workflowRows')<1001) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CONFLICT';END IF;
 IF (jsonb_typeof(i)='object' AND (i-ARRAY['type','candidateId','selectedIndices'])='{}' AND (SELECT count(*) FROM jsonb_object_keys(i))=3 AND i->>'type'='accept_normalized_candidate') IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 v:=design_managed_normalized_workflow.read_candidate(jsonb_build_object('candidateId',i->'candidateId'));SELECT * INTO STRICT c FROM design_managed_normalized_workflow.candidates WHERE candidate_id=i->>'candidateId';
 IF c.candidate->'workflowBinding' IS DISTINCT FROM jsonb_build_object('recordRevision',o->'revision','recordDigest',oldrow->'sha256','sessionId',o->'session'->'scope'->'sessionId','sessionRevision',o->'session'->'revision','sessionDigest',design_dependency_authority.digest(o->'session')) OR c.candidate->'authority' IS DISTINCT FROM a OR c.candidate->>'kind' IS DISTINCT FROM 'managed_normalized_before_view' OR o->'session'->>'phase' IS DISTINCT FROM 'before_analysis' THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;
 PERFORM design_dependency_authority.check_record(r,b);sha:=design_dependency_authority.digest(r);sk:=design_dependency_authority.digest(a->'scope');
 IF (r->>'schemaVersion'='design-prepared-workflow-record-v5' AND q->>'recordSha256'=sha AND r->'revision'=to_jsonb((o->>'revision')::int+1) AND (r-ARRAY['schemaVersion','revision','session','managedImageHistory'])=(o-ARRAY['schemaVersion','revision','session','managedImageHistory']) AND jsonb_typeof(rc)='object' AND (SELECT count(*) FROM jsonb_object_keys(rc))=5 AND (rc-ARRAY['fingerprint','scope','actor','appliedRevision','request'])='{}' AND rc->'scope'=a->'scope' AND rc->'actor'=a->'actor' AND rc->'appliedRevision'=r->'revision' AND jsonb_typeof(req)='object' AND (SELECT count(*) FROM jsonb_object_keys(req))=3 AND (req-ARRAY['requestId','expectedRevision','intent'])='{}' AND req->'expectedRevision'=o->'revision' AND req->>'requestId'~'^[A-Za-z0-9_-]{1,80}$' AND rk=design_dependency_authority.digest(jsonb_build_array(a->'actor',req->'requestId')) AND rc->>'fingerprint'=design_dependency_authority.digest(jsonb_build_object('scope',a->'scope')||req)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 IF EXISTS(SELECT 1 FROM design_private.workflow_receipts WHERE request_key=rk) OR EXISTS(SELECT 1 FROM design_managed_normalized_workflow.consumptions WHERE candidate_id=c.candidate_id) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CONFLICT';END IF;
 IF jsonb_typeof(i->'selectedIndices') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'selectedIndices') NOT BETWEEN 1 AND 2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(i->'selectedIndices') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'number' OR x::text!~'^[01]$' OR (x::text)::int>=jsonb_array_length(c.candidate->'candidate'->'entries')) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 SELECT jsonb_agg(x ORDER BY (x::text)::int) INTO selected FROM jsonb_array_elements(i->'selectedIndices') x;
 IF (SELECT count(DISTINCT x) FROM jsonb_array_elements(selected) x)<>jsonb_array_length(selected) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 s:=o->'session';
 FOR idx IN SELECT (value::text)::int FROM jsonb_array_elements(selected) LOOP
  src:=c.candidate->'descriptionSources'->idx;e:=c.candidate->'candidate'->'entries'->idx;
  IF (src->>'kind'='synthetic_image_description' AND src->>'actor'='system' AND src->>'messageId'='synthetic-normalized:'||c.candidate_id||':'||idx AND e->>'id'='synthetic-normalized-entry:'||c.candidate_id||':'||idx AND e->>'category'='person_style' AND e->>'field' IN ('managed_before_outline_'||(c.candidate->'normalizedBinding'->'input'->>'angle'),'managed_before_hair_shape_'||(c.candidate->'normalizedBinding'->'input'->>'angle')) AND e->>'origin'='extraction' AND e->>'basis'='observable' AND e->>'track'='context' AND e->'zone'='null' AND e->'groupId'='null' AND e->'service'='null' AND e->'side'='null' AND e->>'status'=(CASE WHEN e->'value'='null' THEN 'unknown' ELSE 'not_confirmed' END) AND (e->'value'='null' OR e->>'field'='managed_before_outline_'||(c.candidate->'normalizedBinding'->'input'->>'angle') AND e->>'value' IN ('轮廓偏圆','轮廓偏长','轮廓偏方','轮廓偏椭圆') OR e->>'field'='managed_before_hair_shape_'||(c.candidate->'normalizedBinding'->'input'->>'angle') AND e->>'value' IN ('短发轮廓','中长发轮廓','长发轮廓','直线发丝形态','波浪发丝形态','卷曲发丝形态'))) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
  j:=jsonb_build_object('requestId',(req->>'requestId')||'-normalized-source-'||idx,'expectedRevision',s->'revision','scope',s->'scope','event',jsonb_build_object('type','source_recorded','source',src));
  s:=jsonb_set(jsonb_set(jsonb_set(s,'{sources}',(s->'sources')||jsonb_build_array(src)),'{journal}',(s->'journal')||jsonb_build_array(j)),'{revision}',to_jsonb((s->>'revision')::int+1));
  j:=jsonb_build_object('requestId',(req->>'requestId')||'-normalized-entry-'||idx,'expectedRevision',s->'revision','scope',s->'scope','event',jsonb_build_object('type','entry_recorded','entry',e));
  s:=jsonb_set(jsonb_set(jsonb_set(s,'{entries}',(s->'entries')||jsonb_build_array(e||jsonb_build_object('confirmation',null))),'{journal}',(s->'journal')||jsonb_build_array(j)),'{revision}',to_jsonb((s->>'revision')::int+1));
 END LOOP;
 IF r->'session' IS DISTINCT FROM s THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 receipt:=jsonb_build_object('schemaVersion','design-managed-model-acceptance-v3','candidateId',c.candidate_id,'candidateDigest',design_dependency_authority.digest(c.candidate),'kind',c.candidate->'kind','inputDigest',c.candidate->'workflowBinding'->'sessionDigest','baseRevision',o->'session'->'revision','resultRevision',s->'revision','selectedIndices',selected,'normalizedBindingDigest',design_dependency_authority.digest(c.candidate->'normalizedBinding'));
 ac:=jsonb_build_object('requestId',req->'requestId','workflowRevision',r->'revision','authority',a,'receipt',receipt);
 h:=coalesce(o->'managedImageHistory',jsonb_build_object('schemaVersion','design-managed-image-history-v3','inputs','[]'::jsonb,'accepted','[]'::jsonb));
 h:=jsonb_set(h,'{schemaVersion}','"design-managed-image-history-v3"');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'inputs') x WHERE x->'taskId'=c.input->'taskId') THEN h:=jsonb_set(h,'{inputs}',(h->'inputs')||jsonb_build_array(c.input));ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'inputs') x WHERE x=c.input) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CONFLICT';END IF;
 h:=jsonb_set(h,'{accepted}',(h->'accepted')||jsonb_build_array(jsonb_build_object('candidate',c.candidate,'acceptance',ac)));
 IF jsonb_array_length(h->'inputs')>300 OR jsonb_array_length(h->'accepted')>1000 OR r->'managedImageHistory' IS DISTINCT FROM h THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 -- Final full old-head checks before atomic append. Held locks stay until commit.
 v:=design_normalized_provider_binding.read_completed(c.request_id);
 IF v IS DISTINCT FROM jsonb_build_object('authority',c.authority,'intent',c.intent,'result',c.candidate,'input',c.input) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;
 IF b IS DISTINCT FROM design_dependency_authority.read_bundle() THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;
 INSERT INTO design_private.workflow_versions VALUES(sk,(r->>'revision')::int,r,sha,oldrow->>'sha256',rk);
 INSERT INTO design_private.workflow_receipts VALUES(rk,rc,sha);
 INSERT INTO design_dependency_authority.operation_authors VALUES(sk,(r->>'revision')::int,rk,a,sha,oldrow->>'sha256',b->'manifest'->>'id');
 INSERT INTO design_managed_normalized_workflow.consumptions VALUES(c.candidate_id,a,ac,sha,oldrow->>'sha256',rk,(r->>'revision')::int,txid_current());
 PERFORM design_managed_normalized_workflow.require_consumed(jsonb_build_object('candidateId',c.candidate_id,'acceptance',ac,'recordSha256',sha));RETURN true;
END$$;
CREATE FUNCTION design_managed_normalized_workflow.require_consumed(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;c design_managed_normalized_workflow.candidates;z design_managed_normalized_workflow.consumptions;head jsonb;BEGIN
 IF session_user<>'design_identity_runtime' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (q-ARRAY['candidateId','acceptance','recordSha256'])<>'{}' OR (SELECT count(*) FROM jsonb_object_keys(q))<>3 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 b:=design_dependency_authority.read_bundle();head:=b->'workflowRows'->-1;SELECT * INTO STRICT c FROM design_managed_normalized_workflow.candidates WHERE candidate_id=q->>'candidateId';SELECT * INTO STRICT z FROM design_managed_normalized_workflow.consumptions WHERE candidate_id=c.candidate_id;
 IF z.transaction_id<>txid_current() OR z.authority IS DISTINCT FROM b->'authority' OR c.authority IS DISTINCT FROM z.authority OR z.acceptance IS DISTINCT FROM q->'acceptance' OR z.record_sha256 IS DISTINCT FROM q->>'recordSha256' OR head->>'sha256' IS DISTINCT FROM z.record_sha256 OR head->>'previous_sha256' IS DISTINCT FROM z.previous_sha256 OR head->>'receipt_key' IS DISTINCT FROM z.receipt_key OR head->'revision' IS DISTINCT FROM to_jsonb(z.record_revision) OR head->'record'->'managedImageHistory'->'accepted'->-1 IS DISTINCT FROM jsonb_build_object('candidate',c.candidate,'acceptance',z.acceptance) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 IF design_normalized_provider_binding.verify_retained_context(c.authority,c.intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;RETURN true;
END$$;
CREATE FUNCTION design_managed_normalized_workflow.verify_history(q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;h jsonb;item jsonb;c jsonb;z jsonb;wr jsonb;input_set jsonb:='[]';inp jsonb;BEGIN
 IF session_user<>'design_identity_runtime' OR jsonb_typeof(q) IS DISTINCT FROM 'object' OR (q-ARRAY['managedImageHistory'])<>'{}' OR (SELECT count(*) FROM jsonb_object_keys(q))<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 b:=design_dependency_authority.read_bundle();h:=q->'managedImageHistory';
 IF (jsonb_typeof(h)='object' AND (h-ARRAY['schemaVersion','inputs','accepted'])='{}' AND (SELECT count(*) FROM jsonb_object_keys(h))=3 AND h->>'schemaVersion'='design-managed-image-history-v3' AND jsonb_typeof(h->'inputs')='array' AND jsonb_typeof(h->'accepted')='array' AND jsonb_array_length(h->'accepted') BETWEEN 1 AND 1000 AND jsonb_array_length(h->'inputs') BETWEEN 1 AND 300) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'workflowRows') x WHERE x->'record'->'managedImageHistory'=h) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(h->'accepted') LOOP
  IF item->'candidate'->>'schemaVersion'='design-managed-model-candidate-v1' THEN
   SELECT to_jsonb(stored) INTO STRICT c FROM design_managed_workflow.candidates stored WHERE candidate_id=item->'candidate'->>'id';
   SELECT to_jsonb(consumed) INTO STRICT z FROM design_managed_workflow.consumptions consumed WHERE candidate_id=item->'candidate'->>'id';
   c:=jsonb_set(c,'{inputs}',jsonb_build_array(c->'input'));
  ELSIF item->'candidate'->>'schemaVersion'='design-managed-model-candidate-v2' THEN
   SELECT to_jsonb(stored) INTO STRICT c FROM design_managed_view_workflow.candidates stored WHERE candidate_id=item->'candidate'->>'id';
   SELECT to_jsonb(consumed) INTO STRICT z FROM design_managed_view_workflow.consumptions consumed WHERE candidate_id=item->'candidate'->>'id';
  ELSIF item->'candidate'->>'schemaVersion'='design-managed-model-candidate-v4' THEN
   SELECT to_jsonb(stored) INTO STRICT c FROM design_managed_normalized_workflow.candidates stored WHERE candidate_id=item->'candidate'->>'id';
   SELECT to_jsonb(consumed) INTO STRICT z FROM design_managed_normalized_workflow.consumptions consumed WHERE candidate_id=item->'candidate'->>'id';
   c:=jsonb_set(c,'{inputs}',jsonb_build_array(c->'input'));
  ELSE RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
  SELECT value INTO STRICT wr FROM jsonb_array_elements(b->'workflowRows') x WHERE x->'revision'=z->'record_revision';
  IF c->>'scope_key' IS DISTINCT FROM design_dependency_authority.digest(b->'authority'->'scope') OR item IS DISTINCT FROM jsonb_build_object('candidate',c->'candidate','acceptance',z->'acceptance') OR wr->'sha256' IS DISTINCT FROM z->'record_sha256' OR wr->'receipt_key' IS DISTINCT FROM z->'receipt_key' OR wr->'previous_sha256' IS DISTINCT FROM z->'previous_sha256' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'operationAuthors') p WHERE p->'revision'=z->'record_revision' AND p->'authority'=z->'authority' AND p->'recordSha256'=z->'record_sha256' AND p->'receiptKey'=z->'receipt_key') THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
  FOR inp IN SELECT value FROM jsonb_array_elements(c->'inputs') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'inputs') stored_input WHERE stored_input=inp) THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_DENIED';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input_set) stored_input WHERE stored_input=inp) THEN input_set:=input_set||jsonb_build_array(inp);END IF;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(input_set)<>jsonb_array_length(h->'inputs') OR design_identity.require_authority() IS DISTINCT FROM b->'authority' OR b IS DISTINCT FROM design_dependency_authority.read_bundle() THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_CHANGED';END IF;RETURN true;
END$$;

-- Historical evidence is checked against its immutable original sidecar and
-- operation author; no expired old sending receipt is revived for history reads.
GRANT USAGE ON SCHEMA design_managed_workflow,design_managed_view_workflow TO design_managed_normalized_workflow_capability;
GRANT SELECT ON design_managed_workflow.candidates,design_managed_workflow.consumptions,design_managed_view_workflow.candidates,design_managed_view_workflow.consumptions TO design_managed_normalized_workflow_capability;
CREATE POLICY normalized_history ON design_managed_workflow.candidates FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_history ON design_managed_workflow.consumptions FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_history ON design_managed_view_workflow.candidates FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
CREATE POLICY normalized_history ON design_managed_view_workflow.consumptions FOR SELECT TO design_managed_normalized_workflow_capability USING(true);
GRANT USAGE ON SCHEMA design_managed_normalized_workflow TO design_managed_workflow_capability,design_managed_view_workflow_capability;
DO $patch$ DECLARE src text;old text:=$old$NOT IN ('design-prepared-workflow-record-v1','design-prepared-workflow-record-v2','design-prepared-workflow-record-v3','design-prepared-workflow-record-v4') OR (r->>'schemaVersion' IN ('design-prepared-workflow-record-v3','design-prepared-workflow-record-v4')) IS DISTINCT FROM (r ? 'managedImageHistory') OR (r->>'schemaVersion'='design-prepared-workflow-record-v4') IS DISTINCT FROM (coalesce(r->'managedImageHistory'->>'schemaVersion','')='design-managed-image-history-v2') OR (r->>'schemaVersion'='design-prepared-workflow-record-v3' AND r->'managedImageHistory'->>'schemaVersion' IS DISTINCT FROM 'design-managed-image-history-v1') OR (r->>'schemaVersion' NOT IN ('design-prepared-workflow-record-v3','design-prepared-workflow-record-v4') AND (r->>'schemaVersion'='design-prepared-workflow-record-v2') IS DISTINCT FROM (r ? 'modelCandidates'))$old$;new text:=$new$NOT IN ('design-prepared-workflow-record-v1','design-prepared-workflow-record-v2','design-prepared-workflow-record-v3','design-prepared-workflow-record-v4','design-prepared-workflow-record-v5') OR (r->>'schemaVersion' IN ('design-prepared-workflow-record-v3','design-prepared-workflow-record-v4','design-prepared-workflow-record-v5')) IS DISTINCT FROM (r ? 'managedImageHistory') OR (r->>'schemaVersion'='design-prepared-workflow-record-v4') IS DISTINCT FROM (coalesce(r->'managedImageHistory'->>'schemaVersion','')='design-managed-image-history-v2') OR (r->>'schemaVersion'='design-prepared-workflow-record-v5') IS DISTINCT FROM (coalesce(r->'managedImageHistory'->>'schemaVersion','')='design-managed-image-history-v3') OR (r->>'schemaVersion'='design-prepared-workflow-record-v3' AND r->'managedImageHistory'->>'schemaVersion' IS DISTINCT FROM 'design-managed-image-history-v1') OR (r->>'schemaVersion' NOT IN ('design-prepared-workflow-record-v3','design-prepared-workflow-record-v4','design-prepared-workflow-record-v5') AND (r->>'schemaVersion'='design-prepared-workflow-record-v2') IS DISTINCT FROM (r ? 'modelCandidates'))$new$;BEGIN
 SELECT pg_get_functiondef('design_dependency_authority.check_record(jsonb,jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PATCH_ANCHOR';END IF;EXECUTE replace(src,old,new);END $patch$;
DO $patch$ DECLARE src text;old text:=$old$CASE WHEN oldr->>'schemaVersion'='design-prepared-workflow-record-v4' THEN 'design-prepared-workflow-record-v4' WHEN oldr ? 'managedImageHistory' THEN 'design-prepared-workflow-record-v3' ELSE 'design-prepared-workflow-record-v2' END$old$;new text:=$new$CASE WHEN oldr->>'schemaVersion'='design-prepared-workflow-record-v5' THEN 'design-prepared-workflow-record-v5' ELSE CASE WHEN oldr->>'schemaVersion'='design-prepared-workflow-record-v4' THEN 'design-prepared-workflow-record-v4' WHEN oldr ? 'managedImageHistory' THEN 'design-prepared-workflow-record-v3' ELSE 'design-prepared-workflow-record-v2' END END$new$;BEGIN
 SELECT pg_get_functiondef('design_dependency_authority.append_native(jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PATCH_ANCHOR';END IF;EXECUTE replace(src,old,new);END $patch$;
DO $patch$ DECLARE src text;old text:=$old$NOT IN ('design-full-workflow-snapshot-v1','design-full-workflow-snapshot-v2','design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4') OR (sn->>'schemaVersion' IN ('design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4')) IS DISTINCT FROM (r ? 'managedImageHistory') OR (sn->>'schemaVersion'='design-full-workflow-snapshot-v4') IS DISTINCT FROM (r->>'schemaVersion'='design-prepared-workflow-record-v4')$old$;new text:=$new$NOT IN ('design-full-workflow-snapshot-v1','design-full-workflow-snapshot-v2','design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4','design-full-workflow-snapshot-v5') OR (sn->>'schemaVersion' IN ('design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4','design-full-workflow-snapshot-v5')) IS DISTINCT FROM (r ? 'managedImageHistory') OR (sn->>'schemaVersion'='design-full-workflow-snapshot-v4') IS DISTINCT FROM (r->>'schemaVersion'='design-prepared-workflow-record-v4') OR (sn->>'schemaVersion'='design-full-workflow-snapshot-v5') IS DISTINCT FROM (r->>'schemaVersion'='design-prepared-workflow-record-v5')$new$;BEGIN
 SELECT pg_get_functiondef('design_dependency_authority.append_full(jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PATCH_ANCHOR';END IF;EXECUTE replace(src,old,new);END $patch$;
DO $patch$ DECLARE src text;old text:=$old$b:=design_dependency_authority.read_bundle();h:=q->'managedImageHistory';$old$;new text:=$new$IF q->'managedImageHistory'->>'schemaVersion'='design-managed-image-history-v3' THEN RETURN design_managed_normalized_workflow.verify_history(q);END IF; b:=design_dependency_authority.read_bundle();h:=q->'managedImageHistory';$new$;BEGIN
 SELECT pg_get_functiondef('design_managed_workflow.verify_history(jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PATCH_ANCHOR';END IF;EXECUTE replace(src,old,new);END $patch$;
DO $patch$ DECLARE src text;old text:=$old$b:=design_dependency_authority.read_bundle();h:=q->'managedImageHistory';$old$;new text:=$new$IF q->'managedImageHistory'->>'schemaVersion'='design-managed-image-history-v3' THEN RETURN design_managed_normalized_workflow.verify_history(q);END IF; b:=design_dependency_authority.read_bundle();h:=q->'managedImageHistory';$new$;BEGIN
 SELECT pg_get_functiondef('design_managed_view_workflow.verify_history(jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'NORMALIZED_WORKFLOW_PATCH_ANCHOR';END IF;EXECUTE replace(src,old,new);END $patch$;
-- Existing Stage30 append_text/verify_candidate managed_before_ barriers
-- already reject these fields through generic model/text acceptance paths.
ALTER FUNCTION design_managed_normalized_workflow.publish(jsonb) OWNER TO design_managed_normalized_workflow_capability;
ALTER FUNCTION design_managed_normalized_workflow.read_candidate(jsonb) OWNER TO design_managed_normalized_workflow_capability;
ALTER FUNCTION design_managed_normalized_workflow.append_managed(jsonb) OWNER TO design_managed_normalized_workflow_capability;
ALTER FUNCTION design_managed_normalized_workflow.require_consumed(jsonb) OWNER TO design_managed_normalized_workflow_capability;
ALTER FUNCTION design_managed_normalized_workflow.verify_history(jsonb) OWNER TO design_managed_normalized_workflow_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_managed_normalized_workflow FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION design_managed_normalized_workflow.publish(jsonb),design_managed_normalized_workflow.read_candidate(jsonb),design_managed_normalized_workflow.append_managed(jsonb),design_managed_normalized_workflow.require_consumed(jsonb),design_managed_normalized_workflow.verify_history(jsonb) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_managed_normalized_workflow.verify_history(jsonb) TO design_managed_workflow_capability,design_managed_view_workflow_capability;
REVOKE CREATE ON SCHEMA design_managed_normalized_workflow FROM design_managed_normalized_workflow_capability;
COMMIT;
