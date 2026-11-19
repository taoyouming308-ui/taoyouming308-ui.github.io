/** Test-only node-postgres Pool over a network-none Docker byte relay.
 * Only runtime-role connections use this pool. Existing psql helpers remain
 * explicitly installer/issuer/fixture tooling, not the measured runtime driver.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import {createFixturePgWireStream} from './design-pg-wire-stream.mjs';
export function createFixturePgWirePool(fixture,{max=2}={}){
 assert(/^design-workflow-synthetic-[0-9]+-[a-f0-9]{8}$/.test(fixture.container));
 assert.equal(fixture.db,'design_executor_synthetic');assert.equal(fixture.runtimeRole,'design_identity_runtime');
 assert(Number.isInteger(max)&&max>=1&&max<=4);
 const streams=new Set();let created=0,closed=false,closePromise=null;
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'design_identity_runtime',database:'design_executor_synthetic',
  password:'SYNTHETIC_UNUSED_OFFLINE_PLACEHOLDER',ssl:false,client_encoding:'UTF8',application_name:'identity-runtime',
  options:'-c timezone=UTC -c standard_conforming_strings=on -c statement_timeout=15000 -c lock_timeout=10000 -c design_executor.synthetic_fixture=offline-stage6-only -c design_workflow.synthetic_fixture=offline-stage7-only',
  connectionTimeoutMillis:5000,idleTimeoutMillis:10000,max,allowExitOnIdle:false,
  stream(){if(closed)throw Error('SYNTHETIC_PG_WIRE_CLOSED');created++;const stream=createFixturePgWireStream({container:fixture.container});streams.add(stream);stream.fixtureClosed.then(()=>streams.delete(stream),()=>{});return stream;}
 });
 pool.on('error',()=>{}); // Never log a raw driver error or connection object.
 function close(){if(closePromise)return closePromise;closed=true;closePromise=(async()=>{
  // The caller closes its trusted adapter first. If it failed to release a raw
  // client, destroying its transport makes pool shutdown fail closed, not hang.
  let ending;try{ending=Promise.resolve(pool.end());}catch(error){ending=Promise.reject(error);}void ending.catch(()=>{});
  const current=[...streams];for(const stream of current)stream.destroy();
  let timer;try{const results=await Promise.race([Promise.allSettled([ending,...current.map(s=>s.fixtureClosed)]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SYNTHETIC_PG_WIRE_CLEANUP_UNCONFIRMED')),5000);})]);const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;}
  finally{clearTimeout(timer);}assert.equal(streams.size,0,'all exact Docker relay child processes closed');
 })();void closePromise.catch(()=>{});return closePromise;}
 return Object.freeze({pool,close,stats:()=>Object.freeze({created,activeRelayChildren:streams.size,totalCount:pool.totalCount,idleCount:pool.idleCount,waitingCount:pool.waitingCount})});
}
