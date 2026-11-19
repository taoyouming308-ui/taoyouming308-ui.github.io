/** Synthetic application-source entry. No network/default issuer/native versions.
 * reserveUpload pins metadata in the SAME transaction as the original reservation.
 * No automatic retry; reconcile may publish the original claim, never another PUT.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {policyCopy,validatePolicyScope} from './approval-attempt-contracts.mjs';
import {validateManagedApplicationSourceBinding} from './managed-application-image-contracts.mjs';
import {createManagedContentStore} from './managed-content-store.mjs';
import {validateManagedContentWriteIntent,validateManagedContentManifest,createManagedContentManifest,managedContentManifestReference,managedContentCanonical} from './managed-content-manifest-contracts.mjs';
import {checkedApplicationImageStatus} from '../design-prepared-ui/application-images.mjs';
const CODES=new Set(['APPLICATION_IMAGE_DISABLED','APPLICATION_IMAGE_INVALID','APPLICATION_IMAGE_TOO_LARGE','APPLICATION_IMAGE_BUSY','APPLICATION_IMAGE_DENIED','APPLICATION_IMAGE_NOT_FOUND','APPLICATION_IMAGE_UNCERTAIN','APPLICATION_IMAGE_TIMEOUT','APPLICATION_IMAGE_ABORTED']);
export class ManagedApplicationImageServiceError extends Error{constructor(code,outcome='not_sent'){super(CODES.has(code)?code:'APPLICATION_IMAGE_DENIED');this.code=this.message;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=c=>{throw new ManagedApplicationImageServiceError(c);};
const same=(a,b)=>managedContentCanonical(a)===managedContentCanonical(b),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function own(v,keys,optional=[]){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('APPLICATION_IMAGE_INVALID');const names=[...keys,...optional.filter(k=>Object.hasOwn(v,k))];if(Reflect.ownKeys(v).length!==names.length)fail('APPLICATION_IMAGE_INVALID');const o={};for(const k of names){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('APPLICATION_IMAGE_INVALID');o[k]=d.value;}return o;}
function methods(v,keys){const out={};for(const k of keys){const d=v&&!types.isProxy(v)&&Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('APPLICATION_IMAGE_DISABLED');out[k]=d.value.bind(v);}return out;}
const tp=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(tp,k).get;
function bytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail('APPLICATION_IMAGE_INVALID');const n=get('byteLength').call(v),b=get('buffer').call(v);if(n>8388608)fail('APPLICATION_IMAGE_TOO_LARGE');if(n<1||types.isSharedArrayBuffer(b))fail('APPLICATION_IMAGE_INVALID');return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
export function createManagedApplicationImageService({enabled=false,executionMode,repository,ledger,backend,timeoutMs=30000}={}){
 let repo,l,b,configured=false;try{repo=methods(repository,['prepareUpload','reserveUpload','readUploadStatus']);l=methods(ledger,['reserve','claim','authorize','read','reconcile','publish']);b=methods(backend,['createOnly','readExact']);configured=enabled===true&&executionMode==='synthetic_mock'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;}catch{}
 let busy=false,poisoned=false;
 async function run(mode,input){if(!configured)fail('APPLICATION_IMAGE_DISABLED');if(busy||poisoned)fail('APPLICATION_IMAGE_BUSY');busy=true;const deadline=performance.now()+timeoutMs,abort=new AbortController();let owned,timer,external,listener,uncertain=false,stopped=null,rejectStop;const stoppedPromise=new Promise((_,reject)=>rejectStop=reject);
 const stop=code=>{if(stopped)return;stopped=code;poisoned=true;abort.abort();rejectStop(new ManagedApplicationImageServiceError(code,uncertain?'uncertain':'not_sent'));};
 const check=()=>{if(!stopped&&performance.now()>=deadline)stop('APPLICATION_IMAGE_TIMEOUT');if(stopped)fail(stopped);};
 const work=(async()=>{try{
  const q=own(input,['credential','scope','requestId','mediaId',...(mode==='upload'?['stage','angle','bytes','mime']:[])],['signal']);if(typeof q.credential!=='string'||!q.credential||q.credential.length>16384||/\s/.test(q.credential)||!id(q.requestId)||!id(q.mediaId))fail('APPLICATION_IMAGE_INVALID');const scope=validatePolicyScope(q.scope),common={credential:q.credential,scope,requestId:q.requestId,mediaId:q.mediaId};
  if(q.signal!==undefined){external=q.signal;if(types.isProxy(external))fail('APPLICATION_IMAGE_INVALID');if(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(external))fail('APPLICATION_IMAGE_ABORTED');listener=()=>stop('APPLICATION_IMAGE_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}timer=setTimeout(()=>stop('APPLICATION_IMAGE_TIMEOUT'),Math.max(1,deadline-performance.now()));check();
  let expected=null;
  if(mode==='upload'){
   if(!['before','after'].includes(q.stage)||!['front','back','left','right'].includes(q.angle)||!['image/jpeg','image/webp'].includes(q.mime))fail('APPLICATION_IMAGE_INVALID');owned=bytes(q.bytes);const content={sha256:createHash('sha256').update(owned).digest('hex'),byteLength:owned.length,mime:q.mime};check();
   const prepared=own(policyCopy(await repo.prepareUpload({...common,stage:q.stage,angle:q.angle,content,expectedRevision:0,expectedManifestDigest:null})),['intent','sourceBinding']);check();const intent=validateManagedContentWriteIntent(prepared.intent,{scope});if(intent.role!=='source'||intent.requestId!==q.requestId||intent.assetId!==q.mediaId||!same(intent.content,content)||intent.expectedRevision!==0||intent.expectedManifestDigest!==null)fail('APPLICATION_IMAGE_DENIED');expected=validateManagedApplicationSourceBinding(prepared.sourceBinding,createManagedContentManifest({intent,previous:null,ancestors:[]}));
   if(expected.mediaId!==q.mediaId||expected.requestId!==q.requestId||expected.stage!==q.stage||expected.angle!==q.angle||!same(expected.authority,intent.authority))fail('APPLICATION_IMAGE_DENIED');
   const wrapped={...l,reserve:args=>{check();return repo.reserveUpload({...args,sourceBinding:expected});}};
   const store=createManagedContentStore({enabled:true,ledger:wrapped,backend:b,timeoutMs:Math.max(1,Math.floor(deadline-performance.now())),maxBytes:8388608});check();uncertain=true;await store.put({credential:q.credential,scope,requestId:q.requestId,intent,bytes:owned,signal:abort.signal});check();
  }else if(mode==='reconcile'){
   const initial=await repo.readUploadStatus(common);check();if(!initial)fail('APPLICATION_IMAGE_NOT_FOUND');expected=policyCopy(initial.sourceBinding);validateImmutableDesignAuthority(expected.authority);if(expected.requestId!==q.requestId||expected.mediaId!==q.mediaId||!same(expected.authority.scope,scope))fail('APPLICATION_IMAGE_DENIED');const store=createManagedContentStore({enabled:true,ledger:l,backend:b,timeoutMs:Math.max(1,Math.floor(deadline-performance.now())),maxBytes:8388608});check();uncertain=true;await store.reconcile({credential:q.credential,scope,requestId:q.requestId,signal:abort.signal});check();
  }
  const raw=await repo.readUploadStatus(common);check();if(!raw)fail('APPLICATION_IMAGE_NOT_FOUND');const context=own(policyCopy(raw),['sourceBinding','state','manifest']),binding=context.sourceBinding;
  own(binding,['schemaVersion','authority','requestId','mediaId','stage','angle','source']);validateImmutableDesignAuthority(binding.authority);if(binding.schemaVersion!=='design-application-image-source-v1'||binding.requestId!==q.requestId||binding.mediaId!==q.mediaId||!same(binding.authority.scope,scope)||expected&&!same(expected,binding))fail('APPLICATION_IMAGE_DENIED');
  if(!['reserved','claimed','published','terminated'].includes(context.state))fail('APPLICATION_IMAGE_DENIED');let source=null;if(context.state==='published'){const manifest=validateManagedContentManifest(context.manifest,{scope});validateManagedApplicationSourceBinding(binding,manifest);source=managedContentManifestReference(manifest);if(manifest.role!=='source'||manifest.assetId!==q.mediaId||manifest.requestId!==q.requestId||!same(manifest.authority,binding.authority)||!same(source,binding.source))fail('APPLICATION_IMAGE_DENIED');}else if(context.manifest!==null)fail('APPLICATION_IMAGE_DENIED');
  check();return checkedApplicationImageStatus({schemaVersion:'design-application-image-status-v1',scope,mediaId:q.mediaId,requestId:q.requestId,stage:binding.stage,angle:binding.angle,source,state:({reserved:'pending',claimed:'uncertain',published:'stored',terminated:'terminated'})[context.state],synthetic:true,productionEligible:false,modelSubmissionAuthorized:false},{scope,mediaId:q.mediaId,requestId:q.requestId});
 }catch(e){let code='APPLICATION_IMAGE_DENIED';if(e&&!types.isProxy(e)&&e instanceof ManagedApplicationImageServiceError){const d=Object.getOwnPropertyDescriptor(e,'code');if(d&&Object.hasOwn(d,'value')&&CODES.has(d.value))code=d.value;}throw new ManagedApplicationImageServiceError(code,uncertain?'uncertain':'not_sent');}finally{owned?.fill(0);clearTimeout(timer);if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);busy=false;}})();
 return Promise.race([work,stoppedPromise]);
 }
 return Object.freeze({upload:q=>run('upload',q),status:q=>run('status',q),reconcile:q=>run('reconcile',q)});
}
