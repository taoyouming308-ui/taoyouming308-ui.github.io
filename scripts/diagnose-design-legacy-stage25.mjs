/** One authorized run only. Preserves evidence even on failure. No retry. */
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../../ai-design-pilot-evidence/stage25/',import.meta.url));
mkdirSync(directory,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-');
const log=directory+`legacy-calibration-${stamp}.log`,fd=openSync(log,'wx',0o600);
const child=spawn(process.execPath,[fileURLToPath(new URL('./test-design-postgres-executor-integration.mjs',import.meta.url)),'--stage25-calibration'],{stdio:['ignore',fd,fd]});
child.once('error',()=>{process.exitCode=1;console.error('STAGE25_START_FAILED');});
child.once('close',(code,signal)=>{closeSync(fd);writeFileSync(log+'.status.json',JSON.stringify({exitCode:code,signal:['SIGTERM','SIGKILL','SIGABRT'].includes(signal)?signal:null,cleanup:'verify_exact_cleanup_line_in_log',historicalCause:'unresolved'})+'\n',{flag:'wx',mode:0o600});console.log(log);process.exitCode=code===0?0:1;});
