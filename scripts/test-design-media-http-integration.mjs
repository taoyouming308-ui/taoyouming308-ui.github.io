/** Actual HTTP + private-media modules, synthetic dependencies only; no server/listener/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {createPreparedPrivateMedia,PRIVATE_MEDIA_MAX_BYTES} from '../packages/design-production-adapter/private-media.mjs';
import {createPreparedDesignAccessGate} from '../packages/design-access-gate/index.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden');};
const api='https://synthetic-media.invalid',app='https://synthetic-ui.invalid',credential='synthetic-session-only';
const scope={customerProfileId:'123',visitId:'booking:456',assignmentSource:'appointment'};
const fakeImage=Uint8Array.from([255,216,255,0,83,89,78,84,72,69,84,73,67]);
function fixture(){
 const state={active:true,username:'synthetic-employee',rows:new Map(),bytes:new Map(),inspections:0,onRead:null,onCommit:null,loseReply:false,approvals:[]};
 const authenticate=async token=>{if(token!==credential||!state.active)throw Error('PRIVATE_SECRET denied');return {username:state.username,store:'synthetic-store',active:true,expiresAt:2000};};
 const gate=createPreparedDesignAccessGate({authenticate,now:()=>1000,resolveAssignment:async()=>({source:'appointment',visitId:scope.visitId,customerProfileId:scope.customerProfileId,staffUsername:'synthetic-employee',store:'synthetic-store',active:true}),resolveCustomerVisit:async()=>({...scope,store:'synthetic-store',unambiguous:true})});
 const privateMedia=createPreparedPrivateMedia({enabled:true,privateStorageOrigin:'https://synthetic-private-store.invalid',permissionGate:gate,
  approvalVerifier:{verify:async(receipt,intent)=>{state.approvals.push(intent);return receipt==='synthetic-consent';}},
  imageInspector:async()=>{state.inspections++;return {mime:'image/jpeg',width:2,height:2,frameCount:1,decoded:true};},
  repository:{withScopeLock:async(binding,work)=>{let staged,guard;const result=await work({readRecord:async id=>structuredClone(state.rows.get(id)||null),readBytes:async id=>{if(state.onRead)await state.onRead();return Uint8Array.from(state.bytes.get(id)||[]);},insertImmutable:async value=>{staged=value;return true;},beforeCommit:callback=>{guard=callback;}});if(staged){if(state.onCommit)await state.onCommit();await guard();state.rows.set(staged.record.mediaId,structuredClone(staged.record));state.bytes.set(staged.record.mediaId,Uint8Array.from(staged.bytes));if(state.loseReply)throw Error('PRIVATE_SECRET committed reply lost');}return result;}}
 });
 const handler=createDesignHttpHandler({enabled:true,publicOrigin:api,allowedRequestOrigins:[app],employeeAdapter:{authenticate,gate},privateMedia});
 return {state,handler};
}
function upload({bytes=fakeImage,mime='image/jpeg',approval='synthetic-consent',requestId='synthetic-photo',extra=false}={}){
 const form=new FormData();for(const [k,v] of Object.entries({scope:JSON.stringify(scope),requestId,approval:JSON.stringify(approval),stage:'before',angle:'front'}))form.append(k,v);
 form.append('file',new Blob([bytes],{type:mime}),'PRIVATE_FILENAME_SHOULD_NOT_LEAK.jpg');if(extra)form.append('owner','forged');
 return new Request(api+'/api/design/media/upload',{method:'POST',headers:{origin:app,'x-employee-session':credential},body:form});
}
const json=(route,payload)=>new Request(api+'/api/design/media/'+route,{method:'POST',headers:{origin:app,'x-employee-session':credential,'content-type':'application/json'},body:JSON.stringify(payload)});
const read=()=>json('read',{scope,approval:'synthetic-consent',mediaId:'synthetic-photo'});
async function denied(response){assert.notEqual(response.status,200);const body=await response.json();assert.equal(body.ok,false);assert.equal(body.error.retryable,false);assert(!JSON.stringify(body).includes('PRIVATE_SECRET'));return body;}
test('real composed upload/read/reference flow preserves bytes and strips private metadata',async()=>{
 const {handler,state}=fixture();const saved=await handler(upload());assert.equal(saved.status,200);const body=await saved.json();assert.equal(body.result.reference.mediaId,'synthetic-photo');assert(!/PRIVATE_FILENAME|sha256|storage|credential|owner/.test(JSON.stringify(body)));assert.equal(state.rows.size,1);
 const result=await handler(read());assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/jpeg');assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(result.headers.get('access-control-allow-origin'),app);assert.deepEqual(new Uint8Array(await result.arrayBuffer()),fakeImage);
 const refs=await handler(json('references',{scope,approval:'synthetic-consent',mediaIds:['synthetic-photo']}));assert.equal(refs.status,200);assert.equal((await refs.json()).result.references.length,1);assert.equal(state.approvals.at(-1).operation,'private_photo_archive_reference');
});
test('actual media validator rejects MIME spoof, malformed bytes and unapproved upload through multipart',async()=>{for(const params of [{mime:'image/png'},{bytes:new TextEncoder().encode('<svg>fake</svg>')},{approval:'no-approval'},{extra:true}]){const {handler,state}=fixture();await denied(await handler(upload(params)));assert.equal(state.rows.size,0);}});
test('actual upload bytes over 8 MiB reject, with absent or forged small declared length',async()=>{for(const forge of [false,true]){const {handler,state}=fixture();const oversized=new Uint8Array(PRIVATE_MEDIA_MAX_BYTES+1);oversized.set(fakeImage);const request=upload({bytes:oversized});if(forge)request.headers.set('content-length','1');await denied(await handler(request));assert.equal(state.rows.size,0);assert.equal(state.inspections,0);}});
test('real employee gate rejects foreign visit before media decode/storage',async()=>{const {handler,state}=fixture();const req=upload(),form=await req.formData();form.set('scope',JSON.stringify({...scope,visitId:'booking:999'}));await denied(await handler(new Request(req.url,{method:'POST',headers:{origin:app,'x-employee-session':credential},body:form})));assert.equal(state.inspections,0);assert.equal(state.rows.size,0);});
test('deactivated employee is rejected by HTTP before body reading',async()=>{const {handler,state}=fixture();state.active=false;const req=upload();const rejected=await handler(req);await denied(rejected);assert.equal(req.bodyUsed,false);assert.equal(state.inspections,0);});
test('revocation while reading original never returns image bytes over HTTP',async()=>{const {handler,state}=fixture();assert.equal((await handler(upload())).status,200);state.onRead=()=>{state.active=false;};const result=await handler(read());await denied(result);assert.match(result.headers.get('content-type'),/application\/json/);});
test('revocation during actual transaction prevents staged media publication',async()=>{const {handler,state}=fixture();state.onCommit=()=>{state.active=false;};await denied(await handler(upload()));assert.equal(state.rows.size,0);});
test('lost commit response retains uncertainty and identical retry deduplicates',async()=>{const {handler,state}=fixture();state.loseReply=true;const failure=await denied(await handler(upload()));assert.equal(failure.error.outcome,'uncertain');assert.equal(state.rows.size,1);state.loseReply=false;const replay=await handler(upload());assert.equal(replay.status,200);assert.equal((await replay.json()).result.replayed,true);assert.equal(state.rows.size,1);});
test('corrupted private bytes and cross-customer references are blocked through HTTP',async()=>{const {handler,state}=fixture();assert.equal((await handler(upload())).status,200);state.bytes.get('synthetic-photo')[4]=0;await denied(await handler(read()));await denied(await handler(json('references',{scope:{...scope,customerProfileId:'999'},approval:'synthetic-consent',mediaIds:['synthetic-photo']})));});
