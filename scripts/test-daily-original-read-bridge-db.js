'use strict';
// Real PostgreSQL 17 in an isolated disposable container. Synthetic data only;
// no linked project, credentials, Storage call, financial posting or live read.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const container = 'daily-original-read-' + process.pid + '-' + Date.now();
const q = value => value == null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const jsonSql = value => q(JSON.stringify(value)) + '::jsonb';
const docker = args => spawnSync('docker', args, {encoding:'utf8', maxBuffer:8 * 1024 * 1024});
const checked = result => { if (result.status !== 0) throw Error(result.stderr || result.stdout || result.error); return result.stdout.trim(); };
const raw = input => spawnSync('docker', ['exec','-i',container,'psql','-h','127.0.0.1','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres'], {input, encoding:'utf8', maxBuffer:8 * 1024 * 1024});
const sql = input => checked(raw(input));
const result = input => JSON.parse(sql(input).split('\n').at(-1));
const reject = (input, pattern) => { const r = raw(input); assert.notEqual(r.status, 0, 'forbidden request unexpectedly succeeded'); assert.match(r.stderr, pattern); };
const C = randomUUID(), OtherC = randomUUID(), S = randomUUID(), OtherS = randomUUID(), ForeignS = randomUUID();
const Finance = randomUUID(), Reader = randomUUID(), WriterOnly = randomUUID(), OtherWriter = randomUUID(), ForeignWriter = randomUUID();
const signature = 'public.zysyr_daily_original_references(uuid,integer,uuid,uuid,date,date,boolean)';
const oldSignature = 'public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb)';
const rpc = ({actor=Reader,staff=null,company=C,store=S,start='2026-08-01',end='2026-09-01',detail=false}={}) =>
  `select public.zysyr_daily_original_references(${q(actor)},${staff == null ? 'null' : Number(staff)},${q(company)},${q(store)},${q(start)},${q(end)},${detail ? 'true' : 'false'});`;
const read = options => result('begin read only; set role service_role; ' + rpc(options) + ' rollback;');
const forbidden = options => reject('set role service_role; ' + rpc(options), /FORBIDDEN|IDENTITY|SCOPE/);
const writer = (action, request, metadata, actor=Finance, company=C, store=S) =>
  `select public.zysyr_daily_original_archive(${q(actor)},${q(company)},${q(store)},${q(action)},${q(request)},${jsonSql(metadata)});`;
const snapshot = table => sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by ${table === 'synthetic_financial' ? 'id' : 'request_id'})::text,'[]')) from public.${table} t`);
let started = false;
(async () => { try {
  checked(docker(['run','--rm','-d','--network','none','--name',container,'-e','POSTGRES_PASSWORD=synthetic','postgres:17'])); started = true;
  let ready = false;
  for (let i=0; i<100; i++) { if (docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status === 0) { ready = true; break; } await new Promise(resolve => setTimeout(resolve,100)); }
  assert.equal(ready, true, 'isolated PostgreSQL did not become ready');
  sql(`create role anon; create role authenticated; create role service_role bypassrls; create schema zysyr_private;
    create table public.zysyr_companies(id uuid primary key,status text);
    create table public.zysyr_stores(id uuid primary key,company_id uuid,name text,status text,deleted_at timestamptz);
    create table public.staff(id integer primary key,username text,store text,active boolean,employment_status text);
    create table public.staff_report_grants(staff_id integer,store_id uuid,primary key(staff_id,store_id));
    create table public.synthetic_accounts(id uuid primary key,company_id uuid,store_id uuid,active boolean,can_read boolean,can_write boolean);
    insert into zysyr_companies values(${q(C)},'active'),(${q(OtherC)},'active');
    insert into zysyr_stores values(${q(S)},${q(C)},'Synthetic A','active',null),(${q(OtherS)},${q(C)},'Synthetic B','active',null),(${q(ForeignS)},${q(OtherC)},'Synthetic C','active',null);
    insert into staff values(11,'Synthetic shareholder','Synthetic A',true,'active'),(12,'Synthetic revoked','Synthetic A',true,'active');
    insert into staff_report_grants values(11,${q(S)});
    insert into synthetic_accounts values
      (${q(Finance)},${q(C)},${q(S)},true,true,true),(${q(Reader)},${q(C)},${q(S)},true,true,false),
      (${q(WriterOnly)},${q(C)},${q(S)},true,false,true),(${q(OtherWriter)},${q(C)},${q(OtherS)},true,true,true),
      (${q(ForeignWriter)},${q(OtherC)},${q(ForeignS)},true,true,true);
    create function zysyr_private.account_has_capability(a uuid,c uuid,s uuid,cap text) returns boolean language sql stable as $$
      select exists(select 1 from public.synthetic_accounts ua
        join public.zysyr_companies co on co.id=ua.company_id and co.status='active'
        join public.zysyr_stores st on st.id=ua.store_id and st.company_id=co.id and st.status='active' and st.deleted_at is null
        where ua.id=a and ua.company_id=c and ua.store_id=s and ua.active
          and case cap when 'voucher.read' then ua.can_read when 'daily_report.write' then ua.can_write else false end) $$;
    create function zysyr_private.assert_daily_entry_scope(a uuid,c uuid,s uuid) returns void language plpgsql as $$
      begin if not zysyr_private.account_has_capability(a,c,s,'daily_report.write') then
        raise exception using errcode='42501',message='DAILY_ENTRY_SCOPE_FORBIDDEN'; end if; end $$;
    create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE'; end$$;
    create table public.synthetic_financial(id integer primary key,amount numeric,status text,source_voucher_id uuid,approved_original_count integer,original_image_url text,recognition_eligible boolean);
    insert into synthetic_financial values(1,123.45,'confirmed',null,0,null,false),(2,null,'draft',null,0,null,false);`);
  sql(fs.readFileSync('supabase/migrations/20261112055108_daily_original_independent_archive.sql','utf8'));
  const archive = (date, done=true, actor=Finance, company=C, store=S) => {
    const id = randomUUID(), metadata = {report_date:date,original_filename:'synthetic-'+id+'.jpg',mime_type:'image/jpeg',size_bytes:123,sha256:'a'.repeat(64),note:'private upload note: not a client read field'};
    result(writer('reserve',id,metadata,actor,company,store));
    if (done) result(writer('complete',id,metadata,actor,company,store));
    return {id,metadata};
  };
  const first = archive('2026-08-01'), second = archive('2026-08-01');
  const pending = archive('2026-08-01',false); archive('2026-08-03',false);
  archive('2026-08-02'); archive('2026-07-31'); archive('2026-09-01');
  archive('2026-08-01',true,OtherWriter,C,OtherS); archive('2026-08-01',true,ForeignWriter,OtherC,ForeignS);
  // Bulk fixtures are seeded before snapshots. The detail cap must fail
  // explicitly instead of silently returning a truncated set of originals.
  sql(`insert into public.zysyr_daily_original_reservations(request_id,company_id,store_id,actor_user_id,metadata,report_date,object_path)
    select f.request_id,${q(C)},${q(S)},${q(Finance)},
      jsonb_build_object('report_date',f.report_date,'original_filename','synthetic-bulk.jpg','mime_type','image/jpeg','size_bytes',123,'sha256',repeat('b',64),'note','synthetic bulk fixture'),
      f.report_date,${q(C+'/'+S+'/daily-originals/')}||to_char(f.report_date,'YYYY-MM')||'/'||f.report_date||'/'||f.request_id
    from (select gen_random_uuid() as request_id,'2026-10-01'::date as report_date from generate_series(1,200)
      union all select gen_random_uuid(),'2026-10-02'::date from generate_series(1,201)) f;
    insert into public.zysyr_daily_original_completions(request_id,completed_by)
      select request_id,${q(Finance)} from public.zysyr_daily_original_reservations where report_date>='2026-10-01';`);
  const tables = ['zysyr_daily_original_reservations','zysyr_daily_original_completions'];
  const before = Object.fromEntries([...tables,'synthetic_financial'].map(t => [t,snapshot(t)]));
  const oldDefinition = sql(`select pg_get_functiondef(${q(oldSignature)}::regprocedure)`);
  const oldAcl = sql(`select proacl::text from pg_proc where oid=${q(oldSignature)}::regprocedure`);
  const tableAcls = tables.map(t => sql(`select relacl::text from pg_class where oid=${q('public.'+t)}::regclass`));
  const migration = fs.readdirSync('supabase/migrations').filter(name => name.endsWith('_daily_original_read_bridge.sql'));
  assert.equal(migration.length,1,'exactly one reviewed read-bridge migration is required');
  sql(fs.readFileSync('supabase/migrations/'+migration[0],'utf8'));

  // A new read interface must not relax the old writer or the tables themselves.
  assert.equal(sql(`select pg_get_functiondef(${q(oldSignature)}::regprocedure)`),oldDefinition);
  assert.equal(sql(`select proacl::text from pg_proc where oid=${q(oldSignature)}::regprocedure`),oldAcl);
  for (let i=0; i<tables.length; i++) {
    const table = tables[i];
    assert.equal(sql(`select relacl::text from pg_class where oid=${q('public.'+table)}::regclass`),tableAcls[i]);
    assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid=${q('public.'+table)}::regclass`),'t');
    for (const role of ['anon','authenticated','service_role']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
        assert.equal(sql(`select has_table_privilege(${q(role)},${q('public.'+table)},${q(privilege)})`),'f');
      reject(`set role ${role}; select * from public.${table}`,/permission denied/);
    }
  }
  const properties = result(`select json_build_object('definer',prosecdef,'volatility',provolatile,'config',proconfig,'result',pg_get_function_result(oid)) from pg_proc where oid=${q(signature)}::regprocedure`);
  assert.equal(properties.definer,true); assert.equal(properties.volatility,'s'); assert.equal(properties.result,'jsonb');
  assert.ok(properties.config.some(value => /^search_path=(?:""|)$/.test(value)),'empty search_path required');
  for (const role of ['anon','authenticated']) {
    assert.equal(sql(`select has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`),'f');
    reject(`set role ${role}; `+rpc(),/permission denied/);
  }
  assert.equal(sql(`select has_function_privilege('service_role',${q(signature)},'EXECUTE')`),'t');

  const month = read();
  assert.deepEqual(month.days,[{report_date:'2026-08-01',count:2},{report_date:'2026-08-02',count:1}]);
  assert.deepEqual(month.archives,[],'month counts must not return paths or full originals');
  assert.equal(JSON.stringify(month).includes('object_path'),false);
  assert.equal(JSON.stringify(month).includes(pending.id),false,'pending reservation must not appear in completed references');
  assert.deepEqual(read({actor:Finance}),month);
  assert.deepEqual(read({actor:WriterOnly}),month,'existing daily writer capability also permits references');
  assert.deepEqual(read({actor:null,staff:11}),month,'real staff identity must read without a fabricated account UUID');
  const detail = read({start:'2026-08-01',end:'2026-08-02',detail:true});
  assert.deepEqual(detail.days,[{report_date:'2026-08-01',count:2}]);
  assert.equal(detail.archives.length,2);
  assert.deepEqual(new Set(detail.archives.map(a=>a.request_id)),new Set([first.id,second.id]));
  for (const item of detail.archives) {
    assert.deepEqual(Object.keys(item).sort(),['completed_at','mime_type','object_path','original_filename','report_date','request_id','sha256','size_bytes'].sort());
    assert.equal(item.report_date,'2026-08-01'); assert.equal(item.size_bytes,123); assert.equal(item.sha256,'a'.repeat(64));
    assert.equal(item.mime_type,'image/jpeg'); assert.match(item.object_path,new RegExp('^'+C+'/'+S+'/daily-originals/2026-08/2026-08-01/'+item.request_id+'$'));
    assert.equal(Number.isNaN(Date.parse(item.completed_at)),false);
  }
  const none = read({start:'2026-08-03',end:'2026-08-04',detail:true});
  assert.deepEqual(none,{days:[],archives:[]},'a pending-only date is not a completed original');
  assert.deepEqual(read({start:'2026-08-04',end:'2026-08-05',detail:true}),none,'absence remains distinct from a caller-generated financial zero');
  assert.equal(read({start:'2026-10-01',end:'2026-10-02',detail:true}).archives.length,200,'all originals at the detail boundary must be returned');
  assert.deepEqual(read({start:'2026-10-01',end:'2026-11-01'}).days,[{report_date:'2026-10-01',count:200},{report_date:'2026-10-02',count:201}],'month counts must not inherit a detail pagination limit');
  reject('begin read only; set role service_role; '+rpc({start:'2026-10-02',end:'2026-10-03',detail:true}),/LIMIT_EXCEEDED/);

  // Exact identity, current capabilities and current granted store/company scope.
  forbidden({actor:null}); forbidden({actor:Reader,staff:11}); forbidden({actor:null,staff:0}); forbidden({actor:null,staff:-1});
  forbidden({actor:randomUUID()}); forbidden({actor:null,staff:12}); forbidden({company:null}); forbidden({store:null});
  forbidden({store:OtherS}); forbidden({store:ForeignS}); forbidden({company:OtherC,store:S});
  forbidden({actor:ForeignWriter}); forbidden({actor:null,staff:11,store:OtherS}); forbidden({actor:null,staff:11,company:OtherC,store:ForeignS});
  sql(`update synthetic_accounts set can_read=false where id=${q(Reader)}`); forbidden();
  sql(`update synthetic_accounts set can_read=true,active=false where id=${q(Reader)}`); forbidden();
  sql(`update synthetic_accounts set active=true where id=${q(Reader)}`);
  for (const [change,restore] of [
    ["update staff set active=false where id=11","update staff set active=true where id=11"],
    ["update staff set employment_status='departed' where id=11","update staff set employment_status='active' where id=11"],
    [`delete from staff_report_grants where staff_id=11 and store_id=${q(S)}`,`insert into staff_report_grants values(11,${q(S)})`],
  ]) { sql(change); forbidden({actor:null,staff:11}); sql(restore); }
  for (const [change,restore] of [
    [`update zysyr_companies set status='inactive' where id=${q(C)}`,`update zysyr_companies set status='active' where id=${q(C)}`],
    [`update zysyr_stores set status='inactive' where id=${q(S)}`,`update zysyr_stores set status='active' where id=${q(S)}`],
    [`update zysyr_stores set deleted_at=now() where id=${q(S)}`,`update zysyr_stores set deleted_at=null where id=${q(S)}`],
  ]) { sql(change); forbidden(); forbidden({actor:null,staff:11}); sql(restore); }
  assert.deepEqual(read(),month); assert.deepEqual(read({actor:null,staff:11}),month);
  for (const bounds of [
    {start:null},{end:null},{start:'2026-08-01',end:'2026-08-01'},
    {start:'2026-08-02',end:'2026-08-01'},{start:'2026-08-01',end:'2026-09-02'},
    {start:'2026-08-01',end:'2026-08-03',detail:true},
  ]) reject('set role service_role; '+rpc(bounds),/DATE|RANGE|BOUND/);

  // Read-only readers still cannot use status/reconciliation or the old writer.
  reject('set role service_role; '+writer('status',first.id,{},Reader),/FORBIDDEN/);
  reject('set role service_role; '+writer('reserve',randomUUID(),first.metadata,Reader),/FORBIDDEN/);
  for (const table of tables) {
    reject(`update public.${table} set created_at=now()`,/IMMUTABLE/);
    reject(`delete from public.${table}`,/IMMUTABLE/);
  }
  for (const table of [...tables,'synthetic_financial']) assert.equal(snapshot(table),before[table],table+' must be unchanged by all reference reads');
  console.log('Daily original read PG17: completed-only month/detail, exact account/staff scope and revocation, bounded dates, closed ACL/RLS, immutable archives, unchanged writer and financial sentinel passed. Synthetic only.');
} finally { if (started) checked(docker(['rm','-f',container])); } })().catch(error => { console.error(error); process.exitCode=1; });
