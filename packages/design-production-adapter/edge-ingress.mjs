/** Default-closed routing adapter to the original fixed HTTP handler. It never
 * creates an employee, binding, approval, model client or storage capability. */
import {DESIGN_APP1_ORIGIN,DESIGN_EDGE_ORIGIN,DESIGN_EDGE_BASE_PATH} from '../shared/design-hosted-routing.mjs';
const exposed=['x-design-preview','x-design-preview-width','x-design-preview-height','x-design-source-media','x-design-source-bytes','x-design-source-mime'];
export function createDesignEdgeIngress({enabled=false,handle}={}){
 const denied=status=>Response.json({ok:false,error:{code:'DESIGN_EDGE_UNAVAILABLE',outcome:'not_sent',retryable:false}},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 return async request=>{
  if(enabled!==true||typeof handle!=='function')return denied(503);
  try{
   const u=new URL(request.url),prefix=DESIGN_EDGE_BASE_PATH+'/api/design/';
   if(u.origin!==DESIGN_EDGE_ORIGIN||u.username||u.password||u.search||u.hash||/%|\\/.test(u.pathname)||!u.pathname.startsWith(prefix)||u.pathname.slice(prefix.length).includes('//'))return denied(404);
   if(!['POST','OPTIONS'].includes(request.method))return denied(405);
   // Preserve Origin, opaque employee header, body and abort signal. The
   // original handler still authenticates and authorizes every fixed route.
   const forwarded=new Request(DESIGN_APP1_ORIGIN+u.pathname.slice(DESIGN_EDGE_BASE_PATH.length),request);
   const response=await handle(forwarded);
   if(!(response instanceof Response)||response.status>=300&&response.status<400||response.headers.has('location')||response.headers.has('set-cookie'))return denied(502);
   const headers=new Headers(response.headers);
   if(response.status===200&&headers.get('access-control-allow-origin')===DESIGN_APP1_ORIGIN&&headers.get('x-design-preview')==='phone-v2'){
    if(headers.get('cache-control')!=='private, no-store'||exposed.some(k=>!/^[-A-Za-z0-9_./]{1,100}$/.test(headers.get(k)??'')))return denied(502);
    headers.set('access-control-expose-headers',exposed.join(', '));
   }
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }catch{return denied(503);}
 };
}
