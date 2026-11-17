import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesignPostgresExecutor,DESIGN_POSTGRES_CONTRACT} from '../packages/design-production-adapter/postgres-executor.mjs';
import {createExplicitVisitLifecyclePolicy,visitLifecycleRowDigest} from '../packages/design-production-adapter/lifecycle-policy.mjs';
import {createProductionEmployeeAdapter} from '../packages/design-production-adapter/employee-adapter.mjs';
import {VisitListError} from '../packages/design-production-adapter/visit-list-service.mjs';
globalThis.fetch=()=>{throw Error('Offline fixtures only');};
const TOKEN='synthetic-token-0000000000000000000000000000';
const HASH=createHash('sha256').update(TOKEN).digest('hex');
const NOW=Date.now(),STORE='自由手艺人';
const ROW={source:'appointment',visitId:'booking:101',id:'101',staffUsername:'alice',store:STORE,bookingDate:'2026-11-15',status:0};
const decision={rowSha256:visitLifecycleRowDigest(ROW),allowed:true,policyRevision:'synthetic-reviewed-v1',expiresAt:NOW+3600000};
const policy=()=>createExplicitVisitLifecyclePolicy({approvedPolicyRevisions:['synthetic-reviewed-v1']});
const visit={assignmentSource:'appointment',visitId:'booking:101'};
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
function fixture(){
  const state={calls:[],releases:[],released:false,override:null,commitError:null,rollbackError:null,contract:true,guard:true,session:true};
  const result=(rows=[],command='SELECT')=>({rows,rowCount:rows.length,command});
  const client={async query(sql,values=[]){
    state.calls.push({sql,values:structuredClone(values)});
    if(state.override){const changed=await state.override(sql,values);if(changed!==undefined)return changed;}
    if(sql==='COMMIT'&&state.commitError)throw state.commitError;
    if(sql==='ROLLBACK'&&state.rollbackError)throw state.rollbackError;
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET '))return {rows:[],rowCount:null,command:sql.split(' ')[0]};
    if(sql.includes('pg_advisory_xact_lock'))return result([{locked:null}]);
    if(sql.includes('runtime_contract'))return result([{version:state.contract?DESIGN_POSTGRES_CONTRACT:'wrong',deadline_guard:state.guard}]);
    if(sql==='SELECT clock_timestamp()::text AS now')return result([{now:new Date(NOW).toISOString()}]);
    if(sql.includes('public.employee_booking_sessions'))return result(state.session?[{row:{username:'alice',store:STORE,position:'stylist',expires_at:new Date(NOW+3600000).toISOString()}}]:[]);
    if(sql.includes('public.staff'))return result([{row:{username:values[0],store:STORE,position:'stylist',active:true,employment_status:'active'}}]);
    if(sql.includes('public.bookings'))return result([{row:{id:101,barber_name:'alice',shop_name:STORE,date:ROW.bookingDate,status:0}}]);
    if(sql.includes('public.frontdesk_today_customers'))return result([{row:{id:values[0],barber_name:'alice',store:STORE,business_date:ROW.bookingDate,status:'arrived'}}]);
    if(sql.includes('public.customer_profiles'))return result([{row:{id:11,shop_name:STORE,card_packages:[],service_history:[]}}]);
    if(sql.includes('customer_design_resolve_context'))return result([{result:{customer_profile_id:11,booking_id:values[1],booking_date:values[2],visit_key:values[3],store:STORE,name:'not returned',phone:'not returned'}}]);
    if(sql.includes('lifecycle_decisions'))return result([{row_sha256:decision.rowSha256,allowed:true,policy_revision:decision.policyRevision,expires_at:new Date(decision.expiresAt).toISOString()}]);
    if(sql.includes('binding_versions'))return result([]);
    if(sql.includes('binding_requests'))return result([]);
    if(sql.includes('binding_authorities'))return result([{allowed:true}]);
    throw Error('Fixture missing query');
  },async release(error){state.releases.push(error);state.released=true;}};
  return {state,client,executor:createDesignPostgresExecutor({acquireClient:async()=>client,lifecyclePolicy:policy()})};
}
test('default executor and default lifecycle policy deny without I/O',async()=>{
  await rejects(createDesignPostgresExecutor().readTransaction(()=>[]),'PG_NOT_CONFIGURED');
  assert.throws(()=>createExplicitVisitLifecyclePolicy().evaluate({row:ROW,decision,now:NOW}),{code:'LIFECYCLE_UNCONFIRMED'});
});
test('explicit current policy matches exact source identity and raw status only',()=>{
  assert.deepEqual(policy().evaluate({row:ROW,decision,now:NOW}),{allowed:true,policyRevision:decision.policyRevision});
  for(const changed of [{...ROW,status:1},{...ROW,staffUsername:'bob'},{...ROW,store:'向里造型'},{...ROW,bookingDate:'2026-11-16'}])assert.throws(()=>policy().evaluate({row:changed,decision,now:NOW}),{code:'LIFECYCLE_UNCONFIRMED'});
});
test('unknown revision revoked stale expired malformed decisions deny',()=>{
  for(const change of [{allowed:false},{expiresAt:NOW},{policyRevision:'import-whitelist'},{rowSha256:'f'.repeat(64)},{owner:true}])assert.throws(()=>policy().evaluate({row:ROW,decision:{...decision,...change},now:NOW}),{code:'LIFECYCLE_UNCONFIRMED'});
  assert.throws(()=>createExplicitVisitLifecyclePolicy({approvedPolicyRevisions:['x','x']}),{code:'LIFECYCLE_CONFIGURATION_INVALID'});
  assert.throws(()=>visitLifecycleRowDigest({...ROW,name:'do not infer'}),{code:'LIFECYCLE_INVALID_ROW'});
});
test('real pg-style controls allow null rowCount and fixed ordered transaction setup',async()=>{
  const f=fixture();assert.equal(await f.executor.readTransaction(async()=>7),7);
  assert.equal(f.state.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert(f.state.calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'))<f.state.calls.findIndex(c=>c.sql.includes('runtime_contract')));
  assert.equal(f.state.calls.at(-1).sql,'COMMIT');assert.deepEqual(f.state.releases,[undefined]);
});
test('schema version and required deferred DB deadline guard fail closed',async()=>{
  for(const key of ['contract','guard']){const f=fixture();f.state[key]=false;let called=false;await rejects(f.executor.readTransaction(()=>{called=true;}),'PG_CONTRACT_UNAVAILABLE');assert.equal(called,false);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');}
});
test('actual employee adapter authenticates custom token only through parameterized rows',async()=>{
  const f=fixture();await f.executor.readTransaction(async tx=>{
    const user=await createProductionEmployeeAdapter(tx).authenticate(TOKEN);assert.equal(user.username,'alice');
  });
  assert(!JSON.stringify(f.state.calls).includes(TOKEN));
  const call=f.state.calls.find(c=>c.sql.includes('employee_booking_sessions'));assert.deepEqual(call.values,[HASH]);assert(call.sql.includes('FOR SHARE'));assert(call.sql.includes('clock_timestamp()'));
});
test('literal quote/SQL content in a username remains one parameter',async()=>{
  const f=fixture(),name="a' OR true --";await f.executor.readTransaction(tx=>tx.restRows(`staff?select=username,store,active,employment_status&username=eq.${encodeURIComponent(JSON.stringify(name))}&limit=2`));
  const call=f.state.calls.find(c=>c.sql.includes('public.staff'));assert.deepEqual(call.values,[name]);assert(!call.sql.includes(name));
});
test('rest translator is exact allowlist, not arbitrary SQL or PostgREST proxy',async()=>{
  const paths=['https://evil.invalid/staff?select=*&limit=2','staff?select=*&username=eq.%22alice%22&limit=2','staff?select=username,store,active,employment_status&username=eq.%22alice%22&limit=2&owner=true','staff?select=username,store,active,employment_status&username=eq.%22alice%22&limit=2&limit=2','bookings?select=id,barber_name,shop_name,date,status&id=eq.101%20OR%20TRUE&limit=2','bookings?select=id,barber_name,shop_name,date,status&id=eq.101&limit=2#x'];
  for(const path of paths){const f=fixture();await rejects(f.executor.readTransaction(tx=>tx.restRows(path)),'PG_QUERY_NOT_ALLOWED');assert(!f.state.calls.some(c=>c.sql.includes('public.')));}
});
test('source/profile reads use fixed SQL and shared locks',async()=>{
  const f=fixture();await f.executor.readTransaction(async tx=>{
    await tx.restRows('bookings?select=id,barber_name,shop_name,date,status&id=eq.101&limit=2');
    await tx.restRows('frontdesk_today_customers?select=id,barber_name,store,business_date,status&id=eq.10000000-0000-4000-8000-000000000001&limit=2');
    await tx.restRows('customer_profiles?select=id,shop_name&id=eq.11&limit=2');
  });assert(f.state.calls.filter(c=>c.sql.includes('public.')).every(c=>c.sql.includes('FOR SHARE')));
});
test('day locators use two fixed locked queries and keep actor/date only in parameters',async()=>{
  const f=fixture(),name="a' OR true --",frontdesk={assignmentSource:'frontdesk',visitId:'frontdesk:10000000-0000-4000-8000-000000000001'};
  f.state.override=sql=>sql.includes('AS "assignmentSource"')?{command:'SELECT',rows:[sql.includes('public.bookings')?visit:frontdesk],rowCount:1}:undefined;
  const found=await f.executor.readTransaction(tx=>tx.listAssignedVisits({actor:{username:name,store:STORE},date:ROW.bookingDate}));
  assert.deepEqual(found,[visit,frontdesk]);assert(Object.isFrozen(found)&&found.every(Object.isFrozen));
  const calls=f.state.calls.filter(c=>c.sql.includes('AS "assignmentSource"'));assert.equal(calls.length,2);
  for(const c of calls){assert.deepEqual(c.values,[name,STORE,ROW.bookingDate]);assert(!c.sql.includes(name));assert(c.sql.endsWith('LIMIT 51 FOR SHARE'));}
  assert(!f.state.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)));
});
test('day locator capability rejects malformed date/actor/identity additions before source SQL',async()=>{
  for(const input of [
    {actor:{username:'alice',store:STORE},date:'2026-02-30'},
    {actor:{username:'alice',store:STORE},date:'0000-01-01'},
    {actor:{username:'alice',store:STORE,owner:true},date:ROW.bookingDate},
    {actor:{username:'alice',store:STORE},date:ROW.bookingDate,scope:{}},
  ]){const f=fixture();await rejects(f.executor.readTransaction(tx=>tx.listAssignedVisits(input)),'PG_INVALID_INPUT');assert(!f.state.calls.some(c=>c.sql.includes('public.')));}
});
test('combined day locator capacity is 50 and overflow retains only the fixed safe error class',async()=>{
  for(const n of [49,50]){
    const f=fixture();f.state.override=sql=>sql.includes('AS "assignmentSource"')?{command:'SELECT',rows:sql.includes('public.bookings')?Array.from({length:n},(_,i)=>({assignmentSource:'appointment',visitId:`booking:${i+1}`})):[{assignmentSource:'frontdesk',visitId:'frontdesk:10000000-0000-4000-8000-000000000001'}],rowCount:sql.includes('public.bookings')?n:1}:undefined;
    const work=f.executor.readTransaction(tx=>tx.listAssignedVisits({actor:{username:'alice',store:STORE},date:ROW.bookingDate}));
    if(n===49)assert.equal((await work).length,50);else await assert.rejects(work,e=>e instanceof VisitListError&&e.code==='VISIT_LIST_LIMIT_EXCEEDED'&&e.message===e.code);
  }
  const f=fixture();f.state.override=sql=>{if(sql.includes('AS "assignmentSource"'))throw {name:'VisitListError',code:'VISIT_LIST_LIMIT_EXCEEDED',message:'private diagnostic'};};
  await rejects(f.executor.readTransaction(tx=>tx.listAssignedVisits({actor:{username:'alice',store:STORE},date:ROW.bookingDate})),'PG_TRANSACTION_FAILED');
});
test('bound display projection adds only the exact id/name/store selector',async()=>{
  const f=fixture();f.state.override=sql=>sql.includes("'name',name")?{command:'SELECT',rows:[{row:{id:11,name:'Synthetic Customer',shop_name:STORE}}],rowCount:1}:undefined;
  const found=await f.executor.readTransaction(tx=>tx.restRows('customer_profiles?select=id,name,shop_name&id=eq.11&limit=2'));
  assert.deepEqual(found,[{id:11,name:'Synthetic Customer',shop_name:STORE}]);
  const c=f.state.calls.find(c=>c.sql.includes('public.customer_profiles'));assert.deepEqual(c.values,['11']);assert(c.sql.endsWith('LIMIT 2 FOR SHARE'));assert(!c.sql.includes('phone'));
  const g=fixture();await rejects(g.executor.readTransaction(tx=>tx.restRows('customer_profiles?select=id,name,shop_name,phone&id=eq.11&limit=2')),'PG_QUERY_NOT_ALLOWED');
});
test('context RPC excludes secondary names and phones from returned value',async()=>{
  const f=fixture();const result=await f.executor.readTransaction(tx=>tx.rpc('customer_design_resolve_context',{p_customer_profile_id:11,p_booking_id:null,p_booking_date:ROW.bookingDate,p_visit_key:'manual:'+ROW.bookingDate+':10000000-0000-4000-8000-000000000001'}));
  assert.equal(result.booking_id,null);assert(!Object.hasOwn(result,'phone'));assert(!Object.hasOwn(result,'name'));assert(Object.isFrozen(result));
});
test('unknown RPC and archive writes in read-only operation deny',async()=>{
  const f=fixture();await rejects(f.executor.readTransaction(tx=>tx.rpc('dangerous_function',{})),'PG_RPC_NOT_ALLOWED');
  const g=fixture();await rejects(g.executor.readTransaction(tx=>tx.rpc('append_customer_design_version',{})),'PG_WRITE_NOT_ALLOWED');
});
test('read-only mode cannot consume approvals or append binding versions',async()=>{
  for(const fn of [tx=>tx.consumeApproval({}),tx=>tx.appendVersion({}),tx=>tx.beforeCommit(()=>{})]){const f=fixture();await assert.rejects(f.executor.readTransaction(fn));assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');}
});
test('missing binding is not synthesized from valid source or customer info',async()=>{
  const f=fixture();assert.deepEqual(await f.executor.readTransaction(tx=>tx.resolveVisitBinding(ROW)),[]);
});
test('lifecycle reads require locked exact current server decision and explicit policy',async()=>{
  const f=fixture();assert.deepEqual(await f.executor.readTransaction(tx=>tx.evaluateLifecycle(ROW)),{allowed:true,policyRevision:decision.policyRevision});
  assert(f.state.calls.find(c=>c.sql.includes('lifecycle_decisions')).sql.endsWith('FOR SHARE'));
  const g=fixture();const executor=createDesignPostgresExecutor({acquireClient:async()=>g.client});await rejects(executor.readTransaction(tx=>tx.evaluateLifecycle(ROW)),'LIFECYCLE_UNCONFIRMED');
});
test('operator authority is an exact independent row, not an employee position',async()=>{
  const f=fixture();assert.equal(await f.executor.readTransaction(tx=>tx.authorizeOperator({actor:{username:'alice',store:STORE},action:'bind',visit,customerProfileId:'11'})),true);
  const call=f.state.calls.find(c=>c.sql.includes('binding_authorities'));assert.deepEqual(call.values,['alice',STORE,'bind']);
});
test('callback exception and failed hook roll back before release without retry',async()=>{
  for(const hook of [false,true]){const f=fixture();await rejects(f.executor.writeTransaction(async tx=>{if(hook)await tx.beforeCommit(()=>{throw Error('sensitive database message');});else throw Error('sensitive database message');}),'PG_TRANSACTION_FAILED');assert.equal(f.state.calls.filter(c=>c.sql.startsWith('BEGIN')).length,1);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');assert(f.state.releases[0] instanceof Error);}
});
test('transaction handle is unusable after success and after failure',async()=>{
  for(const failure of [false,true]){const f=fixture();let tx;try{await f.executor.readTransaction(x=>{tx=x;if(failure)throw Error('fail');});}catch{}
    await rejects(tx.readBindingHistory(visit),'PG_TRANSACTION_CLOSED');await rejects(tx.beforeCommit(()=>{}),'PG_TRANSACTION_CLOSED');}
});
test('shared client lease is rejected without releasing the active owner',async()=>{
  const f=fixture();let leave,entered;const enteredP=new Promise(r=>entered=r),wait=new Promise(r=>leave=r);
  const first=f.executor.readTransaction(async()=>{entered();await wait;});await enteredP;
  await rejects(f.executor.readTransaction(()=>1),'PG_CLIENT_ALREADY_LEASED');assert.equal(f.state.releases.length,0);leave();await first;assert.equal(f.state.releases.length,1);
});
test('concurrent queries on one lease fail closed',async()=>{
  const f=fixture();let leave;f.state.override=async sql=>{if(sql.includes('binding_versions'))await new Promise(r=>leave=r);};
  await assert.rejects(f.executor.readTransaction(async tx=>{const p=tx.readBindingHistory(visit);await rejects(tx.readRequest('10000000-0000-4000-8000-000000000001'),'PG_CONCURRENT_CLIENT_USE');leave();await p;throw Error('roll back');}));
  assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');
});
test('malformed driver result does not get returned as a success',async()=>{
  const f=fixture();f.state.override=sql=>sql.includes('binding_versions')?{command:'SELECT',rows:[],rowCount:4}:undefined;
  await rejects(f.executor.readTransaction(tx=>tx.readBindingHistory(visit)),'PG_RESULT_INVALID');assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');
});
test('SQL diagnostics are sanitized and known conflicts are enumerated',async()=>{
  for(const code of ['40001','40P01','55P03','23505','42501']){const f=fixture();f.state.override=sql=>{if(sql.includes('binding_versions'))throw Object.assign(Error('customer secret'),{code});};await rejects(f.executor.readTransaction(tx=>tx.readBindingHistory(visit)),code);}
  const f=fixture();f.state.override=sql=>{if(sql.includes('binding_versions'))throw Error('private db credentials');};await assert.rejects(f.executor.readTransaction(tx=>tx.readBindingHistory(visit)),e=>e.code==='PG_TRANSACTION_FAILED'&&!e.message.includes('private'));
});
test('lost COMMIT acknowledgement is uncertain, discarded and never automatically retried',async()=>{
  const f=fixture();f.state.commitError=Error('connection lost');await assert.rejects(f.executor.writeTransaction(()=>({saved:true})),e=>e.code==='PG_COMMIT_UNCERTAIN'&&e.outcome==='uncertain'&&e.retryable===false);
  assert.equal(f.state.calls.filter(c=>c.sql==='COMMIT').length,1);assert.equal(f.state.calls.filter(c=>c.sql.startsWith('BEGIN')).length,1);assert(f.state.releases[0] instanceof Error);
});
test('rollback transport failure is uncertain and no later client work is permitted',async()=>{
  const f=fixture();f.state.rollbackError=Error('lost');let tx;await rejects(f.executor.writeTransaction(x=>{tx=x;throw Error('abort');}),'PG_ROLLBACK_UNCERTAIN');await rejects(tx.readRequest('10000000-0000-4000-8000-000000000001'),'PG_TRANSACTION_CLOSED');
});
test('acknowledged commit is not relabeled a failure if pool release fails',async()=>{
  const f=fixture();f.client.release=()=>{throw Error('release');};assert.equal(await f.executor.readTransaction(()=>8),8);
});
test('forged adapter error name or known class with changed message cannot leak diagnostics',async()=>{
  const f=fixture();f.state.override=sql=>{if(sql.includes('binding_versions'))throw Object.assign(Error('private credential from driver'),{name:'ProductionArchiveError',code:'ARCHIVE_SCOPE_DENIED'});};
  await assert.rejects(f.executor.readTransaction(tx=>tx.readBindingHistory(visit)),e=>e.code==='PG_TRANSACTION_FAILED'&&!e.message.includes('private'));
  const {ProductionArchiveError}=await import('../packages/design-production-adapter/archive-adapter.mjs');
  const g=fixture();g.state.override=sql=>{if(sql.includes('binding_versions')){const e=new ProductionArchiveError('ARCHIVE_SCOPE_DENIED');e.message='private credential';e.secret='hidden';throw e;}};
  await assert.rejects(g.executor.readTransaction(tx=>tx.readBindingHistory(visit)),e=>e instanceof ProductionArchiveError&&e.message==='ARCHIVE_SCOPE_DENIED'&&!Object.hasOwn(e,'secret'));
});
test('exact legacy conflict sentinel maps safely while suffix diagnostics do not',async()=>{
  for(const [message,code] of [['CUSTOMER_DESIGN_REQUEST_REUSED','CUSTOMER_DESIGN_REQUEST_REUSED'],['CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED','CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED'],['CUSTOMER_DESIGN_REQUEST_REUSED secret','PG_TRANSACTION_FAILED']]){
    const f=fixture();f.state.override=sql=>{if(sql.includes('binding_versions'))throw Object.assign(Error(message),{code:'22023'});};await rejects(f.executor.readTransaction(tx=>tx.readBindingHistory(visit)),code);
  }
});
test('lease stays reserved until asynchronous release finishes',async()=>{
  const f=fixture();let leave,entered;const entering=new Promise(r=>entered=r),waiting=new Promise(r=>leave=r);
  f.client.release=async()=>{entered();await waiting;};const first=f.executor.readTransaction(()=>1);await entering;
  await rejects(f.executor.readTransaction(()=>2),'PG_CLIENT_ALREADY_LEASED');leave();assert.equal(await first,1);assert.equal(await f.executor.readTransaction(()=>3),3);
});
test('lost BEGIN acknowledgement discards the uncertain connection and never invokes callback',async()=>{
  const f=fixture();let called=false;f.state.override=sql=>{if(sql.startsWith('BEGIN'))throw Error('ack lost');};
  await assert.rejects(f.executor.readTransaction(()=>{called=true;}),e=>e.code==='PG_BEGIN_UNCERTAIN'&&e.outcome==='uncertain');assert.equal(called,false);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');assert(f.state.releases[0] instanceof Error);
});
