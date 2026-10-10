// Disposable PostgreSQL, live catalog functions, synthetic data; no production network.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync,spawn}=require('node:child_process');
const container='daily-cash-review-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024});
const args=['exec','-i',container,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'];
const sql=input=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),q=s=>"'"+String(s).replaceAll("'","''")+"'";
const C=id(1),S=id(2),A=id(3),D=id(4),V=id(5),U=id(30);
const service="set request.jwt.claim.role='service_role';";
const json=s=>JSON.parse(sql(s).split('\n').findLast(x=>x.startsWith('{')||x.startsWith('[')));
const fail=(s,p)=>assert.throws(()=>sql(s),e=>p.test(String(e.stderr||e)));
const status=()=>json(service+"select public.zysyr_daily_cash_review_status("+[C,S,D].map(q).join(',')+");");
const call=({actor=A,auth=U,store=S,company=C,revision=0,token=status().source_token,request=id(80),reason='Synthetic original and channels verified',original=true,channels=true,sales=true}={})=>
 service+"select public.zysyr_review_daily_cash_sources("+[actor,auth,company,store,D].map(q).join(',')+','+revision+','+q(token)+','+q(request)+','+[original,channels,sales].join(',')+','+q(reason)+');';
const snapshot=()=>sql("select jsonb_build_object('draft',(select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='"+D+"'),'proofs',(select count(*) from zysyr_private.daily_cash_reviews),'audit',(select count(*) from zysyr_audit_events),'reports',(select count(*) from zysyr_daily_reports),'income',(select count(*) from zysyr_income_records));");
const current=()=>status().status;
async function main(){let created=false;try{
 docker(['run','--rm','-d','--network','none','--tmpfs','/var/lib/postgresql/data:rw','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);created=true;
 for(let i=0;i<80;i++){try{sql('select 1');break}catch(_){await new Promise(r=>setTimeout(r,250))}}
 sql(fs.readFileSync('scripts/fixtures/admin-daily-schema.sql','utf8'));
 sql(`create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'')='yes'$$;
 create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'append-only';end$$;
 create schema zysyr_daily_electronic_private;
 create table zysyr_daily_sheet_attachment_voids(company_id uuid,store_id uuid,draft_id uuid,voucher_id uuid);
 create function zysyr_daily_electronic_private.cash_receipt_projection(uuid,uuid,date) returns jsonb language sql as $$select '{"metadata":{"different_source":true}}'::jsonb$$;
 create table zysyr_daily_electronic_snapshots(id uuid primary key,source_sha256 text);
 create table zysyr_daily_electronic_heads(store_id uuid,business_date date,source_scope text,snapshot_id uuid,latest_fetched_at timestamptz,primary key(store_id,business_date,source_scope));
 create table mgj_business_detail_snapshots(id uuid primary key,source_sha256 text);
 create table mgj_business_detail_heads(shop_name text,business_date date,snapshot_id uuid,last_seen_at timestamptz,primary key(shop_name,business_date));
 create table mgj_daily_consumption(shop_name text,business_date date,services jsonb,fetched_at timestamptz,primary key(shop_name,business_date));
 insert into zysyr_companies(id,code,name) values('${C}','synthetic','Synthetic only');
 insert into zysyr_stores(id,company_id,name) values('${S}','${C}','Synthetic store');
 insert into zysyr_user_accounts(id,company_id,auth_user_id,login_name,display_name,status) values('${A}','${C}','${U}','finance','Synthetic finance','active');
 insert into zysyr_roles(id,code,name) values('${id(35)}','finance','Synthetic finance');
 insert into zysyr_capabilities(id,code,name) values('${id(36)}','daily_report.write','Synthetic write'),('${id(37)}','report.upload','Synthetic upload');
 insert into zysyr_role_capabilities(role_id,capability_id) values('${id(35)}','${id(36)}'),('${id(35)}','${id(37)}');
 insert into zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type) values('${C}','${A}','${id(35)}','company');
 insert into zysyr_voucher_attachments(id,company_id,store_id,store,record_type,object_path,original_filename,mime_type,size_bytes,uploaded_by,audit_status,document_type,reviewed_at,reviewed_by_user_id)
 values('${V}','${C}','${S}','Synthetic store','report','synthetic/image.jpg','synthetic.jpg','image/jpeg',10,'synthetic','approved','daily_report',now(),'${A}');
 insert into zysyr_daily_sheet_drafts(id,company_id,store_id,report_date,source_voucher_id,source_sha256,ocr_provider,ocr_model,created_by_user_id,updated_by_user_id,ocr_raw_result)
 values('${D}','${C}','${S}','2026-10-09','${V}',repeat('a',64),'synthetic','synthetic','${A}','${A}','{"autofill":{"daily_total_policy":"cash-plus-earned-card-v1","cash_receipts":{"policy":"operating-external-cash-v1","state":"candidate","cash_channels_complete":false}}}');
 insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric)
 select '${C}','${S}','${D}',section,row_key,'Synthetic',code,code,rownum,colnum,role,'blank_template',amount,true,amount from (values
 ('stylist','stylist_1','wash_cut_blow',3,2,'staff_value',100),('stylist','stylist_1','subtotal',3,3,'staff_total',100),
 ('stylist','stylist_category_total','wash_cut_blow',10,2,'category_total',100),('stylist','stylist_category_total','subtotal',10,3,'summary_value',100),
 ('summary','summary','actual_total',30,2,'summary_actual',100),('summary','summary','grand_total',30,3,'summary_grand',100),
 ('summary','summary','card_subtotal',30,6,'summary_value',0),
 ('payment','payment','alipay',40,2,'payment_method',100),('payment','payment','cash_flow',40,3,'payment_cashflow',100),
 ('payment','payment','total',40,4,'payment_total',100),('payment','payment','card_consumption',40,5,'payment_card_consumption',0)) as x(section,row_key,code,rownum,colnum,role,amount);
 insert into zysyr_daily_electronic_snapshots values('${id(50)}',repeat('b',64));
 insert into zysyr_daily_electronic_heads values('${S}','2026-10-09','operating_daily_summary','${id(50)}',now());
 insert into mgj_business_detail_snapshots values('${id(51)}',repeat('d',64));
 insert into mgj_business_detail_heads values('Synthetic store','2026-10-09','${id(51)}',now());
 insert into mgj_daily_consumption values('Synthetic store','2026-10-09','[{"source_id":"synthetic-bill","amount":100}]',now());`);
 sql(fs.readFileSync('scripts/fixtures/daily-cash-post-core.sql','utf8'));sql(fs.readFileSync('scripts/fixtures/daily-cash-post-support.sql','utf8'));sql(fs.readFileSync('scripts/fixtures/daily-cash-post-functions.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/20261010080343_zysyr_daily_cash_human_review.sql','utf8');sql(migration);sql(migration);
 const before=snapshot();
 for(const role of ['anon','authenticated'])fail('set role '+role+';'+call(),/permission denied/);
 fail('set role service_role; select * from zysyr_private.daily_cash_reviews;',/permission denied/);
 for(const options of [{auth:id(99)},{actor:id(99)},{store:id(99)},{company:id(99)},{original:false},{channels:false},{sales:false},{reason:'x'},{revision:9},{token:'fake'}])
  fail(call(options),/FORBIDDEN|CONFIRMATION_REQUIRED|REVISION_CONFLICT|SOURCE_CHANGED/);
 fail("set test.locked='yes';"+call(),/FINANCE_PERIOD_LOCKED/);assert.equal(snapshot(),before);
 for(const mutation of ["corrected_numeric=null where column_code='card_subtotal'","corrected_numeric=99 where cell_role='payment_total'","manual_override=false where cell_role='payment_cashflow'"]){
  fail('begin; update zysyr_daily_sheet_cells set '+mutation+';'+call(),/VALUES_INCOMPLETE/);assert.equal(snapshot(),before);
 }
 fail("begin;update zysyr_voucher_attachments set audit_status='rejected';"+call(),/SOURCE_CHANGED|APPROVED_ORIGINAL/);assert.equal(snapshot(),before);
 assert.equal(current(),'required');
 assert.equal(json("set request.jwt.claim.role='';set request.jwt.claims='{\"role\":\"service_role\"}';select public.zysyr_daily_cash_review_status("+[C,S,D].map(q).join(',')+");").status,'required','modern JSON JWT claims accepted');
 assert.equal(json(call().replace(service,"set request.jwt.claim.role='';set request.jwt.claims='{\"role\":\"service_role\"}';")).status,'current');assert.equal(current(),'current');
 assert.equal(sql("select ocr_raw_result#>>'{autofill,cash_receipts,cash_channels_complete}' from zysyr_daily_sheet_drafts"),'false');
 const after=snapshot();assert.equal(json(call()).status,'current');assert.equal(snapshot(),after,'idempotency preserves audit and proofs');
 fail(call({reason:'Different reused request'}),/REQUEST_REUSED/);assert.equal(snapshot(),after);
 for(const mutation of [
  "update zysyr_daily_sheet_drafts set edit_revision=edit_revision+1",
  "update zysyr_daily_sheet_cells set corrected_numeric=101 where cell_role='staff_value'",
  "update zysyr_daily_electronic_heads set latest_fetched_at=latest_fetched_at+interval '1 second'",
  "update zysyr_daily_electronic_snapshots set source_sha256=repeat('c',64)",
  "update mgj_business_detail_heads set last_seen_at=last_seen_at+interval '1 second'",
  "update mgj_daily_consumption set fetched_at=fetched_at+interval '1 second'",
  "update zysyr_voucher_attachments set audit_status='rejected'",
  "update zysyr_user_role_grants set revoked_at=now(),revoke_reason='Synthetic revoke'",
  "update zysyr_user_accounts set status='disabled'"]){
  assert.equal(json('begin;'+mutation+';'+service+"select public.zysyr_daily_cash_review_status("+[C,S,D].map(q).join(',')+');rollback;').status,'required');
 }
 fail('update zysyr_private.daily_cash_reviews set reason=reason;',/append-only/);
 const report={company_id:C,store_id:S,uploaded_by_user_id:A,report_type:'daily',report_date:'2026-10-09',original_filename:'synthetic.jpg',mime_type:'image/jpeg',size_bytes:10,sha256:'a'.repeat(64),bucket_id:'zysyr-reports',object_path:'synthetic/report.jpg',display_data:{}};
 const post=service+"select public.zysyr_confirm_daily_sheet("+[A,C,S,D].map(q).join(',')+','+q(JSON.stringify(report))+"::jsonb,true,'Synthetic final post',0);";
 fail("begin;update zysyr_daily_electronic_heads set latest_fetched_at=now()+interval '1 second';"+post,/CONTROL_MISMATCH/);
 assert.equal(snapshot(),after,'stale post rolls all financial writes back');
 // Inject changes after initial validation and after ledger insertion begins.
 // The final posting guard must roll back report, income and version together.
 sql("create function public.synthetic_slow_income() returns trigger language plpgsql as $$begin perform pg_sleep(0.8);return new;end$$;create trigger synthetic_slow before insert on zysyr_income_records for each row execute function public.synthetic_slow_income();");
 const concurrent=input=>new Promise(resolve=>{const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});
 for(const [i,mutation] of [
  "update zysyr_daily_electronic_heads set latest_fetched_at=latest_fetched_at+interval '1 second'",
  "insert into zysyr_daily_electronic_heads values('"+S+"','2026-10-09','card_sales_daily_summary','"+id(50)+"',now())",
  "update zysyr_user_role_grants set revoked_at=now(),revoke_reason='Synthetic concurrent revoke'",
  "update mgj_business_detail_heads set last_seen_at=last_seen_at+interval '1 second'",
  "update mgj_daily_consumption set services='[{\"source_id\":\"synthetic-bill\",\"amount\":101}]'"
 ].entries()){
  const posting=concurrent(post);await new Promise(r=>setTimeout(r,250));sql(mutation);
  const result=await posting;assert.notEqual(result.code,0,'concurrent source/identity change rejects');
  assert.match(result.err,/CHANGED_BEFORE_POST|FORBIDDEN|CONTROL_MISMATCH/);
  assert.equal(sql('select count(*) from zysyr_income_records'),'0');assert.equal(sql('select count(*) from zysyr_daily_reports'),'0');
  assert.equal(sql('select count(*) from zysyr_daily_sheet_versions'),'0');assert.equal(current(),'required');
  if(i===2)sql("update zysyr_user_role_grants set revoked_at=null,revoke_reason=null;");
  assert.equal(json(call({request:id(90+i)})).status,'current');
 }
 sql('drop trigger synthetic_slow on zysyr_income_records;drop function public.synthetic_slow_income();');
 // Production-shaped collision: empty template/dynamic row and bank/Douyin
 // share physical positions. The old full confirmation must fail atomically.
 sql(`insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric)
 values('${C}','${S}','${D}','stylist','stylist_empty','Template','wash_cut_blow','wash_cut_blow',3,2,'staff_value','blank_template',0,true,0),
 ('${C}','${S}','${D}','stylist','stylist_empty','Template','subtotal','subtotal',3,3,'staff_total','blank_template',0,true,0),
 ('${C}','${S}','${D}','payment','payment','Synthetic','bank_card','bank_card',40,2,'payment_method','blank_template',0,true,0),
 ('${C}','${S}','${D}','payment','payment','Synthetic','douyin','douyin',40,2,'payment_method','blank_template',0,true,0);`);
 assert.equal(json(call({request:id(110)})).status,'current');
 const collisionSnapshot=snapshot();
 fail(post,/duplicate key.*zysyr_report_cells/);
 assert.equal(snapshot(),collisionSnapshot,'old 409 rolls back every financial record');
 sql(fs.readFileSync('supabase/migrations/20261010111632_zysyr_daily_post_logical_cells.sql','utf8'));
 sql(fs.readFileSync('supabase/migrations/20261010111632_zysyr_daily_post_logical_cells.sql','utf8'));
 const wrapper=(patch={})=>service+"select public.zysyr_confirm_daily_sheet_reviewed("+[A,patch.auth||U,C,S,D].map(q).join(',')+','+q(JSON.stringify(report))+"::jsonb,true,'Synthetic explicit final consent',"+(patch.revision??0)+','+q(patch.token||status().source_token)+','+q(id(120))+','+q(patch.statement||'cash-original-channels-sales-v1')+');';
 for(const patch of [{auth:id(99)},{revision:9},{token:'wrong'},{statement:'automatic'}])fail(wrapper(patch),/FORBIDDEN|REVISION_CONFLICT|SOURCE_CHANGED|EXPLICIT_CONFIRMATION_REQUIRED/);
 assert.equal(snapshot(),collisionSnapshot);
 // New proof/audit must roll back too if a later ledger step fails.
 sql("create function public.synthetic_fail_income() returns trigger language plpgsql as $$begin raise exception 'synthetic downstream failure';end$$;create trigger synthetic_fail before insert on zysyr_income_records for each row execute function public.synthetic_fail_income();");
 fail(wrapper(),/synthetic downstream failure/);assert.equal(snapshot(),collisionSnapshot);
 sql('drop trigger synthetic_fail on zysyr_income_records;drop function public.synthetic_fail_income();');
 sql(fs.readFileSync('supabase/migrations/20260920071049_daily_review_atomic_save.sql','utf8'));
 sql(fs.readFileSync('supabase/migrations/20260920110534_daily_review_explicit_blank.sql','utf8'));
 sql(fs.readFileSync('supabase/migrations/20260924010116_zysyr_daily_expected_revision_gate.sql','utf8'));
 await require('./test-daily-post-sequence-harness.js')({sql,json,q,C,S,A,D,V,U});
 const posted={daily_report_status:sql('select status from zysyr_daily_reports')};assert.equal(posted.daily_report_status,'approved');
 assert.equal(sql('select count(*) from zysyr_report_cells'),sql('select count(*) from zysyr_daily_sheet_cells'),'every logical cell retained');
 assert.equal(sql("select count(*) from zysyr_report_cells where sheet_name='原图电子日报/payment' and numeric_value=0"),'3');
 assert.equal(sql("select count(*) from zysyr_daily_report_lines l join zysyr_report_cells c on c.id=l.source_report_cell_id where l.amount=c.numeric_value"),'1','income maps to its exact logical source');
 assert.equal(sql("select status from zysyr_daily_sheet_drafts"),'confirmed');assert.equal(sql("select count(*) from zysyr_daily_sheet_versions"),'1');assert.equal(sql("select sum(amount) from zysyr_income_records where status='approved'"),'100.00');
 console.log('Cash review and full browser/Edge/PostgreSQL sequence: old real-shaped coordinate409 reproduced and fixed; atomic consent/post and lineage verified;  ordinary live posting succeeds; identity/scope/ACL/unknown/difference/revision/source/revocation/idempotency/immutable proof and rollback passed.');
 }finally{if(created)docker(['stop',container]);}}
main().catch(e=>{console.error(String(e.stderr||e));process.exitCode=1;});
