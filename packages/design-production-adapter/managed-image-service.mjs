/** Default-closed managed-image quarantine service. No UI, public bytes, model,
 * legacy media/archive conversion, decoder or network default. Server-owned
 * repository methods supply fresh immutable authority and independently issued
 * storage/processing/cost permissions; structural validation grants none.
 * Object I/O is outside metadata transactions. The trusted storage adapter must
 * enforce private immutable create (never upsert) and return its real version.
 * It must honor abort and settle within its own bounded lifetime. Until any
 * handed-off put settles, this instance retains its single upload admission;
 * a nonsettling adapter blocks further uploads rather than accumulating bytes.
 * Its receipt is not a decode/source-attestation. Unknown writes are never
 * deleted or retried here; a consumed upload claim requires reconciliation.
 */
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {ManagedImageTransformError} from './managed-image-transform.mjs';
import {validateManagedImageCost,validateManagedImageUploadIntent} from './managed-image-ledger-contracts.mjs';
import {MANAGED_IMAGE_SOURCE_SCHEMA,MANAGED_IMAGE_RESPONSE_SCHEMA,managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord,validateManagedImageResponse,createManagedImageCandidate} from './managed-image-contracts.mjs';
const CODES=new Set(['MANAGED_IMAGE_SERVICE_DISABLED','MANAGED_IMAGE_SERVICE_BUSY','MANAGED_IMAGE_SERVICE_INVALID','MANAGED_IMAGE_SERVICE_TOO_LARGE','MANAGED_IMAGE_SERVICE_ACCESS_DENIED','MANAGED_IMAGE_SERVICE_STORAGE_DENIED','MANAGED_IMAGE_SERVICE_ALREADY_CLAIMED','MANAGED_IMAGE_SERVICE_CONFLICT','MANAGED_IMAGE_SERVICE_NOT_FOUND','MANAGED_IMAGE_SERVICE_PREFLIGHT_REQUIRED','MANAGED_IMAGE_SERVICE_RESPONSE_INVALID','MANAGED_IMAGE_SERVICE_TIMEOUT','MANAGED_IMAGE_SERVICE_ABORTED','MANAGED_IMAGE_SERVICE_UNAVAILABLE']);
export class ManagedImageServiceError extends Error{constructor(code,outcome='not_sent'){const safe=CODES.has(code)?code:'MANAGED_IMAGE_SERVICE_UNAVAILABLE';super(safe);this.name='ManagedImageServiceError';this.code=safe;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=code=>{throw new ManagedImageServiceError(code);};
// Inspect no dependency-defined getters/prototype chain; return fixed codes only.
function errorData(error,prototype){if(types.isProxy(error)||!types.isNativeError(error)||Object.getPrototypeOf(error)!==prototype)return null;const code=Object.getOwnPropertyDescriptor(error,'code'),outcome=Object.getOwnPropertyDescriptor(error,'outcome');return code&&Object.hasOwn(code,'value')&&outcome&&Object.hasOwn(outcome,'value')?{code:code.value,outcome:outcome.value}:null;}
const copy=v=>JSON.parse(managedImageCanonical(v));
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sha=v=>createHash('sha256').update(v).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&v.trim()===v&&!/[\x00-\x20\x7f]/.test(v);
function own(v,keys){if(types.isProxy(v)||!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)fail('MANAGED_IMAGE_SERVICE_INVALID');const names=Reflect.ownKeys(v);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))fail('MANAGED_IMAGE_SERVICE_INVALID');const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('MANAGED_IMAGE_SERVICE_INVALID');out[key]=d.value;}return out;}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=name=>Object.getOwnPropertyDescriptor(typed,name).get;
function snapshotBytes(value){if(types.isProxy(value)||!types.isUint8Array(value))fail('MANAGED_IMAGE_SERVICE_INVALID');const buffer=get('buffer').call(value),size=get('byteLength').call(value);if(types.isSharedArrayBuffer(buffer)||size<1)fail('MANAGED_IMAGE_SERVICE_INVALID');if(size>PRIVATE_MEDIA_MAX_BYTES)fail('MANAGED_IMAGE_SERVICE_TOO_LARGE');return Buffer.from(new Uint8Array(buffer,get('byteOffset').call(value),size));}
function request(method,input){if(types.isProxy(input)||!input||typeof input!=='object')fail('MANAGED_IMAGE_SERVICE_INVALID');const keys=['credential','scope','mediaId',...(method==='upload'?['requestId','bytes','mime','stage','angle']:method==='transform'?['requestId','maxEdge']:[]),...(Reflect.ownKeys(input).includes('signal')?['signal']:[])],v=own(input,keys);if(!text(v.credential)||!id(v.mediaId)||method!=='status'&&!id(v.requestId))fail('MANAGED_IMAGE_SERVICE_INVALID');const scope=validateProductionDesignScope(copy(v.scope));if(v.signal!==undefined){if(types.isProxy(v.signal))fail('MANAGED_IMAGE_SERVICE_INVALID');aborted.call(v.signal);}if(method==='upload'&&(!['image/jpeg','image/png','image/webp'].includes(v.mime)||!['before','after','reference'].includes(v.stage)||!['front','back','left','right','detail'].includes(v.angle)))fail('MANAGED_IMAGE_SERVICE_INVALID');if(method==='transform'&&![1024,1536].includes(v.maxEdge))fail('MANAGED_IMAGE_SERVICE_INVALID');return {...v,scope,...(method==='upload'?{bytes:snapshotBytes(v.bytes)}:{})};}
function dto(source,response=null){return freeze({schemaVersion:'design-managed-image-status-v1',mediaId:source.mediaId,sourceVersion:source.object.version,requestId:response?.descriptor.requestId??source.requestId,state:response?'pending_validation':'quarantined',candidateEligible:false,publicEligible:false});}

export function createManagedImageService({enabled=false,repository,storage,transformer,projectOrigin,bucket,storageCost,timeoutMs}={}){
 let uploadBusy=false,config=null;try{config=freeze(copy({projectOrigin,bucket,storageCost:storageCost??null,timeoutMs:timeoutMs??null}));}catch{}
 function ready(method){let validOrigin=false;try{const u=new URL(config?.projectOrigin);validOrigin=u.protocol==='https:'&&u.origin===config.projectOrigin&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);}catch{}if(enabled!==true||!validOrigin||!/^[A-Za-z0-9_-]{1,100}$/.test(config?.bucket??'')||!Number.isSafeInteger(config?.timeoutMs)||config.timeoutMs<1||config.timeoutMs>30000||!['resolveAuthority','readSourceStatus'].every(n=>typeof repository?.[n]==='function'))fail('MANAGED_IMAGE_SERVICE_DISABLED');if(method==='upload'){try{validateManagedImageCost(config.storageCost);}catch{fail('MANAGED_IMAGE_SERVICE_DISABLED');}if(!['authorizeStorage','claimUpload','publishSource'].every(n=>typeof repository?.[n]==='function')||typeof storage?.putImmutable!=='function')fail('MANAGED_IMAGE_SERVICE_DISABLED');}if(method==='transform'&&(typeof transformer?.transform!=='function'||typeof repository?.publishResponse!=='function'))fail('MANAGED_IMAGE_SERVICE_DISABLED');}
 async function call(method,input){ready(method);if(method==='upload'){if(uploadBusy)fail('MANAGED_IMAGE_SERVICE_BUSY');uploadBusy=true;}let q;try{q=request(method,input);}catch(error){if(method==='upload')uploadBusy=false;const detail=errorData(error,ManagedImageServiceError.prototype);fail(detail?.code==='MANAGED_IMAGE_SERVICE_TOO_LARGE'?'MANAGED_IMAGE_SERVICE_TOO_LARGE':'MANAGED_IMAGE_SERVICE_INVALID');}
  const controller=new AbortController(),deadline=performance.now()+config.timeoutMs;let reason=null,timer,putPending=null,claimPending=false,putStarted=false,publishStarted=false,transformUncertain=false;
  const stop=code=>{if(!reason){reason=code;controller.abort();}},onAbort=()=>stop('MANAGED_IMAGE_SERVICE_ABORTED');
  const check=()=>{if(q.signal&&aborted.call(q.signal))onAbort();if(performance.now()>=deadline)stop('MANAGED_IMAGE_SERVICE_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();let listener;const stopped=new Promise((_,reject)=>{listener=()=>reject(new ManagedImageServiceError(reason||'MANAGED_IMAGE_SERVICE_ABORTED'));controller.signal.addEventListener('abort',listener,{once:true});});try{const v=await Promise.race([Promise.resolve().then(()=>{check();return fn();}),stopped]);check();return v;}finally{controller.signal.removeEventListener('abort',listener);}}
  try{
   if(q.signal)EventTarget.prototype.addEventListener.call(q.signal,'abort',onAbort,{once:true});timer=setTimeout(()=>stop('MANAGED_IMAGE_SERVICE_TIMEOUT'),config.timeoutMs);check();
   const authority=validateImmutableDesignAuthority(await step(()=>repository.resolveAuthority({credential:q.credential,scope:q.scope})));if(!same(authority.scope,q.scope))fail('MANAGED_IMAGE_SERVICE_ACCESS_DENIED');
   async function read(){const out=own(await step(()=>repository.readSourceStatus({credential:q.credential,scope:q.scope,mediaId:q.mediaId})),['sourceRecord','response']);if(out.sourceRecord===null){if(out.response!==null)fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');return out;}const sourceRecord=validateManagedImageSourceRecord(out.sourceRecord);if(!same(sourceRecord.owner,authority)||sourceRecord.mediaId!==q.mediaId||sourceRecord.object.projectOrigin!==config.projectOrigin||sourceRecord.object.bucket!==config.bucket)fail('MANAGED_IMAGE_SERVICE_ACCESS_DENIED');return {sourceRecord,response:out.response===null?null:validateManagedImageResponse(out.response,sourceRecord)};}
   if(method==='upload'){
    const source=freeze({sha256:sha(q.bytes),byteLength:q.bytes.length,mime:q.mime}),target=freeze({projectOrigin:config.projectOrigin,bucket:config.bucket,key:'managed-quarantine/'+managedImageDigest({authority,mediaId:q.mediaId})+'/source'});
    const intent=validateManagedImageUploadIntent({schemaVersion:'design-managed-image-upload-intent-v1',requestId:q.requestId,mediaId:q.mediaId,authority,target,source,stage:q.stage,angle:q.angle,cost:config.storageCost});
    async function gate(phase){const current=validateImmutableDesignAuthority(await step(()=>repository.resolveAuthority({credential:q.credential,scope:q.scope})));if(!same(current,authority))fail('MANAGED_IMAGE_SERVICE_ACCESS_DENIED');if(await step(()=>repository.authorizeStorage({credential:q.credential,intent,phase}))!==true)fail('MANAGED_IMAGE_SERVICE_STORAGE_DENIED');}
    const existing=await read();if(existing.sourceRecord){const s=existing.sourceRecord;if(s.requestId!==q.requestId||!same(s.source,source)||s.stage!==q.stage||s.angle!==q.angle||!same({projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,key:s.object.key},target))fail('MANAGED_IMAGE_SERVICE_CONFLICT');await gate('before_replay_return');return dto(s);}
    await gate('before_claim');claimPending=true;const claimed=await step(()=>repository.claimUpload({credential:q.credential,intent}));claimPending=false;if(claimed!=='created')fail('MANAGED_IMAGE_SERVICE_ALREADY_CLAIMED');await gate('before_put');
    const raw=await step(()=>{putStarted=true;putPending=Promise.resolve(storage.putImmutable(Object.freeze({target,source,bytes:q.bytes,requestId:q.requestId,private:true,overwrite:false,signal:controller.signal})));return putPending;});
    const receipt=own(copy(raw),['target','objectVersion','sha256','byteLength','mime','created','private','immutable']);
    if(!same(receipt.target,target)||!/^[A-Za-z0-9._-]{1,160}$/.test(receipt.objectVersion)||receipt.sha256!==source.sha256||receipt.byteLength!==source.byteLength||receipt.mime!==source.mime||receipt.created!==true||receipt.private!==true||receipt.immutable!==true||sha(q.bytes)!==source.sha256)fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');
    const sourceRecord=validateManagedImageSourceRecord({schemaVersion:MANAGED_IMAGE_SOURCE_SCHEMA,mediaId:q.mediaId,requestId:q.requestId,owner:authority,object:{...target,version:receipt.objectVersion},source,stage:q.stage,angle:q.angle,state:'quarantined',validation:'not_performed',publicEligible:false});
    await gate('after_put');publishStarted=true;const saved=validateManagedImageSourceRecord(await step(()=>repository.publishSource({credential:q.credential,sourceRecord})));if(!same(saved,sourceRecord))fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');const current=await read();if(!same(current.sourceRecord,sourceRecord))fail('MANAGED_IMAGE_SERVICE_CONFLICT');await gate('before_return');return dto(sourceRecord);
   }
   const initial=await read();if(!initial.sourceRecord)fail('MANAGED_IMAGE_SERVICE_NOT_FOUND');if(method==='status')return dto(initial.sourceRecord,initial.response);
   let descriptor;try{descriptor=await step(()=>{transformUncertain=true;return transformer.transform({credential:q.credential,scope:q.scope,mediaId:q.mediaId,requestId:q.requestId,maxEdge:q.maxEdge,signal:controller.signal});});}catch(error){const detail=errorData(error,ManagedImageTransformError.prototype);if(detail){transformUncertain=detail.outcome==='uncertain';if(detail.code==='MANAGED_TRANSFORM_SOURCE_ORIENTATION_REQUIRED')fail('MANAGED_IMAGE_SERVICE_PREFLIGHT_REQUIRED');}throw error;}
   transformUncertain=true;
   const response=validateManagedImageResponse({schemaVersion:MANAGED_IMAGE_RESPONSE_SCHEMA,sourceRecordDigest:managedImageDigest(initial.sourceRecord),descriptor},initial.sourceRecord);
   if(response.descriptor.requestId!==q.requestId||response.descriptor.requestedTransform.maxEdge!==q.maxEdge)fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');
   // Enforce the independent, provisional image-input budget without accepting
   // client evidence or treating this blocked pure record as send/adopt authority.
   const pending=createManagedImageCandidate({sourceRecord:initial.sourceRecord,response,evidence:null});if(pending.technicalStatus!=='blocked'||pending.submissionAuthorized||pending.adoptionAuthorized||pending.publicEligible)fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');
   publishStarted=true;const stored=validateManagedImageResponse(await step(()=>repository.publishResponse({credential:q.credential,scope:q.scope,sourceRecordDigest:response.sourceRecordDigest,descriptor:response.descriptor})),initial.sourceRecord);if(!same(stored,response))fail('MANAGED_IMAGE_SERVICE_RESPONSE_INVALID');
   // readSourceStatus is a fresh composite source/identity/preflight/claim/
   // processing/cost check for a returned response, not an owner-only read.
   const current=await read();if(!same(current.sourceRecord,initial.sourceRecord)||!same(current.response,response))fail('MANAGED_IMAGE_SERVICE_CONFLICT');return dto(current.sourceRecord,response);
  }catch(error){const detail=errorData(error,ManagedImageServiceError.prototype),code=detail&&CODES.has(detail.code)?detail.code:'MANAGED_IMAGE_SERVICE_UNAVAILABLE';throw new ManagedImageServiceError(code,claimPending||putStarted||publishStarted||transformUncertain?'uncertain':'not_sent');}
  finally{clearTimeout(timer);controller.abort();if(q.signal)EventTarget.prototype.removeEventListener.call(q.signal,'abort',onAbort);if(q.bytes){const bytes=q.bytes,release=()=>{bytes.fill(0);uploadBusy=false;};if(putPending)void putPending.finally(release).catch(()=>{});else release();}}
 }
 return Object.freeze({upload:input=>call('upload',input),transform:input=>call('transform',input),status:input=>call('status',input)});
}
