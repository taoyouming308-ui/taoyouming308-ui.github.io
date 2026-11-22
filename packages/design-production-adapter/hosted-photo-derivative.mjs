/** Portable bounded PNG verifier for hosted output. The native inspector is
 * unchanged. An independent streaming DEFLATE decoder checks Adler, exact output
 * size and complete single-stream consumption even on Edge versions whose
 * node:zlib implementation ignores info/maxOutputLength. */
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {Inflate} from './vendor/pako-2.1.0.mjs';
function inflateExact(input,expected){
 const decoder=new Inflate({windowBits:15,chunkSize:4096}),state=decoder.strm.state;
 let raw=Buffer.alloc(expected),offset=0,delivered=false;const chunks=[];
 try{
  decoder.onData=chunk=>{chunks.push(chunk);if(offset+chunk.length>expected)throw Error();raw.set(chunk,offset);offset+=chunk.length;};
  if(!decoder.push(input,true)||decoder.err!==0||decoder.ended!==true||offset!==expected||decoder.strm.avail_in!==0||decoder.strm.total_in!==input.length||decoder.strm.total_out!==expected)throw Error();
  delivered=true;return {buffer:raw,consumedBytes:decoder.strm.total_in};
 }finally{
  if(!delivered)raw.fill(0);for(const chunk of chunks)chunk.fill(0);state?.window?.fill(0);decoder.strm.output?.fill(0);
 }
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('PHONE_PHOTO_PROCESSING_DENIED');};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();r[k]=d.value;}return r;}
function copy(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const p=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,get('byteOffset'),n));}
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
/** Exact format constructed by private-image-worker.py: single RGBA8 frame,
 * filter zero, IHDR/IDAT/IEND only, CRC and complete zlib input consumption.
 * Output is <= 128x128; this pure bounded inspection never decodes originals. */
export function inspectHostedPhotoDerivative(value){
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
  const decoded=inflateExact(compressed,expected);raw=decoded.buffer;
  if(raw.length!==expected||decoded.consumedBytes!==compressed.length)fail();
  const pixels=Buffer.alloc(width*height*4);
  try{for(let y=0;y<height;y++){const row=y*(width*4+1);if(raw[row]!==0)fail();raw.copy(pixels,y*width*4,row+1,row+1+width*4);}
   return Object.freeze({schemaVersion:'design-phone-derivative-inspection-v1',sha256:hash(b),byteLength:b.length,mime:'image/png',width,height,frameCount:1,pixelSha256:hash(pixels),metadataAbsent:true,compressedBytes:compressed.length,consumedCompressedBytes:decoded.consumedBytes});
  }finally{pixels.fill(0);}
 }catch{fail();}finally{b?.fill(0);compressed?.fill(0);raw?.fill(0);}
}
