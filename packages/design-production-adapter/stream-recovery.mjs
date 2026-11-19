/** Streaming offline recovery, DPR2. Never captures a live DB or executes SQL.
 * One AES-GCM stream authenticates the entire envelope. Restore first decrypts
 * to a hash/discard sink and authenticates final(), then extracts in a second
 * pass over the SAME open file, authenticates again and compares both digests.
 * No plaintext temporary archive or unauthenticated target is produced.
 * Caller owns stopped-writer consistency. Import has no I/O or activation. */
import {open,lstat,realpath,readdir,mkdir,link,unlink,rm} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,dirname,basename,isAbsolute,resolve} from 'node:path';
import {createHash,createCipheriv,createDecipheriv,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {types} from 'node:util';
import {unpackDesignRecoveryDirectory} from './offline-recovery.mjs';
export const STREAM_RECOVERY_LIMITS=Object.freeze({chunkBytes:1048576,manifestBytes:2097152,payloadBytes:16*1024**3,databaseBytes:8*1024**3,objects:10000});
const {chunkBytes:CHUNK,manifestBytes:MANIFEST,payloadBytes:MAX}=STREAM_RECOVERY_LIMITS;
const HEADER=48,OVERHEAD=HEADER+16+4+MANIFEST,MAGIC=Buffer.from('DPR2');
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=()=>{throw Error('DESIGN_RECOVERY_DENIED');};
const validPath=n=>['database.dump','roles.sql','secrets/master-key.bin'].includes(n)||/^objects\/[a-f0-9]{64}\.object$/.test(n);
const limit=n=>n==='database.dump'?STREAM_RECOVERY_LIMITS.databaseBytes:n==='roles.sql'?16*1024**2:n==='secrets/master-key.bin'?32:8388608+2048;
function origin(s){try{const u=new URL(s);if(u.protocol==='https:'&&u.origin===s&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))return;}catch{}fail();}
function check(signal){if(signal?.aborted)fail();}
function rawKey(value){if(types.isProxy(value)||!types.isUint8Array(value)||value.length!==32||types.isSharedArrayBuffer(value.buffer))fail();return Buffer.from(value);}
function derive(raw,header,storageOrigin){const b=rawKey(raw);try{return Buffer.from(hkdfSync('sha256',b,header.subarray(4,36),Buffer.from('design-offline-recovery-v2\n'+storageOrigin),32));}finally{b.fill(0);}}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();}
function same(a,b){return ['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].every(k=>a[k]===b[k]);}
async function directory(p){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p||await realpath(p)!==p)fail();const s=await lstat(p);if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)fail();}
async function source(p,max){let h;try{h=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await h.stat({bigint:true});if(!s.isFile()||s.uid!==BigInt(process.getuid())||(s.mode&0o777n)!==0o600n||s.nlink!==1n||s.size<1n||s.size>BigInt(max))fail();return {h,s};}catch(e){await h?.close();throw e;}}
async function syncDir(p){const h=await open(p,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
async function readExact(h,n,position){if(!Number.isSafeInteger(n)||n<0||n>MANIFEST)fail();const b=Buffer.alloc(n);let at=0;try{while(at<n){const r=await h.read(b,at,n-at,position+at);if(!r.bytesRead)fail();at+=r.bytesRead;}return b;}catch(e){b.fill(0);throw e;}}
async function readChunk(h,b,n,position,signal){let at=0;while(at<n){check(signal);const r=await h.read(b,at,n-at,position+at);if(!r.bytesRead)fail();at+=r.bytesRead;}return b.subarray(0,n);}
async function snapshotPaths(root){
 await directory(root);await directory(join(root,'objects'));await directory(join(root,'secrets'));
 if(JSON.stringify((await readdir(root)).sort())!==JSON.stringify(['database.dump','objects','roles.sql','secrets'])||JSON.stringify(await readdir(join(root,'secrets')))!=='["master-key.bin"]')fail();
 const names=(await readdir(join(root,'objects'))).sort();if(names.length>STREAM_RECOVERY_LIMITS.objects||names.some(n=>!validPath('objects/'+n)))fail();
 return ['database.dump','roles.sql','secrets/master-key.bin',...names.map(n=>'objects/'+n)].sort();
}
async function walkFile(path,expected,onChunk,signal){
 const {h,s}=await source(path,expected.max);const buffer=Buffer.alloc(CHUNK);let at=0;
 try{if(expected.stat&&!same(s,expected.stat))fail();while(at<Number(s.size)){check(signal);const n=Math.min(buffer.length,Number(s.size)-at);await onChunk(await readChunk(h,buffer,n,at,signal),at);buffer.fill(0,0,n);at+=n;}check(signal);if(!same(s,await h.stat({bigint:true})))fail();return s;}finally{buffer.fill(0);await h.close();}
}
function manifest(value,storageOrigin){
 exact(value,['schemaVersion','storageOrigin','entries']);if(value.schemaVersion!=='design-offline-recovery-v2'||value.storageOrigin!==storageOrigin||!Array.isArray(value.entries)||value.entries.length<3||value.entries.length>STREAM_RECOVERY_LIMITS.objects+3)fail();
 let total=0,last='';for(const e of value.entries){exact(e,['path','byteLength','sha256']);if(typeof e.path!=='string'||!validPath(e.path)||e.path<=last||!Number.isSafeInteger(e.byteLength)||e.byteLength<1||e.byteLength>limit(e.path)||e.path==='secrets/master-key.bin'&&e.byteLength!==32||!/^[a-f0-9]{64}$/.test(e.sha256))fail();last=e.path;total+=e.byteLength;if(total>MAX)fail();}
 if(!['database.dump','roles.sql','secrets/master-key.bin'].every(p=>value.entries.some(e=>e.path===p)))fail();return total;
}
export async function packStreamingDesignRecoveryDirectory({enabled=false,storageOrigin,snapshotDirectory,outputFile,backupKey,signal}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');let temp,owned=false,published=false,out,derived,metadata;
 try{
  origin(storageOrigin);check(signal);const paths=await snapshotPaths(snapshotDirectory),entries=[],stats=new Map();let total=0;
  for(const path of paths){const digest=createHash('sha256');const s=await walkFile(join(snapshotDirectory,path),{max:limit(path)},async(b,at)=>{
   if(path==='database.dump'&&at===0&&b.subarray(0,5).toString()!=='PGDMP')fail();
   if(path==='secrets/master-key.bin'){const k=rawKey(backupKey);try{if(b.length!==32||timingSafeEqual(b,k))fail();}finally{k.fill(0);}}
   digest.update(b);
  },signal);total+=Number(s.size);if(total>MAX)fail();stats.set(path,s);entries.push({path,byteLength:Number(s.size),sha256:digest.digest('hex')});}
  const m={schemaVersion:'design-offline-recovery-v2',storageOrigin,entries};manifest(m,storageOrigin);metadata=Buffer.from(JSON.stringify(m));if(metadata.length>MANIFEST)fail();
  if(typeof outputFile!=='string'||!isAbsolute(outputFile)||resolve(outputFile)!==outputFile||outputFile.startsWith(snapshotDirectory+'/')||!/^[A-Za-z0-9_-]{1,80}\.recovery$/.test(basename(outputFile)))fail();await directory(dirname(outputFile));
  const header=Buffer.concat([MAGIC,randomBytes(32),randomBytes(12)]);derived=derive(backupKey,header,storageOrigin);const cipher=createCipheriv('aes-256-gcm',derived,header.subarray(36),{authTagLength:16});cipher.setAAD(Buffer.concat([header,Buffer.from(storageOrigin)]));
  temp=join(dirname(outputFile),'.pending-recovery-v2-'+randomBytes(16).toString('hex'));out=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=true;await out.writeFile(header);
  async function encrypt(b){check(signal);const encrypted=cipher.update(b);try{await out.writeFile(encrypted);}finally{encrypted.fill(0);}}
  const prefix=Buffer.alloc(4);prefix.writeUInt32BE(metadata.length);await encrypt(prefix);await encrypt(metadata);
  for(const e of entries){const digest=createHash('sha256');await walkFile(join(snapshotDirectory,e.path),{max:limit(e.path),stat:stats.get(e.path)},async b=>{digest.update(b);await encrypt(b);},signal);if(digest.digest('hex')!==e.sha256)fail();}
  if(JSON.stringify(await snapshotPaths(snapshotDirectory))!==JSON.stringify(paths))fail();check(signal);
  const tail=cipher.final(),tag=cipher.getAuthTag();try{await out.writeFile(tail);await out.writeFile(tag);}finally{tail.fill(0);tag.fill(0);}await out.sync();await out.close();out=null;check(signal);await link(temp,outputFile);published=true;await syncDir(dirname(outputFile));
  return Object.freeze({format:'DPR2',files:entries.length,objects:entries.length-3,payloadBytes:total,encrypted:true,chunkBytes:CHUNK});
 }catch{throw Error(published?'DESIGN_RECOVERY_OUTCOME_UNCERTAIN':'DESIGN_RECOVERY_DENIED');}
 finally{derived?.fill(0);metadata?.fill(0);await out?.close().catch(()=>{});if(owned)try{await unlink(temp);await syncDir(dirname(temp));}catch(e){if(e?.code!=='ENOENT')throw Error(published?'DESIGN_RECOVERY_OUTCOME_UNCERTAIN':'DESIGN_RECOVERY_CLEANUP_UNCERTAIN');}}
}
async function* decrypt(h,s,header,tag,storageOrigin,backupKey,signal){
 let derived,plain;const buffer=Buffer.alloc(CHUNK);let position=HEADER,remaining=Number(s.size)-HEADER-16;
 try{
  derived=derive(backupKey,header,storageOrigin);const decipher=createDecipheriv('aes-256-gcm',derived,header.subarray(36),{authTagLength:16});decipher.setAAD(Buffer.concat([header,Buffer.from(storageOrigin)]));decipher.setAuthTag(tag);
  while(remaining){check(signal);const n=Math.min(remaining,CHUNK);plain=decipher.update(await readChunk(h,buffer,n,position,signal));buffer.fill(0,0,n);position+=n;remaining-=n;try{yield plain;}finally{plain.fill(0);plain=null;}}
  check(signal);plain=decipher.final();try{if(plain.length)yield plain;}finally{plain.fill(0);plain=null;}if(!same(s,await h.stat({bigint:true})))fail();
 }finally{derived?.fill(0);plain?.fill(0);buffer.fill(0);}
}
// Owns at most the current decrypted chunk plus the bounded requested buffer.
function reader(generator){let current=null,at=0,done=false;const digest=createHash('sha256');
 async function next(){if(done)return false;const r=await generator.next();if(r.done){done=true;current=null;return false;}current=r.value;at=0;digest.update(current);return true;}
 return {async take(n){if(!Number.isSafeInteger(n)||n<0||n>MANIFEST)fail();const b=Buffer.alloc(n);let pos=0;try{while(pos<n){if(!current||at===current.length){if(!await next())fail();}const size=Math.min(n-pos,current.length-at);current.copy(b,pos,at,at+size);pos+=size;at+=size;}return b;}catch(e){b.fill(0);throw e;}},async finish(){if(current&&at!==current.length)fail();while(await next()){if(current.length)fail();}return digest.digest('hex');},async close(){await generator.return();}};
}
export async function unpackStreamingDesignRecoveryDirectory({enabled=false,storageOrigin,inputFile,targetDirectory,backupKey,signal}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');let h,s,stream,created=false,metadata,tag,header;
 try{
  origin(storageOrigin);check(signal);if(typeof inputFile!=='string'||!isAbsolute(inputFile)||resolve(inputFile)!==inputFile||typeof targetDirectory!=='string'||!isAbsolute(targetDirectory)||resolve(targetDirectory)!==targetDirectory||!/^[A-Za-z0-9_-]{1,80}$/.test(basename(targetDirectory)))fail();await directory(dirname(inputFile));await directory(dirname(targetDirectory));
  ({h,s}=await source(inputFile,MAX+OVERHEAD));const magic=await readExact(h,4,0);
  if(magic.toString()==='DPR1'){await h.close();h=null;check(signal);return {...await unpackDesignRecoveryDirectory({enabled:true,storageOrigin,inputFile,targetDirectory,backupKey}),format:'DPR1'};}
  if(!magic.equals(MAGIC)||s.size<BigInt(HEADER+16+4))fail();header=await readExact(h,HEADER,0);tag=await readExact(h,16,Number(s.size)-16);
  // Discard unverified plaintext. No paths are interpreted or targets created.
  const firstHash=createHash('sha256');for await(const b of decrypt(h,s,header,tag,storageOrigin,backupKey,signal))firstHash.update(b);const verifiedHash=firstHash.digest('hex');check(signal);
  stream=reader(decrypt(h,s,header,tag,storageOrigin,backupKey,signal));const prefix=await stream.take(4);const length=prefix.readUInt32BE(0);prefix.fill(0);if(length<1||length>MANIFEST)fail();metadata=await stream.take(length);const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata)),total=manifest(m,storageOrigin);
  if(Number(s.size)!==HEADER+16+4+length+total)fail();check(signal);await mkdir(targetDirectory,{mode:0o700});created=true;await mkdir(join(targetDirectory,'objects'),{mode:0o700});await mkdir(join(targetDirectory,'secrets'),{mode:0o700});
  for(const e of m.entries){let out;const digest=createHash('sha256');let remaining=e.byteLength,at=0;
   try{out=await open(join(targetDirectory,e.path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);while(remaining){check(signal);const b=await stream.take(Math.min(remaining,CHUNK));try{if(e.path==='database.dump'&&at===0&&b.subarray(0,5).toString()!=='PGDMP')fail();if(e.path==='secrets/master-key.bin'){const k=rawKey(backupKey);try{if(b.length!==32||timingSafeEqual(b,k))fail();}finally{k.fill(0);}}digest.update(b);await out.writeFile(b);remaining-=b.length;at+=b.length;}finally{b.fill(0);}}if(digest.digest('hex')!==e.sha256)fail();await out.sync();}finally{await out?.close();}
  }
  if(await stream.finish()!==verifiedHash)fail();check(signal);for(const p of ['objects','secrets',''])await syncDir(join(targetDirectory,p));await syncDir(dirname(targetDirectory));
  return Object.freeze({format:'DPR2',files:m.entries.length,objects:m.entries.length-3,payloadBytes:total,chunkBytes:CHUNK,databaseSha256:m.entries.find(e=>e.path==='database.dump').sha256});
 }catch(e){if(created)try{await rm(targetDirectory,{recursive:true,force:true});}catch{throw Error('DESIGN_RECOVERY_CLEANUP_UNCERTAIN');}if(e?.message==='DESIGN_RECOVERY_CLEANUP_UNCERTAIN')throw e;fail();}
 finally{await stream?.close().catch(()=>{});await h?.close();metadata?.fill(0);tag?.fill(0);header?.fill(0);}
}
