/** TEST-ONLY isolated PostgreSQL 17 harness; never a runtime driver or installer.
 * Uses only an existing image, no network, ports, host mounts, secrets or live data.
 * Keep ordered same-pipe psql diagnostics and UTF-8 decoding with the Stage6 bridge.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createDesignPostgresExecutor} from '../../packages/design-production-adapter/postgres-executor.mjs';
import {createExplicitVisitLifecyclePolicy} from '../../packages/design-production-adapter/lifecycle-policy.mjs';
import {createVisitBindingAdapter} from '../../packages/design-production-adapter/visit-binding.mjs';
import {createPostgresFixtureTiming,fixtureErrorKind} from './design-postgres-timing.mjs';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(canonical(v));
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const json=v=>`${quote(JSON.stringify(v))}::jsonb`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function createDesignPostgresFixture({timingObserver,profileDatabase=false}={}){
 const timing=createPostgresFixtureTiming(timingObserver);
 assert.equal(typeof profileDatabase,'boolean','profileDatabase is a trusted test-only option');
 const db='design_executor_synthetic';
 const container=`design-workflow-synthetic-${process.pid}-${randomUUID().slice(0,8)}`;
 const STORE='自由手艺人',DATE='2026-11-15',POLICY='synthetic-explicit-lifecycle-v1';
 const TOKENS=Object.fromEntries(['manager','alice','bob'].map(name=>[name,`synthetic-${name}-${'0'.repeat(64)}`]));
 const clients=new Set(),observed=[];let clientNumber=0,cleaned=false;
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
 function psqlArgs(database=db,application='fixture-admin',guarded=true,persistent=false,stage7=true,role='postgres'){
  assert(typeof role==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(role),'trusted synthetic role identifier');
  const command=['psql','-X','-q','-A','-t','-w','-h','127.0.0.1','-U',role,'-d',database,'-v',`ON_ERROR_STOP=${persistent?'0':'1'}`,'-v','VERBOSITY=verbose'];
  return ['exec','-i','-e',`PGAPPNAME=${application}`,'-e',`PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=10000 -c timezone=UTC -c standard_conforming_strings=on${guarded?' -c design_executor.synthetic_fixture=offline-stage6-only':''}${stage7?' -c design_workflow.synthetic_fixture=offline-stage7-only':''}`,container,...(persistent?['sh','-c','exec "$@" 2>&1','synthetic-psql',...command]:command)];
 }
 function sql(text,database=db,guarded=true,stage7=true){return execFileSync('docker',psqlArgs(database,'fixture-admin',guarded,false,stage7),{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:25000}).trim();}
 // Real LOGIN connection, not postgres followed by SET ROLE. Test-only; caller
 // supplies fixed synthetic SQL, never a runtime request or production target.
 function sqlAsRole(text,role){return execFileSync('docker',psqlArgs(db,'fixture-role-check',true,false,true,role),{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:25000}).trim();}
 async function until(predicate,description){for(let i=0;i<150;i++){if(await predicate())return;await sleep(30);}throw Error(`Timed out: ${description}`);}
/**
 * One psql/libpq connection per lease, retained from BEGIN through COMMIT.
 * PostgreSQL PREPARE parses the untouched parameterized statement; EXECUTE
 * passes separately quoted *values*, including SQL NULL. No $n substitution.
 * Query-result JSON aggregation preserves bigint/date/JSON shapes used by the
 * executor without implementing a wire driver. No SQL statement/parameter is
 * logged. The transport understands only the executor's finite SQL categories.
 * Error diagnostics and result markers share one in-container pipe. Separate
 * stdout/stderr delivery cannot order a diagnostic relative to its marker.
 */
function client(application = `executor-${++clientNumber}`, role='postgres') {
  const createdAt=timing.now();let spawnedAt=createdAt,firstFrameReported=false;
  const process = spawn('docker', psqlArgs(db, application, true, true, true, role), { stdio:['pipe','pipe','pipe'] });
  process.once('spawn',()=>{spawnedAt=timing.now();});
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
        current.metrics.frameAt=timing.now();const parseStarted=timing.now();
        const [, failed, code] = line.split(' ');
        if (failed === 'true') {
          const diagnostic = current.output.map(line => line.match(/^ERROR:\s+([A-Z0-9]{5}):\s+(.+)$/)).find(Boolean);
          if (!diagnostic || diagnostic[1] !== code) current.reject(new Error('SYNTHETIC_ERROR_FRAME_INVALID'));
          else current.reject(Object.assign(new Error(diagnostic[2]), { code }));
        } else {
          try {
            const rows = current.rowStatement ? JSON.parse(current.output.filter(Boolean).join('\n')) : [];
            const command = current.rowStatement ? current.command : current.output.find(line => /^(BEGIN|SET|SET CONSTRAINTS|COMMIT|ROLLBACK)$/.test(line));
            assert(command, 'actual PostgreSQL control command tag is present');
            current.resolve({ rows, rowCount: current.rowStatement ? rows.length : null, command });
          } catch { current.reject(new Error('INVALID_SYNTHETIC_CLIENT_RESULT')); }
        }
        current.metrics.parseMs=timing.now()-parseStarted;
      } else pending.output.push(line);
    }
  });
  // Only Docker transport diagnostics can use this stream now. They never
  // provide a database error message or get attached to another SQL request.
  process.stderr.resume();
  process.stdin.on('error', () => {});
  process.on('error', error => { if (pending) { clearTimeout(pending.timeout); pending.reject(error); pending = null; } });
  process.on('close', () => {
    ended = true; clients.delete(api);
    if (pending) { clearTimeout(pending.timeout); pending.reject(new Error('SYNTHETIC_CONNECTION_CLOSED')); pending = null; }
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
      const started=timing.now(),metrics={frameAt:null,parseMs:null};let outcome='success',errorKind='none';
      try{return await new Promise((resolve, reject) => {
        pending = { marker, rowStatement, command, resolve, reject, metrics, output: [], timeout: setTimeout(() => {
          pending = null; process.kill('SIGTERM'); reject(new Error('SYNTHETIC_QUERY_TIMEOUT'));
        }, 20_000) };
        process.stdin.write(input);
      });}catch(error){outcome='error';errorKind=fixtureErrorKind(error);throw error;}finally{
        const details={command,outcome,errorKind};
        if(metrics.frameAt!==null){
          if(!firstFrameReported){firstFrameReported=true;timing.emit('lease_spawn',{...details,durationMs:spawnedAt-createdAt});timing.emit('lease_first_frame',{...details,durationMs:metrics.frameAt-createdAt});}
          timing.emit('query_frame',{...details,durationMs:metrics.frameAt-started});
        }
        if(metrics.parseMs!==null)timing.emit('result_parse',{...details,durationMs:metrics.parseMs});
        const totalMs=timing.now()-started;timing.emit('query_total',{...details,durationMs:totalMs});
        // Fixed template classification, never SQL/template text in the event.
        // Counts the history row-read, not successful completion of later JS replay.
        if(statement==='SELECT revision,record,sha256,previous_sha256,receipt_key FROM design_private.workflow_versions WHERE scope_key=$1 ORDER BY revision LIMIT 1002 FOR SHARE')timing.emit('workflow_history_scan',{...details,durationMs:totalMs});
      }
    },
    async release() { const started=timing.now();if (!ended) process.stdin.end('\\q\n'); await completion; clients.delete(api);timing.emit('lease_closed',{durationMs:timing.now()-started,outcome:'success',errorKind:'none'});timing.emit('lease_total',{durationMs:timing.now()-createdAt,outcome:'success',errorKind:'none'}); },
    async destroy() { if (!ended) process.kill('SIGTERM'); await completion; },
  };
  clients.add(api); return api;
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

 const acquireClient=async()=>client();
 const lifecyclePolicy=createExplicitVisitLifecyclePolicy({approvedPolicyRevisions:[POLICY]});
 const executor=createDesignPostgresExecutor({acquireClient,lifecyclePolicy});
 const binding=createVisitBindingAdapter(executor);
 const scopeA={customerProfileId:'11',...visit(101)},scopeB={customerProfileId:'12',...visit(102)};
 function session(name,expires=Date.now()+3600000){sql(`insert into public.employee_booking_sessions(token_hash,username,store,expires_at) values(${quote(hash(TOKENS[name]))},${quote(name)},${quote(STORE)},${quote(new Date(expires).toISOString())}) on conflict(token_hash) do update set expires_at=excluded.expires_at;`);}
 async function bind(id,{customerProfileId='11',staffUsername='alice',sourceName='appointment',status=sourceName==='appointment'?0:'in_service'}={}){
  const value=row(id,staffUsername,status,sourceName);
  return binding.applyChange(approve(command(id,{visit:visit(id,sourceName),customerProfileId}),value));
 }
 async function seedSource(id,options={}){
  const {customerProfileId='11',staffUsername='alice',sourceName='appointment',status=sourceName==='appointment'?0:'in_service'}=options;
  const sourceRow=source(id,staffUsername,status,sourceName);await bind(id,{customerProfileId,staffUsername,sourceName,status});return {customerProfileId,...visit(id,sourceName)};
 }
 async function seed(){
  sql(`insert into public.staff(username,store,position) values ('manager',${quote(STORE)},'manager'),('alice',${quote(STORE)},'stylist'),('bob',${quote(STORE)},'stylist');
   insert into public.customer_profiles(id,name,phone,shop_name) values (11,'Synthetic Customer','13000000000',${quote(STORE)}),(12,'Synthetic Customer','13000000000',${quote(STORE)});
   insert into design_private.binding_authorities select 'manager',${quote(STORE)},action,true from unnest(array['bind','reassign','revoke','restore']) action;`);
  for(const name of Object.keys(TOKENS))session(name);
  await seedSource(101);await seedSource(102,{customerProfileId:'12'});
 }
 const ownContainer=()=>docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim();
 async function cleanup(){
  if(cleaned)return;
  await Promise.allSettled([...clients].map(c=>c.destroy()));
  const remaining=ownContainer();
  if(remaining){assert.equal(remaining,container);assert.equal(docker(['inspect','--format','{{index .Config.Labels "design.workflow.fixture"}}',container]).trim(),container,'cleanup only this exact labelled fixture');docker(['stop','-t','0',container]);}
  await until(()=>ownContainer()==='','exact synthetic container removal');cleaned=true;
 }
 docker(['image','inspect','postgres:17','--format','{{.Id}}']);
 assert.equal(ownContainer(),'','unique fixture container name unused');
 try{
  // Launch is inside cleanup coverage because a lost Docker response is uncertain.
  docker(['run','--rm','--pull','never','-d','--network','none','--name',container,'--label',`design.workflow.fixture=${container}`,'--tmpfs','/var/lib/postgresql/data:rw,size=268435456','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17',...(profileDatabase?['-c','shared_preload_libraries=pg_stat_statements','-c','pg_stat_statements.track=all','-c','pg_stat_statements.track_planning=on','-c','track_functions=all']:[])]);
  await until(()=>{try{return sql('select 1;','postgres')==='1';}catch{return false;}},'isolated PostgreSQL startup');
  assert.equal(JSON.parse(docker(['inspect','--format','{{json .HostConfig.NetworkMode}}',container])),'none');
  assert.equal(docker(['inspect','--format','{{len .HostConfig.PortBindings}}',container]).trim(),'0');
  assert(JSON.parse(docker(['inspect','--format','{{json .Mounts}}',container])).every(m=>m.Type==='tmpfs'),'no persistent or host mounts');
  sql(`create database ${db};`,'postgres');
  if(profileDatabase)sql('CREATE EXTENSION pg_stat_statements;');
  sql(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage6-executor-fixture.sql',import.meta.url),'utf8'));
  for(const file of ['20260906033501_employee_booking_sessions.sql','20260805040356_frontdesk_today_reception.sql','20261108052541_customer_design_archive.sql','20261108124519_customer_design_six_zone_execution.sql'])sql(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
  const fixture=readFileSync(new URL('../../packages/design-production-adapter/drafts/stage7-workflow-fixture.sql',import.meta.url),'utf8');
  for(const [database,guarded,stage7] of [['postgres',true,true],[db,false,true],[db,true,false]])assert.throws(()=>sql(fixture,database,guarded,stage7),error=>String(error.stderr).includes('SYNTHETIC_WORKFLOW_FIXTURE_REQUIRED'));
  sql(fixture);assert.throws(()=>sql(fixture),error=>String(error.stderr).includes('SYNTHETIC_WORKFLOW_FIXTURE_REQUIRED'));
  const candidateFixture=readFileSync(new URL('../../packages/design-production-adapter/drafts/stage8-candidate-fixture.sql',import.meta.url),'utf8');
  for(const [database,guarded,stage7] of [['postgres',true,true],[db,false,true],[db,true,false]])assert.throws(()=>sql(candidateFixture,database,guarded,stage7),error=>String(error.stderr).includes('SYNTHETIC_CANDIDATE_FIXTURE_REQUIRED'));
  sql(candidateFixture);assert.throws(()=>sql(candidateFixture),error=>String(error.stderr).includes('SYNTHETIC_CANDIDATE_FIXTURE_REQUIRED'));
  await seed();
  return Object.freeze({acquireClient,sql,sqlAsRole,client,clientForRole:(role,application)=>client(application,role),seed,seedSource,bind,cleanup,scopeA,scopeB,credential:TOKENS.alice,tokens:TOKENS,store:STORE,policy:POLICY,lifecyclePolicy,session,lifecycle,sourceRow:row,visit,approve,command,observed,container,db});
 }catch(error){try{await cleanup();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Synthetic setup failed and cleanup could not be verified');}throw error;}
}
