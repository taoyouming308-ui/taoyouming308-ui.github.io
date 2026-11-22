import test from 'node:test';import assert from 'node:assert/strict';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {ManagedImageServiceError} from '../packages/design-production-adapter/managed-image-service.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const api='https://synthetic-api.invalid',app='https://synthetic-app.invalid',scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const dto=()=>({schemaVersion:'design-managed-image-status-v1',mediaId:'photo-1',sourceVersion:'v1',requestId:'upload-1',state:'quarantined',candidateEligible:false,publicEligible:false});
const request=(name,body)=>new Request(api+'/api/design/managed-images/'+name,{method:'POST',headers:{origin:app,'x-employee-session':'synthetic-bearer',...(!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:JSON.stringify(body)});
const form=()=>{const f=new FormData();for(const [k,v]of Object.entries({scope:JSON.stringify(scope),mediaId:'photo-1',requestId:'upload-1',stage:'before',angle:'front'}))f.set(k,v);f.set('file',new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'}),'synthetic.jpg');return f;};
const config=service=>({enabled:true,publicOrigin:api,allowedRequestOrigins:[app],employeeAdapter:{authenticate:async()=>({active:true}),gate:{}},managedImages:service});
test('managed routes default closed and never accept client evidence/owner/model fields',async()=>{
 const h=createDesignHttpHandler(config());assert.equal((await h(request('status',{scope,mediaId:'photo-1'}))).status,503);
 for(const field of ['evidence','owner','model','url']){let called=false;const handler=createDesignHttpHandler(config({status:async()=>{called=true;return dto();}}));assert.equal((await handler(request('status',{scope,mediaId:'photo-1',[field]:'forged'}))).status,400);assert.equal(called,false);}
});
test('upload and current status use same scoped service and only private minimal DTO',async()=>{
 let bytes;const handler=createDesignHttpHandler(config({upload:async r=>{assert.deepEqual(r.scope,scope);assert.equal(r.credential,'synthetic-bearer');assert.equal(r.mediaId,'photo-1');assert.equal(r.signal.aborted,false);bytes=r.bytes;return dto();},status:async r=>{assert.deepEqual(r.scope,scope);return dto();}}));
 const r=await handler(request('upload',form()));assert.equal(r.status,200);assert.deepEqual((await r.json()).result,dto());assert.ok(bytes.every(v=>v===0));assert.equal((await handler(request('status',{scope,mediaId:'photo-1'}))).status,200);
});
test('authenticate before consuming upload and duplicate or approval fields reject',async()=>{
 let called=false;const c=config({upload:async()=>{called=true;return dto();}});c.employeeAdapter.authenticate=async()=>{throw Error('PRIVATE SECRET');};const r=await createDesignHttpHandler(c)(request('upload',form()));assert.equal(r.status,400);assert.equal(called,false);assert.ok(!(await r.text()).includes('PRIVATE SECRET'));
 for(const key of ['approval','owner','file']){const f=form();f.append(key,'forged');assert.equal((await createDesignHttpHandler(config({upload:async()=>dto()}))(request('upload',f))).status,400);}
});
test('provider-like forged flags and unexpected fields never leave managed endpoint',async()=>{
 for(const extra of [{candidateEligible:true},{publicEligible:true},{url:'https://secret.invalid'},{state:'verified'}]){const r=await createDesignHttpHandler(config({status:async()=>({...dto(),...extra})}))(request('status',{scope,mediaId:'photo-1'}));assert.equal(r.status,500);assert.ok(!(await r.text()).includes('secret.invalid'));}
});
test('uncertain managed write is safe nonretryable and does not call legacy paths',async()=>{
 const e=new ManagedImageServiceError('MANAGED_IMAGE_SERVICE_UNAVAILABLE','uncertain');e.message='PRIVATE SECRET';const r=await createDesignHttpHandler(config({upload:async()=>{throw e;}}))(request('upload',form()));assert.equal(r.status,409);const b=await r.json();assert.equal(b.error.outcome,'uncertain');assert.equal(b.error.retryable,false);assert.ok(!JSON.stringify(b).includes('PRIVATE SECRET'));
});
