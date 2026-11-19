/** Synthetic-only ledger-backed normalized result. Never upgrades the Stage34
 * candidate-v3 preview. Structure is not completed-ledger provenance: a fixed
 * repository must independently prove the exact completed result/receipt and
 * current authority before publishing or atomically consuming this candidate. */
import {validateDesignSession,validateDesignPilotResult,appendDesignEvent,getDesignView} from './design-pilot.mjs';
import {DESIGN_VISUAL_VALUES,designCandidateDigest as digest} from './design-candidate.mjs';
import {copyManagedResultData,validateManagedWorkflowBinding} from './managed-image-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {policyOwnerKey,policyId} from '../design-production-adapter/approval-attempt-contracts.mjs';
import {validateManagedNormalizedResultInput,managedNormalizedHistoryInputBinding} from './managed-normalized-result-input.mjs';
export {validateManagedNormalizedResultInput,validateManagedNormalizedHistoryInput,managedNormalizedHistoryInputBinding} from './managed-normalized-result-input.mjs';
export const MANAGED_NORMALIZED_RESULT_SCHEMA='design-managed-model-candidate-v4',MANAGED_NORMALIZED_ACCEPTANCE_SCHEMA='design-managed-model-acceptance-v3';
export class ManagedNormalizedResultError extends Error{constructor(){super('MANAGED_NORMALIZED_RESULT_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedNormalizedResultError();},copy=copyManagedResultData,freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}',same=(a,b)=>canonical(a)===canonical(b);
const exact=(v,k)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...k].sort().join('|'))fail();},id=(v,max=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+max+'}$').test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const labels={front:'正面',back:'背面',left:'左侧',right:'右侧'};
function parts(id,s,input,observations){
 if(s.phase!=='before_analysis'||!Array.isArray(observations)||observations.length<1||observations.length>2)fail();const seen=new Set(),descriptionSources=[],entries=[],latest=getDesignView(s).entries;
 observations.forEach((o,i)=>{exact(o,['field','value']);if(!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))fail();seen.add(o.field);
  const field='managed_before_'+(o.field==='visible_outline'?'outline':'hair_shape')+'_'+input.angle,text='合成演练，mock 响应，未调用真实模型；剪前'+labels[input.angle]+'描述，未确认、非测量或实际操作：'+o.field+'：'+(o.value??'未知')+'。';
  const source={messageId:'synthetic-normalized:'+id+':'+i,kind:'synthetic_image_description',actor:'system',text};descriptionSources.push(source);
  entries.push({id:'synthetic-normalized-entry:'+id+':'+i,category:'person_style',field,zone:null,groupId:null,service:null,side:null,track:'context',origin:'extraction',basis:'observable',value:o.value,status:o.value===null?'unknown':'not_confirmed',sources:o.value===null?[]:[{messageId:source.messageId,quote:text}],replacesEntryId:latest.find(e=>e.category==='person_style'&&e.field===field&&e.zone===null&&e.track==='context')?.id??null});
 });return {descriptionSources,candidate:{phase:s.phase,entries,questions:[],warnings:['仅合成演练的 mock 响应，未调用真实模型，不可用于真实客户或生产；采纳不等于员工确认，更不代表实际操作。']}};
}
function context(raw){const c=copy(raw);exact(c,['session','workflowBinding','input']);exact(c.input,['task','report']);c.session=validateDesignSession(c.session);c.workflowBinding=validateManagedWorkflowBinding(c.workflowBinding,c.session);c.image=managedNormalizedHistoryInputBinding({taskId:c.input.task.taskId,...c.input});return c;}
export function validateManagedNormalizedResultCandidate(value,rawContext){try{
 const v=copy(value,262144),c=context(rawContext),s=c.session;exact(v,['schemaVersion','id','kind','generation','authority','scope','workflowBinding','requestBinding','normalizedBinding','descriptionSources','candidate']);
 if(v.schemaVersion!==MANAGED_NORMALIZED_RESULT_SCHEMA||!id(v.id,80)||v.kind!=='managed_normalized_before_view'||v.generation!=='synthetic_mock_model')fail();const a=validateImmutableDesignAuthority(v.authority),scope=validateProductionDesignScope(v.scope);
 if(!same(a.scope,scope)||scope.customerProfileId!==s.scope.customerId||scope.visitId!==s.scope.visitId||!same(validateManagedWorkflowBinding(v.workflowBinding,s),c.workflowBinding))fail();
 exact(v.normalizedBinding,['promptVersion','input']);validateManagedNormalizedResultInput(v.normalizedBinding.input);if(!same(v.normalizedBinding.input,c.image)||!same(c.image.verificationBinding.authority,a))fail();
 const q=v.requestBinding;exact(q,['requestId','intentDigest','payloadSha256','model','promptVersion','approvalReceiptId','ownerKey']);if(!id(q.requestId)||!sha(q.intentDigest)||!sha(q.payloadSha256)||typeof q.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(q.model)||typeof q.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(q.promptVersion)||q.promptVersion!==v.normalizedBinding.promptVersion||q.ownerKey!==policyOwnerKey(a,q.requestId))fail();policyId(q.approvalReceiptId);
 if(!Array.isArray(v.candidate?.entries))fail();const observations=v.candidate.entries.map(e=>({field:e?.field?.startsWith('managed_before_outline_')?'visible_outline':e?.field?.startsWith('managed_before_hair_shape_')?'visible_hair_shape':null,value:e?.value})),expected=parts(v.id,s,c.image,observations);
 if(!same(expected.descriptionSources,v.descriptionSources)||!same(expected.candidate,v.candidate))fail();let trial=s;for(const source of v.descriptionSources)trial=appendDesignEvent(trial,{requestId:v.id+'-normalized-description-'+trial.revision,expectedRevision:trial.revision,scope:trial.scope,event:{type:'source_recorded',source}}).session;validateDesignPilotResult(v.candidate,trial);return freeze(v);
 }catch{fail();}}
export function buildManagedNormalizedResultCandidate(value){try{
 const q=copy(value);exact(q,['id','authority','scope','workflowBinding','requestBinding','normalizedBinding','session','observations','input']);const c=context({session:q.session,workflowBinding:q.workflowBinding,input:q.input}),p=parts(q.id,c.session,c.image,q.observations);
 return validateManagedNormalizedResultCandidate({schemaVersion:MANAGED_NORMALIZED_RESULT_SCHEMA,id:q.id,kind:'managed_normalized_before_view',generation:'synthetic_mock_model',authority:q.authority,scope:q.scope,workflowBinding:q.workflowBinding,requestBinding:q.requestBinding,normalizedBinding:q.normalizedBinding,...p},{session:c.session,workflowBinding:c.workflowBinding,input:q.input});
 }catch{fail();}}
export function applyTrustedManagedNormalizedCandidate(value){try{
 const q=copy(value);exact(q,['session','candidate','workflowBinding','selectedIndices','requestId','input']);let s=validateDesignSession(q.session);const c=validateManagedNormalizedResultCandidate(q.candidate,{session:s,workflowBinding:q.workflowBinding,input:q.input});
 if(!id(q.requestId,80)||!Array.isArray(q.selectedIndices)||!q.selectedIndices.length||q.selectedIndices.length>2||new Set(q.selectedIndices).size!==q.selectedIndices.length||q.selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=c.candidate.entries.length))fail();const selected=[...q.selectedIndices].sort((a,b)=>a-b);
 for(const i of selected)for(const [suffix,event] of [['source',{type:'source_recorded',source:c.descriptionSources[i]}],['entry',{type:'entry_recorded',entry:c.candidate.entries[i]}]])s=appendDesignEvent(s,{requestId:q.requestId+'-normalized-'+suffix+'-'+i,expectedRevision:s.revision,scope:s.scope,event}).session;
 return freeze({session:s,acceptedReceipt:{schemaVersion:MANAGED_NORMALIZED_ACCEPTANCE_SCHEMA,candidateId:c.id,candidateDigest:digest(c),kind:c.kind,inputDigest:c.workflowBinding.sessionDigest,baseRevision:c.workflowBinding.sessionRevision,resultRevision:s.revision,selectedIndices:selected,normalizedBindingDigest:digest(c.normalizedBinding)}});
 }catch{fail();}}
