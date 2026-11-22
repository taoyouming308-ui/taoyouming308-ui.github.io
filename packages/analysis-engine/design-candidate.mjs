/** Pure server-candidate contract. A validated JSON object alone is NOT authoritative provenance. */
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {validateDesignSession,validateDesignPilotResult,appendDesignEvent,getDesignView} from './design-pilot.mjs';
export const DESIGN_CANDIDATE_SCHEMA='design-model-candidate-v1';
export const DESIGN_VISUAL_VALUES=Object.freeze({visible_outline:Object.freeze(['轮廓偏圆','轮廓偏长','轮廓偏方','轮廓偏椭圆']),visible_hair_shape:Object.freeze(['短发轮廓','中长发轮廓','长发轮廓','直线发丝形态','波浪发丝形态','卷曲发丝形态'])});
export class DesignCandidateError extends Error{constructor(code){super(code);this.name='DesignCandidateError';this.code=code;this.retryable=false;}}
const fail=code=>{throw new DesignCandidateError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('CANDIDATE_INVALID');};
const clone=v=>JSON.parse(JSON.stringify(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const designCandidateDigest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
function context(session){try{return validateDesignSession(session);}catch{fail('CANDIDATE_SESSION_INVALID');}}
export function visualDescriptionText(field,value){return '模型视觉描述，未确认、非测量或事实：'+field+'：'+(value??'未知')+'。';}
function withDescriptions(session,envelope){let next=session;for(const source of envelope.descriptionSources){next=appendDesignEvent(next,{requestId:envelope.id+'-description-'+next.revision,expectedRevision:next.revision,scope:next.scope,event:{type:'source_recorded',source}}).session;}return next;}
export function validateDesignCandidate(value,session){
 exact(value,[...(value?.kind==='completion_comparison'?['comparison']:value?.kind==='completion_synthesis'?['synthesis']:[]),'schemaVersion','id','kind','scope','store','actor','sessionId','baseRevision','inputDigest','payloadDigest','model','promptVersion','sourceRefs','descriptionSources','candidate']);
 const checked=context(session);exact(value.actor,['username','store']);exact(value.scope,['customerProfileId','visitId','assignmentSource']);
 if(value.schemaVersion!==DESIGN_CANDIDATE_SCHEMA||!id(value.id)||!['text_extraction','visual_description','completion_comparison','completion_synthesis'].includes(value.kind)||typeof value.store!=='string'||!value.store||value.actor.store!==value.store||typeof value.actor.username!=='string'||!value.actor.username||value.actor.username.length>160||value.scope.customerProfileId!==checked.scope.customerId||value.scope.visitId!==checked.scope.visitId||!['appointment','frontdesk'].includes(value.scope.assignmentSource)||value.sessionId!==checked.scope.sessionId||value.baseRevision!==checked.revision||value.inputDigest!==designCandidateDigest(checked)||!sha(value.payloadDigest)||typeof value.model!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(value.model)||typeof value.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(value.promptVersion)||!Array.isArray(value.sourceRefs)||!Array.isArray(value.descriptionSources))fail('CANDIDATE_CONTEXT_MISMATCH');
 if(value.kind==='text_extraction'){
  if(value.sourceRefs.length||value.descriptionSources.length)fail('CANDIDATE_INVALID');
  let result;try{result=validateDesignPilotResult(value.candidate,checked);}catch{fail('CANDIDATE_INVALID');}
  if(result.entries.some(e=>e.origin!=='extraction'||e.basis!=='said'||/^managed_(before_|photo_comparison_|completion_synthesis_)/.test(e.field)||e.category==='result_review'&&(e.field.startsWith('model_photo_comparison_')||e.field.startsWith('model_completion_synthesis_'))))fail('CANDIDATE_UNSUPPORTED_INFERENCE');
  const existing=getDesignView(checked).entries;for(const entry of result.entries.filter(e=>e.category==='technique')){const group=existing.find(e=>e.category==='technique'&&e.groupId===entry.groupId);if(!group||group.zone!==entry.zone||group.service!==entry.service||group.side!==entry.side)fail('CANDIDATE_GROUP_UNVERIFIED');}
 }else if(value.kind==='completion_synthesis'){
  const synthesis=validateSynthesisShape(value.synthesis,checked);if((value.model==='server-deterministic')!==(synthesis.generation==='deterministic'))fail('CANDIDATE_INVALID');
  if(value.sourceRefs.length!==synthesis.evidence.length*2)fail('CANDIDATE_INVALID');const seenRefs=new Set();
  for(const ref of value.sourceRefs){exact(ref,['mediaId','sourceSha256','derivativeSha256']);if(typeof ref.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.mediaId)||seenRefs.has(ref.mediaId)||!sha(ref.sourceSha256)||!sha(ref.derivativeSha256))fail('CANDIDATE_INVALID');seenRefs.add(ref.mediaId);}
  const parts=buildSynthesisCandidateParts({id:value.id,session:checked,synthesis});
  if(!equal(parts.candidate,value.candidate)||!equal(parts.descriptionSources,value.descriptionSources))fail('CANDIDATE_INVALID');
  try{validateDesignPilotResult(value.candidate,withDescriptions(checked,value));}catch{fail('CANDIDATE_INVALID');}
 }else if(value.kind==='completion_comparison'){
  exact(value.comparison,['beforeMediaId','afterMediaId','angle']);
  const pair=value.comparison;if(checked.phase!=='completed_review'||pair.beforeMediaId===pair.afterMediaId||!['front','back','left','right'].includes(pair.angle)||value.sourceRefs.length!==2)fail('CANDIDATE_INVALID');
  value.sourceRefs.forEach((r,i)=>{exact(r,['mediaId','sourceSha256','derivativeSha256']);if(r.mediaId!==(i===0?pair.beforeMediaId:pair.afterMediaId)||typeof r.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.mediaId)||!sha(r.sourceSha256)||!sha(r.derivativeSha256))fail('CANDIDATE_INVALID');});
  if(value.descriptionSources.length!==1||value.candidate?.entries?.length!==1)fail('CANDIDATE_INVALID');
  const entry=value.candidate.entries[0],output=DESIGN_COMPARISON_OUTPUTS.find(o=>comparisonDescription(o)===entry.value);
  if(!output)fail('CANDIDATE_UNSUPPORTED_INFERENCE');
  const expected=buildCompletionCandidateParts({id:value.id,session:checked,output,angle:pair.angle});
  if(!equal(expected.descriptionSources,value.descriptionSources)||!equal(expected.candidate,value.candidate))fail('CANDIDATE_INVALID');
  try{validateDesignPilotResult(value.candidate,withDescriptions(checked,value));}catch{fail('CANDIDATE_INVALID');}
 }else{
  if(checked.phase!=='before_analysis'||value.sourceRefs.length!==1||value.descriptionSources.length!==value.candidate?.entries?.length||value.descriptionSources.length>2)fail('CANDIDATE_INVALID');
  const ref=value.sourceRefs[0];exact(ref,['mediaId','sourceSha256','derivativeSha256']);if(typeof ref.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.mediaId)||!sha(ref.sourceSha256)||!sha(ref.derivativeSha256))fail('CANDIDATE_INVALID');
  exact(value.candidate,['phase','entries','questions','warnings']);if(!Array.isArray(value.candidate.entries)||!Array.isArray(value.candidate.questions)||value.candidate.questions.length||!equal(value.candidate.warnings,['模型视觉描述仅供员工核对，不是测量或事实。']))fail('CANDIDATE_INVALID');
  const seen=new Set();value.candidate.entries.forEach((entry,i)=>{
   if(!Object.hasOwn(DESIGN_VISUAL_VALUES,entry.field)||seen.has(entry.field)||entry.category!=='person_style'||entry.origin!=='extraction'||entry.basis!=='observable'||entry.track!=='context'||entry.value!==null&&!DESIGN_VISUAL_VALUES[entry.field].includes(entry.value))fail('CANDIDATE_UNSUPPORTED_INFERENCE');seen.add(entry.field);
   const source=value.descriptionSources[i];exact(source,['messageId','kind','actor','text']);const messageId='vision:'+value.id+':'+i;
   if(source.messageId!==messageId||source.kind!=='image_description'||source.actor!=='model'||source.text!==visualDescriptionText(entry.field,entry.value)||!equal(entry.sources,entry.value===null?[]:[{messageId,quote:source.text}]))fail('CANDIDATE_INVALID');
  });
  try{validateDesignPilotResult(value.candidate,withDescriptions(checked,value));}catch{fail('CANDIDATE_INVALID');}
 }
 if(Buffer.byteLength(canonical(value))>262144)fail('CANDIDATE_LIMIT');return freeze(clone(value));
}
/** Caller MUST load candidate from a scoped immutable server repository and freshly authorize it.
 * This function neither trusts a browser object nor changes authority/confirmation policy.
 */
export function applyTrustedDesignCandidate({session,candidate,selectedIndices,requestId}){
 const value=validateDesignCandidate(candidate,session);if(!id(requestId)||!Array.isArray(selectedIndices)||!selectedIndices.length||selectedIndices.length>100||new Set(selectedIndices).size!==selectedIndices.length||selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=value.candidate.entries.length))fail('CANDIDATE_SELECTION_INVALID');
 let next=context(session);const selected=[...selectedIndices].sort((a,b)=>a-b);
 for(const i of selected){
  const source=value.descriptionSources[i];if(source)next=appendDesignEvent(next,{requestId:requestId+'-source-'+i,expectedRevision:next.revision,scope:next.scope,event:{type:'source_recorded',source}}).session;
  next=appendDesignEvent(next,{requestId:requestId+'-entry-'+i,expectedRevision:next.revision,scope:next.scope,event:{type:'entry_recorded',entry:value.candidate.entries[i]}}).session;
 }
 return freeze({session:next,acceptedReceipt:{candidateId:value.id,kind:value.kind,candidateDigest:designCandidateDigest(value),inputDigest:value.inputDigest,baseRevision:value.baseRevision,resultRevision:next.revision,selectedIndices:selected,sourceRefs:clone(value.sourceRefs)}});
}
/** Strict finite visual output, with no free-form personal-attribute inference channel. */
export function buildVisualCandidateParts({id:candidateId,session,observations}){
 const checked=context(session);if(!id(candidateId)||checked.phase!=='before_analysis'||!Array.isArray(observations)||observations.length>2)fail('CANDIDATE_INVALID');
 const latest=getDesignView(checked).entries,descriptionSources=[],entries=[];const seen=new Set();
 observations.forEach((o,i)=>{exact(o,['field','value']);if(!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))fail('CANDIDATE_UNSUPPORTED_INFERENCE');seen.add(o.field);
 const source={messageId:'vision:'+candidateId+':'+i,kind:'image_description',actor:'model',text:visualDescriptionText(o.field,o.value)};descriptionSources.push(source);
 entries.push({id:'vision-entry:'+candidateId+':'+i,category:'person_style',field:o.field,zone:null,groupId:null,service:null,side:null,track:'context',origin:'extraction',basis:'observable',value:o.value,status:o.value===null?'unknown':'not_confirmed',sources:o.value===null?[]:[{messageId:source.messageId,quote:source.text}],replacesEntryId:latest.find(e=>e.category==='person_style'&&e.field===o.field)?.id??null});
 });
 return freeze({descriptionSources,candidate:{phase:checked.phase,entries,questions:[],warnings:['模型视觉描述仅供员工核对，不是测量或事实。']}});
}

export const DESIGN_COMPARISON_CHANGES=Object.freeze(['发型外轮廓看起来有变化','卷曲形态看起来更明显','卷曲形态看起来较不明显','未见明确外观变化']);
export const DESIGN_COMPARISON_REASONS=Object.freeze(['遮挡影响比较','清晰度不足','姿态或取景差异','光线差异','无法确定可比性']);
export const DESIGN_COMPARISON_OUTPUTS=freeze([...DESIGN_COMPARISON_CHANGES.map(change=>({comparability:'comparable',reason:null,change})),...DESIGN_COMPARISON_REASONS.map(reason=>({comparability:'not_comparable',reason,change:null}))]);
export function comparisonDescription(output){return '模型完成照视觉判断，未确认、非测量或执行事实：'+(output.comparability==='comparable'?output.change:'无法比较：'+output.reason)+'。不证明达标或操作因果。';}
export function buildCompletionCandidateParts({id:candidateId,session,output,angle}){
 const checked=context(session);exact(output,['comparability','reason','change']);if(!['front','back','left','right'].includes(angle)||!id(candidateId)||checked.phase!=='completed_review'||!DESIGN_COMPARISON_OUTPUTS.some(o=>equal(o,output)))fail('CANDIDATE_UNSUPPORTED_INFERENCE');
 const text=comparisonDescription(output),source={messageId:'comparison:'+candidateId+':0',kind:'image_description',actor:'model',text};
 const previous=getDesignView(checked).entries.filter(e=>e.category==='result_review'&&e.field==='model_photo_comparison_'+angle&&e.zone===null&&e.track==='actual').at(-1);
 return freeze({descriptionSources:[source],candidate:{phase:checked.phase,entries:[{id:'comparison-entry:'+candidateId+':0',category:'result_review',field:'model_photo_comparison_'+angle,zone:null,groupId:null,service:null,side:null,track:'actual',origin:'extraction',basis:'observable',value:text,status:'not_confirmed',sources:[{messageId:source.messageId,quote:text}],replacesEntryId:previous?.id??null}],questions:[],warnings:['模型完成照视觉判断仅供员工复核，未确认；actual仅指完成后复盘，不证明实际操作、达标或因果。']}});
}

export const DESIGN_SYNTHESIS_ASSESSMENTS=Object.freeze(['limited_evidence','potential_conflict','consistent_judgments','mixed_judgments']);
function synthesisFacts(side,evidence,reviewFocus){
 const angles=['front','back',side],missingAngles=angles.filter(a=>!evidence.some(e=>e.angle===a)),uncomparableAngles=evidence.filter(e=>e.judgment.comparability==='not_comparable').map(e=>e.angle);
 const up=evidence.filter(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[1]),down=evidence.filter(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[2]);
 const conflictingAngles=up.length&&down.length?evidence.filter(e=>[DESIGN_COMPARISON_CHANGES[1],DESIGN_COMPARISON_CHANGES[2]].includes(e.judgment.change)).map(e=>e.angle):[];
 const assessment=missingAngles.length||uncomparableAngles.length?'limited_evidence':conflictingAngles.length?'potential_conflict':new Set(evidence.map(e=>e.judgment.change)).size===1?'consistent_judgments':'mixed_judgments';
 const base={side,evidence,missingAngles,uncomparableAngles,conflictingAngles,assessment},choices=designSynthesisReviewChoices(base),generation=choices.length>1?'model_review_focus':'deterministic';
 return {...base,generation,reviewFocus:reviewFocus===undefined?(choices[0]??null):reviewFocus};
}
function validateSynthesisShape(value,session){
 exact(value,['side','evidence','missingAngles','uncomparableAngles','conflictingAngles','assessment','generation','reviewFocus']);
 if(session.phase!=='completed_review'||!['left','right'].includes(value.side)||!Array.isArray(value.evidence)||value.evidence.length<1||value.evidence.length>3)fail('CANDIDATE_INVALID');
 const angles=['front','back',value.side],latest=getDesignView(session).entries,seen=new Set();let prior=-1;
 for(const e of value.evidence){
  exact(e,['candidateId','candidateDigest','angle','entryId','acceptanceRequestId','entryStatus','judgment']);const at=angles.indexOf(e.angle);
  if(at<=prior||!id(e.candidateId)||!sha(e.candidateDigest)||!id(e.acceptanceRequestId)||e.entryId!=='comparison-entry:'+e.candidateId+':0'||!['not_confirmed','confirmed'].includes(e.entryStatus)||seen.has(e.candidateId)||!DESIGN_COMPARISON_OUTPUTS.some(o=>equal(o,e.judgment)))fail('CANDIDATE_INVALID');prior=at;seen.add(e.candidateId);
  const entry=latest.find(x=>x.id===e.entryId),source=session.sources.find(x=>x.messageId==='comparison:'+e.candidateId+':0');
  if(!entry||entry.category!=='result_review'||entry.field!=='model_photo_comparison_'+e.angle||entry.origin!=='extraction'||entry.basis!=='observable'||entry.track!=='actual'||entry.status!==e.entryStatus||entry.value!==comparisonDescription(e.judgment)||source?.kind!=='image_description'||source.actor!=='model'||source.text!==entry.value||!equal(entry.sources,[{messageId:source.messageId,quote:source.text}]))fail('CANDIDATE_INVALID');
 }
 const choices=designSynthesisReviewChoices(value);if(choices.length? !choices.some(x=>equal(x,value.reviewFocus)):value.reviewFocus!==null)fail('CANDIDATE_INVALID');
 if(!equal(value,synthesisFacts(value.side,value.evidence,value.reviewFocus)))fail('CANDIDATE_UNSUPPORTED_INFERENCE');return value;
}
/** Caller first validates the trusted workflow's complete modelCandidates history.
 * Only accepted comparison ancestors visible at this exact native prefix are selected.
 */
export function buildSynthesisEvidence({session,modelCandidates,side}){
 const checked=context(session);if(!['left','right'].includes(side)||checked.phase!=='completed_review'||!Array.isArray(modelCandidates)||modelCandidates.length>1000)fail('CANDIDATE_INVALID');
 const latest=getDesignView(checked).entries,evidence=[],sourceRefs=[];
 for(const angle of ['front','back',side]){
  const entry=latest.find(e=>e.category==='result_review'&&e.field==='model_photo_comparison_'+angle&&e.track==='actual'&&e.zone===null);if(!entry)continue;
  const rows=modelCandidates.filter(r=>r?.candidate?.kind==='completion_comparison'&&r.candidate.candidate?.entries?.[0]?.id===entry.id&&r.acceptance?.receipt?.resultRevision<=checked.revision);
  if(rows.length!==1)fail('CANDIDATE_INVALID');const row=rows[0],c=row.candidate,a=row.acceptance,receipt=a.receipt,judgment=DESIGN_COMPARISON_OUTPUTS.find(o=>comparisonDescription(o)===entry.value);
  if(!judgment||c.comparison.angle!==angle||c.sessionId!==checked.scope.sessionId||c.scope.customerProfileId!==checked.scope.customerId||c.scope.visitId!==checked.scope.visitId||receipt.candidateId!==c.id||receipt.kind!=='completion_comparison'||receipt.candidateDigest!==designCandidateDigest(c)||!equal(receipt.selectedIndices,[0])||!equal(receipt.sourceRefs,c.sourceRefs)||!Array.isArray(c.sourceRefs)||c.sourceRefs.length!==2)fail('CANDIDATE_INVALID');
  evidence.push({candidateId:c.id,candidateDigest:designCandidateDigest(c),angle,entryId:entry.id,acceptanceRequestId:a.requestId,entryStatus:entry.status,judgment:clone(judgment)});sourceRefs.push(...clone(c.sourceRefs));
 }
 const synthesis=synthesisFacts(side,evidence);validateSynthesisShape(synthesis,checked);return freeze({synthesis,sourceRefs});
}
export function validateSynthesisContext({synthesis,sourceRefs,session,modelCandidates}){
 validateSynthesisShape(synthesis,context(session));const expected=buildSynthesisEvidence({session,modelCandidates,side:synthesis.side});
 if(!equal({...synthesis,reviewFocus:expected.synthesis.reviewFocus},expected.synthesis)||!equal(sourceRefs,expected.sourceRefs))fail('CANDIDATE_INVALID');return true;
}
export function validateSynthesisEvidence({candidate,session,modelCandidates}){
 if(candidate.kind!=='completion_synthesis')return true;
 if(candidate.baseRevision!==session.revision)fail('CANDIDATE_INVALID');
 return validateSynthesisContext({synthesis:candidate.synthesis,sourceRefs:candidate.sourceRefs,session,modelCandidates});
}
export function designSynthesisReviewChoices(s){
 const choices=[];if(s.missingAngles.length)choices.push({kind:'missing_views',angles:[...s.missingAngles]});if(s.uncomparableAngles.length)choices.push({kind:'noncomparable_views',angles:[...s.uncomparableAngles]});if(s.conflictingAngles.length)choices.push({kind:'opposing_judgments',angles:[...s.conflictingAngles]});
 const comparable=s.evidence.filter(e=>e.judgment.comparability==='comparable');if(new Set(comparable.map(e=>e.judgment.change)).size>1)choices.push({kind:'cross_view_differences',angles:comparable.map(e=>e.angle)});
 for(const e of s.evidence.filter(e=>e.entryStatus==='not_confirmed'))choices.push({kind:'confirm_angle_judgment',angles:[e.angle]});
 if(!s.missingAngles.length&&!s.uncomparableAngles.length&&new Set(comparable.map(e=>e.judgment.change)).size===1)choices.push({kind:'capture_conditions',angles:s.evidence.map(e=>e.angle)});
 return freeze(choices);
}
export function buildSynthesisCandidateParts({id:candidateId,session,synthesis}){
 const checked=context(session);if(!id(candidateId))fail('CANDIDATE_INVALID');validateSynthesisShape(synthesis,checked);
 const labels={front:'正面',back:'背面',left:'左侧',right:'右侧'},status={limited_evidence:'证据不足，不能形成完整三视图结论',potential_conflict:'逐角度判断存在潜在冲突，需复核',consistent_judgments:'现有逐角度判断方向一致，不代表达标',mixed_judgments:'逐角度判断不一致，保留各自限制'};
 const focusLabels={missing_views:'请补齐缺失角度的比较依据',noncomparable_views:'请复核不可比较原因后补充依据',opposing_judgments:'请核查相反卷曲判断是否源于拍摄差异',cross_view_differences:'请分别核对不同角度的判断差异',confirm_angle_judgment:'请员工核对该角度尚未确认的原判断',capture_conditions:'请核查各角度拍摄条件是否足以比较'};
 const text=(synthesis.generation==='deterministic'?'服务器整理既有AI判断（未调用新模型，不是重新看图）：':'模型综合已采纳的逐角度AI判断（不是重新看图，未确认的综合推断）：')+synthesis.evidence.map(e=>labels[e.angle]+'：'+(e.judgment.change??'无法比较：'+e.judgment.reason)+'（'+(e.entryStatus==='confirmed'?'员工已确认该条':'该条未确认')+'）').join('；')+'。缺失角度：'+(synthesis.missingAngles.map(a=>labels[a]).join('、')||'无')+'；不可比较角度：'+(synthesis.uncomparableAngles.map(a=>labels[a]).join('、')||'无')+'；潜在冲突角度：'+(synthesis.conflictingAngles.map(a=>labels[a]).join('、')||'无')+'。'+status[synthesis.assessment]+'。优先复核：'+(synthesis.reviewFocus?focusLabels[synthesis.reviewFocus.kind]+'（'+synthesis.reviewFocus.angles.map(a=>labels[a]).join('、')+'）':'无额外复核重点')+'。仅覆盖所选'+labels[synthesis.side]+'，不代表另一侧；不证明操作、药水、测量、达标或因果。';
 const source={messageId:'synthesis:'+candidateId+':0',kind:synthesis.generation==='deterministic'?'server_synthesis':'model_synthesis',actor:synthesis.generation==='deterministic'?'system':'model',text},field='model_completion_synthesis_'+synthesis.side,previous=getDesignView(checked).entries.find(e=>e.category==='result_review'&&e.field===field&&e.track==='actual'&&e.zone===null);
 return freeze({descriptionSources:[source],candidate:{phase:checked.phase,entries:[{id:'synthesis-entry:'+candidateId+':0',category:'result_review',field,zone:null,groupId:null,service:null,side:null,track:'actual',origin:'suggestion',basis:'inferred',value:text,status:'not_confirmed',sources:[{messageId:source.messageId,quote:text}],replacesEntryId:previous?.id??null}],questions:[],warnings:['综合仅基于已采纳逐角度AI判断，不是重新查看照片；缺失、不可比和冲突限制不能被综合结论消除。']}});
}
