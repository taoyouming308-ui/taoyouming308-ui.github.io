import {validateHeifContainer,isHeifMime} from '../shared/phone-image-types.mjs';
/** Node/native worker, NOT an Edge runtime adapter. Disabled; no installation or default executable. */
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {PRIVATE_MEDIA_MAX_BYTES,sniffPrivateImage} from './private-media.mjs';
export const PRIVATE_IMAGE_REVIEWED_VERSION='ImageMagick 7.1.2-17';
export class PrivateImageDecodeError extends Error{constructor(code){super(code);this.name='PrivateImageDecodeError';this.code=code;}}
const fail=code=>{throw new PrivateImageDecodeError(code);};
const POLICY=`<policymap>
 <policy domain="resource" name="memory" value="256MiB"/>
 <policy domain="resource" name="map" value="0"/>
 <policy domain="resource" name="disk" value="0"/>
 <policy domain="resource" name="width" value="16384"/>
 <policy domain="resource" name="height" value="16384"/>
 <policy domain="resource" name="area" value="40MP"/>
 <policy domain="resource" name="list-length" value="2"/>
 <policy domain="resource" name="thread" value="1"/>
 <policy domain="resource" name="time" value="3"/>
 <policy domain="delegate" rights="none" pattern="*"/>
 <policy domain="filter" rights="none" pattern="*"/>
 <policy domain="coder" rights="none" pattern="*"/>
 <policy domain="coder" rights="read" pattern="{JPEG,PNG,WEBP}"/>
 <policy domain="coder" rights="write" pattern="INFO"/>
 <policy domain="path" rights="none" pattern="@*"/>
</policymap>`;
const u32=(bytes,offset,little=false)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset,little);
/** Exact container ends and explicit animation rejection precede the full native pixel decode. */
export function validatePrivateImageContainer(bytes,mime){
 if(isHeifMime(mime)){try{validateHeifContainer(bytes);return;}catch{fail('IMAGE_CONTAINER_INVALID');}}
 const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
 if(mime==='image/png'){
  let at=8,first=true,ended=false;
  while(at+12<=bytes.length){const length=u32(bytes,at),type=ascii(at+4,at+8);if(length>bytes.length-at-12)fail('IMAGE_CONTAINER_INVALID');
   if(first&&(type!=='IHDR'||length!==13))fail('IMAGE_CONTAINER_INVALID');first=false;
   if(['acTL','fcTL','fdAT'].includes(type))fail('IMAGE_ANIMATION_DENIED');
   at+=length+12;if(type==='IEND'){if(length!==0||at!==bytes.length)fail('IMAGE_CONTAINER_INVALID');ended=true;break;}
  }if(!ended)fail('IMAGE_CONTAINER_INVALID');
 }else if(mime==='image/webp'){
  if(u32(bytes,4,true)+8!==bytes.length)fail('IMAGE_CONTAINER_INVALID');let at=12,frames=0;
  while(at+8<=bytes.length){const type=ascii(at,at+4),length=u32(bytes,at+4,true);if(length>bytes.length-at-8)fail('IMAGE_CONTAINER_INVALID');
   if(['ANIM','ANMF'].includes(type)||(type==='VP8X'&&length>0&&(bytes[at+8]&2)))fail('IMAGE_ANIMATION_DENIED');
   if(type==='VP8 '||type==='VP8L')frames++;at+=8+length+(length%2);
  }if(at!==bytes.length||frames!==1)fail('IMAGE_CONTAINER_INVALID');
 }else if(mime==='image/jpeg'){
  let at=2,ended=false;
  while(at<bytes.length){if(bytes[at++]!==255)fail('IMAGE_CONTAINER_INVALID');while(bytes[at]===255)at++;const marker=bytes[at++];
   if(marker===217){if(at!==bytes.length)fail('IMAGE_CONTAINER_INVALID');ended=true;break;}
   if(marker===216||marker===0||at+2>bytes.length)fail('IMAGE_CONTAINER_INVALID');
   if(marker===1||(marker>=208&&marker<=215))continue;
   const length=(bytes[at]<<8)|bytes[at+1];if(length<2||length>bytes.length-at)fail('IMAGE_CONTAINER_INVALID');
   if(marker===226&&ascii(at+2,at+6)==='MPF\0')fail('IMAGE_ANIMATION_DENIED');at+=length;
   if(marker===218){while(at<bytes.length){if(bytes[at]!==255){at++;continue;}const next=bytes[at+1];if(next===0||(next>=208&&next<=215)){at+=2;continue;}if(next===255){at++;continue;}break;}}
  }if(!ended)fail('IMAGE_CONTAINER_INVALID');
 }else fail('IMAGE_CONTAINER_INVALID');
}
function verifyPolicy(output){
 const blocks=[...output.matchAll(/Policy: (\w+)\n([\s\S]*?)(?=\n  Policy:|\nPath:|$)/g)];
 const resources={memory:'256MiB',map:'0',disk:'0',width:'16384',height:'16384',area:'40MP','list-length':'2',thread:'1',time:'3'};const seen=new Set();let delegate=false,filter=false,coderDeny=false,coderRead=false,coderWrite=false,indirect=false;
 for(const [,domain,body] of blocks){const rights=/rights: ([^\n]+)/.exec(body)?.[1].trim(),pattern=/pattern: ([^\n]+)/.exec(body)?.[1].trim();
  if(domain==='Resource'){const name=/name: ([^\n]+)/.exec(body)?.[1].trim(),value=/value: ([^\n]+)/.exec(body)?.[1].trim();if(resources[name]!==value)fail('IMAGE_POLICY_INVALID');seen.add(name);}
  else if(domain==='Delegate'||domain==='Filter'){if(rights!=='None'||pattern!=='*')fail('IMAGE_POLICY_INVALID');if(domain==='Delegate')delegate=true;else filter=true;}
  else if(domain==='Coder'){if(rights==='None'&&pattern==='*')coderDeny=true;else if(rights==='Read'&&pattern==='{JPEG,PNG,WEBP}')coderRead=true;else if(rights==='Write'&&pattern==='INFO')coderWrite=true;else fail('IMAGE_POLICY_INVALID');}
  else if(domain==='Path'){if(rights!=='None'||pattern!=='@*')fail('IMAGE_POLICY_INVALID');indirect=true;}
  else if(domain!=='Undefined')fail('IMAGE_POLICY_INVALID');
 }
 if(seen.size!==Object.keys(resources).length||!delegate||!filter||!coderDeny||!coderRead||!coderWrite||!indirect)fail('IMAGE_POLICY_INVALID');
}
async function binary(value){if(typeof value!=='string'||!path.isAbsolute(value))fail('IMAGE_WORKER_DISABLED');const resolved=await fs.realpath(value),stat=await fs.stat(resolved);if(!stat.isFile())fail('IMAGE_WORKER_DISABLED');return resolved;}
function execute(python,executable,mode,args,input,directory,timeoutMs){
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[fileURLToPath(new URL('./private-image-sandbox.py',import.meta.url)),executable,mode,...args],{shell:false,windowsHide:true,env:{PATH:'/usr/bin:/bin',HOME:directory,TMPDIR:directory,MAGICK_TMPDIR:directory,MAGICK_CONFIGURE_PATH:directory,MAGICK_THREAD_LIMIT:'1',LC_ALL:'C'}});
  const output=[],errors=[];let size=0,errorSize=0,aborted=null;
  const timer=setTimeout(()=>{aborted='IMAGE_DECODE_TIMEOUT';child.kill('SIGKILL');},timeoutMs);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8192){aborted='IMAGE_DECODE_LIMIT';child.kill('SIGKILL');}else output.push(chunk);});
  child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize>16384){aborted='IMAGE_DECODE_LIMIT';child.kill('SIGKILL');}else errors.push(chunk);});
  child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(new PrivateImageDecodeError('IMAGE_WORKER_UNAVAILABLE'));});
  child.once('close',code=>{clearTimeout(timer);if(aborted)return reject(new PrivateImageDecodeError(aborted));if(code!==0||errorSize){const message=Buffer.concat(errors).toString('utf8');return reject(new PrivateImageDecodeError(message.includes('IMAGE_ADDRESS_SPACE_LIMIT_UNAVAILABLE')?'IMAGE_HARD_MEMORY_LIMIT_UNAVAILABLE':'IMAGE_DECODE_REJECTED'));}resolve(Buffer.concat(output).toString('utf8'));});
  child.stdin.end(input);
 });
}
export function createNativePrivateImageInspector({enabled=false,magickPath,pythonPath,expectedVersion=PRIVATE_IMAGE_REVIEWED_VERSION,syntheticOnly=false,workerTimeoutMs=5000}={}){
 const mode=syntheticOnly===true&&process.platform==='darwin'?'synthetic-macos':'strict';
 let busy=false;
 const inspect=async input=>{
  if(enabled!==true||expectedVersion!==PRIVATE_IMAGE_REVIEWED_VERSION||!Number.isSafeInteger(workerTimeoutMs)||workerTimeoutMs<1||workerTimeoutMs>5000)fail('IMAGE_WORKER_DISABLED');
  if(!(input instanceof Uint8Array)||!input.length||input.length>PRIVATE_MEDIA_MAX_BYTES)fail('IMAGE_INPUT_INVALID');
  if(busy)fail('IMAGE_WORKER_BUSY');busy=true;
  let directory;const deadline=Date.now()+workerTimeoutMs;const remaining=()=>{const left=deadline-Date.now();if(left<1)fail('IMAGE_DECODE_TIMEOUT');return left;};
  try{
   const bytes=Uint8Array.from(input),mime=sniffPrivateImage(bytes);validatePrivateImageContainer(bytes,mime);
   const [magick,python]=await Promise.all([binary(magickPath),binary(pythonPath)]);
   directory=await fs.mkdtemp(path.join(os.tmpdir(),'design-image-decode-'));await fs.chmod(directory,0o700);
   const inputPath=path.join(directory,'original-image');
   await fs.writeFile(inputPath,bytes,{mode:0o600,flag:'wx'});
   await fs.writeFile(path.join(directory,'policy.xml'),POLICY,{mode:0o600,flag:'wx'});
   {const version=await execute(python,magick,mode,['-version'],null,directory,remaining());if(!version.startsWith('Version: '+expectedVersion+' '))fail('IMAGE_WORKER_VERSION_MISMATCH');}
   verifyPolicy(await execute(python,magick,mode,['-list','policy'],null,directory,remaining()));
   const coder={'image/jpeg':'JPEG','image/png':'PNG','image/webp':'WEBP'}[mime];
   // No -ping: %# calculates decoded pixel signature. The only supplied input path is a fixed private file; OS filesystem isolation is still required.
   const output=await execute(python,magick,mode,['-regard-warnings',coder+':'+inputPath,'-format','%m %w %h %n %#\n','info:-'],null,directory,remaining());
   const match=/^(JPEG|PNG|WEBP) ([1-9]\d*) ([1-9]\d*) 1 ([a-fA-F0-9]{64})\n$/.exec(output);
   if(!match||match[1]!==coder)fail('IMAGE_DECODE_REJECTED');const width=Number(match[2]),height=Number(match[3]);
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width>16384||height>16384||width*height>40000000)fail('IMAGE_DECODE_LIMIT');
   return Object.freeze({mime,width,height,frameCount:1,decoded:true});
  }catch(error){if(error instanceof PrivateImageDecodeError)throw error;fail('IMAGE_WORKER_UNAVAILABLE');}
  finally{try{if(directory)await fs.rm(directory,{recursive:true,force:true});}catch{fail('IMAGE_WORKER_CLEANUP_FAILED');}finally{busy=false;}}
 };
 Object.defineProperty(inspect,'runtime',{value:Object.freeze({kind:'node-native-subprocess',version:expectedVersion,syntheticOnly:syntheticOnly===true,hardAddressSpaceLimitRequired:mode==='strict',wallMilliseconds:workerTimeoutMs,maxConcurrentPerInstance:1,cpuSeconds:3,pixelCacheBytes:256*1024*1024}),enumerable:true});
 return Object.freeze(inspect);
}
