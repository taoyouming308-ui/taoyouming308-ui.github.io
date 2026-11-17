/** Internal mTLS image service. No browser/employee/model credentials, URLs,
 * paths, decoder options or commands are accepted. The web process has no Docker
 * socket: it receives only this client capability. Current photo authorization
 * must precede dispatch and be rechecked by the application before delivery. */
import {createServer,request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
import {inspectPhonePhotoDerivative} from './phone-photo-processing.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),fp=s=>typeof s==='string'?s.replaceAll(':','').toLowerCase():'';
const fail=()=>{throw Error('PHONE_BROKER_DENIED');};
const operations=new Set(['inspect','normalize','derive']);
function pack(value){return JSON.stringify(value,(_k,v)=>v instanceof Uint8Array?{binaryBase64:Buffer.from(v).toString('base64')}:v);}
function unpack(text){return JSON.parse(text,(_k,v)=>{if(v&&typeof v==='object'&&Object.keys(v).length===1&&Object.hasOwn(v,'binaryBase64')){if(typeof v.binaryBase64!=='string'||v.binaryBase64.length>750000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.binaryBase64))fail();return Uint8Array.from(Buffer.from(v.binaryBase64,'base64'));}return v;});}
export async function startPhoneImageBroker({enabled=false,tls,clientFingerprint,worker,port=0}={}){
 if(enabled!==true)throw Error('PHONE_BROKER_DISABLED');
 if(!tls?.key||!tls.cert||!tls.ca||!/^[a-f0-9]{64}$/.test(fp(clientFingerprint))||!['inspect','normalize','derive'].every(k=>typeof worker?.[k]==='function')||!Number.isInteger(port)||port<0||port>65535)fail();
 let busy=false,closing=false;const sockets=new Set(),work=new Set();
 const response=(res,status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);}};
 async function serve(req,res){
  const match=/^\/v1\/phone\/(inspect|normalize|derive)$/.exec(req.url??'');
  if(closing||!req.socket.authorized||fp(req.socket.getPeerCertificate().fingerprint256)!==fp(clientFingerprint))return response(res,403,'{"error":"PHONE_BROKER_DENIED"}');
  if(req.method!=='POST'||!match||req.headers['content-type']!=='application/octet-stream')return response(res,404,'{"error":"PHONE_BROKER_DENIED"}');
  if(busy)return response(res,429,'{"error":"PHONE_BROKER_BUSY"}');busy=true;
  const abort=new AbortController();let bytes,timer;
  req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort();});
  const operation=(async()=>{try{
   const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>8388608))fail();
   const chunks=[];let n=0;try{for await(const b of req){n+=b.length;if(n>8388608)fail();chunks.push(b);}bytes=Buffer.concat(chunks,n);}finally{chunks.forEach(b=>b.fill(0));}
   if(!bytes.length||hash(bytes)!==req.headers['x-design-source-sha256']||abort.signal.aborted)fail();
   const method=match[1],value=await(method==='derive'?worker.derive({bytes,sourceSha256:hash(bytes),signal:abort.signal}):worker[method](bytes,{signal:abort.signal}));
   if(abort.signal.aborted)fail();const encoded=pack({ok:true,sourceSha256:hash(bytes),operation:method,value});if(Buffer.byteLength(encoded)>1048576)fail();
   await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);response(res,200,encoded);});
  }catch{response(res,409,'{"error":"PHONE_BROKER_DENIED"}');}finally{bytes?.fill(0);busy=false;}})();
  work.add(operation);void operation.finally(()=>work.delete(operation));
  timer=setTimeout(()=>{abort.abort();response(res,504,'{"error":"PHONE_BROKER_TIMEOUT"}');req.destroy();},20000);
  try{await operation;}finally{clearTimeout(timer);}
 }
 const server=createServer({key:tls.key,cert:tls.cert,ca:tls.ca,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3',requestTimeout:20000,headersTimeout:5000,maxHeaderSize:8192},(req,res)=>{void serve(req,res).catch(()=>response(res,409,'{"error":"PHONE_BROKER_DENIED"}'));});
 server.on('tlsClientError',()=>{});server.on('clientError',(_e,s)=>s.destroy());server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});server.listen(port,'127.0.0.1');await once(server,'listening');
 return Object.freeze({port:server.address().port,async close(){closing=true;const p=new Promise((resolve,reject)=>server.close(e=>e?reject(Error('PHONE_BROKER_CLOSE_FAILED')):resolve()));for(const s of sockets)s.destroy();let timer;try{await Promise.race([Promise.all([p,Promise.allSettled([...work])]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PHONE_BROKER_CLOSE_UNCERTAIN')),5000);})]);if(work.size)throw Error('PHONE_BROKER_CLOSE_UNCERTAIN');}finally{clearTimeout(timer);}}});
}
export function createPhoneImageBrokerClient({enabled=false,endpoint,tls,serverFingerprint}={}){
 let target;try{const u=new URL(endpoint);if(u.protocol==='https:'&&u.origin===endpoint)target=u;}catch{}
 async function call(operation,input,{signal}={}){
  if(enabled!==true)throw Error('PHONE_BROKER_DISABLED');if(!target||!tls?.key||!tls.cert||!tls.ca||!/^[a-f0-9]{64}$/.test(fp(serverFingerprint))||!operations.has(operation)||!(input instanceof Uint8Array)||!input.length||input.length>8388608||signal?.aborted)fail();
  const bytes=Buffer.from(input);let requestHandle;
  try{return await new Promise((resolve,reject)=>{
   let size=0,ended=false;const chunks=[];const done=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);chunks.forEach(b=>b.fill(0));error?reject(Error('PHONE_BROKER_DENIED')):resolve(value);};
   const abort=()=>{requestHandle?.destroy();done(true);};const timer=setTimeout(abort,20000);
   requestHandle=request(new URL('/v1/phone/'+operation,target),{method:'POST',key:tls.key,cert:tls.cert,ca:tls.ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,checkServerIdentity:(host,cert)=>checkServerIdentity(host,cert)||(fp(cert.fingerprint256)!==fp(serverFingerprint)?Error('PHONE_BROKER_DENIED'):undefined),headers:{'content-type':'application/octet-stream','content-length':String(bytes.length),'x-design-source-sha256':hash(bytes),'x-design-request-id':randomUUID()}},res=>{
    if(res.statusCode!==200||res.headers['content-type']!=='application/json'){res.destroy();requestHandle.destroy();done(true);return;}
    res.on('data',b=>{size+=b.length;if(size>1048576||chunks.length>4096){requestHandle.destroy();done(true);}else chunks.push(b);});res.once('error',()=>done(true));res.on('end',()=>{try{const r=unpack(Buffer.concat(chunks,size).toString());if(r.ok!==true||r.sourceSha256!==hash(bytes)||r.operation!==operation)fail();const v=r.value;
     if(operation==='inspect'&&(!PHONE_SOURCE_MIMES.includes(v?.mime)||v.decoded!==true||v.frameCount!==1||![v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384)||v.width*v.height>40000000))fail();
     if(operation==='derive'){if(v.mime!=='image/png'||v.sourceSha256!==hash(bytes)||v.metadataRemoved!==true)fail();inspectPhonePhotoDerivative(v.bytes);}
     if(operation==='normalize'){if(v.source?.sha256!==hash(bytes)||v.normalized?.mime!=='image/jpeg'||!(v.normalized.bytes instanceof Uint8Array)||v.normalized.bytes.length>524288||hash(v.normalized.bytes)!==v.normalized.sha256||v.independentVerification?.sha256!==v.normalized.sha256||v.independentVerification.metadataAbsent!==true)fail();inspectPhonePhotoDerivative(v.derivative.bytes);}
     done(false,v);
    }catch{done(true);}});
   });requestHandle.on('error',()=>done(true));signal?.addEventListener('abort',abort,{once:true});requestHandle.end(bytes);
  });}finally{bytes.fill(0);}
 }
 return Object.freeze({kind:'mtls-private-image-broker',inspect:(bytes,options)=>call('inspect',bytes,options),normalize:(bytes,options)=>call('normalize',bytes,options),derive:({bytes,sourceSha256,signal})=>{if(!(bytes instanceof Uint8Array)||hash(bytes)!==sourceSha256)fail();return call('derive',bytes,{signal});}});
}
