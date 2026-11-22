/** Durable local private objects, compatible with the existing original-media
 * storage abstraction. It is NOT a Supabase cloud emulator or a public server.
 * Fixed logical URI is an AAD namespace; no HTTP is sent. Current app scope and
 * receipt checks remain above this layer; authorize is mandatory on every call.
 * Operators supply an empty/private directory and a server-only 32-byte key. */
import {open,realpath,lstat,link,unlink,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes,randomUUID} from 'node:crypto';
import {types} from 'node:util';
const hash=b=>createHash('sha256').update(b).digest('hex');
const error=code=>Object.assign(Error(code),{code,retryable:false,outcome:code==='PRIVATE_OBJECT_OUTCOME_UNCERTAIN'?'uncertain':'not_sent'});
const fail=code=>{throw error(code??'PRIVATE_OBJECT_DENIED');};
const pattern=/^\/storage\/v1\/object\/customer-design-photos\/[1-9][0-9]{0,15}\/prepared\/[a-f0-9]{64}\/[A-Za-z0-9_-]{1,100}\.(jpg|png|webp|heic|heif)$/;
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();r[k]=d.value;}return r;}
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const p=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,get('byteOffset'),n));}
async function directory(root){if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||await realpath(root)!==root)fail();const s=await lstat(root);if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)fail();}
async function durableDirectory(root){const h=await open(root,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
export function createEncryptedPrivateMediaTransport({enabled=false,root,origin,secretProvider,authorize}={}){
 let active=0;let valid=false;try{const u=new URL(origin);valid=u.protocol==='https:'&&u.origin===origin&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);}catch{}
 const run=async input=>{
  if(enabled!==true||!valid||typeof secretProvider!=='function'||typeof authorize!=='function')throw error('PRIVATE_OBJECT_DISABLED');if(active>=4)throw error('PRIVATE_OBJECT_BUSY');
  active++;const deadline=performance.now()+10000;let plaintext,key,envelope,handle,temp,published=false,metadata,decoded;
  try{
   if(types.isProxy(input)||!input||Object.getPrototypeOf(input)!==Object.prototype)fail();
   const write=input.method==='POST',q=own(input,['url','method','redirect','credentials','timeoutMs','maxResponseBytes','headers',...(write?['body']:[])]),u=new URL(q.url);
   if(!['POST','GET'].includes(q.method)||q.redirect!=='error'||q.credentials!=='omit'||q.timeoutMs!==10000||u.origin!==origin||u.href!==q.url||u.search||u.hash||!pattern.test(u.pathname)||!Number.isSafeInteger(q.maxResponseBytes)||q.maxResponseBytes<1||q.maxResponseBytes>(write?4096:8388608))fail();
   if(write){const h=own(q.headers,['Content-Type','x-upsert']);if(h['x-upsert']!=='false'||!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(h['Content-Type']))fail();plaintext=bytes(q.body,8388608);}
   await directory(root);const context=Object.freeze({url:q.url,operation:write?'create':'read'}),guard=async phase=>{if(performance.now()>=deadline||await authorize(Object.freeze({...context,phase}))!==true||performance.now()>=deadline)fail();};
   await guard('before_credentials');let raw=await secretProvider({purpose:'design-private-object-v1'});try{const material=bytes(raw,32);try{if(material.length!==32)fail();key=Buffer.from(hkdfSync('sha256',material,Buffer.from(origin),'design-private-object-v1',32));}finally{material.fill(0);}}finally{raw=null;}
   const id=hash(q.url),path=join(root,id+'.object'),aad=Buffer.from(q.url);
   await guard('before_io');
   if(write){
    const h=own(q.headers,['Content-Type','x-upsert']);if(h['x-upsert']!=='false'||!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(h['Content-Type']))fail();
    metadata={schemaVersion:'design-encrypted-object-v1',id,mime:h['Content-Type'],byteLength:plaintext.length,sha256:hash(plaintext)};
    const header=Buffer.from(JSON.stringify(metadata)),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.concat([aad,Buffer.from('\n'),header]));
    const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);envelope=Buffer.concat([Buffer.from('DPO1'),Buffer.from([header.length>>8,header.length&255]),header,iv,cipher.getAuthTag(),encrypted]);encrypted.fill(0);
    temp=join(root,'.pending-'+randomUUID());handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(envelope);await handle.sync();await handle.close();handle=null;
    await guard('before_publish');
    try{await link(temp,path);published=true;await durableDirectory(root);}catch(e){if(e?.code==='EEXIST'){await guard('after_io');return {url:q.url,status:409,redirected:false,body:new Uint8Array()};}throw e;}
    await guard('after_io');return {url:q.url,status:201,redirected:false,body:new Uint8Array()};
   }
   own(q.headers,[]);
   try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(e?.code==='ENOENT'){await guard('after_io');return {url:q.url,status:404,redirected:false,body:new Uint8Array()};}throw e;}
   const st=await handle.stat();if(!st.isFile()||![1,2].includes(st.nlink)||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o600||st.size<35||st.size>8388608+2048)fail('PRIVATE_OBJECT_INTEGRITY');
   if(st.nlink===2){
    // Recover only our own interrupted publication's second hardlink. The
    // immutable final object is never deleted/overwritten. Same-UID processes
    // are part of the trusted host boundary, not isolated by file permissions.
    const names=await readdir(root);if(names.length>10000)fail('PRIVATE_OBJECT_INTEGRITY');let recovered=false;
    for(const name of names){if(!/^\.pending-[a-f0-9-]{36}$/.test(name))continue;const p=join(root,name);let candidate;try{candidate=await lstat(p);}catch{continue;}if(candidate.isFile()&&!candidate.isSymbolicLink()&&candidate.ino===st.ino&&candidate.dev===st.dev&&candidate.uid===st.uid&&(candidate.mode&0o777)===0o600){await unlink(p);await durableDirectory(root);recovered=true;break;}}
    if(!recovered||(await handle.stat()).nlink!==1)fail('PRIVATE_OBJECT_INTEGRITY');
   }
   envelope=Buffer.alloc(st.size);let n=0;while(n<envelope.length){const r=await handle.read(envelope,n,envelope.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}if(n!==envelope.length)fail('PRIVATE_OBJECT_INTEGRITY');
   if(envelope.toString('ascii',0,4)!=='DPO1')fail('PRIVATE_OBJECT_INTEGRITY');const length=envelope.readUInt16BE(4);if(length>1024||6+length+28>=envelope.length)fail('PRIVATE_OBJECT_INTEGRITY');
   const header=envelope.subarray(6,6+length),iv=envelope.subarray(6+length,18+length),tag=envelope.subarray(18+length,34+length);metadata=own(JSON.parse(header.toString('utf8')),['schemaVersion','id','mime','byteLength','sha256']);
   if(metadata.schemaVersion!=='design-encrypted-object-v1'||metadata.id!==id||!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(metadata.mime)||!Number.isSafeInteger(metadata.byteLength)||metadata.byteLength<1||metadata.byteLength>q.maxResponseBytes||!/^[a-f0-9]{64}$/.test(metadata.sha256))fail('PRIVATE_OBJECT_INTEGRITY');
   const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.concat([aad,Buffer.from('\n'),header]));decipher.setAuthTag(tag);decoded=Buffer.concat([decipher.update(envelope.subarray(34+length)),decipher.final()]);
   if(decoded.length!==metadata.byteLength||hash(decoded)!==metadata.sha256)fail('PRIVATE_OBJECT_INTEGRITY');await guard('after_io');
   return {url:q.url,status:200,redirected:false,body:Uint8Array.from(decoded)};
  }catch(e){if(published)throw error('PRIVATE_OBJECT_OUTCOME_UNCERTAIN');if(e?.code==='PRIVATE_OBJECT_INTEGRITY')throw error(e.code);throw error('PRIVATE_OBJECT_DENIED');}
  finally{await handle?.close().catch(()=>{});if(temp)try{await unlink(temp);await durableDirectory(root);}catch{}plaintext?.fill(0);key?.fill(0);envelope?.fill(0);decoded?.fill(0);active--;}
 };
 return async input=>{
  let timer,stopped=false;const writing=!types.isProxy(input)&&Object.getOwnPropertyDescriptor(input??{},'method')?.value==='POST';
  const work=run(input);const bounded=work.then(value=>{if(stopped){value.body?.fill(0);throw error(writing?'PRIVATE_OBJECT_OUTCOME_UNCERTAIN':'PRIVATE_OBJECT_DENIED');}return value;});
  try{return await Promise.race([bounded,new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(error(writing?'PRIVATE_OBJECT_OUTCOME_UNCERTAIN':'PRIVATE_OBJECT_DENIED'));},10000);})]);}
  finally{clearTimeout(timer);void bounded.catch(()=>{});}
 };
}
