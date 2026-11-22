/** Pure protocol tests. Native backend is a Map/ReadableStream mock, NOT a
 * qualified cloud store or evidence of vendor versioning/immutability. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createManagedPrivateVersionedStorage as factory,PRIVATE_VERSIONED_BACKEND_SCHEMA,ManagedPrivateVersionedStorageError} from '../packages/design-production-adapter/managed-private-versioned-storage.mjs';
import {createManagedNormalizedStore} from '../packages/design-production-adapter/managed-normalized-store.mjs';
import {normalizedVerificationFixture} from './fixtures/managed-normalized-verification.mjs';
import {managedImageDigest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {IMAGE_UPLOAD_MAX_BYTES} from '../packages/shared/image-upload-limits.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const origin='https://syntheticmanaged.supabase.co',bucket='managed-private';
const contract=()=>({schemaVersion:PRIVATE_VERSIONED_BACKEND_SCHEMA,atomicCreateOnly:true,versionAddressedReads:true,retainedVersionsImmutable:true,privateOnly:true});
const stream=b=>new ReadableStream({start(c){c.enqueue(Uint8Array.from(b));c.close();}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(patch={}){
 const objects=new Map(),events=[];let creates=0,reads=0,grants=0,borrowed;
 const backend={contract:contract(),async createOnce(q){creates++;borrowed=q.bytes;events.push('create');assert.equal(q.private,true);assert.equal(q.ifAbsent,true);assert.equal(q.signal.aborted,false);assert(!objects.has(q.target.key));const version='native-version-'+creates;objects.set(q.target.key,{bytes:Uint8Array.from(q.bytes),version,mime:q.content.mime});return {target:q.target,version,created:true,private:true};},async readVersion(q){reads++;events.push('read:'+q.object.version);const row=objects.get(q.object.key);if(!row||row.version!==q.object.version)throw Error('NO_EXACT_VERSION');assert.equal(q.maxBytes,row.bytes.length);return {object:q.object,private:true,mime:row.mime,body:stream(row.bytes)};},...patch.backend};
 const authorize=async q=>{grants++;events.push(q.operation+':'+q.phase);assert.equal(q.signal.aborted,false);return true;};
 const config={enabled:true,projectOrigin:origin,bucket,backend,authorize,timeoutMs:1000,...patch.config};
 const bytes=Uint8Array.from(Buffer.from('SYNTHETIC normalized PNG protocol bytes'));
 const target={projectOrigin:origin,bucket,key:'managed-normalized/'+'a'.repeat(64)+'/object'},output={sha256:hash(bytes),byteLength:bytes.length,mime:'image/png',width:80,height:120};
 const put={target,output,bytes,private:true,overwrite:false};
 return {config,backend,objects,events,put,service:factory(config),counts:()=>({creates,reads,grants}),borrowed:()=>borrowed};
}
test('default off or unqualified backend performs zero I/O/authorization',async()=>{
 for(const config of [{enabled:undefined},{enabled:false},{backend:{contract:contract(),readVersion(){}}},{backend:{contract:{...contract(),versionAddressedReads:false},createOnce(){},readVersion(){}}},{backend:{contract:{...contract(),retainedVersionsImmutable:false},createOnce(){},readVersion(){}}},{timeoutMs:30001},{projectOrigin:'http://syntheticmanaged.supabase.co'},{authorize:null}]){
  const f=fixture({config});await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_DISABLED'});assert.deepEqual(f.counts(),{creates:0,reads:0,grants:0});
 }
 await assert.rejects(factory().read({}),{code:'PRIVATE_VERSIONED_DISABLED'});
});
test('create once, native version exact readback and fresh permission phases; no credentials/URL',async()=>{
 const f=fixture(),ack=await f.service.putImmutable(f.put);
 assert.deepEqual(ack,{target:f.put.target,objectVersion:'native-version-1',sha256:f.put.output.sha256,byteLength:f.put.bytes.length,mime:'image/png',created:true,private:true,immutable:true});
 assert.deepEqual(f.events,['create:before_io','create','create:after_io','read:before_io','read:native-version-1','read:after_io','create:before_return']);
 assert(f.borrowed().every(x=>x===0));assert(f.put.bytes.some(x=>x!==0));
 const got=await f.service.read({object:{...ack.target,version:ack.objectVersion},derivative:{sha256:ack.sha256,byteLength:ack.byteLength,mime:ack.mime},private:true});assert.deepEqual(got,f.put.bytes);
 assert.equal(f.counts().grants,8);assert.equal(f.counts().creates,1);
});
test('source/derived/normalized method variants compose without changing old receipts',async()=>{
 for(const kind of ['source','derivative','output']){const f=fixture();const {width,height,...simple}=f.put.output;const q={target:{...f.put.target,key:{source:'managed-quarantine/'+'b'.repeat(64)+'/source',derivative:'managed-derived/'+'c'.repeat(64)+'/object',output:f.put.target.key}[kind]},[kind]:kind==='output'?f.put.output:simple,bytes:f.put.bytes,private:true,overwrite:false,...(kind==='source'?{requestId:'synthetic-upload'}:{})};const a=await f.service.putImmutable(q);assert.equal(a.created,true);assert.deepEqual(await f.service.read({object:{...q.target,version:a.objectVersion},derivative:simple,private:true}),q.bytes);}
});
test('foreign origin/bucket/key, path injection, unsigned URL and caller credentials fail before I/O',async()=>{
 for(const change of [q=>({...q,target:{...q.target,projectOrigin:'https://other.supabase.co'}}),q=>({...q,target:{...q.target,bucket:'other'}}),...['/etc/passwd','managed-normalized/../object','managed-normalized/%2f/object'].map(key=>q=>({...q,target:{...q.target,key}})),q=>({...q,url:'https://attacker.invalid'}),q=>({...q,credential:'secret'}),q=>({...q,overwrite:true}),q=>({...q,private:false}),q=>({...q,target:{...q.target,key:'managed-derived/'+'a'.repeat(64)+'/object'}})]){const f=fixture();await assert.rejects(f.service.putImmutable(change(f.put)));assert.deepEqual(f.counts(),{creates:0,reads:0,grants:0});}
});
test('bytes/sha/length mismatch, extra descriptor and shared buffer fail before authorization',async()=>{
 for(const patch of [q=>({...q,bytes:Uint8Array.of(1)}),q=>({...q,output:{...q.output,sha256:'b'.repeat(64)}}),q=>({...q,output:{...q.output,byteLength:1}}),q=>({...q,output:{...q.output,verified:true}}),q=>({...q,bytes:new Uint8Array(new SharedArrayBuffer(q.bytes.length))})]){const f=fixture();await assert.rejects(f.service.putImmutable(patch(f.put)));assert.deepEqual(f.counts(),{creates:0,reads:0,grants:0});}
});
test('inclusive 8MiB source allowed; limit+1 rejected; derivative/output budgets are not enlarged',async()=>{
 const f=fixture({config:{timeoutMs:5000}}),b=new Uint8Array(IMAGE_UPLOAD_MAX_BYTES).fill(7),q={target:{...f.put.target,key:'managed-quarantine/'+'d'.repeat(64)+'/source'},source:{sha256:hash(b),byteLength:b.length,mime:'image/jpeg'},bytes:b,requestId:'boundary',private:true,overwrite:false};await f.service.putImmutable(q);
 const g=fixture();await assert.rejects(g.service.putImmutable({...q,source:{...q.source,byteLength:IMAGE_UPLOAD_MAX_BYTES+1}}));assert.equal(g.counts().creates,0);
 const h=fixture();await assert.rejects(h.service.putImmutable({...h.put,output:{...h.put.output,byteLength:524289}}));assert.equal(h.counts().creates,0);
});
test('mutable caller bytes and metadata are snapshotted before first await',async()=>{
 const gate=deferred(),entered=deferred();let first=true;const f=fixture({config:{authorize:async()=>{if(first){first=false;entered.resolve();await gate.promise;}return true;}}});
 const original=Uint8Array.from(f.put.bytes),target={...f.put.target};const op=f.service.putImmutable(f.put);await entered.promise;f.put.bytes.fill(99);f.put.output.sha256='f'.repeat(64);f.put.target.key='bad';gate.resolve();const ack=await op;assert.deepEqual(ack.target,target);assert.equal(ack.sha256,hash(original));assert.deepEqual(f.objects.get(target.key).bytes,original);
});
test('accessors/Proxies in config/methods/input/authorization are not executed',async()=>{
 let touched=0;const f=fixture();for(const c of [new Proxy(f.config,{ownKeys(){touched++;return [];}}),{...f.config,get authorize(){touched++;return async()=>true;}},{...f.config,authorize:new Proxy(async()=>true,{apply(){touched++;return true;}})},{...f.config,backend:{...f.backend,get createOnce(){touched++;return async()=>{};}}}])await assert.rejects(factory(c).putImmutable(f.put),{code:'PRIVATE_VERSIONED_DISABLED'});
 for(const q of [new Proxy(f.put,{ownKeys(){touched++;return [];}}),{...f.put,get bytes(){touched++;return new Uint8Array(1);}}])await assert.rejects(f.service.putImmutable(q));assert.equal(touched,0);
});
test('captured backend methods are not replaced through mutable config',async()=>{
 const f=fixture();f.backend.createOnce=()=>assert.fail('late method substitution');f.backend.readVersion=()=>assert.fail('late method substitution');f.config.authorize=()=>assert.fail('late auth substitution');await f.service.putImmutable(f.put);assert.equal(f.counts().creates,1);
});
test('permission denied pre-create is not sent; revoked after create is unknown with no retry/delete',async()=>{
 const f=fixture({config:{authorize:async()=>false}});await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_DENIED',outcome:'not_sent'});assert.equal(f.counts().creates,0);
 let grants=0;const g=fixture({config:{authorize:async()=>++grants===1}});await assert.rejects(g.service.putImmutable(g.put),{code:'PRIVATE_VERSIONED_UNCERTAIN'});assert.equal(g.counts().creates,1);await assert.rejects(g.service.putImmutable(g.put),{code:'PRIVATE_VERSIONED_BUSY'});assert.equal(g.objects.size,1);
});
test('read permission checked both before I/O and after data, stale result withheld',async()=>{
 const f=fixture();const ack=await f.service.putImmutable(f.put);let n=0;const reader=factory({...f.config,authorize:async()=>++n===1});await assert.rejects(reader.read({object:{...ack.target,version:ack.objectVersion},output:f.put.output,private:true}),{code:'PRIVATE_VERSIONED_DENIED'});assert.equal(n,2);
});
test('missing/native-version mismatch and object substitution never fall back to latest',async()=>{
 const f=fixture();const ack=await f.service.putImmutable(f.put);const q={object:{...ack.target,version:'not-the-native-version'},output:f.put.output,private:true};await assert.rejects(f.service.read(q));assert.equal(f.counts().creates,1);
 let cancelled=0;const g=fixture({backend:{async readVersion(q){return {object:{...q.object,version:'different'},private:true,mime:'image/png',body:new ReadableStream({cancel(){cancelled++;}})};}}});await assert.rejects(g.service.putImmutable(g.put),{code:'PRIVATE_VERSIONED_UNCERTAIN'});assert.equal(cancelled,1);
});
test('backend ACK requires created private exact native version; no fabricated ETag fallback',async()=>{
 for(const patch of [{version:undefined},{created:false},{private:false},{version:'"etag"'},{version:'../bad'},{extra:'private-log'}]){const f=fixture({backend:{async createOnce(q){return {target:q.target,version:'native-1',created:true,private:true,...patch};}}});await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_UNCERTAIN'});assert.equal(f.counts().reads,0);}
});
test('wrong bytes, MIME, short/long stream and excessive chunks cannot publish success',async()=>{
 const bodies=[()=>stream(Uint8Array.of(1)),f=>stream(new Uint8Array(f.put.bytes.length+1)),f=>new ReadableStream({start(c){for(let n=0;n<4096;n++)c.enqueue(Uint8Array.of(1));c.close();}})];
 for(const body of bodies){let f;f=fixture({backend:{async readVersion(q){return {object:q.object,private:true,mime:'image/png',body:body(f)};}}});await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_UNCERTAIN'});}
 const f=fixture({backend:{async readVersion(q){return {object:q.object,private:true,mime:'image/jpeg',body:stream(Uint8Array.of(1))};}}});await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_UNCERTAIN'});
});
test('chunk-count cap rejects a valid-length stream independently of byte cap',async()=>{
 let chunks=0,cancelled=0;const b=new Uint8Array(5000).fill(1),f=fixture({backend:{async readVersion(q){return {object:q.object,private:true,mime:'image/png',body:new ReadableStream({pull(c){chunks++;c.enqueue(Uint8Array.of(1));},cancel(){cancelled++;}})};}}});
 await assert.rejects(f.service.putImmutable({...f.put,bytes:b,output:{...f.put.output,byteLength:b.length,sha256:hash(b)}}),{code:'PRIVATE_VERSIONED_UNCERTAIN'});assert(chunks<5000);assert.equal(cancelled,1);
});
test('backend throw after possible create remains unknown; new call cannot resend',async()=>{
 let calls=0;const f=fixture({backend:{async createOnce(){calls++;throw Error('private backend credential/path');}}});await assert.rejects(f.service.putImmutable(f.put),e=>e.code==='PRIVATE_VERSIONED_UNCERTAIN'&&!e.message.includes('credential'));await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_BUSY'});assert.equal(calls,1);
});
test('concurrent calls bounded, timed-out PUT retains admission/buffer until late settlement, permanently poisoned',async()=>{
 const pending=deferred(),entered=deferred();let held;const f=fixture({config:{timeoutMs:20},backend:{async createOnce(q){held=q.bytes;entered.resolve();await pending.promise;return {target:q.target,version:'late-version',created:true,private:true};}}});
 const op=f.service.putImmutable(f.put);await entered.promise;await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_BUSY'});await assert.rejects(op,{code:'PRIVATE_VERSIONED_UNCERTAIN'});assert(held.some(x=>x!==0));await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_BUSY'});pending.resolve();await delay(10);assert(held.every(x=>x===0));await assert.rejects(f.service.putImmutable(f.put),{code:'PRIVATE_VERSIONED_BUSY'});assert.equal(f.counts().reads,0);
});
test('pre-abort denies all I/O; abort after dispatch is unknown, not cancelled/free',async()=>{
 const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.service.putImmutable({...f.put,signal:c.signal}),{code:'PRIVATE_VERSIONED_ABORTED'});assert.equal(f.counts().creates,0);
 const pending=deferred(),entered=deferred(),d=new AbortController();const g=fixture({backend:{async createOnce(q){entered.resolve();await pending.promise;return {target:q.target,version:'late',created:true,private:true};}}});const op=g.service.putImmutable({...g.put,signal:d.signal});await entered.promise;d.abort();await assert.rejects(op,{code:'PRIVATE_VERSIONED_UNCERTAIN'});pending.resolve();await delay(10);assert.equal(g.counts().reads,0);
});
test('late read stream is cancelled; timed-out read cannot overlap a second operation',async()=>{
 const pending=deferred();let cancelled=0;const f=fixture({config:{timeoutMs:20},backend:{async readVersion(q){await pending.promise;return {object:q.object,private:true,mime:'image/png',body:new ReadableStream({cancel(){cancelled++;}})};}}});const q={object:{...f.put.target,version:'v1'},output:f.put.output,private:true};await assert.rejects(f.service.read(q),{code:'PRIVATE_VERSIONED_TIMEOUT'});await assert.rejects(f.service.read(q),{code:'PRIVATE_VERSIONED_BUSY'});pending.resolve();await delay(10);assert.equal(cancelled,1);assert.equal(f.counts().creates,0);
});
test('dependency own error messages/accessor codes do not leak or execute',async()=>{
 for(const getter of [false,true]){let calls=0;const error=new ManagedPrivateVersionedStorageError();error.message='secret';if(getter)Object.defineProperty(error,'code',{get(){calls++;return 'private';}});else error.code='private';const f=fixture({config:{authorize:async()=>{throw error;}}});await assert.rejects(f.service.putImmutable(f.put),e=>e!==error&&e.message==='PRIVATE_VERSIONED_DENIED');assert.equal(calls,0);}
});
test('actual Stage33 store consumes adapter ACK/readback with original once-claim+publication guards',async()=>{
 const f=normalizedVerificationFixture(),io=fixture({config:{projectOrigin:f.sourceRecord.object.projectOrigin,bucket:f.sourceRecord.object.bucket}});let claims=0,guards=0,published;
 const repo={async claimPut(){return ++claims===1?'created':'already_claimed';},async guardPut(){guards++;return true;},async publishObject(q){published=q.receipt;return published;},async readObject(){return published;}};
 const service=createManagedNormalizedStore({enabled:true,repository:repo,storage:io.service,projectOrigin:f.sourceRecord.object.projectOrigin,bucket:f.sourceRecord.object.bucket,cost:{currency:'USD',maximumMinorUnits:1,maximumDispatches:1,commitment:'one_time'},timeoutMs:1000});
 const old=structuredClone(f.artifact),out=await service.put({credential:'SYNTHETIC_STORAGE_TOKEN_012345678901234',scope:f.scope,artifact:f.artifact,bytes:f.normalizedBytes});assert.deepEqual(out,{stored:true,artifactDigest:managedImageDigest(f.artifact)});assert.equal(claims,1);assert.equal(guards,2);assert.equal(io.counts().creates,1);assert.equal(io.counts().reads,2);assert.equal(published.object.version,'native-version-1');assert.equal(published.readbackVerified,true);assert.deepEqual(f.artifact,old);assert.equal(f.artifact.state,'pending_validation');
});
