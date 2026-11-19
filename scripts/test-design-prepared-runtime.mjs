import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedDesignRuntime} from '../packages/design-production-adapter/prepared-runtime.mjs';

test('unified runtime defaults closed without acquiring DB, provider or storage dependencies',async()=>{
 let calls=0;const forbidden=()=>{calls++;throw Error('dependency must not be touched');};
 const runtime=createPreparedDesignRuntime({acquireClient:forbidden,diagnostics:forbidden,media:{enabled:true,storageTransport:forbidden},speechAdapter:{transcribe:forbidden}});
 const response=await runtime.handle(new Request('https://synthetic.invalid/api/design/workflow/load',{method:'POST',body:'{}'}));
 assert.equal(response.status,503);assert.equal((await response.json()).error.code,'ENTRY_NOT_CONFIGURED');assert.equal(calls,0);assert.deepEqual(Object.keys(runtime),['handle']);
});
test('unconfigured exact-origin boundary denies before acquiring a connection',async()=>{
 let calls=0;const runtime=createPreparedDesignRuntime({enabled:true,acquireClient:()=>{calls++;throw Error('must not acquire');}});
 const response=await runtime.handle(new Request('https://synthetic.invalid/api/design/workflow/load',{method:'POST',headers:{'content-type':'application/json','x-employee-session':'synthetic-opaque-token'},body:'{}'}));
 assert.equal(response.status,503);assert.equal(calls,0);
});

test('trusted runtime diagnostics receive enum metadata only and are never echoed over HTTP',async()=>{
 const events=[];const runtime=createPreparedDesignRuntime({enabled:true,publicOrigin:'https://synthetic.invalid',allowedRequestOrigins:['https://synthetic.invalid'],diagnostics:e=>events.push(e),acquireClient:()=>{throw Error('secret-driver-message');}});
 const response=await runtime.handle(new Request('https://synthetic.invalid/api/design/workflow/load',{method:'POST',headers:{'content-type':'application/json','x-employee-session':'synthetic-opaque-token'},body:'{}'}));
 assert.notEqual(response.status,200);const body=await response.text();assert(!body.includes('secret-driver-message'));assert(!body.includes('diagnostic'));assert(events.some(e=>e.component==='postgres'&&e.phase==='acquire'&&e.outcome==='failure'));
 for(const e of events)assert.deepEqual(Object.keys(e).sort(),['component','failureKind','outcome','phase']);
});


test('actual HTTP boundary isolates pure validation by request and closes failed requests',async()=>{
 const {createDesignSession}=await import('../packages/analysis-engine/design-pilot.mjs');
 const {createPreparedWorkflowRecord,validatePreparedWorkflowRecord}=await import('../packages/design-production-adapter/prepared-workflow-service.mjs');
 const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
 const record=createPreparedWorkflowRecord({scope,store:'synthetic',session:createDesignSession({customerId:'11',visitId:'booking:101',sessionId:'synthetic-http-memo'})});
 const pairs=[],late=[],pending=[];
 const runtime=createPreparedDesignRuntime({enabled:true,publicOrigin:'https://synthetic.invalid',allowedRequestOrigins:['https://synthetic.invalid'],
  diagnostics:event=>{if(event.component==='postgres'&&event.phase==='acquire'&&event.outcome==='failure'){
   pairs.push([validatePreparedWorkflowRecord(structuredClone(record),scope),validatePreparedWorkflowRecord(structuredClone(record),scope)]);
   pending.push(new Promise(resolve=>setTimeout(()=>{late.push([validatePreparedWorkflowRecord(record,scope),validatePreparedWorkflowRecord(record,scope)]);resolve();},10)));
  }},acquireClient:async()=>{await Promise.resolve();throw Error('synthetic-driver-refusal');}});
 const request=()=>new Request('https://synthetic.invalid/api/design/workflow/load',{method:'POST',headers:{'content-type':'application/json','x-employee-session':'synthetic-opaque-token'},body:'{}'});
 const responses=await Promise.all([runtime.handle(request()),runtime.handle(request())]);
 assert(responses.every(response=>response.status!==200));assert.equal(pairs.length,2);
 for(const pair of pairs)assert.strictEqual(pair[0],pair[1]);assert.notStrictEqual(pairs[0][0],pairs[1][0]);
 assert.notStrictEqual(validatePreparedWorkflowRecord(record,scope),pairs[0][0]);
 await Promise.all(pending);assert.equal(late.length,2);for(const pair of late)assert.notStrictEqual(pair[0],pair[1]);
 for(const response of responses){const body=await response.text();assert(!body.includes('synthetic-driver-refusal'));assert(!body.includes('memo'));}
});
