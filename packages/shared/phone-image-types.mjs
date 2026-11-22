/** Bounded source container admission, not a native decoder or permission.
 * Still HEIC/HEIF only: video/AVIF/sequences are separate unsupported formats. */
export const PHONE_SOURCE_MIMES=Object.freeze(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
export const PHONE_SOURCE_EXTENSIONS=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'});
export const isHeifMime=m=>m==='image/heic'||m==='image/heif';
export const samePhoneMime=(a,b)=>a===b||isHeifMime(a)&&isHeifMime(b);
export function detectHeifMime(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<20||bytes.length>8388608)return null;
 const a=(s,e)=>String.fromCharCode(...bytes.subarray(s,e)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=view.getUint32(0);
 if(a(4,8)!=='ftyp'||n<20||n>4096||n>bytes.length||n%4)return null;
 const brands=[a(8,12)];for(let i=16;i<n;i+=4)brands.push(a(i,i+4));
 if(brands.some(x=>['avif','avis','msf1','hevs','hevm'].includes(x)))return null;
 if(brands.some(x=>['heic','heix','hevc','hevx'].includes(x)))return 'image/heic';
 return brands.some(x=>['mif1','heif'].includes(x))?'image/heif':null;
}
export function validateHeifContainer(bytes){
 const mime=detectHeifMime(bytes);if(!mime)throw Error('PHONE_HEIF_CONTAINER_INVALID');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0,count=0,meta=false,mdat=false;
 while(at<bytes.length){
  if(++count>4096||at+8>bytes.length)throw Error('PHONE_HEIF_CONTAINER_INVALID');let n=v.getUint32(at),header=8;const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
  if(n===1){if(at+16>bytes.length)throw Error('PHONE_HEIF_CONTAINER_INVALID');const size=v.getBigUint64(at+8);if(size>BigInt(bytes.length))throw Error('PHONE_HEIF_CONTAINER_INVALID');n=Number(size);header=16;}
  else if(n===0){if(type!=='mdat')throw Error('PHONE_HEIF_CONTAINER_INVALID');n=bytes.length-at;}
  if(n<header||at+n>bytes.length||!['ftyp','meta','mdat','free','skip','uuid'].includes(type)||type==='ftyp'&&at!==0)throw Error('PHONE_HEIF_CONTAINER_INVALID');
  if(type==='meta')meta=true;if(type==='mdat')mdat=true;at+=n;
 }
 if(!meta||!mdat)throw Error('PHONE_HEIF_CONTAINER_INVALID');return mime;
}
