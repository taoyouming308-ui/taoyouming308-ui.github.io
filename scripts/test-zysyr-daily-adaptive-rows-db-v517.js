#!/usr/bin/env node
// Isolated, disposable PostgreSQL only. Never connects to production.
const {execFileSync}=require('child_process');
const fs=require('fs');
const assert=require('assert/strict');
const name='zysyr-daily-adaptive-v517-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8'});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}
    sql(`create extension if not exists pgcrypto;create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;
      create table zysyr_daily_sheet_drafts(company_id uuid,store_id uuid,id uuid,report_date date,status text,edit_revision integer,validation_result jsonb,updated_by_user_id uuid,updated_at timestamptz,unique(company_id,store_id,id));
      create table zysyr_daily_sheet_cells(id uuid primary key default gen_random_uuid(),company_id uuid,store_id uuid,draft_id uuid,section_code text,row_key text,row_label text,column_code text,column_label text,row_number integer,column_number integer,cell_role text,ocr_text text,ocr_numeric numeric,corrected_numeric numeric,manual_override boolean,confidence numeric,bbox jsonb,source_method text,created_at timestamptz default now(),updated_by_user_id uuid,updated_at timestamptz,manual_text text,row_label_source_method text,row_label_confidence numeric,unique(company_id,draft_id,section_code,row_key,column_code));
      create table zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'SCOPE';end if;end$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select false$$;
      create function zysyr_private.daily_sheet_validation(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('valid',true)$$;
      insert into zysyr_daily_sheet_drafts values('${id(1)}','${id(2)}','${id(4)}','2026-09-09','draft',0,'{}','${id(3)}',now());
      insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,corrected_numeric,manual_override,source_method,updated_by_user_id,updated_at,row_label_source_method) values
      ('${id(1)}','${id(2)}','${id(4)}','stylist','stylist_1','人工姓名','perm','烫发',3,2,'staff_value',88,true,'blank_template','${id(3)}',now(),'manual'),
      ('${id(1)}','${id(2)}','${id(4)}','stylist','stylist_1','人工姓名','subtotal','小计',3,20,'staff_total',88,true,'blank_template','${id(3)}',now(),'manual'),
      ('${id(1)}','${id(2)}','${id(4)}','stylist','stylist_category_total','小计','perm','烫发',12,2,'category_total',null,false,'blank_template','${id(3)}',now(),'template'),
      ('${id(1)}','${id(2)}','${id(4)}','technician','technician_1','第1行','perm','烫发',15,2,'technician_value',null,false,'blank_template','${id(3)}',now(),'template'),
      ('${id(1)}','${id(2)}','${id(4)}','technician','technician_1','第1行','subtotal','小计',15,21,'technician_total',null,false,'blank_template','${id(3)}',now(),'template'),
      ('${id(1)}','${id(2)}','${id(4)}','technician','technician_category_total','小计','perm','烫发',21,2,'technician_category_total',null,false,'blank_template','${id(3)}',now(),'template');`);
    sql(fs.readFileSync('supabase/migrations/20260921033000_daily_recognition_adaptive_staff_rows.sql','utf8'));
    const first=JSON.parse(sql(`select zysyr_expand_daily_sheet_staff_rows('${id(3)}','${id(1)}','${id(2)}','${id(4)}',0,3,2);`));
    assert.equal(first.added_rows,3);assert.equal(first.added_stylist_rows,2);assert.equal(first.added_technician_rows,1);assert.equal(first.revision,1);
    assert.equal(sql(`select count(distinct row_key) from zysyr_daily_sheet_cells where section_code='stylist' and row_key<>'stylist_category_total'`),'3');
    assert.equal(sql(`select count(distinct row_key) from zysyr_daily_sheet_cells where section_code='technician' and row_key<>'technician_category_total'`),'2');
    assert.equal(sql(`select row_label||'|'||corrected_numeric||'|'||manual_override from zysyr_daily_sheet_cells where row_key='stylist_1' and column_code='perm'`),'人工姓名|88|true');
    assert.equal(sql(`select count(*) from zysyr_daily_sheet_cells where row_key in ('stylist_2','stylist_3','technician_2') and (ocr_numeric is not null or corrected_numeric is not null or manual_override)`),'0');
    assert.equal(sql(`select row_number from zysyr_daily_sheet_cells where row_key='stylist_category_total'`),'7');
    assert.equal(sql(`select row_number from zysyr_daily_sheet_cells where row_key='technician_category_total'`),'17');
    const second=JSON.parse(sql(`select zysyr_expand_daily_sheet_staff_rows('${id(3)}','${id(1)}','${id(2)}','${id(4)}',1,3,2);`));
    assert.equal(second.added_rows,0);assert.equal(second.revision,1);
    assert.throws(()=>sql(`select zysyr_expand_daily_sheet_staff_rows('${id(3)}','${id(1)}','${id(2)}','${id(4)}',0,4,2);`),/DAILY_SHEET_CHANGED_RELOAD/);
    assert.equal(sql(`select has_function_privilege('authenticated','zysyr_expand_daily_sheet_staff_rows(uuid,uuid,uuid,uuid,integer,integer,integer)','execute')`),'f');
    assert.equal(sql(`select action from zysyr_audit_events`),'daily_staff_rows_auto_expanded');
    console.log('PostgreSQL v517 adaptive staff rows: append-only blanks, manual preservation, revision gate, audit and browser denial passed');
  }finally{docker(['stop',name]);}
}
run().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1});
