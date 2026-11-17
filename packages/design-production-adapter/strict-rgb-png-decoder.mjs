/** Independent narrow PNG decoder for a separate constrained Node process.
 * PNG filters follow W3C PNG 3 section 9; compressed data uses mature Node zlib.
 * Only static RGB8, no interlace, IHDR/IDAT/IEND. No ancillary metadata, palette,
 * alpha, APNG, unknown chunks, trailing file bytes or unused zlib input accepted.
 * This module is NOT authorization/issuer evidence by itself. Production callers
 * must use bounded isolated execution, not decode arbitrary bytes on the host.
 */
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const fail=()=>{const e=new Error('STRICT_RGB_PNG_INVALID');e.code=e.message;throw e;};
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
export function decodeStrictRgbPng(value,options){
 if(types.isProxy(options)||!options||Object.getPrototypeOf(options)!==Object.prototype||Reflect.ownKeys(options).length!==3)fail();
 const o={};for(const k of ['width','height','maximumBytes']){const d=Object.getOwnPropertyDescriptor(options,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();o[k]=d.value;}
 if(![o.width,o.height].every(x=>Number.isSafeInteger(x)&&x>0&&x<=1536)||![262144,524288].includes(o.maximumBytes)||types.isProxy(value)||!types.isUint8Array(value))fail();
 const proto=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(proto,k).get.call(value),buffer=get('buffer'),n=get('byteLength');
 if(types.isSharedArrayBuffer(buffer)||n<45||n>o.maximumBytes)fail();
 const data=Buffer.from(new Uint8Array(buffer,get('byteOffset'),n));let inflated,pixels,compressed;
 try{
  if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
  const parts=[];let pos=8,chunks=0,header=false,ended=false;
  while(pos<data.length){
   if(ended||++chunks>64||pos+12>data.length)fail();const len=data.readUInt32BE(pos),end=pos+len+12;if(end>data.length)fail();const kind=data.toString('latin1',pos+4,pos+8),p=data.subarray(pos+8,end-4);
   if(crc(data.subarray(pos+4,end-4))!==data.readUInt32BE(end-4))fail();
   if(kind==='IHDR'){if(header||pos!==8||len!==13||p.readUInt32BE(0)!==o.width||p.readUInt32BE(4)!==o.height||p[8]!==8||p[9]!==2||p[10]||p[11]||p[12])fail();header=true;}
   else if(kind==='IDAT'){if(!header||!len)fail();parts.push(p);}
   else if(kind==='IEND'){if(!header||!parts.length||len||end!==data.length)fail();ended=true;}
   else fail();pos=end;
  }
  if(!ended)fail();compressed=Buffer.concat(parts);if(compressed.length<6||(compressed[0]&15)!==8||(compressed[0]>>4)>7||((compressed[0]<<8)+compressed[1])%31||(compressed[1]&32))fail();
  const row=o.width*3,expected=(row+1)*o.height;
  let decoded;try{decoded=inflateSync(compressed,{info:true,maxOutputLength:expected});}catch{fail();}
  inflated=decoded.buffer;if(decoded.engine.bytesWritten!==compressed.length||inflated.length!==expected)fail();
  pixels=Buffer.alloc(row*o.height);
  for(let y=0;y<o.height;y++){
   const source=y*(row+1),target=y*row,filter=inflated[source];if(filter>4)fail();
   for(let x=0;x<row;x++){
    const a=x>=3?pixels[target+x-3]:0,b=y?pixels[target-row+x]:0,c=y&&x>=3?pixels[target-row+x-3]:0;
    const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
    pixels[target+x]=(inflated[source+1+x]+prediction)&255;
   }
  }
  const result={width:o.width,height:o.height,frameCount:1,byteLength:data.length,sha256:hash(data),pixelSha256:hash(pixels),compressedBytes:compressed.length,consumedCompressedBytes:decoded.engine.bytesWritten,metadataAbsent:true,pixels};pixels=null;return Object.freeze(result);
 }finally{data.fill(0);compressed?.fill(0);inflated?.fill(0);pixels?.fill(0);}
}
