/** Server-only composition, not a browser endpoint. Metadata publication precedes
 * private binary storage, so failure can leave pending metadata/private orphans.
 * The independently authorized once-put store owns byte copying and readback.
 * A stored hash is integrity only, never decode or source relationship evidence. */
import {types} from 'node:util';
import {policyCopy,policyFreeze} from './approval-attempt-contracts.mjs';
import {createHash} from 'node:crypto';
import {validateManagedImageResponse,managedImageDigest,MANAGED_IMAGE_RESPONSE_SCHEMA} from './managed-image-contracts.mjs';
export function createManagedImagePersistenceSink({enabled=false,repository,store}={}){
 return async function persistDerivative(input){
  if(enabled!==true||!['readSourceStatus','publishResponse'].every(k=>typeof repository?.[k]==='function')||typeof store?.put!=='function')throw Error('MANAGED_PERSISTENCE_DISABLED');
  if(types.isProxy(input)||!input||Object.getPrototypeOf(input)!==Object.prototype)throw Error('MANAGED_PERSISTENCE_INVALID');
  const keys=['credential','scope','descriptor','bytes','signal'];if(Reflect.ownKeys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)||{},'value')))throw Error('MANAGED_PERSISTENCE_INVALID');
  const {credential,bytes,signal}=input;
  const scope=policyFreeze(policyCopy(input.scope)),descriptor=policyFreeze(policyCopy(input.descriptor));
  try{Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal);}catch{throw Error('MANAGED_PERSISTENCE_INVALID');}
  // Copy before the first await: the transform lends a buffer erased on timeout.
  if(types.isProxy(bytes)||!types.isUint8Array(bytes))throw Error('MANAGED_PERSISTENCE_INVALID');
  const typed=Object.getPrototypeOf(Uint8Array.prototype),read=k=>Object.getOwnPropertyDescriptor(typed,k).get.call(bytes),buffer=read('buffer'),length=read('byteLength');
  if(types.isSharedArrayBuffer(buffer)||length<1||length>8*1024*1024)throw Error('MANAGED_PERSISTENCE_INVALID');
  const owned=Buffer.from(new Uint8Array(buffer,read('byteOffset'),length));let storePending;
  const step=async fn=>{check();let listener;const stopped=new Promise((_,reject)=>{listener=()=>reject(Error('MANAGED_PERSISTENCE_ABORTED'));signal.addEventListener('abort',listener,{once:true});});try{return await Promise.race([Promise.resolve().then(()=>{check();return fn();}),stopped]);}finally{signal.removeEventListener('abort',listener);}};
  const check=()=>{if(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal))throw Error('MANAGED_PERSISTENCE_ABORTED');};
  try{
   check();const current=await step(()=>repository.readSourceStatus({credential,scope,mediaId:descriptor.mediaId}));check();
   const response=validateManagedImageResponse({schemaVersion:MANAGED_IMAGE_RESPONSE_SCHEMA,sourceRecordDigest:managedImageDigest(current.sourceRecord),descriptor},current.sourceRecord);
   if(owned.length!==descriptor.derivative.byteLength||createHash('sha256').update(owned).digest('hex')!==descriptor.derivative.sha256)throw Error('MANAGED_PERSISTENCE_INVALID');
   const published=await step(()=>repository.publishResponse({credential,scope,sourceRecordDigest:response.sourceRecordDigest,descriptor}));check();
   if(managedImageDigest(published)!==managedImageDigest(response))throw Error('MANAGED_PERSISTENCE_INVALID');
   const saved=await step(()=>{storePending=Promise.resolve(store.put({credential,scope,response,bytes:owned,signal}));return storePending;});check();
   if(types.isProxy(saved)||!saved||Object.getPrototypeOf(saved)!==Object.prototype||Reflect.ownKeys(saved).length!==2||Object.getOwnPropertyDescriptor(saved,'stored')?.value!==true||Object.getOwnPropertyDescriptor(saved,'responseDigest')?.value!==managedImageDigest(response))throw Error('MANAGED_PERSISTENCE_INVALID');
   return Object.freeze({stored:true,derivativeSha256:descriptor.derivative.sha256});
  }finally{owned.fill(0);}
 };
}
