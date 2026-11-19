/** Synthetic, in-memory composition only. No database authority, decoder,
 * model, private binary storage or network is established by this fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedFixture,scopeA,credential,copy} from './fixtures/design-prepared-fixture.mjs';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {buildManagedImageResultCandidate} from '../packages/analysis-engine/managed-image-result-candidate.mjs';
import {DESIGN_CANDIDATE_SCHEMA,buildVisualCandidateParts,designCandidateDigest as digest} from '../packages/analysis-engine/design-candidate.mjs';
import {getDesignView} from '../packages/analysis-engine/design-pilot.mjs';
import {createPreparedWorkflowRecord,createPreparedWorkflowService,validatePreparedWorkflowRecord,replayPreparedWorkflowIntentAgainstValidated,PREPARED_MANAGED_RECORD_SCHEMA} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import * as full from '../packages/design-production-adapter/full-workflow-archive.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const rejects=(work,code)=>assert.rejects(work,e=>e.code===code);
const originalText='  【合成测试】保留原话 <img src=x>。\n不是模型推断，也不是已执行。  ';
const originalSpeech='  【合成测试】口述原文：左侧实际合成杠乙。\n保留换行。  ';

function legacyVersion(){
 const steps=Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k=>[k,'']));
 return {id:'20000000-0000-4000-8000-000000000001',requestId:'30000000-0000-4000-8000-000000000001',versionNumber:1,previousVersionId:null,createdAt:'2026-11-15T00:00:00Z',actor:{username:'synthetic-employee',store:'synthetic-store'},scope:copy(scopeA),snapshot:{baseline:{outline:'【合成测试】旧档原话',root_flow:'',steps},optimized:{outline:'',root_flow:'',steps:copy(steps)},reasons:{outline:'',root_flow:'',...steps},execution:{},process:{proposal:'【合成测试】旧方案'},review:{},status:'baseline',photo_ids:[],archive_url:null}};
}

function fixture({legacy=false,missingReader=false}={}){
 const base=preparedFixture(),managed=new Map(),old=new Map();let sequence=0,managedReads=0;
 if(legacy){const current=base.record();base.state.records.set('11',createPreparedWorkflowRecord({scope:scopeA,store:current.store,session:current.session,legacyVersions:[legacyVersion()]}));}
 const repository={transaction:(context,work)=>base.repository.transaction(context,tx=>{
  const wrapped={...tx,readCandidate:async id=>copy(old.get(id)??null)};
  if(!missingReader)wrapped.readManagedCandidate=async id=>{managedReads++;return copy(managed.get(id)??null);};
  return work(wrapped);
 })};
 const service=createPreparedWorkflowService({enabled:true,permissionGate:base.gate,repository,mediaResolver:base.mediaResolver,mediaVerifier:base.mediaResolver});
 const request=(intent,extra={})=>({credential,scope:scopeA,requestId:'managed-workflow-'+(++sequence),expectedRevision:base.record().revision,intent,...extra});
 const dispatch=q=>service.dispatch(q);
 const send=(intent,extra={})=>dispatch(request(intent,extra));
 function publishManaged(id='managed-output',observations){
  const record=base.record(),f=managedImageResultFixture({session:record.session,recordRevision:record.revision,id});
  const candidateInput=copy(f.candidateInput);candidateInput.workflowBinding.recordDigest=digest(record);
  if(observations)candidateInput.observations=observations;
  const candidate=buildManagedImageResultCandidate(candidateInput),row={candidate:copy(candidate),input:copy(f.input)};
  managed.set(id,row);return copy(row);
 }
 function publishOld(id){
  const r=base.record(),s=r.session;
  const candidate={schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind:'visual_description',scope:scopeA,store:r.store,actor:copy(base.state.actor),sessionId:s.scope.sessionId,baseRevision:s.revision,inputDigest:digest(s),payloadDigest:'e'.repeat(64),model:'synthetic-old-model',promptVersion:'old-prompt',sourceRefs:[{mediaId:'synthetic-before',sourceSha256:'a'.repeat(64),derivativeSha256:'b'.repeat(64)}],...buildVisualCandidateParts({id,session:s,observations:[{field:'visible_outline',value:'轮廓偏方'}]})};
  old.set(id,candidate);return copy(candidate);
 }
 return {...base,service,repository,request,dispatch,send,publishManaged,publishOld,managed,old,managedReads:()=>managedReads,
  accept:(candidateId='managed-output',selectedIndices=[0,1],extra={})=>send({type:'accept_managed_candidate',candidateId,selectedIndices},extra)};
}
async function toPhase(h,target){
 const phases=['before_analysis','proposal','execution','completed_review'];
 while(h.record().session.phase!==target)await h.send({type:'advance',phase:phases[phases.indexOf(h.record().session.phase)+1]});
}
async function withOldLanes(){
 const h=fixture({legacy:true});
 await h.send({type:'record_source',kind:'text',text:originalText});
 await h.send({type:'record_source',kind:'speech_transcript',text:originalSpeech});
 await h.send({type:'attach_media',mediaIds:['synthetic-before']});
 h.publishOld('old-before-managed');
 await h.send({type:'accept_model_candidate',candidateId:'old-before-managed',selectedIndices:[0]});
 return h;
}

test('loaded managed output does not mutate workflow until ID-only explicit adoption',async()=>{
 const h=fixture(),before=h.record(),row=h.publishManaged();
 assert.deepEqual((await h.service.load({credential,scope:scopeA})).record,before);
 assert.equal(h.state.writes,0);assert.equal(h.managedReads(),0);
 const out=await h.accept();assert.equal(out.replayed,false);
 assert.equal(out.record.schemaVersion,PREPARED_MANAGED_RECORD_SCHEMA);
 assert.equal(out.record.revision,before.revision+1);
 assert.deepEqual(out.record.managedImageHistory.inputs,[row.input]);
 const accepted=out.record.managedImageHistory.accepted[0];
 assert.deepEqual(accepted.candidate,row.candidate);assert.deepEqual(accepted.acceptance.authority,row.candidate.authority);
 assert.equal(accepted.acceptance.workflowRevision,out.record.revision);
 assert(out.record.session.entries.every(e=>e.status==='not_confirmed'&&e.track==='context'&&e.basis==='observable'));
 assert(out.record.session.sources.every(s=>s.actor==='model'&&s.kind==='image_description'));
 assert.equal(out.record.session.entries.filter(e=>e.track==='actual').length,0);
 assert.deepEqual(h.managed.get('managed-output'),row);
});

test('selected managed unknown remains unknown; no hidden second entry or automatic confirmation',async()=>{
 const h=fixture();h.publishManaged('unknown-output',[{field:'visible_outline',value:null},{field:'visible_hair_shape',value:'中长发轮廓'}]);
 const out=await h.accept('unknown-output',[0]);
 assert.equal(out.record.session.entries.length,1);assert.equal(out.record.session.entries[0].status,'unknown');
 assert.equal(out.record.session.entries[0].value,null);assert.deepEqual(out.record.session.entries[0].sources,[]);
 assert.deepEqual(out.record.managedImageHistory.accepted[0].acceptance.receipt.selectedIndices,[0]);
 await rejects(()=>h.send({type:'confirm_entry',entryId:out.record.session.entries[0].id,text:'确认未知'}),'WORKFLOW_CONFIRMATION_INVALID');
});

test('original confirmation remains a separate employee event and never turns observation into actual work',async()=>{
 const h=fixture();const row=h.publishManaged();await h.accept();const originalLane=copy(h.record().managedImageHistory),entry=h.record().session.entries[0];
 await rejects(()=>h.send({type:'confirm_entry',entryId:entry.id,text:'确认另一项'}),'WORKFLOW_CONFIRMATION_INVALID');
 const confirmation='【合成测试】本人核对并确认'+entry.value+'，并非已做任何工序。';
 const out=await h.send({type:'confirm_entry',entryId:entry.id,text:confirmation});
 assert.equal(getDesignView(out.record.session).entries.find(e=>e.id===entry.id).status,'confirmed');
 assert.equal(out.record.session.sources.at(-1).text,confirmation);assert.equal(out.record.session.sources.at(-1).actor,'employee');
 assert.equal(out.record.session.journal.at(-1).event.type,'entry_confirmed');
 assert.deepEqual(out.record.managedImageHistory,originalLane);assert.deepEqual(h.managed.get(row.candidate.id),row);
 assert.equal(out.record.managedImageHistory.accepted[0].candidate.candidate.entries[0].status,'not_confirmed');
 assert(out.record.session.entries.every(e=>e.track==='context'));assert.equal(out.record.session.phase,'before_analysis');
});

test('old model/photo/legacy lanes and verbatim text/speech stay byte-identical through managed adoption',async()=>{
 const h=await withOldLanes(),before=h.record(),frozen=JSON.stringify({modelCandidates:before.modelCandidates,photoRefs:before.photoRefs,legacyVersions:before.legacyVersions});
 h.publishManaged();const out=await h.accept(),r=out.record;
 assert.equal(JSON.stringify({modelCandidates:r.modelCandidates,photoRefs:r.photoRefs,legacyVersions:r.legacyVersions}),frozen);
 assert.deepEqual(r.session.journal.slice(0,before.session.journal.length),before.session.journal);
 assert.deepEqual(r.session.sources.slice(0,before.session.sources.length),before.session.sources);
 assert.equal(r.session.sources[0].text,originalText);assert.equal(r.session.sources[1].text,originalSpeech);
 assert.equal(r.photoRefs.length,1);assert.equal(r.photoRefs[0].kind,'private_media');
 assert.equal(r.managedImageHistory.accepted[0].candidate.candidate.entries[0].replacesEntryId,before.session.entries.at(-1).id);
});

test('old-managed-old service writes validate one mixed journal while retaining v3 and immutable predecessors',async()=>{
 const h=await withOldLanes();h.publishManaged();await h.accept();const lane=copy(h.record().managedImageHistory),old=copy(h.record().modelCandidates[0]);
 h.publishOld('old-after-managed');const r=(await h.send({type:'accept_model_candidate',candidateId:'old-after-managed',selectedIndices:[0]})).record;
 assert.equal(r.schemaVersion,PREPARED_MANAGED_RECORD_SCHEMA);assert.equal(r.modelCandidates.length,2);
 assert.deepEqual(r.modelCandidates[0],old);assert.deepEqual(r.managedImageHistory,lane);
 assert.deepEqual(validatePreparedWorkflowRecord(r,scopeA),r);
 assert.equal(getDesignView(r.session).entries.find(e=>e.field==='visible_outline').value,'轮廓偏方');
});

test('original native archive/reopen and full v3 roundtrip preserve managed and old history',async()=>{
 const h=await withOldLanes();h.publishManaged();await h.accept();
 const entry=h.record().session.entries.find(e=>e.id==='managed-vision-entry:managed-output:0');
 await h.send({type:'confirm_entry',entryId:entry.id,text:'【合成测试】确认'+entry.value});
 await toPhase(h,'completed_review');await h.send({type:'archive'});
 const priorArchive=copy(h.record().archives[0]),priorLane=copy(h.record().managedImageHistory);
 const first=await h.service.snapshot({credential,scope:scopeA});
 assert.equal(first.saved,false);assert.equal(first.requiresAuthoritativeSourceVerification,true);
 assert.equal(first.snapshot.schemaVersion,full.FULL_WORKFLOW_MANAGED_SCHEMA);
 const unpacked=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(first.snapshot)));
 assert.deepEqual(unpacked.managedImageHistory,priorLane);assert.deepEqual(unpacked.modelCandidates,h.record().modelCandidates);
 assert.deepEqual(unpacked.photoRefs,h.record().photoRefs);assert.deepEqual(unpacked.legacyVersions,h.record().legacyVersions);
 assert.equal(unpacked.evidence.session.sources[0].text,originalText);assert.equal(unpacked.evidence.session.sources[1].text,originalSpeech);
 await h.send({type:'reopen',resumePhase:'completed_review',reason:'【合成测试】明确补充复盘，不改原归档'});
 await h.send({type:'record_source',kind:'text',text:'【合成测试】另一次明确原话'});await h.send({type:'archive'});
 const second=await h.service.snapshot({credential,scope:scopeA});
 assert.equal(second.snapshot.evidence.archives.length,2);assert.deepEqual(second.snapshot.evidence.archives[0],priorArchive);
 assert.deepEqual(second.snapshot.managedImageHistory,priorLane);assert.deepEqual(h.managed.get('managed-output').candidate,priorLane.accepted[0].candidate);
});

test('new candidate needs exact workflow digest even when native session is unchanged',async()=>{
 const h=fixture();h.publishManaged();const prior=h.record();
 await h.send({type:'attach_media',mediaIds:['synthetic-before']});
 assert.deepEqual(h.record().session,prior.session);assert.notEqual(digest(h.record()),digest(prior));
 const before=h.record(),writes=h.state.writes;
 await rejects(()=>h.accept(),'WORKFLOW_CONTRACT_REJECTED');assert.deepEqual(h.record(),before);assert.equal(h.state.writes,writes);
});

test('incorrect record/session digests or revision are rejected before any workflow write',async()=>{
 for(const change of [c=>c.workflowBinding.recordDigest='f'.repeat(64),c=>c.workflowBinding.recordRevision++,c=>c.workflowBinding.sessionDigest='f'.repeat(64),c=>c.workflowBinding.sessionRevision++,c=>c.workflowBinding.sessionId='another-session']){
  const h=fixture();h.publishManaged();change(h.managed.get('managed-output').candidate);const before=h.record();
  await rejects(()=>h.accept(),'WORKFLOW_CONTRACT_REJECTED');assert.deepEqual(h.record(),before);assert.equal(h.state.writes,0);
 }
});

test('wrong input task, version, digest or incomplete evidence cannot enter the new history lane',async()=>{
 for(const [change,code] of [
  [i=>i.taskId='other-task','WORKFLOW_CANDIDATE_DENIED'],
  [i=>i.objectReceipt.object.version='other-version','WORKFLOW_RECORD_INVALID'],
  [i=>i.response.descriptor.derivative.sha256='f'.repeat(64),'WORKFLOW_RECORD_INVALID'],
  [i=>i.verificationReport.checks.fullDecode='unknown','WORKFLOW_RECORD_INVALID'],
  [i=>i.sourceRecord.owner.subjectId='same-alias-other-subject','WORKFLOW_RECORD_INVALID']
 ]){
  const h=fixture();h.publishManaged();change(h.managed.get('managed-output').input);const before=h.record();
  await rejects(()=>h.accept(),code);assert.deepEqual(h.record(),before);assert.equal(h.state.writes,0);
 }
});

test('public acceptance cannot supply envelope, input, confirmation or authority, and no reader means denied',async()=>{
 const h=fixture(),row=h.publishManaged(),intent={type:'accept_managed_candidate',candidateId:row.candidate.id,selectedIndices:[0]};
 for(const [key,value] of [['candidate',row.candidate],['input',row.input],['confirmed',true],['authority',row.candidate.authority]])await rejects(()=>h.send({...intent,[key]:value}),'WORKFLOW_INVALID_FIELDS');
 for(const indices of [[],[0,0],[2],[-1]])await rejects(()=>h.accept(row.candidate.id,indices),'WORKFLOW_CONTRACT_REJECTED');
 assert.equal(h.state.writes,0);const closed=fixture({missingReader:true});closed.publishManaged();
 await rejects(()=>closed.accept(),'WORKFLOW_CANDIDATE_DENIED');assert.equal(closed.state.writes,0);
});

test('lost acknowledgement is uncertain, exact explicit replay adds no new history or confirmation',async()=>{
 const h=fixture();h.publishManaged();const q=h.request({type:'accept_managed_candidate',candidateId:'managed-output',selectedIndices:[1,0]});
 h.state.afterCommit=async()=>{throw Error('synthetic lost acknowledgement');};
 await rejects(()=>h.dispatch(q),'WORKFLOW_OUTCOME_UNCERTAIN');
 const committed=h.record(),reads=h.managedReads();assert.equal(h.state.writes,1);assert.equal(committed.managedImageHistory.accepted.length,1);
 h.state.afterCommit=async()=>{};const replay=await h.dispatch(q);
 assert.equal(replay.replayed,true);assert.deepEqual(replay.record,committed);assert.equal(h.state.writes,1);assert.equal(h.managedReads(),reads);
 assert(replay.record.session.entries.every(e=>e.status==='not_confirmed'));assert.deepEqual(replay.record.managedImageHistory.accepted[0].acceptance.receipt.selectedIndices,[0,1]);
 await rejects(()=>h.dispatch({...q,intent:{...q.intent,selectedIndices:[0]}}),'WORKFLOW_REQUEST_CONFLICT');
});

test('same request concurrent adoption commits once; late auth denial rolls back new adoption',async()=>{
 const h=fixture();h.publishManaged();const q=h.request({type:'accept_managed_candidate',candidateId:'managed-output',selectedIndices:[0]});
 const outcomes=await Promise.all([h.dispatch(q),h.dispatch(q)]);
 assert.equal(outcomes.filter(o=>o.replayed).length,1);assert.equal(h.record().managedImageHistory.accepted.length,1);assert.equal(h.state.writes,1);
 const denied=fixture();denied.publishManaged();const before=denied.record();denied.state.beforeCommit=async()=>{denied.state.active=false;};
 await rejects(()=>denied.accept(),'WORKFLOW_ACCESS_DENIED');assert.deepEqual(denied.record(),before);assert.equal(denied.state.receipts.size,0);
});

test('pure repository replay reconstructs the exact accepted record, not just adjacent managed hashes',async()=>{
 const h=fixture(),prior=validatePreparedWorkflowRecord(h.record(),scopeA),row=h.publishManaged(),q=h.request({type:'accept_managed_candidate',candidateId:'managed-output',selectedIndices:[0]});
 const {credential:ignored,scope:ignoredScope,...request}=q;const out=await h.dispatch(q),expected=validatePreparedWorkflowRecord(out.record,scopeA);
 assert.strictEqual(replayPreparedWorkflowIntentAgainstValidated({prior,expected,request,mediaReferences:null,trustedCandidate:row}),expected);
 const wrong=copy(row);wrong.candidate.workflowBinding.recordDigest='f'.repeat(64);
 assert.throws(()=>replayPreparedWorkflowIntentAgainstValidated({prior,expected,request,mediaReferences:null,trustedCandidate:wrong}));
});

test('full persistence of service snapshot still requires independent managed and original source proofs',async()=>{
 const h=fixture();h.publishManaged();await h.accept();const {snapshot}=await h.service.snapshot({credential,scope:scopeA});
 let rows=[],receipts=new Map(),managedAllowed=true,sourceAllowed=true,managedChecks=0;
 const archive=full.createPreparedFullWorkflowArchive({enabled:true,permissionGate:h.gate,clock:()=>Date.parse('2026-11-16T00:00:00Z'),transaction:async(ctx,work)=>{
  const local=copy(rows),localReceipts=new Map(receipts),hooks=[];
  const result=await work({permissionGate:h.gate,
   verifyBindings:async()=>({scope:scopeA,store:h.state.actor.store,...snapshot.bindings,revision:'synthetic-binding-1'}),
   verifyPhotoRefs:async()=>true,
   verifySourceSnapshots:async({snapshot:value})=>sourceAllowed&&digest(value)===digest(snapshot),
   verifyManagedImageHistory:async({managedImageHistory})=>{managedChecks++;return managedAllowed&&digest(managedImageHistory)===digest(snapshot.managedImageHistory);},
   readVersions:async()=>copy(local),findReceipt:async({requestKey})=>copy(localReceipts.get(requestKey)??null),
   appendVersion:async({version,receipt,expectedVersion,expectedParentDigest})=>{if(expectedVersion!==local.length||expectedParentDigest!==(local.at(-1)?.sha256??null))return false;local.push(copy(version));localReceipts.set(receipt.requestKey,copy(receipt));return true;},
   beforeCommit:async fn=>{hooks.push(fn);}
  });for(const hook of hooks)await hook();rows=local;receipts=localReceipts;return result;
 }});
 const q={credential,scope:scopeA,requestId:'managed-full-save',expectedVersion:0,expectedParentDigest:null,snapshot};
 const saved=await archive.append(q);assert.equal(saved.saved,true);assert.equal(rows.length,1);assert(managedChecks>=3);
 assert.deepEqual(rows[0].snapshot.managedImageHistory,h.record().managedImageHistory);
 const bytes=JSON.stringify(rows[0]);assert.equal((await archive.append(q)).replayed,true);assert.equal(rows.length,1);assert.equal(JSON.stringify(rows[0]),bytes);
 managedAllowed=false;await rejects(()=>archive.append(q),'FULL_MANAGED_HISTORY_DENIED');assert.equal(rows.length,1);
 managedAllowed=true;sourceAllowed=false;await rejects(()=>archive.append(q),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(rows.length,1);
});
