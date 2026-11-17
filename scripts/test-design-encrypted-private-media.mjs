import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,writeFile,readdir,rm,realpath,link,copyFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomBytes} from 'node:crypto';
import {createEncryptedPrivateMediaTransport} from '../packages/design-production-adapter/encrypted-private-media-transport.mjs';
import {createPreparedPrivatePhotoStorage} from '../packages/design-production-adapter/private-media-storage.mjs';
const origin='https://local-photo-fixture.supabase.co',scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},key=randomBytes(32),image=Buffer.from('SYNTHETIC_PRIVATE_IMAGE_BYTES_NOT_A_REAL_PHOTO');
const sha=b=>createHash('sha256').update(b).digest('hex');
const record={mediaId:'synthetic-image',requestId:'synthetic-image',binding:{owner:'synthetic-employee',store:'synthetic-store',scope},stage:'before',angle:'front',mime:'image/heic',byteLength:image.length,width:2016,height:1512,sha256:sha(image),active:true};
async function directory(){const root=await realpath(await mkdtemp(join(tmpdir(),'design-object-')));await chmod(root,0o700);return root;}
function fixture(root,overrides={}){const state={allowed:true,calls:[],posts:0};const direct=createEncryptedPrivateMediaTransport({enabled:true,root,origin,secretProvider:async()=>Uint8Array.from(key),authorize:async q=>state.allowed,...overrides});const transport=async q=>{state.calls.push(q.method);if(q.method==='POST')state.posts++;return direct(q);};const storage=createPreparedPrivatePhotoStorage({enabled:true,origin,transport,authorize:async()=>state.allowed});return {state,transport,direct,storage};}
test('default disabled; actual encrypted create/read survives new instance and no plaintext appears on disk',async()=>{
 await assert.rejects(createEncryptedPrivateMediaTransport()({}),/DISABLED/);const root=await directory();try{const f=fixture(root);await f.storage.stage({record,bytes:image});const files=await readdir(root);assert.equal(files.length,1);assert(files[0].endsWith('.object'));const stored=await readFile(join(root,files[0]));assert(!stored.includes(image));assert(!stored.includes(key));assert.deepEqual(Buffer.from(await fixture(root).storage.read({record})),image);assert.equal(f.state.posts,1);}finally{await rm(root,{recursive:true,force:true});}
});
test('lost POST response performs only read reconciliation, duplicate create cannot overwrite different bytes',async()=>{
 const root=await directory();try{const f=fixture(root);let lost=true;const storage=createPreparedPrivatePhotoStorage({enabled:true,origin,authorize:async()=>true,transport:async q=>{const r=await f.transport(q);if(q.method==='POST'&&lost){lost=false;throw Error('SYNTHETIC_REPLY_LOST');}return r;}});assert.equal((await storage.stage({record,bytes:image})).reconciled,true);assert.deepEqual(f.state.calls,['POST','GET']);
 const changed=Buffer.from('X'.repeat(image.length));await assert.rejects(f.storage.stage({record:{...record,sha256:sha(changed)},bytes:changed}));assert.deepEqual(Buffer.from(await f.storage.read({record})),image);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('ciphertext corruption, wrong master key, unsafe file permissions, symlinks and scope revocation withhold data',async()=>{
 const root=await directory();try{const f=fixture(root);await f.storage.stage({record,bytes:image});const path=join(root,(await readdir(root))[0]),saved=await readFile(path);const wrong=fixture(root,{secretProvider:async()=>new Uint8Array(32).fill(99)});await assert.rejects(wrong.storage.read({record}));
 const changed=Buffer.from(saved);changed[changed.length-1]^=1;await writeFile(path,changed);await assert.rejects(f.storage.read({record}));await writeFile(path,saved);
 await chmod(path,0o644);await assert.rejects(f.storage.read({record}));await chmod(path,0o600);f.state.allowed=false;await assert.rejects(f.storage.read({record}));f.state.allowed=true;
 const alias=root+'-alias';await symlink(root,alias);try{await assert.rejects(fixture(alias).storage.read({record}));}finally{await rm(alias);}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('recover an exact crash-left staging hardlink; encrypted backup restores only with correct key and protected modes',async()=>{
 const root=await directory(),restored=await directory();try{const f=fixture(root);await f.storage.stage({record,bytes:image});const name=(await readdir(root))[0],path=join(root,name),pending=join(root,'.pending-00000000-0000-4000-8000-000000000000');await link(path,pending);assert.deepEqual(Buffer.from(await fixture(root).storage.read({record})),image);assert.deepEqual(await readdir(root),[name]);
 await copyFile(path,join(restored,name));await chmod(join(restored,name),0o600);assert.deepEqual(Buffer.from(await fixture(restored).storage.read({record})),image);
 await writeFile(join(restored,name),(await readFile(path)).subarray(0,40));await assert.rejects(fixture(restored).storage.read({record}));
 }finally{await rm(root,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});
test('late publication authorization revoke returns uncertain and retains immutable object for an authorized later read',async()=>{
 const root=await directory();try{let revoked=false;const f=fixture(root,{authorize:async q=>{if(q.phase==='after_io'&&q.operation==='create'){revoked=true;return false;}return !revoked;}});await assert.rejects(f.storage.stage({record,bytes:image}));assert.equal((await readdir(root)).length,1);assert.deepEqual(Buffer.from(await fixture(root).storage.read({record})),image);}finally{await rm(root,{recursive:true,force:true});}
});
