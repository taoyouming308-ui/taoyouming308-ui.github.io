#!/usr/bin/env node
// Disposable tmpfs PostgreSQL; catalog-shaped schema, synthetic financial data only.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync,spawn}=require('node:child_process');
const container='zysyr-admin-correction-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024});
const args=['exec','-i',container,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'];
const sql=input=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),q=s=>"'"+String(s).replaceAll("'","''")+"'";
const json=s=>JSON.parse(sql(s).split('\n').at(-1));
const fail=(s,p)=>assert.throws(()=>sql(s),e=>p.test(String(e.stderr||e)));
const service="set request.jwt.claim.role='service_role';";
const C=id(1),S=id(2),A=id(3),D=id(4),V=id(5);
const changes=(value=120)=>json("select jsonb_agg(jsonb_build_object('id',id,'value',"+value+")) from zysyr_daily_sheet_cells where draft_id='"+D+"' and cell_role<>'payment_card_consumption';");
const call=(cells,{actor=A,company=C,store=S,revision=1,request=id(80),reason='synthetic correction'}={})=>
  service+"select zysyr_correct_confirmed_daily_sheet("+[actor,company,store,D].map(q).join(',')+','+revision+','+q(request)+','+q(JSON.stringify(cells))+'::jsonb,'+q(reason)+');';
const state=()=>sql("select jsonb_build_object('draft',(select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='"+D+"'),'cells',(select jsonb_agg(c order by id) from zysyr_daily_sheet_cells c),'versions',(select jsonb_agg(v order by version) from zysyr_daily_sheet_versions v),'income',(select jsonb_agg(i order by id) from zysyr_income_records i),'audits',(select count(*) from zysyr_audit_events),'reports',(select jsonb_agg(r order by version) from zysyr_daily_reports r));");
async function main(){
 let created=false;
 try{
  docker(['run','--rm','-d','--network','none','--tmpfs','/var/lib/postgresql/data:rw','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);created=true;
  for(let i=0;i<80;i++){try{sql('select 1');break}catch(_){await new Promise(r=>setTimeout(r,250))}}
  sql(fs.readFileSync('scripts/fixtures/admin-daily-schema.sql','utf8'));
  sql(`create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'')='yes'$$;
    create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'append-only'; end$$;
    create trigger versions_append before update or delete on zysyr_daily_sheet_versions for each row execute function zysyr_private.protect_report_trace_history();
    create trigger changes_append before update or delete on zysyr_daily_sheet_cell_changes for each row execute function zysyr_private.protect_report_trace_history();
    create trigger month_lock before insert or update on zysyr_daily_sheet_drafts for each row execute function zysyr_private.lock_daily_rollup_month();
    create trigger one_active_date before insert or update of status on zysyr_daily_sheet_drafts for each row execute function zysyr_private.enforce_one_active_daily_sheet_date();
    insert into zysyr_companies(id,code,name) values('${C}','synthetic','Synthetic only');
    insert into zysyr_stores(id,company_id,name) values('${S}','${C}','Synthetic store'),('${id(22)}','${C}','Second synthetic');
    insert into zysyr_user_accounts(id,company_id,auth_user_id,login_name,display_name,status) values('${A}','${C}','${id(30)}','admin','Synthetic admin','active'),('${id(31)}','${C}','${id(32)}','other','Synthetic shareholder','active'),('${id(33)}','${C}','${id(34)}','finance','Synthetic finance','active');
    insert into zysyr_roles(id,code,name) values('${id(35)}','shareholder','Synthetic shareholder');
    insert into zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type) values('${C}','${A}','${id(35)}','company'),('${C}','${id(31)}','${id(35)}','company');
    insert into zysyr_voucher_attachments(id,company_id,store_id,store,record_type,object_path,original_filename,mime_type,size_bytes,uploaded_by,audit_status,document_type,reviewed_at,reviewed_by_user_id) values('${V}','${C}','${S}','Synthetic store','report','synthetic/image.jpg','synthetic.jpg','image/jpeg',10,'synthetic','approved','daily_report',now(),'${A}');
    insert into zysyr_daily_sheet_drafts(id,company_id,store_id,report_date,source_voucher_id,source_sha256,ocr_provider,ocr_model,created_by_user_id,updated_by_user_id) values('${D}','${C}','${S}','2026-10-09','${V}',repeat('a',64),'synthetic','synthetic','${A}','${A}');
    insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric)
    select '${C}','${S}','${D}',section,row_key,'Synthetic',code,code,rownum,colnum,role,'blank_template',amount,true,amount from (values
      ('stylist','stylist_1','cut',3,2,'staff_value',100),
      ('stylist','stylist_1','subtotal',3,3,'staff_total',100),
      ('stylist','stylist_category_total','cut',10,2,'category_total',100),
      ('stylist','stylist_category_total','subtotal',10,3,'summary_value',100),
      ('summary','summary','actual',30,2,'summary_actual',100),
      ('summary','summary','grand',30,3,'summary_grand',100),
      ('payment','payment','cash',40,2,'payment_method',100),
      ('payment','payment','cashflow',40,3,'payment_cashflow',100),
      ('payment','payment','total',40,4,'payment_total',100),
      ('payment','payment','card',40,5,'payment_card_consumption',0)) as x(section,row_key,code,rownum,colnum,role,amount);`);
  const migration=fs.readFileSync('supabase/migrations/20261009063120_zysyr_admin_confirmed_daily_correction.sql','utf8');
  sql(migration);sql(migration);
  assert.equal(sql("select count(*) from zysyr_user_capability_grants where revoked_at is null"),'1');
  for(const role of ['anon','authenticated'])fail("set role "+role+";"+call(changes()),/permission denied/);
  fail("set role service_role;"+service+"select zysyr_private.admin_correction_save_daily_sheet_cells('"+A+"','"+C+"','"+S+"','"+D+"','[]','test');",/permission denied/);
  for(const options of [{actor:id(31)},{actor:id(33)},{store:id(22)},{company:id(99)}])fail(call(changes(),options),/FORBIDDEN|NOT_FOUND/);
  fail(call(changes()),/CONFIRMED_REQUIRED/);
  // Seed the initial approved version using the same private posting pipeline in test only.
  // The confirmed helper requires a confirmed projection, unlike ordinary posting.
  sql("update zysyr_daily_sheet_drafts set status='confirmed',confirmed_by_user_id='"+A+"',confirmed_at=now(),confirm_reason='synthetic initial' where id='"+D+"';");
  const initial=json(service+"select zysyr_private.admin_correction_confirm_daily_sheet('"+A+"','"+C+"','"+S+"','"+D+"','"+JSON.stringify({original_filename:'synthetic.jpg',mime_type:'image/jpeg',size_bytes:10,sha256:'a'.repeat(64),bucket_id:'zysyr-reports',object_path:'synthetic/image.jpg',display_data:{}})+"',true,'synthetic initial');");
  const originalSnapshot=sql("select confirmed_snapshot from zysyr_daily_sheet_versions where version=1");
  sql("update zysyr_daily_sheet_drafts set edit_revision=1 where id='"+D+"'");
  assert.equal(sql("select (zysyr_private.daily_sheet_validation('"+C+"','"+S+"','"+D+"')->>'valid')"),'true');
  const before=state();
  fail(call([{id:changes()[0].id,value:120}]),/CONTROL_MISMATCH/);assert.equal(state(),before,'mismatched edit rolls back every cell/audit/ledger write');
  fail(call(changes(),{revision:0}),/REVISION_CONFLICT/);assert.equal(state(),before);
  fail("set test.locked='yes';"+call(changes()),/FINANCE_PERIOD_LOCKED/);assert.equal(state(),before);
  fail(call(changes(),{reason:''}),/INPUT_INVALID/);assert.equal(state(),before);
  sql(`create function public.synthetic_reject_post() returns trigger language plpgsql as $$begin raise exception 'synthetic downstream failure'; end$$;
    create trigger synthetic_reject_post before insert on zysyr_daily_reports for each row execute function public.synthetic_reject_post();`);
  fail(call(changes()),/synthetic downstream failure/);assert.equal(state(),before,'posting failure restores old income, cells, snapshots and audits');
  sql('drop trigger synthetic_reject_post on zysyr_daily_reports; drop function public.synthetic_reject_post();');
  const first=json('set role service_role;'+call(changes()));
  assert.equal(first.corrected,true);assert.equal(first.edit_revision,2);
  assert.equal(sql("select sum(amount) from zysyr_income_records where status='approved'"),'120.00');
  assert.equal(sql("select sum(amount) from zysyr_income_records where status='reversed'"),'100.00');
  assert.equal(sql("select count(*) from zysyr_daily_reports where status='approved'"),'1');
  assert.equal(sql("select count(*) from zysyr_daily_sheet_versions"),'2');
  assert.equal(sql("select confirmed_snapshot from zysyr_daily_sheet_versions where version=1"),originalSnapshot);
  assert.equal(sql("select count(*) from zysyr_voucher_links where business_type='income_record' and unlinked_at is null"),'2','both revisions retain original voucher trace');
  const after=state();assert.equal(json(call(changes())).already_applied,true);assert.equal(state(),after,'lost response retry does not duplicate');
  fail(call(changes(130)),/REQUEST_REUSED/);assert.equal(state(),after);
  fail(call(changes(130),{request:id(81),revision:1}),/REVISION_CONFLICT/);assert.equal(state(),after);
  const status=json(service+"select zysyr_daily_correction_status('"+A+"','"+C+"','"+S+"','"+D+"','"+id(80)+"');");assert.equal(status.applied,true);
  const concurrent=input=>new Promise(resolve=>{const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});
  const race=await Promise.all([concurrent(call(changes(130),{revision:2,request:id(83)})),concurrent(call(changes(140),{revision:2,request:id(84)}))]);
  assert.equal(race.filter(r=>r.code===0).length,1,'only one of two simultaneous corrections may commit');
  assert.match(race.find(r=>r.code!==0).err,/REVISION_CONFLICT/);
  assert.equal(sql('select count(*) from zysyr_daily_reports where status=\'approved\''),'1');
  assert.equal(sql('select count(*) from zysyr_daily_sheet_versions'),'3');
  assert.ok(['130.00','140.00'].includes(sql('select sum(amount) from zysyr_income_records where status=\'approved\'')));
  sql(`create schema zysyr_daily_electronic_private;
    create function zysyr_daily_electronic_private.cash_receipt_projection(uuid,uuid,date) returns jsonb language sql as $$select '{"metadata":{"different_source":true}}'::jsonb$$;
    update zysyr_daily_sheet_drafts set ocr_raw_result='{"autofill":{"daily_total_policy":"cash-plus-earned-card-v1","cash_receipts":{"policy":"operating-external-cash-v1","state":"candidate","cash_channels_complete":true}}}' where id='${D}';
    insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric)
    values('${C}','${S}','${D}','summary','summary','Synthetic','card_subtotal','Card sales',30,6,'summary_value','blank_template',0,true,0);`);
  const cashCells=json(`select jsonb_agg(jsonb_build_object('id',id,'value',case when cell_role in ('payment_method','payment_cashflow') then 100 when cell_role='payment_card_consumption' then 50 when column_code='card_subtotal' then 0 else 150 end)) from zysyr_daily_sheet_cells where draft_id='${D}';`);
  const cash=json(call(cashCells,{revision:3,request:id(85)}));assert.equal(cash.corrected,true);
  assert.equal(sql("select validation_result->>'cash_policy' from zysyr_daily_sheet_drafts where id='"+D+"'"),'operating-external-cash-v1');
  assert.equal(Number(sql("select validation_result->>'cashflow_total' from zysyr_daily_sheet_drafts where id='"+D+"'")),100);
  assert.equal(sql('select count(*) from zysyr_daily_reports where status=\'approved\''),'1');
  sql(`update zysyr_user_capability_grants set revoked_at=now(),revoked_by_user_id='${A}',revoke_reason='synthetic revoke';`);fail(call(changes(130),{request:id(82),revision:2}),/FORBIDDEN/);
  console.log('Admin-only correction PostgreSQL: scope, client/helper deny, locks, validation rollback, revision conflict, immutable history, voucher trace, exact effective income and idempotency passed.');
 }finally{if(created)docker(['stop',container]);}
}
main().catch(e=>{console.error(String(e.stderr||e));process.exitCode=1});
