// Isolated PostgreSQL, synthetic fixtures only; test container uses tmpfs, no volumes.
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const name=`frontdesk-business-${process.pid}-${Date.now()}`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=value=>execFileSync('docker',['exec','-i',name,'psql','-X','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:value,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const bill=JSON.parse(execFileSync('/usr/bin/python3',['-c','import json;from scripts.test_mgj_business_detail import normalized;print(json.dumps(normalized()))'],{encoding:'utf8'}));
const payload={contract_version:'mgj-business-day-v1',shop_id:'1837032',business_date:'2026-01-01',source_scope:'project_consumption',bills:[bill]};
const call=(value=payload,date='2026-01-01',shop='向里造型',time=new Date().toISOString())=>`select public.mgj_ingest_business_details(${quote(shop)},${quote(date)},${quote(time)},${quote(JSON.stringify(value))}::jsonb);`;
const get=()=>JSON.parse(sql("set role service_role;select public.mgj_read_business_details('向里造型','2026-01-01');").split('\n').at(-1));
const run=()=>JSON.parse(sql('set role service_role;'+call()).split('\n').at(-1));
let started=false;
(async()=>{try{
 docker(['run','--rm','-d','--network','none','--name',name,'--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
 let ready=false;for(let n=0;n<80;n++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
 const mounts=JSON.parse(docker(['inspect','--format','{{json .Mounts}}',name]));assert(mounts.every(m=>m.Type!=='volume'));
 sql(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.mgj_daily_consumption(shop_name text,business_date date,services jsonb);
 insert into public.mgj_daily_consumption values('向里造型','2026-01-01','[{"source_id":"42","amount":100}]');
 create table public.legacy_reports(id int,status text,amount numeric);insert into public.legacy_reports values(1,'confirmed',2126);
 ${fs.readFileSync('supabase/migrations/20260927210938_mgj_frontdesk_business_detail_snapshots.sql','utf8')}`);
 for(const table of ['mgj_business_detail_snapshots','mgj_business_detail_heads'])for(const role of ['anon','authenticated','service_role']){
  assert.equal(sql(`select has_table_privilege('${role}','public.${table}','SELECT');`),'f');
  assert.equal(sql(`select has_table_privilege('${role}','public.${table}','INSERT');`),'f');
  assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid='public.${table}'::regclass;`),'t');
 }
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};${call()}`));
 assert.throws(()=>sql(call()),/BUSINESS_SERVICE_REQUIRED/);
 assert.equal(get().available,false);
 const first=run();assert.equal(first.accepted,true);assert.equal(first.report_ready,false);assert.equal(first.formal_ledger_amount_changed,false);
 const second=run();assert.equal(second.snapshot_id,first.snapshot_id);assert.equal(second.deduplicated,true);
 assert.equal(get().source_list_changed,false);assert.equal(get().bills.length,1);
 const incomplete={...payload,bills:[]};assert.throws(()=>sql('set role service_role;'+call(incomplete)),/BUSINESS_INCOMPLETE_OR_DUPLICATE/);
 assert.throws(()=>sql('set role service_role;'+call({...payload,bills:[bill,bill]})),/BUSINESS_INCOMPLETE_OR_DUPLICATE/);
 assert.throws(()=>sql('set role service_role;'+call(payload,'2026-01-01','自由手艺人')),/BUSINESS_INVALID_SCOPE/);
 const malformed=structuredClone(payload);malformed.bills[0].source_posted_amount_cents=20000;
 assert.throws(()=>sql('set role service_role;'+call(malformed)),/BUSINESS_POSTED_AMOUNT_MISMATCH/);
 malformed.bills[0].source_posted_amount_cents=10000;malformed.bills[0].payments[0].amount_cents=0.01;
 assert.throws(()=>sql('set role service_role;'+call(malformed)),/BUSINESS_INVALID_CENTS/);
 const older=JSON.parse(sql('set role service_role;'+call(payload,'2026-01-01','向里造型',new Date(Date.now()-60000).toISOString())).split('\n').at(-1));assert.equal(older.accepted,false);
 sql(`update public.mgj_daily_consumption set services='[{"source_id":"42","amount":101}]';`);assert.equal(get().source_list_changed,true);
 assert.equal(sql('select amount from public.legacy_reports where id=1;'),'2126');
 assert.equal(sql('select count(*) from public.mgj_business_detail_snapshots;'),'1');
 console.log('Business snapshots: ACL/RLS, completeness, shop scope, cents, immutability, deduplication, late-write refusal, source changes and legacy preservation passed');
}finally{if(started)docker(['rm','-f','-v',name]);}})().catch(e=>{console.error(e.stderr||e);process.exitCode=1;});
