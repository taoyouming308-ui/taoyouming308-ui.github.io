#!/usr/bin/env node
// Isolated PostgreSQL regression only. Never connects to production.
const {execFileSync}=require('child_process');
const fs=require('fs');
const assert=require('assert/strict');
const name='zysyr-daily-void-v518-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8'});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}
    sql(`create extension if not exists pgcrypto;create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;
      create table public.zysyr_user_accounts(company_id uuid,id uuid,primary key(company_id,id));
      create table public.zysyr_voucher_attachments(id uuid,company_id uuid,store_id uuid,original_filename text,sha256 text,audit_status text,document_type text,primary key(company_id,id));
      create table public.zysyr_daily_sheet_drafts(id uuid,company_id uuid,store_id uuid,report_date date,status text,source_voucher_id uuid,source_sha256 text,updated_by_user_id uuid,updated_at timestamptz,primary key(company_id,store_id,id));
      create table public.zysyr_daily_sheet_attachments(id uuid,company_id uuid,store_id uuid,draft_id uuid,voucher_id uuid,attachment_kind text,linked_at timestamptz,primary key(id),unique(company_id,id));
      create table public.zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.has_capability(uuid,uuid,text) returns boolean language sql stable as $$select true$$;
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'FINANCE_SCOPE_FORBIDDEN';end if;end$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql stable as $$select false$$;
      create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
      insert into public.zysyr_user_accounts values('${id(1)}','${id(3)}');
      insert into public.zysyr_voucher_attachments values
        ('${id(5)}','${id(1)}','${id(2)}','误传.jpg','${'a'.repeat(64)}','approved','daily_report'),
        ('${id(6)}','${id(1)}','${id(2)}','正确.jpg','${'b'.repeat(64)}','approved','daily_report');
      insert into public.zysyr_daily_sheet_drafts values('${id(4)}','${id(1)}','${id(2)}','2026-09-09','draft','${id(5)}','${'a'.repeat(64)}','${id(3)}',now());
      insert into public.zysyr_daily_sheet_attachments values
        ('${id(7)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','original_report','2026-09-09 10:00:00+00'),
        ('${id(8)}','${id(1)}','${id(2)}','${id(4)}','${id(6)}','original_report','2026-09-09 11:00:00+00');`);
    sql(fs.readFileSync('supabase/migrations/20260921154502_void_mistaken_daily_attachment.sql','utf8'));
    sql(fs.readFileSync('supabase/migrations/20260921160358_zysyr_daily_attachment_void_indexes.sql','utf8'));
    const saved=JSON.parse(sql(`select zysyr_void_daily_sheet_attachment('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${id(7)}','上传错了日期');`));
    assert.equal(saved.replacement_source_voucher_id,id(6));
    assert.equal(saved.original_preserved,true);assert.equal(saved.formal_ledger_written,false);
    assert.equal(sql(`select source_voucher_id||'|'||source_sha256 from zysyr_daily_sheet_drafts where id='${id(4)}'`),id(6)+'|'+('b'.repeat(64)));
    assert.equal(sql(`select count(*) from zysyr_daily_sheet_attachments where id='${id(7)}'`),'1');
    assert.equal(sql(`select reason from zysyr_daily_sheet_attachment_voids where daily_sheet_attachment_id='${id(7)}'`),'上传错了日期');
    assert.equal(sql(`select action from zysyr_audit_events`),'mark_mistaken_upload');
    assert.throws(()=>sql(`select zysyr_void_daily_sheet_attachment('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${id(7)}','重复');`),/DAILY_ATTACHMENT_ALREADY_VOIDED/);
    sql(`update zysyr_daily_sheet_drafts set status='confirmed' where id='${id(4)}'`);
    assert.throws(()=>sql(`select zysyr_void_daily_sheet_attachment('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${id(8)}','已入账后误删');`),/DAILY_ATTACHMENT_CONFIRMED_REQUIRES_REVERSAL/);
    assert.equal(sql(`select has_function_privilege('authenticated','zysyr_void_daily_sheet_attachment(uuid,uuid,uuid,uuid,uuid,text)','execute')`),'f');
    assert.equal(sql(`select has_function_privilege('service_role','zysyr_void_daily_sheet_attachment(uuid,uuid,uuid,uuid,uuid,text)','execute')`),'t');
    console.log('PostgreSQL v518 daily mistaken-upload void: immutable source, active replacement, audit, scope and confirmed guard passed');
  }finally{docker(['stop',name]);}
}
run().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1});
