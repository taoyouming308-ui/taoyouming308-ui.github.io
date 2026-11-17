/** Explicit Node listener for an injected Fetch runtime. Default off; loopback
 * only. TLS/routing/DB/storage/worker installation remain deployment work.
 * This adapter never serves files, keys, approvals, arbitrary proxy URLs or SQL.
 * A timed-out unresolved runtime keeps its admission slot: no unbounded queue. */
import {createServer} from 'node:http';
import {once} from 'node:events';
const REQUEST_LIMIT=12*1024*1024,RESPONSE_LIMIT=64*1024*1024;
const safeHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
export async function startDesignNodeServer({enabled=false,runtime,publicOrigin,port=0,maxConcurrent=4,timeoutMs=30000}={}){
 if(enabled!==true)throw Error('DESIGN_NODE_SERVER_DISABLED');
 let origin;try{const u=new URL(publicOrigin);if(u.protocol==='https:'&&u.origin===publicOrigin)origin=u.origin;}catch{}
 if(!origin||typeof runtime?.handle!=='function'||!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('DESIGN_NODE_SERVER_INVALID');
 const active=new Set(),sockets=new Set();let closing=false;
 const reply=(res,status,code)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,safeHeaders);res.end(JSON.stringify({ok:false,error:{code,retryable:false}}));}};
 async function serve(req,res){
  // Validate raw path before URL normalization; ignore all proxy/forwarded hosts.
  if(closing)return reply(res,503,'DESIGN_SERVER_CLOSING');
  if(req.method!=='POST'||!/^\/api\/design\/[a-z-]+(?:\/[a-z-]+){0,2}$/.test(req.url??''))return reply(res,404,'DESIGN_ROUTE_UNAVAILABLE');
  if(req.headers.origin!==origin)return reply(res,403,'DESIGN_ORIGIN_DENIED');
  if(active.size>=maxConcurrent)return reply(res,503,'DESIGN_SERVER_BUSY');
  const token={},abort=new AbortController();active.add(token);
  let timer,body,reader,settled=false,ended=false;
  const stop=()=>abort.abort();
  const close=()=>{if(!res.writableEnded)stop();};req.once('aborted',stop);res.once('close',close);
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stop();reply(res,504,'DESIGN_REQUEST_TIMEOUT');req.destroy();reject(Error('deadline'));},timeoutMs);});
  // Attach a rejection handler before the first body await.
  void deadline.catch(()=>{});
  const operation=(async()=>{
   const length=req.headers['content-length'];
   if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>REQUEST_LIMIT)){reply(res,413,'DESIGN_REQUEST_TOO_LARGE');req.resume();return;}
   const chunks=[];let n=0;
   try{
    for await(const chunk of req){n+=chunk.length;if(n>REQUEST_LIMIT){reply(res,413,'DESIGN_REQUEST_TOO_LARGE');req.destroy();return;}chunks.push(chunk);}
    if(abort.signal.aborted)return;
    body=Buffer.concat(chunks,n);
   }finally{for(const b of chunks)b.fill(0);}
   const headers=new Headers();
   // Forward only the endpoint contract, never cookies or proxy capabilities.
   for(const name of ['origin','content-type','x-employee-session'])if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
   const response=await runtime.handle(new Request(origin+req.url,{method:'POST',headers,body,signal:abort.signal}));
   if(!(response instanceof Response))throw Error('response');
   if(abort.signal.aborted){await response.body?.cancel().catch(()=>{});return;}
   const declared=response.headers.get('content-length');
   if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>RESPONSE_LIMIT))throw Error('response');
   // Buffer before sending headers so oversized/failed output cannot be a 200.
   const parts=[];let size=0;
   try{
    if(response.body){reader=response.body.getReader();for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>RESPONSE_LIMIT||abort.signal.aborted)throw Error('response');parts.push(Buffer.from(item.value));}}
    if(abort.signal.aborted||res.destroyed)return;
    const h={...safeHeaders};
    // Never forward Set-Cookie, redirect Location or arbitrary runtime headers.
    const type=response.headers.get('content-type');if(type&&/^(application\/json|image\/(png|jpeg|webp|heic|heif))(;|$)/i.test(type))h['content-type']=type;
    if(type?.startsWith('image/')&&response.headers.get('cache-control')==='private, no-store')h['cache-control']='private, no-store';
    if(response.headers.get('x-design-preview')==='phone-v2')for(const name of ['x-design-preview','x-design-preview-width','x-design-preview-height','x-design-source-media','x-design-source-bytes','x-design-source-mime']){const v=response.headers.get(name);if(v!==null&&v.length<=100&&/^[A-Za-z0-9_./-]+$/.test(v))h[name]=v;}
    h['content-length']=String(size);res.writeHead(response.status,h);const out=Buffer.concat(parts,size);
    try{await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);res.end(out);});ended=res.writableFinished;}finally{out.fill(0);}
   }finally{for(const b of parts)b.fill(0);}
  })();
  void operation.finally(()=>{settled=true;active.delete(token);body?.fill(0);}).catch(()=>{});
  try{await Promise.race([operation,deadline]);}catch{reply(res,abort.signal.aborted?504:500,abort.signal.aborted?'DESIGN_REQUEST_TIMEOUT':'DESIGN_SERVER_UNAVAILABLE');}
  finally{clearTimeout(timer);if(!ended)stop();if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}req.off('aborted',stop);res.off('close',close);if(settled)active.delete(token);}
 }
 const server=createServer({requestTimeout:30000,headersTimeout:10000,maxHeaderSize:16384},(req,res)=>{void serve(req,res).catch(()=>{reply(res,500,'DESIGN_SERVER_UNAVAILABLE');});});
 server.maxHeadersCount=32;server.keepAliveTimeout=1000;server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
 server.on('clientError',(_e,s)=>s.destroy());
 server.listen(port,'127.0.0.1');try{await once(server,'listening');}catch{throw Error('DESIGN_NODE_SERVER_UNAVAILABLE');}
 return Object.freeze({address:Object.freeze({host:'127.0.0.1',port:server.address().port}),
  async close(){closing=true;const closed=new Promise((resolve,reject)=>server.close(e=>e?reject(Error('DESIGN_SERVER_CLOSE_FAILED')):resolve()));for(const s of sockets)s.destroy();await closed;if(active.size)throw Error('DESIGN_SERVER_CLOSE_UNSETTLED');},
 });
}
