/** One true node-postgres wire probe. Isolated synthetic PG17 only. */
import assert from 'node:assert/strict';
import {createDesignIdentityPostgresFixture} from './fixtures/design-identity-postgres-fixture.mjs';
import {createFixturePgWirePool} from './fixtures/design-pg-wire-pool.mjs';
import {createIdentityCapabilityOperations} from '../packages/design-production-adapter/identity-capability-postgres.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const f=await createDesignIdentityPostgresFixture();let wire,n=0;
const test=async(name,work)=>{const t=performance.now();await work();console.log(`ok ${++n} - ${name} (${(performance.now()-t).toFixed(1)}ms)`);};
try{
 wire=createFixturePgWirePool(f,{max:2});
 await test('actual wire runtime is nonowner LOGIN with binary value binding',async()=>{const c=await wire.pool.connect();try{const r=await c.query('SELECT current_user::text AS role,session_user::text AS login,$1::jsonb AS record,$2::text AS nothing,$3::bytea AS binary,$4::bigint AS large',[{source:"合成'\\$1",n:1.5},null,Buffer.from([0,255,128]),'9007199254740993']);assert.equal(r.command,'SELECT');assert.equal(r.rowCount,1);assert.equal(r.rows[0].role,f.runtimeRole);assert.equal(r.rows[0].login,f.runtimeRole);assert.deepEqual(r.rows[0].record,{source:"合成'\\$1",n:1.5});assert.equal(r.rows[0].nothing,null);assert.deepEqual(r.rows[0].binary,Buffer.from([0,255,128]));assert.equal(r.rows[0].large,'9007199254740993');}finally{c.release();}});
 await test('wire preserves per-query SQLSTATE and aborted COMMIT tag',async()=>{const c=await wire.pool.connect();try{await c.query('BEGIN');await assert.rejects(c.query('SELECT 1/0 AS value'),e=>e.code==='22012'&&e.message==='division by zero');assert.equal((await c.query('COMMIT')).command,'ROLLBACK');}finally{c.release(true);}});
 await test('wire authorizes immutable identity then exact context denial on reused backend',async()=>{const c=await wire.pool.connect(),ops=createIdentityCapabilityOperations(c);let pid;try{await c.query('BEGIN');pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const a=await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});assert.equal(a.subjectId,'synthetic-subject-alice');await ops.clear();assert.equal((await c.query('COMMIT')).command,'COMMIT');}finally{c.release();}const d=await wire.pool.connect();try{assert.equal((await d.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,pid);await d.query('BEGIN');await assert.rejects(d.query('SELECT design_identity.recheck_authority() AS authority'),e=>e.code==='42501'&&e.message==='IDENTITY_CONTEXT_REQUIRED');await d.query('ROLLBACK');}finally{d.release(true);}});
 console.log(`PASS ${n} true node-postgres wire probe checks (Docker pipe transport, not production TCP/TLS).`);
}finally{try{await wire?.close();if(wire)console.log('WIRE_CLEANUP '+JSON.stringify(wire.stats()));}finally{await f.cleanup();console.log('Verified exact wire fixture container cleanup.');}}
