/** Actual restricted PG read broker; all data synthetic, no provider or network. */
import assert from 'node:assert/strict';
import {createDesignIdentityPostgresFixture} from './fixtures/design-identity-postgres-fixture.mjs';
import {createBoundedIdentityReadBroker} from '../packages/design-production-adapter/bounded-identity-read-broker.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const f=await createDesignIdentityPostgresFixture();let passed=0;const pass=s=>console.log(`ok ${++passed} - ${s}`),wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let acquisitions=0;const acquire=async()=>{acquisitions++;return f.acquireRuntimeClient();};
 const request={operation:'read_scope_records',credential:f.credential,scope:f.scopeA};
 const broker=createBoundedIdentityReadBroker({enabled:true,acquireClient:acquire});
 const result=await broker.handle(request);assert.equal(result.authority.subjectId,'synthetic-subject-alice');assert.equal(result.records.length,1);assert.equal(result.records[0].recordId,'synthetic-record-a');assert(Object.isFrozen(result.records[0]));pass('fixed broker reads exact scope using real non-owner LOGIN capability and returns frozen data');
 const before=acquisitions;for(const input of [{...request,sql:'SET CONSTRAINTS ALL IMMEDIATE'},{...request,operation:'commit'},{...request,transaction_timeout:0},{...request,scope:{...f.scopeA,visitId:'booking:101; RESET ROLE'}}])await assert.rejects(broker.handle(input));assert.equal(acquisitions,before);pass('SQL/settings/transaction-operation injection is rejected before DB acquisition');
 await assert.rejects(broker.handle({...request,credential:f.tokens.bob}),e=>e.code==='BROKER_ACCESS_DENIED');pass('different employee cannot use the selected customer scope');
 let killed=0,delayed=false;
 const slow=createBoundedIdentityReadBroker({enabled:true,maxDurationMs:500,acquireClient:async()=>{const c=await f.acquireRuntimeClient();return {...c,destroy:async()=>{killed++;return c.destroy();},query:async(sql,params)=>{if(sql.includes('read_scope_records')){delayed=true;await c.query('SELECT pg_sleep(1.0) AS ignored');}return c.query(sql,params);}};}});
 await assert.rejects(slow.handle(request),e=>e.code==='BROKER_DEADLINE');await wait(300);assert.equal(delayed,true);assert(killed>0);pass('bounded lifetime withholds slow query result and destroys its restricted connection');
 // Deliberately delay before a read after authority has been resolved. The fixed
 // node budget is not raised; actual DB lifecycle expiry remains authoritative.
 f.sqlAdmin("UPDATE design_private.lifecycle_decisions SET expires_at=clock_timestamp()+interval '1 second' WHERE assignment_source='appointment' AND visit_id='booking:101'");
 const expiry=createBoundedIdentityReadBroker({enabled:true,acquireClient:async()=>{const c=await f.acquireRuntimeClient();return {...c,query:async(sql,params)=>{if(sql.includes('read_scope_records'))await c.query('SELECT pg_sleep(1.1) AS ignored');return c.query(sql,params);}};}});
 await assert.rejects(expiry.handle(request),e=>['BROKER_ACCESS_DENIED','BROKER_DEADLINE'].includes(e.code));pass('actual lifecycle expiry still denies a late scoped read; no expiry check is removed');
 assert.equal(f.sqlAdmin('SELECT count(*) FROM design_identity.transaction_contexts'),'0');pass('successful and interrupted broker operations leave no committed authority contexts');
 console.log(`PASS ${passed} bounded non-owner read-broker cases. Not process isolation, arbitrary-SQL protection or an absolute COMMIT-time claim.`);
}finally{await f.cleanup();console.log('Verified exact bounded-broker fixture cleanup.');}
