/** Synthetic metadata for pure protocol tests only; no real image verifier. */
import {managedImageResultFixture} from './managed-image-result.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
import {appendDesignEvent} from '../../packages/analysis-engine/design-pilot.mjs';
import {managedViewHistoryInputBinding} from '../../packages/analysis-engine/managed-view-result-history.mjs';
import {buildManagedViewResultCandidate,buildManagedSynthesisEvidence} from '../../packages/analysis-engine/managed-view-result-candidate.mjs';
const copy=structuredClone;
export function managedViewInputFixture({stage='before',angle='front',maxEdge=1024,mime='image/jpeg',byteLength=100000,seed=''}={}){
 const old=managedImageResultFixture({maxEdge,mime}),input=copy(old.input),tag=(seed?seed+'-':'')+stage+'-'+angle,s=input.sourceRecord,r=input.response,o=input.objectReceipt;
 input.taskId='task-'+tag;s.mediaId='media-'+tag;s.requestId='upload-'+tag;s.stage=stage;s.angle=angle;s.object.key='11/quarantine/'+s.mediaId;s.source.sha256=digest('synthetic-source-'+tag);
 r.sourceRecordDigest=digest(s);r.descriptor.requestId='transform-'+tag;r.descriptor.mediaId=s.mediaId;r.descriptor.source.expectedSourceSha256=s.source.sha256;
 r.descriptor.source.bindingDigest=digest({authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:r.descriptor.source.width,height:r.descriptor.source.height,orientation:'confirmed',immutable:true,active:true});
 r.descriptor.derivative={sha256:digest('synthetic-derivative-'+tag),byteLength,mime};o.responseDigest=digest(r);o.object.key='managed-derived/'+o.responseDigest+'/object';o.derivative=copy(r.descriptor.derivative);
 const report=input.verificationReport,b=report.verificationBinding;b.sourceRecordDigest=digest(s);b.responseDigest=digest(r);b.objectReceiptDigest=digest(o);b.requestId=r.descriptor.requestId;b.mediaId=s.mediaId;b.sourceSha256=s.source.sha256;b.derivativeSha256=o.derivative.sha256;b.transformDigest=digest(r.descriptor.requestedTransform);
 report.evidence={schemaVersion:'design-managed-image-evidence-v1',id:'verification-'+digest({binding:b,checks:report.checks}),sourceRecordDigest:b.sourceRecordDigest,responseDigest:b.responseDigest,transformDigest:b.transformDigest,verifiedSourceSha256:b.sourceSha256,verifiedDerivativeSha256:b.derivativeSha256,verifier:b.verifier,checks:copy(report.checks)};
 return {input,binding:managedViewHistoryInputBinding(input),authority:s.owner,scope:s.owner.scope};
}
export function managedViewResultFixture({session,recordRevision=0,id='view-one',kind='managed_before_view',angle='front',side='left',managedImageHistory,result}={}){
 const old=managedImageResultFixture();let s=session??old.session;
 if(!session&&kind!=='managed_before_view')for(const phase of ['proposal','execution','completed_review'])s=appendDesignEvent(s,{scope:s.scope,requestId:'phase-'+phase,expectedRevision:s.revision,event:{type:'phase_advanced',phase}}).session;
 let evidenceBinding,inputs=[];
 if(kind==='managed_completion_synthesis'){
  const built=buildManagedSynthesisEvidence({session:s,managedImageHistory,side});evidenceBinding=built.evidenceBinding;result=result??{reviewFocus:built.allowedReviewFocus[0]??null};
 }else{
  const raw=(kind==='managed_before_view'?['before']:['before','after']).map(stage=>managedViewInputFixture({stage,angle}));inputs=raw.map(x=>x.input);evidenceBinding={angle,images:raw.map(x=>x.binding)};
  result=result??(kind==='managed_before_view'?{observations:[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:'中长发轮廓'}]}:{judgment:{comparability:'comparable',reason:null,change:'未见明确外观变化'}});
 }
 const workflowBinding={recordRevision,recordDigest:digest({fixture:'synthetic-views',recordRevision,session:s}),sessionId:s.scope.sessionId,sessionRevision:s.revision,sessionDigest:digest(s)},requestBinding={requestId:'generate-'+id,intentDigest:'c'.repeat(64),payloadSha256:'d'.repeat(64),model:evidenceBinding.generation==='deterministic'?'server-deterministic':'synthetic-vision',promptVersion:'synthetic-managed-views-v1'};
 const candidateInput={id,kind,authority:old.authority,scope:old.scope,workflowBinding,requestBinding,evidenceBinding,result,session:s,...(managedImageHistory?{managedImageHistory}:{})};
 return {session:s,scope:old.scope,authority:old.authority,inputs,workflowBinding,requestBinding,evidenceBinding,result,candidateInput,candidate:buildManagedViewResultCandidate(candidateInput)};
}
