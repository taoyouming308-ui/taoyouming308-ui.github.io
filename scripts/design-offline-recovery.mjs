/** Explicit offline packing/unpacking only. Never executes SQL or stops writers. */
import {isAbsolute} from 'node:path';
import {packDesignRecoveryDirectory,unpackDesignRecoveryDirectory} from '../packages/design-production-adapter/offline-recovery.mjs';
import {createDesignFileSecretProvider} from '../packages/design-production-adapter/server-secret-files.mjs';
let key;
try{
 const a=process.argv.slice(2),verb=a.shift(),options={};if(!['pack','unpack'].includes(verb)||a.length!==8)throw Error();
 for(let i=0;i<a.length;i+=2){if(!['--snapshot','--target','--file','--key-directory','--origin'].includes(a[i])||Object.hasOwn(options,a[i]))throw Error();options[a[i]]=a[i+1];}
 const keys=['--file','--key-directory','--origin',verb==='pack'?'--snapshot':'--target'];if(Object.keys(options).length!==4||!keys.every(k=>typeof options[k]==='string')||!keys.filter(k=>k!=='--origin').every(k=>isAbsolute(options[k])))throw Error();
 const u=new URL(options['--origin']);if(u.protocol!=='https:'||u.origin!==options['--origin']||!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))throw Error();
 key=await createDesignFileSecretProvider({enabled:true,directory:options['--key-directory'],name:'recovery-key.bin'})({purpose:'design-recovery-backup-v1'});
 const common={enabled:true,storageOrigin:u.origin,backupKey:key};
 const result=verb==='pack'?await packDesignRecoveryDirectory({...common,snapshotDirectory:options['--snapshot'],outputFile:options['--file']}):await unpackDesignRecoveryDirectory({...common,inputFile:options['--file'],targetDirectory:options['--target']});
 console.log(JSON.stringify({ok:true,event:verb==='pack'?'packed':'unpacked',files:result.files,objects:result.objects,sqlExecuted:false}));
}catch(e){const code=['DESIGN_RECOVERY_OUTCOME_UNCERTAIN','DESIGN_RECOVERY_CLEANUP_UNCERTAIN'].includes(e?.message)?e.message:'DESIGN_RECOVERY_DENIED';console.error(JSON.stringify({ok:false,code,sqlExecuted:false}));process.exitCode=1;}finally{key?.fill(0);}
