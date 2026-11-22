import {validateManagedApplicationViewResultHistory} from './managed-application-view-result-history.mjs';
import {MANAGED_APPLICATION_HISTORY_SCHEMA,validateManagedApplicationResultHistory} from './managed-application-result-history.mjs';
/** Pure mixed-history replay, NOT live access/issuer proof. Old lanes retain
 * their exact validators; managed images never become old private_media refs.
 * Repository must additionally match each candidate.recordDigest to its actual
 * immutable workflow row. A full snapshot alone lacks all workflow-only rows. */
import {validateDesignSession} from './design-pilot.mjs';
import {designCandidateDigest} from './design-candidate.mjs';
import {validateAcceptedCandidateHistory,reconstructCandidateSessionPrefix} from './design-candidate-history.mjs';
import {copyManagedResultData,validateManagedImageResultCandidate,applyTrustedManagedImageCandidate} from './managed-image-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {validateManagedImageSourceRecord,validateManagedImageResponse,createManagedImageCandidate,managedImageDigest} from '../design-production-adapter/managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from '../design-production-adapter/managed-image-verification.mjs';
import {MANAGED_VIEW_HISTORY_SCHEMA,validateManagedViewResultHistory} from './managed-view-result-history.mjs';
import {MANAGED_NORMALIZED_HISTORY_SCHEMA,validateManagedNormalizedResultHistory} from './managed-normalized-result-history.mjs';
export const MANAGED_IMAGE_HISTORY_SCHEMA='design-managed-image-history-v1';
export class ManagedImageHistoryError extends Error{constructor(){super('MANAGED_IMAGE_HISTORY_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedImageHistoryError();};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v),integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min&&v<=1000;
export function validateManagedImageHistoryInput(value){try{
 const v=copyManagedResultData(value,1024*1024);exact(v,['taskId','sourceRecord','response','objectReceipt','verificationReport']);if(!id(v.taskId))fail();
 const sourceRecord=validateManagedImageSourceRecord(v.sourceRecord),response=validateManagedImageResponse(v.response,sourceRecord),objectReceipt=validateManagedDerivedObjectReceipt(v.objectReceipt,{sourceRecord,response}),verificationReport=validateManagedImageVerificationReport(v.verificationReport,{sourceRecord,response,objectReceipt});
 const image=createManagedImageCandidate({sourceRecord,response,evidence:verificationReport.evidence});if(verificationReport.state!=='evidence_complete'||image.technicalStatus!=='evidence_complete'||sourceRecord.stage!=='before'||!['front','back','left','right'].includes(sourceRecord.angle))fail();
 return freeze({taskId:v.taskId,sourceRecord,response,objectReceipt,verificationReport});
 }catch{fail();}}
/** Exactly the existing managed prepared images[0] binding, not old sourceRefs. */
export function managedImageHistoryInputBinding(value){const v=validateManagedImageHistoryInput(value),s=v.sourceRecord,r=v.response,o=v.objectReceipt,e=v.verificationReport,image=createManagedImageCandidate({sourceRecord:s,response:r,evidence:e.evidence});return freeze({taskId:v.taskId,candidateDigest:managedImageDigest(image),objectReceiptDigest:managedImageDigest(o),verificationReportDigest:managedImageDigest(e),authority:s.owner,sourceRecordDigest:managedImageDigest(s),responseDigest:managedImageDigest(r),evidenceDigest:managedImageDigest(e.evidence),sourceObject:s.object,derivativeObject:o.object,sourceSha256:s.source.sha256,derivativeSha256:o.derivative.sha256,mime:o.derivative.mime,byteLength:o.derivative.byteLength,maxEdge:image.budget.maxEdge,stage:'before',angle:s.angle});}

export function validateManagedImageHistory(value){try{
 const q=copyManagedResultData(value);exact(q,['session','scope','store','photoRefs','managedImageHistory',...(Object.hasOwn(q,'modelCandidates')?['modelCandidates']:[]),...(Object.hasOwn(q,'workflowRevision')?['workflowRevision']:[])]);
 if(q.managedImageHistory?.schemaVersion==='design-managed-image-history-v5')return validateManagedApplicationViewResultHistory(q);
 if(q.managedImageHistory?.schemaVersion===MANAGED_APPLICATION_HISTORY_SCHEMA)return validateManagedApplicationResultHistory(q);
 if(q.managedImageHistory?.schemaVersion===MANAGED_NORMALIZED_HISTORY_SCHEMA)return validateManagedNormalizedResultHistory(q);
 if(q.session?.sources?.some(s=>s.kind==='synthetic_image_description'))fail();
 if(q.managedImageHistory?.schemaVersion===MANAGED_VIEW_HISTORY_SCHEMA)return validateManagedViewResultHistory(q);
 const session=validateDesignSession(q.session),scope=validateProductionDesignScope(q.scope),lane=q.managedImageHistory;
 if(scope.customerProfileId!==session.scope.customerId||scope.visitId!==session.scope.visitId||typeof q.store!=='string'||!q.store||Object.hasOwn(q,'workflowRevision')&&!integer(q.workflowRevision))fail();
 exact(lane,['schemaVersion','inputs','accepted']);if(lane.schemaVersion!==MANAGED_IMAGE_HISTORY_SCHEMA||!Array.isArray(lane.inputs)||!lane.inputs.length||lane.inputs.length>300||!Array.isArray(lane.accepted)||!lane.accepted.length||lane.accepted.length>1000)fail();
 // This validates every old candidate/receipt and its full native replay, not
 // just a collection of old hashes. Keep the actual old envelopes untouched.
 if(Object.hasOwn(q,'modelCandidates')&&!Array.isArray(q.modelCandidates))fail();
 const old=validateAcceptedCandidateHistory({session,scope,store:q.store,photoRefs:q.photoRefs,modelCandidates:q.modelCandidates??[],...(Object.hasOwn(q,'workflowRevision')?{workflowRevision:q.workflowRevision}:{})});
 const inputs=new Map(),used=new Set();for(const input of lane.inputs){const checked=validateManagedImageHistoryInput(input);if(inputs.has(checked.taskId)||!same(checked.sourceRecord.owner.scope,scope)||checked.sourceRecord.owner.actor.store!==q.store)fail();inputs.set(checked.taskId,checked);}
 const spans=old.map(row=>({candidateId:row.candidate.id,requestId:row.acceptance.requestId,workflowRevision:row.acceptance.workflowRevision,baseRevision:row.acceptance.receipt.baseRevision,resultRevision:row.acceptance.receipt.resultRevision}));let last=0;
 for(const row of lane.accepted){exact(row,['candidate','acceptance']);const a=row.acceptance,c=row.candidate;exact(a,['requestId','workflowRevision','authority','receipt']);if(!id(a.requestId,80)||!integer(a.workflowRevision,1)||a.workflowRevision<=last||Object.hasOwn(q,'workflowRevision')&&a.workflowRevision>q.workflowRevision)fail();last=a.workflowRevision;
  const authority=validateImmutableDesignAuthority(a.authority);if(!same(authority.scope,scope)||authority.actor.store!==q.store||!same(authority,c.authority)||!same(c.scope,scope)||c.workflowBinding?.recordRevision!==a.workflowRevision-1)fail();
  const input=inputs.get(c.imageBinding?.taskId);if(!input||!same(c.imageBinding,managedImageHistoryInputBinding(input)))fail();used.add(input.taskId);
  const prefix=reconstructCandidateSessionPrefix(session,c.workflowBinding.sessionRevision),candidate=validateManagedImageResultCandidate(c,{session:prefix,workflowBinding:c.workflowBinding});
  const applied=applyTrustedManagedImageCandidate({session:prefix,candidate,workflowBinding:c.workflowBinding,selectedIndices:a.receipt?.selectedIndices,requestId:a.requestId});
  if(!same(applied.acceptedReceipt,a.receipt)||a.receipt.candidateDigest!==designCandidateDigest(c)||!same(applied.session.journal,session.journal.slice(0,a.receipt.resultRevision)))fail();
  spans.push({candidateId:c.id,requestId:a.requestId,workflowRevision:a.workflowRevision,baseRevision:a.receipt.baseRevision,resultRevision:a.receipt.resultRevision});
 }
 // Full native journal validation covers ordinary/confirmation/archive events
 // between accepted spans. Cross-lane ordering rejects double ownership and
 // overlap; a managed receipt cannot appropriate an old candidate's events.
 spans.sort((a,b)=>a.workflowRevision-b.workflowRevision);const ids=new Set(),requests=new Set();let previousWorkflow=0,previousNative=0;
 for(const s of spans){if(ids.has(s.candidateId)||requests.has(s.requestId)||s.workflowRevision<=previousWorkflow||s.baseRevision<previousNative||s.resultRevision<=s.baseRevision||s.resultRevision>session.revision)fail();ids.add(s.candidateId);requests.add(s.requestId);previousWorkflow=s.workflowRevision;previousNative=s.resultRevision;}
 if(used.size!==inputs.size)fail();return freeze(lane);
 }catch{fail();}}
