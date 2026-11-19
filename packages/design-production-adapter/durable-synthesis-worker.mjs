/** Explicit finite worker pump. No daemon, environment credentials, retry or default network. */
import {validateDurableLease,DurableSynthesisError} from './durable-synthesis-contracts.mjs';
import {policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {DEEPSEEK_CHAT_ENDPOINT} from './provider-adapter.mjs';
const fail=()=>{throw new DurableSynthesisError('DURABLE_DENIED');};
const sameLease=(a,b)=>a&&b&&a.operationId===b.operationId&&a.fence===b.fence&&policyEqual(a.authority,b.authority)&&policyEqual(a.intent,b.intent);
const report=(state,lease=null)=>Object.freeze({state,operationId:lease?.operationId??null});
/** Trusted injected repositories own fresh authorization and durable dispatch claim.
 * buildPayload is a fixed reviewed pure builder, never a browser callback.
 * Cancellation/abort after claim cannot retract bytes or guarantee no charge.
 */
export function createDurableSynthesisWorker({enabled=false,repository,executionRepository,buildPayload,sealer,transport,timeoutMs=30000}={}){
 let busy=false,poisoned=false;
 const configured=()=>enabled===true&&['claim','dispatch','finish','fail'].every(k=>typeof repository?.[k]==='function')&&['prepare','readKey'].every(k=>typeof executionRepository?.[k]==='function')&&typeof buildPayload==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;
 async function runOnce({signal}={}){
  if(!configured())throw new DurableSynthesisError('DURABLE_DISABLED');
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw new DurableSynthesisError('DURABLE_INVALID');
  if(busy||poisoned)throw new DurableSynthesisError('DURABLE_CONFLICT');
  if(signal?.aborted)return report('stopped');
  busy=true;let lease=null,dispatchAttempted=false,finishAttempted=false,key=null,controller=new AbortController(),timer;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const active=()=>{if(controller.signal.aborted)fail();};
  // Bound await without allowing late resolution to resume this execution.
  const wait=async operation=>{active();let onAbort;try{const pending=Promise.resolve(operation());return await Promise.race([pending,new Promise((_,reject)=>{onAbort=()=>reject(new DurableSynthesisError('DURABLE_DENIED'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();})]);}finally{controller.signal.removeEventListener('abort',onAbort);}};
  try{
   timer=setTimeout(abort,timeoutMs);
   lease=validateDurableLease(await wait(()=>repository.claim()));if(!lease)return report('idle');active();
   const fenced=Object.freeze({operationId:lease.operationId,fence:lease.fence});
   const prepared=await wait(()=>executionRepository.prepare(fenced));active();
   if(!sameLease(lease,validateDurableLease(prepared.lease)))fail();
   const payload=buildPayload(prepared);active();
   let candidate;
   if(lease.intent.kind==='local'){
    if(payload.kind!=='local'||!payload.localCandidate)fail();candidate=payload.localCandidate;
   }else{
    if(payload.kind!=='external'||payload.destination!==DEEPSEEK_CHAT_ENDPOINT||typeof payload.body!=='string'||typeof payload.parse!=='function'||typeof transport!=='function'||typeof sealer?.open!=='function'||typeof sealer?.digest!=='function')fail();
    const keyed=await wait(()=>executionRepository.readKey(fenced));active();
    if(!sameLease(lease,validateDurableLease(keyed.lease)))fail();
    key=await wait(()=>sealer.open(keyed.keyRecord.sealed,keyed.keyRecord));active();
    if(typeof key!=='string'||key.length<16||key.length>500||!/^[A-Za-z0-9._~-]+$/.test(key))fail();
    if(await wait(()=>sealer.digest(key))!==lease.intent.keyBinding.keyDigest)fail();active();
    const request=Object.freeze({url:DEEPSEEK_CHAT_ENDPOINT,method:'POST',redirect:'error',credentials:'omit',maxResponseBytes:262144,headers:Object.freeze({'Content-Type':'application/json',Authorization:'Bearer '+key}),body:payload.body,signal:controller.signal});
    dispatchAttempted=true;
    // A lost acknowledgment means no transport. Never retry this claim or job.
    if(await wait(()=>repository.dispatch(fenced))!==true)fail();active();
    // No intervening await after confirmed claim and before transport invocation.
    const response=await wait(()=>transport(request));active();
    if(!response||Object.getPrototypeOf(response)!==Object.prototype||response.url!==DEEPSEEK_CHAT_ENDPOINT||response.redirected!==false||response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers?.['content-type']||''))fail();
    const bytes=typeof response.body==='string'?Buffer.from(response.body):response.body instanceof Uint8Array?Buffer.from(response.body):null;
    if(!bytes||bytes.length>262144)fail();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes(key))fail();
    candidate=payload.parse(JSON.parse(text));if(JSON.stringify(candidate).includes(key))fail();
   }
   key=null;active();
   finishAttempted=true;const finished=await wait(()=>repository.finish({...fenced,candidateEnvelope:candidate}));active();
   if(finished?.operation?.id!==lease.operationId||finished.operation.state!=='completed')fail();
   return report('completed',lease);
  }catch{
   if(controller.signal.aborted)poisoned=true;
   // Settlement is best-effort, never repeats execution. Revocation may leave a
   // permanent original-ledger tombstone; do not turn it into permission to retry.
   let settlementUnknown=false;
   if(lease){let cleanupTimer;try{await Promise.race([Promise.resolve().then(()=>repository.fail({operationId:lease.operationId,fence:lease.fence})),new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('CLEANUP_DEADLINE')),1000);})]);}catch{settlementUnknown=true;poisoned=true;}finally{clearTimeout(cleanupTimer);}}
   return report(dispatchAttempted||finishAttempted||settlementUnknown?'uncertain':lease?'stopped':'unknown',lease);
  }finally{key=null;clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);busy=false;}
 }
 return Object.freeze({runOnce,async runBatch({maxJobs=1,signal}={}){
  if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>32)throw new DurableSynthesisError('DURABLE_INVALID');
  const results=[];for(let i=0;i<maxJobs&&!signal?.aborted;i++){const result=await runOnce({signal});results.push(result);if(result.state!=='completed')break;}return policyFreeze({results});
 }});
}
