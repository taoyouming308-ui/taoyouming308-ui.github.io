/** Explicit default-closed HTTP service for the fixed synthetic lane only. */
import {policyCopy,policyExact,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {projectManagedNormalizedReview,validateManagedNormalizedProjection} from './managed-normalized-http-projection.mjs';
export function createManagedNormalizedHttpService({enabled=false,createDispatcher,repository,run,authenticate}={}){
 const fail=()=>{throw Error('MANAGED_NORMALIZED_SERVICE_DENIED');};
 const ready=()=>{if(enabled!==true||typeof createDispatcher!=='function'||typeof run!=='function'||typeof authenticate!=='function'||typeof repository?.publish!=='function'||typeof repository?.load!=='function')fail();};
 async function execute(value,describe){ready();const r=policyCopy(value);policyExact(r,['credential','scope','requestId',...(describe?['taskId','expectedWorkflowRevision']:[])]);await authenticate(r.credential);const base={credential:r.credential,scope:r.scope,requestId:r.requestId};
  const result=await createDispatcher()[describe?'dispatch':'query'](describe?r:base);let state=result.state,candidateId=null;
  if(state==='completed'){const saved=await run(r,()=>repository.publish(base));if(!policyEqual(saved.candidate,result.candidate)||saved.candidate.requestBinding.requestId!==r.requestId||!policyEqual(saved.candidate.scope,r.scope))fail();candidateId=saved.candidate.id;}
  else if(state==='missing')state='not_found';else if(['dispatch_claimed','not_sent'].includes(state))state='uncertain';
  await authenticate(r.credential);return validateManagedNormalizedProjection({schemaVersion:'design-normalized-model-status-v1',requestId:r.requestId,state,candidateId,retryable:false,synthetic:true,productionEligible:false},{type:'status',payload:r});
 }
 return Object.freeze({describe:r=>execute(r,true),status:r=>execute(r,false),async load(value){ready();const r=policyCopy(value);policyExact(r,['credential','scope','candidateId']);await authenticate(r.credential);const row=await run(r,()=>repository.load(r));if(row.candidate.id!==r.candidateId||!policyEqual(row.candidate.scope,r.scope))fail();await authenticate(r.credential);return projectManagedNormalizedReview(row);}});
}
