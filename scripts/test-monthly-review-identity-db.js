// Disposable synthetic PostgreSQL only; no production access or real identities.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const name='zysyr-review-identity-'+process.pid+'-'+Date.now();
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=text=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],
  {input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let checks=0;
function equal(actual,expected){assert.equal(actual,expected);checks++}
function denied(query,pattern){assert.throws(()=>sql(query),error=>pattern.test(String(error.stderr)));checks++}
const resolve=(account=null,staff=null,store=2,company=1)=>`select zysyr_monthly_review_identity('${id(company)}','${id(store)}',${account===null?'null':"'"+id(account)+"'"},${staff===null?'null':staff});`;
const recipients=(store=2,company=1)=>`select count(*) from zysyr_private.monthly_review_recipients('${id(company)}','${id(store)}');`;
async function run(){
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(r=>setTimeout(r,500))}}
    sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema zysyr_private;
      create table zysyr_companies(id uuid primary key);
      create table zysyr_stores(company_id uuid,id uuid,status text,primary key(company_id,id));
      create table staff(id integer primary key,username text,active boolean,employment_status text);
      create table staff_report_grants(staff_id integer,store_id uuid,primary key(staff_id,store_id));
      create table zysyr_user_accounts(company_id uuid,id uuid,status text,display_name text,primary key(company_id,id));
      create table zysyr_roles(id uuid primary key,code text);
      create table zysyr_user_role_grants(company_id uuid,user_account_id uuid,role_id uuid,scope_type text,store_id uuid,valid_from date,valid_to date,revoked_at timestamptz);
      insert into zysyr_companies values('${id(1)}'),('${id(9)}');
      insert into zysyr_stores values('${id(1)}','${id(2)}','active'),('${id(1)}','${id(3)}','active'),('${id(9)}','${id(8)}','active');
      insert into staff values(10,'Owner',true,'active'),(11,'Owner',true,'active');
      insert into staff_report_grants values(10,'${id(2)}'),(11,'${id(2)}');
      insert into zysyr_user_accounts values('${id(1)}','${id(4)}','active','Owner'),('${id(1)}','${id(5)}','active','Owner'),('${id(9)}','${id(6)}','active','Other');
      insert into zysyr_roles values('${id(7)}','shareholder');
      insert into zysyr_user_role_grants values('${id(1)}','${id(4)}','${id(7)}','company',null,'2020-01-01',null,null),('${id(1)}','${id(5)}','${id(7)}','store','${id(2)}','2020-01-01',null,null);
      grant usage on schema public,zysyr_private to service_role;
      grant select on all tables in schema public to service_role;
    `);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013130139_zysyr_monthly_review_identity.sql'),'utf8'));
    equal(sql(recipients()),'4'); // Same names must NOT merge without explicit authorization.
    sql(`insert into zysyr_monthly_review_identity_links values('${id(1)}',10,'${id(4)}','Owner explicitly confirmed both entrances',now());`);
    equal(sql(recipients()),'3');
    equal(sql(resolve(4)),sql(resolve(null,10)));
    equal(sql(resolve(null,11)),'staff:11');
    equal(sql(resolve(5)),'account:'+id(5));
    equal(sql(resolve(4,null,3)),'account:'+id(4));
    denied(resolve(null,10,3),/MONTHLY_REVIEW_STAFF_DENIED/); // No account scope inheritance.
    denied(resolve(5,null,3),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    denied(resolve(4,10),/MONTHLY_REVIEW_IDENTITY_INVALID/);
    denied(resolve(),/MONTHLY_REVIEW_IDENTITY_INVALID/);
    denied(resolve(4,null,8),/MONTHLY_REVIEW_STORE_DENIED/);
    denied(resolve(4,null,8,9),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    equal(sql(recipients(8,1)),'0');
    equal(sql(recipients(8,9)),'0');
    sql('update staff set active=false where id=10;');
    denied(resolve(null,10),/MONTHLY_REVIEW_STAFF_DENIED/);
    equal(sql(resolve(4)),'account:'+id(4));
    sql("update staff set active=true,employment_status='departed' where id=10;");
    denied(resolve(null,10),/MONTHLY_REVIEW_STAFF_DENIED/);
    sql("update staff set employment_status='active' where id=10;");
    sql(`delete from staff_report_grants where staff_id=10;`);
    denied(resolve(null,10),/MONTHLY_REVIEW_STAFF_DENIED/);
    sql(`insert into staff_report_grants values(10,'${id(2)}');update zysyr_user_accounts set status='suspended' where id='${id(4)}';`);
    denied(resolve(4),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    equal(sql(resolve(null,10)),'account:'+id(4)); // Identity stable; this login still authorized.
    sql(`update zysyr_user_accounts set status='active' where id='${id(4)}';update zysyr_user_role_grants set revoked_at=now() where user_account_id='${id(4)}';`);
    denied(resolve(4),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    sql(`update zysyr_user_role_grants set revoked_at=null,valid_from=current_date+2 where user_account_id='${id(4)}';`);
    denied(resolve(4),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    sql(`update zysyr_user_role_grants set valid_from='2020-01-01',valid_to=current_date-2 where user_account_id='${id(4)}';`);
    denied(resolve(4),/MONTHLY_REVIEW_ACCOUNT_DENIED/);
    sql(`update zysyr_user_role_grants set valid_to=null where user_account_id='${id(4)}';`);
    equal(sql('set role service_role;'+resolve(null,10)).split('\n').at(-1),'account:'+id(4));
    for(const role of ['anon','authenticated']){
      denied(`set role ${role};select * from zysyr_monthly_review_identity_links;`,/permission denied/);
      denied(`set role ${role};${resolve(4)}`,/permission denied/);
      denied(`set role ${role};${recipients()}`,/permission denied/);
    }
    denied("update zysyr_monthly_review_identity_links set reason='change identity';",/MONTHLY_REVIEW_IDENTITY_IMMUTABLE/);
    denied('delete from zysyr_monthly_review_identity_links;',/MONTHLY_REVIEW_IDENTITY_IMMUTABLE/);
    denied(`set role service_role;insert into zysyr_monthly_review_identity_links values('${id(1)}',11,'${id(5)}','not authorized mapping',now());`,/permission denied/);
    denied(`insert into zysyr_monthly_review_identity_links values('${id(1)}',11,'${id(6)}','wrong company account mapping',now());`,/foreign key/);
    denied(`insert into zysyr_monthly_review_identity_links values('${id(1)}',11,'${id(4)}','duplicate account mapping',now());`,/unique constraint/);
    equal(sql('select count(*) from zysyr_monthly_review_identity_links;'),'1');
    equal(sql("select count(*) from zysyr_stores;"),'3');
    equal(sql("select count(*) from zysyr_user_role_grants;"),'2');
    equal(sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='zysyr_monthly_review_identity_links'::regclass;"),'t');
    console.log(`monthly review identity: ${checks} synthetic PostgreSQL checks passed`);
  }finally{docker(['rm','-f','-v',name]);} // Only this test-created container/volume.
}
run().catch(error=>{console.error(error.message);if(error.stderr)console.error(error.stderr);process.exitCode=1});
