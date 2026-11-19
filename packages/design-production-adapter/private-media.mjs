import {PHONE_SOURCE_MIMES,detectHeifMime,samePhoneMime} from '../shared/phone-image-types.mjs';
/** Disabled preparation only. No storage client, URLs, credentials or model-image transport. */
import {createHash} from 'node:crypto';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';
export const PRIVATE_MEDIA_MAX_BYTES=IMAGE_UPLOAD_MAX_BYTES;
const codes=new Set(['MEDIA_DISABLED','MEDIA_INVALID_REQUEST','MEDIA_INVALID_BYTES','MEDIA_DECODE_REQUIRED','MEDIA_APPROVAL_REQUIRED','MEDIA_SCOPE_DENIED','MEDIA_NOT_FOUND','MEDIA_REQUEST_CONFLICT','MEDIA_INTEGRITY_FAILED','MEDIA_AUTHORIZATION_CHANGED','MEDIA_COMMIT_GUARD_REQUIRED','MEDIA_OUTCOME_UNCERTAIN','MEDIA_UNAVAILABLE']);
export class PrivateMediaError extends Error{constructor(code){super(code);this.name='PrivateMediaError';this.code=code;this.retryable=false;if(code==='MEDIA_OUTCOME_UNCERTAIN')this.outcome='uncertain';}}
const fail=code=>{throw new PrivateMediaError(code);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>{if(!plain(x)||Object.keys(x).sort().join('|')!==[...keys].sort().join('|'))fail('MEDIA_INVALID_REQUEST');};
const id=x=>{if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(x))fail('MEDIA_INVALID_REQUEST');return x;};
const copy=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function bytesCopy(value){if(!(value instanceof Uint8Array)||value.byteLength===0||value.byteLength>PRIVATE_MEDIA_MAX_BYTES)fail('MEDIA_INVALID_BYTES');return Uint8Array.from(value);}
/** Magic is only an early filter. A trusted full decoder is mandatory below. */
export function sniffPrivateImage(value){
 const bytes=bytesCopy(value),ascii=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
 if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&ascii(12,16)==='IHDR')return 'image/png';
 if(bytes.length>=16&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(12,16)))return 'image/webp';
 const heif=detectHeifMime(bytes);if(heif)return heif;
 fail('MEDIA_INVALID_BYTES');
}
const stages=['before','after','reference'],angles=['front','back','left','right','detail'];
function metadata(value){
 exact(value,['mime','width','height','frameCount','decoded']);
 if(!PHONE_SOURCE_MIMES.includes(value.mime)||value.decoded!==true||value.frameCount!==1||!['width','height'].every(k=>Number.isSafeInteger(value[k])&&value[k]>0&&value[k]<=16384)||value.width*value.height>40000000)fail('MEDIA_DECODE_REQUIRED');
 return {mime:value.mime,width:value.width,height:value.height};
}
function owner(grant,scope){
 if(!plain(grant)||!plain(grant.actor)||!['username','store'].every(k=>typeof grant.actor[k]==='string'&&grant.actor[k].length>0&&grant.actor[k].length<=160&&!/[\u0000-\u001f]/.test(grant.actor[k]))||!equal(validateProductionDesignScope(grant.scope),scope))fail('MEDIA_SCOPE_DENIED');
 return freeze({owner:grant.actor.username,store:grant.actor.store,scope});
}
function reference(record){return freeze({mediaId:record.mediaId,stage:record.stage,angle:record.angle,mime:record.mime,byteLength:record.byteLength,width:record.width,height:record.height});}
function checkRecord(record,binding,mediaId){
 if(record===null)fail('MEDIA_NOT_FOUND');
 exact(record,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);
 if(record.mediaId!==mediaId||record.requestId!==mediaId||!equal(record.binding,binding)||record.active!==true)fail('MEDIA_SCOPE_DENIED');
 if(!stages.includes(record.stage)||!angles.includes(record.angle)||!Number.isSafeInteger(record.byteLength)||record.byteLength<1||record.byteLength>PRIVATE_MEDIA_MAX_BYTES||typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256))fail('MEDIA_INTEGRITY_FAILED');
 metadata({mime:record.mime,width:record.width,height:record.height,frameCount:1,decoded:true});
 return copy(record);
}
export function createPreparedPrivateMedia({enabled=false,permissionGate,approvalVerifier,imageInspector,repository,privateStorageOrigin}={}){
 let storageOrigin=null;try{const url=new URL(privateStorageOrigin);if(url.protocol==='https:'&&url.origin===privateStorageOrigin&&!url.username&&!url.password)storageOrigin=url.origin;}catch{}
 function ready(){if(enabled!==true||!storageOrigin||typeof permissionGate?.authorize!=='function'||typeof approvalVerifier?.verify!=='function'||typeof imageInspector!=='function'||typeof repository?.withScopeLock!=='function')fail('MEDIA_DISABLED');}
 async function inspect(bytes,mime){
  if(!samePhoneMime(sniffPrivateImage(bytes),mime))fail('MEDIA_INVALID_BYTES');
  const result=metadata(await imageInspector(Uint8Array.from(bytes)));
  if(!samePhoneMime(result.mime,mime))fail('MEDIA_INTEGRITY_FAILED');return {...result,mime};
 }
 async function run(fixed,operation){
  ready();try{
   const binding=owner(await permissionGate.authorize(fixed.credential,fixed.scope),fixed.scope);
   async function recheck(){if(!equal(owner(await permissionGate.authorize(fixed.credential,fixed.scope),fixed.scope),binding))fail('MEDIA_AUTHORIZATION_CHANGED');}
   let invoked=false,callbackResult;
   const result=await repository.withScopeLock(binding,async tx=>{
    if(invoked)fail('MEDIA_COMMIT_GUARD_REQUIRED');invoked=true;
    if(!plain(tx)||!['readRecord','readBytes','insertImmutable','beforeCommit'].every(k=>typeof tx[k]==='function'))fail('MEDIA_DISABLED');
    await recheck();callbackResult=await operation({binding,tx,recheck});return callbackResult;
   });
   if(!invoked||result!==callbackResult)fail('MEDIA_COMMIT_GUARD_REQUIRED');
   fixed.commitReturned=Boolean(result?.pendingCommit);
   if(fixed.finalApproval)await fixed.finalApproval();
   await recheck();return result;
  }catch(error){if(fixed.commitReturned)fail('MEDIA_OUTCOME_UNCERTAIN');if(error instanceof PrivateMediaError&&codes.has(error.code))throw new PrivateMediaError(error.code);fail(fixed.writeAttempted?'MEDIA_OUTCOME_UNCERTAIN':'MEDIA_UNAVAILABLE');}
 }
 async function approve(receipt,intent,phase){if(await approvalVerifier.verify(receipt,freeze(copy(intent)),phase)!==true)fail('MEDIA_APPROVAL_REQUIRED');}
 function scopeRequest(input,keys){exact(input,keys);return {credential:input.credential,scope:validateProductionDesignScope(input.scope),approval:input.approval};}
 return Object.freeze({
  async upload(input){
   const fixed=scopeRequest(input,['credential','scope','approval','requestId','bytes','mime','stage','angle']);fixed.requestId=id(input.requestId);
   const bytes=bytesCopy(input.bytes),mime=input.mime,stage=input.stage,angle=input.angle;
   if(!stages.includes(stage)||!angles.includes(angle))fail('MEDIA_INVALID_REQUEST');
   return run(fixed,async({binding,tx,recheck})=>{
    const intent={operation:'private_photo_upload',recipient:{kind:'private_storage',origin:storageOrigin},binding,requestId:fixed.requestId,sha256:hash(bytes),byteLength:bytes.length,mime,stage,angle};
    // Explicit exact upload approval precedes sending originals to the private decoder.
    await approve(fixed.approval,intent,'before_storage');await recheck();
    const dimensions=await inspect(bytes,mime),record=freeze({mediaId:fixed.requestId,requestId:fixed.requestId,binding,stage,angle,...dimensions,byteLength:bytes.length,sha256:hash(bytes),active:true});
    fixed.finalApproval=()=>approve(fixed.approval,intent,'before_return');
    await approve(fixed.approval,intent,'before_storage');await recheck();
    const existing=await tx.readRecord(fixed.requestId);
    if(existing!==null){const checked=checkRecord(existing,binding,fixed.requestId);if(!equal(checked,record))fail('MEDIA_REQUEST_CONFLICT');
     const saved=bytesCopy(await tx.readBytes(fixed.requestId));if(saved.length!==bytes.length||hash(saved)!==record.sha256)fail('MEDIA_INTEGRITY_FAILED');
     await recheck();await approve(fixed.approval,intent,'before_return');await recheck();return freeze({reference:reference(checked),replayed:true});}
    let guarded=false;
    tx.beforeCommit(async()=>{await recheck();await approve(fixed.approval,intent,'before_commit');await recheck();guarded=true;});
    try{
     // Adapter stages original bytes privately; it must not publish before beforeCommit.
     fixed.writeAttempted=true;const stored=await tx.insertImmutable({record,bytes:Uint8Array.from(bytes)});
     if(stored!==true)fail('MEDIA_REQUEST_CONFLICT');
     // The transaction may invoke beforeCommit only after this callback returns.
     return {pendingCommit:true,record,guarded:()=>guarded};
    }catch(error){if(error instanceof PrivateMediaError)throw error;fail('MEDIA_OUTCOME_UNCERTAIN');}
   }).then(async result=>{
    if(!result.pendingCommit)return result;
    if(!result.guarded())fail('MEDIA_COMMIT_GUARD_REQUIRED');
    // No internal record, storage key or closure escapes the completed transaction.
    return freeze({reference:reference(result.record),replayed:false});
   });
  },
  async read(input){
   const fixed=scopeRequest(input,['credential','scope','approval','mediaId']);fixed.mediaId=id(input.mediaId);
   return run(fixed,async({binding,tx,recheck})=>{
    const record=checkRecord(await tx.readRecord(fixed.mediaId),binding,fixed.mediaId);
    const intent={operation:'employee_private_photo_view',recipient:{kind:'employee',username:binding.owner,store:binding.store},binding,mediaIds:[fixed.mediaId],sha256:record.sha256};
    fixed.finalApproval=()=>approve(fixed.approval,intent,'before_return');
    await approve(fixed.approval,intent,'before_read');await recheck();
    const bytes=bytesCopy(await tx.readBytes(fixed.mediaId));
    if(bytes.length!==record.byteLength||hash(bytes)!==record.sha256)fail('MEDIA_INTEGRITY_FAILED');
    const dimensions=await inspect(bytes,record.mime);if(dimensions.width!==record.width||dimensions.height!==record.height)fail('MEDIA_INTEGRITY_FAILED');await recheck();
    if(!equal(checkRecord(await tx.readRecord(fixed.mediaId),binding,fixed.mediaId),record))fail('MEDIA_AUTHORIZATION_CHANGED');
    await approve(fixed.approval,intent,'before_return');await recheck();
    return {reference:reference(record),bytes,cacheControl:'private, no-store',maxAgeSeconds:0};
   });
  },
  async resolveReferences(input){
   const fixed=scopeRequest(input,['credential','scope','approval','mediaIds']);
   if(!Array.isArray(input.mediaIds)||input.mediaIds.length>30||new Set(input.mediaIds).size!==input.mediaIds.length)fail('MEDIA_INVALID_REQUEST');fixed.mediaIds=input.mediaIds.map(id);
   return run(fixed,async({binding,tx,recheck})=>{
    const records=[];for(const mediaId of fixed.mediaIds)records.push(checkRecord(await tx.readRecord(mediaId),binding,mediaId));
    const intent={operation:'private_photo_archive_reference',recipient:{kind:'private_storage',origin:storageOrigin},binding,mediaIds:fixed.mediaIds,sha256:records.map(row=>row.sha256)};
    fixed.finalApproval=()=>approve(fixed.approval,intent,'before_return');
    await approve(fixed.approval,intent,'before_return');await recheck();
    return freeze({references:records.map(reference)});
   });
  }
 });
}
