/** Explicit, non-model staging lifecycle. No env/keys, migrations, public bind,
 * cloud provisioning or signal handlers on import. Caller-owned dependencies
 * must already target an isolated staging installation. This module cannot
 * establish that isolation, issue employee authority or qualify a worker host.
 * After validation, ownership transfers here, including on startup failure.
 * verifyReady performs the site's real checks, not configuration assertions. */
import {createConfiguredDesignServerRuntime} from './configured-server-runtime.mjs';
import {startDesignNodeServer} from './node-http-server.mjs';
const fail=code=>{throw Error(code);};
const dependencyKeys=['acquireClient','worker','mediaApprovalVerifier','storageOrigin','privateMediaTransport','verifyReady','close'];
function validOrigin(value){try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value;}catch{return false;}}
function bounded(work,ms,code,onTimeout){let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout?.();reject(Error(code));},ms);})]).finally(()=>clearTimeout(timer));}
export async function startDesignStagingService(options={}){
 if(options.enabled!==true)fail('DESIGN_STAGING_DISABLED');
 const {publicOrigin,port=0,dependencies:d}=options;
 if(Object.keys(options).some(k=>!['enabled','publicOrigin','port','dependencies'].includes(k))||!validOrigin(publicOrigin)||!Number.isInteger(port)||port<0||port>65535||!d||Object.keys(d).sort().join('|')!==[...dependencyKeys].sort().join('|')||!['acquireClient','privateMediaTransport','verifyReady','close'].every(k=>typeof d[k]==='function')||!['inspect','normalize','derive'].every(k=>typeof d.worker?.[k]==='function')||typeof d.mediaApprovalVerifier?.verifyImmutable!=='function'||!validOrigin(d.storageOrigin))fail('DESIGN_STAGING_INVALID');
 let listener,state='checking',closing;const abort=new AbortController();
 function close(){
  if(closing)return closing;
  state='closing';abort.abort();
  closing=(async()=>{let uncertain=false;
   // Always attempt dependency cleanup, including when the listener cannot drain.
   try{if(listener)await bounded(()=>listener.close(),5000,'DESIGN_STAGING_CLOSE_UNCERTAIN');}catch{uncertain=true;}
   try{await bounded(()=>d.close(),5000,'DESIGN_STAGING_CLOSE_UNCERTAIN');}catch{uncertain=true;}
   state=uncertain?'close_uncertain':'closed';if(uncertain)fail('DESIGN_STAGING_CLOSE_UNCERTAIN');
  })();return closing;
 }
 try{
  const ready=await bounded(()=>d.verifyReady({signal:abort.signal}),10000,'DESIGN_STAGING_NOT_READY',()=>abort.abort());
  if(ready!==true)fail('DESIGN_STAGING_NOT_READY');
  const runtime=await createConfiguredDesignServerRuntime({enabled:true,modelsEnabled:false,publicOrigin,acquireClient:d.acquireClient,worker:d.worker,mediaApprovalVerifier:d.mediaApprovalVerifier,storageOrigin:d.storageOrigin,privateMediaTransport:d.privateMediaTransport});
  listener=await startDesignNodeServer({enabled:true,runtime,publicOrigin,port});state='ready';
  return Object.freeze({address:listener.address,status:()=>Object.freeze({state,modelsEnabled:false}),close});
 }catch{
  try{await close();}catch{fail('DESIGN_STAGING_CLOSE_UNCERTAIN');}
  fail('DESIGN_STAGING_START_FAILED');
 }
}
