import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtifactReadRuntime} from '../packages/design-production-adapter/artifact-read-runtime.mjs';
const api='https://synthetic-api.invalid',origin='https://synthetic-app.invalid';
const request=(path,body={},source=origin)=>new Request(api+path,{method:'POST',headers:{origin:source,'content-type':'application/json','x-employee-session':'SYNTHETIC_SESSION_FOR_ARTIFACT_READ_1234'},body:JSON.stringify(body)});
test('artifact runtime disabled causes zero driver/readers I/O',async()=>{let io=0;const runtime=createArtifactReadRuntime({acquireClient:()=>{io++;throw Error();}});assert.equal((await runtime.handle(request('/api/design/archive/full/load'))).status,503);assert.equal(io,0);});
test('explicit read mode never falls back to writes, generation, issuer, keys or old workflow',async()=>{
 let io=0;const runtime=createArtifactReadRuntime({enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],acquireClient:()=>{io++;throw Error();}});
 for(const path of ['/api/design/archive/full','/api/design/media/upload','/api/design/candidate/extract','/api/design/candidate/synthesize','/api/design/workflow/dispatch','/api/design/workflow/load','/api/design/key-settings/read','/api/design/artifact/issue']){const r=await runtime.handle(request(path));assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.equal(io,0);
});
test('read mode rejects wrong origin/extra identity and missing old reader without database access',async()=>{
 let io=0;const runtime=createArtifactReadRuntime({enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],employeeAdapter:{authenticate:async()=>{},gate:{}},acquireClient:()=>{io++;throw Error();}}),scope={assignmentSource:'appointment',visitId:'booking:101',customerProfileId:'11'};
 assert.equal((await runtime.handle(request('/api/design/archive/full/load',{scope},'https://other.invalid'))).status,403);
 assert.equal((await runtime.handle(request('/api/design/archive/full/load',{scope,actor:'forged'}))).status,400);
 assert.notEqual((await runtime.handle(request('/api/design/archive/full/load',{scope}))).status,200);assert.equal(io,0);
});

test('unknown proof mode cannot silently fall back to base access',async()=>{let io=0;const runtime=createArtifactReadRuntime({enabled:true,proofMode:'unknown',publicOrigin:api,allowedRequestOrigins:[origin],acquireClient:()=>io++});assert.equal((await runtime.handle(request('/api/design/archive/full/load'))).status,503);assert.equal(io,0);});
