/** Executable LOCAL SYNTHETIC runtime, default off. Never a generic JPEG/WebP
 * fully-consumed decoder and never a model/storage/issuer permission grant.
 * Only the literal PNG fixture can produce the accepted source and parent.
 * Unknown source/parent/final bytes are compared BEFORE any native decode.
 * Actual PNG inspection runs in a separate pinned, no-network Node container.
 */
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationParent} from './managed-image-normalization-contracts.mjs';
import {stripNormalizationPngDensity} from './managed-image-normalization.mjs';
import {SYNTHETIC_CANONICAL_FIXTURE,syntheticCanonicalSourceBytes} from './synthetic-canonical-image-fixture.mjs';
import {validateManagedNormalizedStrictTask,buildManagedNormalizedStrictBinding,validateManagedNormalizedStrictBinaryResult,MANAGED_NORMALIZED_STRICT_POLICY as POLICY} from './managed-normalized-strict-contracts.mjs';
import {validateManagedApplicationProcessingIntent,validateManagedApplicationStrictTask,buildManagedApplicationStrictBinding,validateManagedApplicationStrictBinaryResult,MANAGED_APPLICATION_DIRECT_CHECKS,MANAGED_APPLICATION_DIRECT_POLICY as DIRECT_POLICY} from './managed-application-image-contracts.mjs';
const IMG=`public.ecr.aws/supabase/imgproxy@${POLICY.producer.imageDigest}`;
const NODE=`${POLICY.decoder.runtimeImage}@${POLICY.decoder.imageDigest}`;
const DOCKER='/usr/local/bin/docker';
const ROOT='/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage34/canonical-runtime';
const DECODE=fileURLToPath(new URL('./strict-rgb-png-decoder.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
let globalBusy=false;
const CODES=new Set(['LOCAL_CANONICAL_DISABLED','LOCAL_CANONICAL_INVALID','LOCAL_CANONICAL_BUSY','LOCAL_CANONICAL_ABORTED','LOCAL_CANONICAL_TIMEOUT','LOCAL_CANONICAL_SOURCE_MISMATCH','LOCAL_CANONICAL_PARENT_MISMATCH','LOCAL_CANONICAL_NORMALIZED_MISMATCH','LOCAL_CANONICAL_ISOLATION_FAILED','LOCAL_CANONICAL_DECODE_FAILED','LOCAL_CANONICAL_CLEANUP_FAILED','LOCAL_CANONICAL_UNAVAILABLE']);
export class LocalCanonicalImageError extends Error{constructor(code){const c=CODES.has(code)?code:'LOCAL_CANONICAL_UNAVAILABLE';super(c);this.code=c;this.retryable=false;}}
const fail=c=>{throw new LocalCanonicalImageError(c);};
function own(q,keys){if(types.isProxy(q)||!q||Object.getPrototypeOf(q)!==Object.prototype||Reflect.ownKeys(q).length!==keys.length)fail('LOCAL_CANONICAL_INVALID');const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(q,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('LOCAL_CANONICAL_INVALID');r[k]=d.value;}return r;}
function copyBytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail('LOCAL_CANONICAL_INVALID');const p=Object.getPrototypeOf(Uint8Array.prototype),g=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=g('buffer'),n=g('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail('LOCAL_CANONICAL_INVALID');return Buffer.from(new Uint8Array(b,g('byteOffset'),n));}
const SECURITY=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--cpus=1','--memory=256m','--memory-swap=256m','--user=999:999','--tmpfs=/tmp:rw,noexec,nosuid,size=32m,mode=1777'];
const HTTP_JS=`const os=require('node:os'),fs=require('node:fs'),http=require('node:http');if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal)||fs.readFileSync('/proc/net/route','utf8').split('\\n').slice(1).some(x=>x.trim()&&!x.startsWith('lo\\t')))throw Error('isolation');const r=http.get({host:'127.0.0.1',port:8080,path:process.argv[1],timeout:10000},s=>{let n=0,a=[];s.on('data',b=>{n+=b.length;if(n>262165)r.destroy(Error('limit'));else a.push(b)});s.on('end',()=>process.stdout.write(JSON.stringify({status:s.statusCode,body:Buffer.concat(a).toString('base64')})))});r.on('timeout',()=>r.destroy(Error('deadline')));r.on('error',()=>{process.exitCode=2});`;
const INSPECT_JS=`import{readFileSync}from'node:fs';import{decodeStrictRgbPng}from'/input/decoder.mjs';import os from'node:os';if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal))throw Error('isolation');const names=JSON.parse(process.argv[1]);if(!Array.isArray(names)||names.some(x=>!['fixture.png','reference.png','normalized.png'].includes(x)))throw Error('path');const results={};let first;try{for(const name of names){const r=decodeStrictRgbPng(readFileSync('/input/'+name),{width:80,height:120,maximumBytes:262144});const {pixels,...summary}=r;results[name]={...summary,mime:'image/png'};if(name==='reference.png')first=Buffer.from(pixels);if(name==='normalized.png'){if(!first||!pixels.equals(first))throw Error('pixel-mismatch');}pixels.fill(0);}process.stdout.write(JSON.stringify({node:process.version,zlib:process.versions.zlib,results,pixelsEqual:names.includes('normalized.png')}));}finally{first?.fill(0);}`;
function safe(e){if(!types.isProxy(e)&&e instanceof LocalCanonicalImageError){const d=Object.getOwnPropertyDescriptor(e,'code');if(d&&Object.hasOwn(d,'value'))return new LocalCanonicalImageError(d.value);}return new LocalCanonicalImageError('LOCAL_CANONICAL_UNAVAILABLE');}

/** normalizeSynthetic must be called only AFTER the independent durable
 * processing claim. verifyTask must be called only AFTER private storage and a
 * separately issued current verifier task. Those authorities live outside this
 * runtime and are never generated here. No credential enters the container.
 * Application entries use the distinct direct policy: source manifest -> PNG,
 * no hosted parent/native-version substitution. The reference PNG is generated
 * from the exact pinned JPEG/WebP source, not compared to pre-encoding pixels. */
export function createLocalCanonicalImageRuntime({enabled=false}={}){
 async function execute(input,mode){
  if(enabled!==true)fail('LOCAL_CANONICAL_DISABLED');if(globalBusy)fail('LOCAL_CANONICAL_BUSY');
  const direct=mode==='application_normalize'||mode==='application_verify',verifying=mode==='verify'||mode==='application_verify';
  const q=own(input,direct?(verifying?['task','sourceBytes','normalizedBytes','signal']:['intent','sourceBytes','signal']):mode==='seed'?['mime','maxEdge','signal']:mode==='verify'?['task','sourceBytes','parentBytes','normalizedBytes','signal']:['sourceRecord','parentResponse','parentObjectReceipt','sourceBytes','parentBytes','signal']);
  let task,context;
  if(direct){if(['producer','decoder','sourceEncoder','normalization','fixture'].some(k=>managedImageDigest(DIRECT_POLICY[k])!==managedImageDigest(POLICY[k])))fail('LOCAL_CANONICAL_INVALID');const a=verifying?(task=validateManagedApplicationStrictTask(q.task)).claimedArtifact.artifact:validateManagedApplicationProcessingIntent(q.intent);context={sourceRecord:{source:a.sourceManifest.content},maximumOutputBytes:262144,expectedOutput:{width:80,height:120}};}
  else if(mode==='seed'){if(!POLICY.sourceMimeTypes.includes(q.mime)||q.maxEdge!==1024)fail('LOCAL_CANONICAL_INVALID');context={sourceRecord:{source:{mime:q.mime}},parentResponse:{descriptor:{source:{width:80,height:120},requestedTransform:{maxEdge:1024}}},parentObjectReceipt:null,maximumOutputBytes:262144,expectedOutput:{width:80,height:120}};}
  else if(mode==='verify'){task=validateManagedNormalizedStrictTask(q.task);const a=task.claimedArtifact.artifact;context=validateManagedImageNormalizationParent({sourceRecord:a.sourceRecord,parentResponse:a.parentResponse,parentObjectReceipt:a.parentObjectReceipt});}
  else context=validateManagedImageNormalizationParent({sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:q.parentObjectReceipt});
  const {sourceRecord:s,parentResponse:r,parentObjectReceipt:o}=context;
  if(!direct&&(!POLICY.parentTransform.maxEdges.includes(r.descriptor.requestedTransform.maxEdge)||!['image/jpeg','image/webp'].includes(s.source.mime)||r.descriptor.source.width!==80||r.descriptor.source.height!==120||context.expectedOutput.width!==80||context.expectedOutput.height!==120))fail('LOCAL_CANONICAL_INVALID');
  let source=null,parent=null,normalized=null;const owned=[];
  try{
   if(mode!=='seed'){source=copyBytes(q.sourceBytes,8*1024*1024);owned.push(source);if(!direct){parent=copyBytes(q.parentBytes,context.maximumOutputBytes);owned.push(parent);}}
   if(verifying){normalized=copyBytes(q.normalizedBytes,context.maximumOutputBytes);owned.push(normalized);}
   if(mode!=='seed'&&(source.length!==s.source.byteLength||sha(source)!==s.source.sha256||!direct&&(parent.length!==o.derivative.byteLength||sha(parent)!==o.derivative.sha256)))fail('LOCAL_CANONICAL_INVALID');
   const expectedNormalized=direct&&verifying?task.normalizedManifest.content:task?.objectReceipt?.output;
   if(normalized&&(normalized.length!==expectedNormalized.byteLength||sha(normalized)!==expectedNormalized.sha256))fail('LOCAL_CANONICAL_INVALID');
   if(q.signal!==null&&q.signal!==undefined){try{aborted.call(q.signal);}catch{fail('LOCAL_CANONICAL_INVALID');}}
  }catch(e){owned.forEach(b=>b.fill(0));throw safe(e);}
  globalBusy=true;const created=new Set(),deadline=performance.now()+30000;let dir,cleanupOK=false;
  const check=()=>{if(q.signal&&aborted.call(q.signal))fail('LOCAL_CANONICAL_ABORTED');if(performance.now()>=deadline)fail('LOCAL_CANONICAL_TIMEOUT');};
  const command=(args,{cleanup=false,maxBuffer=2*1024*1024}={})=>new Promise((resolve,reject)=>{
   if(!cleanup){try{check();}catch(e){reject(e);return;}}
   const timeout=cleanup?10000:Math.max(1,Math.min(15000,Math.floor(deadline-performance.now())));
   execFile(DOCKER,args,{encoding:'utf8',timeout,maxBuffer,signal:cleanup?undefined:q.signal??undefined},(error,stdout,stderr)=>{if(error&&cleanup&&typeof stderr==='string'&&stderr.includes('No such container')&&stderr.includes(args.at(-1))){resolve('');return;}if(error){reject(new LocalCanonicalImageError(!cleanup&&q.signal&&aborted.call(q.signal)?'LOCAL_CANONICAL_ABORTED':!cleanup&&performance.now()>=deadline?'LOCAL_CANONICAL_TIMEOUT':'LOCAL_CANONICAL_UNAVAILABLE'));return;}resolve(stdout);});
  });
  const put=async(name,b)=>{check();await writeFile(`${dir}/inputs/${name}`,b,{mode:0o444,flag:'wx'});};
  const container=async(args)=>{const name='design-canonical-'+randomUUID();created.add(name);const out=await command(['run','--pull=never','--rm','--name',name,...args]);created.delete(name);return out;};
  let result;
  try{
   check();const evidenceRoot=direct?'/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage40/canonical-runtime':ROOT;await mkdir(evidenceRoot,{recursive:true,mode:0o700});dir=await mkdtemp(`${evidenceRoot}/job-`);await mkdir(`${dir}/inputs`,{mode:0o755});
   const fixture=syntheticCanonicalSourceBytes();if(sha(fixture)!==SYNTHETIC_CANONICAL_FIXTURE.sha256)fail('LOCAL_CANONICAL_INVALID');
   await put('fixture.png',fixture);await put('decoder.mjs',await readFile(DECODE));
   for(const image of [IMG,NODE]){const data=JSON.parse(await command(['image','inspect',image]))[0];if(!data.RepoDigests?.includes(image)||data.Os!=='linux'||data.Architecture!=='arm64')fail('LOCAL_CANONICAL_ISOLATION_FAILED');}
   const inspect=async names=>{
    const text=await container(['--network=none',...SECURITY,'--mount',`type=bind,src=${dir}/inputs,dst=/input,readonly`,'--entrypoint','node',NODE,'--input-type=module','-e',INSPECT_JS,JSON.stringify(names)]);
    const value=JSON.parse(text);if(value.node!==`v${POLICY.decoder.nodeVersion}`||value.zlib!==POLICY.decoder.zlibVersion)fail('LOCAL_CANONICAL_DECODE_FAILED');return value;
   };
   const fixtureResult=(await inspect(['fixture.png'])).results['fixture.png'];
   const server='design-canonical-'+randomUUID();created.add(server);
   const env={IMGPROXY_BIND:'127.0.0.1:8080',IMGPROXY_LOCAL_FILESYSTEM_ROOT:'/input',IMGPROXY_ALLOWED_SOURCES:direct?'local:///fixture.png,local:///source.jpg,local:///source.webp':'local:///fixture.png,local:///source.jpg,local:///source.webp,local:///parent.jpg,local:///parent.webp',IMGPROXY_MAX_SRC_RESOLUTION:'40',IMGPROXY_MAX_SRC_FILE_SIZE:'8388609',...POLICY.producer.environment,IMGPROXY_CONCURRENCY:'1',IMGPROXY_MAX_CLIENTS:'4',IMGPROXY_READ_TIMEOUT:'5',IMGPROXY_WRITE_TIMEOUT:'10',IMGPROXY_DOWNLOAD_TIMEOUT:'3'};
   const envargs=Object.entries(env).flatMap(([k,v])=>['-e',`${k}=${v}`]);
   await command(['run','--pull=never','--detach','--name',server,'--network=none',...SECURITY,'--mount',`type=bind,src=${dir}/inputs,dst=/input,readonly`,...envargs,IMG]);
   const current=JSON.parse(await command(['inspect',server]))[0],h=current.HostConfig;
   if(h.NetworkMode!=='none'||Object.keys(h.PortBindings??{}).length||!h.ReadonlyRootfs||h.Memory!==268435456||h.MemorySwap!==268435456||h.PidsLimit!==64||h.NanoCpus!==1000000000||!h.CapDrop?.includes('ALL')||!h.SecurityOpt?.includes('no-new-privileges')||current.Config.User!=='999:999'||current.Mounts.some(m=>m.RW))fail('LOCAL_CANONICAL_ISOLATION_FAILED');
   await new Promise(resolve=>setTimeout(resolve,500));check();
   const request=async path=>{const raw=JSON.parse(await container(['--network',`container:${server}`,...SECURITY,'--entrypoint','node',NODE,'-e',HTTP_JS,path]));if(raw.status!==200||typeof raw.body!=='string'||raw.body.length>350000)fail('LOCAL_CANONICAL_DECODE_FAILED');const b=Buffer.from(raw.body,'base64');if(!b.length||b.length>context.maximumOutputBytes+21)fail('LOCAL_CANONICAL_DECODE_FAILED');owned.push(b);return b;};
   const ext=s.source.mime==='image/jpeg'?'jpg':'webp';
   const generatedSource=await request(`/insecure/rs:fit:80:120:0/q:80/plain/local:///fixture.png@${ext}`);
   if(mode==='seed')source=generatedSource;
   if(!source.equals(generatedSource))fail('LOCAL_CANONICAL_SOURCE_MISMATCH');await put(`source.${ext}`,generatedSource);
   if(!direct){
   const edge=r.descriptor.requestedTransform.maxEdge;
   const generatedParent=await request(`/insecure/rs:fit:${edge}:${edge}:0/q:80/plain/local:///source.${ext}@${ext}`);
   if(mode==='seed')parent=generatedParent;
   if(!parent.equals(generatedParent))fail('LOCAL_CANONICAL_PARENT_MISMATCH');await put(`parent.${ext}`,generatedParent);
   }
   if(mode==='seed'){
    result=Object.freeze({fixtureId:SYNTHETIC_CANONICAL_FIXTURE.id,mime:q.mime,maxEdge:1024,sourceBytes:Buffer.from(source),parentBytes:Buffer.from(parent)});
    await writeFile(`${dir}/result.json`,JSON.stringify({mode,fixtureSha256:SYNTHETIC_CANONICAL_FIXTURE.sha256,sourceSha256:sha(source),parentSha256:sha(parent),normalizedGenerated:false,producer:IMG,production:false}),{mode:0o600});
   }else{
   const rawPng=await request(`/insecure/rs:fit:80:120:0/q:80/plain/local:///${direct?'source':'parent'}.${ext}@png`);
   const reference=stripNormalizationPngDensity(rawPng,{width:80,height:120,maximumBytes:context.maximumOutputBytes});owned.push(reference);
   await put('reference.png',reference);
   if(verifying){
    if(!normalized.equals(reference))fail('LOCAL_CANONICAL_NORMALIZED_MISMATCH');await put('normalized.png',normalized);
    const inspected=await inspect(['reference.png','normalized.png']);if(inspected.pixelsEqual!==true)fail('LOCAL_CANONICAL_DECODE_FAILED');
    const measurement=bytes=>({sha256:sha(bytes),byteLength:bytes.length,mime:s.source.mime,producerSha256:sha(bytes),producerByteLength:bytes.length});
    const checks=Object.fromEntries((direct?MANAGED_APPLICATION_DIRECT_CHECKS:['fixturePngComplete','sourceExactFixtureProducerMatch','parentExactProducerMatch','normalizedPngComplete','normalizedPixelsEqual','metadataAbsent','identityOrientation','sameGeometry']).map(k=>[k,'verified']));
    result=direct?validateManagedApplicationStrictBinaryResult({schemaVersion:'design-normalized-strict-binary-result-v2',bindingDigest:managedImageDigest(buildManagedApplicationStrictBinding(task)),fixture:fixtureResult,source:measurement(source),normalized:inspected.results['normalized.png'],reference:inspected.results['reference.png'],checks},task):validateManagedNormalizedStrictBinaryResult({schemaVersion:'design-normalized-strict-binary-result-v1',bindingDigest:managedImageDigest(buildManagedNormalizedStrictBinding(task)),fixture:fixtureResult,source:measurement(source),parent:measurement(parent),normalized:inspected.results['normalized.png'],reference:inspected.results['reference.png'],checks},task);
   }else{
    await inspect(['reference.png']);result=Buffer.from(reference);
   }
   check();await writeFile(`${dir}/result.json`,JSON.stringify({mode,taskDigest:task?managedImageDigest(task):null,fixtureSha256:SYNTHETIC_CANONICAL_FIXTURE.sha256,sourceSha256:sha(source),...(direct?{}:{parentSha256:sha(parent)}),normalizedSha256:sha(reference),rawPngSha256:sha(rawPng),producer:IMG,independentPngDecoder:NODE,production:false,arbitraryJpegFullConsumptionClaimed:false}),{mode:0o600});
   }
  }catch(e){throw safe(e);}
  finally{
   const failed=[];for(const name of created){try{await command(['rm','-f',name],{cleanup:true});created.delete(name);}catch{failed.push(name);}}
   cleanupOK=failed.length===0;owned.forEach(b=>b.fill(0));if(dir)await writeFile(`${dir}/cleanup.json`,JSON.stringify({remainingExactContainers:failed}),{mode:0o600}).catch(()=>{});globalBusy=!cleanupOK;
   if(!cleanupOK)fail('LOCAL_CANONICAL_CLEANUP_FAILED');
  }
  return result;
 }
 return Object.freeze({prepareSyntheticSource:input=>execute(input,'seed'),normalizeSynthetic:input=>execute(input,'normalize'),verifyTask:input=>execute(input,'verify'),normalizeApplicationSource:input=>execute(input,'application_normalize'),verifyApplicationTask:input=>execute(input,'application_verify')});
}
