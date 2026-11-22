/** Synthetic service composition only. The in-memory transaction is not a DB
 * authorization proof, image decoder, provider, storage or deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparedFixture,scopeA,credential,copy} from './fixtures/design-prepared-fixture.mjs';
import {managedViewResultFixture} from './fixtures/managed-view-result.mjs';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {buildManagedViewResultCandidate,buildManagedSynthesisEvidence} from '../packages/analysis-engine/managed-view-result-candidate.mjs';
import {buildManagedImageResultCandidate} from '../packages/analysis-engine/managed-image-result-candidate.mjs';
import {DESIGN_CANDIDATE_SCHEMA,buildVisualCandidateParts,designCandidateDigest as digest} from '../packages/analysis-engine/design-candidate.mjs';
import {getDesignView,DESIGN_MANAGED_BEFORE_FIELDS,DESIGN_MANAGED_REVIEW_FIELDS} from '../packages/analysis-engine/design-pilot.mjs';
import {createPreparedWorkflowRecord,createPreparedWorkflowService,validatePreparedWorkflowRecord,replayPreparedWorkflowIntentAgainstValidated,PREPARED_MANAGED_RECORD_SCHEMA,PREPARED_MANAGED_VIEW_RECORD_SCHEMA} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import * as full from '../packages/design-production-adapter/full-workflow-archive.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const rejects=(work,code)=>assert.rejects(work,e=>e.code===code);
const originalText='  【合成测试】原话 <img src=x>。\n保留空格，不是已执行。  ';
const originalSpeech='  【合成测试】口述：左侧仍需本人核对。\n不代替操作。  ';
const beforeKind='managed_before_view',compareKind='managed_completion_comparison',synthKind='managed_completion_synthesis';
function legacyVersion(){
 const steps=Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k=>[k,'']));
 return {id:'20000000-0000-4000-8000-000000000001',requestId:'30000000-0000-4000-8000-000000000001',versionNumber:1,previousVersionId:null,createdAt:'2026-11-15T00:00:00Z',actor:{username:'synthetic-employee',store:'synthetic-store'},scope:copy(scopeA),snapshot:{baseline:{outline:'【合成测试】旧档原话',root_flow:'',steps},optimized:{outline:'',root_flow:'',steps:copy(steps)},reasons:{outline:'',root_flow:'',...steps},execution:{},process:{proposal:'【合成测试】旧方案'},review:{},status:'baseline',photo_ids:[],archive_url:null}};
}
function fixture({legacy=false,missingReader=false}={}){
 const base=preparedFixture(),views=new Map(),managed=new Map(),old=new Map();let serial=0,viewReads=0;
 if(legacy){const r=base.record();base.state.records.set('11',createPreparedWorkflowRecord({scope:scopeA,store:r.store,session:r.session,legacyVersions:[legacyVersion()]}));}
 const repository={transaction:(context,work)=>base.repository.transaction(context,tx=>{
  const wrapped={...tx,readCandidate:async id=>copy(old.get(id)??null),readManagedCandidate:async id=>copy(managed.get(id)??null)};
  if(!missingReader)wrapped.readManagedViewCandidate=async id=>{viewReads++;return copy(views.get(id)??null);};
  return work(wrapped);
 })};
 const service=createPreparedWorkflowService({enabled:true,permissionGate:base.gate,repository,mediaResolver:base.mediaResolver,mediaVerifier:base.mediaResolver});
 const request=(intent,extra={})=>({credential,scope:scopeA,requestId:'view-workflow-'+(++serial),expectedRevision:base.record().revision,intent,...extra});
 const dispatch=q=>service.dispatch(q),send=(intent,extra={})=>dispatch(request(intent,extra));
 function publishView({id='view-'+(++serial),kind=beforeKind,angle='front',side='left',result}={}){
  const r=base.record(),f=managedViewResultFixture({session:r.session,recordRevision:r.revision,id,kind,angle,side,...(r.managedImageHistory?{managedImageHistory:r.managedImageHistory}:{}),...(result?{result}:{})});
  const q=copy(f.candidateInput);q.workflowBinding.recordDigest=digest(r);
  const row={candidate:buildManagedViewResultCandidate(q),inputs:copy(f.inputs)};views.set(id,copy(row));return copy(row);
 }
 function publishManaged(id='v1-'+(++serial)){
  const r=base.record(),f=managedImageResultFixture({session:r.session,recordRevision:r.revision,id}),q=copy(f.candidateInput);q.workflowBinding.recordDigest=digest(r);
  const row={candidate:buildManagedImageResultCandidate(q),input:f.input};managed.set(id,copy(row));return copy(row);
 }
 function publishOld(id='old-'+(++serial),textEntry=null){
  const r=base.record(),s=r.session,c={schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind:textEntry?'text_extraction':'visual_description',scope:scopeA,store:r.store,actor:copy(base.state.actor),sessionId:s.scope.sessionId,baseRevision:s.revision,inputDigest:digest(s),payloadDigest:'e'.repeat(64),model:'synthetic-old-model',promptVersion:'old-prompt',sourceRefs:textEntry?[]:[{mediaId:'synthetic-before',sourceSha256:'a'.repeat(64),derivativeSha256:'b'.repeat(64)}],...(textEntry?{descriptionSources:[],candidate:{phase:s.phase,entries:[textEntry],questions:[],warnings:[]}}:buildVisualCandidateParts({id,session:s,observations:[{field:'visible_outline',value:'轮廓偏方'}]}))};
  old.set(id,copy(c));return copy(c);
 }
 const accept=(row,selectedIndices=row.candidate.kind===beforeKind?[0,1]:[0],extra={})=>send({type:'accept_managed_view_candidate',candidateId:row.candidate.id,selectedIndices},extra);
 return {...base,service,repository,request,dispatch,send,publishView,publishManaged,publishOld,views,managed,old,accept,viewReads:()=>viewReads,
  acceptV1:row=>send({type:'accept_managed_candidate',candidateId:row.candidate.id,selectedIndices:[0,1]})};
}
async function toPhase(h,target='completed_review'){
 const phases=['before_analysis','proposal','execution','completed_review'];
 while(h.record().session.phase!==target)await h.send({type:'advance',phase:phases[phases.indexOf(h.record().session.phase)+1]});
}
async function compare(h,angle='front'){
 await toPhase(h);const row=h.publishView({kind:compareKind,angle});await h.accept(row);return row;
}
async function comparisons(h,angles=['front','back','left']){const rows=[];for(const angle of angles)rows.push(await compare(h,angle));return rows;}
async function confirm(h,id){const entry=h.record().session.entries.find(e=>e.id===id);return h.send({type:'confirm_entry',entryId:id,text:'【合成测试】本人核对：'+entry.value});}
function version(snapshot,n=1,previous=null){const v={schemaVersion:full.FULL_WORKFLOW_VERSION_SCHEMA,version:n,previous,scope:scopeA,actor:{username:'synthetic-employee',store:'synthetic-store'},requestId:'full-'+n,createdAt:'2026-11-16T00:00:00Z',bindingRevision:'binding-1',snapshot};return {...v,sha256:digest(v)};}

test('v2 output stays outside workflow until explicit ID-only selection; adoption is not confirmation',async()=>{
 const h=fixture(),prior=h.record(),row=h.publishView();
 assert.deepEqual((await h.service.load({credential,scope:scopeA})).record,prior);assert.equal(h.state.writes,0);assert.equal(h.viewReads(),0);
 const out=await h.accept(row,[1]);assert.equal(out.replayed,false);assert.equal(out.record.schemaVersion,PREPARED_MANAGED_VIEW_RECORD_SCHEMA);
 assert.equal(out.record.managedImageHistory.schemaVersion,'design-managed-image-history-v2');assert.deepEqual(out.record.managedImageHistory.inputs,row.inputs);
 assert.equal(out.record.session.entries.length,1);assert.equal(out.record.session.entries[0].field,'managed_before_hair_shape_front');
 assert.equal(out.record.session.entries[0].status,'not_confirmed');assert.equal(out.record.session.entries[0].basis,'observable');assert.equal(out.record.session.entries[0].track,'context');
 const accepted=out.record.managedImageHistory.accepted[0];assert.deepEqual(accepted.candidate,row.candidate);assert.deepEqual(accepted.acceptance.receipt.selectedIndices,[1]);assert.equal(accepted.acceptance.workflowRevision,out.record.revision);
});

test('three angles coexist through service writes; front correction replaces only front and preserves prior history',async()=>{
 const h=fixture();for(const angle of ['front','back','left'])await h.accept(h.publishView({id:'before-'+angle,angle}));
 const prior=h.record(),entries=getDesignView(prior.session).entries;assert.equal(entries.length,6);assert.equal(prior.managedImageHistory.inputs.length,3);
 for(const angle of ['front','back','left'])assert.equal(entries.filter(e=>e.field.endsWith('_'+angle)).length,2);
 const row=h.publishView({id:'front-correction',angle:'front',result:{observations:[{field:'visible_outline',value:'轮廓偏方'}]}}),out=await h.accept(row,[0]);
 assert.equal(out.record.session.entries.length,7);assert.equal(getDesignView(out.record.session).entries.length,6);
 assert.equal(row.candidate.candidate.entries[0].replacesEntryId,'managed-before-entry:before-front:0');
 for(const angle of ['back','left'])assert.deepEqual(getDesignView(out.record.session).entries.filter(e=>e.field.endsWith('_'+angle)),entries.filter(e=>e.field.endsWith('_'+angle)));
 assert.deepEqual(out.record.managedImageHistory.accepted.slice(0,3),prior.managedImageHistory.accepted);assert.deepEqual(out.record.session.journal.slice(0,prior.session.revision),prior.session.journal);
});

test('explicit unknown stays unknown and cannot be confirmed or silently filled',async()=>{
 const h=fixture(),row=h.publishView({result:{observations:[{field:'visible_outline',value:null}]}}),out=await h.accept(row,[0]);
 const e=out.record.session.entries[0];assert.equal(e.value,null);assert.equal(e.status,'unknown');assert.deepEqual(e.sources,[]);
 await rejects(()=>confirm(h,e.id),'WORKFLOW_CONFIRMATION_INVALID');assert.equal(h.record().session.entries.length,1);
});

test('pair and evidence-only synthesis require distinct adoptions and preserve before and human review entries',async()=>{
 const h=fixture();await h.accept(h.publishView());const beforeEntries=copy(h.record().session.entries);await toPhase(h);
 await h.send({type:'record_source',kind:'text',text:originalText});const source=h.record().session.sources.at(-1);
 await h.send({type:'record_review',field:'observed_result',value:originalText,sourceId:source.messageId,quote:originalText,replacesEntryId:null});
 const human=copy(h.record().session.entries.at(-1)),pair=h.publishView({kind:compareKind});
 assert.equal(h.record().managedImageHistory.accepted.length,1);await h.accept(pair);
 const beforeSynthesis=h.record(),synth=h.publishView({kind:synthKind});assert.deepEqual(synth.inputs,[]);assert(!Object.hasOwn(synth.candidate.evidenceBinding,'images'));
 assert.deepEqual(h.record(),beforeSynthesis);const out=await h.accept(synth);
 assert.equal(out.record.managedImageHistory.accepted.length,3);assert.equal(out.record.managedImageHistory.inputs.length,2);
 assert.deepEqual(out.record.session.entries.slice(0,2),beforeEntries);assert.deepEqual(out.record.session.entries[2],human);
 const tail=out.record.session.entries.slice(-2);assert.deepEqual(tail.map(e=>e.field),['managed_photo_comparison_front','managed_completion_synthesis_left']);
 assert.deepEqual(tail.map(e=>e.basis),['observable','inferred']);assert(tail.every(e=>e.status==='not_confirmed'&&e.track==='actual'));
 assert.equal(out.record.session.entries.filter(e=>e.category==='technique').length,0);
});

test('synthesis binds confirmation at generation prefix; later confirmation does not rewrite historical evidence',async()=>{
 const h=fixture(),rows=await comparisons(h);await confirm(h,rows[0].candidate.candidate.entries[0].id);
 const built=buildManagedSynthesisEvidence({session:h.record().session,managedImageHistory:h.record().managedImageHistory,side:'left'});assert(built.allowedReviewFocus.length>1);
 const synth=h.publishView({kind:synthKind,id:'synthesis-prefix',result:{reviewFocus:built.allowedReviewFocus.at(-1)}});assert.notDeepEqual(synth.candidate.result.reviewFocus,built.allowedReviewFocus[0]);await h.accept(synth);const frozenLane=copy(h.record().managedImageHistory);
 assert.deepEqual(synth.candidate.evidenceBinding.confirmedAngles,['front']);assert.deepEqual(synth.candidate.evidenceBinding.unconfirmedAngles,['back','left']);
 assert.equal(synth.candidate.evidenceBinding.ancestors[1].confirmationDigest,null);
 await confirm(h,rows[1].candidate.candidate.entries[0].id);
 assert.deepEqual(h.record().managedImageHistory,frozenLane);assert.deepEqual(validatePreparedWorkflowRecord(h.record(),scopeA),h.record());
 const next=h.publishView({kind:synthKind,id:'synthesis-next'});assert.deepEqual(next.candidate.evidenceBinding.confirmedAngles,['front','back']);await h.accept(next);
 assert.deepEqual(h.record().managedImageHistory.accepted[3],frozenLane.accepted[3]);
 assert.equal(getDesignView(h.record().session).entries.find(e=>e.field==='managed_completion_synthesis_left').status,'not_confirmed');
 const bad=copy(h.record());bad.managedImageHistory.accepted[3].candidate.evidenceBinding.ancestors[1].entryStatus='confirmed';assert.throws(()=>validatePreparedWorkflowRecord(bad,scopeA));
});

test('confirmation after generation makes a pending synthesis stale; no implicit rebase occurs on acceptance',async()=>{
 const h=fixture(),rows=await comparisons(h),synth=h.publishView({kind:synthKind});await confirm(h,rows[0].candidate.candidate.entries[0].id);const before=h.record();
 await rejects(()=>h.accept(synth),'WORKFLOW_CONTRACT_REJECTED');assert.deepEqual(h.record(),before);
});

test('deterministic synthesis retains server provenance and remains a separate unconfirmed suggestion',async()=>{
 const h=fixture(),rows=await comparisons(h);for(const row of rows)await confirm(h,row.candidate.candidate.entries[0].id);
 const s=h.publishView({kind:synthKind});assert.equal(s.candidate.evidenceBinding.generation,'deterministic');assert.equal(s.candidate.requestBinding.model,'server-deterministic');await h.accept(s);
 assert.equal(h.record().session.sources.at(-1).actor,'system');assert.equal(h.record().session.sources.at(-1).kind,'server_synthesis');assert.equal(h.record().session.entries.at(-1).status,'not_confirmed');
 assert.equal(h.record().managedImageHistory.inputs.length,6);
});

test('missing requested side is explicit; opposite side is not an ancestor and no-ancestor synthesis is rejected',async()=>{
 const empty=fixture();await toPhase(empty);assert.throws(()=>empty.publishView({kind:synthKind}));assert.equal(empty.record().managedImageHistory,undefined);
 const h=fixture();await comparisons(h,['front','right']);const row=h.publishView({kind:synthKind,side:'left'});await h.accept(row);
 assert.deepEqual(row.candidate.evidenceBinding.ancestors.map(x=>x.angle),['front']);assert.deepEqual(row.candidate.evidenceBinding.missingAngles,['back','left']);
 assert.equal(row.candidate.evidenceBinding.assessment,'limited_evidence');assert.match(h.record().session.entries.at(-1).value,/不代表另一侧/);
});

test('old model/v1/legacy and native source bytes survive v4 adoption, old-v1 reacceptance, archive and reopen',async()=>{
 const h=fixture({legacy:true});await h.send({type:'record_source',kind:'text',text:originalText});await h.send({type:'record_source',kind:'speech_transcript',text:originalSpeech});await h.send({type:'attach_media',mediaIds:['synthetic-before']});
 const model=h.publishOld();await h.send({type:'accept_model_candidate',candidateId:model.id,selectedIndices:[0]});await h.acceptV1(h.publishManaged());
 const prior=h.record(),oldFull=(await h.service.snapshot({credential,scope:scopeA})).snapshot,oldBytes=JSON.stringify(oldFull),v1=version(oldFull);
 assert.equal(prior.schemaVersion,PREPARED_MANAGED_RECORD_SCHEMA);assert.equal(oldFull.schemaVersion,full.FULL_WORKFLOW_MANAGED_SCHEMA);
 await h.accept(h.publishView({angle:'back'}));await h.acceptV1(h.publishManaged('old-v1-after-upgrade'));
 const oldLater=h.publishOld('old-model-after-upgrade');await h.send({type:'accept_model_candidate',candidateId:oldLater.id,selectedIndices:[0]});
 const upgraded=h.record();assert.equal(upgraded.schemaVersion,PREPARED_MANAGED_VIEW_RECORD_SCHEMA);assert.equal(upgraded.managedImageHistory.schemaVersion,'design-managed-image-history-v2');
 assert.deepEqual(upgraded.managedImageHistory.accepted[0],prior.managedImageHistory.accepted[0]);assert.deepEqual(upgraded.modelCandidates[0],prior.modelCandidates[0]);assert.deepEqual(upgraded.photoRefs,prior.photoRefs);assert.deepEqual(upgraded.legacyVersions,prior.legacyVersions);
 assert.deepEqual(upgraded.session.journal.slice(0,prior.session.revision),prior.session.journal);assert.equal(upgraded.session.sources[0].text,originalText);assert.equal(upgraded.session.sources[1].text,originalSpeech);
 await compare(h);await h.accept(h.publishView({kind:synthKind}));await h.send({type:'archive'});const firstArchive=copy(h.record().archives[0]);
 const first=(await h.service.snapshot({credential,scope:scopeA})).snapshot,v2=version(first,2,{version:1,sha256:v1.sha256});assert.equal(first.schemaVersion,full.FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA);
 full.validateFullWorkflowChain([v1,v2],scopeA);assert.equal(JSON.stringify(oldFull),oldBytes);
 const unpacked=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(first)));assert.deepEqual(unpacked.managedImageHistory,h.record().managedImageHistory);
 await h.send({type:'reopen',resumePhase:'completed_review',reason:'【合成测试】追加复盘，旧档不改'});await h.send({type:'record_source',kind:'text',text:'【合成测试】另一次原话'});await h.send({type:'archive'});
 const last=(await h.service.snapshot({credential,scope:scopeA})).snapshot;assert.deepEqual(last.evidence.archives[0],firstArchive);assert.equal(last.evidence.archives.length,2);assert.deepEqual(last.managedImageHistory,first.managedImageHistory);
 full.validateFullWorkflowChain([v1,v2,version(last,3,{version:2,sha256:v2.sha256})],scopeA);assert.equal(JSON.stringify(oldFull),oldBytes);
});

test('wrong source inputs and candidate record/session bindings fail before any write',async()=>{
 const mutations=[r=>r.candidate.workflowBinding.recordDigest='f'.repeat(64),r=>r.candidate.workflowBinding.sessionDigest='f'.repeat(64),r=>r.inputs=[],r=>r.inputs[0].taskId='other-task',r=>r.inputs[0].objectReceipt.object.version='other-version',r=>r.inputs[0].verificationReport.checks.fullDecode='unknown',r=>r.inputs[0].sourceRecord.owner.subjectId='same-alias-other-owner',r=>{const conflicting=copy(r.inputs[0]);conflicting.objectReceipt.object.version='conflicting';r.inputs.push(conflicting);}];
 for(const [index,change] of mutations.entries()){const h=fixture(),row=h.publishView(),prior=h.record();change(h.views.get(row.candidate.id));await assert.rejects(()=>h.accept(row),undefined,'mutation '+index);assert.deepEqual(h.record(),prior);assert.equal(h.state.writes,0);}
 const h=fixture(),row=h.publishView(),prior=h.record();await h.send({type:'attach_media',mediaIds:['synthetic-before']});assert.deepEqual(h.record().session,prior.session);const before=h.record();await rejects(()=>h.accept(row),'WORKFLOW_CONTRACT_REJECTED');assert.deepEqual(h.record(),before);
});

test('trusted repeated identical input merges once; later pairs reuse the exact before provenance without duplicating it',async()=>{
 const h=fixture(),row=h.publishView();h.views.get(row.candidate.id).inputs.push(copy(row.inputs[0]));await h.accept(row);
 assert.deepEqual(h.record().managedImageHistory.inputs,row.inputs);const frozen=copy(h.record().managedImageHistory.inputs[0]);await compare(h);
 assert.equal(h.record().managedImageHistory.inputs.length,2);assert.deepEqual(h.record().managedImageHistory.inputs[0],frozen);
});

test('acceptance is ID-only and exact-kind: no caller envelope/input/authority and no old/new route confusion',async()=>{
 const h=fixture(),row=h.publishView(),intent={type:'accept_managed_view_candidate',candidateId:row.candidate.id,selectedIndices:[0]};
 for(const [key,value] of [['candidate',row.candidate],['inputs',row.inputs],['authority',row.candidate.authority],['confirmed',true]])await rejects(()=>h.send({...intent,[key]:value}),'WORKFLOW_INVALID_FIELDS');
 const old=h.publishManaged();h.views.set(old.candidate.id,{candidate:old.candidate,inputs:[old.input]});await rejects(()=>h.accept({candidate:old.candidate},[0]),'WORKFLOW_CONTRACT_REJECTED');
 h.managed.set(row.candidate.id,{candidate:row.candidate,input:row.inputs[0]});await rejects(()=>h.acceptV1(row),'WORKFLOW_CONTRACT_REJECTED');assert.equal(h.state.writes,0);
 const missing=fixture({missingReader:true});await rejects(()=>missing.accept(missing.publishView()),'WORKFLOW_CANDIDATE_DENIED');assert.equal(missing.state.writes,0);
});

test('compare/synthesis cannot partially select or duplicate their one bounded result',async()=>{
 const h=fixture();await toPhase(h);const pair=h.publishView({kind:compareKind});
 for(const indices of [[],[1],[0,0],[-1]])await rejects(()=>h.accept(pair,indices),'WORKFLOW_CONTRACT_REJECTED');await h.accept(pair);
 const s=h.publishView({kind:synthKind});for(const indices of [[],[1],[0,0]])await rejects(()=>h.accept(s,indices),'WORKFLOW_CONTRACT_REJECTED');assert.equal(h.record().managedImageHistory.accepted.length,1);
});

test('lost acknowledgement and concurrent exact request replay never add duplicate history or confirmation',async()=>{
 const h=fixture(),row=h.publishView(),q=h.request({type:'accept_managed_view_candidate',candidateId:row.candidate.id,selectedIndices:[1,0]});
 h.state.afterCommit=async()=>{throw Error('synthetic lost acknowledgement');};await rejects(()=>h.dispatch(q),'WORKFLOW_OUTCOME_UNCERTAIN');
 const committed=h.record(),reads=h.viewReads();assert.equal(committed.managedImageHistory.accepted.length,1);h.state.afterCommit=async()=>{};
 const out=await Promise.all([h.dispatch(q),h.dispatch(q)]);assert(out.every(x=>x.replayed));assert.equal(h.state.writes,1);assert.equal(h.viewReads(),reads);assert.deepEqual(h.record(),committed);
 assert(committed.session.entries.every(e=>e.status==='not_confirmed'));await rejects(()=>h.dispatch({...q,intent:{...q.intent,selectedIndices:[0]}}),'WORKFLOW_REQUEST_CONFLICT');
});

test('separate concurrent candidates obey CAS; fresh final permission denial rolls back an adoption',async()=>{
 const h=fixture(),a=h.publishView({id:'same-base-a'}),b=h.publishView({id:'same-base-b',angle:'back'}),rev=h.record().revision;
 const out=await Promise.allSettled([h.accept(a,[0],{expectedRevision:rev}),h.accept(b,[0],{expectedRevision:rev})]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(out.find(x=>x.status==='rejected').reason.code,'WORKFLOW_REVISION_CONFLICT');assert.equal(h.record().managedImageHistory.accepted.length,1);
 const denied=fixture(),row=denied.publishView(),before=denied.record();denied.state.beforeCommit=async()=>{denied.state.active=false;};await rejects(()=>denied.accept(row),'WORKFLOW_ACCESS_DENIED');assert.deepEqual(denied.record(),before);assert.equal(denied.state.receipts.size,0);
});

test('repository pure replay reconstructs all three service intent kinds against exact validated records',async()=>{
 const h=fixture();for(const kind of [beforeKind,compareKind,synthKind]){
  if(kind!==beforeKind)await toPhase(h);const row=h.publishView({kind}),prior=validatePreparedWorkflowRecord(h.record(),scopeA),q=h.request({type:'accept_managed_view_candidate',candidateId:row.candidate.id,selectedIndices:[0]});
  const {credential:ignored,scope:ignoredScope,...request}=q,out=await h.dispatch(q),expected=validatePreparedWorkflowRecord(out.record,scopeA);
  assert.strictEqual(replayPreparedWorkflowIntentAgainstValidated({prior,expected,request,mediaReferences:null,trustedCandidate:row}),expected);
  const bad=copy(row);bad.candidate.workflowBinding.recordDigest='f'.repeat(64);assert.throws(()=>replayPreparedWorkflowIntentAgainstValidated({prior,expected,request,mediaReferences:null,trustedCandidate:bad}));
 }
});

test('old manual and text-model entry points reject each of the fourteen dedicated fields',async()=>{
 const fields=[...DESIGN_MANAGED_BEFORE_FIELDS,...DESIGN_MANAGED_REVIEW_FIELDS];assert.equal(new Set(fields).size,14);
 for(const field of fields){const h=fixture();if(DESIGN_MANAGED_REVIEW_FIELDS.includes(field))await toPhase(h);await h.send({type:'record_source',kind:'text',text:originalText});const s=h.record().session,source=s.sources.at(-1),before=h.record(),writes=h.state.writes;
  for(const type of ['record_context','record_review'])await rejects(()=>h.send({type,field,value:originalText,sourceId:source.messageId,quote:originalText,replacesEntryId:null}),'WORKFLOW_INVALID_FIELD');
  const entry={id:'legacy-spoof',category:DESIGN_MANAGED_BEFORE_FIELDS.includes(field)?'person_style':'result_review',field,zone:null,groupId:null,service:null,side:null,track:DESIGN_MANAGED_BEFORE_FIELDS.includes(field)?'context':'actual',origin:'extraction',basis:'said',value:originalText,status:'not_confirmed',sources:[{messageId:source.messageId,quote:originalText}],replacesEntryId:null};
  const c=h.publishOld('old-spoof',entry);await rejects(()=>h.send({type:'accept_model_candidate',candidateId:c.id,selectedIndices:[0]}),'WORKFLOW_CONTRACT_REJECTED');assert.deepEqual(h.record(),before);assert.equal(h.state.writes,writes);
 }
});

test('full-v4 persistence independently checks fresh managed history and source proofs, including exact replay',async()=>{
 const h=fixture();await h.accept(h.publishView());const {snapshot}=await h.service.snapshot({credential,scope:scopeA});let rows=[],receipts=new Map(),managedAllowed=true,sourceAllowed=true,checks=0;
 const archive=full.createPreparedFullWorkflowArchive({enabled:true,permissionGate:h.gate,clock:()=>Date.parse('2026-11-16T00:00:00Z'),transaction:async(ctx,work)=>{
  const local=copy(rows),pending=new Map(receipts),hooks=[];
  const out=await work({permissionGate:h.gate,verifyBindings:async()=>({scope:scopeA,store:h.state.actor.store,...snapshot.bindings,revision:'synthetic-binding-1'}),verifyPhotoRefs:async()=>true,
   verifySourceSnapshots:async({snapshot:value})=>sourceAllowed&&digest(value)===digest(snapshot),verifyManagedImageHistory:async({managedImageHistory})=>{checks++;return managedAllowed&&digest(managedImageHistory)===digest(snapshot.managedImageHistory);},
   readVersions:async()=>copy(local),findReceipt:async({requestKey})=>copy(pending.get(requestKey)??null),appendVersion:async({version,receipt,expectedVersion,expectedParentDigest})=>{if(expectedVersion!==local.length||expectedParentDigest!==(local.at(-1)?.sha256??null))return false;local.push(copy(version));pending.set(receipt.requestKey,copy(receipt));return true;},beforeCommit:async fn=>{hooks.push(fn);}});
  for(const fn of hooks)await fn();rows=local;receipts=pending;return out;
 }});
 const q={credential,scope:scopeA,requestId:'full-view-save',expectedVersion:0,expectedParentDigest:null,snapshot};assert.equal((await archive.append(q)).saved,true);assert(checks>=3);assert.equal(rows[0].snapshot.schemaVersion,full.FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA);
 const bytes=JSON.stringify(rows);assert.equal((await archive.append(q)).replayed,true);managedAllowed=false;await rejects(()=>archive.append(q),'FULL_MANAGED_HISTORY_DENIED');managedAllowed=true;sourceAllowed=false;await rejects(()=>archive.append(q),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(JSON.stringify(rows),bytes);
});

test('v1 and v2 share the existing 300-input cap; an oversized raw v1 record is not a valid legacy upgrade',async()=>{
 // Static boundary assertion is intentional: 301 fully valid legacy inputs
 // cannot be constructed because the original v1 validator already rejects
 // that count. SQL's older 1000-input allowance is not JS/full validity.
 for(const file of ['managed-image-result-history.mjs','managed-view-result-history.mjs']){
  const source=readFileSync(new URL('../packages/analysis-engine/'+file,import.meta.url),'utf8');
  assert.match(source,/lane\.inputs\.length>300/);assert.match(source,/lane\.accepted\.length>1000/);
 }
 const h=fixture();await h.acceptV1(h.publishManaged());const original=h.record(),bytes=JSON.stringify(original);
 assert.deepEqual(validatePreparedWorkflowRecord(original,scopeA),original);
 const oversized=copy(original);oversized.managedImageHistory.inputs=Array.from({length:301},(_,i)=>({...copy(original.managedImageHistory.inputs[0]),taskId:'oversized-input-'+i}));
 // This deliberately invalid record also contains unreferenced inputs. It is
 // not evidence that 300 such fabricated rows would pass complete replay.
 assert.throws(()=>validatePreparedWorkflowRecord(oversized,scopeA),e=>e.code==='WORKFLOW_RECORD_INVALID');
 assert.equal(JSON.stringify(h.record()),bytes);assert.equal(original.managedImageHistory.inputs.length,1);
 await h.accept(h.publishView({angle:'back'}));assert.deepEqual(h.record().managedImageHistory.accepted[0],original.managedImageHistory.accepted[0]);assert.deepEqual(h.record().managedImageHistory.inputs[0],original.managedImageHistory.inputs[0]);assert.equal(JSON.stringify(original),bytes);
});
