/** Server-only processing operation. No automatic approval, cloud PUT, model or
 * verification issuance. The caller owns returned private bytes and must erase
 * them after a separately approved store. Unknown outcomes are query-only. */
import {createHash} from 'node:crypto';import {types} from 'node:util';import {performance} from 'node:perf_hooks';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedNormalizationProcessingIntent,validateClaimedNormalizationArtifact} from './managed-normalization-processing-contracts.mjs';
import {createManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
const codes=new Set(['CANONICAL_NORMALIZATION_DISABLED','CANONICAL_NORMALIZATION_INVALID','CANONICAL_NORMALIZATION_BUSY','CANONICAL_NORMALIZATION_DENIED','CANONICAL_NORMALIZATION_TIMEOUT','CANONICAL_NORMALIZATION_ABORTED','CANONICAL_NORMALIZATION_UNCERTAIN']);
export class CanonicalNormalizationError extends Error{constructor(code){const c=codes.has(code)?code:'CANONICAL_NORMALIZATION_INVALID';super(c);this.code=c;this.retryable=false;this.outcome=c==='CANONICAL_NORMALIZATION_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new CanonicalNormalizationError(c);},hash=b=>createHash('sha256').update(b).digest('hex'),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function method(v,k){if(!v||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)){const fn=d.value;return(...args)=>Reflect.apply(fn,v,args);}}
const tp=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(tp,k).get;
function bytes(v,max){if(types.isProxy(v)||!types.isUint8Array(v))fail();const b=get('buffer').call(v),n=get('byteLength').call(v);if(types.isSharedArrayBuffer(b)||!Number.isSafeInteger(n)||n<1||n>max)fail();return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
export function createCanonicalNormalizationOperation({enabled=false,processing,storage,runtime,timeoutMs=30000}={}){
 const prepare=method(processing,'prepare'),authorize=method(processing,'authorize'),claim=method(processing,'claim'),guard=method(processing,'guard'),bind=method(processing,'bindArtifact'),readBound=method(processing,'readBoundArtifact'),read=method(storage,'read'),normalize=method(runtime,'normalizeSynthetic');
 const ready=enabled===true&&[prepare,authorize,claim,guard,bind,readBound,read,normalize].every(f=>typeof f==='function')&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000;let busy=false,poisoned=false;
 return Object.freeze({async run(value){
  if(!ready)fail('CANONICAL_NORMALIZATION_DISABLED');if(busy||poisoned)fail('CANONICAL_NORMALIZATION_BUSY');busy=true;
  const controller=new AbortController(),pending=new Set(),owned=[],deadline=performance.now()+timeoutMs;let external,listener,timer,reason=null,claimed=false,finished=false;
  const stop=c=>{if(!reason){reason=c;controller.abort();}};
  const check=()=>{if(finished)fail('CANONICAL_NORMALIZATION_ABORTED');if(external&&aborted.call(external))stop('CANONICAL_NORMALIZATION_ABORTED');if(performance.now()>=deadline)stop('CANONICAL_NORMALIZATION_TIMEOUT');if(reason)fail(reason);};
  async function step(fn){check();const p=Promise.resolve().then(()=>{check();return fn();});pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));let cb;const interrupted=new Promise((_,reject)=>{cb=()=>reject(new CanonicalNormalizationError(reason??'CANONICAL_NORMALIZATION_ABORTED'));controller.signal.addEventListener('abort',cb,{once:true});});try{const r=await Promise.race([p,interrupted]);check();return r;}finally{controller.signal.removeEventListener('abort',cb);}}
  try{
   if(!value||types.isProxy(value))fail();const ds=Object.getOwnPropertyDescriptors(value),keys=['credential','scope','mediaId','parentRequestId','requestId',...(Object.hasOwn(ds,'signal')?['signal']:[])];if(Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail();const q=Object.fromEntries(keys.map(k=>[k,ds[k].value]));
   if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential)||![q.mediaId,q.parentRequestId,q.requestId].every(id))fail();
   const scope=freeze(validateProductionDesignScope(copy(q.scope)));external=q.signal;if(external!==undefined){if(types.isProxy(external))fail();aborted.call(external);listener=()=>stop('CANONICAL_NORMALIZATION_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('CANONICAL_NORMALIZATION_TIMEOUT'),timeoutMs);const selector=freeze({credential:q.credential,scope,mediaId:q.mediaId,parentRequestId:q.parentRequestId,requestId:q.requestId});
   const intent=validateManagedNormalizationProcessingIntent(await step(()=>prepare(selector)));if(intent.requestId!==q.requestId||intent.sourceRecord.mediaId!==q.mediaId||intent.parentResponse.descriptor.requestId!==q.parentRequestId||!equal(intent.authority.scope,scope))fail('CANONICAL_NORMALIZATION_DENIED');
   const request=freeze({credential:q.credential,scope,intent});if(await step(()=>authorize(request))!==true)fail('CANONICAL_NORMALIZATION_DENIED');
   const outcome=await step(()=>{claimed=true;return claim(request);});if(outcome!=='created')fail('CANONICAL_NORMALIZATION_UNCERTAIN');
   const fresh=async()=>{if(await step(()=>guard(request))!==true)fail('CANONICAL_NORMALIZATION_DENIED');};
   async function readBytes(object,descriptor,limit){await fresh();const b=await step(async()=>{const out=bytes(await read({object,derivative:descriptor,private:true,signal:controller.signal}),limit);owned.push(out);return out;});if(b.length!==descriptor.byteLength||hash(b)!==descriptor.sha256)fail('CANONICAL_NORMALIZATION_INVALID');await fresh();return b;}
   const sourceBytes=await readBytes(intent.sourceRecord.object,intent.sourceRecord.source,8388608),parentBytes=await readBytes(intent.parentObjectReceipt.object,intent.parentObjectReceipt.derivative,262144);
   const verifyInputs=()=>{if(hash(sourceBytes)!==intent.sourceRecord.source.sha256||hash(parentBytes)!==intent.parentObjectReceipt.derivative.sha256)fail('CANONICAL_NORMALIZATION_INVALID');};
   await fresh();const output=await step(async()=>{const out=bytes(await normalize({sourceRecord:intent.sourceRecord,parentResponse:intent.parentResponse,parentObjectReceipt:intent.parentObjectReceipt,sourceBytes,parentBytes,signal:controller.signal}),262144);owned.push(out);return out;});
   verifyInputs();await fresh();verifyInputs();
   const t=intent.parentResponse.descriptor.requestedTransform,artifact=createManagedImageNormalizationArtifact({requestId:q.requestId,sourceRecord:intent.sourceRecord,parentResponse:intent.parentResponse,parentObjectReceipt:intent.parentObjectReceipt,output:{sha256:hash(output),byteLength:output.length,mime:'image/png',width:t.width,height:t.height}});
   const bound=validateClaimedNormalizationArtifact(await step(()=>{verifyInputs();return bind({...request,artifact});}));if(!equal(bound.artifact,artifact))fail('CANONICAL_NORMALIZATION_INVALID');
   const current=validateClaimedNormalizationArtifact(await step(()=>readBound({credential:q.credential,scope,requestId:q.requestId})));if(!equal(current,bound))fail('CANONICAL_NORMALIZATION_DENIED');await fresh();verifyInputs();if(hash(output)!==artifact.output.sha256)fail('CANONICAL_NORMALIZATION_INVALID');check();
   return Object.freeze({claimedArtifact:bound,bytes:Uint8Array.from(output)});
  }catch(e){if(claimed){poisoned=true;fail('CANONICAL_NORMALIZATION_UNCERTAIN');}const d=!types.isProxy(e)&&e instanceof CanonicalNormalizationError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new CanonicalNormalizationError(d&&Object.hasOwn(d,'value')?d.value:undefined);}
  finally{finished=true;clearTimeout(timer);controller.abort();if(listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);const clear=()=>{owned.forEach(b=>b.fill(0));busy=false;};if(pending.size)void(async()=>{while(pending.size)await Promise.allSettled([...pending]);clear();})();else clear();}
 }});
}
