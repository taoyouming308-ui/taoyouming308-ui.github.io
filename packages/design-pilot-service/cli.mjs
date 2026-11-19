#!/usr/bin/env node
import path from 'node:path';
import {startSyntheticDesignService,SYNTHETIC_OPT_IN} from './server.mjs';
const argv=process.argv.slice(2),options={};
const usage='Usage: node packages/design-pilot-service/cli.mjs --enable-synthetic-pilot --data-dir /absolute/dedicated-test-directory [--port 0] [--ui-root /absolute/repository]';
try{
  for(let index=0;index<argv.length;index++){
    const key=argv[index];
    if(key==='--enable-synthetic-pilot')options.optIn=SYNTHETIC_OPT_IN;
    else if(['--data-dir','--port','--ui-root'].includes(key)){
      if(!argv[index+1]||argv[index+1].startsWith('--'))throw new Error(usage);
      const value=argv[++index];
      if(key==='--port'){if(!/^\d+$/.test(value))throw new Error(usage);options.port=Number(value);}
      else {if(!path.isAbsolute(value))throw new Error(usage);options[key==='--data-dir'?'dataDir':'uiRoot']=value;}
    }else throw new Error(usage);
  }
  const service=await startSyntheticDesignService(options);
  console.log('SYNTHETIC LOCAL TEST ONLY. No real authentication, customer records, photos, model calls or credentials.');
  console.log('Local fixture service: '+service.url);
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await service.close();process.exitCode=0;};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(error){console.error(error.code?error.code+': '+error.message:error.message);process.exitCode=1;}
