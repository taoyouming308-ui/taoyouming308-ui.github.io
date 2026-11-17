/** Explicitly injected, disabled-by-default fetch transport. No keys, retries or default network. */
import {DEEPSEEK_CHAT_ENDPOINT,DEEPSEEK_ASR_ENDPOINT} from './provider-adapter.mjs';
const allowed=new Set([DEEPSEEK_CHAT_ENDPOINT,DEEPSEEK_ASR_ENDPOINT]);
export class OfficialTransportError extends Error{constructor(code){super(code);this.name='OfficialTransportError';this.code=code;this.retryable=false;}}
const fail=code=>{throw new OfficialTransportError(code);};
export function createPreparedOfficialTransport({enabled=false,fetchImplementation}={}){
 return async input=>{
  if(enabled!==true||typeof fetchImplementation!=='function')fail('TRANSPORT_DISABLED');
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join('|')!=='body|credentials|headers|maxResponseBytes|method|redirect|signal|url')fail('TRANSPORT_INVALID_REQUEST');
  if(!allowed.has(input.url)||input.method!=='POST'||input.redirect!=='error'||input.credentials!=='omit'||!(input.signal instanceof AbortSignal)||!Number.isSafeInteger(input.maxResponseBytes)||input.maxResponseBytes<1||input.maxResponseBytes>262144)fail('TRANSPORT_INVALID_REQUEST');
  if(!input.headers||Object.getPrototypeOf(input.headers)!==Object.prototype)fail('TRANSPORT_INVALID_REQUEST');
  const headerKeys=Object.keys(input.headers).sort().join('|');
  if(headerKeys!==(input.url===DEEPSEEK_CHAT_ENDPOINT?'Authorization|Content-Type':'Authorization')||!/^Bearer [A-Za-z0-9._~-]{8,512}$/.test(input.headers.Authorization))fail('TRANSPORT_INVALID_REQUEST');
  if(input.url===DEEPSEEK_CHAT_ENDPOINT){if(input.headers['Content-Type']!=='application/json'||typeof input.body!=='string'||new TextEncoder().encode(input.body).length>196608)fail('TRANSPORT_INVALID_REQUEST');}
  else{if(!(input.body instanceof FormData)||[...input.body.keys()].join('|')!=='file')fail('TRANSPORT_INVALID_REQUEST');const file=input.body.get('file');if(!(file instanceof Blob)||file.size<1||file.size>8*1024*1024||file.type!=='audio/wav'||file.name!=='speech.wav')fail('TRANSPORT_INVALID_REQUEST');}
  if(input.signal.aborted)fail('TRANSPORT_ABORTED');
  const url=input.url,limit=input.maxResponseBytes,signal=input.signal;
  let response,reader;
  try{
   // Request captures the approved body/headers before awaiting any I/O.
   const request=new Request(url,{method:'POST',headers:input.headers,body:input.body,redirect:'error',credentials:'omit',signal,cache:'no-store',referrerPolicy:'no-referrer'});
   response=await fetchImplementation(request);
   if(!(response instanceof Response)||response.url!==url||response.redirected||response.status>=300&&response.status<400)fail('TRANSPORT_REDIRECT_REJECTED');
   const contentType=response.headers.get('content-type')||'';
   if(!/^application\/json(?:\s*;|$)/i.test(contentType))fail('TRANSPORT_INVALID_RESPONSE');
   const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))fail('TRANSPORT_RESPONSE_LIMIT');
   if(!response.body)fail('TRANSPORT_INVALID_RESPONSE');
   reader=response.body.getReader();let length=0;const chunks=[];
   while(true){if(signal.aborted)fail('TRANSPORT_ABORTED');const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))fail('TRANSPORT_INVALID_RESPONSE');length+=value.length;if(length>limit)fail('TRANSPORT_RESPONSE_LIMIT');chunks.push(value);}
   if(signal.aborted)fail('TRANSPORT_ABORTED');
   const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
   return {url,redirected:false,status:response.status,headers:{'content-type':contentType},body:bytes};
  }catch(error){if(error instanceof OfficialTransportError)throw error;fail('TRANSPORT_FAILED');}
  finally{if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}else if(response?.body){try{await response.body.cancel();}catch{}}}
 };
}
