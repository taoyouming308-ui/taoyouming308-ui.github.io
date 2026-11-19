/** Native source decoding in a fixed no-network container. Web services use the
 * mTLS broker client, not this Docker capability. Mac offline qualification is
 * explicitly separate from deployment host acceptance; no production bypass. */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {realpath,stat} from 'node:fs/promises';
import {sniffPrivateImage} from './private-media.mjs';
import {validatePrivateImageContainer} from './private-image-decoder.mjs';
import {inspectPhonePhotoDerivative} from './phone-photo-processing.mjs';
import {verifyPrivateImageDaemonInfo} from './private-image-worker-driver.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('PHONE_NATIVE_DENIED');};
const SECURITY=['--network=none','--log-driver=none','--read-only','--user=65532:65532','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=1073741824','--memory-swap=1073741824','--cpus=1','--ulimit=core=0:0','--tmpfs=/work:rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=65532,gid=65532','--workdir=/work'];
function command(binary,args,bytes,timeout=15000,max=1048576,signal){return new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'},stdio:['pipe','pipe','pipe']});let size=0,errors=0,stopped=false;const chunks=[];
 const stop=()=>{stopped=true;child.kill('SIGKILL');};const timer=setTimeout(stop,timeout);signal?.addEventListener('abort',stop,{once:true});
 child.stdout.on('data',b=>{size+=b.length;if(size>max)stop();else chunks.push(b);});child.stderr.on('data',b=>{errors+=b.length;if(errors>4096)stop();});child.stdin.on('error',()=>{});
 child.once('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(Error('PHONE_NATIVE_DENIED'));});
 child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(stopped||code!==0||errors){for(const b of chunks)b.fill(0);reject(Error('PHONE_NATIVE_DENIED'));}else{const output=Buffer.concat(chunks);chunks.forEach(b=>b.fill(0));resolve(output);}});
 if(signal?.aborted)stop();child.stdin.end(bytes);
});}
function inspect(v,image,name,operation){const h=v?.HostConfig,c=v?.Config;
 if(v?.Image!==image||v.Name!=='/'+name||v.State?.Status!=='created'||c?.User!=='65532:65532'||c.WorkingDir!=='/work'||JSON.stringify(c.Entrypoint)!=='["/usr/bin/python3"]'||JSON.stringify(c.Cmd)!==JSON.stringify(['-I','/opt/design-phone/worker.py',operation])||JSON.stringify(c.Env)!=='["PATH=/usr/bin:/bin"]'||!c.OpenStdin||c.Tty||h?.NetworkMode!=='none'||h.LogConfig?.Type!=='none'||h.Privileged||!h.ReadonlyRootfs||h.Memory!==1073741824||h.MemorySwap!==1073741824||h.PidsLimit!==32||h.NanoCpus!==1000000000||JSON.stringify(h.CapDrop)!=='["ALL"]'||(h.CapAdd?.length??0)||JSON.stringify(h.SecurityOpt)!=='["no-new-privileges"]'||h.PidMode||h.IpcMode!=='private'||h.UTSMode||h.UsernsMode==='host'||Object.keys(h.PortBindings??{}).length||(h.Devices?.length??0)||(h.DeviceRequests?.length??0)||(h.Binds?.length??0)||(v.Mounts?.length??0)||JSON.stringify(h.Tmpfs)!==JSON.stringify({'/work':'rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=65532,gid=65532'}))fail();
}
function binary(v,mime,max,edge){if(!v||Object.keys(v).sort().join('|')!=='byteLength|bytesBase64|height|mime|sha256|width'||v.mime!==mime||![v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=edge)||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>max||typeof v.bytesBase64!=='string'||v.bytesBase64.length>4*Math.ceil(max/3))fail();const b=Buffer.from(v.bytesBase64,'base64');if(b.toString('base64')!==v.bytesBase64||b.length!==v.byteLength||sha(b)!==v.sha256)fail();validatePrivateImageContainer(b,mime);return b;}
/** Low-level offline qualification coordinator, not a deployment factory. */
async function runJob({image,bytes,operation,signal}={},docker){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!['inspect','process','verify-clean'].includes(operation)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>8388608||signal!==undefined&&(!(signal instanceof AbortSignal)||signal.aborted))fail();
 const owned=Buffer.from(bytes);validatePrivateImageContainer(owned,sniffPrivateImage(owned));
 const name='design-phone-job-'+randomUUID(),deadline=performance.now()+15000;let attempted=false,output;
 const left=()=>{if(signal?.aborted)fail();const n=Math.floor(deadline-performance.now());if(n<=0)fail();return n;};
 try{
  attempted=true;await docker(['create','--pull=never','--name',name,...SECURITY,'--entrypoint=/usr/bin/python3','-i',image,'-I','/opt/design-phone/worker.py',operation],null,left(),4096,signal);
  const meta=JSON.parse((await docker(['inspect',name],null,left(),65536,signal)).toString());if(meta.length!==1)fail();inspect(meta[0],image,name,operation);
  output=await docker(['start','--attach','--interactive',name],owned,left(),1048576,signal);const r=JSON.parse(output.toString());
  if(r.schemaVersion!=='design-phone-native-v2'||r.sourceSha256!==sha(owned)||r.runtime?.pillowHeif!=='1.8.1'||r.runtime?.pillow!=='13.0.0'||r.runtime?.python!=='3.12.13'||r.source?.mime!==sniffPrivateImage(owned)||r.source.frameCount!==1||r.source.decoded!==true||![r.source.width,r.source.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384)||r.source.width*r.source.height>40000000)fail();
  if(Object.keys(r.source).sort().join('|')!=='decoded|frameCount|height|mime|width'||Object.keys(r.runtime).sort().join('|')!=='pillow|pillowHeif|python')fail();
  const keys=['runtime','schemaVersion','source','sourceSha256',...(operation==='process'?['derivative','normalized','orientationApplied']:operation==='verify-clean'?['metadataAbsent']:[])];if(Object.keys(r).sort().join('|')!==keys.sort().join('|'))fail();
  if(operation==='verify-clean'&&r.metadataAbsent!==true)fail();
  if(operation==='process'){
   const clean=binary(r.normalized,'image/jpeg',524288,1024),small=binary(r.derivative,'image/png',49152,108);
   try{const check=inspectPhonePhotoDerivative(small);if(check.width!==r.derivative.width||check.height!==r.derivative.height||!Number.isInteger(r.orientationApplied)||r.orientationApplied<1||r.orientationApplied>8)fail();}finally{clean.fill(0);small.fill(0);}
  }return r;
 }catch{fail();}finally{
  owned.fill(0);output?.fill(0);
  if(attempted)try{await docker(['rm','--force',name],null,5000,4096);}catch{throw Error('PHONE_NATIVE_CLEANUP_UNCERTAIN');}
 }
}
export const runOfflinePhoneNativeJob=q=>runJob(q,(args,...rest)=>command(process.platform==='darwin'?'/usr/local/bin/docker':'/usr/bin/docker',args,...rest));
/** Read-only deployment preflight. No container creation, pull or platform
 * override. Reported capabilities still require target enforcement acceptance. */
export async function qualifyPhoneNativeHost({image,dockerPath='/usr/bin/docker'}={}){
 if(process.platform!=='linux'||process.arch!=='arm64'||!process.getuid?.())throw Error('PHONE_NATIVE_HOST_UNSUPPORTED');
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('PHONE_NATIVE_IMAGE_UNSUPPORTED');
 try{
  const socket='/run/user/'+process.getuid()+'/docker.sock',st=await stat(socket),path=await realpath(dockerPath),bin=await stat(path);
  if(!st.isSocket()||st.uid!==process.getuid()||(st.mode&0o007)||!bin.isFile()||(bin.mode&0o022))throw Error();
  const docker=(args,...rest)=>command(path,['--host','unix://'+socket,...args],...rest);
  verifyPrivateImageDaemonInfo(JSON.parse((await docker(['info','--format','{{json .}}'],null,3000,65536)).toString()));
  const rows=JSON.parse((await docker(['image','inspect',image],null,3000,65536)).toString());
  if(rows.length!==1||rows[0].Id!==image||rows[0].Os!=='linux'||rows[0].Architecture!=='arm64')throw Error();
  return Object.freeze({platform:'linux',architecture:'arm64',rootless:true,cgroupVersion:'2',image,dockerPath:path});
 }catch{throw Error('PHONE_NATIVE_HOST_UNSUPPORTED');}
}
function factory({enabled=false,image,qualify=false,dockerPath='/usr/bin/docker'}={}){
 let busy=false,quarantined=false;
 async function run(bytes,operation,signal){
  if(enabled!==true)throw Error('PHONE_NATIVE_DISABLED');if(busy||quarantined)throw Error('PHONE_NATIVE_BUSY');busy=true;
  try{
   if(!qualify){
    const host=await qualifyPhoneNativeHost({image,dockerPath}),path=host.dockerPath,socket='/run/user/'+process.getuid()+'/docker.sock';
    return await runJob({image,bytes,operation,signal},(args,...rest)=>command(path,['--host','unix://'+socket,...args],...rest));
   }
   return await runOfflinePhoneNativeJob({image,bytes,operation,signal});
  }catch(e){if(e?.message==='PHONE_NATIVE_CLEANUP_UNCERTAIN')quarantined=true;throw e;}finally{busy=false;}
 }
 const normalize=async(bytes,{signal}={})=>{const r=await run(bytes,'process',signal),normalized=Buffer.from(r.normalized.bytesBase64,'base64'),derivative=Buffer.from(r.derivative.bytesBase64,'base64');
  try{const independent=await run(normalized,'verify-clean',signal);if(independent.source.width!==r.normalized.width||independent.source.height!==r.normalized.height||independent.sourceSha256!==r.normalized.sha256)fail();return {schemaVersion:r.schemaVersion,source:{...r.source,sha256:r.sourceSha256},normalized:{...Object.fromEntries(Object.entries(r.normalized).filter(([k])=>k!=='bytesBase64')),bytes:Uint8Array.from(normalized)},derivative:{bytes:Uint8Array.from(derivative),mime:'image/png',sourceSha256:r.sourceSha256,metadataRemoved:true},orientationApplied:r.orientationApplied,independentVerification:{sha256:independent.sourceSha256,metadataAbsent:true}};}finally{normalized.fill(0);derivative.fill(0);}
 };
 return Object.freeze({kind:qualify?'offline-native-qualification':'qualified-native-broker',async inspect(bytes,{signal}={}){return (await run(bytes,'inspect',signal)).source;},normalize,async process(bytes){const r=await normalize(bytes);r.normalized.bytes.fill(0);return{source:{mime:r.source.mime,width:r.source.width,height:r.source.height,frameCount:1,decoded:true},derivative:r.derivative};},async derive({bytes,sourceSha256,signal}){if(sha(bytes)!==sourceSha256)fail();const r=await normalize(bytes,{signal});r.normalized.bytes.fill(0);return r.derivative;}});
}
export const createOfflinePhoneNativeWorker=options=>factory({...options,qualify:true});
export const createPhoneNativeWorker=options=>factory({...options,qualify:false});
