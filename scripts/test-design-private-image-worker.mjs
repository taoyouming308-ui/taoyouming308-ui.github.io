import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyPrivateImageDaemonInfo,createIsolatedPrivateImageWorker,createPrivateImageIsolationPlan,verifyPrivateImageContainer,validatePrivateImageWorkerResult,runPrivateImageWorkerProtocol} from '../packages/design-production-adapter/private-image-worker-driver.mjs';
import {syntheticPrivatePNG} from './fixtures/design-private-media-native.mjs';
const bytes=syntheticPrivatePNG(),sha=b=>createHash('sha256').update(b).digest('hex');
const image='sha256:'+'a'.repeat(64),name='design-image-00000000-0000-0000-0000-000000000000';
const inspected=()=>({Image:image,Name:'/'+name,State:{Running:false,Status:'created'},Config:{Image:image,User:'65532:65532',WorkingDir:'/work',Entrypoint:['/usr/bin/python3'],Cmd:['-I','/opt/design-worker/private-image-worker.py'],OpenStdin:true,Tty:false,Env:['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']},Mounts:[],HostConfig:{NetworkMode:'none',LogConfig:{Type:'none',Config:{}},ReadonlyRootfs:true,PidsLimit:32,Memory:1073741824,MemorySwap:1073741824,NanoCpus:1000000000,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],IpcMode:'private',Tmpfs:{'/work':'rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=65532,gid=65532'}}});
const output=()=>({schemaVersion:'private-image-worker-v1',sourceSha256:sha(bytes),source:{mime:'image/png',width:3,height:2,frameCount:1,decoded:true},derivative:{mime:'image/png',width:3,height:2,sha256:sha(bytes),bytesBase64:Buffer.from(bytes).toString('base64')}});
let count=0;async function test(name,fn){await fn();console.log('PASS '+name);count++;}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
await test('default disabled, no process or host IO',()=>rejects(()=>createIsolatedPrivateImageWorker().process(bytes),'IMAGE_WORKER_DISABLED'));
await test('actual unsupported host refuses rather than forged attestation',async()=>{if(process.platform!=='linux'||process.getuid()===0)await rejects(()=>createIsolatedPrivateImageWorker({enabled:true,image,dockerPath:'/not/a/binary'}).process(bytes),'IMAGE_WORKER_HOST_UNSUPPORTED');});
await test('rootless requires systemd cgroup v2 and CPU/memory/PID capability reports',()=>{
 const info={OSType:'linux',CgroupVersion:'2',CgroupDriver:'systemd',MemoryLimit:true,SwapLimit:true,PidsLimit:true,CpuCfsPeriod:true,CpuCfsQuota:true,SecurityOptions:['name=rootless','name=seccomp,profile=builtin']};assert.equal(verifyPrivateImageDaemonInfo(info),true);
 for(const [key,value] of [['CgroupDriver','none'],['CgroupDriver','cgroupfs'],['CgroupVersion','1'],['CpuCfsPeriod',false],['CpuCfsQuota',false],['MemoryLimit',false],['PidsLimit',false],['SwapLimit',false],['SecurityOptions',['name=rootless','name=seccomp,profile=builtin-invalid']]])assert.throws(()=>verifyPrivateImageDaemonInfo({...info,[key]:value}));
});
await test('fixed digest, never pull and no mounts/network/credentials',()=>{const p=createPrivateImageIsolationPlan(image,name);assert.ok(p.includes('never'));assert.ok(p.includes('none'));assert.ok(p.includes('--read-only'));assert.throws(()=>createPrivateImageIsolationPlan('latest',name));assert.throws(()=>createPrivateImageIsolationPlan(image,'other-container'));assert.ok(!p.includes('-v'));});
await test('actual inspection refuses weakened isolation',()=>{assert.equal(verifyPrivateImageContainer(inspected(),{image,name}),true);for(const mutate of [v=>v.HostConfig.NetworkMode='bridge',v=>v.HostConfig.LogConfig.Type='json-file',v=>v.HostConfig.Memory=0,v=>v.HostConfig.PidsLimit=0,v=>v.HostConfig.Privileged=true,v=>v.HostConfig.SecurityOpt=['seccomp=unconfined'],v=>v.Config.User='0',v=>v.Config.Env.push('SECRET=not-a-secret'),v=>v.Mounts=[{Source:'/'}],v=>v.Config.Cmd=['anything'],v=>v.Image='sha256:'+'b'.repeat(64),v=>v.HostConfig.IpcMode='host']){const v=inspected();mutate(v);assert.throws(()=>verifyPrivateImageContainer(v,{image,name}));}});
await test('protocol exact source hash/dimensions/metadata/size',()=>{const v=validatePrivateImageWorkerResult(JSON.stringify(output()),bytes);assert.equal(v.derivative.metadataRemoved,true);for(const mutate of [v=>v.sourceSha256='0'.repeat(64),v=>v.source.frameCount=2,v=>v.derivative.width=129,v=>v.derivative.bytesBase64+='!',v=>v.derivative.sha256='0'.repeat(64),v=>v.secret='not-a-secret']){const o=output();mutate(o);assert.throws(()=>validatePrivateImageWorkerResult(JSON.stringify(o),bytes));}assert.throws(()=>validatePrivateImageWorkerResult('x'.repeat(100001),bytes));});
await test('inspect before sending pixels, always cleanup after result',async()=>{const calls=[];const result=await runPrivateImageWorkerProtocol({image,name,bytes,execute:async(a,input)=>{calls.push(a[0]);if(a[0]==='inspect'){assert.equal(input,null);return JSON.stringify([inspected()]);}if(a[0]==='start'){assert.deepEqual(input,bytes);return JSON.stringify(output());}return '';}});assert.deepEqual(calls,['create','inspect','start','rm']);assert.equal(result.source.width,3);});
await test('weakened inspect never sends input',async()=>{const calls=[];await rejects(()=>runPrivateImageWorkerProtocol({image,name,bytes,execute:async(a,input)=>{calls.push(a[0]);assert.equal(input,null);if(a[0]==='inspect'){const v=inspected();v.HostConfig.Memory=0;return JSON.stringify([v]);}return '';}}),'IMAGE_WORKER_ISOLATION_INVALID');assert.deepEqual(calls,['create','inspect','rm']);});
await test('unknown create cleans unique name, sanitized error',async()=>{const calls=[];await rejects(()=>runPrivateImageWorkerProtocol({image,name,bytes,execute:async a=>{calls.push(a[0]);if(a[0]==='create')throw Error('secret mock diagnostic');return '';}}),'IMAGE_WORKER_REJECTED');assert.deepEqual(calls,['create','rm']);});
await test('timeout and invalid output still cleanup',async()=>{for(const response of [()=>{throw Error('timeout');},()=>'{bad']){const calls=[];await assert.rejects(()=>runPrivateImageWorkerProtocol({image,name,bytes,execute:async a=>{calls.push(a[0]);if(a[0]==='inspect')return JSON.stringify([inspected()]);if(a[0]==='start')return response();return '';}}));assert.equal(calls.at(-1),'rm');}});
await test('cleanup failure withholds successful output as uncertain',()=>rejects(()=>runPrivateImageWorkerProtocol({image,name,bytes,execute:async a=>{if(a[0]==='inspect')return JSON.stringify([inspected()]);if(a[0]==='start')return JSON.stringify(output());if(a[0]==='rm')throw Error('not removed');return '';}}),'IMAGE_WORKER_CLEANUP_UNCERTAIN'));
await test('worker pixel-only encoder actual Python roundtrip no native fallback',()=>{const result=spawnSync('/usr/bin/python3',['-I','-c',`import importlib.util,struct,zlib,json
spec=importlib.util.spec_from_file_location('worker','packages/design-production-adapter/private-image-worker.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=m.png_rgba(2,1,bytes([0,0,255,255]*2));at=8;types=[];raw=b''
while at<len(p):
 n=struct.unpack('>I',p[at:at+4])[0];kind=p[at+4:at+8];types.append(kind.decode());data=p[at+8:at+8+n]
 if kind==b'IDAT':raw+=data
 at+=12+n
assert types==['IHDR','IDAT','IEND'];assert zlib.decompress(raw)==b'\\x00'+bytes([0,0,255,255]*2)
for w,h,pixels in [(0,1,b''),(129,1,b''),(1,1,b'')]:
 try:m.png_rgba(w,h,pixels);raise AssertionError('accepted')
 except ValueError:pass
print('pixel encoder verified')`],{encoding:'utf8',maxBuffer:4096});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/verified/);});
console.log(count+' private image worker tests passed; no container/native production decode executed.');
