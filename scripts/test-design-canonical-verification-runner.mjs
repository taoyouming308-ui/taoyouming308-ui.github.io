/** Pure issuer/storage/runtime mocks, no container, PG, decoder or real image
 * qualification. Tests target byte ownership and fixed role composition only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalVerificationPureFixture,canonicalBinaryResult} from './fixtures/canonical-verification-pure.mjs';
import {createCanonicalVerificationRunner as factory,CanonicalVerificationRunnerError} from '../packages/design-production-adapter/managed-canonical-verification-runner.mjs';
import {managedImageDigest as digest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedNormalizedModelPreview} from '../packages/design-production-adapter/managed-normalized-model-preview.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone,tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const rejects=(work,code)=>assert.rejects(work,e=>e instanceof CanonicalVerificationRunnerError&&e.code===code&&e.message===code&&e.retryable===false&&e.outcome===(code==='CANONICAL_RUNNER_UNCERTAIN'?'uncertain':'not_published'));
function fixture(){
 const f=canonicalVerificationPureFixture(),events=[],borrowed=[],published=[];
 const issuer={async readTask(q){events.push('task');assert.deepEqual(q,f.query);return f.task;},async guardTask(q){events.push('guard');assert.deepEqual(q,{...f.query,taskDigest:digest(f.task)});return true;},async publishReport(q){events.push('publish');assert.deepEqual(Object.keys(q).sort(),['credential','report','scope','taskId']);assert.equal(q.credential,f.query.credential);published.push(q.report);return {task:f.task,report:q.report};}};
 Object.defineProperty(issuer,'readStatus',{get(){throw Error('UNGRANTED_RUNTIME_CAPABILITY');}});
 const storage={async read(q){events.push('read');assert.deepEqual(Object.keys(q).sort(),['derivative','object','private','signal']);assert.equal(q.private,true);assert.equal(q.signal.aborted,false);
  for(const [object,derivative,bytes] of [[f.sourceRecord.object,f.sourceRecord.source,f.sourceBytes],[f.parentObjectReceipt.object,f.parentObjectReceipt.derivative,f.parentBytes],[f.objectReceipt.object,{sha256:f.artifact.output.sha256,byteLength:f.artifact.output.byteLength,mime:'image/png'},f.normalizedBytes]])if(q.object.key===object.key){assert.deepEqual(q.object,object);assert.deepEqual(q.derivative,derivative);return bytes;}
  throw Error('UNEXPECTED_OBJECT');
 }};
 const runtime={async verifyTask(q){events.push('runtime');assert.deepEqual(Object.keys(q).sort(),['normalizedBytes','parentBytes','signal','sourceBytes','task']);assert.equal(q.signal.aborted,false);assert.deepEqual(q.task,f.task);borrowed.push(q.sourceBytes,q.parentBytes,q.normalizedBytes);return canonicalBinaryResult(q.task);}};
 const config={enabled:true,issuer,storage,runtime,timeoutMs:1000};return {...f,events,borrowed,published,issuer,storage,runtime,config,runner:()=>factory(config)};
}
test('default closed, incomplete dependencies and invalid total budget do no I/O',async()=>{
 const h=fixture();for(const patch of [{enabled:false},{issuer:{}},{storage:{}},{runtime:{}},{timeoutMs:0},{timeoutMs:30001},{timeoutMs:NaN}])await rejects(()=>factory({...h.config,...patch}).run(h.query),'CANONICAL_RUNNER_DISABLED');assert.deepEqual(h.events,[]);
});
test('fixed independent task, three exact private object versions and real byte hashes compose',async()=>{
 const h=fixture(),original=[h.sourceBytes,h.parentBytes,h.normalizedBytes].map(b=>Buffer.from(b)),out=await h.runner().run(h.query);
 assert.deepEqual(h.events,['task','guard','read','guard','read','guard','read','guard','runtime','guard','publish','guard']);assert.deepEqual(out,{taskId:h.task.taskId,state:'evidence_complete',reportDigest:digest(h.published[0])});assert(Object.isFrozen(out));
 assert.equal(h.borrowed.length,3);assert(h.borrowed.every(b=>b.every(x=>x===0)));[h.sourceBytes,h.parentBytes,h.normalizedBytes].forEach((b,i)=>assert.deepEqual(b,original[i]));
 assert.deepEqual([h.published[0].submissionAuthorized,h.published[0].adoptionAuthorized,h.published[0].publicEligible],[false,false,false]);assert(!JSON.stringify(out).includes(h.query.credential));assert.equal(Object.hasOwn(h.published[0].checks,'fullDecode'),false);
});
test('success has the exact reader packet required by the separate prepared/mock preview lane',async()=>{
 const h=fixture();await h.runner().run(h.query);let reads=0;const preview=createManagedNormalizedModelPreview({enabled:true,ledger:{async readVerified(q){reads++;assert.deepEqual(q,h.query);return {task:h.task,report:h.published[0]};}},storage:h.storage,modelConfig:{model:'synthetic-vision',maxOutputTokens:128},approvedModels:['synthetic-vision']});
 const mockResponse=Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({observations:[{field:'visible_outline',value:null}]})}}]}));
 const out=await preview.preview({...h.query,requestId:'mock-canonical-preview',mockResponse});assert.equal(reads,3);assert.equal(out.candidate.state,'mock_preview_not_dispatched');assert.equal(out.candidate.submissionAuthorized,false);assert.equal(out.prepared.state,'prepared_not_dispatched');
});
test('wrong task ID/scope denies before storage; task JSON cannot be supplied as request',async()=>{
 for(const patch of [{taskId:'other-task'},{scope:{...fixture().scope,customerProfileId:'999'}}]){const h=fixture();h.issuer.readTask=async()=>h.task;await rejects(()=>h.runner().run({...h.query,...patch}),'CANONICAL_RUNNER_DENIED');assert(!h.events.includes('read'));}
 const h=fixture();await rejects(()=>h.runner().run({...h.query,task:h.task}),'CANONICAL_RUNNER_INVALID');assert.deepEqual(h.events,[]);
});
test('different source/parent/final versions and verifier policy cannot borrow an existing task',async()=>{
 for(const change of [t=>t.claimedArtifact.artifact.sourceRecord.object.version='changed',t=>t.claimedArtifact.artifact.parentObjectReceipt.object.version='changed',t=>t.verifier.id='old-generic',t=>t.policy.parentTransform.maxEdges=[1536]]){const h=fixture(),t=clone(h.task);change(t);h.issuer.readTask=async()=>t;await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert(!h.events.includes('read'));}
 const h=fixture(),t=clone(h.task);t.objectReceipt.object.version='new-version';h.issuer.readTask=async()=>t;h.issuer.guardTask=async q=>q.taskDigest===digest(h.task);await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_DENIED');assert(!h.events.includes('read'));
});
for(const part of ['sourceBytes','parentBytes','normalizedBytes'])test(`${part} actual SHA mismatch blocks runtime and publication`,async()=>{
 const h=fixture(),read=h.storage.read;h.storage.read=async q=>{const b=await read(q);return b===h[part]?Buffer.alloc(b.length,1):b;};await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert(!h.events.includes('runtime'));assert.equal(h.published.length,0);
});
test('invalid, truncated, shared and oversized byte results never reach runtime',async()=>{
 for(const value of [Buffer.alloc(1),new Uint8Array(new SharedArrayBuffer(20)),new Uint8Array(8388609),new DataView(new ArrayBuffer(20)),new Proxy(new Uint8Array(20),{})]){const h=fixture();h.storage.read=async()=>value;await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert(!h.events.includes('runtime'));assert.equal(h.published.length,0);}
});
test('unknown and failed binary checks remain explicit non-qualification with no evidence',async()=>{
 for(const check of ['unknown','failed']){const h=fixture();h.runtime.verifyTask=async q=>canonicalBinaryResult(q.task,{check});const out=await h.runner().run(h.query);assert.equal(out.state,check==='unknown'?'pending_validation':'validation_failed');assert.equal(h.published[0].evidence,null);assert.equal(h.published[0].submissionAuthorized,false);}
});
test('forged metrics, wrong binding and legacy generic binary result never publish',async()=>{
 for(const change of [r=>r.schemaVersion='design-managed-normalized-binary-result-v1',r=>r.bindingDigest='0'.repeat(64),r=>r.normalized.pixelSha256='0'.repeat(64),r=>r.normalized.consumedCompressedBytes--,r=>r.source.producerSha256='0'.repeat(64),r=>r.checks.fullDecode='verified']){const h=fixture();h.runtime.verifyTask=async q=>{const r=canonicalBinaryResult(q.task);change(r);return r;};await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert.equal(h.published.length,0);}
});
test('runtime cannot mutate its input bytes and publish evidence about their original digest',async()=>{
 for(const part of ['sourceBytes','parentBytes','normalizedBytes']){const h=fixture();let borrowed;h.runtime.verifyTask=async q=>{borrowed=q[part];q[part][0]^=1;return canonicalBinaryResult(q.task);};await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert.equal(h.published.length,0);assert(borrowed.every(x=>x===0));}
});
test('every pre-publication fresh check rejects false or unknown; no permissive fallback',async()=>{
 for(let nth=1;nth<=5;nth++){const h=fixture();let n=0;h.issuer.guardTask=async()=>++n!==nth;await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_DENIED');assert.equal(h.published.length,0);assert.equal(h.events.includes('runtime'),nth===5);}
 for(const value of [undefined,null,1,'true']){const h=fixture();h.issuer.guardTask=async()=>value;await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_DENIED');assert.equal(h.published.length,0);}
});
test('revocation during runtime wait is checked before attempting report publication',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred();let live=true;h.issuer.guardTask=async()=>live;h.runtime.verifyTask=async q=>{entered.resolve();await resume.promise;return canonicalBinaryResult(q.task);};const run=h.runner().run(h.query);await entered.promise;live=false;resume.resolve();await rejects(()=>run,'CANONICAL_RUNNER_DENIED');assert.equal(h.published.length,0);
});
test('captured methods and validated task are immutable across callback waits',async()=>{
 const h=fixture(),runner=h.runner();h.runtime.verifyTask=()=>{throw Error('changed');};await runner.run(h.query);assert.equal(h.published.length,1);assert(Object.isFrozen(h.published[0].verificationBinding.policy));
});
test('publication lost ack or bad exact acknowledgement is uncertain and cannot resend',async()=>{
 for(const mode of ['throw','extra','task','report','null']){const h=fixture();let calls=0;h.issuer.publishReport=async q=>{calls++;if(mode==='throw')throw Error('lost ack');const ack={task:h.task,report:q.report};if(mode==='extra')ack.secret='SECRET';if(mode==='task')ack.task={...h.task,taskId:'changed'};if(mode==='report')ack.report={...q.report,taskDigest:'0'.repeat(64)};return mode==='null'?null:ack;};const runner=h.runner();await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_UNCERTAIN');await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');assert.equal(calls,1);}
});
test('post-publication revoke is uncertain even though one durable report may exist',async()=>{
 const h=fixture();let n=0;h.issuer.guardTask=async()=>++n!==6;const runner=h.runner();await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_UNCERTAIN');assert.equal(h.published.length,1);await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');
});
test('already aborted, malformed signals and untrusted selector getters never start I/O',async()=>{
 const h=fixture(),controller=new AbortController();controller.abort();await rejects(()=>h.runner().run({...h.query,signal:controller.signal}),'CANONICAL_RUNNER_ABORTED');for(const signal of [{aborted:false},null,new Proxy(controller.signal,{})])await rejects(()=>h.runner().run({...h.query,signal}),'CANONICAL_RUNNER_INVALID');let touches=0;const q={...h.query};Object.defineProperty(q,'taskId',{enumerable:true,get(){touches++;return h.task.taskId;}});await rejects(()=>h.runner().run(q),'CANONICAL_RUNNER_INVALID');await rejects(()=>h.runner().run(new Proxy(h.query,{get(){touches++;}})),'CANONICAL_RUNNER_INVALID');assert.equal(touches,0);assert.deepEqual(h.events,[]);
});
test('dependency mutable errors are sanitized without invoking a code getter',async()=>{
 for(const accessor of [false,true]){const h=fixture(),e=new CanonicalVerificationRunnerError('CANONICAL_RUNNER_DENIED');let n=0;e.message='SECRET';e.secret='SECRET';if(accessor)Object.defineProperty(e,'code',{get(){n++;return 'SECRET';}});else e.code='SECRET';h.issuer.readTask=async()=>{throw e;};await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert.equal(n,0);}
});
test('late storage result holds admission; borrowed owned copies wipe but storage cache is retained',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred(),controller=new AbortController();let reads=0;const original=Buffer.from(h.sourceBytes);h.storage.read=async()=>{reads++;entered.resolve();return resume.promise;};const runner=h.runner(),run=runner.run({...h.query,signal:controller.signal});await entered.promise;controller.abort();await rejects(()=>run,'CANONICAL_RUNNER_ABORTED');await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');resume.resolve(h.sourceBytes);await tick();assert.equal(reads,1);assert.deepEqual(h.sourceBytes,original);assert.equal(h.published.length,0);
});
test('late runtime keeps borrowed bytes live until raw callback settles, then wipes all three',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred(),controller=new AbortController();let q;h.runtime.verifyTask=async value=>{q=value;entered.resolve();await resume.promise;return canonicalBinaryResult(q.task);};const runner=h.runner(),run=runner.run({...h.query,signal:controller.signal});await entered.promise;controller.abort();await rejects(()=>run,'CANONICAL_RUNNER_ABORTED');await tick();for(const k of ['sourceBytes','parentBytes','normalizedBytes'])assert(q[k].some(x=>x!==0));await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');resume.resolve();await tick();for(const k of ['sourceBytes','parentBytes','normalizedBytes'])assert(q[k].every(x=>x===0));assert.equal(h.published.length,0);
 // Explicitly new invocation after a pre-publication failure may run; no retry
 // happened automatically, and the prior raw callback no longer owns buffers.
 assert.equal((await runner.run(h.query)).state,'evidence_complete');assert.equal(h.published.length,1);
});
test('late task and guard promises also retain admission and cannot continue to storage',async()=>{
 for(const target of ['readTask','guardTask']){const h=fixture(),entered=deferred(),resume=deferred(),controller=new AbortController();h.issuer[target]=async()=>{entered.resolve();await resume.promise;return target==='readTask'?h.task:true;};const runner=h.runner(),run=runner.run({...h.query,signal:controller.signal});await entered.promise;controller.abort();await rejects(()=>run,'CANONICAL_RUNNER_ABORTED');await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');resume.resolve();await tick();assert(!h.events.includes('read'));assert.equal(h.published.length,0);}
});
test('late publication cannot report success or be repeated after acknowledgement eventually arrives',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred(),controller=new AbortController();let pub;h.issuer.publishReport=async q=>{pub=q;entered.resolve();await resume.promise;return {task:h.task,report:q.report};};const runner=h.runner(),run=runner.run({...h.query,signal:controller.signal});await entered.promise;controller.abort();await rejects(()=>run,'CANONICAL_RUNNER_UNCERTAIN');assert(pub);assert(h.borrowed.some(b=>b.some(x=>x!==0)));await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');resume.resolve();await tick();assert(h.borrowed.every(b=>b.every(x=>x===0)));await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');assert.equal(h.events.filter(e=>e==='guard').length,5);
});
test('one absolute timeout bounds all stages and retains late runtime admission',async()=>{
 const h=fixture(),entered=deferred(),resume=deferred();let q;h.runtime.verifyTask=async value=>{q=value;entered.resolve();await resume.promise;return canonicalBinaryResult(q.task);};const runner=factory({...h.config,timeoutMs:100}),run=runner.run(h.query);await entered.promise;await rejects(()=>run,'CANONICAL_RUNNER_TIMEOUT');assert.equal(q.signal.aborted,true);await rejects(()=>runner.run(h.query),'CANONICAL_RUNNER_BUSY');resume.resolve();await tick();assert(q.normalizedBytes.every(x=>x===0));assert.equal(h.published.length,0);
});
test('dependency methods do not evaluate an overridden bind getter or callable Proxy',async()=>{
 const h=fixture();let touched=0;const fn=async()=>h.task;Object.defineProperty(fn,'bind',{get(){touched++;throw Error('SECRET_BIND');}});h.issuer.readTask=fn;
 const runner=h.runner();await runner.run(h.query);assert.equal(touched,0);
 const other=fixture();other.issuer.readTask=new Proxy(async()=>other.task,{get(){touched++;throw Error('SECRET_PROXY');},apply(){touched++;throw Error('SECRET_PROXY');}});const disabled=other.runner();await rejects(()=>disabled.run(other.query),'CANONICAL_RUNNER_DISABLED');assert.equal(touched,0);
});
test('retained runtime buffer mutation during final fresh guard is rejected before publish',async()=>{
 const h=fixture();let q,n=0;h.runtime.verifyTask=async value=>{q=value;return canonicalBinaryResult(q.task);};h.issuer.guardTask=async()=>{if(++n===5)q.normalizedBytes[0]^=1;return true;};await rejects(()=>h.runner().run(h.query),'CANONICAL_RUNNER_INVALID');assert.equal(h.published.length,0);
});
