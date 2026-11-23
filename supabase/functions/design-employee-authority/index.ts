import {createLiveEmployeeAuthorityHandler} from './handler.mjs';
// Existing runtime secret stays in Edge memory; never copied to the photo host.
// The RPC is SECURITY INVOKER and executable only by service_role. No old Edge
// handler, session expiry, login or appointment endpoint is modified.
const PROJECT='https://pdssrmpeiuwvxzsgschm.supabase.co';
const handle=createLiveEmployeeAuthorityHandler({async verifySession(credential:string,nonce:string){
 const origin=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(origin!==PROJECT||!key)throw Error('DENIED');
 const url=PROJECT+'/rest/v1/rpc/design_employee_verify_session';
 const response=await fetch(url,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_credential:credential,p_nonce:nonce}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(2500)});
 if(!response.ok||response.url!==url||response.redirected||!response.headers.get('content-type')?.startsWith('application/json')||Number(response.headers.get('content-length'))>4096)throw Error('DENIED');
 let size=0;const chunks=[];for await(const p of response.body??[]){size+=p.length;if(size>4096)throw Error('DENIED');chunks.push(p);}
 const bytes=new Uint8Array(size);let at=0;for(const p of chunks){bytes.set(p,at);at+=p.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
}});
Deno.serve(handle);
