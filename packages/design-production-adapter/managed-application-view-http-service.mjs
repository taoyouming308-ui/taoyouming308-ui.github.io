import {ManagedApplicationViewDispatchError} from './managed-application-view-model-dispatcher.mjs';
/** Scoped projections over explicit operations. No batch auto-send or retry. */
import {policyEqual,policyFreeze,policyCopy,policyExact} from './approval-attempt-contracts.mjs';
import {projectManagedApplicationViewReview} from './managed-application-view-http-projection.mjs';
export function createManagedApplicationViewHttpService({enabled=false,createDispatcher,repository,run,authenticate,verificationStatus,inlineReviewEnabled=false}={}){
 const fail=()=>{throw Error('MANAGED_APPLICATION_VIEW_SERVICE_DENIED');};
 const ready=()=>{if(enabled!==true||typeof createDispatcher!=='function'||typeof run!=='function'||typeof authenticate!=='function'||typeof repository?.publish!=='function'||typeof repository?.load!=='function')fail();};
 const operations={compare:['managed_application_completion_comparison',['beforeTaskId','afterTaskId']],synthesize:['managed_application_completion_synthesis',['side']]};
 async function execute(value,method){ready();const r=policyCopy(value),fields=operations[method]?.[1]??[];policyExact(r,['credential','scope','requestId',...fields,...(method==='status'?[]:['expectedWorkflowRevision'])]);await authenticate(r.credential);const base={credential:r.credential,scope:r.scope,requestId:r.requestId},op=operations[method],q=op?{...base,candidateKind:op[0],selectors:Object.fromEntries(op[1].map(k=>[k,r[k]])),expectedWorkflowRevision:r.expectedWorkflowRevision}:base;
  const result=await createDispatcher()[op?'dispatch':'query'](q);try{let state=result.state,candidateId=null,review=null;
  if(state==='completed'){const saved=await run(r,()=>repository.publish(base));if(!policyEqual(saved.candidate,result.candidate)||!policyEqual(saved.candidate.scope,r.scope)||saved.candidate.requestBinding.requestId!==r.requestId)fail();candidateId=saved.candidate.id;if(inlineReviewEnabled===true)review=projectManagedApplicationViewReview(saved);}
  else if(state==='missing')state='not_found';else if(['dispatch_claimed','not_sent'].includes(state))state='uncertain';
  if(!['not_found','pending','uncertain','completed'].includes(state))fail();await authenticate(r.credential);return policyFreeze({schemaVersion:inlineReviewEnabled===true?'design-application-view-model-status-v2':'design-application-view-model-status-v1',requestId:r.requestId,state,candidateId,retryable:false,synthetic:true,productionEligible:false,...(inlineReviewEnabled===true?{review}:{})});}catch{throw new ManagedApplicationViewDispatchError('uncertain');}
 }
 return Object.freeze({...Object.fromEntries(['compare','synthesize','status'].map(m=>[m,r=>execute(r,m)])),async load(value){ready();const r=policyCopy(value);policyExact(r,['credential','scope','candidateId']);await authenticate(r.credential);const row=await run(r,()=>repository.load(r));if(row.candidate.id!==r.candidateId||!policyEqual(row.candidate.scope,r.scope))fail();try{await authenticate(r.credential);}catch{throw new ManagedApplicationViewDispatchError('not_sent');}return projectManagedApplicationViewReview(row);}});
}
