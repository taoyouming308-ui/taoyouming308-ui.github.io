#!/usr/bin/env node
// Isolated disposable PostgreSQL only; never connects to production.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const name='zysyr-monthly-source-v496-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8'});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}
    sql(`create table public.zysyr_report_uploads(
      id bigint generated always as identity primary key,
      report_type text not null,
      object_path text not null,
      display_data jsonb not null default '{}'::jsonb,
      constraint zysyr_report_uploads_object_path_key unique(object_path)
    );`);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913040528_monthly_draft_shared_source.sql'),'utf8'));
    sql(`insert into public.zysyr_report_uploads(report_type,object_path) values('monthly_profit_loss','owned/a.xlsx');`);
    assert.throws(()=>sql(`insert into public.zysyr_report_uploads(report_type,object_path) values('monthly_profit_loss','owned/a.xlsx');`),/zysyr_report_uploads_owned_object_path_key/);
    sql(`insert into public.zysyr_report_uploads(report_type,object_path,display_data) values
      ('monthly_profit_loss','retained/template.xlsx','{"source_object_reused":true}'),
      ('monthly_profit_loss','retained/template.xlsx','{"source_object_reused":true}');`);
    assert.equal(sql(`select count(*) from public.zysyr_report_uploads where object_path='retained/template.xlsx'`),'2');
    assert.throws(()=>sql(`insert into public.zysyr_report_uploads(report_type,object_path,display_data) values('daily_sheet','retained/template.xlsx','{"source_object_reused":true}');`),/zysyr_report_uploads_shared_source_monthly_only/);
    console.log('PostgreSQL monthly shared-source ownership and scope checks passed');
  }finally{docker(['stop',name]);}
}
run().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1});
