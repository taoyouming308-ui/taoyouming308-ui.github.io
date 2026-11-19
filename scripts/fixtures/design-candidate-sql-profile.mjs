/** Test-only fixed-enum profile. Never emits SQL, parameters, source, identity or Error text. */
import {AsyncLocalStorage} from 'node:async_hooks';
export const CANDIDATE_QUERY_FAMILIES=Object.freeze(['control_begin','control_settings','control_commit','control_rollback','identity_authorize','identity_recheck','identity_clear','dependency_bundle','dependency_proof','candidate_context','candidate_processing','candidate_receipt','candidate_context_verify','candidate_local','policy_approval','policy_attempt','clock','durable_enqueue','durable_status','durable_list','durable_lookup','durable_cancel','durable_claim','durable_recheck','durable_dispatch','durable_finish','durable_fail','worker_prepare','worker_key','other']);
const groups=new Set(CANDIDATE_QUERY_FAMILIES);
const phases=new Set(['lease_spawn','lease_first_frame','query_frame','result_parse','query_total','workflow_history_scan','lease_closed','lease_total']);
const ops=new Set(['vision','compare','synthesize','speech','extract']);
const round=n=>Math.round(n*1000)/1000;
export function candidateFixtureQueryFamily(sql){
 if(typeof sql!=='string')return 'other';
 if(/^BEGIN(?: ISOLATION LEVEL READ COMMITTED)?$/.test(sql))return 'control_begin';
 const controls={BEGIN:'control_begin',COMMIT:'control_commit',ROLLBACK:'control_rollback'};if(Object.hasOwn(controls,sql))return controls[sql];
 if(/^SET LOCAL (statement_timeout|lock_timeout|idle_in_transaction_session_timeout|search_path)=/.test(sql))return 'control_settings';
 const m=/^SELECT (design_[a-z_]+)\.([a-z_]+)\(/.exec(sql),f=m?.[2];
 if(m?.[1]==='design_durable_synthesis'&&['enqueue','status','list','lookup','cancel','claim','recheck','dispatch','finish','fail'].includes(f))return 'durable_'+f;
 if(m?.[1]==='design_durable_worker'&&['prepare','read_key'].includes(f))return f==='prepare'?'worker_prepare':'worker_key';
 if(f==='authorize'||f==='authenticate')return 'identity_authorize';
 if(f==='recheck'||f==='recheck_authority')return 'identity_recheck';
 if(f==='clear_context')return 'identity_clear';
 if(f==='read_bundle')return 'dependency_bundle';
 if(f==='read_bundle_proof')return 'dependency_proof';
 if(f==='read_context')return 'candidate_context';
 if(f==='read_processing')return 'candidate_processing';
 if(f==='read_issued')return 'candidate_receipt';
 if(f==='verify_request_context')return 'candidate_context_verify';
 if(f==='register_local')return 'candidate_local';
 if(['read_approval','insert_approval','cas_approval'].includes(f))return 'policy_approval';
 if(['read_attempt','insert_attempt','cas_attempt'].includes(f))return 'policy_attempt';
 if(sql==='SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint AS value')return 'clock';
 return 'other';
}
export function instrumentCandidateFixtureClient(client,observer){
 if(typeof observer!=='function')return client;
 return {...client,async query(sql,params){const family=candidateFixtureQueryFamily(sql),start=performance.now();let outcome='success';try{return await client.query(sql,params);}catch(error){outcome='error';throw error;}finally{try{Promise.resolve(observer(Object.freeze({family,durationMs:performance.now()-start,outcome}))).catch(()=>{});}catch{}}}};
}
function add(map,key,durationMs,outcome){const row=map.get(key)??{count:0,totalMs:0,maxMs:0,errors:0};row.count++;row.totalMs+=durationMs;row.maxMs=Math.max(row.maxMs,durationMs);row.errors+=outcome==='error'?1:0;map.set(key,row);}
const rows=map=>Object.fromEntries([...map].map(([k,r])=>[k,{...r,totalMs:round(r.totalMs),maxMs:round(r.maxMs)}]));
const subtract=(after,before)=>Object.fromEntries(Object.keys(after).map(k=>[k,round(after[k]-(before[k]??0))]));
export function createCandidateSQLProfile(){
 const als=new AsyncLocalStorage(),spans=[],active=new Set(),counts=new Map();let discarded=0;
 const observeTiming=e=>{const span=als.getStore();if(!span)return;if(!phases.has(e?.phase)||!Number.isFinite(e.durationMs)||e.durationMs<0||!['success','error'].includes(e.outcome)){discarded++;return;}add(span.timing,e.phase,e.durationMs,e.outcome);};
 const observeQuery=e=>{const span=als.getStore();if(!span)return;if(!groups.has(e?.family)||!Number.isFinite(e.durationMs)||e.durationMs<0||!['success','error'].includes(e.outcome)){discarded++;return;}add(span.query,e.family,e.durationMs,e.outcome);};
 function database(f){
  const top=JSON.parse(f.sqlAdmin("SELECT json_build_object('calls',coalesce(sum(calls),0),'planMs',coalesce(sum(total_plan_time),0),'executionMs',coalesce(sum(total_exec_time),0)) FROM pg_stat_statements WHERE toplevel AND userid=(SELECT oid FROM pg_roles WHERE rolname='design_identity_runtime')"));
  // Literal categories only. The names/SQL/arguments are never included in results.
  const functions=JSON.parse(f.sqlAdmin("SELECT coalesce(json_object_agg(family,totals),'{}'::json) FROM (SELECT CASE WHEN schemaname='design_identity' THEN 'identity' WHEN funcname IN ('canonical','digest','numeric_json') THEN 'canonical_hash' WHEN funcname IN ('sources','checked_bundle','read_bundle','assert_baseline') THEN 'dependency_bundle' WHEN funcname IN ('check_evidence','synthesis_evidence','verify_refs') THEN 'source_evidence' WHEN funcname='context_for' THEN 'provider_context' WHEN schemaname='design_policy_private' THEN 'policy' WHEN schemaname='design_candidate_provider_binding' THEN 'candidate_other' ELSE 'other' END family,json_build_object('calls',sum(calls),'selfMs',sum(self_time),'inclusiveMs',sum(total_time)) totals FROM pg_stat_user_functions WHERE schemaname LIKE 'design_%' GROUP BY 1) x"));
  return {top,functions};
 }
 async function measure(operation,f,work){if(!ops.has(operation)||spans.length>=64)throw Error('INVALID_SYNTHETIC_PROFILE');await f.flushProfileStatistics?.();const before=database(f),span={operation,timing:new Map(),query:new Map(),overlap:active.size>0},attempt=(counts.get(operation)??0)+1,start=performance.now();counts.set(operation,attempt);for(const other of active)other.overlap=true;active.add(span);let result;try{result=await als.run(span,work);return result;}finally{const wallMs=performance.now()-start;active.delete(span);const flushed=await f.flushProfileStatistics?.();const after=database(f),timing=rows(span.timing),query=rows(span.query),dbFunctions={};for(const [family,row]of Object.entries(after.functions))dbFunctions[family]=subtract(row,before.functions[family]??{});const report={operation,attempt,databaseOverlapsAnotherMeasuredRequest:span.overlap,databaseFlushComplete:flushed!==false,wallMs:round(wallMs),httpStatus:result?.status??null,timing,query,database:{top:subtract(after.top,before.top),functions:dbFunctions},outsideQueryMs:round(wallMs-(timing.query_total?.totalMs??0)),discarded};spans.push(report);console.log('STAGE20_SQL_PROFILE '+JSON.stringify(report));}}
 return Object.freeze({observeTiming,observeQuery,measure,snapshot:()=>structuredClone(spans)});
}
