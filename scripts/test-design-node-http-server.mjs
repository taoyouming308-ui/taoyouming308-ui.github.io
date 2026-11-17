import test from 'node:test';import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startDesignNodeServer} from '../packages/design-production-adapter/node-http-server.mjs';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
const publicOrigin='https://node-server.synthetic.invalid';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function start(runtime,extra={}){return startDesignNodeServer({enabled:true,runtime,publicOrigin,...extra});}
const send=(server,path='/api/design/workflow/load',extra={})=>fetch('http://127.0.0.1:'+server.address.port+path,{method:'POST',headers:{origin:publicOrigin,'content-type':'application/json','x-employee-session':'SYNTHETIC-ONLY',...extra.headers},body:'{}',...extra});
test('actual private normalized image keeps cache policy and bounded source-binding headers',async()=>{
 const server=await start({handle:async()=>new Response(Uint8Array.from([255,216,255,217]),{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-design-preview':'phone-v2','x-design-preview-width':'1024','x-design-preview-height':'768','x-design-source-media':'synthetic-heic','x-design-source-bytes':'8247','x-design-source-mime':'image/heic','x-private-object-path':'MUST_NOT_FORWARD','set-cookie':'MUST_NOT_FORWARD'}})});
 try{const r=await send(server,'/api/design/media/preview');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('content-type'),'image/jpeg');assert.equal(r.headers.get('x-design-source-media'),'synthetic-heic');assert.equal(r.headers.get('x-design-source-mime'),'image/heic');assert.equal(r.headers.get('x-design-preview-width'),'1024');assert.equal(r.headers.get('x-private-object-path'),null);assert.equal(r.headers.get('set-cookie'),null);assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[255,216,255,217]);}finally{await server.close();}
});
test('disabled by default and invalid config opens no listener',async()=>{await assert.rejects(startDesignNodeServer(),/DISABLED/);for(const c of [{publicOrigin:'http://localhost'},{timeoutMs:30001},{maxConcurrent:17},{port:-1}])await assert.rejects(start({handle:async()=>new Response()},c),/INVALID/);});
test('real HTTP bridges exact Fetch runtime; strips cookies/proxy headers and unsafe response headers',async()=>{
 let calls=0;const server=await start({async handle(req){calls++;assert.equal(req.url,publicOrigin+'/api/design/workflow/load');assert.equal(req.headers.get('x-employee-session'),'SYNTHETIC-ONLY');assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('x-forwarded-host'),null);assert.equal(await req.text(),'{}');return new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':'bad','location':'https://bad.invalid','access-control-allow-origin':'*'}});}});
 try{const r=await send(server,undefined,{headers:{origin:publicOrigin,'content-type':'application/json','x-employee-session':'SYNTHETIC-ONLY',cookie:'SYNTHETIC-COOKIE','x-forwarded-host':'bad.invalid'}});assert.equal(r.status,200);assert.equal(await r.text(),'{"ok":true}');assert.equal(r.headers.get('cache-control'),'no-store');for(const h of ['set-cookie','location','access-control-allow-origin'])assert.equal(r.headers.get(h),null);assert.equal(calls,1);}finally{await server.close();}
});
test('wrong origin, GET, query/path traversal/arbitrary paths never invoke runtime',async()=>{
 let calls=0;const server=await start({handle:async()=>{calls++;return new Response();}});try{
  assert.equal((await send(server,undefined,{headers:{origin:'https://other.invalid'}})).status,403);
  for(const p of ['/api/design/workflow/load?x=1','/api/design/%2e%2e/keys','/private/master-key.bin','/api/design/workflow/load/extra/more'])assert.equal((await send(server,p)).status,404);
  assert.equal((await send(server,undefined,{method:'GET',body:undefined})).status,404);assert.equal(calls,0);
 }finally{await server.close();}
});
test('actual default Fetch handler remains closed through real HTTP, with no key or SQL setup',async()=>{const server=await start({handle:createDesignHttpHandler()});try{const r=await send(server);assert.equal(r.status,503);const body=await r.text();assert(!body.includes('SYNTHETIC-ONLY'));}finally{await server.close();}});
test('deadline aborts forwarded Request and busy admission persists until unresolved handler settles',async()=>{
 const hold=deferred(),entered=deferred();let signal;const server=await start({async handle(r){signal=r.signal;entered.resolve();await hold.promise;return new Response('{"late":true}');}},{timeoutMs:50,maxConcurrent:1});
 try{const pending=send(server).catch(e=>e);await entered.promise;const first=await pending;if(first instanceof Response){assert.equal(first.status,504);assert(!await first.text().then(t=>t.includes('late')));}assert.equal(signal.aborted,true);assert.equal((await send(server)).status,503);hold.resolve();await new Promise(r=>setTimeout(r,10));}finally{hold.resolve();await server.close();}
});
test('oversized declared request rejects before runtime, and thrown errors are redacted',async()=>{
 let calls=0;const server=await start({handle:async()=>{calls++;throw Error('SECRET-SYNTHETIC-TEXT');}});try{
  const status=await new Promise((resolve,reject)=>{const r=request({host:'127.0.0.1',port:server.address.port,path:'/api/design/workflow/load',method:'POST',headers:{origin:publicOrigin,'content-length':String(12*1024*1024+1)}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});assert.equal(status,413);assert.equal(calls,0);
  const r=await send(server);assert.equal(r.status,500);assert(!await r.text().then(t=>t.includes('SECRET')));
 }finally{await server.close();}
});
