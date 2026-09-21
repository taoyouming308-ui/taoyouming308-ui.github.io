#!/usr/bin/env node
// Real PostgreSQL ACL/transaction tests; synthetic accounts only, no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { execFileSync } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const container = `zysyr-staff-access-${process.pid}-${Date.now()}`;
const docker = args => execFileSync('docker', args, {encoding:'utf8'});
const sql = input => execFileSync('docker', ['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'], {input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const q = s => "'" + String(s).replaceAll("'","''") + "'";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const shared = fs.readFileSync('supabase/functions/_shared/staff-report-access.ts','utf8');
const operations = fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const token = '11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';

async function edgeTests() {
  let storeAccess = [id(1)], active = true, sessionValid = true, sessionStore = '甲店', mode = 'read';
  const calls = [];
  const hash = async s => Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
  const read = async path => {
    calls.push(path);
    if(path.startsWith('employee_booking_sessions?')) return sessionValid?[{username:'只读股东',store:sessionStore,expires_at:'2099-01-01'}]:[];
    if(path.startsWith('staff?')) return [{id:3,username:'只读股东',store:'甲店',active,employment_status:'active'}];
    if(path.startsWith('staff_report_grants?')) return storeAccess.map(store_id=>({store_id}));
    if(path.startsWith('zysyr_stores?')) return storeAccess.map((store_id,i)=>({id:store_id,company_id:id(9),name:i?'乙店':'甲店'}));
    throw new Error('Unexpected read '+path);
  };
  const context = vm.createContext({console,Request,Response,TextEncoder,crypto:webcrypto,Date,
    fetch:async (url,opts={})=>{
      if(mode==='deny')throw Error('must reject before database access');
      assert.equal(opts.method||'GET','GET','read-only report session cannot write');
      return new Response(JSON.stringify(await read(String(url).split('/rest/v1/')[1])),{status:200});
    }, Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.local':'synthetic-service-key'},serve:fn=>{context.handler=fn;}}});
  vm.runInContext(stripTypeScriptTypes(shared.replaceAll('export ','')),context);
  vm.runInContext(stripTypeScriptTypes(operations.replace(/^import .*;\n/gm,'')),context);
  const post = async payload => context.handler(new Request('https://test.local',{method:'POST',body:JSON.stringify(payload)}));
  let r=await post({operation:'session',employee_session_token:token});
  assert.equal(r.status,200);const user=(await r.json()).user;
  assert.deepEqual(user.stores,['甲店']);assert.equal(user.can_read_daily_reports,true);
  for(const flag of ['can_write_expense','can_upload_reports','can_upload_vouchers','can_manage_payroll','can_manage_finance_accounts','can_manage_stores','can_import_photo_reports']) assert.equal(user[flag],false,flag);
  const startCalls=calls.length;mode='deny';
  for(const operation of ['login','logout','shareholder_register','daily_sheet_get','daily_sheet_confirm','daily_sheet_save','monthly_cell_save','expense_save','report_acknowledge','daily_recognition_worker_next','staff_grant','unknown']) {
    r=await post({operation,employee_session_token:token,role:'finance',auth_capabilities:['daily_report.write']});
    assert.equal(r.status,403,operation+' denied');
  }
  assert.equal(calls.length,startCalls);mode='read';
  r=await post({operation:'overview',employee_session_token:token,store:'乙店'});assert.equal(r.status,403);
  sessionValid=false;r=await post({operation:'session',employee_session_token:token});assert.equal(r.status,403);sessionValid=true;
  active=false;r=await post({operation:'session',employee_session_token:token});assert.equal(r.status,403);active=true;
  sessionStore='乙店';r=await post({operation:'session',employee_session_token:token});assert.equal(r.status,403);sessionStore='甲店';
  storeAccess=[];r=await post({operation:'session',employee_session_token:token});assert.equal(r.status,403);
  storeAccess=[id(1),id(2)];r=await post({operation:'session',employee_session_token:token});assert.deepEqual((await r.json()).user.stores,['甲店','乙店']);
  assert(calls.some(p=>p.includes('expires_at=gt.')),'sessions require unexpired token');
  // Execute new admin service, not just text assertions.
  let credential='plain-legacy',staffRole='admin',limited=false; const writes=[];
  const adminContext=vm.createContext({console,Request,Response,TextEncoder,crypto:webcrypto,Date,
    Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.local':'synthetic-service-key'},serve:fn=>{adminContext.handler=fn;}},
    fetch:async(url,opts={})=>{
      const path=String(url).split('/rest/v1/')[1],data=opts.body?JSON.parse(opts.body):null;
      if(opts.method==='POST')writes.push({path,data});
      let result=[];
      if(path==='rpc/staff_access_rate_limit')result=!limited;
      else if(path.startsWith('staff?'))result=[{id:1,username:'管理员',password_hash:credential,role:staffRole,store:'甲店',active:true,employment_status:'active'}];
      else if(path.startsWith('staff_access_sessions?'))result=[{staff_id:1,credential_hash:credential,role:'admin',store:'甲店'}];
      else if(path.startsWith('zysyr_stores?'))result=[{id:id(1),name:'甲店'}];
      else if(path==='rpc/staff_access_manage')result={id:3};
      else if(!['staff_access_sessions','staff'].includes(path))throw Error(path);
      return new Response(JSON.stringify(result));
    }});
  vm.runInContext(stripTypeScriptTypes(shared.replaceAll('export ','')),adminContext);
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/staff-access-api/index.ts','utf8').replace(/^import .*;\n/gm,'')),adminContext);
  const adminPost=async p=>adminContext.handler(new Request('https://test.local',{method:'POST',body:JSON.stringify(p)}));
  for(const stored of ['plain-legacy',await hash('plain-legacy'),'sha256:'+await hash('plain-legacy')]){
    credential=stored;r=await adminPost({operation:'admin_login',username:'管理员',password:'plain-legacy'});assert.equal(r.status,200);
    const data=await r.json();assert(!('password_hash' in data.user));assert.equal(data.session_token.length,72);
  }
  r=await adminPost({operation:'admin_login',username:'管理员',password:credential});assert.equal(r.status,403,'stored hash cannot be submitted as a password');
  staffRole='staff';r=await adminPost({operation:'admin_login',username:'管理员',password:'plain-legacy',role:'admin'});assert.equal(r.status,403);staffRole='admin';
  limited=true;r=await adminPost({operation:'admin_login',username:'管理员',password:'plain-legacy'});assert.equal(r.status,429);limited=false;
  r=await adminPost({operation:'register',username:'申请者',password:'abcdef',store:'甲店',position:'股东',role:'admin'});assert.equal(r.status,403);
  r=await adminPost({operation:'register',username:'申请者',password:'abcdef',store:'甲店',position:'发型师',role:'admin',active:true,report_store_ids:[id(1)]});assert.equal(r.status,200);
  const registered=writes.filter(w=>w.path==='staff').at(-1).data;
  assert.equal(registered.active,false);assert.equal(registered.role,'staff');assert.equal(registered.employment_status,'pending');assert(!registered.report_store_ids);
  r=await adminPost({operation:'save',session_token:token,staff_id:3,data:{password:'abcdef',password_hash:'attacker',role:'staff'}});assert.equal(r.status,200);
  assert.equal(writes.at(-1).data.p_data.password_hash,'sha256:'+await hash('abcdef'));
  assert(!('password' in writes.at(-1).data.p_data));
  r=await adminPost({operation:'save',session_token:token,staff_id:3,data:{password_hash:'attacker',role:'staff'}});assert.equal(r.status,200);
  assert(!('password_hash' in writes.at(-1).data.p_data));
  console.log('staff report Edge tests passed: read-only allowlist, live session/store scope, login, registration and credential handling');
}

async function databaseTests(){
  docker(['run','--rm','-d','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try{
    for(let i=0;i<80;i++){try{sql('select 1');break}catch{await new Promise(r=>setTimeout(r,250));}}
    sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create table public.staff(id serial primary key,username text unique,password_hash text,role text,store text,position text,active boolean,employment_status text,created_at timestamptz default now());
      create table public.zysyr_stores(id uuid primary key,company_id uuid,name text,status text);
      create table public.employee_booking_sessions(token_hash text,username text);
      create table public.zysyr_operations_sessions(token_hash text,username text);
      create table public.finance_fixture(id integer primary key,amount numeric);insert into finance_fixture values(1,2126);
      grant all on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role;
      grant all on staff to anon,authenticated;grant update(username) on staff to anon;
      insert into staff(id,username,password_hash,role,store,position,active,employment_status) values
      (1,'老板','secret','admin','甲店','店长',true,'active'),(2,'店管','secret','store_admin','甲店','店长',true,'active'),
      (3,'甲员工','secret','staff','甲店','发型师',true,'active'),(4,'乙员工','secret','staff','乙店','发型师',true,'active'),
      (5,'待审核','secret','staff','甲店','发型师',false,'pending');
      select setval('staff_id_seq',5);
      insert into zysyr_stores values('${id(1)}','${id(9)}','甲店','active'),('${id(2)}','${id(9)}','乙店','active');`);
    sql(fs.readFileSync('supabase/migrations/20260921021140_staff_report_access.sql','utf8'));
    sql(fs.readFileSync('supabase/migrations/20260921021346_staff_credentials_private.sql','utf8'));
    sql(`insert into staff_access_sessions(token_hash,staff_id,credential_hash,role,store,expires_at) values
      ('owner',1,'secret','admin','甲店',now()+interval '1 hour'),('manager',2,'secret','store_admin','甲店',now()+interval '1 hour');`);
    const manage=(who,operation,target,data={})=>sql(`set role service_role;select public.staff_access_manage('${who}',${q(operation)},${target},${q(JSON.stringify(data))}::jsonb);`);
    const deny=(query,re=/permission denied/)=>assert.throws(()=>sql(query),re);
    for(const role of ['anon','authenticated']){
      assert.equal(sql(`set role ${role};select count(username) from staff;`),'SET\n5');
      for(const query of ['select password_hash from staff','select username from staff where password_hash=\'secret\'','select * from staff',"update staff set username='x' where id=3","insert into staff(username) values('x')",'delete from staff where id=3','select * from staff_report_grants',"select staff_access_rate_limit('x')","select staff_access_manage('owner','grants',3,'{}')"]){deny(`set role ${role};${query}`);}
    }
    assert.throws(()=>manage('fake','grants',3,{report_store_ids:[id(1)]}),/ADMIN_SESSION_INVALID/);
    assert.throws(()=>manage('manager','grants',3,{report_store_ids:[id(1)]}),/REPORT_GRANT_FORBIDDEN/);
    assert.throws(()=>manage('manager','employment',4,{employment_status:'departed'}),/STAFF_FORBIDDEN/);
    assert.throws(()=>manage('manager','save',3,{username:'甲员工',store:'甲店',position:'店长',role:'admin'}),/STAFF_FORBIDDEN/);
    assert.throws(()=>manage('owner','employment',1,{employment_status:'departed'}),/SELF_CHANGE_FORBIDDEN/);
    manage('owner','grants',3,{report_store_ids:[id(1),id(2)]});
    assert.equal(sql('select count(*) from staff_report_grants where staff_id=3'),'2');
    const audits=sql('select count(*) from staff_access_audit');
    assert.throws(()=>manage('owner','save',3,{username:'SHOULD_ROLL_BACK',store:'甲店',position:'发型师',role:'staff',report_store_ids:[id(8)]}),/STORE_INVALID/);
    assert.equal(sql('select username from staff where id=3'),'甲员工');assert.equal(sql('select count(*) from staff_access_audit'),audits);
    manage('owner','grants',3,{report_store_ids:[]});assert.equal(sql('select count(*) from staff_report_grants'),'0');
    manage('owner','grants',3,{report_store_ids:[id(1)]});
    sql("insert into employee_booking_sessions values('b','甲员工');insert into zysyr_operations_sessions values('f','甲员工');");
    manage('manager','employment',3,{employment_status:'departed'});
    assert.equal(sql("select active||'|'||employment_status from staff where id=3"),'false|departed');
    assert.equal(sql('select count(*) from staff_report_grants'),'0');assert.equal(sql('select count(*) from employee_booking_sessions'),'0');
    manage('manager','employment',3,{employment_status:'active'});
    manage('manager','reject',5);assert.equal(sql("select employment_status from staff where id=5"),'departed');
    manage('owner','save',0,{username:'新股东',store:'甲店',position:'股东',role:'staff',password_hash:'sha256:synthetic',report_store_ids:[id(2)]});
    assert.equal(sql("select count(*) from staff_report_grants g join staff s on s.id=g.staff_id where s.username='新股东'"),'1');
    assert.equal(sql("select count(*) from staff_access_audit where after_data ? 'password_hash' or before_data ? 'password_hash'"),'0');
    sql("update staff set role='staff' where id=2");assert.throws(()=>manage('manager','employment',3,{employment_status:'departed'}),/ADMIN_SESSION_INVALID/);
    sql("update staff set password_hash='changed' where id=1");assert.throws(()=>manage('owner','grants',3,{report_store_ids:[id(1)]}),/ADMIN_SESSION_INVALID/);
    assert.equal(sql("select bool_and(staff_access_rate_limit('bucket')) from generate_series(1,20)"),'t');
    assert.equal(sql("select staff_access_rate_limit('bucket')"),'f');
    assert.equal(sql('select amount from finance_fixture'),'2126');
    console.log('staff access PostgreSQL tests passed: ACL, roles, grants, revocation, atomic rollback, audit and unchanged finance fixture');
  }finally{docker(['stop',container]);}
}
(async()=>{await edgeTests();await databaseTests();})().catch(e=>{console.error(e);process.exitCode=1;});
