/** Operator-invoked staging entry. The bootstrap is trusted local server code,
 * never a browser input. This script provisions no accounts, secrets or SQL. */
import {lstat,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {startDesignStagingService} from '../packages/design-production-adapter/staging-service.mjs';
const a=process.argv.slice(2);let service,stopping=false,shutdown;
async function close(){if(shutdown)return shutdown;stopping=true;shutdown=(async()=>{try{await service?.close();console.log('{"event":"closed","modelsEnabled":false}');}catch{console.error('{"event":"close_uncertain"}');process.exitCode=1;}})();return shutdown;}
try{
 if(a.length!==6||a[0]!=='--bootstrap'||a[2]!=='--origin'||a[4]!=='--port'||!isAbsolute(a[1])||resolve(a[1])!==a[1]||!a[1].endsWith('.mjs')||!/^\d{1,5}$/.test(a[5])||Number(a[5])<1024||Number(a[5])>65535)throw Error();
 const u=new URL(a[3]);if(u.protocol!=='https:'||u.origin!==a[3])throw Error();
 const bootstrap=a[1],dir=dirname(bootstrap),st=await lstat(bootstrap),ds=await lstat(dir);
 if(await realpath(bootstrap)!==bootstrap||!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o600||!ds.isDirectory()||ds.uid!==process.getuid?.()||(ds.mode&0o777)!==0o700)throw Error();
 // Bootstrap must live outside this public release, including all fixture code.
 const release=await realpath(new URL('../',import.meta.url));if(bootstrap.startsWith(release+'/')||bootstrap===release)throw Error();
 const module=await import(pathToFileURL(bootstrap));if(typeof module.prepareDesignStagingDependencies!=='function')throw Error();
 const dependencies=await module.prepareDesignStagingDependencies();
 service=await startDesignStagingService({enabled:true,publicOrigin:a[3],port:Number(a[5]),dependencies});
 process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
 if(stopping)await close();else console.log(JSON.stringify({event:'ready',modelsEnabled:false,address:service.address}));
}catch{console.error('{"event":"start_failed","modelsEnabled":false}');process.exitCode=1;}
