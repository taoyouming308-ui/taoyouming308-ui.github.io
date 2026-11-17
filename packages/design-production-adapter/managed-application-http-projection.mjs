import {buildManagedApplicationStrictInput} from './managed-application-image-contracts.mjs';
/** Browser projection only. Synthetic qualification never means production eligibility. */
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {DESIGN_VISUAL_VALUES} from '../analysis-engine/design-candidate.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
const fail=()=>{throw Error('INVALID_MANAGED_APPLICATION_RESULT');};
const exact=(v,k)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...k].sort().join('|'))fail();};
const id=v=>{if(typeof v!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(v))fail();};
const text=(v,n=200)=>{if(typeof v!=='string'||!v||v.length>n)fail();};
const warning='仅合成演练的 mock 响应，未调用真实模型，不可用于真实客户或生产；采纳不等于员工确认，更不代表实际操作。';
export function validateManagedApplicationProjection(value,{type,payload}){try{
 const v=copyManagedResultData(value,65536);
 if(type==='status'){
  exact(v,['schemaVersion','requestId','state','candidateId','retryable','synthetic','productionEligible']);id(v.requestId);
  if(v.schemaVersion!=='design-application-model-status-v1'||v.requestId!==payload.requestId||v.retryable!==false||v.synthetic!==true||v.productionEligible!==false||!['not_found','pending','uncertain','completed'].includes(v.state))fail();
  if(v.state==='completed')id(v.candidateId);else if(v.candidateId!==null)fail();
 }else if(type==='review'){
  exact(v,['schemaVersion','id','kind','generation','scope','requestId','workflowRevision','sessionId','baseRevision','sourceSummary','candidate','reviewOnly','productionEligible']);id(v.id);id(v.requestId);validateProductionDesignScope(v.scope);text(v.sessionId,160);
  if(v.schemaVersion!=='design-application-model-review-v1'||v.id!==payload.candidateId||v.kind!=='managed_application_before_view'||v.generation!=='synthetic_mock_model'||!policyEqual(v.scope,payload.scope)||v.reviewOnly!==true||v.productionEligible!==false||[v.workflowRevision,v.baseRevision].some(n=>!Number.isSafeInteger(n)||n<0||Object.is(n,-0)))fail();
  const s=v.sourceSummary;exact(s,['taskId','mediaId','stage','angle','sourceReference','normalizedReference','qualification']);id(s.taskId);id(s.mediaId);
  if(s.stage!=='before'||!['front','back','left','right'].includes(s.angle)||s.qualification!=='synthetic_pinned_direct_only')fail();
  for(const k of ['sourceReference','normalizedReference']){const r=s[k];exact(r,['manifestId','revision','digest']);id(r.manifestId);if(!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.digest!=='string'||!/^[a-f0-9]{64}$/.test(r.digest))fail();}
  const c=v.candidate;exact(c,['phase','entries','questions','warnings']);if(c.phase!=='before_analysis'||!Array.isArray(c.entries)||c.entries.length<1||c.entries.length>2||!policyEqual(c.questions,[])||!policyEqual(c.warnings,[warning]))fail();
  const seen=new Set();for(const e of c.entries){exact(e,['id','category','field','zone','groupId','service','side','track','origin','basis','value','status','sources','replacesEntryId']);text(e.id);const m=typeof e.field==='string'&&e.field.match(/^managed_before_(outline|hair_shape)_(front|back|left|right)$/);if(!m||m[2]!==s.angle||seen.has(e.field)||e.id!==`synthetic-application-entry:${v.id}:${seen.size}`||e.category!=='person_style'||e.track!=='context'||e.origin!=='extraction'||e.basis!=='observable'||['zone','groupId','service','side'].some(k=>e[k]!==null))fail();seen.add(e.field);
   if(e.value===null?e.status!=='unknown':e.status!=='not_confirmed'||!DESIGN_VISUAL_VALUES['visible_'+m[1]].includes(e.value))fail();if(e.replacesEntryId!==null)text(e.replacesEntryId);if(!Array.isArray(e.sources)||e.sources.length!==(e.value===null?0:1))fail();
   for(const src of e.sources){exact(src,['messageId','quote']);if(src.messageId!==`synthetic-application:${v.id}:${seen.size-1}`)fail();const label={front:'正面',back:'背面',left:'左侧',right:'右侧'}[s.angle];if(src.quote!==`合成演练，mock 响应，未调用真实模型；剪前${label}描述，未确认、非测量或实际操作：visible_${m[1]}：${e.value}。`)fail();}
  }
 }else fail();return policyFreeze(v);
 }catch{fail();}}
export function projectManagedApplicationReview(row){try{
 const {candidate:c,input}=copyManagedResultData(row),t=input.task,a=t.claimedArtifact.artifact,s=a.sourceBinding;
 if(!policyEqual(c.applicationBinding.input,buildManagedApplicationStrictInput({task:t,report:input.report}))||!policyEqual(c.authority,s.authority)||!policyEqual(c.scope,s.authority.scope)||input.taskId!==t.taskId||c.applicationBinding.input.taskId!==t.taskId||c.schemaVersion!=='design-managed-model-candidate-v5')fail();
 return validateManagedApplicationProjection({schemaVersion:'design-application-model-review-v1',id:c.id,kind:c.kind,generation:c.generation,scope:c.scope,requestId:c.requestBinding.requestId,workflowRevision:c.workflowBinding.recordRevision,sessionId:c.workflowBinding.sessionId,baseRevision:c.workflowBinding.sessionRevision,sourceSummary:{taskId:t.taskId,mediaId:s.mediaId,stage:s.stage,angle:s.angle,sourceReference:c.applicationBinding.input.verificationBinding.sourceReference,normalizedReference:c.applicationBinding.input.verificationBinding.normalizedReference,qualification:'synthetic_pinned_direct_only'},candidate:c.candidate,reviewOnly:true,productionEligible:false},{type:'review',payload:{candidateId:c.id,scope:c.scope}});
 }catch{fail();}}
