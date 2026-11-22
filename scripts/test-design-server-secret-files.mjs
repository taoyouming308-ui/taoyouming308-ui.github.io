import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,chmod,symlink,link,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes,webcrypto} from 'node:crypto';
import {createDesignFileSecretProvider} from '../packages/design-production-adapter/server-secret-files.mjs';
import {createImmutableDesignKeySealer} from '../packages/design-production-adapter/key-crypto.mjs';
const purpose={purpose:'design-immutable-key-v2'};
test('default closed before reading a path',()=>assert.rejects(createDesignFileSecretProvider()(purpose),/DESIGN_SERVER_SECRET_UNAVAILABLE/));
test('private binary key works with actual existing AES-GCM sealer and authority AAD',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'design-secret-')));try{
  await chmod(directory,0o700);const secret=randomBytes(32);await writeFile(join(directory,'master-key.bin'),secret,{mode:0o600});
  const provider=createDesignFileSecretProvider({enabled:true,directory}),value=await provider(purpose);assert.deepEqual(Buffer.from(value),secret);value.fill(0);assert.deepEqual(Buffer.from(await provider(purpose)),secret);
  const sealer=createImmutableDesignKeySealer({secretProvider:provider,cryptoProvider:webcrypto});
  const context={schemaVersion:'design-key-record-v2',owner:{subjectId:'synthetic-subject',employmentId:'synthetic-employment',membershipId:'synthetic-member',storeId:'synthetic-store'},securityEpoch:1,membershipRevision:1,revision:1,purpose:'chat',destination:'https://api.deepseek.com/chat/completions',model:'synthetic-model'};
  const plaintext='SYNTHETIC-ONLY-NOT-A-REAL-KEY',sealed=await sealer.seal(plaintext,context);assert(!JSON.stringify(sealed).includes(plaintext));assert.equal(await sealer.open(sealed,context),plaintext);await assert.rejects(sealer.open(sealed,{...context,securityEpoch:2}));secret.fill(0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('permissions, symlink paths, hardlinks, invalid sizes/names and unknown purposes fail closed',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'design-secret-negative-')));try{
  const directory=join(root,'private');await mkdir(directory,{mode:0o700});const file=join(directory,'master-key.bin');await writeFile(file,Buffer.alloc(32,7),{mode:0o600});const provider=createDesignFileSecretProvider({enabled:true,directory});
  await chmod(file,0o644);await assert.rejects(provider(purpose));await chmod(file,0o600);
  await chmod(directory,0o755);await assert.rejects(provider(purpose));await chmod(directory,0o700);
  await assert.rejects(provider({purpose:'arbitrary'}));await assert.rejects(createDesignFileSecretProvider({enabled:true,directory,name:'../master-key.bin'})(purpose));
  await symlink(directory,join(root,'alias'));await assert.rejects(createDesignFileSecretProvider({enabled:true,directory:join(root,'alias')})(purpose));
  await link(file,join(directory,'second.bin'));await assert.rejects(provider(purpose));await rm(join(directory,'second.bin'));
  await rm(file);await symlink(join(root,'missing'),file);await assert.rejects(provider(purpose));await rm(file);
  for(const n of [0,31,33,100000]){await writeFile(file,Buffer.alloc(n),{mode:0o600});await assert.rejects(provider(purpose));await rm(file);}
 }finally{await rm(root,{recursive:true,force:true});}
});
