// Honest fresh-install verification: no production connections, no fixture stubs.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const name='history-full-migrations-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024});
const sql=input=>execFileSync('docker',['exec','-i',name,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024});
(async()=>{let created=false,applied=[];try{
 docker(['run','--rm','-d','--network','none','--tmpfs','/var/lib/postgresql/data:rw','--name',name,'-e','POSTGRES_PASSWORD=synthetic-local-only','public.ecr.aws/supabase/postgres:17.6.1.143']);created=true;
 let ready=false;for(let i=0;i<120;i++){try{sql('select 1');ready=true;break}catch{await new Promise(r=>setTimeout(r,250))}}
 if(!ready)throw Error('Official Supabase PostgreSQL startup failed: '+docker(['logs','--tail','30',name]));
 for(const file of fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
  try{sql(fs.readFileSync('supabase/migrations/'+file,'utf8'));applied.push(file)}catch(e){throw Error(`Full migration chain failed at ${file} after ${applied.length} successful migrations.\n${e.stderr||e}`)}
 }
 console.log('PASS: all '+applied.length+' repository migrations applied to fresh official Supabase PostgreSQL without schema stubs.');
 }finally{if(created)docker(['rm','-f',name]);}})().catch(e=>{console.error(e.message);process.exitCode=1});
