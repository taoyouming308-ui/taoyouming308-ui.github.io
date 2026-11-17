/** Pure derived structure only. No authority, source provenance or live access.
 * Each factory owns a private namespace. Every handle first calls its trusted
 * record validator; callers cannot nominate a cache key, hash or validation flag.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {types} from 'node:util';
import {Buffer} from 'node:buffer';

const MAX_ENTRIES=64,MAX_BYTES=16*1024*1024;
const invalid=()=>{throw TypeError('DERIVED_SNAPSHOT_INVALID');};
function immutableJSON(value){
 let nodes=0;
 function visit(v,depth){
  if(++nodes>1500000||depth>90||types.isProxy(v))invalid();
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))invalid();return;}
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype)||!Object.isFrozen(v))invalid();
  const keys=Reflect.ownKeys(v);
  if(Array.isArray(v)){
   if(keys.length!==v.length+1)invalid();
   for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))invalid();visit(d.value,depth+1);}return;
  }
  for(const key of keys){
   if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))invalid();
   const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))invalid();visit(d.value,depth+1);
  }
 }
 if(value===null||typeof value!=='object')invalid();visit(value,0);return value;
}

export function createRequestLocalDerivedSnapshot({validateRecord,createSnapshot}={}){
 if(typeof validateRecord!=='function'||typeof createSnapshot!=='function')throw TypeError('DERIVED_SNAPSHOT_CONFIGURATION');
 const local=new AsyncLocalStorage();
 function validate(value,scope){
  // Never use an earlier record or derived result to skip fresh input checking.
  const record=validateRecord(value,scope),context=local.getStore();
  if(!context||context.closed||!context.proven.has(record)){
   immutableJSON(record);
   if(context&&!context.closed)context.proven.add(record);
  }
  return Object.freeze({record,snapshot(){
   // A handle retained past finally, used in another request, or invoked in a
   // nested scope cannot reach its former cache. It can only recompute pure data.
   const active=context&&!context.closed&&local.getStore()===context;
   if(active&&context.entries.has(record))return context.entries.get(record);
   const result=immutableJSON(createSnapshot(record));
   if(active&&context.entries.size<MAX_ENTRIES){
    // Both key and value are deeply frozen data descriptors. JSON serialization
    // cannot invoke a caller getter/toJSON. Count retained keys conservatively.
    const bytes=Buffer.byteLength(JSON.stringify(record))+Buffer.byteLength(JSON.stringify(result));
    if(bytes<=MAX_BYTES-context.bytes){context.entries.set(record,result);context.bytes+=bytes;}
   }
   return result;
  }});
 }
 async function run(work){
  if(typeof work!=='function')throw TypeError('DERIVED_SNAPSHOT_WORK_REQUIRED');
  const context={closed:false,entries:new Map(),proven:new WeakSet(),bytes:0};
  try{return await local.run(context,work);}finally{context.closed=true;context.entries.clear();context.proven=new WeakSet();context.bytes=0;}
 }
 return Object.freeze({validate,run});
}
