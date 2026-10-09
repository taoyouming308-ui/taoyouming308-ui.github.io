const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict');
const name='aesthetic-study-test-'+Date.now();
const docker=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=q=>docker(['exec','-i','-e','PGPASSWORD=synthetic-only-test',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],q);
(async()=>{try{
 docker(['run','-d','--network','none','--name',name,'-e','POSTGRES_PASSWORD=synthetic-only-test','postgres:17']);
 for(let i=0;i<40;i++){try{sql('select 1');break;}catch(e){if(i===39)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}}
 sql("create role anon;create role authenticated;create role service_role;create table aesthetic_knowledge_candidates(id uuid primary key,status text,version integer,updated_at timestamptz);");
 sql(fs.readFileSync('supabase/migrations/20261009030000_aesthetic_study.sql','utf8'));
 const end=Date.now(),start=end-20000,base={event_id:'11111111-1111-4111-8111-111111111111',visit_id:'22222222-2222-4222-8222-222222222222',case_id:'case1',content_version:'v1',kind:'time',start_ms:start,end_ms:end,at:new Date(end).toISOString()};
 const ingest=events=>sql("select aesthetic_study_ingest(1,'synthetic','A','"+JSON.stringify(events)+"'::jsonb);");
 ingest([base]);ingest([base]);assert.equal(sql('select active_ms from aesthetic_study_progress').trim(),'20000');
 ingest([{...base,event_id:'33333333-3333-4333-8333-333333333333',case_id:'case2',start_ms:start+10000,end_ms:end+10000,at:new Date(end+10000).toISOString()}]);assert.equal(sql('select sum(active_ms) from aesthetic_study_progress').trim(),'30000');
 const concurrent=event=>new Promise((resolve,reject)=>{const child=cp.spawn('docker',['exec','-i','-e','PGPASSWORD=synthetic-only-test',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At']);let error='';child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(error)):resolve());child.stdin.end("select aesthetic_study_ingest(1,'synthetic','A','"+JSON.stringify([event])+"'::jsonb);");});
 await Promise.all(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'].map((id,i)=>concurrent({...base,event_id:id,case_id:'concurrent'+i,start_ms:end+10000,end_ms:end+20000,at:new Date(end+20000).toISOString()})));
 assert.equal(sql('select sum(active_ms) from aesthetic_study_progress').trim(),'40000');
 assert.throws(()=>sql("select aesthetic_study_ingest(2,'other','B','"+JSON.stringify([base])+"'::jsonb)"));
 const mark={...base,event_id:'44444444-4444-4444-8444-444444444444',kind:'complete',at:new Date(end+1000).toISOString()};delete mark.start_ms;delete mark.end_ms;
 ingest([mark]);ingest([{...mark,event_id:'55555555-5555-4555-8555-555555555555',kind:'uncomplete',at:new Date(end).toISOString()}]);assert.equal(sql("select self_completed from aesthetic_study_progress where case_id='case1'").trim(),'t');
 ingest([{...mark,event_id:'66666666-6666-4666-8666-666666666666',kind:'visit'}]);ingest([{...mark,event_id:'77777777-7777-4777-8777-777777777777',kind:'visit'}]);assert.equal(sql("select visits from aesthetic_study_progress where case_id='case1'").trim(),'1');
 assert.throws(()=>ingest([{...base,event_id:'88888888-8888-4888-8888-888888888888',start_ms:start-10000}]));
 assert.equal(sql("select count(*) from aesthetic_study_events where event_id='88888888-8888-4888-8888-888888888888'").trim(),'0');
 assert.equal(sql("select has_table_privilege('anon','aesthetic_study_progress','select'),has_function_privilege('authenticated','aesthetic_study_ingest(integer,text,text,jsonb)','execute')").trim(),'f|f');
 sql("insert into aesthetic_knowledge_candidates values('99999999-9999-4999-8999-999999999999','archived',2,now());insert into aesthetic_study_candidate_archive(candidate_id,before_status,before_version,archived_version,archived_by) values('99999999-9999-4999-8999-999999999999','pending_review',1,2,'synthetic');select aesthetic_study_restore_candidate('99999999-9999-4999-8999-999999999999','synthetic');");
 assert.equal(sql('select status,version from aesthetic_knowledge_candidates').trim(),'pending_review|3');assert.throws(()=>sql("select aesthetic_study_restore_candidate('99999999-9999-4999-8999-999999999999','synthetic')"));
 console.log('PostgreSQL17 study: migration, overlap across devices/cases, duplicate/reordered completion/visit, invalid rollback, private ACL, archive restore passed');
}finally{try{docker(['rm','-f',name]);}catch(_){}}})().catch(e=>{console.error(e);process.exitCode=1;});
