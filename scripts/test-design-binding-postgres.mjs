/** Offline real-PostgreSQL transaction tests. Not a migration/deployment runner. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const draft = readFileSync(new URL('../packages/design-production-adapter/drafts/visit-binding-transaction.sql', import.meta.url), 'utf8');
const container = `design-binding-synthetic-${process.pid}-${randomUUID().slice(0,8)}`;
const db = 'design_binding_synthetic', schema = 'design_binding_fixture';
const manager = 'a'.repeat(64), alice = 'b'.repeat(64), bob = 'c'.repeat(64);
const day = '2026-11-15', store = 'synthetic-store';
const children = new Set();
let created = false, passed = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30_000 });
function args(database=db, name='fixture-query', guarded=true) {
  return ['exec','-i','-e',`PGAPPNAME=${name}`,'-e',
    `PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=10000${guarded ? ' -c design_binding.synthetic_fixture=offline-stage5-only' : ''}`,
    container,'psql','-X','-q','-h','127.0.0.1','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'];
}
function sql(text, database=db, guarded=true) {
  return execFileSync('docker', args(database,'fixture-query',guarded), {
    input: text, encoding:'utf8', stdio:['pipe','pipe','pipe'], timeout:25_000,
  }).trim();
}
function expectError(text, code, database=db, guarded=true) {
  assert.throws(() => sql(text,database,guarded), error => String(error.stderr).includes(code), code);
}
async function test(name, fn) { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
async function until(check, description) {
  for (let i=0;i<100;i++) { if (check()) return; await sleep(40); }
  throw new Error(`Timed out: ${description}`);
}
function session(name, initial) {
  const child = spawn('docker',args(db,name),{stdio:['pipe','pipe','pipe']});
  children.add(child);
  const state={stdout:'',stderr:'',code:null,done:false};
  child.stdout.on('data',chunk => state.stdout+=chunk);
  child.stderr.on('data',chunk => state.stderr+=chunk);
  const finished = new Promise(resolve => {
    child.on('error',error => { state.stderr+=String(error); state.done=true; resolve(state); });
    child.on('close',code => { state.code=code; state.done=true; children.delete(child); resolve(state); });
  });
  child.stdin.on('error',() => {});
  child.stdin.write(initial+'\n');
  return {state,finished,child,finish(text='commit;') { child.stdin.end(text+'\n'); }};
}
async function ready(s) {
  await until(() => { if (s.state.done) throw new Error(s.state.stderr); return s.state.stdout.includes('LOCK_HELD'); },'first transaction holds its locks');
}
async function blocked(name) {
  await until(() => sql(`select count(*) from pg_stat_activity where application_name=${quote(name)}
    and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`)==='1','second connection demonstrably waits on PostgreSQL lock');
}
function bindingCommand(id, overrides={}) {
  return {requestId:randomUUID(),action:'bind',source:'appointment',visitId:`booking:${id}`,
    customerProfileId:'11',store,bookingDate:day,visitKey:`booking:${id}`,staffUsername:'alice',
    lifecycleRevision:1,expectedRevision:0,...overrides};
}
function approve(command, author='manager', seconds=3600) {
  const id=randomUUID();
  sql(`insert into ${schema}.binding_approvals values (${quote(id)},${quote(author)},${json(command)},clock_timestamp()+make_interval(secs=>${seconds}));`);
  return id;
}
function changeSql(command, approval, token=manager) {
  return `select ${schema}.apply_binding(${quote(token)},${json(command)},${quote(approval)}::uuid);`;
}
function change(command) { return JSON.parse(sql(changeSql(command,approve(command)))); }
function archiveCommand(id, overrides={}) {
  return {requestId:randomUUID(),source:'appointment',visitId:`booking:${id}`,customerProfileId:'11',
    expectedBindingRevision:1,expectedLatestVersionId:null,snapshot:{synthetic:true,note:'first'},...overrides};
}
function archiveSql(command, token=alice) { return `select ${schema}.append_archive(${quote(token)},${json(command)});`; }
function archive(command, token=alice) { return JSON.parse(sql(archiveSql(command,token))); }
function source(id, stylist='alice', status=0, lifecycle=true) {
  sql(`insert into ${schema}.bookings values(${id},${quote(stylist)},${quote(store)},${quote(day)},${status});
    ${lifecycle ? `insert into ${schema}.lifecycle_decisions values('appointment','booking:${id}',to_jsonb(${status}),true,1,'synthetic explicit reviewed decision');` : ''}`);
}
function count(table, condition='true') { return Number(sql(`select count(*) from ${schema}.${table} where ${condition};`)); }

async function main() {
  // Inspect only the named existing image; never pull, contact a registry or
  // attach a preexisting container/volume. An absent image is a hard failure.
  docker(['image','inspect','postgres:17','--format','{{.Id}}']);
  docker(['run','--rm','--pull','never','-d','--network','none','--name',container,
    '--tmpfs','/var/lib/postgresql/data:rw,size=268435456',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  created=true;
  try {
    let isReady=false;
    for (let i=0;i<100;i++) {
      try { sql('select 1;','postgres'); isReady=true; break; } catch { await sleep(150); }
    }
    assert.ok(isReady,'isolated PostgreSQL becomes ready');
    assert.equal(JSON.parse(docker(['inspect','--format','{{json .HostConfig.NetworkMode}}',container])),'none');
    assert.equal(docker(['inspect','--format','{{len .HostConfig.PortBindings}}',container]).trim(),'0');
    sql(`create database ${db};`,'postgres');
    await test('draft refuses ordinary databases and absent synthetic guard',() => {
      expectError(draft,'SYNTHETIC_FIXTURE_REQUIRED','postgres');
      expectError(draft,'SYNTHETIC_FIXTURE_REQUIRED');
      assert.equal(sql("select count(*) from pg_namespace where nspname='design_binding_fixture';"),'0');
    });
    sql(`create schema ${schema};
      create table ${schema}.synthetic_guard(marker text primary key);
      insert into ${schema}.synthetic_guard values('empty-disposable-database-no-real-data');
      create table ${schema}.staff(username text primary key,store text not null,active boolean,employment_status text not null);
      create table ${schema}.employee_booking_sessions(token_hash text primary key,username text not null,store text not null,expires_at timestamptz not null);
      create table ${schema}.bookings(id bigint primary key,barber_name text not null,shop_name text not null,date date not null,status integer not null);
      create table ${schema}.frontdesk_today_customers(id uuid primary key,barber_name text not null,store text not null,business_date date not null,status text not null);
      create table ${schema}.customer_profiles(id bigint primary key,shop_name text not null);
      create table ${schema}.binding_authorities(username text not null,store text not null,can_bind boolean not null,primary key(username,store));
      create table ${schema}.binding_approvals(id uuid primary key,author text not null,command jsonb not null,expires_at timestamptz not null);
      create table ${schema}.lifecycle_decisions(source text not null,visit_id text not null,source_status jsonb not null,allowed boolean not null,revision integer not null,reason text not null,primary key(source,visit_id));
      insert into ${schema}.staff values('manager',${quote(store)},true,'active'),('alice',${quote(store)},true,'active'),('bob',${quote(store)},true,'active');
      insert into ${schema}.employee_booking_sessions values
        (${quote(manager)},'manager',${quote(store)},clock_timestamp()+interval '1 hour'),
        (${quote(alice)},'alice',${quote(store)},clock_timestamp()+interval '1 hour'),
        (${quote(bob)},'bob',${quote(store)},clock_timestamp()+interval '1 hour');
      insert into ${schema}.customer_profiles values(11,${quote(store)}),(12,${quote(store)});
      insert into ${schema}.binding_authorities values('manager',${quote(store)},true);`);
    await test('draft refuses missing fixture setting even with fixture tables',() => expectError(draft,'SYNTHETIC_FIXTURE_REQUIRED',db,false));
    sql(draft);
    await test('entry points refuse non-fixture setting and stale-snapshot isolation',() => {
      expectError(`select ${schema}.authenticate(${quote(alice)});`,'SYNTHETIC_FIXTURE_REQUIRED',db,false);
      expectError(`begin isolation level repeatable read; select ${schema}.authenticate(${quote(alice)});`,'SYNTHETIC_FIXTURE_REQUIRED');
    });
    source(101);
    const first=bindingCommand(101), approval=approve(first);
    await test('binding requires independent exact approval and current manager authority',() => {
      expectError(changeSql(first,randomUUID()),'EXPLICIT_APPROVAL_REQUIRED');
      expectError(changeSql(first,approval,alice),'BINDING_AUTHORITY_DENIED');
      expectError(changeSql({...first,customerProfileId:'12'},approval),'EXPLICIT_APPROVAL_REQUIRED');
      assert.equal(count('visit_binding_versions'),0);
    });
    await test('expired exact approval cannot authorize binding',() => {
      expectError(changeSql(first,approve(first,'manager',-1)),'EXPLICIT_APPROVAL_REQUIRED');
      assert.equal(count('visit_binding_versions'),0);
    });
    let binding1;
    await test('first binding appends an approved stable identity and exact replay receipt',() => {
      binding1=JSON.parse(sql(changeSql(first,approval)));
      assert.equal(binding1.revision,1);
      assert.deepEqual(JSON.parse(sql(changeSql(first,approval))),{...binding1,alreadyApplied:true});
      const changed={...first,staffUsername:'bob'};
      expectError(changeSql(changed,approve(changed)),'REQUEST_REUSED');
      assert.equal(count('visit_binding_versions'),1);
    });
    const firstRow=sql(`select to_jsonb(v) from ${schema}.visit_binding_versions v where id=${quote(binding1.id)};`);
    await test('numeric source status alone never creates lifecycle authority',() => {
      source(102,'alice',0,false);
      const c=bindingCommand(102), a=approve(c);
      expectError(changeSql(c,a),'LIFECYCLE_DENIED');
      sql(`insert into ${schema}.lifecycle_decisions values('appointment','booking:102','1',true,1,'synthetic');`);
      expectError(changeSql(c,a),'LIFECYCLE_DENIED');
      sql(`update ${schema}.lifecycle_decisions set source_status='0',allowed=false where visit_id='booking:102';`);
      expectError(changeSql(c,a),'LIFECYCLE_DENIED');
      sql(`update ${schema}.lifecycle_decisions set allowed=true where visit_id='booking:102';`);
      assert.equal(JSON.parse(sql(changeSql(c,a))).revision,1);
    });
    await test('first binding fixes profile store service date and archive visit key',() => {
      for (const override of [{customerProfileId:'12'},{store:'another-store'},{bookingDate:'2026-11-14'},{visitKey:'booking:102'}]) {
        const c=bindingCommand(101,{action:'reassign',expectedRevision:1,...override});
        expectError(changeSql(c,approve(c)),'FIRST_BINDING_IDENTITY_FIXED');
      }
    });
    await test('source reassignment denies old authority until explicit new binding version',() => {
      sql(`update ${schema}.bookings set barber_name='bob' where id=101;`);
      expectError(archiveSql(archiveCommand(101)),'ASSIGNMENT_CHANGED');
      const c=bindingCommand(101,{action:'reassign',expectedRevision:1,staffUsername:'bob'});
      assert.equal(change(c).revision,2);
      expectError(archiveSql(archiveCommand(101)),'BINDING_DENIED');
      assert.equal(sql(`select to_jsonb(v) from ${schema}.visit_binding_versions v where id=${quote(binding1.id)};`),firstRow);
    });
    let archive1; const request1=archiveCommand(101,{expectedBindingRevision:2});
    await test('archive CAS/idempotency is stored atomically with immutable parent linkage',() => {
      archive1=archive(request1,bob);
      assert.deepEqual(archive(request1,bob),{...archive1,alreadyApplied:true});
      expectError(archiveSql({...request1,snapshot:{synthetic:true,note:'changed'}},bob),'REQUEST_REUSED');
      expectError(archiveSql(archiveCommand(101,{expectedBindingRevision:2}),bob),'ARCHIVE_CAS_CONFLICT');
      const second=archive(archiveCommand(101,{expectedBindingRevision:2,expectedLatestVersionId:archive1.id}),bob);
      assert.equal(second.previousVersionId,archive1.id);
      assert.equal(second.versionNumber,2);
      assert.equal(archive(request1,bob).id,archive1.id,'replay returns its applied version, not current head');
    });
    await test('old bindings archives receipts and approvals cannot be updated or deleted',() => {
      for (const table of ['visit_binding_versions','customer_design_versions','request_receipts','binding_approvals']) {
        expectError(`delete from ${schema}.${table};`,'APPEND_ONLY');
        const field=table==='request_receipts'?'result':table==='binding_approvals'?'command':table==='customer_design_versions'?'snapshot':'action';
        expectError(`update ${schema}.${table} set ${field}=${field};`,'APPEND_ONLY');
      }
    });
    await test('binding can be revoked after source deletion and restored only with checked same identity',() => {
      sql(`delete from ${schema}.bookings where id=101;`);
      const revoke=bindingCommand(101,{action:'revoke',expectedRevision:2,staffUsername:'bob'});
      assert.equal(change(revoke).active,false);
      expectError(archiveSql(request1,bob),'BINDING_DENIED');
      const restore=bindingCommand(101,{action:'restore',expectedRevision:3,staffUsername:'bob'}), a=approve(restore);
      expectError(changeSql(restore,a),'SOURCE_MISSING');
      source(101,'bob',0,false);
      assert.equal(JSON.parse(sql(changeSql(restore,a))).revision,4);
      assert.equal(sql(`select to_jsonb(v) from ${schema}.visit_binding_versions v where id=${quote(binding1.id)};`),firstRow);
    });
    await test('reassignment requires a changed stylist and can explicitly replace revoked authority',() => {
      const unchanged=bindingCommand(101,{action:'reassign',expectedRevision:4,staffUsername:'bob'});
      expectError(changeSql(unchanged,approve(unchanged)),'REASSIGNMENT_REQUIRED');
      change(bindingCommand(101,{action:'revoke',expectedRevision:4,staffUsername:'bob'}));
      const wrongRestore=bindingCommand(101,{action:'restore',expectedRevision:5,staffUsername:'alice'});
      expectError(changeSql(wrongRestore,approve(wrongRestore)),'RESTORE_IDENTITY_CHANGED');
      sql(`update ${schema}.bookings set barber_name='alice' where id=101;`);
      assert.equal(change(bindingCommand(101,{action:'reassign',expectedRevision:5,staffUsername:'alice'})).revision,6);
    });
    await test('frontdesk UUIDs remain separate visits on the same service date',() => {
      for (const id of [randomUUID(),randomUUID()]) {
        const visit=`frontdesk:${id}`;
        sql(`insert into ${schema}.frontdesk_today_customers values(${quote(id)},'alice',${quote(store)},${quote(day)},'in_service');
          insert into ${schema}.lifecycle_decisions values('frontdesk',${quote(visit)},'"in_service"',true,1,'synthetic');`);
        change(bindingCommand(999,{source:'frontdesk',visitId:visit,visitKey:`manual:${day}:${id}`}));
        archive(archiveCommand(999,{source:'frontdesk',visitId:visit}));
      }
      assert.equal(count('customer_design_versions',"visit_key like 'manual:%'"),2);
    });
    await test('concurrent binding CAS has one winner on real PostgreSQL connections',async () => {
      source(103);
      const a=bindingCommand(103), b=bindingCommand(103);
      const aa=approve(a), ba=approve(b);
      const one=session('binding-cas-winner',`begin; ${changeSql(a,aa)} select 'LOCK_HELD';`);
      await ready(one);
      const two=session('binding-cas-loser',changeSql(b,ba)); two.finish('');
      await blocked('binding-cas-loser'); one.finish();
      assert.equal((await one.finished).code,0);
      assert.match((await two.finished).stderr,/BINDING_CAS_CONFLICT/);
      assert.equal(count('visit_binding_versions',"visit_id='booking:103'"),1);
      assert.equal(count('request_receipts',`request_id in (${quote(a.requestId)},${quote(b.requestId)})`),1);
    });
    await test('concurrent same-request binding replay appends once',async () => {
      source(104); const c=bindingCommand(104), a=approve(c);
      const one=session('request-first',`begin; ${changeSql(c,a)} select 'LOCK_HELD';`); await ready(one);
      const two=session('request-replay',changeSql(c,a)); two.finish('');
      await blocked('request-replay'); one.finish(); await one.finished;
      const result=await two.finished; assert.equal(result.code,0);
      assert.equal(JSON.parse(result.stdout.trim()).alreadyApplied,true);
      assert.equal(count('visit_binding_versions',"visit_id='booking:104'"),1);
    });
    await test('concurrent archive head CAS has one winner and no loser receipt',async () => {
      const a=archiveCommand(103), b=archiveCommand(103);
      const one=session('archive-cas-winner',`begin; ${archiveSql(a)} select 'LOCK_HELD';`); await ready(one);
      const two=session('archive-cas-loser',archiveSql(b)); two.finish('');
      await blocked('archive-cas-loser'); one.finish(); assert.equal((await one.finished).code,0);
      assert.match((await two.finished).stderr,/ARCHIVE_CAS_CONFLICT/);
      assert.equal(count('customer_design_versions',"visit_key='booking:103'"),1);
      assert.equal(count('request_receipts',`request_id=${quote(b.requestId)}`),0);
    });
    await test('concurrent identical archive requests return one committed applied version',async () => {
      source(105); change(bindingCommand(105)); const c=archiveCommand(105);
      const one=session('archive-request-first',`begin; ${archiveSql(c)} select 'LOCK_HELD';`); await ready(one);
      const two=session('archive-request-replay',archiveSql(c)); two.finish('');
      await blocked('archive-request-replay'); one.finish(); assert.equal((await one.finished).code,0);
      const result=await two.finished; assert.equal(result.code,0);
      assert.equal(JSON.parse(result.stdout.trim()).alreadyApplied,true);
      assert.equal(count('customer_design_versions',"visit_key='booking:105'"),1);
    });
    await test('explicit rollback removes archive and request receipt together',() => {
      const c=archiveCommand(104);
      sql(`begin; ${archiveSql(c)} rollback;`);
      assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
      assert.equal(archive(c).versionNumber,1);
    });
    // Every revoke-first test verifies an actual wait_event_type=Lock, not a
    // JavaScript mutex or elapsed sleep. Direct row writers test the locks too.
    for (const kind of ['session','staff','assignment','lifecycle','binding']) {
      await test(`${kind} revocation winning first blocks then rejects archive commit`,async () => {
        const id=200+passed; source(id); change(bindingCommand(id));
        const c=archiveCommand(id);
        let mutation, restore;
        if (kind==='session') {
          mutation=`delete from ${schema}.employee_booking_sessions where token_hash=${quote(alice)};`;
          restore=`insert into ${schema}.employee_booking_sessions values(${quote(alice)},'alice',${quote(store)},clock_timestamp()+interval '1 hour');`;
        } else if (kind==='staff') {
          mutation=`update ${schema}.staff set employment_status='departed' where username='alice';`;
          restore=`update ${schema}.staff set employment_status='active' where username='alice';`;
        } else if (kind==='assignment') mutation=`update ${schema}.bookings set barber_name='bob' where id=${id};`;
        else if (kind==='lifecycle') mutation=`update ${schema}.lifecycle_decisions set allowed=false where visit_id='booking:${id}';`;
        else { const r=bindingCommand(id,{action:'revoke',expectedRevision:1}); mutation=changeSql(r,approve(r)); }
        const one=session(`${kind}-revoke-first`,`begin; ${mutation} select 'LOCK_HELD';`); await ready(one);
        const two=session(`${kind}-denied-append`,archiveSql(c)); two.finish('');
        await blocked(`${kind}-denied-append`); one.finish(); assert.equal((await one.finished).code,0);
        const result=await two.finished; assert.notEqual(result.code,0); assert.match(result.stderr,/(SESSION_DENIED|STAFF_DENIED|ASSIGNMENT_CHANGED|LIFECYCLE_DENIED|BINDING_DENIED)/);
        assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
        assert.equal(count('customer_design_versions',`visit_key='booking:${id}'`),0);
        if (restore) sql(restore);
      });
    }
    for (const kind of ['session','staff','assignment','binding']) {
      await test(`archive winning first prevents ${kind} revocation from committing first`,async () => {
        const id=300+passed; source(id); change(bindingCommand(id));
        const c=archiveCommand(id);
        let mutation, restore;
        if (kind==='session') {
          mutation=`delete from ${schema}.employee_booking_sessions where token_hash=${quote(alice)};`;
          restore=`insert into ${schema}.employee_booking_sessions values(${quote(alice)},'alice',${quote(store)},clock_timestamp()+interval '1 hour');`;
        } else if (kind==='staff') {
          mutation=`update ${schema}.staff set active=false where username='alice';`;
          restore=`update ${schema}.staff set active=true where username='alice';`;
        } else if (kind==='assignment') mutation=`delete from ${schema}.bookings where id=${id};`;
        else { const r=bindingCommand(id,{action:'revoke',expectedRevision:1}); mutation=changeSql(r,approve(r)); }
        const one=session(`${kind}-append-first`,`begin; ${archiveSql(c)} select 'LOCK_HELD';`); await ready(one);
        const two=session(`${kind}-waiting-revoke`,mutation); two.finish('');
        await blocked(`${kind}-waiting-revoke`);
        assert.equal(two.state.done,false,'revocation has not committed while append holds authorization');
        one.finish(); assert.equal((await one.finished).code,0); assert.equal((await two.finished).code,0);
        assert.equal(count('customer_design_versions',`visit_key='booking:${id}'`),1);
        expectError(archiveSql(c),kind==='assignment'?'SOURCE_MISSING':kind==='session'?'SESSION_DENIED':kind==='staff'?'STAFF_DENIED':'BINDING_DENIED');
        if (restore) sql(restore);
      });
    }
    for (const kind of ['session','staff','assignment','binding']) {
      await test(`deferred commit check rolls back same-transaction ${kind} revocation`,() => {
        const id=400+passed; source(id); change(bindingCommand(id)); const c=archiveCommand(id);
        let mutation;
        if (kind==='session') mutation=`delete from ${schema}.employee_booking_sessions where token_hash=${quote(alice)};`;
        else if (kind==='staff') mutation=`update ${schema}.staff set active=false where username='alice';`;
        else if (kind==='assignment') mutation=`delete from ${schema}.bookings where id=${id};`;
        else { const r=bindingCommand(id,{action:'revoke',expectedRevision:1}); mutation=changeSql(r,approve(r)); }
        expectError(`begin; ${archiveSql(c)} ${mutation} commit;`,kind==='assignment'?'SOURCE_MISSING':kind==='session'?'SESSION_DENIED':kind==='staff'?'STAFF_DENIED':'BINDING_DENIED');
        assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
        assert.equal(count('customer_design_versions',`visit_key='booking:${id}'`),0);
      });
    }
    await test('commit-time expiry rolls back an otherwise successful append',() => {
      source(501); change(bindingCommand(501)); const c=archiveCommand(501);
      expectError(`begin; ${archiveSql(c)} update ${schema}.employee_booking_sessions set expires_at=clock_timestamp()-interval '1 second' where token_hash=${quote(alice)}; commit;`,'SESSION_DENIED');
      assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
    });
    await test('wall-clock session expiry while transaction is open fails deferred validation',() => {
      source(502); change(bindingCommand(502)); const c=archiveCommand(502);
      sql(`update ${schema}.employee_booking_sessions set expires_at=clock_timestamp()+interval '1 second' where token_hash=${quote(alice)};`);
      expectError(`begin; ${archiveSql(c)} select pg_sleep(1.1); commit;`,'SESSION_DENIED');
      assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
      sql(`update ${schema}.employee_booking_sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=${quote(alice)};`);
    });
    for (const kind of ['session','staff','authority','assignment','lifecycle','stylist']) {
      await test(`binding deferred validation rolls back same-transaction ${kind} revocation`,() => {
        const id=600+passed; source(id); const c=bindingCommand(id), a=approve(c);
        let mutation, code;
        if (kind==='session') {
          mutation=`delete from ${schema}.employee_booking_sessions where token_hash=${quote(manager)};`; code='SESSION_DENIED';
        } else if (kind==='staff') {
          mutation=`update ${schema}.staff set active=false where username='manager';`; code='STAFF_DENIED';
        } else if (kind==='authority') {
          mutation=`update ${schema}.binding_authorities set can_bind=false where username='manager';`; code='BINDING_AUTHORITY_DENIED';
        } else if (kind==='assignment') {
          mutation=`delete from ${schema}.bookings where id=${id};`; code='SOURCE_MISSING';
        } else if (kind==='lifecycle') {
          mutation=`update ${schema}.lifecycle_decisions set allowed=false where visit_id='booking:${id}';`; code='LIFECYCLE_DENIED';
        } else {
          mutation=`update ${schema}.staff set active=false where username='alice';`; code='STYLIST_DENIED';
        }
        expectError(`begin; ${changeSql(c,a)} ${mutation} commit;`,code);
        assert.equal(count('visit_binding_versions',`visit_id='booking:${id}'`),0);
        assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
      });
    }
    await test('approval expiry after binding function returns rolls back the commit',() => {
      source(701); const c=bindingCommand(701), a=approve(c,'manager',1);
      expectError(`begin; ${changeSql(c,a)} select pg_sleep(1.1); commit;`,'EXPLICIT_APPROVAL_REQUIRED');
      assert.equal(count('visit_binding_versions',"visit_id='booking:701'"),0);
      assert.equal(count('request_receipts',`request_id=${quote(c.requestId)}`),0);
    });
    await test('no production source schema or public function was installed',() => {
      assert.equal(sql("select count(*) from information_schema.tables where table_schema='public';"),'0');
      assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"),'0');
    });
    console.log(`Design binding PostgreSQL 17: ${passed} real isolated transaction tests passed; synthetic blueprint only, no production readiness claim.`);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    if (created) docker(['stop','--time','1',container]);
    // --rm + tmpfs removes only this uniquely named disposable fixture.
    // Docker may return from stop slightly before --rm finishes removing it.
    await until(() => docker(['ps','-aq','--filter',`name=^/${container}$`]).trim()==='', 'owned fixture container was removed');
    console.log(`Cleanup verified: ${container} removed; no mounted user directories or persistent volumes.`);
  }
}

main().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode=1; });
