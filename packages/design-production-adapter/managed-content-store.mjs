/** Application-level create-only protocol. Default off; no network, credentials,
 * native versions, decoding, backup or WORM guarantees. A real ledger must make
 * claim and publish atomic, fresh-authorized durable transactions. Injected mocks
 * are NOT a durable implementation. Reconcile reads object bytes but may commit
 * the original claim's manifest; it never repeats an object PUT. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {policyCopy,policyFreeze,validatePolicyScope} from './approval-attempt-contracts.mjs';
import {validateManagedContentWriteIntent,validateManagedContentManifestContext,validateManagedContentManifestReference,createManagedContentManifest,managedContentManifestReference,managedContentCanonical,managedContentDigest} from './managed-content-manifest-contracts.mjs';
const codes=new Set(['CONTENT_STORE_DISABLED','CONTENT_STORE_INVALID','CONTENT_STORE_BUSY','CONTENT_STORE_DENIED','CONTENT_STORE_INTEGRITY','CONTENT_STORE_TIMEOUT','CONTENT_STORE_ABORTED','CONTENT_STORE_RECONCILE_REQUIRED','CONTENT_STORE_UNCERTAIN']);
export class ManagedContentStoreError extends Error{constructor(code,outcome='not_sent'){const c=codes.has(code)?code:'CONTENT_STORE_DENIED';super(c);this.code=c;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=c=>{throw new ManagedContentStoreError(c);},hash=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>managedContentCanonical(a)===managedContentCanonical(b);
function own(v,keys,optional=[]){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('CONTENT_STORE_INVALID');const names=[...keys,...optional.filter(k=>Object.hasOwn(v,k))];if(Reflect.ownKeys(v).length!==names.length)fail('CONTENT_STORE_INVALID');const out={};for(const k of names){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('CONTENT_STORE_INVALID');out[k]=d.value;}return out;}
const proto=Object.getPrototypeOf(Uint8Array.prototype),getter=k=>Object.getOwnPropertyDescriptor(proto,k).get;
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail('CONTENT_STORE_INVALID');const n=getter('byteLength').call(v),b=getter('buffer').call(v);if(types.isSharedArrayBuffer(b)||n<1||n>max)fail('CONTENT_STORE_INTEGRITY');return Buffer.from(new Uint8Array(b,getter('byteOffset').call(v),n));}
function methods(v,names){if(!v||types.isProxy(v))return null;const o={};for(const n of names){const d=Object.getOwnPropertyDescriptor(v,n);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))return null;o[n]=d.value.bind(v);}return Object.freeze(o);}
function cleanError(e,uncertain){let c='CONTENT_STORE_DENIED';if(e&&!types.isProxy(e)&&e instanceof ManagedContentStoreError){const d=Object.getOwnPropertyDescriptor(e,'code');if(d&&Object.hasOwn(d,'value')&&codes.has(d.value))c=d.value;}return new ManagedContentStoreError(c,uncertain?'uncertain':'not_sent');}
export function createManagedContentStore(config={}){
 let c,ledger,backend,enabled=false;
 try{c=own(config,['enabled','ledger','backend','timeoutMs','maxBytes']);ledger=methods(c.ledger,['reserve','claim','read','publish','reconcile','authorize']);backend=methods(c.backend,['createOnly','readExact']);enabled=c.enabled===true&&!!ledger&&!!backend&&Number.isSafeInteger(c.timeoutMs)&&c.timeoutMs>0&&c.timeoutMs<=30000&&Number.isSafeInteger(c.maxBytes)&&c.maxBytes>0&&c.maxBytes<=8388608;c=Object.freeze(c);}catch{}
 let busy=false,poisoned=false;
 async function run(mode,input){
  if(!enabled)fail('CONTENT_STORE_DISABLED');if(busy||poisoned)fail('CONTENT_STORE_BUSY');busy=true;
  let owned=null,readOwned=null,delivered=false,mayWrite=false,timer,external,listener,stopped=null,uncertain=false;
  const deadline=performance.now()+c.timeoutMs,controller=new AbortController();let rejectStop;const stoppedPromise=new Promise((_,reject)=>rejectStop=reject);
  const stop=code=>{if(stopped)return;stopped=code;poisoned=true;controller.abort();rejectStop(new ManagedContentStoreError(code,mayWrite?'uncertain':'not_sent'));};
  const check=()=>{if(!stopped&&performance.now()>=deadline)stop('CONTENT_STORE_TIMEOUT');if(stopped)fail(stopped);};
  const work=(async()=>{try{
   const q=own(input,mode==='put'?['credential','scope','requestId','intent','bytes']:mode==='read'?['credential','scope','reference']:['credential','scope','requestId'],['signal']);
   if(typeof q.credential!=='string'||!q.credential||q.credential.length>16384||/\s/.test(q.credential))fail('CONTENT_STORE_INVALID');const scope=validatePolicyScope(q.scope);
   if(mode!=='read'&&(typeof q.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(q.requestId)))fail('CONTENT_STORE_INVALID');
   if(q.signal!==undefined){external=q.signal;if(types.isProxy(external))fail('CONTENT_STORE_INVALID');const abort=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;if(abort.call(external))fail('CONTENT_STORE_ABORTED');listener=()=>stop('CONTENT_STORE_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('CONTENT_STORE_TIMEOUT'),Math.max(1,deadline-performance.now()));check();
   const common={credential:q.credential,scope},reference=mode==='read'?validateManagedContentManifestReference(q.reference):null;
   let intent;if(mode==='put'){intent=validateManagedContentWriteIntent(q.intent,{scope});if(intent.requestId!==q.requestId)fail('CONTENT_STORE_INVALID');if(intent.role!=='source')fail('CONTENT_STORE_DENIED');if(intent.content.byteLength>c.maxBytes)fail('CONTENT_STORE_INTEGRITY');owned=bytes(q.bytes,c.maxBytes);if(owned.length!==intent.content.byteLength||hash(owned)!==intent.content.sha256)fail('CONTENT_STORE_INTEGRITY');}
   // reserve may itself commit even if its reply is lost; never auto-retry it.
   check();if(mode==='put')mayWrite=true;
   const raw=await (mode==='put'?ledger.reserve({...common,requestId:q.requestId,intent}):mode==='read'?ledger.read({...common,reference,purpose:'object_read'}):ledger.reconcile({...common,requestId:q.requestId}));check();
   const ctx=own(policyCopy(raw),['intent','previous','ancestors','claimId','state','manifest']);ctx.intent=validateManagedContentWriteIntent(ctx.intent,{scope});if(intent&&!equal(intent,ctx.intent)||mode!=='read'&&ctx.intent.requestId!==q.requestId)fail('CONTENT_STORE_INTEGRITY');intent=ctx.intent;if(intent.role!=='source')fail('CONTENT_STORE_DENIED');if(intent.content.byteLength>c.maxBytes)fail('CONTENT_STORE_INTEGRITY');
   if(typeof ctx.claimId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(ctx.claimId)||!['reserved','claimed','published'].includes(ctx.state))fail('CONTENT_STORE_INTEGRITY');
   const expected=createManagedContentManifest({intent,previous:ctx.previous,ancestors:ctx.ancestors});validateManagedContentManifestContext({manifest:expected,previous:ctx.previous,ancestors:ctx.ancestors},{scope});
   if(ctx.state==='published'){if(!equal(expected,ctx.manifest))fail('CONTENT_STORE_INTEGRITY');}else if(ctx.manifest!==null)fail('CONTENT_STORE_INTEGRITY');
   if(mode==='read'&&(ctx.state!=='published'||!equal(reference,managedContentManifestReference(expected))))fail('CONTENT_STORE_INTEGRITY');
   // This mode is pinned from a fresh trusted initial state, not caller input.
   // Recovering an unpublished claim still returns its write receipt after CAS.
   const objectRead=mode==='read'||mode==='reconcile'&&ctx.state==='published';
   const binding={...common,requestId:intent.requestId,intentDigest:managedContentDigest(intent),claimId:ctx.claimId};
   const guard=async phase=>{check();if(await ledger.authorize({...binding,phase})!==true)fail('CONTENT_STORE_DENIED');check();};
   if(mode==='put'){
    if(ctx.state!=='reserved'){uncertain=true;fail('CONTENT_STORE_RECONCILE_REQUIRED');}
    await guard('before_claim');const claim=own(policyCopy(await ledger.claim(binding)),['created']);check();if(claim.created!==true){uncertain=true;fail('CONTENT_STORE_RECONCILE_REQUIRED');}
    await guard('before_put');const ack=own(policyCopy(await backend.createOnly({target:intent.target,content:intent.content,bytes:owned,private:true,ifAbsent:true,signal:controller.signal})),['target','created','private']);check();if(ack.created!==true||ack.private!==true||!equal(ack.target,intent.target))fail('CONTENT_STORE_INTEGRITY');
   }else if(mode==='reconcile'&&ctx.state==='reserved')fail('CONTENT_STORE_DENIED');
   await guard(objectRead?'object_read_before':'before_read');const r=own(await backend.readExact({target:intent.target,content:intent.content,maxBytes:intent.content.byteLength,private:true,signal:controller.signal}),['target','content','bytes','private']);
   // Own and wipe late copies, never modify caller/backend-owned buffers.
   readOwned=bytes(r.bytes,c.maxBytes);check();if(r.private!==true||!equal(policyCopy(r.target),intent.target)||!equal(policyCopy(r.content),intent.content)||readOwned.length!==intent.content.byteLength||hash(readOwned)!==intent.content.sha256)fail('CONTENT_STORE_INTEGRITY');
   if(mode!=='read'&&ctx.state!=='published'){await guard('before_publish');mayWrite=true;const published=policyCopy(await ledger.publish({...binding,manifest:expected}));check();if(!equal(published,expected))fail('CONTENT_STORE_INTEGRITY');}
   // Re-read the publication by its exact reference, not an object ACK or cache.
   const fresh=own(policyCopy(await ledger.read({...common,reference:managedContentManifestReference(expected),purpose:objectRead?'object_read':'publication_receipt'})),['intent','previous','ancestors','claimId','state','manifest']);check();if(fresh.state!=='published'||fresh.claimId!==ctx.claimId||!equal(fresh.intent,intent)||!equal(fresh.manifest,expected)||!equal(fresh.previous,ctx.previous)||!equal(fresh.ancestors,ctx.ancestors))fail('CONTENT_STORE_INTEGRITY');
   await guard(objectRead?'object_read_return':'before_return');const manifest=policyFreeze(policyCopy(expected));if(mode==='read'){delivered=true;return Object.freeze({manifest,bytes:readOwned});}return manifest;
  }catch(e){throw cleanError(e,mayWrite||uncertain);}finally{clearTimeout(timer);if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);owned?.fill(0);if(!delivered)readOwned?.fill(0);busy=false;}})();
  // work always retains its handlers/cleanup after a deadline; pending I/O keeps
  // admission occupied. No timeout or unknown result starts another operation.
  return Promise.race([work,stoppedPromise]);
 }
 return Object.freeze({put:q=>run('put',q),read:q=>run('read',q),reconcile:q=>run('reconcile',q)});
}
