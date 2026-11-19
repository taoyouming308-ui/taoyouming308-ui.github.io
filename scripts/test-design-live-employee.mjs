import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createLiveEmployeeAuthorityHandler} from '../supabase/functions/design-employee-authority/handler.mjs';
import {createLiveEmployeeSessionVerifier} from '../packages/design-production-adapter/live-employee-session.mjs';
const ENDPOINT='https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/design-employee-authority';
const APP='https://taoyouming308-ui.github.io',TOKEN='synthetic-live-employee-'+ 'a'.repeat(64),NOW=Date.now();
const hash=v=>createHash('sha256').update(v).digest('hex');
function identity(nonce,patch={}){return {schemaVersion:'design-live-employee-v1',nonce,staffId:'17',staffCreatedAt:'2026-01-01T00:00:00.000000Z',actor:{username:'synthetic stylist',store:'自由手艺人'},sessionBinding:hash('design-live-employee-v1:'+TOKEN),sourceRevision:'a'.repeat(64),checkedAt:NOW,sessionExpiresAt:NOW+3600000,validUntil:NOW+5000,...patch};}
function request({url=ENDPOINT,method='POST',origin=APP,token=TOKEN,body=JSON.stringify({nonce:randomUUID()}),headers={}}={}){return new Request(url,{method,headers:{...(origin?{origin}:{}),'content-type':'application/json',...(token?{'x-employee-session':token}:{}),...headers},...(!['GET','HEAD','OPTIONS'].includes(method)?{body}:{})});}
test('real employee result is minimal, private and never relays supplied credential',async()=>{
 let calls=0;const handle=createLiveEmployeeAuthorityHandler({clock:()=>NOW,verifySession:async(t,n)=>{calls++;assert.equal(t,TOKEN);return identity(n);}});const r=await handle(request());assert.equal(r.status,200);assert.equal(calls,1);assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('access-control-allow-origin'),APP);assert.equal(r.headers.get('access-control-allow-credentials'),null);const body=await r.text();assert(!body.includes(TOKEN));assert.equal(JSON.parse(body).identity.staffId,'17');
});
test('route, origin, method, credential, ambient authority and request shape fail before source reads',async()=>{
 let calls=0;const handle=createLiveEmployeeAuthorityHandler({verifySession:async()=>{calls++;throw Error();}});
 for(const q of [{origin:'https://other.invalid'},{url:ENDPOINT+'?path=staff'},{url:ENDPOINT+'/alias'},{method:'GET'},{token:null},{token:'short'},{token:TOKEN+' x'},{headers:{cookie:'session=x'}},{headers:{authorization:'Bearer x'}},{body:'{"nonce":"forged"}'},{body:JSON.stringify({nonce:randomUUID(),staffId:'17'})},{body:' '.repeat(81)}])assert((await handle(request(q))).status>=400);
 assert.equal(calls,0);
});
test('CORS preflight permits only the exact employee session headers without source reads',async()=>{
 let calls=0;const handle=createLiveEmployeeAuthorityHandler({verifySession:()=>{calls++;}}),headers={'access-control-request-method':'POST','access-control-request-headers':'X-Employee-Session, Content-Type'};
 const r=await handle(request({method:'OPTIONS',headers}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-max-age'),'0');
 for(const q of [{origin:'https://other.invalid',headers},{headers:{...headers,'access-control-request-headers':'content-type,x-employee-session,authorization'}},{headers:{...headers,'access-control-request-method':'PUT'}},{origin:null,headers}])assert.equal((await handle(request({method:'OPTIONS',...q}))).status,403);assert.equal(calls,0);
});
test('dependency failures, extra data, stale/expired claims and invalid staff identity are withheld uniformly',async()=>{
 for(const patch of [{credential:TOKEN},{staffId:'0'},{actor:{username:'synthetic stylist',store:'other'}},{checkedAt:NOW-2001},{checkedAt:NOW+251},{validUntil:NOW},{validUntil:NOW+5001},{nonce:randomUUID()},{staffCreatedAt:'bad'}]){
  const handle=createLiveEmployeeAuthorityHandler({clock:()=>NOW,verifySession:async(t,n)=>identity(n,patch)}),r=await handle(request());assert.equal(r.status,403);assert.deepEqual(await r.json(),{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
 }
 const handle=createLiveEmployeeAuthorityHandler({verifySession:async()=>{throw Error(TOKEN);}});assert(!(await (await handle(request())).text()).includes(TOKEN));
});
function clientFixture(change=v=>v,responsePatch={}){
 let calls=0;const sent=[];
 const client=createLiveEmployeeSessionVerifier({enabled:true,clock:()=>NOW,fetchImplementation:async(url,init)=>{calls++;sent.push({url,init});const value=change(identity(JSON.parse(init.body).nonce),calls);return {ok:true,status:200,url,redirected:false,headers:new Headers({'content-type':'application/json','cache-control':'private, no-store'}),body:new Response(JSON.stringify({ok:true,identity:value})).body,...responsePatch};}});
 return {client,sent,count:()=>calls};
}
test('server client uses fixed TLS origin, short fresh proof, no cookies/redirects/retries/cache',async()=>{
 const f=clientFixture(),a=await f.client.verify(TOKEN);await f.client.recheck(TOKEN,a);assert.equal(f.count(),2);assert(Object.isFrozen(a.actor));
 for(const {url,init} of f.sent){assert.equal(url,ENDPOINT);assert.equal(init.method,'POST');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers['x-employee-session'],TOKEN);assert.deepEqual(Object.keys(JSON.parse(init.body)),['nonce']);assert(init.signal instanceof AbortSignal);}
 assert.notEqual(JSON.parse(f.sent[0].init.body).nonce,JSON.parse(f.sent[1].init.body).nonce);
});
test('default disabled and malformed credentials cause no external request',async()=>{
 let calls=0;const client=createLiveEmployeeSessionVerifier({fetchImplementation:()=>calls++});await assert.rejects(client.verify(TOKEN));assert.equal(calls,0);const f=clientFixture();for(const token of ['',TOKEN+'\n','short',{},null])await assert.rejects(f.client.verify(token));assert.equal(f.count(),0);
});
test('server rejects redirected, wrong URL, public-cache or oversized replies with one attempt',async()=>{
 for(const patch of [{url:ENDPOINT+'?alias=1'},{redirected:true},{status:302,ok:false},{headers:new Headers({'content-type':'application/json','cache-control':'no-store'})},{headers:new Headers({'content-type':'application/json','cache-control':'private, no-store','content-length':'4097'})},{body:new Response('x'.repeat(4097)).body}]){const f=clientFixture(v=>v,patch);await assert.rejects(f.client.verify(TOKEN),/DESIGN_LIVE_EMPLOYEE_DENIED/);assert.equal(f.count(),1);}
});
test('server rejects stale, substituted nonce/token, extra or expired identity evidence',async()=>{
 for(const patch of [{nonce:randomUUID()},{sessionBinding:'b'.repeat(64)},{checkedAt:NOW-2001},{checkedAt:NOW+251},{validUntil:NOW},{validUntil:NOW+5001},{staffId:'0'},{credential:TOKEN},{actor:{username:'synthetic stylist',store:'other'}}]){const f=clientFixture(v=>({...v,...patch}));await assert.rejects(f.client.verify(TOKEN));assert.equal(f.count(),1);}
});
test('fresh final checks reject account recreation, reassignment and identity changes',async()=>{
 for(const patch of [{staffId:'18'},{staffCreatedAt:'2026-02-01T00:00:00.000000Z'},{actor:{username:'other',store:'自由手艺人'}},{actor:{username:'synthetic stylist',store:'向里造型'}},{sourceRevision:'b'.repeat(64)}]){const f=clientFixture((v,n)=>n===1?v:{...v,...patch}),a=await f.client.verify(TOKEN);await assert.rejects(f.client.recheck(TOKEN,a));assert.equal(f.count(),2);}
});
