import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
/** Prepared Supabase private-object protocol, no fetch/default transport/credential lookup. */
import {createHash} from 'node:crypto';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const encoded=x=>JSON.stringify(canonical(x));
const same=(a,b)=>encoded(a)===encoded(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export class PrivateStorageError extends Error{constructor(code){super(code);this.name='PrivateStorageError';this.code=code;this.retryable=false;if(code==='PRIVATE_STORAGE_OUTCOME_UNCERTAIN')this.outcome='uncertain';}}
const fail=code=>{throw new PrivateStorageError(code);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>{if(!plain(x)||Object.keys(x).sort().join('|')!==[...keys].sort().join('|'))fail('PRIVATE_STORAGE_INVALID');};
function bind(value){exact(value,['owner','store','scope']);if(!['owner','store'].every(k=>typeof value[k]==='string'&&value[k].trim()===value[k]&&value[k].length>0&&value[k].length<=160&&!/[\u0000-\u001f]/.test(value[k])))fail('PRIVATE_STORAGE_INVALID');return freeze({owner:value.owner,store:value.store,scope:validateProductionDesignScope(value.scope)});}
function record(value){
 exact(value,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);
 const binding=bind(value.binding),extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[value.mime];
 if(!extension||typeof value.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value.mediaId)||value.requestId!==value.mediaId||!Number.isSafeInteger(value.byteLength)||value.byteLength<1||value.byteLength>PRIVATE_MEDIA_MAX_BYTES||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>16384||value.height>16384||value.width*value.height>40000000||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||value.active!==true||!['before','after','reference'].includes(value.stage)||!['front','back','left','right','detail'].includes(value.angle))fail('PRIVATE_STORAGE_INVALID');
 return freeze({...value,binding});
}
const locator=r=>r.binding.scope.customerProfileId+'/prepared/'+hash(encoded(r.binding))+'/'+r.mediaId+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[r.mime]);
export function createPreparedPrivatePhotoStorage({enabled=false,origin,transport,authorize}={}){
 let trustedOrigin=null;try{const u=new URL(origin);if(u.protocol==='https:'&&u.origin===origin&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))trustedOrigin=u.origin;}catch{}
 function ready(){if(enabled!==true||!trustedOrigin||typeof transport!=='function'||typeof authorize!=='function')fail('PRIVATE_STORAGE_DISABLED');}
 async function permission(r,phase){if(await authorize(freeze({binding:r.binding,mediaId:r.mediaId,sha256:r.sha256,origin:trustedOrigin,phase}))!==true)fail('PRIVATE_STORAGE_ACCESS_DENIED');}
 async function request(r,method,bytes,trace={}){
  await permission(r,method==='POST'?'before_stage':'before_read');
  const url=trustedOrigin+'/storage/v1/object/customer-design-photos/'+locator(r);
  // Trusted transport must attach server authorization internally, enforce timeout/response cap,
  // never redirect, and never expose request/response bodies, credentials or paths in logs.
  trace.sent=true;const reply=await transport(Object.freeze({url,method,redirect:'error',credentials:'omit',timeoutMs:10000,maxResponseBytes:method==='GET'?r.byteLength:4096,headers:Object.freeze(method==='POST'?{'Content-Type':r.mime,'x-upsert':'false'}:{}),...(method==='POST'?{body:Uint8Array.from(bytes)}:{})}));
  if(!plain(reply)||reply.url!==url||reply.redirected!==false||!Number.isInteger(reply.status)||reply.status<100||reply.status>599||reply.status>=300&&reply.status<400)fail('PRIVATE_STORAGE_RESPONSE_INVALID');
  await permission(r,'after_response');return reply;
 }
 async function checkedRead(r){const reply=await request(r,'GET');if(reply.status!==200)fail('PRIVATE_STORAGE_READ_UNAVAILABLE');if(!(reply.body instanceof Uint8Array)||reply.body.length!==r.byteLength||hash(reply.body)!==r.sha256)fail('PRIVATE_STORAGE_INTEGRITY');return Uint8Array.from(reply.body);}
 return Object.freeze({origin:trustedOrigin,
  async stage(input){ready();exact(input,['record','bytes']);const r=record(input.record);if(!(input.bytes instanceof Uint8Array)||input.bytes.length!==r.byteLength||hash(input.bytes)!==r.sha256)fail('PRIVATE_STORAGE_INTEGRITY');const bytes=Uint8Array.from(input.bytes);let reply,reconciled=false;const trace={sent:false};
   try{reply=await request(r,'POST',bytes,trace);}catch(error){if(!trace.sent)fail('PRIVATE_STORAGE_ACCESS_DENIED');if(error instanceof PrivateStorageError&&['PRIVATE_STORAGE_RESPONSE_INVALID','PRIVATE_STORAGE_ACCESS_DENIED'].includes(error.code))fail('PRIVATE_STORAGE_OUTCOME_UNCERTAIN');reconciled=true;}
   if(reply&&[400,409].includes(reply.status))reconciled=true;
   else if(reply&&![200,201].includes(reply.status)){if([401,403,404,413,415].includes(reply.status))fail('PRIVATE_STORAGE_WRITE_REJECTED');reconciled=true;}
   // Read-only reconciliation, never an automatic second POST or upsert/delete.
   try{await checkedRead(r);}catch{fail('PRIVATE_STORAGE_OUTCOME_UNCERTAIN');}
   return Object.freeze({staged:true,reconciled});
  },
  async read(input){ready();exact(input,['record']);try{return await checkedRead(record(input.record));}catch(error){if(error instanceof PrivateStorageError&&['PRIVATE_STORAGE_ACCESS_DENIED','PRIVATE_STORAGE_RESPONSE_INVALID','PRIVATE_STORAGE_READ_UNAVAILABLE','PRIVATE_STORAGE_INTEGRITY','PRIVATE_STORAGE_INVALID'].includes(error.code))fail(error.code);fail('PRIVATE_STORAGE_READ_UNAVAILABLE');}}
 });
}
/** Bridge: private immutable staging first, authoritative metadata publication second.
 * This is NOT a distributed transaction. Unpublished orphan objects can remain.
 */
export function createPreparedPrivateMediaPublicationRepository({enabled=false,objectStorage,metadataRepository,approvalRecipientOrigin}={}){
 return Object.freeze({async withScopeLock(binding,work){
  if(enabled!==true||!objectStorage?.origin||objectStorage.origin!==approvalRecipientOrigin||typeof objectStorage.stage!=='function'||typeof objectStorage.read!=='function'||typeof metadataRepository?.withScopeLock!=='function')fail('PRIVATE_STORAGE_DISABLED');
  const fixed=bind(binding);
  return metadataRepository.withScopeLock(fixed,async tx=>{
   if(!plain(tx)||!['readRecord','insertImmutable','beforeCommit'].every(k=>typeof tx[k]==='function'))fail('PRIVATE_STORAGE_METADATA_REQUIRED');
   const readRecord=async id=>{const row=await tx.readRecord(id);if(row===null)return null;const r=record(row);if(!same(r.binding,fixed)||r.mediaId!==id)fail('PRIVATE_STORAGE_ACCESS_DENIED');return r;};
   return work({readRecord,readBytes:async id=>{const r=await readRecord(id);if(!r)fail('PRIVATE_STORAGE_NOT_PUBLISHED');return objectStorage.read({record:r});},
    insertImmutable:async input=>{exact(input,['record','bytes']);const r=record(input.record);if(!same(r.binding,fixed))fail('PRIVATE_STORAGE_ACCESS_DENIED');if(await readRecord(r.mediaId)!==null)return false;
     await objectStorage.stage({record:r,bytes:input.bytes});return tx.insertImmutable(r);
    },beforeCommit:callback=>tx.beforeCommit(callback)});
  });
 }});
}
