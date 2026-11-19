#!/usr/bin/env node
/** Synthetic, pure integrity tests. No data, credentials, provider, database or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as ev from '../packages/analysis-engine/design-pilot.mjs';
import {DESIGN_CANDIDATE_SCHEMA,DESIGN_COMPARISON_OUTPUTS,designCandidateDigest,buildVisualCandidateParts,buildCompletionCandidateParts,buildSynthesisEvidence,buildSynthesisCandidateParts,designSynthesisReviewChoices,validateSynthesisEvidence,applyTrustedDesignCandidate} from '../packages/analysis-engine/design-candidate.mjs';
import {CandidateHistoryError,reconstructCandidateSessionPrefix,validateAcceptedCandidateHistory,validateDesignCandidatePhotoRefs} from '../packages/analysis-engine/design-candidate-history.mjs';
import {PREPARED_MODEL_RECORD_SCHEMA,validatePreparedWorkflowRecord} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import * as full from '../packages/design-production-adapter/full-workflow-archive.mjs';
globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},store='synthetic-store',actor={username:'synthetic-employee',store};
const nativeScope={customerId:'11',visitId:'booking:101',sessionId:'synthetic-history'};
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const hashBytes=v=>createHash('sha256').update(v).digest('hex');
const append=(session,event,requestId='manual-'+session.revision)=>ev.appendDesignEvent(session,{requestId,expectedRevision:session.revision,scope:session.scope,event}).session;
const base=()=>ev.createDesignSession(nativeScope);
const photo=()=>({kind:'private_media',scope:copy(scope),store,reference:{mediaId:'synthetic-photo',stage:'before',angle:'front',mime:'image/png',byteLength:70,width:1,height:1}});
function envelope(session,id,kind,parts={}){
  return {schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind,scope:copy(scope),store,actor:copy(actor),sessionId:session.scope.sessionId,baseRevision:session.revision,inputDigest:designCandidateDigest(session),payloadDigest:'a'.repeat(64),model:'synthetic-model',promptVersion:'synthetic-prompt-v1',sourceRefs:[],descriptionSources:[],...parts};
}
function textCandidate(session,id='text-one'){
  const entry=(field,value,index)=>({id:'extracted:'+id+':'+index,category:'person_style',field,zone:null,...(session.schemaVersion===ev.DESIGN_SCHEMA_VERSION?{groupId:null,service:null,side:null}:{}),track:'context',origin:'extraction',basis:'said',value,status:'not_confirmed',sources:[{messageId:'original-text',quote:'我想要短发，风格自然。'}],replacesEntryId:null});
  return envelope(session,id,'text_extraction',{candidate:{phase:session.phase,entries:[entry('requested_style','短发',0),entry('self_description','自然',1)],questions:['【合成测试】保留未选择条目？'],warnings:['【合成测试】  保留原始空格  ']}});
}
function visualCandidate(session,id='visual-one'){
  return envelope(session,id,'visual_description',{...buildVisualCandidateParts({id,session,observations:[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:'中长发轮廓'}]}),sourceRefs:[{mediaId:'synthetic-photo',sourceSha256:'b'.repeat(64),derivativeSha256:'c'.repeat(64)}]});
}
function accept(session,candidate,selectedIndices,requestId,workflowRevision){
  const applied=applyTrustedDesignCandidate({session,candidate,selectedIndices,requestId});
  return {session:applied.session,row:{candidate:copy(candidate),acceptance:{requestId,workflowRevision,receipt:copy(applied.acceptedReceipt)}}};
}
function fixture(){
  let session=append(base(),{type:'source_recorded',source:{messageId:'original-text',kind:'text',actor:'employee',text:'  【合成测试】我想要短发，风格自然。  '}});
  const first=accept(session,textCandidate(session),[0],'accept-text',2);session=first.session;
  session=append(session,{type:'source_recorded',source:{messageId:'extra-context',kind:'text',actor:'employee',text:'【合成测试】不补写未知技术参数。'}});
  const second=accept(session,visualCandidate(session),[1,0],'accept-visual',4);session=second.session;
  return {session,scope:copy(scope),store,modelCandidates:[first.row,second.row],photoRefs:[photo()],workflowRevision:4};
}
function completionCandidate(session,{id='comparison-one',angle='front',output=DESIGN_COMPARISON_OUTPUTS[0]}={}){
  return envelope(session,id,'completion_comparison',{
    ...buildCompletionCandidateParts({id,session,output,angle}),comparison:{beforeMediaId:'synthetic-photo',afterMediaId:'synthetic-after',angle},
    sourceRefs:[{mediaId:'synthetic-photo',sourceSha256:'b'.repeat(64),derivativeSha256:'c'.repeat(64)},{mediaId:'synthetic-after',sourceSha256:'d'.repeat(64),derivativeSha256:'e'.repeat(64)}]
  });
}
function completionFixture({angle='front',output=DESIGN_COMPARISON_OUTPUTS[0],prior=false,human=false}={}){
  const f=prior?fixture():{session:base(),scope:copy(scope),store,modelCandidates:[],photoRefs:[photo()],workflowRevision:0};
  for(const phase of ['proposal','execution','completed_review']){f.session=append(f.session,{type:'phase_advanced',phase});f.workflowRevision++;}
  if(human){
    const source={messageId:'human-result',kind:'text',actor:'employee',text:'【合成测试】员工现场观察原文，保留独立确认。'};
    f.session=append(f.session,{type:'source_recorded',source});
    f.session=append(f.session,{type:'entry_recorded',entry:{id:'human-observed-result',category:'result_review',field:'observed_result',zone:null,groupId:null,service:null,side:null,track:'actual',origin:'extraction',basis:'said',value:source.text,status:'not_confirmed',sources:[{messageId:source.messageId,quote:source.text}],replacesEntryId:null}});
    f.session=append(f.session,{type:'entry_confirmed',entryId:'human-observed-result',confirmedValue:source.text,sources:[{messageId:source.messageId,quote:source.text}]});f.workflowRevision+=3;
  }
  f.photoRefs[0].reference.angle=angle;
  const after=photo();Object.assign(after.reference,{mediaId:'synthetic-after',stage:'after',angle});f.photoRefs.push(after);f.workflowRevision++;
  const accepted=accept(f.session,completionCandidate(f.session,{angle,output}),[0],'accept-comparison',++f.workflowRevision);
  f.session=accepted.session;f.modelCandidates.push(accepted.row);return f;
}
function appendComparison(f,{angle,id='comparison-'+angle+'-'+f.modelCandidates.length,output=DESIGN_COMPARISON_OUTPUTS[0]}={}){
  const sourceRefs=['before','after'].map(stage=>{
    const mediaId=id+'-'+stage,attached=photo();Object.assign(attached.reference,{mediaId,stage,angle});f.photoRefs.push(attached);
    return {mediaId,sourceSha256:digest({mediaId,original:true}),derivativeSha256:digest({mediaId,original:false})};
  });
  const candidate=envelope(f.session,id,'completion_comparison',{...buildCompletionCandidateParts({id,session:f.session,output,angle}),comparison:{beforeMediaId:sourceRefs[0].mediaId,afterMediaId:sourceRefs[1].mediaId,angle},sourceRefs});
  const accepted=accept(f.session,candidate,[0],'accept-'+id,++f.workflowRevision);f.session=accepted.session;f.modelCandidates.push(accepted.row);return accepted.row;
}
function appendSynthesis(f,{side='left',id='synthesis-'+side+'-'+f.modelCandidates.length}={}){
  const evidence=buildSynthesisEvidence({session:f.session,modelCandidates:f.modelCandidates,side});
  const candidate=envelope(f.session,id,'completion_synthesis',{...evidence,...buildSynthesisCandidateParts({id,session:f.session,synthesis:evidence.synthesis}),...(evidence.synthesis.generation==='deterministic'?{model:'server-deterministic'}:{})});
  const accepted=accept(f.session,candidate,[0],'accept-'+id,++f.workflowRevision);f.session=accepted.session;f.modelCandidates.push(accepted.row);return accepted.row;
}
function synthesisFixture({side='left',angles=['front','back',side],outputs=[],prior=false,human=false}={}){
  const f=completionFixture({angle:angles[0],output:outputs[0]??DESIGN_COMPARISON_OUTPUTS[0],prior,human});
  for(let i=1;i<angles.length;i++)appendComparison(f,{angle:angles[i],output:outputs[i]??DESIGN_COMPARISON_OUTPUTS[0]});
  appendSynthesis(f,{side});return f;
}
function rewriteLastSynthesis(f,change){
  const row=f.modelCandidates.at(-1),prefix=reconstructCandidateSessionPrefix(f.session,row.candidate.baseRevision),candidate=copy(row.candidate);change(candidate);
  Object.assign(candidate,buildSynthesisCandidateParts({id:candidate.id,session:prefix,synthesis:candidate.synthesis}));
  const applied=accept(prefix,candidate,[0],row.acceptance.requestId,row.acceptance.workflowRevision);f.session=applied.session;f.modelCandidates[f.modelCandidates.length-1]=applied.row;
}
const mediaInput=f=>({candidate:f.modelCandidates.at(-1).candidate,photoRefs:f.photoRefs,scope:f.scope,store:f.store});
const workflowInput=f=>({schemaVersion:PREPARED_MODEL_RECORD_SCHEMA,revision:f.workflowRevision,scope:f.scope,store:f.store,session:f.session,archives:[],photoRefs:f.photoRefs,legacyVersions:[],modelCandidates:f.modelCandidates});
function snapshotInput(input){return {scope:input.scope,store:input.store,bindings:{uiScope:null,evidenceScope:input.session.scope},ui:null,evidence:{session:input.session,archives:[]},legacyVersions:[],photoRefs:input.photoRefs,...(input.modelCandidates===undefined?{}:{modelCandidates:input.modelCandidates})};}
function version(snapshot,previous=null){
  const number=(previous?.version??0)+1,body={schemaVersion:full.FULL_WORKFLOW_VERSION_SCHEMA,version:number,previous:previous?{version:previous.version,sha256:previous.sha256}:null,scope:copy(scope),actor:copy(actor),requestId:'full-'+number,createdAt:'2026-11-15T00:00:00.000Z',bindingRevision:'synthetic-binding',snapshot};
  return {...body,sha256:digest(body)};
}
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof CandidateHistoryError&&e.message===e.code&&(!code||e.code===code));

test('old v1 object, canonical bytes and both hashes match captured 7f41c0ff baseline',()=>{
  const input=snapshotInput({session:base(),scope,store,photoRefs:[]}),snapshot=full.createFullWorkflowSnapshot(input),encoded=full.serializeFullWorkflowSnapshot(snapshot);
  assert.equal(snapshot.schemaVersion,full.FULL_WORKFLOW_SCHEMA);assert.equal(Object.hasOwn(snapshot,'modelCandidates'),false);
  assert.equal(snapshot.sha256,'2b1d8b49a17d9399f7b38258a4be2debac4590700483825e73b3030621b86596');
  assert.equal(hashBytes(encoded),'c5efa47e70488e3fdf7596a90e90d10d89479ec4603ece3ede3b0740e9ae3983');assert.equal(Buffer.byteLength(encoded),1070);
  assert.deepEqual(full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(encoded)),input);
});
test('v2 roundtrip keeps complete text and visual envelopes, selection and original source digests',()=>{
  const f=fixture(),snapshot=full.createFullWorkflowSnapshot(snapshotInput(f)),encoded=full.serializeFullWorkflowSnapshot(snapshot);
  const unpacked=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(encoded));
  assert.equal(snapshot.schemaVersion,full.FULL_WORKFLOW_MODEL_SCHEMA);assert.deepEqual(unpacked,snapshotInput(f));
  assert.deepEqual(validateAcceptedCandidateHistory(f),f.modelCandidates);assert.equal(unpacked.modelCandidates[0].candidate.candidate.entries.length,2);
  assert.deepEqual(unpacked.modelCandidates[1].candidate.sourceRefs,visualCandidate(reconstructCandidateSessionPrefix(f.session,3)).sourceRefs);
  assert.deepEqual(unpacked.modelCandidates[1].acceptance.receipt.selectedIndices,[0,1]);assert.equal(f.session.entries.length,3);
  assert(snapshot.index.some(row=>row.kind==='candidate'&&row.path==='/modelCandidates/1/candidate'&&row.nativeIdentity.candidateId==='visual-one'));
  assert(snapshot.index.some(row=>row.kind==='acceptance'&&row.nativeIdentity.requestId==='accept-visual'&&row.nativeIdentity.workflowRevision===4));
  assert(Object.isFrozen(unpacked.modelCandidates[0].candidate.candidate.entries));
});
test('original inputs stay unmodified and validated histories are detached and recursively frozen',()=>{
  const f=fixture(),before=canonical(f),rows=validateAcceptedCandidateHistory(f);
  assert.equal(canonical(f),before);assert(Object.isFrozen(rows[1].candidate.sourceRefs[0]));f.modelCandidates[0].candidate.model='changed';assert.equal(rows[0].candidate.model,'synthetic-model');
});
test('later employee confirmation does not rewrite candidate or historical acceptance',()=>{
  const f=fixture(),entry=f.session.entries.find(e=>e.field==='visible_outline');
  f.session=append(f.session,{type:'source_recorded',source:{messageId:'confirmation',kind:'text',actor:'employee',text:'【合成测试】确认轮廓偏圆。'}});
  f.session=append(f.session,{type:'entry_confirmed',entryId:entry.id,confirmedValue:entry.value,sources:[{messageId:'confirmation',quote:'确认轮廓偏圆。'}]});f.workflowRevision++;
  assert.equal(f.session.entries.find(e=>e.id===entry.id).status,'confirmed');validateAcceptedCandidateHistory(f);
  assert.equal(reconstructCandidateSessionPrefix(f.session,7).entries.find(e=>e.id===entry.id).status,'not_confirmed');assert.equal(f.modelCandidates[1].candidate.candidate.entries[0].status,'not_confirmed');
});
test('altering candidate model, payload or original unselected content invalidates the accepted receipt',()=>{
  for(const change of [f=>f.modelCandidates[0].candidate.model='forged-model',f=>f.modelCandidates[0].candidate.payloadDigest='f'.repeat(64),f=>f.modelCandidates[0].candidate.candidate.warnings[0]='changed unselected warning',f=>f.modelCandidates[0].candidate.candidate.entries.pop()]){
    const f=fixture();change(f);rejects(()=>validateAcceptedCandidateHistory(f));
  }
});
test('receipt tampering, injected fields, request changes, wrong revisions and selection changes reject',()=>{
  for(const change of [r=>r.receipt.candidateDigest='d'.repeat(64),r=>r.receipt.inputDigest='d'.repeat(64),r=>r.receipt.candidateId='forged',r=>r.receipt.kind='visual_description',r=>r.receipt.resultRevision++,r=>r.receipt.baseRevision--,r=>r.receipt.selectedIndices=[1],r=>r.receipt.selectedIndices=[],r=>r.receipt.selectedIndices=[0,0],r=>r.receipt.selectedIndices=[100],r=>r.requestId='forged-accept',r=>r.extra='SENSITIVE_MUST_NOT_LEAK']){
    const f=fixture();change(f.modelCandidates[0].acceptance);rejects(()=>validateAcceptedCandidateHistory(f));
  }
  const f=fixture();f.modelCandidates[1].acceptance.receipt.selectedIndices=[1,0];rejects(()=>validateAcceptedCandidateHistory(f),'CANDIDATE_HISTORY_RECEIPT_MISMATCH');
});
test('source hashes and media IDs remain exact, present and bound to the same visit and store',()=>{
  for(const change of [f=>f.modelCandidates[1].candidate.sourceRefs[0].sourceSha256='d'.repeat(64),f=>f.modelCandidates[1].acceptance.receipt.sourceRefs[0].derivativeSha256='d'.repeat(64),f=>f.photoRefs=[],f=>f.photoRefs[0].scope.visitId='booking:102',f=>f.photoRefs[0].store='other-store',f=>f.modelCandidates[1].candidate.scope.assignmentSource='frontdesk',f=>f.modelCandidates[1].candidate.actor.store='other-store',f=>f.photoRefs[0].reference.mediaId='other-media']){
    const f=fixture();change(f);rejects(()=>validateAcceptedCandidateHistory(f));
  }
});
test('history order, overlap, duplicate candidates/requests and future workflow revisions reject',()=>{
  for(const change of [f=>f.modelCandidates.reverse(),f=>f.modelCandidates.push(copy(f.modelCandidates[1])),f=>f.modelCandidates[1].acceptance.workflowRevision=2,f=>f.modelCandidates[1].acceptance.workflowRevision=5,f=>f.modelCandidates[0].acceptance.workflowRevision=0,f=>f.modelCandidates[1].acceptance.requestId=f.modelCandidates[0].acceptance.requestId,f=>f.modelCandidates[1].candidate.id=f.modelCandidates[0].candidate.id]){
    const f=fixture();change(f);rejects(()=>validateAcceptedCandidateHistory(f));
  }
  const f=fixture();delete f.workflowRevision;validateAcceptedCandidateHistory(f);
});
test('self-consistent modified receipt still must reproduce final native journal events exactly',()=>{
  const f=fixture(),row=f.modelCandidates[0],prefix=reconstructCandidateSessionPrefix(f.session,row.candidate.baseRevision);
  row.acceptance.requestId='other-request';row.acceptance.receipt=applyTrustedDesignCandidate({session:prefix,candidate:row.candidate,selectedIndices:[0],requestId:row.acceptance.requestId}).acceptedReceipt;
  rejects(()=>validateAcceptedCandidateHistory(f),'CANDIDATE_HISTORY_JOURNAL_MISMATCH');
});
test('bounded exact JSON rejects null photos, getters without executing them, sparse arrays and cyclic data',()=>{
  for(const change of [f=>f.photoRefs=[null],f=>f.modelCandidates[0].candidate.injected='SENSITIVE',f=>f.modelCandidates[0].acceptance.receipt.extra=1,f=>f.modelCandidates=new Array(2),f=>f.modelCandidates[0].candidate.self=f.modelCandidates[0].candidate,f=>f.modelCandidates[0].candidate.model='x'.repeat(65537),f=>f.modelCandidates=Array(1001).fill(f.modelCandidates[0])]){
    const f=fixture();change(f);rejects(()=>validateAcceptedCandidateHistory(f));
  }
  let invoked=false;const f=fixture();Object.defineProperty(f.modelCandidates[0].candidate,'model',{enumerable:true,get(){invoked=true;throw Error('SENSITIVE');}});rejects(()=>validateAcceptedCandidateHistory(f));assert.equal(invoked,false);
});
test('reconstruction handles native v1 to v2 migration without changing old session or candidate bytes',()=>{
  let legacy=copy(base());legacy.schemaVersion=ev.LEGACY_DESIGN_SCHEMA_VERSION;
  legacy=append(legacy,{type:'source_recorded',source:{messageId:'original-text',kind:'text',actor:'employee',text:'【合成测试】我想要短发，风格自然。'}});
  const first=accept(legacy,textCandidate(legacy,'legacy-text'),[0],'accept-legacy',1),oldBytes=canonical(first.session),oldCandidate=canonical(first.row.candidate);
  const migrated=ev.migrateDesignSession(first.session,{requestId:'explicit-migrate',expectedRevision:first.session.revision,scope:nativeScope}).session;
  const second=accept(migrated,visualCandidate(migrated),[0],'accept-new',3);
  const f={session:second.session,scope,store,modelCandidates:[first.row,second.row],photoRefs:[photo()],workflowRevision:3};
  validateAcceptedCandidateHistory(f);assert.equal(canonical(reconstructCandidateSessionPrefix(f.session,2)),oldBytes);assert.equal(canonical(first.row.candidate),oldCandidate);
  assert.equal(reconstructCandidateSessionPrefix(f.session,0).schemaVersion,ev.LEGACY_DESIGN_SCHEMA_VERSION);assert.equal(reconstructCandidateSessionPrefix(f.session,3).schemaVersion,ev.DESIGN_SCHEMA_VERSION);
  assert.deepEqual(full.unpackFullWorkflowSnapshot(full.createFullWorkflowSnapshot(snapshotInput(f))),snapshotInput(f));
});
test('reconstruction rejects invalid final projection and out-of-range revisions',()=>{
  const f=fixture();for(const revision of [-1,1.2,NaN,f.session.revision+1,'1'])rejects(()=>reconstructCandidateSessionPrefix(f.session,revision));
  f.session=copy(f.session);f.session.entries[0].value='forged';rejects(()=>reconstructCandidateSessionPrefix(f.session,1),'CANDIDATE_HISTORY_SESSION_INVALID');
});
test('v1 to v2 full version chain is valid and preserves the previous v1 snapshot byte-for-byte',()=>{
  const f=fixture(),firstSnapshot=full.createFullWorkflowSnapshot(snapshotInput({session:base(),scope,store,photoRefs:[]})),oldBytes=full.serializeFullWorkflowSnapshot(firstSnapshot),first=version(firstSnapshot),second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);
  assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);assert.equal(full.serializeFullWorkflowSnapshot(first.snapshot),oldBytes);assert.equal(second.schemaVersion,full.FULL_WORKFLOW_VERSION_SCHEMA);
});
test('reverse v2 to v1 transition and deleting any established candidate history are rejected',()=>{
  const f=fixture(),first=version(full.createFullWorkflowSnapshot(snapshotInput(f)));
  const omitted=snapshotInput(f);delete omitted.modelCandidates;
  const dropped=snapshotInput({...f,modelCandidates:f.modelCandidates.slice(0,1)});
  for(const input of [omitted,dropped])assert.throws(()=>full.validateFullWorkflowChain([first,version(full.createFullWorkflowSnapshot(input),first)],scope),e=>e.code==='FULL_HISTORY_REWRITE');
});
test('individually valid rewritten provenance cannot replace established candidate history',()=>{
  const f=fixture(),first=version(full.createFullWorkflowSnapshot(snapshotInput(f)));f.modelCandidates[0].candidate.model='another-valid-model';f.modelCandidates[0].acceptance.receipt.candidateDigest=designCandidateDigest(f.modelCandidates[0].candidate);
  validateAcceptedCandidateHistory(f);const rewritten=full.createFullWorkflowSnapshot(snapshotInput(f));
  assert.throws(()=>full.validateFullWorkflowChain([first,version(rewritten,first)],scope),e=>e.code==='FULL_HISTORY_REWRITE');
});
test('v2 requires a nonempty explicit lane and rejects schema downgrades or changed indexes',()=>{
  const f=fixture(),input=snapshotInput(f);assert.throws(()=>full.createFullWorkflowSnapshot({...input,modelCandidates:[]}),e=>e.code==='FULL_MODEL_HISTORY_INVALID');
  validateAcceptedCandidateHistory({...f,modelCandidates:[]});
  for(const change of [s=>s.schemaVersion=full.FULL_WORKFLOW_SCHEMA,s=>delete s.modelCandidates,s=>s.index.pop(),s=>s.modelCandidates[0].acceptance.receipt.selectedIndices=[1]]){
    const snapshot=copy(full.createFullWorkflowSnapshot(input));change(snapshot);const {sha256,...body}=snapshot;snapshot.sha256=digest(body);assert.throws(()=>full.validateFullWorkflowSnapshot(snapshot));
  }
  assert.throws(()=>full.createFullWorkflowSnapshot(null),e=>e.code==='FULL_INVALID_FIELDS');assert.throws(()=>full.validateFullWorkflowSnapshot(null),e=>e.code==='FULL_INVALID_FIELDS');
});
test('v2 appends a later accepted candidate while preserving the full earlier envelope and receipt',()=>{
  const f=fixture(),earlier={...f,session:reconstructCandidateSessionPrefix(f.session,2),modelCandidates:f.modelCandidates.slice(0,1),photoRefs:[]};
  const first=version(full.createFullWorkflowSnapshot(snapshotInput(earlier))),second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);
  assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);assert.deepEqual(second.snapshot.modelCandidates[0],first.snapshot.modelCandidates[0]);
});
test('every migrated/archive/reopened prefix is exactly the native session originally produced',()=>{
  let session=copy(base());session.schemaVersion=ev.LEGACY_DESIGN_SCHEMA_VERSION;const original=[copy(session)];
  function record(event){session=append(session,event);original.push(copy(session));}
  record({type:'source_recorded',source:{messageId:'legacy-source',kind:'text',actor:'employee',text:'【合成测试】杠径22。'}});
  record({type:'phase_advanced',phase:'proposal'});
  record({type:'entry_recorded',entry:{id:'legacy-technical',category:'technique',field:'rod_size_mm',zone:'top',track:'planned',origin:'extraction',basis:'said',value:22,status:'not_confirmed',sources:[{messageId:'legacy-source',quote:'杠径22。'}],replacesEntryId:null}});
  record({type:'entry_confirmed',entryId:'legacy-technical',confirmedValue:22,sources:[{messageId:'legacy-source',quote:'杠径22。'}]});
  for(const phase of ['execution','completed_review','archive'])record({type:'phase_advanced',phase});
  session=ev.migrateDesignSession(session,{scope:nativeScope,requestId:'migration',expectedRevision:session.revision}).session;original.push(copy(session));
  session=ev.createDesignRevision(session,ev.createDesignArchive(session,nativeScope),{scope:nativeScope,requestId:'reopen',expectedRevision:session.revision,resumePhase:'proposal',reasonSource:{messageId:'reopen-reason',kind:'text',actor:'employee',text:'【合成测试】保留全部历史并修订。'}}).session;original.push(copy(session));
  for(const phase of ['execution','completed_review','archive'])record({type:'phase_advanced',phase});
  for(let revision=0;revision<original.length;revision++)assert.deepEqual(reconstructCandidateSessionPrefix(session,revision),original[revision]);
});
test('maximum native source history reconstructs bounded middle and final checkpoints without loss',()=>{
  let session=copy(base());
  for(let i=0;i<1000;i++){const source={messageId:'bounded-source-'+i,kind:'text',actor:'employee',text:'【合成测试】原文'};session.sources.push(source);session.journal.push({requestId:'bounded-request-'+i,expectedRevision:i,scope:nativeScope,event:{type:'source_recorded',source}});}session.revision=1000;session=ev.validateDesignSession(session);
  const middle=reconstructCandidateSessionPrefix(session,750);assert.equal(middle.revision,750);assert.deepEqual(middle.journal,session.journal.slice(0,750));assert.deepEqual(middle.sources,session.sources.slice(0,750));assert.deepEqual(reconstructCandidateSessionPrefix(session,1000),session);
});
test('old text/visual envelopes, acceptance and full snapshot hashes match bd3fcea3 without added comparison fields',()=>{
  const f=fixture(),snapshot=full.createFullWorkflowSnapshot(snapshotInput(f));
  assert.deepEqual(f.modelCandidates.map(row=>({candidate:designCandidateDigest(row.candidate),acceptance:digest(row.acceptance)})),[
    {candidate:'467fa5eac3ad2375aa613cbf32180da89c0f8d24c1ef8f532e6f06c8b3a83e03',acceptance:'942a84e09e71671b4e0b8adf4d92fe78b607c032b649f90ad591d74e669b81dd'},
    {candidate:'c54857f1a990ee4acf94e8f967aad707582a3f707cd59c6afe054dd746fc1aaf',acceptance:'0a3ed2be8eca6076302d393001c115029b3241fdea2c531a16b20758e2340fcb'}
  ]);
  assert.equal(snapshot.sha256,'9b4305a88254613e5ccc9df062b82f910468b3850548cba51c441188c5dde698');
  assert.equal(hashBytes(full.serializeFullWorkflowSnapshot(snapshot)),'d8087d14bdde30a183a3263fb06f9f7ec4b3a29af41829739dd75c87bc5e630b');
  for(const row of f.modelCandidates){assert.equal(Object.hasOwn(row.candidate,'comparison'),false);assert.equal(Object.hasOwn(row.acceptance.receipt,'comparison'),false);}
});
test('completion comparison preserves full candidate, two ordered digests, receipt and workflow/full readback',()=>{
  const f=completionFixture({prior:true,human:true}),before=canonical(f),rows=validateAcceptedCandidateHistory(f),row=rows.at(-1);
  assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);assert.equal(canonical(f),before);
  assert.equal(row.candidate.schemaVersion,DESIGN_CANDIDATE_SCHEMA);assert.equal(row.candidate.candidate.phase,'completed_review');
  assert.deepEqual(row.candidate.comparison,{beforeMediaId:'synthetic-photo',afterMediaId:'synthetic-after',angle:'front'});
  assert.deepEqual(row.acceptance.receipt.sourceRefs,row.candidate.sourceRefs);assert.equal(row.acceptance.receipt.sourceRefs.length,2);
  const entry=row.candidate.candidate.entries[0];assert.equal(entry.field,'model_photo_comparison_front');assert.equal(entry.category,'result_review');assert.equal(entry.track,'actual');assert.equal(entry.basis,'observable');assert.equal(entry.status,'not_confirmed');assert.equal(entry.replacesEntryId,null);
  assert.equal(row.candidate.descriptionSources[0].kind,'image_description');assert.equal(row.candidate.descriptionSources[0].actor,'model');
  assert.equal(f.session.entries.find(e=>e.id==='human-observed-result').status,'confirmed');
  const record=workflowInput(f);assert.deepEqual(validatePreparedWorkflowRecord(record,f.scope),record);
  const snapshot=full.createFullWorkflowSnapshot(snapshotInput(f)),loaded=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(snapshot)));
  assert.deepEqual(loaded,snapshotInput(f));assert.deepEqual(loaded.modelCandidates,f.modelCandidates);
  assert(snapshot.index.some(i=>i.kind==='candidate'&&i.nativeIdentity.kind==='completion_comparison'));
  assert(Object.isFrozen(rows.at(-1).candidate.comparison));assert(Object.isFrozen(loaded.modelCandidates.at(-1).acceptance.receipt.sourceRefs[1]));
});
test('all finite comparison outcomes and all supported common angles retain unconfirmed model evidence',()=>{
  for(const angle of ['front','back','left','right'])for(const output of DESIGN_COMPARISON_OUTPUTS){
    const f=completionFixture({angle,output}),row=validateAcceptedCandidateHistory(f)[0];
    assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);assert.equal(row.candidate.candidate.entries.length,1);
    assert.equal(row.candidate.candidate.entries[0].status,'not_confirmed');assert.equal(row.candidate.comparison.angle,angle);
    if(output.comparability==='not_comparable')assert(row.candidate.candidate.entries[0].value.includes('无法比较：'+output.reason));
  }
});
test('comparison requires both attached private photos with exact before/after stages and common declared angle',()=>{
  const changes=[
    f=>f.photoRefs.pop(),f=>f.photoRefs.shift(),f=>f.photoRefs=[],
    f=>f.photoRefs[0].reference.stage='after',f=>f.photoRefs[1].reference.stage='before',
    f=>f.photoRefs[0].reference.stage='reference',f=>f.photoRefs[1].reference.stage='reference',
    f=>f.photoRefs[0].reference.angle='back',f=>f.photoRefs[1].reference.angle='left',
    f=>f.photoRefs.forEach(p=>p.reference.angle='detail'),f=>f.photoRefs.forEach(p=>p.reference.angle='back'),
    f=>f.photoRefs[1].reference.mediaId='unrelated-after',f=>f.photoRefs.push(copy(f.photoRefs[1]))
  ];
  for(const change of changes){const f=completionFixture();change(f);rejects(()=>validateDesignCandidatePhotoRefs(mediaInput(f)));rejects(()=>validateAcceptedCandidateHistory(f));assert.throws(()=>validatePreparedWorkflowRecord(workflowInput(f),f.scope),e=>e.code==='WORKFLOW_RECORD_INVALID');assert.throws(()=>full.createFullWorkflowSnapshot(snapshotInput(f)));}
  const f=completionFixture();f.photoRefs.reverse();assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);validateAcceptedCandidateHistory(f);
});
test('legacy assets cannot substitute either private comparison original even with an identical ID and metadata',()=>{
  for(const index of [0,1]){
    const f=completionFixture(),row=f.modelCandidates[0],mediaId='11111111-1111-4111-8111-111111111111',ref=f.photoRefs[index].reference;
    ref.mediaId=mediaId;row.candidate.comparison[index===0?'beforeMediaId':'afterMediaId']=mediaId;row.candidate.sourceRefs[index].mediaId=mediaId;
    const prefix=reconstructCandidateSessionPrefix(f.session,row.candidate.baseRevision);
    row.acceptance.receipt=copy(applyTrustedDesignCandidate({session:prefix,candidate:row.candidate,selectedIndices:[0],requestId:row.acceptance.requestId}).acceptedReceipt);
    validateAcceptedCandidateHistory(f);
    f.photoRefs[index]={kind:'legacy_asset',assetId:mediaId,scope:copy(scope),store,stage:ref.stage,angle:ref.angle};
    rejects(()=>validateDesignCandidatePhotoRefs(mediaInput(f)),'CANDIDATE_HISTORY_MEDIA_MISSING');rejects(()=>validateAcceptedCandidateHistory(f),'CANDIDATE_HISTORY_MEDIA_MISSING');
  }
});
test('comparison metadata, ordered source hashes and exact acceptance receipt reject corruption',()=>{
  const changes=[
    r=>delete r.candidate.comparison,r=>r.candidate.comparison=null,r=>r.candidate.comparison.extra='injected',
    r=>r.candidate.comparison.beforeMediaId=r.candidate.comparison.afterMediaId,r=>r.candidate.comparison.angle='detail',
    r=>r.candidate.sourceRefs.reverse(),r=>r.candidate.sourceRefs.pop(),r=>r.candidate.sourceRefs.push(copy(r.candidate.sourceRefs[0])),
    r=>delete r.candidate.sourceRefs[1].derivativeSha256,r=>r.candidate.sourceRefs[0].sourceSha256='f'.repeat(64),r=>r.candidate.sourceRefs[1].derivativeSha256='f'.repeat(64),
    r=>r.acceptance.receipt.sourceRefs.reverse(),r=>r.acceptance.receipt.sourceRefs.pop(),r=>r.acceptance.receipt.sourceRefs.push(copy(r.acceptance.receipt.sourceRefs[0])),
    r=>r.acceptance.receipt.sourceRefs[1].sourceSha256='f'.repeat(64),r=>r.acceptance.receipt.selectedIndices=[1],r=>r.acceptance.receipt.kind='visual_description',
    r=>r.candidate.descriptionSources[0].actor='employee',r=>r.candidate.candidate.entries[0].field='observed_result',r=>r.candidate.candidate.entries[0].status='confirmed'
  ];
  for(const change of changes){const f=completionFixture();change(f.modelCandidates[0]);rejects(()=>validateAcceptedCandidateHistory(f));}
});
test('photo binding helper independently rejects malformed pair, sources, scope and hidden accessors without mutation',()=>{
  const changes=[
    x=>x.candidate.kind='unknown',x=>x.candidate.sourceRefs=[],x=>x.candidate.sourceRefs.reverse(),x=>x.candidate.sourceRefs[0].sourceSha256='bad',x=>delete x.candidate.sourceRefs[1].derivativeSha256,
    x=>x.candidate.comparison.angle='detail',x=>x.candidate.comparison.afterMediaId=x.candidate.comparison.beforeMediaId,x=>x.candidate.comparison.angle='back',
    x=>x.scope.visitId='booking:102',x=>x.candidate.scope.customerProfileId='12',x=>x.candidate.store='other-store',x=>x.photoRefs[1].scope.visitId='booking:102',x=>x.photoRefs[1].store='other-store',x=>x.photoRefs=[null]
  ];
  for(const change of changes){const input=copy(mediaInput(completionFixture()));change(input);rejects(()=>validateDesignCandidatePhotoRefs(input));}
  let invoked=false;const input=copy(mediaInput(completionFixture()));Object.defineProperty(input.candidate.comparison,'angle',{enumerable:true,get(){invoked=true;throw Error('SENSITIVE');}});rejects(()=>validateDesignCandidatePhotoRefs(input));assert.equal(invoked,false);
  const f=fixture();assert.equal(validateDesignCandidatePhotoRefs({candidate:f.modelCandidates[0].candidate,photoRefs:[],scope,store}),true);
  f.photoRefs[0].reference.stage='reference';f.photoRefs[0].reference.angle='detail';const before=canonical(f);
  assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);validateAcceptedCandidateHistory(f);assert.equal(canonical(f),before);
});
test('completion append preserves prior candidate bytes and full history rejects independently consistent provenance rewrites',()=>{
  const prior=fixture(),first=version(full.createFullWorkflowSnapshot(snapshotInput(prior))),bytes=full.serializeFullWorkflowSnapshot(first.snapshot),f=completionFixture({prior:true});
  const second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);
  assert.equal(full.serializeFullWorkflowSnapshot(first.snapshot),bytes);assert.deepEqual(second.snapshot.modelCandidates.slice(0,2),first.snapshot.modelCandidates);
  const thirdInput=copy(f),row=thirdInput.modelCandidates.at(-1);row.candidate.sourceRefs[1].sourceSha256='f'.repeat(64);
  row.acceptance.receipt.sourceRefs=copy(row.candidate.sourceRefs);row.acceptance.receipt.candidateDigest=designCandidateDigest(row.candidate);
  validateAcceptedCandidateHistory(thirdInput);const third=version(full.createFullWorkflowSnapshot(snapshotInput(thirdInput)),second);
  assert.throws(()=>full.validateFullWorkflowChain([first,second,third],scope),e=>e.code==='FULL_HISTORY_REWRITE');
  const dropped={...f,modelCandidates:f.modelCandidates.slice(0,-1)};assert.throws(()=>full.validateFullWorkflowChain([first,second,version(full.createFullWorkflowSnapshot(snapshotInput(dropped)),second)],scope),e=>e.code==='FULL_HISTORY_REWRITE');
});
test('pre-synthesis comparison envelope, receipt and full bytes match the captured a48f1e77 baseline',()=>{
  const f=completionFixture({prior:true,human:true}),row=f.modelCandidates.at(-1),snapshot=full.createFullWorkflowSnapshot(snapshotInput(f));
  assert.equal(designCandidateDigest(row.candidate),'b5b136cf21a66d60e04031b5dc27310514f34bcb68077b0891449e449be64c73');
  assert.equal(digest(row.acceptance),'b5ff534e48ca94ce1b3cac04a98bbcaee45d763362ddded266871885b2ffdb25');
  assert.equal(snapshot.sha256,'ef00bba380e7e0480ab698cf0f5ac9dbc3f2b711391b51d9af90b6510d26dfed');
  assert.equal(hashBytes(full.serializeFullWorkflowSnapshot(snapshot)),'900dbf1359169fd816936e4e493d575e663d65c222379563643dde9ab76801a4');
  for(const row of f.modelCandidates)assert.equal(Object.hasOwn(row.candidate,'synthesis'),false);
});
test('left and right synthesis preserve accepted ancestors, six ordered originals and complete workflow/full readback',()=>{
  for(const side of ['left','right']){
    const f=synthesisFixture({side,prior:true,human:true}),original=canonical(f),rows=validateAcceptedCandidateHistory(f),row=rows.at(-1),entry=row.candidate.candidate.entries[0];
    assert.equal(canonical(f),original);assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);
    assert.equal(row.candidate.schemaVersion,DESIGN_CANDIDATE_SCHEMA);assert.equal(row.candidate.kind,'completion_synthesis');
    assert.deepEqual(row.candidate.synthesis.evidence.map(e=>e.angle),['front','back',side]);
    assert.deepEqual(row.candidate.sourceRefs,rows.filter(r=>r.candidate.kind==='completion_comparison').flatMap(r=>r.candidate.sourceRefs));
    assert.deepEqual(row.acceptance.receipt.sourceRefs,row.candidate.sourceRefs);assert.equal(row.candidate.sourceRefs.length,6);
    for(const evidence of row.candidate.synthesis.evidence){const ancestor=rows.find(r=>r.candidate.id===evidence.candidateId);assert.equal(evidence.candidateDigest,designCandidateDigest(ancestor.candidate));assert.equal(evidence.acceptanceRequestId,ancestor.acceptance.requestId);assert.equal(evidence.entryStatus,'not_confirmed');}
    assert.equal(entry.field,'model_completion_synthesis_'+side);assert.equal(entry.origin,'suggestion');assert.equal(entry.basis,'inferred');assert.equal(entry.track,'actual');assert.equal(entry.status,'not_confirmed');assert.equal(entry.replacesEntryId,null);
    assert.equal(row.candidate.descriptionSources[0].kind,'model_synthesis');assert.equal(row.candidate.descriptionSources[0].actor,'model');assert.equal(f.session.entries.find(e=>e.id==='human-observed-result').status,'confirmed');
    assert.deepEqual(validatePreparedWorkflowRecord(workflowInput(f),f.scope),workflowInput(f));
    const snapshot=full.createFullWorkflowSnapshot(snapshotInput(f)),loaded=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(snapshot)));
    assert.deepEqual(loaded,snapshotInput(f));assert(snapshot.index.some(i=>i.kind==='candidate'&&i.nativeIdentity.kind==='completion_synthesis'));
    assert(Object.isFrozen(rows.at(-1).candidate.synthesis.evidence[0].judgment));assert(Object.isFrozen(loaded.modelCandidates.at(-1).acceptance.receipt.sourceRefs[5]));
  }
});
test('partial, missing, uncomparable and conflicting angle evidence remain explicit without borrowing another side',()=>{
  for(const side of ['left','right'])for(const angles of [['front'],['back'],[side],['front','back'],['front',side],['back',side]]){
    const f=synthesisFixture({side,angles}),synthesis=validateAcceptedCandidateHistory(f).at(-1).candidate.synthesis;
    assert.deepEqual(synthesis.missingAngles,['front','back',side].filter(a=>!angles.includes(a)));assert.equal(synthesis.assessment,'limited_evidence');
    assert.deepEqual(synthesis.evidence.map(e=>e.angle),angles);assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);
  }
  for(const output of DESIGN_COMPARISON_OUTPUTS){
    const f=synthesisFixture({angles:['front'],outputs:[output]}),synthesis=validateAcceptedCandidateHistory(f).at(-1).candidate.synthesis;
    assert.deepEqual(synthesis.evidence[0].judgment,output);assert.deepEqual(synthesis.uncomparableAngles,output.comparability==='not_comparable'?['front']:[]);
  }
  for(const angles of [['front','back'],['front','back','left']]){
    const f=synthesisFixture({angles,outputs:[DESIGN_COMPARISON_OUTPUTS[1],DESIGN_COMPARISON_OUTPUTS[2],DESIGN_COMPARISON_OUTPUTS[1]]}),synthesis=validateAcceptedCandidateHistory(f).at(-1).candidate.synthesis;
    assert.deepEqual(synthesis.conflictingAngles,angles);assert.equal(synthesis.assessment,angles.length===3?'potential_conflict':'limited_evidence');
  }
  const f=completionFixture({angle:'right'});appendComparison(f,{angle:'front'});appendSynthesis(f,{side:'left'});
  assert.deepEqual(validateAcceptedCandidateHistory(f).at(-1).candidate.synthesis.missingAngles,['back','left']);
  assert.deepEqual(f.modelCandidates.at(-1).candidate.synthesis.evidence.map(e=>e.angle),['front']);
});
test('synthesis rejects corrupted metadata, ancestry identities, order, hashes and acceptance selections',()=>{
  const changes=[
    c=>delete c.synthesis,c=>c.synthesis=null,c=>c.synthesis.extra='injected',c=>c.synthesis.side='bilateral',
    c=>c.synthesis.evidence=[],c=>c.synthesis.evidence.reverse(),c=>c.synthesis.evidence.push(copy(c.synthesis.evidence[0])),
    c=>c.synthesis.evidence[0].candidateId='other-candidate',c=>c.synthesis.evidence[0].candidateDigest='f'.repeat(64),
    c=>c.synthesis.evidence[0].entryId='comparison-entry:other-candidate:0',c=>c.synthesis.evidence[0].acceptanceRequestId='other-acceptance',
    c=>c.synthesis.evidence[0].entryStatus='confirmed',c=>c.synthesis.evidence[0].angle='right',c=>c.synthesis.evidence[0].extra='injected',
    c=>c.synthesis.evidence[0].judgment.change='unsupported causal claim',c=>c.synthesis.missingAngles=['left'],
    c=>c.synthesis.uncomparableAngles=['front'],c=>c.synthesis.conflictingAngles=['front'],c=>c.synthesis.assessment='potential_conflict',
    c=>delete c.synthesis.generation,c=>delete c.synthesis.reviewFocus,c=>c.synthesis.generation='deterministic',c=>c.synthesis.reviewFocus={kind:'unsupported_claim',angles:['front']},c=>c.synthesis.reviewFocus={kind:'confirm_angle_judgment',angles:['right']},c=>c.model='server-deterministic',
    c=>c.sourceRefs.reverse(),c=>c.sourceRefs.pop(),c=>c.sourceRefs.push(copy(c.sourceRefs[0])),c=>c.sourceRefs[0].sourceSha256='f'.repeat(64),c=>c.sourceRefs[5].derivativeSha256='f'.repeat(64),
    c=>c.descriptionSources[0].kind='image_description',c=>c.descriptionSources[0].actor='employee',c=>c.candidate.entries[0].basis='observable',c=>c.candidate.entries[0].status='confirmed'
  ];
  for(const change of changes){const f=synthesisFixture(),row=f.modelCandidates.at(-1);change(row.candidate);row.acceptance.receipt.candidateDigest=designCandidateDigest(row.candidate);rejects(()=>validateAcceptedCandidateHistory(f));}
  for(const change of [r=>r.receipt.sourceRefs.pop(),r=>r.receipt.sourceRefs.reverse(),r=>r.receipt.kind='completion_comparison',r=>r.receipt.selectedIndices=[1],r=>r.receipt.resultRevision++,r=>r.workflowRevision=1]){
    const f=synthesisFixture();change(f.modelCandidates.at(-1).acceptance);rejects(()=>validateAcceptedCandidateHistory(f));
  }
});
test('individually valid native comparisons without their prior accepted artifacts cannot support a synthesis',()=>{
  for(const change of [f=>f.modelCandidates.splice(0,1),f=>f.modelCandidates.splice(1,1),f=>f.modelCandidates=f.modelCandidates.slice(-1),f=>f.modelCandidates[0].acceptance.receipt.resultRevision=f.modelCandidates.at(-1).candidate.baseRevision+1]){
    const f=synthesisFixture();change(f);rejects(()=>validateAcceptedCandidateHistory(f));
  }
  const f=synthesisFixture(),row=f.modelCandidates.at(-1),prefix=reconstructCandidateSessionPrefix(f.session,row.candidate.baseRevision),prior=f.modelCandidates.slice(0,-1);
  prior[0].acceptance.receipt.resultRevision=prefix.revision+1;
  assert.throws(()=>validateSynthesisEvidence({candidate:row.candidate,session:prefix,modelCandidates:prior}));
});
test('self-consistent summary and receipt cannot omit an available accepted angle or relabel its ancestry',()=>{
  const omitted=synthesisFixture();rewriteLastSynthesis(omitted,c=>{
    c.synthesis.evidence.splice(1,1);c.sourceRefs.splice(2,2);c.synthesis.missingAngles=['back'];c.synthesis.assessment='limited_evidence';
  });rejects(()=>validateAcceptedCandidateHistory(omitted),'CANDIDATE_HISTORY_CANDIDATE_INVALID');
  for(const change of [e=>e.candidateDigest='f'.repeat(64),e=>e.acceptanceRequestId='different-accepted-request']){
    const f=synthesisFixture();rewriteLastSynthesis(f,c=>change(c.synthesis.evidence[0]));rejects(()=>validateAcceptedCandidateHistory(f),'CANDIDATE_HISTORY_CANDIDATE_INVALID');
  }
});
test('synthesis photo helper keeps all six scoped private originals and exact per-ancestor stages and angles',()=>{
  for(let index=0;index<6;index++){
    for(const change of [f=>f.photoRefs.splice(index,1),f=>f.photoRefs[index].reference.stage='reference',f=>f.photoRefs[index].reference.angle='detail',f=>f.photoRefs[index].scope.visitId='booking:102',f=>f.photoRefs[index].store='other-store']){
      const f=synthesisFixture();change(f);rejects(()=>validateDesignCandidatePhotoRefs(mediaInput(f)));rejects(()=>validateAcceptedCandidateHistory(f));
    }
  }
  for(const change of [c=>c.sourceRefs=[],c=>c.sourceRefs.push(copy(c.sourceRefs[0])),c=>c.sourceRefs[1]=copy(c.sourceRefs[0]),c=>[c.sourceRefs[0],c.sourceRefs[1]]=[c.sourceRefs[1],c.sourceRefs[0]],c=>c.synthesis.evidence.reverse(),c=>c.synthesis.evidence[0].angle='right',c=>c.synthesis.side='both']){
    const f=synthesisFixture();change(f.modelCandidates.at(-1).candidate);rejects(()=>validateDesignCandidatePhotoRefs(mediaInput(f)));
  }
  const f=synthesisFixture();f.photoRefs.reverse();const before=canonical(f);assert.equal(validateDesignCandidatePhotoRefs(mediaInput(f)),true);validateAcceptedCandidateHistory(f);assert.equal(canonical(f),before);
  let invoked=false;const input=copy(mediaInput(synthesisFixture()));Object.defineProperty(input.candidate.synthesis.evidence[0],'angle',{enumerable:true,get(){invoked=true;throw Error('SENSITIVE');}});rejects(()=>validateDesignCandidatePhotoRefs(input));assert.equal(invoked,false);
});
test('later confirmation, opposite side and supersession never recompute or rewrite an older synthesis',()=>{
  const f=synthesisFixture(),saved=canonical(f.modelCandidates),summary=f.modelCandidates.at(-1),beforeSummary=reconstructCandidateSessionPrefix(f.session,summary.candidate.baseRevision),front=f.session.entries.find(e=>e.id===summary.candidate.synthesis.evidence[0].entryId);
  const source={messageId:'confirm-ancestor',kind:'text',actor:'employee',text:'【合成测试】确认先前正面逐角度判断。'};
  f.session=append(f.session,{type:'source_recorded',source});f.session=append(f.session,{type:'entry_confirmed',entryId:front.id,confirmedValue:front.value,sources:[{messageId:source.messageId,quote:source.text}]});f.workflowRevision+=2;
  validateAcceptedCandidateHistory(f);assert.equal(summary.candidate.synthesis.evidence[0].entryStatus,'not_confirmed');
  const confirmed=appendSynthesis(f,{side:'left'});assert.equal(confirmed.candidate.synthesis.evidence[0].entryStatus,'confirmed');assert.equal(confirmed.candidate.candidate.entries[0].status,'not_confirmed');
  appendComparison(f,{angle:'right',output:DESIGN_COMPARISON_OUTPUTS[2]});appendSynthesis(f,{side:'right'});
  const replacement=appendComparison(f,{angle:'front',output:DESIGN_COMPARISON_OUTPUTS[1]});const latest=appendSynthesis(f,{side:'left'});
  assert.equal(latest.candidate.synthesis.evidence[0].candidateId,replacement.candidate.id);assert.equal(latest.candidate.synthesis.evidence[0].entryStatus,'not_confirmed');assert.equal(latest.candidate.candidate.entries[0].replacesEntryId,confirmed.candidate.candidate.entries[0].id);
  validateAcceptedCandidateHistory(f);assert.equal(canonical(f.modelCandidates.slice(0,4)),saved);
  assert.deepEqual(reconstructCandidateSessionPrefix(f.session,summary.candidate.baseRevision),beforeSummary);
  assert.deepEqual(full.unpackFullWorkflowSnapshot(full.createFullWorkflowSnapshot(snapshotInput(f))).modelCandidates,f.modelCandidates);
});
test('changed ancestor provenance invalidates an older synthesis even when that ancestor receipt is rehashed',()=>{
  for(const change of [r=>r.candidate.model='another-valid-model',r=>r.candidate.sourceRefs[0].sourceSha256='f'.repeat(64),r=>r.candidate.sourceRefs[1].derivativeSha256='f'.repeat(64)]){
    const f=synthesisFixture(),ancestor=f.modelCandidates[0];change(ancestor);ancestor.acceptance.receipt.candidateDigest=designCandidateDigest(ancestor.candidate);ancestor.acceptance.receipt.sourceRefs=copy(ancestor.candidate.sourceRefs);
    validateAcceptedCandidateHistory({...f,session:reconstructCandidateSessionPrefix(f.session,f.modelCandidates.at(-1).candidate.baseRevision),modelCandidates:f.modelCandidates.slice(0,-1)});
    rejects(()=>validateAcceptedCandidateHistory(f),'CANDIDATE_HISTORY_CANDIDATE_INVALID');
  }
});
test('full history preserves append-only synthesis lanes and rejects coherently rewritten JSON ancestry',()=>{
  const f=synthesisFixture({prior:true,human:true}),originalRows=canonical(f.modelCandidates),first=version(full.createFullWorkflowSnapshot(snapshotInput(f))),firstBytes=full.serializeFullWorkflowSnapshot(first.snapshot);
  appendComparison(f,{angle:'front',output:DESIGN_COMPARISON_OUTPUTS[1]});appendSynthesis(f,{side:'left'});
  const second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);
  assert.equal(full.serializeFullWorkflowSnapshot(first.snapshot),firstBytes);assert.equal(canonical(second.snapshot.modelCandidates.slice(0,first.snapshot.modelCandidates.length)),originalRows);
  const changed=copy(f),ancestor=changed.modelCandidates.find(r=>r.candidate.kind==='completion_comparison');ancestor.candidate.model='another-valid-model';ancestor.acceptance.receipt.candidateDigest=designCandidateDigest(ancestor.candidate);
  for(const row of changed.modelCandidates.filter(r=>r.candidate.kind==='completion_synthesis')){
    const evidence=row.candidate.synthesis.evidence.find(e=>e.candidateId===ancestor.candidate.id);if(evidence)evidence.candidateDigest=ancestor.acceptance.receipt.candidateDigest;
    row.acceptance.receipt.candidateDigest=designCandidateDigest(row.candidate);
  }
  // Consistent declared JSON hashes do not establish original bytes or authority.
  validateAcceptedCandidateHistory(changed);const rewritten=version(full.createFullWorkflowSnapshot(snapshotInput(changed)),second);
  assert.throws(()=>full.validateFullWorkflowChain([first,second,rewritten],scope),e=>e.code==='FULL_HISTORY_REWRITE');
  const dropped={...f,modelCandidates:f.modelCandidates.slice(0,-1)};validateAcceptedCandidateHistory(dropped);
  assert.throws(()=>full.validateFullWorkflowChain([first,second,version(full.createFullWorkflowSnapshot(snapshotInput(dropped)),second)],scope),e=>e.code==='FULL_HISTORY_REWRITE');
});
test('deterministic summaries keep server provenance and confirmed ancestors without confirming the new inference',()=>{
  for(const angles of [['front'],['front','back','left']]){
    const f=completionFixture();for(const angle of angles.slice(1))appendComparison(f,{angle});
    for(const row of f.modelCandidates){
      const entry=row.candidate.candidate.entries[0],source={messageId:'confirm-'+row.candidate.id,kind:'text',actor:'employee',text:'【合成测试】确认所选逐角度判断。'};
      f.session=append(f.session,{type:'source_recorded',source});f.session=append(f.session,{type:'entry_confirmed',entryId:entry.id,confirmedValue:entry.value,sources:[{messageId:source.messageId,quote:source.text}]});f.workflowRevision+=2;
    }
    const summary=appendSynthesis(f),synthesis=summary.candidate.synthesis;
    assert.equal(synthesis.generation,'deterministic');assert.equal(designSynthesisReviewChoices(synthesis).length,1);assert.equal(summary.candidate.model,'server-deterministic');
    assert.equal(summary.candidate.descriptionSources[0].kind,'server_synthesis');assert.equal(summary.candidate.descriptionSources[0].actor,'system');assert(synthesis.evidence.every(e=>e.entryStatus==='confirmed'));
    assert.equal(summary.candidate.candidate.entries[0].status,'not_confirmed');assert.equal(summary.candidate.candidate.entries[0].basis,'inferred');validateAcceptedCandidateHistory(f);
    assert.deepEqual(full.unpackFullWorkflowSnapshot(full.createFullWorkflowSnapshot(snapshotInput(f))).modelCandidates,f.modelCandidates);
    for(const change of [c=>c.model='synthetic-model',c=>c.descriptionSources[0].kind='model_synthesis',c=>c.descriptionSources[0].actor='model',c=>c.synthesis.generation='model_review_focus']){
      const changed=copy(f);change(changed.modelCandidates.at(-1).candidate);rejects(()=>validateAcceptedCandidateHistory(changed));
    }
  }
});
test('chosen valid model review focus is immutable evidence rather than recomputed to the first choice',()=>{
  const f=synthesisFixture(),choices=designSynthesisReviewChoices(f.modelCandidates.at(-1).candidate.synthesis);assert(choices.length>1);
  rewriteLastSynthesis(f,c=>{c.synthesis.reviewFocus=copy(choices.at(-1));});
  validateAcceptedCandidateHistory(f);const first=version(full.createFullWorkflowSnapshot(snapshotInput(f))),preserved=canonical(f.modelCandidates.at(-1));
  appendComparison(f,{angle:'back',output:DESIGN_COMPARISON_OUTPUTS[4]});appendSynthesis(f);
  const second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);assert.equal(canonical(f.modelCandidates[3]),preserved);
});
test('a partial historical synthesis retains its missing angles after later accepted evidence completes the views',()=>{
  const f=synthesisFixture({angles:['front']}),old=copy(f.modelCandidates.at(-1)),first=version(full.createFullWorkflowSnapshot(snapshotInput(f)));
  appendComparison(f,{angle:'back'});appendComparison(f,{angle:'left'});const latest=appendSynthesis(f);
  validateAcceptedCandidateHistory(f);assert.deepEqual(old.candidate.synthesis.missingAngles,['back','left']);assert.deepEqual(latest.candidate.synthesis.missingAngles,[]);assert.deepEqual(f.modelCandidates[1],old);
  const second=version(full.createFullWorkflowSnapshot(snapshotInput(f)),first);assert.equal(full.validateFullWorkflowChain([first,second],scope).length,2);assert.deepEqual(second.snapshot.modelCandidates[1],first.snapshot.modelCandidates[1]);
});
