-- OFFLINE synthetic PG17 only. No keys, approvals, dispatch or history mutation.
-- Caller supplies the current checked bundle; this helper never trusts caller hashes.
BEGIN;
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regnamespace('design_managed_view_workflow') IS NULL OR to_regprocedure('design_managed_view_provider_binding.image_context(jsonb,text)') IS NULL THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_FIXTURE_REQUIRED';END IF;
END$$;
GRANT CREATE ON SCHEMA design_managed_view_provider_binding TO design_identity_capability;
CREATE FUNCTION design_managed_view_provider_binding.review_choices(e jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE choices jsonb:='[]';ev jsonb;angles jsonb;distinct_changes integer;BEGIN
 IF jsonb_typeof(e->'ancestors') IS DISTINCT FROM 'array' OR jsonb_typeof(e->'missingAngles') IS DISTINCT FROM 'array' OR jsonb_typeof(e->'uncomparableAngles') IS DISTINCT FROM 'array' OR jsonb_typeof(e->'conflictingAngles') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
 IF jsonb_array_length(e->'missingAngles')>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','missing_views','angles',e->'missingAngles'));END IF;
 IF jsonb_array_length(e->'uncomparableAngles')>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','noncomparable_views','angles',e->'uncomparableAngles'));END IF;
 IF jsonb_array_length(e->'conflictingAngles')>0 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','opposing_judgments','angles',e->'conflictingAngles'));END IF;
 SELECT count(DISTINCT x->'judgment'->'change'),coalesce(jsonb_agg(x->'angle'),'[]') INTO distinct_changes,angles FROM jsonb_array_elements(e->'ancestors') x WHERE x->'judgment'->>'comparability'='comparable';
 IF distinct_changes>1 THEN choices:=choices||jsonb_build_array(jsonb_build_object('kind','cross_view_differences','angles',angles));END IF;
 FOR ev IN SELECT value FROM jsonb_array_elements(e->'ancestors') WHERE value->>'entryStatus'='not_confirmed' LOOP choices:=choices||jsonb_build_array(jsonb_build_object('kind','confirm_angle_judgment','angles',jsonb_build_array(ev->'angle')));END LOOP;
 IF e->'missingAngles'='[]'::jsonb AND e->'uncomparableAngles'='[]'::jsonb AND distinct_changes=1 THEN SELECT jsonb_agg(x->'angle') INTO angles FROM jsonb_array_elements(e->'ancestors') x;choices:=choices||jsonb_build_array(jsonb_build_object('kind','capture_conditions','angles',angles));END IF;
 RETURN choices;
END$$;
CREATE FUNCTION design_managed_view_provider_binding.synthesis_evidence(a jsonb,b jsonb,side text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;s jsonb;h jsonb;angle text;entry jsonb;lane jsonb;c jsonb;ac jsonb;receipt jsonb;expected_receipt jsonb;original_entry jsonb;judgment jsonb;description text;binding jsonb;live jsonb;source jsonb;oldrow jsonb;acceptedrow jsonb;expected_journal jsonb;ev jsonb;ancestors jsonb:='[]';missing jsonb:='[]';nc jsonb:='[]';confirmed jsonb:='[]';unconfirmed jsonb:='[]';conflicts jsonb:='[]';result jsonb;n integer;base integer;finish integer;changes integer;has_up boolean:=false;has_down boolean:=false;stored design_managed_view_workflow.candidates;consumed design_managed_view_workflow.consumptions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));
 IF (side IN ('left','right') AND a=b->'authority') IS DISTINCT FROM true OR b IS DISTINCT FROM design_dependency_authority.checked_bundle(a) THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
 r:=b->'workflowRows'->-1->'record';s:=r->'session';h:=r->'managedImageHistory';
 IF s->>'phase' IS DISTINCT FROM 'completed_review' OR h->>'schemaVersion' NOT IN ('design-managed-image-history-v1','design-managed-image-history-v2') OR jsonb_typeof(h->'accepted') IS DISTINCT FROM 'array' OR jsonb_typeof(h->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(h->'accepted')>1000 OR jsonb_array_length(h->'inputs')>300 THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
 FOREACH angle IN ARRAY ARRAY['front','back',side] LOOP
  -- Same latestEntry grouping and first visible match order as getDesignView.
  SELECT x.value INTO entry FROM jsonb_array_elements(s->'entries') WITH ORDINALITY x(value,n) WHERE x.value->>'category'='result_review' AND x.value->>'field'='managed_photo_comparison_'||angle AND x.value->>'track'='actual' AND x.value->'zone'='null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'entries') WITH ORDINALITY y(value,n) WHERE y.n>x.n AND y.value->'category'=x.value->'category' AND y.value->'field'=x.value->'field' AND y.value->'zone'=x.value->'zone' AND y.value->'track'=x.value->'track' AND coalesce(y.value->'groupId','null')=coalesce(x.value->'groupId','null') AND coalesce(y.value->'service','null')=coalesce(x.value->'service','null') AND coalesce(y.value->'side','null')=coalesce(x.value->'side','null')) ORDER BY x.n LIMIT 1;
  IF entry IS NULL THEN missing:=missing||jsonb_build_array(angle);CONTINUE;END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(h->'accepted') x WHERE x->'candidate'->>'schemaVersion'='design-managed-model-candidate-v2' AND x->'candidate'->>'kind'='managed_completion_comparison' AND x->'candidate'->'candidate'->'entries'->0->'id'=entry->'id';
  IF n<>1 THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  SELECT value INTO lane FROM jsonb_array_elements(h->'accepted') x WHERE x->'candidate'->>'schemaVersion'='design-managed-model-candidate-v2' AND x->'candidate'->>'kind'='managed_completion_comparison' AND x->'candidate'->'candidate'->'entries'->0->'id'=entry->'id';
  c:=lane->'candidate';ac:=lane->'acceptance';receipt:=ac->'receipt';original_entry:=c->'candidate'->'entries'->0;judgment:=c->'result'->'judgment';
  SELECT * INTO STRICT stored FROM design_managed_view_workflow.candidates WHERE candidate_id=c->>'id';
  SELECT * INTO STRICT consumed FROM design_managed_view_workflow.consumptions WHERE candidate_id=c->>'id';
  -- Inherited-author support is deliberately closed until original-author live
  -- image-task provenance is independently supported. Never relabel to current a.
  IF (c=stored.candidate AND ac=consumed.acceptance AND c->'authority'=stored.authority AND ac->'authority'=stored.authority AND consumed.authority=stored.authority AND stored.authority=a AND c->'scope'=a->'scope' AND stored.scope_key=design_dependency_authority.digest(a->'scope') AND c->'evidenceBinding'->>'angle'=angle AND receipt->'selectedIndices'='[0]'::jsonb AND entry->>'id'='managed-comparison-entry:'||(c->>'id')||':0' AND ac->>'requestId'~'^[A-Za-z0-9_-]{1,80}$' AND jsonb_array_length(c->'evidenceBinding'->'images')=2 AND jsonb_array_length(stored.inputs)=2) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  base:=(c->'workflowBinding'->>'sessionRevision')::integer;finish:=(receipt->>'resultRevision')::integer;
  SELECT value INTO STRICT oldrow FROM jsonb_array_elements(b->'workflowRows') WHERE value->'revision'=c->'workflowBinding'->'recordRevision';
  SELECT value INTO STRICT acceptedrow FROM jsonb_array_elements(b->'workflowRows') WHERE value->'revision'=ac->'workflowRevision';
  expected_receipt:=jsonb_build_object('schemaVersion','design-managed-model-acceptance-v2','candidateId',c->'id','candidateDigest',design_dependency_authority.digest(c),'kind','managed_completion_comparison','inputDigest',c->'workflowBinding'->'sessionDigest','baseRevision',base,'resultRevision',base+2,'selectedIndices','[0]'::jsonb,'evidenceBindingDigest',design_dependency_authority.digest(c->'evidenceBinding'));
  IF (receipt=expected_receipt AND finish<=(s->>'revision')::integer AND ac->'workflowRevision'=to_jsonb((c->'workflowBinding'->>'recordRevision')::integer+1) AND consumed.record_revision=(ac->>'workflowRevision')::integer AND consumed.record_sha256=acceptedrow->>'sha256' AND consumed.previous_sha256=oldrow->>'sha256' AND oldrow->'sha256'=c->'workflowBinding'->'recordDigest' AND oldrow->'record'->'session'->'revision'=to_jsonb(base) AND design_dependency_authority.digest(oldrow->'record'->'session')=c->'workflowBinding'->>'sessionDigest' AND oldrow->'record'->'session'->'scope'->'sessionId'=c->'workflowBinding'->'sessionId' AND acceptedrow->'record'->'session'->'revision'=to_jsonb(finish)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  source:=c->'descriptionSources'->0;
  expected_journal:=(oldrow->'record'->'session'->'journal')||jsonb_build_array(jsonb_build_object('requestId',(ac->>'requestId')||'-managed-view-source-0','expectedRevision',base,'scope',s->'scope','event',jsonb_build_object('type','source_recorded','source',source)),jsonb_build_object('requestId',(ac->>'requestId')||'-managed-view-entry-0','expectedRevision',base+1,'scope',s->'scope','event',jsonb_build_object('type','entry_recorded','entry',original_entry)));
  IF expected_journal IS DISTINCT FROM acceptedrow->'record'->'session'->'journal' OR expected_journal IS DISTINCT FROM (SELECT coalesce(jsonb_agg(j.value ORDER BY j.n),'[]') FROM jsonb_array_elements(s->'journal') WITH ORDINALITY j(value,n) WHERE j.n<=finish) THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  description:='托管图片逐角比较，未确认、非测量或执行事实：'||CASE WHEN judgment->>'comparability'='comparable' THEN judgment->>'change' ELSE '无法比较：'||(judgment->>'reason') END||'。不证明达标或操作因果。';
  IF (entry->>'status' IN ('confirmed','not_confirmed') AND entry->>'value'=description AND entry->>'basis'='observable' AND entry->>'origin'='extraction' AND (entry-ARRAY['status','confirmation'])=(original_entry-'status') AND CASE WHEN entry->>'status'='confirmed' THEN jsonb_typeof(entry->'confirmation')='object' ELSE entry->'confirmation'='null'::jsonb END) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(c->'evidenceBinding'->'images') LOOP
   live:=design_managed_view_provider_binding.image_context(a,binding->>'taskId');
   IF live IS DISTINCT FROM binding OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stored.inputs) x WHERE x->>'taskId'=binding->>'taskId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'inputs') x WHERE x->>'taskId'=binding->>'taskId' AND x IN (SELECT value FROM jsonb_array_elements(stored.inputs))) THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
  END LOOP;
  ev:=jsonb_build_object('candidateId',c->'id','candidateDigest',design_dependency_authority.digest(c),'angle',angle,'entryId',entry->'id','acceptanceRequestId',ac->'requestId','acceptanceReceiptDigest',design_dependency_authority.digest(receipt),'entryStatus',entry->'status','confirmationDigest',CASE WHEN entry->>'status'='confirmed' THEN to_jsonb(design_dependency_authority.digest(entry->'confirmation')) ELSE 'null'::jsonb END,'judgment',judgment,'imageBindingDigests',jsonb_build_array(design_dependency_authority.digest(c->'evidenceBinding'->'images'->0),design_dependency_authority.digest(c->'evidenceBinding'->'images'->1)));
  ancestors:=ancestors||jsonb_build_array(ev);
  IF judgment->>'comparability'='not_comparable' THEN nc:=nc||jsonb_build_array(angle);END IF;
  IF entry->>'status'='confirmed' THEN confirmed:=confirmed||jsonb_build_array(angle);ELSE unconfirmed:=unconfirmed||jsonb_build_array(angle);END IF;
  has_up:=has_up OR coalesce(judgment->>'change'='卷曲形态看起来更明显',false);has_down:=has_down OR coalesce(judgment->>'change'='卷曲形态看起来较不明显',false);
 END LOOP;
 IF jsonb_array_length(ancestors) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';END IF;
 IF has_up AND has_down THEN SELECT jsonb_agg(x->'angle') INTO conflicts FROM jsonb_array_elements(ancestors) x WHERE x->'judgment'->>'change' IN ('卷曲形态看起来更明显','卷曲形态看起来较不明显');END IF;
 SELECT count(DISTINCT x->'judgment'->'change') INTO changes FROM jsonb_array_elements(ancestors) x;
 result:=jsonb_build_object('side',side,'ancestors',ancestors,'missingAngles',missing,'uncomparableAngles',nc,'conflictingAngles',conflicts,'confirmedAngles',confirmed,'unconfirmedAngles',unconfirmed,'assessment',CASE WHEN missing<>'[]'::jsonb OR nc<>'[]'::jsonb THEN 'limited_evidence' WHEN conflicts<>'[]'::jsonb THEN 'potential_conflict' WHEN changes=1 THEN 'consistent_judgments' ELSE 'mixed_judgments' END);
 RETURN result||jsonb_build_object('generation',CASE WHEN jsonb_array_length(design_managed_view_provider_binding.review_choices(result))>1 THEN 'model_review_focus' ELSE 'deterministic' END);
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'MANAGED_VIEW_ANCESTOR_INVALID' USING ERRCODE='42501';
END$$;
ALTER FUNCTION design_managed_view_provider_binding.review_choices(jsonb) OWNER TO design_identity_capability;
ALTER FUNCTION design_managed_view_provider_binding.synthesis_evidence(jsonb,jsonb,text) OWNER TO design_identity_capability;
REVOKE ALL ON FUNCTION design_managed_view_provider_binding.review_choices(jsonb),design_managed_view_provider_binding.synthesis_evidence(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.review_choices(jsonb),design_managed_view_provider_binding.synthesis_evidence(jsonb,jsonb,text) TO design_provider_issuer_capability;
GRANT EXECUTE ON FUNCTION design_managed_view_provider_binding.review_choices(jsonb) TO design_candidate_local_capability;
REVOKE CREATE ON SCHEMA design_managed_view_provider_binding FROM design_identity_capability;
COMMIT;
