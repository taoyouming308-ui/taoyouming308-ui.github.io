/** Default-closed independent three-object verifier composition. No issuer,
 * persistence, network or decoder is supplied here. A report is not a capability.
 * Production runtime must independently prove BOTH source→parent and parent→PNG;
 * bytes/hashes, successful decoding and caller metadata alone cannot prove them. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
import {validateManagedNormalizedObjectReceipt,buildManagedNormalizedVerificationBinding,validateManagedNormalizedVerificationReport} from './managed-normalized-verification-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';
const codes=new Set(['NORMALIZED_VERIFICATION_DISABLED','NORMALIZED_VERIFICATION_INVALID','NORMALIZED_VERIFICATION_BUSY','NORMALIZED_VERIFICATION_DENIED','NORMALIZED_VERIFICATION_BINDING','NORMALIZED_VERIFICATION_RUNTIME','NORMALIZED_VERIFICATION_TIMEOUT','NORMALIZED_VERIFICATION_ABORTED']);
export class ManagedNormalizedVerificationError extends Error{constructor(code){const c=codes.has(code)?code:'NORMALIZED_VERIFICATION_INVALID';super(c);this.code=c;this.retryable=false;this.outcome='not_published';}}
const fail=c=>{throw new ManagedNormalizedVerificationError(c);},sha=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.parse(managedImageCanonical(x)),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max,id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x),version=x=>typeof x==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(x);
function own(x,keys){if(types.isProxy(x)||!x||Object.getPrototypeOf(x)!==Object.prototype||Reflect.ownKeys(x).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(x,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function bytes(x,max){if(types.isProxy(x)||!types.isUint8Array(x))fail();const b=get('buffer').call(x),n=get('byteLength').call(x);if(types.isSharedArrayBuffer(b)||!integer(n,1,max))fail();return Buffer.from(new Uint8Array(b,get('byteOffset').call(x),n));}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const checkNames=['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry'];
function result(raw,b,a,o){
 const r=json(raw);own(r,['schemaVersion','bindingDigest','verifier','policyVersion','source','parent','normalized','checks']);
 if(r.schemaVersion!=='design-managed-normalized-binary-result-v1'||r.bindingDigest!==managedImageDigest(b)||!same(r.verifier,b.verifier)||r.policyVersion!==b.policyVersion)fail('NORMALIZED_VERIFICATION_RUNTIME');
 own(r.checks,checkNames);if(Object.values(r.checks).some(x=>!['unknown','failed','verified'].includes(x)))fail('NORMALIZED_VERIFICATION_RUNTIME');
 own(r.source,['sha256','byteLength','mime','frameCount','displayWidth','displayHeight']);
 for(const n of ['parent','normalized'])own(r[n],['sha256','byteLength','mime','frameCount','width','height']);
 for(const [n,d] of [['source',a.sourceRecord.source],['parent',a.parentObjectReceipt.derivative],['normalized',o.output]]){
  const m=r[n];if(m.sha256!==d.sha256||m.byteLength!==d.byteLength||m.mime!==d.mime)fail('NORMALIZED_VERIFICATION_BINDING');
  const w=n==='source'?m.displayWidth:m.width,h=n==='source'?m.displayHeight:m.height;
  if([m.frameCount,w,h].some(x=>x!==null&&!integer(x,1,16384)))fail('NORMALIZED_VERIFICATION_RUNTIME');
  if(r.checks.fullDecode==='verified'&&(m.frameCount!==1||!integer(w,1,16384)||!integer(h,1,16384)||w*h>40000000))fail('NORMALIZED_VERIFICATION_RUNTIME');
 }
 const s=a.parentResponse.descriptor.source,p=a.parentResponse.descriptor.requestedTransform;
 if(r.checks.orientation==='verified'&&(r.source.displayWidth!==s.width||r.source.displayHeight!==s.height))fail('NORMALIZED_VERIFICATION_RUNTIME');
 if(r.checks.geometry==='verified'&&(r.source.displayWidth!==s.width||r.source.displayHeight!==s.height||['parent','normalized'].some(n=>r[n].width!==p.width||r[n].height!==p.height)||p.width>s.width||p.height>s.height))fail('NORMALIZED_VERIFICATION_RUNTIME');
 return r;
}
export function createManagedNormalizedVerification({enabled=false,readInputs,finalGuard,runtime,verifier,policyVersion,timeoutMs}={}){
 let ver,verifyBinary;try{ver=json(verifier);own(ver,['id','version']);if(!id(ver.id)||!version(ver.version))throw Error();freeze(ver);if(!types.isProxy(runtime)){const d=runtime&&Object.getOwnPropertyDescriptor(runtime,'verifyBinary');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function')verifyBinary=d.value.bind(runtime);}}catch{ver=null;}
 const ready=enabled===true&&ver&&version(policyVersion)&&integer(timeoutMs,1,30000)&&typeof readInputs==='function'&&typeof finalGuard==='function'&&typeof verifyBinary==='function';let busy=false;
 return Object.freeze({async verify(input){
  if(!ready)fail('NORMALIZED_VERIFICATION_DISABLED');if(busy)fail('NORMALIZED_VERIFICATION_BUSY');busy=true;
  const controller=new AbortController(),deadline=performance.now()+timeoutMs,pending=new Set(),buffers=[];let timer,external,listener,reason;
  const stop=c=>{if(!reason){reason=c;controller.abort();}};
  const check=()=>{if(external&&aborted.call(external))stop('NORMALIZED_VERIFICATION_ABORTED');if(performance.now()>=deadline)stop('NORMALIZED_VERIFICATION_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let abort;
   const stopped=new Promise((_,reject)=>{abort=()=>reject(new ManagedNormalizedVerificationError(reason??'NORMALIZED_VERIFICATION_ABORTED'));controller.signal.addEventListener('abort',abort,{once:true});});try{const v=await Promise.race([p,stopped]);check();return v;}finally{controller.signal.removeEventListener('abort',abort);}}
  try{
   if(types.isProxy(input)||!input||typeof input!=='object')fail();const q=own(input,['credential','scope','taskId',...(Reflect.ownKeys(input).includes('signal')?['signal']:[])]);
   if(typeof q.credential!=='string'||q.credential.length<1||q.credential.length>4096||/[\s\x00-\x1f\x7f]/.test(q.credential)||!id(q.taskId))fail();
   const scope=freeze(json(validateProductionDesignScope(q.scope)));external=q.signal;if(external!==undefined){if(types.isProxy(external))fail();aborted.call(external);listener=()=>stop('NORMALIZED_VERIFICATION_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('NORMALIZED_VERIFICATION_TIMEOUT'),timeoutMs);check();const request=freeze({credential:q.credential,scope,taskId:q.taskId});
   const raw=own(await step(()=>readInputs(request,controller.signal)),['artifact','objectReceipt','sourceBytes','parentBytes','normalizedBytes']);
   const artifact=validateManagedImageNormalizationArtifact(raw.artifact),objectReceipt=validateManagedNormalizedObjectReceipt(raw.objectReceipt,{artifact});
   if(!same(artifact.authority.scope,scope))fail('NORMALIZED_VERIFICATION_BINDING');
   const max=artifact.parentResponse.descriptor.requestedTransform.maxEdge===1024?262144:524288;
   const take=(value,limit)=>{const b=bytes(value,limit);buffers.push(b);return b;};
   const sourceBytes=take(raw.sourceBytes,IMAGE_UPLOAD_MAX_BYTES),parentBytes=take(raw.parentBytes,max),normalizedBytes=take(raw.normalizedBytes,max);
   const verifyBytes=()=>{for(const [v,d] of [[sourceBytes,artifact.sourceRecord.source],[parentBytes,artifact.parentObjectReceipt.derivative],[normalizedBytes,artifact.output]])if(v.length!==d.byteLength||sha(v)!==d.sha256)fail('NORMALIZED_VERIFICATION_BINDING');};verifyBytes();
   const context={taskId:q.taskId,artifact,objectReceipt,verifier:ver,policyVersion},binding=buildManagedNormalizedVerificationBinding(context);
   const guard=phase=>freeze({...request,binding,phase});
   if(await step(()=>finalGuard(guard('before_verification'),controller.signal))!==true)fail('NORMALIZED_VERIFICATION_DENIED');
   const expected=freeze({sourceDisplay:artifact.parentResponse.descriptor.source,transform:artifact.parentResponse.descriptor.requestedTransform,normalizationPolicy:artifact.normalizationPolicy});
   const limits=freeze({maximumSourceBytes:IMAGE_UPLOAD_MAX_BYTES,maximumParentBytes:max,maximumNormalizedBytes:max,maximumSourcePixels:40000000,maximumSourceDimension:16384,maximumFrames:1,timeoutMs});
   const r=result(await step(()=>verifyBinary({binding,sourceBytes,parentBytes,normalizedBytes,expected,limits},controller.signal)),binding,artifact,objectReceipt);verifyBytes();
   const checks=r.checks,state=Object.values(checks).includes('failed')?'validation_failed':Object.values(checks).every(x=>x==='verified')?'evidence_complete':'pending_validation';
   const evidence=state==='evidence_complete'?{schemaVersion:'design-managed-normalized-evidence-v1',id:'normalized-verification-'+managedImageDigest({binding,checks}),verificationBindingDigest:managedImageDigest(binding),verifier:ver,policyVersion,checks}:null;
   const report=validateManagedNormalizedVerificationReport({schemaVersion:'design-managed-normalized-verification-report-v1',state,verificationBinding:binding,checks,evidence,submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false},context);
   if(await step(()=>finalGuard(guard('after_verification'),controller.signal))!==true)fail('NORMALIZED_VERIFICATION_DENIED');verifyBytes();check();return report;
  }catch(e){const d=!types.isProxy(e)&&e instanceof ManagedNormalizedVerificationError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedNormalizedVerificationError(d&&Object.hasOwn(d,'value')?d.value:undefined);}
  finally{clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);const clear=()=>{buffers.forEach(b=>b.fill(0));busy=false;};if(pending.size)void Promise.allSettled([...pending]).then(clear);else clear();}
 }});
}
