// Isolated Postgres role checks; never reads or writes production business data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const name = 'zysyr-permissions-' + process.pid;
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = input => execFileSync('docker', ['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],
  {input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const tables = ['zysyr_cash_opening_balances','zysyr_report_acknowledgements','zysyr_shareholder_registrations'];
const signatures = [
  'zysyr_acknowledge_report(uuid,uuid,uuid,text,uuid)',
  'zysyr_admin_complete_shareholder_account(uuid,uuid,uuid,text,text,text,uuid,uuid)',
  'zysyr_record_petty_cash(uuid,uuid,uuid,date,text,text,text,numeric,uuid,uuid[],text,text,text)',
  'zysyr_upsert_cash_opening_balance(uuid,uuid,uuid,text,numeric)',
];
(async () => {
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try {
    for(let n=0;n<80;n++){try{sql('select 1');break;}catch{await new Promise(r=>setTimeout(r,250));}}
    sql('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
    for(const table of tables) sql('create table public.'+table+'(id integer); insert into public.'+table+' values(1); grant all on public.'+table+' to anon,authenticated,service_role;');
    for(const signature of signatures) sql('create function public.'+signature+' returns integer language sql security definer set search_path=\'\' as $$select 1$$;');
    sql(fs.readFileSync('supabase/migrations/20260920110545_report_private_api_permissions.sql','utf8'));
    for(const table of tables){
      assert.equal(sql("select relrowsecurity from pg_class where oid='public."+table+"'::regclass"),'t');
      for(const role of ['anon','authenticated']){
        assert.throws(()=>sql('set role '+role+'; select * from public.'+table),/permission denied/);
        assert.throws(()=>sql('set role '+role+'; insert into public.'+table+' values(2)'),/permission denied/);
      }
      assert.equal(sql('set role service_role; select count(*) from public.'+table),'1','existing rows preserved');
      sql('set role service_role; insert into public.'+table+' values(2)');
    }
    for(const signature of signatures){
      for(const role of ['anon','authenticated']) assert.equal(sql("select has_function_privilege('"+role+"','public."+signature+"','execute')"),'f');
      assert.equal(sql("select has_function_privilege('service_role','public."+signature+"','execute')"),'t');
    }
    console.log('Report permissions: 3 tables preserve data/service access; anonymous/authenticated direct reads/writes blocked; 4 RPCs private.');
  }finally{docker(['stop',name]);}
})().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1;});
