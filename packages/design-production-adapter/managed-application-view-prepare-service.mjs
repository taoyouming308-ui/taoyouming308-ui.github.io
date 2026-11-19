/** Independent before/after view preparation; never relabels source stage.
 * Old before-only prepare API and strict-input-v2 remain unchanged. */
/** Server-only fixed synthetic preparation. Independent processing/storage grants
 * must already exist; this service cannot issue them. Task issuance is separate
 * from granting processing/storage permission. Unknown stages are query-only:
 * status never runs processing, PUT, task issuance or verification. No model call.
 */
import {types} from 'node:util';import {performance} from 'node:perf_hooks';
import {policyCopy as copy,policyEqual as equal,policyExact as exact,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageDigest as digest} from './managed-image-contracts.mjs';
import {validateManagedContentManifestReference,validateManagedContentManifest,managedContentManifestReference} from './managed-content-manifest-contracts.mjs';
import {validateManagedApplicationSourceBinding,validateClaimedApplicationNormalizationArtifact,createManagedApplicationProcessingIntent,createManagedApplicationContentWriteIntent,createManagedApplicationContentManifest,managedApplicationContentManifestReference,validateManagedApplicationStrictTask,validateManagedApplicationStrictReport} from './managed-application-image-contracts.mjs';
import {ManagedApplicationPrepareError} from './managed-application-prepare-service.mjs';
const fail=c=>{throw new ManagedApplicationPrepareError(c);},id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('APPLICATION_PREPARE_INVALID');const o={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('APPLICATION_PREPARE_INVALID');o[k]=d.value;}return o;}
function method(v,k){if(!v||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value))return(...a)=>Reflect.apply(d.value,v,a);}
const tp=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(tp,k).get;
function bytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail('APPLICATION_PREPARE_INVALID');const b=get('buffer').call(v),n=get('byteLength').call(v);if(types.isSharedArrayBuffer(b)||n<1||n>262144)fail('APPLICATION_PREPARE_INVALID');return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
export const managedApplicationPreparationTaskId=claimed=>'application-task-'+digest(validateClaimedApplicationNormalizationArtifact(claimed));
export function createManagedApplicationViewPrepareService(config={}){
 let c,readSource,readClaim,readBound,guard,normalize,put,issue,query,verify,ready=false;
 try{c=own(config,['enabled','mode','sourceRepo','processing','operation','derivedStore','taskIssuer','canonical','runner','timeoutMs','taskTtlMs']);readSource=method(c.sourceRepo,'readSource');readClaim=method(c.processing,'readClaim');readBound=method(c.processing,'readBoundArtifact');guard=method(c.processing,'guard');normalize=method(c.operation,'run');put=method(c.derivedStore,'put');issue=method(c.taskIssuer,'issueTask');query=method(c.canonical,'queryStatus');verify=method(c.runner,'run');ready=c.enabled===true&&c.mode==='synthetic_mock'&&[readSource,readClaim,readBound,guard,normalize,put,issue,query,verify].every(f=>typeof f==='function')&&Number.isSafeInteger(c.timeoutMs)&&c.timeoutMs>0&&c.timeoutMs<=30000&&Number.isSafeInteger(c.taskTtlMs)&&c.taskTtlMs>0&&c.taskTtlMs<=900000;c=Object.freeze(c);}catch{}
 let busy=false,poisoned=false;
 async function run(input,prepare){
  if(!ready)fail('APPLICATION_PREPARE_DISABLED');if(busy||prepare&&poisoned)fail('APPLICATION_PREPARE_BUSY');busy=true;
  const controller=new AbortController(),deadline=performance.now()+c.timeoutMs,pending=new Set(),owned=[];let external,listener,timer,reason,finished=false,attempted=false;
  const stop=code=>{if(!reason){reason=code;controller.abort();}};
  const check=()=>{if(finished)fail('APPLICATION_PREPARE_ABORTED');if(external&&aborted.call(external))stop('APPLICATION_PREPARE_ABORTED');if(performance.now()>=deadline)stop('APPLICATION_PREPARE_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let cb;const stopped=new Promise((_,reject)=>{cb=()=>reject(new ManagedApplicationPrepareError(reason??'APPLICATION_PREPARE_ABORTED'));controller.signal.addEventListener('abort',cb,{once:true});});try{const r=await Promise.race([p,stopped]);check();return r;}finally{controller.signal.removeEventListener('abort',cb);}}
  try{
   if(!input||types.isProxy(input))fail('APPLICATION_PREPARE_INVALID');const q=own(input,['credential','scope','mediaId','source','requestId','stage','angle',...(Object.hasOwn(input,'signal')?['signal']:[])]);
   if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential)||!id(q.mediaId)||!id(q.requestId)||!['before','after'].includes(q.stage)||!['front','back','left','right'].includes(q.angle))fail('APPLICATION_PREPARE_INVALID');
   const scope=freeze(validateProductionDesignScope(copy(q.scope))),reference=validateManagedContentManifestReference(q.source),base={credential:q.credential,scope},selector={...base,requestId:q.requestId};
   external=q.signal;if(external!==undefined){if(types.isProxy(external))fail('APPLICATION_PREPARE_INVALID');aborted.call(external);listener=()=>stop('APPLICATION_PREPARE_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('APPLICATION_PREPARE_TIMEOUT'),Math.max(1,deadline-performance.now()));
   let source;
   async function freshSource(){const p=copy(await step(()=>readSource({...base,reference})));exact(p,['sourceBinding','sourceManifest']);p.sourceManifest=validateManagedContentManifest(p.sourceManifest,{scope});p.sourceBinding=validateManagedApplicationSourceBinding(p.sourceBinding,p.sourceManifest);if(p.sourceBinding.mediaId!==q.mediaId||p.sourceBinding.stage!==q.stage||p.sourceBinding.angle!==q.angle||!equal(managedContentManifestReference(p.sourceManifest),reference)||source&&!equal(p,source))fail('APPLICATION_PREPARE_DENIED');source=freeze(p);return source;}
   await freshSource();
   const intent=createManagedApplicationProcessingIntent({requestId:q.requestId,authority:source.sourceManifest.authority,...source});
   async function fresh(){await freshSource();if(await step(()=>guard({...base,intent}))!==true)fail('APPLICATION_PREPARE_DENIED');}
   const dto=(state,taskId=null)=>freeze({schemaVersion:'design-application-view-prepare-status-v1',requestId:q.requestId,state,taskId,source:{mediaId:q.mediaId,reference,stage:q.stage,angle:q.angle},synthetic:true,modelDispatched:false});
   function bound(v){const b=validateClaimedApplicationNormalizationArtifact(v);if(b.artifact.requestId!==q.requestId||!equal(b.artifact.sourceManifest,source.sourceManifest)||!equal(b.artifact.sourceBinding,source.sourceBinding))fail('APPLICATION_PREPARE_DENIED');return b;}
   function claim(v){if(v===null)return null;const p=copy(v);exact(p,['claimId','permissionId','intentDigest','artifactDigest']);if(p.intentDigest!==digest(intent)||p.claimId!=='normalization-claim-'+p.intentDigest||!id(p.permissionId)||p.artifactDigest!==null&&(typeof p.artifactDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.artifactDigest)))fail('APPLICATION_PREPARE_DENIED');return p;}
   async function packetFor(b){const taskId=managedApplicationPreparationTaskId(b);await fresh();const p=copy(await step(()=>query({...base,taskId})));if(p===null)return dto('pending');exact(p,['task','report']);const t=validateManagedApplicationStrictTask(p.task);if(t.taskId!==taskId||!equal(t.claimedArtifact,b))fail('APPLICATION_PREPARE_DENIED');if(p.report===null)return dto('pending');const r=validateManagedApplicationStrictReport(p.report,t);return dto(r.state==='evidence_complete'?'ready':r.state==='validation_failed'?'failed':'pending',r.state==='evidence_complete'?taskId:null);}
   const prior=claim(await step(()=>readClaim(selector)));
   if(prior!==null){if(prior.artifactDigest===null){await fresh();return dto('pending');}const b=bound(await step(()=>readBound(selector)));if(digest(b.artifact)!==prior.artifactDigest)fail('APPLICATION_PREPARE_DENIED');return await packetFor(b);}
   if(!prepare){await freshSource();return dto('missing');}
   // Once processing is invoked, a lost response can include a committed claim.
   const result=await step(async()=>{attempted=true;const r=own(await normalize({...base,sourceReference:reference,requestId:q.requestId,signal:controller.signal}),['claimedArtifact','bytes']);
    // Operation returns an owned buffer: copy for our lifetime, erase its transfer
    // even when the enclosing deadline has already fired.
    let b;try{b=bytes(r.bytes);owned.push(b);}finally{if(b)Uint8Array.prototype.fill.call(r.bytes,0);}return {claimedArtifact:bound(r.claimedArtifact),bytes:b};});
   const b=result.claimedArtifact,writeIntent=createManagedApplicationContentWriteIntent({claimedArtifact:b}),expected=createManagedApplicationContentManifest({intent:writeIntent,claimedArtifact:b});
   await fresh();const m=copy(await step(()=>put({...base,requestId:q.requestId,intent:writeIntent,bytes:result.bytes,signal:controller.signal})));if(!equal(m,expected))fail('APPLICATION_PREPARE_DENIED');
   const taskId=managedApplicationPreparationTaskId(b);await fresh();const task=validateManagedApplicationStrictTask(await step(()=>issue({...base,taskId,requestId:q.requestId,normalizedReference:managedApplicationContentManifestReference(expected),ttlMs:c.taskTtlMs})));if(task.taskId!==taskId||!equal(task.claimedArtifact,b)||!equal(task.normalizedManifest,expected))fail('APPLICATION_PREPARE_DENIED');
   await fresh();const v=copy(await step(()=>verify({...base,taskId,signal:controller.signal})));exact(v,['taskId','state','reportDigest']);if(v.taskId!==taskId)fail('APPLICATION_PREPARE_DENIED');return await packetFor(b);
  }catch(e){if(attempted){poisoned=true;throw new ManagedApplicationPrepareError('APPLICATION_PREPARE_UNCERTAIN',true);}const d=e&&!types.isProxy(e)&&e instanceof ManagedApplicationPrepareError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedApplicationPrepareError(d&&Object.hasOwn(d,'value')?d.value:undefined);}
  finally{finished=true;clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);const clear=()=>{for(const b of owned)b.fill(0);busy=false;};if(pending.size){poisoned=true;void(async()=>{while(pending.size)await Promise.allSettled([...pending]);clear();})();}else clear();}
 }
 return Object.freeze({prepare:q=>run(q,true),status:q=>run(q,false)});
}
