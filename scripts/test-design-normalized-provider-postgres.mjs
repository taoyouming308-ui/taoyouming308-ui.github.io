/** Stage35 actual isolated PG/shared-ledger/original workflow composition.
 * Default: mock strict report over literal reference PNG, NOT image validation.
 * --actual-worker: main input is normalized and independently verified by the
 * existing pinned offline worker AFTER the real PG processing claim.
 * Both modes keep storage/model transport mock, credentials synthetic and all
 * flags default-off outside this fixture. No HTTP/production/cloud connection.
 */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createManagedNormalizedProviderFixture} from './fixtures/managed-normalized-provider.mjs';
import {createManagedNormalizedProviderFacade} from '../packages/design-production-adapter/managed-normalized-provider-facade.mjs';
import {createManagedNormalizedModelDispatcher} from '../packages/design-production-adapter/managed-normalized-model-dispatcher.mjs';
import {policyDigest,policyOwnerKey} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
import {managedImageDigest as digest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const E='/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage35';mkdirSync(E,{recursive:true,mode:0o700});
const smoke=process.argv.includes('--smoke'),native=process.argv.includes('--actual-worker'),ext=process.argv.includes('--webp')?'webp':'jpg',mode=native?'actual-worker-'+ext+(smoke?'-smoke':'-full'):smoke?'protocol-smoke':'protocol-full',timings=[];
const lit=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>lit(JSON.stringify(v))+'::jsonb';
let f,count=0,input,plan,result,record,failed=null,stage='fixture install';
async function check(label,fn){stage=label;const at=performance.now();await fn();console.log(`ok ${++count} - ${label} (${Math.round(performance.now()-at)}ms)`);}
async function timed(operation,fn){const at=performance.now();try{const out=await fn();const elapsedMs=Math.round(performance.now()-at);timings.push({operation,elapsedMs,outcome:'success'});console.log('NORMALIZED_OPERATION '+JSON.stringify(timings.at(-1)));assert(elapsedMs<30000,'original 30s operation budget exceeded: '+operation);return out;}catch(e){if(timings.at(-1)?.operation!==operation||timings.at(-1)?.outcome!=='success'){timings.push({operation,elapsedMs:Math.round(performance.now()-at),outcome:'error'});console.log('NORMALIZED_OPERATION '+JSON.stringify(timings.at(-1)));}throw e;}}
const query=p=>({credential:f.credential,scope:f.scope,requestId:p.intent.requestId});
const request=p=>({...query(p),taskId:p.request.taskId});
const prepare=id=>timed('plan:'+id,()=>f.normalizedPlan({requestId:id,taskId:input.taskId}));
const attempt=p=>JSON.parse(f.sqlAdmin(`SELECT record::text FROM design_policy_private.attempts WHERE owner_key=${lit(policyOwnerKey(p.context.authority,p.intent.requestId))}`));
const rows=p=>Number(f.sqlAdmin(`SELECT count(*) FROM design_policy_private.attempts WHERE owner_key=${lit(policyOwnerKey(p.context.authority,p.intent.requestId))}`));
const consumed=id=>Number(f.sqlAdmin(`SELECT count(*) FROM design_managed_normalized_workflow.consumptions WHERE candidate_id=${lit(id)}`));
const pub=p=>timed('publish:'+p.intent.requestId,()=>f.normalizedRun(c=>c.candidates.publish({...query(p)})));
function lostCommitFacade(state){let armed=false,lost=false;return {facade:createManagedNormalizedProviderFacade({enabled:true,acquireClient:async()=>{const c=await f.acquire();return {...c,async query(sql,args){const out=await c.query(sql,args);if(sql.includes('cas_attempt')&&args?.[2]?.state===state)armed=true;if(sql==='COMMIT'&&armed&&!lost){lost=true;throw Error('SYNTHETIC_COMMIT_ACK_LOST');}return out;}};}}),didLose:()=>lost};}
try{
 f=await createManagedNormalizedProviderFixture();const {credential,scope}=f;
 await check('new independent issuers cannot read keys/attempts, set capability role or issue another kind',async()=>{
  for(const role of ['design_normalized_model_processing_issuer','design_normalized_model_cost_issuer','design_normalized_model_approval_issuer']){assert.equal(f.sqlAdmin(`SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolinherit FROM pg_roles WHERE rolname=${lit(role)}`),'f');for(const sql of ['SELECT * FROM design_key_private.key_versions','SELECT * FROM design_policy_private.attempts','SET ROLE design_identity_runtime','SET ROLE design_managed_normalized_workflow_capability'])assert.throws(()=>f.sqlAsRole(sql,role));}
  assert.throws(()=>f.sqlAsRole("SELECT design_normalized_provider_binding.issue_cost('x','{}','x','{}',1000)",'design_normalized_model_processing_issuer'));
  for(const sql of ["SELECT design_normalized_provider_binding.issue_approval('x','{}','x','{}',1000)",'INSERT INTO design_managed_normalized_workflow.candidates(candidate_id) VALUES(\'forged\')','SELECT * FROM design_normalized_provider_binding.permissions'])assert.throws(()=>f.sqlAsRole(sql,'design_identity_runtime'));
 });
 await check(native?'actual fixed producer normalization and independent verification after durable claim':'explicit protocol mock report, real processing/storage/task permissions and exact private versions',async()=>{
  input=await f.verifiedNormalizedInput({id:'stage35-main',native,ext});assert.equal(input.report.state,'evidence_complete');assert.equal(input.task.policy.scope,'synthetic_fixture_only');assert.equal(input.claimedArtifact.artifact.state,'pending_validation');assert.equal(input.report.submissionAuthorized,false);assert.equal(input.report.adoptionAuthorized,false);assert.equal(input.report.publicEligible,false);assert.deepEqual(input.task.claimedArtifact,input.claimedArtifact);assert.equal(digest(input.parent.sourceRecord),digest(input.claimedArtifact.artifact.sourceRecord));
  assert.deepEqual([f.normalizedCounts().nativeNormalizations,f.normalizedCounts().nativeVerifications],native?[1,1]:[0,0]);
 });
 await check('current full authority, strict input, source workflow and existing immutable key bound; default-off/missing approval cannot send',async()=>{
  plan=await prepare('normalized-main');assert.deepEqual(plan.context.authority,f.authority);assert.deepEqual(plan.context.normalizedInputBinding,plan.prepared.input);assert.equal(plan.context.workflowBinding.sessionDigest,policyDigest(plan.context.session));assert.equal(plan.intent.schemaVersion,'design-provider-intent-v6');assert.equal(plan.intent.normalizedBinding.input.taskId,input.taskId);assert.equal(plan.context.keyBinding.purpose,'chat');
  await assert.rejects(createManagedNormalizedModelDispatcher().dispatch(plan.request));await assert.rejects(f.normalizedDispatcher().dispatch(plan.request));assert.deepEqual([f.normalizedCounts().sends,f.normalizedCounts().keyOpens],[0,0]);
 });
 await check('separate processing/cost/approval required; real shared-ledger dispatcher emits one unconfirmed synthetic candidate',async()=>{
  await f.normalizedApprove(plan,{cost:false,approval:false});await assert.rejects(f.normalizedIssuers.issueApproval({credential,scope,receiptId:'premature-approval',intent:plan.intent,ttlMs:900000}));
  await f.normalizedApprove(plan,{processing:false,approval:false});await assert.rejects(f.normalizedDispatcher().dispatch(plan.request));assert.equal(f.normalizedCounts().sends,0);
  await f.normalizedApprove(plan,{processing:false,cost:false});result=await timed('dispatch:main',()=>f.normalizedDispatcher().dispatch(plan.request));assert.equal(result.state,'completed');assert.equal(result.candidate.schemaVersion,'design-managed-model-candidate-v4');assert.equal(result.candidate.kind,'managed_normalized_before_view');assert.equal(result.candidate.generation,'synthetic_mock_model');assert(result.candidate.candidate.entries.every(e=>e.status==='not_confirmed'||e.status==='unknown'));assert.deepEqual([f.normalizedCounts().sends,f.normalizedCounts().keyOpens],[1,1]);assert.equal(rows(plan),1);assert.equal(attempt(plan).state,'completed');assert.equal(attempt(plan).intent.schemaVersion,'design-provider-intent-v6');
 });
 await check('fresh taskless query/completed replay then ID publication/load use same result without a second key or transport',async()=>{
  const before=f.normalizedCounts(),queried=await timed('query:main',()=>f.normalizedDispatcher().query(query(plan)));assert.deepEqual(queried.candidate,result.candidate);const replay=await timed('replay:main',()=>f.normalizedDispatcher().dispatch(plan.request));assert.equal(replay.replayed,true);assert.deepEqual(replay.candidate,result.candidate);assert.deepEqual(f.normalizedCounts(),before);
  const published=await pub(plan),loaded=await timed('load:main',()=>f.normalizedRun(c=>c.candidates.load({credential,scope,candidateId:result.candidate.id})));assert.deepEqual(published.candidate,result.candidate);assert.deepEqual(loaded.candidate,result.candidate);assert.deepEqual(loaded.input.task,input.task);assert.equal(consumed(result.candidate.id),0);
 });
 if(!smoke){
  await check('old v2 and new v6 share principal/request namespace without adoption of old receipts',async()=>{
   const old=await f.plan({requestId:'normalized-old-v2'});await f.providerIssuer.issue({credential,scope,receiptId:'normalized-v2-old-approval',intent:old.intent,ttlMs:900000});const p=await prepare('normalized-old-v2');await assert.rejects(f.normalizedApprove(p));
   const existing=await f.plan({requestId:plan.intent.requestId});await assert.rejects(f.providerIssuer.issue({credential,scope,receiptId:'normalized-v2-conflict',intent:existing.intent,ttlMs:900000}));
  });
 }
 await check('explicit native adoption is not confirmation; separate human confirmation/full-v5/recreated repo preserve all three objects',async()=>{
  const previous=(await f.normalizedLoad()).record,oldPhotos=structuredClone(previous.photoRefs),accepted=await timed('adopt:main',()=>f.normalizedDispatch({type:'accept_normalized_candidate',candidateId:result.candidate.id,selectedIndices:[0]},{requestId:'normalized-adopt-main',expectedRevision:previous.revision}));record=accepted.record;
  assert.equal(record.schemaVersion,'design-prepared-workflow-record-v5');assert.equal(record.managedImageHistory.schemaVersion,'design-managed-image-history-v3');assert.equal(record.managedImageHistory.accepted.at(-1).candidate.id,result.candidate.id);assert.equal(record.session.entries.at(-1).status,'not_confirmed');assert.equal(consumed(result.candidate.id),1);assert.deepEqual(record.photoRefs,oldPhotos);
  const entry=record.session.entries.at(-1),confirmed=await timed('confirm:main',()=>f.normalizedDispatch({type:'confirm_entry',entryId:entry.id,text:'【合成独立人工核查】'+entry.value},{requestId:'normalized-confirm-main'}));record=confirmed.record;assert.equal(record.session.entries.at(-1).status,'confirmed');assert.deepEqual(record.managedImageHistory.accepted.at(-1).candidate,result.candidate);
  const snapshot=(await timed('snapshot:main',()=>f.normalizedRun(c=>c.workflow.snapshot({credential,scope})))).snapshot;assert.equal(snapshot.schemaVersion,'design-full-workflow-snapshot-v5');const saved=await timed('full-append:main',()=>f.normalizedRun(c=>c.full.append({credential,scope,requestId:'normalized-full-main',expectedVersion:0,expectedParentDigest:null,snapshot})));assert.equal(saved.appliedVersion,1);
  f.recreateNormalizedComposition();const reread=(await timed('workflow-reload:main',()=>f.normalizedLoad())).record,history=await timed('full-reload:main',()=>f.normalizedRun(c=>c.full.load({credential,scope})));assert.deepEqual(reread,record);assert.deepEqual(history.versions[0].snapshot,snapshot);assert.equal(digest(history.versions[0].snapshot),digest(snapshot));assert.equal(f.normalizedCounts().sends,1);
 });
 if(!smoke){
  await check('changed workflow cannot reuse old completion authorization',async()=>{const before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher().query(query(plan)));await assert.rejects(f.normalizedDispatcher().dispatch(plan.request));assert.deepEqual(f.normalizedCounts(),before);});
  await check('pending and concurrent reserves use one original ownerKey and never auto-dispatch',async()=>{
   const p=await prepare('normalized-pending');await f.normalizedApprove(p);const handles=await Promise.all([f.normalizedFacade.forRequest(request(p)),f.normalizedFacade.forRequest(request(p))]),out=await Promise.all(handles.map(h=>h.reserve({intent:p.intent})));assert.equal(out.filter(x=>x.created).length,1);assert.equal(rows(p),1);const before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher().dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends);
  });
  await check('lost actual dispatch-claim COMMIT cannot cause transport or a second claim',async()=>{
   const p=await prepare('normalized-claim-lost');await f.normalizedApprove(p);const fault=lostCommitFacade('dispatch_claimed'),before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher({facade:fault.facade}).dispatch(p.request),e=>e.outcome==='uncertain');assert(fault.didLose());assert.equal(f.normalizedCounts().sends,before.sends);assert.equal((await f.normalizedDispatcher().query(query(p))).state,'dispatch_claimed');await assert.rejects(f.normalizedDispatcher().dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends);assert.equal(rows(p),1);
  });
  await check('lost actual completed COMMIT is queryable with exactly one mock transport',async()=>{
   const p=await prepare('normalized-result-lost');await f.normalizedApprove(p);const fault=lostCommitFacade('completed'),before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher({facade:fault.facade}).dispatch(p.request));assert(fault.didLose());assert.equal(f.normalizedCounts().sends,before.sends+1);assert.equal((await f.normalizedDispatcher().query(query(p))).state,'completed');assert.equal(f.normalizedCounts().sends,before.sends+1);assert.equal(rows(p),1);
  });
  await check('mock transport loses response: unknown state is query-only, never a new send',async()=>{
   const p=await prepare('normalized-transport-lost');await f.normalizedApprove(p);const before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher({beforeReply:()=>{throw Error('SYNTHETIC_REPLY_LOST');}}).dispatch(p.request),e=>e.outcome==='uncertain');assert.equal(f.normalizedCounts().sends,before.sends+1);assert.equal((await f.normalizedDispatcher().query(query(p))).state,'uncertain');await assert.rejects(f.normalizedDispatcher().dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends+1);
  });
  await check('same-connection acceptance final guard failure rolls back workflow/receipt/consumption; original request then succeeds',async()=>{
   const p=await prepare('normalized-rollback');await f.normalizedApprove(p);const done=await f.normalizedDispatcher().dispatch(p.request);await pub(p);
   const prior=(await f.normalizedLoad()).record,requestId='normalized-rollback-adopt',request={credential,scope,requestId,expectedRevision:prior.revision,intent:{type:'accept_normalized_candidate',candidateId:done.candidate.id,selectedIndices:[0]}},counts=()=>f.sqlAdmin(`SELECT jsonb_build_object('versions',(SELECT count(*) FROM design_private.workflow_versions),'receipts',(SELECT count(*) FROM design_private.workflow_receipts),'consumptions',(SELECT count(*) FROM design_managed_normalized_workflow.consumptions))::text`),before=counts();let appended=false,guardFailed=false;
   const acquire=async()=>{const c=await f.acquire();return {...c,async query(sql,args){const out=await c.query(sql,args);if(sql.includes('design_managed_normalized_workflow.append_managed('))appended=true;if(appended&&sql.includes('design_managed_normalized_workflow.require_consumed(')&&!guardFailed){guardFailed=true;throw Error('SYNTHETIC_FINAL_ACCEPT_GUARD_FAILURE');}return out;}};};
   await assert.rejects(f.normalizedRunWithClient(acquire,c=>c.workflow.dispatch(request)));assert(appended&&guardFailed);assert.equal(counts(),before);assert.equal(consumed(done.candidate.id),0);assert.deepEqual((await f.normalizedLoad()).record,prior);
   const accepted=await f.normalizedDispatch(request.intent,{requestId,expectedRevision:prior.revision});assert.equal(consumed(done.candidate.id),1);const last=accepted.record.managedImageHistory.accepted.at(-1),requirement={candidateId:done.candidate.id,acceptance:last.acceptance,recordSha256:digest(accepted.record)};
   assert.throws(()=>f.sqlAsRole(`BEGIN;SELECT design_identity.authorize(${lit(credential)},${json(scope)});SELECT design_managed_normalized_workflow.require_consumed(${json(requirement)});ROLLBACK;`,'design_identity_runtime'),'new transaction cannot claim original consumption transaction');
  });
  await check('raw runtime cannot mutate completed result or self-confirm candidate inside shared ledger',async()=>{
   const p=await prepare('normalized-tamper');await f.normalizedApprove(p);const done=await f.normalizedDispatcher().dispatch(p.request),raw=attempt(p),key=policyOwnerKey(p.context.authority,p.intent.requestId);for(const edit of [r=>{r.intent.schemaVersion='design-provider-intent-v4';},r=>{r.result.candidate.entries[0].status='confirmed';},r=>{r.result.normalizedBinding.input.processingProvenanceDigest='0'.repeat(64);}]){const r=structuredClone(raw);r.revision++;edit(r);assert.throws(()=>f.sqlAsRole(`BEGIN;SELECT design_identity.authorize(${lit(credential)},${json(scope)});SELECT design_policy_private.cas_attempt(${lit(key)},${raw.revision},${json(r)});ROLLBACK;`,'design_identity_runtime'));}assert.deepEqual((await f.normalizedDispatcher().query(query(p))).candidate,done.candidate);
  });
  await check('processing approval revoked during mock transport withholds result and cannot resend',async()=>{
   const p=await prepare('normalized-revoked-send');await f.normalizedApprove(p);const before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher({beforeReply:()=>f.normalizedIssuers.revokeProcessing({receiptId:'normalized-processing-'+p.intent.requestId})}).dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends+1);await assert.rejects(f.normalizedDispatcher().dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends+1);
  });
  await check('workflow change and current key rotation each reject exact older approval before new send',async()=>{
   const p=await prepare('normalized-stale-workflow');await f.normalizedApprove(p);await f.normalizedDispatch({type:'record_source',kind:'text',text:'【合成新来源】不能沿用旧记录批准。'},{requestId:'normalized-source-change'});const before=f.normalizedCounts();await assert.rejects(f.normalizedDispatcher().dispatch(p.request));assert.equal(f.normalizedCounts().sends,before.sends);
   const k=await prepare('normalized-stale-key');await f.normalizedApprove(k);await f.saveKey({key:'STAGE35_SYNTHETIC_ONLY_REPLACEMENT_KEY_12345'});await assert.rejects(f.normalizedDispatcher().dispatch(k.request));assert.equal(f.normalizedCounts().sends,before.sends);
  });
 }
 await check('real native phase progression/archive and second full append preserve first archive and all accepted evidence',async()=>{
   const first=(await f.normalizedRun(c=>c.full.load({credential,scope}))).versions[0],firstDigest=digest(first),before=(await f.normalizedLoad()).record,history=structuredClone(before.managedImageHistory);
   for(const phase of ['proposal','execution','completed_review'])await timed('advance:'+phase,()=>f.normalizedDispatch({type:'advance',phase}));
   const archived=await timed('native-archive',()=>f.normalizedDispatch({type:'archive'}));assert.equal(archived.record.session.phase,'archive');assert.equal(archived.record.archives.length,1);assert.deepEqual(archived.record.managedImageHistory,history);
   const snapshot=(await f.normalizedRun(c=>c.workflow.snapshot({credential,scope}))).snapshot;assert.equal(snapshot.evidence.archives.length,1);assert.equal(snapshot.schemaVersion,'design-full-workflow-snapshot-v5');
   const saved=await timed('full-append:archived',()=>f.normalizedRun(c=>c.full.append({credential,scope,requestId:'normalized-full-archived',expectedVersion:1,expectedParentDigest:first.sha256,snapshot})));assert.equal(saved.appliedVersion,2);
   f.recreateNormalizedComposition();const loaded=(await f.normalizedLoad()).record,full=await f.normalizedRun(c=>c.full.load({credential,scope}));assert.deepEqual(loaded,archived.record);assert.equal(full.versions.length,2);assert.deepEqual(full.versions[0],first);assert.equal(digest(full.versions[0]),firstDigest);assert.deepEqual(full.versions[1].snapshot,snapshot);
  });
  await check('strict processing revocation cuts new context/read before bytes/model; original functions unchanged',async()=>{
   const before=f.normalizedCounts();assert.deepEqual(await f.canonicalLedger.readVerified({credential,scope,taskId:input.taskId}),{task:input.task,report:input.report});const historic=(await f.normalizedLoad()).record,fullHistoric=await f.normalizedRun(c=>c.full.load({credential,scope}));await f.processingIssuer.revoke({permissionId:'norm-processing-stage35-main'});await assert.rejects(f.canonicalLedger.readVerified({credential,scope,taskId:input.taskId}));await assert.rejects(prepare('normalized-revoked-source'));await assert.rejects(f.normalizedPreparer.prepare({credential,scope,requestId:'normalized-revoked-bytes',taskId:input.taskId}));assert.deepEqual(f.normalizedCounts(),before);assert.deepEqual((await f.normalizedLoad()).record,historic);assert.deepEqual(await f.normalizedRun(c=>c.full.load({credential,scope})),fullHistoric);assert.equal(f.sqlAdmin(f.normalizedOriginalSQL),f.normalizedOriginal);
   const dump=f.sqlAdmin("SELECT coalesce(string_agg(record::text,''),'') FROM design_normalized_provider_binding.permissions");assert(!dump.includes(credential));assert(!dump.includes('data:image'));assert(!dump.includes('STAGE18_SYNTHETIC_NOT_A_REAL_PROVIDER_KEY'));
  });
 console.log('PASS '+count+' Stage35 '+mode+' groups; actual PG/shared key+attempt/workflow, storage and model transport mocked');
}catch(e){failed={stage,name:typeof e?.name==='string'?e.name:'Error',code:typeof e?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'TEST_FAILURE',frames:typeof e?.stack==='string'?e.stack.split('\n').slice(1,5):[]};console.error('NORMALIZED_TEST_FAILURE '+JSON.stringify(failed));process.exitCode=1;}
finally{try{if(f)await f.cleanup();}finally{writeFileSync(`${E}/managed-normalized-${mode}-summary.json`,JSON.stringify({mode,passedGroups:count,failed,timings,counts:f?.normalizedCounts()??null,actualPostgres:true,actualNativeWorker:native,privateStorage:'native_version_map_mock_with_formal_adapter',provider:'synthetic_mock_transport',production:false},null,2)+'\n',{mode:0o600});}}
