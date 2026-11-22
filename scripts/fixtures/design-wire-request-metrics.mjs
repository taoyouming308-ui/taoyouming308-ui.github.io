/** Synthetic-only request timing. Client cutoff is not server completion.
 * Fixed labels/counters only: never SQL, parameters, request IDs or error text.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {CANDIDATE_QUERY_FAMILIES} from './design-candidate-sql-profile.mjs';
const OPERATIONS=new Set(['load','synthesize','synthesis_replay','snapshot','full_load_before','full_append','full_load_after','enqueue','status','list','lookup','cancel','worker','load_candidate','adopt']);
const FAMILIES=new Set(CANDIDATE_QUERY_FAMILIES);
const PHASES=new Set(['claim','prepare','payload','read_key','key_open','key_digest','dispatch','transport','parse','finish','fail']);
const ERRORS=new Set(['HTTP_OUTCOME_UNCERTAIN','TIMEOUT','TRANSMISSION_DENIED','IMMUTABLE_DEPENDENCY_UNCERTAIN','RESPONSE_INVALID','RESPONSE_TOO_LARGE','REQUEST_REJECTED','DURABLE_DENIED','DURABLE_LEASE_LOST','DURABLE_OUTCOME_UNCERTAIN','DURABLE_RESULT_INVALID']);
const copy=v=>JSON.parse(JSON.stringify(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function createWireRequestMetrics({clock=()=>performance.now(),onReport=()=>{}}={}){
 const local=new AsyncLocalStorage(),rows=[],pending=new Set();
 const now=()=>{const n=clock();if(!Number.isFinite(n)||n<0)throw Error('SYNTHETIC_METRIC_CLOCK_INVALID');return n;};
 const elapsed=m=>Math.max(0,now()-m.started);
 function emit(phase,m,point){try{Promise.resolve(onReport(freeze({phase,operation:m.operation,workflowRevision:m.workflowRevision,nativeRevision:m.nativeRevision,...copy(point)}))).catch(()=>{});}catch{}}
 function point(m,wallMs){const queries=copy(m.queries),queryAwaitMs=Object.values(queries).reduce((sum,r)=>sum+r.totalMs,0);return freeze({wallMs,queries,queryAwaitMs,outsideQueryMs:wallMs-queryAwaitMs,transactions:queries.control_begin?.count??0,commits:queries.control_commit?.count??0,rollbacks:queries.control_rollback?.count??0,providerDelta:m.providerDelta,keyDelta:m.keyDelta,phases:copy(m.phases),discardedObservations:m.discardedObservations});}
 function observeQuery(e){const m=local.getStore();if(!m||m.serverFinal)return;if(!FAMILIES.has(e?.family)||!Number.isFinite(e.durationMs)||e.durationMs<0||!['success','error'].includes(e.outcome)){m.discardedObservations++;return;}const row=m.queries[e.family]??={count:0,totalMs:0,errors:0};row.count++;row.totalMs+=e.durationMs;row.errors+=e.outcome==='error'?1:0;}
 function observePhase(e){const m=local.getStore();if(!m||m.serverFinal)return;if(!PHASES.has(e?.phase)||!Number.isFinite(e.durationMs)||e.durationMs<0||!['success','error'].includes(e.outcome)){m.discardedObservations++;return;}const r=m.phases[e.phase]??={count:0,totalMs:0,errors:0};r.count++;r.totalMs+=e.durationMs;r.errors+=e.outcome==='error'?1:0;}
 async function phase(name,work){if(!PHASES.has(name)||typeof work!=='function')throw Error('SYNTHETIC_PHASE_INVALID');const started=now();let outcome='success';try{return await work();}catch(e){outcome='error';throw e;}finally{observePhase({phase:name,durationMs:Math.max(0,now()-started),outcome});}}
 function noteCall(kind){const m=local.getStore();if(m&&!m.serverFinal&&['provider','key'].includes(kind))m[kind+'Delta']++;}
 function noteAbort(){const m=local.getStore();if(m&&m.abortedMs===null)m.abortedMs=elapsed(m);}
 function trackRuntime(promise){
  const m=local.getStore();if(!m)return promise;if(m.runtimeStarted)throw Error('SYNTHETIC_METRIC_MULTIPLE_RUNTIME');m.runtimeStarted=true;const start=now();
  const done=Promise.resolve(promise).then(response=>{m.serverFinal=freeze({...point(m,elapsed(m)),runtimeWallMs:Math.max(0,now()-start),status:Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null,outcome:'responded'});emit('server_final',m,m.serverFinal);},()=>{m.serverFinal=freeze({...point(m,elapsed(m)),runtimeWallMs:Math.max(0,now()-start),status:null,outcome:'rejected'});emit('server_final',m,m.serverFinal);});
  pending.add(done);void done.then(()=>pending.delete(done),()=>pending.delete(done));return promise;
 }
 async function measure(operation,{workflowRevision=null,nativeRevision=null}={},work){
  if(!OPERATIONS.has(operation)||rows.length>=64||typeof work!=='function'||![workflowRevision,nativeRevision].every(x=>x===null||(Number.isSafeInteger(x)&&x>=0)))throw Error('SYNTHETIC_METRIC_INPUT_INVALID');
  const m={operation,workflowRevision,nativeRevision,started:now(),queries:{},phases:{},discardedObservations:0,providerDelta:0,keyDelta:0,abortedMs:null,runtimeStarted:false,clientCutoff:null,serverFinal:null};rows.push(m);let error=null;
  return local.run(m,async()=>{try{return await work();}catch(e){error={code:ERRORS.has(e?.code)?e.code:'SYNTHETIC_CHECK_FAILED',outcome:['not_sent','uncertain','unknown'].includes(e?.outcome)?e.outcome:'unknown'};throw e;}finally{m.clientCutoff=freeze({...point(m,elapsed(m)),abortedMs:m.abortedMs,error});emit('client_cutoff',m,m.clientCutoff);}});
 }
 return Object.freeze({observeQuery,observePhase,notePhase:observePhase,phase,noteCall,noteAbort,trackRuntime,measure,async drain(){await Promise.all([...pending]);},snapshot:()=>freeze(rows.map(m=>({operation:m.operation,workflowRevision:m.workflowRevision,nativeRevision:m.nativeRevision,clientCutoff:copy(m.clientCutoff),serverFinal:copy(m.serverFinal)})))});
}
