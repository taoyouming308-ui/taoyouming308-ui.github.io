/** Node-only one-shot driver for a separately provisioned rootless Linux worker host.
 * No Docker socket belongs in the web/Edge app. No image build/pull/network fallback.
 */
import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {sniffPrivateImage,PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';
import {validatePrivateImageContainer} from './private-image-decoder.mjs';
import {validateDesignDerivative} from './design-candidate-provider.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new PrivateImageWorkerError(code);};
export class PrivateImageWorkerError extends Error{constructor(code){super(code);this.name='PrivateImageWorkerError';this.code=code;}}
export const WORKER_PROTOCOL='private-image-worker-v1';
const OUTPUT_LIMIT=100000;
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('IMAGE_WORKER_PROTOCOL_INVALID');};
export function createPrivateImageIsolationPlan(image,name){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^design-image-[a-f0-9-]{36}$/.test(name))fail('IMAGE_WORKER_CONFIG_INVALID');
 return Object.freeze(['create','--pull','never','--name',name,'--network','none','--log-driver','none','--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','1073741824','--memory-swap','1073741824','--cpus','1','--ulimit','core=0:0','--tmpfs','/work:rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=65532,gid=65532','--workdir','/work','--entrypoint','/usr/bin/python3','-i',image,'-I','/opt/design-worker/private-image-worker.py']);
}
/** Inspect the actual daemon result, never a caller-provided boolean attestation. */
export function verifyPrivateImageContainer(value,{image,name}){
 const v=value, h=v?.HostConfig,c=v?.Config;
 if(v?.Image!==image||v?.Name!=='/'+name||v?.State?.Running!==false||v?.State?.Status!=='created'||!h||!c||c.Image!==image||c.User!=='65532:65532'||c.WorkingDir!=='/work'||JSON.stringify(c.Entrypoint)!==JSON.stringify(['/usr/bin/python3'])||JSON.stringify(c.Cmd)!==JSON.stringify(['-I','/opt/design-worker/private-image-worker.py'])||!c.OpenStdin||c.Tty||h.NetworkMode!=='none'||h.LogConfig?.Type!=='none'||Object.keys(h.LogConfig?.Config??{}).length||h.Privileged||h.ReadonlyRootfs!==true||h.PidsLimit!==32||h.Memory!==1073741824||h.MemorySwap!==1073741824||h.NanoCpus!==1000000000||JSON.stringify(h.CapDrop)!==JSON.stringify(['ALL'])||(h.CapAdd?.length??0)!==0||!h.SecurityOpt?.includes('no-new-privileges')||h.SecurityOpt.some(s=>s!=='no-new-privileges')||(h.Binds?.length??0)!==0||(v.Mounts?.length??0)!==0||(h.Devices?.length??0)!==0||(h.DeviceRequests?.length??0)!==0||h.PidMode||h.IpcMode!=='private'||h.UTSMode||h.UsernsMode==='host'||h.PublishAllPorts||Object.keys(h.PortBindings??{}).length||Object.keys(h.Tmpfs??{}).join('|')!=='/work'||h.Tmpfs['/work']!=='rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=65532,gid=65532')fail('IMAGE_WORKER_ISOLATION_INVALID');
 // Immutable image environment must contain no injected credentials/configuration.
 const allowed=new Set(['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']);
 if(!Array.isArray(c.Env)||c.Env.some(e=>!allowed.has(e)))fail('IMAGE_WORKER_ISOLATION_INVALID');
 return true;
}
export function validatePrivateImageWorkerResult(text,input){
 if(typeof text!=='string'||Buffer.byteLength(text)>OUTPUT_LIMIT)fail('IMAGE_WORKER_PROTOCOL_INVALID');let v;try{v=JSON.parse(text);}catch{fail('IMAGE_WORKER_PROTOCOL_INVALID');}
 exact(v,['schemaVersion','sourceSha256','source','derivative']);exact(v.source,['mime','width','height','frameCount','decoded']);exact(v.derivative,['mime','width','height','sha256','bytesBase64']);
 const s=v.source,d=v.derivative;
 if(v.schemaVersion!==WORKER_PROTOCOL||v.sourceSha256!==hash(input)||s.mime!==sniffPrivateImage(input)||s.frameCount!==1||s.decoded!==true||![s.width,s.height].every(x=>Number.isSafeInteger(x)&&x>0&&x<=16384)||s.width*s.height>40000000||d.mime!=='image/png'||![d.width,d.height].every(x=>Number.isSafeInteger(x)&&x>0&&x<=128)||typeof d.bytesBase64!=='string'||d.bytesBase64.length>90000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d.bytesBase64))fail('IMAGE_WORKER_PROTOCOL_INVALID');
 const bytes=Buffer.from(d.bytesBase64,'base64');if(bytes.toString('base64')!==d.bytesBase64||hash(bytes)!==d.sha256)fail('IMAGE_WORKER_PROTOCOL_INVALID');
 try{validateDesignDerivative(bytes);}catch{fail('IMAGE_WORKER_PROTOCOL_INVALID');}
 if(bytes.readUInt32BE(16)!==d.width||bytes.readUInt32BE(20)!==d.height)fail('IMAGE_WORKER_PROTOCOL_INVALID');
 return {source:Object.freeze({...s}),derivative:{bytes:Uint8Array.from(bytes),mime:d.mime,sourceSha256:v.sourceSha256,metadataRemoved:true}};
}
function command(binary,socket,args,input,timeoutMs,maxBytes=OUTPUT_LIMIT){
 return new Promise((resolve,reject)=>{
 const child=spawn(binary,['--host','unix://'+socket,...args],{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'},stdio:['pipe','pipe','pipe']});let size=0,stderr=0,failed=false;const chunks=[];
 const abort=()=>{failed=true;child.kill('SIGKILL');};const timer=setTimeout(abort,timeoutMs);
 child.stdout.on('data',b=>{size+=b.length;if(size>maxBytes)abort();else chunks.push(b);});child.stderr.on('data',b=>{stderr+=b.length;if(stderr>4096)abort();});child.stdin.on('error',()=>{});
 child.on('error',()=>{clearTimeout(timer);reject(new PrivateImageWorkerError('IMAGE_WORKER_UNAVAILABLE'));});child.on('close',code=>{clearTimeout(timer);if(failed||code!==0||stderr)reject(new PrivateImageWorkerError('IMAGE_WORKER_REJECTED'));else resolve(Buffer.concat(chunks).toString('utf8'));});child.stdin.end(input);
 });
}
/** Exported coordinator is a protocol seam for synthetic mocks, not production attestation.
 * Production uses only createIsolatedPrivateImageWorker, which supplies real commands.
 */
export async function runPrivateImageWorkerProtocol({image,name,bytes,execute}){
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>PRIVATE_MEDIA_MAX_BYTES)fail('IMAGE_WORKER_INPUT_INVALID');bytes=Uint8Array.from(bytes);
 validatePrivateImageContainer(bytes,sniffPrivateImage(bytes));
 createPrivateImageIsolationPlan(image,name);const deadline=Date.now()+15000;const left=()=>{const n=deadline-Date.now();if(n<1)fail('IMAGE_WORKER_TIMEOUT');return n;};let created=false;
 try{
  // Cleanup by unique name even when create result is lost. Never target arbitrary names.
  created=true;await execute(createPrivateImageIsolationPlan(image,name),null,left());
  const inspected=JSON.parse(await execute(['inspect',name],null,left()));if(!Array.isArray(inspected)||inspected.length!==1)fail('IMAGE_WORKER_ISOLATION_INVALID');verifyPrivateImageContainer(inspected[0],{image,name});
  const result=await execute(['start','--attach','--interactive',name],bytes,left());
  return validatePrivateImageWorkerResult(result,bytes);
 }catch(e){if(e instanceof PrivateImageWorkerError)throw e;fail('IMAGE_WORKER_REJECTED');}
 finally{if(created){try{await execute(['rm','--force',name],null,5000);}catch{fail('IMAGE_WORKER_CLEANUP_UNCERTAIN');}}}
}
/** Validates reported capabilities; target-host enforcement tests remain required. */
export function verifyPrivateImageDaemonInfo(info){
 if(!info||info.OSType!=='linux'||info.CgroupVersion!=='2'||info.CgroupDriver!=='systemd'||info.MemoryLimit!==true||info.SwapLimit!==true||info.PidsLimit!==true||info.CpuCfsPeriod!==true||info.CpuCfsQuota!==true||!Array.isArray(info.SecurityOptions)||!info.SecurityOptions.includes('name=rootless')||!info.SecurityOptions.includes('name=seccomp,profile=builtin'))fail('IMAGE_WORKER_HOST_UNSUPPORTED');
 return true;
}
export function createIsolatedPrivateImageWorker({enabled=false,dockerPath,image}={}){
 let busy=false,quarantined=false;
 const run=async input=>{
  if(enabled!==true)fail('IMAGE_WORKER_DISABLED');
  // No injectable platform and NO macOS synthetic bypass in this production factory.
  if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0)fail('IMAGE_WORKER_HOST_UNSUPPORTED');
  if(quarantined)fail('IMAGE_WORKER_CLEANUP_UNCERTAIN');if(busy)fail('IMAGE_WORKER_BUSY');
  if(!(input instanceof Uint8Array)||input.length<1||input.length>PRIVATE_MEDIA_MAX_BYTES)fail('IMAGE_WORKER_INPUT_INVALID');
  if(typeof dockerPath!=='string'||!dockerPath.startsWith('/'))fail('IMAGE_WORKER_CONFIG_INVALID');
  createPrivateImageIsolationPlan(image,'design-image-00000000-0000-0000-0000-000000000000');busy=true;
  try{
   const bytes=Uint8Array.from(input);validatePrivateImageContainer(bytes,sniffPrivateImage(bytes));
   const binary=await realpath(dockerPath),binaryStat=await stat(binary);if(!binaryStat.isFile()||(binaryStat.mode&0o022)!==0)fail('IMAGE_WORKER_CONFIG_INVALID');
   const socket='/run/user/'+process.getuid()+'/docker.sock',socketStat=await stat(socket);if(!socketStat.isSocket()||socketStat.uid!==process.getuid())fail('IMAGE_WORKER_HOST_UNSUPPORTED');
   const execute=(args,data,timeout)=>command(binary,socket,args,data,timeout);
   const info=JSON.parse(await execute(['info','--format','{{json .}}'],null,3000));
   verifyPrivateImageDaemonInfo(info);
   return await runPrivateImageWorkerProtocol({image,name:'design-image-'+randomUUID(),bytes,execute});
  }catch(e){if(e?.code==='IMAGE_WORKER_CLEANUP_UNCERTAIN')quarantined=true;if(e instanceof PrivateImageWorkerError)throw e;fail('IMAGE_WORKER_REJECTED');}
  finally{busy=false;}
 };
 return Object.freeze({process:run,async inspect(bytes){return (await run(bytes)).source;},async derive({bytes,sourceSha256}){if(!(bytes instanceof Uint8Array)||hash(bytes)!==sourceSha256)fail('IMAGE_WORKER_INPUT_INVALID');return (await run(bytes)).derivative;}});
}
