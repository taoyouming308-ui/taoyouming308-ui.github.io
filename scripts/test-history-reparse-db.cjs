// Isolated synthetic PostgreSQL only. Never connects to an existing database.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync,spawn}=require('node:child_process');
const authoritative=process.env.HISTORY_AUTHORITATIVE_BASELINE==='1';
let database='postgres',dbUser='postgres';
const name='history-reparse-test-'+process.pid+'-'+Date.now();
const docker=a=>execFileSync('docker',a,{encoding:'utf8',maxBuffer:32*1024*1024});
const sql=s=>execFileSync('docker',['exec','-i',name,'psql','-X','-h','127.0.0.1','-U',dbUser,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
const q=s=>"'"+String(s).replaceAll("'","''")+"'",id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const C=id(1),S=id(2),A=id(3),B=id(4),R=id(5),Req=id(6);
const args=[A,C,S,B].map(q).join(',');
const json=s=>JSON.parse(sql(s).split('\n').findLast(x=>x.startsWith('{')));
const fail=(s,re)=>assert.throws(()=>sql(s),e=>re.test(String(e.stderr||e)));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
(async()=>{let created=false;try{
 docker(['run','--rm','-d','--network','none','--tmpfs','/var/lib/postgresql/data:rw','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_PASSWORD=synthetic-local-only',authoritative?'public.ecr.aws/supabase/postgres:17.6.1.143':'postgres:17']);created=true;
 for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(r=>setTimeout(r,250))}}
 const loadFunction=(file,name)=>{const source=fs.readFileSync('supabase/migrations/'+file,'utf8'),start=source.indexOf('create or replace function zysyr_private.'+name+'(');assert.ok(start>=0,name);sql(source.slice(start,source.indexOf('$$;',start)+3));};
 if(authoritative){
 sql('create database history_catalog_test template template0');database='history_catalog_test';
 dbUser='supabase_admin';sql(require('./fixtures/history-authoritative/build-baseline.cjs')());dbUser='postgres';
 assert.equal(sql('show check_function_bodies'),'on');
 sql(`insert into auth.users(id) values('${A}');`);
 }else{
 sql(fs.readFileSync('scripts/fixtures/admin-daily-schema.sql','utf8'));
 sql(`create function zysyr_private.has_capability(uuid,uuid,text) returns boolean language sql as $$select false$$;`);

 loadFunction('20260820095920_zysyr_sprint1_employee_store_management.sql','account_has_capability');
 loadFunction('20260820102856_zysyr_sprint2_voucher_center.sql','account_is_finance_in_scope');
 loadFunction('20260820112615_zysyr_sprint3_finance_foundation.sql','assert_finance_scope');
 const authSource=fs.readFileSync('supabase/migrations/20260811031221_zysyr_v2_sprint0_auth_rbac_audit.sql','utf8'),periodStart=authSource.indexOf('create table if not exists public.zysyr_period_locks');
 sql(authSource.slice(periodStart,authSource.indexOf('\n);',periodStart)+4));
 loadFunction('20260820112615_zysyr_sprint3_finance_foundation.sql','period_is_locked');
 for(const file of ['20260830021731_zysyr_history_import_staging.sql','20260830040811_zysyr_history_human_review.sql','20260830070134_zysyr_history_formal_ledger.sql'])sql(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 }
 sql(`insert into zysyr_companies(id,code,name) values('${C}','synthetic','Synthetic');
 insert into zysyr_stores(id,company_id,name) values('${S}','${C}','Synthetic');
 insert into zysyr_user_accounts(id,company_id,auth_user_id,login_name,display_name,status) values('${A}','${C}','${A}','synthetic','Synthetic','active');
 insert into zysyr_roles(id,code,name) values('${id(101)}','finance','Synthetic finance');
 insert into zysyr_capabilities(id,code,name) values('${id(102)}','expense.create_submit','Synthetic permission');
 insert into zysyr_role_capabilities(role_id,capability_id) values('${id(101)}','${id(102)}');
 insert into zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type) values('${C}','${A}','${id(101)}','company');
 insert into zysyr_history_import_batches(id,company_id,store_id,import_type,source_filename,source_mime_type,source_size_bytes,source_sha256,source_object_path,target_store_label,period_start,period_end,raw_row_count,valid_row_count,reason,created_by_user_id)
 values('${B}','${C}','${S}','monthly_profit_loss','synthetic.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,repeat('a',64),'synthetic','Synthetic','2026-09-01','2026-09-01',3,3,'Synthetic','${A}');
 insert into zysyr_history_import_rows(id,company_id,store_id,import_batch_id,source_sheet,source_row_number,source_locator,row_hash,raw_json,mapped_json,validation_status)
 values('${R}','${C}','${S}','${B}','Sheet1',1,'Sheet1!A1',repeat('b',64),'{}','{"period_month":"2026-09-01","cell_address":"A1","amount":null,"formula":"SUM(A2:A3)"}','valid');
 insert into zysyr_history_import_rows(id,company_id,store_id,import_batch_id,source_sheet,source_row_number,source_locator,row_hash,raw_json,mapped_json,validation_status)
 values('${id(7)}','${C}','${S}','${B}','Sheet1',1,'Sheet1!B1',repeat('d',64),'{}','{"period_month":"2026-09-01","cell_address":"B1","amount":1,"formula":"A1"}','valid'),
 ('${id(8)}','${C}','${S}','${B}','Sheet1',1,'Sheet1!C1',repeat('e',64),'{}','{"period_month":"2026-09-01","cell_address":"C1","amount":0,"formula":null}','valid');`);
 if(!authoritative) for(const file of ['20260906122116_zysyr_history_monthly_direct_evidence.sql','20260908023351_zysyr_monthly_cell_detail_workbench.sql','20260908171000_zysyr_monthly_detail_column_labels.sql','20260922093000_zysyr_history_item_evidence_upload.sql','20260922131500_zysyr_completed_history_monthly_attachments.sql']) sql('set check_function_bodies=off;'+fs.readFileSync('supabase/migrations/'+file,'utf8'));
 sql(fs.readFileSync('supabase/migrations/20261112062603_zysyr_history_reparse_fail_closed.sql','utf8'));
 if(authoritative){for(const f of require('./fixtures/history-authoritative/functions.json').filter(f=>f.schema_name==='public')){const types=f.identity_arguments.split(',').map(x=>x.trim().split(' ').slice(1).join(' ')).join(',');
 assert.equal(sql(`select has_function_privilege('service_role',${q('public.'+f.proname+'('+types+')')},'EXECUTE')`),'t',f.proname);
 assert.equal(sql(`select has_function_privilege('service_role',${q('zysyr_private.'+f.proname+'('+types+')')},'EXECUTE')`),'f',f.proname);
 }console.log('PASS: authoritative catalog baseline rebuilt with function body checking ON; all 14 real public history RPC signatures preserved and originals private.');}
 for(const table of ['zysyr_history_import_batches','zysyr_history_import_rows','zysyr_history_import_events','zysyr_history_import_evidence','zysyr_history_import_row_evidence','zysyr_history_ledger_entries','zysyr_history_ledger_revisions'])assert.equal(sql(`select has_table_privilege('service_role','public.${table}','INSERT,UPDATE,DELETE')`),'f',table);
 const state=()=>json(`set role service_role;select public.zysyr_history_reparse_state(${args});`);
 const st=state(),r=st.rows[0];
 const decisions=[{import_row_id:R,source_locator:r.source_locator,source_row_hash:r.row_hash,original_mapped:r.mapped_json,original_raw:r.raw_json,source_snapshot:{cell_address:'A1',cached_value:0,cache_present:true,formula:'SUM(A2:A3)',merged_master:null,shared_formula_reference:null},disposition:'include',effective_mapped:{...r.mapped_json,amount:0},validation_status:'valid',validation_issues:[],reason:'cached_zero'}];
 for(const r of st.rows.slice(1)) decisions.push({import_row_id:r.id,source_locator:r.source_locator,source_row_hash:r.row_hash,original_mapped:r.mapped_json,original_raw:r.raw_json,
 source_snapshot:{cell_address:r.mapped_json.cell_address,cached_value:1,cache_present:true,formula:'SUM(B2:B3)',merged_master:r.id===id(8)?'A1':null,shared_formula_reference:r.id===id(7)?'A1':null},
 disposition:r.id===id(8)?'exclude_merged_slave':'include',effective_mapped:r.id===id(8)?r.mapped_json:{...r.mapped_json,formula:'SUM(B2:B3)'},validation_status:'valid',validation_issues:[],reason:r.id===id(8)?'merged_slave':'shared_formula'});
 decisions[1].validation_status='warning';decisions[1].validation_issues=['Synthetic period coverage warning'];
 const call=(d=decisions,request=Req,token=st.state_fingerprint,reason='Synthetic repair')=>`set role service_role;select public.zysyr_history_reparse_apply(${args},${q(request)},${q(token)},${q('a'.repeat(64))},${q('c'.repeat(64))},${q(hash(d))},${q(reason)},${q(JSON.stringify(d))}::jsonb);`;
 fail(`set role anon;select public.zysyr_history_reparse_state(${args});`,/permission denied/);
 fail(`set role authenticated;select public.zysyr_history_reparse_state(${args});`,/permission denied/);
 fail(`begin;update zysyr_user_role_grants set revoked_at=now(),revoke_reason='Synthetic revocation';`+call(),/FINANCE_SCOPE_FORBIDDEN/);
 fail(call(decisions,Req,'stale'),/STATE_CHANGED/);
 const bad=structuredClone(decisions);bad[0].effective_mapped.amount=100;fail(call(bad),/AMOUNT_DENIED/);
 for(const mutate of [d=>d.pop(),d=>d.push(d[0]),d=>d[0].source_row_hash='f'.repeat(64),d=>d[1].source_snapshot.shared_formula_reference='wrong',d=>d[2].source_snapshot.merged_master='Z999']){
  const d=structuredClone(decisions);mutate(d);fail(call(d),/ROW_SET_INVALID|SOURCE_MISMATCH|FORMULA_DENIED|MERGE_INVALID/);
 }
 assert.equal(json(`set role service_role;select public.zysyr_history_reparse_status(${args},${q(Req)});`).status,'not_found');
 fail(`set role service_role;select public.zysyr_history_reparse_state(${[id(99),C,S,B].map(q).join(',')});`,/FORBIDDEN/);
 // An AFTER INSERT failure proves that generation, audit and receipt all roll back.
 sql("create function public.synthetic_generation_fail() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_ROLLBACK';end$$;create trigger synthetic_generation_fail after insert on zysyr_private.history_parse_generations for each row execute function public.synthetic_generation_fail();");
 fail(call(),/SYNTHETIC_ROLLBACK/);assert.equal(sql('select count(*) from zysyr_private.history_parse_generations'),'0');assert.deepEqual(state(),st);
 sql('drop trigger synthetic_generation_fail on zysyr_private.history_parse_generations;drop function public.synthetic_generation_fail();');
 sql("create function public.synthetic_generation_slow() returns trigger language plpgsql as $$begin perform pg_sleep(0.7);return new;end$$;create trigger synthetic_generation_slow before insert on zysyr_private.history_parse_generations for each row execute function public.synthetic_generation_slow();");
 const concurrent=input=>new Promise(resolve=>{const p=spawn('docker',['exec','-i',name,'psql','-X','-h','127.0.0.1','-U',dbUser,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});
 const applying=concurrent(call());await new Promise(r=>setTimeout(r,200));
 const competitors=[concurrent(call(decisions,id(90))),concurrent(`set role service_role;select public.zysyr_review_history_import_row(${[A,C,S,R].map(q).join(',')},'{}','confirmed','synthetic');`),concurrent(`set role service_role;select public.zysyr_post_history_import_batch(${args},true,'synthetic');`)];
 const applied=await applying;assert.equal(applied.code,0,applied.err);
 for(const competitor of competitors){const result=await competitor;assert.notEqual(result.code,0);assert.match(result.err,/STATE_CHANGED|VERSION_REQUIRED/);}
 sql('drop trigger synthetic_generation_slow on zysyr_private.history_parse_generations;drop function public.synthetic_generation_slow();');
 const result=JSON.parse(applied.out.split('\n').find(x=>x.startsWith('{')));assert.equal(result.effective_count,2);assert.equal(result.excluded_count,1);assert.equal(result.formal_ledger_written,false);
 assert.deepEqual(json(call()),result);fail(call(decisions,Req,st.state_fingerprint,'different'),/REQUEST_REUSED/);
 assert.equal(state().active_generation.decisions.length,3);
 const status=json(`set role service_role;select public.zysyr_history_reparse_status(${args},${q(Req)});`);assert.equal(status.status,'committed');assert.deepEqual(status.receipt,result);
 fail(`set role service_role;select * from zysyr_private.history_parse_generations;`,/permission denied/);
 fail('update zysyr_private.history_parse_generations set reason=reason;',/IMMUTABLE|append|mutation/i);
 for(const fn of [`zysyr_confirm_history_import(${args},'synthetic')`,`zysyr_confirm_history_import_month(${args},'2026-09-01','synthetic')`,`zysyr_post_history_import_batch(${args},true,'synthetic')`,`zysyr_review_history_import_row(${[A,C,S,R].map(q).join(',')},'{}','confirmed','synthetic')`])fail('set role service_role;select public.'+fn+';',/VERSION_REQUIRED/);
 assert.equal(sql('select count(*) from zysyr_history_ledger_entries'),'0');assert.equal(sql('select count(*) from zysyr_history_import_rows'),'3');assert.deepEqual(state().rows,st.rows);
 // Reverse ordering on a fresh batch: committed human work must win.
 const B2=id(91),R2=id(92),args2=[A,C,S,B2].map(q).join(',');
 sql(`insert into zysyr_history_import_batches select (jsonb_populate_record(null::zysyr_history_import_batches,to_jsonb(b)||jsonb_build_object('id','${B2}','source_sha256',repeat('f',64),'raw_row_count',1,'valid_row_count',1))).* from zysyr_history_import_batches b where id='${B}';
 insert into zysyr_history_import_rows select (jsonb_populate_record(null::zysyr_history_import_rows,to_jsonb(r)||jsonb_build_object('id','${R2}','import_batch_id','${B2}'))).* from zysyr_history_import_rows r where id='${R}';`);
 const beforeReview=json(`set role service_role;select public.zysyr_history_reparse_state(${args2});`);
 const d2=[{...decisions[0],import_row_id:R2}];
 const reviewFirst=concurrent(`begin;set role service_role;select public.zysyr_review_history_import_row(${[A,C,S,R2].map(q).join(',')},'{"cell_address":"A1","amount":123,"formula":"SUM(A2:A3)"}','confirmed','Synthetic human decision');select pg_sleep(0.7);commit;`);
 await new Promise(r=>setTimeout(r,200));
 const reparseSecond=concurrent(`set role service_role;select public.zysyr_history_reparse_apply(${args2},${q(id(93))},${q(beforeReview.state_fingerprint)},${q('f'.repeat(64))},${q('c'.repeat(64))},${q(hash(d2))},'Synthetic retry',${q(JSON.stringify(d2))}::jsonb);`);
 const reviewed=await reviewFirst;assert.equal(reviewed.code,0,reviewed.err);
 const rejected=await reparseSecond;assert.notEqual(rejected.code,0);assert.match(rejected.err,/STATE_CHANGED|NOT_PRISTINE|PRIOR_ACTIVITY/);
 assert.equal(sql(`select review_status||':'||(corrected_json->>'amount') from zysyr_history_import_rows where id='${R2}'`),'confirmed:123');
 assert.equal(sql(`select count(*) from zysyr_private.history_parse_generations where batch_id='${B2}'`),'0');
 assert.equal(sql(`select count(*) from zysyr_history_import_events where import_batch_id='${B2}' and action='row_review'`),'1');
 await require('./test-history-generation-finance-db.cjs')({sql,json,fail,q,id,C,S,A,B,R,Req,args,state,st,decisions,hash,concurrent,loadFunction});
 await require('./test-history-generation-adjustments-db.cjs')({sql,json,fail,q,id,C,S,A,B,R,args,concurrent});
 await require('./test-history-source-provenance-db.cjs')({sql,json,fail,q,id,C,S,A,B,hash});
 console.log('PASS: review-first/apply preserves committed human correction; concurrent apply/apply, apply/review, apply/post; AFTER INSERT fault rollback; merged exclusion/shared formula; isolated schema install, scope denial, ACLs, stale preview, amount denial, cached-zero, replay/status, append-only, old review/month/confirm/post gates, original row and zero-ledger retention.');
 }finally{if(created)docker(['rm','-f',name]);}})().catch(e=>{console.error(e.stderr?.toString()||e);process.exitCode=1});
