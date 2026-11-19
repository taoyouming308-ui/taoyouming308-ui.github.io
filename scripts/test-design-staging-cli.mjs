import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,realpath,chmod,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./serve-design-staging.mjs',import.meta.url));
const source=`export async function prepareDesignStagingDependencies(){const deny=async()=>{throw Error('SYNTHETIC_PRIVATE_ERROR');};return {acquireClient:deny,worker:{inspect:deny,normalize:deny,derive:deny},mediaApprovalVerifier:{verifyImmutable:deny},storageOrigin:'https://cli-synthetic.supabase.co',privateMediaTransport:deny,verifyReady:async()=>true,close:async()=>{}};}`;
function child(args){const p=spawn(process.execPath,[script,...args],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);const ended=once(p,'exit');return {p,ended,output:()=>({stdout,stderr})};}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CLI_TEST_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}}
test('CLI rejects invalid args without bootstrap execution or private error output',async()=>{const c=child([]);try{assert.equal((await bounded(c.ended))[0],1);assert.deepEqual(JSON.parse(c.output().stderr),{event:'start_failed',modelsEnabled:false});assert.equal(c.output().stdout,'');}finally{c.p.kill('SIGKILL');}});
test('protected external synthetic bootstrap starts a real listener and SIGTERM closes it',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'design-staging-cli-')));let c;
 try{
  await chmod(dir,0o700);const file=join(dir,'bootstrap.mjs');await writeFile(file,source,{mode:0o600});
  // Reserve an ephemeral port, then release it before the child takes ownership.
  const {createServer}=await import('node:net'),reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  c=child(['--bootstrap',file,'--origin','https://cli.synthetic.invalid','--port',String(port)]);
  const ready=await bounded(new Promise((resolve,reject)=>{c.p.stdout.on('data',()=>{try{const v=JSON.parse(c.output().stdout.trim());if(v.event==='ready')resolve(v);}catch{}});void c.ended.then(()=>reject(Error('EARLY_EXIT')));}));
  assert.equal(ready.modelsEnabled,false);const r=await fetch('http://127.0.0.1:'+port+'/api/design/key-settings/read',{method:'POST',headers:{origin:'https://cli.synthetic.invalid','content-type':'application/json'},body:'{}'});assert.equal(r.status,404);
  c.p.kill('SIGTERM');assert.equal((await bounded(c.ended))[0],0);assert.equal(c.output().stderr,'');assert(c.output().stdout.includes('"event":"closed"'));await assert.rejects(fetch('http://127.0.0.1:'+port));
 }finally{c?.p.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
test('unprotected bootstrap is rejected before its code can execute',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'design-staging-cli-')));let c;
 try{await chmod(dir,0o700);const file=join(dir,'bootstrap.mjs');await writeFile(file,"console.log('MUST_NOT_IMPORT');throw Error('SYNTHETIC_PRIVATE_ERROR');",{mode:0o644});c=child(['--bootstrap',file,'--origin','https://cli.synthetic.invalid','--port','4281']);assert.equal((await bounded(c.ended))[0],1);assert.equal(c.output().stdout,'');assert(!c.output().stderr.includes('SYNTHETIC_PRIVATE_ERROR'));}finally{c?.p.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
