/** Default-closed WASM alternative, not the qualified native worker factory.
 * No network, environment, database, storage, logging or model calls. Caller
 * supplies processing authority; upload/view/storage permissions remain separate.
 * The hosting isolate must enforce memory/CPU termination independently. */
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {deflateSync} from 'node:zlib';
import {validateHeifContainer} from '../shared/phone-image-types.mjs';
import encodeJpeg from './vendor/jpeg-encoder-0.4.4.mjs';
import decodeJpeg from './vendor/jpeg-decoder-0.4.4.mjs';
import {inspectHostedPhotoDerivative} from './hosted-photo-derivative.mjs';

export const HOSTED_HEIF_LIMITS=Object.freeze({sourceBytes:8388608,pixels:12582912,edge:8192,previewEdge:768,previewBytes:524288,derivativeEdge:108});
const fail=()=>{throw Error('HOSTED_HEIF_DENIED');};
// Node-compatible Edge hashing rejects Uint8ClampedArray on some runtimes.
const sha=b=>createHash('sha256').update(new Uint8Array(b.buffer,b.byteOffset,b.byteLength)).digest('hex');
let busy=false;
function ownBytes(input,max){
 if(types.isProxy(input)||!types.isUint8Array(input))fail();
 const p=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(p,k).get.call(input),buffer=get('buffer'),n=get('byteLength');
 if(types.isSharedArrayBuffer(buffer)||n<1||n>max)fail();
 return new Uint8Array(new Uint8Array(buffer,get('byteOffset'),n));
}
/** Only our baseline, single-scan JFIF encoder output. Reject metadata,
 * progressive/multi-frame data, concatenation, unknown markers and trailing
 * bytes before passing the bounded JPEG to a separate entropy decoder. */
export function inspectHostedJpeg(input){
 let b,pixels;
 try{
  b=ownBytes(input,HOSTED_HEIF_LIMITS.previewBytes);
  if(b[0]!==255||b[1]!==216)fail();
  let at=2,width=0,height=0,frame=0,scan=0,ended=false,jfif=0;
  while(at<b.length){
   if(b[at++]!==255)fail();const marker=b[at++];
   if(marker===217){if(!scan||at!==b.length)fail();ended=true;break;}
   if(![224,219,192,196,218].includes(marker)||at+2>b.length)fail();
   const n=(b[at]<<8)|b[at+1],end=at+n;if(n<2||end>b.length||scan)fail();
   if(marker===224){if(jfif++||at!==4||n!==16||!b.subarray(at+2,end).every((v,i)=>v===[74,70,73,70,0,1,1,0,0,1,0,1,0,0][i]))fail();}
   if(marker===192){if(frame++||n!==17||b[at+2]!==8||b[at+7]!==3)fail();height=(b[at+3]<<8)|b[at+4];width=(b[at+5]<<8)|b[at+6];}
   at=end;
   if(marker===218){if(scan++||frame!==1||jfif!==1||n!==12)fail();
    while(at<b.length){if(b[at++]!==255)continue;const v=b[at];if(v===0){at++;continue;}if(v!==217)fail();at--;break;}
   }
  }
  if(!ended||width<1||height<1||width>HOSTED_HEIF_LIMITS.previewEdge||height>HOSTED_HEIF_LIMITS.previewEdge)fail();
  const decoded=decodeJpeg(b,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:0.6,maxMemoryUsageInMB:32});pixels=decoded.data;
  if(decoded.width!==width||decoded.height!==height||pixels.length!==width*height*4||decoded.exifBuffer||decoded.comments)fail();
  return Object.freeze({sha256:sha(b),width,height,mime:'image/jpeg',frameCount:1,decoded:true,metadataAbsent:true,pixelSha256:sha(pixels)});
 }catch{fail();}finally{b?.fill(0);pixels?.fill(0);}
}
function resize(source,width,height,edge){
 const scale=Math.min(1,edge/width,edge/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 const data=new Uint8Array(w*h*4);
 // Bounded bilinear sampling; flatten alpha onto white for both derivatives.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const fx=Math.max(0,Math.min(width-1,(x+0.5)*width/w-0.5)),fy=Math.max(0,Math.min(height-1,(y+0.5)*height/h-0.5)),x0=Math.floor(fx),y0=Math.floor(fy),dx=fx-x0,dy=fy-y0;
  const indices=[(y0*width+x0)*4,(y0*width+Math.min(x0+1,width-1))*4,(Math.min(y0+1,height-1)*width+x0)*4,(Math.min(y0+1,height-1)*width+Math.min(x0+1,width-1))*4],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy],to=(y*w+x)*4;
  for(let c=0;c<3;c++){let v=0;for(let i=0;i<4;i++){const alpha=source[indices[i]+3]/255;v+=(source[indices[i]+c]*alpha+255*(1-alpha))*weights[i];}data[to+c]=Math.round(v);}data[to+3]=255;
 }
 return {data,width:w,height:h};
}
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
function png(image){
 const chunk=(type,data)=>{const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);out.write(type,4,'ascii');out.set(data,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;};
 let raw,compressed,combined;const parts=[];
 try{
  const header=Buffer.alloc(13);header.writeUInt32BE(image.width);header.writeUInt32BE(image.height,4);header[8]=8;header[9]=6;
  raw=Buffer.alloc((image.width*4+1)*image.height);
  for(let y=0;y<image.height;y++)raw.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),y*(image.width*4+1)+1);
  compressed=deflateSync(raw,{level:6});parts.push(Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',new Uint8Array()));combined=Buffer.concat(parts);return new Uint8Array(combined);
 }finally{raw?.fill(0);compressed?.fill(0);combined?.fill(0);for(const part of parts)part.fill(0);}
}
async function decodeSource(source){
 let m,context=0,handle,image,rgba,channel;let channels=[];
 try{
  const {default:factory}=await import('./vendor/libheif-1.23.5.mjs');
  // Embedded binary; this URL is never fetched. No plugins or external files.
  m=await factory({print:()=>{},printErr:()=>{},locateFile:()=> 'https://codec-binary.invalid/disabled.wasm'});
  if(!(m.HEAPU8 instanceof Uint8Array)||m.heif_get_version_number_major()!==1||m.heif_get_version_number_minor()!==23||m.heif_get_version_number_maintenance()!==5)fail();
  context=m.heif_context_alloc();if(!context)fail();
  const read=m.heif_context_read_from_memory(context,source);if(!read||read.code!==m.heif_error_code.heif_error_Ok)fail();
  if(m.heif_context_get_number_of_top_level_images(context)!==1)fail();
  const ids=m.heif_js_context_get_list_of_top_level_image_IDs(context);if(!Array.isArray(ids)||ids.length!==1)fail();
  const found=m.heif_js_context_get_image_handle(context,ids[0]);if(!found||typeof found!=='object'||found.code)fail();handle=found;
  const width=m.heif_image_handle_get_width(handle),height=m.heif_image_handle_get_height(handle);
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=HOSTED_HEIF_LIMITS.edge)||width*height>HOSTED_HEIF_LIMITS.pixels)fail();
  // Direct binding avoids the convenience decoder's console/error callbacks.
  const decoded=await m.heif_js_decode_image2(handle,m.heif_colorspace.heif_colorspace_RGB,m.heif_chroma.heif_chroma_interleaved_RGBA);
  const pointer=decoded?.image;if(pointer&&typeof pointer==='object'&&!pointer.code)image=pointer;
  channels=Array.isArray(decoded?.channels)?decoded.channels:[];
  if(!decoded||decoded.code||!image||channels.length!==1)fail();
  channel=decoded.channels[0];
  if(channel.id!==m.heif_channel.heif_channel_interleaved||channel.width!==width||channel.height!==height||!Number.isSafeInteger(channel.stride)||channel.stride<width*4||channel.stride>width*4+4096||!(channel.data instanceof Uint8Array)||channel.data.length<channel.stride*height)fail();
  rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)rgba.set(channel.data.subarray(y*channel.stride,y*channel.stride+width*4),y*width*4);
  const result={data:rgba,width,height};rgba=undefined;return result;
 }catch{fail();}finally{
  rgba?.fill(0);for(const c of channels)if(c?.data instanceof Uint8Array)c.data.fill(0);
  if(m){try{if(image)m.heif_image_release(image);}finally{try{if(handle)m.heif_image_handle_release(handle);}finally{try{if(context)m.heif_context_free(context);}finally{
   // Per-job module: after all destructors, erase the entire private heap and
   // discard it. Never reuse a wiped module or retain customer pixel buffers.
   m.HEAPU8?.fill(0);
  }}}}
 }
}
/** serialize across factories; no timeout is represented as physical CPU
 * cancellation. The platform terminates jobs exceeding its hard limits. */
export function createHostedHeifCodec({enabled=false,authorize}={}){
 return Object.freeze({kind:'hosted-heif-wasm-candidate',async normalize(input,{signal}={}){
  if(enabled!==true)throw Error('HOSTED_HEIF_DISABLED');
  if(busy)throw Error('HOSTED_HEIF_BUSY');
  let source,full,preview,tiny,encoded,derivative,delivered=false;
  busy=true;
  try{
   if(typeof authorize!=='function'||!(signal instanceof AbortSignal)||signal.aborted)fail();
   source=ownBytes(input,HOSTED_HEIF_LIMITS.sourceBytes);const mime=validateHeifContainer(source),content=Object.freeze({sha256:sha(source),byteLength:source.length,mime});
   const guard=async phase=>{if(signal.aborted||await authorize(Object.freeze({phase,content,signal}))!==true||signal.aborted)fail();};
   await guard('before_processing');full=await decodeSource(source);if(signal.aborted)fail();
   preview=resize(full.data,full.width,full.height,HOSTED_HEIF_LIMITS.previewEdge);tiny=resize(full.data,full.width,full.height,HOSTED_HEIF_LIMITS.derivativeEdge);full.data.fill(0);
   encoded=encodeJpeg(preview,72).data;
   if(encoded.length>HOSTED_HEIF_LIMITS.previewBytes)fail();
   const inspection=inspectHostedJpeg(encoded);derivative=png(tiny);const derivativeInspection=inspectHostedPhotoDerivative(derivative);
   await guard('before_delivery');
   const result=Object.freeze({schemaVersion:'design-hosted-heif-v1',source:Object.freeze({...content,width:full.width,height:full.height,frameCount:1,decoded:true}),normalized:Object.freeze({bytes:new Uint8Array(encoded),mime:'image/jpeg',width:preview.width,height:preview.height,sha256:inspection.sha256,byteLength:encoded.length}),derivative:Object.freeze({bytes:derivative,mime:'image/png',sourceSha256:content.sha256,metadataRemoved:true}),independentVerification:inspection,derivativeInspection,modelSubmissionAuthorized:false,publicEligible:false});
   delivered=true;return result;
  }catch{fail();}finally{
   source?.fill(0);full?.data?.fill(0);preview?.data?.fill(0);tiny?.data?.fill(0);encoded?.fill(0);if(!delivered)derivative?.fill(0);busy=false;
  }
 }});
}
