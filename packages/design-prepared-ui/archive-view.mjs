import {validateFullWorkflowHistoryView,validateFullWorkflowVersionView,validateLegacyArchiveView} from './workflow-view-contracts.mjs';
/** Shared read-only archive view. Native formats stay separate; no writes or image URLs. */
const copy=value=>JSON.parse(JSON.stringify(value));
const normalizedSnapshot='design-full-workflow-snapshot-v5',normalizedHistory='design-managed-image-history-v3';
const managedSnapshots=['design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4',normalizedSnapshot];
export const NORMALIZED_ARCHIVE_NOTICE='合成演练：固定夹具限定验证，mock 响应，未调用真实模型；采纳不等于员工确认，更不代表真实客户分析或实际操作。';
const scopeKeys=['customerProfileId','visitId','assignmentSource'];
const sameScope=(a,b)=>a&&b&&scopeKeys.every(k=>a[k]===b[k]);
const fail=()=>{throw Object.assign(new Error('ARCHIVE_VIEW_INVALID'),{code:'ARCHIVE_VIEW_INVALID'});};
export function archiveViewData({scope,legacyVersions=null,history=null,browserViews=false}={}){
 if(browserViews||history?.schemaVersion==='design-full-workflow-history-view-v1'){if(!scope||legacyVersions!==null&&(!Array.isArray(legacyVersions)||legacyVersions.length>1000))fail();if(history)validateFullWorkflowHistoryView(history,{scope});for(const row of legacyVersions||[])validateLegacyArchiveView(row,{scope});return copy({scope,legacyVersions,history,browserViews:true});}
 if(!scope||legacyVersions!==null&&(!Array.isArray(legacyVersions)||legacyVersions.length>1000))fail();
 for(const row of legacyVersions||[])if(!sameScope(row.scope,scope)||!row.snapshot||!Number.isSafeInteger(row.versionNumber))fail();
 if(history){if(!Array.isArray(history.versions)||history.versions.length>100||history.currentVersion!==history.versions.length||history.currentDigest!==(history.versions.at(-1)?.sha256??null))fail();
  history.versions.forEach((row,index)=>{if(row.version!==index+1||!sameScope(row.scope,scope)||!sameScope(row.snapshot?.scope,scope)||!['design-full-workflow-snapshot-v1','design-full-workflow-snapshot-v2','design-full-workflow-snapshot-v3','design-full-workflow-snapshot-v4',normalizedSnapshot].includes(row.snapshot?.schemaVersion))fail();if(row.snapshot.schemaVersion===normalizedSnapshot){if(row.snapshot.managedImageHistory?.schemaVersion!==normalizedHistory)fail();managedArchiveSummary(row.snapshot.managedImageHistory);}});}
 return copy({scope,legacyVersions,history});
}
// Display only. The authorized API still carries its full private snapshot;
// this projection must not be described as HTTP-level minimization.
export function managedArchiveSummary(history){
 if(!history||!['design-managed-image-history-v1','design-managed-image-history-v2',normalizedHistory].includes(history.schemaVersion)||!Array.isArray(history.inputs)||!Array.isArray(history.accepted)||history.inputs.length>1000||history.accepted.length>1000)fail();
 if(history.schemaVersion===normalizedHistory)return normalizedArchiveSummary(history);
 return {schemaVersion:history.schemaVersion,inputs:history.inputs.map(row=>({taskId:row.taskId,mediaId:row.sourceRecord?.mediaId,sourceVersion:row.sourceRecord?.object?.version,stage:row.sourceRecord?.stage,angle:row.sourceRecord?.angle,verificationState:row.verificationReport?.state})),accepted:history.accepted.map(row=>({candidateId:row.candidate?.id,kind:row.candidate?.kind,taskId:row.candidate?.imageBinding?.taskId,requestId:row.acceptance?.requestId,workflowRevision:row.acceptance?.workflowRevision,selectedIndices:row.acceptance?.receipt?.selectedIndices,descriptionSources:row.candidate?.descriptionSources,entries:row.candidate?.candidate?.entries,...(row.candidate?.schemaVersion==='design-managed-model-candidate-v2'?{evidenceSummary:managedArchiveEvidence(row.candidate,history.inputs)}:{})}))};
}
function managedArchiveEvidence(candidate,inputs){
 const binding=candidate.evidenceBinding;
 const image=v=>{const row=inputs.find(i=>i.taskId===v.taskId);if(!row)fail();return {taskId:v.taskId,mediaId:row.sourceRecord?.mediaId,stage:v.stage,angle:v.angle,sourceVersion:v.sourceObject?.version,derivativeVersion:v.derivativeObject?.version};};
 if(candidate.kind==='managed_before_view')return {view:image(binding.images[0])};
 if(candidate.kind==='managed_completion_comparison')return {before:image(binding.images[0]),after:image(binding.images[1]),angle:binding.angle,judgment:copy(candidate.result.judgment)};
 if(candidate.kind!=='managed_completion_synthesis')fail();
 return {side:binding.side,generation:binding.generation,evidence:binding.ancestors.map(e=>({candidateId:e.candidateId,angle:e.angle,entryId:e.entryId,entryStatus:e.entryStatus,judgment:copy(e.judgment)})),missingAngles:copy(binding.missingAngles),uncomparableAngles:copy(binding.uncomparableAngles),conflictingAngles:copy(binding.conflictingAngles),confirmedAngles:copy(binding.confirmedAngles),unconfirmedAngles:copy(binding.unconfirmedAngles),assessment:binding.assessment,reviewFocus:copy(candidate.result.reviewFocus)};
}
// This is deliberately a display projection, not task/report validation or
// authorization. Trusted server validation and fresh repository checks remain
// mandatory. Unknown private fields are never recursively copied into v5 UI.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const label=(value,max=160)=>{if(typeof value!=='string'||!value||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail();return value;};
const version=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(value))fail();return value;};
function safeSources(sources){if(!Array.isArray(sources)||sources.length>100)fail();return sources.map(s=>({messageId:label(s.messageId),kind:label(s.kind,80),actor:label(s.actor,80),text:label(s.text,12000)}));}
function safeEntries(entries){if(!Array.isArray(entries)||entries.length>100)fail();return entries.map(e=>{const out=pick(e,['id','category','field','zone','groupId','service','side','track','origin','basis','value','status','replacesEntryId']);if(Object.values(out).some(v=>v!==null&&!['string','number'].includes(typeof v))||!['unknown','not_confirmed'].includes(out.status)||!Array.isArray(e.sources)||e.sources.length>12)fail();out.sources=e.sources.map(s=>({messageId:label(s.messageId),quote:label(s.quote,12000)}));return out;});}
function normalizedArchiveSummary(history){
 if(history.inputs.length>300)fail();const tasks=new Map();
 const inputs=history.inputs.map(row=>{if(!row||typeof row!=='object'||tasks.has(row.taskId))fail();tasks.set(row.taskId,row);
  if(!Object.hasOwn(row,'task'))return {taskId:row.taskId,mediaId:row.sourceRecord?.mediaId,sourceVersion:row.sourceRecord?.object?.version,stage:row.sourceRecord?.stage,angle:row.sourceRecord?.angle,verificationState:row.verificationReport?.state};
  const t=row.task,a=t?.claimedArtifact?.artifact,s=a?.sourceRecord;if(t?.schemaVersion!=='design-normalized-strict-task-v1'||t.taskId!==row.taskId||row.report?.schemaVersion!=='design-normalized-strict-report-v1'||row.report.state!=='evidence_complete'||s?.stage!=='before'||!['front','back','left','right'].includes(s.angle))fail();
  return {taskId:label(row.taskId,100),mediaId:label(s.mediaId,100),sourceVersion:version(s.object?.version),parentVersion:version(a.parentObjectReceipt?.object?.version),normalizedVersion:version(t.objectReceipt?.object?.version),stage:s.stage,angle:s.angle,verificationState:row.report.state,qualification:'synthetic_pinned_producer_only',synthetic:true,notice:NORMALIZED_ARCHIVE_NOTICE};
 });
 const accepted=history.accepted.map(row=>{const c=row?.candidate,a=row?.acceptance;if(!c||!a||!Array.isArray(a.receipt?.selectedIndices)||a.receipt.selectedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>99))fail();
  const out={candidateId:label(c.id,80),kind:label(c.kind,80),requestId:label(a.requestId,100),workflowRevision:a.workflowRevision,selectedIndices:[...a.receipt.selectedIndices],descriptionSources:safeSources(c.descriptionSources),entries:safeEntries(c.candidate?.entries)};
  if(c.schemaVersion==='design-managed-model-candidate-v4'){
   const input=c.normalizedBinding?.input,task=tasks.get(input?.taskId);if(c.kind!=='managed_normalized_before_view'||c.generation!=='synthetic_mock_model'||!task?.task||input.stage!=='before'||input.angle!==task.task.claimedArtifact.artifact.sourceRecord.angle||out.entries.length<1||out.entries.length>2||out.descriptionSources.some(s=>s.kind!=='synthetic_image_description'||s.actor!=='system'||!s.text.startsWith('合成演练，mock 响应，未调用真实模型；'))||out.entries.some(e=>e.track!=='context'||e.category!=='person_style'||e.origin!=='extraction'||e.basis!=='observable'||!['managed_before_outline_'+input.angle,'managed_before_hair_shape_'+input.angle].includes(e.field)))fail();
   return {...out,taskId:label(input.taskId,100),generation:'synthetic_mock_model',synthetic:true,notice:NORMALIZED_ARCHIVE_NOTICE};
  }
  if(c.schemaVersion==='design-managed-model-candidate-v1')return {...out,taskId:c.imageBinding?.taskId};
  if(c.schemaVersion==='design-managed-model-candidate-v2')return {...out,evidenceSummary:managedArchiveEvidence(c,history.inputs)};
  fail();
 });
 if(!accepted.some(r=>r.synthetic===true))fail();return {schemaVersion:history.schemaVersion,notice:NORMALIZED_ARCHIVE_NOTICE,inputs,accepted};
}
export function archiveDisplayVersion(row){
 if(!managedSnapshots.includes(row.snapshot?.schemaVersion)){if(!['design-full-workflow-snapshot-v1','design-full-workflow-snapshot-v2'].includes(row.snapshot?.schemaVersion))fail();return copy(row);}
 if(row.snapshot.schemaVersion!==normalizedSnapshot){const snapshot={...row.snapshot,managedImageHistory:managedArchiveSummary(row.snapshot.managedImageHistory)};return copy({...row,snapshot});}
 if(row.snapshot.managedImageHistory?.schemaVersion!==normalizedHistory)fail();
 const snapshot={...pick(row.snapshot,['schemaVersion','mappingPolicy','scope','store','bindings','ui','evidence','legacyVersions','photoRefs','modelCandidates','index','sha256']),managedImageHistory:managedArchiveSummary(row.snapshot.managedImageHistory)};
 return copy({...pick(row,['schemaVersion','version','previous','scope','actor','requestId','createdAt','bindingRevision','sha256']),snapshot});
}

const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
function exact(parent,label,value){const d=node('details'),s=node('summary',label);d.append(s);let rendered=false;d.addEventListener('toggle',()=>{if(d.open&&!rendered){rendered=true;const pre=node('pre',JSON.stringify(value,null,2));pre.dataset.archiveExact='';d.append(pre);}});parent.append(d);return d;}
function legacy(parent,row){const d=node('details');d.dataset.legacyVersion=row.id;d.append(node('summary',`旧格式 · 版本 ${row.versionNumber} · ${row.createdAt||'时间未提供'}`));d.append(node('p',`原作者 ${row.actor?.username||'未提供'}；旧格式原样只读，不推断计划、实际或员工确认。`));let hydrated=false;d.addEventListener('toggle',()=>{if(!d.open||hydrated)return;hydrated=true;const snapshot=row.snapshot;
 for(const [key,label] of [['baseline','初始判断'],['optimized','优化设计'],['reasons','调整理由'],['execution','六区执行'],['process','流程'],['review','复盘'],['photo_ids','旧照片引用']])if(Object.hasOwn(snapshot,key))exact(d,label,snapshot[key]);
 exact(d,'完整旧版本原结构（所有字段）',row);});parent.append(d);
}
function full(parent,row){const d=node('details');d.dataset.fullVersion=String(row.version);d.append(node('summary',`完整格式 · 版本 ${row.version} · ${row.createdAt||'时间未提供'}`));d.append(node('p',`父版本 ${row.previous?.version??'无'}；保存员工 ${row.actor?.username||'未提供'}。不同格式并列保存，不写回旧档案字段。`));let hydrated=false;d.addEventListener('toggle',()=>{if(!d.open||hydrated)return;hydrated=true;const snapshot=row.snapshot,session=snapshot.evidence?.session;
 if(snapshot.managedImageHistory){if(snapshot.schemaVersion===normalizedSnapshot)d.append(node('p',NORMALIZED_ARCHIVE_NOTICE));d.append(node('p','托管图片模型来源独立保留；采纳不等于员工确认，不改变旧照片引用。这里仅展示安全摘要，不展开私有存储路径或完整内部证明。'));exact(d,'托管图片来源与采纳摘要',managedArchiveSummary(snapshot.managedImageHistory));}
 if(snapshot.modelCandidates)exact(d,'模型候选与采纳证据（独立来源类型）',snapshot.modelCandidates);
 if(session){exact(d,'原话、转写及来源身份（原样）',session.sources);const entries=node('section');entries.append(node('h4','原生条目历史（含被替代条目）：多组、左右、计划 / 实际及确认'));
 for(const entry of session.entries||[]){const card=node('article');card.dataset.archiveEntry=entry.id;card.append(node('p',`${entry.zone??entry.category} / ${entry.groupId??'无工艺组'} / ${entry.service??'不适用'} / ${entry.side??'不适用'} / ${entry.track} / ${entry.field}`));card.append(node('pre',entry.value===null?'未知（null）':typeof entry.value==='string'?entry.value:JSON.stringify(entry.value)));card.append(node('p',`状态：${entry.status}；来源类型：${entry.origin}。按原记录展示，不重新判定或代为确认。`));exact(card,'逐字来源与完整条目',entry);entries.append(card);}d.append(entries);exact(d,'完整原生证据与历史检查点',snapshot.evidence);}
 if(snapshot.ui)exact(d,'合成 UI 投影（独立格式，非真实业务记录）',snapshot.ui);
 exact(d,'照片引用（不自动读取图片）',snapshot.photoRefs);
 for(const old of snapshot.legacyVersions||[])legacy(d,old);
 exact(d,managedSnapshots.includes(snapshot.schemaVersion)?'版本展示结构（托管私有谱系已替换为摘要，非原始完整性校验输入）':'完整版本原结构（包含全部字段、历史及完整性摘要）',archiveDisplayVersion(row));});parent.append(d);
}
function safeLegacy(parent,row){if(row.schemaVersion!=='design-legacy-archive-view-v1')fail();const d=node('details');d.dataset.legacyVersion=row.id;d.append(node('summary',`旧档展示 · 版本 ${row.versionNumber}`));d.append(node('p',`原作者 ${row.authorLabel}；服务端保留原档，此处仅安全展示。`));exact(d,'旧档安全内容',row.content);parent.append(d);}
function safeFull(parent,row){validateFullWorkflowVersionView(row,{scope:row.scope});const d=node('details');d.dataset.fullVersion=String(row.version);d.append(node('summary',`完整档案展示 · 版本 ${row.version}`));d.append(node('p',`保存员工 ${row.authorLabel}；父版本 ${row.previous?.version??'无'}。这是服务端展示视图，不是原始完整档案。`));exact(d,'原生来源、条目与修订',row.snapshot.evidence);exact(d,'已采纳候选安全摘要',row.snapshot.acceptedCandidates);exact(d,'图像来源安全摘要',row.snapshot.managedInputs);for(const old of row.snapshot.legacyVersions)safeLegacy(d,old);exact(d,'版本展示结构（不可用作完整性验证或保存请求）',row);parent.append(d);}
export function renderArchiveVersions(container,value){const data=archiveViewData(value);if(data.browserViews){container.replaceChildren();container.classList.add('apw-archive-view');container.append(node('h3','档案安全展示 · 原始资料留存服务端'));container.append(node('p','展示视图不是原始完整档案，也不携带私有路径、密钥或验证证明。采纳不代表员工确认或实际执行。'));for(const row of data.legacyVersions||[])safeLegacy(container,row);for(const row of data.history?.versions||[])safeFull(container,row);return;}container.replaceChildren();container.classList.add('apw-archive-view');container.append(node('h3','旧 / 新档案 · 只读原格式'));container.append(node('p','这里不转换或覆盖历史。原始字段、来源、左右、计划 / 实际、确认、照片引用与父版本分别保留。摘要不能代替完整原结构；摘要校验不是授权或用户签名。'));
 const old=node('section');old.dataset.legacyHistory='';old.append(node('h4',data.legacyVersions===null?'旧格式历史由上方原档案展示':`旧格式历史 ${data.legacyVersions.length} 版`));for(const row of data.legacyVersions||[])legacy(old,row);container.append(old);
 const newer=node('section');newer.dataset.fullHistory='';newer.append(node('h4',data.history?`完整格式历史 ${data.history.versions.length} 版`:'完整格式尚未读取'));for(const row of data.history?.versions||[])full(newer,row);container.append(newer);return data;
}
