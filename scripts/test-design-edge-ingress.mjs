import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignEdgeIngress} from '../packages/design-production-adapter/edge-ingress.mjs';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {createPreparedHttpClient} from '../packages/design-prepared-ui/http-client.mjs';
import {DESIGN_APP1_ORIGIN as app,DESIGN_EDGE_ORIGIN as api,DESIGN_EDGE_BASE_PATH as base} from '../packages/shared/design-hosted-routing.mjs';
const token='SYNTHETIC_EDGE_SESSION_ONLY',scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},visit={assignmentSource:'appointment',visitId:'booking:101'};
const request=(path='visit/resolve',extra={})=>new Request(api+base+'/api/design/'+path,{method:'POST',headers:{origin:app,'x-employee-session':token,'content-type':'application/json'},body:JSON.stringify({visit}),...extra});
test('Edge routing is closed by default; wrong host/path/query never reaches original handler',async()=>{
 assert.equal((await createDesignEdgeIngress()(request())).status,503);let calls=0;
 const h=createDesignEdgeIngress({enabled:true,handle:async()=>{calls++;return Response.json({});}});
 for(const url of [app+base+'/api/design/visit/resolve',api+'/api/design/visit/resolve',api+base+'/api/design/visit/resolve?x=1',api+base+'/api/design/%76isit/resolve',api+base+'/api/design/visit//resolve'])assert.equal((await h(new Request(url,{method:'POST'}))).status,404);
 assert.equal((await h(request('visit/resolve',{method:'GET',body:undefined}))).status,405);assert.equal(calls,0);
});
test('explicit client prefix reaches original auth and exact visit resolver without granting extra scope',async()=>{
 let calls=0,active=true;const original=createDesignHttpHandler({enabled:true,publicOrigin:app,allowedRequestOrigins:[app],employeeAdapter:{async authenticate(value){assert.equal(value,token);if(!active)throw Error('revoked');},gate:{}},async visitResolver(input){assert.deepEqual(input,{visit,credential:token});calls++;return {scope};}});
 const edge=createDesignEdgeIngress({enabled:true,handle:original});
 const client=createPreparedHttpClient({enabled:true,origin:app,documentOrigin:app,apiOrigin:api,apiBasePath:base,allowCrossOriginApi:true,credentialProvider:async()=>token,fetchImpl:async(url,init)=>{assert.equal(url,api+base+'/api/design/visit/resolve');return edge(new Request(url,{...init,headers:{...init.headers,origin:app}}));}});
 assert.deepEqual(await client.resolveVisit(visit),{scope});assert.equal(calls,1);active=false;await assert.rejects(()=>client.resolveVisit(visit));assert.equal(calls,1);
 const preflight=await edge(request('visit/resolve',{method:'OPTIONS',body:undefined,headers:{origin:app,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-employee-session'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),app);
 assert.equal((await edge(request('visit/resolve',{headers:{origin:'https://wrong.invalid'}}))).status,403);
 assert.equal((await edge(request('visit/resolve',{headers:{origin:app,authorization:'Bearer synthetic'}}))).status,400);
});
test('path configuration is trusted exact target only and keeps response-URL pinning',async()=>{
 let calls=0;const make=extra=>createPreparedHttpClient({enabled:true,origin:app,documentOrigin:app,apiOrigin:api,allowCrossOriginApi:true,credentialProvider:async()=>token,fetchImpl:async()=>{calls++;return Response.json({ok:true,result:{}});},...extra});
 for(const apiBasePath of ['/',base+'/',base+'?x',base+'/../other','//evil.invalid',42])await assert.rejects(()=>make({apiBasePath}).resolveVisit(visit),/HTTP_CLIENT_NOT_CONFIGURED/);
 await assert.rejects(()=>make({apiOrigin:'https://other.invalid',apiBasePath:base}).resolveVisit(visit),/HTTP_CLIENT_NOT_CONFIGURED/);assert.equal(calls,0);
 await assert.rejects(()=>make({apiBasePath:base,fetchImpl:async()=>{const r=Response.json({ok:true,result:{}});Object.defineProperty(r,'url',{value:api+'/api/design/visit/resolve'});return r;}}).resolveVisit(visit),/REDIRECT_DENIED/);
});
test('measured Supabase internal form requires explicit opt-in and the exact origin/host/path tuple',async()=>{
 let calls=0;const handle=async req=>{calls++;assert.equal(req.url,app+'/api/design/visit/resolve');assert.equal(req.headers.get('x-employee-session'),token);assert.deepEqual(await req.json(),{visit});return Response.json({ok:true});};
 const internal=api.replace('https:','http:')+'/design-api/api/design/visit/resolve';
 const make=(url=internal,host='edge-runtime.supabase.com')=>new Request(url,{method:'POST',headers:{host,origin:app,'x-employee-session':token,'content-type':'application/json'},body:JSON.stringify({visit})});
 assert.equal((await createDesignEdgeIngress({enabled:true,handle})(make())).status,404);
 const edge=createDesignEdgeIngress({enabled:true,allowSupabaseGatewayRewrite:true,handle});
 for(const [url,host]of [[internal,'wrong.invalid'],[internal.replace('http:','https:'),'edge-runtime.supabase.com'],[internal.replace('/design-api/','/wrong/'),'edge-runtime.supabase.com'],[internal.replace('pdssrmpeiuwvxzsgschm','other-project'),'edge-runtime.supabase.com'],[internal+'?x','edge-runtime.supabase.com']])assert.equal((await edge(make(url,host))).status,404);
 assert.equal(calls,0);assert.equal((await edge(make())).status,200);assert.equal(calls,1);
});
test('preview response exposes only fixed safe metadata; redirects and cookies are denied',async()=>{
 const headers={'access-control-allow-origin':app,'cache-control':'private, no-store','x-design-preview':'phone-v2','x-design-preview-width':'768','x-design-preview-height':'576','x-design-source-media':'synthetic-photo','x-design-source-bytes':'1234','x-design-source-mime':'image/heif','content-type':'image/jpeg'};
 const h=createDesignEdgeIngress({enabled:true,handle:async()=>new Response(new Uint8Array([255,216,255,217]),{headers})});const r=await h(request());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.ok(r.headers.get('access-control-expose-headers').includes('x-design-source-mime'));assert.equal(r.headers.get('access-control-allow-credentials'),null);
 for(const response of [new Response(null,{status:302,headers:{location:'https://wrong.invalid'}}),new Response(null,{headers:{'set-cookie':'private=synthetic'}}),new Response(null,{headers:{...headers,'cache-control':'public'}})])assert.equal((await createDesignEdgeIngress({enabled:true,handle:async()=>response})(request())).status,502);
});
