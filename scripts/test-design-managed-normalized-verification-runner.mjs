/** Protocol composition only. Synthetic byte strings are not images, and the
 * injected complete inspector is NOT a qualified decoder or production proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedNormalizedVerificationRunner,ManagedNormalizedVerificationRunnerError} from '../packages/design-production-adapter/managed-normalized-verification-runner.mjs';
import {managedImageDigest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {normalizedVerificationFixture,normalizedBinaryResult} from './fixtures/managed-normalized-verification.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const reject=(work,code)=>assert.rejects(work,e=>e instanceof ManagedNormalizedVerificationRunnerError&&e.code===code&&e.message===code&&e.retryable===false&&e.outcome===(code==='NORMALIZED_RUNNER_UNCERTAIN'?'uncertain':'not_published'));
function fixture(){
 const f=normalizedVerificationFixture(),events=[],borrowed=[],published=[];
 const task=()=>({taskId:f.taskId,artifact:f.artifact,objectReceipt:f.objectReceipt,verifier:f.verifier,policyVersion:f.policyVersion});
 const issuer={
  async readVerificationTask(q){events.push('task');assert.deepEqual(Object.keys(q).sort(),['credential','scope','taskId']);assert.deepEqual(q,f.input);return task();},
  async checkVerificationBinding(q){events.push('guard');assert.deepEqual(Object.keys(q).sort(),['binding','credential','scope','taskId']);assert.equal(q.binding.taskId,f.taskId);return true;},
  async publishVerification(q){events.push('publish');assert.deepEqual(Object.keys(q).sort(),['credential','report','scope','taskId']);published.push(q.report);return {...task(),verificationReport:q.report};}
 };
 // The runner must not require or probe ordinary runtime read privileges.
 Object.defineProperty(issuer,'readVerificationStatus',{get(){throw Error('RUNTIME_PRIVILEGE_FORBIDDEN');}});
 const storage={async read(q){events.push('read');assert.deepEqual(Object.keys(q).sort(),['derivative','object','private','signal']);assert.equal(q.private,true);assert.equal(q.signal.aborted,false);
  for(const [object,derivative,bytes] of [[f.sourceRecord.object,f.sourceRecord.source,f.sourceBytes],[f.parentObjectReceipt.object,f.parentObjectReceipt.derivative,f.parentBytes],[f.objectReceipt.object,{sha256:f.artifact.output.sha256,byteLength:f.artifact.output.byteLength,mime:f.artifact.output.mime},f.normalizedBytes]])if(q.object.key===object.key){assert.deepEqual(q.object,object);assert.deepEqual(q.derivative,derivative);return bytes;}
  throw Error('UNEXPECTED_PRIVATE_OBJECT');
 }};
 const runtime={async verifyBinary(q,signal){events.push('inspect');assert.equal(signal.aborted,false);assert(!Object.hasOwn(q,'credential'));borrowed.push(q.sourceBytes,q.parentBytes,q.normalizedBytes);return normalizedBinaryResult(f,q.binding);}};
 const config={enabled:true,issuer,storage,runtime,verifier:f.verifier,policyVersion:f.policyVersion,timeoutMs:1000};
 return {...f,events,borrowed,published,task,issuer,storage,runtime,config,runner:()=>createManagedNormalizedVerificationRunner(config)};
}

test('default off, incomplete config and excessive budget never touch injected capabilities',async()=>{
 const f=fixture();for(const config of [{},{...f.config,enabled:false},{...f.config,runtime:null},{...f.config,timeoutMs:30001},{...f.config,timeoutMs:0},{...f.config,policyVersion:'arbitrary policy'}])await reject(()=>createManagedNormalizedVerificationRunner(config).run(f.input),'NORMALIZED_RUNNER_DISABLED');assert.equal(f.events.length,0);
});
test('exact independent task, three private versions, root verifier, issuer publish and fresh guard compose',async()=>{
 const f=fixture(),out=await f.runner().run(f.input);
 assert.deepEqual(out,{taskId:f.taskId,state:'evidence_complete',reportDigest:managedImageDigest(f.published[0])});assert(Object.isFrozen(out));
 assert.deepEqual(f.events,['task','guard','read','guard','read','guard','read','guard','inspect','guard','publish','guard']);
 assert(f.borrowed.every(b=>b.every(x=>x===0)));assert.equal(f.sourceBytes.toString(),'SYNTHETIC source');
 assert.deepEqual([f.published[0].submissionAuthorized,f.published[0].adoptionAuthorized,f.published[0].publicEligible],[false,false,false]);
 assert.deepEqual(Object.keys(out).sort(),['reportDigest','state','taskId']);
});
for(const field of ['taskId','verifier','policyVersion'])test(`independent task ${field} must match fixed runner config before any byte read`,async()=>{
 const f=fixture();f.issuer.readVerificationTask=async()=>({...f.task(),[field]:field==='verifier'?{id:'other-verifier',version:'1'}:'other'});
 await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_BINDING');assert.equal(f.events.length,0);
});
test('wrong scope and changed receipt artifact fail before storage',async()=>{
 const f=fixture();f.issuer.readVerificationTask=async()=>f.task();await reject(()=>f.runner().run({...f.input,scope:{...f.scope,customerProfileId:'999'}}),'NORMALIZED_RUNNER_BINDING');
 f.issuer.readVerificationTask=async()=>({...f.task(),objectReceipt:{...f.objectReceipt,artifactDigest:'f'.repeat(64)}});await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_DENIED');assert.equal(f.events.length,0);
});
for(const part of ['sourceBytes','parentBytes','normalizedBytes'])test(`${part} same-length wrong bytes cannot reach runtime or issuer publication`,async()=>{
 const f=fixture(),original=f.storage.read;f.storage.read=async q=>{const b=await original(q);return b===f[part]?Buffer.alloc(b.length,1):b;};await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_BINDING');assert(!f.events.includes('inspect'));assert(!f.events.includes('publish'));
});
test('invalid, shared and oversized storage bytes reject without decode',async()=>{
 for(const value of [new Uint8Array(new SharedArrayBuffer(20)),new Uint8Array(8*1024*1024+1),new DataView(new ArrayBuffer(20)),new Proxy(new Uint8Array(20),{})]){
  const f=fixture();f.storage.read=async()=>value;await assert.rejects(()=>f.runner().run(f.input),e=>['NORMALIZED_RUNNER_BINDING','NORMALIZED_RUNNER_INVALID'].includes(e.code));assert(!f.events.includes('inspect'));assert(!f.events.includes('publish'));
 }
});
test('each unknown check remains pending; any failed check is published only as failed',async()=>{
 for(const name of ['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry']){
  const f=fixture();f.runtime.verifyBinary=async q=>{const r=normalizedBinaryResult(f,q.binding);r.checks[name]='unknown';return r;};const out=await f.runner().run(f.input);assert.equal(out.state,'pending_validation');assert.equal(f.published[0].evidence,null);
 }
 const f=fixture();f.runtime.verifyBinary=async q=>{const r=normalizedBinaryResult(f,q.binding);r.checks.parentBinding='failed';return r;};assert.equal((await f.runner().run(f.input)).state,'validation_failed');assert.equal(f.published[0].evidence,null);
});
test('forged runtime measurements, binding, verifier or mutation never publishes',async()=>{
 for(const bad of ['binding','verifier','measure','bytes']){
  const f=fixture();f.runtime.verifyBinary=async q=>{const r=normalizedBinaryResult(f,q.binding);if(bad==='binding')r.bindingDigest='a'.repeat(64);if(bad==='verifier')r.verifier={id:'self-appointed',version:'1'};if(bad==='measure')r.normalized.width=1;if(bad==='bytes')q.parentBytes[0]^=1;return r;};
  await assert.rejects(()=>f.runner().run(f.input),e=>['NORMALIZED_RUNNER_BINDING','NORMALIZED_RUNNER_RUNTIME'].includes(e.code));assert.equal(f.published.length,0);
 }
});
test('every pre-publication fresh guard may deny without producing or sending a report',async()=>{
 for(let nth=1;nth<=5;nth++){
  const f=fixture();let calls=0;f.issuer.checkVerificationBinding=async()=>++calls!==nth;await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_DENIED');assert.equal(f.published.length,0);assert.equal(f.events.includes('inspect'),nth===5);
 }
});
test('revocation during final inspection wait is checked before publication',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred();let live=true;f.issuer.checkVerificationBinding=async()=>live;f.runtime.verifyBinary=async q=>{entered.resolve();await finish.promise;return normalizedBinaryResult(f,q.binding);};
 const run=f.runner().run(f.input);await entered.promise;live=false;finish.resolve();await reject(()=>run,'NORMALIZED_RUNNER_DENIED');assert.equal(f.published.length,0);
});
test('configuration snapshots verifier and methods; report cannot choose runtime identity',async()=>{
 const f=fixture(),fixed={...f.verifier};f.config.verifier=fixed;const runner=f.runner();fixed.id='mutated';f.runtime.verifyBinary=()=>{throw Error('replaced');};await runner.run(f.input);assert.equal(f.published[0].verificationBinding.verifier.id,f.verifier.id);
});
test('malformed or different publication ack is uncertain and blocks same-instance retry',async()=>{
 for(const mode of ['task','report','extra','null']){
  const f=fixture();let attempts=0;f.issuer.publishVerification=async q=>{attempts++;const ack={...f.task(),verificationReport:q.report};if(mode==='task')ack.taskId='other';if(mode==='report'){ack.verificationReport=structuredClone(q.report);ack.verificationReport.checks.sourceBinding='unknown';}if(mode==='extra')ack.secret='MUST_NOT_LEAK';return mode==='null'?null:ack;};
  const runner=f.runner();await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_UNCERTAIN');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');assert.equal(attempts,1);
 }
});
test('lost publication ack is uncertain even with a misleading exported error',async()=>{
 const f=fixture();f.issuer.publishVerification=()=>{const e=new ManagedNormalizedVerificationRunnerError('NORMALIZED_RUNNER_INVALID');e.message='secret';e.code='secret';e.extra='secret';throw e;};const runner=f.runner();await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_UNCERTAIN');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');
});
test('post-publication fresh revocation withholds success and is uncertain, never resend',async()=>{
 const f=fixture();let calls=0;f.issuer.checkVerificationBinding=async()=>++calls!==6;const runner=f.runner();await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_UNCERTAIN');assert.equal(f.published.length,1);await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');
});
test('late storage keeps admission; cannot start a second read or publish after abort',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred(),controller=new AbortController();let reads=0;f.storage.read=async()=>{reads++;entered.resolve();return finish.promise;};const runner=f.runner(),run=runner.run({...f.input,signal:controller.signal});
 await entered.promise;controller.abort();await reject(()=>run,'NORMALIZED_RUNNER_ABORTED');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve(f.sourceBytes);await tick();assert.equal(reads,1);assert.equal(f.published.length,0);assert.equal(f.sourceBytes.toString(),'SYNTHETIC source');
});
test('underlying late native promise holds admission and borrowed bytes beyond verify abort race',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred(),controller=new AbortController();let q;
 f.runtime.verifyBinary=async input=>{q=input;entered.resolve();await finish.promise;return normalizedBinaryResult(f,q.binding);};const runner=f.runner(),run=runner.run({...f.input,signal:controller.signal});
 await entered.promise;controller.abort();await reject(()=>run,'NORMALIZED_RUNNER_ABORTED');await tick();assert(q.parentBytes.some(x=>x!==0));await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve();await tick();assert(q.sourceBytes.every(x=>x===0));assert(q.parentBytes.every(x=>x===0));assert(q.normalizedBytes.every(x=>x===0));assert.equal(f.published.length,0);
 // Late work settled, so a new explicit call can run (no automatic retry).
 const out=await runner.run(f.input);assert.equal(out.state,'evidence_complete');assert.equal(f.published.length,1);
});
test('late issuer task callback holds admission without any byte read',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred(),controller=new AbortController();f.issuer.readVerificationTask=()=>{entered.resolve();return finish.promise;};const runner=f.runner(),run=runner.run({...f.input,signal:controller.signal});await entered.promise;controller.abort();await reject(()=>run,'NORMALIZED_RUNNER_ABORTED');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve(f.task());await tick();assert.equal(f.events.length,0);
});
test('late successful publish cannot return success or invoke later guards after abort',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred(),controller=new AbortController();let count=0;
 f.issuer.publishVerification=async q=>{count++;entered.resolve();await finish.promise;return {...f.task(),verificationReport:q.report};};const runner=f.runner(),run=runner.run({...f.input,signal:controller.signal});await entered.promise;const guards=f.events.filter(x=>x==='guard').length;controller.abort();await reject(()=>run,'NORMALIZED_RUNNER_UNCERTAIN');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve();await tick();await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');assert.equal(count,1);assert.equal(f.events.filter(x=>x==='guard').length,guards);
});
test('deadline during publication is uncertain, retains admission and never repeats the write',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred();let writes=0;f.config.timeoutMs=100;
 f.issuer.publishVerification=async q=>{writes++;entered.resolve();await finish.promise;return {...f.task(),verificationReport:q.report};};
 const runner=f.runner(),run=runner.run(f.input);await entered.promise;await reject(()=>run,'NORMALIZED_RUNNER_UNCERTAIN');await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve();await tick();await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');assert.equal(writes,1);
});
test('one total deadline spans sequential stages, not a fresh 30-second budget per step',async()=>{
 const f=fixture(),read=f.storage.read;f.config.timeoutMs=90;f.storage.read=async q=>{await delay(55);return read({...q,signal:new AbortController().signal});};
 await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_TIMEOUT');await delay(60);assert(!f.events.includes('inspect'));assert.equal(f.published.length,0);assert(f.events.filter(x=>x==='read').length<=2);
});
test('already aborted request and invalid selectors cannot query task authority',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await reject(()=>f.runner().run({...f.input,signal:controller.signal}),'NORMALIZED_RUNNER_ABORTED');
 for(const patch of [{credential:'has whitespace'},{taskId:'../arbitrary'},{report:{}},{artifact:f.artifact}])await reject(()=>f.runner().run({...f.input,...patch}),'NORMALIZED_RUNNER_INVALID');assert.equal(f.events.length,0);
});
test('parallel run never shares an in-flight verifier slot',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred();f.issuer.readVerificationTask=async()=>{entered.resolve();await finish.promise;return f.task();};const runner=f.runner(),first=runner.run(f.input);await entered.promise;await reject(()=>runner.run(f.input),'NORMALIZED_RUNNER_BUSY');finish.resolve();await first;assert.equal(f.published.length,1);
});
test('dependency/input/task getters and proxies never execute and cannot inject evidence',async()=>{
 let traps=0;const f=fixture(),getter={};Object.defineProperty(getter,'readVerificationTask',{get(){traps++;return ()=>{};}});
 const proxy=new Proxy({}, {get(){traps++;},getOwnPropertyDescriptor(){traps++;},getPrototypeOf(){traps++;}});
 for(const issuer of [getter,proxy])await reject(()=>createManagedNormalizedVerificationRunner({...f.config,issuer}).run(f.input),'NORMALIZED_RUNNER_DISABLED');
 await reject(()=>f.runner().run(proxy),'NORMALIZED_RUNNER_INVALID');const input={...f.input};Object.defineProperty(input,'taskId',{enumerable:true,get(){traps++;return f.taskId;}});await reject(()=>f.runner().run(input),'NORMALIZED_RUNNER_INVALID');
 // A callback's returned Promise is trusted JS machinery; Promise resolution
 // itself reads `then`. Test untrusted JSON nested inside the resolved task,
 // rather than claiming we can prevent native thenable assimilation.
 f.issuer.readVerificationTask=async()=>({...f.task(),artifact:proxy});await reject(()=>f.runner().run(f.input),'NORMALIZED_RUNNER_DENIED');assert.equal(traps,0);
});
test('dependency errors are rebuilt, never expose arbitrary secret message/code/extra',async()=>{
 const f=fixture();f.issuer.readVerificationTask=()=>{const e=new ManagedNormalizedVerificationRunnerError('NORMALIZED_RUNNER_DENIED');e.message='secret';e.extra='secret';throw e;};await assert.rejects(()=>f.runner().run(f.input),e=>e.code==='NORMALIZED_RUNNER_DENIED'&&e.message==='NORMALIZED_RUNNER_DENIED'&&!Object.hasOwn(e,'extra'));
});
test('captured method invocation does not consult a function-owned bind getter',async()=>{
 const f=fixture();let calls=0;Object.defineProperty(f.runtime.verifyBinary,'bind',{get(){calls++;throw Error('forbidden');}});await f.runner().run(f.input);assert.equal(calls,0);
});
