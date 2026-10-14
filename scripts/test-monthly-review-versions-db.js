// Synthetic PG17 only. No network, credentials, production identities or amounts.
const {execFileSync,execFile}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const name='zysyr-review-versions-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
// TCP becomes ready only after the Docker entrypoint's temporary init server
// has stopped; its Unix socket can accept a query just before shutting down.
const args=['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-Atq'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const asyncSQL=text=>new Promise((resolve,reject)=>{const child=execFile('docker',args,{encoding:'utf8'},(error,out,stderr)=>{
  if(error){error.stderr=stderr;reject(error)}else resolve(out.trim());});child.stdin.end(text);});
function holdingMonthLock(tail){
  let ready;const locked=new Promise(r=>{ready=r;});
  const done=new Promise((resolve,reject)=>{const child=execFile('docker',args,{encoding:'utf8'},(error,out,stderr)=>{
    if(error){error.stderr=stderr;reject(error)}else resolve(out.trim());});
    child.stdout.on('data',text=>{if(String(text).includes('LOCKED'))ready();});
    child.stdin.end(`begin;select pg_advisory_xact_lock(hashtextextended('${id(1)}:${id(2)}:2026-01-01',0));select 'LOCKED';select pg_sleep(1);${tail}commit;`);
  });return {locked,done};
}
const file=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
function existingFunction(filename,fn){const text=file(filename);const start=text.indexOf('create or replace function '+fn+'(');
  assert(start>=0,fn);const end=text.indexOf('$$;',start);assert(end>start);return text.slice(start,end+3);}
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const lit=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
const j=v=>lit(JSON.stringify(v))+'::jsonb';
let checks=0;
function equal(a,b){assert.deepEqual(a,b);checks++;}
function ok(v){assert.ok(v);checks++;}
function denied(query,re){assert.throws(()=>sql(query),e=>re.test(String(e.stderr)));checks++;}
const token=(store=2,month='2026-01-01')=>`zysyr_monthly_review_source_token('${id(1)}','${id(store)}','${month}')`;
const snapshot=(amount=100,store=2,month='2026-01')=>({schema_version:1,store_id:id(store),month,
  report:{source_id:id(20+store),display_data:{values:[['Income',amount],['Expense',30]]}},daily_performance:{rows:[]}});
const publish=(snap=snapshot(),expected=null,actor=6,source=null,store=2,month='2026-01-01')=>
  `select zysyr_publish_monthly_review('${id(actor)}','${id(1)}','${id(store)}','${month}',${j(snap)},${source?lit(source):token(store,month)},${lit(expected)});`;
const confirm=(pub,{account=4,staff=null,snap=snapshot(),source=null,hash=pub.content_hash,statement='reviewed_no_objection_v1',store=2}={})=>
  `select zysyr_confirm_monthly_review('${id(1)}','${id(store)}','${pub.id}',${lit(hash)},${j(snap)},${source?lit(source):token(store)},${lit(statement)},${account===null?'null':lit(id(account))},${staff??'null'});`;
const inbox=(account=4,staff=null,store=2)=>`select zysyr_monthly_review_inbox('${id(1)}','${id(store)}',${account===null?'null':lit(id(account))},${staff??'null'});`;
const status=(account=4,staff=null,finance=false,store=2)=>`select zysyr_monthly_review_status('${id(1)}','${id(store)}','2026-01-01',${account===null?'null':lit(id(account))},${staff??'null'},${finance});`;
const service=query=>'set role service_role;'+query;
const json=query=>JSON.parse(sql(service(query)));
const count=table=>sql('select count(*) from '+table);
async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try{
    let ready=false;for(let i=0;i<80;i++){try{sql('select 1');ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}assert(ready);
    sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema zysyr_private;
      create table zysyr_companies(id uuid primary key,status text);
      create table zysyr_stores(company_id uuid,id uuid,status text,deleted_at timestamptz,primary key(company_id,id));
      create table staff(id integer primary key,username text,active boolean,employment_status text);
      create table staff_report_grants(staff_id integer,store_id uuid,primary key(staff_id,store_id));
      create table zysyr_user_accounts(company_id uuid,id uuid,status text,display_name text,primary key(company_id,id));
      create table zysyr_roles(id uuid primary key,code text);
      create table zysyr_user_role_grants(company_id uuid,user_account_id uuid,role_id uuid,scope_type text,store_id uuid,valid_from date,valid_to date,revoked_at timestamptz);
      create table zysyr_capabilities(id uuid primary key,code text);
      create table zysyr_role_capabilities(role_id uuid,capability_id uuid);
      create table zysyr_user_capability_grants(company_id uuid,user_account_id uuid,capability_id uuid,scope_type text,store_id uuid,valid_from date,valid_to date,revoked_at timestamptz);
      create table zysyr_report_uploads(id uuid primary key,company_id uuid,store_id uuid,report_type text,report_date date,status text,display_data jsonb);
      create table zysyr_report_cells(id uuid primary key,company_id uuid,store_id uuid,report_id uuid,numeric_value numeric);
      create table zysyr_monthly_cell_revisions(id uuid primary key,company_id uuid,store_id uuid,report_id uuid,after_amount numeric);
      create table zysyr_monthly_text_revisions(id uuid primary key,company_id uuid,store_id uuid,report_id uuid,after_text text);
      create table zysyr_monthly_income_adjustments(id uuid primary key,company_id uuid,store_id uuid,period_month date,after_amount numeric);
      create table zysyr_history_ledger_entries(id uuid primary key,company_id uuid,store_id uuid,period_month date,entry_type text,status text,import_batch_id uuid,current_payload jsonb);
      create table zysyr_history_import_batches(id uuid primary key,company_id uuid,store_id uuid,status text,source_sha256 text);
      create table zysyr_daily_sheet_drafts(id uuid primary key,company_id uuid,store_id uuid,report_date date,edit_revision integer,status text,confirmed_at timestamptz);
      create table zysyr_daily_sheet_cells(id uuid primary key,company_id uuid,store_id uuid,draft_id uuid,section_code text,column_code text,row_key text,cell_role text,ocr_numeric numeric,corrected_numeric numeric,manual_override boolean);
      create table zysyr_report_acknowledgements(id uuid,acknowledged_at timestamptz);
      insert into zysyr_companies values('${id(1)}','active'),('${id(9)}','active');
      insert into zysyr_stores values('${id(1)}','${id(2)}','active',null),('${id(1)}','${id(3)}','active',null),('${id(9)}','${id(8)}','active',null);
      insert into staff values(10,'Owner',true,'active'),(11,'Reader',true,'active');
      insert into staff_report_grants values(10,'${id(2)}'),(10,'${id(3)}');
      insert into zysyr_user_accounts values('${id(1)}','${id(4)}','active','Owner'),('${id(1)}','${id(5)}','active','Reader'),('${id(1)}','${id(6)}','active','Finance');
      insert into zysyr_roles values('${id(7)}','shareholder'),('${id(17)}','finance');
      insert into zysyr_user_role_grants values
        ('${id(1)}','${id(4)}','${id(7)}','company',null,'2020-01-01',null,null),
        ('${id(1)}','${id(5)}','${id(7)}','store','${id(2)}','2020-01-01',null,null),
        ('${id(1)}','${id(6)}','${id(17)}','company',null,'2020-01-01',null,null);
      insert into zysyr_capabilities values('${id(18)}','report.upload');
      insert into zysyr_role_capabilities values('${id(17)}','${id(18)}');
      insert into zysyr_report_uploads values('${id(22)}','${id(1)}','${id(2)}','monthly_profit_loss','2026-01-01','active','{}'),('${id(23)}','${id(1)}','${id(3)}','monthly_profit_loss','2026-01-01','active','{}');
      insert into zysyr_report_cells values('${id(30)}','${id(1)}','${id(2)}','${id(22)}',100);
      insert into zysyr_report_acknowledgements values('${id(31)}','2026-01-05T12:00:00Z');
      grant usage on schema public to service_role;
      grant usage on schema zysyr_private to authenticated;
      grant select on all tables in schema public to service_role;`);
    sql(existingFunction('20260820095920_zysyr_sprint1_employee_store_management.sql','zysyr_private.account_has_capability')
      +existingFunction('20260820102856_zysyr_sprint2_voucher_center.sql','zysyr_private.account_is_finance_in_scope')
      +existingFunction('20260820112615_zysyr_sprint3_finance_foundation.sql','zysyr_private.assert_finance_scope'));
    sql('revoke all on all functions in schema zysyr_private from public,anon,authenticated,service_role;');
    sql(file('20261013130139_zysyr_monthly_review_identity.sql'));
    sql(`insert into zysyr_monthly_review_identity_links values('${id(1)}',10,'${id(4)}','Synthetic explicit owner identity',now());`);
    sql(file('20261013143641_zysyr_monthly_review_versions.sql'));
    denied(service(inbox()),/permission denied for schema zysyr_private/);
    const existingACL=sql("select jsonb_agg(jsonb_build_array(oid,proacl) order by oid) from pg_proc where pronamespace='zysyr_private'::regnamespace;");
    sql(file('20261014014800_zysyr_monthly_review_service_namespace.sql'));
    equal(sql("select jsonb_agg(jsonb_build_array(oid,proacl) order by oid) from pg_proc where pronamespace='zysyr_private'::regnamespace;"),existingACL);
    denied(service('select zysyr_private.assert_finance_scope(null,null,null,null);'),/permission denied/);
    equal(count('zysyr_monthly_review_publications'),'0');equal(count('zysyr_monthly_review_receipts'),'0');
    equal(json(inbox()).count,0);equal(json(status()).publication,null);
    const before=sql(`select jsonb_build_array((select jsonb_agg(to_jsonb(r)) from zysyr_report_uploads r),(select jsonb_agg(to_jsonb(c)) from zysyr_report_cells c),(select jsonb_agg(to_jsonb(a)) from zysyr_report_acknowledgements a));`);
    denied(service(publish(snapshot(),null,4)),/FINANCE_SCOPE_FORBIDDEN/);
    denied(service(publish(snapshot(),null,5)),/FINANCE_SCOPE_FORBIDDEN/);
    denied(service(publish({...snapshot(),month:'2026-02'})),/SNAPSHOT_INVALID/);
    denied(service(publish({...snapshot(),store_id:id(3)})),/SNAPSHOT_INVALID/);
    denied(service(publish({schema_version:1,store_id:id(2),month:'2026-01',report:{display_data:{values:[]}}})),/SNAPSHOT_EMPTY/);
    denied(service(publish(snapshot(100,2,'2026-02'),null,6,null,2,'2026-02-01')),/REPORT_MISSING/);
    denied(service(publish(snapshot(),null,6,'a'.repeat(64))),/SOURCE_CHANGED/);
    const pub=json(publish());equal(pub.version,1);equal(pub.created,true);equal(pub.added_recipients,2);
    const duplicate=json(publish());equal(duplicate.id,pub.id);equal(duplicate.created,false);equal(duplicate.added_recipients,0);
    equal(count('zysyr_monthly_review_recipients'),'2');equal(json(inbox()).count,1);equal(json(inbox(null,10)).count,1);
    equal(json(inbox(5)).count,1);equal(json(inbox(4,null,3)).count,0);
    const view=json(status());equal(view.assigned,true);equal(view.receipt,null);equal(view.recipients,undefined);equal(view.publication.snapshot,snapshot());
    equal(json(status(6,null,true)).recipients.length,2);
    denied(service(status(4,null,true)),/FINANCE_SCOPE_FORBIDDEN/);
    denied(service(status(null,10,true)),/FINANCE_REQUIRED/);
    denied(service(status(5,null,false,3)),/ACCOUNT_DENIED/);
    denied(service(confirm(pub,{statement:'read'})),/CONSENT_REQUIRED/);
    denied(service(confirm(pub,{hash:'a'.repeat(64)})),/CONTENT_CHANGED/);
    denied(service(confirm(pub,{store:3})),/PUBLICATION_NOT_FOUND/);
    denied(service(confirm(pub,{account:4,staff:10})),/IDENTITY_INVALID/);
    denied(service(confirm(pub,{account:6})),/ACCOUNT_DENIED/);
    denied(service(confirm(pub,{snap:snapshot(101)})),/REPUBLICATION_REQUIRED/);
    denied(service(confirm(pub,{source:'a'.repeat(64)})),/SOURCE_CHANGED/);
    // Two entrances and concurrent clicks produce ONE immutable receipt.
    const results=await Promise.all(Array.from({length:8},(_,i)=>asyncSQL(service(confirm(pub,i%2?{account:null,staff:10}:{}))).then(JSON.parse)));
    equal(new Set(results.map(r=>r.id)).size,1);equal(results.filter(r=>r.created).length,1);
    equal(new Set(results.map(r=>r.confirmed_at)).size,1);equal(count('zysyr_monthly_review_receipts'),'1');
    equal(json(inbox()).count,0);equal(json(inbox(null,10)).count,0);equal(json(inbox(5)).count,1);
    equal(json(status()).receipt.id,results[0].id);equal(json(status(null,10)).receipt.id,results[0].id);
    const second=json(confirm(pub,{account:5}));equal(second.created,true);
    equal(json(status(6,null,true)).recipients.filter(r=>r.confirmed_at).length,2);
    // New content never inherits old receipts. A stale publisher cannot roll back.
    denied(service(publish(snapshot(101))),/VERSION_CHANGED/);
    const pub2=json(publish(snapshot(101),pub.id));equal(pub2.version,2);equal(json(inbox()).count,1);
    equal(json(status()).receipt,null);equal(json(status()).history.length,2);
    equal(json(status()).history[1].my_confirmed_at,results[0].confirmed_at);
    equal(json(confirm(pub)).id,results[0].id);equal(json(inbox()).count,1); // Lost reply doesn't confirm v2.
    denied(service(confirm(pub2)),/REPUBLICATION_REQUIRED/);
    // Newly granted reader is not silently asserted/added by merely opening App.
    sql(`insert into staff_report_grants values(11,'${id(2)}');`);
    equal(json(status(null,11)).assigned,false);equal(json(inbox(null,11)).count,0);
    denied(service(confirm(pub2,{account:null,staff:11,snap:snapshot(101)})),/RECIPIENT_REQUIRED/);
    const republish=json(publish(snapshot(101),pub2.id));equal(republish.id,pub2.id);equal(republish.added_recipients,1);
    equal(json(inbox(null,11)).count,1);
    denied(service(confirm(pub,{account:null,staff:11})),/VERSION_CHANGED/);
    const owner2=json(confirm(pub2,{snap:snapshot(101)}));equal(owner2.created,true);
    equal(json(status()).history[1].my_confirmed_at,results[0].confirmed_at);
    // Live revocation applies to reads AND repeated confirmation readback.
    sql("update staff set employment_status='departed' where id=10;");
    denied(service(inbox(null,10)),/STAFF_DENIED/);denied(service(confirm(pub2,{account:null,staff:10,snap:snapshot(101)})),/STAFF_DENIED/);
    equal(json(status()).receipt.id,owner2.id);
    sql("update staff set employment_status='active' where id=10;");
    sql(`update zysyr_user_role_grants set revoked_at=now() where user_account_id='${id(5)}';`);
    denied(service(inbox(5)),/ACCOUNT_DENIED/);denied(service(status(5)),/ACCOUNT_DENIED/);
    equal(json(status(6,null,true)).recipients.find(r=>r.person_key==='account:'+id(5)).access_active,false);
    sql(`update zysyr_user_role_grants set revoked_at=null where user_account_id='${id(5)}';`);
    sql(`update zysyr_companies set status='inactive' where id='${id(1)}';`);
    denied(service(inbox()),/STORE_DENIED/);denied(service(status()),/STORE_DENIED/);
    denied(service(confirm(pub2,{snap:snapshot(101)})),/STORE_DENIED/);
    sql(`update zysyr_companies set status='active';update zysyr_stores set deleted_at=now() where id='${id(2)}';`);
    denied(service(inbox(null,10)),/STORE_DENIED/);denied(service(publish(snapshot(102),pub2.id)),/STORE_DENIED/);
    sql('update zysyr_stores set deleted_at=null;');
    // A grant revoked while this request waits for the month lock is not usable.
    const held=holdingMonthLock(`update zysyr_user_role_grants set revoked_at=now() where user_account_id='${id(5)}';`);
    await held.locked;
    await assert.rejects(asyncSQL(service(confirm(pub2,{account:5,snap:snapshot(101)}))),e=>/ACCOUNT_DENIED/.test(e.stderr));checks++;
    await held.done;sql(`update zysyr_user_role_grants set revoked_at=null where user_account_id='${id(5)}';`);
    // Expiry, finance capabilities, source scope and source freshness fail closed.
    sql(`update zysyr_user_role_grants set valid_to=current_date-2 where user_account_id='${id(6)}';`);
    denied(service(publish(snapshot(102),pub2.id)),/FINANCE_SCOPE_FORBIDDEN/);
    sql(`update zysyr_user_role_grants set valid_to=null where user_account_id='${id(6)}';delete from zysyr_role_capabilities;`);
    denied(service(publish(snapshot(102),pub2.id)),/FINANCE_SCOPE_FORBIDDEN/);
    sql(`insert into zysyr_role_capabilities values('${id(17)}','${id(18)}');`);
    const source1=sql('select '+token()+';');
    equal(sql("set timezone='Asia/Shanghai';select "+token()+';'),source1);
    sql(`insert into zysyr_monthly_income_adjustments values('${id(35)}','${id(1)}','${id(2)}','2026-01-01',102);`);
    ok(source1!==sql('select '+token()+';'));
    denied(service(publish(snapshot(102),pub2.id,6,source1)),/SOURCE_CHANGED/);
    denied(service(confirm(pub2,{account:5,snap:snapshot(101),source:source1})),/SOURCE_CHANGED/);
    sql('delete from zysyr_monthly_income_adjustments;');
    equal(sql('select '+token()+';'),source1);
    // Each monthly dependency changes the token, unrelated stores and drafts do not.
    const scoped=(table,values,where='')=>{
      const original=sql('select '+token()+';');sql(`insert into ${table} values(${values});`);
      ok(sql('select '+token()+';')!==original);sql(`delete from ${table}${where};`);equal(sql('select '+token()+';'),original);
    };
    scoped('zysyr_monthly_cell_revisions',`'${id(36)}','${id(1)}','${id(2)}','${id(22)}',103`);
    scoped('zysyr_monthly_text_revisions',`'${id(37)}','${id(1)}','${id(2)}','${id(22)}','Corrected label'`);
    sql(`insert into zysyr_history_import_batches values('${id(40)}','${id(1)}','${id(2)}','completed','hash');`);
    scoped('zysyr_history_ledger_entries',`'${id(41)}','${id(1)}','${id(2)}','2026-01-01','monthly_profit_loss','posted','${id(40)}','{"amount":104}'`);
    sql(`insert into zysyr_daily_sheet_drafts values('${id(45)}','${id(1)}','${id(2)}','2026-01-10',1,'draft',null);`);
    equal(sql('select '+token()+';'),source1);
    sql(`update zysyr_daily_sheet_drafts set status='confirmed',confirmed_at=now();`);
    ok(sql('select '+token()+';')!==source1);
    scoped('zysyr_daily_sheet_cells',`'${id(46)}','${id(1)}','${id(2)}','${id(45)}','payment','cash_flow','payment','payment_cashflow',100,0,true`);
    sql(`delete from zysyr_daily_sheet_drafts;insert into zysyr_monthly_income_adjustments values('${id(47)}','${id(1)}','${id(3)}','2026-01-01',200);`);
    equal(sql('select '+token()+';'),source1);sql('delete from zysyr_monthly_income_adjustments;');
    denied(service(`select zysyr_monthly_review_source_token('${id(1)}','${id(8)}','2026-01-01');`),/STORE_DENIED/);
    denied(service(`select zysyr_monthly_review_source_token('${id(1)}','${id(2)}','2026-01-02');`),/MONTH_INVALID/);
    // Concurrent publication retries create one version and one recipient set.
    const pubs=await Promise.all(Array.from({length:6},()=>asyncSQL(service(publish(snapshot(200,3),null,6,null,3))).then(JSON.parse)));
    equal(new Set(pubs.map(p=>p.id)).size,1);equal(pubs.filter(p=>p.created).length,1);
    const p3=pubs[0];equal(p3.version,1);
    sql(`delete from staff_report_grants where store_id='${id(3)}';update zysyr_user_role_grants set revoked_at=now() where user_account_id='${id(4)}';`);
    denied(service(publish(snapshot(201,3),p3.id,6,null,3)),/NO_RECIPIENTS/);
    sql(`insert into staff_report_grants values(10,'${id(3)}');update zysyr_user_role_grants set revoked_at=null where user_account_id='${id(4)}';`);
    // Rollback leaves no publication, recipient or pending task.
    const originalCount=count('zysyr_monthly_review_publications');
    sql('begin;'+service(publish(snapshot(202,3),p3.id,6,null,3))+'rollback;');
    equal(count('zysyr_monthly_review_publications'),originalCount);
    equal(json(inbox(4,null,3)).pending[0].id,p3.id);
    // Finance re-publishes while an unconfirmed shareholder is waiting: that
    // request must not attach an old-screen confirmation to the new version.
    const newer=holdingMonthLock(publish(snapshot(102),pub2.id));await newer.locked;
    await assert.rejects(asyncSQL(service(confirm(pub2,{account:5,snap:snapshot(101)}))),e=>/VERSION_CHANGED/.test(e.stderr));checks++;
    await newer.done;
    equal(json(status()).publication.version,3);equal(json(status()).receipt,null);
    equal(json(status()).history[1].my_confirmed_at,owner2.confirmed_at);
    equal(json(inbox()).count,1);
    // Append-only protections and no direct service mutation.
    for(const table of ['zysyr_monthly_review_publications','zysyr_monthly_review_recipients','zysyr_monthly_review_receipts']){
      for(const role of ['anon','authenticated'])denied(`set role ${role};select * from ${table};`,/permission denied/);
      denied(service(`delete from ${table};`),/permission denied/);
      denied(`delete from ${table};`,/RECORD_IMMUTABLE/);
      equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid='${table}'::regclass;`),'t');
    }
    denied(`update zysyr_monthly_review_publications set version=100;`,/RECORD_IMMUTABLE/);
    denied(`update zysyr_monthly_review_receipts set confirmed_at=now();`,/RECORD_IMMUTABLE/);
    denied(`update zysyr_monthly_review_recipients set display_name='changed';`,/RECORD_IMMUTABLE/);
    denied(service(`insert into zysyr_monthly_review_receipts(company_id,store_id,publication_id,person_key,actor_user_account_id) values('${id(1)}','${id(2)}','${pub2.id}','account:${id(5)}','${id(5)}');`),/permission denied/);
    for(const role of ['anon','authenticated'])for(const query of [publish(),confirm(pub),inbox(),status(),'select '+token()+';'])denied(`set role ${role};${query}`,/permission denied/);
    // Catalog-based local advisor checks cover all new public and private entry points.
    equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%monthly_review%' and n.nspname in ('public','zysyr_private') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));`),'0');
    equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%monthly_review%' and n.nspname='public' and p.prosecdef;`),'0');
    const after=sql(`select jsonb_build_array((select jsonb_agg(to_jsonb(r)) from zysyr_report_uploads r),(select jsonb_agg(to_jsonb(c)) from zysyr_report_cells c),(select jsonb_agg(to_jsonb(a)) from zysyr_report_acknowledgements a));`);
    equal(after,before);equal(count('zysyr_report_acknowledgements'),'1');
    console.log(`monthly review versions: ${checks} synthetic PostgreSQL checks passed`);
  }finally{docker(['rm','-f','-v',name]);} // Only the test-created container and its volumes.
}
run().catch(e=>{console.error(e.stack);if(e.stderr)console.error(e.stderr);process.exitCode=1;});
