/** Stage30 actual isolated PG, mock bytes/verifier/model only. Root serial slot required. */
import assert from 'node:assert/strict';
import {createManagedViewProviderFixture} from './fixtures/managed-view-provider.mjs';
import {createManagedViewProviderAccess} from '../packages/design-production-adapter/managed-view-provider-access.mjs';
import {createManagedViewProviderFacade} from '../packages/design-production-adapter/managed-view-provider-facade.mjs';
import {createImmutableDependencyRepository} from '../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {createPreparedWorkflowService,runPreparedRecordValidationScope} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {policyOwnerKey} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const f=await createManagedViewProviderFixture(),{credential,scope}=f;let n=0,before,after,p,result,serial=0;
const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const bridge=createImmutableDependencyRepository({enabled:true,acquireClient:f.acquire,managedViewsEnabled:true}),native=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository,mediaResolver:bridge.mediaResolver,mediaVerifier:bridge.mediaVerifier,candidateAcceptanceVerifier:bridge.verifySynthesisAcceptance});
const run=fn=>bridge.runRequest({credential,scope},()=>runPreparedRecordValidationScope(fn));
async function load(){return run(()=>native.load({credential,scope}));}
async function dispatch(intent){const current=await load();return run(()=>native.dispatch({credential,scope,requestId:'view-workflow-'+(++serial),expectedRevision:current.record.revision,intent}));}
const plan=(id,kind='managed_before_view',selectors={taskId:before.taskId})=>f.viewPlan({requestId:id,candidateKind:kind,selectors});
const query=p=>({credential,scope,requestId:p.intent.requestId});
try{
 before=await f.verifiedInput({id:'diag-before',stage:'before',angle:'front'});
 for(const phase of ['proposal','execution','completed_review'])await dispatch({type:'advance',phase});
 after=await f.verifiedInput({id:'diag-after',stage:'after',angle:'front'});
 p=await plan('diag-pair','managed_completion_comparison',{beforeTaskId:before.taskId,afterTaskId:after.taskId});await f.viewApprove(p);result=await f.viewDispatcher({content:{judgment:{comparability:'comparable',reason:null,change:'未见明确外观变化'}}}).dispatch(p.request);
 await run(()=>bridge.createManagedCandidateRepository({views:true}).publish({credential,scope,requestId:p.intent.requestId}));await dispatch({type:'accept_managed_view_candidate',candidateId:result.candidate.id,selectedIndices:[0]});await dispatch({type:'confirm_entry',entryId:result.candidate.candidate.entries[0].id,text:'【合成】员工核对：'+result.candidate.candidate.entries[0].value});
 const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
 try{f.sqlAsRole(`BEGIN;SELECT design_identity.authorize(${lit(credential)},${lit(JSON.stringify(scope))}::jsonb);SELECT design_managed_view_provider_binding.read_context('managed_completion_synthesis','{"side":"left"}'::jsonb,'diag-local');ROLLBACK;`,'design_identity_runtime');console.log('PASS local context diagnosis');}catch(e){const stderr=String(e.stderr||'');console.log('RAW_SAFE_DIAGNOSTIC',JSON.stringify({sqlstate:stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]||'unknown',frames:[...stderr.matchAll(/function (?:[a-z_]+\.)?([a-z_]+)(?:\([^\n]*?\))? line ([0-9]+)/g)].map(m=>({name:m[1],line:Number(m[2])})).filter(m=>['synthesis_evidence','context_for','read_context','review_choices'].includes(m.name))}));throw Error('SYNTHETIC_LOCAL_CONTEXT_DIAGNOSTIC_FAILED');}

}finally{await f.cleanup();}
