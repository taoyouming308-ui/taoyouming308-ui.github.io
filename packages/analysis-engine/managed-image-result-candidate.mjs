/** Pure managed-image MODEL OUTPUT contract. This is not the quarantined image
 * input candidate, old design-model-candidate-v1, or authority to send/accept.
 * Callers must load immutable server results and perform fresh authorization.
 * Old candidate/media schemas and byte limits are deliberately unchanged. */
import {types} from 'node:util';
import {validateDesignSession,validateDesignPilotResult,appendDesignEvent,getDesignView} from './design-pilot.mjs';
import {DESIGN_VISUAL_VALUES,designCandidateDigest} from './design-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {MANAGED_IMAGE_CANDIDATE_BUDGETS} from '../design-production-adapter/managed-image-contracts.mjs';

export const MANAGED_IMAGE_RESULT_SCHEMA='design-managed-model-candidate-v1';
export const MANAGED_IMAGE_ACCEPTANCE_SCHEMA='design-managed-model-acceptance-v1';
export const MANAGED_IMAGE_RESULT_WARNING='托管图片模型视觉描述仅供员工核对，不是测量或事实；采纳不等于确认或实际操作。';
export class ManagedImageResultError extends Error{constructor(){super('MANAGED_IMAGE_RESULT_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedImageResultError();};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
export const managedResultDigest=designCandidateDigest;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v);
const version=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(v);
/** Own-data snapshot before any validation; same 32MiB/1000-event history domain.
 * This is a pure copy, not a cache, proof, authorization or trusted brand. */
export function copyManagedResultData(input,maxBytes=32*1024*1024){let nodes=0,bytes=0;const charge=n=>{if((bytes+=n)>maxBytes)fail();};function visit(v,depth){
 if(++nodes>750000||depth>80||types.isProxy(v))fail();
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'){if(typeof v==='string'&&v.length>65536||typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))fail();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))fail();const keys=Reflect.ownKeys(v);
 if(Array.isArray(v)){if(keys.length!==v.length+1)fail();charge(2+Math.max(0,v.length-1));const out=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out.push(visit(d.value,depth+1));}return out;}
 const out={};charge(2+Math.max(0,keys.length-1));for(const k of keys){if(typeof k!=='string'||k.length>65536||['__proto__','prototype','constructor'].includes(k))fail();const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();charge(Buffer.byteLength(JSON.stringify(k))+1);out[k]=visit(d.value,depth+1);}return out;
 }return visit(input,0);}
function workflowBinding(v,session){exact(v,['recordRevision','recordDigest','sessionId','sessionRevision','sessionDigest']);if(!Number.isSafeInteger(v.recordRevision)||v.recordRevision<0||v.recordRevision>1000||!sha(v.recordDigest)||typeof v.sessionId!=='string'||!v.sessionId||v.sessionId.length>160||!Number.isSafeInteger(v.sessionRevision)||v.sessionRevision<0||v.sessionRevision>1000||!sha(v.sessionDigest))fail();if(session&&(v.sessionId!==session.scope.sessionId||v.sessionRevision!==session.revision||v.sessionDigest!==designCandidateDigest(session)))fail();return v;}
export function validateManagedWorkflowBinding(value,session){try{const v=copyManagedResultData(value,16384),s=session===undefined?undefined:validateDesignSession(copyManagedResultData(session));return freeze(workflowBinding(v,s));}catch{fail();}}
function object(v){exact(v,['projectOrigin','bucket','key','version']);if(typeof v.projectOrigin!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v.projectOrigin)||typeof v.bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.bucket)||!version(v.version)||typeof v.key!=='string'||v.key.length>1024||!/^\w[\w./-]*$/.test(v.key)||v.key.split('/').some(p=>!p||p==='.'||p==='..'))fail();}
function imageBinding(v,authority){exact(v,['taskId','candidateDigest','objectReceiptDigest','verificationReportDigest','authority','sourceRecordDigest','responseDigest','evidenceDigest','sourceObject','derivativeObject','sourceSha256','derivativeSha256','mime','byteLength','maxEdge','stage','angle']);
 if(!id(v.taskId)||['candidateDigest','objectReceiptDigest','verificationReportDigest','sourceRecordDigest','responseDigest','evidenceDigest','sourceSha256','derivativeSha256'].some(k=>!sha(v[k]))||!same(validateImmutableDesignAuthority(v.authority),authority)||v.stage!=='before'||!['front','back','left','right'].includes(v.angle)||![1024,1536].includes(v.maxEdge)||!Object.hasOwn(MANAGED_IMAGE_CANDIDATE_BUDGETS[v.maxEdge],v.mime)||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>MANAGED_IMAGE_CANDIDATE_BUDGETS[v.maxEdge][v.mime])fail();
 object(v.sourceObject);object(v.derivativeObject);if(v.sourceObject.projectOrigin!==v.derivativeObject.projectOrigin||v.sourceObject.bucket!==v.derivativeObject.bucket||v.sourceObject.key===v.derivativeObject.key)fail();return v;
}
const description=(field,value)=>'托管图片模型视觉描述，未确认、非测量或事实：'+field+'：'+(value??'未知')+'。';
function parts(candidateId,session,observations){
 if(session.phase!=='before_analysis'||!Array.isArray(observations)||observations.length>2)fail();const seen=new Set(),latest=getDesignView(session).entries,descriptionSources=[],entries=[];
 observations.forEach((o,i)=>{exact(o,['field','value']);if(!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))fail();seen.add(o.field);
  const source={messageId:'managed-vision:'+candidateId+':'+i,kind:'image_description',actor:'model',text:description(o.field,o.value)};descriptionSources.push(source);
  entries.push({id:'managed-vision-entry:'+candidateId+':'+i,category:'person_style',field:o.field,zone:null,groupId:null,service:null,side:null,track:'context',origin:'extraction',basis:'observable',value:o.value,status:o.value===null?'unknown':'not_confirmed',sources:o.value===null?[]:[{messageId:source.messageId,quote:source.text}],replacesEntryId:latest.find(e=>e.category==='person_style'&&e.field===o.field)?.id??null});
 });
 return {descriptionSources,candidate:{phase:session.phase,entries,questions:[],warnings:[MANAGED_IMAGE_RESULT_WARNING]}};
}
function validate(v,s,w){
 exact(v,['schemaVersion','id','kind','authority','scope','workflowBinding','requestBinding','imageBinding','descriptionSources','candidate']);
 if(v.schemaVersion!==MANAGED_IMAGE_RESULT_SCHEMA||v.kind!=='managed_visual_description'||!id(v.id,80))fail();const a=validateImmutableDesignAuthority(v.authority),scope=validateProductionDesignScope(v.scope);
 if(!same(a.scope,scope)||scope.customerProfileId!==s.scope.customerId||scope.visitId!==s.scope.visitId||!same(workflowBinding(v.workflowBinding,s),workflowBinding(w,s)))fail();imageBinding(v.imageBinding,a);
 const q=v.requestBinding;exact(q,['requestId','intentDigest','payloadSha256','model','promptVersion']);if(!id(q.requestId)||!sha(q.intentDigest)||!sha(q.payloadSha256)||typeof q.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(q.model)||typeof q.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(q.promptVersion))fail();
 if(!Array.isArray(v.candidate?.entries))fail();const expected=parts(v.id,s,v.candidate.entries.map(e=>({field:e?.field,value:e?.value})));
 if(!same(v.descriptionSources,expected.descriptionSources)||!same(v.candidate,expected.candidate))fail();let trial=s;for(const src of v.descriptionSources)trial=appendDesignEvent(trial,{requestId:v.id+'-managed-description-'+trial.revision,expectedRevision:trial.revision,scope:trial.scope,event:{type:'source_recorded',source:src}}).session;
 validateDesignPilotResult(v.candidate,trial);copyManagedResultData(v,262144);return freeze(v);
}
export function validateManagedImageResultCandidate(value,context){try{const v=copyManagedResultData(value,262144),c=copyManagedResultData(context);exact(c,['session','workflowBinding']);return validate(v,validateDesignSession(c.session),c.workflowBinding);}catch{fail();}}
export function buildManagedImageResultCandidate(input){try{
 const q=copyManagedResultData(input);exact(q,['id','authority','scope','workflowBinding','requestBinding','imageBinding','session','observations']);const s=validateDesignSession(q.session),p=parts(q.id,s,q.observations);
 return validateManagedImageResultCandidate({schemaVersion:MANAGED_IMAGE_RESULT_SCHEMA,id:q.id,kind:'managed_visual_description',authority:q.authority,scope:q.scope,workflowBinding:q.workflowBinding,requestBinding:q.requestBinding,imageBinding:q.imageBinding,...p},{session:s,workflowBinding:q.workflowBinding});
 }catch{fail();}}
/** Acceptance appends selected model statements, never employee confirmation.
 * Storage must atomically consume the candidate and persist this exact receipt. */
export function applyTrustedManagedImageCandidate(input){try{
 const q=copyManagedResultData(input);exact(q,['session','candidate','workflowBinding','selectedIndices','requestId']);let next=validateDesignSession(q.session);const c=validateManagedImageResultCandidate(q.candidate,{session:next,workflowBinding:q.workflowBinding});
 if(!id(q.requestId,80)||!Array.isArray(q.selectedIndices)||!q.selectedIndices.length||q.selectedIndices.length>2||new Set(q.selectedIndices).size!==q.selectedIndices.length||q.selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=c.candidate.entries.length))fail();const selected=[...q.selectedIndices].sort((a,b)=>a-b);
 for(const i of selected){for(const [suffix,event] of [['source',{type:'source_recorded',source:c.descriptionSources[i]}],['entry',{type:'entry_recorded',entry:c.candidate.entries[i]}]])next=appendDesignEvent(next,{requestId:q.requestId+'-managed-'+suffix+'-'+i,expectedRevision:next.revision,scope:next.scope,event}).session;}
 return freeze({session:next,acceptedReceipt:{schemaVersion:MANAGED_IMAGE_ACCEPTANCE_SCHEMA,candidateId:c.id,candidateDigest:designCandidateDigest(c),inputDigest:c.workflowBinding.sessionDigest,baseRevision:c.workflowBinding.sessionRevision,resultRevision:next.revision,selectedIndices:selected,imageBindingDigest:designCandidateDigest(c.imageBinding)}});
 }catch{fail();}}
