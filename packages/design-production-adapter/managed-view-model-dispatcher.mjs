/** Server-only managed dispatch. Default off, no default network/key/issuer.
 * The facade is the fixed durable PostgreSQL capability, not browser input.
 * A claim acknowledgement loss never authorizes transport or automatic retry.
 * Abort cannot retract bytes already sent or supplier charges. */
import {types} from 'node:util';
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {buildManagedViewProviderIntent} from './managed-view-provider-contracts.mjs';
import {buildManagedViewResultCandidate,validateManagedViewResultCandidate,buildManagedSynthesisEvidence} from '../analysis-engine/managed-view-result-candidate.mjs';
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {parseManagedViewModelResult} from './managed-view-model-result.mjs';
import {validateManagedImageModelTransportRequest} from './managed-image-model-request.mjs';
const copy=x=>JSON.parse(managedImageCanonical(x)),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export class ManagedViewDispatchError extends Error{constructor(outcome='not_sent'){super('MANAGED_VIEW_DISPATCH_FAILED');this.code=this.message;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedViewDispatchError();};
function request(v,queryOnly){const q=copy(v);if(Object.keys(q).sort().join('|')!==(queryOnly?'credential|requestId|scope':'candidateKind|credential|expectedWorkflowRevision|requestId|scope|selectors')||typeof q.credential!=='string'||q.credential.length<32||q.credential.length>4096||typeof q.requestId!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(q.requestId)||!queryOnly&&(!Number.isSafeInteger(q.expectedWorkflowRevision)||q.expectedWorkflowRevision<0))fail();if(!queryOnly){const k=q.candidateKind,keys=k==='managed_before_view'?['taskId']:k==='managed_completion_comparison'?['beforeTaskId','afterTaskId']:k==='managed_completion_synthesis'?['side']:null;if(!keys||Object.keys(q.selectors).sort().join('|')!==[...keys].sort().join('|'))fail();for(const n of keys)if(typeof q.selectors[n]!=='string'||!(n==='side'?['left','right'].includes(q.selectors[n]):/^[-A-Za-z0-9_]{1,100}$/.test(q.selectors[n])))fail();}return freeze(q);}

function snapshotPrepared(value){if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();const keys=['schemaVersion','state','intent','transportRequest','submissionAuthorized','adoptionAuthorized'];if(Reflect.ownKeys(value).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=k==='transportRequest'?(d.value===null?null:validateManagedImageModelTransportRequest(d.value)):copyManagedResultData(d.value);}return freeze(out);}
export function createManagedViewDispatcher({enabled=false,preparer,facade,sealer,transport,timeoutMs=30000}={}){
 let busy=false,poisoned=false;
 async function run(input,queryOnly){let timer,lease,key=null,keyBytes,claimAttempted=false,reserveAttempted=false,finishAttempted=false,admitted=false;const abort=new AbortController();
 try{
 if(enabled!==true||busy||poisoned||typeof facade?.[queryOnly?'forQuery':'forRequest']!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();if(!queryOnly&&(typeof preparer?.prepare!=='function'))fail();
 const q=request(input,queryOnly);busy=true;admitted=true;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{poisoned=true;abort.abort();reject(new ManagedViewDispatchError());},timeoutMs);});
 const step=async fn=>{if(abort.signal.aborted)fail();const v=await Promise.race([Promise.resolve().then(()=>{if(abort.signal.aborted)fail();return fn();}),deadline]);if(abort.signal.aborted)fail();return v;};
 const base=freeze(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='expectedWorkflowRevision')));lease=await step(()=>queryOnly?facade.forQuery(base):facade.forRequest(base));let c=copyManagedResultData(lease.context);if(c.evidenceBinding?.generation){const rebuilt=buildManagedSynthesisEvidence({session:c.session,managedImageHistory:c.managedImageHistory,side:c.evidenceBinding.side});if(!same(rebuilt.evidenceBinding,c.evidenceBinding))fail();c.allowedReviewFocus=rebuilt.allowedReviewFocus;}c=freeze(c);const local=c.evidenceBinding?.generation==='deterministic';if(!queryOnly&&q.expectedWorkflowRevision!==c.workflowBinding.recordRevision)fail();
 let activeIntent;const checked=result=>{const r=validateManagedViewResultCandidate(result,{session:c.session,workflowBinding:c.workflowBinding,...(c.managedImageHistory?{managedImageHistory:c.managedImageHistory}:{})});const i=c.intent??c.approvedIntent??activeIntent;if(!same(r.authority,c.authority)||!same(r.scope,q.scope)||!same(r.evidenceBinding,c.evidenceBinding)||r.requestBinding.requestId!==q.requestId||r.requestBinding.intentDigest!==managedImageDigest(i)||r.requestBinding.payloadSha256!==i.payloadSha256||r.requestBinding.model!==i.model||r.requestBinding.promptVersion!==i.promptVersion)fail();return r;};
 async function read(){const out=await step(()=>lease.readResult());if(out?.state!=='completed'){if(!['pending','dispatch_claimed','uncertain','not_sent','missing'].includes(out?.state))fail();return freeze({state:out.state,requestId:q.requestId,retryable:false});}const candidate=checked(out.result);return freeze({state:'completed',candidate,replayed:true});}
 if(queryOnly)return await read();
 const p=await step(()=>preparer.prepare(base,c)),prepared=snapshotPrepared(p),body=prepared.transportRequest;
 const intent=activeIntent=buildManagedViewProviderIntent({prepared,keyBinding:c.keyBinding,workflowBinding:c.workflowBinding,cost:c.approvedIntent?.cost??null});
 if(prepared.intent.requestId!==q.requestId||!same(prepared.intent.scope,q.scope)||!local&&!same(intent,c.approvedIntent)||!same(prepared.intent.authority,c.authority)||!same(prepared.intent.evidenceBinding,c.evidenceBinding))fail();
 reserveAttempted=true;const reserved=await step(()=>lease.reserve({intent}));if(reserved?.created!==true){if(reserved?.state==='completed')return await read();throw new ManagedViewDispatchError('uncertain');}
 if(!local&&(typeof sealer?.open!=='function'||typeof sealer?.digest!=='function'||typeof transport!=='function'))fail();
 let parsed;
 if(local){if(await step(()=>lease.dispatchClaim())!==true)fail();parsed={reviewFocus:c.allowedReviewFocus[0]??null};}else{
 key=await step(()=>sealer.open(c.keyRecord.sealed,c.keyRecord));if(typeof key!=='string'||!/^[-A-Za-z0-9._~]{16,500}$/.test(key))fail();keyBytes=Buffer.from(key);
 if(await step(()=>sealer.digest(key))!==c.keyBinding.keyDigest)fail();
 const transportInput={url:body.url,method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body.body,credentials:'omit',redirect:'error',signal:abort.signal,maxResponseBytes:262144};
 claimAttempted=true;
 if(await step(()=>lease.dispatchClaim())!==true)fail();
 // Deliberately no intervening await after final composite SQL claim.
 if(abort.signal.aborted)fail();const sent=transport(transportInput);const response=await step(()=>sent);
 if(response?.url!==body.url||response.status!==200||response.redirected!==false||types.isProxy(response.body)||!types.isUint8Array(response.body))fail();
 parsed=parseManagedViewModelResult(response.body,{kind:q.candidateKind,allowedReviewFocus:c.allowedReviewFocus});
 if(JSON.stringify(parsed).includes(key))fail();}

 const result=buildManagedViewResultCandidate({id:'managed-view-'+managedImageDigest({authority:c.authority,requestId:q.requestId}),kind:q.candidateKind,authority:c.authority,scope:q.scope,workflowBinding:c.workflowBinding,requestBinding:{requestId:q.requestId,intentDigest:managedImageDigest(intent),payloadSha256:prepared.intent.payloadSha256,model:prepared.intent.model,promptVersion:prepared.intent.promptVersion},evidenceBinding:c.evidenceBinding,session:c.session,...(c.managedImageHistory?{managedImageHistory:c.managedImageHistory}:{}),result:parsed});
 checked(result);finishAttempted=true;if(await step(()=>lease.complete({result}))!==true)fail();const out=await read();if(out.state!=='completed')fail();return freeze({...out,replayed:false});
 }catch{
 const uncertain=reserveAttempted||claimAttempted||finishAttempted;
 if(uncertain&&lease&&typeof lease.markUncertain==='function'){let cleanup;try{await Promise.race([Promise.resolve().then(()=>lease.markUncertain()),new Promise((_,reject)=>{cleanup=setTimeout(()=>reject(new Error('cleanup')),1000);})]);}catch{poisoned=true;}finally{clearTimeout(cleanup);}}
 throw new ManagedViewDispatchError(uncertain?'uncertain':'not_sent');
 }finally{clearTimeout(timer);abort.abort();keyBytes?.fill(0);key=null;if(admitted)busy=false;}}
 return Object.freeze({dispatch:q=>run(q,false),query:q=>run(q,true)});
}
