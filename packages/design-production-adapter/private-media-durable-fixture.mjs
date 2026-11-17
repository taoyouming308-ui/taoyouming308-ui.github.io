import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
/** Local SYNTHETIC fixture only: bytes+metadata publish in one atomic private manifest. */
import {promises as fs,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
export const MEDIA_FIXTURE_OPT_IN='synthetic-private-media-fixture-only';
const MAX_STORE=24*1024*1024,FORMAT='synthetic-private-media-durable-v1';
const hash=x=>createHash('sha256').update(x).digest('hex');
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const json=x=>JSON.stringify(canonical(x));
const copy=x=>JSON.parse(json(x));
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const exact=(x,keys)=>{if(!plain(x)||Object.keys(x).sort().join('|')!==keys.sort().join('|'))fail('MEDIA_FIXTURE_INVALID');};
function bindingOf(x){exact(x,['owner','store','scope']);if(!/^synthetic-[A-Za-z0-9_-]{1,80}$/.test(x.owner)||!/^synthetic-[A-Za-z0-9_-]{1,80}$/.test(x.store))fail('MEDIA_FIXTURE_SYNTHETIC_ONLY');return {owner:x.owner,store:x.store,scope:validateProductionDesignScope(x.scope)};}
export async function openSyntheticDurableMediaRepository({enabled=false,optIn,directory,allowedBindings,fixtureSha256,fault}={}){
 if(enabled!==true||optIn!==MEDIA_FIXTURE_OPT_IN||process.env.NODE_ENV==='production')fail('MEDIA_FIXTURE_DISABLED');
 if(!Array.isArray(allowedBindings)||!allowedBindings.length||!Array.isArray(fixtureSha256)||!fixtureSha256.length||!fixtureSha256.every(x=>/^[a-f0-9]{64}$/.test(x)))fail('MEDIA_FIXTURE_CONFIG_REQUIRED');
 const allowed=new Set(allowedBindings.map(x=>json(bindingOf(x)))),hashes=new Set(fixtureSha256);
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('MEDIA_FIXTURE_DIRECTORY_REQUIRED');
 const tmp=await fs.realpath(os.tmpdir());const parent=await fs.realpath(path.dirname(directory));
 if(!parent.startsWith(tmp+path.sep)||!path.basename(parent).startsWith('design-media-fixture-'))fail('MEDIA_FIXTURE_TEMP_ONLY');
 await fs.mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 return openExisting();
 async function openExisting(){
  const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))fail('MEDIA_FIXTURE_UNSAFE_DIRECTORY');
  const root=await fs.realpath(directory),manifest=path.join(root,'manifest.json'),lockPath=path.join(root,'.exclusive.lock'),markerPath=path.join(root,'.initialized');
  let lock;try{lock=await fs.open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{fail('MEDIA_FIXTURE_LOCKED');}
  const lockStat=await lock.stat();await lock.writeFile(FORMAT);await lock.sync();let closed=false,closing=false,tail=Promise.resolve();
  let expectedDigest=null,initialized=false;
  const permit=binding=>{const b=bindingOf(binding);if(!allowed.has(json(b)))fail('MEDIA_FIXTURE_SCOPE_DENIED');return b;};
  const objectKey=(binding,id)=>hash(json([binding,id]));
  function validate(data){
   exact(data,['format','commitRevision','objects','sha256']);if(data.format!==FORMAT||!Array.isArray(data.objects)||data.objects.length>16||data.commitRevision!==data.objects.length)fail('MEDIA_FIXTURE_CORRUPT');
   const {sha256,...body}=data;if(sha256!==hash(json(body)))fail('MEDIA_FIXTURE_CORRUPT');
   const ids=new Set();for(const item of data.objects){exact(item,['key','record','bytesBase64']);const r=item.record;
    exact(r,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);const b=permit(r.binding);
    if(typeof r.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.mediaId)||r.requestId!==r.mediaId||r.active!==true||!['before','after','reference'].includes(r.stage)||!['front','back','left','right','detail'].includes(r.angle)||!PHONE_SOURCE_MIMES.includes(r.mime)||!Number.isSafeInteger(r.width)||!Number.isSafeInteger(r.height)||r.width<1||r.height<1||r.width>16384||r.height>16384||r.width*r.height>40000000)fail('MEDIA_FIXTURE_CORRUPT');
    if(item.key!==objectKey(b,r.mediaId)||ids.has(item.key)||typeof item.bytesBase64!=='string'||item.bytesBase64.length>Math.ceil(PRIVATE_MEDIA_MAX_BYTES/3)*4)fail('MEDIA_FIXTURE_CORRUPT');ids.add(item.key);
    const bytes=Buffer.from(item.bytesBase64,'base64');if(bytes.toString('base64')!==item.bytesBase64||bytes.length!==r.byteLength||!bytes.length||bytes.length>PRIVATE_MEDIA_MAX_BYTES||hash(bytes)!==r.sha256||!hashes.has(r.sha256))fail('MEDIA_FIXTURE_CORRUPT');
   }return data;
  }
  function seal(objects){const body={format:FORMAT,commitRevision:objects.length,objects};return {...body,sha256:hash(json(body))};}
  async function read(){let h;try{h=await fs.open(manifest,constants.O_RDONLY|constants.O_NOFOLLOW);const s=await h.stat();if(!s.isFile()||s.size>MAX_STORE||(s.mode&0o077))fail('MEDIA_FIXTURE_CORRUPT');const bytes=await h.readFile();if(expectedDigest&&hash(bytes)!==expectedDigest)fail('MEDIA_FIXTURE_CHANGED');const data=validate(JSON.parse(bytes));expectedDigest=hash(bytes);initialized=true;return data;}catch(e){if(e.code==='ENOENT'&&!initialized)return seal([]);throw e;}finally{if(h)await h.close();}}
  async function publish(objects,guard){
   const data=validate(seal(objects)),bytes=Buffer.from(json(data)+'\n');if(bytes.length>MAX_STORE)fail('MEDIA_FIXTURE_CAPACITY');
   const pending=path.join(root,'.manifest-pending');let handle;
   try{handle=await fs.open(pending,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    if(fault)await fault('before_publish');await guard();await fs.rename(pending,manifest);expectedDigest=hash(bytes);initialized=true;
    const directoryHandle=await fs.open(root,constants.O_RDONLY);try{await directoryHandle.sync();}finally{await directoryHandle.close();}
    if(fault)await fault('after_publish');
   }finally{if(handle)await handle.close();await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async function close(){if(closed)return;closing=true;await tail;closed=true;await lock.close();const current=await fs.lstat(lockPath);if(current.ino!==lockStat.ino||current.dev!==lockStat.dev)fail('MEDIA_FIXTURE_LOCK_CHANGED');await fs.unlink(lockPath);}
  try{
   const entries=await fs.readdir(root);if(entries.some(x=>!['.exclusive.lock','manifest.json','.initialized'].includes(x)))fail('MEDIA_FIXTURE_UNEXPECTED_FILES');
   if(entries.includes('.initialized')){const marker=await fs.open(markerPath,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await marker.stat();if(!stat.isFile()||stat.size>128||(stat.mode&0o077)||(await marker.readFile('utf8'))!==FORMAT+'\n')fail('MEDIA_FIXTURE_CORRUPT');initialized=true;}finally{await marker.close();}}
   else if(entries.includes('manifest.json'))fail('MEDIA_FIXTURE_INITIALIZATION_INCOMPLETE');
   const wasInitialized=initialized,initial=await read();if(!wasInitialized){await publish(initial.objects,async()=>{});const marker=await fs.open(markerPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await marker.writeFile(FORMAT+'\n');await marker.sync();}finally{await marker.close();}const d=await fs.open(root,constants.O_RDONLY);try{await d.sync();}finally{await d.close();}}
  }catch(error){await close();throw error;}
  return Object.freeze({
   kind:'synthetic-durable-file',
   withScopeLock(binding,work){if(closed||closing)return Promise.reject(Object.assign(new Error('MEDIA_FIXTURE_CLOSED'),{code:'MEDIA_FIXTURE_CLOSED'}));const b=permit(binding);
    const run=tail.then(async()=>{const current=await read();let staged=null,guard=null,active=true;
     const requireActive=()=>{if(!active)fail('MEDIA_FIXTURE_TRANSACTION_CLOSED');};
     const lookup=id=>current.objects.find(row=>row.key===objectKey(b,id));
     const tx={readRecord:async id=>{requireActive();return copy(lookup(id)?.record??null);},readBytes:async id=>{requireActive();const row=lookup(id);if(!row)fail('MEDIA_FIXTURE_NOT_FOUND');return Uint8Array.from(Buffer.from(row.bytesBase64,'base64'));},
      insertImmutable:async({record,bytes})=>{requireActive();if(staged||lookup(record.mediaId))return false;if(json(record.binding)!==json(b)||!(bytes instanceof Uint8Array)||!hashes.has(hash(bytes)))fail('MEDIA_FIXTURE_SYNTHETIC_ONLY');staged={key:objectKey(b,record.mediaId),record:copy(record),bytesBase64:Buffer.from(bytes).toString('base64')};return true;},
      beforeCommit:fn=>{requireActive();if(guard||typeof fn!=='function')fail('MEDIA_FIXTURE_GUARD_REQUIRED');guard=fn;}};
     try{const result=await work(tx);if(staged){if(!guard)fail('MEDIA_FIXTURE_GUARD_REQUIRED');await publish([...current.objects,staged],guard);}return result;}finally{active=false;}
    });tail=run.catch(()=>{});return run;
   },close
  });
 }
}
