/** Synthetic protocol tests only: never contact Supabase or decode real images. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createManagedImageTransform,ManagedImageTransformError,MANAGED_IMAGE_TRANSFORM_SCHEMA} from '../packages/design-production-adapter/managed-image-transform.mjs';
import {PRIVATE_MEDIA_MAX_BYTES} from '../packages/design-production-adapter/private-media.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const origin='https://syntheticproject00001.supabase.co',bucket='customer-design-photos';
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const authority=()=>({schemaVersion:'design-immutable-authority-v1',subjectId:'synthetic-subject',employmentId:'synthetic-employment',membershipId:'synthetic-membership',securityEpoch:1,membershipRevision:1,storeId:'synthetic-store',actor:{username:'synthetic-alias',store:'Synthetic Store'},scope:{...scope},bindingRevision:'binding-1'});
const hash=b=>createHash('sha256').update(b).digest('hex');
// Deliberately NOT a valid fully decoded JPEG: markers are not certification.
const bytes=()=>Buffer.concat([Buffer.from([255,216,255]),Buffer.from('Exif\0\0GPS Orientation=6 ICC_PROFILE synthetic truncated pixels')]);
const request=()=>({credential:'synthetic-bearer-not-to-transport',scope:{...scope},mediaId:'photo-1',requestId:'transform-1',maxEdge:1024});
const row=()=>({authority:authority(),mediaId:'photo-1',projectOrigin:origin,bucket,objectKey:'11/prepared/immutable/photo-1.jpg',objectVersion:'synthetic-version-1',expectedSourceSha256:'a'.repeat(64),mime:'image/jpeg',byteLength:2048,width:3000,height:2000,orientation:'confirmed',immutable:true,active:true});
const stream=chunks=>new ReadableStream({start(c){chunks.forEach(x=>c.enqueue(x));c.close();}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={}){
 const state={source:row(),events:[],requests:[],claimed:new Set(),access:true,cost:true,afterResolve:null,afterAccess:null,afterCost:null,afterClaim:null,reply:null};
 const config={enabled:true,projectOrigin:origin,bucket,timeoutMs:1000,maxResponseBytes:4096,
  resolveSource:async arg=>{state.events.push('source:'+arg.phase);if(state.afterResolve)await state.afterResolve(arg);return structuredClone(state.source);},
  authorize:async arg=>{state.events.push('access:'+arg.phase);assert.equal(arg.intent.purpose,'private_image_managed_transform_quarantine');assert.equal(arg.intent.recipient,origin);assert.equal(arg.intent.source.authority.subjectId,'synthetic-subject');if(state.afterAccess)await state.afterAccess(arg);return state.access;},
  approveCost:async arg=>{state.events.push('cost:'+arg.phase);if(state.afterCost)await state.afterCost(arg);return state.cost;},
  finalGuard:async arg=>{state.events.push('final:'+arg.phase);return state.access&&state.cost&&isDeepStrictEqual(state.source,arg.intent.source);},
  claimAttempt:async arg=>{state.events.push('claim');const key=arg.intent.source.authority.subjectId+':'+arg.intent.requestId;if(state.claimed.has(key))return 'existing';state.claimed.add(key);if(state.afterClaim)await state.afterClaim(arg);return 'created';},
  transport:async req=>{state.events.push('transport');state.requests.push(req);return state.reply?state.reply(req):{status:200,url:req.url,redirected:false,mime:'image/jpeg',body:stream([bytes()])};},...overrides};
 return {state,config,adapter:createManagedImageTransform(config)};
}
const reject=async(p,code,outcome)=>assert.rejects(p,e=>e instanceof ManagedImageTransformError&&e.code===code&&e.message===code&&e.retryable===false&&(!outcome||e.outcome===outcome));
test('default disabled and incomplete explicit dependencies never resolve or dispatch',async()=>{
 await reject(createManagedImageTransform().transform(request()),'MANAGED_TRANSFORM_DISABLED');
 for(const option of ['resolveSource','authorize','approveCost','finalGuard','claimAttempt','transport']){const f=fixture({[option]:undefined});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_DISABLED');assert.equal(f.state.events.length,0);}
});
test('server configuration rejects external origin, implicit limits and widened bounds',async()=>{
 for(const options of [{projectOrigin:'http://syntheticproject00001.supabase.co'},{projectOrigin:origin+'/'},{projectOrigin:'https://storage.example.invalid'},{projectOrigin:'https://user@syntheticproject00001.supabase.co'},{bucket:'../other'},{timeoutMs:30001},{timeoutMs:undefined},{maxResponseBytes:8*1024*1024+1}]){const f=fixture(options);await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_DISABLED');assert.equal(f.state.events.length,0);}
});
test('fixed authenticated transform requests contain/origin and returns only pending provenance',async()=>{
 const f=fixture(),result=await f.adapter.transform(request()),r=f.state.requests[0],u=new URL(r.url);
 assert.equal(u.pathname,'/storage/v1/render/image/authenticated/customer-design-photos/11/prepared/immutable/photo-1.jpg');assert.deepEqual(Object.fromEntries(u.searchParams),{width:'1024',height:'682',resize:'contain',format:'origin',quality:'80'});
 assert.equal(r.redirect,'error');assert.equal(r.credentials,'omit');assert.equal(r.cache,'no-store');assert.equal(r.expectedObjectVersion,'synthetic-version-1');assert.equal(r.expectedSourceSha256,'a'.repeat(64));assert(!JSON.stringify(r).includes('synthetic-bearer'));assert(!r.url.includes('token='));assert(!r.url.includes('version'));
 assert.equal(result.schemaVersion,MANAGED_IMAGE_TRANSFORM_SCHEMA);assert.equal(result.state,'pending_validation');assert.equal(result.source.expectedSourceSha256,'a'.repeat(64));assert.equal(result.derivative.sha256,hash(bytes()));assert.equal(result.derivative.byteLength,bytes().length);assert.equal(result.validation.derivativeSource,'not_verified');assert(Object.isFrozen(result.validation));assert(!JSON.stringify(result).includes('supabase.co'));assert(!('bytes' in result));assert(!('decoded' in result));assert(!('metadataRemoved' in result));
 assert.deepEqual(f.state.events.filter(x=>x.startsWith('access:')),['access:before_claim','access:before_transport','access:after_response']);assert.deepEqual(f.state.events.filter(x=>x.startsWith('cost:')),['cost:before_claim','cost:before_transport','cost:after_response']);
 assert.equal(f.state.events[f.state.events.indexOf('transport')-1],'final:before_transport');assert.equal(f.state.events.at(-1),'final:after_response');
});
test('1536 and small originals never request an upscale, with unknown output geometry',async()=>{
 const f=fixture();const a=await f.adapter.transform({...request(),maxEdge:1536});assert.deepEqual(a.requestedTransform,{maxEdge:1536,width:1536,height:1024,resize:'contain',format:'origin',quality:80});
 const g=fixture();g.state.source.width=200;g.state.source.height=300;const b=await g.adapter.transform(request());assert.equal(b.requestedTransform.width,200);assert.equal(b.requestedTransform.height,300);assert.equal(b.validation.geometry,'not_verified');
});
test('only exact public selectors permitted: no URLs, hashes, approval booleans or arbitrary dimensions',async()=>{
 for(const extra of [{url:origin},{objectKey:'foo'},{sourceSha256:'b'.repeat(64)},{approved:true},{width:1200}]){const f=fixture();await reject(f.adapter.transform({...request(),...extra}),'MANAGED_TRANSFORM_INVALID');assert.equal(f.state.events.length,0);}
 for(const maxEdge of [0,1,1023,1025,1535,1537,2500,'1024',null])await reject(fixture().adapter.transform({...request(),maxEdge}),'MANAGED_TRANSFORM_INVALID');
});
test('input getters and proxies execute zero traps; request source is independently snapshotted',async()=>{
 let calls=0;const bad=request();Object.defineProperty(bad,'scope',{enumerable:true,get(){calls++;return scope;}});await reject(fixture().adapter.transform(bad),'MANAGED_TRANSFORM_INVALID');
 const proxy=new Proxy(request(),{ownKeys(){calls++;throw Error('secret');},get(){calls++;throw Error('secret');}});await reject(fixture().adapter.transform(proxy),'MANAGED_TRANSFORM_INVALID');assert.equal(calls,0);
 const wait=deferred(),f=fixture();f.state.afterResolve=async()=>{await wait.promise;};const q=request(),pending=f.adapter.transform(q);q.scope.customerProfileId='99';q.maxEdge=1536;wait.resolve();const out=await pending;assert.equal(out.requestedTransform.maxEdge,1024);
});
test('source path/destination/immutable/version/active/type/bounds all fail before cost or transport',async()=>{
 for(const patch of [{objectKey:'../photo'},{objectKey:'a/%2e%2e/x'},{objectKey:'a//b'},{objectKey:'https://evil.invalid/x'},{objectVersion:''},{objectVersion:'https://private.invalid?token=secret'},{projectOrigin:'https://other.supabase.co'},{bucket:'public'},{immutable:false},{active:false},{mime:'image/svg+xml'},{byteLength:PRIVATE_MEDIA_MAX_BYTES+1},{width:16385},{width:10000,height:10000},{expectedSourceSha256:'a'.repeat(63)},{mediaId:'other'}]){const f=fixture();Object.assign(f.state.source,patch);await assert.rejects(f.adapter.transform(request()));assert.equal(f.state.events.filter(x=>x.startsWith('cost:')).length,0);assert.equal(f.state.requests.length,0);}
});
test('unknown source orientation rejects before approval claim/dispatch rather than inventing geometry',async()=>{const f=fixture();f.state.source.orientation='unverified';await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_SOURCE_ORIENTATION_REQUIRED');assert.deepEqual(f.state.events,['source:initial']);});
test('source getters and same-alias different identity cannot supply an alternating snapshot',async()=>{
 let calls=0;const s=row();Object.defineProperty(s,'width',{enumerable:true,get(){calls++;return 3000;}});const f=fixture({resolveSource:()=>s});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_INVALID');assert.equal(calls,0);
 const g=fixture();g.state.afterClaim=()=>{g.state.source.authority.subjectId='replacement-with-same-alias';};await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_SOURCE_CHANGED');assert.equal(g.state.requests.length,0);
});
test('data processing and cost approvals are independent and cannot be omitted',async()=>{
 const f=fixture();f.state.access=false;await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_ACCESS_DENIED','not_sent');assert.equal(f.state.claimed.size,0);assert.equal(f.state.requests.length,0);
 const g=fixture();g.state.cost=false;await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_COST_DENIED','not_sent');assert.equal(g.state.claimed.size,0);assert.equal(g.state.requests.length,0);
});
test('claim is one-shot; unknown claim or repeat cannot trigger a second chargeable call',async()=>{
 const f=fixture();await f.adapter.transform(request());await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_ALREADY_CLAIMED','not_sent');assert.equal(f.state.requests.length,1);
 const g=fixture({claimAttempt:()=>{throw Error('SECRET unknown ledger commit');}});await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_UNAVAILABLE','uncertain');assert.equal(g.state.requests.length,0);
});
test('claim wait followed by access/cost/object change performs fresh checks and sends nothing',async()=>{
 for(const change of ['access','cost','object']){const f=fixture();f.state.afterClaim=()=>{if(change==='object')f.state.source.objectVersion='new-version';else f.state[change]=false;};await assert.rejects(f.adapter.transform(request()));assert.equal(f.state.requests.length,0);assert.equal(f.state.claimed.size,1);}
});
test('after transport revocation and mutation withhold output, with uncertain cost and no retry',async()=>{
 for(const change of ['access','cost','object','hash','scope','epoch']){const f=fixture();f.state.reply=req=>{if(change==='access'||change==='cost')f.state[change]=false;else if(change==='object')f.state.source.objectVersion='later';else if(change==='hash')f.state.source.expectedSourceSha256='b'.repeat(64);else if(change==='scope')f.state.source.authority.scope.customerProfileId='12';else f.state.source.authority.securityEpoch++;return {status:200,url:req.url,redirected:false,mime:'image/jpeg',body:stream([bytes()])};};await assert.rejects(f.adapter.transform(request()),e=>e.outcome==='uncertain'&&e.retryable===false);assert.equal(f.state.requests.length,1);}
});
test('object change during last cost wait is found by fresh resolver before return',async()=>{const f=fixture();f.state.afterCost=arg=>{if(arg.phase==='after_response')f.state.source.objectVersion='changed-while-waiting';};await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_SOURCE_CHANGED','uncertain');});
test('final source wait cannot hide separate cost or processing revocation before dispatch',async()=>{
 for(const permission of ['access','cost']){const atWait=deferred(),resume=deferred(),f=fixture();let reads=0;f.state.afterResolve=async arg=>{if(arg.phase==='before_transport'&&++reads===2){atWait.resolve();await resume.promise;}};const pending=f.adapter.transform(request());await atWait.promise;f.state[permission]=false;resume.resolve();await reject(pending,'MANAGED_TRANSFORM_ACCESS_DENIED','not_sent');assert.equal(f.state.requests.length,0);assert.equal(f.state.claimed.size,1);}
});
test('final source wait cannot hide separate revocation before result delivery',async()=>{
 for(const permission of ['access','cost']){const atWait=deferred(),resume=deferred(),f=fixture();let reads=0;f.state.afterResolve=async arg=>{if(arg.phase==='after_response'&&++reads===2){atWait.resolve();await resume.promise;}};const pending=f.adapter.transform(request());await atWait.promise;f.state[permission]=false;resume.resolve();await reject(pending,'MANAGED_TRANSFORM_ACCESS_DENIED','uncertain');assert.equal(f.state.requests.length,1);}
});
test('EXIF/GPS/orientation/ICC and truncated synthetic pixels remain unvalidated, not clean derivatives',async()=>{
 const result=await fixture().adapter.transform(request());for(const field of ['sourceBytes','derivativeSource','fullDecode','metadataRemoval','orientation','color','geometry'])assert.equal(result.validation[field],'not_verified');assert.equal(result.validation.candidateEligible,false);assert.equal(result.validation.publicEligible,false);assert.equal(result.validation.immutableObject,'trusted_resolver_assertion');
});
test('response redirects, wrong MIME/status/URL and non-stream bodies are withheld',async()=>{
 for(const patch of [{redirected:true},{status:302},{status:401},{url:'https://other.invalid'},{mime:'image/png'},{body:new Uint8Array([1,2,3])}]){const f=fixture();f.state.reply=req=>({status:200,url:req.url,redirected:false,mime:'image/jpeg',body:stream([bytes()]),...patch});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_RESPONSE_INVALID','uncertain');assert.equal(f.state.requests.length,1);}
});
test('actual streamed output length, chunk count, empty body and magic are independently bounded',async()=>{
 const f=fixture({maxResponseBytes:8});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_BYTES_LIMIT','uncertain');
 for(const chunks of [[],[new Uint8Array([1,2,3])],[new Uint8Array(new SharedArrayBuffer(16))]]){const g=fixture();g.state.reply=req=>({status:200,url:req.url,redirected:false,mime:'image/jpeg',body:stream(chunks)});await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_RESPONSE_INVALID','uncertain');}
 const g=fixture();g.state.reply=req=>({status:200,url:req.url,redirected:false,mime:'image/jpeg',body:stream(Array.from({length:4097},()=>new Uint8Array()))});await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_BYTES_LIMIT','uncertain');
});
test('PNG/WebP exact MIME and minimal signature filters still do not claim full decode',async()=>{
 for(const [mime,data] of [['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/webp',Buffer.from('RIFF0000WEBP')]]){const f=fixture();f.state.source.mime=mime;f.state.reply=req=>({status:200,url:req.url,redirected:false,mime,body:stream([data])});const out=await f.adapter.transform(request());assert.equal(out.validation.fullDecode,'not_verified');assert.equal(out.derivative.sha256,hash(data));}
});
test('already aborted request performs no work and abort during resolver blocks claim',async()=>{
 const a=new AbortController();a.abort();const f=fixture();await reject(f.adapter.transform({...request(),signal:a.signal}),'MANAGED_TRANSFORM_ABORTED','not_sent');assert.equal(f.state.events.length,0);
 const b=new AbortController(),wait=deferred(),g=fixture({resolveSource:()=>wait.promise});const pending=g.adapter.transform({...request(),signal:b.signal});b.abort();await reject(pending,'MANAGED_TRANSFORM_ABORTED','not_sent');wait.resolve(row());assert.equal(g.state.requests.length,0);
});
test('total deadline includes resolver, cost, claim, transport and body waits',async()=>{
 for(const dependency of ['resolveSource','approveCost','finalGuard','claimAttempt','transport']){const f=fixture({timeoutMs:20,[dependency]:()=>new Promise(()=>{})});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT',['claimAttempt','transport'].includes(dependency)?'uncertain':'not_sent');}
 const f=fixture({timeoutMs:20});f.state.reply=req=>({status:200,url:req.url,redirected:false,mime:'image/jpeg',body:new ReadableStream({pull:()=>new Promise(()=>{})})});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT','uncertain');
});
test('late ignored-abort transport body is cancelled and cannot become a returned result',async()=>{
 const late=deferred();let cancelled=0,calls=0,req;const f=fixture({timeoutMs:20,transport:r=>{req=r;calls++;return late.promise;}});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT','uncertain');assert.equal(req.signal.aborted,true);late.resolve({status:200,url:req.url,redirected:false,mime:'image/jpeg',body:new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}})});await sleep(5);assert.equal(cancelled,1);assert.equal(calls,1);
});
test('invalid extra-field responses cancel own data-body, including late replies',async()=>{
 let immediate=0;const f=fixture();f.state.reply=req=>({status:200,url:req.url,redirected:false,mime:'image/jpeg',extra:'invalid',body:new ReadableStream({cancel(){immediate++;}})});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_INVALID','uncertain');await sleep(1);assert.equal(immediate,1);
 const late=deferred();let cancelled=0,req;const g=fixture({timeoutMs:20,transport:r=>{req=r;return late.promise;}});await reject(g.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT','uncertain');late.resolve({status:200,url:req.url,redirected:false,mime:'image/jpeg',extra:'invalid',body:new ReadableStream({cancel(){cancelled++;}})});await sleep(5);assert.equal(cancelled,1);
});
test('invalid response body/shape accessors are not executed even during cleanup',async()=>{
 let traps=0;for(const proxied of [false,true]){const f=fixture();f.state.reply=req=>{const raw={status:200,url:req.url,redirected:false,mime:'image/jpeg',extra:true};Object.defineProperty(raw,'body',{enumerable:true,get(){traps++;throw Error('secret');}});return proxied?new Proxy(raw,{getOwnPropertyDescriptor(){traps++;throw Error('secret');},get(_target,key){if(key==='then')return undefined;traps++;throw Error('secret');}}):raw;};await assert.rejects(f.adapter.transform(request()));}assert.equal(traps,0);
});
test('deadline expires during final approval and never publishes late provenance',async()=>{
 const wait=deferred(),f=fixture({timeoutMs:20});f.state.afterCost=arg=>arg.phase==='after_response'?wait.promise:undefined;await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT','uncertain');wait.resolve();await sleep(1);assert.equal(f.state.requests.length,1);
});
test('dependency failures are fixed safe errors, never secret text or retry permission',async()=>{
 for(const dependency of ['resolveSource','authorize','approveCost','finalGuard','claimAttempt','transport']){const f=fixture({[dependency]:()=>{throw Error('PRIVATE_KEY token=SECRET');}});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_UNAVAILABLE');}
});

test('private persistence is separately opt-in and missing sink fails closed',async()=>{
 const f=fixture({persistDerivative:()=>{throw Error('must not run');}});await f.adapter.transform(request());
 const absent=fixture({derivativePersistenceEnabled:true});await reject(absent.adapter.transform(request()),'MANAGED_TRANSFORM_DISABLED');assert.equal(absent.state.requests.length,0);
});
test('trusted sink receives exact same bounded bytes after guard and borrowed buffer is erased',async()=>{
 let borrowed,calls=0;const f=fixture({derivativePersistenceEnabled:true,persistDerivative:async r=>{calls++;borrowed=r.bytes;assert.deepEqual(r.bytes,bytes());assert.equal(r.descriptor.derivative.sha256,hash(r.bytes));assert.equal(r.descriptor.validation.fullDecode,'not_verified');assert.ok(f.state.events.includes('final:after_response'));return {stored:true,derivativeSha256:hash(r.bytes)};}});
 const out=await f.adapter.transform(request());assert.equal(calls,1);assert.ok(borrowed.every(v=>v===0));assert.equal(out.validation.candidateEligible,false);assert.equal(f.state.events.filter(x=>x==='final:after_response').length,2);
});
test('unknown sink outcome consumes transform claim and never automatically re-sends',async()=>{
 let calls=0;const f=fixture({derivativePersistenceEnabled:true,persistDerivative:async()=>{calls++;throw Error('synthetic lost storage receipt');}});
 await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_UNAVAILABLE','uncertain');await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_ALREADY_CLAIMED');assert.equal(calls,1);assert.equal(f.state.requests.length,1);
});
test('malformed persistence receipt or byte mutation cannot publish a descriptor',async()=>{
 for(const mode of ['receipt','mutate']){const f=fixture({derivativePersistenceEnabled:true,persistDerivative:async r=>{const h=hash(r.bytes);if(mode==='mutate')r.bytes[0]=0;return {stored:true,derivativeSha256:mode==='receipt'?'a'.repeat(64):h};}});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_RESPONSE_INVALID','uncertain');}
});
test('revocation after private write withholds returned descriptor without deleting or retrying',async()=>{
 const f=fixture({derivativePersistenceEnabled:true,persistDerivative:async r=>{f.state.access=false;return {stored:true,derivativeSha256:hash(r.bytes)};}});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_ACCESS_DENIED','uncertain');assert.equal(f.state.requests.length,1);
});
test('sink timeout with late completion cannot return bytes or retry claim',async()=>{
 const done=deferred();let borrowed;const f=fixture({timeoutMs:25,derivativePersistenceEnabled:true,persistDerivative:r=>{borrowed=r.bytes;return done.promise;}});await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_TIMEOUT','uncertain');assert.ok(borrowed.every(v=>v===0));done.resolve({stored:true,derivativeSha256:hash(bytes())});await sleep(1);await reject(f.adapter.transform(request()),'MANAGED_TRANSFORM_ALREADY_CLAIMED');assert.equal(f.state.requests.length,1);
});
