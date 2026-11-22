/** Pure synthetic mixed-history replay. Does not grant current source access. */
import {managedApplicationHistoryFixture} from './managed-application-history.mjs';
import {managedApplicationViewResultFixture} from './managed-application-view-result.mjs';
import {applyTrustedManagedApplicationViewCandidate,buildManagedApplicationSynthesisEvidence} from '../../packages/analysis-engine/managed-application-view-result-candidate.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
export function managedApplicationViewHistoryFixture(){
 const h=managedApplicationHistoryFixture(),s=h.state;let serial=0;
 function accept(f){const requestId='adopt-'+f.candidate.id,out=applyTrustedManagedApplicationViewCandidate({...f.context,candidate:f.candidate,selectedIndices:[0],requestId});for(const input of f.inputs){const prior=s.managedImageHistory.inputs.find(x=>x.taskId===input.taskId);if(prior&&digest(prior)!==digest(input))throw Error('fixture input conflict');if(!prior)s.managedImageHistory.inputs.push(structuredClone(input));}s.session=out.session;s.workflowRevision++;s.managedImageHistory.schemaVersion='design-managed-image-history-v5';const row={candidate:f.candidate,acceptance:{requestId,workflowRevision:s.workflowRevision,authority:s.authority,receipt:out.acceptedReceipt}};s.managedImageHistory.accepted.push(structuredClone(row));return structuredClone(row);}
 function applicationCompare(angle='front',judgment={comparability:'comparable',reason:null,change:'未见明确外观变化'}){h.phases();const id='application-compare-'+(++serial);return accept(managedApplicationViewResultFixture({session:s.session,recordRevision:s.workflowRevision,id,angle,result:{judgment}}));}
 function applicationSynthesize(side='left',select=0){const history=structuredClone(s.managedImageHistory),built=buildManagedApplicationSynthesisEvidence({session:s.session,managedImageHistory:history,side});return accept(managedApplicationViewResultFixture({session:s.session,recordRevision:s.workflowRevision,id:'application-synthesis-'+(++serial),kind:'managed_application_completion_synthesis',side,managedImageHistory:history,result:{reviewFocus:built.allowedReviewFocus[select]??null}}));}
 return {...h,applicationCompare,applicationSynthesize};
}
