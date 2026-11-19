/**
 * Offline integration of the real JS adapters, executor and PostgreSQL 17.
 * No driver install, network, ports, host mounts, credentials or production DB.
 * PREPARE/EXECUTE below is a TEST-ONLY pg-style client transport, not runtime I/O.
 */
import assert from 'node:assert/strict';
import {createLegacyQueryDiagnostics} from './fixtures/design-legacy-diagnostics.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createVisitBindingAdapter } from '../packages/design-production-adapter/visit-binding.mjs';
import { createProductionEmployeeAdapter } from '../packages/design-production-adapter/employee-adapter.mjs';
import { createProductionArchiveAdapter } from '../packages/design-production-adapter/archive-adapter.mjs';
import { createDesignDiagnostics } from '../packages/shared/design-diagnostics.mjs';

globalThis.fetch = () => { throw new Error('Network forbidden in offline executor integration'); };
const db = 'design_executor_synthetic';
const container = `design-executor-synthetic-${process.pid}-${randomUUID().slice(0, 8)}`;
const STORE = '自由手艺人', DATE = '2026-11-15', POLICY = 'synthetic-explicit-lifecycle-v1';
const TOKENS = Object.fromEntries(['manager','alice','bob'].map(name => [name, `synthetic-${name}-${'0'.repeat(64)}`]));
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v)
  ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(canonical(value));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = readFileSync(new URL('../packages/design-production-adapter/drafts/stage6-executor-fixture.sql', import.meta.url), 'utf8');
const clients = new Set(), observed = [];
const stage25 = process.argv.includes('--stage25-calibration');
const investigating = stage25 || process.argv.includes('--investigate-legacy');
const diagnosing = investigating || process.argv.includes('--diagnose');
const diagnosticRing = [];
const correlatedDiagnostics=createLegacyQueryDiagnostics();
let diagnosticSequence = 0;
const DIAGNOSTIC_STAGES = new Set(['client-error-frame','client-invalid-result','docker-stderr','client-process-error','client-process-close','client-timeout','leased-query','employee-source','employee-rpc','employee-binding','query-start','query-complete','resolver-start','resolver-complete','resolver-failure','lifecycle-policy','container-state','investigation-failure','adapter-phase']);
const DIAGNOSTIC_SENTINELS = new Set(['division by zero','CUSTOMER_DESIGN_AUTHOR_REQUIRED','CUSTOMER_DESIGN_REQUEST_REUSED','CUSTOMER_DESIGN_VERSION_CONFLICT','CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED','DESIGN_COMMIT_DEADLINE_EXPIRED','SYNTHETIC_ERROR_FRAME_INVALID','INVALID_SYNTHETIC_CLIENT_RESULT','SYNTHETIC_CONNECTION_CLOSED','SYNTHETIC_QUERY_TIMEOUT','BINDING_LIFECYCLE_UNCONFIRMED','BINDING_SOURCE_CHANGED','BINDING_READ_UNAVAILABLE','BINDING_SOURCE_UNAVAILABLE','BINDING_RECEIPT_INVALID','BINDING_HISTORY_INVALID','PG_TRANSACTION_FAILED','PG_ROLLBACK_UNCERTAIN','PG_COMMIT_UNCERTAIN','PG_BEGIN_UNCERTAIN','PG_RESULT_INVALID','PG_LIFECYCLE_UNCONFIRMED','PG_CONTRACT_UNAVAILABLE','AUTHENTICATION_REQUIRED','RELATIONSHIP_UNAVAILABLE']);
const DIAGNOSTIC_ERROR_TYPES = new Set(['Error','TypeError','SyntaxError','AssertionError','DesignAccessError','DesignPostgresError','VisitBindingError','VisitLifecycleError','ProductionEmployeeError','ProductionArchiveError']);
function diagnosticRecord(stage, details = {}, error) {
  const record = {stage:DIAGNOSTIC_STAGES.has(stage) ? stage : 'unknown'};
  // Revalidate with the shared fixed-enum contract; never copy observer extras.
  if (stage === 'adapter-phase') {
    createDesignDiagnostics(event => Object.assign(record,event),details.component)(details.phase,details.outcome,details.failureKind);
    return record;
  }
  const summarize = value => {const text=String(value);return {bytes:Buffer.byteLength(text),sha256:hash(text)};};
  const code = value => typeof value === 'string' && (/^[A-Z0-9]{5}$/.test(value) || DIAGNOSTIC_SENTINELS.has(value));
  if (typeof details.statement === 'string') {
    const command=details.statement.trim().match(/^([A-Z]+)/i)?.[1]?.toUpperCase();
    record.command=['SELECT','WITH','INSERT','UPDATE','BEGIN','SET','COMMIT','ROLLBACK'].includes(command) ? command : 'OTHER';
    record.templateSha256=hash(details.statement);
  }
  if (typeof details.marker === 'string' && /^__RESULT_\d+__$/.test(details.marker)) record.frame=details.marker;
  if (code(details.code)) record.sqlstate=details.code;
  else if (Number.isSafeInteger(details.code)) record.exitCode=details.code;
  if (['SIGTERM','SIGKILL','SIGABRT'].includes(details.signal)) record.signal=details.signal;
  for (const key of ['rows','keys','sequence']) if (Number.isSafeInteger(details[key]) && details[key]>=0) record[key]=details[key];
  for (const key of ['allowed','rowDigestMatches','policyReviewed','unexpired','clockFinite','sourceMatches','profileMatches','running','oomKilled','inspectionAvailable']) if (typeof details[key]==='boolean') record[key]=details[key];
  if (['lt10ms','lt100ms','lt1s','lt5s','ge5s'].includes(details.elapsed)) record.elapsed=details.elapsed;
  if (['lt1s','lt10s','lt60s','ge60s'].includes(details.clockSkew)) record.clockSkew=details.clockSkew;
  if (['source','history','receipt','context','lifecycle'].includes(details.method)) record.method=details.method;
  if (Array.isArray(details.output)) record.output={lines:details.output.length,...summarize(details.output.join('\n'))};
  if (typeof details.text === 'string') record.transport=summarize(details.text);
  if (error) {
    record.error={type:DIAGNOSTIC_ERROR_TYPES.has(error.name) ? error.name : 'UnknownError'};
    if (code(error.code)) record.error.code=error.code;
    else if (error.code !== undefined) record.error.codeDigest=summarize(error.code);
    if (DIAGNOSTIC_SENTINELS.has(error.message)) record.error.sentinel=error.message;
    else if (error.message !== undefined) record.error.messageDigest=summarize(error.message);
  }
  return record;
}
function diagnose(stage, details, error) {
  if (!diagnosing) return;
  const record={test:passed+1,...diagnosticRecord(stage,details,error)};
  if (investigating) { diagnosticRing.push(record); if(diagnosticRing.length>256) diagnosticRing.shift(); }
  else console.error('SYNTHETIC_DIAGNOSTIC '+JSON.stringify(record));
}
const diagnostics = diagnosing ? event => diagnose('adapter-phase',event) : undefined;
const elapsedBucket = started => {const ms=performance.now()-started;return ms<10?'lt10ms':ms<100?'lt100ms':ms<1000?'lt1s':ms<5000?'lt5s':'ge5s';};
function queryState(statement,result) {
  const state={rows:result.rows.length,keys:Object.keys(result.rows[0]||{}).length};
  if(statement.includes('clock_timestamp()::text AS now')) {
    const value=Date.parse(result.rows[0]?.now),skew=Math.abs(value-Date.now());state.clockFinite=Number.isFinite(value);
    if(state.clockFinite) state.clockSkew=skew<1000?'lt1s':skew<10000?'lt10s':skew<60000?'lt60s':'ge60s';
  }
  if(statement.includes('FROM public.bookings') && result.rows[0]?.row) {
    const r=result.rows[0].row;state.sourceMatches=r.id===101&&r.barber_name==='alice'&&r.shop_name===STORE&&r.date===DATE&&r.status===0;
  }
  if(statement.includes('FROM public.customer_profiles') && result.rows[0]?.row) {
    const r=result.rows[0].row;state.profileMatches=r.id===11&&r.shop_name===STORE;
  }
  return state;
}
function traced(stage, details, operation) {
  const pending = operation();
  if (!diagnosing) return pending;
  return pending.catch(error => { diagnose(stage,details,error); throw error; });
}
let passed = 0, clientNumber = 0;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30_000 });
function psqlArgs(database = db, application = 'fixture-admin', guarded = true, persistent = false) {
  const command = ['psql','-X','-q','-A','-t','-w','-h','127.0.0.1','-U','postgres','-d',database,
    '-v',`ON_ERROR_STOP=${persistent ? '0' : '1'}`,'-v','VERBOSITY=verbose'];
  return ['exec','-i','-e',`PGAPPNAME=${application}`,'-e',
    `PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=10000 -c timezone=UTC -c standard_conforming_strings=on${guarded ? ' -c design_executor.synthetic_fixture=offline-stage6-only' : ''}`,
    // Merge psql's streams BEFORE Docker transports them. The fixed shell text
    // never includes SQL or data: executable/options stay separate argv items.
    container,...(persistent ? ['sh','-c','exec "$@" 2>&1','synthetic-psql',...command] : command)];
}
function sql(text, database = db, guarded = true) {
  return execFileSync('docker', psqlArgs(database,'fixture-admin',guarded), {
    input: text, encoding:'utf8', stdio:['pipe','pipe','pipe'], timeout:25_000,
  }).trim();
}
const count = (table, condition = 'true') => Number(sql(`select count(*) from ${table} where ${condition};`));
async function test(name, fn) { await fn(); console.log(`ok ${++passed} - ${name}`); }
async function until(predicate, description) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await sleep(30); }
  throw new Error(`Timed out: ${description}`);
}
function latch() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const rejects = (promise, ...codes) => assert.rejects(promise, error => codes.includes(error.code), codes.join('|'));

/**
 * One psql/libpq connection per lease, retained from BEGIN through COMMIT.
 * PostgreSQL PREPARE parses the untouched parameterized statement; EXECUTE
 * passes separately quoted *values*, including SQL NULL. No $n substitution.
 * Query-result JSON aggregation preserves bigint/date/JSON shapes used by the
 * executor without implementing a wire driver. Default runs do not log SQL.
 * Opt-in --diagnose logs command classes, template/frame hashes, SQLSTATE and
 * fixed known sentinels, plus fixed adapter/transaction phase enums. It never
 * logs SQL, parameters, raw output or arbitrary messages. The transport accepts
 * only finite SQL categories.
 * Error diagnostics and result markers share one in-container pipe. Separate
 * stdout/stderr delivery cannot order a diagnostic relative to its marker.
 */
function client(application = `executor-${++clientNumber}`) {
  const diagnosticLease=correlatedDiagnostics.lease();
  const emit=(token,phase,code)=>{if(diagnosing)correlatedDiagnostics.emit(token,phase,code);};
  const process = spawn('docker', psqlArgs(db, application, true, true), { stdio:['pipe','pipe','pipe'] });
  process.stdout.setEncoding('utf8'); // Preserve multibyte characters split across transport chunks.
  let buffer = '', pending = null, ended = false, serial = 0;
  const completion = new Promise(resolve => process.once('close', resolve));
  process.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const at = buffer.indexOf('\n'), line = buffer.slice(0, at).replace(/\r$/, ''); buffer = buffer.slice(at + 1);
      if (!pending) continue;
      if (line.startsWith(pending.marker + ' ')) {
        const current = pending; pending = null; clearTimeout(current.timeout);
        const [, failed, code] = line.split(' ');
        if (failed === 'true') {
          const diagnostic = current.output.map(line => line.match(/^ERROR:\s+([A-Z0-9]{5}):\s+(.+)$/)).find(Boolean);
          const error = !diagnostic || diagnostic[1] !== code ? new Error('SYNTHETIC_ERROR_FRAME_INVALID') : Object.assign(new Error(diagnostic[2]), { code });
          emit(current.queryToken,'error_frame',code);
          diagnose('client-error-frame',{application,statement:current.statement,marker:current.marker,code,output:current.output},error);
          current.reject(error);
        } else {
          try {
            const rows = current.rowStatement ? JSON.parse(current.output.filter(Boolean).join('\n')) : [];
            const command = current.rowStatement ? current.command : current.output.find(line => /^(BEGIN|SET|COMMIT|ROLLBACK)$/.test(line));
            assert(command, 'actual PostgreSQL control command tag is present');
            current.resolve({ rows, rowCount: current.rowStatement ? rows.length : null, command });
          } catch (error) {
            emit(current.queryToken,'invalid_frame');
            diagnose('client-invalid-result',{application,statement:current.statement,marker:current.marker,output:current.output.map(line=>line.startsWith('[')?`JSON line (${line.length} characters)`:line.slice(0,500))},error);
            current.reject(new Error('INVALID_SYNTHETIC_CLIENT_RESULT'));
          }
        }
      } else pending.output.push(line);
    }
  });
  // Only Docker transport diagnostics can use this stream now. They never
  // provide a database error message or get attached to another SQL request.
  process.stderr.setEncoding('utf8');
  process.stderr.on('data',text=>diagnose('docker-stderr',{application,text:text.slice(0,1000)}));
  process.stdin.on('error', () => {});
  process.on('error', error => { emit(pending?.queryToken,'process_error'); diagnose('client-process-error',{application},error); if (pending) { clearTimeout(pending.timeout); pending.reject(error); pending = null; } });
  process.on('close', (code,signal) => {
    ended = true; clients.delete(api);
    if (pending) { emit(pending.queryToken,'process_close'); diagnose('client-process-close',{application,code,signal,statement:pending.statement,output:pending.output}); clearTimeout(pending.timeout); pending.reject(new Error('SYNTHETIC_CONNECTION_CLOSED')); pending = null; }
  });
  function parameter(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') { assert(Number.isFinite(value)); return String(value); }
    if (typeof value === 'object') value = JSON.stringify(value);
    assert.equal(typeof value, 'string'); assert(!value.includes('\0'));
    return quote(value);
  }
  const api = {
    application,
    async query(text, params = []) {
      assert(!ended, 'client remains leased'); assert.equal(pending, null, 'no interleaving within a transaction');
      assert.equal(typeof text, 'string'); assert(Array.isArray(params));
      const statement = text.trim().replace(/;\s*$/, ''), command = statement.match(/^([A-Z]+)/i)?.[1]?.toUpperCase();
      assert(['SELECT','WITH','INSERT','UPDATE','BEGIN','SET','COMMIT','ROLLBACK'].includes(command), `unexpected test-client command ${command}`);
      const rowStatement = ['SELECT','WITH','INSERT','UPDATE'].includes(command);
      if (['INSERT','UPDATE'].includes(command)) assert(/\breturning\b/i.test(statement), 'DML must return a bounded result');
      if (!rowStatement) assert.equal(params.length, 0, 'control statements have no values');
      observed.push({ application, command, parameterCount: params.length, placeholderCount: new Set(statement.match(/\$\d+/g) || []).size });
      const number = ++serial, marker = `__RESULT_${number}__`, name = `fixture_statement_${number}`;
      const wrapped = `WITH fixture_rows AS MATERIALIZED (${statement}) SELECT coalesce(json_agg(fixture_rows),'[]'::json) FROM fixture_rows`;
      // The markers are emitted after the actual execution and before any
      // cleanup statement can overwrite psql's ERROR/SQLSTATE variables.
      const input = rowStatement
        ? `PREPARE ${name} AS ${wrapped};\n\\if :ERROR\n\\echo ${marker} :ERROR :SQLSTATE\n\\else\nEXECUTE ${name}${params.length ? '(' + params.map(parameter).join(',') + ')' : ''};\n\\echo ${marker} :ERROR :SQLSTATE\n\\if :ERROR\n\\else\nDEALLOCATE ${name};\n\\endif\n\\endif\n`
        : `\\set QUIET off\n${statement};\n\\echo ${marker} :ERROR :SQLSTATE\n\\set QUIET on\n`;
      const queryToken=correlatedDiagnostics.begin(diagnosticLease);emit(queryToken,'query_start');
      return new Promise((resolve, reject) => {
        pending = { queryToken, marker, rowStatement, command, statement, resolve, reject, output: [], timeout: setTimeout(() => {
          emit(queryToken,'timeout');
          diagnose('client-timeout',{application,statement,output:pending?.output});
          pending = null; process.kill('SIGTERM'); reject(new Error('SYNTHETIC_QUERY_TIMEOUT'));
        }, 20_000) };
        process.stdin.write(input);
      }).then(result=>{emit(queryToken,'query_success','00000');return result;},error=>{emit(queryToken,'query_failure',error.code);throw error;});
    },
    async release() { if (!ended) process.stdin.end('\\q\n'); await completion; clients.delete(api); },
    async destroy() { if (!ended) process.kill('SIGTERM'); await completion; },
  };
  clients.add(api); return api;
}

function snapshot(note = '合成轮廓') {
  const steps = Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k => [k,'']));
  return { baseline:{outline:note,root_flow:'',steps}, optimized:{outline:'',root_flow:'',steps:{...steps}},
    reasons:{outline:'',root_flow:'',...steps}, execution:{}, process:{}, review:{}, status:'baseline',photo_ids:[],archive_url:null };
}
const visit = (id, source = 'appointment') => ({ assignmentSource:source, visitId:`${source === 'appointment' ? 'booking' : 'frontdesk'}:${id}` });
function row(id, stylist = 'alice', status = 0, source = 'appointment') {
  return {source,visitId:visit(id,source).visitId,id:String(id),staffUsername:stylist,store:STORE,bookingDate:DATE,status};
}
function lifecycle(sourceRow, patch = {}) {
  const values = {allowed:true,policy_revision:POLICY,expires_at:new Date(Date.now()+3600_000).toISOString(),...patch};
  sql(`insert into design_private.lifecycle_decisions values(${quote(sourceRow.source)},${quote(sourceRow.visitId)},${quote(digest(sourceRow))},
    ${values.allowed},${quote(values.policy_revision)},${quote(values.expires_at)}) on conflict(assignment_source,visit_id) do update set
    row_sha256=excluded.row_sha256,allowed=excluded.allowed,policy_revision=excluded.policy_revision,expires_at=excluded.expires_at;`);
}
function source(id, stylist = 'alice', status = 0, sourceName = 'appointment') {
  if (sourceName === 'appointment') sql(`insert into public.bookings values(${id},${quote(stylist)},${quote(STORE)},${quote(DATE)},${status},'Synthetic Customer','13000000000');`);
  else sql(`insert into public.frontdesk_today_customers(id,business_date,store,customer_name,customer_phone,barber_name,status,created_by)
    values(${quote(id)},${quote(DATE)},${quote(STORE)},'Synthetic Customer','13000000000',${quote(stylist)},${quote(status)},'synthetic-fixture');`);
  const value = row(id,stylist,status,sourceName); lifecycle(value); return value;
}
function command(id, overrides = {}) {
  return {credential:TOKENS.manager,requestId:randomUUID(),expectedRevision:0,action:'bind',visit:visit(id),customerProfileId:'11',...overrides};
}
function approve(request, sourceRow, patch = {}) {
  const history = JSON.parse(sql(`select coalesce(json_agg(record order by revision),'[]') from design_private.binding_versions
    where assignment_source=${quote(request.visit.assignmentSource)} and visit_id=${quote(request.visit.visitId)};`));
  const prior = history.at(-1), basis = request.action === 'revoke' ? prior : sourceRow;
  const fixed = Object.fromEntries(['requestId','expectedRevision','action','visit','customerProfileId'].map(k => [k,request[k]]));
  const intent = {actor:{username:'manager',store:STORE},command:fixed,previousRevision:prior?.revision || 0,previousState:prior?.state || null,
    target:{customerProfileId:request.customerProfileId,store:basis.store,bookingDate:basis.bookingDate,
      visitKey:request.visit.assignmentSource === 'appointment' ? request.visit.visitId : `manual:${DATE}:${sourceRow.id}`,staffUsername:basis.staffUsername},
    sourceStatus:request.action === 'revoke' ? null : sourceRow.status,policyRevision:request.action === 'revoke' ? null : POLICY};
  const approval = `synthetic-independent-approval-${randomUUID()}`;
  const values = {intent,expiresAt:new Date(Date.now()+3600_000).toISOString(),revoked:false,...patch};
  sql(`insert into design_private.binding_approvals values(${quote(hash(approval))},${quote(randomUUID())},${quote(digest(values.intent))},
    ${json(values.intent)},${quote(values.expiresAt)},${values.revoked},null);`);
  return {...request,approval};
}
function archiveRequest(id, overrides = {}) {
  return {credential:TOKENS.alice,scope:{customerProfileId:'11',...visit(id)},requestId:randomUUID(),expectedLatestVersionId:null,snapshot:snapshot(),...overrides};
}

async function main() {
  docker(['image','inspect','postgres:17','--format','{{.Id}}']);
  const ownContainer = () => docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim();
  assert.equal(ownContainer(),'','unique fixture name is unused before starting');
  try {
    // Keep launch inside cleanup coverage: a CLI timeout/lost response does not
    // prove that Docker failed to create this exact labelled fixture container.
    docker(['run','--rm','--pull','never','-d','--network','none','--name',container,
      '--label',`design.executor.fixture=${container}`,
      '--tmpfs','/var/lib/postgresql/data:rw,size=268435456','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    await until(() => { try { return sql('select 1;','postgres') === '1'; } catch { return false; } },'isolated PostgreSQL startup');
    assert.equal(JSON.parse(docker(['inspect','--format','{{json .HostConfig.NetworkMode}}',container])),'none');
    assert.equal(docker(['inspect','--format','{{len .HostConfig.PortBindings}}',container]).trim(),'0');
    const mounts = JSON.parse(docker(['inspect','--format','{{json .Mounts}}',container]));
    assert(mounts.every(mount => mount.Type === 'tmpfs'), 'no persistent or host-mounted files');
    sql(`create database ${db};`,'postgres');
    await test('fixture refuses ordinary database and absent explicit fixture marker', () => {
      for (const [database,guarded] of [['postgres',true],[db,false]])
        assert.throws(() => sql(fixture,database,guarded), error => String(error.stderr).includes('SYNTHETIC_FIXTURE_REQUIRED'));
      assert.equal(count('pg_namespace',"nspname='design_private'"),0);
    });
    sql(fixture);
    for (const file of ['20260906033501_employee_booking_sessions.sql','20260805040356_frontdesk_today_reception.sql',
      '20261108052541_customer_design_archive.sql','20261108124519_customer_design_six_zone_execution.sql']) {
      sql(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    await test('persistent client binds quoted Unicode JSON and real SQL NULL without interpolation', async () => {
      const c = client('bridge-self-test');
      try {
        await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const special = {text:"合成 ' ; DROP TABLE public.staff; -- \\ :variable `whoami`\n\\g",array:[null,true,3]};
        const result = await c.query('select $1::jsonb as value,$2::text as absent,$3::text as empty',[special,null,'']);
        assert.deepEqual(result.rows,[{value:special,absent:null,empty:''}]);
        const unicode = '发型🙂跨块字符'.repeat(12_000);
        assert.equal((await c.query('select $1::text as value',[unicode])).rows[0].value,unicode,'large multibyte result survives transport chunk boundaries');
        await rejects(c.query('select 1/0 as value'),'22012');
        await c.query('ROLLBACK');
        assert.equal((await c.query('select 17 as version')).rows[0].version,17);
        await c.query('BEGIN'); await rejects(c.query('select 1/0 as value'),'22012');
        assert.equal((await c.query('COMMIT')).command,'ROLLBACK','aborted COMMIT is not fabricated into success');
        // Alternate real legacy sentinels and different SQLSTATEs repeatedly.
        // Every operation must preserve its own exact error, never a fallback
        // or a previous operation's independently delivered diagnostic.
        for (let i = 0; i < 128; i++) {
          const legacy = i % 2 === 0;
          const statement = legacy ? 'SELECT public.append_customer_design_version($1::jsonb,$2::text,$3::text) AS result' : 'SELECT 1/0 AS value';
          const expected = legacy ? {code:'22023',message:'CUSTOMER_DESIGN_AUTHOR_REQUIRED'} : {code:'22012',message:'division by zero'};
          let failure;
          try { await c.query(statement,legacy ? [{},'','manual'] : []); } catch (error) { failure = error; }
          assert.deepEqual(failure && {code:failure.code,message:failure.message},expected,`exact per-operation PostgreSQL diagnostic ${i}`);
        }
      } finally { await c.release(); }
    });
    if (process.argv.includes('--bridge-only')) return;
    await runExecutorTests();
    console.log(`PASS: ${passed} ${investigating?'focused legacy investigation':'real-PG17 executor integration'} tests; synthetic data only.`);
  } catch (error) {
    if (investigating) {
      diagnose('investigation-failure',{},error);
      try {
        if (ownContainer()===container && docker(['inspect','--format','{{index .Config.Labels "design.executor.fixture"}}',container]).trim()===container) {
          const state=JSON.parse(docker(['inspect','--format','{{json .State}}',container]));
          diagnose('container-state',{inspectionAvailable:true,running:state.Running,oomKilled:state.OOMKilled});
        } else diagnose('container-state',{inspectionAvailable:false});
      } catch { diagnose('container-state',{inspectionAvailable:false}); }
      for (const record of correlatedDiagnostics.snapshot()) console.error('SYNTHETIC_QUERY_DIAGNOSTIC '+JSON.stringify(record));
      for (const record of diagnosticRing) console.error('SYNTHETIC_DIAGNOSTIC '+JSON.stringify(record));
    }
    throw error;
  } finally {
    await Promise.allSettled([...clients].map(c => c.destroy()));
    const remaining = ownContainer();
    if (remaining) {
      assert.equal(remaining,container);
      assert.equal(docker(['inspect','--format','{{index .Config.Labels "design.executor.fixture"}}',container]).trim(),container,'cleanup targets only this run’s labelled container');
      docker(['stop','-t','0',container]);
    }
    await until(() => ownContainer() === '', 'unique fixture container removed');
    console.log('cleanup ok - exact labelled synthetic container is absent');
  }
}

async function runExecutorTests() {
  // The real executor is imported only after the isolation/fixture checks.
  const {createDesignPostgresExecutor} = await import('../packages/design-production-adapter/postgres-executor.mjs');
  const {createExplicitVisitLifecyclePolicy} = await import('../packages/design-production-adapter/lifecycle-policy.mjs');
  const reviewedPolicy = createExplicitVisitLifecyclePolicy({approvedPolicyRevisions:[POLICY]});
  const lifecyclePolicy = investigating ? {evaluate(input) {
    const decision=input?.decision,metadata={allowed:decision?.allowed,policyReviewed:decision?.policyRevision===POLICY,
      unexpired:Number.isFinite(decision?.expiresAt)&&decision.expiresAt>input?.now,clockFinite:Number.isFinite(input?.now)};
    // Inspection must not replace the real policy's own invalid-input error.
    try { metadata.rowDigestMatches=digest(input?.row)===decision?.rowSha256; } catch { /* Diagnostic only. */ }
    diagnose('lifecycle-policy',metadata);
    return reviewedPolicy.evaluate(input);
  }} : reviewedPolicy;
  function composition(options = {}) {
    const acquireClient = async () => {
      const c = client(options.application || `executor-${++clientNumber}`), query = c.query.bind(c);
      const wrapped = {release:c.release.bind(c), async query(text,params) {
        if (options.beforeQuery) await options.beforeQuery(text,params,c);
        const sequence=investigating?++diagnosticSequence:0,started=investigating?performance.now():0;
        if(investigating) diagnose('query-start',{sequence,statement:text});
        const result = await traced('leased-query',{application:c.application,statement:text},()=>query(text,params));
        if(investigating) diagnose('query-complete',{sequence,statement:text,elapsed:elapsedBucket(started),...queryState(text,result)});
        if (options.afterQuery) await options.afterQuery(text,params,result,c);
        return result;
      }};
      return wrapped;
    };
    const executor = createDesignPostgresExecutor({acquireClient,lifecyclePolicy:options.lifecyclePolicy || lifecyclePolicy,diagnostics});
    const binding = createVisitBindingAdapter(investigating ? {...executor,diagnostics,readTransaction:callback=>executor.readTransaction(tx=>{
      const instrumented={...tx};
      for(const [name,method] of [['restRows','source'],['readBindingHistory','history'],['readRequest','receipt'],['rpc','context'],['evaluateLifecycle','lifecycle']]) {
        instrumented[name]=async(...args)=>{
          const sequence=++diagnosticSequence,started=performance.now();diagnose('resolver-start',{sequence,method});
          try {
            const result=await tx[name](...args);
            diagnose('resolver-complete',{sequence,method,elapsed:elapsedBucket(started),rows:Array.isArray(result)?result.length:result===null?0:1});
            return result;
          } catch(error) {diagnose('resolver-failure',{sequence,method,elapsed:elapsedBucket(started)},error);throw error;}
        };
      }
      return callback(Object.freeze(instrumented));
    })} : {...executor,diagnostics});
    const employee = createProductionEmployeeAdapter({
      diagnostics,
      restRows:path => traced('employee-source',{table:path.split('?')[0]},()=>executor.readTransaction(tx => tx.restRows(path))),
      rpc:(name,input) => traced('employee-rpc',{name},()=>executor.readTransaction(tx => tx.rpc(name,input))),
      resolveVisitBinding:row=>traced('employee-binding',{source:row.source},()=>binding.resolveVisitBinding(row)),
    });
    const archive = createProductionArchiveAdapter({employeeAdapter:employee,transaction:executor.transaction});
    return {executor,binding,employee,archive};
  }
  const app = composition();
  sql(`insert into public.staff(username,store,position) values
    ('manager',${quote(STORE)},'manager'),('alice',${quote(STORE)},'stylist'),('bob',${quote(STORE)},'stylist');
    insert into public.customer_profiles(id,name,phone,shop_name) values
    (11,'Synthetic Customer','13000000000',${quote(STORE)}),(12,'Synthetic Customer','13000000000',${quote(STORE)});
    insert into design_private.binding_authorities select 'manager',${quote(STORE)},action,true from unnest(array['bind','reassign','revoke','restore']) action;`);
  function session(name, expires = Date.now()+3600_000) {
    const token = TOKENS[name], tokenHash = hash(token);
    sql(`insert into public.employee_booking_sessions(token_hash,username,store,expires_at)
      values(${quote(tokenHash)},${quote(name)},${quote(STORE)},${quote(new Date(expires).toISOString())})
      on conflict(token_hash) do update set expires_at=excluded.expires_at;`);
  }
  for (const name of Object.keys(TOKENS)) session(name);
  await test('actual employee adapter hashes opaque sessions and denies missing or inactive staff', async () => {
    assert.equal((await app.employee.authenticate(TOKENS.alice)).username,'alice');
    await rejects(app.employee.authenticate('synthetic-missing-session-'+ '0'.repeat(40)),'AUTHENTICATION_REQUIRED');
    sql("update public.staff set active=false where username='alice';");
    await rejects(app.employee.authenticate(TOKENS.alice),'AUTHENTICATION_REQUIRED');
    sql("update public.staff set active=true where username='alice';");
  });
  const firstRow = source(101), first = approve(command(101),firstRow);
  await test('known source status and matching name/phone never replace explicit binding authority', async () => {
    await rejects(app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_UNAVAILABLE');
    await rejects(app.binding.applyChange({...first,approval:'synthetic-no-such-approval'}),'BINDING_APPROVAL_REQUIRED');
    await rejects(app.binding.applyChange({...first,credential:TOKENS.alice}),'BINDING_OPERATOR_DENIED');
    assert.equal(count('design_private.binding_versions'),0);
  });
  await test('first binding uses exact approved intent and atomically appends a verified receipt', async () => {
    const result = await app.binding.applyChange(first);
    assert.equal(result.appliedRevision,1); assert.equal(result.replayed,false);
    assert.deepEqual(await app.binding.applyChange(first),{...result,replayed:true});
    assert.equal(count('design_private.binding_versions'),1); assert.equal(count('design_private.binding_requests'),1);
    assert.equal(count('design_private.binding_approvals',`consumed_request_id=${quote(first.requestId)}`),1);
    assert.equal((await app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)})).actor.username,'alice');
    await rejects(app.binding.applyChange({...first,customerProfileId:'12'}),'BINDING_REQUEST_CONFLICT');
  });
  await test('default lifecycle policy, stale source digest and unreviewed policy revisions deny', async () => {
    const denied = composition({lifecyclePolicy:createExplicitVisitLifecyclePolicy()});
    await rejects(denied.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_UNAVAILABLE');
    lifecycle(firstRow,{policy_revision:'unreviewed'});
    await rejects(app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_UNAVAILABLE');
    lifecycle(firstRow); sql("update public.bookings set status=1 where id=101;");
    await rejects(app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_UNAVAILABLE');
    sql("update public.bookings set status=0 where id=101;");
  });
  if(stage25) {
    const scope={customerProfileId:'11',...visit(101)};
    const dump=()=>{for(const event of correlatedDiagnostics.snapshot())console.log('SYNTHETIC_QUERY_DIAGNOSTIC '+JSON.stringify(event));for(const event of diagnosticRing)console.log('SYNTHETIC_DIAGNOSTIC '+JSON.stringify(event));};
    await test('Stage25 one real assignment lock denial calibration',async()=>{
      const baseline=correlatedDiagnostics.snapshot();const startQueryId=Math.max(0,...baseline.map(e=>e.queryId)),startMonotonic=Math.max(0,...baseline.map(e=>e.monotonicMs));
      const blocker=client('stage25-lock-holder');
      try {
        await blocker.query('BEGIN');await blocker.query('UPDATE public.bookings SET status=status WHERE id=$1 RETURNING id',[101]);
        const controlled=composition({beforeQuery:async(text,params,c)=>{if(text.includes('FROM public.bookings'))await c.query("SET LOCAL lock_timeout = '100ms'");}});
        await rejects(controlled.employee.gate.authorize(TOKENS.alice,scope),'RELATIONSHIP_UNAVAILABLE');
        assert(correlatedDiagnostics.snapshot().some(e=>e.queryId>startQueryId&&e.monotonicMs>=startMonotonic&&e.phase==='error_frame'&&e.sqlstate==='55P03'));
      } finally {await blocker.query('ROLLBACK');await blocker.release();dump();}
    });
    await test('Stage25 one lifecycle mismatch denial calibration',async()=>{
      lifecycle(row(101,'alice',1));const firstSequence=diagnosticSequence,priorEvents=new Set(diagnosticRing);
      try{await rejects(app.employee.gate.authorize(TOKENS.alice,scope),'RELATIONSHIP_UNAVAILABLE');assert(diagnosticSequence>firstSequence);assert(diagnosticRing.some(e=>!priorEvents.has(e)&&e.stage==='lifecycle-policy'&&e.rowDigestMatches===false));}
      finally{lifecycle(firstRow);dump();}
    });
    await test('Stage25 one isolated self-connection termination calibration',async()=>{
      const c=client('stage25-disconnect');
      try{await assert.rejects(c.query('SELECT pg_terminate_backend(pg_backend_pid()) AS terminated'));}
      finally{await c.destroy();dump();}
    });
    await test('Stage25 one restored-source legacy append, no replay or retry',async()=>{
      assert.equal(count('public.customer_design_versions'),0);
      const result=await app.archive.appendLegacyVersion(archiveRequest(101));
      assert.equal(result.version.versionNumber,1);assert.equal(count('public.customer_design_versions'),1);dump();
    });
    return;
  }
  let saved; const archive = archiveRequest(101);
  await test('actual legacy RPC preserves complete validated snapshot, CAS and original replay identity', async () => {
    saved = await app.archive.appendLegacyVersion(archive);
    assert.equal(saved.version.versionNumber,1); assert.equal(saved.version.previousVersionId,null);
    assert.deepEqual(saved.version.snapshot,archive.snapshot);
    const replay = await app.archive.appendLegacyVersion(archive);
    assert.equal(replay.alreadyApplied,true); assert.equal(replay.appliedVersionId,saved.appliedVersionId);
    await rejects(app.archive.appendLegacyVersion({...archive,snapshot:snapshot('changed payload')}),'ARCHIVE_REQUEST_CONFLICT');
    await rejects(app.archive.appendLegacyVersion(archiveRequest(101)),'ARCHIVE_VERSION_CONFLICT');
    const second = await app.archive.appendLegacyVersion(archiveRequest(101,{expectedLatestVersionId:saved.appliedVersionId}));
    assert.equal(second.version.previousVersionId,saved.appliedVersionId); assert.equal(second.version.versionNumber,2);
    assert.equal((await app.archive.appendLegacyVersion(archive)).appliedVersionId,saved.appliedVersionId);
    if(investigating) {
      let latest=second;
      for(let index=0;index<12;index++) {
        const next=await app.archive.appendLegacyVersion(archiveRequest(101,{expectedLatestVersionId:latest.appliedVersionId}));
        assert.equal(next.version.previousVersionId,latest.appliedVersionId);
        assert.equal(next.version.versionNumber,latest.version.versionNumber+1);latest=next;
      }
      console.log('investigation ok - 12 distinct correct-CAS appends completed without retry');
    }
  });
  if(investigating) return;
  await test('reassignment denies old stylist and requires an appended explicitly approved binding', async () => {
    const before = sql("select record::text from design_private.binding_versions where visit_id='booking:101' and revision=1;");
    sql("update public.bookings set barber_name='bob' where id=101;"); lifecycle(row(101,'bob'));
    await rejects(app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_UNAVAILABLE','RELATIONSHIP_DENIED');
    const reassignment = approve(command(101,{action:'reassign',expectedRevision:1}),row(101,'bob'));
    assert.equal((await app.binding.applyChange(reassignment)).appliedRevision,2);
    await rejects(app.employee.gate.authorize(TOKENS.alice,{customerProfileId:'11',...visit(101)}),'RELATIONSHIP_DENIED');
    assert.equal((await app.employee.gate.authorize(TOKENS.bob,{customerProfileId:'11',...visit(101)})).actor.username,'bob');
    assert.equal(sql("select record::text from design_private.binding_versions where visit_id='booking:101' and revision=1;"),before);
  });
  await test('binding revoke works after source deletion and restore needs the same fresh identity', async () => {
    const request = approve(command(101,{action:'revoke',expectedRevision:2}),row(101,'bob'));
    sql('delete from public.bookings where id=101;');
    assert.equal((await app.binding.applyChange(request)).appliedRevision,3);
    const restore = approve(command(101,{action:'restore',expectedRevision:3}),row(101,'bob'));
    await rejects(app.binding.applyChange(restore),'BINDING_SOURCE_AMBIGUOUS');
    source(101,'bob'); assert.equal((await app.binding.applyChange(restore)).appliedRevision,4);
  });
  await test('frontdesk real SQL NULL booking identity and UUID visit keys keep same-day visits distinct', async () => {
    for (const id of [randomUUID(),randomUUID()]) {
      const r = source(id,'alice','in_service','frontdesk');
      await app.binding.applyChange(approve(command(id,{visit:visit(id,'frontdesk')}),r));
      const result = await app.archive.appendLegacyVersion(archiveRequest(id,{scope:{customerProfileId:'11',...visit(id,'frontdesk')}}));
      assert.equal(result.version.scope.visitId,`frontdesk:${id}`);
    }
    assert.equal(count('public.customer_design_versions',"booking_id is null and visit_key like 'manual:%'"),2);
  });
  await test('fixture append-only constraints reject old binding, receipt and archive rewrites', async () => {
    for (const table of ['design_private.binding_versions','design_private.binding_requests','public.customer_design_versions','design_private.commit_checks'])
      assert.throws(() => sql(`delete from ${table};`), error => String(error.stderr).includes(table.startsWith('public.') ? 'CUSTOMER_DESIGN_IMMUTABLE' : 'DESIGN_APPEND_ONLY'));
  });
  await test('executor rejects arbitrary table/RPC/query shape and an escaped transaction handle', async () => {
    let handle;
    await app.executor.readTransaction(async tx => {
      handle = tx;
      for (const path of ['staff?select=*&username=eq.%22alice%22&limit=2','staff?select=username,store,active,employment_status&username=eq.%22alice%22&limit=2&limit=99',
        'bookings?select=id,barber_name,shop_name,date,status&id=eq.101%20OR%201=1&limit=2'])
        await rejects(tx.restRows(path),'PG_QUERY_NOT_ALLOWED');
      await rejects(tx.rpc('pg_read_file',{}),'PG_RPC_NOT_ALLOWED');
    });
    await rejects(handle.readRequest(randomUUID()),'PG_TRANSACTION_CLOSED');
  });
  await test('SQL values remain parameters and caller strings never enter statement text', async () => {
    const name = `synthetic' ; -- 中文`, token = 'synthetic-injection-token-'+'1'.repeat(50);
    sql(`insert into public.staff(username,store,position) values(${quote(name)},${quote(STORE)},'stylist');
      insert into public.employee_booking_sessions(token_hash,username,store,expires_at)
      values(${quote(hash(token))},${quote(name)},${quote(STORE)},clock_timestamp()+interval '1 hour');`);
    const checked = composition({beforeQuery(text) { assert(!text.includes(name)); assert(!text.includes(token)); }});
    assert.equal((await checked.employee.authenticate(token)).username,name);
    assert(observed.some(q => q.parameterCount > 0));
    assert(observed.every(q => q.parameterCount === q.placeholderCount),'all parameterized placeholders reach PREPARE/EXECUTE');
  });

  await runConcurrencyTests({app,composition,session});
}

async function runConcurrencyTests({app,composition,session}) {
  async function blocked(application) {
    await until(() => Number(sql(`select count(*) from pg_stat_activity where application_name=${quote(application)}
      and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`)) > 0, `${application} demonstrably waits on PostgreSQL locks`);
  }
  function paused(application, match) {
    const held = latch(), release = latch(); let used = false;
    const value = composition({application,async afterQuery(text) {
      if (!used && match(text)) { used = true; held.resolve(); await release.promise; }
    }});
    return {...value,held:held.promise,resume:release.resolve};
  }
  async function ready(pause, work) {
    await Promise.race([pause.held, work.then(() => { throw new Error('Expected transaction pause was not reached'); })]);
  }
  await test('real concurrent binding CAS has one winner, atomic receipt and unconsumed losing approval', async () => {
    const r = source(201), first = approve(command(201),r), second = approve(command(201),r);
    const winner = paused('binding-cas-first',text => text.startsWith('INSERT INTO design_private.binding_versions'));
    const a = winner.binding.applyChange(first); await ready(winner,a);
    const other = composition({application:'binding-cas-second'});
    const b = rejects(other.binding.applyChange(second),'BINDING_REVISION_CONFLICT');
    try { await blocked('binding-cas-second'); } finally { winner.resume(); }
    assert.equal((await a).appliedRevision,1); await b;
    assert.equal(count('design_private.binding_versions',"visit_id='booking:201'"),1);
    assert.equal(count('design_private.binding_requests',`request_id in (${quote(first.requestId)},${quote(second.requestId)})`),1);
    assert.equal(count('design_private.binding_approvals',`approval_hash=${quote(hash(second.approval))} and consumed_request_id is null`),1);
  });
  await test('real concurrent identical binding request returns one immutable applied revision', async () => {
    const r = source(202), request = approve(command(202),r);
    const winner = paused('binding-replay-first',text => text.startsWith('INSERT INTO design_private.binding_versions'));
    const a = winner.binding.applyChange(request); await ready(winner,a);
    const b = composition({application:'binding-replay-second'}).binding.applyChange(request);
    try { await blocked('binding-replay-second'); } finally { winner.resume(); }
    assert.equal((await a).replayed,false); assert.equal((await b).replayed,true);
    assert.equal(count('design_private.binding_versions',"visit_id='booking:202'"),1);
  });
  async function boundSource(id) { const r = source(id); await app.binding.applyChange(approve(command(id),r)); return r; }
  await test('real concurrent archive CAS has one winner through the actual legacy append RPC', async () => {
    await boundSource(203);
    const winner = paused('archive-cas-first',text => text.startsWith('SELECT public.append_customer_design_version'));
    const a = winner.archive.appendLegacyVersion(archiveRequest(203)); await ready(winner,a);
    const b = rejects(composition({application:'archive-cas-second'}).archive.appendLegacyVersion(archiveRequest(203)),'ARCHIVE_VERSION_CONFLICT');
    try { await blocked('archive-cas-second'); } finally { winner.resume(); }
    assert.equal((await a).saved,true); await b;
    assert.equal(count('public.customer_design_versions',"visit_key='booking:203'"),1);
  });
  await test('real concurrent same-request archive replay appends once and returns its original version', async () => {
    await boundSource(204); const request = archiveRequest(204);
    const winner = paused('archive-replay-first',text => text.startsWith('SELECT public.append_customer_design_version'));
    const a = winner.archive.appendLegacyVersion(request); await ready(winner,a);
    const b = composition({application:'archive-replay-second'}).archive.appendLegacyVersion(request);
    try { await blocked('archive-replay-second'); } finally { winner.resume(); }
    const first = await a, replay = await b;
    assert.equal(replay.alreadyApplied,true); assert.equal(replay.appliedVersionId,first.appliedVersionId);
    assert.equal(count('public.customer_design_versions',"visit_key='booking:204'"),1);
  });
  await test('failure after binding insert rolls back history, request receipt and approval consumption together', async () => {
    const r = source(205), request = approve(command(205),r);
    const failing = composition({afterQuery(text) { if(text.startsWith('INSERT INTO design_private.binding_requests')) throw new Error('synthetic-after-append-failure'); }});
    await rejects(failing.binding.applyChange(request),'BINDING_OUTCOME_UNCERTAIN');
    assert.equal(count('design_private.binding_versions',"visit_id='booking:205'"),0);
    assert.equal(count('design_private.binding_requests',`request_id=${quote(request.requestId)}`),0);
    assert.equal(count('design_private.binding_approvals',`approval_hash=${quote(hash(request.approval))} and consumed_request_id is null`),1);
    assert.equal((await app.binding.applyChange(request)).appliedRevision,1);
  });
  await test('failure after actual archive RPC rolls back the SQL append rather than returning success', async () => {
    await boundSource(206);
    const failing = composition({afterQuery(text) { if(text.startsWith('SELECT public.append_customer_design_version')) throw new Error('synthetic-after-rpc-failure'); }});
    await rejects(failing.archive.appendLegacyVersion(archiveRequest(206)),'ARCHIVE_OUTCOME_UNCERTAIN');
    assert.equal(count('public.customer_design_versions',"visit_key='booking:206'"),0);
  });
  await test('a lost COMMIT acknowledgement stays uncertain while exact readback proves one applied archive', async () => {
    await boundSource(207); const request = archiveRequest(207); let wrote = false;
    const uncertain = composition({afterQuery(text) {
      if(text.startsWith('SELECT public.append_customer_design_version')) wrote = true;
      if(wrote && text === 'COMMIT') throw new Error('synthetic-commit-ack-lost');
    }});
    await rejects(uncertain.archive.appendLegacyVersion(request),'ARCHIVE_OUTCOME_UNCERTAIN');
    assert.equal(count('public.customer_design_versions',`request_id=${quote(request.requestId)}`),1);
    const replay = await app.archive.appendLegacyVersion(request); assert.equal(replay.alreadyApplied,true);
    assert.equal(count('public.customer_design_versions',`request_id=${quote(request.requestId)}`),1);
  });
  await test('session revocation that commits first blocks the read then denies archive authorization', async () => {
    await boundSource(208); const mutator = client('session-revoker');
    try {
      await mutator.query('BEGIN');
      await mutator.query('UPDATE public.employee_booking_sessions SET expires_at=clock_timestamp()-interval \'1 second\' WHERE token_hash=$1 RETURNING token_hash',[hash(TOKENS.alice)]);
      const denied = rejects(composition({application:'session-revoked-append'}).archive.appendLegacyVersion(archiveRequest(208)),'AUTHENTICATION_REQUIRED');
      await blocked('session-revoked-append'); await mutator.query('COMMIT'); await denied;
      assert.equal(count('public.customer_design_versions',"visit_key='booking:208'"),0);
    } finally { await mutator.release(); session('alice'); }
  });
  await test('source reassignment that commits first denies the old binding after an observed row-lock wait', async () => {
    await boundSource(209); const mutator = client('source-reassigner');
    try {
      await mutator.query('BEGIN');
      await mutator.query("UPDATE public.bookings SET barber_name='bob' WHERE id=$1 RETURNING id",[209]);
      const denied = rejects(composition({application:'source-reassigned-append'}).archive.appendLegacyVersion(archiveRequest(209)),'RELATIONSHIP_UNAVAILABLE','RELATIONSHIP_DENIED');
      await blocked('source-reassigned-append'); await mutator.query('COMMIT'); await denied;
      assert.equal(count('public.customer_design_versions',"visit_key='booking:209'"),0);
    } finally { await mutator.release(); }
  });
  await test('append-first source locks prevent an independent reassignment committing until append ends', async () => {
    await boundSource(210);
    const winner = paused('archive-lock-holder',text => text.startsWith('SELECT public.append_customer_design_version'));
    const a = winner.archive.appendLegacyVersion(archiveRequest(210)); await ready(winner,a);
    const mutator = client('waiting-source-reassigner');
    try {
      await mutator.query('BEGIN');
      const change = mutator.query("UPDATE public.bookings SET barber_name='bob' WHERE id=$1 RETURNING id",[210]);
      try { await blocked('waiting-source-reassigner'); } finally { winner.resume(); }
      assert.equal((await a).saved,true); await change; await mutator.query('COMMIT');
      assert.equal(count('public.customer_design_versions',"visit_key='booking:210'"),1);
      await rejects(app.archive.appendLegacyVersion(archiveRequest(210)),'RELATIONSHIP_UNAVAILABLE','RELATIONSHIP_DENIED');
    } finally { winner.resume(); await mutator.release(); }
  });
  await test('lifecycle revocation committed first is reread after lock contention and never authorizes a write', async () => {
    await boundSource(211); const mutator = client('lifecycle-revoker');
    try {
      await mutator.query('BEGIN');
      await mutator.query("UPDATE design_private.lifecycle_decisions SET allowed=false WHERE visit_id=$1 RETURNING visit_id",['booking:211']);
      const denied = rejects(composition({application:'lifecycle-revoked-append'}).archive.appendLegacyVersion(archiveRequest(211)),'RELATIONSHIP_UNAVAILABLE');
      await blocked('lifecycle-revoked-append'); await mutator.query('COMMIT'); await denied;
      assert.equal(count('public.customer_design_versions',"visit_key='booking:211'"),0);
    } finally { await mutator.release(); }
  });
  await test('independent approval revocation wins its row lock and rolls back binding without consumption', async () => {
    const r = source(212), request = approve(command(212),r), mutator = client('approval-revoker');
    try {
      await mutator.query('BEGIN');
      await mutator.query('UPDATE design_private.binding_approvals SET revoked=true WHERE approval_hash=$1 RETURNING approval_hash',[hash(request.approval)]);
      const denied = rejects(composition({application:'approval-revoked-binding'}).binding.applyChange(request),'BINDING_APPROVAL_REQUIRED');
      await blocked('approval-revoked-binding'); await mutator.query('COMMIT'); await denied;
      assert.equal(count('design_private.binding_versions',"visit_id='booking:212'"),0);
      assert.equal(count('design_private.binding_approvals',`approval_hash=${quote(hash(request.approval))} and consumed_request_id is null`),1);
    } finally { await mutator.release(); }
  });
  await test('deferred database deadline rejects expiry in the final JavaScript-to-COMMIT gap', async () => {
    const r = source(213), expiry = Date.now()+10_000, request = approve(command(213),r,{expiresAt:new Date(expiry).toISOString()});
    let delayed = false;
    const failing = composition({async beforeQuery(text) {
      if(text === 'COMMIT' && !delayed) {
        assert(Date.now() < expiry,'approval is live when the deliberate final-COMMIT delay begins');
        delayed = true; await sleep(expiry-Date.now()+100);
      }
    }});
    await rejects(failing.binding.applyChange(request),'BINDING_OUTCOME_UNCERTAIN');
    assert.equal(delayed,true);
    assert.equal(count('design_private.binding_versions',"visit_id='booking:213'"),0);
    assert.equal(count('design_private.binding_requests',`request_id=${quote(request.requestId)}`),0);
    assert.equal(count('design_private.binding_approvals',`approval_hash=${quote(hash(request.approval))} and consumed_request_id is null`),1);
  });
  await test('executor fails closed when its required deferred database trigger is unavailable', async () => {
    sql('alter table design_private.commit_checks disable trigger design_commit_deadline;');
    try { await rejects(app.executor.readTransaction(() => true),'PG_CONTRACT_UNAVAILABLE'); }
    finally { sql('alter table design_private.commit_checks enable trigger design_commit_deadline;'); }
  });
}
main().catch(error => { console.error(stage25?'STAGE25_FAILED_SEE_SAFE_DIAGNOSTIC_RING':error.stack); process.exitCode = 1; });
