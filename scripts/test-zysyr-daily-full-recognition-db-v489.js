// Isolated, disposable PostgreSQL only. Never connects to production.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const name='zysyr-daily-v489-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8'});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}
    sql(`create extension if not exists pgcrypto;create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;
      create table zysyr_stores(company_id uuid,id uuid,name text,unique(company_id,id));
      create table zysyr_user_accounts(company_id uuid,id uuid,unique(company_id,id));
      create table zysyr_daily_sheet_drafts(company_id uuid,store_id uuid,id uuid,report_date date,status text,source_voucher_id uuid,edit_revision integer default 0,validation_result jsonb default '{}'::jsonb,ocr_provider text,ocr_model text,updated_by_user_id uuid,updated_at timestamptz,unique(company_id,store_id,id));
      create table zysyr_voucher_attachments(company_id uuid,store_id uuid,id uuid,audit_status text,document_type text,mime_type text,unique(company_id,id));
      create table zysyr_daily_sheet_attachments(company_id uuid,store_id uuid,draft_id uuid,voucher_id uuid,attachment_kind text,linked_at timestamptz default now());
      create table zysyr_daily_sheet_cells(company_id uuid,store_id uuid,draft_id uuid,id uuid primary key,section_code text,row_key text,row_label text,column_code text,column_label text,row_number integer,column_number integer,cell_role text,ocr_numeric numeric,ocr_text text,corrected_numeric numeric,manual_text text,manual_override boolean default false,confidence numeric,bbox jsonb,source_method text,updated_by_user_id uuid,updated_at timestamptz);
      create table zysyr_daily_sheet_cell_changes(id uuid default gen_random_uuid(),company_id uuid,store_id uuid,draft_id uuid,cell_id uuid,revision integer,before_value numeric,after_value numeric,before_text text,after_text text,before_label text,after_label text,changed_by_user_id uuid,changed_at timestamptz,reason text);
      create table zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'SCOPE';end if;end$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select false$$;
      create function zysyr_private.daily_sheet_validation(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('valid',true)$$;
      insert into zysyr_stores values('${id(1)}','${id(2)}','自由手艺人');insert into zysyr_user_accounts values('${id(1)}','${id(3)}');
      insert into zysyr_voucher_attachments values('${id(1)}','${id(2)}','${id(5)}','approved','daily_report','image/jpeg');
      insert into zysyr_voucher_attachments values('${id(1)}','${id(2)}','${id(9)}','approved','daily_report','image/jpeg');
      insert into zysyr_daily_sheet_drafts values('${id(1)}','${id(2)}','${id(4)}','2026-01-03','draft','${id(5)}',0,'{}',null,null,'${id(3)}',now());
      insert into zysyr_daily_sheet_drafts values('${id(1)}','${id(2)}','${id(10)}','2026-01-04','draft','${id(9)}',0,'{}',null,null,'${id(3)}',now());
      insert into zysyr_daily_sheet_attachments values('${id(1)}','${id(2)}','${id(4)}','${id(5)}','original_report',now());
      insert into zysyr_daily_sheet_attachments values('${id(1)}','${id(2)}','${id(10)}','${id(9)}','original_report',now());
      insert into zysyr_daily_sheet_cells values
       ('${id(1)}','${id(2)}','${id(4)}','${id(6)}','stylist','stylist_1','第1行','perm','烫发',3,2,'staff_value',null,null,null,null,false,null,null,'blank_template','${id(3)}',now()),
       ('${id(1)}','${id(2)}','${id(4)}','${id(7)}','technician','technician_1','第1行','unclosed_order','未结单号',16,23,'unclosed_order',null,null,null,null,false,null,null,'blank_template','${id(3)}',now()),
       ('${id(1)}','${id(2)}','${id(4)}','${id(8)}','stylist','stylist_2','人工姓名','perm','烫发',4,2,'staff_value',null,null,88,null,true,null,null,'blank_template','${id(3)}',now());
      insert into zysyr_daily_sheet_cell_changes(company_id,store_id,draft_id,cell_id,before_label,after_label) values('${id(1)}','${id(2)}','${id(4)}','${id(8)}','第2行','人工姓名');`);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260912120743_daily_full_fidelity_recognition_jobs.sql'),'utf8'));
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913022849_daily_recognition_single_item_retry.sql'),'utf8'));
    const job=JSON.parse(sql(`select zysyr_start_daily_recognition_job('${id(3)}','${id(1)}','${id(2)}','2026-01-01');`));
    assert.equal(job.total_count,2);
    const claim=JSON.parse(sql(`select zysyr_claim_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}');`));
    assert.equal(claim.item.report_date,'2026-01-03');
    const candidates=JSON.stringify({cells:[{id:id(6),value:123.45,confidence:.94}],text_cells:[{id:id(7),value:'A108',confidence:.8}],row_names:[{section:'stylist',row_key:'stylist_1',name:'陈晨',confidence:.96},{section:'stylist',row_key:'stylist_2',name:'错误覆盖',confidence:.9}]});
    const applied=JSON.parse(sql(`select zysyr_apply_daily_sheet_recognition_candidates('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}',0,'${candidates}'::jsonb,'gpt-5.6-luna');`));
    assert.equal(applied.saved_cells,1);assert.equal(applied.saved_text_cells,1);assert.equal(applied.saved_row_names,1);assert.equal(applied.manual_cells_preserved,1);
    assert.equal(sql(`select row_label||'|'||ocr_numeric||'|'||source_method from zysyr_daily_sheet_cells where id='${id(6)}'`),'陈晨|123.45|codex_local_candidate');
    assert.equal(sql(`select ocr_text from zysyr_daily_sheet_cells where id='${id(7)}'`),'A108');
    assert.equal(sql(`select row_label||'|'||corrected_numeric from zysyr_daily_sheet_cells where id='${id(8)}'`),'人工姓名|88');
    const second=JSON.parse(sql(`select zysyr_claim_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}');`));assert.equal(second.item,null);
    const firstFailed=JSON.parse(sql(`select zysyr_finish_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}','${claim.item.id}',false,0,'原图表格不完整');`));assert.equal(firstFailed.status,'running');
    const other=JSON.parse(sql(`select zysyr_claim_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}');`));assert.equal(other.item.report_date,'2026-01-04');
    const bothFailed=JSON.parse(sql(`select zysyr_finish_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}','${other.item.id}',false,0,'图片模糊');`));assert.equal(bothFailed.status,'completed_with_errors');assert.equal(bothFailed.failed_count,2);
    const retried=JSON.parse(sql(`select zysyr_retry_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}','${claim.item.id}');`));assert.equal(retried.status,'running');assert.equal(retried.failed_count,1);
    assert.equal(sql(`select report_date||'|'||status from zysyr_daily_recognition_job_items where job_id='${job.id}' order by report_date`),'2026-01-03|queued\n2026-01-04|failed');
    assert.equal(sql(`select action||'|'||(before_json->>'error_message') from zysyr_audit_events where entity_id='${claim.item.id}'`),'daily_recognition_item_retried|原图表格不完整');
    const retryClaim=JSON.parse(sql(`select zysyr_claim_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}');`));assert.equal(retryClaim.item.id,claim.item.id);assert.equal(retryClaim.item.attempt_count,2);
    const finished=JSON.parse(sql(`select zysyr_finish_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}','${retryClaim.item.id}',true,3,null);`));assert.equal(finished.status,'completed_with_errors');assert.equal(finished.failed_count,1);
    assert.throws(()=>sql(`select zysyr_retry_daily_recognition_item('${id(3)}','${id(1)}','${id(2)}','${job.id}','${retryClaim.item.id}');`),/DAILY_RECOGNITION_ITEM_NOT_FAILED/);
    assert.throws(()=>sql(`select zysyr_retry_daily_recognition_item('${id(30)}','${id(1)}','${id(2)}','${job.id}','${other.item.id}');`),/SCOPE/);
    assert.equal(sql(`select has_function_privilege('authenticated','zysyr_retry_daily_recognition_item(uuid,uuid,uuid,uuid,uuid)','execute')`),'f');
    assert.throws(()=>sql(`set role authenticated;select * from zysyr_daily_recognition_jobs;`),/permission denied/);
    console.log('PostgreSQL daily recognition: durable progress, exact candidates, isolated single-day retry, audit and browser denial passed');
  }finally{docker(['stop',name]);}
}
run().catch(error=>{console.error(error.stderr?String(error.stderr):error);process.exitCode=1});
