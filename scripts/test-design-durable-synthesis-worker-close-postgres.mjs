/** Targeted final-close PG regression. No real provider, only explicit deferred mock work. */
import assert from 'node:assert/strict';
import {policyDigest} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {createDurableSynthesisWorkerPostgresFixture} from './fixtures/design-durable-synthesis-worker-fixture.mjs';
import {createDurableSynthesisWorkerRuntime} from '../packages/design-production-adapter/durable-synthesis-worker-runtime.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const bounded=async p=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>reject(Error('STAGE24_CLOSE_CHECKPOINT_TIMEOUT')),15000))]);}finally{clearTimeout(t);}};
const f=await createDurableSynthesisWorkerPostgresFixture(),runtimes=[];let checks=0,calls=0;
const q=v=>`'${String(v).replaceAll("'","''")}'`,state=id=>f.sqlAdmin(`SELECT record->>'state' FROM design_policy_private.attempts WHERE owner_key=${q(id)}`);
const runtime=extra=>{const r=createDurableSynthesisWorkerRuntime({enabled:true,pool:f.wire.pool,sealer:f.sealer,modelConfig:f.modelConfig,approvedTextModels:[f.modelConfig.model],timeoutMs:30000,transport:async()=>{calls++;throw Error('UNEXPECTED_TRANSPORT');},...extra});runtimes.push(r);return r;};
try{
 await f.seedLocal();await f.comparison('back');
 const p=await f.enqueue('close-during-key-open'),openEntered=deferred(),openResult=deferred();
 const a=runtime({sealer:{...f.sealer,async open(...args){const value=await f.sealer.open(...args);f.noOpenWorkerTransaction();openEntered.resolve();await openResult.promise;return value;}}});
 const active=a.runOnce();await bounded(openEntered.promise);const closing=a.close();assert.equal(a.close(),closing);await bounded(closing);assert.equal((await active).state,'stopped');assert.equal(state(p.ownerKey),'not_sent');assert.equal(calls,0);openResult.resolve();await new Promise(r=>setImmediate(r));await assert.rejects(a.runOnce(),e=>e.code==='DURABLE_DISABLED');assert.equal(calls,0);console.log(`ok ${++checks} - close during real job key opening stops before dispatch; late open cannot send`);
 const p2=await f.enqueue('close-during-transport'),entered=deferred(),response=deferred();let signal;
 const b=runtime({transport:async req=>{calls++;signal=req.signal;f.noOpenWorkerTransaction();entered.resolve();return response.promise;}});
 const sending=b.runOnce();await bounded(entered.promise);assert.equal(state(p2.ownerKey),'dispatch_claimed');await bounded(b.close());assert.equal(signal.aborted,true);assert.equal((await sending).state,'uncertain');assert.equal(state(p2.ownerKey),'uncertain');assert.equal(calls,1);console.log(`ok ${++checks} - close aborts active mock transport and settles real claimed ledger uncertain`);
 response.resolve(f.response({reviewFocus:p2.intent.evidenceBinding.synthesis.reviewFocus}));await new Promise(r=>setImmediate(r));assert.equal(state(p2.ownerKey),'uncertain');assert.equal(f.sqlAdmin(`SELECT count(*) FROM design_private.model_candidates WHERE candidate_id=${q(policyDigest([p2.context.authority.actor,'close-during-transport','completion_synthesis']))}`),'0');await assert.rejects(b.runOnce(),e=>e.code==='DURABLE_DISABLED');await assert.rejects(b.runBatch({maxJobs:1}),e=>e.code==='DURABLE_DISABLED');const next=runtime({});assert.equal((await next.runOnce()).state,'idle');assert.equal(calls,1);const op=(await f.queue.lookup({credential:f.credential,scope:f.scope,requestId:'close-during-transport'})).operation;assert.equal(op.resultAvailable,false);console.log(`ok ${++checks} - late response cannot finish, closed runtime cannot reenter, new runtime cannot resend`);
 console.log(`PASS ${checks} targeted Stage24 actual worker close checks`);
}finally{const errors=[];for(const r of runtimes)try{await r.close();}catch(e){errors.push(e);}try{await f.cleanup();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'STAGE24_CLOSE_CLEANUP_UNCONFIRMED');}
