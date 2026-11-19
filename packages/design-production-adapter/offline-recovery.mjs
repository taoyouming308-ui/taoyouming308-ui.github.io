/** Offline snapshot envelope, never a DB client or online backup coordinator.
 * Caller must first stop writers and capture a matching DB/roles/object/key set.
 * SQL is opaque and is NEVER executed here. Restore creates a NEW private dir.
 * No import reads env, keys, customer files or opens a network connection. */
import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {open,lstat,realpath,readdir,mkdir,link,unlink,rm} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,dirname,basename,isAbsolute,resolve} from 'node:path';
import {types} from 'node:util';
const MAX=64*1024*1024,HEAD=65536,MAGIC=Buffer.from('DPR1'),hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('DESIGN_RECOVERY_DENIED');};
const validPath=n=>['database.dump','roles.sql','secrets/master-key.bin'].includes(n)||/^objects\/[a-f0-9]{64}\.object$/.test(n);
const limit=n=>n==='database.dump'?32*1024*1024:n==='roles.sql'?2*1024*1024:n==='secrets/master-key.bin'?32:8388608+2048;
function origin(s){try{const u=new URL(s);if(u.protocol==='https:'&&u.origin===s&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))return s;}catch{}fail();}
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v)||types.isSharedArrayBuffer(v.buffer)||v.length<1||v.length>max)fail();return Buffer.from(v);}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();}
function key(raw,storageOrigin){const b=bytes(raw,32);try{if(b.length!==32)fail();return Buffer.from(hkdfSync('sha256',b,Buffer.from(storageOrigin),'design-offline-recovery-v1',32));}finally{b.fill(0);}}
function validate(entries){
 if(!Array.isArray(entries)||entries.length<3||entries.length>131)fail();let size=0,last='';
 for(const e of entries){exact(e,['path','byteLength','sha256']);if(typeof e.path!=='string'||!validPath(e.path)||e.path<=last||!Number.isSafeInteger(e.byteLength)||e.byteLength<1||e.byteLength>limit(e.path)||e.path==='secrets/master-key.bin'&&e.byteLength!==32||!/^[a-f0-9]{64}$/.test(e.sha256))fail();last=e.path;size+=e.byteLength;}
 if(size>MAX||!['database.dump','roles.sql','secrets/master-key.bin'].every(n=>entries.some(e=>e.path===n)))fail();return size;
}
export function sealDesignRecovery({enabled=false,storageOrigin,files,backupKey}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');let derived,plain;const owned=[];
 try{
  origin(storageOrigin);if(!Array.isArray(files)||files.length>131)fail();
  const sorted=[...files].sort((a,b)=>String(a.path).localeCompare(String(b.path),'en'));
  let total=0;const entries=sorted.map(f=>{exact(f,['path','bytes']);if(!validPath(f.path))fail();const b=bytes(f.bytes,limit(f.path));owned.push(b);total+=b.length;if(total>MAX)fail();return {path:f.path,byteLength:b.length,sha256:hash(b)};});
  validate(entries);const master=owned[entries.findIndex(e=>e.path==='secrets/master-key.bin')],raw=bytes(backupKey,32);try{if(raw.length!==32||timingSafeEqual(raw,master))fail();}finally{raw.fill(0);}
  const db=owned[entries.findIndex(e=>e.path==='database.dump')];if(db.subarray(0,5).toString()!=='PGDMP')fail();
  const metadata=Buffer.from(JSON.stringify({schemaVersion:'design-offline-recovery-v1',storageOrigin,entries}));if(metadata.length>HEAD)fail();
  const length=Buffer.alloc(4);length.writeUInt32BE(metadata.length);plain=Buffer.concat([length,metadata,...owned]);derived=key(backupKey,storageOrigin);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(Buffer.concat([MAGIC,Buffer.from(storageOrigin)]));
  return Buffer.concat([MAGIC,iv,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
 }catch{fail();}finally{derived?.fill(0);plain?.fill(0);owned.forEach(b=>b.fill(0));}
}
export function openDesignRecovery({enabled=false,storageOrigin,envelope,backupKey}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');let input,derived,plain;const output=[];
 try{
  origin(storageOrigin);input=bytes(envelope,MAX+HEAD+64);if(input.length<40||!input.subarray(0,4).equals(MAGIC))fail();derived=key(backupKey,storageOrigin);
  const decipher=createDecipheriv('aes-256-gcm',derived,input.subarray(4,16));decipher.setAAD(Buffer.concat([MAGIC,Buffer.from(storageOrigin)]));decipher.setAuthTag(input.subarray(-16));
  const first=decipher.update(input.subarray(16,-16));try{plain=Buffer.concat([first,decipher.final()]);}finally{first.fill(0);}
  if(plain.length<4)fail();const n=plain.readUInt32BE(0);if(n>HEAD||n<1||4+n>plain.length)fail();
  const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain.subarray(4,4+n)));exact(m,['schemaVersion','storageOrigin','entries']);
  if(m.schemaVersion!=='design-offline-recovery-v1'||m.storageOrigin!==storageOrigin||4+n+validate(m.entries)!==plain.length)fail();let at=4+n;
  for(const e of m.entries){const b=plain.subarray(at,at+e.byteLength);if(hash(b)!==e.sha256)fail();output.push({path:e.path,bytes:Buffer.from(b)});at+=e.byteLength;}
  if(output.find(f=>f.path==='database.dump').bytes.subarray(0,5).toString()!=='PGDMP')fail();
  return {files:output,summary:Object.freeze({schemaVersion:m.schemaVersion,storageOrigin,files:output.length,objects:output.filter(f=>f.path.startsWith('objects/')).length,databaseSha256:m.entries.find(e=>e.path==='database.dump').sha256})};
 }catch{output.forEach(f=>f.bytes.fill(0));fail();}finally{input?.fill(0);derived?.fill(0);plain?.fill(0);}
}
async function directory(path){if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||await realpath(path)!==path)fail();const s=await lstat(path);if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)fail();}
async function file(path,max){let h,b,returned=false;try{h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await h.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.nlink!==1||s.size<1||s.size>max)fail();b=Buffer.alloc(s.size+1);let n=0;while(n<b.length){const r=await h.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}const after=await h.stat();if(n!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs)fail();returned=true;return b.subarray(0,n);}finally{if(!returned)b?.fill(0);await h?.close();}}
async function writeNew(path,b,onCreated){const h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{onCreated?.();await h.writeFile(b);await h.sync();}finally{await h.close();}}
async function syncDir(path){const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
export async function packDesignRecoveryDirectory({enabled=false,storageOrigin,snapshotDirectory,outputFile,backupKey}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');const files=[];let envelope,temp,tempOwned=false,published=false;
 try{
  await directory(snapshotDirectory);await directory(join(snapshotDirectory,'objects'));await directory(join(snapshotDirectory,'secrets'));
  if(JSON.stringify((await readdir(snapshotDirectory)).sort())!==JSON.stringify(['database.dump','objects','roles.sql','secrets'])||JSON.stringify(await readdir(join(snapshotDirectory,'secrets')))!=='["master-key.bin"]')fail();
  const objects=(await readdir(join(snapshotDirectory,'objects'))).sort();if(objects.length>128||objects.some(n=>!validPath('objects/'+n)))fail();
  let total=0;for(const n of ['database.dump','roles.sql','secrets/master-key.bin',...objects.map(n=>'objects/'+n)]){const b=await file(join(snapshotDirectory,n),limit(n));files.push({path:n,bytes:b});total+=b.length;if(total>MAX)fail();}
  // The caller owns quiescence; reject obvious in-snapshot mutation as well.
  if(JSON.stringify((await readdir(join(snapshotDirectory,'objects'))).sort())!==JSON.stringify(objects))fail();
  for(const f of files){const b=await file(join(snapshotDirectory,f.path),limit(f.path));try{if(!b.equals(f.bytes))fail();}finally{b.fill(0);}}
  if(typeof outputFile!=='string'||!isAbsolute(outputFile)||resolve(outputFile)!==outputFile||outputFile.startsWith(snapshotDirectory+'/')||!/^[A-Za-z0-9_-]{1,80}\.recovery$/.test(basename(outputFile)))fail();await directory(dirname(outputFile));
  envelope=sealDesignRecovery({enabled:true,storageOrigin,files,backupKey});temp=join(dirname(outputFile),'.pending-recovery-'+randomBytes(16).toString('hex'));await writeNew(temp,envelope,()=>{tempOwned=true;});await link(temp,outputFile);published=true;await syncDir(dirname(outputFile));
  return Object.freeze({files:files.length,objects:objects.length,encrypted:true});
 }catch{throw Error(published?'DESIGN_RECOVERY_OUTCOME_UNCERTAIN':'DESIGN_RECOVERY_DENIED');}finally{files.forEach(f=>f.bytes.fill(0));envelope?.fill(0);if(tempOwned)try{await unlink(temp);await syncDir(dirname(temp));}catch(e){if(e?.code!=='ENOENT')throw Error(published?'DESIGN_RECOVERY_OUTCOME_UNCERTAIN':'DESIGN_RECOVERY_CLEANUP_UNCERTAIN');}}
}
export async function unpackDesignRecoveryDirectory({enabled=false,storageOrigin,inputFile,targetDirectory,backupKey}={}){
 if(enabled!==true)throw Error('DESIGN_RECOVERY_DISABLED');let envelope,opened,created=false;
 try{
  if(typeof inputFile!=='string'||!isAbsolute(inputFile)||resolve(inputFile)!==inputFile||typeof targetDirectory!=='string'||!isAbsolute(targetDirectory)||resolve(targetDirectory)!==targetDirectory||!/^[A-Za-z0-9_-]{1,80}$/.test(basename(targetDirectory)))fail();
  await directory(dirname(inputFile));await directory(dirname(targetDirectory));envelope=await file(inputFile,MAX+HEAD+64);opened=openDesignRecovery({enabled:true,storageOrigin,envelope,backupKey});
  await mkdir(targetDirectory,{mode:0o700});created=true;await mkdir(join(targetDirectory,'objects'),{mode:0o700});await mkdir(join(targetDirectory,'secrets'),{mode:0o700});
  for(const f of opened.files)await writeNew(join(targetDirectory,f.path),f.bytes);
  for(const n of ['objects','secrets',''])await syncDir(join(targetDirectory,n));await syncDir(dirname(targetDirectory));
  return opened.summary;
 }catch{if(created)try{await rm(targetDirectory,{recursive:true,force:true});}catch{throw Error('DESIGN_RECOVERY_CLEANUP_UNCERTAIN');}fail();}finally{envelope?.fill(0);opened?.files.forEach(f=>f.bytes.fill(0));}
}
