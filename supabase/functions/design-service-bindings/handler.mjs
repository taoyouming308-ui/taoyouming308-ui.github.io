/** Fixed custom-session service binding API. No photo, model or Storage I/O. */
import {SERVICE_BINDING_URL,SERVICE_BINDING_APP,validateServiceBindingInput} from '../../../packages/shared/design-service-binding-contract.mjs';
export {SERVICE_BINDING_URL,SERVICE_BINDING_APP,validateServiceBindingInput};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
/** @param {{enabled?:boolean,rpc?:(q:{credential:string,input:Record<string,unknown>,signal:AbortSignal})=>Promise<Record<string,unknown>>}} config */
export function createServiceBindingHandler({enabled=false,rpc}={}){
 return async request=>{
  const origin=request.headers.get('origin');
  const headers={'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff','vary':'Origin',...(origin===SERVICE_BINDING_APP?{'access-control-allow-origin':SERVICE_BINDING_APP}: {})};
  const reply=(status,code,outcome='not_sent')=>Response.json({ok:false,error:{code,outcome,retryable:false}},{status,headers});
  if(enabled!==true||typeof rpc!=='function')return reply(503,'DESIGN_SERVICE_UNAVAILABLE');
  let sent=false,write=false;
  try{
   const u=new URL(request.url),publicUrl=new URL(SERVICE_BINDING_URL);
   const direct=u.origin===publicUrl.origin&&u.pathname===publicUrl.pathname;
   const gateway=u.origin===publicUrl.origin.replace('https:','http:')&&u.pathname==='/design-service-bindings'&&request.headers.get('host')==='edge-runtime.supabase.com';
   if(!direct&&!gateway||u.search||u.hash||u.username||u.password)return reply(404,'DESIGN_SERVICE_UNAVAILABLE');
   if(origin!==SERVICE_BINDING_APP)return reply(403,'DESIGN_SERVICE_DENIED');
   if(request.method==='OPTIONS'){
    const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(request.headers.get('access-control-request-method')!=='POST'||requested.some(x=>!['content-type','x-design-admin-session','x-employee-session'].includes(x)))return reply(403,'DESIGN_SERVICE_DENIED');
    return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, x-design-admin-session, x-employee-session'}});
   }
   if(request.method!=='POST')return reply(405,'DESIGN_SERVICE_INVALID');
   if(request.headers.has('authorization')||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')||Number(request.headers.get('content-length'))>12000)return reply(400,'DESIGN_SERVICE_INVALID');
   const reader=request.body?.getReader();if(!reader)return reply(400,'DESIGN_SERVICE_INVALID');
   const parts=[];let n=0,timer;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DESIGN_SERVICE_INVALID')),1500);});
   try{for(;;){const p=await Promise.race([reader.read(),timeout]);if(p.done)break;n+=p.value.length;if(n>12000)throw Error('DESIGN_SERVICE_INVALID');parts.push(p.value);}}finally{clearTimeout(timer);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
   const bytes=new Uint8Array(n);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
   let input;try{input=validateServiceBindingInput(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}finally{bytes.fill(0);}
   const employee=request.headers.get('x-employee-session'),admin=request.headers.get('x-design-admin-session');
   if(input.action==='resolve'?!employee||admin!==null:!admin||employee!==null)return reply(403,'DESIGN_SERVICE_DENIED');
   const credential=input.action==='resolve'?employee:admin;
   if(input.action==='resolve'?credential.length<32||credential.length>200||/[\s\u0000-\u001f\u007f]/.test(credential):!/^[a-fA-F0-9-]{72}$/.test(credential))return reply(403,'DESIGN_SERVICE_DENIED');
   if(request.signal.aborted)return reply(400,'DESIGN_SERVICE_INVALID');
   write=['confirm','revoke'].includes(input.action);sent=true;
   const result=await rpc({credential,input,signal:request.signal});
   const encoded=JSON.stringify(result);
   if(!plain(result)||encoded.length>256*1024||encoded.includes(credential))throw Error('DESIGN_SERVICE_RESPONSE_INVALID');
   return Response.json({ok:true,result},{status:200,headers});
  }catch(error){
   const code=error?.code;
   if(['DESIGN_SERVICE_STALE','DESIGN_SERVICE_CONFLICT'].includes(code))return reply(409,code);
   if(code==='DESIGN_SERVICE_BUSY')return reply(503,code);
   if(['DESIGN_SERVICE_DENIED','DESIGN_EMPLOYEE_DENIED','DESIGN_SERVICE_SCOPE_IMMUTABLE'].includes(code))return reply(403,'DESIGN_SERVICE_DENIED');
   if(code==='DESIGN_SERVICE_TOO_MANY')return reply(422,code);
   if(!sent)return reply(400,'DESIGN_SERVICE_INVALID');
   return reply(503,'DESIGN_SERVICE_UNAVAILABLE',write?'uncertain':'not_sent');
  }
 };
}
