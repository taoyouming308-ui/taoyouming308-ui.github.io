/** Offline deterministic attribution tests. No database, network, credentials or real data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createDesignDiagnostics } from '../packages/shared/design-diagnostics.mjs';
import { createProductionEmployeeAdapter } from '../packages/design-production-adapter/employee-adapter.mjs';
import { createVisitBindingAdapter, VISIT_BINDING_SCHEMA } from '../packages/design-production-adapter/visit-binding.mjs';
import { createDesignPostgresExecutor, DESIGN_POSTGRES_CONTRACT } from '../packages/design-production-adapter/postgres-executor.mjs';

globalThis.fetch = () => { throw new Error('Offline diagnostics fixtures only'); };
const NOW = Date.parse('2026-11-15T12:00:00Z'), DATE = '2026-11-15', STORE = '自由手艺人';
const PRIVATE = 'synthetic-private-diagnostic-canary';
const TOKEN = PRIVATE + '-00000000000000000000000000000000';
const SCOPE = {customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const ROW = {source:'appointment',visitId:'booking:101',id:'101',staffUsername:'synthetic-stylist',store:STORE,bookingDate:DATE,status:0};
const PHASES = {
  employee:['session_read','session_validate','staff_read','staff_validate','assignment_read','assignment_validate','binding_read','binding_validate','profile_read','profile_validate','context_rpc','context_validate'],
  access_gate:['authenticate','assignment','customer_visit','final_expiry'],
  visit_binding:['history','assignment','lifecycle','profile_context','final_consistency','transaction'],
  postgres:['acquire','begin','transaction_setup','callback','guard','commit','rollback','release'],
};
const OUTCOMES = ['start','success','failure'];
const FAILURE_KINDS = ['none','dependency','missing','ambiguous','invalid_shape','invalid_value','expired','inactive','mismatch','not_configured','unknown'];
const clone = value => structuredClone(value);
const dependencyFailure = () => { throw Object.assign(new Error(PRIVATE),{code:PRIVATE,detail:PRIVATE}); };
const result = (rows=[],command='SELECT') => ({rows,rowCount:rows.length,command});
function validateEvents(events) {
  assert(events.length > 0);
  for (const event of events) {
    assert(Object.isFrozen(event));
    assert.deepEqual(Object.keys(event).sort(),['component','failureKind','outcome','phase']);
    assert(Object.hasOwn(PHASES,event.component));
    assert(PHASES[event.component].includes(event.phase));
    assert(OUTCOMES.includes(event.outcome));
    assert(FAILURE_KINDS.includes(event.failureKind));
  }
  const serialized=JSON.stringify(events);
  for(const forbidden of [PRIVATE,TOKEN,STORE,'booking:101','customer_design_resolve_context','token_hash','SELECT','synthetic-stylist']) assert(!serialized.includes(forbidden));
}
const has = (events,component,phase,outcome='failure',failureKind='dependency') => events.some(event =>
  event.component===component && event.phase===phase && event.outcome===outcome && event.failureKind===failureKind);
const rejectedCode = async promise => {
  try { await promise; } catch(error) { return error.code; }
  assert.fail('Expected operation to reject');
};

function employeeFixture(diagnostics) {
  const state={
    session:{username:ROW.staffUsername,store:STORE,expires_at:new Date(NOW+3600000).toISOString()},
    staff:{username:ROW.staffUsername,store:STORE,active:true,employment_status:'active'},
    booking:{id:101,barber_name:ROW.staffUsername,shop_name:STORE,date:DATE,status:0},
    profile:{id:11,shop_name:STORE,card_packages:[],service_history:[],private_payload:PRIVATE},
    binding:{assignmentSource:'appointment',visitId:'booking:101',customerProfileId:'11',store:STORE,bookingDate:DATE,visitKey:'booking:101',active:true,revision:'synthetic-binding-1'},
    rows:(table,rows)=>rows, bindings:rows=>rows, context:value=>value,
  };
  const adapter=createProductionEmployeeAdapter({diagnostics,clock:()=>NOW,
    async restRows(path) {
      const table=path.split('?')[0];
      const key={employee_booking_sessions:'session',staff:'staff',bookings:'booking',customer_profiles:'profile'}[table];
      assert(key,'Only fixture read categories are supported');
      return clone(state.rows(table,[state[key]]));
    },
    async resolveVisitBinding() { return clone(state.bindings([state.binding])); },
    async rpc(name) {
      assert.equal(name,'customer_design_resolve_context');
      return clone(state.context({customer_profile_id:11,booking_id:101,booking_date:DATE,visit_key:'booking:101',store:STORE,private_payload:PRIVATE}));
    },
  });
  return {state,adapter};
}
const tableFault = (table,transform) => state => {state.rows=(name,rows)=>name===table?transform(rows):rows;};
const employeeCases = [
  ['session dependency',tableFault('employee_booking_sessions',dependencyFailure),'session_read','dependency','authenticate'],
  ['session missing',tableFault('employee_booking_sessions',()=>[]),'session_read','missing','authenticate'],
  ['session ambiguous',tableFault('employee_booking_sessions',rows=>[...rows,...rows]),'session_read','ambiguous','authenticate'],
  ['session malformed',state=>{state.session.expires_at=PRIVATE;},'session_validate','invalid_value','authenticate'],
  ['staff dependency',tableFault('staff',dependencyFailure),'staff_read','dependency','authenticate'],
  ['staff missing',tableFault('staff',()=>[]),'staff_read','missing','authenticate'],
  ['staff ambiguous',tableFault('staff',rows=>[...rows,...rows]),'staff_read','ambiguous','authenticate'],
  ['staff inactive',state=>{state.staff.active=false;},'staff_validate','mismatch','authenticate'],
  ['source dependency',tableFault('bookings',dependencyFailure),'assignment_read','dependency','assignment'],
  ['source missing',tableFault('bookings',()=>[]),'assignment_read','missing','assignment'],
  ['source ambiguous',tableFault('bookings',rows=>[...rows,...rows]),'assignment_read','ambiguous','assignment'],
  ['source nonarray',tableFault('bookings',()=>({private:PRIVATE})),'assignment_read','invalid_shape','assignment'],
  ['source row malformed',tableFault('bookings',()=>[[]]),'assignment_read','invalid_shape','assignment'],
  ['source id invalid',state=>{state.booking.id=102;},'assignment_validate','invalid_value','assignment'],
  ['source date invalid',state=>{state.booking.date='2026-02-30';},'assignment_validate','invalid_value','assignment'],
  ['source status invalid',state=>{state.booking.status=2;},'assignment_validate','invalid_value','assignment'],
  ['binding dependency',state=>{state.bindings=dependencyFailure;},'binding_read','dependency','assignment'],
  ['binding missing',state=>{state.bindings=()=>[];},'binding_read','missing','assignment'],
  ['binding ambiguous',state=>{state.bindings=rows=>[...rows,...rows];},'binding_read','ambiguous','assignment'],
  ['binding nonarray',state=>{state.bindings=()=>null;},'binding_read','invalid_shape','assignment'],
  ['binding malformed',state=>{state.bindings=()=>[{private:PRIVATE}];},'binding_validate','mismatch','assignment'],
  ['binding wrong visit',state=>{state.binding.visitKey='booking:102';},'binding_validate','mismatch','assignment'],
  ['profile dependency',tableFault('customer_profiles',dependencyFailure),'profile_read','dependency','customer_visit'],
  ['profile missing',tableFault('customer_profiles',()=>[]),'profile_read','missing','customer_visit'],
  ['profile ambiguous',tableFault('customer_profiles',rows=>[...rows,...rows]),'profile_read','ambiguous','customer_visit'],
  ['profile malformed',tableFault('customer_profiles',()=>[null]),'profile_read','invalid_shape','customer_visit'],
  ['profile mismatch',state=>{state.profile.id=12;},'profile_validate','mismatch','customer_visit'],
  ['context dependency',state=>{state.context=dependencyFailure;},'context_rpc','dependency','customer_visit'],
  ['context malformed',state=>{state.context=()=>null;},'context_validate','mismatch','customer_visit'],
  ['context mismatch',state=>{state.context=value=>({...value,booking_id:102});},'context_validate','mismatch','customer_visit'],
  ['later source dependency',state=>{let count=0;state.rows=(table,rows)=>table==='bookings'&&++count===2?dependencyFailure():rows;},'assignment_read','dependency','customer_visit'],
];
for(const [name,change,phase,kind,gatePhase] of employeeCases) test(`employee attribution: ${name}`,async()=>{
  const events=[];
  const silent=employeeFixture(), observed=employeeFixture(event=>events.push(event));
  change(silent.state);change(observed.state);
  const expected=gatePhase==='authenticate'?'AUTHENTICATION_REQUIRED':'RELATIONSHIP_UNAVAILABLE';
  assert.equal(await rejectedCode(silent.adapter.gate.authorize(TOKEN,SCOPE)),expected);
  assert.equal(await rejectedCode(observed.adapter.gate.authorize(TOKEN,SCOPE)),expected);
  assert(has(events,'employee',phase,'failure',kind));
  assert(has(events,'access_gate',gatePhase));
  assert.equal(events.filter(event=>event.component==='employee'&&event.outcome==='failure').length,1);
  validateEvents(events);
});

test('fixed-enum helper freezes exact records and rejects arbitrary fields and values',()=>{
  const events=[];
  for(const [component,phases] of Object.entries(PHASES)) {
    const emit=createDesignDiagnostics(event=>events.push(event),component);
    for(const phase of phases) for(const outcome of OUTCOMES) for(const kind of FAILURE_KINDS) emit(phase,outcome,kind,{private:PRIVATE});
    const count=events.length;
    emit(PRIVATE,'failure','dependency');emit(phases[0],PRIVATE,'dependency');emit(phases[0],'failure',PRIVATE);
    assert.equal(events.length,count);
  }
  const count=events.length;
  createDesignDiagnostics(event=>events.push(event),PRIVATE)('acquire','start');
  createDesignDiagnostics(undefined,'postgres')('acquire','start');
  assert.equal(events.length,count);validateEvents(events);
});

const observerModes={
  throws:()=>{throw new Error(PRIVATE);},
  rejects:()=>Promise.reject(new Error(PRIVATE)),
  crossRealmRejects:()=>runInNewContext('Promise.reject(new Error(marker))',{marker:PRIVATE}),
  thenableRejects:()=>({then(_resolve,reject){reject(new Error(PRIVATE));}}),
  thenableThrows:()=>({then(){throw new Error(PRIVATE);}}),
  thenableGetterThrows:()=>Object.defineProperty({},'then',{get(){throw new Error(PRIVATE);}}),
  // Never settles. Awaiting it would leave the test pending and fail the runner.
  pending:()=>new Promise(()=>{}),
  thenablePending:()=>({then(){}}),
  mutation:event=>{event.phase=PRIVATE;},
};
for(const [name,observer] of Object.entries(observerModes)) test(`observer ${name} cannot change employee grant or denial`,async()=>{
  const events=[];const diagnostics=event=>{events.push(event);return observer(event);};
  const good=employeeFixture(diagnostics);
  assert.deepEqual(await good.adapter.gate.authorize(TOKEN,SCOPE),{actor:{username:ROW.staffUsername,store:STORE},scope:SCOPE});
  const bad=employeeFixture(diagnostics);tableFault('bookings',()=>[])(bad.state);
  assert.equal(await rejectedCode(bad.adapter.gate.authorize(TOKEN,SCOPE)),'RELATIONSHIP_UNAVAILABLE');
  await new Promise(resolve=>setImmediate(resolve)); // Rejected promises/thenables must be handled.
  validateEvents(events);
});

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function bindingFixture(diagnostics) {
  const visit={assignmentSource:'appointment',visitId:'booking:101'};
  const record={schemaVersion:VISIT_BINDING_SCHEMA,visit,revision:1,previousRevision:0,requestId:'10000000-0000-4000-8000-000000000001',action:'bind',state:'active',customerProfileId:'11',store:STORE,bookingDate:DATE,visitKey:visit.visitId,staffUsername:ROW.staffUsername,actor:{username:'synthetic-manager',store:STORE},authorityReceiptId:'synthetic-receipt',sourceStatus:0,policyRevision:'synthetic-reviewed-v1',createdAt:NOW};
  const command={requestId:record.requestId,expectedRevision:0,action:'bind',visit,customerProfileId:'11'};
  const receipt={requestId:record.requestId,actor:record.actor,visit,commandSha256:digest({actor:record.actor,command}),appliedRevision:1,recordSha256:digest(record)};
  const employee=employeeFixture();
  const tx={
    async restRows(path) {
      if(path.startsWith('bookings?'))return clone([employee.state.booking]);
      if(path.startsWith('staff?'))return clone([employee.state.staff]);
      if(path.startsWith('customer_profiles?'))return clone([employee.state.profile]);
      assert.fail('Unexpected binding fixture read');
    },
    async rpc(){return {customer_profile_id:11,booking_id:101,booking_date:DATE,visit_key:'booking:101',store:STORE};},
    async readBindingHistory(){return clone([record]);},async readRequest(){return clone(receipt);},
    async evaluateLifecycle(){return {allowed:true,policyRevision:'synthetic-reviewed-v1'};},
  };
  const state={run:callback=>callback(tx)};
  return {state,tx,adapter:createVisitBindingAdapter({diagnostics,clock:()=>NOW,readTransaction:callback=>state.run(callback)})};
}
const bindingCases=[
  ['history dependency',f=>{f.tx.readBindingHistory=dependencyFailure;},'history','dependency','BINDING_READ_UNAVAILABLE'],
  // Existing VisitBindingError wrappers erased the original cause already.
  // Preserve the phase, but do not infer dependency versus validation from it.
  ['history invalid',f=>{f.tx.readBindingHistory=async()=>null;},'history','unknown','BINDING_HISTORY_INVALID'],
  ['receipt mismatch',f=>{f.tx.readRequest=async()=>null;},'history','unknown','BINDING_RECEIPT_INVALID'],
  ['source dependency',f=>{f.tx.restRows=dependencyFailure;},'assignment','unknown','BINDING_SOURCE_UNAVAILABLE'],
  ['lifecycle dependency',f=>{f.tx.evaluateLifecycle=dependencyFailure;},'lifecycle','unknown','BINDING_LIFECYCLE_UNCONFIRMED'],
  ['context dependency',f=>{f.tx.rpc=dependencyFailure;},'profile_context','unknown','BINDING_PROFILE_MISMATCH'],
  ['transaction dependency',f=>{f.state.run=dependencyFailure;},'transaction','dependency','BINDING_READ_UNAVAILABLE'],
];
for(const [name,change,phase,kind,expected] of bindingCases) test(`binding attribution: ${name}`,async()=>{
  const events=[];const silent=bindingFixture(),observed=bindingFixture(event=>events.push(event));
  change(silent);change(observed);
  assert.equal(await rejectedCode(silent.adapter.resolveVisitBinding(ROW)),expected);
  assert.equal(await rejectedCode(observed.adapter.resolveVisitBinding(ROW)),expected);
  assert(has(events,'visit_binding',phase,'failure',kind));validateEvents(events);
});
test('binding success emits fixed consistency phases without payloads',async()=>{
  const events=[],f=bindingFixture(event=>events.push(event));
  assert.equal((await f.adapter.resolveVisitBinding(ROW))[0].customerProfileId,'11');
  assert(has(events,'visit_binding','final_consistency','success','none'));validateEvents(events);
});

function postgresFixture(diagnostics) {
  const state={fail:null,released:0};
  const client={
    async query(sql) {
      if(state.fail==='begin'&&sql.startsWith('BEGIN'))dependencyFailure();
      if(state.fail==='commit'&&sql==='COMMIT')dependencyFailure();
      if(state.fail==='rollback'&&sql==='ROLLBACK')dependencyFailure();
      if(sql.startsWith('BEGIN')||sql.startsWith('SET ')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:null,command:sql.split(' ')[0]};
      if(sql.includes('pg_advisory_xact_lock'))return result([{locked:null}]);
      if(sql.includes('runtime_contract'))return result([{version:state.fail==='transaction_setup'?'invalid':DESIGN_POSTGRES_CONTRACT,deadline_guard:true}]);
      if(sql.includes('binding_versions'))return result([]);
      assert.fail('Unexpected transaction fixture query');
    },
    async release(){state.released++;if(state.fail==='release')dependencyFailure();},
  };
  const executor=createDesignPostgresExecutor({diagnostics,acquireClient:async()=>{if(state.fail==='acquire')dependencyFailure();return client;}});
  const operation=()=>executor.writeTransaction(async tx=>{
    if(state.fail==='callback'||state.fail==='rollback')dependencyFailure();
    if(state.fail==='guard')await tx.beforeCommit(dependencyFailure);
    return 7;
  });
  return {state,executor,operation};
}
for(const [phase,expected] of [['acquire','PG_TRANSACTION_FAILED'],['begin','PG_BEGIN_UNCERTAIN'],['transaction_setup','PG_CONTRACT_UNAVAILABLE'],['callback','PG_TRANSACTION_FAILED'],['guard','PG_TRANSACTION_FAILED'],['commit','PG_COMMIT_UNCERTAIN'],['rollback','PG_ROLLBACK_UNCERTAIN']]) test(`transaction attribution: ${phase}`,async()=>{
  const events=[],silent=postgresFixture(),observed=postgresFixture(event=>events.push(event));
  silent.state.fail=observed.state.fail=phase;
  assert.equal(await rejectedCode(silent.operation()),expected);
  assert.equal(await rejectedCode(observed.operation()),expected);
  assert(has(events,'postgres',phase));validateEvents(events);
});
test('release failure remains diagnostic and cannot replace an acknowledged success',async()=>{
  const events=[],f=postgresFixture(event=>events.push(event));f.state.fail='release';
  assert.equal(await f.operation(),7);assert.equal(f.state.released,1);
  assert(has(events,'postgres','commit','success','none'));assert(has(events,'postgres','release'));validateEvents(events);
});
test('executor propagates observer to the same-connection binding resolver',async()=>{
  const events=[],observer=event=>events.push(event),f=postgresFixture(observer);
  await f.executor.readTransaction(async tx=>{assert.equal(tx.diagnostics,observer);assert.deepEqual(await tx.resolveVisitBinding(ROW),[]);});
  assert(has(events,'visit_binding','history','success','none'));assert(has(events,'postgres','callback','success','none'));validateEvents(events);
});
for(const [name,observer] of Object.entries(observerModes)) test(`observer ${name} cannot change transaction success or failure`,async()=>{
  const f=postgresFixture(observer);assert.equal(await f.operation(),7);
  f.state.fail='callback';assert.equal(await rejectedCode(f.operation()),'PG_TRANSACTION_FAILED');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.released,2);
});
