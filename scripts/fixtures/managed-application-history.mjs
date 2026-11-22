/** Pure mixed replay fixture, no current repository/issuer authorization. */
import {managedNormalizedHistoryFixture} from './managed-normalized-history.mjs';
import {managedApplicationResultFixture} from './managed-application-result.mjs';
import {applyTrustedManagedApplicationCandidate} from '../../packages/analysis-engine/managed-application-result-candidate.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
export function managedApplicationHistoryFixture(){
 const h=managedNormalizedHistoryFixture(),s=h.state;let serial=0;
 function application({id='application-history-'+(++serial),selectedIndices=[0,1]}={}){
  const f=managedApplicationResultFixture({session:s.session,recordRevision:s.workflowRevision,id,requestId:'generate-'+id}),requestId='adopt-'+id,out=applyTrustedManagedApplicationCandidate({session:s.session,candidate:f.candidate,workflowBinding:f.workflowBinding,selectedIndices,requestId,input:f.input});
  const prior=s.managedImageHistory.inputs.find(i=>i.taskId===f.historyInput.taskId);if(prior&&digest(prior)!==digest(f.historyInput))throw Error('fixture input conflict');if(!prior)s.managedImageHistory.inputs.push(structuredClone(f.historyInput));
  s.session=out.session;s.workflowRevision++;s.managedImageHistory.schemaVersion='design-managed-image-history-v4';const row={candidate:f.candidate,acceptance:{requestId,workflowRevision:s.workflowRevision,authority:s.authority,receipt:out.acceptedReceipt}};s.managedImageHistory.accepted.push(structuredClone(row));return structuredClone(row);
 }
 return {...h,application};
}
