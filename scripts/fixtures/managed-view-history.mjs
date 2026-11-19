/** Metadata-only synthetic history builder. No bytes, decoder, auth or I/O. */
import {createDesignSession,appendDesignEvent,createDesignArchive} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest,DESIGN_CANDIDATE_SCHEMA,buildVisualCandidateParts,applyTrustedDesignCandidate} from '../../packages/analysis-engine/design-candidate.mjs';
import {managedImageResultFixture} from './managed-image-result.mjs';
import {buildManagedImageResultCandidate,applyTrustedManagedImageCandidate} from '../../packages/analysis-engine/managed-image-result-candidate.mjs';
import {buildManagedViewResultCandidate,applyTrustedManagedViewCandidate,buildManagedSynthesisEvidence} from '../../packages/analysis-engine/managed-view-result-candidate.mjs';
import {MANAGED_VIEW_HISTORY_SCHEMA,managedViewHistoryInputBinding} from '../../packages/analysis-engine/managed-view-result-history.mjs';
const copy=structuredClone;

export function managedViewHistoryInput({stage='before',angle='front',id=stage+'-'+angle}={}){
 const f=managedImageResultFixture(),s=copy(f.sourceRecord),r=copy(f.response),o=copy(f.objectReceipt),report=copy(f.verificationReport);
 s.mediaId='media-'+id;s.requestId='upload-'+id;s.stage=stage;s.angle=angle;s.object.key='11/quarantine/'+s.mediaId;s.object.version='source-'+id;s.source.sha256=digest('source-'+id);
 const d={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:3000,height:2000,orientation:'confirmed',immutable:true,active:true};
 r.sourceRecordDigest=digest(s);r.descriptor.requestId='transform-'+id;r.descriptor.mediaId=s.mediaId;r.descriptor.source={bindingDigest:digest(d),objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:d.mime,byteLength:d.byteLength,width:d.width,height:d.height,orientation:'confirmed'};r.descriptor.derivative.sha256=digest('derived-'+id);
 o.responseDigest=digest(r);o.object={...s.object,key:'managed-derived/'+digest(r)+'/object',version:'derived-'+id};o.derivative=copy(r.descriptor.derivative);
 const b={sourceRecordDigest:digest(s),responseDigest:digest(r),objectReceiptDigest:digest(o),requestId:r.descriptor.requestId,mediaId:s.mediaId,sourceObjectVersion:s.object.version,derivativeObjectVersion:o.object.version,sourceSha256:s.source.sha256,derivativeSha256:o.derivative.sha256,transformDigest:digest(r.descriptor.requestedTransform),verifier:report.verificationBinding.verifier,policyVersion:report.verificationBinding.policyVersion};
 report.verificationBinding=b;report.evidence={...report.evidence,id:'verification-'+digest({binding:b,checks:report.checks}),sourceRecordDigest:b.sourceRecordDigest,responseDigest:b.responseDigest,transformDigest:b.transformDigest,verifiedSourceSha256:b.sourceSha256,verifiedDerivativeSha256:b.derivativeSha256};
 return {taskId:'task-'+id,sourceRecord:s,response:r,objectReceipt:o,verificationReport:report};
}

export function managedViewHistoryFixture(){
 const base=managedImageResultFixture();
 const state={scope:base.scope,store:base.authority.actor.store,authority:base.authority,session:createDesignSession({customerId:'11',visitId:'booking:101',sessionId:'view-history'}),workflowRevision:0,photoRefs:[],modelCandidates:[],managedImageHistory:{schemaVersion:MANAGED_VIEW_HISTORY_SCHEMA,inputs:[],accepted:[]},archives:[]};let serial=0;
 const native=event=>{state.session=appendDesignEvent(state.session,{scope:state.session.scope,requestId:'native-'+(++serial),expectedRevision:state.session.revision,event}).session;};
 const binding=()=>({recordRevision:state.workflowRevision,recordDigest:digest({fixture:'synthetic-workflow',revision:state.workflowRevision,session:state.session}),sessionId:state.session.scope.sessionId,sessionRevision:state.session.revision,sessionDigest:digest(state.session)});
 const history=()=>copy(state.managedImageHistory);
 function include(input){const exists=state.managedImageHistory.inputs.find(x=>x.taskId===input.taskId);if(!exists)state.managedImageHistory.inputs.push(copy(input));else if(digest(exists)!==digest(input))throw Error('fixture input conflict');}
 function acceptNew({kind,evidenceBinding,result,inputs=[],id='view-'+(++serial)}){
  const w=binding(),prior=history(),candidate=buildManagedViewResultCandidate({id,kind,authority:state.authority,scope:state.scope,workflowBinding:w,requestBinding:{requestId:'generation-'+id,intentDigest:digest('intent-'+id),payloadSha256:digest('body-'+id),model:evidenceBinding.generation==='deterministic'?'server-deterministic':'synthetic-vision',promptVersion:'synthetic-views-v1'},evidenceBinding,result,session:state.session,...(kind==='managed_completion_synthesis'?{managedImageHistory:prior}:{})});
  const requestId='accept-'+id,out=applyTrustedManagedViewCandidate({session:state.session,candidate,workflowBinding:w,selectedIndices:candidate.candidate.entries.map((_,i)=>i),requestId,...(kind==='managed_completion_synthesis'?{managedImageHistory:prior}:{})});
  inputs.forEach(include);state.session=out.session;state.workflowRevision++;
  const row={candidate,acceptance:{requestId,workflowRevision:state.workflowRevision,authority:state.authority,receipt:out.acceptedReceipt}};state.managedImageHistory.accepted.push(copy(row));return copy(row);
 }
 function before(angle='front',value='轮廓偏圆'){
  const input=managedViewHistoryInput({angle});return acceptNew({kind:'managed_before_view',evidenceBinding:{angle,images:[managedViewHistoryInputBinding(input)]},result:{observations:[{field:'visible_outline',value},{field:'visible_hair_shape',value:'中长发轮廓'}]},inputs:[input]});
 }
 function phases(target='completed_review'){
  const phases=['before_analysis','proposal','execution','completed_review'];while(state.session.phase!==target){native({type:'phase_advanced',phase:phases[phases.indexOf(state.session.phase)+1]});state.workflowRevision++;}
 }
 function compare(angle='front',judgment={comparability:'comparable',reason:null,change:'未见明确外观变化'}){
  phases();const inputs=['before','after'].map(stage=>managedViewHistoryInput({stage,angle}));return acceptNew({kind:'managed_completion_comparison',evidenceBinding:{angle,images:inputs.map(managedViewHistoryInputBinding)},result:{judgment},inputs});
 }
 function confirm(entryId){const e=state.session.entries.find(x=>x.id===entryId),messageId='confirmation-'+(++serial),text='【合成测试】员工确认：'+e.value;
  native({type:'source_recorded',source:{messageId,kind:'text',actor:'employee',text}});native({type:'entry_confirmed',entryId,confirmedValue:e.value,sources:[{messageId,quote:e.value}]});state.workflowRevision++;
 }
 function synthesize(side='left',select=0){const built=buildManagedSynthesisEvidence({session:state.session,managedImageHistory:history(),side});return acceptNew({kind:'managed_completion_synthesis',evidenceBinding:built.evidenceBinding,result:{reviewFocus:built.allowedReviewFocus[select]??null}});}
 function oldManaged(id='old-managed-'+(++serial)){
  const f=managedImageResultFixture({session:state.session,recordRevision:state.workflowRevision,id}),q=copy(f.candidateInput);q.workflowBinding=binding();
  const c=buildManagedImageResultCandidate(q),requestId='accept-'+id,out=applyTrustedManagedImageCandidate({session:state.session,candidate:c,workflowBinding:q.workflowBinding,selectedIndices:[0],requestId});include(f.input);state.session=out.session;state.workflowRevision++;
  const row={candidate:c,acceptance:{requestId,workflowRevision:state.workflowRevision,authority:state.authority,receipt:out.acceptedReceipt}};state.managedImageHistory.accepted.push(copy(row));return copy(row);
 }
 function oldModel(id='old-model-'+(++serial)){
  if(!state.photoRefs.length)state.photoRefs.push({kind:'private_media',scope:state.scope,store:state.store,reference:{mediaId:'old-photo',stage:'before',angle:'front',mime:'image/png',byteLength:70,width:1,height:1}});
  const c={schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind:'visual_description',scope:state.scope,store:state.store,actor:state.authority.actor,sessionId:state.session.scope.sessionId,baseRevision:state.session.revision,inputDigest:digest(state.session),payloadDigest:'e'.repeat(64),model:'old-model',promptVersion:'old-prompt',sourceRefs:[{mediaId:'old-photo',sourceSha256:'a'.repeat(64),derivativeSha256:'b'.repeat(64)}],...buildVisualCandidateParts({id,session:state.session,observations:[{field:'visible_outline',value:'轮廓偏方'}]})};
  const requestId='accept-'+id,out=applyTrustedDesignCandidate({session:state.session,candidate:c,selectedIndices:[0],requestId});state.session=out.session;state.workflowRevision++;const row={candidate:c,acceptance:{requestId,workflowRevision:state.workflowRevision,receipt:out.acceptedReceipt}};state.modelCandidates.push(copy(row));return copy(row);
 }
 function archive(){phases();native({type:'phase_advanced',phase:'archive'});state.workflowRevision++;state.archives.push(createDesignArchive(state.session,state.session.scope));}
 const validation=()=>({session:state.session,scope:state.scope,store:state.store,photoRefs:state.photoRefs,...(state.modelCandidates.length?{modelCandidates:state.modelCandidates}:{}),managedImageHistory:state.managedImageHistory,workflowRevision:state.workflowRevision});
 const snapshot=()=>({scope:state.scope,store:state.store,bindings:{uiScope:null,evidenceScope:state.session.scope},ui:null,evidence:{session:state.session,archives:state.archives},photoRefs:state.photoRefs,legacyVersions:[],...(state.modelCandidates.length?{modelCandidates:state.modelCandidates}:{}),managedImageHistory:state.managedImageHistory});
 return {state,before,compare,confirm,synthesize,oldManaged,oldModel,phases,archive,acceptNew,validation,snapshot};
}
