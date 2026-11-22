/**
 * Default-closed, server-only binary verification protocol. No decoder, network,
 * process launcher, issuer, persistence or model dispatch is provided here.
 * A real isolated verifier must inspect BOTH original immutable object bytes and
 * the unchanged hosted derivative. Hash equality alone does not prove lineage,
 * full decode, absent EXIF/GPS, correct orientation, color or contain geometry.
 * No stripping/re-encoding is allowed under the same artifact hash.
 *
 * readInputs must privately read exact immutable versions under current access.
 * finalGuard must freshly/compositely check the full immutable principal/scope,
 * both objects, exact binding, and processing/verifier authorization. Its last
 * awaited check is not a claim of absolute remote-time authorization.
 * runtime is fixed trusted SERVER configuration, never client-supplied JSON.
 * It must enforce its own process/memory/CPU/abort limits; this JS layer cannot
 * forcibly stop an arbitrary callback. A nonsettling callback keeps this instance
 * busy, preventing unbounded accumulation. There is no retry or fallback.
 * Pure report validation is NOT attestation: independent issuer provenance and
 * current repository authorization/expiry/revocation remain mandatory.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {
 managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord,
 validateManagedImageResponse,validateManagedImageVerificationEvidence,
 MANAGED_IMAGE_CANDIDATE_BUDGETS,MANAGED_IMAGE_EVIDENCE_SCHEMA
} from './managed-image-contracts.mjs';

export const MANAGED_DERIVED_OBJECT_SCHEMA='design-managed-derived-object-v1';
export const MANAGED_IMAGE_VERIFICATION_REPORT_SCHEMA='design-managed-image-verification-report-v1';
export const MANAGED_IMAGE_BINARY_RESULT_SCHEMA='design-managed-image-binary-result-v1';
const NAMES=['sourceBinding','fullDecode','metadataRemoval','orientation','color','geometry'];
const CODES=new Set(['MANAGED_VERIFICATION_DISABLED','MANAGED_VERIFICATION_INVALID','MANAGED_VERIFICATION_BINDING_MISMATCH','MANAGED_VERIFICATION_BUDGET_EXCEEDED','MANAGED_VERIFICATION_DENIED','MANAGED_VERIFICATION_BUSY','MANAGED_VERIFICATION_TIMEOUT','MANAGED_VERIFICATION_ABORTED','MANAGED_VERIFICATION_RUNTIME_INVALID','MANAGED_VERIFICATION_UNAVAILABLE']);
export class ManagedImageVerificationError extends Error{
 constructor(code='MANAGED_VERIFICATION_INVALID'){const safe=CODES.has(code)?code:'MANAGED_VERIFICATION_UNAVAILABLE';super(safe);this.name='ManagedImageVerificationError';this.code=safe;this.retryable=false;}
}
const fail=(code='MANAGED_VERIFICATION_INVALID')=>{throw new ManagedImageVerificationError(code);};
const mismatch=()=>fail('MANAGED_VERIFICATION_BINDING_MISMATCH');
const json=v=>JSON.parse(managedImageCanonical(v));
const digest=managedImageDigest,same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const hash=b=>createHash('sha256').update(b).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const version=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function own(v,keys){
 if(types.isProxy(v)||!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)fail();
 const names=Reflect.ownKeys(v);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))fail();
 const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;
}
function verifier(v){own(v,['id','version']);if(!id(v.id)||!version(v.version))fail();}
function checks(v){own(v,NAMES);if(NAMES.some(k=>!['verified','failed','unknown'].includes(v[k])))fail();}
function safeError(e){
 const d=!types.isProxy(e)&&e instanceof ManagedImageVerificationError?Object.getOwnPropertyDescriptor(e,'code'):null;
 return new ManagedImageVerificationError(d&&Object.hasOwn(d,'value')?d.value:'MANAGED_VERIFICATION_UNAVAILABLE');
}
function context(v){const c=own(v,['sourceRecord','response']),s=validateManagedImageSourceRecord(c.sourceRecord),r=validateManagedImageResponse(c.response,s);const maximumBytes=MANAGED_IMAGE_CANDIDATE_BUDGETS[r.descriptor.requestedTransform.maxEdge][r.descriptor.derivative.mime];if(r.descriptor.derivative.byteLength>maximumBytes)fail('MANAGED_VERIFICATION_BUDGET_EXCEEDED');return {s,r,maximumBytes};}
/** readbackVerified attests only storage byte equality, NOT decoded image truth. */
export function validateManagedDerivedObjectReceipt(value,ctx){try{
 const {s,r}=context(ctx),v=json(value);own(v,['schemaVersion','responseDigest','object','derivative','private','readbackVerified']);
 if(v.schemaVersion!==MANAGED_DERIVED_OBJECT_SCHEMA||v.private!==true||v.readbackVerified!==true||v.responseDigest!==digest(r)||!same(v.derivative,r.descriptor.derivative))mismatch();
 // Reuse the exact private object grammar without inventing a second URL parser.
 validateManagedImageSourceRecord({...s,object:v.object});
 if(v.object.projectOrigin!==s.object.projectOrigin||v.object.bucket!==s.object.bucket||v.object.key===s.object.key)mismatch();
 return freeze(v);
 }catch(e){throw safeError(e);}}
function binding(s,r,o,ver,policyVersion){return freeze({sourceRecordDigest:digest(s),responseDigest:digest(r),objectReceiptDigest:digest(o),requestId:r.descriptor.requestId,mediaId:s.mediaId,sourceObjectVersion:s.object.version,derivativeObjectVersion:o.object.version,sourceSha256:s.source.sha256,derivativeSha256:o.derivative.sha256,transformDigest:digest(r.descriptor.requestedTransform),verifier:ver,policyVersion});}
const stateFor=c=>NAMES.some(k=>c[k]==='failed')?'validation_failed':NAMES.every(k=>c[k]==='verified')?'evidence_complete':'pending_validation';
function evidenceFor(b,c){return {schemaVersion:MANAGED_IMAGE_EVIDENCE_SCHEMA,id:'verification-'+digest({binding:b,checks:c}),sourceRecordDigest:b.sourceRecordDigest,responseDigest:b.responseDigest,transformDigest:b.transformDigest,verifiedSourceSha256:b.sourceSha256,verifiedDerivativeSha256:b.derivativeSha256,verifier:b.verifier,checks:c};}
/** Structural validation only. Never use this export to issue trust to client JSON. */
export function validateManagedImageVerificationReport(value,ctx){try{
 const c=own(ctx,['sourceRecord','response','objectReceipt']),{s,r}=context({sourceRecord:c.sourceRecord,response:c.response}),o=validateManagedDerivedObjectReceipt(c.objectReceipt,{sourceRecord:s,response:r}),v=json(value);
 own(v,['schemaVersion','state','verificationBinding','checks','evidence','submissionAuthorized','adoptionAuthorized','publicEligible']);
 if(v.schemaVersion!==MANAGED_IMAGE_VERIFICATION_REPORT_SCHEMA||v.submissionAuthorized!==false||v.adoptionAuthorized!==false||v.publicEligible!==false)fail();
 const b=v.verificationBinding;own(b,['sourceRecordDigest','responseDigest','objectReceiptDigest','requestId','mediaId','sourceObjectVersion','derivativeObjectVersion','sourceSha256','derivativeSha256','transformDigest','verifier','policyVersion']);verifier(b.verifier);if(!version(b.policyVersion))fail();checks(v.checks);
 if(!same(b,binding(s,r,o,b.verifier,b.policyVersion))||v.state!==stateFor(v.checks))mismatch();
 if(v.state==='evidence_complete'){const e=validateManagedImageVerificationEvidence(v.evidence,{sourceRecord:s,response:r});if(!same(e,evidenceFor(b,v.checks)))mismatch();}
 else if(v.evidence!==null)fail();
 return freeze(v);
 }catch(e){throw safeError(e);}}

const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function bytesCopy(v,limit){
 if(types.isProxy(v)||!types.isUint8Array(v))fail();const buffer=get('buffer').call(v),length=get('byteLength').call(v),offset=get('byteOffset').call(v);
 if(types.isSharedArrayBuffer(buffer)||!integer(length,1,limit))fail('MANAGED_VERIFICATION_BUDGET_EXCEEDED');
 const out=new Uint8Array(length);Uint8Array.prototype.set.call(out,new Uint8Array(buffer,offset,length));return out;
}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function validDimensions(w,h){return integer(w,1,16384)&&integer(h,1,16384)&&w*h<=40000000;}
function binaryResult(raw,b,s,r,o){
 const v=json(raw);own(v,['schemaVersion','bindingDigest','verifier','policyVersion','source','derivative','checks']);
 if(v.schemaVersion!==MANAGED_IMAGE_BINARY_RESULT_SCHEMA||v.bindingDigest!==digest(b)||!same(v.verifier,b.verifier)||v.policyVersion!==b.policyVersion)fail('MANAGED_VERIFICATION_RUNTIME_INVALID');
 checks(v.checks);own(v.source,['sha256','byteLength','mime','frameCount','displayWidth','displayHeight']);own(v.derivative,['sha256','byteLength','mime','frameCount','width','height']);
 const a=v.source,d=v.derivative;
 if(a.sha256!==s.source.sha256||a.byteLength!==s.source.byteLength||a.mime!==s.source.mime||d.sha256!==o.derivative.sha256||d.byteLength!==o.derivative.byteLength||d.mime!==o.derivative.mime)mismatch();
 // Unknown/failed results may omit measurements, not forge successful decode.
 for(const x of [a.frameCount,a.displayWidth,a.displayHeight,d.frameCount,d.width,d.height])if(x!==null&&!integer(x,1,16384))fail('MANAGED_VERIFICATION_RUNTIME_INVALID');
 if(v.checks.fullDecode==='verified'&&(a.frameCount!==1||d.frameCount!==1||!validDimensions(a.displayWidth,a.displayHeight)||!validDimensions(d.width,d.height)))fail('MANAGED_VERIFICATION_RUNTIME_INVALID');
 if(v.checks.orientation==='verified'&&(a.displayWidth!==r.descriptor.source.width||a.displayHeight!==r.descriptor.source.height))fail('MANAGED_VERIFICATION_RUNTIME_INVALID');
 if(v.checks.geometry==='verified'&&(a.displayWidth!==r.descriptor.source.width||a.displayHeight!==r.descriptor.source.height||d.width!==r.descriptor.requestedTransform.width||d.height!==r.descriptor.requestedTransform.height||d.width>a.displayWidth||d.height>a.displayHeight))fail('MANAGED_VERIFICATION_RUNTIME_INVALID');
 return freeze(v);
}
/** Runtime result protocol: fixed bindingDigest/verifier/policy; source measures
 * {sha256,byteLength,mime,frameCount,displayWidth,displayHeight}; derivative
 * {sha256,byteLength,mime,frameCount,width,height}; six tri-state checks.
 * Display dimensions must reflect independently verified source orientation.
 * metadataRemoval means actual EXIF/GPS/private metadata absence in the SAME
 * derivative bytes; color means actual policy-verified conversion/preservation.
 * sourceBinding must be independently established, never inferred from hashes.
 */
export function createManagedImageVerification({enabled=false,readInputs,finalGuard,runtime,verifier:verifierConfig,policyVersion,timeoutMs}={}){
 let ver,verifyBinary;try{ver=json(verifierConfig);verifier(ver);freeze(ver);if(!types.isProxy(runtime)){const d=runtime&&Object.getOwnPropertyDescriptor(runtime,'verifyBinary');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function')verifyBinary=d.value.bind(runtime);}}catch{}
 const ready=enabled===true&&ver&&version(policyVersion)&&integer(timeoutMs,1,30000)&&typeof readInputs==='function'&&typeof finalGuard==='function'&&typeof verifyBinary==='function';let busy=false;
 return Object.freeze({async verify(input){
  if(!ready)fail('MANAGED_VERIFICATION_DISABLED');if(busy)fail('MANAGED_VERIFICATION_BUSY');busy=true;
  const controller=new AbortController(),deadline=performance.now()+timeoutMs,pending=new Set();let sourceBytes,derivativeBytes,external,timer,listener,reason=null;
  const stop=code=>{if(!reason){reason=code;controller.abort();}};
  const check=()=>{if(external&&aborted.call(external))stop('MANAGED_VERIFICATION_ABORTED');if(performance.now()>=deadline)stop('MANAGED_VERIFICATION_TIMEOUT');if(reason)fail(reason);};
  async function step(work){check();let remove;const stopped=new Promise((_,reject)=>{const fn=()=>reject(new ManagedImageVerificationError(reason||'MANAGED_VERIFICATION_ABORTED'));controller.signal.addEventListener('abort',fn,{once:true});remove=()=>controller.signal.removeEventListener('abort',fn);});
   const task=Promise.resolve().then(()=>{check();return work();});pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));
   try{const result=await Promise.race([task,stopped]);check();return result;}finally{remove();}}
  try{
   if(types.isProxy(input)||!input||typeof input!=='object')fail();const names=Reflect.ownKeys(input),q=own(input,['credential','scope','mediaId','requestId',...(names.includes('signal')?['signal']:[])]);
   if(typeof q.credential!=='string'||q.credential.length<1||q.credential.length>4096||q.credential.trim()!==q.credential||/[\u0000-\u001f\u007f]/.test(q.credential)||!id(q.mediaId)||!id(q.requestId))fail();
   const scope=freeze(validateProductionDesignScope(json(q.scope)));external=q.signal;if(external!==undefined){if(types.isProxy(external))fail();aborted.call(external);listener=()=>stop('MANAGED_VERIFICATION_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('MANAGED_VERIFICATION_TIMEOUT'),timeoutMs);check();
   const request=freeze({credential:q.credential,scope,mediaId:q.mediaId,requestId:q.requestId});
   const raw=own(await step(()=>readInputs(request,controller.signal)),['sourceRecord','response','objectReceipt','sourceBytes','derivativeBytes']);
   const {s,r,maximumBytes}=context({sourceRecord:raw.sourceRecord,response:raw.response}),o=validateManagedDerivedObjectReceipt(raw.objectReceipt,{sourceRecord:s,response:r});
   if(s.mediaId!==q.mediaId||r.descriptor.requestId!==q.requestId||!same(s.owner.scope,scope))mismatch();
   sourceBytes=bytesCopy(raw.sourceBytes,PRIVATE_MEDIA_MAX_BYTES);derivativeBytes=bytesCopy(raw.derivativeBytes,maximumBytes);
   const verifyBytes=()=>{if(sourceBytes.length!==s.source.byteLength||hash(sourceBytes)!==s.source.sha256||derivativeBytes.length!==o.derivative.byteLength||hash(derivativeBytes)!==o.derivative.sha256)mismatch();};verifyBytes();
   const b=binding(s,r,o,ver,policyVersion),guard=phase=>freeze({credential:q.credential,scope,binding:b,phase});
   if(await step(()=>finalGuard(guard('before_verification'),controller.signal))!==true)fail('MANAGED_VERIFICATION_DENIED');
   const limits=freeze({maximumSourceBytes:PRIVATE_MEDIA_MAX_BYTES,maximumDerivativeBytes:maximumBytes,maximumSourcePixels:40000000,maximumSourceDimension:16384,maximumDerivativeDimension:r.descriptor.requestedTransform.maxEdge,maximumFrames:1,timeoutMs});
   const expected=freeze({sourceMime:s.source.mime,derivativeMime:o.derivative.mime,sourceDisplay:{width:r.descriptor.source.width,height:r.descriptor.source.height},transform:r.descriptor.requestedTransform});
   const result=binaryResult(await step(()=>verifyBinary({binding:b,sourceBytes,derivativeBytes,expected,limits},controller.signal)),b,s,r,o);verifyBytes();
   const state=stateFor(result.checks),report=validateManagedImageVerificationReport({schemaVersion:MANAGED_IMAGE_VERIFICATION_REPORT_SCHEMA,state,verificationBinding:b,checks:result.checks,evidence:state==='evidence_complete'?evidenceFor(b,result.checks):null,submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false},{sourceRecord:s,response:r,objectReceipt:o});
   // No awaited metadata/read/decoder work after this composite current check.
   if(await step(()=>finalGuard(guard('after_verification'),controller.signal))!==true)fail('MANAGED_VERIFICATION_DENIED');verifyBytes();check();return report;
  }catch(e){throw safeError(e);}
  finally{
   clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);
   const release=()=>{sourceBytes?.fill(0);derivativeBytes?.fill(0);busy=false;};
   // Late completion never publishes a report. Retain admission until all
   // handed-off callbacks settle; don't wipe a buffer still in native use.
   if(pending.size)void Promise.allSettled([...pending]).then(release);else release();
  }
 }});
}
