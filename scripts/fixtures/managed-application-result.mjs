/** Pure synthetic structure only, never actual issuer/model evidence. */
import {managedApplicationImageFixture} from './managed-application-image.mjs';
import {createDesignSession} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
import {policyOwnerKey} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {buildManagedApplicationResultCandidate} from '../../packages/analysis-engine/managed-application-result-candidate.mjs';
export function managedApplicationResultFixture({session,recordRevision=0,recordDigest,id='application-result-one',requestId='application-generation-one',observations=[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:'中长发轮廓'}],base=managedApplicationImageFixture()}={}){
 const {task,report,authority,scope}=base,input={task,report};
 session??=createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'application-result-session'});
 const workflowBinding={recordRevision,recordDigest:recordDigest??digest({fixture:'application-result',recordRevision,session}),sessionId:session.scope.sessionId,sessionRevision:session.revision,sessionDigest:digest(session)};
 const requestBinding={requestId,intentDigest:digest('synthetic-intent-'+requestId),payloadSha256:digest('synthetic-payload-'+requestId),model:'synthetic-vision',promptVersion:'managed-application-before-v1',approvalReceiptId:'synthetic-application-approval-'+requestId,ownerKey:policyOwnerKey(authority,requestId)},applicationBinding={promptVersion:requestBinding.promptVersion,input:base.input};
 const candidateInput={id,authority,scope,workflowBinding,requestBinding,applicationBinding,session,observations,input},candidate=buildManagedApplicationResultCandidate(candidateInput);
 return {...base,task,report,input,historyInput:{taskId:task.taskId,...input},authority,scope,session,workflowBinding,requestBinding,applicationBinding,candidateInput,candidate};
}
