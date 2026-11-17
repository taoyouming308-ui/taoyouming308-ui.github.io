-- ISOLATED SYNTHETIC FIXTURE ONLY. Install provider main, this helper, then workflow.
-- Full finite candidate reconstruction, not a shape/hash-only acceptance shortcut.
BEGIN;
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regprocedure('design_managed_application_view_provider_binding.context_for(jsonb,text,jsonb,text)') IS NULL OR to_regprocedure('design_managed_application_view_provider_binding.review_choices(jsonb)') IS NULL THEN RAISE EXCEPTION 'APPLICATION_VIEW_RESULT_PREREQUISITE';END IF;
END$$;
CREATE FUNCTION design_managed_application_view_provider_binding.result_valid(a jsonb,i jsonb,v jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 ctx jsonb;ses jsonb;ev jsonb;result_value jsonb;choices jsonb;cid text;kind text;angle text;local_result boolean;
 sources jsonb:='[]';entries jsonb:='[]';warnings jsonb;rb jsonb;expected jsonb;src jsonb;en jsonb;previous jsonb;item jsonb;judgment jsonb;
 idx int:=0;total int;seen text[]:=ARRAY[]::text[];input_field text;field_name text;val jsonb;description text;prefix_name text;category_name text;track_name text;origin_name text;basis_name text;source_kind text:='image_description';source_actor text:='model';
 labels jsonb:='{"front":"正面","back":"背面","left":"左侧","right":"右侧"}';
 states jsonb:='{"limited_evidence":"证据不足，不能形成完整三视图结论","potential_conflict":"逐角判断存在潜在冲突，需复核","consistent_judgments":"现有逐角判断方向一致，不代表达标","mixed_judgments":"逐角判断不同，保留各自限制"}';
 focus_labels jsonb:='{"missing_views":"补齐缺失角度","noncomparable_views":"复核不可比较原因","opposing_judgments":"核查相反判断与拍摄差异","cross_view_differences":"分别核对不同角度差异","confirm_angle_judgment":"核对尚未确认的逐角判断","capture_conditions":"核查拍摄条件是否足以比较"}';
 visual_values jsonb:='{"visible_outline":["轮廓偏圆","轮廓偏长","轮廓偏方","轮廓偏椭圆"],"visible_hair_shape":["短发轮廓","中长发轮廓","长发轮廓","直线发丝形态","波浪发丝形态","卷曲发丝形态"]}';
 comparison_values jsonb:='[{"comparability":"comparable","reason":null,"change":"发型外轮廓看起来有变化"},{"comparability":"comparable","reason":null,"change":"卷曲形态看起来更明显"},{"comparability":"comparable","reason":null,"change":"卷曲形态看起来较不明显"},{"comparability":"comparable","reason":null,"change":"未见明确外观变化"},{"comparability":"not_comparable","reason":"遮挡影响比较","change":null},{"comparability":"not_comparable","reason":"清晰度不足","change":null},{"comparability":"not_comparable","reason":"姿态或取景差异","change":null},{"comparability":"not_comparable","reason":"光线差异","change":null},{"comparability":"not_comparable","reason":"无法确定可比性","change":null}]';
 views_text text;missing_text text;uncomparable_text text;conflict_text text;focus_text text;
BEGIN
 IF session_user IS DISTINCT FROM 'design_identity_runtime' OR a IS DISTINCT FROM design_identity.require_authority() OR design_managed_application_view_provider_binding.valid_intent(i) IS DISTINCT FROM true OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>262144 THEN RETURN false;END IF;
 kind:=i->>'candidateKind';ctx:=design_managed_application_view_provider_binding.context_for(a,kind,design_managed_application_view_provider_binding.selectors(i),i->>'requestId');ses:=ctx->'session';ev:=ctx->'evidenceBinding';
 IF ctx->'authority' IS DISTINCT FROM a OR ctx->'workflowBinding' IS DISTINCT FROM i->'workflowBinding' OR ev IS DISTINCT FROM i->'evidenceBinding' OR ctx->'keyBinding' IS DISTINCT FROM i->'keyBinding' OR jsonb_typeof(ses->'entries') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 cid:='app-view-'||design_dependency_authority.digest(jsonb_build_object('authority',a,'requestId',i->'requestId'));
 rb:=jsonb_build_object('requestId',i->'requestId','intentDigest',design_dependency_authority.digest(i),'payloadSha256',i->'payloadSha256','model',i->'model','promptVersion',i->'promptVersion','ownerKey',design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',i->'requestId')),'approvalReceiptId',CASE WHEN i->>'kind'='local' THEN NULL ELSE (SELECT x.record->>'receiptId' FROM design_policy_private.issued_receipts x WHERE x.record->'authority'=a AND x.record->'intent'=i AND x.active) END);
 result_value:=v->'result';angle:=ev->>'angle';
 IF kind='managed_application_completion_comparison' THEN
  IF ses->>'phase' IS DISTINCT FROM 'completed_review' OR jsonb_typeof(result_value) IS DISTINCT FROM 'object' OR (result_value-ARRAY['judgment']) IS DISTINCT FROM '{}'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(comparison_values) allowed WHERE allowed=result_value->'judgment') THEN RETURN false;END IF;
  judgment:=result_value->'judgment';description:='合成演练，mock 响应，未调用真实模型；应用图片逐角比较，未确认、非测量或执行事实：'||CASE WHEN judgment->>'comparability'='comparable' THEN judgment->>'change' ELSE '无法比较：'||(judgment->>'reason') END||'。来源记录不同不证明实际不同拍摄；不证明达标、实际操作或因果。';
  total:=1;field_name:='managed_photo_comparison_'||angle;val:=to_jsonb(description);prefix_name:='synthetic-application-comparison';category_name:='result_review';track_name:='actual';origin_name:='extraction';basis_name:='observable';
  warnings:=jsonb_build_array('仅合成演练的 mock 逐角比较，未调用真实模型；actual只表示完成复盘，不证明独立拍摄、实际操作、达标或因果。');source_kind:='synthetic_application_comparison';source_actor:='system';
 ELSIF kind='managed_application_completion_synthesis' THEN
  IF ses->>'phase' IS DISTINCT FROM 'completed_review' OR jsonb_typeof(result_value) IS DISTINCT FROM 'object' OR (result_value-ARRAY['reviewFocus']) IS DISTINCT FROM '{}'::jsonb OR NOT result_value?'reviewFocus' THEN RETURN false;END IF;
  -- context_for freshly reconstructs the exact accepted ancestors/confirmations.
  choices:=design_managed_application_view_provider_binding.review_choices(ev);IF jsonb_typeof(choices) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  local_result:=ev->>'generation'='deterministic';
  IF local_result IS NULL OR local_result IS DISTINCT FROM (i->>'kind'='local') OR local_result IS DISTINCT FROM (jsonb_array_length(choices)<=1) THEN RETURN false;END IF;
  IF jsonb_array_length(choices)=0 THEN IF result_value->'reviewFocus' IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(choices) allowed WHERE allowed=result_value->'reviewFocus') THEN RETURN false;END IF;
  SELECT string_agg((labels->>(x.item->>'angle'))||'：'||coalesce(x.item->'judgment'->>'change','无法比较：'||(x.item->'judgment'->>'reason'))||'（'||CASE WHEN x.item->>'entryStatus'='confirmed' THEN '员工已确认该条' ELSE '该条未确认' END||'）','；' ORDER BY x.ord) INTO views_text FROM jsonb_array_elements(ev->'ancestors') WITH ORDINALITY x(item,ord);
  SELECT string_agg(labels->>x.angle,'、' ORDER BY x.ord) INTO missing_text FROM jsonb_array_elements_text(ev->'missingAngles') WITH ORDINALITY x(angle,ord);
  SELECT string_agg(labels->>x.angle,'、' ORDER BY x.ord) INTO uncomparable_text FROM jsonb_array_elements_text(ev->'uncomparableAngles') WITH ORDINALITY x(angle,ord);
  SELECT string_agg(labels->>x.angle,'、' ORDER BY x.ord) INTO conflict_text FROM jsonb_array_elements_text(ev->'conflictingAngles') WITH ORDINALITY x(angle,ord);
  IF result_value->'reviewFocus'='null'::jsonb THEN focus_text:='无额外复核重点';ELSE
   SELECT string_agg(labels->>x.angle,'、' ORDER BY x.ord) INTO focus_text FROM jsonb_array_elements_text(result_value->'reviewFocus'->'angles') WITH ORDINALITY x(angle,ord);
   focus_text:=(focus_labels->>(result_value->'reviewFocus'->>'kind'))||'（'||focus_text||'）';END IF;
  description:=CASE WHEN local_result THEN '合成演练，服务器整理，未调用新模型：' ELSE '合成演练，mock 响应，未调用真实模型；整理已采纳逐角判断，未重新查看照片：' END||views_text||'。缺失角度：'||coalesce(missing_text,'无')||'；不可比：'||coalesce(uncomparable_text,'无')||'；潜在冲突：'||coalesce(conflict_text,'无')||'。'||(states->>(ev->>'assessment'))||'。优先复核：'||focus_text||'。仅覆盖所选'||(labels->>(ev->>'side'))||'，不代表另一侧；不证明操作、药水、测量、达标或因果。';
  IF description IS NULL THEN RETURN false;END IF;
  total:=1;field_name:='managed_completion_synthesis_'||(ev->>'side');val:=to_jsonb(description);prefix_name:='synthetic-application-synthesis';category_name:='result_review';track_name:='actual';origin_name:='suggestion';basis_name:='inferred';source_kind:='synthetic_application_synthesis';source_actor:='system';
  warnings:=jsonb_build_array('仅合成演练，综合只整理已采纳逐角 mock 判断并保留原确认状态；自身仍未确认，不重看照片，不能消除缺角、不可比和冲突，不推断工艺或实际执行。');
 ELSE RETURN false;END IF;
 FOR idx IN 0..total-1 LOOP

  IF description IS NULL OR field_name IS NULL THEN RETURN false;END IF;
  src:=jsonb_build_object('messageId',prefix_name||':'||cid||':'||idx,'kind',source_kind,'actor',source_actor,'text',description);
  previous:=NULL;
  SELECT x.entry->'id' INTO previous FROM jsonb_array_elements(ses->'entries') WITH ORDINALITY x(entry,ord)
   WHERE x.entry->>'category'=category_name AND x.entry->>'field'=field_name AND x.entry->'zone'='null'::jsonb AND x.entry->>'track'=track_name AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(ses->'entries') WITH ORDINALITY y(entry,ord) WHERE y.ord>x.ord AND
    jsonb_build_array(y.entry->'category',y.entry->'field',y.entry->'zone',y.entry->'track',y.entry->'groupId',y.entry->'service',y.entry->'side')=jsonb_build_array(x.entry->'category',x.entry->'field',x.entry->'zone',x.entry->'track',x.entry->'groupId',x.entry->'service',x.entry->'side')) ORDER BY x.ord LIMIT 1;
  en:=jsonb_build_object('id',prefix_name||'-entry:'||cid||':'||idx,'category',category_name,'field',field_name,'zone',null,'groupId',null,'service',null,'side',null,'track',track_name,'origin',origin_name,'basis',basis_name,'value',val,'status',CASE WHEN val='null'::jsonb THEN 'unknown' ELSE 'not_confirmed' END,'sources',CASE WHEN val='null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('messageId',src->'messageId','quote',description)) END,'replacesEntryId',previous);
  sources:=sources||jsonb_build_array(src);entries:=entries||jsonb_build_array(en);
 END LOOP;
 expected:=jsonb_build_object('schemaVersion','design-managed-model-candidate-v6','id',cid,'kind',kind,'generation',CASE WHEN i->>'kind'='local' THEN 'synthetic_deterministic' ELSE 'synthetic_mock_model' END,'authority',a,'scope',a->'scope','workflowBinding',i->'workflowBinding','requestBinding',rb,'evidenceBinding',ev,'result',result_value,'descriptionSources',sources,'candidate',jsonb_build_object('phase',ses->'phase','entries',entries,'questions','[]'::jsonb,'warnings',warnings));
 RETURN (v=expected) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END$$;
ALTER FUNCTION design_managed_application_view_provider_binding.result_valid(jsonb,jsonb,jsonb) OWNER TO design_identity_capability;
REVOKE ALL ON FUNCTION design_managed_application_view_provider_binding.result_valid(jsonb,jsonb,jsonb) FROM PUBLIC,design_identity_runtime;
COMMIT;
