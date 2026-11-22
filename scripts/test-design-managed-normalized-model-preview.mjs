/** Pure/mock only: reports and storage below are synthetic capabilities, NOT
 * PG issuance, a qualified producer/decoder or real model execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {managedViewHistoryFixture} from './fixtures/managed-view-history.mjs';
import {managedImageDigest as digest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {createManagedNormalizationProcessingIntent} from '../packages/design-production-adapter/managed-normalization-processing-contracts.mjs';
import {MANAGED_NORMALIZED_STRICT_POLICY as POLICY,MANAGED_NORMALIZED_STRICT_VERIFIER as VERIFIER,MANAGED_NORMALIZED_STRICT_CHECKS as CHECKS,createManagedNormalizedStrictReport} from '../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {syntheticCanonicalSourceBytes} from '../packages/design-production-adapter/synthetic-canonical-image-fixture.mjs';
import {createManagedNormalizedModelPreview as factory,validateManagedNormalizedMockCandidate as validate,ManagedNormalizedModelPreviewError} from '../packages/design-production-adapter/managed-normalized-model-preview.mjs';
import {validateManagedImageResultCandidate} from '../packages/analysis-engine/managed-image-result-candidate.mjs';
import {validateManagedViewResultCandidate} from '../packages/analysis-engine/managed-view-result-candidate.mjs';
import {validateManagedViewResultHistory} from '../packages/analysis-engine/managed-view-result-history.mjs';
import {createFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {MANAGED_IMAGE_MODEL_MAX_BODY_BYTES,validateManagedImageModelTransportRequest} from '../packages/design-production-adapter/managed-image-model-request.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
const result={observations:[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:null}]};
const rawResponse=(r=result,patch={})=>Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(r)},...patch}]}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const rejected=(p,code)=>assert.rejects(p,e=>e instanceof ManagedNormalizedModelPreviewError&&(!code||e.code===code)&&e.outcome==='not_sent'&&e.retryable===false);
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({stage='before',angle='front',version='final-1',subject='subject-1',bytes=syntheticCanonicalSourceBytes(),state='verified'}={}){
 const f=managedImageResultFixture(),s=clone(f.sourceRecord);s.owner.subjectId=subject;s.stage=stage;s.angle=angle;
 const d={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:80,height:120,orientation:'confirmed',immutable:true,active:true};
 const p=clone(f.response);p.sourceRecordDigest=digest(s);p.descriptor.source={bindingDigest:digest(d),objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:80,height:120,orientation:'confirmed'};p.descriptor.requestedTransform.width=80;p.descriptor.requestedTransform.height=120;
 const parent={...clone(f.objectReceipt),responseDigest:digest(p),object:{...s.object,key:'managed-derived/'+digest(p)+'/object',version:'parent-1'},derivative:clone(p.descriptor.derivative)};
 const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-1',sourceRecord:s,parentResponse:p,parentObjectReceipt:parent,output:{sha256:hash(bytes),byteLength:bytes.length,mime:'image/png',width:80,height:120}});
 const intent=createManagedNormalizationProcessingIntent({requestId:artifact.requestId,sourceRecord:s,parentResponse:p,parentObjectReceipt:parent});
 const claimedArtifact={schemaVersion:'design-claimed-normalization-v1',artifact,processingProvenance:{schemaVersion:'design-normalization-processing-provenance-v1',claimId:'normalization-claim-'+digest(intent),permissionId:'synthetic-permission',intentDigest:digest(intent),artifactDigest:digest(artifact)}};
 const objectReceipt={schemaVersion:'design-managed-normalized-object-v1',artifactDigest:digest(artifact),object:{...s.object,key:'managed-normalized/'+digest(artifact)+'/object',version},output:clone(artifact.output),private:true,readbackVerified:true};
 const task={schemaVersion:'design-normalized-strict-task-v1',taskId:'strict-task-1',claimedArtifact,objectReceipt,fixtureId:POLICY.fixture.id,verifier:clone(VERIFIER),policy:clone(POLICY)};
 const report=createManagedNormalizedStrictReport({task,checks:Object.fromEntries(CHECKS.map(k=>[k,state]))});
 const packet={task,report},calls={ledger:[],storage:[]},q={credential:'SYNTHETIC_'+ 'x'.repeat(40),scope:s.owner.scope,taskId:task.taskId,requestId:'preview-1'};
 const config={enabled:true,ledger:{async readVerified(v){calls.ledger.push(v);return clone(packet);}},storage:{async read(v){calls.storage.push(v);return bytes;}},modelConfig:{model:'synthetic-vision',maxOutputTokens:128},approvedModels:['synthetic-vision']};
 return {f,packet,bytes,q,calls,config,request:()=>({...q,mockResponse:rawResponse()})};
}

test('default closed, missing fixed capabilities and invalid configuration perform zero reads',async()=>{
 for(const patch of [{enabled:false},{ledger:{}},{storage:{}},{modelConfig:{model:'unapproved',maxOutputTokens:128}},{approvedModels:[]},{timeoutMs:30001},{timeoutMs:0}]){const h=fixture();await rejected(factory({...h.config,...patch}).prepare(h.q),'NORMALIZED_PREVIEW_DISABLED');assert.equal(h.calls.ledger.length,0);assert.equal(h.calls.storage.length,0);}
});
test('prepare uses exact private PNG version and fresh equal PG reads before/after storage',async()=>{
 const h=fixture(),p=await factory(h.config).prepare(h.q);assert.equal(p.state,'prepared_not_dispatched');assert.equal(h.calls.ledger.length,2);assert.equal(h.calls.storage.length,1);
 const read=h.calls.storage[0];assert.deepEqual(Object.keys(read).sort(),['derivative','object','private','signal']);assert.deepEqual(read.object,h.packet.task.objectReceipt.object);assert.deepEqual(read.derivative,{sha256:hash(h.bytes),byteLength:h.bytes.length,mime:'image/png'});assert.equal(read.private,true);assert.equal(read.signal.aborted,false);
 const body=JSON.parse(p.transportRequest.body);assert.equal(body.model,'synthetic-vision');assert.equal(body.stream,false);assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,'+Buffer.from(h.bytes).toString('base64'));assert.equal(p.transportRequest.payloadSha256,hash(p.transportRequest.body));assert(p.transportRequest.byteLength<MANAGED_IMAGE_MODEL_MAX_BODY_BYTES);assert(Object.isFrozen(p));
 for(const k of ['keyAccessAuthorized','requestLedgerAuthorized','submissionAuthorized','adoptionAuthorized','publicEligible'])assert.equal(p[k],false);
 assert.equal(p.transportRequest.dispatchAuthorized,false);assert(!JSON.stringify(p).includes(h.q.credential));assert.deepEqual(h.bytes,syntheticCanonicalSourceBytes());
});
test('mock finite result yields explicitly non-dispatched candidate-v3 with unconfirmed entries',async()=>{
 const h=fixture(),out=await factory(h.config).preview(h.request()),c=out.candidate;assert.equal(h.calls.ledger.length,3);assert.equal(c.schemaVersion,'design-managed-model-candidate-v3');assert.equal(c.state,'mock_preview_not_dispatched');assert.equal(c.generation,'synthetic_mock_response');assert.equal(c.kind,'managed_before_view');assert.deepEqual(c.result,result);assert.deepEqual(c.entries.map(e=>e.status),['not_confirmed','unknown']);assert.deepEqual(c.entries.map(e=>e.field),['managed_before_outline_front','managed_before_hair_shape_front']);assert.equal(c.input.verificationReportDigest,digest(h.packet.report));assert(!Object.hasOwn(c,'workflowBinding'));assert(!Object.hasOwn(c,'receiptId'));
 assert.deepEqual(validate(c,{prepared:out.prepared,...h.packet}),c);for(const k of ['keyAccessAuthorized','requestLedgerAuthorized','submissionAuthorized','adoptionAuthorized','publicEligible'])assert.equal(c[k],false);
 assert.deepEqual(Object.keys(factory(h.config)).sort(),['prepare','preview']);assert(Object.isFrozen(c.entries[0]));assert(!JSON.stringify(out).includes(h.q.credential));
});
test('old candidate validators, unchanged mixed history and full archive explicitly reject preview',async()=>{
 const h=fixture(),{candidate:c}=await factory(h.config).preview(h.request());assert.throws(()=>validateManagedImageResultCandidate(c,{session:h.f.session,workflowBinding:h.f.workflowBinding}));assert.throws(()=>validateManagedViewResultCandidate(c,{session:h.f.session,workflowBinding:h.f.workflowBinding}));
 const old=managedViewHistoryFixture();old.before();const before=JSON.stringify(old.snapshot()),history=clone(old.validation());history.managedImageHistory.accepted[0].candidate=c;assert.throws(()=>validateManagedViewResultHistory(history));const full=clone(old.snapshot());full.managedImageHistory.accepted[0].candidate=c;assert.throws(()=>createFullWorkflowSnapshot(full),e=>e.code==='FULL_MANAGED_HISTORY_INVALID');assert.equal(JSON.stringify(old.snapshot()),before);
});
test('each angle remains explicit; after/reference/detail and non-complete reports deny before bytes',async()=>{
 for(const angle of ['front','back','left','right']){const h=fixture({angle}),c=(await factory(h.config).preview(h.request())).candidate;assert(c.entries.every(e=>e.field.endsWith('_'+angle)));}
 for(const opt of [{stage:'after'},{stage:'reference'},{angle:'detail'},{state:'unknown'},{state:'failed'}]){const h=fixture(opt);await rejected(factory(h.config).prepare(h.q));assert.equal(h.calls.storage.length,0);}
});
test('self-consistent complete report is not sufficient when the trusted PG capability denies',async()=>{
 const h=fixture();h.config.ledger.readVerified=async()=>{throw Error('REVOKED synthetic secret');};await rejected(factory(h.config).prepare(h.q),'NORMALIZED_PREVIEW_DENIED');assert.equal(h.calls.storage.length,0);
});
test('old generic report, forged report, another task and changed scope reject before storage',async()=>{
 for(const change of [h=>h.packet.report=h.f.verificationReport,h=>h.packet.report={...h.packet.report,taskDigest:'0'.repeat(64)},h=>h.q.taskId='another-task',h=>h.q.scope={...h.q.scope,customerProfileId:'12'}]){const h=fixture();change(h);await rejected(factory(h.config).prepare(h.q));assert.equal(h.calls.storage.length,0);}
});
test('wrong SHA, truncated bytes, wrong PNG magic and oversized data reject',async()=>{
 for(const bytes of [Buffer.alloc(219,0),syntheticCanonicalSourceBytes().subarray(0,20),Buffer.alloc(262145)]){const h=fixture();h.config.storage.read=async()=>bytes;await rejected(factory(h.config).prepare(h.q),'NORMALIZED_PREVIEW_BINDING');}
 const h=fixture({bytes:Buffer.alloc(219,1)});await rejected(factory(h.config).prepare(h.q),'NORMALIZED_PREVIEW_BINDING');
});
test('maximum current 256KiB image still respects original 1MiB model body limit',async()=>{
 const bytes=Buffer.alloc(262144);Buffer.from(syntheticCanonicalSourceBytes()).copy(bytes);const h=fixture({bytes}),p=await factory(h.config).prepare(h.q);assert(p.transportRequest.byteLength>262144);assert(p.transportRequest.byteLength<1048576);
 const body='x'.repeat(1048577);assert.throws(()=>validateManagedImageModelTransportRequest({...p.transportRequest,body,byteLength:body.length,payloadSha256:hash(body)}));
});
test('revocation during storage read withholds even valid bytes and does not repeat read',async()=>{
 const h=fixture(),gate=deferred(),entered=deferred();let deny=false;h.config.storage.read=async()=>{entered.resolve();await gate.promise;return h.bytes;};h.config.ledger.readVerified=async()=>{h.calls.ledger.push(1);if(deny)throw Error('revoked');return h.packet;};const work=factory(h.config).prepare(h.q);await entered.promise;deny=true;gate.resolve();await rejected(work);assert.equal(h.calls.ledger.length,2);
});
test('version or full immutable principal change across reads never swaps to the new input',async()=>{
 for(const opt of [{version:'final-2'},{subject:'same-alias-new-person'}]){const h=fixture(),other=fixture(opt);let calls=0;h.config.ledger.readVerified=async()=>++calls===1?h.packet:other.packet;await rejected(factory(h.config).prepare(h.q),'NORMALIZED_PREVIEW_BINDING');assert.equal(calls,2);}
});
test('last fresh read after mock parsing can revoke and prevent candidate delivery',async()=>{
 const h=fixture();let n=0;h.config.ledger.readVerified=async()=>{if(++n===3)throw Error('expired report');return h.packet;};await rejected(factory(h.config).preview(h.request()));assert.equal(n,3);
});
test('finite parser refuses empty, duplicates, inferred sensitive claims and tool/truncated replies',async()=>{
 for(const raw of [rawResponse({observations:[]}),rawResponse({observations:[result.observations[0],result.observations[0]]}),rawResponse({observations:[{field:'age',value:'25'}]}),rawResponse({observations:[{field:'visible_outline',value:'invented'}]}),rawResponse(result,{finish_reason:'length'}),rawResponse(result,{message:{role:'assistant',content:JSON.stringify(result),tool_calls:[]}}),Buffer.from('{'),Buffer.alloc(262145)]){const h=fixture();await rejected(factory(h.config).preview({...h.q,mockResponse:raw}));assert(h.calls.ledger.length<=2);}
});
test('mock response is a snapshot; caller mutation during an awaited read cannot change preview',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred();let n=0;h.config.ledger.readVerified=async()=>{if(++n===1){entered.resolve();await resume.promise;}return h.packet;};const q=h.request(),before=Buffer.from(q.mockResponse),p=factory(h.config).preview(q);await entered.promise;q.mockResponse.fill(0);resume.resolve();assert.deepEqual((await p).candidate.result,result);assert(before.some(x=>x!==0));
});
test('model allowlist is snapshotted and caller cannot add authority or arbitrary URL/task JSON',async()=>{
 const h=fixture(),p=factory(h.config);h.config.modelConfig.model='changed';h.config.approvedModels.length=0;assert.equal((await p.prepare(h.q)).model,'synthetic-vision');
 for(const patch of [{url:'https://evil.invalid'},{task:h.packet.task},{report:h.packet.report},{authority:h.f.authority},{submissionAuthorized:true}])await rejected(p.prepare({...h.q,...patch}),'NORMALIZED_PREVIEW_INVALID');
});
test('untrusted accessors/proxies are not evaluated; shared buffers are rejected',async()=>{
 const h=fixture();let traps=0;const q={...h.q};Object.defineProperty(q,'taskId',{enumerable:true,get(){traps++;return h.q.taskId;}});await rejected(factory(h.config).prepare(q));await rejected(factory(h.config).prepare(new Proxy(h.q,{get(){traps++;},ownKeys(){traps++;}})));const bad=clone(h.packet);Object.defineProperty(bad.task.policy,'id',{enumerable:true,get(){traps++;return POLICY.id;}});h.config.ledger.readVerified=async()=>bad;await rejected(factory(h.config).prepare(h.q));assert.equal(traps,0);
 const g=fixture();g.config.storage.read=async()=>new Uint8Array(new SharedArrayBuffer(219));await rejected(factory(g.config).prepare(g.q));
});
test('dependency and mutable exported errors are rebuilt without secret payloads',async()=>{
 for(const error of [Object.assign(Error('SECRET'),{code:'SECRET',secret:'SECRET'}),Object.assign(new ManagedNormalizedModelPreviewError('NORMALIZED_PREVIEW_DENIED'),{message:'SECRET',secret:'SECRET'}),Object.assign(new ManagedNormalizedModelPreviewError(),{code:'SECRET',message:'SECRET'})]){const h=fixture();h.config.ledger.readVerified=async()=>{throw error;};await assert.rejects(factory(h.config).prepare(h.q),e=>e.code==='NORMALIZED_PREVIEW_DENIED'&&e.message==='NORMALIZED_PREVIEW_DENIED'&&!JSON.stringify(e).includes('SECRET'));}
});
test('already aborted request does zero I/O and fake signals reject',async()=>{
 const h=fixture(),c=new AbortController();c.abort();await rejected(factory(h.config).prepare({...h.q,signal:c.signal}),'NORMALIZED_PREVIEW_ABORTED');assert.equal(h.calls.ledger.length,0);for(const signal of [{aborted:false},null,new Proxy(c.signal,{})])await rejected(factory(h.config).prepare({...h.q,signal}));
});
test('timeout does not release admission or publish a late storage result',async t=>{
 // Test the actual default timer deterministically after storage is entered.
 // A 15ms wall-clock budget could expire during fixture validation under a
 // parallel test load, before entered resolved and before a rejection handler.
 t.mock.timers.enable({apis:['setTimeout']});
 const h=fixture(),entered=deferred(),resume=deferred();let reads=0;h.config.storage.read=async v=>{reads++;entered.resolve(v.signal);await resume.promise;return h.bytes;};const p=factory(h.config),work=p.prepare(h.q),rejection=rejected(work,'NORMALIZED_PREVIEW_TIMEOUT'),signal=await entered.promise;t.mock.timers.tick(30000);await rejection;assert.equal(signal.aborted,true);await rejected(p.prepare(h.q),'NORMALIZED_PREVIEW_BUSY');assert.equal(reads,1);resume.resolve();await tick();await tick();assert.equal(h.calls.ledger.length,1);assert.deepEqual(h.bytes,syntheticCanonicalSourceBytes());
});
test('external abort while ledger waits retains admission until actual dependency settles',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred(),c=new AbortController();h.config.ledger.readVerified=async()=>{entered.resolve();await resume.promise;return h.packet;};const p=factory(h.config),work=p.prepare({...h.q,signal:c.signal});await entered.promise;c.abort();await rejected(work,'NORMALIZED_PREVIEW_ABORTED');await rejected(p.prepare(h.q),'NORMALIZED_PREVIEW_BUSY');resume.resolve();await tick();assert.equal(h.calls.storage.length,0);
});
test('concurrent preparation is bounded to one lease; failure never automatically retries',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred();let n=0;h.config.ledger.readVerified=async()=>{n++;entered.resolve();await resume.promise;throw Error('connection unknown');};const p=factory(h.config),work=p.prepare(h.q);await entered.promise;await rejected(p.preview(h.request()),'NORMALIZED_PREVIEW_BUSY');resume.resolve();await rejected(work);assert.equal(n,1);await tick();assert.equal(n,1);
});
test('candidate digest, strict source binding, flags and mock label cannot be relabelled',async()=>{
 const h=fixture(),out=await factory(h.config).preview(h.request());for(const mutate of [c=>c.schemaVersion='design-managed-model-candidate-v2',c=>c.state='completed',c=>c.generation='model',c=>c.adoptionAuthorized=true,c=>c.submissionAuthorized=true,c=>c.requestLedgerAuthorized=true,c=>c.entries[0].status='confirmed',c=>c.input.taskId='other',c=>c.input.verificationReportDigest='0'.repeat(64),c=>c.result.observations[0].value='轮廓偏方']){const c=clone(out.candidate);mutate(c);assert.throws(()=>validate(c,{prepared:out.prepared,...h.packet}));}
});
test('pure preview validation also binds exact prompt/body, bytes and model configuration',async()=>{
 const h=fixture(),out=await factory(h.config).preview(h.request());
 for(const mutate of [p=>p.model='different',p=>p.maxOutputTokens=256,p=>{const b=JSON.parse(p.transportRequest.body);b.messages[0].content='changed prompt';p.transportRequest.body=JSON.stringify(b);p.transportRequest.byteLength=Buffer.byteLength(p.transportRequest.body);p.transportRequest.payloadSha256=hash(p.transportRequest.body);},p=>{const b=JSON.parse(p.transportRequest.body);b.messages[1].content[1].image_url.url='data:image/png;base64,'+Buffer.alloc(h.bytes.length).toString('base64');p.transportRequest.body=JSON.stringify(b);p.transportRequest.byteLength=Buffer.byteLength(p.transportRequest.body);p.transportRequest.payloadSha256=hash(p.transportRequest.body);}]){const p=clone(out.prepared);mutate(p);assert.throws(()=>validate(out.candidate,{prepared:p,...h.packet}));}
});
