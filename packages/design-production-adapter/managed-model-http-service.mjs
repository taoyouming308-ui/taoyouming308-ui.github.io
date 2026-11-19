/** Minimal HTTP projections. No caller candidate JSON, transport defaults or retries. */
import {policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
export function createManagedModelHttpService({enabled=false,createDispatcher,repository,run,authenticate}={}){
 const denied=()=>{throw new Error('MANAGED_MODEL_SERVICE_DENIED');};
 const ready=()=>{if(enabled!==true||typeof createDispatcher!=='function'||typeof run!=='function'||typeof authenticate!=='function'||typeof repository?.publish!=='function'||typeof repository?.load!=='function')denied();};
 async function execute(request,query){ready();await authenticate(request.credential);const dispatcher=createDispatcher();
  const fixed=Object.fromEntries((query?['credential','scope','requestId']:['credential','scope','requestId','taskId','expectedWorkflowRevision']).map(k=>[k,request[k]]));
  const result=await dispatcher[query?'query':'dispatch'](fixed);
  let candidateId=null,state=result.state;
  if(state==='completed'){
   const saved=await run(request,()=>repository.publish({credential:request.credential,scope:request.scope,requestId:request.requestId}));
   if(!policyEqual(saved.candidate,result.candidate))denied();candidateId=saved.candidate.id;
  }else if(state==='missing')state='not_found';else if(state==='dispatch_claimed'||state==='not_sent')state='uncertain';
  if(!['not_found','pending','uncertain','completed'].includes(state))denied();
  await authenticate(request.credential);
  return policyFreeze({schemaVersion:'design-managed-model-status-v1',requestId:request.requestId,state,candidateId,retryable:false});
 }
 return Object.freeze({describe:r=>execute(r,false),status:r=>execute(r,true),async load(request){ready();await authenticate(request.credential);const value=await run(request,()=>repository.load(request));const c=value.candidate;if(c.id!==request.candidateId||!policyEqual(c.scope,request.scope))denied();await authenticate(request.credential);return policyFreeze({schemaVersion:'design-managed-model-review-v1',id:c.id,kind:'managed_visual_description',scope:c.scope,sessionId:c.workflowBinding.sessionId,baseRevision:c.workflowBinding.sessionRevision,candidate:c.candidate,reviewOnly:true});}});
}
