import {applyTrustedManagedApplicationViewCandidate} from '../analysis-engine/managed-application-view-result-candidate.mjs';
import {applyTrustedManagedApplicationCandidate} from '../analysis-engine/managed-application-result-candidate.mjs';
import {managedNormalizedLegacyHistory} from '../analysis-engine/managed-normalized-result-history.mjs';
import {applyTrustedManagedNormalizedCandidate} from '../analysis-engine/managed-normalized-result-candidate.mjs';
import {applyTrustedManagedViewCandidate} from '../analysis-engine/managed-view-result-candidate.mjs';
import {applyTrustedManagedImageCandidate} from '../analysis-engine/managed-image-result-candidate.mjs';
/** Prepared intent-to-evidence boundary. No production route, credentials, I/O or default activation. */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {createRequestLocalRecordValidator} from './request-local-record-validation.mjs';
import {Buffer} from 'node:buffer';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {createFullWorkflowSnapshot} from './full-workflow-archive.mjs';
import {applyTrustedDesignCandidate} from '../analysis-engine/design-candidate.mjs';
import {validateDesignSession,getDesignView,appendDesignEvent,createDesignArchive,createDesignRevision,DESIGN_PHASES,DESIGN_ZONES,DESIGN_TECHNIQUE_FIELDS} from '../analysis-engine/design-pilot.mjs';
export const PREPARED_RECORD_SCHEMA='design-prepared-workflow-record-v1';
export const PREPARED_MODEL_RECORD_SCHEMA='design-prepared-workflow-record-v2';
export const PREPARED_MANAGED_RECORD_SCHEMA='design-prepared-workflow-record-v3';
export const PREPARED_MANAGED_VIEW_RECORD_SCHEMA='design-prepared-workflow-record-v4';
export const PREPARED_APPLICATION_VIEW_RECORD_SCHEMA='design-prepared-workflow-record-v7';
export const PREPARED_APPLICATION_RECORD_SCHEMA='design-prepared-workflow-record-v6';
export const PREPARED_NORMALIZED_RECORD_SCHEMA='design-prepared-workflow-record-v5';
export class PreparedWorkflowError extends Error{constructor(code,outcome='not_sent'){super(code);this.name='PreparedWorkflowError';this.code=code;this.outcome=outcome;this.retryable=false;}}
const fail=code=>{throw new PreparedWorkflowError(code);};
// Pure structural proof only; never stores credentials, live access or DB authority.
const validatedRecords=new WeakSet();
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('WORKFLOW_INVALID_FIELDS');};
const clone=v=>JSON.parse(JSON.stringify(v));
function checkedIntent(value){
 let nodes=0;function visit(v,depth){if(++nodes>4096||depth>12)fail('WORKFLOW_INVALID_INTENT');if(v===null||['string','boolean'].includes(typeof v))return;if(typeof v==='number'&&Number.isFinite(v))return;if(!Array.isArray(v)&&!plain(v))fail('WORKFLOW_INVALID_INTENT');for(const key of Reflect.ownKeys(v)){if(Array.isArray(v)&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!d||!Object.hasOwn(d,'value')||!d.enumerable||['__proto__','constructor','prototype'].includes(key))fail('WORKFLOW_INVALID_INTENT');visit(d.value,depth+1);}}
 visit(value,0);const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>16384)fail('WORKFLOW_INVALID_INTENT');return JSON.parse(encoded);
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const equal=(a,b)=>canonical(a)===canonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v))fail('WORKFLOW_INVALID_ID');return v;};
const text=(v,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000\u000b\u000c]/.test(v))fail('WORKFLOW_INVALID_TEXT');return v;};
const fields={perm:['rod_type','rod_size_mm','rod_method','direction','angle_degrees','turns','product','formula','mixture','application','softening_check','time_minutes','temperature_celsius'],dye:['color_target','color_formula','product','mixture','application','time_minutes','temperature_celsius'],cut:['direction','angle_degrees']};
export const PREPARED_NOTE_FIELDS=Object.freeze(['style','person','length','features','layers','bangs','curls','care']);
// Copy data descriptors once before any caller-controlled property is read.
// Match the existing full/history JSON bounds; later contract-specific limits remain.
function snapshotRecordJSON(value){
  let nodes=0,bytes=0;
  const charge=n=>{bytes+=n;if(bytes>32*1024*1024)fail('WORKFLOW_RECORD_INVALID');};
  function copy(v,depth){
    if(++nodes>750000||depth>80||nodeTypes.isProxy(v))fail('WORKFLOW_RECORD_INVALID');
    if(v===null||typeof v==='boolean'||typeof v==='string'){if(typeof v==='string'&&v.length>65536)fail('WORKFLOW_RECORD_INVALID');charge(Buffer.byteLength(JSON.stringify(v)));return v;}
    if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail('WORKFLOW_RECORD_INVALID');charge(Buffer.byteLength(JSON.stringify(v)));return v;}
    if(typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))fail('WORKFLOW_RECORD_INVALID');
    const keys=Reflect.ownKeys(v);
    if(Array.isArray(v)){
      charge(2+Math.max(0,v.length-1));
      if(keys.length!==v.length+1)fail('WORKFLOW_RECORD_INVALID');const result=[];
      for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('WORKFLOW_RECORD_INVALID');result.push(copy(d.value,depth+1));}return result;
    }
    charge(2+Math.max(0,keys.length-1));
    const result={};
    for(const key of keys){
      if(typeof key!=='string'||key.length>65536||['__proto__','prototype','constructor'].includes(key))fail('WORKFLOW_RECORD_INVALID');
      const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('WORKFLOW_RECORD_INVALID');
      charge(Buffer.byteLength(JSON.stringify(key))+1);result[key]=copy(d.value,depth+1);
    }return result;
  }return copy(value,0);
}
function validateCopiedPreparedWorkflowRecord(value,scope){
  const managed=[PREPARED_MANAGED_RECORD_SCHEMA,PREPARED_MANAGED_VIEW_RECORD_SCHEMA,PREPARED_NORMALIZED_RECORD_SCHEMA,PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(value?.schemaVersion),model=value?.schemaVersion===PREPARED_MODEL_RECORD_SCHEMA||managed&&Object.hasOwn(value,'modelCandidates');
  exact(value,['schemaVersion','revision','scope','store','session','archives','photoRefs','legacyVersions',...(model?['modelCandidates']:[]),...(managed?['managedImageHistory']:[])]);
  if(![PREPARED_RECORD_SCHEMA,PREPARED_MODEL_RECORD_SCHEMA,PREPARED_MANAGED_RECORD_SCHEMA,PREPARED_MANAGED_VIEW_RECORD_SCHEMA,PREPARED_NORMALIZED_RECORD_SCHEMA,PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(value.schemaVersion)||!Number.isSafeInteger(value.revision)||value.revision<0||!equal(value.scope,scope)||typeof value.store!=='string')fail('WORKFLOW_RECORD_INVALID');
  let session;try{session=validateDesignSession(value.session);}catch{fail('WORKFLOW_RECORD_INVALID');}
  if(![PREPARED_NORMALIZED_RECORD_SCHEMA,PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(value.schemaVersion)&&session.sources.some(x=>x.kind==='synthetic_image_description'))fail('WORKFLOW_RECORD_INVALID');
  if(session.scope.customerId!==scope.customerProfileId||session.scope.visitId!==scope.visitId)fail('WORKFLOW_SCOPE_MISMATCH');
  // Full contract checks all native archives, metadata, migration and scope, without converting to legacy/UI fixtures.
  try{
    if(model&&(!Array.isArray(value.modelCandidates)||!value.modelCandidates.length||value.modelCandidates.length>1000))fail('WORKFLOW_RECORD_INVALID');
    const snapshot=createFullWorkflowSnapshot({scope,store:value.store,bindings:{uiScope:null,evidenceScope:session.scope},ui:null,evidence:{session,archives:value.archives},photoRefs:value.photoRefs,legacyVersions:value.legacyVersions,...(model?{modelCandidates:value.modelCandidates}:{}),...(managed?{managedImageHistory:value.managedImageHistory}:{})});
    // Snapshot has already copied and fully validated the accepted history.
    // Only the additional workflow-revision bound remains. Never read raw rows.
    if(model)for(const row of snapshot.modelCandidates)if(row.acceptance.workflowRevision>value.revision)fail('WORKFLOW_RECORD_INVALID');
    if(managed&&snapshot.managedImageHistory.schemaVersion!==(value.schemaVersion===PREPARED_APPLICATION_VIEW_RECORD_SCHEMA?'design-managed-image-history-v5':value.schemaVersion===PREPARED_APPLICATION_RECORD_SCHEMA?'design-managed-image-history-v4':value.schemaVersion===PREPARED_NORMALIZED_RECORD_SCHEMA?'design-managed-image-history-v3':value.schemaVersion===PREPARED_MANAGED_VIEW_RECORD_SCHEMA?'design-managed-image-history-v2':'design-managed-image-history-v1'))fail('WORKFLOW_RECORD_INVALID');
    if(managed)for(const row of snapshot.managedImageHistory.accepted)if(row.acceptance.workflowRevision>value.revision)fail('WORKFLOW_RECORD_INVALID');
  }catch{fail('WORKFLOW_RECORD_INVALID');}
  const checked=freeze(clone(value));validatedRecords.add(checked);return checked;
}
const recordValidation=createRequestLocalRecordValidator({snapshot:snapshotRecordJSON,validateCopied:validateCopiedPreparedWorkflowRecord,invalid:()=>fail('WORKFLOW_RECORD_INVALID')});
export function validatePreparedWorkflowRecord(value,scope){return recordValidation.validate(value,scope);}
/** Trusted request boundary only; no cache access, options or authorization shortcut. */
export function runPreparedRecordValidationScope(work){return recordValidation.run(work);}
export function createPreparedWorkflowRecord({scope,store,session,legacyVersions=[]}){
  validateProductionDesignScope(scope);
  return validatePreparedWorkflowRecord({schemaVersion:PREPARED_RECORD_SCHEMA,revision:0,scope,store,session,archives:[],photoRefs:[],legacyVersions},scope);
}
function rebuildIntent(record,request,mediaReferences,trustedCandidate,expected){
  const next=clone(record),intent=request.intent,rid=request.requestId;
  function event(suffix,event){next.session=appendDesignEvent(next.session,{requestId:rid+'-'+suffix,expectedRevision:next.session.revision,scope:next.session.scope,event}).session;}
  function source(messageId,kind,value){event('source',{type:'source_recorded',source:{messageId,kind,actor:'employee',text:text(value)}});}
  if(next.session.phase==='archive'&&intent.type!=='reopen')fail('WORKFLOW_ARCHIVED');
  if(intent.type==='record_source'){
    exact(intent,['type','kind','text']);if(!['text','speech_transcript'].includes(intent.kind))fail('WORKFLOW_INVALID_SOURCE');source('source:'+rid,intent.kind,intent.text);
  }else if(intent.type==='record_note'){
    exact(intent,['type','field','text']);if(!PREPARED_NOTE_FIELDS.includes(intent.field))fail('WORKFLOW_INVALID_FIELD');
    if(intent.field==='care'&&next.session.phase!=='completed_review')fail('WORKFLOW_CARE_AFTER_ONLY');
    source('note:'+intent.field+':'+rid,'text',intent.text); // Exact original text; field stays explicit metadata in a controlled ID, never a fabricated native field.
  }else if(intent.type==='advance'){
    exact(intent,['type','phase']);if(intent.phase==='archive')fail('WORKFLOW_ARCHIVE_COMMAND_REQUIRED');event('phase',{type:'phase_advanced',phase:intent.phase});
  }else if(intent.type==='create_group'){
    exact(intent,['type','zone','service','side']);if(!DESIGN_ZONES.includes(intent.zone)||!Object.hasOwn(fields,intent.service)||!['left','right','center','bilateral','unknown'].includes(intent.side))fail('WORKFLOW_INVALID_GROUP');
    const entry={id:'entry:'+rid,category:'technique',groupId:'group:'+rid,service:intent.service,side:intent.side,field:intent.service==='perm'?'rod_type':intent.service==='dye'?'color_target':'direction',zone:intent.zone,track:'planned',origin:'extraction',basis:'said',value:null,status:'unknown',sources:[],replacesEntryId:null};event('entry',{type:'entry_recorded',entry});
  }else if(['record_context','record_technique','record_review'].includes(intent.type)){
    exact(intent,intent.type==='record_technique'?['type','groupId','field','track','value','sourceId','quote','replacesEntryId']:['type','field','value','sourceId','quote','replacesEntryId']);
    if(intent.type==='record_context'&&!['requested_style','self_description','visible_outline','visible_hair_shape'].includes(intent.field))fail('WORKFLOW_INVALID_FIELD');
    if(intent.type==='record_review'&&!['observed_result','customer_feedback','employee_review'].includes(intent.field))fail('WORKFLOW_INVALID_FIELD');
    let group=null,category=intent.type==='record_context'?'person_style':intent.type==='record_review'?'result_review':'technique';
    if(category==='technique'){
      group=Object.entries(getDesignView(next.session).zones).flatMap(([zone,value])=>value.groups.map(g=>({...g,zone}))).find(g=>g.groupId===intent.groupId);
      if(!group||!fields[group.service]?.includes(intent.field))fail('WORKFLOW_INVALID_GROUP');
    }
    const value=intent.value;if(category==='technique'&&['rod_size_mm','angle_degrees','turns','time_minutes','temperature_celsius'].includes(intent.field)&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)))fail('WORKFLOW_EXPLICIT_NUMBER_REQUIRED');if(value!==null&&typeof value!=='number'&&typeof value!=='string')fail('WORKFLOW_INVALID_VALUE');
    const refs=value===null?[]:[{messageId:text(intent.sourceId,160),quote:text(intent.quote,2000)}];
    if(value===null&&(intent.sourceId!==null||intent.quote!==null))fail('WORKFLOW_INVALID_SOURCE');
    const entry={id:'entry:'+rid,category,field:intent.field,zone:group?.zone??null,groupId:group?.groupId??null,service:group?.service??null,side:group?.side??null,track:category==='person_style'?'context':category==='result_review'?'actual':intent.track,origin:'extraction',basis:'said',value,status:value===null?'unknown':'not_confirmed',sources:refs,replacesEntryId:intent.replacesEntryId};
    event('entry',{type:'entry_recorded',entry});
  }else if(intent.type==='confirm_entry'){
    exact(intent,['type','entryId','text']);const entry=getDesignView(next.session).entries.find(e=>e.id===intent.entryId);
    if(!entry||entry.value===null||typeof intent.text!=='string'||!intent.text.includes(String(entry.value)))fail('WORKFLOW_CONFIRMATION_INVALID');
    const messageId='confirmation:'+rid;source(messageId,'text',intent.text);
    event('confirm',{type:'entry_confirmed',entryId:entry.id,confirmedValue:entry.value,sources:[{messageId,quote:text(intent.text,2000)}]});
  }else if(intent.type==='archive'){
    exact(intent,['type']);event('archive',{type:'phase_advanced',phase:'archive'});next.archives.push(createDesignArchive(next.session,next.session.scope));
  }else if(intent.type==='reopen'){
    exact(intent,['type','resumePhase','reason']);const parent=next.archives.at(-1);if(!parent)fail('WORKFLOW_ARCHIVE_REQUIRED');
    next.session=createDesignRevision(next.session,parent,{requestId:rid+'-reopen',expectedRevision:next.session.revision,scope:next.session.scope,resumePhase:intent.resumePhase,reasonSource:{messageId:'revision:'+rid,kind:'text',actor:'employee',text:text(intent.reason)}}).session;
  }else if(intent.type==='accept_model_candidate'){
    if([PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(record.schemaVersion))fail('WORKFLOW_CANDIDATE_DENIED');
    exact(intent,['type','candidateId','selectedIndices']);id(intent.candidateId);
    if(!trustedCandidate||trustedCandidate.id!==intent.candidateId||!equal(trustedCandidate.scope,next.scope)||trustedCandidate.store!==next.store)fail('WORKFLOW_CANDIDATE_DENIED');
    const applied=applyTrustedDesignCandidate({session:next.session,candidate:trustedCandidate,selectedIndices:intent.selectedIndices,requestId:rid});
    next.session=applied.session;if(![PREPARED_MANAGED_RECORD_SCHEMA,PREPARED_MANAGED_VIEW_RECORD_SCHEMA,PREPARED_NORMALIZED_RECORD_SCHEMA,PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(next.schemaVersion))next.schemaVersion=PREPARED_MODEL_RECORD_SCHEMA;
    next.modelCandidates=[...(next.modelCandidates||[]),{candidate:clone(trustedCandidate),acceptance:{requestId:rid,workflowRevision:record.revision+1,receipt:clone(applied.acceptedReceipt)}}];
  }else if(intent.type==='accept_managed_candidate'){
    if([PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(record.schemaVersion))fail('WORKFLOW_CANDIDATE_DENIED');
    exact(intent,['type','candidateId','selectedIndices']);
    if(!trustedCandidate)fail('WORKFLOW_CANDIDATE_DENIED');exact(trustedCandidate,['candidate','input']);
    const c=trustedCandidate.candidate,input=trustedCandidate.input;
    if(c.id!==intent.candidateId||!equal(c.scope,next.scope)||c.authority.actor.store!==next.store)fail('WORKFLOW_CANDIDATE_DENIED');
    const workflowBinding={recordRevision:record.revision,recordDigest:hash(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:hash(record.session)};
    const applied=applyTrustedManagedImageCandidate({session:next.session,candidate:c,workflowBinding,selectedIndices:intent.selectedIndices,requestId:rid});
    const history=next.managedImageHistory||{schemaVersion:'design-managed-image-history-v1',inputs:[],accepted:[]},old=history.inputs.find(x=>x.taskId===input.taskId);
    if(input.taskId!==c.imageBinding.taskId||old&&!equal(old,input))fail('WORKFLOW_CANDIDATE_DENIED');
    if(!old)history.inputs.push(clone(input));
    history.accepted.push({candidate:clone(c),acceptance:{requestId:rid,workflowRevision:record.revision+1,authority:clone(c.authority),receipt:clone(applied.acceptedReceipt)}});
    next.session=applied.session;if(![PREPARED_MANAGED_VIEW_RECORD_SCHEMA,PREPARED_NORMALIZED_RECORD_SCHEMA,PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(next.schemaVersion))next.schemaVersion=PREPARED_MANAGED_RECORD_SCHEMA;next.managedImageHistory=history;
  }else if(intent.type==='accept_managed_view_candidate'){
    if([PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(record.schemaVersion))fail('WORKFLOW_CANDIDATE_DENIED');
    exact(intent,['type','candidateId','selectedIndices']);if(!trustedCandidate)fail('WORKFLOW_CANDIDATE_DENIED');exact(trustedCandidate,['candidate','inputs']);
    const c=trustedCandidate.candidate,inputs=trustedCandidate.inputs;if(c.id!==intent.candidateId||!equal(c.scope,next.scope)||c.authority?.actor.store!==next.store||!Array.isArray(inputs))fail('WORKFLOW_CANDIDATE_DENIED');
    const workflowBinding={recordRevision:record.revision,recordDigest:hash(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:hash(record.session)};
    const applied=applyTrustedManagedViewCandidate({session:next.session,candidate:c,workflowBinding,selectedIndices:intent.selectedIndices,requestId:rid,...(next.managedImageHistory?{managedImageHistory:next.managedImageHistory.schemaVersion==='design-managed-image-history-v3'?managedNormalizedLegacyHistory(next.managedImageHistory):next.managedImageHistory}:{})});
    const history=next.managedImageHistory||{schemaVersion:'design-managed-image-history-v2',inputs:[],accepted:[]};if(history.schemaVersion!=='design-managed-image-history-v3')history.schemaVersion='design-managed-image-history-v2';
    for(const input of inputs){const old=history.inputs.find(x=>x.taskId===input.taskId);if(old&&!equal(old,input))fail('WORKFLOW_CANDIDATE_DENIED');if(!old)history.inputs.push(clone(input));}
    history.accepted.push({candidate:clone(c),acceptance:{requestId:rid,workflowRevision:record.revision+1,authority:clone(c.authority),receipt:clone(applied.acceptedReceipt)}});
    next.session=applied.session;if(next.schemaVersion!==PREPARED_NORMALIZED_RECORD_SCHEMA)next.schemaVersion=PREPARED_MANAGED_VIEW_RECORD_SCHEMA;next.managedImageHistory=history;
  }else if(intent.type==='accept_normalized_candidate'){
    if([PREPARED_APPLICATION_RECORD_SCHEMA,PREPARED_APPLICATION_VIEW_RECORD_SCHEMA].includes(record.schemaVersion))fail('WORKFLOW_CANDIDATE_DENIED');exact(intent,['type','candidateId','selectedIndices']);if(!trustedCandidate)fail('WORKFLOW_CANDIDATE_DENIED');exact(trustedCandidate,['candidate','input']);
    const c=trustedCandidate.candidate,input=trustedCandidate.input;if(c.id!==intent.candidateId||!equal(c.scope,next.scope)||c.authority?.actor.store!==next.store)fail('WORKFLOW_CANDIDATE_DENIED');
    const workflowBinding={recordRevision:record.revision,recordDigest:hash(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:hash(record.session)};
    const applied=applyTrustedManagedNormalizedCandidate({session:next.session,candidate:c,workflowBinding,selectedIndices:intent.selectedIndices,requestId:rid,input:{task:input.task,report:input.report}});
    const history=next.managedImageHistory||{schemaVersion:'design-managed-image-history-v3',inputs:[],accepted:[]};history.schemaVersion='design-managed-image-history-v3';
    const old=history.inputs.find(x=>x.taskId===input.taskId);if(input.taskId!==c.normalizedBinding.input.taskId||old&&!equal(old,input))fail('WORKFLOW_CANDIDATE_DENIED');if(!old)history.inputs.push(clone(input));
    history.accepted.push({candidate:clone(c),acceptance:{requestId:rid,workflowRevision:record.revision+1,authority:clone(c.authority),receipt:clone(applied.acceptedReceipt)}});
    next.session=applied.session;next.schemaVersion=PREPARED_NORMALIZED_RECORD_SCHEMA;next.managedImageHistory=history;
  }else if(intent.type==='accept_application_candidate'){
    if(record.schemaVersion===PREPARED_APPLICATION_VIEW_RECORD_SCHEMA)fail('WORKFLOW_CANDIDATE_DENIED');
    exact(intent,['type','candidateId','selectedIndices']);if(!trustedCandidate)fail('WORKFLOW_CANDIDATE_DENIED');exact(trustedCandidate,['candidate','input']);
    const c=trustedCandidate.candidate,input=trustedCandidate.input;if(c.id!==intent.candidateId||!equal(c.scope,next.scope)||c.authority?.actor.store!==next.store)fail('WORKFLOW_CANDIDATE_DENIED');
    const workflowBinding={recordRevision:record.revision,recordDigest:hash(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:hash(record.session)};
    const applied=applyTrustedManagedApplicationCandidate({session:next.session,candidate:c,workflowBinding,selectedIndices:intent.selectedIndices,requestId:rid,input:{task:input.task,report:input.report}});
    const history=next.managedImageHistory||{schemaVersion:'design-managed-image-history-v4',inputs:[],accepted:[]};history.schemaVersion='design-managed-image-history-v4';
    const old=history.inputs.find(x=>x.taskId===input.taskId);if(input.taskId!==c.applicationBinding.input.taskId||old&&!equal(old,input))fail('WORKFLOW_CANDIDATE_DENIED');if(!old)history.inputs.push(clone(input));
    history.accepted.push({candidate:clone(c),acceptance:{requestId:rid,workflowRevision:record.revision+1,authority:clone(c.authority),receipt:clone(applied.acceptedReceipt)}});
    next.session=applied.session;next.schemaVersion=PREPARED_APPLICATION_RECORD_SCHEMA;next.managedImageHistory=history;
  }else if(intent.type==='accept_application_view_candidate'){
    exact(intent,['type','candidateId','selectedIndices']);if(!trustedCandidate)fail('WORKFLOW_CANDIDATE_DENIED');exact(trustedCandidate,['candidate','inputs']);
    const c=trustedCandidate.candidate,inputs=trustedCandidate.inputs;if(c.id!==intent.candidateId||!equal(c.scope,next.scope)||c.authority?.actor.store!==next.store||!Array.isArray(inputs))fail('WORKFLOW_CANDIDATE_DENIED');
    const workflowBinding={recordRevision:record.revision,recordDigest:hash(record),sessionId:record.session.scope.sessionId,sessionRevision:record.session.revision,sessionDigest:hash(record.session)};
    const applied=applyTrustedManagedApplicationViewCandidate({session:next.session,candidate:c,workflowBinding,selectedIndices:intent.selectedIndices,requestId:rid,...(c.kind==='managed_application_completion_comparison'?{inputs}:{managedImageHistory:next.managedImageHistory})});
    const history=next.managedImageHistory||{schemaVersion:'design-managed-image-history-v5',inputs:[],accepted:[]};history.schemaVersion='design-managed-image-history-v5';
    for(const input of inputs){const old=history.inputs.find(x=>x.taskId===input.taskId);if(old&&!equal(old,input))fail('WORKFLOW_CANDIDATE_DENIED');if(!old)history.inputs.push(clone(input));}
    history.accepted.push({candidate:clone(c),acceptance:{requestId:rid,workflowRevision:record.revision+1,authority:clone(c.authority),receipt:clone(applied.acceptedReceipt)}});
    next.session=applied.session;next.schemaVersion=PREPARED_APPLICATION_VIEW_RECORD_SCHEMA;next.managedImageHistory=history;
  }else if(intent.type==='attach_media'){
    exact(intent,['type','mediaIds']);if(!Array.isArray(mediaReferences)||mediaReferences.length!==intent.mediaIds.length)fail('WORKFLOW_MEDIA_DENIED');
    for(const reference of mediaReferences){if(next.photoRefs.some(p=>p.kind==='private_media'&&p.reference.mediaId===reference.mediaId))fail('WORKFLOW_MEDIA_DUPLICATE');next.photoRefs.push({kind:'private_media',scope:next.scope,store:next.store,reference:clone(reference)});}
  }else fail('WORKFLOW_INVALID_INTENT');
  next.revision++;
  if(expected!==undefined){if(!equal(next,expected))fail('WORKFLOW_RECORD_INVALID');return expected;}
  return validatePreparedWorkflowRecord(next,record.scope);
}
function applyIntent(record,request,mediaReferences,trustedCandidate){return rebuildIntent(record,request,mediaReferences,trustedCandidate);}
/** Pure replay proof; not authorization. No caller flag or hash can create a brand. */
export function replayPreparedWorkflowIntentAgainstValidated(input){
  if(nodeTypes.isProxy(input)||!plain(input))fail('WORKFLOW_RECORD_INVALID');
  const allowed=['prior','request','mediaReferences','trustedCandidate','expected'],descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(descriptors).some(key=>!allowed.includes(key)||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable))fail('WORKFLOW_RECORD_INVALID');
  const prior=descriptors.prior?.value,expected=descriptors.expected?.value;
  if(!validatedRecords.has(prior)||!validatedRecords.has(expected))fail('WORKFLOW_RECORD_INVALID');
  // Reject proxies/accessors before checkedIntent can inspect an external request.
  let nodes=0;
  function safe(value,depth=0){
    if(++nodes>750000||depth>80||nodeTypes.isProxy(value))fail('WORKFLOW_RECORD_INVALID');
    if(value===null||['string','boolean'].includes(typeof value))return;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('WORKFLOW_RECORD_INVALID');return;}
    if(typeof value!=='object'||Object.getPrototypeOf(value)!==(Array.isArray(value)?Array.prototype:Object.prototype))fail('WORKFLOW_RECORD_INVALID');
    for(const key of Reflect.ownKeys(value)){if(Array.isArray(value)&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('WORKFLOW_RECORD_INVALID');safe(d.value,depth+1);}
  }
  const raw=descriptors.request?.value;safe(raw);exact(raw,['requestId','expectedRevision','intent']);
  const request={requestId:id(raw.requestId),expectedRevision:raw.expectedRevision,intent:checkedIntent(raw.intent)};
  if(request.expectedRevision!==prior.revision||expected.revision!==prior.revision+1||!equal(prior.scope,expected.scope))fail('WORKFLOW_RECORD_INVALID');
  const mediaReferences=descriptors.mediaReferences?.value??null,trustedCandidate=descriptors.trustedCandidate?.value??null;
  safe(mediaReferences);safe(trustedCandidate);
  return rebuildIntent(prior,request,mediaReferences,trustedCandidate,expected);
}
export function createPreparedWorkflowService({enabled=false,permissionGate,repository,mediaResolver,mediaVerifier,candidateAcceptanceVerifier}={}){
  function configured(){if(enabled!==true)fail('WORKFLOW_DISABLED');if(typeof permissionGate?.authorize!=='function'||typeof repository?.transaction!=='function')fail('WORKFLOW_NOT_CONFIGURED');}
  async function authorize(credential,scope,gate=permissionGate){let grant;try{grant=await gate.authorize(credential,scope);}catch{fail('WORKFLOW_ACCESS_DENIED');}exact(grant,['actor','scope']);exact(grant.actor,['username','store']);if(!equal(grant.scope,scope)||typeof grant.actor.username!=='string'||!grant.actor.username||typeof grant.actor.store!=='string'||!grant.actor.store)fail('WORKFLOW_ACCESS_DENIED');return freeze(clone(grant));}
  async function run(request,write){
    configured();exact(request,write?['credential','scope','requestId','expectedRevision','intent']:['credential','scope']);
    const scope=validateProductionDesignScope(request.scope),credential=request.credential;
    const fixed=write?{requestId:id(request.requestId),expectedRevision:request.expectedRevision,intent:checkedIntent(request.intent)}:null;
    if(write&&(!Number.isSafeInteger(fixed.expectedRevision)||fixed.expectedRevision<0||Buffer.byteLength(JSON.stringify(fixed.intent))>16384))fail('WORKFLOW_INVALID_INTENT');
    const initial=await authorize(credential,scope);let invoked=false,guarded=false,checked,returned=false,acceptedSynthesisId=null;
    try{
      const result=await repository.transaction({grant:initial,scope},async tx=>{
        if(invoked)fail('WORKFLOW_TRANSACTION_INVALID');invoked=true;
        if(typeof tx?.permissionGate?.authorize!=='function'||['read','findReceipt','write','beforeCommit'].some(k=>typeof tx[k]!=='function'))fail('WORKFLOW_NOT_CONFIGURED');
        async function recheck(){if(!equal(await authorize(credential,scope,tx.permissionGate),initial))fail('WORKFLOW_AUTHORIZATION_CHANGED');}
        await recheck();const current=validatePreparedWorkflowRecord(await tx.read(),scope);if(current.store!==initial.actor.store)fail('WORKFLOW_ACCESS_DENIED');
        let record=current,replayed=false;
        async function verifyMedia(value){
          const refs=value.photoRefs.filter(p=>p.kind==='private_media').map(p=>p.reference);if(!refs.length)return;
          if(typeof mediaResolver!=='function')fail('WORKFLOW_MEDIA_DENIED');
          let live;try{live=await mediaResolver({credential,grant:initial,scope,mediaIds:freeze(refs.map(r=>r.mediaId)),transaction:tx});}catch{fail('WORKFLOW_MEDIA_DENIED');}
          if(!equal(live,refs))fail('WORKFLOW_MEDIA_DENIED');
        }
        await verifyMedia(current);
        if(write){
          const key=hash([initial.actor,fixed.requestId]),fingerprint=hash({scope,...fixed});const old=await tx.findReceipt(key);
          if(old!==null){
            exact(old,['fingerprint','scope','actor','appliedRevision','request']);
            if(!equal(old.request,fixed)||old.fingerprint!==fingerprint||!equal(old.scope,scope)||!equal(old.actor,initial.actor)||!Number.isSafeInteger(old.appliedRevision)||old.appliedRevision!==fixed.expectedRevision+1||old.appliedRevision>current.revision)fail('WORKFLOW_REQUEST_CONFLICT');replayed=true;
          }else{
            if(current.revision!==fixed.expectedRevision)fail('WORKFLOW_REVISION_CONFLICT');
            if(current.session.phase==='archive'&&fixed.intent?.type!=='reopen')fail('WORKFLOW_ARCHIVED');
            let refs=null,candidate=null;
            if(fixed.intent?.type==='attach_media'){
              exact(fixed.intent,['type','mediaIds']);if(typeof mediaResolver!=='function'||typeof mediaVerifier!=='function'||!Array.isArray(fixed.intent.mediaIds)||!fixed.intent.mediaIds.length||fixed.intent.mediaIds.length>30||new Set(fixed.intent.mediaIds).size!==fixed.intent.mediaIds.length||fixed.intent.mediaIds.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v)))fail('WORKFLOW_MEDIA_DENIED');
              try{refs=await mediaResolver({credential,grant:initial,scope,mediaIds:freeze([...fixed.intent.mediaIds]),transaction:tx});}catch{fail('WORKFLOW_MEDIA_DENIED');}
              if(!Array.isArray(refs)||!equal(refs.map(r=>r.mediaId),fixed.intent.mediaIds))fail('WORKFLOW_MEDIA_DENIED');
              await recheck();
            }
            if(fixed.intent?.type==='accept_model_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);
              if(typeof tx.readCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate||!equal(candidate.actor,initial.actor)||!equal(candidate.scope,scope)||candidate.store!==initial.actor.store)fail('WORKFLOW_CANDIDATE_DENIED');
              if(candidate.kind==='completion_synthesis'){if(typeof candidateAcceptanceVerifier!=='function')fail('WORKFLOW_CANDIDATE_DENIED');acceptedSynthesisId=candidate.id;}
              await recheck();
            }
            if(fixed.intent?.type==='accept_managed_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);
              if(typeof tx.readManagedCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readManagedCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate?.candidate||!equal(candidate.candidate.authority?.actor,initial.actor)||!equal(candidate.candidate.scope,scope))fail('WORKFLOW_CANDIDATE_DENIED');
              await recheck();
            }
            if(fixed.intent?.type==='accept_managed_view_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);if(typeof tx.readManagedViewCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readManagedViewCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate?.candidate||!equal(candidate.candidate.authority?.actor,initial.actor)||!equal(candidate.candidate.scope,scope))fail('WORKFLOW_CANDIDATE_DENIED');await recheck();
            }
            if(fixed.intent?.type==='accept_normalized_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);if(typeof tx.readNormalizedCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readNormalizedCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate?.candidate||!equal(candidate.candidate.authority?.actor,initial.actor)||!equal(candidate.candidate.scope,scope))fail('WORKFLOW_CANDIDATE_DENIED');await recheck();
            }
            if(fixed.intent?.type==='accept_application_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);if(typeof tx.readApplicationCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readApplicationCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate?.candidate||!equal(candidate.candidate.authority?.actor,initial.actor)||!equal(candidate.candidate.scope,scope))fail('WORKFLOW_CANDIDATE_DENIED');await recheck();
            }
            if(fixed.intent?.type==='accept_application_view_candidate'){
              exact(fixed.intent,['type','candidateId','selectedIndices']);id(fixed.intent.candidateId);if(typeof tx.readApplicationViewCandidate!=='function')fail('WORKFLOW_CANDIDATE_DENIED');
              try{candidate=await tx.readApplicationViewCandidate(fixed.intent.candidateId);}catch{fail('WORKFLOW_CANDIDATE_DENIED');}
              if(!candidate?.candidate||!equal(candidate.candidate.authority?.actor,initial.actor)||!equal(candidate.candidate.scope,scope))fail('WORKFLOW_CANDIDATE_DENIED');await recheck();
            }
            try{record=applyIntent(current,fixed,refs,candidate);}catch(error){if(error instanceof PreparedWorkflowError)throw error;fail('WORKFLOW_CONTRACT_REJECTED');}
            await recheck();const receipt={fingerprint,scope,actor:initial.actor,appliedRevision:record.revision,request:clone(fixed)};
            if(await tx.write({expectedRevision:current.revision,record,receiptKey:key,receipt})!==true)fail('WORKFLOW_REVISION_CONFLICT');
            if(!equal(await tx.read(),record)||!equal(await tx.findReceipt(key),receipt))fail('WORKFLOW_TRANSACTION_INVALID');
          }
        }
        await recheck();await tx.beforeCommit(async()=>{await verifyMedia(record);await recheck();guarded=true;});checked=freeze({record:clone(record),replayed});return checked;
      });returned=true;
      if(!invoked||!guarded||!equal(result,checked))fail('WORKFLOW_TRANSACTION_INVALID');
      const refs=checked.record.photoRefs.filter(p=>p.kind==='private_media').map(p=>p.reference);
      if(refs.length){
        if(typeof mediaVerifier!=='function')fail('WORKFLOW_MEDIA_DENIED');
        let live;try{live=await mediaVerifier({credential,grant:initial,scope,mediaIds:freeze(refs.map(r=>r.mediaId))});}catch{fail('WORKFLOW_MEDIA_DENIED');}
        if(!equal(live,refs))fail('WORKFLOW_MEDIA_DENIED');
      }
      if(!equal(await authorize(credential,scope),initial))fail('WORKFLOW_AUTHORIZATION_CHANGED');
      // Only a newly committed synthesis needs current ancestor checks here.
      // History loads and exact already-committed replay retain archival semantics.
      if(acceptedSynthesisId&&!checked.replayed&&await candidateAcceptanceVerifier({credential,scope,actor:initial.actor,candidateId:acceptedSynthesisId})!==true)fail('WORKFLOW_CANDIDATE_DENIED');
      return checked;
    }catch(error){if(returned&&write)throw new PreparedWorkflowError('WORKFLOW_OUTCOME_UNCERTAIN','uncertain');if(error instanceof PreparedWorkflowError)throw error;throw new PreparedWorkflowError('WORKFLOW_OUTCOME_UNCERTAIN','uncertain');}
  }
  return Object.freeze({load:request=>run(request,false),dispatch:request=>run(request,true),async snapshot(request){const {record}=await run(request,false);const snapshot=createFullWorkflowSnapshot({scope:record.scope,store:record.store,bindings:{uiScope:null,evidenceScope:record.session.scope},ui:null,evidence:{session:record.session,archives:record.archives},legacyVersions:record.legacyVersions,photoRefs:record.photoRefs,...(record.modelCandidates?{modelCandidates:record.modelCandidates}:{}),...(record.managedImageHistory?{managedImageHistory:record.managedImageHistory}:{})});return freeze({snapshot,saved:false,requiresAuthoritativeSourceVerification:true});}});
}

// Pure replay used by the durable repository to verify persisted intent history.
export {applyIntent as applyPreparedWorkflowIntent};
