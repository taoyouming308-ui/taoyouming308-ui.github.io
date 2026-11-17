import test from 'node:test';import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {inspectPhonePhotoDerivative,createPhonePhotoProcessor} from '../packages/design-production-adapter/phone-photo-processing.mjs';
import {canonicalProducerSeeds} from './fixtures/canonical-producer-seeds.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
function chunk(kind,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(kind,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function png({width=2,height=3,metadata=false,trailing=false,unused=false,filter=0,bomb=false}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(bomb?100000:(width*4+1)*height,13);for(let y=0;y<height;y++)rows[y*(width*4+1)]=filter;let compressed=deflateSync(rows);if(unused)compressed=Buffer.concat([compressed,Buffer.from('unused')]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(metadata?[chunk('tEXt',Buffer.from('private metadata'))]:[]),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0)),...(trailing?[Buffer.from('trailing')]:[])]);}
const signal=()=>new AbortController().signal;
function setup(extra={}){let calls=0;const worker={async process(bytes){calls++;return {source:{mime:canonicalProducerSeeds().mime,width:3024,height:4032,frameCount:1,decoded:true},derivative:{bytes:png(),mime:'image/png',sourceSha256:hash(bytes),metadataRemoved:true}};}};return {processor:createPhonePhotoProcessor({enabled:true,worker,authorize:async()=>true,...extra}),calls:()=>calls,worker};}
test('independent full pixel decode consumes exact zlib and rejects metadata/CRC/truncation/animation-like extra chunks/bombs',()=>{
 const value=png(),m=inspectPhonePhotoDerivative(value);assert.equal(m.width,2);assert.equal(m.height,3);assert.equal(m.consumedCompressedBytes,m.compressedBytes);assert.equal(m.pixelSha256,hash(Buffer.alloc(24,13)));
 const corrupt=Buffer.from(value);corrupt[corrupt.length-1]^=1;
 for(const bad of [corrupt,value.subarray(0,-1),png({metadata:true}),png({trailing:true}),png({unused:true}),png({filter:1}),png({bomb:true}),png({width:129}),Buffer.alloc(96*1024+1)])assert.throws(()=>inspectPhonePhotoDerivative(bad),/PHONE_PHOTO_PROCESSING_DENIED/);
 assert.deepEqual(value,png());
});
test('default off, explicit before/final authorization, separate general-photo schema and no synthetic/model grant',async()=>{
 await assert.rejects(createPhonePhotoProcessor().process(null),/DISABLED/);let phases=[];
 const f=setup({authorize:async q=>{phases.push(q.phase);assert.equal(q.content.sha256,hash(canonicalProducerSeeds().sourceBytes));return true;}}),source=canonicalProducerSeeds().sourceBytes,copy=Buffer.from(source);
 const result=await f.processor.process({bytes:source,signal:signal()});assert.deepEqual(Buffer.from(source),copy);assert.equal(f.calls(),1);assert.deepEqual(phases,['before_processing','before_delivery']);assert.equal(result.schemaVersion,'design-phone-photo-processing-v1');assert.equal(result.modelSubmissionAuthorized,false);assert.equal(result.adoptionAuthorized,false);assert.equal(result.publicEligible,false);assert.deepEqual(Buffer.from(result.derivative.bytes),png());
});
test('source size/magic/container framing and final revocation deny; no caller policy or getters accepted',async()=>{
 let seen=0;const f=setup({authorize:async()=>++seen===1});await assert.rejects(f.processor.process({bytes:canonicalProducerSeeds().sourceBytes,signal:signal()}));assert.equal(f.calls(),1);
 const g=setup();let getters=0;for(const input of [null,{bytes:Buffer.alloc(8*1024*1024+1),signal:signal()},{bytes:Buffer.from('HEIC unsupported'),signal:signal()},{bytes:Buffer.concat([canonicalProducerSeeds().sourceBytes,Buffer.from('trailing')]),signal:signal()},{bytes:canonicalProducerSeeds().sourceBytes,signal:signal(),policy:{}},{get bytes(){getters++;},signal:signal()}])await assert.rejects(g.processor.process(input));assert.equal(getters,0);assert.equal(g.calls(),0);
});
test('exact source binding and independent derivative validation reject a compromised worker result',async()=>{
 for(const mutate of [r=>r.derivative.sourceSha256='0'.repeat(64),r=>r.derivative.bytes=png({metadata:true}),r=>r.source.frameCount=2,r=>r.source.width=50000]){
  const f=setup(),bad={async process(b){const r=await f.worker.process(b);mutate(r);return r;}};await assert.rejects(setup({worker:bad}).processor.process({bytes:canonicalProducerSeeds().sourceBytes,signal:signal()}));
 }
});
test('abort/timeout withholds late result and retains admission for a stalled worker',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r),f=setup();const worker={async process(b){entered();await hold;return f.worker.process(b);}};
 const p=setup({worker,timeoutMs:20}).processor,input={bytes:canonicalProducerSeeds().sourceBytes,signal:signal()};const pending=p.process(input);await ready;await assert.rejects(pending,/DENIED/);await assert.rejects(p.process(input),/BUSY/);release();await new Promise(r=>setImmediate(r));
 const c=new AbortController();c.abort();await assert.rejects(setup().processor.process({bytes:input.bytes,signal:c.signal}));
});
