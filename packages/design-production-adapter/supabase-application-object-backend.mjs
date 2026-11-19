/** Prepared Supabase application-manifest object I/O. No default fetch, credentials,
 * manifest publication, retry, native versions, WORM or decoding claims.
 * Trusted deployment must independently qualify private bucket + INSERT/SELECT-only
 * scoped RLS. JWT parsing below rejects obvious bypass keys; it is NOT verification
 * of a JWT signature or proof of deployed permissions. authorize must fresh-check
 * the complete authority/claim/permission, not trust target/hash as authorization.
 * Docs: https://supabase.com/docs/guides/storage/serving/downloads
 * https://supabase.com/docs/guides/storage/uploads/standard-uploads
 * Authenticated CDN responses may outlive revocation; final application guard is
 * mandatory. Runtime credentials must never be given to the browser or logged.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {performance} from 'node:perf_hooks';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';
const codes=new Set(['APPLICATION_OBJECT_DISABLED','APPLICATION_OBJECT_INVALID','APPLICATION_OBJECT_BUSY','APPLICATION_OBJECT_DENIED','APPLICATION_OBJECT_INTEGRITY','APPLICATION_OBJECT_TIMEOUT','APPLICATION_OBJECT_ABORTED','APPLICATION_OBJECT_CONFLICT','APPLICATION_OBJECT_UNCERTAIN']);
export class SupabaseApplicationObjectError extends Error{
 constructor(code){const c=codes.has(code)?code:'APPLICATION_OBJECT_DENIED';super(c);this.code=c;this.outcome=c==='APPLICATION_OBJECT_UNCERTAIN'?'uncertain':c==='APPLICATION_OBJECT_CONFLICT'?'not_created':'not_sent';this.retryable=false;}
}
const fail=c=>{throw new SupabaseApplicationObjectError(c);};
const hash=b=>createHash('sha256').update(b).digest('hex');
function own(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('APPLICATION_OBJECT_INVALID');const o={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('APPLICATION_OBJECT_INVALID');o[k]=d.value;}return o;}
function shape(v,required,optional=[]){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('APPLICATION_OBJECT_INVALID');return own(v,[...required,...optional.filter(k=>Object.hasOwn(v,k))]);}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function copyBytes(v,limit){if(types.isProxy(v)||!types.isUint8Array(v))fail('APPLICATION_OBJECT_INVALID');const n=get('byteLength').call(v),b=get('buffer').call(v);if(types.isSharedArrayBuffer(b)||!n||n>limit)fail('APPLICATION_OBJECT_INTEGRITY');return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
const abortGet=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const safeCode=e=>{if(!e||types.isProxy(e)||!(e instanceof SupabaseApplicationObjectError))return 'APPLICATION_OBJECT_DENIED';const d=Object.getOwnPropertyDescriptor(e,'code');return d&&Object.hasOwn(d,'value')&&codes.has(d.value)?d.value:'APPLICATION_OBJECT_DENIED';};
const pathOK=s=>typeof s==='string'&&s.length<=800&&s.split('/').every(p=>/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(p)&&p!=='.'&&p!=='..');
export function createSupabaseApplicationObjectBackend(config={}){
 let c,ready=false;
 try{c=own(config,['enabled','projectOrigin','bucket','keyPrefix','transport','credentialProvider','authorize','timeoutMs','maxBytes']);const u=new URL(c.projectOrigin);ready=c.enabled===true&&u.origin===c.projectOrigin&&u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)&&typeof c.bucket==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(c.bucket)&&c.keyPrefix==='managed-content/v1'&&['transport','credentialProvider','authorize'].every(k=>typeof c[k]==='function'&&!types.isProxy(c[k]))&&Number.isSafeInteger(c.timeoutMs)&&c.timeoutMs>0&&c.timeoutMs<=30000&&Number.isSafeInteger(c.maxBytes)&&c.maxBytes>0&&c.maxBytes<=IMAGE_UPLOAD_MAX_BYTES;c=Object.freeze(c);}catch{}
 let busy=false,poisoned=false;
 async function run(input,write){
  if(!ready)fail('APPLICATION_OBJECT_DISABLED');if(busy||poisoned)fail('APPLICATION_OBJECT_BUSY');busy=true;
  let timer,external,listener,owned,result,reader,sent=false,conflict=false,reason,stopResolve;
  const controller=new AbortController(),deadline=performance.now()+c.timeoutMs,stopPromise=new Promise(r=>stopResolve=r);
  const stop=code=>{if(!reason){reason=code;controller.abort();stopResolve(new SupabaseApplicationObjectError(sent&&write?'APPLICATION_OBJECT_UNCERTAIN':code));}};
  const check=()=>{if(external&&abortGet.call(external))stop('APPLICATION_OBJECT_ABORTED');if(performance.now()>=deadline)stop('APPLICATION_OBJECT_TIMEOUT');if(reason)fail(reason);};
  const step=async fn=>{check();const v=await fn();check();return v;};
  const work=(async()=>{try{
   const q=shape(input,['target','content',...(write?['bytes','ifAbsent']:['maxBytes']),'private'],['signal']);
   const target=Object.freeze(own(q.target,['projectOrigin','bucket','key'])),content=Object.freeze(own(q.content,['sha256','byteLength','mime']));
   if(q.private!==true||(write?q.ifAbsent!==true:q.maxBytes!==content.byteLength)||target.projectOrigin!==c.projectOrigin||target.bucket!==c.bucket||!pathOK(target.key)||!/^managed-content\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(target.key)||target.key.split('/').at(-1)!==content.sha256||typeof content.sha256!=='string'||!/^[a-f0-9]{64}$/.test(content.sha256)||!Number.isSafeInteger(content.byteLength)||content.byteLength<1||content.byteLength>c.maxBytes||!['image/png','image/jpeg','image/webp'].includes(content.mime))fail('APPLICATION_OBJECT_INVALID');
   if(write){owned=copyBytes(q.bytes,content.byteLength);if(owned.length!==content.byteLength||hash(owned)!==content.sha256)fail('APPLICATION_OBJECT_INTEGRITY');}
   if(q.signal!==undefined){external=q.signal;if(types.isProxy(external))fail('APPLICATION_OBJECT_INVALID');abortGet.call(external);listener=()=>stop('APPLICATION_OBJECT_ABORTED');EventTarget.prototype.addEventListener.call(external,'abort',listener,{once:true});}
   timer=setTimeout(()=>stop('APPLICATION_OBJECT_TIMEOUT'),Math.max(1,deadline-performance.now()));check();
   const guard=async phase=>{if(await step(()=>c.authorize(Object.freeze({operation:write?'create':'read',phase,target,content,signal:controller.signal})))!==true)fail('APPLICATION_OBJECT_DENIED');};
   await guard('before_credentials');
   // Credentials remain confined to this trusted server adapter and transport.
   const cr=own(await step(()=>c.credentialProvider(Object.freeze({target,operation:write?'create':'read',signal:controller.signal}))),['apiKey','accessToken','expiresAt']);
   let claims;try{if(typeof cr.accessToken!=='string'||cr.accessToken.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cr.accessToken))throw 0;claims=JSON.parse(Buffer.from(cr.accessToken.split('.')[1],'base64url').toString());}catch{fail('APPLICATION_OBJECT_DENIED');}
   if(typeof cr.apiKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,256}$/.test(cr.apiKey)||claims.role!=='authenticated'||!Number.isSafeInteger(cr.expiresAt)||!Number.isSafeInteger(claims.exp)||claims.exp*1000!==cr.expiresAt||cr.expiresAt<=Date.now()||cr.expiresAt>Date.now()+3600000)fail('APPLICATION_OBJECT_DENIED');
   const url=c.projectOrigin+'/storage/v1/object/'+(write?'':'authenticated/')+encodeURIComponent(c.bucket)+'/'+target.key.split('/').map(encodeURIComponent).join('/');
   const headers=Object.freeze({apikey:cr.apiKey,Authorization:'Bearer '+cr.accessToken,...(write?{'Content-Type':content.mime,'x-upsert':'false','Cache-Control':'no-store'}:{Accept:content.mime})});
   await guard('before_io');check();if(cr.expiresAt<=Date.now())fail('APPLICATION_OBJECT_DENIED');
   sent=true;
   const raw=await c.transport(Object.freeze({url,method:write?'POST':'GET',headers,...(write?{body:owned}:{}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal,maxResponseBytes:write?4096:content.byteLength}));
   // Own late response stream even when its shape is invalid, so it is cancelled.
   const bd=raw&&!types.isProxy(raw)?Object.getOwnPropertyDescriptor(raw,'body'):null;
   if(bd&&Object.hasOwn(bd,'value')&&!types.isProxy(bd.value)&&bd.value instanceof ReadableStream)reader=ReadableStream.prototype.getReader.call(bd.value);
   check();const r=own(raw,['url','redirected','status','mime','body']);
   if(r.url!==url||r.redirected!==false||!Number.isSafeInteger(r.status)||r.status<100||r.status>599||r.status>=300&&r.status<400||!reader)fail('APPLICATION_OBJECT_INTEGRITY');
   if(write&&r.status===409){conflict=true;fail('APPLICATION_OBJECT_CONFLICT');}
   if(write?![200,201].includes(r.status):r.status!==200)fail('APPLICATION_OBJECT_DENIED');
   if(!write&&r.mime!==content.mime)fail('APPLICATION_OBJECT_INTEGRITY');
   const chunks=[];let n=0,total=0;
   try{for(;;){const v=await step(()=>reader.read());if(++n>4096)fail('APPLICATION_OBJECT_INTEGRITY');if(v.done)break;const b=copyBytes(v.value,write?4096:content.byteLength);total+=b.length;if(total>(write?4096:content.byteLength)){b.fill(0);fail('APPLICATION_OBJECT_INTEGRITY');}chunks.push(b);}if(!write)result=Buffer.concat(chunks,total);}finally{for(const b of chunks)b.fill(0);}
   reader.releaseLock();reader=null;
   if(!write&&(result.length!==content.byteLength||hash(result)!==content.sha256))fail('APPLICATION_OBJECT_INTEGRITY');
   await guard('after_io');check();
   return write?Object.freeze({target,created:true,private:true}):Object.freeze({target,content,bytes:result,private:true});
  }catch(e){if(result){result.fill(0);result=null;}throw new SupabaseApplicationObjectError(write&&sent&&!conflict?'APPLICATION_OBJECT_UNCERTAIN':safeCode(e));}
  finally{clearTimeout(timer);if(external&&listener)EventTarget.prototype.removeEventListener.call(external,'abort',listener);if(owned)owned.fill(0);if(reader){poisoned=true;try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}busy=false;}})();
  // Attach handlers immediately; a non-settling dependency retains admission.
  const outcome=await Promise.race([work.then(value=>({value}),error=>({error})),stopPromise.then(error=>({error,stopped:true}))]);
  if(outcome.stopped){poisoned=true;work.then(v=>{if(v?.bytes)v.bytes.fill(0);},()=>{});}
  if(outcome.error)throw outcome.error;return outcome.value;
 }
 return Object.freeze({createOnly:q=>run(q,true),readExact:q=>run(q,false)});
}
