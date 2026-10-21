const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'public-shell-build-'));
const run=args=>cp.spawnSync(process.execPath,['scripts/build-app-shell.js',...args],{cwd:tmp,encoding:'utf8'});
(async()=>{
 try {
  const files=new Set([...require('./app-shell-files.json'),'version.txt','app-shell-sw.js','scripts/build-app-shell.js','scripts/app-shell-files.json','scripts/app-shell-worker-runtime.js']);
  for(const file of files){fs.mkdirSync(path.dirname(path.join(tmp,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(tmp,file));}
  assert.equal(run(['--check']).status,0);
  fs.appendFileSync(path.join(tmp,'operations-time.js'),'\n// changed fixture');assert.notEqual(run(['--check']).status,0,'stale resource hashes must fail the original release gate');assert.equal(run([]).status,0);
  const before=fs.readFileSync(path.join(tmp,'app-shell-sw.js'),'utf8').match(/"id": "([^"]+)"/)[1];
  fs.appendFileSync(path.join(tmp,'scripts/app-shell-worker-runtime.js'),'\n// runtime-only fixture');assert.equal(run([]).status,0);assert.notEqual(fs.readFileSync(path.join(tmp,'app-shell-sw.js'),'utf8').match(/"id": "([^"]+)"/)[1],before);
  const html=path.join(tmp,'frontdesk.html');fs.appendFileSync(html,'<script src="missing-public-code.js"></script>');assert.notEqual(run([]).status,0,'unreviewed dependency must block shell generation');
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
 // Execute the actual install callback: legacy unregister may leave a complete cache with one evicted entry.
 const handlers={},stored=new Map(),name='zysyr-public-shell-637-same',complete='https://example.test/__zysyr_public_shell_complete__';
 stored.set(complete,new Response('637'));let deleted=false;
 const cache={match:async key=>stored.get(key)?.clone(),put:async(key,value)=>stored.set(key,value)};
 const context={URL,Map,Response,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,SHELL:{version:637,id:'same',files:[{path:'one.js',types:['application/javascript'],versions:['637'],sha256:'not-needed'}]},self:{location:{href:'https://example.test/app-shell-sw.js'},addEventListener:(type,fn)=>handlers[type]=fn},caches:{keys:async()=>[name],open:async()=>cache,delete:async()=>{deleted=true;}},fetch:async()=>{throw Error('synthetic offline');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'app-shell-worker-runtime.js'),'utf8'),context);
 let install;handlers.install({waitUntil:p=>install=p});await assert.rejects(install);assert.equal(deleted,false,'same release failed reinstall must retain previously complete cache');assert.equal(await stored.get(complete).text(),'637');
 console.log('shell build and reinstall: stale hashes, missing dependency, runtime identity, legacy same-release failure protection passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
