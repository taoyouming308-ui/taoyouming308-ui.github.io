// Isolated PG17 + PostgREST14: reproduce the actual 8s API deadline and prove
// function-scoped settings are hoisted, without any production credentials/data.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const prefix='daily-timeout-'+process.pid+'-'+Date.now(),pg=prefix+'-pg',api=prefix+'-api',net=prefix+'-net';
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024,...options}).trim();
const sql=input=>docker(['exec','-i',pg,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input,stdio:['pipe','pipe','pipe']});
const signature='public.zysyr_confirm_daily_project_review(uuid,uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,jsonb,jsonb,text)';
const migration=fs.readFileSync('supabase/migrations/20261013080225_zysyr_daily_post_transaction_timeout.sql','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){let network=false,db=false,rest=false;try{
 docker(['network','create',net]);network=true;
 docker(['run','--rm','-d','--network',net,'--tmpfs','/var/lib/postgresql/data:rw','--name',pg,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);db=true;
 for(let i=0;i<60;i++){try{sql('select 1');break}catch(e){if(i===59)throw e;await sleep(200);}}
 sql(`create role service_role nologin; create role authenticator login; grant service_role to authenticator;
 alter role authenticator set statement_timeout='8s';
 create table synthetic_posts(value integer);
 create function public.zysyr_confirm_daily_project_review(p_actor_user_id uuid,p_actor_auth_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,p_expected_revision integer,p_report jsonb,p_is_business_day boolean,p_reason text,p_project_confirmation jsonb,p_cash_confirmation jsonb,p_electronic_cell_hash text)
 returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
 begin insert into public.synthetic_posts values(100); perform pg_sleep(9); return jsonb_build_object('saved',true,'timeout',current_setting('statement_timeout'),'lock',current_setting('lock_timeout')); end $$;
 revoke all on function ${signature} from public; grant execute on function ${signature} to service_role;
 create function public.synthetic_settings() returns text language sql as $$ select current_setting('statement_timeout') $$;
 grant execute on function public.synthetic_settings() to service_role;`);
 const fingerprint=()=>sql(`select md5(prosrc)||proacl::text from pg_proc where oid='${signature}'::regprocedure;`),before=fingerprint();
 docker(['run','--rm','-d','--network',net,'--name',api,'-p','127.0.0.1::3000','-e',`PGRST_DB_URI=postgres://authenticator@${pg}:5432/postgres`,'-e','PGRST_DB_ANON_ROLE=service_role','public.ecr.aws/supabase/postgrest:v14.14']);rest=true;
 const port=docker(['port',api,'3000/tcp']).split(':').pop(),url='http://127.0.0.1:'+port;
 for(let i=0;i<60;i++){try{if((await fetch(url+'/')).ok)break}catch(e){}if(i===59)throw Error('local REST unavailable');await sleep(200);}
 const body={p_actor_user_id:null,p_actor_auth_user_id:null,p_company_id:null,p_store_id:null,p_draft_id:null,p_expected_revision:0,p_report:{},p_is_business_day:true,p_reason:'synthetic',p_project_confirmation:{},p_cash_confirmation:{},p_electronic_cell_hash:''};
 const post=()=>fetch(url+'/rpc/zysyr_confirm_daily_project_review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let r=await post();assert.equal(r.ok,false);assert.equal((await r.json()).code,'57014');assert.equal(sql('select count(*) from synthetic_posts'),'0','timeout rolls back synthetic insert');
 sql(migration);assert.equal(fingerprint(),before,'function body and ACL unchanged');
 await sleep(1200);
 r=await post();assert.equal(r.ok,true);assert.deepEqual(await r.json(),{saved:true,timeout:'30s',lock:'5s'});assert.equal(sql('select count(*) from synthetic_posts'),'1');
 assert.equal(await (await fetch(url+'/rpc/synthetic_settings')).json(),'8s','unrelated API keeps its original timeout');
 sql(`alter function ${signature} reset statement_timeout; notify pgrst,'reload schema';`);
 assert.equal(fingerprint(),before);await sleep(1200);
 r=await post();assert.equal((await r.json()).code,'57014');assert.equal(sql('select count(*) from synthetic_posts'),'1','rollback restores original timeout without partial insert');
 console.log('PostgREST deadline: original 8s timeout reproduced; scoped 30s succeeds; body/ACL/5s lock unchanged; unrelated API stays 8s; rollback verified.');
 }finally{if(rest)docker(['rm','-f','-v',api]);if(db)docker(['rm','-f','-v',pg]);if(network)docker(['network','rm',net]);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
