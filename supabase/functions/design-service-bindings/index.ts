import {createServiceBindingHandler} from './handler.mjs';
const PROJECT='https://pdssrmpeiuwvxzsgschm.supabase.co';
const handle=createServiceBindingHandler({enabled:true,async rpc({credential,input,signal}:{credential:string,input:Record<string,unknown>,signal:AbortSignal}){
 const origin=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(origin!==PROJECT||!key)throw Error('UNAVAILABLE');
 const url=PROJECT+'/rest/v1/rpc/design_service_binding';
 const response=await fetch(url,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_credential:credential,p_input:input}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(4500)])});
 if(response.url!==url||response.redirected||!response.headers.get('content-type')?.startsWith('application/json')||Number(response.headers.get('content-length'))>262144)throw Error('UNAVAILABLE');
 const reader=response.body?.getReader();if(!reader)throw Error('UNAVAILABLE');
 const chunks:Uint8Array[]=[];let n=0;
 try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>262144)throw Error('UNAVAILABLE');chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(n);let at=0;for(const p of chunks){bytes.set(p,at);at+=p.length;}
 let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
 if(!response.ok){const e=new Error('RPC_DENIED') as Error&{code?:string};e.code=typeof result?.message==='string'?result.message:'';throw e;}
 return result;
}});
Deno.serve(handle);
