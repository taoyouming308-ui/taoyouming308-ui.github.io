/** Explicit local builder, never called on import by the application.
 * Existing Docker only. Optional downloads are fixed official URLs + SHA256.
 * No installation, production target, service start or credentials. */
import {readFile,writeFile,mkdtemp,mkdir,copyFile,cp,realpath,stat,chmod} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const work=arg('--work-root'),wheels=arg('--wheel-dir'),tag=arg('--tag');
if(!work||!wheels||![work,wheels].every(isAbsolute)||!/^design-phone-worker:[a-z0-9][a-z0-9_.-]{0,63}$/.test(tag??''))throw Error('Explicit --work-root ABS --wheel-dir ABS --tag design-phone-worker:local-tag required; --download optionally permits pinned public downloads');
const source=fileURLToPath(new URL('../packages/design-production-adapter/',import.meta.url)),lock=JSON.parse(await readFile(join(source,'phone-worker-lock.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const [name,provenance] of Object.entries(lock.strictJpeg.headerSources)){if(!['jpeglib.h','jmorecfg.h','LICENSE.md','README.ijg'].includes(name)||sha(await readFile(join(source,'vendor/jpeg',name)))!==provenance.sha256)throw Error('PHONE_BUILD_HEADER_HASH_MISMATCH');}
for(const dir of [work,wheels]){await mkdir(dir,{recursive:true,mode:0o700});if(await realpath(dir)!==dir||!(await stat(dir)).isDirectory())throw Error('PHONE_BUILD_PATH_DENIED');}
const context=await mkdtemp(join(work,'phone-build-'));await chmod(context,0o700);await mkdir(join(context,'vendor'));
for(const dep of [{name:lock.wheel,url:lock.url,sha256:lock.sha256},{name:lock.heifWheel,url:lock.heifUrl,sha256:lock.heifSha256}]){
 const p=join(wheels,dep.name);let bytes;try{bytes=await readFile(p);}catch{
  if(!process.argv.includes('--download'))throw Error('PHONE_BUILD_PINNED_WHEEL_MISSING');
  const u=new URL(dep.url);if(u.origin!=='https://files.pythonhosted.org')throw Error('PHONE_BUILD_URL_DENIED');
  const r=await fetch(u,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000)});if(!r.ok||Number(r.headers.get('content-length'))>16000000)throw Error('PHONE_BUILD_DOWNLOAD_FAILED');const parts=[];let size=0;for await(const part of r.body){size+=part.length;if(size>16000000)throw Error('PHONE_BUILD_DOWNLOAD_LIMIT');parts.push(part);}bytes=Buffer.concat(parts);
  if(sha(bytes)!==dep.sha256)throw Error('PHONE_BUILD_HASH_MISMATCH');await writeFile(p,bytes,{flag:'wx',mode:0o600});
 }
 if(bytes.length>16000000||sha(bytes)!==dep.sha256)throw Error('PHONE_BUILD_HASH_MISMATCH');await writeFile(join(context,'vendor',dep.name),bytes,{flag:'wx',mode:0o600});
}
for(const [a,b] of [['phone-worker.Dockerfile','Dockerfile'],['phone-native-worker.py','phone-native-worker.py'],['phone-strict-jpeg.c','phone-strict-jpeg.c']])await copyFile(join(source,a),join(context,b));await cp(join(source,'vendor/jpeg'),join(context,'vendor/jpeg'),{recursive:true});
async function docker(args,{output=null,timeout=120000}={}){return new Promise((resolve,reject)=>{const p=spawn(process.platform==='darwin'?'/usr/local/bin/docker':'/usr/bin/docker',args,{shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',DOCKER_CONFIG:'/nonexistent',HOME:'/nonexistent'}});let size=0;const parts=[];const timer=setTimeout(()=>p.kill('SIGKILL'),timeout);p.stdout.on('data',b=>{size+=b.length;if(size>(output?67108864:16000000))p.kill('SIGKILL');else parts.push(b);});p.stderr.on('data',b=>{size+=b.length;if(size>(output?67108864:16000000))p.kill('SIGKILL');else if(!output)process.stderr.write(b);});p.once('error',()=>{clearTimeout(timer);reject(Error('PHONE_BUILD_DOCKER_FAILED'));});p.once('close',async code=>{clearTimeout(timer);const bytes=Buffer.concat(parts);if(output)await writeFile(output,bytes,{mode:0o600});code===0?resolve(bytes):reject(Error('PHONE_BUILD_DOCKER_FAILED'));});});}
await docker(['image','inspect',lock.base]);await docker(['build','--platform=linux/arm64','--network=none','--label','design.phone.local-builder=true','--tag',tag,context]);const image=(await docker(['image','inspect','--format','{{.Id}}',tag])).toString().trim();if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('PHONE_BUILD_IMAGE_INVALID');await writeFile(join(work,'image-id.txt'),image+'\n',{mode:0o600});
if(process.argv.includes('--corpus'))try{await docker(['run','--rm','--name','design-phone-corpus-'+process.pid,'--label','design.phone.synthetic-corpus=true','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1g','--memory-swap=1g','--cpus=1','--pids-limit=32','--mount','type=bind,src='+fileURLToPath(new URL('./fixtures/phone-corpus.py',import.meta.url))+',dst=/fixture.py,readonly','--entrypoint=/usr/bin/python3',image,'-I','/fixture.py'],{output:join(work,'phone-corpus.json')});}catch(error){await docker(['rm','--force','design-phone-corpus-'+process.pid],{timeout:5000}).catch(()=>{});throw error;}
console.log(JSON.stringify({image,tag,context,syntheticCorpus:process.argv.includes('--corpus'),modelCalls:0,productionHostAcceptance:false}));
