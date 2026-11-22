/** Default-closed server-only quarantine byte sink. No HTTP, credentials lookup or decoding.
 * One durable put claim precedes I/O. Unknown put/commit never triggers another put.
 * Readback proves only byte equality, NOT source relationship, decoding or vendor immutability.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {managedImageDigest,managedImageCanonical,MANAGED_IMAGE_CANDIDATE_BUDGETS} from './managed-image-contracts.mjs';
import {validateManagedImageCost} from './managed-image-ledger-contracts.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const safeCodes=new Set(['MANAGED_DERIVED_DISABLED','MANAGED_DERIVED_INVALID','MANAGED_DERIVED_BUSY','MANAGED_DERIVED_DENIED','MANAGED_DERIVED_UNCERTAIN']);
export class ManagedDerivedStoreError extends Error{constructor(code){super(safeCodes.has(code)?code:'MANAGED_DERIVED_DENIED');this.code=this.message;this.outcome=this.code==='MANAGED_DERIVED_UNCERTAIN'?'uncertain':'not_sent';this.retryable=false;}}
const fail=c=>{throw new ManagedDerivedStoreError(c);};
const data=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.sort().join('|'))fail('MANAGED_DERIVED_INVALID');const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('MANAGED_DERIVED_INVALID');out[k]=d.value;}return out;};
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const typedProto=Object.getPrototypeOf(Uint8Array.prototype),typedGet=k=>Object.getOwnPropertyDescriptor(typedProto,k).get;
function snapshotBytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail('MANAGED_DERIVED_INVALID');const buffer=typedGet('buffer').call(v),length=typedGet('byteLength').call(v),offset=typedGet('byteOffset').call(v);if(types.isSharedArrayBuffer(buffer)||length<1||length>524288)fail('MANAGED_DERIVED_INVALID');return Uint8Array.from(new Uint8Array(buffer,offset,length));}
export function createManagedDerivedStore({enabled=false,repository,storage,projectOrigin,bucket,cost,timeoutMs}={}){
 let busy=false;let origin,fixedCost;try{fixedCost=validateManagedImageCost(cost);}catch{}try{const u=new URL(projectOrigin);if(u.origin===projectOrigin&&u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))origin=u.origin;}catch{}
 async function put(input){
  if(enabled!==true)fail('MANAGED_DERIVED_DISABLED');
  if(!fixedCost||!origin||typeof bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(bucket)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!['claimPut','publishObject','readObject','guardPut'].every(k=>typeof repository?.[k]==='function')||!['putImmutable','read'].every(k=>typeof storage?.[k]==='function'))fail('MANAGED_DERIVED_DISABLED');
  if(busy)fail('MANAGED_DERIVED_BUSY');busy=true;
  let bytes,pending=null,uncertain=false,timer,listener;const controller=new AbortController();
  try{
   if(!input||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)fail('MANAGED_DERIVED_INVALID');const names=Reflect.ownKeys(input),q=data(input,['credential','scope','response','bytes',...(names.includes('signal')?['signal']:[])]);
   if(q.signal!==undefined){if(types.isProxy(q.signal))fail('MANAGED_DERIVED_INVALID');if(aborted.call(q.signal))fail('MANAGED_DERIVED_DENIED');listener=()=>controller.abort();EventTarget.prototype.addEventListener.call(q.signal,'abort',listener,{once:true});}
   bytes=snapshotBytes(q.bytes);
   const response=freeze(JSON.parse(managedImageCanonical(q.response))),derivative=response?.descriptor?.derivative;
   if(!derivative||!MANAGED_IMAGE_CANDIDATE_BUDGETS[response?.descriptor?.requestedTransform?.maxEdge]?.[derivative.mime]||bytes.length>MANAGED_IMAGE_CANDIDATE_BUDGETS[response.descriptor.requestedTransform.maxEdge][derivative.mime]||hash(bytes)!==derivative.sha256||bytes.length!==derivative.byteLength)fail('MANAGED_DERIVED_INVALID');
   const responseDigest=managedImageDigest(response),target=freeze({projectOrigin:origin,bucket,key:'managed-derived/'+responseDigest+'/object'}),intent=freeze({schemaVersion:'design-managed-derived-put-intent-v1',response,target,cost:fixedCost});
   timer=setTimeout(()=>controller.abort(),timeoutMs);
   const step=async fn=>{if(controller.signal.aborted)fail(uncertain?'MANAGED_DERIVED_UNCERTAIN':'MANAGED_DERIVED_DENIED');let stop;const stopped=new Promise((_,reject)=>{stop=()=>reject(new ManagedDerivedStoreError(uncertain?'MANAGED_DERIVED_UNCERTAIN':'MANAGED_DERIVED_DENIED'));controller.signal.addEventListener('abort',stop,{once:true});});try{const result=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)fail(uncertain?'MANAGED_DERIVED_UNCERTAIN':'MANAGED_DERIVED_DENIED');return fn();}),stopped]);if(controller.signal.aborted)fail(uncertain?'MANAGED_DERIVED_UNCERTAIN':'MANAGED_DERIVED_DENIED');return result;}finally{controller.signal.removeEventListener('abort',stop);}};
   uncertain=true;const claim=await step(()=>repository.claimPut({credential:q.credential,scope:q.scope,intent}));if(claim!=='created')fail('MANAGED_DERIVED_UNCERTAIN');
   if(await step(()=>repository.guardPut({credential:q.credential,scope:q.scope,intent}))!==true)fail('MANAGED_DERIVED_UNCERTAIN');
   if(controller.signal.aborted)fail('MANAGED_DERIVED_UNCERTAIN');pending=Promise.resolve().then(()=>{if(controller.signal.aborted)fail('MANAGED_DERIVED_UNCERTAIN');return storage.putImmutable({target,derivative,bytes,private:true,overwrite:false,signal:controller.signal});});
   const ack=data(await step(()=>pending),['target','objectVersion','sha256','byteLength','mime','created','private','immutable']);
   if(!same(ack.target,target)||ack.created!==true||ack.private!==true||ack.immutable!==true||typeof ack.objectVersion!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(ack.objectVersion)||ack.sha256!==derivative.sha256||ack.byteLength!==bytes.length||ack.mime!==derivative.mime)fail('MANAGED_DERIVED_UNCERTAIN');
   if(await step(()=>repository.guardPut({credential:q.credential,scope:q.scope,intent}))!==true)fail('MANAGED_DERIVED_UNCERTAIN');
   const object={...target,version:ack.objectVersion};
   if(controller.signal.aborted)fail('MANAGED_DERIVED_UNCERTAIN');pending=Promise.resolve().then(()=>{if(controller.signal.aborted)fail('MANAGED_DERIVED_UNCERTAIN');return storage.read({object,derivative,private:true,signal:controller.signal});});
   const read=snapshotBytes(await step(()=>pending));try{if(read.length!==bytes.length||hash(read)!==derivative.sha256)fail('MANAGED_DERIVED_UNCERTAIN');}finally{read.fill(0);}
   const receipt={schemaVersion:'design-managed-derived-object-v1',responseDigest,object,derivative,private:true,readbackVerified:true};
   const stored=await step(()=>repository.publishObject({credential:q.credential,scope:q.scope,responseDigest,receipt}));if(!same(stored,receipt))fail('MANAGED_DERIVED_UNCERTAIN');
   const current=await step(()=>repository.readObject({credential:q.credential,scope:q.scope,responseDigest}));if(!same(current,receipt))fail('MANAGED_DERIVED_UNCERTAIN');
   return Object.freeze({stored:true,responseDigest});
  }catch(e){if(uncertain)fail('MANAGED_DERIVED_UNCERTAIN');const d=!types.isProxy(e)&&e instanceof ManagedDerivedStoreError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedDerivedStoreError(d&&Object.hasOwn(d,'value')?d.value:'MANAGED_DERIVED_DENIED');}
  finally{clearTimeout(timer);controller.abort();const release=()=>{bytes?.fill(0);busy=false;};if(pending)void pending.then(release,release);else release();if(listener){const d=Object.getOwnPropertyDescriptor(input,'signal');if(d&&Object.hasOwn(d,'value'))EventTarget.prototype.removeEventListener.call(d.value,'abort',listener);}}
 }
 return Object.freeze({put});
}
