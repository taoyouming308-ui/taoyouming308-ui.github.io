/** Reviewed finite pure/mock list. Excludes browser/PG/native execution; those
 * are separately named suites, never silently skipped and called full acceptance. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {isAbsolute,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const selection=JSON.parse(readFileSync(new URL('./fixtures/design-local-pure-selection.json',import.meta.url),'utf8'));
if(process.argv.length!==4||process.argv[2]!=='--evidence-dir'||!isAbsolute(process.argv[3]))throw Error('An explicit absolute --evidence-dir is required');
const evidence=process.argv[3];mkdirSync(evidence,{recursive:true,mode:0o700});
const results=[],logs=[];
for(const file of selection.run){
 if(!/^scripts\/test-[a-z0-9-]+\.(mjs|cjs)$/.test(file))throw Error('Invalid finite test manifest');
 const at=performance.now(),r=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
 const row={file,exit:r.status,seconds:Math.round((performance.now()-at)/10)/100,timeout:r.error?.code==='ETIMEDOUT'};results.push(row);logs.push('FILE '+file+'\n'+(r.stdout??'')+(r.stderr??''));
 console.log((r.status===0?'PASS ':'FAIL ')+file);
}
writeFileSync(join(evidence,'pure-tests.log'),logs.join('\n'),{mode:0o600});
writeFileSync(join(evidence,'pure-results.json'),JSON.stringify({results,excluded:selection.excluded},null,2)+'\n',{mode:0o600});
const failed=results.filter(x=>x.exit!==0);console.log(JSON.stringify({scripts:results.length,passed:results.length-failed.length,failed:failed.length}));process.exitCode=failed.length?1:0;
