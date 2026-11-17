/** Default-closed, server-only verifier-role composition. No network, decoder,
 * storage implementation, credentials, issuer privileges or retry is supplied.
 * Task metadata comes only from the independent issuer. A configured runtime
 * still needs qualification: synthetic complete reports are not such proof.
 *
 * storage.read must honor exact private object versions; this layer cannot
 * establish a vendor's version-addressing semantics. It copies bounded read
 * results, and the underlying verifier checks all three actual byte hashes.
 * Issuer callbacks must freshly enforce task/principal/access/approval expiry
 * and revocation; a callback returning true is not deployment authorization.
 *
 * One deadline covers reads, inspection, publication and final guard. Arbitrary
 * callbacks cannot be forcibly stopped: outstanding callbacks retain admission
 * and owned buffers until they settle. Never reuse a timed-out native borrow.
 * After any attempted publication failure this instance is poisoned. Query the
 * durable state separately with the runtime ledger; never automatically resend.
 * A confirmed report grants no model, adoption or public-image permission.
 */
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
import {validateManagedNormalizedObjectReceipt,buildManagedNormalizedVerificationBinding,validateManagedNormalizedVerificationReport} from './managed-normalized-verification-contracts.mjs';
import {createManagedNormalizedVerification,ManagedNormalizedVerificationError} from './managed-normalized-verification.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';

const CODES=new Set(['NORMALIZED_RUNNER_DISABLED','NORMALIZED_RUNNER_INVALID','NORMALIZED_RUNNER_BUSY','NORMALIZED_RUNNER_DENIED','NORMALIZED_RUNNER_BINDING','NORMALIZED_RUNNER_RUNTIME','NORMALIZED_RUNNER_TIMEOUT','NORMALIZED_RUNNER_ABORTED','NORMALIZED_RUNNER_UNCERTAIN']);
export class ManagedNormalizedVerificationRunnerError extends Error{
 constructor(code){const safe=CODES.has(code)?code:'NORMALIZED_RUNNER_DENIED';super(safe);this.name='ManagedNormalizedVerificationRunnerError';this.code=safe;this.outcome=safe==='NORMALIZED_RUNNER_UNCERTAIN'?'uncertain':'not_published';this.retryable=false;}
}
const fail=code=>{throw new ManagedNormalizedVerificationRunnerError(code);};
const copy=value=>JSON.parse(managedImageCanonical(value));
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const version=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(value);
function own(value,keys){
 if(types.isProxy(value)||!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)fail('NORMALIZED_RUNNER_INVALID');
 const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('NORMALIZED_RUNNER_INVALID');result[key]=d.value;}return result;
}
function method(value,key){
 if(!value||types.isProxy(value))return null;
 const d=Object.getOwnPropertyDescriptor(value,key);
 return d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)?(...args)=>Reflect.apply(d.value,value,args):null;
}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=key=>Object.getOwnPropertyDescriptor(typed,key).get;
function bytesCopy(value,maximum,expectedLength){
 if(types.isProxy(value)||!types.isUint8Array(value))fail('NORMALIZED_RUNNER_INVALID');
 const buffer=get('buffer').call(value),length=get('byteLength').call(value),offset=get('byteOffset').call(value);
 if(types.isSharedArrayBuffer(buffer)||!integer(length,1,maximum)||length!==expectedLength)fail('NORMALIZED_RUNNER_BINDING');
 return Buffer.from(new Uint8Array(buffer,offset,length));
}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function safeError(error){
 if(!types.isProxy(error)&&(error instanceof ManagedNormalizedVerificationRunnerError||error instanceof ManagedNormalizedVerificationError)){
  const d=Object.getOwnPropertyDescriptor(error,'code');
  if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')return new ManagedNormalizedVerificationRunnerError(d.value.replace(/^NORMALIZED_VERIFICATION_/,'NORMALIZED_RUNNER_'));
 }
 return new ManagedNormalizedVerificationRunnerError();
}

export function createManagedNormalizedVerificationRunner({enabled=false,issuer,storage,runtime,verifier,policyVersion,timeoutMs}={}){
 const readTask=method(issuer,'readVerificationTask'),guardBinding=method(issuer,'checkVerificationBinding'),publish=method(issuer,'publishVerification');
 const read=method(storage,'read'),verifyBinary=method(runtime,'verifyBinary');
 let fixedVerifier;try{fixedVerifier=copy(verifier);own(fixedVerifier,['id','version']);if(!id(fixedVerifier.id)||!version(fixedVerifier.version))throw Error();freeze(fixedVerifier);}catch{fixedVerifier=null;}
 const ready=enabled===true&&readTask&&guardBinding&&publish&&read&&verifyBinary&&fixedVerifier&&version(policyVersion)&&integer(timeoutMs,1,30000);
 let busy=false,poisoned=false;
 return Object.freeze({async run(value){
  if(!ready)fail('NORMALIZED_RUNNER_DISABLED');if(busy||poisoned)fail('NORMALIZED_RUNNER_BUSY');busy=true;
  const controller=new AbortController(),deadline=performance.now()+timeoutMs,pending=new Set(),buffers=[];
  let timer,external,listener,reason=null,finished=false,publishAttempted=false;
  const stop=code=>{if(!reason){reason=code;controller.abort();}};
  const check=()=>{
   if(finished)fail('NORMALIZED_RUNNER_ABORTED');
   if(external&&aborted.call(external))stop('NORMALIZED_RUNNER_ABORTED');
   if(performance.now()>=deadline)stop('NORMALIZED_RUNNER_TIMEOUT');
   if(reason)fail(reason);
  };
  // Also track the underlying runtime promise, not just verify()'s abort race.
  const borrow=work=>{const p=Promise.resolve().then(()=>{check();return work();});pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
  const step=async work=>{
   check();let onAbort;
   const stopped=new Promise((_,reject)=>{onAbort=()=>reject(new ManagedNormalizedVerificationRunnerError(reason??'NORMALIZED_RUNNER_ABORTED'));controller.signal.addEventListener('abort',onAbort,{once:true});});
   const p=borrow(work);
   try{const result=await Promise.race([p,stopped]);check();return result;}finally{controller.signal.removeEventListener('abort',onAbort);}
  };
  try{
   if(!value||types.isProxy(value))fail('NORMALIZED_RUNNER_INVALID');
   const q=own(value,['credential','scope','taskId',...(Object.hasOwn(value,'signal')?['signal']:[])]);
   if(typeof q.credential!=='string'||q.credential.length<1||q.credential.length>4096||/[\s\x00-\x1f\x7f]/.test(q.credential)||!id(q.taskId))fail('NORMALIZED_RUNNER_INVALID');
   const scope=freeze(validateProductionDesignScope(copy(q.scope))),request=freeze({credential:q.credential,scope,taskId:q.taskId});
   external=q.signal;if(external!==undefined){if(types.isProxy(external))fail('NORMALIZED_RUNNER_INVALID');aborted.call(external);listener=()=>stop('NORMALIZED_RUNNER_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('NORMALIZED_RUNNER_TIMEOUT'),timeoutMs);check();
   const task=raw=>{
    const c=own(copy(raw),['taskId','artifact','objectReceipt','verifier','policyVersion']);
    if(c.taskId!==request.taskId||!same(c.verifier,fixedVerifier)||c.policyVersion!==policyVersion)fail('NORMALIZED_RUNNER_BINDING');
    c.artifact=validateManagedImageNormalizationArtifact(c.artifact);
    c.objectReceipt=validateManagedNormalizedObjectReceipt(c.objectReceipt,{artifact:c.artifact});
    if(!same(c.artifact.authority.scope,scope))fail('NORMALIZED_RUNNER_BINDING');
    buildManagedNormalizedVerificationBinding(c);return freeze(c);
   };
   const context=task(await step(()=>readTask(request,controller.signal))),binding=buildManagedNormalizedVerificationBinding(context);
   const guardResult=()=>step(()=>guardBinding(freeze({...request,binding}),controller.signal));
   const guard=async()=>{if(await guardResult()!==true)fail('NORMALIZED_RUNNER_DENIED');};
   const {artifact,objectReceipt}=context,max=artifact.parentResponse.descriptor.requestedTransform.maxEdge===1024?262144:524288;
   const readBytes=async(object,derivative,maximum)=>{
    await guard();
    return step(async()=>{
     const raw=await read(Object.freeze({object,derivative,private:true,signal:controller.signal}));
     // Even a late read is copied/tracked before the abort race can discard it.
     // Never zero a storage cache's backing buffer; only owned copies are wiped.
     const b=bytesCopy(raw,maximum,derivative.byteLength);buffers.push(b);return b;
    });
   };
   const sourceBytes=await readBytes(artifact.sourceRecord.object,artifact.sourceRecord.source,IMAGE_UPLOAD_MAX_BYTES);
   const parentBytes=await readBytes(artifact.parentObjectReceipt.object,artifact.parentObjectReceipt.derivative,max);
   const normalizedDescriptor=freeze({sha256:artifact.output.sha256,byteLength:artifact.output.byteLength,mime:artifact.output.mime});
   const normalizedBytes=await readBytes(objectReceipt.object,normalizedDescriptor,max);
   check();const remaining=Math.floor(deadline-performance.now());if(remaining<1)fail('NORMALIZED_RUNNER_TIMEOUT');
   const service=createManagedNormalizedVerification({enabled:true,verifier:fixedVerifier,policyVersion,timeoutMs:remaining,
    readInputs:async()=>({artifact,objectReceipt,sourceBytes,parentBytes,normalizedBytes}),
    finalGuard:async q=>{if(!same(q.binding,binding))throw new ManagedNormalizedVerificationError('NORMALIZED_VERIFICATION_BINDING');return guardResult();},
    runtime:{verifyBinary:(q,signal)=>borrow(()=>verifyBinary(q,signal))}
   });
   const report=validateManagedNormalizedVerificationReport(await step(()=>service.verify({...request,signal:controller.signal})),context);
   // Mark only once the method is actually invoked, after the final time check.
   const published=await step(()=>{publishAttempted=true;return publish(freeze({...request,report}),controller.signal);});
   const ack=own(copy(published),['taskId','artifact','objectReceipt','verifier','policyVersion','verificationReport']);
   const {verificationReport,...ackTask}=ack;
   if(!same(task(ackTask),context)||!same(validateManagedNormalizedVerificationReport(verificationReport,context),report))fail('NORMALIZED_RUNNER_BINDING');
   // No ordinary runtime status privilege is used. This is a fresh issuer-side
   // guard after a confirmed publication, not an independent durable readback.
   await guard();check();
   return Object.freeze({taskId:request.taskId,state:report.state,reportDigest:managedImageDigest(report)});
  }catch(error){
   if(publishAttempted){poisoned=true;fail('NORMALIZED_RUNNER_UNCERTAIN');}
   throw safeError(error);
  }finally{
   finished=true;clearTimeout(timer);controller.abort();
   if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);
   const clear=()=>{for(const b of buffers)b.fill(0);busy=false;};
   // Hold the slot for late storage/issuer/native work; never permit a second
   // run merely because the caller already received a timeout rejection.
   if(pending.size)void (async()=>{while(pending.size)await Promise.allSettled([...pending]);clear();})();else clear();
  }
 }});
}
