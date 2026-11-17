/** Bounded true-wire Pool(2) actor isolation. No model or media operations. */
import assert from 'node:assert/strict';
import {createImmutableCandidateWireFixture} from './fixtures/design-immutable-candidate-wire-fixture.mjs';
import {createImmutableGenerationRuntime} from '../packages/design-production-adapter/immutable-generation-runtime.mjs';
import {createIdentityCapabilityOperations} from '../packages/design-production-adapter/identity-capability-postgres.mjs';
import {policyDigest} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const f=await createImmutableCandidateWireFixture({canonicalLeaves:true}),origin='https://wire-actors.synthetic.invalid';
const app=createImmutableGenerationRuntime({enabled:true,acquireClient:f.acquire,publicOrigin:origin,allowedRequestOrigins:[origin]});
const actors=[{credential:f.credential,scope:f.scopeA,subjectId:'synthetic-subject-alice'},{credential:f.tokens.bob,scope:f.scopeC,subjectId:'synthetic-subject-bob'}];
let n=0;const test=async(name,work)=>{await work();console.log(`ok ${++n} - ${name}`);};
async function http(actor,path,extra={}){const r=await app.handle(new Request(origin+'/api/design/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-employee-session':actor.credential},body:JSON.stringify({scope:actor.scope,...extra})}));return {status:r.status,body:await r.json()};}
const originalCount=()=>f.sqlAdmin('SELECT count(*) FROM design_private.workflow_versions;');
try{
 await test('two concurrent actual physical leases carry separate immutable authority',async()=>{
  const leases=await Promise.all([f.acquire(),f.acquire()]);let ok=false;
  try{await Promise.all(leases.map(c=>c.query('BEGIN')));const pids=await Promise.all(leases.map(async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));assert.notEqual(...pids);
   await Promise.all(leases.map(async(c,i)=>{const ops=createIdentityCapabilityOperations(c),a=actors[i],authority=await ops.resolveAuthority({credential:a.credential,scope:a.scope});assert.equal(authority.subjectId,a.subjectId);assert.deepEqual(authority.scope,a.scope);await ops.recheck(authority);await ops.clear();assert.equal((await c.query('COMMIT')).command,'COMMIT');}));ok=true;
  }finally{await Promise.all(leases.map(c=>c.release(ok?undefined:Error('synthetic actor test failed'))));}
 });
 let heads;
 await test('same shared pool loads both authorized scopes without mixing data',async()=>{heads=await Promise.all(actors.map(a=>http(a,'workflow/load')));for(let i=0;i<2;i++){assert.equal(heads[i].status,200,JSON.stringify(heads[i].body));assert.deepEqual(heads[i].body.result.record.scope,actors[i].scope);}});
 const requests=actors.map((a,i)=>({requestId:'same-request-two-actors',expectedRevision:heads?.[i]?.body.result.record.revision,intent:{type:'record_source',kind:'text',text:'【合成】独立员工原话 '+(i+1)}}));let saved;
 await test('same request ID writes independently for both current immutable employees',async()=>{saved=await Promise.all(actors.map((a,i)=>http(a,'workflow/dispatch',requests[i])));for(let i=0;i<2;i++){const r=saved[i];assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.replayed,false);assert.deepEqual(r.body.result.record.scope,actors[i].scope);assert.equal(r.body.result.record.session.sources.at(-1).text,requests[i].intent.text);
   const rows=JSON.parse(f.sqlAdmin(`SELECT json_agg(authority) FROM design_dependency_authority.operation_authors WHERE scope_key='${policyDigest(actors[i].scope)}' AND revision=${r.body.result.record.revision}`));assert.equal(rows.length,1);assert.equal(rows[0].subjectId,actors[i].subjectId);assert.deepEqual(rows[0].scope,actors[i].scope);
  }});
 await test('both exact replays preserve row count and do not share receipts',async()=>{const count=originalCount(),rs=await Promise.all(actors.map((a,i)=>http(a,'workflow/dispatch',requests[i])));for(let i=0;i<2;i++){assert.equal(rs[i].status,200,JSON.stringify(rs[i].body));assert.equal(rs[i].body.result.replayed,true);assert.deepEqual(rs[i].body.result.record,saved[i].body.result.record);}assert.equal(originalCount(),count);});
 await test('other employee cannot use same ID to read or write the first scope',async()=>{const count=originalCount(),wrong={...actors[1],scope:actors[0].scope};for(const [path,body]of [['workflow/load',{}],['workflow/dispatch',requests[0]]]){const r=await http(wrong,path,body);assert.notEqual(r.status,200);assert.equal(Object.hasOwn(r.body,'result'),false);}assert.equal(originalCount(),count);});
 console.log(`PASS ${n} actual-wire shared-pool actor isolation checks; no provider calls.`);
}finally{await f.cleanup();console.log('Verified exact Stage21 shared-pool actor fixture cleanup.');}
