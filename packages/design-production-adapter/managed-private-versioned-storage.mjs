/** Server-only, default-closed adapter for an explicitly qualified backend.
 * No fetch, URLs supplied by callers, environment lookup, credentials, issuer,
 * upsert, deletion or retry. This module does NOT qualify Supabase or any vendor.
 *
 * The backend contract below is a TRUSTED DEPLOYMENT ASSERTION, not evidence.
 * createOnce must atomically reject an existing key; readVersion must address the
 * requested retained immutable native version, not latest-by-path or an ETag.
 * A backend lacking either guarantee MUST NOT supply this contract. No cloud
 * implementation is provided. Mock tests establish only protocol behaviour.
 *
 * authorize is a server closure over the current immutable authority and exact
 * independent storage approval. It is called afresh before/after each I/O and
 * before return, never cached. It does not replace the calling store's durable
 * claim/ancestry guards. Credentials stay entirely inside the injected backend.
 * Hash/readback proves byte equality only, not decoding or immutability.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';

export const PRIVATE_VERSIONED_BACKEND_SCHEMA='design-private-versioned-backend-v1';
const CODES=new Set(['PRIVATE_VERSIONED_DISABLED','PRIVATE_VERSIONED_INVALID','PRIVATE_VERSIONED_BUSY','PRIVATE_VERSIONED_DENIED','PRIVATE_VERSIONED_INTEGRITY','PRIVATE_VERSIONED_TIMEOUT','PRIVATE_VERSIONED_ABORTED','PRIVATE_VERSIONED_UNCERTAIN']);
export class ManagedPrivateVersionedStorageError extends Error {
 constructor(code='PRIVATE_VERSIONED_DENIED'){const c=CODES.has(code)?code:'PRIVATE_VERSIONED_DENIED';super(c);this.code=c;this.outcome=c==='PRIVATE_VERSIONED_UNCERTAIN'?'uncertain':'not_sent';this.retryable=false;}
}
const fail=c=>{throw new ManagedPrivateVersionedStorageError(c);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b); // only our fixed-order projections
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function own(v,keys){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('PRIVATE_VERSIONED_INVALID');
 const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('PRIVATE_VERSIONED_INVALID');out[k]=d.value;}return out;
}
function optional(v,names){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('PRIVATE_VERSIONED_INVALID');return names.filter(k=>Object.hasOwn(v,k));}
function method(v,name){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)return null;const d=Object.getOwnPropertyDescriptor(v,name);return d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)?(...a)=>Reflect.apply(d.value,v,a):null;}
function bytes(v,max){
 if(types.isProxy(v)||!types.isUint8Array(v))fail('PRIVATE_VERSIONED_INVALID');const b=get('buffer').call(v),n=get('byteLength').call(v);
 if(types.isSharedArrayBuffer(b)||n<1||n>max)fail('PRIVATE_VERSIONED_INVALID');return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));
}
function content(v,kind){
 const c=own(v,['sha256','byteLength','mime',...(kind==='output'?['width','height']:[])]);
 if(typeof c.sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.sha256)||!Number.isSafeInteger(c.byteLength)||c.byteLength<1||c.byteLength>(kind==='source'?IMAGE_UPLOAD_MAX_BYTES:kind==='output'?524288:IMAGE_UPLOAD_MAX_BYTES)||!['image/png','image/jpeg','image/webp'].includes(c.mime))fail('PRIVATE_VERSIONED_INVALID');
 if(kind==='output'&&(c.mime!=='image/png'||!Number.isSafeInteger(c.width)||!Number.isSafeInteger(c.height)||c.width<1||c.height<1||c.width>1536||c.height>1536))fail('PRIVATE_VERSIONED_INVALID');
 return frozen(c);
}
function destination(v,version,origin,bucket){
 const t=own(v,['projectOrigin','bucket','key',...(version?['version']:[])]);
 if(t.projectOrigin!==origin||t.bucket!==bucket||typeof t.key!=='string'||!/^managed-(?:quarantine\/[a-f0-9]{64}\/source|derived\/[a-f0-9]{64}\/object|normalized\/[a-f0-9]{64}\/object)$/.test(t.key))fail('PRIVATE_VERSIONED_INVALID');
 if(version&&(typeof t.version!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(t.version)))fail('PRIVATE_VERSIONED_INVALID');return frozen(t);
}
function safeError(e){if(!types.isProxy(e)&&e instanceof ManagedPrivateVersionedStorageError){const d=Object.getOwnPropertyDescriptor(e,'code');if(d&&Object.hasOwn(d,'value'))return new ManagedPrivateVersionedStorageError(d.value);}return new ManagedPrivateVersionedStorageError();}

export function createManagedPrivateVersionedStorage(config={}){
 let cfg,createOnce,readVersion,authorize,ready=false;
 try{
  cfg=own(config,['enabled','projectOrigin','bucket','backend','authorize','timeoutMs']);
  const u=new URL(cfg.projectOrigin);if(cfg.enabled!==true||u.origin!==cfg.projectOrigin||u.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)||typeof cfg.bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(cfg.bucket)||!Number.isSafeInteger(cfg.timeoutMs)||cfg.timeoutMs<1||cfg.timeoutMs>30000)throw 0;
  const b=own(cfg.backend,['contract','createOnce','readVersion']);
  const c=own(b.contract,['schemaVersion','atomicCreateOnly','versionAddressedReads','retainedVersionsImmutable','privateOnly']);
  if(c.schemaVersion!==PRIVATE_VERSIONED_BACKEND_SCHEMA||['atomicCreateOnly','versionAddressedReads','retainedVersionsImmutable','privateOnly'].some(k=>c[k]!==true))throw 0;
  createOnce=method(cfg.backend,'createOnce');readVersion=method(cfg.backend,'readVersion');authorize=typeof cfg.authorize==='function'&&!types.isProxy(cfg.authorize)?cfg.authorize:null;
  ready=!!(createOnce&&readVersion&&authorize);cfg={projectOrigin:cfg.projectOrigin,bucket:cfg.bucket,timeoutMs:cfg.timeoutMs};
 }catch{ready=false;}
 let busy=false,poisoned=false;
 async function run(input,write){
  if(!ready)fail('PRIVATE_VERSIONED_DISABLED');if(busy||poisoned)fail('PRIVATE_VERSIONED_BUSY');busy=true;
  let external,listener,timer,owned,resultBytes,reader,mutating=false,reason=null,resolveStop;
  const controller=new AbortController(),deadline=performance.now()+cfg.timeoutMs,stopped=new Promise(r=>{resolveStop=r;});
  const stop=code=>{if(!reason){reason=code;controller.abort();resolveStop(new ManagedPrivateVersionedStorageError(mutating?'PRIVATE_VERSIONED_UNCERTAIN':code));}};
  const check=()=>{if(external&&aborted.call(external))stop('PRIVATE_VERSIONED_ABORTED');if(performance.now()>=deadline)stop('PRIVATE_VERSIONED_TIMEOUT');if(reason)fail(mutating?'PRIVATE_VERSIONED_UNCERTAIN':reason);};
  const step=async fn=>{check();const value=await fn();check();return value;};
  const work=(async()=>{try{
   const variants=optional(input,['source','derivative','output']);if(variants.length!==1)fail('PRIVATE_VERSIONED_INVALID');const kind=variants[0],extras=optional(input,['requestId','signal']);
   const q=own(input,[write?'target':'object',kind,...(write?['bytes','overwrite']:[]),'private',...extras]);
   if(q.private!==true||write&&q.overwrite!==false||(!write||kind!=='source')&&Object.hasOwn(q,'requestId'))fail('PRIVATE_VERSIONED_INVALID');
   if(Object.hasOwn(q,'requestId')&&(typeof q.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(q.requestId)))fail('PRIVATE_VERSIONED_INVALID');
   const c=content(q[kind],kind),object=destination(q[write?'target':'object'],!write,cfg.projectOrigin,cfg.bucket),{version,...plainTarget}=object,target=frozen(plainTarget);
   if(write&&!target.key.startsWith({source:'managed-quarantine/',derivative:'managed-derived/',output:'managed-normalized/'}[kind]))fail('PRIVATE_VERSIONED_INVALID');
   const max=target.key.startsWith('managed-quarantine/')?IMAGE_UPLOAD_MAX_BYTES:524288;if(c.byteLength>max)fail('PRIVATE_VERSIONED_INVALID');
   if(write){owned=bytes(q.bytes,c.byteLength);if(owned.length!==c.byteLength||hash(owned)!==c.sha256)fail('PRIVATE_VERSIONED_INTEGRITY');}
   if(Object.hasOwn(q,'signal')){external=q.signal;if(types.isProxy(external))fail('PRIVATE_VERSIONED_INVALID');aborted.call(external);listener=()=>stop('PRIVATE_VERSIONED_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('PRIVATE_VERSIONED_TIMEOUT'),Math.max(1,deadline-performance.now()));check();
   const declared=frozen({sha256:c.sha256,byteLength:c.byteLength,mime:c.mime}),requestId=q.requestId??null;
   const guard=async(operation,phase,objectVersion)=>{if(await step(()=>authorize(Object.freeze({operation,phase,target,objectVersion,content:declared,requestId,signal:controller.signal})))!==true)fail('PRIVATE_VERSIONED_DENIED');};
   async function readExact(exactObject){
    await guard('read','before_io',exactObject.version);
    check();const raw=await readVersion(Object.freeze({object:exactObject,private:true,maxBytes:c.byteLength,signal:controller.signal}));
    // Also take ownership of a late/invalid response stream so it is cancelled
    // in finally, without invoking a response accessor or following any URL.
    const bodyDescriptor=raw&&!types.isProxy(raw)?Object.getOwnPropertyDescriptor(raw,'body'):null;
    const body=bodyDescriptor&&Object.hasOwn(bodyDescriptor,'value')?bodyDescriptor.value:null;
    if(body&&!types.isProxy(body)&&body instanceof ReadableStream)reader=ReadableStream.prototype.getReader.call(body);
    check();
    const r=own(raw,['object','private','mime','body']);
    if(!equal(destination(r.object,true,cfg.projectOrigin,cfg.bucket),exactObject)||r.private!==true||r.mime!==c.mime)fail('PRIVATE_VERSIONED_INTEGRITY');
    // A response is streamed and bounded here as well as at the trusted backend.
    if(!reader)fail('PRIVATE_VERSIONED_INVALID');const chunks=[];let size=0,n=0;
    try{for(;;){const item=await step(()=>reader.read());if(++n>4096)fail('PRIVATE_VERSIONED_INTEGRITY');if(item.done)break;const b=bytes(item.value,c.byteLength);size+=b.length;if(size>c.byteLength){b.fill(0);fail('PRIVATE_VERSIONED_INTEGRITY');}chunks.push(b);}resultBytes=Buffer.concat(chunks,size);}finally{for(const b of chunks)b.fill(0);}
    reader.releaseLock();reader=null;
    if(resultBytes.length!==c.byteLength||hash(resultBytes)!==c.sha256)fail('PRIVATE_VERSIONED_INTEGRITY');
    await guard('read','after_io',exactObject.version);return resultBytes;
   }
   if(write){
    await guard('create','before_io',null);check();mutating=true;
    const raw=await step(()=>createOnce(Object.freeze({target,content:declared,bytes:owned,private:true,ifAbsent:true,signal:controller.signal})));
    const ack=own(raw,['target','version','created','private']);
    if(!equal(destination(ack.target,false,cfg.projectOrigin,cfg.bucket),target)||ack.created!==true||ack.private!==true)fail('PRIVATE_VERSIONED_INTEGRITY');
    const actual=destination({...target,version:ack.version},true,cfg.projectOrigin,cfg.bucket);
    if(hash(owned)!==c.sha256)fail('PRIVATE_VERSIONED_INTEGRITY');await guard('create','after_io',actual.version);
    await readExact(actual);await guard('create','before_return',actual.version);check();
    return frozen({target,objectVersion:actual.version,...declared,created:true,private:true,immutable:true});
   }
   await readExact(object);await guard('read','before_return',object.version);check();const out=Uint8Array.from(resultBytes);return out;
  }catch(e){if(mutating){poisoned=true;throw new ManagedPrivateVersionedStorageError('PRIVATE_VERSIONED_UNCERTAIN');}throw safeError(e);}
  finally{
   clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);
   // Admission and owned buffers remain held until pending backend/reader work
   // actually settles. A backend which ignores abort cannot grow memory per call.
   if(reader){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}
   owned?.fill(0);resultBytes?.fill(0);busy=false;
  }})();
  const outcome=await Promise.race([work.then(value=>({value}),error=>({error})),stopped.then(error=>({error}))]);
  if(outcome.error){if(mutating)poisoned=true;throw outcome.error;}return outcome.value;
 }
 return Object.freeze({putImmutable:q=>run(q,true),read:q=>run(q,false)});
}
