/** Separate PNG object, not replacement of its hosted parent. Server-only and
 * default off. The durable PUT claim does NOT authorize/claim earlier decoding.
 * Storage callbacks are trusted version-specific adapters, not a vendor proof.
 * Hash/readback proves byte equality only. No decoder, issuer, model or retry. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
import {validateManagedNormalizedObjectReceipt} from './managed-normalized-verification-contracts.mjs';
import {validateManagedNormalizedPutIntent} from './managed-normalized-ledger.mjs';
import {validateManagedImageCost} from './managed-image-ledger-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const codes=new Set(['MANAGED_NORMALIZED_DISABLED','MANAGED_NORMALIZED_INVALID','MANAGED_NORMALIZED_BUSY','MANAGED_NORMALIZED_DENIED','MANAGED_NORMALIZED_UNCERTAIN']);
export class ManagedNormalizedStoreError extends Error{constructor(code){super(codes.has(code)?code:'MANAGED_NORMALIZED_DENIED');this.code=this.message;this.outcome=this.code==='MANAGED_NORMALIZED_UNCERTAIN'?'uncertain':'not_sent';this.retryable=false;}}
const fail=c=>{throw new ManagedNormalizedStoreError(c);},hash=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const own=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('MANAGED_NORMALIZED_INVALID');const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('MANAGED_NORMALIZED_INVALID');out[k]=d.value;}return out;};
const method=(v,k)=>{if(!v||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)?d.value.bind(v):null;};
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function snapshot(v){if(types.isProxy(v)||!types.isUint8Array(v))fail('MANAGED_NORMALIZED_INVALID');const proto=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(proto,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>524288)fail('MANAGED_NORMALIZED_INVALID');return Uint8Array.from(new Uint8Array(b,get('byteOffset'),n));}
export function createManagedNormalizedStore({enabled=false,repository,storage,projectOrigin,bucket,cost,timeoutMs}={}){
 const calls=Object.fromEntries(['claimPut','guardPut','publishObject','readObject'].map(k=>[k,method(repository,k)])),put=method(storage,'putImmutable'),read=method(storage,'read');
 let fixedCost;try{fixedCost=validateManagedImageCost(cost);}catch{}
 const ready=enabled===true&&fixedCost&&Object.values(calls).every(Boolean)&&put&&read&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;
 let busy=false,poisoned=false;
 return Object.freeze({async put(input){
  if(!ready)fail('MANAGED_NORMALIZED_DISABLED');if(busy||poisoned)fail('MANAGED_NORMALIZED_BUSY');busy=true;
  let bytes,external,listener,timer,uncertain=false;const pending=new Set(),controller=new AbortController(),deadline=performance.now()+timeoutMs;
  const check=()=>{if(performance.now()>=deadline)controller.abort();if(controller.signal.aborted)fail(uncertain?'MANAGED_NORMALIZED_UNCERTAIN':'MANAGED_NORMALIZED_DENIED');};
  const step=async fn=>{check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let onAbort;const stopped=new Promise((_,reject)=>{onAbort=()=>reject(new ManagedNormalizedStoreError(uncertain?'MANAGED_NORMALIZED_UNCERTAIN':'MANAGED_NORMALIZED_DENIED'));controller.signal.addEventListener('abort',onAbort,{once:true});});try{const out=await Promise.race([p,stopped]);check();return out;}finally{controller.signal.removeEventListener('abort',onAbort);}};
  try{
   if(!input||types.isProxy(input))fail('MANAGED_NORMALIZED_INVALID');const q=own(input,['credential','scope','artifact','bytes',...(Object.hasOwn(input,'signal')?['signal']:[])]);
   if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential))fail('MANAGED_NORMALIZED_INVALID');
   const scope=validateProductionDesignScope(JSON.parse(managedImageCanonical(q.scope))),artifact=validateManagedImageNormalizationArtifact(q.artifact);
   if(!equal(scope,artifact.authority.scope))fail('MANAGED_NORMALIZED_INVALID');
   // Single snapshot before any await. Mutable caller data never controls a late write.
   bytes=snapshot(q.bytes);if(bytes.length!==artifact.output.byteLength||hash(bytes)!==artifact.output.sha256)fail('MANAGED_NORMALIZED_INVALID');
   const artifactDigest=managedImageDigest(artifact),target={projectOrigin,bucket,key:'managed-normalized/'+artifactDigest+'/object'},intent=validateManagedNormalizedPutIntent({schemaVersion:'design-managed-normalized-put-intent-v1',artifact,target,cost:fixedCost});
   external=q.signal;if(external!==undefined){if(types.isProxy(external))fail('MANAGED_NORMALIZED_INVALID');if(aborted.call(external))fail('MANAGED_NORMALIZED_DENIED');listener=()=>controller.abort();EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>controller.abort(),timeoutMs);check();
   uncertain=true;const claim=await step(()=>calls.claimPut({credential:q.credential,scope,intent}));if(claim!=='created')fail('MANAGED_NORMALIZED_UNCERTAIN');
   const guard=async()=>{if(await step(()=>calls.guardPut({credential:q.credential,scope,intent}))!==true)fail('MANAGED_NORMALIZED_UNCERTAIN');};
   await guard();
   const ack=own(await step(()=>put({target:intent.target,output:artifact.output,bytes,private:true,overwrite:false,signal:controller.signal})),['target','objectVersion','sha256','byteLength','mime','created','private','immutable']);
   if(!equal(ack.target,intent.target)||ack.created!==true||ack.private!==true||ack.immutable!==true||typeof ack.objectVersion!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(ack.objectVersion)||ack.sha256!==artifact.output.sha256||ack.byteLength!==bytes.length||ack.mime!=='image/png'||hash(bytes)!==artifact.output.sha256)fail('MANAGED_NORMALIZED_UNCERTAIN');
   await guard();const object={...intent.target,version:ack.objectVersion};
   const readback=snapshot(await step(()=>read({object,output:artifact.output,private:true,signal:controller.signal})));
   try{if(readback.length!==bytes.length||hash(readback)!==artifact.output.sha256)fail('MANAGED_NORMALIZED_UNCERTAIN');}finally{readback.fill(0);}
   const receipt=validateManagedNormalizedObjectReceipt({schemaVersion:'design-managed-normalized-object-v1',artifactDigest,object,output:artifact.output,private:true,readbackVerified:true},{artifact});
   const stored=await step(()=>calls.publishObject({credential:q.credential,scope,artifactDigest,receipt}));if(!equal(stored,receipt))fail('MANAGED_NORMALIZED_UNCERTAIN');
   const current=await step(()=>calls.readObject({credential:q.credential,scope,artifactDigest}));if(!equal(current,receipt))fail('MANAGED_NORMALIZED_UNCERTAIN');
   if(hash(bytes)!==artifact.output.sha256)fail('MANAGED_NORMALIZED_UNCERTAIN');check();
   return Object.freeze({stored:true,artifactDigest});
  }catch(e){if(uncertain){poisoned=true;fail('MANAGED_NORMALIZED_UNCERTAIN');}const d=!types.isProxy(e)&&e instanceof ManagedNormalizedStoreError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedNormalizedStoreError(d&&Object.hasOwn(d,'value')?d.value:'MANAGED_NORMALIZED_DENIED');}
  finally{clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);const release=()=>{bytes?.fill(0);busy=false;};if(pending.size)void Promise.allSettled([...pending]).then(release);else release();}
 }});
}
