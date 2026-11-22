import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createScopedPrivateMediaTransport} from '../packages/design-production-adapter/scoped-private-media-transport.mjs';
import {createConfiguredDesignServerRuntime} from '../packages/design-production-adapter/configured-server-runtime.mjs';
const origin='https://synthetic-storage.supabase.co',url=origin+'/storage/v1/object/customer-design-photos/11/prepared/'+'a'.repeat(64)+'/synthetic-photo.jpg';
test('non-model runtime starts without model configuration, master file, API transport or cloud credential provider',async()=>{
 let calls=0;const denied=async()=>{calls++;throw Error('MUST_NOT_TOUCH_DEPENDENCY');};
 const runtime=await createConfiguredDesignServerRuntime({enabled:true,publicOrigin:'https://configured.synthetic.invalid',storageOrigin:origin,acquireClient:denied,worker:{inspect:denied,derive:denied,normalize:denied},mediaApprovalVerifier:{verifyImmutable:denied},privateMediaTransport:denied});
 for(const path of ['/api/design/key-settings/read','/api/design/key-settings/save','/api/design/key-settings/revoke','/api/design/speech']){const r=await runtime.handle(new Request('https://configured.synthetic.invalid'+path,{method:'POST',headers:{origin:'https://configured.synthetic.invalid','content-type':'application/json'},body:'{}'}));assert.equal(r.status,404);const body=await r.json();assert.equal(body.error.retryable,false);assert.equal(body.error.outcome,'not_sent');}
 assert.equal(calls,0);
});
const exp=Math.floor(Date.now()/1000)+300,token=role=>'e30.'+Buffer.from(JSON.stringify({role,exp})).toString('base64url')+'.c3ludGhldGlj';
const credentials=async()=>({apiKey:'sb_publishable_SYNTHETIC_ONLY',accessToken:token('authenticated'),expiresAt:exp*1000});
const input=(write=false)=>({url,method:write?'POST':'GET',redirect:'error',credentials:'omit',timeoutMs:10000,maxResponseBytes:write?4096:3,headers:write?{'Content-Type':'image/jpeg','x-upsert':'false'}:{},...(write?{body:Uint8Array.from([1,2,3])}:{})});
function response(request,body=Uint8Array.from([1,2,3]),status=200){const r=new Response(body,{status});Object.defineProperty(r,'url',{value:request.url});return r;}
function transport(extra={}){return createScopedPrivateMediaTransport({enabled:true,origin,credentialProvider:credentials,authorize:async()=>true,fetchImplementation:async r=>response(r),...extra});}
test('storage default disabled and fixed private route authenticated wire mapping; no cookies/redirects/upserts',async()=>{
 await assert.rejects(createScopedPrivateMediaTransport()(input()));let seen=[];
 const t=transport({authorize:async q=>{seen.push(q.phase);return true;},fetchImplementation:async r=>{assert.equal(r.url,url.replace('/object/','/object/authenticated/'));assert.equal(r.redirect,'error');assert.equal(r.credentials,'omit');assert.equal(r.headers.get('cookie'),null);assert.equal(r.headers.get('authorization'),'Bearer '+token('authenticated'));return response(r);}});
 const r=await t(input());assert.equal(r.url,url);assert.deepEqual([...r.body],[1,2,3]);assert.deepEqual(seen,['before_credentials','before_io','after_io']);
 let posts=0;await transport({fetchImplementation:async r=>{posts++;assert.equal(r.url,url);assert.equal(r.headers.get('x-upsert'),'false');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);return response(r,new Uint8Array(),201);}})(input(true));assert.equal(posts,1);
});
test('privileged credentials, alternate/public URL, upsert, oversized responses and redirects are rejected',async()=>{
 let sends=0;const fetchImplementation=async r=>{sends++;return response(r);};
 await assert.rejects(transport({credentialProvider:async()=>({...await credentials(),accessToken:token('service_role')}),fetchImplementation})(input()));assert.equal(sends,0);
 for(const q of [{...input(),url:url.replace('/object/','/object/public/')},{...input(),url:url+'?x=1'},{...input(),url:url.replace('11/prepared','../prepared')},{...input(true),headers:{'Content-Type':'image/jpeg','x-upsert':'true'}}])await assert.rejects(transport({fetchImplementation})(q));assert.equal(sends,0);
 await assert.rejects(transport({fetchImplementation:async r=>response(r,new Uint8Array(4))})(input()));await assert.rejects(transport({fetchImplementation:async r=>response(r,null,302)})(input()));
});
test('fresh revocation after I/O and lost POST reject without retries or secret-bearing errors',async()=>{
 let sends=0,checks=0;await assert.rejects(transport({authorize:async()=>++checks<3,fetchImplementation:async r=>{sends++;return response(r);}})(input()));assert.equal(sends,1);
 sends=0;await assert.rejects(transport({fetchImplementation:async()=>{sends++;throw Error('SYNTHETIC-PRIVATE-TOKEN');}})(input(true)),e=>e.message==='DESIGN_PRIVATE_TRANSPORT_FAILED');assert.equal(sends,1);
});
test('configured runtime default off, missing dependency/secret denied; synthetic application and speech never enabled',async()=>{
 let io=0;const request=path=>new Request('https://configured.synthetic.invalid'+path,{method:'POST',headers:{origin:'https://configured.synthetic.invalid','content-type':'application/json'},body:'{}'});
 const off=await createConfiguredDesignServerRuntime();assert.equal((await off.handle(request('/api/design/workflow-view/load'))).status,503);
 await assert.rejects(createConfiguredDesignServerRuntime({enabled:true}),/NOT_CONFIGURED/);
 const directory=await realpath(await mkdtemp(join(tmpdir(),'design-configured-')));try{
  await chmod(directory,0o700);await writeFile(join(directory,'master-key.bin'),Buffer.alloc(32,7),{mode:0o600});
  const runtime=await createConfiguredDesignServerRuntime({enabled:true,modelsEnabled:true,publicOrigin:'https://configured.synthetic.invalid',secretDirectory:directory,modelConfig:{approved:true,model:'synthetic-model',maxTokens:256},approvedVisionModels:['synthetic-model'],approvedTextModels:['synthetic-model'],acquireClient:async()=>{io++;throw Error('NO_DATABASE');},worker:{inspect:async()=>{io++;throw Error('NO_WORKER');},derive:async()=>{io++;throw Error('NO_WORKER');}},mediaApprovalVerifier:{verifyImmutable:async()=>false},storageOrigin:origin,storageAuthorize:async()=>false,storageCredentialProvider:credentials,fetchImplementation:async()=>{io++;throw Error('NO_NETWORK');}});
  for(const path of ['/api/design/application-views/compare','/api/design/application-images/upload','/api/design/speech'])assert.equal((await runtime.handle(request(path))).status,404);
  assert.equal((await runtime.handle(request('/api/design/key-settings/read'))).status,401);assert.equal(io,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
