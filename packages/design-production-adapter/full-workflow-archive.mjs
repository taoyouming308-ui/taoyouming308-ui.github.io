import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Buffer} from 'node:buffer';
/** Additive, lossless archive preparation. No network, SQL, migration, storage or legacy conversion. */
import {createHash} from 'node:crypto';
import {validateUIDraftState,validateUIDraftArchive,UI_ZONES} from '../analysis-engine/design-pilot-ui-draft.mjs';
import {validateDesignSession,validateDesignArchive,DESIGN_SCHEMA_VERSION} from '../analysis-engine/design-pilot.mjs';
import {validateAcceptedCandidateHistory} from '../analysis-engine/design-candidate-history.mjs';
import {validateManagedImageHistory} from '../analysis-engine/managed-image-result-history.mjs';
import {validateLegacyArchiveSnapshot} from './archive-adapter.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';

export const FULL_WORKFLOW_SCHEMA='design-full-workflow-snapshot-v1';
export const FULL_WORKFLOW_MODEL_SCHEMA='design-full-workflow-snapshot-v2';
export const FULL_WORKFLOW_MANAGED_SCHEMA='design-full-workflow-snapshot-v3';
export const FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA='design-full-workflow-snapshot-v4';
export const FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA='design-full-workflow-snapshot-v7';
export const FULL_WORKFLOW_APPLICATION_SCHEMA='design-full-workflow-snapshot-v6';
export const FULL_WORKFLOW_NORMALIZED_SCHEMA='design-full-workflow-snapshot-v5';
export const FULL_WORKFLOW_VERSION_SCHEMA='design-full-workflow-version-v1';
export const FULL_WORKFLOW_MAX_BYTES=32*1024*1024;
export const FULL_WORKFLOW_CHAIN_MAX_BYTES=64*1024*1024;
const MAX_VERSION_BYTES=FULL_WORKFLOW_MAX_BYTES+64*1024;
export class FullWorkflowArchiveError extends Error {
  constructor(code,outcome=code==='FULL_OUTCOME_UNCERTAIN'?'uncertain':'not_sent'){super(code);this.name='FullWorkflowArchiveError';this.code=code;this.outcome=outcome;this.retryable=false;}
}
const fail=code=>{throw new FullWorkflowArchiveError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('FULL_INVALID_FIELDS');};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const id=v=>{if(typeof v!=='string'||!v.length||v.length>160||v!==v.trim()||/[\u0000-\u001f\u007f]/.test(v)||['__proto__','prototype','constructor'].includes(v))fail('FULL_INVALID_ID');return v;};
const integer=v=>{if(!Number.isSafeInteger(v)||v<0)fail('FULL_INVALID_VERSION');};
function jsonCopy(value,maxBytes=FULL_WORKFLOW_MAX_BYTES){
  let count=0,byteCount=0;
  const charge=bytes=>{byteCount+=bytes;if(byteCount>maxBytes)fail('FULL_TOO_LARGE');};
  function visit(v,depth){
    if(++count>750000||depth>80)fail('FULL_TOO_LARGE');
    if(v===null||typeof v==='string'||typeof v==='boolean'){if(typeof v==='string'&&v.length>65536)fail('FULL_TOO_LARGE');charge(Buffer.byteLength(JSON.stringify(v)));return;}
    if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail('FULL_INVALID_JSON');charge(Buffer.byteLength(JSON.stringify(v)));return;}
    if(Array.isArray(v)){
      if(Reflect.ownKeys(v).length!==v.length+1)fail('FULL_INVALID_JSON');charge(2+Math.max(0,v.length-1));
      for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value'))fail('FULL_INVALID_JSON');visit(d.value,depth+1);}return;
    }
    if(!plain(v))fail('FULL_INVALID_JSON');charge(2+Math.max(0,Reflect.ownKeys(v).length-1));
    for(const key of Reflect.ownKeys(v)){
      if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))fail('FULL_INVALID_JSON');
      if(key.length>65536)fail('FULL_TOO_LARGE');charge(Buffer.byteLength(JSON.stringify(key))+1);
      const d=Object.getOwnPropertyDescriptor(v,key);if(!d.enumerable||!Object.hasOwn(d,'value'))fail('FULL_INVALID_JSON');visit(d.value,depth+1);
    }
  }
  visit(value,0);const serialized=canonical(value);if(Buffer.byteLength(serialized)>maxBytes)fail('FULL_TOO_LARGE');return JSON.parse(serialized);
}
function scopeOf(value){try{return validateProductionDesignScope(value);}catch{fail('FULL_SCOPE_MISMATCH');}}
function actorOf(value){exact(value,['username','store']);id(value.username);id(value.store);return {...value};}
function nativeScope(value){exact(value,['customerId','visitId','sessionId']);Object.values(value).forEach(id);}
function prefix(oldValue,newValue){return Array.isArray(oldValue)&&Array.isArray(newValue)&&newValue.length>=oldValue.length&&same(oldValue,newValue.slice(0,oldValue.length));}
function sameScope(a,b){if(!same(a,b))fail('FULL_SCOPE_MISMATCH');}
function checkNativeArchives(lane,type){
  const state=type==='ui'?lane.state:lane.session;
  const history=type==='ui'?state.history:state.journal;
  const expected=[];let phase='before_analysis';
  history.forEach((row,index)=>{
    if(type==='ui'){if(row.operation==='archive')expected.push(index+1);return;}
    if(row.event.type==='phase_advanced')phase=row.event.phase;
    if(row.event.type==='revision_opened')phase=row.event.resumePhase;
    if((row.event.type==='phase_advanced'||row.event.type==='schema_migrated')&&phase==='archive')expected.push(index+1);
  });
  if(!Array.isArray(lane.archives)||lane.archives.length>1000||!same(lane.archives.map(a=>a.revision),expected))fail('FULL_NATIVE_HISTORY_INCOMPLETE');
  let previous=null;
  for(const archive of lane.archives){
    try{if(type==='ui')validateUIDraftArchive(archive,state.scope);else validateDesignArchive(archive,state.scope);}catch{fail('FULL_NATIVE_ARCHIVE_INVALID');}
    const archivedHistory=type==='ui'?archive.snapshot.history:archive.snapshot.journal;
    if(!same(archivedHistory,history.slice(0,archive.revision)))fail('FULL_NATIVE_ARCHIVE_INVALID');
    const linked=Object.hasOwn(archive,'previousArchiveRevision')?archive.previousArchiveRevision:null;
    // Legacy v1 evidence has no parent field; preserve that absence, never invent one.
    if((type==='ui'||archive.schemaVersion===DESIGN_SCHEMA_VERSION)&&linked!==previous)fail('FULL_NATIVE_ARCHIVE_INVALID');
    previous=archive.revision;
  }
  for(const row of history){
    const parent=type==='ui'?(row.operation==='reopen'?row.parentArchiveRevision:null):(['revision_opened','schema_migrated'].includes(row.event.type)?row.event.parentArchiveRevision:null);
    if(parent!==null&&parent!==undefined&&!expected.includes(parent))fail('FULL_NATIVE_HISTORY_INCOMPLETE');
  }
}
function validateComponents(input){
  const model=plain(input)&&Object.hasOwn(input,'modelCandidates');
  const managed=plain(input)&&Object.hasOwn(input,'managedImageHistory');
  exact(input,['scope','store','bindings','ui','evidence','legacyVersions','photoRefs',...(model?['modelCandidates']:[]),...(managed?['managedImageHistory']:[])]);
  scopeOf(input.scope);id(input.store);exact(input.bindings,['uiScope','evidenceScope']);
  if(input.ui===null){if(input.bindings.uiScope!==null)fail('FULL_SCOPE_MISMATCH');}
  else{
    exact(input.ui,['state','archives']);nativeScope(input.bindings.uiScope);
    try{validateUIDraftState(input.ui.state);}catch{fail('FULL_UI_INVALID');}
    sameScope(input.ui.state.scope,input.bindings.uiScope);checkNativeArchives(input.ui,'ui');
  }
  if(input.evidence===null){if(input.bindings.evidenceScope!==null)fail('FULL_SCOPE_MISMATCH');}
  else{
    exact(input.evidence,['session','archives']);nativeScope(input.bindings.evidenceScope);
    try{validateDesignSession(input.evidence.session);}catch{fail('FULL_EVIDENCE_INVALID');}
    if(input.evidence.session.schemaVersion!==DESIGN_SCHEMA_VERSION)fail('FULL_EXPLICIT_MIGRATION_REQUIRED');
    sameScope(input.evidence.session.scope,input.bindings.evidenceScope);
    if(input.evidence.session.scope.customerId!==input.scope.customerProfileId||input.evidence.session.scope.visitId!==input.scope.visitId)fail('FULL_SCOPE_MISMATCH');
    checkNativeArchives(input.evidence,'evidence');
  }
  if(input.evidence?.session.sources.some(s=>['synthetic_application_comparison','synthetic_application_synthesis'].includes(s.kind))&&input.managedImageHistory?.schemaVersion!=='design-managed-image-history-v5')fail('FULL_MANAGED_HISTORY_INVALID');
  if(input.evidence?.session.sources.some(s=>s.kind==='synthetic_image_description')&&!['design-managed-image-history-v3','design-managed-image-history-v4','design-managed-image-history-v5'].includes(input.managedImageHistory?.schemaVersion))fail('FULL_MANAGED_HISTORY_INVALID');
  if(!Array.isArray(input.photoRefs)||input.photoRefs.length>300)fail('FULL_PHOTO_INVALID');
  const photoIds=new Set();
  for(const photo of input.photoRefs){
    if(photo.kind==='legacy_asset'){
      exact(photo,['kind','assetId','scope','store','stage','angle']);
      if(typeof photo.assetId!=='string'||!UUID.test(photo.assetId)||photoIds.has('legacy:'+photo.assetId))fail('FULL_PHOTO_INVALID');photoIds.add('legacy:'+photo.assetId);
      if(!['before','after','unknown'].includes(photo.stage)||!['front','back','left','right','unknown'].includes(photo.angle))fail('FULL_PHOTO_INVALID');
    }else if(photo.kind==='private_media'){
      exact(photo,['kind','scope','store','reference']);const ref=photo.reference;
      exact(ref,['mediaId','stage','angle','mime','byteLength','width','height']);
      if(typeof ref.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.mediaId)||photoIds.has('private:'+ref.mediaId))fail('FULL_PHOTO_INVALID');photoIds.add('private:'+ref.mediaId);
      if(!['before','after','reference'].includes(ref.stage)||!['front','back','left','right','detail'].includes(ref.angle)||!PHONE_SOURCE_MIMES.includes(ref.mime)||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<1||ref.byteLength>8*1024*1024||!['width','height'].every(k=>Number.isSafeInteger(ref[k])&&ref[k]>0&&ref[k]<=16384)||ref.width*ref.height>40000000)fail('FULL_PHOTO_INVALID');
    }else fail('FULL_PHOTO_INVALID');
    sameScope(photo.scope,input.scope);if(photo.store!==input.store)fail('FULL_SCOPE_MISMATCH');
  }
  if(!Array.isArray(input.legacyVersions)||input.legacyVersions.length>1000)fail('FULL_LEGACY_INVALID');
  const legacyIds=new Set(),legacyRequests=new Set();let parent=null;
  input.legacyVersions.forEach((version,index)=>{
    exact(version,['id','requestId','versionNumber','previousVersionId','createdAt','actor','scope','snapshot']);
    if(!UUID.test(version.id)||legacyIds.has(version.id)||!UUID.test(version.requestId)||legacyRequests.has(version.requestId)||version.versionNumber!==index+1||version.previousVersionId!==parent)fail('FULL_LEGACY_HISTORY_INCOMPLETE');
    legacyIds.add(version.id);legacyRequests.add(version.requestId);parent=version.id;
    actorOf(version.actor);sameScope(version.scope,input.scope);if(version.actor.store!==input.store)fail('FULL_SCOPE_MISMATCH');
    if(typeof version.createdAt!=='string'||version.createdAt.length>64||!Number.isFinite(Date.parse(version.createdAt)))fail('FULL_LEGACY_INVALID');
    try{validateLegacyArchiveSnapshot(version.snapshot);}catch{fail('FULL_LEGACY_INVALID');}
    if(version.snapshot.photo_ids.some(assetId=>!photoIds.has('legacy:'+assetId)))fail('FULL_PHOTO_REFERENCE_MISSING');
  });
  if(model){
    if(input.evidence===null||!Array.isArray(input.modelCandidates)||!input.modelCandidates.length)fail('FULL_MODEL_HISTORY_INVALID');
    if(!managed)try{validateAcceptedCandidateHistory({session:input.evidence.session,scope:input.scope,store:input.store,modelCandidates:input.modelCandidates,photoRefs:input.photoRefs});}catch{fail('FULL_MODEL_HISTORY_INVALID');}
  }
  if(managed){
    if(input.evidence===null)fail('FULL_MANAGED_HISTORY_INVALID');
    try{validateManagedImageHistory({session:input.evidence.session,scope:input.scope,store:input.store,photoRefs:input.photoRefs,...(model?{modelCandidates:input.modelCandidates}:{}),managedImageHistory:input.managedImageHistory});}catch{fail('FULL_MANAGED_HISTORY_INVALID');}
  }
  if(input.ui===null&&input.evidence===null&&!input.legacyVersions.length)fail('FULL_EMPTY_SNAPSHOT');
}
function indexFor(input){
  const index=[];
  const add=(namespace,kind,path,value,nativeIdentity=null)=>index.push({namespace,kind,path,nativeIdentity,sha256:digest(value)});
  if(input.ui){
    const state=input.ui.state;add('ui','state','/ui/state',state);add('ui','revision_history','/ui/state/history',state.history);
    const walk=(value,path)=>{
      if(plain(value)&&Object.hasOwn(value,'tracks')&&Object.hasOwn(value,'original')){add('ui','field_record',path,value,{activePhase:value.phase});return;}
      if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))walk(child,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'));
    };
    walk(state.draft,'/ui/state/draft');
    for(const zone of UI_ZONES)for(const service of ['perm','dye'])state.draft.zoneProcesses[zone][service].forEach((group,arrayIndex)=>add('ui','process_group',`/ui/state/draft/zoneProcesses/${zone}/${service}/${arrayIndex}`,group,{zone,service,arrayIndex,groupId:null,side:null}));
    for(const stage of ['before','after'])state.draft.photos[stage].forEach((photo,i)=>add('ui','synthetic_photo_marker',`/ui/state/draft/photos/${stage}/${i}`,photo,{stage,angle:photo.angle,id:photo.id}));
    input.ui.archives.forEach((archive,i)=>add('ui','native_archive',`/ui/archives/${i}`,archive,{revision:archive.revision}));
  }
  if(input.evidence){
    const state=input.evidence.session;add('evidence','session','/evidence/session',state);add('evidence','revision_history','/evidence/session/journal',state.journal);
    state.sources.forEach((source,i)=>add('evidence','source_record',`/evidence/session/sources/${i}`,source,{messageId:source.messageId,kind:source.kind}));
    state.entries.forEach((entry,i)=>add('evidence','entry','/evidence/session/entries/'+i,entry,{id:entry.id,zone:entry.zone,groupId:entry.groupId,service:entry.service,side:entry.side,track:entry.track}));
    input.evidence.archives.forEach((archive,i)=>add('evidence','native_archive',`/evidence/archives/${i}`,archive,{revision:archive.revision}));
  }
  input.legacyVersions.forEach((version,i)=>add('legacy','native_version',`/legacyVersions/${i}`,version,{id:version.id,versionNumber:version.versionNumber}));
  input.photoRefs.forEach((photo,i)=>add('media',photo.kind==='private_media'?'private_media_reference':'legacy_asset_reference',`/photoRefs/${i}`,photo,photo.kind==='private_media'?{mediaId:photo.reference.mediaId,stage:photo.reference.stage,angle:photo.reference.angle}:{assetId:photo.assetId,stage:photo.stage,angle:photo.angle}));
  (input.modelCandidates||[]).forEach((row,i)=>{
    add('model','candidate',`/modelCandidates/${i}/candidate`,row.candidate,{candidateId:row.candidate.id,kind:row.candidate.kind,baseRevision:row.candidate.baseRevision});
    add('model','acceptance',`/modelCandidates/${i}/acceptance`,row.acceptance,{candidateId:row.candidate.id,requestId:row.acceptance.requestId,workflowRevision:row.acceptance.workflowRevision,resultRevision:row.acceptance.receipt.resultRevision});
  });
  if(input.managedImageHistory){
    input.managedImageHistory.inputs.forEach((row,i)=>{if(row.task?.schemaVersion==='design-normalized-strict-task-v2'){const a=row.task.claimedArtifact.artifact;add('managed_media','synthetic_application_input',`/managedImageHistory/inputs/${i}`,row,{taskId:row.taskId,sourceReference:a.sourceBinding.source,normalizedReference:{manifestId:row.task.normalizedManifest.manifestId,revision:row.task.normalizedManifest.revision},qualification:'synthetic_pinned_producer_only'});return;}const normalized=Object.hasOwn(row,'task'),source=normalized?row.task.claimedArtifact.artifact.sourceRecord:row.sourceRecord,object=normalized?row.task.objectReceipt:row.objectReceipt;add('managed_media',normalized?'synthetic_normalized_input':'verified_input',`/managedImageHistory/inputs/${i}`,row,{taskId:row.taskId,sourceVersion:source.object.version,derivativeVersion:object.object.version,...(normalized?{parentVersion:row.task.claimedArtifact.artifact.parentObjectReceipt.object.version,qualification:'synthetic_pinned_producer_only'}:{})});});
    input.managedImageHistory.accepted.forEach((row,i)=>{
      add('managed_model','candidate',`/managedImageHistory/accepted/${i}/candidate`,row.candidate,{candidateId:row.candidate.id,kind:row.candidate.kind,baseRevision:row.candidate.workflowBinding.sessionRevision});
      add('managed_model','acceptance',`/managedImageHistory/accepted/${i}/acceptance`,row.acceptance,{candidateId:row.candidate.id,requestId:row.acceptance.requestId,workflowRevision:row.acceptance.workflowRevision,resultRevision:row.acceptance.receipt.resultRevision});
    });
  }
  return index;
}
// Pure validation only. The private brand is issued solely after the original
// complete validator and deep freeze. It conveys no live access or provenance.
const snapshotValidationScope=new AsyncLocalStorage();
export async function withFullWorkflowSnapshotValidation(work){
 if(typeof work!=='function')throw TypeError('FULL_SNAPSHOT_WORK_REQUIRED');
 const context={closed:false,proven:new WeakSet(),count:0};
 try{return await snapshotValidationScope.run(context,work);}finally{context.closed=true;context.proven=new WeakSet();context.count=0;}
}
function ownValidatedSnapshot(snapshot){const context=snapshotValidationScope.getStore();if(context&&!context.closed&&context.count<64&&!context.proven.has(snapshot)){context.proven.add(snapshot);context.count++;}return snapshot;}
/** Preserve separate native representations; never manufacture semantic equivalence or confirmation. */
export function createFullWorkflowSnapshot(value){
  const input=jsonCopy(value);validateComponents(input);
  const body={schemaVersion:Object.hasOwn(input,'managedImageHistory')?(input.managedImageHistory.schemaVersion==='design-managed-image-history-v5'?FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA:input.managedImageHistory.schemaVersion==='design-managed-image-history-v4'?FULL_WORKFLOW_APPLICATION_SCHEMA:input.managedImageHistory.schemaVersion==='design-managed-image-history-v3'?FULL_WORKFLOW_NORMALIZED_SCHEMA:input.managedImageHistory.schemaVersion==='design-managed-image-history-v2'?FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA:FULL_WORKFLOW_MANAGED_SCHEMA):Object.hasOwn(input,'modelCandidates')?FULL_WORKFLOW_MODEL_SCHEMA:FULL_WORKFLOW_SCHEMA,mappingPolicy:'parallel-native-snapshots-no-inference',...input,index:indexFor(input)};
  const snapshot={...body,sha256:digest(body)};jsonCopy(snapshot);return ownValidatedSnapshot(freeze(snapshot));
}
export function validateFullWorkflowSnapshot(value){
  const context=snapshotValidationScope.getStore();if(context&&!context.closed&&context.proven.has(value))return value;
  const snapshot=jsonCopy(value);
  const managed=[FULL_WORKFLOW_MANAGED_SCHEMA,FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA,FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(snapshot?.schemaVersion),model=snapshot?.schemaVersion===FULL_WORKFLOW_MODEL_SCHEMA||managed&&Object.hasOwn(snapshot,'modelCandidates');
  exact(snapshot,['schemaVersion','mappingPolicy','scope','store','bindings','ui','evidence','legacyVersions','photoRefs','index','sha256',...(model?['modelCandidates']:[]),...(managed?['managedImageHistory']:[])]);
  if(![FULL_WORKFLOW_SCHEMA,FULL_WORKFLOW_MODEL_SCHEMA,FULL_WORKFLOW_MANAGED_SCHEMA,FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA,FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(snapshot.schemaVersion)||snapshot.mappingPolicy!=='parallel-native-snapshots-no-inference'||!SHA.test(snapshot.sha256))fail('FULL_SCHEMA_INVALID');
  const input=Object.fromEntries(['scope','store','bindings','ui','evidence','legacyVersions','photoRefs',...(model?['modelCandidates']:[]),...(managed?['managedImageHistory']:[])].map(key=>[key,snapshot[key]]));
  const expected=createFullWorkflowSnapshot(input);if(!same(snapshot,expected))fail('FULL_SNAPSHOT_TAMPERED');return expected;
}
export function unpackFullWorkflowSnapshot(value){
  const checked=validateFullWorkflowSnapshot(value);return freeze(jsonCopy(Object.fromEntries(['scope','store','bindings','ui','evidence','legacyVersions','photoRefs',...(Object.hasOwn(checked,'modelCandidates')?['modelCandidates']:[]),...([FULL_WORKFLOW_MANAGED_SCHEMA,FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA,FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(checked.schemaVersion)?['managedImageHistory']:[])].map(key=>[key,checked[key]]))));
}
export function serializeFullWorkflowSnapshot(value){return canonical(validateFullWorkflowSnapshot(value));}
export function parseFullWorkflowSnapshot(serialized){
  if(typeof serialized!=='string'||Buffer.byteLength(serialized)>FULL_WORKFLOW_MAX_BYTES)fail('FULL_TOO_LARGE');let value;
  try{value=JSON.parse(serialized);}catch{fail('FULL_INVALID_JSON');}
  const checked=validateFullWorkflowSnapshot(value);if(canonical(checked)!==serialized)fail('FULL_NONCANONICAL_SERIALIZATION');return checked;
}
function transition(previous,next){
  sameScope(previous.scope,next.scope);if(previous.store!==next.store)fail('FULL_SCOPE_MISMATCH');
  for(const [lane,state,history] of [['ui','state','history'],['evidence','session','journal']])if(previous[lane]!==null){
    if(next[lane]===null||!same(previous[lane][state].scope,next[lane][state].scope)||!prefix(previous[lane][state][history],next[lane][state][history])||!prefix(previous[lane].archives,next[lane].archives))fail('FULL_HISTORY_REWRITE');
  }
  if(!prefix(previous.legacyVersions,next.legacyVersions)||!prefix(previous.photoRefs,next.photoRefs)||!prefix(previous.modelCandidates||[],next.modelCandidates||[]))fail('FULL_HISTORY_REWRITE');
  if(previous.managedImageHistory&&(!next.managedImageHistory||!prefix(previous.managedImageHistory.inputs,next.managedImageHistory.inputs)||!prefix(previous.managedImageHistory.accepted,next.managedImageHistory.accepted)))fail('FULL_HISTORY_REWRITE');
  if(previous.schemaVersion===FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA&&![FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA,FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(next.schemaVersion)||previous.schemaVersion===FULL_WORKFLOW_NORMALIZED_SCHEMA&&![FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(next.schemaVersion)||previous.schemaVersion===FULL_WORKFLOW_APPLICATION_SCHEMA&&![FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(next.schemaVersion)||previous.schemaVersion===FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA&&next.schemaVersion!==FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA)fail('FULL_HISTORY_REWRITE');
}
function makeVersion(base){return freeze({...base,sha256:digest(base)});}
export function validateFullWorkflowVersion(value,scope){
  const version=jsonCopy(value,MAX_VERSION_BYTES);exact(version,['schemaVersion','version','previous','scope','actor','requestId','createdAt','bindingRevision','snapshot','sha256']);
  if(version.schemaVersion!==FULL_WORKFLOW_VERSION_SCHEMA||!SHA.test(version.sha256))fail('FULL_SCHEMA_INVALID');integer(version.version);if(version.version<1)fail('FULL_INVALID_VERSION');
  scopeOf(version.scope);sameScope(version.scope,scope);actorOf(version.actor);id(version.requestId);id(version.bindingRevision);
  if(typeof version.createdAt!=='string'||!Number.isFinite(Date.parse(version.createdAt))||version.createdAt.length>64)fail('FULL_INVALID_VERSION');
  if(version.previous===null){if(version.version!==1)fail('FULL_PARENT_MISMATCH');}
  else{exact(version.previous,['version','sha256']);if(version.previous.version!==version.version-1||!SHA.test(version.previous.sha256))fail('FULL_PARENT_MISMATCH');}
  const snapshot=validateFullWorkflowSnapshot(version.snapshot);sameScope(snapshot.scope,version.scope);if(snapshot.store!==version.actor.store)fail('FULL_SCOPE_MISMATCH');
  const {sha256,...base}=version;if(sha256!==digest(base))fail('FULL_VERSION_TAMPERED');return freeze(version);
}
export function validateFullWorkflowChain(value,scope){
  scopeOf(scope);if(!Array.isArray(value)||value.length>100)fail('FULL_CHAIN_LIMIT');
  const bounded=jsonCopy(value,FULL_WORKFLOW_CHAIN_MAX_BYTES);
  const versions=bounded.map(v=>validateFullWorkflowVersion(v,scope));const requests=new Set();
  versions.forEach((version,index)=>{
    const key=canonical([version.actor,version.requestId]);if(requests.has(key))fail('FULL_REQUEST_CONFLICT');requests.add(key);
    if(version.version!==index+1||!same(version.previous,index?{version:index,sha256:versions[index-1].sha256}:null))fail('FULL_PARENT_MISMATCH');
    if(index)transition(versions[index-1].snapshot,version.snapshot);
  });return freeze(versions);
}
function safeFailure(error,transactionReturned){if(transactionReturned)throw new FullWorkflowArchiveError('FULL_OUTCOME_UNCERTAIN');if(error instanceof FullWorkflowArchiveError)throw error;fail('FULL_OUTCOME_UNCERTAIN');}
/** All repository/authorization methods must share one real transaction; no executor is supplied. */
export function createPreparedFullWorkflowArchive({enabled=false,permissionGate,transaction,clock=()=>Date.now()}={}){
  return Object.freeze({async append(request){
    if(enabled!==true)fail('FULL_DISABLED');
    if(typeof permissionGate?.authorize!=='function'||typeof transaction!=='function'||typeof clock!=='function')fail('FULL_NOT_CONFIGURED');
    exact(request,['credential','scope','requestId','expectedVersion','expectedParentDigest','snapshot']);
    const scope=scopeOf(request.scope),requestId=id(request.requestId);integer(request.expectedVersion);
    if((request.expectedVersion===0&&request.expectedParentDigest!==null)||(request.expectedVersion>0&&(typeof request.expectedParentDigest!=='string'||!SHA.test(request.expectedParentDigest))))fail('FULL_PARENT_MISMATCH');
    const snapshot=validateFullWorkflowSnapshot(request.snapshot);sameScope(snapshot.scope,scope);
    const fixed={credential:request.credential,scope,requestId,expectedVersion:request.expectedVersion,expectedParentDigest:request.expectedParentDigest};
    async function authorize(gate){let grant;try{grant=await gate.authorize(fixed.credential,scope);}catch{fail('FULL_ACCESS_DENIED');}exact(grant,['actor','scope']);actorOf(grant.actor);sameScope(grant.scope,scope);if(grant.actor.store!==snapshot.store)fail('FULL_ACCESS_DENIED');return freeze(jsonCopy(grant));}
    const initial=await authorize(permissionGate);
    const requestKey=digest([initial.actor,requestId]);
    const fingerprint=digest({actor:initial.actor,scope,requestId,expectedVersion:fixed.expectedVersion,expectedParentDigest:fixed.expectedParentDigest,snapshotSha256:snapshot.sha256});
    let invoked=false,guarded=false,checkedResult,transactionReturned=false;
    try{
      const result=await transaction({scope,actor:initial.actor},async tx=>{
        if(invoked)fail('FULL_TRANSACTION_REENTRY');invoked=true;
        if(!plain(tx)||typeof tx.permissionGate?.authorize!=='function'||['verifyBindings','verifyPhotoRefs','verifySourceSnapshots','readVersions','findReceipt','appendVersion','beforeCommit'].some(key=>typeof tx[key]!=='function'))fail('FULL_NOT_CONFIGURED');
        let binding;
        async function recheck(){
          const grant=await authorize(tx.permissionGate);if(!same(grant,initial))fail('FULL_AUTHORIZATION_CHANGED');
          let current,photos;try{current=await tx.verifyBindings({grant,scope,bindings:snapshot.bindings});photos=await tx.verifyPhotoRefs({grant,scope,photoRefs:snapshot.photoRefs});}catch{fail('FULL_BINDING_DENIED');}
          exact(current,['scope','store','uiScope','evidenceScope','revision']);id(current.revision);
          if(!same(current.scope,scope)||current.store!==initial.actor.store||!same(current.uiScope,snapshot.bindings.uiScope)||!same(current.evidenceScope,snapshot.bindings.evidenceScope)||photos!==true)fail('FULL_BINDING_DENIED');
          if(binding&&!same(current,binding))fail('FULL_AUTHORIZATION_CHANGED');binding=freeze(jsonCopy(current));
          let sourceChecked;try{sourceChecked=await tx.verifySourceSnapshots({grant,snapshot});}catch{fail('FULL_SOURCE_SNAPSHOT_DENIED');}
          if(sourceChecked!==true)fail('FULL_SOURCE_SNAPSHOT_DENIED');
          if([FULL_WORKFLOW_MANAGED_SCHEMA,FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA,FULL_WORKFLOW_NORMALIZED_SCHEMA,FULL_WORKFLOW_APPLICATION_SCHEMA,FULL_WORKFLOW_APPLICATION_VIEWS_SCHEMA].includes(snapshot.schemaVersion)){
            // A legacy verifier that ignores an unfamiliar lane cannot grant
            // live access merely because the new pure replay is structurally valid.
            if(typeof tx.verifyManagedImageHistory!=='function')fail('FULL_MANAGED_HISTORY_DENIED');
            let managedChecked;try{managedChecked=await tx.verifyManagedImageHistory({grant,scope,managedImageHistory:snapshot.managedImageHistory});}catch{fail('FULL_MANAGED_HISTORY_DENIED');}
            if(managedChecked!==true)fail('FULL_MANAGED_HISTORY_DENIED');
          }
          if(!same(await authorize(tx.permissionGate),initial))fail('FULL_AUTHORIZATION_CHANGED');
        }
        await recheck();
        const chain=validateFullWorkflowChain(await tx.readVersions(),scope),head=chain.at(-1);
        if(head&&head.actor.store!==initial.actor.store)fail('FULL_SCOPE_MISMATCH');
        const receipt=await tx.findReceipt({requestKey});let version,replayed=false;
        if(receipt!==null){
          exact(receipt,['requestKey','fingerprint','scope','version','sha256']);
          if(receipt.requestKey!==requestKey||receipt.fingerprint!==fingerprint||!same(receipt.scope,scope))fail('FULL_REQUEST_CONFLICT');
          integer(receipt.version);version=chain[receipt.version-1];
          if(!version||version.sha256!==receipt.sha256||version.requestId!==requestId||!same(version.actor,initial.actor)||version.snapshot.sha256!==snapshot.sha256||version.version!==fixed.expectedVersion+1||(version.previous?.sha256??null)!==fixed.expectedParentDigest)fail('FULL_RECEIPT_INVALID');replayed=true;
        }else{
          if(chain.some(row=>row.requestId===requestId&&same(row.actor,initial.actor)))fail('FULL_RECEIPT_INVALID');
          if((head?.version??0)!==fixed.expectedVersion||(head?.sha256??null)!==fixed.expectedParentDigest)fail('FULL_VERSION_CONFLICT');
          if(chain.length>=100)fail('FULL_CHAIN_LIMIT');if(head)transition(head.snapshot,snapshot);
          const instant=clock();if(!Number.isFinite(instant)||!Number.isFinite(new Date(instant).getTime()))fail('FULL_INVALID_VERSION');
          version=makeVersion({schemaVersion:FULL_WORKFLOW_VERSION_SCHEMA,version:chain.length+1,previous:head?{version:head.version,sha256:head.sha256}:null,scope,actor:initial.actor,requestId,createdAt:new Date(instant).toISOString(),bindingRevision:binding.revision,snapshot});
          validateFullWorkflowChain([...chain,version],scope);
          const receipt={requestKey,fingerprint,scope,version:version.version,sha256:version.sha256};
          await recheck();const appended=await tx.appendVersion({version,receipt,expectedVersion:fixed.expectedVersion,expectedParentDigest:fixed.expectedParentDigest});if(appended!==true)fail('FULL_VERSION_CONFLICT');
          const stored=validateFullWorkflowChain(await tx.readVersions(),scope);
          if(!same(stored,[...chain,version])||!same(await tx.findReceipt({requestKey}),receipt))fail('FULL_COMMIT_VALIDATION_FAILED');
        }
        await recheck();
        await tx.beforeCommit(async()=>{if(guarded)fail('FULL_TRANSACTION_REENTRY');await recheck();guarded=true;});
        checkedResult=freeze({saved:true,replayed,appliedVersion:version.version,observedHeadVersion:replayed?(head?.version??0):version.version,version});
        return checkedResult;
      });
      transactionReturned=true;
      if(!invoked||!guarded||!same(result,checkedResult))fail('FULL_OUTCOME_UNCERTAIN');
      if(!same(await authorize(permissionGate),initial))fail('FULL_AUTHORIZATION_CHANGED');
      return freeze(jsonCopy(result,MAX_VERSION_BYTES+65536));
    }catch(error){safeFailure(error,transactionReturned);}
  }});
}
