/** Mixed-history protocol fixtures only. No current authorization/issuer proof. */
import {managedViewHistoryFixture} from './managed-view-history.mjs';
import {managedNormalizedResultFixture} from './managed-normalized-result.mjs';
import {applyTrustedManagedNormalizedCandidate} from '../../packages/analysis-engine/managed-normalized-result-candidate.mjs';
import {buildManagedViewResultCandidate,applyTrustedManagedViewCandidate,buildManagedSynthesisEvidence} from '../../packages/analysis-engine/managed-view-result-candidate.mjs';
import {managedNormalizedLegacyHistory} from '../../packages/analysis-engine/managed-normalized-result-history.mjs';
import {appendDesignEvent} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
const copy=structuredClone;
export function managedNormalizedHistoryFixture(){
 const h=managedViewHistoryFixture(),s=h.state;let serial=0;
 function normalized({id='normalized-history-'+(++serial),selectedIndices=[0,1]}={}){
  const f=managedNormalizedResultFixture({session:s.session,recordRevision:s.workflowRevision,id,requestId:'generate-'+id}),requestId='adopt-'+id,out=applyTrustedManagedNormalizedCandidate({session:s.session,candidate:f.candidate,workflowBinding:f.workflowBinding,selectedIndices,requestId,input:f.input});
  const prior=s.managedImageHistory.inputs.find(i=>i.taskId===f.historyInput.taskId);if(prior&&digest(prior)!==digest(f.historyInput))throw Error('fixture task reused');if(!prior)s.managedImageHistory.inputs.push(copy(f.historyInput));
  s.session=out.session;s.workflowRevision++;s.managedImageHistory.schemaVersion='design-managed-image-history-v3';const row={candidate:f.candidate,acceptance:{requestId,workflowRevision:s.workflowRevision,authority:s.authority,receipt:out.acceptedReceipt}};s.managedImageHistory.accepted.push(copy(row));return copy(row);
 }
 function reopen(){const event={type:'revision_opened',parentArchiveRevision:s.archives.at(-1).revision,resumePhase:'completed_review',reasonSource:{messageId:'normalized-reopen-reason-'+serial,kind:'text',actor:'employee',text:'合成演练复核，保留原记录'}};s.session=appendDesignEvent(s.session,{scope:s.session.scope,requestId:'reopen-normalized-'+(++serial),expectedRevision:s.session.revision,event}).session;s.workflowRevision++;}
 function synthesize(side='left'){
  const managedImageHistory=s.managedImageHistory.schemaVersion==='design-managed-image-history-v3'?managedNormalizedLegacyHistory(s.managedImageHistory):copy(s.managedImageHistory),built=buildManagedSynthesisEvidence({session:s.session,managedImageHistory,side}),id='mixed-synthesis-'+(++serial),requestId='accept-'+id,workflowBinding={recordRevision:s.workflowRevision,recordDigest:digest({fixture:'mixed-synthesis',session:s.session,revision:s.workflowRevision}),sessionId:s.session.scope.sessionId,sessionRevision:s.session.revision,sessionDigest:digest(s.session)};
  const context={session:s.session,workflowBinding,managedImageHistory},candidate=buildManagedViewResultCandidate({...context,id,kind:'managed_completion_synthesis',authority:s.authority,scope:s.scope,requestBinding:{requestId:'generate-'+id,intentDigest:digest('intent-'+id),payloadSha256:digest('payload-'+id),model:built.evidenceBinding.generation==='deterministic'?'server-deterministic':'synthetic-vision',promptVersion:'synthetic-views-v1'},evidenceBinding:built.evidenceBinding,result:{reviewFocus:built.allowedReviewFocus[0]??null}}),out=applyTrustedManagedViewCandidate({...context,candidate,selectedIndices:[0],requestId});
  s.session=out.session;s.workflowRevision++;const row={candidate,acceptance:{requestId,workflowRevision:s.workflowRevision,authority:s.authority,receipt:out.acceptedReceipt}};s.managedImageHistory.accepted.push(copy(row));return copy(row);
 }
 return {...h,normalized,reopen,synthesize};
}
