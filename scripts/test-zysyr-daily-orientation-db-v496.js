#!/usr/bin/env node
// Isolated disposable PostgreSQL only; never connects to production.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const name='zysyr-orientation-v496-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8'});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}
    sql(`create extension if not exists pgcrypto;create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;
      create table zysyr_daily_sheet_drafts(company_id uuid,store_id uuid,id uuid,primary key(company_id,store_id,id));
      create table zysyr_voucher_attachments(company_id uuid,store_id uuid,id uuid,mime_type text,primary key(company_id,id));
      create table zysyr_user_accounts(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_daily_sheet_attachments(id uuid,company_id uuid,store_id uuid,draft_id uuid,voucher_id uuid,primary key(id),unique(company_id,id));
      create table zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.has_capability(uuid,uuid,text) returns boolean language sql as $$select true$$;
      create function zysyr_private.assert_daily_entry_scope(uuid,uuid,uuid) returns void language plpgsql as $$begin if $1<>'${id(5)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'SCOPE';end if;end$$;
      create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'append-only';end$$;
      create function zysyr_register_report_upload(jsonb,jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
        if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service role required'; end if;
        return jsonb_build_object('saved', true);
      end$$;
      insert into zysyr_daily_sheet_drafts values('${id(1)}','${id(2)}','${id(3)}');
      insert into zysyr_voucher_attachments values('${id(1)}','${id(2)}','${id(4)}','image/jpeg');
      insert into zysyr_user_accounts values('${id(1)}','${id(5)}');
      insert into zysyr_daily_sheet_attachments values('${id(6)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}');`);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913033822_daily_attachment_orientation_revisions.sql'),'utf8'));
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913043516_zysyr_service_role_claims_compat.sql'),'utf8'));
    sql(`select set_config('request.jwt.claim.role','',false);select set_config('request.jwt.claims','{"role":"service_role"}',false);select zysyr_save_daily_attachment_orientation('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(6)}',90::smallint,'向右摆正');`);
    assert.equal(sql(`select revision||'|'||degrees from zysyr_daily_attachment_orientation_revisions`),'1|90');
    assert.match(sql(`select set_config('request.jwt.claim.role','',false);select set_config('request.jwt.claims','{"role":"service_role"}',false);select zysyr_register_report_upload('{}','[]')->>'saved'`),/true$/);
    sql(`select set_config('request.jwt.claim.role','service_role',false);select zysyr_save_daily_attachment_orientation('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(6)}',180::smallint,'再次摆正');`);
    assert.equal(sql(`select revision||'|'||degrees from zysyr_daily_attachment_orientation_revisions order by revision`),'1|90\n2|180');
    sql(`select set_config('request.jwt.claim.role','service_role',false);select zysyr_save_daily_attachment_orientation('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(6)}',180::smallint,'重复保存');`);
    assert.equal(sql(`select count(*) from zysyr_daily_attachment_orientation_revisions`),'2');
    assert.equal(sql(`select count(*)||'|'||(max(after_json->>'source_object_unchanged')) from zysyr_audit_events`),'2|true');
    assert.throws(()=>sql(`update zysyr_daily_attachment_orientation_revisions set degrees=0`),/append-only/);
    assert.throws(()=>sql(`select set_config('request.jwt.claim.role','service_role',false);select zysyr_save_daily_attachment_orientation('${id(9)}','${id(1)}','${id(2)}','${id(3)}','${id(6)}',0::smallint,'越权保存');`),/SCOPE/);
    assert.equal(sql(`select has_function_privilege('authenticated','zysyr_save_daily_attachment_orientation(uuid,uuid,uuid,uuid,uuid,smallint,text)','execute')`),'f');
    console.log('PostgreSQL daily image orientation persistence, audit, scope and append-only checks passed');
  }finally{docker(['stop',name]);}
}
run().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1});
