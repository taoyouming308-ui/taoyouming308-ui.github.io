/** Separate general-phone processing boundary. Never fabricates a Stage40/41
 * synthetic strict task/report, model approval, employee confirmation or archive.
 * worker must be the separately qualified isolated service. The independent
 * bounded decoder below verifies only its tiny reconstructed output, not source
 * JPEG/WebP entropy consumption or the worker host's security. */
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {types} from 'node:util';
import {sniffPrivateImage,PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {validatePrivateImageContainer} from './private-image-decoder.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('PHONE_PHOTO_PROCESSING_DENIED');};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();r[k]=d.value;}return r;}
function copy(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const p=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,get('byteOffset'),n));}
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
/** Exact format constructed by private-image-worker.py: single RGBA8 frame,
 * filter zero, IHDR/IDAT/IEND only, CRC and complete zlib input consumption.
 * Output is <= 128x128; this pure bounded inspection never decodes originals. */
export function inspectPhonePhotoDerivative(value){
 let b,compressed,raw;
 try{
  b=copy(value,96*1024);if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
  let at=8,width,height,phase=0;const parts=[];
  while(at<b.length){
   if(at+12>b.length)fail();const n=b.readUInt32BE(at),end=at+12+n;if(end>b.length)fail();
   const kind=b.toString('latin1',at+4,at+8),data=b.subarray(at+8,end-4);
   if(crc(b.subarray(at+4,end-4))!==b.readUInt32BE(end-4))fail();
   if(kind==='IHDR'){
    if(phase||at!==8||n!==13||data[8]!==8||data[9]!==6||data[10]||data[11]||data[12])fail();
    width=data.readUInt32BE(0);height=data.readUInt32BE(4);if(width<1||height<1||width>128||height>128)fail();phase=1;
   }else if(kind==='IDAT'){if(phase!==1||!n||parts.length>=16)fail();parts.push(data);}
   else if(kind==='IEND'){if(phase!==1||!parts.length||n||end!==b.length)fail();phase=2;}
   else fail();at=end;
  }
  if(phase!==2)fail();compressed=Buffer.concat(parts);const expected=(width*4+1)*height;
  const decoded=inflateSync(compressed,{info:true,maxOutputLength:expected});raw=decoded.buffer;
  if(raw.length!==expected||decoded.engine.bytesWritten!==compressed.length)fail();
  const pixels=Buffer.alloc(width*height*4);
  try{for(let y=0;y<height;y++){const row=y*(width*4+1);if(raw[row]!==0)fail();raw.copy(pixels,y*width*4,row+1,row+1+width*4);}
   return Object.freeze({schemaVersion:'design-phone-derivative-inspection-v1',sha256:hash(b),byteLength:b.length,mime:'image/png',width,height,frameCount:1,pixelSha256:hash(pixels),metadataAbsent:true,compressedBytes:compressed.length,consumedCompressedBytes:decoded.engine.bytesWritten});
  }finally{pixels.fill(0);}
 }catch{fail();}finally{b?.fill(0);compressed?.fill(0);raw?.fill(0);}
}
export function createPhonePhotoProcessor({enabled=false,worker,authorize,timeoutMs=30000}={}){
 let busy=false;
 return Object.freeze({async process(input){
  if(enabled!==true)throw Error('PHONE_PHOTO_PROCESSING_DISABLED');if(busy)throw Error('PHONE_PHOTO_PROCESSING_BUSY');
  let source,derived,timer,listener,delivered=false;const abort=new AbortController();
  const q=exact(input,['bytes','signal']);
  if(!(q.signal instanceof AbortSignal)||q.signal.aborted||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();busy=true;
  const stopped=new Promise((_,reject)=>{listener=()=>{abort.abort();reject(Error('PHONE_PHOTO_PROCESSING_DENIED'));};q.signal.addEventListener('abort',listener,{once:true});timer=setTimeout(listener,timeoutMs);});
  const work=(async()=>{try{
   if(typeof worker?.process!=='function'||typeof authorize!=='function')fail();
   source=copy(q.bytes,PRIVATE_MEDIA_MAX_BYTES);const mime=sniffPrivateImage(source);validatePrivateImageContainer(source,mime);
   const content=Object.freeze({sha256:hash(source),byteLength:source.length,mime});
   const guard=async phase=>{if(abort.signal.aborted||await authorize(Object.freeze({phase,content,signal:abort.signal}))!==true||abort.signal.aborted)fail();};
   await guard('before_processing');
   const result=exact(await worker.process(source),['source','derivative']);
   const s=exact(result.source,['mime','width','height','frameCount','decoded']),d=exact(result.derivative,['bytes','mime','sourceSha256','metadataRemoved']);
   // Clear our owned copies; never change the caller's original or a buffer
   // retained by a separately supervised worker. Returned bytes stay private.
   derived=copy(d.bytes,96*1024);
   if(s.mime!==mime||s.frameCount!==1||s.decoded!==true||![s.width,s.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384)||s.width*s.height>40000000||d.mime!=='image/png'||d.sourceSha256!==content.sha256||d.metadataRemoved!==true)fail();
   const inspection=inspectPhonePhotoDerivative(derived);
   await guard('before_delivery');
   return Object.freeze({schemaVersion:'design-phone-photo-processing-v1',source:Object.freeze({...content,width:s.width,height:s.height,frameCount:1}),derivative:Object.freeze({bytes:Uint8Array.from(derived),inspection}),modelSubmissionAuthorized:false,adoptionAuthorized:false,publicEligible:false});
  }catch{fail();}finally{source?.fill(0);derived?.fill(0);busy=false;}})();
  // A stalled dependency keeps admission until it settles. A timeout/abort does
  // not claim that a separately supervised native job was physically cancelled.
  try{const value=await Promise.race([work,stopped]);delivered=true;return value;}
  finally{clearTimeout(timer);q.signal.removeEventListener('abort',listener);abort.abort();if(!delivered)void work.then(v=>v?.derivative?.bytes?.fill(0),()=>{});}
 }});
}
