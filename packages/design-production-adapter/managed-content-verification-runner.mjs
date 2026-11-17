/** Independent canonical verifier role composition. Only the restricted runtime
 * calculates binary evidence; caller input carries selectors, never check flags.
 * No automatic approvals or model dispatch. Late publication is query-only. */
import {createHash} from 'node:crypto';import {types} from 'node:util';import {performance} from 'node:perf_hooks';
import {policyCopy as copy,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';import {managedImageDigest as digest} from './managed-image-contracts.mjs';
import {validateManagedApplicationStrictTask,buildManagedApplicationStrictReport,validateManagedApplicationStrictReport,managedApplicationContentManifestReference} from './managed-application-image-contracts.mjs';
import {managedContentManifestReference} from './managed-content-manifest-contracts.mjs';
const codes=new Set(['CONTENT_VERIFICATION_RUNNER_DISABLED','CONTENT_VERIFICATION_RUNNER_INVALID','CONTENT_VERIFICATION_RUNNER_BUSY','CONTENT_VERIFICATION_RUNNER_DENIED','CONTENT_VERIFICATION_RUNNER_TIMEOUT','CONTENT_VERIFICATION_RUNNER_ABORTED','CONTENT_VERIFICATION_RUNNER_UNCERTAIN']);
export class ManagedContentVerificationRunnerError extends Error{constructor(code){const c=codes.has(code)?code:'CONTENT_VERIFICATION_RUNNER_INVALID';super(c);this.code=c;this.retryable=false;this.outcome=c==='CONTENT_VERIFICATION_RUNNER_UNCERTAIN'?'uncertain':'not_published';}}
const fail=c=>{throw new ManagedContentVerificationRunnerError(c);},sha=b=>createHash('sha256').update(b).digest('hex'),id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
function method(v,k){if(!v||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)){const fn=d.value;return(...args)=>Reflect.apply(fn,v,args);}}
const tp=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(tp,k).get;
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const b=get('buffer').call(v),n=get('byteLength').call(v);if(types.isSharedArrayBuffer(b)||!Number.isSafeInteger(n)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
export function createManagedContentVerificationRunner({enabled=false,issuer,storage,runtime,timeoutMs=30000}={}){
 const readTask=method(issuer,'readTask'),guardTask=method(issuer,'guardTask'),publish=method(issuer,'publishReport'),read=method(storage,'read'),verify=method(runtime,'verifyApplicationTask');
 const ready=enabled===true&&[readTask,guardTask,publish,read,verify].every(f=>typeof f==='function')&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;let busy=false,poisoned=false;
 return Object.freeze({async run(value){
  if(!ready)fail('CONTENT_VERIFICATION_RUNNER_DISABLED');if(busy||poisoned)fail('CONTENT_VERIFICATION_RUNNER_BUSY');busy=true;
  const controller=new AbortController(),pending=new Set(),owned=[],deadline=performance.now()+timeoutMs;let external,listener,timer,reason=null,finished=false,publishAttempted=false;
  const stop=c=>{if(!reason){reason=c;controller.abort();}};
  const check=()=>{if(finished)fail('CONTENT_VERIFICATION_RUNNER_ABORTED');if(external&&aborted.call(external))stop('CONTENT_VERIFICATION_RUNNER_ABORTED');if(performance.now()>=deadline)stop('CONTENT_VERIFICATION_RUNNER_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let cb;const stopped=new Promise((_,reject)=>{cb=()=>reject(new ManagedContentVerificationRunnerError(reason??'CONTENT_VERIFICATION_RUNNER_ABORTED'));controller.signal.addEventListener('abort',cb,{once:true});});try{const out=await Promise.race([p,stopped]);check();return out;}finally{controller.signal.removeEventListener('abort',cb);}}
  try{
   if(types.isProxy(value)||!value)fail();const q=own(value,['credential','scope','taskId',...(Object.hasOwn(value,'signal')?['signal']:[])]);if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential)||!id(q.taskId))fail();
   const scope=freeze(validateProductionDesignScope(copy(q.scope))),request=freeze({credential:q.credential,scope,taskId:q.taskId});external=q.signal;if(external!==undefined){if(types.isProxy(external))fail();aborted.call(external);listener=()=>stop('CONTENT_VERIFICATION_RUNNER_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('CONTENT_VERIFICATION_RUNNER_TIMEOUT'),timeoutMs);const task=validateManagedApplicationStrictTask(await step(()=>readTask(request)));if(task.taskId!==q.taskId||!equal(task.claimedArtifact.artifact.authority.scope,scope))fail('CONTENT_VERIFICATION_RUNNER_DENIED');
   const taskDigest=digest(task),fresh=async()=>{if(await step(()=>guardTask({...request,taskDigest}))!==true)fail('CONTENT_VERIFICATION_RUNNER_DENIED');};
   const artifact=task.claimedArtifact.artifact;
   async function readBytes(manifest,reference,max){await fresh();const b=await step(async()=>{const raw=own(await read({credential:q.credential,scope,reference,signal:controller.signal}),['manifest','bytes']);const out=bytes(raw.bytes,max);owned.push(out);if(!equal(copy(raw.manifest),manifest))fail('CONTENT_VERIFICATION_RUNNER_DENIED');return out;});if(b.length!==manifest.content.byteLength||sha(b)!==manifest.content.sha256)fail();await fresh();return b;}
   const sourceBytes=await readBytes(artifact.sourceManifest,managedContentManifestReference(artifact.sourceManifest),8388608),normalizedBytes=await readBytes(task.normalizedManifest,managedApplicationContentManifestReference(task.normalizedManifest),262144);
   const verifyBytes=()=>{for(const [b,d] of [[sourceBytes,artifact.sourceManifest.content],[normalizedBytes,task.normalizedManifest.content]])if(b.length!==d.byteLength||sha(b)!==d.sha256)fail();};
   await fresh();const binaryResult=await step(()=>verify({task,sourceBytes,normalizedBytes,signal:controller.signal}));verifyBytes();
   const report=buildManagedApplicationStrictReport({task,binaryResult});await fresh();
   const raw=await step(()=>{verifyBytes();publishAttempted=true;return publish({...request,report});}),ack=own(copy(raw),['task','report']);if(!equal(validateManagedApplicationStrictTask(ack.task),task)||!equal(validateManagedApplicationStrictReport(ack.report,task),report))fail();
   await fresh();verifyBytes();check();return Object.freeze({taskId:q.taskId,state:report.state,reportDigest:digest(report)});
  }catch(e){if(publishAttempted){poisoned=true;fail('CONTENT_VERIFICATION_RUNNER_UNCERTAIN');}const d=!types.isProxy(e)&&e instanceof ManagedContentVerificationRunnerError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedContentVerificationRunnerError(d&&Object.hasOwn(d,'value')?d.value:undefined);}
  finally{finished=true;clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);const clear=()=>{owned.forEach(b=>b.fill(0));busy=false;};if(pending.size)void(async()=>{while(pending.size)await Promise.allSettled([...pending]);clear();})();else clear();}
 }});
}
