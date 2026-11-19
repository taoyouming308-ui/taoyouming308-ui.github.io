/** Pure protocol fixture, NOT real decoder/issuer/model qualification. */
import {canonicalVerificationPureFixture,canonicalBinaryResult} from './canonical-verification-pure.mjs';
import {buildManagedNormalizedStrictReport,buildManagedNormalizedStrictInput} from '../../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {createDesignSession} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
import {policyOwnerKey} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {buildManagedNormalizedResultCandidate} from '../../packages/analysis-engine/managed-normalized-result-candidate.mjs';
export function managedNormalizedResultFixture({session,recordRevision=0,recordDigest,id='normalized-result-one',requestId='normalized-generation-one',observations=[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:'中长发轮廓'}]}={}){
 const base=canonicalVerificationPureFixture(),task=base.task,report=buildManagedNormalizedStrictReport({task,binaryResult:canonicalBinaryResult(task)}),input={task,report},authority=task.claimedArtifact.artifact.sourceRecord.owner,scope=authority.scope;
 session??=createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'normalized-result-session'});
 const workflowBinding={recordRevision,recordDigest:recordDigest??digest({fixture:'normalized-result',recordRevision,session}),sessionId:session.scope.sessionId,sessionRevision:session.revision,sessionDigest:digest(session)};
 const requestBinding={requestId,intentDigest:digest('synthetic-intent-'+requestId),payloadSha256:digest('synthetic-payload-'+requestId),model:'synthetic-vision',promptVersion:'managed-normalized-before-v1',approvalReceiptId:'synthetic-normalized-approval-'+requestId,ownerKey:policyOwnerKey(authority,requestId)},normalizedBinding={promptVersion:requestBinding.promptVersion,input:buildManagedNormalizedStrictInput(input)};
 const candidateInput={id,authority,scope,workflowBinding,requestBinding,normalizedBinding,session,observations,input},candidate=buildManagedNormalizedResultCandidate(candidateInput);
 return {...base,task,report,input,historyInput:{taskId:task.taskId,...input},authority,scope,session,workflowBinding,requestBinding,normalizedBinding,candidateInput,candidate};
}
