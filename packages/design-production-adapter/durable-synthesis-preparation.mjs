/** Exact server-side enqueue preparation. No provider, key opening, or approval issuance. */
import {buildSynthesisEvidence} from '../analysis-engine/design-candidate.mjs';
import {buildDesignCompletionSynthesisPrompt} from '../prompts/design-completion-synthesis.mjs';
import {policyCopy,policyExact,policyEqual,policyFreeze,policyDigest,validatePolicyIntent} from './approval-attempt-contracts.mjs';
import {DEEPSEEK_CHAT_ENDPOINT,providerDigest} from './provider-adapter.mjs';
import {ImmutableDependencyError} from './immutable-dependency-repository.mjs';
const deny=()=>{throw new ImmutableDependencyError('IMMUTABLE_DEPENDENCY_DENIED');};
/** The repository must atomically revalidate/import the independently issued approval,
 * reserve the existing ledger, and enqueue. This preparation alone grants nothing. */
export function createDurableSynthesisPreparation({enabled=false,prepareGeneration,verifySynthesisAncestors,access,repository,modelConfig,approvedTextModels=[],clock=()=>Date.now()}={}){
 return Object.freeze({async enqueue(input){
  if(enabled!==true||typeof prepareGeneration!=='function'||typeof verifySynthesisAncestors!=='function'||typeof access?.readCandidateContext!=='function'||typeof access?.readApproval!=='function'||typeof repository?.enqueue!=='function')deny();
  const request=policyCopy(input);policyExact(request,['credential','scope','requestId','side']);
  if(!['left','right'].includes(request.side)||typeof request.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(request.requestId))deny();
  const initial=await prepareGeneration(request),record=initial.record;
  const evidence=buildSynthesisEvidence({session:record.session,modelCandidates:record.modelCandidates||[],side:request.side});
  if(await verifySynthesisAncestors({credential:request.credential,scope:request.scope,actor:initial.authority.actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:policyDigest(record.session),...evidence})!==true)deny();
  const evidenceBinding=policyFreeze({sourceRefs:evidence.sourceRefs,comparison:null,synthesis:evidence.synthesis});
  const local=evidence.synthesis.generation==='deterministic';
  if(!local&&!(modelConfig?.approved===true&&typeof modelConfig.model==='string'&&Array.isArray(approvedTextModels)&&approvedTextModels.includes(modelConfig.model)&&Number.isSafeInteger(modelConfig.maxTokens)&&modelConfig.maxTokens>0&&modelConfig.maxTokens<=8192))deny();
  const base={credential:request.credential,scope:request.scope,requestId:request.requestId};
  const context=await access.readCandidateContext({...base,candidateKind:'completion_synthesis',mode:local?'local':'external',evidenceBinding});
  if(!policyEqual(context.authority,initial.authority)||!policyEqual(context.evidenceBinding,evidenceBinding)||context.sourceBinding.sessionDigest!==policyDigest(record.session)||context.sourceBinding.sessionRevision!==record.session.revision||context.sourceBinding.workflowRevision!==record.revision)deny();
  const messages=buildDesignCompletionSynthesisPrompt(evidence.synthesis).messages;
  const body=local?JSON.stringify(messages):JSON.stringify({model:modelConfig.model,messages,max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
  // Amount originates only in the independently issued exact receipt, not client fields.
  let receipt=null;
  if(!local){receipt=await access.readApproval(base);const now=clock();if(!Number.isSafeInteger(now)||!Number.isSafeInteger(receipt?.issuedAt)||!Number.isSafeInteger(receipt?.expiresAt)||receipt.issuedAt>now||receipt.expiresAt<=now||receipt.expiresAt-receipt.issuedAt>900000||!policyEqual(receipt.authority,initial.authority))deny();}
  const intent=validatePolicyIntent({schemaVersion:'design-provider-intent-v3',requestId:request.requestId,candidateKind:'completion_synthesis',kind:local?'local':'external',operation:local?'server_synthesis':'analyze',destination:local?'local':DEEPSEEK_CHAT_ENDPOINT,model:local?'server-deterministic':modelConfig.model,payloadSha256:providerDigest(body),byteLength:Buffer.byteLength(body),dataKinds:['accepted_angle_ai_judgments_no_images'],purpose:'accepted_angle_ai_judgment_synthesis',inputDigest:context.sourceBinding.sessionDigest,sourceRefs:evidence.sourceRefs,maxOutputTokens:local?0:modelConfig.maxTokens,cost:local?null:receipt.intent.cost,keyBinding:context.keyBinding,sourceBinding:context.sourceBinding,evidenceBinding});
  if(!local&&!policyEqual(receipt.intent,intent))deny();
  const latest=await prepareGeneration(request);
  if(!policyEqual(latest.authority,initial.authority)||!policyEqual(latest.record,record))deny();
  return repository.enqueue({...base,side:request.side,intent});
 }});
}
