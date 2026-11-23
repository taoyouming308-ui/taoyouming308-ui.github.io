import {SERVICE_BINDING_URL,validateServiceBindingInput} from '../shared/design-service-binding-contract.mjs';
export class AdminServiceBindingError extends Error{
 constructor(code,outcome='not_sent'){super(code);this.code=code;this.outcome=outcome;this.retryable=false;}
}
export function createAdminServiceBindingClient({getCredential,fetchImplementation=globalThis.fetch}={}){
 async function request(input){
  try{validateServiceBindingInput(input);}catch{throw new AdminServiceBindingError('DESIGN_SERVICE_INVALID');}
  const credential=typeof getCredential==='function'?getCredential():null;
  if(typeof credential!=='string'||!/^[a-fA-F0-9-]{72}$/.test(credential)||typeof fetchImplementation!=='function')throw new AdminServiceBindingError('DESIGN_SERVICE_DENIED');
  let sent=false;const write=['confirm','revoke'].includes(input.action),deadline=AbortSignal.timeout(10000);
  try{
   sent=true;const response=await fetchImplementation(SERVICE_BINDING_URL,{method:'POST',headers:{'content-type':'application/json','x-design-admin-session':credential},body:JSON.stringify(input),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:deadline});
   if(response.url!==SERVICE_BINDING_URL||response.redirected||!response.headers.get('content-type')?.startsWith('application/json')||!/\bprivate\b/i.test(response.headers.get('cache-control')??'')||!/\bno-store\b/i.test(response.headers.get('cache-control')??'')||Number(response.headers.get('content-length'))>262144)throw Error('INVALID_RESPONSE');
   let n=0;const chunks=[];for await(const p of response.body??[]){n+=p.length;if(n>262144||deadline.aborted)throw Error('INVALID_RESPONSE');chunks.push(p);}
   const bytes=new Uint8Array(n);let at=0;for(const p of chunks){bytes.set(p,at);at+=p.length;}
   let doc;try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
   if(getCredential()!==credential)throw Error('IDENTITY_CHANGED');
   if(response.status===200&&doc?.ok===true&&doc.result&&typeof doc.result==='object'&&!Array.isArray(doc.result))return doc.result;
   const codes=['DESIGN_SERVICE_STALE','DESIGN_SERVICE_CONFLICT','DESIGN_SERVICE_BUSY','DESIGN_SERVICE_DENIED','DESIGN_SERVICE_TOO_MANY','DESIGN_SERVICE_INVALID'];
   if(doc?.ok===false&&codes.includes(doc.error?.code)&&doc.error?.outcome==='not_sent')throw new AdminServiceBindingError(doc.error.code);
   throw Error('INVALID_RESPONSE');
  }catch(e){if(e instanceof AdminServiceBindingError)throw e;throw new AdminServiceBindingError('DESIGN_SERVICE_UNAVAILABLE',sent&&write?'uncertain':'not_sent');}
 }
 return Object.freeze({request});
}
