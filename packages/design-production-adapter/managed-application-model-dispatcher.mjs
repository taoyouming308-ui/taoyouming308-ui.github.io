/** Default-closed SYNTHETIC-only orchestration. No default network, real key,
 * issuer or storage. Injected capabilities are trusted server dependencies.
 * Fixed-reference qualification is never arbitrary-photo qualification.
 * Uncertain receipts are query-only; a timeout retains admission and buffers
 * until the dependency actually settles. JS key/body strings cannot be wiped. */
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {managedImageCanonical,managedImageDigest as digest} from './managed-image-contracts.mjs';
import {buildManagedApplicationProviderIntent} from './managed-application-provider-contracts.mjs';
import {buildManagedApplicationResultCandidate,validateManagedApplicationResultCandidate} from '../analysis-engine/managed-application-result-candidate.mjs';
import {parseManagedImageModelObservations} from './managed-image-model-result.mjs';
import {validateManagedImageModelTransportRequest} from './managed-image-model-request.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const copy=v=>JSON.parse(managedImageCanonical(v)),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export class ManagedApplicationDispatchError extends Error{constructor(outcome='not_sent'){super('APPLICATION_DISPATCH_DENIED');this.code=this.message;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedApplicationDispatchError();};
function method(o,k){if(!o||types.isProxy(o))return null;const d=Object.getOwnPropertyDescriptor(o,k);return d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)?(...a)=>Reflect.apply(d.value,o,a):null;}
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
function data(v,k){if(!v||types.isProxy(v))fail();const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();return d.value;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function responseCopy(v){const r=own(v,['url','status','redirected','body']);if(types.isProxy(r.body)||!types.isUint8Array(r.body))fail();const n=get('byteLength').call(r.body),b=get('buffer').call(r.body);if(types.isSharedArrayBuffer(b)||n<1||n>262144)fail();return {...r,body:Buffer.from(new Uint8Array(b,get('byteOffset').call(r.body),n))};}
function preparedCopy(v){const p=own(v,['schemaVersion','state','requestId','input','model','maxOutputTokens','promptVersion','transportRequest','keyAccessAuthorized','requestLedgerAuthorized','submissionAuthorized','adoptionAuthorized','publicEligible']);return freeze(Object.fromEntries(Object.entries(p).map(([k,x])=>[k,k==='transportRequest'?validateManagedImageModelTransportRequest(x):copyManagedResultData(x)])));}
function request(v,query){const q=copy(v),keys=query?['credential','scope','requestId']:['credential','scope','requestId','taskId','expectedWorkflowRevision'];if(Object.keys(q).sort().join('|')!==keys.sort().join('|')||typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential)||!(query?['requestId']:['requestId','taskId']).every(k=>typeof q[k]==='string'&&/^[-A-Za-z0-9_]{1,100}$/.test(q[k]))||!query&&(!Number.isSafeInteger(q.expectedWorkflowRevision)||q.expectedWorkflowRevision<0))fail();q.scope=validateProductionDesignScope(q.scope);return freeze(q);}
export function createManagedApplicationModelDispatcher({enabled=false,executionMode,preparer,facade,sealer,transport,timeoutMs=30000}={}){
 const prepare=method(preparer,'prepare'),forRequest=method(facade,'forRequest'),forQuery=method(facade,'forQuery'),open=method(sealer,'open'),keyDigest=method(sealer,'digest');
 const send=typeof transport==='function'&&!types.isProxy(transport)?transport:null;let busy=false,poisoned=false;
 async function run(value,query){
  if(enabled!==true||executionMode!=='synthetic_mock'||busy||poisoned||!forQuery||!query&&(!prepare||!forRequest||!open||!keyDigest||!send)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();
  const q=request(value,query);busy=true;let timer,lease,key=null,keyBytes,reserveAttempted=false,claimAttempted=false,publishAttempted=false,stopped=false,resolveStop;
  const deadline=performance.now()+timeoutMs,abort=new AbortController(),stopPromise=new Promise(resolve=>{resolveStop=resolve;});
  const uncertain=()=>reserveAttempted||claimAttempted||publishAttempted;
  const check=()=>{if(performance.now()>=deadline){stopped=true;poisoned=true;abort.abort();}if(stopped||abort.signal.aborted)fail();};
  timer=setTimeout(()=>{stopped=true;poisoned=true;abort.abort();resolveStop({error:new ManagedApplicationDispatchError(uncertain()?'uncertain':'not_sent')});},timeoutMs);
  const work=(async()=>{try{
   const step=async fn=>{check();const v=await fn();check();return v;};
   const base=freeze(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='expectedWorkflowRevision')));
   lease=await step(()=>query?forQuery(base):forRequest(base));
   const reserve=method(lease,'reserve'),claim=method(lease,'dispatchClaim'),complete=method(lease,'complete'),readResult=method(lease,'readResult');if(!readResult||!query&&(!reserve||!claim||!complete))fail();
   const c=freeze(copyManagedResultData(data(lease,'context'))),intent=c.approvedIntent;
   if(!query&&q.expectedWorkflowRevision!==c.workflowBinding.recordRevision)fail();
   const checked=result=>{const r=validateManagedApplicationResultCandidate(result,{session:c.session,workflowBinding:c.workflowBinding,input:{task:c.task,report:c.report}});if(r.generation!=='synthetic_mock_model'||!same(r.authority,c.authority)||!same(r.scope,q.scope)||!same(r.applicationBinding,intent.applicationBinding)||r.requestBinding.requestId!==q.requestId||r.requestBinding.intentDigest!==digest(intent)||r.requestBinding.payloadSha256!==intent.payloadSha256||r.requestBinding.model!==intent.model||r.requestBinding.promptVersion!==intent.applicationBinding.promptVersion||r.requestBinding.approvalReceiptId!==c.approvedReceiptId||r.requestBinding.ownerKey!==c.ownerKey)fail();return r;};
   const read=async()=>{const row=copyManagedResultData(await step(()=>readResult()));if(row?.state!=='completed'){if(!['pending','dispatch_claimed','uncertain','not_sent','missing'].includes(row?.state))fail();return freeze({state:row.state,requestId:q.requestId,retryable:false});}return freeze({state:'completed',candidate:checked(row.result),replayed:true});};
   if(query)return await read();
   const prepared=preparedCopy(await step(()=>prepare(base))),body=validateManagedImageModelTransportRequest(prepared.transportRequest);
   const actual=buildManagedApplicationProviderIntent({prepared,keyBinding:c.keyBinding,workflowBinding:c.workflowBinding,cost:intent.cost});
   if(!same(actual,intent)||!same(prepared.input,c.applicationInputBinding)||prepared.requestId!==q.requestId)fail();
   reserveAttempted=true;const reserved=copyManagedResultData(await step(()=>reserve({intent:actual})));if(reserved?.created!==true){if(reserved?.state==='completed')return await read();throw new ManagedApplicationDispatchError('uncertain');}
   key=await step(()=>open(c.keyRecord.sealed,c.keyRecord));if(typeof key!=='string'||!/^[-A-Za-z0-9._~]{16,500}$/.test(key))fail();keyBytes=Buffer.from(key);if(await step(()=>keyDigest(key))!==c.keyBinding.keyDigest)fail();
   const transportInput={url:body.url,method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body.body,credentials:'omit',redirect:'error',signal:abort.signal,maxResponseBytes:262144};
   claimAttempted=true;if(await step(()=>claim())!==true)fail();
   // No intervening async action between current composite claim and transport.
   check();const pending=send(transportInput);const response=responseCopy(await step(()=>pending));
   let parsed;try{if(response.url!==body.url||response.status!==200||response.redirected!==false)fail();parsed=parseManagedImageModelObservations(response.body);if(JSON.stringify(parsed).includes(key))fail();}finally{response.body.fill(0);}
   const candidate=buildManagedApplicationResultCandidate({id:'application-'+digest({authority:c.authority,requestId:q.requestId}),authority:c.authority,scope:q.scope,workflowBinding:c.workflowBinding,requestBinding:{requestId:q.requestId,intentDigest:digest(intent),payloadSha256:body.payloadSha256,model:prepared.model,promptVersion:prepared.promptVersion,approvalReceiptId:c.approvedReceiptId,ownerKey:c.ownerKey},applicationBinding:intent.applicationBinding,session:c.session,observations:parsed.observations,input:{task:c.task,report:c.report}});
   checked(candidate);publishAttempted=true;if(await step(()=>complete({result:candidate}))!==true)fail();const out=await read();if(out.state!=='completed')fail();return freeze({...out,replayed:false});
  }catch{
   keyBytes?.fill(0);key=null;
   if(uncertain()){poisoned=true;const mark=method(lease,'markUncertain');if(mark){try{await mark();}catch{}}}
   throw new ManagedApplicationDispatchError(uncertain()?'uncertain':'not_sent');
  }finally{clearTimeout(timer);abort.abort();keyBytes?.fill(0);key=null;busy=false;}})();
  const result=await Promise.race([work.then(value=>({value}),error=>({error})),stopPromise]);if(result.error)throw result.error;return result.value;
 }
 return Object.freeze({dispatch:q=>run(q,false),query:q=>run(q,true)});
}
