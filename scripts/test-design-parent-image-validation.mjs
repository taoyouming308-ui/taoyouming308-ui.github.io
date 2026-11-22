import test from 'node:test';
import assert from 'node:assert/strict';
import {validateParentImageContainer as validate} from '../packages/design-production-adapter/parent-image-validation.mjs';
import {parentImageBytes} from './fixtures/parent-image-bytes.mjs';
const f=parentImageBytes();
const check=(b,mime='image/jpeg')=>validate(b,{mime,width:80,height:120,maximumBytes:262144});
const copy=b=>Buffer.from(b);
const jpegSegment=(m,p)=>{const h=Buffer.alloc(4);h[0]=255;h[1]=m;h.writeUInt16BE(p.length+2,2);return Buffer.concat([h,p]);};
function chunks(b){const r=[];for(let p=12;p<b.length;){const n=b.readUInt32LE(p+4);r.push({kind:b.toString('latin1',p,p+4),start:p,end:p+8+n+n%2,n});p+=8+n+n%2;}return r;}
const riff=b=>{b.writeUInt32LE(b.length-8,4);return b;};
test('real synthetic baseline JPEG and static VP8 parse, but NEVER claim entropy decoded or qualified',()=>{
 for(const [b,m] of [[f.jpeg,'image/jpeg'],[f.webp,'image/webp']]){const r=check(b,m);assert.equal(r.containerEnvelopeComplete,true);assert.equal(r.fullyDecoded,false);assert.equal(r.fullyConsumed,false);assert.equal(r.qualified,false);assert.equal(r.compressedStream,'not_verified');assert(Object.isFrozen(r));}
});
test('JPEG sole EOI must end file; duplicate SOI/EOI and marker-in-entropy reject',()=>{
 for(const b of [Buffer.concat([f.jpeg,Buffer.from('<html>')]),Buffer.concat([f.jpeg,Buffer.from([255,217])]),Buffer.concat([f.jpeg.subarray(0,2),Buffer.from([255,216]),f.jpeg.subarray(2)]),Buffer.concat([f.jpeg.subarray(0,-2),Buffer.from([255,216,255,217])]),f.jpeg.subarray(0,-1)])assert.throws(()=>check(b));
});
test('unknown JPEG APP, ICC, Adobe, COM, progressive/restart and invalid table lengths reject',()=>{
 for(const marker of [0xe2,0xee,0xef,0xfe,0xc2,0xdd]){assert.throws(()=>check(Buffer.concat([f.jpeg.subarray(0,2),jpegSegment(marker,Buffer.alloc(4)),f.jpeg.subarray(2)])));}
 const bad=copy(f.jpeg);bad.writeUInt16BE(65535,4);assert.throws(()=>check(bad));
 const q=copy(f.jpeg),at=q.indexOf(Buffer.from([255,219]));q[at+4]=16;assert.throws(()=>check(q));
});
test('JPEG frame component/dimensions/spectral and table references are exact',()=>{
 const sof=f.jpeg.indexOf(Buffer.from([255,192])),sos=f.jpeg.indexOf(Buffer.from([255,218]));
 for(const mutate of [b=>b[sof+4]=12,b=>b.writeUInt16BE(2000,sof+7),b=>b[sof+9]=4,b=>b[sos+6]=255,b=>b[sos+2+b.readUInt16BE(sos+2)-1]=1]){const b=copy(f.jpeg);mutate(b);assert.throws(()=>check(b));}
});
test('EXIF duplicate or unknown/GPS/ICC fields, orientation and overlapping pointers reject',()=>{
 const exif=f.jpeg.subarray(2,2+2+f.jpeg.readUInt16BE(4));assert.throws(()=>check(Buffer.concat([f.jpeg.subarray(0,2),exif,f.jpeg.subarray(2)])));
 const tiff=12;
 for(const mutate of [b=>b.writeUInt16LE(6,tiff+18),b=>b.writeUInt16LE(0x8825,tiff+10),b=>b.writeUInt32LE(8,tiff+8+2+5*12+8),b=>b.writeUInt32LE(0xffffffff,tiff+4)]){const b=copy(f.jpeg);mutate(b);assert.throws(()=>check(b));}
});
test('WebP RIFF exact size, flags/reserved bytes, canvas, one image and no unknown extensions',()=>{
 const c=chunks(f.webp),image=c.find(x=>x.kind==='VP8 '),exif=c.find(x=>x.kind==='EXIF');
 for(const b of [Buffer.concat([f.webp,Buffer.from('tail')]),f.webp.subarray(0,-2),riff(Buffer.concat([f.webp,Buffer.from('JUNK\0\0\0\0')])),riff(Buffer.concat([f.webp.subarray(0,exif.start),f.webp.subarray(image.start,image.end),f.webp.subarray(exif.start)]))])assert.throws(()=>check(b,'image/webp'));
 for(const mutate of [b=>b[20]=2,b=>b[20]=0,b=>b[21]=1,b=>b[24]=0,b=>b[image.start+8]|=1,b=>b[image.start+8]&=~16,b=>b[image.start+14]|=128]){const b=copy(f.webp);mutate(b);assert.throws(()=>check(b,'image/webp'));}
});
test('WebP nonzero RIFF padding is rejected rather than ignored',()=>{
 const c=chunks(f.webp).find(x=>x.kind==='VP8 '),b=riff(Buffer.concat([f.webp.subarray(0,c.end),Buffer.from([0,1]),f.webp.subarray(c.end)]));b.writeUInt32LE(c.n+1,c.start+4);assert.throws(()=>check(b,'image/webp'));
});
test('JPEG entropy/VP8 payload internal tail illustrates unproven consumption, not qualification',()=>{
 const j=Buffer.concat([f.jpeg.subarray(0,-2),Buffer.alloc(16,65),f.jpeg.subarray(-2)]);assert.equal(check(j).qualified,false);
 const c=chunks(f.webp).find(x=>x.kind==='VP8 '),w=riff(Buffer.concat([f.webp.subarray(0,c.end),Buffer.alloc(16,65),f.webp.subarray(c.end)]));w.writeUInt32LE(c.n+16,c.start+4);assert.equal(check(w,'image/webp').fullyConsumed,false);
});
test('every truncated prefix rejects, with bounded bytes and no partial parse success',()=>{
 for(const [b,m] of [[f.jpeg,'image/jpeg'],[f.webp,'image/webp']])for(let n=0;n<b.length;n++)assert.throws(()=>check(b.subarray(0,n),m));
 assert.throws(()=>check(Buffer.alloc(262145)));
});
test('unknown options/getters/proxies/shared buffer rejected without executing getters',()=>{
 let calls=0;const opts={mime:'image/jpeg',width:80,height:120,maximumBytes:262144};Object.defineProperty(opts,'width',{enumerable:true,get(){calls++;return 80;}});assert.throws(()=>validate(f.jpeg,opts));assert.equal(calls,0);assert.throws(()=>check(new Uint8Array(new SharedArrayBuffer(100))));assert.throws(()=>check(new Proxy(f.jpeg,{})));
});
