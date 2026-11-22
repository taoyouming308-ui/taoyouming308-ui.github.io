/** Additive mixed managed history. Pure replay is not a live source/issuer proof.
 * Repository authorization must still bind every workflow digest to its real
 * immutable row and freshly verify the private source/acceptance sidecars. */
import {validateManagedViewHistoryInput,managedViewHistoryInputBinding} from './managed-view-result-history.mjs';
import {validateManagedApplicationResultCandidate,applyTrustedManagedApplicationCandidate,validateManagedApplicationHistoryInput,managedApplicationHistoryInputBinding} from './managed-application-result-candidate.mjs';
import {validateManagedNormalizedResultCandidate,applyTrustedManagedNormalizedCandidate,validateManagedNormalizedHistoryInput,managedNormalizedHistoryInputBinding} from './managed-normalized-result-candidate.mjs';
import {validateDesignSession} from './design-pilot.mjs';
import {designCandidateDigest} from './design-candidate.mjs';
import {validateAcceptedCandidateHistory,reconstructCandidateSessionPrefix} from './design-candidate-history.mjs';
import {copyManagedResultData,validateManagedImageResultCandidate,applyTrustedManagedImageCandidate} from './managed-image-result-candidate.mjs';
import {validateManagedViewResultCandidate,applyTrustedManagedViewCandidate} from './managed-view-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';

export const MANAGED_APPLICATION_HISTORY_SCHEMA='design-managed-image-history-v4';
export class ManagedApplicationHistoryError extends Error{constructor(){super('MANAGED_APPLICATION_HISTORY_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedApplicationHistoryError();};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v),integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min&&v<=1000;

/** Projection only for old v2 synthesis reconstruction. It does not validate or
 * grant access to the supplied lane; callers must first validate history-v3.
 * New normalized before-only results cannot masquerade as comparison ancestors. */
export function managedApplicationLegacyHistory(value){
 const lane=copyManagedResultData(value);exact(lane,['schemaVersion','inputs','accepted']);
 if(lane.schemaVersion!==MANAGED_APPLICATION_HISTORY_SCHEMA||!Array.isArray(lane.inputs)||lane.inputs.length>300||!Array.isArray(lane.accepted)||lane.accepted.length>1000)fail();
 return freeze({schemaVersion:'design-managed-image-history-v2',inputs:lane.inputs.filter(v=>!Object.hasOwn(v,'task')),accepted:lane.accepted.filter(r=>!['design-managed-model-candidate-v4','design-managed-model-candidate-v5'].includes(r.candidate?.schemaVersion))});
}

export function validateManagedApplicationResultHistory(value){try{
 const q=copyManagedResultData(value);exact(q,['session','scope','store','photoRefs','managedImageHistory',...(Object.hasOwn(q,'modelCandidates')?['modelCandidates']:[]),...(Object.hasOwn(q,'workflowRevision')?['workflowRevision']:[])]);
 const session=validateDesignSession(q.session),scope=validateProductionDesignScope(q.scope),lane=q.managedImageHistory;
 if(scope.customerProfileId!==session.scope.customerId||scope.visitId!==session.scope.visitId||typeof q.store!=='string'||!q.store||Object.hasOwn(q,'workflowRevision')&&!integer(q.workflowRevision))fail();
 exact(lane,['schemaVersion','inputs','accepted']);
 if(lane.schemaVersion!==MANAGED_APPLICATION_HISTORY_SCHEMA||!Array.isArray(lane.inputs)||!lane.inputs.length||lane.inputs.length>300||!Array.isArray(lane.accepted)||!lane.accepted.length||lane.accepted.length>1000)fail();
 if(Object.hasOwn(q,'modelCandidates')&&!Array.isArray(q.modelCandidates))fail();
 const old=validateAcceptedCandidateHistory({session,scope,store:q.store,photoRefs:q.photoRefs,modelCandidates:q.modelCandidates??[],...(Object.hasOwn(q,'workflowRevision')?{workflowRevision:q.workflowRevision}:{})});
 const inputs=new Map(),bindings=new Map(),used=new Set(),processed=[],syntheticSources=new Set(),syntheticEntries=new Set();
 for(const input of lane.inputs){const application=input.task?.schemaVersion==='design-normalized-strict-task-v2',normalized=Object.hasOwn(input,'task'),checked=application?validateManagedApplicationHistoryInput(input):normalized?validateManagedNormalizedHistoryInput(input):validateManagedViewHistoryInput(input),owner=application?checked.task.claimedArtifact.artifact.authority:normalized?checked.task.claimedArtifact.artifact.sourceRecord.owner:checked.sourceRecord.owner;if(inputs.has(checked.taskId)||!same(owner.scope,scope)||owner.actor.store!==q.store)fail();inputs.set(checked.taskId,checked);bindings.set(checked.taskId,application?managedApplicationHistoryInputBinding(checked):normalized?managedNormalizedHistoryInputBinding(checked):managedViewHistoryInputBinding(checked));}
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
   const priorLane={schemaVersion:'design-managed-image-history-v2',inputs:[...used].map(task=>inputs.get(task)).filter(v=>!Object.hasOwn(v,'task')),accepted:processed.filter(r=>!['design-managed-model-candidate-v4','design-managed-model-candidate-v5'].includes(r.candidate.schemaVersion))};
   if(c.kind==='managed_before_view'||c.kind==='managed_completion_comparison'){
    if(!Array.isArray(c.evidenceBinding?.images))fail();for(const binding of c.evidenceBinding.images)bindImage(binding);
   }else if(c.kind!=='managed_completion_synthesis')fail();
   // Passing only prior accepted rows prevents a self/future/circular ancestor
   // from being used to justify this synthesis. Confirmation is read from the
   // exact generation prefix, not the final session's later confirmation state.
   const context={session:prefix,workflowBinding:c.workflowBinding,...(c.kind==='managed_completion_synthesis'?{managedImageHistory:priorLane}:{})};
   candidate=validateManagedViewResultCandidate(c,context);
   applied=applyTrustedManagedViewCandidate({...context,candidate,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
  }else if(c.schemaVersion==='design-managed-model-candidate-v4'){
   const taskId=c.normalizedBinding?.input?.taskId,input=inputs.get(taskId);
   if(!input||!Object.hasOwn(input,'task')||!same(c.normalizedBinding.input,bindings.get(taskId)))fail();used.add(taskId);
   const context={session:prefix,workflowBinding:c.workflowBinding,input:{task:input.task,report:input.report}};
   candidate=validateManagedNormalizedResultCandidate(c,context);applied=applyTrustedManagedNormalizedCandidate({...context,candidate,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
   for(const i of applied.acceptedReceipt.selectedIndices){syntheticSources.add(candidate.descriptionSources[i].messageId);syntheticEntries.add(candidate.candidate.entries[i].id);}
  }else if(c.schemaVersion==='design-managed-model-candidate-v5'){
   newCount++;const taskId=c.applicationBinding?.input?.taskId,input=inputs.get(taskId);
   if(!input||!Object.hasOwn(input,'task')||!same(c.applicationBinding.input,bindings.get(taskId)))fail();used.add(taskId);
   const context={session:prefix,workflowBinding:c.workflowBinding,input:{task:input.task,report:input.report}};
   candidate=validateManagedApplicationResultCandidate(c,context);applied=applyTrustedManagedApplicationCandidate({...context,candidate,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
   for(const i of applied.acceptedReceipt.selectedIndices){syntheticSources.add(candidate.descriptionSources[i].messageId);syntheticEntries.add(candidate.candidate.entries[i].id);}
  }else fail();
  if(!same(applied.acceptedReceipt,a.receipt)||a.receipt.candidateDigest!==designCandidateDigest(c)||!same(applied.session.journal,session.journal.slice(0,a.receipt.resultRevision)))fail();
  spans.push({candidateId:c.id,requestId:a.requestId,workflowRevision:a.workflowRevision,baseRevision:a.receipt.baseRevision,resultRevision:a.receipt.resultRevision});processed.push(row);
 }
 // A schema upgrade is introduced by a real new-style acceptance, not by
 // relabelling an otherwise unchanged old history as a multiview record.
 if(!newCount||used.size!==inputs.size)fail();
 // A native source/event outside a proven normalized acceptance cannot borrow
 // the synthetic label to bypass the candidate/receipt history contract.
 for(const row of session.journal){const e=row.event;if(e.type==='source_recorded'&&e.source.kind==='synthetic_image_description'&&!syntheticSources.has(e.source.messageId))fail();if(e.type==='entry_recorded'&&(e.entry.id.startsWith('synthetic-normalized-entry:')||e.entry.id.startsWith('synthetic-application-entry:')||e.entry.sources.some(r=>syntheticSources.has(r.messageId)))&&!syntheticEntries.has(e.entry.id))fail();}
 spans.sort((a,b)=>a.workflowRevision-b.workflowRevision);const ids=new Set(),requests=new Set();let previousWorkflow=0,previousNative=0;
 for(const s of spans){if(ids.has(s.candidateId)||requests.has(s.requestId)||s.workflowRevision<=previousWorkflow||s.baseRevision<previousNative||s.resultRevision<=s.baseRevision||s.resultRevision>session.revision)fail();ids.add(s.candidateId);requests.add(s.requestId);previousWorkflow=s.workflowRevision;previousNative=s.resultRevision;}
 return freeze(lane);
 }catch{fail();}}
