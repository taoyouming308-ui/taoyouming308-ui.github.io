/** One baseline and two fixed diagnostic controls. Not a repeat-until-green run. */
import assert from 'node:assert/strict';
import {createDesignPostgresFixture} from './fixtures/design-postgres-fixture.mjs';
import {createDesignPostgresExecutor} from '../packages/design-production-adapter/postgres-executor.mjs';
import {createVisitBindingAdapter} from '../packages/design-production-adapter/visit-binding.mjs';
import {createProductionEmployeeAdapter} from '../packages/design-production-adapter/employee-adapter.mjs';
import {createProductionArchiveAdapter} from '../packages/design-production-adapter/archive-adapter.mjs';
import {createDesignDiagnostics} from '../packages/shared/design-diagnostics.mjs';
globalThis.fetch=()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const f=await createDesignPostgresFixture();
let active=null;
const states=new Set(['55P03','57014','40001','40P01','42501']);
const family=text=>text.includes('FROM public.bookings')?'assignment':text.includes('FROM design_private.lifecycle_decisions')?'lifecycle':text.includes('customer_design_resolve_context')?'context':text.includes('FROM design_private.binding_versions')?'binding':text.includes('FROM public.employee_booking_sessions')?'session':text.includes('FROM public.staff')?'staff':text.includes('FROM public.customer_profiles')?'profile':'other';
function observe(event){
 if(!active)return;
 createDesignDiagnostics(safe=>{if(safe.outcome==='failure'&&active.failures.length<24)active.failures.push(safe);},event.component)(event.phase,event.outcome,event.failureKind);
}
function composition({shortAssignmentLock=false}={}){
 const executor=createDesignPostgresExecutor({lifecyclePolicy:f.lifecyclePolicy,diagnostics:observe,acquireClient:async()=>{
  const c=f.client(),query=c.query.bind(c);
  return {release:c.release.bind(c),async query(text,params){
   // This setting is only on the negative-control connection, immediately before
   // its locked source read. Runtime SQL and timeout configuration are unchanged.
   if(shortAssignmentLock&&family(text)==='assignment')await query("SET LOCAL lock_timeout = '100ms'");
   const started=performance.now(),kind=family(text);
   try{const result=await query(text,params);if(active)active.queryCounts[kind]=(active.queryCounts[kind]||0)+1;return result;}
   catch(error){if(active)active.queryFailures.push({family:kind,sqlstate:states.has(error.code)?error.code:'other',durationMs:Math.round(performance.now()-started)});throw error;}
  }};
 }});
 const binding=createVisitBindingAdapter({...executor,diagnostics:observe});
 const employee=createProductionEmployeeAdapter({diagnostics:observe,
  restRows:path=>executor.readTransaction(tx=>tx.restRows(path)),
  rpc:(name,input)=>executor.readTransaction(tx=>tx.rpc(name,input)),
  resolveVisitBinding:row=>binding.resolveVisitBinding(row)});
 return {employee,archive:createProductionArchiveAdapter({employeeAdapter:employee,transaction:executor.transaction})};
}
const steps=Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k=>[k,'']));
const snapshot={baseline:{outline:'Synthetic diagnostic only',root_flow:'',steps},optimized:{outline:'',root_flow:'',steps:{...steps}},reasons:{outline:'',root_flow:'',...steps},execution:{},process:{},review:{},status:'baseline',photo_ids:[],archive_url:null};
const request=index=>({credential:f.credential,scope:f.scopeA,requestId:`00000000-0000-4000-8000-00000000000${index}`,expectedLatestVersionId:null,snapshot});
const versionCount=()=>Number(f.sql('SELECT count(*) FROM public.customer_design_versions;'));
async function arm(name,work){
 active={name,queryCounts:{},queryFailures:[],failures:[]};const started=performance.now();
 try{await work();active.durationMs=Math.round(performance.now()-started);console.log(JSON.stringify(active));}
 finally{active=null;}
}
try{
 const app=composition();
 // Reproduce exactly the original test-6 source restore boundary once, without
 // running the old 27-test suite or its 12-append investigation loop.
 f.lifecycle(f.sourceRow(101));f.sql('UPDATE public.bookings SET status=1 WHERE id=101;');
 await assert.rejects(app.employee.gate.authorize(f.credential,f.scopeA),e=>e.code==='RELATIONSHIP_UNAVAILABLE');
 f.sql('UPDATE public.bookings SET status=0 WHERE id=101;');
 await arm('restored_source_baseline',async()=>{
  assert.equal(f.sql('SELECT status=0 FROM public.bookings WHERE id=101;'),'t');
  const result=await app.archive.appendLegacyVersion(request(1));assert.equal(result.version.versionNumber,1);
  assert.equal(active.queryFailures.length,0);assert.equal(active.failures.length,0);assert.equal(versionCount(),1);
 });
 await arm('assignment_lock_timeout_control',async()=>{
  const blocker=f.client('fixed-diagnostic-lock-holder');
  try{
   await blocker.query('BEGIN');await blocker.query('UPDATE public.bookings SET status=status WHERE id=$1 RETURNING id',[101]);
   await assert.rejects(composition({shortAssignmentLock:true}).archive.appendLegacyVersion(request(2)),e=>e.code==='RELATIONSHIP_UNAVAILABLE');
   assert(active.queryFailures.some(e=>e.family==='assignment'&&e.sqlstate==='55P03'));
   assert(active.failures.some(e=>e.component==='access_gate'&&e.phase==='assignment'));
  }finally{await blocker.query('ROLLBACK');await blocker.release();}
  assert.equal(versionCount(),1);
 });
 await arm('lifecycle_digest_mismatch_control',async()=>{
  f.lifecycle(f.sourceRow(101,'alice',1));
  try{
   await assert.rejects(app.archive.appendLegacyVersion(request(3)),e=>e.code==='RELATIONSHIP_UNAVAILABLE');
   assert.equal(active.queryFailures.length,0);
   assert(active.failures.some(e=>e.component==='visit_binding'&&e.phase==='lifecycle'));
   assert(active.failures.some(e=>e.component==='access_gate'&&e.phase==='assignment'));
  }finally{f.lifecycle(f.sourceRow(101));}
  assert.equal(versionCount(),1);
 });
 console.log('PASS: one baseline and two distinguishable fixed controls. Historical Stage7 cause remains unconfirmed; no additional retry.');
}finally{await f.cleanup();console.log('cleanup ok - exact labelled synthetic container absent');}
