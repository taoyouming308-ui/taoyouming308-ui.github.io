/** Actual Caddy process and TLS sockets; exclusively synthetic local acceptance.
 * Never installs trust, changes DNS, starts a system service or obtains ACME certs.
 * These functions are NOT a deployer, identity authority or production bootstrap. */
import assert from 'node:assert/strict';
import {createServer} from 'node:net';import {once} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
import {request} from 'node:https';import {createHash,X509Certificate} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Fixed reviewed browser graph, plus the separately loaded PCM worklet. No
// repository-root file serving and no private adapter/SQL/fixture files.
export const designPublicFiles=Object.freeze(JSON.parse(await readFile(join(root,'deployment/design-public-files.json'),'utf8')));
export async function reserveDesignHttpsOrigin(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return 'https://127.0.0.1:'+port;}
export function requestDesignHttps(url,{ca,method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{const q=request(url,{ca,minVersion:'TLSv1.3',method,headers,agent:false},r=>{const parts=[];r.on('data',b=>parts.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,bytes:Buffer.concat(parts),authorized:r.socket?.authorized??q.socket.authorized,protocol:q.socket.getProtocol()}));});q.setTimeout(35000,()=>q.destroy(Error('FIXTURE_HTTPS_TIMEOUT')));q.on('error',reject);q.end(body);});}
export async function startDesignHttpsFixture({work,caddy,origin,backendPort,tls,html}={}){
 assert(isAbsolute(caddy));assert.equal(execFileSync(caddy,['version'],{encoding:'utf8'}).trim().split(' ')[0],'v2.11.9');
 const u=new URL(origin);assert.equal(u.hostname,'127.0.0.1');assert(u.port);assert.equal(u.origin,origin);
 const dir=await mkdtemp(join(work,'https-private-'));await chmod(dir,0o700);let child,ended,closed=false,output='';
 try{
  const publicDir=join(dir,'public');await mkdir(publicDir,{mode:0o700});
  for(const name of designPublicFiles){const target=join(publicDir,name);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,await readFile(join(root,name)),{mode:0o600});}
  // Only the optional original-homepage browser fixture overrides the static
  // HTML. Real candidate modules/CSS remain byte-identical. No inline script.
  if(html!==undefined)await writeFile(join(publicDir,'ai-design-prepared.html'),html,{mode:0o600});
  await writeFile(join(dir,'server.crt'),tls.cert,{mode:0o600});await writeFile(join(dir,'server.key'),tls.key,{mode:0o600});
  const config=join(root,'deployment/design-staging.Caddyfile'),env={PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:join(dir,'data'),XDG_CONFIG_HOME:join(dir,'config'),DESIGN_HTTPS_ORIGIN:origin,DESIGN_BIND_ADDRESS:'127.0.0.1',DESIGN_TLS_CERT:join(dir,'server.crt'),DESIGN_TLS_KEY:join(dir,'server.key'),DESIGN_BACKEND_PORT:String(backendPort),DESIGN_PUBLIC_DIRECTORY:publicDir};
  execFileSync(caddy,['validate','--config',config,'--adapter','caddyfile'],{env,stdio:'pipe',timeout:10000});
  child=spawn(caddy,['run','--config',config,'--adapter','caddyfile'],{env,stdio:['ignore','pipe','pipe']});ended=once(child,'exit');
  for(const pipe of [child.stdout,child.stderr])pipe.on('data',b=>{output=(output+b.toString()).slice(-32768);});
  const until=Date.now()+10000;for(;;){try{const r=await requestDesignHttps(origin+'/ai-design-prepared.html',{ca:tls.ca});assert.equal(r.status,200);assert.equal(r.authorized,true);assert.equal(r.protocol,'TLSv1.3');break;}catch(e){if(Date.now()>until||child.exitCode!==null)throw Error('CADDY_FIXTURE_START_FAILED: '+e.message);await new Promise(r=>setTimeout(r,50));}}
  const spki=createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  return {origin,publicDir,spki,logs:()=>output,async replaceHtml(value){await writeFile(join(publicDir,'ai-design-prepared.html'),value,{mode:0o600});},async close(){if(closed)return;closed=true;child.kill('SIGTERM');const result=await boundedExit(ended,()=>child.kill('SIGKILL'));await rm(dir,{recursive:true,force:true});assert.equal(result[0],0);}};
 }catch(e){if(child&&child.exitCode===null){child.kill('SIGTERM');await boundedExit(ended,()=>child.kill('SIGKILL'));}await rm(dir,{recursive:true,force:true});throw e;}
}
async function boundedExit(p,kill){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>{kill();reject(Error('CADDY_FIXTURE_CLOSE_UNCERTAIN'));},5000);})]);}finally{clearTimeout(timer);}}
