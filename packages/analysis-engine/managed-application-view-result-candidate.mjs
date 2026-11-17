/** Versioned application-manifest synthetic comparison/synthesis OUTPUT. Pure structure/replay, never
 * authorization, actual decoding, disclosure approval or proof of execution.
 * Legacy v1 single-image fields, schemas and hashes are not altered. */
import {validateDesignSession,validateDesignPilotResult,appendDesignEvent,getDesignView} from './design-pilot.mjs';
import {DESIGN_VISUAL_VALUES,DESIGN_COMPARISON_OUTPUTS,DESIGN_COMPARISON_CHANGES,designSynthesisReviewChoices,designCandidateDigest as digest} from './design-candidate.mjs';
import {reconstructCandidateSessionPrefix} from './design-candidate-history.mjs';
import {copyManagedResultData,validateManagedWorkflowBinding} from './managed-image-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {validateManagedApplicationViewResultInput,validateManagedApplicationViewHistoryInputAndBinding} from '../design-production-adapter/managed-application-view-input.mjs';
import {policyOwnerKey,policyId} from '../design-production-adapter/approval-attempt-contracts.mjs';

export const MANAGED_APPLICATION_VIEW_RESULT_SCHEMA='design-managed-model-candidate-v6';
export const MANAGED_APPLICATION_VIEW_ACCEPTANCE_SCHEMA='design-managed-model-acceptance-v5';
export const MANAGED_APPLICATION_VIEW_KINDS=Object.freeze(['managed_application_completion_comparison','managed_application_completion_synthesis']);
export const MANAGED_APPLICATION_VIEW_ANGLES=Object.freeze(['front','back','left','right']);
export class ManagedApplicationViewResultError extends Error{constructor(){super('MANAGED_APPLICATION_VIEW_RESULT_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedApplicationViewResultError();};
const clone=v=>copyManagedResultData(v),same=(a,b)=>digest(a)===digest(b)&&canonical(a)===canonical(b);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const labels={front:'正面',back:'背面',left:'左侧',right:'右侧'};
function checkedImages(kind,e,a){
 exact(e,['angle','images']);if(kind!=='managed_application_completion_comparison'||!MANAGED_APPLICATION_VIEW_ANGLES.includes(e.angle)||!Array.isArray(e.images)||e.images.length!==2)fail();
 e.images.forEach((x,i)=>{validateManagedApplicationViewResultInput(x);if(x.stage!==['before','after'][i]||x.angle!==e.angle||!same(x.verificationBinding.authority,a))fail();});
 const [x,y]=e.images.map(v=>v.verificationBinding);
 for(const [left,right]of [[e.images[0].taskId,e.images[1].taskId],[x.sourceReference.manifestId,y.sourceReference.manifestId],[x.sourceBinding.requestId,y.sourceBinding.requestId],[x.sourceBinding.mediaId,y.sourceBinding.mediaId],[x.processingProvenance.claimId,y.processingProvenance.claimId],[x.artifactDigest,y.artifactDigest],[x.normalizedReference.manifestId,y.normalizedReference.manifestId]])if(left===right)fail();
 // Equal content hashes are allowed for distinct immutable records. This does
 // not prove separate physical captures, true angles or a styling change.
 return e;
}
function fullImages(e,a,raw){if(!Array.isArray(raw)||raw.length!==2)fail();const checked=raw.map(validateManagedApplicationViewHistoryInputAndBinding),inputs=checked.map(x=>x.input);for(let i=0;i<2;i++)if(!same(checked[i].binding,e.images[i]))fail();if(inputs[0].task.claimedArtifact.artifact.requestId===inputs[1].task.claimedArtifact.artifact.requestId)fail();return inputs;}
export function managedApplicationViewComparisonDescription(j){if(!DESIGN_COMPARISON_OUTPUTS.some(x=>same(x,j)))fail();return '合成演练，mock 响应，未调用真实模型；应用图片逐角比较，未确认、非测量或执行事实：'+(j.comparability==='comparable'?j.change:'无法比较：'+j.reason)+'。来源记录不同不证明实际不同拍摄；不证明达标、实际操作或因果。';}
const entryBase={zone:null,groupId:null,service:null,side:null};
function parts(c,s,history,inputs){
 const latest=getDesignView(s).entries,sources=[],entries=[],warnings=[];
 function add(index,{prefix,field,value,category,track,origin,basis,text,sourceKind='image_description',actor='model'}){
  const src={messageId:prefix+':'+c.id+':'+index,kind:sourceKind,actor,text};sources.push(src);
  entries.push({id:prefix+'-entry:'+c.id+':'+index,category,field,...entryBase,track,origin,basis,value,status:value===null?'unknown':'not_confirmed',sources:value===null?[]:[{messageId:src.messageId,quote:text}],replacesEntryId:latest.find(x=>x.category===category&&x.field===field&&x.zone===null&&x.track===track)?.id??null});
 }
 if(c.kind==='managed_application_completion_comparison'){
  if(s.phase!=='completed_review')fail();checkedImages(c.kind,c.evidenceBinding,c.authority);fullImages(c.evidenceBinding,c.authority,inputs);exact(c.result,['judgment']);const text=managedApplicationViewComparisonDescription(c.result.judgment);
  add(0,{prefix:'synthetic-application-comparison',field:'managed_photo_comparison_'+c.evidenceBinding.angle,value:text,category:'result_review',track:'actual',origin:'extraction',basis:'observable',text,sourceKind:'synthetic_application_comparison',actor:'system'});
  warnings.push('仅合成演练的 mock 逐角比较，未调用真实模型；actual只表示完成复盘，不证明独立拍摄、实际操作、达标或因果。');
 }else if(c.kind==='managed_application_completion_synthesis'){
  validateManagedApplicationSynthesisContext({session:s,managedImageHistory:history,evidenceBinding:c.evidenceBinding});exact(c.result,['reviewFocus']);
  const e=c.evidenceBinding,choices=reviewChoices(e);if(choices.length?!choices.some(x=>same(x,c.result.reviewFocus)):c.result.reviewFocus!==null)fail();
  const states={limited_evidence:'证据不足，不能形成完整三视图结论',potential_conflict:'逐角判断存在潜在冲突，需复核',consistent_judgments:'现有逐角判断方向一致，不代表达标',mixed_judgments:'逐角判断不同，保留各自限制'};
  const focus={missing_views:'补齐缺失角度',noncomparable_views:'复核不可比较原因',opposing_judgments:'核查相反判断与拍摄差异',cross_view_differences:'分别核对不同角度差异',confirm_angle_judgment:'核对尚未确认的逐角判断',capture_conditions:'核查拍摄条件是否足以比较'};
  const local=e.generation==='deterministic',text=(local?'合成演练，服务器整理，未调用新模型：':'合成演练，mock 响应，未调用真实模型；整理已采纳逐角判断，未重新查看照片：')+e.ancestors.map(x=>labels[x.angle]+'：'+(x.judgment.change??'无法比较：'+x.judgment.reason)+'（'+(x.entryStatus==='confirmed'?'员工已确认该条':'该条未确认')+'）').join('；')+'。缺失角度：'+(e.missingAngles.map(x=>labels[x]).join('、')||'无')+'；不可比：'+(e.uncomparableAngles.map(x=>labels[x]).join('、')||'无')+'；潜在冲突：'+(e.conflictingAngles.map(x=>labels[x]).join('、')||'无')+'。'+states[e.assessment]+'。优先复核：'+(c.result.reviewFocus?focus[c.result.reviewFocus.kind]+'（'+c.result.reviewFocus.angles.map(x=>labels[x]).join('、')+'）':'无额外复核重点')+'。仅覆盖所选'+labels[e.side]+'，不代表另一侧；不证明操作、药水、测量、达标或因果。';
  add(0,{prefix:'synthetic-application-synthesis',field:'managed_completion_synthesis_'+e.side,value:text,category:'result_review',track:'actual',origin:'suggestion',basis:'inferred',text,sourceKind:'synthetic_application_synthesis',actor:'system'});
  warnings.push('仅合成演练，综合只整理已采纳逐角 mock 判断并保留原确认状态；自身仍未确认，不重看照片，不能消除缺角、不可比和冲突，不推断工艺或实际执行。');
 }else fail();
 return {descriptionSources:sources,candidate:{phase:s.phase,entries,questions:[],warnings}};
}
function requestBinding(q,a,local){exact(q,['requestId','intentDigest','payloadSha256','model','promptVersion','approvalReceiptId','ownerKey']);if(!id(q.requestId)||!sha(q.intentDigest)||!sha(q.payloadSha256)||typeof q.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(q.model)||typeof q.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(q.promptVersion)||q.ownerKey!==policyOwnerKey(a,q.requestId)||(q.model==='server-deterministic')!==local)fail();if(local){if(q.approvalReceiptId!==null)fail();}else policyId(q.approvalReceiptId);}
function context(raw,kind){const c=clone(raw);exact(c,['session','workflowBinding',...(kind==='managed_application_completion_comparison'?['inputs']:['managedImageHistory'])]);c.session=validateDesignSession(c.session);c.workflowBinding=validateManagedWorkflowBinding(c.workflowBinding,c.session);return c;}
function checkCandidate(value,rawContext,builtParts=null){try{
 const v=copyManagedResultData(value,262144),ctx=context(rawContext,v.kind),s=ctx.session;
 exact(v,['schemaVersion','id','kind','generation','authority','scope','workflowBinding','requestBinding','evidenceBinding','result','descriptionSources','candidate']);
 if(v.schemaVersion!==MANAGED_APPLICATION_VIEW_RESULT_SCHEMA||!id(v.id,80)||!MANAGED_APPLICATION_VIEW_KINDS.includes(v.kind))fail();const a=validateImmutableDesignAuthority(v.authority),scope=validateProductionDesignScope(v.scope);
 if(!same(a.scope,scope)||scope.customerProfileId!==s.scope.customerId||scope.visitId!==s.scope.visitId||!same(validateManagedWorkflowBinding(v.workflowBinding,s),ctx.workflowBinding))fail();const local=v.kind==='managed_application_completion_synthesis'&&v.evidenceBinding?.generation==='deterministic';requestBinding(v.requestBinding,a,local);if(v.generation!==(local?'synthetic_deterministic':'synthetic_mock_model'))fail();
 if((v.requestBinding.model==='server-deterministic')!==(v.kind==='managed_application_completion_synthesis'&&v.evidenceBinding?.generation==='deterministic'))fail();
 const expected=builtParts??parts(v,s,ctx.managedImageHistory,ctx.inputs);if(!same(expected.descriptionSources,v.descriptionSources)||!same(expected.candidate,v.candidate))fail();
 let trial=s;for(const source of v.descriptionSources)trial=appendDesignEvent(trial,{scope:trial.scope,requestId:v.id+'-application-view-description-'+trial.revision,expectedRevision:trial.revision,event:{type:'source_recorded',source}}).session;
 validateDesignPilotResult(v.candidate,trial);return freeze(v);
 }catch{fail();}}
// Only the builder can supply its own just-derived parts; public validation stays independent.
export function validateManagedApplicationViewResultCandidate(value,rawContext){return checkCandidate(value,rawContext);}
export function buildManagedApplicationViewResultCandidate(input){try{
 const q=clone(input);exact(q,['id','kind','generation','authority','scope','workflowBinding','requestBinding','evidenceBinding','result','session',...(q.kind==='managed_application_completion_comparison'?['inputs']:['managedImageHistory'])]);
 const s=validateDesignSession(q.session),candidate={schemaVersion:MANAGED_APPLICATION_VIEW_RESULT_SCHEMA,...Object.fromEntries(['id','kind','generation','authority','scope','workflowBinding','requestBinding','evidenceBinding','result'].map(k=>[k,q[k]]))};
 const builtParts=parts(candidate,s,q.managedImageHistory,q.inputs);Object.assign(candidate,builtParts);return checkCandidate(candidate,{session:s,workflowBinding:q.workflowBinding,...(q.kind==='managed_application_completion_comparison'?{inputs:q.inputs}:{managedImageHistory:q.managedImageHistory})},builtParts);
 }catch{fail();}}
export function applyTrustedManagedApplicationViewCandidate(input){try{
 const q=clone(input);exact(q,['session','candidate','workflowBinding','selectedIndices','requestId',...(q.candidate?.kind==='managed_application_completion_comparison'?['inputs']:['managedImageHistory'])]);
 let s=validateDesignSession(q.session);const c=validateManagedApplicationViewResultCandidate(q.candidate,{session:s,workflowBinding:q.workflowBinding,...(q.candidate?.kind==='managed_application_completion_comparison'?{inputs:q.inputs}:{managedImageHistory:q.managedImageHistory})});
 if(!id(q.requestId,80)||!Array.isArray(q.selectedIndices)||!q.selectedIndices.length||q.selectedIndices.length>2||new Set(q.selectedIndices).size!==q.selectedIndices.length||q.selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=c.candidate.entries.length)||!same(q.selectedIndices,[0]))fail();
 const selected=[...q.selectedIndices].sort((a,b)=>a-b);
 for(const i of selected)for(const [suffix,event] of [['source',{type:'source_recorded',source:c.descriptionSources[i]}],['entry',{type:'entry_recorded',entry:c.candidate.entries[i]}]])s=appendDesignEvent(s,{scope:s.scope,requestId:q.requestId+'-application-view-'+suffix+'-'+i,expectedRevision:s.revision,event}).session;
 return freeze({session:s,acceptedReceipt:{schemaVersion:MANAGED_APPLICATION_VIEW_ACCEPTANCE_SCHEMA,candidateId:c.id,candidateDigest:digest(c),kind:c.kind,inputDigest:c.workflowBinding.sessionDigest,baseRevision:c.workflowBinding.sessionRevision,resultRevision:s.revision,selectedIndices:selected,evidenceBindingDigest:digest(c.evidenceBinding)}});
 }catch{fail();}}
function reviewChoices(e){return designSynthesisReviewChoices({side:e.side,evidence:e.ancestors,missingAngles:e.missingAngles,uncomparableAngles:e.uncomparableAngles,conflictingAngles:e.conflictingAngles});}
function facts(side,ancestors){
 const required=['front','back',side],missingAngles=required.filter(a=>!ancestors.some(e=>e.angle===a)),uncomparableAngles=ancestors.filter(e=>e.judgment.comparability==='not_comparable').map(e=>e.angle),confirmedAngles=ancestors.filter(e=>e.entryStatus==='confirmed').map(e=>e.angle),unconfirmedAngles=ancestors.filter(e=>e.entryStatus==='not_confirmed').map(e=>e.angle);
 const up=ancestors.some(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[1]),down=ancestors.some(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[2]),conflictingAngles=up&&down?ancestors.filter(e=>[DESIGN_COMPARISON_CHANGES[1],DESIGN_COMPARISON_CHANGES[2]].includes(e.judgment.change)).map(e=>e.angle):[];
 const assessment=missingAngles.length||uncomparableAngles.length?'limited_evidence':conflictingAngles.length?'potential_conflict':new Set(ancestors.map(e=>e.judgment.change)).size===1?'consistent_judgments':'mixed_judgments';
 const base={side,ancestors,missingAngles,uncomparableAngles,conflictingAngles,confirmedAngles,unconfirmedAngles,assessment};return {...base,generation:reviewChoices(base).length>1?'model_review_focus':'deterministic'};
}
/** Shape and deterministic facts only. No session, issuer, receipt-storage or
 * live-source authority is established until the composite context is checked. */
export function validateManagedApplicationViewEvidenceBinding(value,context){try{
 const e=clone(value),c=clone(context);exact(c,['kind']);if(!MANAGED_APPLICATION_VIEW_KINDS.includes(c.kind))fail();
 if(c.kind!=='managed_application_completion_synthesis')return freeze(checkedImages(c.kind,e,validateImmutableDesignAuthority(e.images?.[0]?.verificationBinding?.authority)));
 exact(e,['side','ancestors','missingAngles','uncomparableAngles','conflictingAngles','confirmedAngles','unconfirmedAngles','assessment','generation']);
 if(!['left','right'].includes(e.side)||!Array.isArray(e.ancestors)||e.ancestors.length<1||e.ancestors.length>3)fail();
 const angles=['front','back',e.side],seen=new Set();let prior=-1;
 for(const a of e.ancestors){
  exact(a,['candidateId','candidateDigest','angle','entryId','acceptanceRequestId','acceptanceReceiptDigest','entryStatus','confirmationDigest','judgment','imageBindingDigests']);
  const at=angles.indexOf(a.angle);
  if(at<=prior||!id(a.candidateId,80)||seen.has(a.candidateId)||!sha(a.candidateDigest)||a.entryId!=='synthetic-application-comparison-entry:'+a.candidateId+':0'||!id(a.acceptanceRequestId,80)||!sha(a.acceptanceReceiptDigest)||!['confirmed','not_confirmed'].includes(a.entryStatus)||(a.entryStatus==='confirmed'?!sha(a.confirmationDigest):a.confirmationDigest!==null)||!DESIGN_COMPARISON_OUTPUTS.some(j=>same(j,a.judgment))||!Array.isArray(a.imageBindingDigests)||a.imageBindingDigests.length!==2||a.imageBindingDigests.some(x=>!sha(x)))fail();
  prior=at;seen.add(a.candidateId);
 }
 if(!same(e,facts(e.side,e.ancestors)))fail();return freeze(e);
 }catch{fail();}}
/** Caller must additionally check live ancestor/media/evidence access. These
 * deterministic facts bind the EXACT historical prefix and immutable receipts.
 * Original ancestor authors remain unchanged and match their acceptance author.
 * This does not authorize cross-identity/epoch reuse: the fresh repository must
 * separately verify current access to every original ancestor and source proof.
 * A previous employee confirmation is not model, billing or adoption consent. */
export function buildManagedApplicationSynthesisEvidence(input){try{
 const q=clone(input);exact(q,['session','managedImageHistory','side']);const s=validateDesignSession(q.session),h=q.managedImageHistory;
 if(s.phase!=='completed_review'||!['left','right'].includes(q.side))fail();exact(h,['schemaVersion','inputs','accepted']);if(h.schemaVersion!=='design-managed-image-history-v5'||!Array.isArray(h.inputs)||h.inputs.length>300||!Array.isArray(h.accepted)||h.accepted.length>1000)fail();
 const latest=getDesignView(s).entries,ancestors=[];
 for(const angle of ['front','back',q.side]){
  const entry=latest.find(x=>x.category==='result_review'&&x.field==='managed_photo_comparison_'+angle&&x.track==='actual'&&x.zone===null);if(!entry)continue;
  const rows=h.accepted.filter(x=>x?.candidate?.schemaVersion===MANAGED_APPLICATION_VIEW_RESULT_SCHEMA&&x.candidate.kind==='managed_application_completion_comparison'&&x.candidate.candidate?.entries?.[0]?.id===entry.id);if(rows.length!==1)fail();
  const row=rows[0],c=row.candidate,a=row.acceptance;exact(row,['candidate','acceptance']);exact(a,['requestId','workflowRevision','authority','receipt']);
  if(!same(validateImmutableDesignAuthority(a.authority),c.authority)||a.workflowRevision!==c.workflowBinding.recordRevision+1||!id(a.requestId,80)||c.evidenceBinding.angle!==angle||c.scope.customerProfileId!==s.scope.customerId||c.scope.visitId!==s.scope.visitId||a.receipt.resultRevision>s.revision||!same(a.receipt.selectedIndices,[0]))fail();
  const inputs=c.evidenceBinding.images.map(image=>{const rows=h.inputs.filter(x=>x.taskId===image.taskId);if(rows.length!==1)fail();return rows[0];});const prefix=reconstructCandidateSessionPrefix(s,c.workflowBinding.sessionRevision),applied=applyTrustedManagedApplicationViewCandidate({session:prefix,candidate:c,workflowBinding:c.workflowBinding,selectedIndices:[0],requestId:a.requestId,inputs});
  if(!same(applied.acceptedReceipt,a.receipt)||!same(applied.session.journal,s.journal.slice(0,a.receipt.resultRevision))||!['confirmed','not_confirmed'].includes(entry.status)||entry.value!==managedApplicationViewComparisonDescription(c.result.judgment)||entry.basis!=='observable'||entry.origin!=='extraction')fail();
  if(entry.status==='confirmed'?!entry.confirmation:entry.confirmation!==null)fail();
  ancestors.push({candidateId:c.id,candidateDigest:digest(c),angle,entryId:entry.id,acceptanceRequestId:a.requestId,acceptanceReceiptDigest:digest(a.receipt),entryStatus:entry.status,confirmationDigest:entry.status==='confirmed'?digest(entry.confirmation):null,judgment:clone(c.result.judgment),imageBindingDigests:c.evidenceBinding.images.map(digest)});
 }
 if(!ancestors.length)fail();const evidenceBinding=facts(q.side,ancestors);return freeze({evidenceBinding,allowedReviewFocus:reviewChoices(evidenceBinding)});
 }catch{fail();}}
export function validateManagedApplicationSynthesisContext(input){try{
 const q=clone(input);exact(q,['session','managedImageHistory','evidenceBinding']);const expected=buildManagedApplicationSynthesisEvidence({session:q.session,managedImageHistory:q.managedImageHistory,side:q.evidenceBinding?.side});if(!same(q.evidenceBinding,expected.evidenceBinding))fail();return true;
 }catch{fail();}}
