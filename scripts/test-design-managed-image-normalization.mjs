/** Protocol-only synthetic callbacks. NOT real decode/metadata attestation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createManagedImageNormalization,stripNormalizationPngDensity} from '../packages/design-production-adapter/managed-image-normalization.mjs';
import {managedImageDigest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const sha=b=>createHash('sha256').update(b).digest('hex');
const crc32=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
const chunk=(kind,data)=>{const a=Buffer.alloc(data.length+12);a.writeUInt32BE(data.length);a.write(kind,4);data.copy(a,8);a.writeUInt32BE(crc32(a.subarray(4,a.length-4)),a.length-4);return a;};
function png(width=1024,height=682,{density=false,extra=null}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(density?[chunk('pHYs',Buffer.from([0,0,11,19,0,0,11,19,1]))]:[]),...(extra?[chunk(extra,Buffer.alloc(0))]:[]),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
function fixture(overrides={}){
 const f=managedImageResultFixture(),parentBytes=Buffer.from('mock JPEG with EXIF'),pngBytes=png();
 const parentResponse=structuredClone(f.response);parentResponse.descriptor.derivative={sha256:sha(parentBytes),byteLength:parentBytes.length,mime:'image/jpeg'};
 const parentObjectReceipt={...structuredClone(f.objectReceipt),responseDigest:managedImageDigest(parentResponse),derivative:structuredClone(parentResponse.descriptor.derivative)};
 const input={credential:'synthetic-fixture-token',scope:f.scope,mediaId:f.sourceRecord.mediaId,parentRequestId:parentResponse.descriptor.requestId,requestId:'normalize-1',signal:null};
 const reads={sourceRecord:f.sourceRecord,parentResponse,parentObjectReceipt,parentBytes};
 const count={claim:0,decode:0,inspect:0,consume:0},phases=[],claims=new Set();let borrowed;
 const parentInspector=async q=>({fullyDecoded:true,frameCount:1,orientation:'identity',profile:'absent',containerValid:true,trailingDataAbsent:true,...q.expected});
 const deps={enabled:true,timeoutMs:1000,readInputs:async()=>reads,authorize:async q=>{phases.push(q.phase);return true;},claim:async q=>{count.claim++;if(claims.has(q.requestId))return false;claims.add(q.requestId);return true;},runtime:{normalizePng:async q=>{count.decode++;borrowed=q.parentBytes;return pngBytes;}},inspector:{inspectParent:parentInspector,verifyNormalization:async q=>{count.inspect++;return {containerValid:true,trailingDataAbsent:true,unknownChunksAbsent:true,fullyDecoded:true,frameCount:1,parentOrientation:'identity',metadataAbsent:true,pixelsEqual:true,...q.expected};}},consume:async()=>{count.consume++;return true;},...overrides};
 if(overrides.inspector)deps.inspector={inspectParent:parentInspector,...overrides.inspector};
 return {input,reads,parentBytes,pngBytes,count,phases,deps,make:()=>createManagedImageNormalization(deps),borrowed:()=>borrowed};
}
const rejects=(f,code)=>assert.rejects(f,e=>e.code===code);
test('disabled by default and missing true dependencies closed',async()=>{
 const f=fixture();await rejects(()=>createManagedImageNormalization().normalize(f.input),'NORMALIZATION_DISABLED');
 await rejects(()=>createManagedImageNormalization({...f.deps,consume:null}).normalize(f.input),'NORMALIZATION_DISABLED');
});
test('new pending artifact binds unchanged parent and fresh guards; no persistence or verification claim',async()=>{
 const f=fixture(),old=structuredClone(f.reads.parentResponse),a=await f.make().normalize(f.input);
 assert.equal(a.state,'pending_validation');assert.equal(a.output.sha256,sha(f.pngBytes));assert.notEqual(a.output.sha256,a.parentObjectReceipt.derivative.sha256);
 assert.equal(a.output.mime,'image/png');assert(Object.values(a.validation).every(x=>x==='not_verified'));
 assert.equal(a.submissionAuthorized,false);assert.deepEqual(f.reads.parentResponse,old);assert.equal(f.parentBytes.toString(),'mock JPEG with EXIF');assert(f.borrowed().every(x=>x===0));
 assert.deepEqual(f.phases,['before_normalize','claimed_before_decode','parent_inspected_before_decode','after_normalize','before_consume','return']);
});
test('durable claim dependency rejects same request across fresh instances',async()=>{
 const f=fixture();await f.make().normalize(f.input);await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_DENIED');assert.equal(f.count.decode,1);
});
test('current authorization before and after claim prevents decoder execution',async()=>{
 for(const phase of ['before_normalize','claimed_before_decode']){const f=fixture({authorize:async q=>q.phase!==phase});await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_DENIED');assert.equal(f.count.decode,0);}
});
test('revocation after decoding prevents consume; final return revoke denies completed handoff',async()=>{
 for(const phase of ['after_normalize','before_consume','return']){const f=fixture({authorize:async q=>q.phase!==phase});await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_DENIED');assert.equal(f.count.consume,phase==='return'?1:0);}
});
test('scope, media and parent request mismatch reject before claim',async()=>{
 for(const patch of [{mediaId:'another'},{parentRequestId:'another'},{scope:{customerProfileId:'12',visitId:'booking:101',assignmentSource:'appointment'}}]){const f=fixture();await rejects(()=>f.make().normalize({...f.input,...patch}),'NORMALIZATION_BINDING_MISMATCH');assert.equal(f.count.claim,0);}
});
test('actual parent bytes must match exact old private receipt',async()=>{
 const f=fixture();f.reads.parentBytes=Buffer.from('substituted');await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_BINDING_MISMATCH');assert.equal(f.count.decode,0);
});
test('PNG over budget rejects without inspection, consume or automatic retry',async()=>{
 const f=fixture({runtime:{normalizePng:async()=>Buffer.alloc(262166)}}),n=f.make();await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUDGET_EXCEEDED');assert.equal(f.count.inspect,0);assert.equal(f.count.consume,0);await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUSY');
});
test('independent inspector must fully decode exact pixels, metadata, orientation and geometry',async()=>{
 for(const patch of [{containerValid:false},{trailingDataAbsent:false},{unknownChunksAbsent:false},{fullyDecoded:false},{frameCount:2},{parentOrientation:'rotate90'},{metadataAbsent:false},{pixelsEqual:false},{width:1},{height:1}]){const f=fixture({inspector:{verifyNormalization:async q=>({containerValid:true,trailingDataAbsent:true,unknownChunksAbsent:true,fullyDecoded:true,frameCount:1,parentOrientation:'identity',metadataAbsent:true,pixelsEqual:true,...q.expected,...patch})}});await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_INSPECTION_FAILED');assert.equal(f.count.consume,0);}
});
test('inspector cannot mutate lent bytes then approve original hash',async()=>{
 const f=fixture({inspector:{verifyNormalization:async q=>{q.pngBytes[0]^=1;return {containerValid:true,trailingDataAbsent:true,unknownChunksAbsent:true,fullyDecoded:true,frameCount:1,parentOrientation:'identity',metadataAbsent:true,pixelsEqual:true,...q.expected};}}});await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_BINDING_MISMATCH');assert.equal(f.count.consume,0);
});
test('unknown claim or consumer result poisons instance and never retries',async()=>{
 for(const override of [{claim:async()=>{throw Error('private database details');}},{consume:async()=>{throw Error('private store details');}}]){const f=fixture(override),n=f.make();await rejects(()=>n.normalize(f.input),'NORMALIZATION_UNCERTAIN');await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUSY');}
});
test('timeout holds pending work and prevents growing buffers/reentry',async()=>{
 let resolve;const f=fixture({timeoutMs:10,runtime:{normalizePng:()=>new Promise(r=>resolve=r)}}),n=f.make();await rejects(()=>n.normalize(f.input),'NORMALIZATION_TIMEOUT');await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUSY');resolve(Buffer.from('late'));await new Promise(r=>setTimeout(r,0));await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUSY');assert.equal(f.count.consume,0);
});
test('pre-abort causes no reads or claims',async()=>{const f=fixture(),c=new AbortController();c.abort();await rejects(()=>f.make().normalize({...f.input,signal:c.signal}),'NORMALIZATION_ABORTED');assert.equal(f.count.claim,0);});
test('getters/proxies and shared binary memory are rejected without getter invocation',async()=>{
 const f=fixture();let calls=0;const q={...f.input};Object.defineProperty(q,'scope',{enumerable:true,get(){calls++;return f.input.scope;}});await rejects(()=>f.make().normalize(q),'NORMALIZATION_INVALID');assert.equal(calls,0);
 f.reads.parentBytes=new Uint8Array(new SharedArrayBuffer(20));await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_BUDGET_EXCEEDED');
});

test('PNG density removed structurally with new hash; only known RGB static framing allowed',()=>{const raw=png(10,10,{density:true}),clean=stripNormalizationPngDensity(raw,{width:10,height:10,maximumBytes:262144});assert(!clean.includes(Buffer.from('pHYs')));assert.notEqual(sha(raw),sha(clean));assert.deepEqual(clean,png(10,10));});
test('unknown/APNG chunks, CRC corruption, truncation, trailing/polyglot and wrong dimensions reject',()=>{const valid=png(10,10),bad=Buffer.from(valid);bad[bad.length-1]^=1;for(const b of [bad,valid.subarray(0,valid.length-1),Buffer.concat([valid,Buffer.from('<html>')]),png(10,10,{extra:'acTL'}),png(10,10,{extra:'tEXt'}),png(11,10)])assert.throws(()=>stripNormalizationPngDensity(b,{width:10,height:10,maximumBytes:262144}));});

test('parent preflight rejects animation, rotation, unknown profile or trailing before normalize',async()=>{for(const patch of [{frameCount:2},{orientation:'rotate90'},{profile:'unrecognized'},{trailingDataAbsent:false}]){const f=fixture({inspector:{inspectParent:async q=>({fullyDecoded:true,frameCount:1,orientation:'identity',profile:'absent',containerValid:true,trailingDataAbsent:true,...q.expected,...patch}),verifyNormalization:async()=>{throw Error('unreachable');}}});await rejects(()=>f.make().normalize(f.input),'NORMALIZATION_INSPECTION_FAILED');assert.equal(f.count.decode,0);assert.equal(f.count.consume,0);}});

test('high-bit chunk name cannot alias an allowed ASCII marker',()=>{const b=png(10,10);b[15]|=128;b.writeUInt32BE(crc32(b.subarray(12,29)),29);assert.throws(()=>stripNormalizationPngDensity(b,{width:10,height:10,maximumBytes:262144}));});

test('post-consume revocation/timeout reports uncertain without exposing artifact and never retries',async()=>{
 for(const mode of ['revoke','timeout']){let resolve;const f=fixture({timeoutMs:20,authorize:async q=>{if(q.phase==='return')return mode==='revoke'?false:new Promise(r=>resolve=r);return true;}}),n=f.make();await assert.rejects(()=>n.normalize(f.input),e=>e.outcome==='uncertain'&&!Object.hasOwn(e,'artifact')&&(e.code==='NORMALIZATION_DENIED'||e.code==='NORMALIZATION_TIMEOUT'));assert.equal(f.count.consume,1);await rejects(()=>n.normalize(f.input),'NORMALIZATION_BUSY');if(resolve)resolve(true);}
 const f=fixture({authorize:async()=>false});await assert.rejects(()=>f.make().normalize(f.input),e=>e.outcome==='not_sent');assert.equal(f.count.consume,0);
});
