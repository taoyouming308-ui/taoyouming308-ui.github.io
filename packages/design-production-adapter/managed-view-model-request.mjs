/** Server-only v5 preparation. Returned body must never reach browser/log/storage.
 * Pair budget is aggregate 1MiB; oversized pairs are rejected, never reprocessed.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {managedImageCanonical,managedImageDigest,createManagedImageCandidate} from './managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from './managed-image-verification.mjs';
import {validateManagedImageModelTransportRequest,MANAGED_IMAGE_MODEL_ENDPOINT} from './managed-image-model-request.mjs';
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {buildManagedViewModelPrompt} from '../prompts/managed-view-model.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function own(v){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)throw 0;const out={};for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))throw 0;out[k]=d.value;}return out;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function byteCopy(v){if(types.isProxy(v)||!types.isUint8Array(v))throw 0;const b=get('buffer').call(v),n=get('byteLength').call(v);if(types.isSharedArrayBuffer(b)||n<1||n>524288)throw 0;return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
const fail=()=>{throw new Error('MANAGED_VIEW_MODEL_NOT_PREPARED');};
const purposes={managed_before_view:'managed_before_view_candidates_for_employee_review',managed_completion_comparison:'managed_completion_comparison_for_employee_review',managed_completion_synthesis:'managed_completion_synthesis_for_employee_review'};
export function managedViewLocalPayload(candidateKind,evidenceBinding,allowedReviewFocus){if(candidateKind!=='managed_completion_synthesis'||!Array.isArray(allowedReviewFocus)||allowedReviewFocus.length>1)fail();return managedImageCanonical({candidateKind,evidenceBinding,result:{reviewFocus:allowedReviewFocus[0]??null}});}
export function createManagedViewModelRequestPreparer({enabled=false,modelConfig,approvedModels,readVerifiedInput,verifyCurrentEvidence}={}){
 let config;try{config=freeze(copyManagedResultData({modelConfig:modelConfig??null,approvedModels:approvedModels??[]}));}catch{}
 return Object.freeze({async prepare(input,trustedContext){const owned=[];try{
 if(enabled!==true||!config||typeof verifyCurrentEvidence!=='function')fail();
 const q=freeze(copyManagedResultData(input)),c=freeze(copyManagedResultData(trustedContext));
 if(Object.keys(q).filter(k=>k!=='expectedWorkflowRevision').sort().join('|')!=='candidateKind|credential|requestId|scope|selectors'||typeof q.credential!=='string'||q.credential.length<32||q.credential.length>4096||!Object.hasOwn(purposes,q.candidateKind)||typeof q.requestId!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(q.requestId)||!same(q.scope,c.authority.scope))fail();
 const evidence=c.evidenceBinding,local=q.candidateKind==='managed_completion_synthesis'&&evidence.generation==='deterministic',choices=c.allowedReviewFocus;
 let body,promptVersion,model,maxOutputTokens,transportRequest=null;
 if(local){body=managedViewLocalPayload(q.candidateKind,evidence,choices);promptVersion='managed-synthesis-deterministic-v1';model='server-deterministic';maxOutputTokens=0;}
 else{
 const m=config.modelConfig;if(!m||Object.keys(m).sort().join()!=='maxOutputTokens,model'||typeof m.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(m.model)||!config.approvedModels.includes(m.model)||m.model==='server-deterministic'||!Number.isSafeInteger(m.maxOutputTokens)||m.maxOutputTokens<1||m.maxOutputTokens>8192)fail();
 model=m.model;maxOutputTokens=m.maxOutputTokens;const prompt=buildManagedViewModelPrompt(q.candidateKind,{angle:evidence.angle,evidenceBinding:evidence,allowedReviewFocus:choices});promptVersion=prompt.promptVersion;const content=[{type:'text',text:prompt.text}];
 if(q.candidateKind!=='managed_completion_synthesis'){
 if(typeof readVerifiedInput!=='function'||!Array.isArray(evidence.images)||evidence.images.length!==(q.candidateKind==='managed_before_view'?1:2))fail();
 const ids=q.candidateKind==='managed_before_view'?[q.selectors.taskId]:[q.selectors.beforeTaskId,q.selectors.afterTaskId];if(new Set(ids).size!==ids.length)fail();
 for(let i=0;i<ids.length;i++){
 const raw=own(await readVerifiedInput({credential:q.credential,scope:q.scope,taskId:ids[i]}));
 const metadata=copyManagedResultData({sourceRecord:raw.sourceRecord,response:raw.response,objectReceipt:raw.objectReceipt,verificationReport:raw.verificationReport});
 const {sourceRecord,response}=metadata,objectReceipt=validateManagedDerivedObjectReceipt(metadata.objectReceipt,{sourceRecord,response}),report=validateManagedImageVerificationReport(metadata.verificationReport,{sourceRecord,response,objectReceipt}),candidate=createManagedImageCandidate({sourceRecord,response,evidence:report.evidence});
 const binding={taskId:ids[i],candidateDigest:managedImageDigest(candidate),objectReceiptDigest:managedImageDigest(objectReceipt),verificationReportDigest:managedImageDigest(report),authority:sourceRecord.owner,sourceRecordDigest:managedImageDigest(sourceRecord),responseDigest:managedImageDigest(response),evidenceDigest:managedImageDigest(report.evidence),sourceObject:sourceRecord.object,derivativeObject:objectReceipt.object,sourceSha256:sourceRecord.source.sha256,derivativeSha256:objectReceipt.derivative.sha256,mime:objectReceipt.derivative.mime,byteLength:objectReceipt.derivative.byteLength,maxEdge:candidate.budget.maxEdge,stage:sourceRecord.stage,angle:sourceRecord.angle};
 if(report.state!=='evidence_complete'||binding.stage!==(i===0?'before':'after')||binding.angle!==evidence.angle||!same(binding,evidence.images[i])||!same(binding.authority,c.authority))fail();
 const bytes=byteCopy(raw.bytes);owned.push(bytes);
 if(!bytes.length||bytes.length!==binding.byteLength||bytes.length>candidate.budget.maximumBytes||hash(bytes)!==binding.derivativeSha256)fail();content.push({type:'image_url',image_url:{url:'data:'+binding.mime+';base64,'+bytes.toString('base64')}});
 }
 }
 body=JSON.stringify({model,messages:[{role:'system',content:prompt.system},{role:'user',content}],max_tokens:maxOutputTokens,response_format:{type:'json_object'},stream:false});
 transportRequest=validateManagedImageModelTransportRequest({schemaVersion:'design-managed-image-model-transport-v1',url:MANAGED_IMAGE_MODEL_ENDPOINT,method:'POST',redirect:'error',credentials:'omit',body,byteLength:Buffer.byteLength(body),payloadSha256:hash(body),dispatchAuthorized:false});
 }
 const result=freeze({schemaVersion:'design-managed-view-model-prepared-v1',state:'prepared_not_dispatched',intent:{schemaVersion:'design-managed-view-model-intent-v1',requestId:q.requestId,authority:c.authority,scope:q.scope,recipient:local?'local':MANAGED_IMAGE_MODEL_ENDPOINT,purpose:purposes[q.candidateKind],model,maxOutputTokens,promptVersion,payloadSha256:hash(body),byteLength:Buffer.byteLength(body),candidateKind:q.candidateKind,evidenceBinding:evidence},transportRequest,submissionAuthorized:false,adoptionAuthorized:false});
 // One composite fresh capability, after ALL reads, binds every image/ancestor.
 if(await verifyCurrentEvidence({credential:q.credential,scope:q.scope,requestId:q.requestId,context:c})!==true)fail();return result;
 }catch{fail();}finally{owned.forEach(b=>b.fill(0));}}});
}
