/** Default-closed server composition. No decoder, network, storage, approval
 * issuer or durable claim implementation lives here. Consumed bytes are a NEW
 * pending artifact, never a replacement for a hosted derivative/verified report.
 * Real production use still needs bounded isolated runtime, independent binary
 * inspector, durable once-claim, current authorization, private storage and issuer.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord,validateManagedImageResponse,MANAGED_IMAGE_CANDIDATE_BUDGETS} from './managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt} from './managed-image-verification.mjs';
import {createManagedImageNormalizationArtifact,managedImageNormalizationBinding,MANAGED_IMAGE_NORMALIZATION_POLICY} from './managed-image-normalization-contracts.mjs';
const codes=new Set(['NORMALIZATION_DISABLED','NORMALIZATION_INVALID','NORMALIZATION_DENIED','NORMALIZATION_BUSY','NORMALIZATION_TIMEOUT','NORMALIZATION_ABORTED','NORMALIZATION_BINDING_MISMATCH','NORMALIZATION_BUDGET_EXCEEDED','NORMALIZATION_INSPECTION_FAILED','NORMALIZATION_UNCERTAIN','NORMALIZATION_UNAVAILABLE']);
export class ManagedImageNormalizationError extends Error{constructor(code='NORMALIZATION_INVALID',outcome='not_sent'){const c=codes.has(code)?code:'NORMALIZATION_UNAVAILABLE';super(c);this.name='ManagedImageNormalizationError';this.code=c;this.retryable=false;this.outcome=outcome==='uncertain'||c==='NORMALIZATION_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new ManagedImageNormalizationError(c);};
const json=v=>JSON.parse(managedImageCanonical(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const sha=b=>createHash('sha256').update(b).digest('hex');
function own(v,keys){if(types.isProxy(v)||!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('NORMALIZATION_INVALID');const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('NORMALIZATION_INVALID');out[k]=d.value;}return out;}
function method(v,k){if(types.isProxy(v)||!v)return;const d=Object.getOwnPropertyDescriptor(v,k);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function')return d.value.bind(v);}
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail('NORMALIZATION_INVALID');const t=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(t,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>max)fail('NORMALIZATION_BUDGET_EXCEEDED');return Buffer.from(new Uint8Array(b,get('byteOffset'),n));}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const crc32=buffer=>{let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
/** Narrow PNG CONTAINER check, NOT compressed-stream decode/attestation. Only
 * static 8-bit RGB emitted by the pinned decoder is supported. The sole allowed
 * ancillary pHYs chunk is removed; every other ancillary/unknown chunk fails.
 * The independent inspector MUST still fully decode the resulting bytes. */
export function stripNormalizationPngDensity(value,options){
 const {width,height,maximumBytes}=own(options,['width','height','maximumBytes']);
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1536)||![262144,524288].includes(maximumBytes))fail('NORMALIZATION_INVALID');
 const b=bytes(value,maximumBytes+21),parts=[b.subarray(0,8)];
 const reject=()=>fail('NORMALIZATION_INSPECTION_FAILED');
 if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))reject();
 let pos=8,seenHeader=false,seenData=false,seenDensity=false,ended=false;
 while(pos<b.length){
  if(ended||pos+12>b.length)reject();const n=b.readUInt32BE(pos),end=pos+12+n;if(end>b.length)reject();
  const kind=b.toString('latin1',pos+4,pos+8),payload=b.subarray(pos+8,pos+8+n);
  if(crc32(b.subarray(pos+4,pos+8+n))!==b.readUInt32BE(pos+8+n))reject();
  if(kind==='IHDR'){
   if(seenHeader||pos!==8||n!==13||payload.readUInt32BE(0)!==width||payload.readUInt32BE(4)!==height||payload[8]!==8||payload[9]!==2||payload[10]!==0||payload[11]!==0||payload[12]!==0)reject();seenHeader=true;
  }else if(kind==='pHYs'){
   if(!seenHeader||seenData||seenDensity||n!==9||payload[8]>1)reject();seenDensity=true;
  }else if(kind==='IDAT'){
   if(!seenHeader||n===0)reject();seenData=true;
  }else if(kind==='IEND'){
   if(!seenData||n!==0||end!==b.length)reject();ended=true;
  }else reject();
  if(kind!=='pHYs')parts.push(b.subarray(pos,end));pos=end;
 }
 if(!ended)reject();const output=Buffer.concat(parts);if(output.length>maximumBytes)fail('NORMALIZATION_BUDGET_EXCEEDED');return output;
}
/** authorize phases receive the complete fixed parent binding and, once made,
 * the complete artifact binding. A true callback must mean FRESH current checks,
 * not a cached boolean. claim must atomically reject prior/uncertain request IDs.
 * callback promises may outlive timeout; this instance stays occupied until they
 * settle and becomes poisoned after uncertain execution. No automatic retry.
 */
export function createManagedImageNormalization({enabled=false,readInputs,authorize,claim,runtime,inspector,consume,timeoutMs}={}){
 const normalize=method(runtime,'normalizePng'),inspect=method(inspector,'verifyNormalization'),inspectParent=method(inspector,'inspectParent');
 const ready=enabled===true&&[readInputs,authorize,claim,normalize,inspect,inspectParent,consume].every(x=>typeof x==='function')&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;
 let busy=false,poisoned=false;
 return Object.freeze({async normalize(input){
  if(!ready)fail('NORMALIZATION_DISABLED');if(busy||poisoned)fail('NORMALIZATION_BUSY');busy=true;
  const pending=new Set(),buffers=[],controller=new AbortController(),deadline=performance.now()+timeoutMs;
  let listener,timer,external,reason=null,started=false,consumeAttempted=false;
  const stop=c=>{if(!reason){reason=c;controller.abort();}};
  const check=()=>{if(external&&aborted.call(external))stop('NORMALIZATION_ABORTED');if(performance.now()>=deadline)stop('NORMALIZATION_TIMEOUT');if(reason)fail(reason);};
  const step=async fn=>{check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let onAbort;const interrupt=new Promise((_,reject)=>{onAbort=()=>reject(new ManagedImageNormalizationError(reason??'NORMALIZATION_ABORTED'));controller.signal.addEventListener('abort',onAbort,{once:true});});try{const result=await Promise.race([p,interrupt]);check();return result;}finally{controller.signal.removeEventListener('abort',onAbort);}};
  try{
   const q=own(input,['credential','scope','mediaId','parentRequestId','requestId','signal']);
   const scope=freeze(json(validateProductionDesignScope(q.scope)));
   if(typeof q.credential!=='string'||q.credential.length<1||q.credential.length>8192||![q.mediaId,q.parentRequestId,q.requestId].every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x)))fail('NORMALIZATION_INVALID');
   external=q.signal;if(external!==undefined&&external!==null){aborted.call(external);listener=()=>stop('NORMALIZATION_ABORTED');external.addEventListener('abort',listener,{once:true});}
   timer=setTimeout(()=>stop('NORMALIZATION_TIMEOUT'),timeoutMs);check();
   const query=Object.freeze({credential:q.credential,scope,mediaId:q.mediaId,parentRequestId:q.parentRequestId,requestId:q.requestId});
   const read=own(await step(()=>readInputs({...query,signal:controller.signal})),['sourceRecord','parentResponse','parentObjectReceipt','parentBytes']);
   const source=validateManagedImageSourceRecord(read.sourceRecord),response=validateManagedImageResponse(read.parentResponse,source),receipt=validateManagedDerivedObjectReceipt(read.parentObjectReceipt,{sourceRecord:source,response});
   if(!same(source.owner.scope,scope)||source.mediaId!==q.mediaId||response.descriptor.requestId!==q.parentRequestId||!['image/jpeg','image/webp'].includes(receipt.derivative.mime))fail('NORMALIZATION_BINDING_MISMATCH');
   const maximumBytes=MANAGED_IMAGE_CANDIDATE_BUDGETS[response.descriptor.requestedTransform.maxEdge]['image/png'];
   const parent=bytes(read.parentBytes,maximumBytes);buffers.push(parent);
   if(parent.length!==receipt.derivative.byteLength||sha(parent)!==receipt.derivative.sha256)fail('NORMALIZATION_BINDING_MISMATCH');
   const binding=freeze({requestId:q.requestId,authority:source.owner,scope,sourceRecordDigest:managedImageDigest(source),parentResponseDigest:managedImageDigest(response),parentObjectReceiptDigest:managedImageDigest(receipt),parentDerivativeSha256:receipt.derivative.sha256,parentObjectVersion:receipt.object.version,normalizationPolicy:MANAGED_IMAGE_NORMALIZATION_POLICY});
   const guard=async(phase,artifact=null)=>{if(await step(()=>authorize({...query,binding,artifactBinding:artifact?managedImageNormalizationBinding(artifact):null,phase,signal:controller.signal}))!==true)fail('NORMALIZATION_DENIED');};
   await guard('before_normalize');started=true;
   if(await step(()=>claim({...query,binding,signal:controller.signal}))!==true)fail('NORMALIZATION_DENIED');
   // Recheck after the claim await, not only before it. No token reaches decoder.
   await guard('claimed_before_decode');
   const expected=freeze({width:response.descriptor.requestedTransform.width,height:response.descriptor.requestedTransform.height});
   const limits=freeze({maximumParentBytes:maximumBytes,maximumOutputBytes:maximumBytes,maximumDecoderOutputBytes:maximumBytes+21,maximumFrames:1});
   const preflight=own(await step(()=>inspectParent({parentBytes:parent,binding,expected,limits,signal:controller.signal})),['fullyDecoded','frameCount','orientation','profile','containerValid','trailingDataAbsent','width','height']);
   if(preflight.fullyDecoded!==true||preflight.frameCount!==1||!['absent','identity'].includes(preflight.orientation)||preflight.profile!=='absent'||preflight.containerValid!==true||preflight.trailingDataAbsent!==true||preflight.width!==expected.width||preflight.height!==expected.height)fail('NORMALIZATION_INSPECTION_FAILED');
   if(sha(parent)!==receipt.derivative.sha256)fail('NORMALIZATION_BINDING_MISMATCH');
   await guard('parent_inspected_before_decode');
   const raw=bytes(await step(()=>normalize({parentBytes:parent,binding,expected,limits,signal:controller.signal})),maximumBytes+21);buffers.push(raw);
   const png=stripNormalizationPngDensity(raw,{...expected,maximumBytes});buffers.push(png);
   const artifact=createManagedImageNormalizationArtifact({requestId:q.requestId,sourceRecord:source,parentResponse:response,parentObjectReceipt:receipt,output:{sha256:sha(png),byteLength:png.length,mime:'image/png',...expected}});
   await guard('after_normalize',artifact);
   const result=own(await step(()=>inspect({parentBytes:parent,pngBytes:png,binding,artifact,expected,limits,signal:controller.signal})),['fullyDecoded','frameCount','parentOrientation','metadataAbsent','pixelsEqual','containerValid','trailingDataAbsent','unknownChunksAbsent','width','height']);
   if(result.containerValid!==true||result.trailingDataAbsent!==true||result.unknownChunksAbsent!==true||result.fullyDecoded!==true||result.frameCount!==1||!['absent','identity'].includes(result.parentOrientation)||result.metadataAbsent!==true||result.pixelsEqual!==true||result.width!==expected.width||result.height!==expected.height)fail('NORMALIZATION_INSPECTION_FAILED');
   // Inspectors are read-only; mutation is detected before handing off bytes.
   if(sha(parent)!==receipt.derivative.sha256||sha(png)!==artifact.output.sha256)fail('NORMALIZATION_BINDING_MISMATCH');
   await guard('before_consume',artifact);
   if(await step(()=>{consumeAttempted=true;return consume({artifact,bytes:png,signal:controller.signal});})!==true)fail('NORMALIZATION_UNCERTAIN');
   await guard('return',artifact);
   if(sha(parent)!==receipt.derivative.sha256||sha(png)!==artifact.output.sha256)fail('NORMALIZATION_BINDING_MISMATCH');
   return artifact;
  }catch(e){
   if(started)poisoned=true;
   const d=!types.isProxy(e)&&e instanceof ManagedImageNormalizationError?Object.getOwnPropertyDescriptor(e,'code'):null;
   throw new ManagedImageNormalizationError(d&&Object.hasOwn(d,'value')?d.value:started?'NORMALIZATION_UNCERTAIN':'NORMALIZATION_UNAVAILABLE',consumeAttempted?'uncertain':'not_sent');
  }finally{
   clearTimeout(timer);if(listener)external.removeEventListener('abort',listener);
   const clear=()=>{buffers.forEach(b=>b.fill(0));busy=false;};
   if(pending.size)Promise.allSettled([...pending]).then(clear);else clear();
  }
 }});
}
