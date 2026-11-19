import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,hkdfSync} from 'node:crypto';import {mkdtemp,realpath,mkdir,chmod,writeFile,readFile,rm,lstat,symlink,link,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {sealDesignRecovery,openDesignRecovery,packDesignRecoveryDirectory,unpackDesignRecoveryDirectory} from '../packages/design-production-adapter/offline-recovery.mjs';
const storageOrigin='https://recovery-synthetic.supabase.co',backupKey=Buffer.alloc(32,7),name='objects/'+'a'.repeat(64)+'.object';
const files=()=>[{path:'database.dump',bytes:Buffer.from('PGDMPsynthetic-not-a-real-dump')},{path:'roles.sql',bytes:Buffer.from('-- synthetic roles only\n')},{path:'secrets/master-key.bin',bytes:Buffer.alloc(32,9)},{path:name,bytes:Buffer.from('DPO1synthetic encrypted object')}];
const seal=(extra={})=>sealDesignRecovery({enabled:true,storageOrigin,files:files(),backupKey,...extra});
const open=(envelope,extra={})=>openDesignRecovery({enabled:true,storageOrigin,envelope,backupKey,...extra});
test('default closed; authenticated roundtrip preserves every byte and leaves caller input untouched',()=>{
 assert.throws(()=>sealDesignRecovery(),/DISABLED/);assert.throws(()=>openDesignRecovery(),/DISABLED/);const f=files(),before=f.map(x=>Buffer.from(x.bytes)),b=seal({files:f}),r=open(b);
 try{assert.equal(r.summary.objects,1);for(let i=0;i<f.length;i++){assert(f[i].bytes.equals(before[i]));assert(r.files.find(x=>x.path===f[i].path).bytes.equals(f[i].bytes));}assert(!b.includes(f[2].bytes));assert(!b.includes(Buffer.from('database.dump')));}finally{r.files.forEach(x=>x.bytes.fill(0));b.fill(0);}
});
test('fresh nonces, wrong key/namespace, truncation, appended bytes and ciphertext mutation fail closed',()=>{
 const a=seal(),b=seal();assert(!a.equals(b));for(const [value,extra] of [[a,{backupKey:Buffer.alloc(32,8)}],[a,{storageOrigin:'https://other.supabase.co'}],[a.subarray(0,-1),{}],[Buffer.concat([a,Buffer.from([0])]),{}],[Buffer.from(a),{}]]){if(value.length===a.length&&!value.equals(a))value[20]^=1;else if(value!==a&&value.length===a.length)value[20]^=1;assert.throws(()=>open(value,extra),/DENIED/);}a.fill(0);b.fill(0);
});
test('object and backup keys must differ; exact bounds, fixed file names and duplicates are enforced',()=>{
 assert.throws(()=>seal({backupKey:Buffer.alloc(32,9)}));assert.throws(()=>seal({backupKey:Buffer.alloc(31)}));
 for(const f of [[...files(),files()[0]],files().map(x=>x.path===name?{...x,path:'../outside'}:x),files().filter(x=>x.path!=='roles.sql'),files().map(x=>x.path==='database.dump'?{...x,bytes:Buffer.from('not pg_dump')}:x),files().map(x=>x.path===name?{...x,bytes:Buffer.alloc(8388608+2049)}:x)])assert.throws(()=>seal({files:f}),/DENIED/);
 const shared=new Uint8Array(new SharedArrayBuffer(32));assert.throws(()=>seal({backupKey:shared}),/DENIED/);
});
test('authenticated malformed manifests cannot escape paths or bypass hash/length/exact-schema checks',()=>{
 // Correct authentication deliberately isolates plaintext validation from GCM.
 const good=seal(),valid=open(good),entries=valid.files.map(f=>({path:f.path,byteLength:f.bytes.length,sha256:'0'.repeat(64)}));
 const malformed=[{entries},{entries:entries.map((e,i)=>i?e:{...e,path:'../escape'})},{entries,unknown:true},{entries:entries.slice(1)},{entries:[entries[0],entries[0],...entries.slice(1)]}];
 for(const patch of malformed){const meta=Buffer.from(JSON.stringify({schemaVersion:'design-offline-recovery-v1',storageOrigin,...patch})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(meta.length);const plain=Buffer.concat([prefix,meta,...valid.files.map(f=>f.bytes)]),derived=hkdfSync('sha256',backupKey,Buffer.from(storageOrigin),'design-offline-recovery-v1',32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',derived,iv);c.setAAD(Buffer.concat([Buffer.from('DPR1'),Buffer.from(storageOrigin)]));const bad=Buffer.concat([Buffer.from('DPR1'),iv,c.update(plain),c.final(),c.getAuthTag()]);assert.throws(()=>open(bad),/DENIED/);plain.fill(0);bad.fill(0);}
 valid.files.forEach(f=>f.bytes.fill(0));good.fill(0);
});
async function fixture(work){const snapshot=join(work,'snapshot');await mkdir(snapshot,{mode:0o700});for(const n of ['objects','secrets'])await mkdir(join(snapshot,n),{mode:0o700});for(const f of files())await writeFile(join(snapshot,f.path),f.bytes,{mode:0o600});return snapshot;}
async function temporary(work){return realpath(await mkdtemp(join(tmpdir(),work)));}
test('actual private disk pack/unpack, permissions and duplicate destination refusal preserve originals',async()=>{
 const dir=await temporary('design-recovery-');try{await chmod(dir,0o700);const snapshot=await fixture(dir),outputFile=join(dir,'backup.recovery');await packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile,backupKey});const before=await readFile(outputFile);assert.equal((await lstat(outputFile)).mode&0o777,0o600);assert.equal((await lstat(outputFile)).nlink,1,'acknowledged archive has no leftover publication hardlink');
  await assert.rejects(packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile,backupKey}));assert((await readFile(outputFile)).equals(before));
  const target=join(dir,'restored');const result=await unpackDesignRecoveryDirectory({enabled:true,storageOrigin,inputFile:outputFile,targetDirectory:target,backupKey});assert.equal(result.objects,1);assert.equal((await lstat(target)).mode&0o777,0o700);
  for(const f of files()){assert((await readFile(join(target,f.path))).equals(f.bytes));assert.equal((await lstat(join(target,f.path))).mode&0o777,0o600);}
  await assert.rejects(unpackDesignRecoveryDirectory({enabled:true,storageOrigin,inputFile:outputFile,targetDirectory:target,backupKey}));assert((await readFile(join(target,'database.dump'))).equals(files()[0].bytes));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('bad key and tamper create no restore directory; unsafe input permissions/links and extra files are denied',async()=>{
 const dir=await temporary('design-recovery-');try{await chmod(dir,0o700);const snapshot=await fixture(dir),outputFile=join(dir,'backup.recovery');await packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile,backupKey});const options={enabled:true,storageOrigin,inputFile:outputFile,targetDirectory:join(dir,'denied'),backupKey:Buffer.alloc(32,3)};await assert.rejects(unpackDesignRecoveryDirectory(options));assert(!(await readdir(dir)).includes('denied'));const corrupt=await readFile(outputFile);corrupt[corrupt.length-1]^=1;await writeFile(outputFile,corrupt,{mode:0o600});await assert.rejects(unpackDesignRecoveryDirectory({...options,backupKey}));assert(!(await readdir(dir)).includes('denied'));
  const db=join(snapshot,'database.dump');await chmod(db,0o644);await assert.rejects(packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile:join(dir,'unsafe.recovery'),backupKey}));await chmod(db,0o600);
  await link(db,join(dir,'hardlink'));await assert.rejects(packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile:join(dir,'unsafe.recovery'),backupKey}));await rm(join(dir,'hardlink'));
  await writeFile(join(snapshot,'unexpected'),Buffer.from('do not include'),{mode:0o600});await assert.rejects(packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:snapshot,outputFile:join(dir,'unsafe.recovery'),backupKey}));await rm(join(snapshot,'unexpected'));
  await symlink(snapshot,join(dir,'snapshot-link'));await assert.rejects(packDesignRecoveryDirectory({enabled:true,storageOrigin,snapshotDirectory:join(dir,'snapshot-link'),outputFile:join(dir,'unsafe.recovery'),backupKey}));assert(!(await readdir(dir)).includes('unsafe.recovery'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('actual offline CLI packs/unpacks with separate protected key and never executes SQL',async()=>{
 const dir=await temporary('design-recovery-cli-');try{await chmod(dir,0o700);const snapshot=await fixture(dir),keys=join(dir,'keys');await mkdir(keys,{mode:0o700});await writeFile(join(keys,'recovery-key.bin'),backupKey,{mode:0o600});const script=fileURLToPath(new URL('./design-offline-recovery.mjs',import.meta.url)),archive=join(dir,'cli.recovery'),target=join(dir,'restored');
  const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000});for(const args of [['pack','--snapshot',snapshot,'--file',archive],['unpack','--target',target,'--file',archive]]){const r=run([...args,'--key-directory',keys,'--origin',storageOrigin]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).sqlExecuted,false);assert.equal(r.stderr,'');}
  assert((await readFile(join(target,'secrets/master-key.bin'))).equals(Buffer.alloc(32,9)));await chmod(join(keys,'recovery-key.bin'),0o644);const denied=run(['unpack','--target',join(dir,'denied'),'--file',archive,'--key-directory',keys,'--origin',storageOrigin]);assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stderr).code,'DESIGN_RECOVERY_DENIED');assert(!(await readdir(dir)).includes('denied'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
