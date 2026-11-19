/**
 * Strict synthetic UI projection bridge, NOT the event/model extraction contract.
 * No network, storage, identity decisions, images, credentials or model calls.
 */
export const UI_DRAFT_SCHEMA = 'design-pilot-ui-draft-v1';
export const UI_STATE_SCHEMA = 'design-pilot-ui-state-v1';
export const UI_ZONES = Object.freeze(['bangs','top','ear_front','ear_back','middle','bottom']);
export const UI_BASIC_FIELDS = Object.freeze(['style','person','length','features','layers','bangs','curls']);
export const UI_ZONE_FIELDS = Object.freeze(['goal','action','direction']);
export const UI_PERM_FIELDS = Object.freeze(['placement','rods','method','direction','products','mix','application','softening']);
export const UI_DYE_FIELDS = Object.freeze(['placement','colors','products','ratios','regions','application']);
export const UI_REVIEW_FIELDS = Object.freeze(['achieved','pending','next']);
export const UI_FIXTURE_TEXT = Object.freeze({
  sample: '【固定虚构示例，不来自照片识别】\n模拟顾客希望保留长度，整体简洁，脸周柔和。刘海区向后，顶区向上，耳前区向后。耳后区、中区、底区的方向未确认。今天拟剪发并讨论烫发，不做染发。杠具、卷杠方法、产品、配比、上药位置和软化控制均待现场确认。',
  quote: '模拟顾客希望保留长度，整体简洁，脸周柔和。',
  directions: '刘海区向后，顶区向上，耳前区向后。',
  style: '简洁；脸周柔和', styleB: '【合成测试】风格意向改为轻盈自然', length: '保留长度',
  proposal: '先与模拟顾客确认“简洁、脸周柔和”的具体含义，再按六区逐项确认方案。未提供的技术参数保持空白。',
  proposalB: '【合成测试】保留原方案，重新逐区核对；这不是实际操作或模型建议。',
  transcript: '【合成测试】模拟口述希望保留长度，其他内容待本人核对。',
  alternateText: '【合成测试】模拟散客讨论剪染方案，不代表真实顾客需求。',
  person: '【合成测试】只记录可见轮廓，不从外貌推断性格。',
  features: '【合成测试】脸周线条柔和', layers: '【合成测试】层次待讨论', bangs: '【合成测试】刘海保留', curls: '【合成测试】卷度待现场确认',
  left: '【合成测试】左侧', right: '【合成测试】右侧', center: '【合成测试】中间', bilateral: '【合成测试】双侧，需分别核对',
  rodA: '【合成测试】虚构杠具A', rodB: '【合成测试】虚构杠具B',
  methodA: '【合成测试】虚构卷法A', methodB: '【合成测试】虚构卷法B',
  productA: '【合成测试】虚构产品A', productB: '【合成测试】虚构产品B',
  formulaA: '【合成测试】虚构配方A，非操作建议', formulaB: '【合成测试】虚构配方B，非操作建议',
  application: '【合成测试】施作位置待现场确认', softening: '【合成测试】软化条件未确认',
  colorA: '【合成测试】虚构色号A', colorB: '【合成测试】虚构色号B',
  goal: '【合成测试】保留本区轮廓', action: '【合成测试】本区操作仅作模拟记录',
  achieved: '【合成测试】仅并排查看示意素材，未验证真实效果',
  pending: '【合成测试】仍需本人核对', next: '【合成测试】下一次继续补充',
  care: '【合成测试】完成后整理方式由本人填写，未生成护理结论',
  revisionReason: '【合成测试】追加关联修订，保留旧版本及来源。',
});
export const UI_SIDE_NOTES = Object.freeze([
  '侧面标签有匹配；拍摄距离、角度和光线仍需本人核对。',
  '侧面标签不一致：一组为左侧，另一组为右侧。请补齐同侧素材，当前不能做同角度侧面对照。',
]);
export const UI_FIXTURE_TEXTS = Object.freeze([...new Set(['', ...Object.values(UI_FIXTURE_TEXT), 'forward','backward','up','down','待确认','向前 · 朝脸','向后 · 离脸','向上','向下'])]);
const TEXT_SET = new Set(UI_FIXTURE_TEXTS);
/** Field-address allowlist shared by the UI catalogue and server validator. */
export function getUIFieldOptions(fieldPath) {
  const parts=String(fieldPath).split('.'),field=parts.at(-1),root=parts[0];
  let values;
  if(root==='basic')values={style:[UI_FIXTURE_TEXT.style,UI_FIXTURE_TEXT.styleB],person:[UI_FIXTURE_TEXT.person],length:[UI_FIXTURE_TEXT.length],features:[UI_FIXTURE_TEXT.features],layers:[UI_FIXTURE_TEXT.layers],bangs:[UI_FIXTURE_TEXT.bangs],curls:[UI_FIXTURE_TEXT.curls]}[field];
  else if(fieldPath==='proposal')values=[UI_FIXTURE_TEXT.proposal,UI_FIXTURE_TEXT.proposalB];
  else if(fieldPath==='care')values=[UI_FIXTURE_TEXT.care];
  else if(root==='zones')values={goal:[UI_FIXTURE_TEXT.goal],action:[UI_FIXTURE_TEXT.action],direction:['forward','backward','up','down']}[field];
  else if(root==='review')values={achieved:[UI_FIXTURE_TEXT.achieved],pending:[UI_FIXTURE_TEXT.pending],next:[UI_FIXTURE_TEXT.next]}[field];
  else if(['perm','dye','zoneProcesses'].includes(root))values={
    placement:[UI_FIXTURE_TEXT.left,UI_FIXTURE_TEXT.right,UI_FIXTURE_TEXT.center,UI_FIXTURE_TEXT.bilateral],rods:[UI_FIXTURE_TEXT.rodA,UI_FIXTURE_TEXT.rodB],method:[UI_FIXTURE_TEXT.methodA,UI_FIXTURE_TEXT.methodB],
    direction:['向前 · 朝脸','向后 · 离脸','向上','向下'],products:[UI_FIXTURE_TEXT.productA,UI_FIXTURE_TEXT.productB],mix:[UI_FIXTURE_TEXT.formulaA,UI_FIXTURE_TEXT.formulaB],application:[UI_FIXTURE_TEXT.application],softening:[UI_FIXTURE_TEXT.softening],
    colors:[UI_FIXTURE_TEXT.colorA,UI_FIXTURE_TEXT.colorB],ratios:[UI_FIXTURE_TEXT.formulaA,UI_FIXTURE_TEXT.formulaB],regions:[UI_FIXTURE_TEXT.left,UI_FIXTURE_TEXT.right,UI_FIXTURE_TEXT.bilateral],
  }[field];
  check(values,'UI_INVALID_FIELDS','Unknown UI field path');return Object.freeze(['',...values]);
}
export function getUIDraftCatalogue(){return freeze({schemaVersion:UI_DRAFT_SCHEMA,fixtureText:UI_FIXTURE_TEXT,fixtureTexts:UI_FIXTURE_TEXTS,
  fieldOptions:{basic:Object.fromEntries(UI_BASIC_FIELDS.map(key=>[key,getUIFieldOptions('basic.'+key)])),proposal:getUIFieldOptions('proposal'),care:getUIFieldOptions('care'),
    zones:Object.fromEntries(UI_ZONE_FIELDS.map(key=>[key,getUIFieldOptions('zones.bangs.'+key)])),perm:Object.fromEntries(UI_PERM_FIELDS.map(key=>[key,getUIFieldOptions('perm.'+key)])),dye:Object.fromEntries(UI_DYE_FIELDS.map(key=>[key,getUIFieldOptions('dye.'+key)])),review:Object.fromEntries(UI_REVIEW_FIELDS.map(key=>[key,getUIFieldOptions('review.'+key)]))},emptyDraft:createUIDraftPayload()});}
const PHASES = ['planned','actual'];
const TRACK_KEYS = ['value','original','origin','confirmed','phase','edited'];
const DRAFT_KEYS = ['schemaVersion','synthetic','step','selectedZone','text','transcript','photos','side','basic','proposal','care','zones','zoneProcesses','services','perm','dye','review','materialRevision','designRevision','analysis','comparison','demoLoaded'];
const STATE_KEYS = ['schemaVersion','scope','revision','status','draft','history'];
const MAX_HISTORY = 100;
export class UIDraftError extends Error { constructor(code,message) { super(message);this.name='UIDraftError';this.code=code; } }
function check(value,code,message) { if(!value) throw new UIDraftError(code,message); }
function plain(value) { return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype; }
function exact(value,expected,label) { check(plain(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|'),'UI_INVALID_FIELDS',`${label} contains missing or unsupported fields`); }
function bool(value,label) { check(typeof value==='boolean','UI_INVALID_VALUE',`${label} must be boolean`); }
function integer(value,label,max=1000000) { check(Number.isSafeInteger(value)&&value>=0&&value<=max,'UI_INVALID_VALUE',`${label} is outside the bounded integer range`); }
function enumeration(value,allowed,label) { check(allowed.includes(value),'UI_INVALID_VALUE',`${label} is unsupported`); }
function identifier(value,label) { check(typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value),'UI_INVALID_ID',`${label} must be a fixture identifier`); }
function fixedText(value,label) { check(typeof value==='string'&&TEXT_SET.has(value),'UI_SYNTHETIC_TEXT_ONLY',`${label} must use a fixed synthetic catalogue value; no free text, URLs, files or credentials`); }
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
function canonical(value) {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  check(plain(value),'UI_INVALID_VALUE','Only plain JSON values are supported');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const clone=value=>JSON.parse(canonical(value));
function scope(value) { exact(value,['customerId','visitId','sessionId'],'scope');Object.entries(value).forEach(([key,item])=>identifier(item,key));return clone(value); }
function sameScope(a,b) { scope(b);check(canonical(a)===canonical(b),'SCOPE_MISMATCH','UI scope must match customer, visit and session exactly'); }
function blankRecord(phase='planned') { return {value:'',original:'',origin:'manual',confirmed:false,phase,edited:false,tracks:{planned:null,actual:null}}; }
const blankFields=(fields,phase)=>Object.fromEntries(fields.map(field=>[field,blankRecord(phase)]));
export function createUIDraftPayload() {
  return freeze({schemaVersion:UI_DRAFT_SCHEMA,synthetic:true,step:0,selectedZone:'bangs',text:'',transcript:'',photos:{before:[],after:[]},side:{before:'left',after:'left'},
    basic:blankFields(UI_BASIC_FIELDS,'context'),proposal:blankRecord(),care:blankRecord('actual'),zones:Object.fromEntries(UI_ZONES.map(zone=>[zone,blankFields(UI_ZONE_FIELDS)])),
    zoneProcesses:Object.fromEntries(UI_ZONES.map(zone=>[zone,{perm:[],dye:[]}])),services:{cut:true,perm:false,dye:false},perm:blankFields(UI_PERM_FIELDS),dye:blankFields(UI_DYE_FIELDS),review:blankFields(UI_REVIEW_FIELDS,'actual'),
    materialRevision:0,designRevision:0,analysis:null,comparison:null,demoLoaded:false});
}
export function createUIProcessGroup(service) { enumeration(service,['perm','dye'],'service');return freeze(blankFields(service==='perm'?UI_PERM_FIELDS:UI_DYE_FIELDS)); }
function track(value,phase,label,options) {
  exact(value,TRACK_KEYS,label);fixedText(value.value,label+'.value');fixedText(value.original,label+'.original');
  enumeration(value.value,options,label+'.value');
  enumeration(value.original,[...options,UI_FIXTURE_TEXT.quote,UI_FIXTURE_TEXT.directions,'向前 · 朝脸','向后 · 离脸','向上','向下'],label+'.original');
  enumeration(value.origin,['manual','demo_extract','demo_suggest'],label+'.origin');enumeration(value.phase,phase,label+'.phase');
  bool(value.confirmed,label+'.confirmed');bool(value.edited,label+'.edited');
  check(!value.confirmed||(Boolean(value.value)&&Boolean(value.original)),'UI_INVALID_CONFIRMATION','An empty or unsourced field cannot be confirmed');
  if(value.origin==='demo_extract'&&!value.edited&&value.value) {
    check((value.original===UI_FIXTURE_TEXT.quote&&[UI_FIXTURE_TEXT.style,UI_FIXTURE_TEXT.length].includes(value.value))||
      (value.original===UI_FIXTURE_TEXT.directions&&['backward','up'].includes(value.value)),'UI_INVALID_PROVENANCE','Unedited demo extraction must match the fixed example');
  }
  if(value.origin==='demo_suggest'&&!value.edited&&value.value) check(value.value===UI_FIXTURE_TEXT.proposal&&value.original===UI_FIXTURE_TEXT.quote,'UI_INVALID_PROVENANCE','Unedited demo suggestion must match the fixed example');
}
function record(value,phase,label) {
  exact(value,[...TRACK_KEYS,'tracks'],label);const current={};for(const key of TRACK_KEYS)current[key]=value[key];const options=getUIFieldOptions(label);track(current,phase,label,options);
  exact(value.tracks,PHASES,label+'.tracks');
  for(const key of PHASES) if(value.tracks[key]!==null){
    check(phase.length>1,'UI_INVALID_TRACK','Context/completed observations cannot contain hidden alternate tracks');
    track(value.tracks[key],[key],label+'.tracks.'+key,options);
  }
}
function fields(value,names,phase,label) { exact(value,names,label);for(const key of names)record(value[key],phase,label+'.'+key); }
function photoCoverage(photos) { return photos.some(p=>p.angle==='front')&&photos.some(p=>p.angle==='back')&&photos.some(p=>['left','right'].includes(p.angle)); }
/** Strict allowlist: photo metadata is only for built-in synthetic illustrations. */
export function validateUIDraftPayload(value) {
  exact(value,DRAFT_KEYS,'UI draft');check(value.schemaVersion===UI_DRAFT_SCHEMA&&value.synthetic===true,'UI_SCHEMA_MISMATCH','Only the synthetic UI projection schema is supported');
  integer(value.step,'step',4);enumeration(value.selectedZone,UI_ZONES,'selectedZone');fixedText(value.text,'text');fixedText(value.transcript,'transcript');bool(value.demoLoaded,'demoLoaded');
  integer(value.materialRevision,'materialRevision');integer(value.designRevision,'designRevision');check(value.designRevision>=value.materialRevision,'UI_INVALID_REVISION','Design counter cannot precede material counter');
  fields(value.basic,UI_BASIC_FIELDS,['context'],'basic');record(value.proposal,PHASES,'proposal');record(value.care,['actual'],'care');
  exact(value.zones,UI_ZONES,'zones');exact(value.zoneProcesses,UI_ZONES,'zoneProcesses');
  for(const zone of UI_ZONES){
    fields(value.zones[zone],UI_ZONE_FIELDS,PHASES,'zones.'+zone);
    const direction=value.zones[zone].direction;for(const item of [direction,...Object.values(direction.tracks).filter(Boolean)])enumeration(item.value,['','forward','backward','up','down'],'zone direction');
    exact(value.zoneProcesses[zone],['perm','dye'],'zoneProcesses.'+zone);
    for(const service of ['perm','dye']){
      const groups=value.zoneProcesses[zone][service];check(Array.isArray(groups)&&groups.length<=8,'UI_GROUP_LIMIT','At most eight groups per zone/service');
      groups.forEach((group,index)=>fields(group,service==='perm'?UI_PERM_FIELDS:UI_DYE_FIELDS,PHASES,`zoneProcesses.${zone}.${service}.${index}`));
    }
  }
  exact(value.services,['cut','perm','dye'],'services');Object.entries(value.services).forEach(([key,item])=>bool(item,'services.'+key));
  fields(value.perm,UI_PERM_FIELDS,PHASES,'perm');fields(value.dye,UI_DYE_FIELDS,PHASES,'dye');fields(value.review,UI_REVIEW_FIELDS,['actual'],'review');
  exact(value.photos,['before','after'],'photos');exact(value.side,['before','after'],'side');const photoIds=new Set();
  for(const stage of ['before','after']){
    enumeration(value.side[stage],['left','right'],'photo side');check(Array.isArray(value.photos[stage])&&value.photos[stage].length<=12,'UI_PHOTO_LIMIT','At most twelve synthetic metadata items per stage');
    const counts={front:0,back:0,side:0};
    for(const photo of value.photos[stage]){
      exact(photo,['id','kind','angle'],'photo metadata');integer(photo.id,'photo.id');check(photo.id>0&&!photoIds.has(photo.id),'UI_PHOTO_ID','Photo identifiers must be positive and unique across stages');photoIds.add(photo.id);
      check(photo.kind==='demo','UI_SYNTHETIC_PHOTO_ONLY','Only built-in synthetic image metadata is accepted');enumeration(photo.angle,['front','back','left','right'],'photo angle');counts[['left','right'].includes(photo.angle)?'side':photo.angle]++;
    }
    check(Object.values(counts).every(count=>count<=4),'UI_PHOTO_LIMIT','At most four synthetic metadata items per position');
  }
  if(value.analysis!==null){
    exact(value.analysis,['materialRevision','sample'],'analysis');integer(value.analysis.materialRevision,'analysis.materialRevision');bool(value.analysis.sample,'analysis.sample');
    check(value.analysis.materialRevision<=value.materialRevision,'UI_INVALID_REVISION','Analysis cannot refer to future material');
    if(value.analysis.sample&&value.analysis.materialRevision===value.materialRevision)check(value.demoLoaded&&value.text===UI_FIXTURE_TEXT.sample&&['',UI_FIXTURE_TEXT.transcript].includes(value.transcript),'UI_INVALID_PROVENANCE','Current sample analysis must refer to the fixed example with no transcript or its exact fixed synthetic transcript');
  }
  if(value.comparison!==null){
    exact(value.comparison,['materialRevision','designRevision','sideNote'],'comparison');integer(value.comparison.materialRevision,'comparison.materialRevision');integer(value.comparison.designRevision,'comparison.designRevision');enumeration(value.comparison.sideNote,UI_SIDE_NOTES,'comparison.sideNote');
    check(value.comparison.materialRevision<=value.materialRevision&&value.comparison.designRevision<=value.designRevision,'UI_INVALID_REVISION','Comparison cannot refer to future material/design');
    if(value.comparison.materialRevision===value.materialRevision&&value.comparison.designRevision===value.designRevision){
      check(photoCoverage(value.photos.before)&&photoCoverage(value.photos.after),'UI_INVALID_COMPARISON','Current comparison needs all required synthetic angles');
      const match=['left','right'].some(angle=>value.photos.before.some(p=>p.angle===angle)&&value.photos.after.some(p=>p.angle===angle));
      check(value.comparison.sideNote===UI_SIDE_NOTES[match?0:1],'UI_INVALID_COMPARISON','Comparison side note must match explicit angle metadata');
    }
  }
  check(new TextEncoder().encode(canonical(value)).length<=512*1024,'UI_PAYLOAD_LIMIT','UI projection exceeds 512 KiB');
  return freeze(clone(value));
}
function emptyState(scopeValue){return {schemaVersion:UI_STATE_SCHEMA,scope:scope(scopeValue),revision:0,status:'draft',draft:createUIDraftPayload(),history:[]};}
export function createUIDraftState(scopeValue){return freeze(emptyState(scopeValue));}
function requestShape(request,state){
  const common=['requestId','expectedRevision','scope','operation'];
  exact(request,[...common,...(request.operation==='save'?['draft']:request.operation==='reopen'?['parentArchiveRevision','reason']:[])],'UI request');
  enumeration(request.operation,['save','archive','reopen'],'operation');identifier(request.requestId,'requestId');integer(request.expectedRevision,'expectedRevision');sameScope(state.scope,request.scope);
}
function apply(state,request){
  requestShape(request,state);check(request.expectedRevision===state.revision,'REVISION_CONFLICT','Expected revision must match latest UI draft revision');
  check(!state.history.some(item=>item.requestId===request.requestId),'IDEMPOTENCY_CONFLICT','UI history contains a repeated request ID');
  check(state.history.length<MAX_HISTORY,'UI_HISTORY_LIMIT','UI history limit reached; old versions will not be deleted');
  if(request.operation==='save'){
    check(state.status==='draft','ARCHIVE_IMMUTABLE','Reopen the saved archive explicitly before editing');const draft=validateUIDraftPayload(request.draft);
    check(draft.materialRevision>=state.draft.materialRevision&&draft.designRevision>=state.draft.designRevision,'UI_INVALID_REVISION','UI material/design counters cannot move backward');
    const material=value=>canonical([value.text,value.transcript,value.photos]);
    const design=value=>canonical([material(value),value.basic,value.proposal,value.care,value.zones,value.zoneProcesses,value.services,value.perm,value.dye,value.review]);
    if(material(draft)!==material(state.draft))check(draft.materialRevision>state.draft.materialRevision,'UI_INVALID_REVISION','Changed raw material requires a new material counter');
    if(design(draft)!==design(state.draft))check(draft.designRevision>state.draft.designRevision,'UI_INVALID_REVISION','Changed design/source/confirmation requires a new design counter');
    state.draft=draft;
  }else if(request.operation==='archive'){
    check(state.status==='draft','ARCHIVE_IMMUTABLE','Already archived; no replacement archive is allowed');state.status='archived';
  }else{
    check(state.status==='archived'&&request.parentArchiveRevision===state.revision,'ARCHIVE_MISMATCH','Reopen must link the exact archived checkpoint');
    check(request.reason===UI_FIXTURE_TEXT.revisionReason,'UI_SYNTHETIC_TEXT_ONLY','Use the fixed synthetic revision reason');state.status='draft';
  }
  state.history.push(clone(request));state.revision++;
}
export function validateUIDraftState(value){
  exact(value,STATE_KEYS,'UI state');check(value.schemaVersion===UI_STATE_SCHEMA&&Array.isArray(value.history)&&value.history.length<=MAX_HISTORY,'UI_SCHEMA_MISMATCH','Invalid UI state schema or history');
  const result=emptyState(value.scope);value.history.forEach(request=>apply(result,request));
  check(canonical(result)===canonical(value),'UI_STATE_TAMPERED','UI projection must match its append-only history');return freeze(result);
}
function append(state,request){
  const checked=validateUIDraftState(state);requestShape(request,checked);
  const index=checked.history.findIndex(item=>item.requestId===request.requestId);
  if(index>=0){check(canonical(checked.history[index])===canonical(request),'IDEMPOTENCY_CONFLICT','Request ID was already used with another UI payload');return freeze({uiDraft:checked,replayed:true,appliedRevision:index+1});}
  const next=clone(checked);apply(next,request);return freeze({uiDraft:freeze(next),replayed:false,appliedRevision:next.revision});
}
export function saveUIDraft(state,request){exact(request,['requestId','expectedRevision','scope','draft'],'save request');return append(state,{...request,operation:'save'});}
export function createUIDraftArchive(state){
  const checked=validateUIDraftState(state);check(checked.status==='archived','ARCHIVE_REQUIRED','UI state must first append its archive operation');
  const last=checked.history.filter(item=>item.operation==='reopen').at(-1);
  return freeze({schemaVersion:UI_STATE_SCHEMA,kind:'synthetic_ui_projection_archive',scope:clone(checked.scope),revision:checked.revision,previousArchiveRevision:last?.parentArchiveRevision??null,snapshot:checked});
}
export function validateUIDraftArchive(archive,requestedScope){
  exact(archive,['schemaVersion','kind','scope','revision','previousArchiveRevision','snapshot'],'UI archive');sameScope(archive.scope,requestedScope);
  const expected=createUIDraftArchive(archive.snapshot);sameScope(expected.scope,archive.scope);check(canonical(archive)===canonical(expected),'ARCHIVE_MISMATCH','UI archive envelope differs from its snapshot');return expected;
}
export function archiveUIDraft(state,request){exact(request,['requestId','expectedRevision','scope'],'archive request');return append(state,{...request,operation:'archive'});}
export function reopenUIDraft(state,archive,request){
  exact(request,['requestId','expectedRevision','scope','reason'],'reopen request');const checked=validateUIDraftState(state),parent=validateUIDraftArchive(archive,request.scope);sameScope(checked.scope,parent.scope);
  check(request.expectedRevision===parent.revision&&parent.revision<=checked.revision,'ARCHIVE_MISMATCH','Expected revision must match the saved UI parent archive');
  const checkpoint=emptyState(checked.scope);checked.history.slice(0,parent.revision).forEach(item=>apply(checkpoint,item));check(canonical(checkpoint)===canonical(parent.snapshot),'ARCHIVE_MISMATCH','UI parent is not the exact history checkpoint');
  return append(checked,{...request,operation:'reopen',parentArchiveRevision:parent.revision});
}
