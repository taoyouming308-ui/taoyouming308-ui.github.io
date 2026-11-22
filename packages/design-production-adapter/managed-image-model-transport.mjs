/** Independent managed-model 1MiB transport. Never selected by the old v3 adapter.
 * Explicit injected fetch only; this module grants no approval or claim authority. */
import {types} from 'node:util';
import {MANAGED_IMAGE_MODEL_ENDPOINT as endpoint,MANAGED_IMAGE_MODEL_MAX_BODY_BYTES as limit} from './managed-image-model-request.mjs';
export class ManagedModelTransportError extends Error{constructor(){super('MANAGED_MODEL_TRANSPORT_FAILED');this.code=this.message;this.retryable=false;}}
const fail=()=>{throw new ManagedModelTransportError();};
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
export function createManagedImageModelTransport({enabled=false,fetchImplementation}={}){return async value=>{
 let response,reader;const cancel=()=>{try{const p=reader?reader.cancel():response?.body?.cancel();Promise.resolve(p).catch(()=>{});}catch{}};
 try{
 if(enabled!==true||typeof fetchImplementation!=='function')fail();const v=own(value,['url','method','headers','body','redirect','credentials','signal','maxResponseBytes']),h=own(v.headers,['Authorization','Content-Type']);
 if(v.url!==endpoint||v.method!=='POST'||v.redirect!=='error'||v.credentials!=='omit'||!(v.signal instanceof AbortSignal)||v.signal.aborted||v.maxResponseBytes!==262144||typeof v.body!=='string'||Buffer.byteLength(v.body)>limit||h['Content-Type']!=='application/json'||typeof h.Authorization!=='string'||!/^Bearer [A-Za-z0-9._~-]{16,500}$/.test(h.Authorization))fail();
 const request=new Request(endpoint,{method:'POST',body:v.body,headers:h,redirect:'error',credentials:'omit',signal:v.signal,cache:'no-store',referrerPolicy:'no-referrer'});
 let onAbort;const aborted=new Promise((_,reject)=>{onAbort=()=>{cancel();reject(new ManagedModelTransportError());};v.signal.addEventListener('abort',onAbort,{once:true});});
 try{
 const pending=Promise.resolve().then(()=>{if(v.signal.aborted)fail();return fetchImplementation(request);}).then(r=>{response=r;if(v.signal.aborted){cancel();fail();}return r;});
 response=await Promise.race([pending,aborted]);if(!(response instanceof Response)||response.url!==endpoint||response.redirected||response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail();
 const n=response.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>262144))fail();if(!response.body)fail();reader=response.body.getReader();let size=0;const chunks=[];
 while(true){const item=await Promise.race([reader.read(),aborted]);if(v.signal.aborted)fail();if(item.done)break;if(!(item.value instanceof Uint8Array))fail();size+=item.value.length;if(size>262144)fail();chunks.push(Buffer.from(item.value));}
 return Object.freeze({url:endpoint,status:200,redirected:false,headers:Object.freeze({'content-type':'application/json'}),body:Buffer.concat(chunks,size)});
 }finally{v.signal.removeEventListener('abort',onAbort);}
 }catch{fail();}finally{cancel();try{reader?.releaseLock();}catch{}}
};}
