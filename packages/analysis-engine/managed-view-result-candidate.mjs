/** Versioned managed multi-view MODEL OUTPUT. Pure structure/replay, never
 * authorization, actual decoding, disclosure approval or proof of execution.
 * Legacy v1 single-image fields, schemas and hashes are not altered. */
import {validateDesignSession,validateDesignPilotResult,appendDesignEvent,getDesignView} from './design-pilot.mjs';
import {DESIGN_VISUAL_VALUES,DESIGN_COMPARISON_OUTPUTS,DESIGN_COMPARISON_CHANGES,designSynthesisReviewChoices,designCandidateDigest as digest} from './design-candidate.mjs';
import {reconstructCandidateSessionPrefix} from './design-candidate-history.mjs';
import {copyManagedResultData,validateManagedWorkflowBinding} from './managed-image-result-candidate.mjs';
import {validateImmutableDesignAuthority} from '../design-production-adapter/immutable-authority.mjs';
import {validateProductionDesignScope} from '../design-production-adapter/employee-adapter.mjs';
import {MANAGED_IMAGE_CANDIDATE_BUDGETS} from '../design-production-adapter/managed-image-contracts.mjs';

export const MANAGED_VIEW_RESULT_SCHEMA='design-managed-model-candidate-v2';
export const MANAGED_VIEW_ACCEPTANCE_SCHEMA='design-managed-model-acceptance-v2';
export const MANAGED_VIEW_KINDS=Object.freeze(['managed_before_view','managed_completion_comparison','managed_completion_synthesis']);
export const MANAGED_VIEW_ANGLES=Object.freeze(['front','back','left','right']);
export class ManagedViewResultError extends Error{constructor(){super('MANAGED_VIEW_RESULT_INVALID');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedViewResultError();};
const clone=v=>copyManagedResultData(v),same=(a,b)=>digest(a)===digest(b)&&canonical(a)===canonical(b);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=(v,n=100)=>typeof v==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+n+'}$').test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const labels={front:'正面',back:'背面',left:'左侧',right:'右侧'};
function object(v){exact(v,['projectOrigin','bucket','key','version']);if(typeof v.projectOrigin!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v.projectOrigin)||typeof v.bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.bucket)||typeof v.version!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(v.version)||typeof v.key!=='string'||v.key.length>1024||!/^\w[\w./-]*$/.test(v.key)||v.key.split('/').some(p=>!p||p==='.'||p==='..'))fail();}
/** Independent before/after structural binding; old v4 before-only validator
 * is deliberately not widened. Caller must independently verify issuer/access. */
export function validateManagedViewImageBinding(value,context={}){try{
 const v=clone(value),c=clone(context);exact(c,[...(Object.hasOwn(c,'authority')?['authority']:[]),...(Object.hasOwn(c,'stage')?['stage']:[])]);
 exact(v,['taskId','candidateDigest','objectReceiptDigest','verificationReportDigest','authority','sourceRecordDigest','responseDigest','evidenceDigest','sourceObject','derivativeObject','sourceSha256','derivativeSha256','mime','byteLength','maxEdge','stage','angle']);
 const a=validateImmutableDesignAuthority(v.authority);if(!id(v.taskId)||['candidateDigest','objectReceiptDigest','verificationReportDigest','sourceRecordDigest','responseDigest','evidenceDigest','sourceSha256','derivativeSha256'].some(k=>!sha(v[k]))||!['before','after'].includes(v.stage)||!MANAGED_VIEW_ANGLES.includes(v.angle)||![1024,1536].includes(v.maxEdge)||!MANAGED_IMAGE_CANDIDATE_BUDGETS[v.maxEdge]?.[v.mime]||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>MANAGED_IMAGE_CANDIDATE_BUDGETS[v.maxEdge][v.mime])fail();
 if(Object.hasOwn(c,'authority')&&!same(a,validateImmutableDesignAuthority(c.authority))||Object.hasOwn(c,'stage')&&v.stage!==c.stage)fail();
 object(v.sourceObject);object(v.derivativeObject);if(v.sourceObject.projectOrigin!==v.derivativeObject.projectOrigin||v.sourceObject.bucket!==v.derivativeObject.bucket||v.sourceObject.key===v.derivativeObject.key)fail();return freeze(v);
 }catch{fail();}}
function checkedImages(kind,e,a){
 exact(e,['angle','images']);const stages=kind==='managed_before_view'?['before']:['before','after'];
 if(!MANAGED_VIEW_ANGLES.includes(e.angle)||!Array.isArray(e.images)||e.images.length!==stages.length)fail();
 e.images.forEach((x,i)=>{validateManagedViewImageBinding(x,{authority:a,stage:stages[i]});if(x.angle!==e.angle)fail();});
 if(stages.length===2&&(e.images[0].taskId===e.images[1].taskId||same(e.images[0].sourceObject,e.images[1].sourceObject)))fail();
 return e;
}
export function managedViewComparisonDescription(j){if(!DESIGN_COMPARISON_OUTPUTS.some(x=>same(x,j)))fail();return '托管图片逐角比较，未确认、非测量或执行事实：'+(j.comparability==='comparable'?j.change:'无法比较：'+j.reason)+'。不证明达标或操作因果。';}
const entryBase={zone:null,groupId:null,service:null,side:null};
function parts(c,s,history){
 const latest=getDesignView(s).entries,sources=[],entries=[],warnings=[];
 function add(index,{prefix,field,value,category,track,origin,basis,text,sourceKind='image_description',actor='model'}){
  const src={messageId:prefix+':'+c.id+':'+index,kind:sourceKind,actor,text};sources.push(src);
  entries.push({id:prefix+'-entry:'+c.id+':'+index,category,field,...entryBase,track,origin,basis,value,status:value===null?'unknown':'not_confirmed',sources:value===null?[]:[{messageId:src.messageId,quote:text}],replacesEntryId:latest.find(x=>x.category===category&&x.field===field&&x.zone===null&&x.track===track)?.id??null});
 }
 if(c.kind==='managed_before_view'){
  if(s.phase!=='before_analysis')fail();checkedImages(c.kind,c.evidenceBinding,c.authority);exact(c.result,['observations']);const seen=new Set();
  if(!Array.isArray(c.result.observations)||c.result.observations.length<1||c.result.observations.length>2)fail();
  c.result.observations.forEach((o,i)=>{exact(o,['field','value']);if(!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))fail();seen.add(o.field);const text='托管剪前'+labels[c.evidenceBinding.angle]+'模型描述，未确认、非测量或事实：'+o.field+'：'+(o.value??'未知')+'。';
   add(i,{prefix:'managed-before',field:'managed_before_'+(o.field==='visible_outline'?'outline':'hair_shape')+'_'+c.evidenceBinding.angle,value:o.value,category:'person_style',track:'context',origin:'extraction',basis:'observable',text});});
  warnings.push('仅描述所选剪前角度的可见外形，不代表其它角度；未知不补猜，采纳不等于确认或实际操作。');
 }else if(c.kind==='managed_completion_comparison'){
  if(s.phase!=='completed_review')fail();checkedImages(c.kind,c.evidenceBinding,c.authority);exact(c.result,['judgment']);const text=managedViewComparisonDescription(c.result.judgment);
  add(0,{prefix:'managed-comparison',field:'managed_photo_comparison_'+c.evidenceBinding.angle,value:text,category:'result_review',track:'actual',origin:'extraction',basis:'observable',text});
  warnings.push('仅比较相同明确角度的剪前与完成照；actual只表示完成复盘，不证明实际操作、达标或因果。');
 }else if(c.kind==='managed_completion_synthesis'){
  validateManagedSynthesisContext({session:s,managedImageHistory:history,evidenceBinding:c.evidenceBinding});exact(c.result,['reviewFocus']);
  const e=c.evidenceBinding,choices=reviewChoices(e);if(choices.length?!choices.some(x=>same(x,c.result.reviewFocus)):c.result.reviewFocus!==null)fail();
  const states={limited_evidence:'证据不足，不能形成完整三视图结论',potential_conflict:'逐角判断存在潜在冲突，需复核',consistent_judgments:'现有逐角判断方向一致，不代表达标',mixed_judgments:'逐角判断不同，保留各自限制'};
  const focus={missing_views:'补齐缺失角度',noncomparable_views:'复核不可比较原因',opposing_judgments:'核查相反判断与拍摄差异',cross_view_differences:'分别核对不同角度差异',confirm_angle_judgment:'核对尚未确认的逐角判断',capture_conditions:'核查拍摄条件是否足以比较'};
  const local=e.generation==='deterministic',text=(local?'服务器整理已采纳逐角判断，未调用新模型：':'模型综合已采纳逐角判断，未重新查看照片：')+e.ancestors.map(x=>labels[x.angle]+'：'+(x.judgment.change??'无法比较：'+x.judgment.reason)+'（'+(x.entryStatus==='confirmed'?'员工已确认该条':'该条未确认')+'）').join('；')+'。缺失角度：'+(e.missingAngles.map(x=>labels[x]).join('、')||'无')+'；不可比：'+(e.uncomparableAngles.map(x=>labels[x]).join('、')||'无')+'；潜在冲突：'+(e.conflictingAngles.map(x=>labels[x]).join('、')||'无')+'。'+states[e.assessment]+'。优先复核：'+(c.result.reviewFocus?focus[c.result.reviewFocus.kind]+'（'+c.result.reviewFocus.angles.map(x=>labels[x]).join('、')+'）':'无额外复核重点')+'。仅覆盖所选'+labels[e.side]+'，不代表另一侧；不证明操作、药水、测量、达标或因果。';
  add(0,{prefix:'managed-synthesis',field:'managed_completion_synthesis_'+e.side,value:text,category:'result_review',track:'actual',origin:'suggestion',basis:'inferred',text,sourceKind:local?'server_synthesis':'model_synthesis',actor:local?'system':'model'});
  warnings.push('综合仅整理已采纳逐角模型判断，保留每项原确认状态；综合自身仍未确认，缺角、不可比和冲突不能消除。');
 }else fail();
 return {descriptionSources:sources,candidate:{phase:s.phase,entries,questions:[],warnings}};
}
function requestBinding(q){exact(q,['requestId','intentDigest','payloadSha256','model','promptVersion']);if(!id(q.requestId)||!sha(q.intentDigest)||!sha(q.payloadSha256)||typeof q.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(q.model)||typeof q.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(q.promptVersion))fail();}
function context(raw){const c=clone(raw);exact(c,['session','workflowBinding',...(Object.hasOwn(c,'managedImageHistory')?['managedImageHistory']:[])]);c.session=validateDesignSession(c.session);c.workflowBinding=validateManagedWorkflowBinding(c.workflowBinding,c.session);return c;}
export function validateManagedViewResultCandidate(value,rawContext){try{
 const v=copyManagedResultData(value,262144),ctx=context(rawContext),s=ctx.session;
 exact(v,['schemaVersion','id','kind','authority','scope','workflowBinding','requestBinding','evidenceBinding','result','descriptionSources','candidate']);
 if(v.schemaVersion!==MANAGED_VIEW_RESULT_SCHEMA||!id(v.id,80)||!MANAGED_VIEW_KINDS.includes(v.kind))fail();const a=validateImmutableDesignAuthority(v.authority),scope=validateProductionDesignScope(v.scope);
 if(!same(a.scope,scope)||scope.customerProfileId!==s.scope.customerId||scope.visitId!==s.scope.visitId||!same(validateManagedWorkflowBinding(v.workflowBinding,s),ctx.workflowBinding))fail();requestBinding(v.requestBinding);
 if((v.requestBinding.model==='server-deterministic')!==(v.kind==='managed_completion_synthesis'&&v.evidenceBinding?.generation==='deterministic'))fail();
 const expected=parts(v,s,ctx.managedImageHistory);if(!same(expected.descriptionSources,v.descriptionSources)||!same(expected.candidate,v.candidate))fail();
 let trial=s;for(const source of v.descriptionSources)trial=appendDesignEvent(trial,{scope:trial.scope,requestId:v.id+'-view-description-'+trial.revision,expectedRevision:trial.revision,event:{type:'source_recorded',source}}).session;
 validateDesignPilotResult(v.candidate,trial);return freeze(v);
 }catch{fail();}}
export function buildManagedViewResultCandidate(input){try{
 const q=clone(input);exact(q,['id','kind','authority','scope','workflowBinding','requestBinding','evidenceBinding','result','session',...(Object.hasOwn(q,'managedImageHistory')?['managedImageHistory']:[])]);
 const s=validateDesignSession(q.session),candidate={schemaVersion:MANAGED_VIEW_RESULT_SCHEMA,...Object.fromEntries(['id','kind','authority','scope','workflowBinding','requestBinding','evidenceBinding','result'].map(k=>[k,q[k]]))};
 Object.assign(candidate,parts(candidate,s,q.managedImageHistory));return validateManagedViewResultCandidate(candidate,{session:s,workflowBinding:q.workflowBinding,...(Object.hasOwn(q,'managedImageHistory')?{managedImageHistory:q.managedImageHistory}:{})});
 }catch{fail();}}
export function applyTrustedManagedViewCandidate(input){try{
 const q=clone(input);exact(q,['session','candidate','workflowBinding','selectedIndices','requestId',...(Object.hasOwn(q,'managedImageHistory')?['managedImageHistory']:[])]);
 let s=validateDesignSession(q.session);const c=validateManagedViewResultCandidate(q.candidate,{session:s,workflowBinding:q.workflowBinding,...(Object.hasOwn(q,'managedImageHistory')?{managedImageHistory:q.managedImageHistory}:{})});
 if(!id(q.requestId,80)||!Array.isArray(q.selectedIndices)||!q.selectedIndices.length||q.selectedIndices.length>2||new Set(q.selectedIndices).size!==q.selectedIndices.length||q.selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=c.candidate.entries.length)||c.kind!=='managed_before_view'&&!same(q.selectedIndices,[0]))fail();
 const selected=[...q.selectedIndices].sort((a,b)=>a-b);
 for(const i of selected)for(const [suffix,event] of [['source',{type:'source_recorded',source:c.descriptionSources[i]}],['entry',{type:'entry_recorded',entry:c.candidate.entries[i]}]])s=appendDesignEvent(s,{scope:s.scope,requestId:q.requestId+'-managed-view-'+suffix+'-'+i,expectedRevision:s.revision,event}).session;
 return freeze({session:s,acceptedReceipt:{schemaVersion:MANAGED_VIEW_ACCEPTANCE_SCHEMA,candidateId:c.id,candidateDigest:digest(c),kind:c.kind,inputDigest:c.workflowBinding.sessionDigest,baseRevision:c.workflowBinding.sessionRevision,resultRevision:s.revision,selectedIndices:selected,evidenceBindingDigest:digest(c.evidenceBinding)}});
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
export function validateManagedViewEvidenceBinding(value,context){try{
 const e=clone(value),c=clone(context);exact(c,['kind']);if(!MANAGED_VIEW_KINDS.includes(c.kind))fail();
 if(c.kind!=='managed_completion_synthesis')return freeze(checkedImages(c.kind,e,validateImmutableDesignAuthority(e.images?.[0]?.authority)));
 exact(e,['side','ancestors','missingAngles','uncomparableAngles','conflictingAngles','confirmedAngles','unconfirmedAngles','assessment','generation']);
 if(!['left','right'].includes(e.side)||!Array.isArray(e.ancestors)||e.ancestors.length<1||e.ancestors.length>3)fail();
 const angles=['front','back',e.side],seen=new Set();let prior=-1;
 for(const a of e.ancestors){
  exact(a,['candidateId','candidateDigest','angle','entryId','acceptanceRequestId','acceptanceReceiptDigest','entryStatus','confirmationDigest','judgment','imageBindingDigests']);
  const at=angles.indexOf(a.angle);
  if(at<=prior||!id(a.candidateId,80)||seen.has(a.candidateId)||!sha(a.candidateDigest)||a.entryId!=='managed-comparison-entry:'+a.candidateId+':0'||!id(a.acceptanceRequestId,80)||!sha(a.acceptanceReceiptDigest)||!['confirmed','not_confirmed'].includes(a.entryStatus)||(a.entryStatus==='confirmed'?!sha(a.confirmationDigest):a.confirmationDigest!==null)||!DESIGN_COMPARISON_OUTPUTS.some(j=>same(j,a.judgment))||!Array.isArray(a.imageBindingDigests)||a.imageBindingDigests.length!==2||a.imageBindingDigests.some(x=>!sha(x)))fail();
  prior=at;seen.add(a.candidateId);
 }
 if(!same(e,facts(e.side,e.ancestors)))fail();return freeze(e);
 }catch{fail();}}
/** Caller must additionally check live ancestor/media/evidence access. These
 * deterministic facts bind the EXACT historical prefix and immutable receipts.
 * A previous employee confirmation is not model, billing or adoption consent. */
export function buildManagedSynthesisEvidence(input){try{
 const q=clone(input);exact(q,['session','managedImageHistory','side']);const s=validateDesignSession(q.session),h=q.managedImageHistory;
 if(s.phase!=='completed_review'||!['left','right'].includes(q.side))fail();exact(h,['schemaVersion','inputs','accepted']);if(!['design-managed-image-history-v1','design-managed-image-history-v2'].includes(h.schemaVersion)||!Array.isArray(h.inputs)||h.inputs.length>300||!Array.isArray(h.accepted)||h.accepted.length>1000)fail();
 const latest=getDesignView(s).entries,ancestors=[];
 for(const angle of ['front','back',q.side]){
  const entry=latest.find(x=>x.category==='result_review'&&x.field==='managed_photo_comparison_'+angle&&x.track==='actual'&&x.zone===null);if(!entry)continue;
  const rows=h.accepted.filter(x=>x?.candidate?.schemaVersion===MANAGED_VIEW_RESULT_SCHEMA&&x.candidate.kind==='managed_completion_comparison'&&x.candidate.candidate?.entries?.[0]?.id===entry.id);if(rows.length!==1)fail();
  const row=rows[0],c=row.candidate,a=row.acceptance;exact(row,['candidate','acceptance']);exact(a,['requestId','workflowRevision','authority','receipt']);
  if(!same(validateImmutableDesignAuthority(a.authority),c.authority)||a.workflowRevision!==c.workflowBinding.recordRevision+1||!id(a.requestId,80)||c.evidenceBinding.angle!==angle||c.scope.customerProfileId!==s.scope.customerId||c.scope.visitId!==s.scope.visitId||a.receipt.resultRevision>s.revision||!same(a.receipt.selectedIndices,[0]))fail();
  const prefix=reconstructCandidateSessionPrefix(s,c.workflowBinding.sessionRevision),applied=applyTrustedManagedViewCandidate({session:prefix,candidate:c,workflowBinding:c.workflowBinding,selectedIndices:[0],requestId:a.requestId});
  if(!same(applied.acceptedReceipt,a.receipt)||!same(applied.session.journal,s.journal.slice(0,a.receipt.resultRevision))||!['confirmed','not_confirmed'].includes(entry.status)||entry.value!==managedViewComparisonDescription(c.result.judgment)||entry.basis!=='observable'||entry.origin!=='extraction')fail();
  if(entry.status==='confirmed'?!entry.confirmation:entry.confirmation!==null)fail();
  ancestors.push({candidateId:c.id,candidateDigest:digest(c),angle,entryId:entry.id,acceptanceRequestId:a.requestId,acceptanceReceiptDigest:digest(a.receipt),entryStatus:entry.status,confirmationDigest:entry.status==='confirmed'?digest(entry.confirmation):null,judgment:clone(c.result.judgment),imageBindingDigests:c.evidenceBinding.images.map(digest)});
 }
 if(!ancestors.length)fail();const evidenceBinding=facts(q.side,ancestors);return freeze({evidenceBinding,allowedReviewFocus:reviewChoices(evidenceBinding)});
 }catch{fail();}}
export function validateManagedSynthesisContext(input){try{
 const q=clone(input);exact(q,['session','managedImageHistory','evidenceBinding']);const expected=buildManagedSynthesisEvidence({session:q.session,managedImageHistory:q.managedImageHistory,side:q.evidenceBinding?.side});if(!same(q.evidenceBinding,expected.evidenceBinding))fail();return true;
 }catch{fail();}}
