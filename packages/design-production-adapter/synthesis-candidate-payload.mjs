/** Pure synthesis material shared by synchronous provider and durable worker.
 * Inputs are server-validated context/evidence. No authority, clock, ledger or I/O.
 */
import {Buffer} from 'node:buffer';
import {DesignProviderError,DEEPSEEK_CHAT_ENDPOINT,providerDigest} from './provider-adapter.mjs';
import {DESIGN_CANDIDATE_SCHEMA,designCandidateDigest,validateDesignCandidate,validateSynthesisEvidence,buildSynthesisCandidateParts,designSynthesisReviewChoices} from '../analysis-engine/design-candidate.mjs';
import {buildDesignCompletionSynthesisPrompt} from '../prompts/design-completion-synthesis.mjs';
const clone=structuredClone;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>designCandidateDigest(a)===designCandidateDigest(b);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const fail=code=>{throw new DesignProviderError(code);};
/** The existing strict completion parser. Transport bounds/URL/key redaction remain upstream. */
export function synthesisChatContent(raw,model){
 if(!plain(raw)||raw.object!=='chat.completion'||raw.model!==model||typeof raw.id!=='string'||raw.id.length<1||raw.id.length>160||!Number.isSafeInteger(raw.created)||raw.created<0||!Array.isArray(raw.choices)||raw.choices.length!==1)fail('INVALID_PROVIDER_RESPONSE');
 const choice=raw.choices[0],message=choice?.message;
 if(!plain(choice)||choice.index!==0||choice.finish_reason!=='stop'||!plain(message)||message.role!=='assistant'||typeof message.content!=='string'||!message.content.trim()||message.content.length>100000||message.refusal||(message.tool_calls!=null&&(!Array.isArray(message.tool_calls)||message.tool_calls.length))||(message.server_tool_calls!=null&&(!Array.isArray(message.server_tool_calls)||message.server_tool_calls.length)))fail('INVALID_PROVIDER_RESPONSE');
 return message.content;
}
export function buildSynthesisCandidatePayload({scope,actor,requestId,session,modelCandidates,synthesis,sourceRefs,modelConfig,approvedTextModels=[]}){
 // Snapshot these pure inputs once; the caller still performs every live gate.
 const context=freeze(clone({scope,actor,requestId,session,modelCandidates,synthesis,sourceRefs}));
 ({scope,actor,requestId,session,modelCandidates,synthesis,sourceRefs}=context);
 const local=synthesis.generation==='deterministic',prompt=buildDesignCompletionSynthesisPrompt(synthesis);
 if(!local&&(!plain(modelConfig)||Object.keys(modelConfig).sort().join('|')!=='approved|maxTokens|model'||modelConfig.approved!==true||typeof modelConfig.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(modelConfig.model)||modelConfig.model==='server-deterministic'||!Number.isSafeInteger(modelConfig.maxTokens)||modelConfig.maxTokens<1||modelConfig.maxTokens>8192||!Array.isArray(approvedTextModels)||!approvedTextModels.includes(modelConfig.model)))fail('MODEL_NOT_APPROVED');
 const model=local?'server-deterministic':modelConfig.model,body=local?JSON.stringify(prompt.messages):JSON.stringify({model,messages:prompt.messages,max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
 const byteLength=Buffer.byteLength(body);if(!local&&byteLength>196608)fail('INVALID_CONTEXT');
 const payloadSha256=providerDigest(body),inputDigest=designCandidateDigest(session),id=designCandidateDigest([actor,requestId,'completion_synthesis']),promptVersion=local?'design-synthesis-deterministic-v1':prompt.promptVersion;
 function envelope(selected){return validateDesignCandidate({schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind:'completion_synthesis',scope,store:actor.store,actor,sessionId:session.scope.sessionId,baseRevision:session.revision,inputDigest,payloadDigest:payloadSha256,model,promptVersion,sourceRefs,synthesis:selected,...buildSynthesisCandidateParts({id,session,synthesis:selected})},session);}
 function validateCandidate(candidate,{exactEnvelope=false}={}){const checked=validateDesignCandidate(candidate,session);validateSynthesisEvidence({candidate:checked,session,modelCandidates});if(checked.id!==id||checked.kind!=='completion_synthesis'||checked.payloadDigest!==payloadSha256||!same(checked.actor,actor))fail('INVALID_RESULT');if(exactEnvelope){if(!local&&!designSynthesisReviewChoices(synthesis).some(f=>same(f,checked.synthesis.reviewFocus)))fail('INVALID_RESULT');const expected=envelope(local?synthesis:{...clone(synthesis),reviewFocus:clone(checked.synthesis.reviewFocus)});if(!same(checked,expected))fail('INVALID_RESULT');}return checked;}
 function parse(raw){if(local)fail('INVALID_RESULT');let output;try{output=JSON.parse(synthesisChatContent(raw,model));if(!plain(output)||Object.keys(output).sort().join('|')!=='reviewFocus')fail('INVALID_RESULT');}catch{fail('INVALID_RESULT');}
  if(!designSynthesisReviewChoices(synthesis).some(f=>same(f,output.reviewFocus)))fail('INVALID_RESULT');return envelope({...clone(synthesis),reviewFocus:clone(output.reviewFocus)});
 }
 return freeze({kind:local?'local':'external',destination:local?'local':DEEPSEEK_CHAT_ENDPOINT,model,body,byteLength,payloadSha256,inputDigest,candidateId:id,promptVersion,sourceRefs,synthesis,localCandidate:local?envelope(synthesis):null,parse,validateCandidate});
}
