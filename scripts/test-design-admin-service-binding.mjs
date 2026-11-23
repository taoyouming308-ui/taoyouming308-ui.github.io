import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServiceBindingHandler,SERVICE_BINDING_URL as url,SERVICE_BINDING_APP as app,validateServiceBindingInput} from '../supabase/functions/design-service-bindings/handler.mjs';
import {createAdminServiceBindingClient} from '../packages/design-prepared-ui/admin-service-binding-client.mjs';
import {createLiveServiceBindingVerifier} from '../packages/design-production-adapter/live-service-binding.mjs';
const token='a'.repeat(72),employee='synthetic-employee-'+randomUUID(),hash=v=>createHash('sha256').update(v).digest('hex');
const inspect={action:'inspect',visitKey:'booking:101',profileId:'11',staffId:'2'};
const confirm={...inspect,action:'confirm',expectedRevision:0,sourceSha:'a'.repeat(64),profileSha:'b'.repeat(64),staffSha:'c'.repeat(64),requestId:randomUUID(),reason:'Explicit synthetic review'};
const req=(input=inspect,over={})=>new Request(url,{method:'POST',headers:{origin:app,'content-type':'application/json','x-design-admin-session':token,...over.headers},body:JSON.stringify(input),...Object.fromEntries(Object.entries(over).filter(([k])=>k!=='headers'))});
const pinned=async response=>{Object.defineProperty(response,'url',{value:url});return response;};
test('default closure, exact public/internal URL, Origin, method and preflight precede RPC',async()=>{
 let calls=0;const handle=createServiceBindingHandler({enabled:true,rpc:async()=>{calls++;return {};}});
 assert.equal((await createServiceBindingHandler()(req())).status,503);
 for(const u of [url+'?x',url+'/extra',url.replace('pdssrmpeiuwvxzsgschm','other')])assert.equal((await handle(new Request(u,req()))).status,404);
 assert.equal((await handle(req(inspect,{headers:{origin:'https://foreign.invalid'}}))).status,403);
 assert.equal((await handle(new Request(url,{method:'GET',headers:{origin:app}}))).status,405);
 const pre=await handle(new Request(url,{method:'OPTIONS',headers:{origin:app,'access-control-request-method':'POST','access-control-request-headers':'content-type, x-design-admin-session'}}));assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),app);assert.equal(pre.headers.get('access-control-allow-credentials'),null);
 assert.equal(calls,0);
 const internal=url.replace('https:','http:').replace('/functions/v1','');assert.equal((await handle(new Request(internal,req(inspect,{headers:{host:'edge-runtime.supabase.com'}})))).status,200);assert.equal(calls,1);
});
test('request contract refuses unknown authority, mixed credential domains and invalid bounds',async()=>{
 let calls=0;const handle=createServiceBindingHandler({enabled:true,rpc:async()=>{calls++;return {};}});
 for(const input of [{...inspect,role:'admin'},{...inspect,staffId:'0'},{...inspect,profileId:11},{...confirm,expectedRevision:1.5},{...confirm,reason:''},{...confirm,requestId:'invalid'}])assert.throws(()=>validateServiceBindingInput(input));
 for(const headers of [{'x-employee-session':employee},{authorization:'Bearer fake'},{'x-design-admin-session':'invalid'}])assert([400,403].includes((await handle(req(inspect,{headers}))).status));
 assert.equal(calls,0);
});
test('bounded body rejects oversized and stalled reads without dispatch',async()=>{
 let calls=0;const handle=createServiceBindingHandler({enabled:true,rpc:async()=>{calls++;return {};}});
 assert.equal((await handle(req({...inspect,unknown:'x'.repeat(13000)}))).status,400);
 const stream=new ReadableStream({start(){}}),start=Date.now();
 const r=await handle(new Request(url,{method:'POST',headers:{origin:app,'content-type':'application/json','x-design-admin-session':token},body:stream,duplex:'half'}));
 assert.equal(r.status,400);assert(Date.now()-start<2500);assert.equal(calls,0);
});
test('server failure after a mutation is uncertain; status query and known denials never auto-repeat',async()=>{
 const seen=[];const handle=createServiceBindingHandler({enabled:true,rpc:async({input})=>{seen.push(input.action);throw Error('transport');}});
 assert.equal((await (await handle(req(confirm))).json()).error.outcome,'uncertain');
 assert.equal((await (await handle(req({action:'status',visitKey:'booking:101',profileId:'11',requestId:confirm.requestId}))).json()).error.outcome,'not_sent');
 assert.deepEqual(seen,['confirm','status']);
 const denied=createServiceBindingHandler({enabled:true,rpc:async()=>{throw {code:'DESIGN_SERVICE_DENIED'};}});assert.equal((await denied(req(confirm))).status,403);
});
test('server refuses responses containing its opaque credential',async()=>{
 const h=createServiceBindingHandler({enabled:true,rpc:async()=>({accidental:token})});const r=await h(req());assert.equal(r.status,503);assert(!(await r.text()).includes(token));
});
test('admin client pins HTTPS, uses only existing custom session and performs exactly one mutation attempt',async()=>{
 let calls=0;const client=createAdminServiceBindingClient({getCredential:()=>token,fetchImplementation:async(u,o)=>{calls++;assert.equal(u,url);assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.equal(o.headers.authorization,undefined);assert.equal(o.headers['x-design-admin-session'],token);throw Error('lost');}});
 await assert.rejects(()=>client.request(confirm),e=>e.outcome==='uncertain'&&!e.retryable);assert.equal(calls,1);
 const redirect=createAdminServiceBindingClient({getCredential:()=>token,fetchImplementation:async()=>Response.json({ok:true,result:{}},{headers:{'cache-control':'private, no-store'}})});await assert.rejects(()=>redirect.request(inspect));
});
test('admin response arriving after an account switch is discarded',async()=>{
 let current=token;const client=createAdminServiceBindingClient({getCredential:()=>current,fetchImplementation:async()=>{current='b'.repeat(72);return pinned(Response.json({ok:true,result:{label:'old actor'}},{headers:{'cache-control':'private, no-store'}}));}});await assert.rejects(()=>client.request(inspect));
});
const scope={assignmentSource:'appointment',visitId:'booking:101',customerProfileId:'11'};
function bindingFixture(){const now=Date.now(),state={revision:1,wrongNonce:false,extra:false,expired:false};return {state,clock:()=>now,fetch:async(u,o)=>{
 assert.equal(u,url);const body=JSON.parse(o.body);assert.equal(body.action,'resolve');assert.equal(o.headers['x-design-admin-session'],undefined);assert.equal(o.headers['x-employee-session'],employee);
 const result={schemaVersion:'design-live-service-binding-v1',nonce:state.wrongNonce?randomUUID():body.nonce,visitKey:'booking:101',profileId:'11',staffId:'2',staffCreatedAt:'2026-01-01T00:00:00.000000Z',actor:{username:'synthetic A',store:'自由手艺人'},store:'自由手艺人',date:'2026-11-23',revision:state.revision,sourceSha:'a'.repeat(64),profileSha:'b'.repeat(64),staffSha:'c'.repeat(64),sessionBinding:hash('design-live-employee-v1:'+employee),checkedAt:now,validUntil:state.expired?now:now+5000,...(state.extra?{uploadAllowed:true}:{})};
 return pinned(Response.json({ok:true,result},{headers:{'cache-control':'private, no-store'}}));
 }};}
test('live verifier is default closed and returns only fresh exact binding evidence',async()=>{
 await assert.rejects(()=>createLiveServiceBindingVerifier().verify(employee,scope));
 const f=bindingFixture(),v=createLiveServiceBindingVerifier({enabled:true,fetchImplementation:f.fetch,clock:f.clock});const proof=await v.verify(employee,scope);assert(Object.isFrozen(proof)&&Object.isFrozen(proof.actor));assert.equal(proof.profileId,'11');assert.equal(proof.uploadAllowed,undefined);
 await v.recheck(employee,scope,proof);f.state.revision=2;await assert.rejects(()=>v.recheck(employee,scope,proof));
});
test('live evidence denies forged nonce, expiry, extra photo authority and redirected response',async()=>{
 for(const key of ['wrongNonce','expired','extra']){const f=bindingFixture();f.state[key]=true;await assert.rejects(()=>createLiveServiceBindingVerifier({enabled:true,fetchImplementation:f.fetch,clock:f.clock}).verify(employee,scope));}
 const f=bindingFixture();await assert.rejects(()=>createLiveServiceBindingVerifier({enabled:true,clock:f.clock,fetchImplementation:async()=>Response.json({ok:true,result:{}})}).verify(employee,scope));
});
