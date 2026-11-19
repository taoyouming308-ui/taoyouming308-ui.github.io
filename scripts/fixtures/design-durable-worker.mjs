/** Synthetic pure worker fixture; no authorization, key material, PG or network. */
import {Buffer} from 'node:buffer';
import {syntheticSynthesisWorkflow,syntheticSynthesisScope as scope,syntheticSynthesisActor as actor} from './design-synthesis.mjs';
import {buildSynthesisEvidence,designSynthesisReviewChoices} from '../../packages/analysis-engine/design-candidate.mjs';
import {buildDesignCompletionSynthesisPrompt} from '../../packages/prompts/design-completion-synthesis.mjs';
import {policyDigest,policyOwnerKey,validatePolicyIntent} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {validatePreparedWorkflowRecord} from '../../packages/design-production-adapter/prepared-workflow-service.mjs';
import {providerDigest,DEEPSEEK_CHAT_ENDPOINT} from '../../packages/design-production-adapter/provider-adapter.mjs';
export function syntheticDurableWorkerFixture({local=false}={}){
 const record=validatePreparedWorkflowRecord({schemaVersion:'design-prepared-workflow-record-v2',revision:10,...syntheticSynthesisWorkflow(local?[{angle:'front',confirmed:true}]:undefined),archives:[],legacyVersions:[]},scope);
 const authority={schemaVersion:'design-immutable-authority-v1',subjectId:'synthetic-subject',employmentId:'synthetic-employment',membershipId:'synthetic-membership',securityEpoch:1,membershipRevision:1,storeId:'synthetic-store-id',actor,scope,bindingRevision:'synthetic-binding'};
 const requestId='synthetic-worker-request',modelConfig={approved:true,model:'synthetic-approved-text',maxTokens:512},approvedTextModels=[modelConfig.model];
 const evidence=buildSynthesisEvidence({session:record.session,modelCandidates:record.modelCandidates,side:'left'}),messages=buildDesignCompletionSynthesisPrompt(evidence.synthesis).messages;
 const body=local?JSON.stringify(messages):JSON.stringify({model:modelConfig.model,messages,max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
 const keyBinding=local?null:{owner:Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(k=>[k,authority[k]])),securityEpoch:1,membershipRevision:1,purpose:'chat',revision:1,destination:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,keyDigest:Buffer.alloc(32,7).toString('base64')};
 const intent=validatePolicyIntent({schemaVersion:'design-provider-intent-v3',requestId,candidateKind:'completion_synthesis',kind:local?'local':'external',operation:local?'server_synthesis':'analyze',destination:local?'local':DEEPSEEK_CHAT_ENDPOINT,model:local?'server-deterministic':modelConfig.model,payloadSha256:providerDigest(body),byteLength:Buffer.byteLength(body),dataKinds:['accepted_angle_ai_judgments_no_images'],purpose:'accepted_angle_ai_judgment_synthesis',inputDigest:policyDigest(record.session),sourceRefs:evidence.sourceRefs,maxOutputTokens:local?0:modelConfig.maxTokens,cost:local?null:{currency:'USD',maximumMinorUnits:2,commitment:'one_time'},keyBinding,sourceBinding:{workflowRevision:record.revision,workflowSha256:policyDigest(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:policyDigest(record.session),manifestId:'synthetic-manifest',manifestFingerprint:'e'.repeat(64)},evidenceBinding:{sourceRefs:evidence.sourceRefs,comparison:null,synthesis:evidence.synthesis}});
 const lease={operationId:policyOwnerKey(authority,requestId),fence:1,leaseExpiresAt:Date.now()+600000,authority,intent};
 const rawResponse={id:'synthetic-response',object:'chat.completion',model:modelConfig.model,created:1,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({reviewFocus:designSynthesisReviewChoices(evidence.synthesis).at(-1)})}}]};
 return structuredClone({lease,record,modelConfig,approvedTextModels,rawResponse});
}
