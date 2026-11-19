/** Synthetic pure-contract fixtures only. Bytes are placeholders, checks are mock
 * structures: no decoder, repository, issuer, physical capture or model proof. */
import {createHash} from 'node:crypto';
import {managedContentManifestFixture} from './managed-content-manifest.mjs';
import {createManagedContentWriteIntent,createManagedContentManifest} from '../../packages/design-production-adapter/managed-content-manifest-contracts.mjs';
import * as C from '../../packages/design-production-adapter/managed-application-image-contracts.mjs';
import {buildManagedApplicationViewInput} from '../../packages/design-production-adapter/managed-application-view-input.mjs';
import {createDesignSession,appendDesignEvent} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
import {policyOwnerKey} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {buildManagedApplicationViewResultCandidate,buildManagedApplicationSynthesisEvidence} from '../../packages/analysis-engine/managed-application-view-result-candidate.mjs';
export function managedApplicationViewInputFixture({id='before-front',stage='before',angle='front',authority,mime='image/jpeg',sourceBytes,normalizedBytes,normalizationRequestId}={}){
 const f=managedContentManifestFixture();authority??=f.authority;sourceBytes??=f.bytes;
 const sourceIntent=createManagedContentWriteIntent({...f.sourceInput,authority,requestId:'upload-'+id,assetId:'media-'+id,content:{sha256:createHash('sha256').update(sourceBytes).digest('hex'),byteLength:sourceBytes.length,mime}}),sourceManifest=createManagedContentManifest({intent:sourceIntent,previous:null,ancestors:[]});
 const sourceBinding=C.createManagedApplicationSourceBinding({authority,requestId:sourceManifest.requestId,mediaId:sourceManifest.assetId,stage,angle,sourceManifest});
 const intent=C.createManagedApplicationProcessingIntent({requestId:normalizationRequestId??'normalize-'+id,authority,sourceBinding,sourceManifest});normalizedBytes??=Uint8Array.from(Buffer.from('synthetic-PNG-placeholder-NOT-REAL-DECODE'));
 const output={sha256:createHash('sha256').update(normalizedBytes).digest('hex'),byteLength:normalizedBytes.length,mime:'image/png',width:80,height:120},artifact=C.createManagedApplicationNormalizationArtifact({intent,output}),claimedArtifact=C.createClaimedApplicationNormalizationArtifact({artifact,permissionId:'processing-'+id});
 const writeIntent=C.createManagedApplicationContentWriteIntent({claimedArtifact}),normalizedManifest=C.createManagedApplicationContentManifest({intent:writeIntent,claimedArtifact});
 const task=C.validateManagedApplicationStrictTask({schemaVersion:'design-normalized-strict-task-v2',taskId:'task-'+id,claimedArtifact,normalizedManifest,fixtureId:C.MANAGED_APPLICATION_DIRECT_POLICY.fixture.id,verifier:C.MANAGED_APPLICATION_DIRECT_VERIFIER,policy:C.MANAGED_APPLICATION_DIRECT_POLICY}),checks=Object.fromEntries(C.MANAGED_APPLICATION_DIRECT_CHECKS.map(k=>[k,'verified'])),report=C.createManagedApplicationStrictReport({task,checks}),binding=buildManagedApplicationViewInput({task,report}),input={taskId:task.taskId,task,report};
 return {scope:authority.scope,authority,sourceManifest,sourceBinding,intent,artifact,claimedArtifact,writeIntent,normalizedManifest,task,report,binding,input,historyInput:input,sourceBytes,normalizedBytes};
}
export function managedApplicationViewResultFixture({session,recordRevision=0,recordDigest,id='application-view-one',kind='managed_application_completion_comparison',angle='front',side='left',managedImageHistory,result,inputs,captures}={}){
 const base=managedContentManifestFixture(),authority=base.authority,scope=authority.scope;let s=session??createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'application-view-session'});
 if(!session)for(const phase of ['proposal','execution','completed_review'])s=appendDesignEvent(s,{scope:s.scope,requestId:'phase-'+phase,expectedRevision:s.revision,event:{type:'phase_advanced',phase}}).session;
 let evidenceBinding;
 if(kind==='managed_application_completion_comparison'){
  captures??=['before','after'].map(stage=>managedApplicationViewInputFixture({id:id+'-'+stage,stage,angle}));inputs??=captures.map(x=>x.input);evidenceBinding={angle,images:inputs.map(x=>buildManagedApplicationViewInput({task:x.task,report:x.report}))};result??={judgment:{comparability:'comparable',reason:null,change:'未见明确外观变化'}};
 }else{const built=buildManagedApplicationSynthesisEvidence({session:s,managedImageHistory,side});evidenceBinding=built.evidenceBinding;result??={reviewFocus:built.allowedReviewFocus[0]??null};inputs=[];}
 const local=evidenceBinding.generation==='deterministic',generation=local?'synthetic_deterministic':'synthetic_mock_model',requestId='generate-'+id,workflowBinding={recordRevision,recordDigest:recordDigest??digest({fixture:'application-view',recordRevision,session:s}),sessionId:s.scope.sessionId,sessionRevision:s.revision,sessionDigest:digest(s)},requestBinding={requestId,intentDigest:digest('intent-'+id),payloadSha256:digest('body-'+id),model:local?'server-deterministic':'synthetic-vision',promptVersion:local?'application-view-local-v1':'application-view-mock-v1',approvalReceiptId:local?null:'approval-'+id,ownerKey:policyOwnerKey(authority,requestId)};
 const context={session:s,workflowBinding,...(kind==='managed_application_completion_comparison'?{inputs}:{managedImageHistory})},candidateInput={id,kind,generation,authority,scope,workflowBinding,requestBinding,evidenceBinding,result,session:s,...(kind==='managed_application_completion_comparison'?{inputs}:{managedImageHistory})};
 return {...base,authority,scope,session:s,workflowBinding,requestBinding,evidenceBinding,result,inputs,captures,context,candidateInput,candidate:buildManagedApplicationViewResultCandidate(candidateInput)};
}
