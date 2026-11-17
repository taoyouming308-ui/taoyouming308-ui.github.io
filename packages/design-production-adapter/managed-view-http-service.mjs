/** Scoped projections over explicit operations. No batch auto-send or retry. */
import {policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {projectManagedViewReview} from './managed-view-http-projection.mjs';
export function createManagedViewHttpService({enabled=false,createDispatcher,repository,run,authenticate,verificationStatus}={}){
 const fail=()=>{throw Error('MANAGED_VIEW_SERVICE_DENIED');};
 const ready=()=>{if(enabled!==true||typeof createDispatcher!=='function'||typeof run!=='function'||typeof authenticate!=='function'||typeof repository?.publish!=='function'||typeof repository?.load!=='function')fail();};
 const operations={describe:['managed_before_view',['taskId']],compare:['managed_completion_comparison',['beforeTaskId','afterTaskId']],synthesize:['managed_completion_synthesis',['side']]};
 async function execute(r,method){ready();await authenticate(r.credential);const base={credential:r.credential,scope:r.scope,requestId:r.requestId},op=operations[method],q=op?{...base,candidateKind:op[0],selectors:Object.fromEntries(op[1].map(k=>[k,r[k]])),expectedWorkflowRevision:r.expectedWorkflowRevision}:base;
  const result=await createDispatcher()[op?'dispatch':'query'](q);let state=result.state,candidateId=null;
  if(state==='completed'){const saved=await run(r,()=>repository.publish(base));if(!policyEqual(saved.candidate,result.candidate))fail();candidateId=saved.candidate.id;}
  else if(state==='missing')state='not_found';else if(['dispatch_claimed','not_sent'].includes(state))state='uncertain';
  if(!['not_found','pending','uncertain','completed'].includes(state))fail();await authenticate(r.credential);return policyFreeze({schemaVersion:'design-managed-view-status-v1',requestId:r.requestId,state,candidateId,retryable:false});
 }
 return Object.freeze({...Object.fromEntries(['describe','compare','synthesize','status'].map(m=>[m,r=>execute(r,m)])),async load(r){ready();await authenticate(r.credential);const row=await run(r,()=>repository.load(r));if(row.candidate.id!==r.candidateId||!policyEqual(row.candidate.scope,r.scope))fail();await authenticate(r.credential);return projectManagedViewReview(row);},async verificationStatus(r){ready();if(typeof verificationStatus!=='function')fail();await authenticate(r.credential);const value=await verificationStatus(r);await authenticate(r.credential);return value;}});
}
