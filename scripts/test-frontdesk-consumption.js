// Execute the production dashboard reader with synthetic storage, and replay
// its new atomic snapshot migration on a network-isolated PostgreSQL instance.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {execFileSync}=require('node:child_process');
const source=fs.readFileSync('supabase/functions/frontdesk-api/index.ts','utf8');
const reader=source.slice(source.indexOf('function selectedStore('),source.indexOf('const TODAY_SOURCES'));
let paths=[],snapshots=[];
const ctx=vm.createContext({Date,cleanText:(v,n)=>String(v||'').slice(0,n),restRows:async p=>{paths.push(p);return p.startsWith('mgj_daily_consumption?')?snapshots:[];}});
vm.runInContext(stripTypeScriptTypes(reader)+';globalThis.run=dashboard;',ctx);
const container='frontdesk-consumption-test-'+process.pid;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
// The image starts a temporary Unix-socket-only server during initialization.
// TCP becomes available only on the final server, avoiding a false ready signal.
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{
  snapshots=[{fetched_at:new Date().toISOString(),services:[{source_id:'1',amount:100}]}];
  let result=await ctx.run({date:'2026-09-27',store:'向里造型'},{role:'frontdesk',store:'自由手艺人'});
  assert.equal(result.store,'自由手艺人');assert.equal(result.services.length,1);assert.equal(result.consumption_complete,true);
  assert(paths.every(p=>p.includes(encodeURIComponent('自由手艺人'))),'every read is store scoped');
  assert(!paths.some(p=>p.startsWith('mgj_service_records')),'partial hair reconciliation is not a daily bill source');
  snapshots=[];
  result=await ctx.run({date:'2026-09-27'},{role:'frontdesk',store:'自由手艺人'});
  assert.equal(result.consumption_complete,false);assert.equal(result.synced_at,'');
  snapshots=[{services:[],fetched_at:new Date(Date.now()-3600000).toISOString()}];
  result=await ctx.run({date:'2026-09-27'},{role:'frontdesk',store:'自由手艺人'});
  assert.equal(result.consumption_complete,true);assert.equal(result.consumption_stale,true);
  docker(['run','--rm','-d','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try{
    let ready=false;
    for(let i=0;i<80;i++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
    assert(ready);
    sql('create role anon; create role authenticated; create role service_role bypassrls;');
    sql(fs.readFileSync('supabase/migrations/20260927141046_frontdesk_daily_consumption_snapshot.sql','utf8'));
    assert.equal(sql("select relrowsecurity from pg_class where oid='public.mgj_daily_consumption'::regclass"),'t');
    assert.equal(sql("select has_table_privilege('anon','public.mgj_daily_consumption','select') or has_function_privilege('authenticated','public.write_mgj_daily_consumption(text,date,jsonb,timestamptz)','execute')"),'f');
    sql("set role service_role; select public.write_mgj_daily_consumption('自由手艺人','2026-09-27','[{\"source_id\":\"a\"}]','2026-09-27T10:00:00Z'); select public.write_mgj_daily_consumption('向里造型','2026-09-27','[{\"source_id\":\"b\"}]','2026-09-27T10:00:00Z');");
    assert(sql("set role service_role; select public.write_mgj_daily_consumption('自由手艺人','2026-09-27','[]','2026-09-27T09:00:00Z');").includes('"written": 0'));
    assert.equal(sql("select jsonb_array_length(services) from public.mgj_daily_consumption where shop_name='自由手艺人'"),'1');
    sql("set role service_role; select public.write_mgj_daily_consumption('自由手艺人','2026-09-27','[]','2026-09-27T11:00:00Z');");
    assert.equal(sql("select jsonb_array_length(services) from public.mgj_daily_consumption where shop_name='自由手艺人'"),'0');
    assert.equal(sql("select jsonb_array_length(services) from public.mgj_daily_consumption where shop_name='向里造型'"),'1','same-day other store preserved');
  }finally{docker(['stop',container]);}
  console.log('Daily consumption: dashboard scope/completeness/freshness and PostgreSQL RLS/atomic monotonic snapshots passed');
})().catch(e=>{console.error(e.stderr?String(e.stderr):e);process.exitCode=1;});
