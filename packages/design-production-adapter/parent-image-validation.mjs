/** Conservative container grammar, NOT an entropy/VP8 decoder. Based on ITU T.81
 * Annex B and Google's WebP RIFF specification. Unsupported valid formats fail
 * closed. Parsing never means compressed bytes were fully consumed, decoded or
 * safe: that requires a separately qualified bounded native decoder interface.
 * In particular bytes inserted BEFORE JPEG EOI or INSIDE the last VP8 partition
 * cannot be excluded by container framing alone. No authority/issuer/storage I/O.
 */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
const fail=()=>{const e=new Error('PARENT_IMAGE_UNSUPPORTED_OR_INVALID');e.code=e.message;throw e;};
const exact=(x,keys)=>{if(types.isProxy(x)||!x||Object.getPrototypeOf(x)!==Object.prototype||Reflect.ownKeys(x).length!==keys.length)fail();const o={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(x,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();o[k]=d.value;}return o;};
function snapshot(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const p=Object.getPrototypeOf(Uint8Array.prototype),g=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=g('buffer'),n=g('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,g('byteOffset'),n));}
/** Only the small EXIF subset emitted by the pinned local imgproxy is accepted.
 * Unknown tags, GPS, thumbnails, MakerNotes, chained IFDs, overlapping/outside
 * offsets and unreferenced trailing payload fail, rather than being hidden. */
function exif(p){
 if(p.length>4096||p.length<14||!p.subarray(0,6).equals(Buffer.from('Exif\0\0')))fail();
 const b=p.subarray(6);let le;if(b.subarray(0,2).toString('latin1')==='II')le=true;else if(b.subarray(0,2).toString('latin1')==='MM')le=false;else fail();
 const u16=n=>{if(n<0||n+2>b.length)fail();return le?b.readUInt16LE(n):b.readUInt16BE(n);},u32=n=>{if(n<0||n+4>b.length)fail();return le?b.readUInt32LE(n):b.readUInt32BE(n);};
 if(u16(2)!==42||u32(4)!==8)fail();const used=new Uint8Array(b.length);
 const occupy=(a,n)=>{if(a<0||n<0||a+n>b.length)fail();for(let j=a;j<a+n;j++){if(used[j])fail();used[j]=1;}};occupy(0,8);
 let orientation=null,dimensions=null,child=null;
 const parse=(offset,secondary)=>{
  if(offset%2)fail();const n=u16(offset);if(n<1||n>12)fail();occupy(offset,2+n*12+4);if(u32(offset+2+n*12)!==0)fail();let previous=-1;let width,height;
  for(let i=0;i<n;i++){
   const at=offset+2+i*12,tag=u16(at),type=u16(at+2),count=u32(at+4),val=u32(at+8);if(tag<=previous)fail();previous=tag;
   const short=()=>{if(type!==3||count!==1||b[at+10]!==0||b[at+11]!==0)fail();return u16(at+8);};
   if(!secondary&&tag===0x112){orientation=short();if(orientation!==1)fail();}
   else if(!secondary&&(tag===0x11a||tag===0x11b)){if(type!==5||count!==1||val%2)fail();occupy(val,8);if(!u32(val)||!u32(val+4)||u32(val)>1000000||u32(val+4)>1000000)fail();}
   else if(!secondary&&tag===0x128){if(![1,2,3].includes(short()))fail();}
   else if(!secondary&&tag===0x213){if(![1,2].includes(short()))fail();}
   else if(!secondary&&tag===0x8769){if(type!==4||count!==1||child!==null)fail();child=val;}
   else if(secondary&&(tag===0x9000||tag===0xa000)){if(type!==7||count!==4||!/^\d{4}$/.test(b.toString('latin1',at+8,at+12)))fail();}
   else if(secondary&&tag===0x9101){if(type!==7||count!==4||!b.subarray(at+8,at+12).equals(Buffer.from([1,2,3,0])))fail();}
   else if(secondary&&tag===0xa001){if(![1,65535].includes(short()))fail();}
   else if(secondary&&(tag===0xa002||tag===0xa003)){if(type!==4||count!==1||val<1||val>1536)fail();if(tag===0xa002)width=val;else height=val;}
   else fail();
  }
  if(secondary){if(!width||!height)fail();dimensions={width,height};}
 };
 parse(8,false);if(child!==null)parse(child,true);if(used.some(x=>x!==1))fail();return {orientation:orientation===null?'absent':'identity',dimensions};
}
function jpeg(b){
 if(b.length<4||b[0]!==255||b[1]!==216)fail();let pos=2,count=0,frame=null,metadata=null,jfif=false,scan=false;
 const q=new Set(),dc=new Set(),ac=new Set();
 while(pos<b.length){
  if(++count>64||pos+4>b.length||b[pos]!==255)fail();const marker=b[pos+1];
  if([0,255,216,217].includes(marker))fail();const n=b.readUInt16BE(pos+2);if(n<2||pos+2+n>b.length)fail();const p=b.subarray(pos+4,pos+2+n);pos+=2+n;
  if(marker===0xe0){if(jfif||scan||frame||p.length!==14||p.toString('latin1',0,5)!=='JFIF\0'||p[5]!==1||![1,2].includes(p[6])||p[7]>2||!p.readUInt16BE(8)||!p.readUInt16BE(10)||p[12]||p[13])fail();jfif=true;}
  else if(marker===0xe1){if(metadata||frame)fail();metadata=exif(p);}
  else if(marker===0xdb){let a=0;while(a<p.length){const id=p[a++];if(id>3||q.has(id)||a+64>p.length)fail();for(let k=0;k<64;k++)if(p[a+k]===0)fail();q.add(id);a+=64;}if(a===0)fail();}
  else if(marker===0xc4){let a=0;while(a<p.length){if(a+17>p.length)fail();const id=p[a++],kind=id>>4,table=id&15;if(kind>1||table>3||(kind?ac:dc).has(table))fail();let total=0,slots=1;for(let k=0;k<16;k++){const v=p[a+k];total+=v;slots=slots*2-v;if(slots<0)fail();}a+=16;if(total<1||total>256||a+total>p.length)fail();const seen=new Set();for(let k=0;k<total;k++){const v=p[a+k];if(seen.has(v)||(!kind&&v>11)||(kind&&(v&15)>10)||(kind&&(v&15)===0&&v!==0&&v!==240))fail();seen.add(v);}a+=total;(kind?ac:dc).add(table);}if(a===0)fail();}
  else if(marker===0xc0){
   if(frame||p.length<9||p[0]!==8)fail();const height=p.readUInt16BE(1),width=p.readUInt16BE(3),components=p[5];if(![1,3].includes(components)||p.length!==6+3*components||!width||!height||width>1536||height>1536)fail();const c=[];
   for(let i=0;i<components;i++){const at=6+3*i,id=p[at],h=p[at+1]>>4,v=p[at+1]&15,t=p[at+2];if(id!==i+1||h<1||h>4||v<1||v>4||t>3)fail();c.push({id,h,v,q:t});}
   if(c.reduce((s,x)=>s+x.h*x.v,0)>10)fail();frame={width,height,components:c};
  }else if(marker===0xda){
   if(scan||!frame||p.length!==1+2*frame.components.length+3||p[0]!==frame.components.length)fail();scan=true;
   for(let i=0;i<frame.components.length;i++){const c=frame.components[i],at=1+2*i,d=p[at+1]>>4,a=p[at+1]&15;if(p[at]!==c.id||!dc.has(d)||!ac.has(a)||!q.has(c.q))fail();}
   if(p[p.length-3]!==0||p[p.length-2]!==63||p[p.length-1]!==0)fail();
   const start=pos;while(pos<b.length){if(b[pos++]!==255)continue;if(pos>=b.length)fail();const code=b[pos++];if(code===0)continue;if(code===217){if(pos!==b.length||pos-start<3)fail();if(metadata?.dimensions&&(metadata.dimensions.width!==frame.width||metadata.dimensions.height!==frame.height))fail();return {...frame,components:frame.components.length,orientation:metadata?.orientation??'absent',metadata:metadata?'known_exif':jfif?'jfif':'none',segmentCount:count,compressedStream:'not_verified'};}fail();}fail();
  }else fail(); // includes restart/DRI, progressive, Adobe, ICC, COM, unknown APP.
 }
 fail();
}
function webp(b){
 if(b.length<20||b.toString('latin1',0,4)!=='RIFF'||b.toString('latin1',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length||b.length%2)fail();
 let pos=12,count=0,extended=null,frame=null,metadata=null;
 while(pos<b.length){if(++count>3||pos+8>b.length)fail();const kind=b.toString('latin1',pos,pos+4),n=b.readUInt32LE(pos+4),end=pos+8+n+(n%2);if(end>b.length||(n%2&&b[end-1]!==0))fail();const p=b.subarray(pos+8,pos+8+n);pos=end;
  if(kind==='VP8X'){if(count!==1||n!==10||![0,8].includes(p[0])||p[1]||p[2]||p[3])fail();extended={flags:p[0],width:1+p.readUIntLE(4,3),height:1+p.readUIntLE(7,3)};}
  else if(kind==='VP8 '){
   if(frame||metadata||n<11)fail();const tag=p.readUIntLE(0,3),version=(tag>>1)&7,partition=tag>>5;if((tag&1)!==0||version>3||!(tag&16)||partition<1||partition>n-10||!p.subarray(3,6).equals(Buffer.from([157,1,42])))fail();
   const w=p.readUInt16LE(6),h=p.readUInt16LE(8);if((w>>14)||(h>>14)||!(w&16383)||!(h&16383)||(w&16383)>1536||(h&16383)>1536)fail();frame={width:w&16383,height:h&16383};
  }else if(kind==='EXIF'){if(!extended||extended.flags!==8||!frame||metadata)fail();metadata=exif(p);}
  else fail(); // VP8L/alpha/animation/ICCP/XMP/unknown extensions unsupported.
 }
 if(!frame||!!metadata!==!!(extended?.flags&8)||(extended&&(extended.width!==frame.width||extended.height!==frame.height))||(metadata?.dimensions&&(metadata.dimensions.width!==frame.width||metadata.dimensions.height!==frame.height)))fail();
 return {...frame,components:3,orientation:metadata?.orientation??'absent',metadata:metadata?'known_exif':'none',segmentCount:count,compressedStream:'not_verified'};
}
/** This return value deliberately cannot fulfill inspector.inspectParent's
 * fullyDecoded/containerValid/trailingDataAbsent authorization protocol. */
export function validateParentImageContainer(value,options){
 const o=exact(options,['mime','width','height','maximumBytes']);if(!['image/jpeg','image/webp'].includes(o.mime)||![262144,524288].includes(o.maximumBytes)||![o.width,o.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1536))fail();
 const b=snapshot(value,o.maximumBytes);try{const info=o.mime==='image/jpeg'?jpeg(b):webp(b);if(info.width!==o.width||info.height!==o.height)fail();return Object.freeze({schemaVersion:'design-parent-container-inspection-v1',mime:o.mime,sha256:createHash('sha256').update(b).digest('hex'),byteLength:b.length,...info,frameCount:1,containerEnvelopeComplete:true,fullyConsumed:false,fullyDecoded:false,qualified:false});}finally{b.fill(0);}
}
