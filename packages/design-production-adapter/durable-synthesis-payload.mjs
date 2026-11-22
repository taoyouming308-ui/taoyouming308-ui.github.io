/** Pure lease/record consistency and synthesis material, not a worker authority grant.
 * Fresh SQL must prove the entire lease, manifest, key/config, cost receipt, expiry,
 * fence and ancestors. This module cannot establish any of those live facts.
 */
import {types} from 'node:util';
import {validateDurableLease,DurableSynthesisError} from './durable-synthesis-contracts.mjs';
import {policyCopy,policyEqual,policyDigest,policyOwnerKey,policyFreeze} from './approval-attempt-contracts.mjs';
import {validatePreparedWorkflowRecord} from './prepared-workflow-service.mjs';
import {buildSynthesisEvidence} from '../analysis-engine/design-candidate.mjs';
import {buildSynthesisCandidatePayload} from './synthesis-candidate-payload.mjs';
const deny=()=>{throw new DurableSynthesisError('DURABLE_RESULT_INVALID');};
function own(value,names){if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==names.length)deny();const result={};for(const name of names){const d=Object.getOwnPropertyDescriptor(value,name);if(!d?.enumerable||!Object.hasOwn(d,'value'))deny();result[name]=d.value;}return result;}
export function prepareDurableSynthesisPayload(input,options={}){
 try{
  const values=own(input,['lease','record']),lease=validateDurableLease(values.lease);if(!lease)deny();
  const config=policyCopy(options);if(Object.keys(config).some(k=>!['modelConfig','approvedTextModels'].includes(k)))deny();
  const {intent,authority}=lease,scope=authority.scope,record=validatePreparedWorkflowRecord(values.record,scope);
  if(lease.operationId!==policyOwnerKey(authority,intent.requestId)||record.store!==authority.actor.store||record.session.phase!=='completed_review')deny();
  const source=intent.sourceBinding;
  if(source.workflowRevision!==record.revision||source.workflowSha256!==policyDigest(record)||source.sessionId!==record.session.scope.sessionId||source.sessionRevision!==record.session.revision||source.sessionDigest!==policyDigest(record.session))deny();
  const evidence=buildSynthesisEvidence({session:record.session,modelCandidates:record.modelCandidates||[],side:intent.evidenceBinding.synthesis.side});
  if(!policyEqual(intent.evidenceBinding,{sourceRefs:evidence.sourceRefs,comparison:null,synthesis:evidence.synthesis})||!policyEqual(intent.sourceRefs,evidence.sourceRefs))deny();
  if(intent.kind==='external'){
   const owner=Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(k=>[k,authority[k]]));
   if(!policyEqual(intent.keyBinding.owner,owner)||intent.keyBinding.securityEpoch!==authority.securityEpoch||intent.keyBinding.membershipRevision!==authority.membershipRevision)deny();
  }
  const payload=buildSynthesisCandidatePayload({scope,actor:authority.actor,requestId:intent.requestId,session:record.session,modelCandidates:record.modelCandidates||[],...evidence,modelConfig:config.modelConfig,approvedTextModels:config.approvedTextModels||[]});
  if(intent.kind!==payload.kind||intent.destination!==payload.destination||intent.model!==payload.model||intent.payloadSha256!==payload.payloadSha256||intent.byteLength!==payload.byteLength||intent.inputDigest!==payload.inputDigest||intent.maxOutputTokens!==(payload.kind==='local'?0:config.modelConfig.maxTokens))deny();
  function validateCandidate(raw){try{return payload.validateCandidate(policyCopy(raw),{exactEnvelope:true});}catch{deny();}}
  function parse(raw){try{return validateCandidate(payload.parse(policyCopy(raw)));}catch{deny();}}
  return policyFreeze({kind:payload.kind,destination:payload.destination,model:payload.model,body:payload.body,payloadSha256:payload.payloadSha256,byteLength:payload.byteLength,localCandidate:payload.localCandidate,parse,validateCandidate});
 }catch{deny();}
}
