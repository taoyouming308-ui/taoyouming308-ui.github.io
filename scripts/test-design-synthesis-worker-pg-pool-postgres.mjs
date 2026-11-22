/** Isolated PG17 exact worker LOGIN, real node-postgres protocol; no provider. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImmutableCandidateProviderPostgresFixture} from './fixtures/design-immutable-candidate-provider-fixture.mjs';
import {createFixtureSynthesisWorkerPgWirePool} from './fixtures/design-synthesis-worker-pg-wire-pool.mjs';
import {createFixturePgWirePool} from './fixtures/design-pg-wire-pool.mjs';
import {createTrustedSynthesisWorkerPgPoolAdapter as worker} from '../packages/design-production-adapter/trusted-synthesis-worker-pg-pool-adapter.mjs';
import {createTrustedPgPoolAdapter as runtime} from '../packages/design-production-adapter/trusted-pg-pool-adapter.mjs';
import {createPostgresDurableSynthesisWorkerRepository} from '../packages/design-production-adapter/postgres-durable-synthesis-repository.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const f=await createImmutableCandidateProviderPostgresFixture({canonicalLeaves:true});let wire,runtimeWire;const adapters=[];let count=0;
const config=pool=>({enabled:true,pool,maxLeases:1,maxWaiting:2,acquireTimeoutMs:10000,queryTimeoutMs:20000});
const check=async(name,fn)=>{await fn();console.log(`ok ${++count} - ${name}`);};
try{
 f.sqlAdmin(readFileSync(new URL('../packages/design-production-adapter/drafts/stage23-durable-synthesis-fixture.sql',import.meta.url),'utf8'));
 wire=createFixtureSynthesisWorkerPgWirePool(f,{max:1});runtimeWire=createFixturePgWirePool(f,{max:1});
 const a=worker(config(wire.pool));adapters.push(a);
 await check('real worker has exact independent identity; legal commit destroys physical socket',async()=>{const pids=[];for(let i=0;i<2;i++){const c=await a.acquireClient();await c.query('BEGIN');const r=await c.query('SELECT pg_backend_pid() AS pid,session_user::text AS login,current_user::text AS role');assert.equal(r.rows[0].login,'design_synthesis_worker');assert.equal(r.rows[0].role,'design_synthesis_worker');pids.push(r.rows[0].pid);await c.query('COMMIT');await c.release();assert.equal(wire.pool.totalCount,0);}assert.notEqual(pids[0],pids[1]);});
 await check('runtime adapter rejects worker, worker adapter rejects runtime',async()=>{for(const [factory,pool] of [[runtime,wire.pool],[worker,runtimeWire.pool]]){const b=factory(config(pool));adapters.push(b);await assert.rejects(b.acquireClient(),e=>e.code==='PG_ADAPTER_ROLE_DENIED');await b.close();}});
 await check('fixed worker claim repository uses native pg rows and legal empty queue',async()=>{const repo=createPostgresDurableSynthesisWorkerRepository({enabled:true,acquireWorkerClient:a.acquireClient});assert.equal(await repo.claim(),null);assert.equal(wire.pool.totalCount,0);});
 await check('direct private table and role switching denied and poisoned connection discarded',async()=>{for(const sql of ['SELECT * FROM design_durable_synthesis.jobs','SET ROLE design_identity_runtime','SELECT * FROM design_key_private.key_versions']){const c=await a.acquireClient();await c.query('BEGIN');await assert.rejects(c.query(sql),e=>e.code==='42501'&&e.message==='PG_ADAPTER_DATABASE_ERROR');await c.query('ROLLBACK');await c.release();assert.equal(wire.pool.totalCount,0);}});
 console.log(`PASS ${count} Stage24 real worker pool checks`);
}finally{
 const errors=[];for(const fn of [...adapters.map(a=>()=>a.close()),()=>wire?.close(),()=>runtimeWire?.close(),()=>f.cleanup()])try{await fn();}catch(e){errors.push(e);}
 if(errors.length)throw new AggregateError(errors,'STAGE24_WORKER_POOL_CLEANUP_UNCONFIRMED');
 console.log('STAGE24_WORKER_POOL_CLEANUP '+JSON.stringify({worker:wire?.stats(),runtime:runtimeWire?.stats()}));
}
