/** TEST ONLY: fixed colored pixels, never a production image classifier/fallback. */
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createNativePrivateImageInspector} from '../../packages/design-production-adapter/private-image-decoder.mjs';
function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const tag=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);tag.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([tag,data])),out.length-4);return out;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(3);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.from([0,65,105,225,65,105,225,65,105,225,0,65,105,225,65,105,225,65,105,225]);
const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const hash=value=>createHash('sha256').update(value).digest('hex');
export const SYNTHETIC_PRIVATE_PNG_SHA256=hash(bytes);
export const syntheticPrivatePNG=()=>Uint8Array.from(bytes);
export function createSyntheticWhitelistedInspector(){
 const native=createNativePrivateImageInspector({enabled:true,magickPath:'/opt/homebrew/bin/magick',pythonPath:'/usr/bin/python3',syntheticOnly:true});
 return async input=>{
  if(process.env.NODE_ENV==='production'||!(input instanceof Uint8Array)||input.length!==bytes.length||hash(input)!==SYNTHETIC_PRIVATE_PNG_SHA256)throw Error('SYNTHETIC_FIXTURE_ONLY');
  return native(Uint8Array.from(input));
 };
}
