/** Pure synthetic lineage/replay tests; no real image or authority evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {managedViewHistoryFixture as fixture,managedViewHistoryInput} from './fixtures/managed-view-history.mjs';
import {validateManagedViewResultHistory as validate,validateManagedViewHistoryInput,managedViewHistoryInputBinding,MANAGED_VIEW_HISTORY_SCHEMA} from '../packages/analysis-engine/managed-view-result-history.mjs';
import {validateManagedImageHistory,validateManagedImageHistoryInput,managedImageHistoryInputBinding} from '../packages/analysis-engine/managed-image-result-history.mjs';
import {designCandidateDigest as digest} from '../packages/analysis-engine/design-candidate.mjs';
import {getDesignView} from '../packages/analysis-engine/design-pilot.mjs';
import * as full from '../packages/design-production-adapter/full-workflow-archive.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};const copy=structuredClone;
function comparisons(){const h=fixture();for(const angle of ['front','back','left'])h.compare(angle);return h;}
function version(snapshot,n=1,previous=null){const actor={username:'synthetic-employee',store:'synthetic-store'},v={schemaVersion:full.FULL_WORKFLOW_VERSION_SCHEMA,version:n,previous,scope:snapshot.scope,actor,requestId:'full-'+n,createdAt:'2026-11-16T00:00:00Z',bindingRevision:'binding-1',snapshot};return {...v,sha256:digest(v)};}

test('v2 input permits verified before/after only; old v1 helper stays before-only with identical output',()=>{
 const before=managedViewHistoryInput(),after=managedViewHistoryInput({stage:'after'});
 assert.deepEqual(validateManagedViewHistoryInput(before),validateManagedImageHistoryInput(before));
 assert.deepEqual(managedViewHistoryInputBinding(before),managedImageHistoryInputBinding(before));
 assert.equal(managedViewHistoryInputBinding(after).stage,'after');assert.throws(()=>validateManagedImageHistoryInput(after));
 for(const change of [x=>x.sourceRecord.stage='reference',x=>x.sourceRecord.angle='detail',x=>x.verificationReport.checks.fullDecode='unknown',x=>x.verificationReport.state='failed']){const v=copy(after);change(v);assert.throws(()=>validateManagedViewHistoryInput(v));}
});

test('three before views remain independent and all source records are retained in one v2 lane',()=>{
 const h=fixture();for(const a of ['front','back','left'])h.before(a);
 const lane=validate(h.validation());assert.equal(lane.inputs.length,3);assert.equal(lane.accepted.length,3);
 assert(Object.isFrozen(lane));assert.equal(lane.schemaVersion,MANAGED_VIEW_HISTORY_SCHEMA);
 assert.equal(getDesignView(h.state.session).entries.length,6);
 for(const a of ['front','back','left'])assert(getDesignView(h.state.session).entries.some(e=>e.field==='managed_before_outline_'+a&&e.status==='not_confirmed'));
 assert.deepEqual(validateManagedImageHistory(h.validation()),lane);
});

test('old model and old managed rows coexist before/after new rows without rewriting either lane',()=>{
 const h=fixture();h.oldModel();h.oldManaged();const prior=copy(h.validation()),beforeBytes=JSON.stringify(prior);
 h.before('front');h.before('back');h.oldManaged('old-managed-later');h.oldModel('old-model-later');
 const lane=validate(h.validation());
 assert.deepEqual(lane.accepted[0],prior.managedImageHistory.accepted[0]);assert.deepEqual(h.state.modelCandidates[0],prior.modelCandidates[0]);
 assert.deepEqual(h.state.session.journal.slice(0,prior.session.revision),prior.session.journal);assert.equal(JSON.stringify(prior),beforeBytes);
 assert.equal(lane.accepted.at(-1).candidate.schemaVersion,'design-managed-model-candidate-v1');assert.equal(lane.schemaVersion,MANAGED_VIEW_HISTORY_SCHEMA);
});

test('history schema cannot be upgraded without a new v2 acceptance or downgraded to old validator semantics',()=>{
 const h=fixture();h.oldManaged();assert.throws(()=>validate(h.validation()));
 const old=copy(h.validation());old.managedImageHistory.schemaVersion='design-managed-image-history-v1';assert.deepEqual(validateManagedImageHistory(old),old.managedImageHistory);
 h.before('left');const v=copy(h.validation());v.managedImageHistory.schemaVersion='design-managed-image-history-v1';assert.throws(()=>validateManagedImageHistory(v));
});

test('same-angle before/after pairs retain both complete private source and verification chains',()=>{
 const h=comparisons(),lane=validate(h.validation());assert.equal(lane.inputs.length,6);assert.equal(lane.accepted.length,3);
 for(const row of lane.accepted){const b=row.candidate.evidenceBinding;assert.deepEqual(b.images.map(x=>x.stage),['before','after']);assert(b.images.every(x=>x.angle===b.angle));assert.notEqual(b.images[0].sourceObject.version,b.images[1].sourceObject.version);}
 assert.equal(getDesignView(h.state.session).entries.length,3);
});

test('wrong versions, input hashes, owner identity and cross-task substitution fail complete history validation',()=>{
 const h=fixture();h.compare();const base=h.validation();
 for(const change of [v=>v.managedImageHistory.inputs[1].objectReceipt.object.version='changed',v=>v.managedImageHistory.inputs[0].sourceRecord.owner.subjectId='same-name-new-subject',v=>v.managedImageHistory.inputs[0].response.descriptor.derivative.sha256='e'.repeat(64),v=>v.managedImageHistory.inputs[1].taskId='other-task',v=>v.managedImageHistory.inputs[0].verificationReport.evidence.id='other-evidence']){const v=copy(base);change(v);assert.throws(()=>validate(v));}
});

test('candidate pair angle or role cannot be rewritten even if candidate receipt digest is recomputed',()=>{
 const h=fixture();h.compare('left');
 for(const change of [c=>c.evidenceBinding.angle='right',c=>c.evidenceBinding.images.reverse(),c=>c.evidenceBinding.images[1].angle='right',c=>c.evidenceBinding.images[1]=copy(c.evidenceBinding.images[0])]){
  const v=copy(h.validation()),row=v.managedImageHistory.accepted[0];change(row.candidate);row.acceptance.receipt.candidateDigest=digest(row.candidate);row.acceptance.receipt.evidenceBindingDigest=digest(row.candidate.evidenceBinding);assert.throws(()=>validate(v));
 }
});

test('synthesis preserves confirmed and unconfirmed ancestor facts at its exact creation prefix',()=>{
 const h=comparisons(),front=h.state.managedImageHistory.accepted[0];h.confirm(front.candidate.candidate.entries[0].id);
 const synthesis=h.synthesize(),lane=validate(h.validation()),e=synthesis.candidate.evidenceBinding;
 assert.deepEqual(e.confirmedAngles,['front']);assert.deepEqual(e.unconfirmedAngles,['back','left']);
 assert.equal(e.ancestors[0].confirmationDigest,digest(h.state.session.entries.find(x=>x.id===e.ancestors[0].entryId).confirmation));
 assert.equal(e.ancestors[1].confirmationDigest,null);assert.equal(synthesis.candidate.candidate.entries[0].status,'not_confirmed');
 assert.equal(lane.inputs.length,6);assert.equal(lane.accepted.length,4);
 const original=JSON.stringify(lane);h.confirm(e.ancestors[1].entryId);
 assert.equal(JSON.stringify(validate(h.validation())),original);assert.equal(h.state.session.entries.find(x=>x.id===e.ancestors[1].entryId).status,'confirmed');
});

test('confirmed deterministic synthesis stays unconfirmed itself and uses no invented additional image lineage',()=>{
 const h=comparisons();for(const row of h.state.managedImageHistory.accepted)h.confirm(row.candidate.candidate.entries[0].id);
 const row=h.synthesize(),lane=validate(h.validation());assert.equal(row.candidate.evidenceBinding.generation,'deterministic');
 assert.equal(row.candidate.requestBinding.model,'server-deterministic');assert.equal(row.candidate.descriptionSources[0].kind,'server_synthesis');
 assert.equal(row.candidate.candidate.entries[0].status,'not_confirmed');assert.equal(row.candidate.candidate.entries[0].basis,'inferred');
 assert.equal(lane.inputs.length,6);assert(!Object.hasOwn(row.candidate.evidenceBinding,'images'));
});

test('missing requested side never adopts the opposite side and limitations survive synthesis history',()=>{
 const h=fixture();h.compare('front');h.compare('right');const row=h.synthesize('left');validate(h.validation());
 assert.deepEqual(row.candidate.evidenceBinding.ancestors.map(x=>x.angle),['front']);assert.deepEqual(row.candidate.evidenceBinding.missingAngles,['back','left']);
 assert.equal(row.candidate.evidenceBinding.assessment,'limited_evidence');assert.match(row.candidate.candidate.entries[0].value,/不代表另一侧/);
});

test('future or self ancestor and modified confirmation state cannot justify a synthesis',()=>{
 const h=comparisons();h.synthesize();
 for(const change of [e=>e.ancestors[0].candidateId='not-previously-accepted',e=>e.ancestors[0].candidateId=h.state.managedImageHistory.accepted.at(-1).candidate.id,e=>{e.ancestors[0].entryStatus='confirmed';e.ancestors[0].confirmationDigest='e'.repeat(64);},e=>e.ancestors[0].imageBindingDigests.reverse(),e=>e.missingAngles=['right']]){
  const v=copy(h.validation()),r=v.managedImageHistory.accepted.at(-1);change(r.candidate.evidenceBinding);r.acceptance.receipt.candidateDigest=digest(r.candidate);r.acceptance.receipt.evidenceBindingDigest=digest(r.candidate.evidenceBinding);assert.throws(()=>validate(v));
 }
});

test('acceptance receipts, accepting identity and cross-lane workflow/native spans cannot be fabricated',()=>{
 const h=fixture();h.oldModel();h.oldManaged();h.before();
 for(const change of [r=>r.acceptance.workflowRevision++,r=>r.acceptance.receipt.selectedIndices=[0],r=>r.acceptance.receipt.resultRevision--,r=>r.acceptance.receipt.kind='managed_completion_comparison',r=>r.acceptance.authority.membershipRevision++,r=>r.acceptance.requestId='accept-old-model-1']){
  const v=copy(h.validation());change(v.managedImageHistory.accepted.at(-1));assert.throws(()=>validate(v));
 }
 const bound=copy(h.validation());bound.workflowRevision--;assert.throws(()=>validate(bound));
});

test('duplicate, orphan and missing inputs cannot become hidden archive attachments',()=>{
 const h=fixture();h.before();
 for(const change of [v=>v.managedImageHistory.inputs=[],v=>v.managedImageHistory.inputs.push(copy(v.managedImageHistory.inputs[0])),v=>v.managedImageHistory.inputs.push(managedViewHistoryInput({stage:'after',angle:'right'})),v=>v.managedImageHistory.accepted.push(copy(v.managedImageHistory.accepted[0]))]){const v=copy(h.validation());change(v);assert.throws(()=>validate(v));}
});

test('v4 snapshot roundtrip indexes all managed v1/v2 rows without inline private paths in index',()=>{
 const h=fixture();h.oldManaged();h.before('front');h.compare('front');h.synthesize('left');h.archive();
 const input=h.snapshot(),snapshot=full.createFullWorkflowSnapshot(input);assert.equal(snapshot.schemaVersion,full.FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA);
 assert.deepEqual(full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(snapshot))),input);
 assert.equal(snapshot.index.filter(x=>x.namespace==='managed_model').length,h.state.managedImageHistory.accepted.length*2);
 assert(snapshot.index.every(x=>!Object.hasOwn(x,'sourceRecord')&&!Object.hasOwn(x,'objectReceipt')));assert(!JSON.stringify(snapshot.index).includes('supabase.co'));
 assert.equal(snapshot.evidence.archives.length,1);assert.equal(snapshot.managedImageHistory.accepted[0].candidate.schemaVersion,'design-managed-model-candidate-v1');
});

test('v3-to-v4 archive upgrade preserves original bytes and history prefixes, old v1 can append afterward',()=>{
 const h=fixture();h.oldManaged();const oldInput=copy(h.snapshot());oldInput.managedImageHistory.schemaVersion='design-managed-image-history-v1';
 const first=full.createFullWorkflowSnapshot(oldInput),bytes=full.serializeFullWorkflowSnapshot(first),firstVersion=version(first);
 h.before('front');const second=full.createFullWorkflowSnapshot(h.snapshot()),secondVersion=version(second,2,{version:1,sha256:firstVersion.sha256});
 h.oldManaged('legacy-after-upgrade');const third=full.createFullWorkflowSnapshot(h.snapshot()),thirdVersion=version(third,3,{version:2,sha256:secondVersion.sha256});
 assert.equal(first.schemaVersion,full.FULL_WORKFLOW_MANAGED_SCHEMA);assert.equal(second.schemaVersion,full.FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA);assert.equal(third.schemaVersion,full.FULL_WORKFLOW_MANAGED_VIEWS_SCHEMA);
 assert.equal(full.validateFullWorkflowChain([firstVersion,secondVersion,thirdVersion],h.state.scope).length,3);assert.equal(full.serializeFullWorkflowSnapshot(first),bytes);
 assert.deepEqual(third.managedImageHistory.accepted.slice(0,second.managedImageHistory.accepted.length),second.managedImageHistory.accepted);
});

test('outer schema relabel, dropped lane and changed managed prefixes cannot pass with rehashed wrappers',()=>{
 const h=fixture();h.oldManaged();h.before();const sn=full.createFullWorkflowSnapshot(h.snapshot()),first=version(sn);
 const relabel=copy(sn);relabel.schemaVersion=full.FULL_WORKFLOW_MANAGED_SCHEMA;const {sha256,...body}=relabel;relabel.sha256=digest(body);assert.throws(()=>full.validateFullWorkflowSnapshot(relabel));
 const drop=copy(h.snapshot());delete drop.managedImageHistory;const next=version(full.createFullWorkflowSnapshot(drop),2,{version:1,sha256:first.sha256});assert.throws(()=>full.validateFullWorkflowChain([first,next],h.state.scope),e=>e.code==='FULL_HISTORY_REWRITE');
 const oldOnly=copy(h.snapshot());oldOnly.managedImageHistory.schemaVersion='design-managed-image-history-v1';oldOnly.managedImageHistory.accepted=oldOnly.managedImageHistory.accepted.slice(0,1);oldOnly.managedImageHistory.inputs=oldOnly.managedImageHistory.inputs.slice(0,1);
 const downgrade=version(full.createFullWorkflowSnapshot(oldOnly),2,{version:1,sha256:first.sha256});assert.throws(()=>full.validateFullWorkflowChain([first,downgrade],h.state.scope),e=>e.code==='FULL_HISTORY_REWRITE');
});

test('own-data snapshot rejects getter/proxy tampering before executing it',()=>{
 const h=fixture();h.before();let calls=0;const q=copy(h.validation());Object.defineProperty(q.managedImageHistory,'accepted',{enumerable:true,get(){calls++;return [];}});
 assert.throws(()=>validate(q));assert.throws(()=>validateManagedImageHistory(q));assert.throws(()=>validate(new Proxy(h.validation(),{get(){calls++;return undefined;},ownKeys(){calls++;return [];}})));assert.equal(calls,0);
});

function archiveHarness(snapshot,{missing=false}={}){
 const grant={actor:{username:'synthetic-employee',store:'synthetic-store'},scope:snapshot.scope};let active=true,checks=0,rows=[],receipt=null;
 const gate={authorize:async()=>copy(grant)};
 const adapter=full.createPreparedFullWorkflowArchive({enabled:true,permissionGate:gate,clock:()=>Date.parse('2026-11-16T00:00:00Z'),transaction:async(context,work)=>{
  const prior=copy({rows,receipt}),hooks=[];
  try{const tx={permissionGate:gate,verifyBindings:async()=>({scope:snapshot.scope,store:grant.actor.store,...snapshot.bindings,revision:'binding-1'}),verifyPhotoRefs:async()=>true,verifySourceSnapshots:async()=>true,readVersions:async()=>copy(rows),findReceipt:async()=>copy(receipt),appendVersion:async q=>{rows.push(copy(q.version));receipt=copy(q.receipt);return true;},beforeCommit:async hook=>{hooks.push(hook);}};
   if(!missing)tx.verifyManagedImageHistory=async q=>{checks++;assert.deepEqual(q.managedImageHistory,snapshot.managedImageHistory);return active;};
   const result=await work(tx);for(const hook of hooks)await hook();return result;
  }catch(e){rows=prior.rows;receipt=prior.receipt;throw e;}
 }});
 return {adapter,request:{credential:'SYNTHETIC',scope:snapshot.scope,requestId:'full-v4',expectedVersion:0,expectedParentDigest:null,snapshot},stats:()=>({checks,rows}),revoke:()=>{active=false;}};
}
test('full v4 cannot use a legacy verifier that ignores managed provenance',async()=>{
 const f=fixture();f.before();const h=archiveHarness(full.createFullWorkflowSnapshot(f.snapshot()),{missing:true});
 await assert.rejects(h.adapter.append(h.request),e=>e.code==='FULL_MANAGED_HISTORY_DENIED');assert.equal(h.stats().rows.length,0);
});
test('full v4 append and exact replay each recheck independent managed authority, revoked replay fails',async()=>{
 const f=comparisons();f.synthesize();const h=archiveHarness(full.createFullWorkflowSnapshot(f.snapshot()));
 assert.equal((await h.adapter.append(h.request)).saved,true);const checks=h.stats().checks;assert(checks>=3);
 assert.equal((await h.adapter.append(h.request)).replayed,true);assert(h.stats().checks>checks);assert.equal(h.stats().rows.length,1);
 h.revoke();await assert.rejects(h.adapter.append(h.request),e=>e.code==='FULL_MANAGED_HISTORY_DENIED');assert.equal(h.stats().rows.length,1);
});
