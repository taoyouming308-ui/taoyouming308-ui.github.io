/** Actual private Storage HTTP adapter for the original media lane. Injected
 * network only, default closed, no service-role bypass, public/signed URL,
 * upsert/delete/list or retry. JWT claim parsing is NOT signature verification;
 * Supabase validates the credential and deployed RLS remains mandatory. */
import {types} from 'node:util';
const fail=()=>{throw Error('DESIGN_PRIVATE_TRANSPORT_FAILED');};
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();r[k]=d.value;}return r;}
const pathPattern=/^\/storage\/v1\/object\/customer-design-photos\/[1-9][0-9]{0,15}\/prepared\/[a-f0-9]{64}\/[A-Za-z0-9_-]{1,100}\.(jpg|png|webp)$/;
function copyBytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail();const p=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(p,k).get.call(v),b=get('buffer'),n=get('byteLength');if(types.isSharedArrayBuffer(b)||n<1||n>8388608)fail();return Buffer.from(new Uint8Array(b,get('byteOffset'),n));}
export function createScopedPrivateMediaTransport({enabled=false,origin,credentialProvider,authorize,fetchImplementation}={}){
 let valid=false;try{const u=new URL(origin);valid=u.origin===origin&&u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);}catch{}
 return async input=>{
  let timer,reader,response,body,output,aborted=false;const control=new AbortController();
  if(enabled!==true||!valid||[credentialProvider,authorize,fetchImplementation].some(f=>typeof f!=='function'))fail();
  if(!input||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)fail();
  const q=own(input,['url','method','redirect','credentials','timeoutMs','maxResponseBytes','headers',...(Object.hasOwn(input??{},'body')?['body']:[])]);
  try{
   const u=new URL(q.url),write=q.method==='POST';
   if(u.origin!==origin||!pathPattern.test(u.pathname)||u.search||u.hash||q.url!==u.href||!['GET','POST'].includes(q.method)||q.redirect!=='error'||q.credentials!=='omit'||q.timeoutMs!==10000||!Number.isSafeInteger(q.maxResponseBytes)||q.maxResponseBytes<1||q.maxResponseBytes>(write?4096:8388608))fail();
   const h=own(q.headers,write?['Content-Type','x-upsert']:[]);
   if(write){if(!['image/jpeg','image/png','image/webp'].includes(h['Content-Type'])||h['x-upsert']!=='false')fail();body=copyBytes(q.body);}else if(Object.hasOwn(q,'body'))fail();
   const context=Object.freeze({url:q.url,operation:write?'create':'read',signal:control.signal});
   const check=()=>{if(aborted)fail();};
   const work=(async()=>{
    if(await authorize({...context,phase:'before_credentials'})!==true)fail();check();
    const cr=own(await credentialProvider(context),['apiKey','accessToken','expiresAt']);check();
    if(typeof cr.apiKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,256}$/.test(cr.apiKey)||typeof cr.accessToken!=='string'||cr.accessToken.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cr.accessToken))fail();
    const claims=JSON.parse(Buffer.from(cr.accessToken.split('.')[1],'base64url').toString('utf8'));
    if(claims.role!=='authenticated'||!Number.isSafeInteger(cr.expiresAt)||!Number.isSafeInteger(claims.exp)||claims.exp*1000!==cr.expiresAt||cr.expiresAt<=Date.now()||cr.expiresAt>Date.now()+3600000)fail();
    if(await authorize({...context,phase:'before_io'})!==true)fail();check();if(cr.expiresAt<=Date.now())fail();
    // The old storage abstraction uses a logical object URL for both methods.
    // GET maps to the authenticated wire route; exact response URL is checked.
    const wire=write?q.url:origin+u.pathname.replace('/object/','/object/authenticated/');
    const r=await fetchImplementation(new Request(wire,{method:q.method,headers:{...h,apikey:cr.apiKey,Authorization:'Bearer '+cr.accessToken},...(write?{body}:{}),redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:control.signal}));response=r;
    if(aborted){void r?.body?.cancel().catch(()=>{});fail();}
    check();if(!(r instanceof Response)||r.url!==wire||r.redirected||r.status>=300&&r.status<400||!r.body)fail();
    const declared=r.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>q.maxResponseBytes))fail();
    reader=r.body.getReader();const chunks=[];let size=0,count=0;
    try{for(;;){const item=await reader.read();check();if(item.done)break;if(++count>4096)fail();size+=item.value.byteLength;if(size>q.maxResponseBytes)fail();chunks.push(Buffer.from(item.value));}output=Buffer.concat(chunks,size);}finally{chunks.forEach(b=>b.fill(0));}
    if(await authorize({...context,phase:'after_io'})!==true)fail();check();
    return Object.freeze({url:q.url,status:r.status,redirected:false,body:Uint8Array.from(output)});
   })();
   const stop=new Promise((_,reject)=>{timer=setTimeout(()=>{aborted=true;control.abort();reject(Error('DESIGN_PRIVATE_TRANSPORT_FAILED'));},10000);});
   try{return await Promise.race([work,stop]);}finally{if(aborted)void work.then(v=>v.body.fill(0),()=>{});}
  }catch{fail();}finally{clearTimeout(timer);control.abort();output?.fill(0);body?.fill(0);try{void (reader?reader.cancel():response?.body?.cancel())?.catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
 };
}
