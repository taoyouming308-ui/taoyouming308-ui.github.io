/** Additive mixed managed history. Pure replay is not a live source/issuer proof.
 * Repository authorization must still bind every workflow digest to its real
 * immutable row and freshly verify the private source/acceptance sidecars. */
import {validateDesignSession} from './design-pilot.mjs';
import {designCandidateDigest} from './design-candidate.mjs';
import {validateAcceptedCandidateHistory,reconstructCandidateSessionPrefix} from './design-candidate-history.mjs';
import {copyManagedResultData,validateManagedImageResultCandidate,applyTrustedManagedImageCandidate} from './managed-image-result-candidate.mjs';
import {validateManagedViewResultCandidate,applyTrustedManagedViewCandidate} from './managed-view-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {validateManagedImageSourceRecord,validateManagedImageResponse,createManagedImageCandidate,managedImageDigest} from '../design-production-adapter/managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from '../design-production-adapter/managed-image-verification.mjs';

export const MANAGED_VIEW_HISTORY_SCHEMA='design-managed-image-history-v2';
export class ManagedViewHistoryError extends Error{constructor(){super('MANAGED_VIEW_HISTORY_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedViewHistoryError();};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v),integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min&&v<=1000;

/** Separate v2 helper: the old v1 before-only input validator stays unchanged. */
export function validateManagedViewHistoryInput(value){try{
 const v=copyManagedResultData(value,1024*1024);exact(v,['taskId','sourceRecord','response','objectReceipt','verificationReport']);if(!id(v.taskId))fail();
 const sourceRecord=validateManagedImageSourceRecord(v.sourceRecord),response=validateManagedImageResponse(v.response,sourceRecord),objectReceipt=validateManagedDerivedObjectReceipt(v.objectReceipt,{sourceRecord,response}),verificationReport=validateManagedImageVerificationReport(v.verificationReport,{sourceRecord,response,objectReceipt});
 const image=createManagedImageCandidate({sourceRecord,response,evidence:verificationReport.evidence});
 if(verificationReport.state!=='evidence_complete'||image.technicalStatus!=='evidence_complete'||!['before','after'].includes(sourceRecord.stage)||!['front','back','left','right'].includes(sourceRecord.angle))fail();
 return freeze({taskId:v.taskId,sourceRecord,response,objectReceipt,verificationReport});
 }catch{fail();}}

export function managedViewHistoryInputBinding(value){
 const v=validateManagedViewHistoryInput(value),s=v.sourceRecord,r=v.response,o=v.objectReceipt,e=v.verificationReport,image=createManagedImageCandidate({sourceRecord:s,response:r,evidence:e.evidence});
 return freeze({taskId:v.taskId,candidateDigest:managedImageDigest(image),objectReceiptDigest:managedImageDigest(o),verificationReportDigest:managedImageDigest(e),authority:s.owner,sourceRecordDigest:managedImageDigest(s),responseDigest:managedImageDigest(r),evidenceDigest:managedImageDigest(e.evidence),sourceObject:s.object,derivativeObject:o.object,sourceSha256:s.source.sha256,derivativeSha256:o.derivative.sha256,mime:o.derivative.mime,byteLength:o.derivative.byteLength,maxEdge:image.budget.maxEdge,stage:s.stage,angle:s.angle});
}

export function validateManagedViewResultHistory(value){try{
 const q=copyManagedResultData(value);exact(q,['session','scope','store','photoRefs','managedImageHistory',...(Object.hasOwn(q,'modelCandidates')?['modelCandidates']:[]),...(Object.hasOwn(q,'workflowRevision')?['workflowRevision']:[])]);
 const session=validateDesignSession(q.session),scope=validateProductionDesignScope(q.scope),lane=q.managedImageHistory;
 if(scope.customerProfileId!==session.scope.customerId||scope.visitId!==session.scope.visitId||typeof q.store!=='string'||!q.store||Object.hasOwn(q,'workflowRevision')&&!integer(q.workflowRevision))fail();
 exact(lane,['schemaVersion','inputs','accepted']);
 if(lane.schemaVersion!==MANAGED_VIEW_HISTORY_SCHEMA||!Array.isArray(lane.inputs)||!lane.inputs.length||lane.inputs.length>300||!Array.isArray(lane.accepted)||!lane.accepted.length||lane.accepted.length>1000)fail();
 if(Object.hasOwn(q,'modelCandidates')&&!Array.isArray(q.modelCandidates))fail();
 const old=validateAcceptedCandidateHistory({session,scope,store:q.store,photoRefs:q.photoRefs,modelCandidates:q.modelCandidates??[],...(Object.hasOwn(q,'workflowRevision')?{workflowRevision:q.workflowRevision}:{})});
 const inputs=new Map(),bindings=new Map(),used=new Set(),processed=[];
 for(const input of lane.inputs){const checked=validateManagedViewHistoryInput(input);if(inputs.has(checked.taskId)||!same(checked.sourceRecord.owner.scope,scope)||checked.sourceRecord.owner.actor.store!==q.store)fail();inputs.set(checked.taskId,checked);bindings.set(checked.taskId,managedViewHistoryInputBinding(checked));}
 const spans=old.map(row=>({candidateId:row.candidate.id,requestId:row.acceptance.requestId,workflowRevision:row.acceptance.workflowRevision,baseRevision:row.acceptance.receipt.baseRevision,resultRevision:row.acceptance.receipt.resultRevision}));
 let last=0,newCount=0;
 function bindImage(binding){if(!binding||!bindings.has(binding.taskId)||!same(binding,bindings.get(binding.taskId)))fail();used.add(binding.taskId);}
 for(const row of lane.accepted){
  exact(row,['candidate','acceptance']);const a=row.acceptance,c=row.candidate;
  exact(a,['requestId','workflowRevision','authority','receipt']);
  if(!id(a.requestId,80)||!integer(a.workflowRevision,1)||a.workflowRevision<=last||Object.hasOwn(q,'workflowRevision')&&a.workflowRevision>q.workflowRevision)fail();last=a.workflowRevision;
  const authority=validateImmutableDesignAuthority(a.authority);
  if(!same(authority.scope,scope)||authority.actor.store!==q.store||!same(authority,c.authority)||!same(c.scope,scope)||c.workflowBinding?.recordRevision!==a.workflowRevision-1)fail();
  const prefix=reconstructCandidateSessionPrefix(session,c.workflowBinding.sessionRevision);let candidate,applied;
  if(c.schemaVersion==='design-managed-model-candidate-v1'){
   // The legacy validator still enforces before-only imageBinding and its old
   // candidate/receipt bytes. No v2 result can masquerade as the old schema.
   bindImage(c.imageBinding);candidate=validateManagedImageResultCandidate(c,{session:prefix,workflowBinding:c.workflowBinding});
   applied=applyTrustedManagedImageCandidate({session:prefix,candidate,workflowBinding:c.workflowBinding,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
  }else if(c.schemaVersion==='design-managed-model-candidate-v2'){
   newCount++;
   const priorLane={schemaVersion:MANAGED_VIEW_HISTORY_SCHEMA,inputs:[...used].map(task=>inputs.get(task)),accepted:processed};
   if(c.kind==='managed_before_view'||c.kind==='managed_completion_comparison'){
    if(!Array.isArray(c.evidenceBinding?.images))fail();for(const binding of c.evidenceBinding.images)bindImage(binding);
   }else if(c.kind!=='managed_completion_synthesis')fail();
   // Passing only prior accepted rows prevents a self/future/circular ancestor
   // from being used to justify this synthesis. Confirmation is read from the
   // exact generation prefix, not the final session's later confirmation state.
   const context={session:prefix,workflowBinding:c.workflowBinding,...(c.kind==='managed_completion_synthesis'?{managedImageHistory:priorLane}:{})};
   candidate=validateManagedViewResultCandidate(c,context);
   applied=applyTrustedManagedViewCandidate({...context,candidate,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
  }else fail();
  if(!same(applied.acceptedReceipt,a.receipt)||a.receipt.candidateDigest!==designCandidateDigest(c)||!same(applied.session.journal,session.journal.slice(0,a.receipt.resultRevision)))fail();
  spans.push({candidateId:c.id,requestId:a.requestId,workflowRevision:a.workflowRevision,baseRevision:a.receipt.baseRevision,resultRevision:a.receipt.resultRevision});processed.push(row);
 }
 // A schema upgrade is introduced by a real new-style acceptance, not by
 // relabelling an otherwise unchanged old history as a multiview record.
 if(!newCount||used.size!==inputs.size)fail();
 spans.sort((a,b)=>a.workflowRevision-b.workflowRevision);const ids=new Set(),requests=new Set();let previousWorkflow=0,previousNative=0;
 for(const s of spans){if(ids.has(s.candidateId)||requests.has(s.requestId)||s.workflowRevision<=previousWorkflow||s.baseRevision<previousNative||s.resultRevision<=s.baseRevision||s.resultRevision>session.revision)fail();ids.add(s.candidateId);requests.add(s.requestId);previousWorkflow=s.workflowRevision;previousNative=s.resultRevision;}
 return freeze(lane);
 }catch{fail();}}
