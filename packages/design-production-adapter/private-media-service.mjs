/** Explicit server composition. No credentials, network fallback or decoder activation. */
import {createPreparedPrivateMedia,PrivateMediaError,PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {createPreparedPrivatePhotoStorage} from './private-media-storage.mjs';
import {createHash} from 'node:crypto';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fail=code=>{throw new PrivateMediaError(code);};
/** Short metadata transactions bracket immutable object I/O; never a distributed transaction.
 * Factory dependencies are server-owned. No client can select a repository or destination.
 */
export function createPrivateMediaService({enabled=false,permissionGate,approvalVerifier,imageInspector,imageNormalizer,metadataRepository,storageOrigin,storageTransport}={}){
 async function call(method,input){
  if(enabled!==true||typeof permissionGate?.authorize!=='function'||typeof approvalVerifier?.verify!=='function'||typeof imageInspector!=='function'||typeof metadataRepository?.withScopeLock!=='function'||typeof metadataRepository?.verifyRecords!=='function'||typeof storageTransport!=='function')fail('MEDIA_DISABLED');
  if(method==='upload'&&(!(input?.bytes instanceof Uint8Array)||input.bytes.length<1||input.bytes.length>PRIVATE_MEDIA_MAX_BYTES))fail('MEDIA_INVALID_BYTES');
  let fixed;try{const {credential,...values}=input;fixed={...structuredClone(values),credential};}catch{fail('MEDIA_INVALID_REQUEST');}
  const credential=fixed.credential,records=new Map();let binding=null,returned=false,guardTx=null,writeAttempted=false;
  const gate={authorize:(...args)=>(guardTx?guardTx.permissionGate:permissionGate).authorize(...args)};
  const approvals={verify:(...args)=>approvalVerifier.verify(...args,Object.freeze({transaction:guardTx}))};
  async function authorize(expected){const grant=await gate.authorize(credential,expected.scope);if(!same(grant.scope,expected.scope)||grant.actor?.username!==expected.owner||grant.actor?.store!==expected.store)fail('MEDIA_AUTHORIZATION_CHANGED');return true;}
  const objectStorage=createPreparedPrivatePhotoStorage({enabled:true,origin:storageOrigin,transport:storageTransport,authorize:async intent=>{if(guardTx||!binding||!same(binding,intent.binding))return false;return authorize(binding);}});
  const repository={async withScopeLock(b,work){
   binding=freeze(structuredClone(b));const hooks=[];let staged=null,open=true;
   const usable=()=>{if(!open)fail('MEDIA_UNAVAILABLE');};
   async function readRecord(id){usable();if(records.has(id))return records.get(id);const record=await metadataRepository.withScopeLock(binding,tx=>tx.readRecord(id));const copied=record===null?null:freeze(structuredClone(record));records.set(id,copied);return copied;}
   const facade={readRecord,async readBytes(id){const record=await readRecord(id);if(!record||record.active!==true)fail('MEDIA_SCOPE_DENIED');return objectStorage.read({record});},
    async insertImmutable({record,bytes}){usable();if(staged||!same(record.binding,binding))fail('MEDIA_INVALID_REQUEST');if(await readRecord(record.mediaId)!==null)return false;writeAttempted=true;await objectStorage.stage({record,bytes});staged=freeze(structuredClone(record));return true;},
    beforeCommit(check){usable();if(typeof check!=='function')fail('MEDIA_INVALID_REQUEST');hooks.push(check);}};
   let result;try{result=await work(facade);}finally{open=false;}
   // No Storage request, decode or user wait is performed while the metadata lock is held.
   await metadataRepository.withScopeLock(binding,async tx=>{
    if(typeof tx.permissionGate?.authorize!=='function')fail('MEDIA_DISABLED');
    for(const [id,expected] of records){const live=await tx.readRecord(id);if(!same(live,expected)&&!(staged&&id===staged.mediaId&&same(live,staged)))fail('MEDIA_AUTHORIZATION_CHANGED');}
    if(staged){const existing=await tx.readRecord(staged.mediaId);if(existing===null){if(await tx.insertImmutable(staged)!==true)fail('MEDIA_REQUEST_CONFLICT');}else if(!same(existing,staged))fail('MEDIA_REQUEST_CONFLICT');}
    await tx.beforeCommit(async()=>{guardTx=tx;try{for(const hook of hooks)await hook();await authorize(binding);}finally{guardTx=null;}});
   });
   if(staged)records.set(staged.mediaId,staged);return result;
  }};
  const service=createPreparedPrivateMedia({enabled:true,permissionGate:gate,approvalVerifier:approvals,imageInspector,repository,privateStorageOrigin:storageOrigin});
  try{
   const result=await service[method](fixed);returned=true;
   // After outer approval and all transaction waits: fresh active/identity verification.
   if(!binding||await metadataRepository.verifyRecords(binding,freeze([...records.values()].filter(Boolean)))!==true)fail('MEDIA_AUTHORIZATION_CHANGED');
   await authorize(binding);return result;
  }catch(error){
   if((returned&&method==='upload')||writeAttempted)fail('MEDIA_OUTCOME_UNCERTAIN');
   if(error instanceof PrivateMediaError)throw error;
   fail('MEDIA_UNAVAILABLE');
  }
 }
 async function preview(input){
  if(typeof imageNormalizer!=='function')fail('MEDIA_DISABLED');let before,after,normal;
  const sha=b=>createHash('sha256').update(b).digest('hex');
  try{
   const fixed=structuredClone(input);before=await call('read',fixed);normal=await imageNormalizer(before.bytes);
   if(normal?.source?.sha256!==sha(before.bytes)||normal.normalized?.mime!=='image/jpeg'||!(normal.normalized.bytes instanceof Uint8Array)||normal.normalized.bytes.length<1||normal.normalized.bytes.length>524288||sha(normal.normalized.bytes)!==normal.normalized.sha256||normal.independentVerification?.sha256!==normal.normalized.sha256||normal.independentVerification.metadataAbsent!==true||![normal.normalized.width,normal.normalized.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024))fail('MEDIA_INTEGRITY_FAILED');
   after=await call('read',fixed);if(!same(before.reference,after.reference)||sha(before.bytes)!==sha(after.bytes))fail('MEDIA_AUTHORIZATION_CHANGED');
   return {reference:after.reference,bytes:Uint8Array.from(normal.normalized.bytes),preview:{mime:'image/jpeg',width:normal.normalized.width,height:normal.normalized.height,sourceSha256:sha(after.bytes)},cacheControl:'private, no-store',maxAgeSeconds:0};
  }finally{before?.bytes?.fill(0);after?.bytes?.fill(0);normal?.normalized?.bytes?.fill(0);normal?.derivative?.bytes?.fill(0);}
 }
 return Object.freeze({upload:input=>call('upload',input),read:input=>call('read',input),preview,resolveReferences:input=>call('resolveReferences',input)});
}
