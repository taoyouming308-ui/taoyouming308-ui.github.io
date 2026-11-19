/**
 * Server-only, default-closed Supabase transform preparation. No network default.
 * This is NOT the private image decoder or the metadata-stripped derivative API.
 * Nothing returned here is eligible for a model candidate or public image.
 *
 * The trusted resolver must freshly authorize the full immutable principal/scope
 * and supply immutable storage metadata, including independently verified source
 * orientation and display-oriented dimensions (not an untrusted boolean). Its
 * immutable/version assertion is not
 * proof that the hosted transform read those bytes: SDK version pinning, EXIF,
 * geometry, color and full decode are deliberately NOT certified by this module.
 * Pre/post equality also cannot detect replacement-and-restoration during I/O.
 *
 * All dependencies are server-owned. claimAttempt must atomically reserve the
 * immutable principal + requestId + exact intent in a durable store and return
 * 'created' only once. No approval is issued here; no failed claim is retried.
 * credential is ephemeral current-auth input, NEVER persisted in that ledger;
 * store only immutable principal/request/intent digest and required audit data.
 * An existing approval cannot be silently reused or renewed by this adapter.
 * transport must use only the fixed authenticated download target, attach its
 * own server credential, honor abort and never retry/log/persist a signed URL.
 * Only a bounded stream is accepted. Bytes are discarded after hashing.
 * authorize and approveCost are separate current checks; finalGuard must then
 * atomically/compositely recheck the exact source/identity/processing/cost intent.
 * It is the last awaited verifier at each gate, not a cached grant. A real
 * composite repository is required before activation. This does not guarantee
 * authorization at an absolute remote receive/charge time or undo a sent call.
 *
 * Reference: https://supabase.com/docs/guides/storage/serving/image-transformations
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';

export const MANAGED_IMAGE_TRANSFORM_SCHEMA='design-managed-image-transform-v1';
const CODES=new Set(['MANAGED_TRANSFORM_DISABLED','MANAGED_TRANSFORM_INVALID','MANAGED_TRANSFORM_SOURCE_INVALID','MANAGED_TRANSFORM_SOURCE_CHANGED','MANAGED_TRANSFORM_SOURCE_ORIENTATION_REQUIRED','MANAGED_TRANSFORM_ACCESS_DENIED','MANAGED_TRANSFORM_COST_DENIED','MANAGED_TRANSFORM_ALREADY_CLAIMED','MANAGED_TRANSFORM_TIMEOUT','MANAGED_TRANSFORM_ABORTED','MANAGED_TRANSFORM_RESPONSE_INVALID','MANAGED_TRANSFORM_BYTES_LIMIT','MANAGED_TRANSFORM_UNAVAILABLE']);
export class ManagedImageTransformError extends Error{
 constructor(code,outcome='not_sent'){const safe=CODES.has(code)?code:'MANAGED_TRANSFORM_UNAVAILABLE';super(safe);this.name='ManagedImageTransformError';this.code=safe;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}
}
const fail=code=>{throw new ManagedImageTransformError(code);};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function own(v,keys){
 if(types.isProxy(v)||!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)fail('MANAGED_TRANSFORM_INVALID');
 const names=Reflect.ownKeys(v);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))fail('MANAGED_TRANSFORM_INVALID');
 const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('MANAGED_TRANSFORM_INVALID');out[key]=d.value;}return out;
}
// Only small JSON metadata reaches validators. Copy before reading caller fields.
function json(v){let count=0,bytes=0;function walk(x,depth){
 if(++count>256||depth>8||types.isProxy(x))fail('MANAGED_TRANSFORM_INVALID');
 if(x===null||['boolean','number','string'].includes(typeof x)){if(typeof x==='string'&&x.length>8192||typeof x==='number'&&(!Number.isFinite(x)||Object.is(x,-0)))fail('MANAGED_TRANSFORM_INVALID');bytes+=Buffer.byteLength(JSON.stringify(x));if(bytes>16384)fail('MANAGED_TRANSFORM_INVALID');return x;}
 if(!x||typeof x!=='object'||Object.getPrototypeOf(x)!==Object.prototype)fail('MANAGED_TRANSFORM_INVALID');
 const names=Reflect.ownKeys(x);if(names.length>24)fail('MANAGED_TRANSFORM_INVALID');const out={};for(const k of names){if(typeof k!=='string'||!text(k,80)||['__proto__','constructor','prototype'].includes(k))fail('MANAGED_TRANSFORM_INVALID');const d=Object.getOwnPropertyDescriptor(x,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('MANAGED_TRANSFORM_INVALID');out[k]=walk(d.value,depth+1);}return out;
 }return walk(v,0);}
function source(value,request,origin,bucket){
 const v=json(value);own(v,['authority','mediaId','projectOrigin','bucket','objectKey','objectVersion','expectedSourceSha256','mime','byteLength','width','height','orientation','immutable','active']);
 v.authority=validateImmutableDesignAuthority(v.authority);
 if(!same(v.authority.scope,request.scope)||v.mediaId!==request.mediaId||v.projectOrigin!==origin||v.bucket!==bucket||v.immutable!==true||v.active!==true||!text(v.objectVersion,160)||!/^[A-Za-z0-9._-]+$/.test(v.objectVersion)||!text(v.objectKey,1024)||v.objectKey.split('/').some(s=>!s||s==='.'||s==='..'||!/^[A-Za-z0-9._-]+$/.test(s))||!/^\w[\w./-]*$/.test(v.objectKey)||typeof v.expectedSourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedSourceSha256)||!['image/jpeg','image/png','image/webp'].includes(v.mime)||!integer(v.byteLength,1,PRIVATE_MEDIA_MAX_BYTES)||!integer(v.width,1,16384)||!integer(v.height,1,16384)||v.width*v.height>40000000||!['confirmed','unverified'].includes(v.orientation))fail('MANAGED_TRANSFORM_SOURCE_INVALID');
 if(v.orientation!=='confirmed')fail('MANAGED_TRANSFORM_SOURCE_ORIENTATION_REQUIRED');
 return freeze(v);
}
function sniff(bytes,mime){
 if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes.length>=8&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 return bytes.length>=12&&Buffer.from(bytes.subarray(0,4)).toString('ascii')==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString('ascii')==='WEBP';
}
const abortedGetter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const signalAborted=s=>abortedGetter.call(s);
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedGet=name=>Object.getOwnPropertyDescriptor(typedPrototype,name).get;
const byteLength=typedGet('byteLength'),byteOffset=typedGet('byteOffset'),arrayBuffer=typedGet('buffer');
function cancelBody(body){try{Promise.resolve(ReadableStream.prototype.cancel.call(body)).catch(()=>{});}catch{}}
// Cleanup must not depend on accepting the response's shape. Never read getters.
function ownBody(raw){if(types.isProxy(raw)||raw===null||typeof raw!=='object')return null;try{const d=Object.getOwnPropertyDescriptor(raw,'body');return d&&Object.hasOwn(d,'value')?d.value:null;}catch{return null;}}

export function createManagedImageTransform({enabled=false,projectOrigin,bucket,resolveSource,authorize,approveCost,finalGuard,claimAttempt,transport,timeoutMs,maxResponseBytes,derivativePersistenceEnabled=false,persistDerivative}={}){
 let origin=null;try{const u=new URL(projectOrigin);if(u.protocol==='https:'&&u.origin===projectOrigin&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))origin=u.origin;}catch{}
 const ready=()=>{if(enabled!==true||!origin||!text(bucket,100)||!/^[A-Za-z0-9_-]+$/.test(bucket)||!integer(timeoutMs,1,30000)||!integer(maxResponseBytes,1,PRIVATE_MEDIA_MAX_BYTES)||![resolveSource,authorize,approveCost,finalGuard,claimAttempt,transport].every(v=>typeof v==='function')||derivativePersistenceEnabled===true&&typeof persistDerivative!=='function')fail('MANAGED_TRANSFORM_DISABLED');};
 return Object.freeze({async transform(input){
  ready();let request,externalSignal;
  try{if(types.isProxy(input))fail('MANAGED_TRANSFORM_INVALID');const names=Reflect.ownKeys(input);const v=own(input,['credential','scope','mediaId','requestId','maxEdge',...(names.includes('signal')?['signal']:[])]);externalSignal=v.signal;
   if(externalSignal!==undefined){if(types.isProxy(externalSignal))fail('MANAGED_TRANSFORM_INVALID');signalAborted(externalSignal);}
   const scope=validateProductionDesignScope(json(v.scope));if(!text(v.credential,4096)||!text(v.mediaId,160)||!text(v.requestId,160)||![1024,1536].includes(v.maxEdge))fail('MANAGED_TRANSFORM_INVALID');request=freeze({credential:v.credential,scope,mediaId:v.mediaId,requestId:v.requestId,maxEdge:v.maxEdge});
  }catch{fail('MANAGED_TRANSFORM_INVALID');}
  const controller=new AbortController(),started=performance.now(),deadline=started+timeoutMs;
  let reason=null,timer,reader=null,unclaimedBody=null,claimPending=false,transportStarted=false,bytes=null;const chunks=[];
  const abort=code=>{if(!reason){reason=code;controller.abort();}};
  const onAbort=()=>abort('MANAGED_TRANSFORM_ABORTED');
  const check=()=>{if(externalSignal&&signalAborted(externalSignal))onAbort();if(performance.now()>=deadline)abort('MANAGED_TRANSFORM_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();let remove;const stopped=new Promise((_,reject)=>{const listener=()=>reject(new ManagedImageTransformError(reason||'MANAGED_TRANSFORM_ABORTED'));controller.signal.addEventListener('abort',listener,{once:true});remove=()=>controller.signal.removeEventListener('abort',listener);});
   try{const result=await Promise.race([Promise.resolve().then(()=>{check();return fn();}),stopped]);check();return result;}finally{remove();}}
  try{
   if(externalSignal)EventTarget.prototype.addEventListener.call(externalSignal,'abort',onAbort,{once:true});timer=setTimeout(()=>abort('MANAGED_TRANSFORM_TIMEOUT'),timeoutMs);check();
   const load=async phase=>source(await step(()=>resolveSource(freeze({credential:request.credential,scope:request.scope,mediaId:request.mediaId,phase}),controller.signal)),request,origin,bucket);
   const fixed=await load('initial');const scale=Math.min(1,request.maxEdge/Math.max(fixed.width,fixed.height));
   const transform=freeze({width:Math.max(1,Math.floor(fixed.width*scale)),height:Math.max(1,Math.floor(fixed.height*scale)),resize:'contain',format:'origin',quality:80});
   const intent=freeze({schemaVersion:'design-managed-image-transform-intent-v1',requestId:request.requestId,purpose:'private_image_managed_transform_quarantine',recipient:origin,bucket,source:fixed,maxEdge:request.maxEdge,transform,maxResponseBytes});
   async function gate(phase){
    if(!same(await load(phase),fixed))fail('MANAGED_TRANSFORM_SOURCE_CHANGED');
    if(await step(()=>authorize(freeze({credential:request.credential,intent,phase}),controller.signal))!==true)fail('MANAGED_TRANSFORM_ACCESS_DENIED');
    if(await step(()=>approveCost(freeze({credential:request.credential,intent,phase}),controller.signal))!==true)fail('MANAGED_TRANSFORM_COST_DENIED');
    // Resolver must freshly check current source access, not merely return a cache.
    if(!same(await load(phase),fixed))fail('MANAGED_TRANSFORM_SOURCE_CHANGED');
    // Source resolution may itself wait: independent earlier checks are not an
    // authority cache. This final composite gate must recheck ALL exact facts.
    if(await step(()=>finalGuard(freeze({credential:request.credential,intent,phase}),controller.signal))!==true)fail('MANAGED_TRANSFORM_ACCESS_DENIED');
   }
   await gate('before_claim');claimPending=true;
   const claimed=await step(()=>claimAttempt(freeze({credential:request.credential,intent}),controller.signal));claimPending=false;
   if(claimed!=='created')fail('MANAGED_TRANSFORM_ALREADY_CLAIMED');
   await gate('before_transport');
   const path=fixed.objectKey.split('/').map(encodeURIComponent).join('/');
   const url=origin+'/storage/v1/render/image/authenticated/'+encodeURIComponent(bucket)+'/'+path+'?'+new URLSearchParams(Object.entries(transform).map(([k,v])=>[k,String(v)])).toString();
   // No guessed version query/header. expectedObjectVersion is a server transport
   // precondition, NOT a claim that hosted Storage enforces a versioned read.
   let reply=await step(()=>{transportStarted=true;return Promise.resolve(transport(Object.freeze({url,method:'GET',redirect:'error',credentials:'omit',cache:'no-store',headers:Object.freeze({Accept:fixed.mime}),expectedObjectVersion:fixed.objectVersion,expectedSourceSha256:fixed.expectedSourceSha256,maxResponseBytes,signal:controller.signal}))).then(raw=>{if(controller.signal.aborted)cancelBody(ownBody(raw));return raw;});});
   unclaimedBody=ownBody(reply);
   reply=own(reply,['url','status','redirected','mime','body']);
   unclaimedBody=reply.body;
   if(reply.url!==url||reply.status!==200||reply.redirected!==false||reply.mime!==fixed.mime||types.isProxy(reply.body))fail('MANAGED_TRANSFORM_RESPONSE_INVALID');
   try{reader=ReadableStream.prototype.getReader.call(reply.body);unclaimedBody=null;}catch{fail('MANAGED_TRANSFORM_RESPONSE_INVALID');}
   let length=0,chunkCount=0;
   while(true){const part=await step(()=>reader.read());if(part.done)break;const chunk=part.value;
    if(types.isProxy(chunk)||!types.isUint8Array(chunk))fail('MANAGED_TRANSFORM_RESPONSE_INVALID');const buffer=arrayBuffer.call(chunk);
    if(types.isSharedArrayBuffer(buffer))fail('MANAGED_TRANSFORM_RESPONSE_INVALID');const size=byteLength.call(chunk);
    length+=size;if(length>maxResponseBytes||++chunkCount>4096)fail('MANAGED_TRANSFORM_BYTES_LIMIT');chunks.push(Buffer.from(new Uint8Array(buffer,byteOffset.call(chunk),size)));
   }
   if(!length)fail('MANAGED_TRANSFORM_RESPONSE_INVALID');bytes=Buffer.concat(chunks,length);chunks.forEach(c=>c.fill(0));
   if(!sniff(bytes,reply.mime))fail('MANAGED_TRANSFORM_RESPONSE_INVALID');
   const derivative=freeze({sha256:sha(bytes),byteLength:length,mime:reply.mime});
   await gate('after_response');check();
   const descriptor=freeze({schemaVersion:MANAGED_IMAGE_TRANSFORM_SCHEMA,state:'pending_validation',requestId:request.requestId,mediaId:request.mediaId,
    source:{bindingDigest:sha(canonical(fixed)),objectVersion:fixed.objectVersion,expectedSourceSha256:fixed.expectedSourceSha256,mime:fixed.mime,byteLength:fixed.byteLength,width:fixed.width,height:fixed.height,orientation:fixed.orientation},
    requestedTransform:{maxEdge:request.maxEdge,...transform},derivative,
    validation:{sourceBytes:'not_verified',immutableObject:'trusted_resolver_assertion',derivativeSource:'not_verified',fullDecode:'not_verified',metadataRemoval:'not_verified',orientation:'not_verified',color:'not_verified',geometry:'not_verified',candidateEligible:false,publicEligible:false}});
   if(derivativePersistenceEnabled===true){
    // Borrowed owned bytes, never a browser return. The fixed trusted sink must
    // copy synchronously before awaiting; it obtains its own storage approval,
    // once-claim and read-back verification. This is NOT decoder evidence.
    const saved=await step(()=>persistDerivative(Object.freeze({credential:request.credential,scope:request.scope,descriptor,bytes,signal:controller.signal})));
    own(saved,['stored','derivativeSha256']);
    if(saved.stored!==true||saved.derivativeSha256!==derivative.sha256||sha(bytes)!==derivative.sha256)fail('MANAGED_TRANSFORM_RESPONSE_INVALID');
    await gate('after_response');check();
   }
   bytes.fill(0);bytes=null;return descriptor;
  }catch(error){const code=error instanceof ManagedImageTransformError?error.code:'MANAGED_TRANSFORM_UNAVAILABLE';throw new ManagedImageTransformError(code,transportStarted||claimPending?'uncertain':'not_sent');}
  finally{clearTimeout(timer);controller.abort();if(externalSignal)EventTarget.prototype.removeEventListener.call(externalSignal,'abort',onAbort);if(bytes)bytes.fill(0);chunks.forEach(c=>c.fill(0));if(unclaimedBody)cancelBody(unclaimedBody);if(reader){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
 }});
}
