/** Server-memory PREPARATION ONLY. Never serialize this result to a browser or
 * log its body. No transport, key resolver, approval issuer or dispatch exists.
 * The new body budget does not widen the old v3/196608-byte transport contract.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {managedImageCanonical,managedImageDigest,createManagedImageCandidate} from './managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from './managed-image-verification.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {buildDesignImagePrompt} from '../prompts/design-image.mjs';
export const MANAGED_IMAGE_MODEL_MAX_BODY_BYTES=1048576;
export const MANAGED_IMAGE_MODEL_ENDPOINT='https://api.deepseek.com/chat/completions';
const PURPOSE='managed_before_image_candidates_for_employee_review';
export class ManagedImageModelRequestError extends Error{constructor(){super('MANAGED_IMAGE_MODEL_NOT_PREPARED');this.code=this.message;this.outcome='not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedImageModelRequestError();};
const copy=x=>JSON.parse(managedImageCanonical(x)),hash=x=>createHash('sha256').update(x).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
function own(v,keys){if(types.isProxy(v)||!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const names=Reflect.ownKeys(v);if(names.length!==keys.length||names.some(k=>!keys.includes(k)))fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function bytesCopy(v){if(types.isProxy(v)||!types.isUint8Array(v))fail();const buffer=get('buffer').call(v),size=get('byteLength').call(v);if(types.isSharedArrayBuffer(buffer)||size<1||size>524288)fail();return Buffer.from(new Uint8Array(buffer,get('byteOffset').call(v),size));}
/** Pure shape/budget preparation contract, NOT permission to send. No headers or
 * bearer are accepted. A future independent dispatcher must bind its exact body
 * to current v4 data/cost approval, key revision and one-shot durable claim. */
export function validateManagedImageModelTransportRequest(value){try{const v=own(value,['schemaVersion','url','method','redirect','credentials','body','byteLength','payloadSha256','dispatchAuthorized']);if(v.schemaVersion!=='design-managed-image-model-transport-v1'||v.url!==MANAGED_IMAGE_MODEL_ENDPOINT||v.method!=='POST'||v.redirect!=='error'||v.credentials!=='omit'||v.dispatchAuthorized!==false||typeof v.body!=='string'||v.body.length>MANAGED_IMAGE_MODEL_MAX_BODY_BYTES||Buffer.byteLength(v.body)>MANAGED_IMAGE_MODEL_MAX_BODY_BYTES||v.byteLength!==Buffer.byteLength(v.body)||v.payloadSha256!==hash(v.body))fail();return freeze({...v});}catch{fail();}}
/** readVerifiedInput is a server-owned composition, not a browser callback:
 * fixed ledger.readVerifiedInput({credential,scope,taskId}) -> private immutable
 * object read -> full hash check -> fresh equal ledger read. Its result is the
 * four ledger metadata fields plus bytes. verifyCurrentInput must freshly check
 * that same task's independent issuer record, expiry/revocation, full authority,
 * original/preflight/processing/cost/claim and object/version/evidence binding.
 * Returning a structurally valid report alone is NEVER sufficient. Production
 * composition of these capabilities is deliberately not provided by this module.
 * No raw image body is delivered to an HTTP caller. JS strings cannot be securely
 * erased; callers must bound lifetime, avoid logs and never persist this body.
 */
export function createManagedImageModelRequestPreparer({enabled=false,modelConfig,approvedModels,recipient,purpose,readVerifiedInput,verifyCurrentInput}={}){
 let config;try{config=freeze(copy({modelConfig,approvedModels,recipient,purpose}));}catch{}
 return Object.freeze({async prepare(value){let bytes;
 try{
  if(enabled!==true||!config||config.recipient!==MANAGED_IMAGE_MODEL_ENDPOINT||config.purpose!==PURPOSE||typeof readVerifiedInput!=='function'||typeof verifyCurrentInput!=='function')fail();
  const m=own(config.modelConfig,['model','maxOutputTokens']);if(!/^[A-Za-z0-9._-]{1,80}$/.test(m.model)||typeof m.model!=='string'||!Array.isArray(config.approvedModels)||!config.approvedModels.includes(m.model)||!Number.isSafeInteger(m.maxOutputTokens)||m.maxOutputTokens<1||m.maxOutputTokens>8192)fail();
  const q=copy(value);own(q,['credential','scope','requestId','taskId']);if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>4096||!/^[-A-Za-z0-9_]{1,100}$/.test(q.requestId)||!/^[-A-Za-z0-9_]{1,100}$/.test(q.taskId))fail();q.scope=validateProductionDesignScope(q.scope);freeze(q);
  const raw=own(await readVerifiedInput(freeze({credential:q.credential,scope:q.scope,taskId:q.taskId})),['sourceRecord','response','objectReceipt','verificationReport','bytes']);
  const context={sourceRecord:raw.sourceRecord,response:raw.response},objectReceipt=validateManagedDerivedObjectReceipt(raw.objectReceipt,context),verificationReport=validateManagedImageVerificationReport(raw.verificationReport,{...context,objectReceipt}),candidate=createManagedImageCandidate({...context,evidence:verificationReport.evidence});
  if(candidate.technicalStatus!=='evidence_complete'||!candidate.evidence||candidate.sourceRecord.stage!=='before'||!['front','back','left','right'].includes(candidate.sourceRecord.angle)||!same(candidate.sourceRecord.owner.scope,q.scope))fail();
  // Structural evidence validation above is necessary, never issuer authority.
  if(verificationReport.state!=='evidence_complete')fail();
  const binding=freeze({taskId:q.taskId,candidateDigest:managedImageDigest(candidate),objectReceiptDigest:managedImageDigest(objectReceipt),verificationReportDigest:managedImageDigest(verificationReport),authority:candidate.sourceRecord.owner,sourceRecordDigest:managedImageDigest(candidate.sourceRecord),responseDigest:managedImageDigest(candidate.response),evidenceDigest:managedImageDigest(candidate.evidence),sourceObject:candidate.sourceRecord.object,derivativeObject:objectReceipt.object,sourceSha256:candidate.sourceRecord.source.sha256,derivativeSha256:objectReceipt.derivative.sha256,mime:objectReceipt.derivative.mime,byteLength:objectReceipt.derivative.byteLength,maxEdge:candidate.budget.maxEdge,stage:'before',angle:candidate.sourceRecord.angle});
  const guard=freeze({credential:q.credential,scope:q.scope,taskId:q.taskId,binding});
  if(await verifyCurrentInput(guard)!==true)fail();
  bytes=bytesCopy(raw.bytes);if(bytes.length!==binding.byteLength||bytes.length>candidate.budget.maximumBytes||hash(bytes)!==binding.derivativeSha256)fail();
  const prompt=buildDesignImagePrompt(),body=JSON.stringify({model:m.model,messages:[{role:'system',content:prompt.system},{role:'user',content:[{type:'text',text:'剪前单图；方向：'+binding.angle+'。未知不得补猜，结果仅待员工复核。'},{type:'image_url',image_url:{url:'data:'+binding.mime+';base64,'+bytes.toString('base64')}}]}],max_tokens:m.maxOutputTokens,response_format:{type:'json_object'},stream:false});
  bytes.fill(0);bytes=null;
  const transportRequest=validateManagedImageModelTransportRequest({schemaVersion:'design-managed-image-model-transport-v1',url:config.recipient,method:'POST',redirect:'error',credentials:'omit',body,byteLength:Buffer.byteLength(body),payloadSha256:hash(body),dispatchAuthorized:false});
  const result=freeze({schemaVersion:'design-managed-image-model-prepared-v1',state:'prepared_not_dispatched',intent:{schemaVersion:'design-managed-image-model-intent-v1',requestId:q.requestId,authority:binding.authority,scope:q.scope,recipient:config.recipient,purpose:config.purpose,model:m.model,maxOutputTokens:m.maxOutputTokens,promptVersion:prompt.promptVersion,payloadSha256:transportRequest.payloadSha256,byteLength:transportRequest.byteLength,images:[binding]},transportRequest,submissionAuthorized:false,adoptionAuthorized:false});
  if(await verifyCurrentInput(guard)!==true)fail();return result;
 }catch{fail();}finally{bytes?.fill(0);}
 }});
}
