/** Pure browser-boundary contracts; actual codec tests are separate. */
import test from 'node:test';import assert from 'node:assert/strict';
import {prepareLocalPhoto,createScopedPhotoPreviews} from '../packages/design-prepared-ui/photo-preview.mjs';
import {detectHeifMime,validateHeifContainer} from '../packages/shared/phone-image-types.mjs';
const box=(name,data=Buffer.alloc(0))=>{const h=Buffer.alloc(8);h.writeUInt32BE(8+data.length);h.write(name,4);return Buffer.concat([h,data]);};
const heic=Buffer.concat([box('ftyp',Buffer.concat([Buffer.from('heic'),Buffer.alloc(4),Buffer.from('mif1heic')])),box('meta'),box('mdat',Buffer.from([1]))]);
const file=(type='image/heic',bytes=heic)=>({type,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
test('HEIC/HEIF explicit opt-in defers native validation; empty phone MIME sniffs actual brands; no browser decode claim',async()=>{
 let decodes=0;const decode=async()=>{decodes++;throw Error('BROWSER_HEIF_UNAVAILABLE');};await assert.rejects(prepareLocalPhoto(file(),{decode}));
 for(const type of ['image/heic','image/heif','']){const p=await prepareLocalPhoto(file(type),{decode,allowHeif:true});assert.equal(p.pendingServerDecode,true);assert.equal(p.width,null);assert.equal(p.height,null);assert.equal(p.mime,type||'image/heic');assert.deepEqual(p.bytes,Uint8Array.from(heic));}assert.equal(decodes,0);
});
test('AVIF, sequence brands, missing payload and truncated BMFF fail before upload; headers alone never claim decode',async()=>{
 for(const bytes of [heic.subarray(0,-1),Buffer.concat([box('ftyp',Buffer.concat([Buffer.from('avif'),Buffer.alloc(4),Buffer.from('mif1heic')])),box('meta'),box('mdat',Buffer.from([1]))]),Buffer.concat([box('ftyp',Buffer.concat([Buffer.from('heic'),Buffer.alloc(4),Buffer.from('msf1')])),box('meta'),box('mdat',Buffer.from([1]))])]){await assert.rejects(prepareLocalPhoto(file('image/heic',bytes),{allowHeif:true}));}
 assert.equal(detectHeifMime(heic),'image/heic');assert.doesNotThrow(()=>validateHeifContainer(heic));
});
const ref={mediaId:'synthetic-heif-photo',mime:'image/heic',byteLength:123,width:4032,height:3024,stage:'before',angle:'front'},bytes=Uint8Array.from([255,216,255,217]),result={preview:true,previewProfile:'phone-v2',sourceMediaId:ref.mediaId,sourceByteLength:123,sourceMime:'image/heic',mime:'image/jpeg',width:1024,height:768,bytes};
test('normalized JPEG preview must bind original HEIC reference and actual browser decoded dimensions',async()=>{
 let made=0,closed=0;const previews=createScopedPhotoPreviews({enabled:true,readMedia:async()=>structuredClone(result),decode:async()=>({width:1024,height:768,close(){closed++;}}),createURL:()=>{made++;return 'blob:synthetic';},revokeURL:()=>{}});previews.select({customer:'a'});assert.equal((await previews.open(ref)).url,'blob:synthetic');assert.equal(closed,1);assert.equal(made,1);
 for(const patch of [{sourceMediaId:'other'},{sourceMime:'image/png'},{sourceByteLength:124},{previewProfile:'unreviewed'},{width:0},{mime:'image/heic'}]){const p=createScopedPhotoPreviews({enabled:true,readMedia:async()=>({...result,...patch}),decode:async()=>{throw Error('must not decode');},createURL:()=>{throw Error('must not publish');}});p.select({customer:'a'});await assert.rejects(p.open(ref));}
 const p=createScopedPhotoPreviews({enabled:true,readMedia:async()=>result,decode:async()=>({width:768,height:1024,close(){}}),createURL:()=>{throw Error('must not publish');}});p.select({customer:'a'});await assert.rejects(p.open(ref),/DIMENSIONS/);
});
test('customer switch during decode suppresses late result and closes bitmap; old preview URLs are revoked',async()=>{
 let release,entered;const waiting=new Promise(r=>{entered=r;}),hold=new Promise(r=>{release=r;}),revoked=[];let closed=0,made=0;
 const p=createScopedPhotoPreviews({enabled:true,readMedia:async()=>structuredClone(result),decode:async()=>{entered();await hold;return {width:1024,height:768,close(){closed++;}};},createURL:()=>{made++;return 'blob:late';},revokeURL:u=>revoked.push(u)});p.select({customer:'a'});const pending=p.open(ref);await waiting;p.select({customer:'b'});release();assert.equal(await pending,null);assert.equal(made,0);assert.equal(closed,1);assert.equal(p.get(ref.mediaId),null);
 const q=createScopedPhotoPreviews({enabled:true,readMedia:async()=>structuredClone(result),decode:async()=>({width:1024,height:768}),createURL:()=> 'blob:old',revokeURL:u=>revoked.push(u)});q.select({customer:'a'});await q.open(ref);q.select({customer:'b'});assert.deepEqual(revoked,['blob:old']);
});
