import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHostedHeifCodec,inspectHostedJpeg,HOSTED_HEIF_LIMITS} from '../packages/design-production-adapter/hosted-heif-codec.mjs';
import {inspectPhonePhotoDerivative} from '../packages/design-production-adapter/phone-photo-processing.mjs';
import {inspectHostedPhotoDerivative} from '../packages/design-production-adapter/hosted-photo-derivative.mjs';
import {deflateSync,inflateSync} from 'node:zlib';
import decodeJpeg from '../packages/design-production-adapter/vendor/jpeg-decoder-0.4.4.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/hosted-heif-synthetic.json',import.meta.url),'utf8'));
const bytes=name=>{const r=fixture.samples.find(r=>r.name===name),b=Buffer.from(r.base64,'base64');assert.equal(b.length,r.byteLength);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);return b;};
const run=(codec,b=bytes('phone.heif'),signal=new AbortController().signal)=>codec.normalize(b,{signal});
const codec=opts=>createHostedHeifCodec({enabled:true,authorize:async()=>true,...opts});
const orientationFixture=JSON.parse(await readFile(new URL('./fixtures/hosted-heif-orientations.json',import.meta.url),'utf8'));
async function checkOrientation(sample,layout,dimensions){
 const b=Buffer.from(sample.base64,'base64');assert.equal(b.length,sample.byteLength);assert.equal(createHash('sha256').update(b).digest('hex'),sample.sha256);
 const r=await run(codec(),b);let image;
 try{
  assert.deepEqual([r.normalized.width,r.normalized.height],dimensions);
  image=decodeJpeg(r.normalized.bytes,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:0.1,maxMemoryUsageInMB:8});
  const colors=[[230,20,20],[20,210,20],[20,20,230],[230,210,20]];
  for(const [i,[x,y]]of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].entries()){
   const at=(Math.floor(image.height*y)*image.width+Math.floor(image.width*x))*4,want=colors[layout[i]];
   for(let c=0;c<3;c++)assert.ok(Math.abs(image.data[at+c]-want[c])<20,'independently encoded HEIF quadrant has the expected orientation');
  }
  assert.equal(r.independentVerification.metadataAbsent,true);
 }finally{image?.data.fill(0);r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);}
}
test('HEIF container rotation and mirroring preserve all eight independently encoded directions',async()=>{
 const layouts={1:[0,1,2,3],2:[1,0,3,2],3:[3,2,1,0],4:[2,3,0,1],5:[0,2,1,3],6:[2,0,3,1],7:[3,1,2,0],8:[1,3,0,2]};
 for(const sample of orientationFixture.samples.filter(s=>s.kind==='heif-container'))await checkOrientation(sample,layouts[sample.orientation],sample.orientation>=5?[96,64]:[64,96]);
});
test('descriptive EXIF without HEIF transform is not incorrectly treated as JPEG orientation',async()=>{
 await checkOrientation(orientationFixture.samples.find(s=>s.kind==='descriptive-exif-only'),[0,1,2,3],[64,96]);
});
test('hosted codec is closed by default and requires a real processing authorizer/signal',async()=>{
 await assert.rejects(run(createHostedHeifCodec()),/DISABLED/);
 await assert.rejects(run(createHostedHeifCodec({enabled:true})),/DENIED/);
 await assert.rejects(codec().normalize(bytes('phone.heif')),/DENIED/);
});
test('generic HEIF becomes bounded entropy-verified metadata-free preview and independent PNG',async()=>{
 const b=bytes('phone.heif'),copy=Buffer.from(b),phases=[];
 const r=await run(codec({authorize:async q=>{phases.push(q.phase);assert.equal(q.content.sha256,fixture.samples[0].sha256);return true;}}),b);
 try{
  assert.deepEqual(b,copy);assert.deepEqual(phases,['before_processing','before_delivery']);
  assert.equal(r.source.mime,'image/heif');assert.equal(r.source.width,4032);assert.equal(r.source.height,3024);
  assert.deepEqual([r.normalized.width,r.normalized.height],[768,576]);
  assert.ok(r.normalized.byteLength<=HOSTED_HEIF_LIMITS.previewBytes);
  assert.deepEqual(inspectHostedJpeg(r.normalized.bytes),r.independentVerification);
  const tiny=inspectPhonePhotoDerivative(r.derivative.bytes);assert.deepEqual([tiny.width,tiny.height],[108,81]);assert.equal(tiny.metadataAbsent,true);
  assert.deepEqual(inspectHostedPhotoDerivative(r.derivative.bytes),tiny);assert.deepEqual(r.derivativeInspection,tiny);
  assert.equal(r.modelSubmissionAuthorized,false);assert.equal(r.publicEligible,false);
 }finally{r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);}
});
test('portable PNG verification denies trailing/concatenated zlib, bad Adler and excessive output',async()=>{
 const r=await run(codec(),bytes('phone-10bit.heic'));
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);b.set(data,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};
 try{
  const b=Buffer.from(r.derivative.bytes),original=Buffer.from(b),parts=[];let at=8;
  while(at<b.length){const n=b.readUInt32BE(at),kind=b.toString('ascii',at+4,at+8);parts.push({kind,data:b.subarray(at+8,at+8+n)});at+=n+12;}
  const compressed=parts.find(p=>p.kind==='IDAT').data,raw=inflateSync(compressed),adler=Buffer.from(compressed);adler[adler.length-1]^=1;
  const wrap=data=>Buffer.concat([b.subarray(0,8),...parts.map(p=>chunk(p.kind,p.kind==='IDAT'?data:p.data))]);
  const badFilter=Buffer.from(raw);badFilter[0]=1;
  for(const bad of [wrap(Buffer.concat([compressed,Buffer.from([0])])),wrap(Buffer.concat([compressed,deflateSync(Buffer.alloc(0))])),wrap(compressed.subarray(0,-1)),wrap(adler),wrap(deflateSync(Buffer.alloc(1024*1024))),wrap(deflateSync(badFilter)),Buffer.concat([b,Buffer.from([0])]),Buffer.concat([b.subarray(0,33),chunk('tEXt',Buffer.from('location=private')),b.subarray(33)])])assert.throws(()=>inspectHostedPhotoDerivative(bad),/DENIED/);
  assert.deepEqual(b,original);assert.deepEqual(inspectHostedPhotoDerivative(b),inspectPhonePhotoDerivative(b));
 }finally{r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);}
});
test('10-bit HEIC actually decodes; no extension renaming or browser converter',async()=>{
 const r=await run(codec(),bytes('phone-10bit.heic'));
 try{assert.equal(r.source.mime,'image/heic');assert.equal(r.source.decoded,true);assert.ok(r.independentVerification.decoded);}finally{r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);}
});
test('multi-image HEIC is rejected before pixel publication and next job succeeds',async()=>{
 const c=codec();await assert.rejects(run(c,bytes('multi.heic')),/DENIED/);
 const r=await run(c,bytes('phone-10bit.heic'));r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);
});
test('revocation or abort at final gate withholds every output',async()=>{
 await assert.rejects(run(codec({authorize:async q=>q.phase==='before_processing'})),/DENIED/);
 const controller=new AbortController();
 await assert.rejects(run(codec({authorize:async q=>{if(q.phase==='before_delivery')controller.abort();return true;}}),bytes('phone.heif'),controller.signal),/DENIED/);
});
test('initial denial, pre-abort and invalid bytes cannot enter decoding',async()=>{
 await assert.rejects(run(codec({authorize:async()=>false})),/DENIED/);
 const stopped=new AbortController();stopped.abort();await assert.rejects(run(codec(),bytes('phone.heif'),stopped.signal),/DENIED/);
 for(const b of [new Uint8Array(0),new Uint8Array(HOSTED_HEIF_LIMITS.sourceBytes+1),bytes('phone.heif').subarray(0,50),new Uint8Array(new SharedArrayBuffer(100))])await assert.rejects(run(codec(),b),/DENIED/);
 await assert.rejects(run(codec(),new Proxy(bytes('phone.heif'),{})),/DENIED/);
});
test('one admission spans all factories and remains locked while authorization is pending',async()=>{
 let release,entered;const pending=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const first=run(codec({authorize:async()=>{entered();await pending;return false;}}));await ready;
 await assert.rejects(run(codec()),/BUSY/);release();await assert.rejects(first,/DENIED/);
 const r=await run(codec(),bytes('phone-10bit.heic'));r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);
});
test('JPEG inspector rejects EXIF, comments, trailing images, truncation and mutated dimensions',async()=>{
 const r=await run(codec(),bytes('phone-10bit.heic'));
 try{
  const b=r.normalized.bytes;
  const exif=Buffer.concat([b.subarray(0,2),Buffer.from([255,225,0,8,69,120,105,102,0,0]),b.subarray(2)]);
  const comment=Buffer.concat([b.subarray(0,2),Buffer.from([255,254,0,4,65,65]),b.subarray(2)]);
  const huge=Buffer.from(b),at=huge.indexOf(Buffer.from([255,192]));assert.ok(at>0);huge[at+5]=255;huge[at+6]=255;
  for(const bad of [exif,comment,Buffer.concat([b,b]),b.subarray(0,-1),huge])assert.throws(()=>inspectHostedJpeg(bad),/DENIED/);
 }finally{r.normalized.bytes.fill(0);r.derivative.bytes.fill(0);}
});
