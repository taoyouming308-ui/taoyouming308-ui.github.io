/** Pure structure reuse only. Never records authorization, DB provenance or live access. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {types as nodeTypes} from 'node:util';
import {Buffer} from 'node:buffer';
const MAX_ENTRIES=64,MAX_BYTES=16*1024*1024;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(key=>JSON.stringify(key)+':'+canonical(v[key])).join(',')+'}';
function snapshot(value,invalid){
 let nodes=0,bytes=0;const charge=n=>{bytes+=n;if(bytes>32*1024*1024)invalid();};
 function copy(v,depth){
  if(++nodes>750000||depth>80||nodeTypes.isProxy(v))invalid();
  if(v===null||typeof v==='boolean'||typeof v==='string'){if(typeof v==='string'&&v.length>65536)invalid();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))invalid();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))invalid();
  const keys=Reflect.ownKeys(v);
  if(Array.isArray(v)){charge(2+Math.max(0,v.length-1));if(keys.length!==v.length+1)invalid();const result=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))invalid();result.push(copy(d.value,depth+1));}return result;}
  charge(2+Math.max(0,keys.length-1));const result={};
  for(const key of keys){if(typeof key!=='string'||key.length>65536||['__proto__','prototype','constructor'].includes(key))invalid();const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))invalid();charge(Buffer.byteLength(JSON.stringify(key))+1);result[key]=copy(d.value,depth+1);}return result;
 }return copy(value,0);
}
function deeplyFrozen(value){return value===null||typeof value!=='object'||Object.isFrozen(value)&&Object.values(value).every(deeplyFrozen);}
/** One private cache namespace per trusted validator. A different factory cannot poison it. */
export function createRequestLocalRecordValidator({validateCopied,invalid,snapshot:trustedSnapshot}={}){
 if(typeof validateCopied!=='function'||typeof invalid!=='function'||trustedSnapshot!==undefined&&typeof trustedSnapshot!=='function')throw TypeError('PURE_VALIDATOR_CONFIGURATION');
 const storage=new AsyncLocalStorage();
 const reject=()=>{invalid();throw Error('PURE_VALIDATOR_INVALID_CALLBACK');};
 const safeSnapshot=trustedSnapshot??(value=>snapshot(value,reject));
 function validate(value,scope){
  // Every hit still snapshots new input without invoking getters or proxy traps.
  const copied=safeSnapshot(value),copiedScope=safeSnapshot(scope),context=storage.getStore();
  if(!context||context.closed)return validateCopied(copied,copiedScope);
  const recordText=JSON.stringify(copied),key=canonical([copiedScope,copied])+'\n'+JSON.stringify([copiedScope,copied]);
  const cached=context.entries.get(key);if(cached)return cached;
  const result=validateCopied(copied,copiedScope);
  // Only an immutable, exact record result can be reused. No promise or caller
  // boolean can substitute for successful synchronous structural validation.
  if(!result||typeof result!=='object'||nodeTypes.isPromise(result))return result;
  const checkedResult=safeSnapshot(result);
  if(!deeplyFrozen(result)||JSON.stringify(checkedResult)!==recordText)return result;
  const cost=Buffer.byteLength(key)+Buffer.byteLength(recordText);
  if(!context.closed&&context.entries.size<MAX_ENTRIES&&cost<=MAX_BYTES-context.bytes){context.entries.set(key,result);context.bytes+=cost;}
  return result;
 }
 async function run(work){
  if(typeof work!=='function')throw TypeError('PURE_VALIDATOR_WORK_REQUIRED');
  const context={closed:false,entries:new Map(),bytes:0};
  try{return await storage.run(context,work);}finally{context.closed=true;context.entries.clear();context.bytes=0;}
 }
 return Object.freeze({validate,run});
}
