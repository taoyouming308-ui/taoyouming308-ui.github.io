/** Default-closed, SERVER-MEMORY synthetic preparation / mock preview only.
 * No transport, key, approval issuer, request/billing ledger, publication or
 * adoption capability is accepted. This is NOT a production candidate v3:
 * there is deliberately no workflow binding or durable dispatch receipt.
 * Old workflow/history/full-archive validators must continue to reject it.
 *
 * ledger.readVerified must be the fixed current PG capability, not a caller's
 * report JSON. Each call must recheck the immutable principal, processing claim,
 * two application-manifest objects, independent task/report and their expiry/revocation. storage
 * must honor the exact private manifest reference. This layer checks returned PNG
 * bytes against that issued task, but does not qualify a decoder or implement
 * storage versioning. Pure synthetic tests establish neither capability.
 *
 * Prepared bodies contain private base64. Never log, persist or expose them to
 * HTTP. This module never sends them. The separate Stage35 dispatcher may use
 * prepare() only under its synthetic_mock/shared-ledger gates; preview-v3 itself
 * remains non-adoptable. Real sending is not enabled. JS strings cannot be
 * securely erased. No key/approval integration is supplied by this module.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedApplicationStrictTask,validateManagedApplicationStrictReport,buildManagedApplicationStrictInput,validateManagedApplicationStrictInput} from './managed-application-image-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {MANAGED_IMAGE_MODEL_ENDPOINT,validateManagedImageModelTransportRequest} from './managed-image-model-request.mjs';
import {parseManagedImageModelObservations} from './managed-image-model-result.mjs';
import {buildDesignImagePrompt} from '../prompts/design-image.mjs';
import {DESIGN_VISUAL_VALUES} from '../analysis-engine/design-candidate.mjs';

export const APPLICATION_MODEL_PREPARED_SCHEMA='design-application-model-prepared-v1';
export const APPLICATION_MODEL_PREVIEW_SCHEMA='design-application-model-preview-v1';
const CODES=new Set(['APPLICATION_PREVIEW_DISABLED','APPLICATION_PREVIEW_INVALID','APPLICATION_PREVIEW_DENIED','APPLICATION_PREVIEW_BINDING','APPLICATION_PREVIEW_BUSY','APPLICATION_PREVIEW_TIMEOUT','APPLICATION_PREVIEW_ABORTED']);
export class ManagedApplicationModelPreviewError extends Error{constructor(code){const c=CODES.has(code)?code:'APPLICATION_PREVIEW_DENIED';super(c);this.name='ManagedApplicationModelPreviewError';this.code=c;this.outcome='not_sent';this.retryable=false;}}
const fail=code=>{throw new ManagedApplicationModelPreviewError(code);};
const copy=v=>JSON.parse(managedImageCanonical(v)),digest=managedImageDigest,hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const flags=Object.freeze({keyAccessAuthorized:false,requestLedgerAuthorized:false,submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false});
function own(v,keys){
 if(types.isProxy(v)||!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('APPLICATION_PREVIEW_INVALID');
 const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('APPLICATION_PREVIEW_INVALID');out[k]=d.value;}return out;
}
function method(o,k){if(!o||types.isProxy(o))return null;const d=Object.getOwnPropertyDescriptor(o,k);return d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)?(...a)=>Reflect.apply(d.value,o,a):null;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function bytesCopy(v,max){
 if(types.isProxy(v)||!types.isUint8Array(v))fail('APPLICATION_PREVIEW_INVALID');
 const buffer=get('buffer').call(v),size=get('byteLength').call(v);
 if(types.isSharedArrayBuffer(buffer)||size<1||size>max)fail('APPLICATION_PREVIEW_BINDING');
 return Buffer.from(new Uint8Array(buffer,get('byteOffset').call(v),size));
}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function safeError(e){if(!types.isProxy(e)&&e instanceof ManagedApplicationModelPreviewError){const d=Object.getOwnPropertyDescriptor(e,'code');if(d&&Object.hasOwn(d,'value'))return new ManagedApplicationModelPreviewError(d.value);}return new ManagedApplicationModelPreviewError();}
function packet(value,q){const v=own(value,['task','report']),task=validateManagedApplicationStrictTask(v.task),report=validateManagedApplicationStrictReport(v.report,task),input=buildManagedApplicationStrictInput({task,report});if(task.taskId!==q.taskId||!same(task.claimedArtifact.artifact.authority.scope,q.scope))fail('APPLICATION_PREVIEW_BINDING');return freeze({task,report,input});}
function observations(value){const r=copy(value);own(r,['observations']);if(!Array.isArray(r.observations)||r.observations.length<1||r.observations.length>2)fail('APPLICATION_PREVIEW_INVALID');const seen=new Set();for(const o of r.observations){own(o,['field','value']);if(!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))fail('APPLICATION_PREVIEW_INVALID');seen.add(o.field);}return freeze(r);}
function bodyFor(modelConfig,input,base64){const prompt=buildDesignImagePrompt();return JSON.stringify({model:modelConfig.model,messages:[{role:'system',content:prompt.system},{role:'user',content:[{type:'text',text:'剪前单图；方向：'+input.angle+'。未知不得补猜，结果仅待员工复核。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+base64}}]}],max_tokens:modelConfig.maxOutputTokens,response_format:{type:'json_object'},stream:false});}
function candidate(prepared,result){
 const r=observations(result),i=prepared.input,requestBinding={payloadSha256:prepared.transportRequest.payloadSha256,model:prepared.model,promptVersion:prepared.promptVersion};
 const entries=r.observations.map(o=>({category:'person_style',field:'managed_before_'+(o.field==='visible_outline'?'outline':'hair_shape')+'_'+i.angle,track:'context',origin:'extraction',basis:'observable',value:o.value,status:o.value===null?'unknown':'not_confirmed'}));
 const body={schemaVersion:APPLICATION_MODEL_PREVIEW_SCHEMA,state:'mock_preview_not_dispatched',kind:'managed_before_view',generation:'synthetic_mock_response',requestId:prepared.requestId,input:i,requestBinding,result:r,entries,...flags};
 return freeze({id:'application-preview-'+digest(body),...body});
}
/** Pure validation of a mock preview, not provenance or authorization. The
 * context must originate from the private preparer; JSON alone grants nothing. */
export function validateManagedApplicationMockCandidate(value,{prepared,task,report}={}){try{
 const c=copy(value),p=own(prepared,['schemaVersion','state','requestId','input','model','maxOutputTokens','promptVersion','transportRequest',...Object.keys(flags)]);
 if(p.schemaVersion!==APPLICATION_MODEL_PREPARED_SCHEMA||p.state!=='prepared_not_dispatched'||!id(p.requestId)||Object.keys(flags).some(k=>p[k]!==false))fail();
 const input=validateManagedApplicationStrictInput(p.input,{task,report}),transport=validateManagedImageModelTransportRequest(p.transportRequest),t=validateManagedApplicationStrictTask(task);
 if(typeof p.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(p.model)||!Number.isSafeInteger(p.maxOutputTokens)||p.maxOutputTokens<1||p.maxOutputTokens>8192||p.promptVersion!==buildDesignImagePrompt().promptVersion)fail();
 const parsed=JSON.parse(transport.body),url=parsed?.messages?.[1]?.content?.[1]?.image_url?.url;if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))fail();
 const base64=url.slice('data:image/png;base64,'.length),bytes=Buffer.from(base64,'base64');try{if(bytes.length!==input.verificationBinding.output.byteLength||bytes.length>262144||bytes.toString('base64')!==base64||hash(bytes)!==input.verificationBinding.output.sha256||transport.body!==bodyFor(p,input,base64))fail();}finally{bytes.fill(0);}
 const expected=candidate(p,c.result);if(!same(c,expected))fail();return expected;
 }catch{fail('APPLICATION_PREVIEW_INVALID');}}

export function createManagedApplicationModelPreview({enabled=false,ledger,storage,modelConfig,approvedModels,timeoutMs=30000}={}){
 const readVerified=method(ledger,'readVerified'),read=method(storage,'read');let config;
 try{config=copy({modelConfig,approvedModels});own(config.modelConfig,['model','maxOutputTokens']);const m=config.modelConfig;if(typeof m.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(m.model)||!Array.isArray(config.approvedModels)||!config.approvedModels.length||config.approvedModels.length>32||config.approvedModels.some(x=>typeof x!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(x))||!config.approvedModels.includes(m.model)||!Number.isSafeInteger(m.maxOutputTokens)||m.maxOutputTokens<1||m.maxOutputTokens>8192)throw 0;freeze(config);}catch{config=null;}
 const ready=enabled===true&&config&&readVerified&&read&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000;let busy=false;
 async function run(value,withPreview){
  if(!ready)fail('APPLICATION_PREVIEW_DISABLED');if(busy)fail('APPLICATION_PREVIEW_BUSY');busy=true;
  let timer,external,listener,reason,bytes,mock,resolveStop;const controller=new AbortController(),deadline=performance.now()+timeoutMs;
  const stopped=new Promise(resolve=>{resolveStop=resolve;});
  const stop=code=>{if(!reason){reason=code;controller.abort();resolveStop(code);}};
  const check=()=>{if(external&&aborted.call(external))stop('APPLICATION_PREVIEW_ABORTED');if(performance.now()>=deadline)stop('APPLICATION_PREVIEW_TIMEOUT');if(reason)fail(reason);};
  // One work promise retains admission until every dependency actually settles.
  // Timeout returns promptly, but late reads cannot resume into another step.
  const work=(async()=>{try{
   if(types.isProxy(value)||!value)fail('APPLICATION_PREVIEW_INVALID');
   const hasSignal=Object.hasOwn(value,'signal'),v=own(value,['credential','scope','requestId','taskId',...(withPreview?['mockResponse']:[]),...(hasSignal?['signal']:[])]);
   if(hasSignal){external=v.signal;if(types.isProxy(external))fail('APPLICATION_PREVIEW_INVALID');aborted.call(external);listener=()=>stop('APPLICATION_PREVIEW_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   const q=copy({credential:v.credential,scope:v.scope,requestId:v.requestId,taskId:v.taskId});if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential)||!id(q.requestId)||!id(q.taskId))fail('APPLICATION_PREVIEW_INVALID');q.scope=validateProductionDesignScope(q.scope);freeze(q);
   if(withPreview)mock=bytesCopy(v.mockResponse,262144);check();timer=setTimeout(()=>stop('APPLICATION_PREVIEW_TIMEOUT'),Math.max(1,deadline-performance.now()));
   const selector=freeze({credential:q.credential,scope:q.scope,taskId:q.taskId});
   const initial=packet(await readVerified(selector),q);check();
   const manifest=initial.task.normalizedManifest,out=initial.input.verificationBinding.output;
   const stored=await read(Object.freeze({credential:q.credential,scope:q.scope,reference:initial.input.verificationBinding.normalizedReference,signal:controller.signal}));check();if(!same(stored.manifest,manifest))fail('APPLICATION_PREVIEW_BINDING');const raw=stored.bytes;
   bytes=bytesCopy(raw,262144);if(bytes.length!==out.byteLength||hash(bytes)!==out.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('APPLICATION_PREVIEW_BINDING');
   const fresh=async()=>{check();const current=packet(await readVerified(selector),q);check();if(!same(initial,current))fail('APPLICATION_PREVIEW_BINDING');};
   await fresh();check();const m=config.modelConfig,prompt=buildDesignImagePrompt();
   const body=bodyFor(m,initial.input,bytes.toString('base64'));bytes.fill(0);bytes=null;
   const transportRequest=validateManagedImageModelTransportRequest({schemaVersion:'design-managed-image-model-transport-v1',url:MANAGED_IMAGE_MODEL_ENDPOINT,method:'POST',redirect:'error',credentials:'omit',body,byteLength:Buffer.byteLength(body),payloadSha256:hash(body),dispatchAuthorized:false});
   const prepared=freeze({schemaVersion:APPLICATION_MODEL_PREPARED_SCHEMA,state:'prepared_not_dispatched',requestId:q.requestId,input:initial.input,model:m.model,maxOutputTokens:m.maxOutputTokens,promptVersion:prompt.promptVersion,transportRequest,...flags});
   if(!withPreview){check();return prepared;}
   const result=parseManagedImageModelObservations(mock);mock.fill(0);mock=null;const preview=candidate(prepared,result);
   await fresh();check();return freeze({prepared,candidate:preview});
  }catch(e){throw safeError(e);}finally{clearTimeout(timer);if(external&&listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);bytes?.fill(0);mock?.fill(0);busy=false;}})();
  // Race is only delivery control; no underlying operation is retried or lost.
  const outcome=await Promise.race([work.then(value=>({value}),error=>({error})),stopped.then(code=>({error:new ManagedApplicationModelPreviewError(code)}))]);
  if(outcome.error)throw outcome.error;return outcome.value;
 }
 return Object.freeze({prepare:value=>run(value,false),preview:value=>run(value,true)});
}
