/** Actual PostgreSQL 17 candidate publication and atomic workflow acceptance.
 * Offline synthetic metadata only: no model calls, keys, real images/data or RLS proof.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesignPostgresFixture} from './fixtures/design-postgres-fixture.mjs';
import {createDesignPostgresExecutor} from '../packages/design-production-adapter/postgres-executor.mjs';
import {createDesignPostgresRepositories} from '../packages/design-production-adapter/postgres-workflow-repositories.mjs';
import {createPreparedWorkflowService,validatePreparedWorkflowRecord,runPreparedRecordValidationScope} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {unpackFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {getDesignView} from '../packages/analysis-engine/design-pilot.mjs';
import {validateDesignCandidate,buildVisualCandidateParts,buildCompletionCandidateParts,DESIGN_COMPARISON_OUTPUTS,buildSynthesisEvidence,buildSynthesisCandidateParts,designSynthesisReviewChoices,applyTrustedDesignCandidate} from '../packages/analysis-engine/design-candidate.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden in synthetic PostgreSQL tests');};
const args=process.argv.slice(2);
assert(args.length===0||args.length===1&&args[0]==='--request-memo','Only the explicit test-only --request-memo option is supported');
const requestMemo=args[0]==='--request-memo';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(canonical(v));
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const json=v=>`${quote(canonical(v))}::jsonb`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rejects=(promise,...codes)=>assert.rejects(promise,error=>{assert(codes.includes(error.code),`expected ${codes.join('|')}, got ${error.code}: ${error.message}`);return true;});
function latch(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
let serial=0,passed=0,memoCases=0,memoHitChecks=0;
async function test(name,fn){
 // A whole case intentionally outlives an HTTP request: mutations, fresh reads,
 // revocations and concurrent calls must still be verified while pure hits occur.
 if(requestMemo){await runPreparedRecordValidationScope(fn);memoCases++;}else await fn();
 console.log(`ok ${++passed} - ${name}`);
}
async function main(){
 const f=await createDesignPostgresFixture(),{credential,store}=f;
 const actor={username:'alice',store};
 const count=(table,condition='true')=>Number(f.sql(`select count(*) from design_private.${table} where ${condition};`));
 const where=scope=>`scope_key=${quote(digest(scope))}`;
 const candidateWhere=id=>`candidate_id=${quote(id)}`;
 const rawCandidate=id=>f.sql(`select to_jsonb(c) from design_private.model_candidates c where ${candidateWhere(id)};`);
 const expiry=id=>f.sql(`select expires_at::text from design_private.model_candidates where ${candidateWhere(id)};`);
 // Wait against PostgreSQL's own clock; never rewrite the immutable expiry column.
 const expire=id=>{assert.equal(f.sql(`select expires_at>clock_timestamp() from design_private.model_candidates where ${candidateWhere(id)};`),'t','candidate is still live before deliberately waiting for its DB deadline');return f.sql(`select pg_sleep(greatest(extract(epoch from (expires_at-clock_timestamp())),0)+0.02) from design_private.model_candidates where ${candidateWhere(id)};`);};
 function composition(options={}){
  const executor=createDesignPostgresExecutor({lifecyclePolicy:f.lifecyclePolicy,acquireClient:async()=>{
   const c=f.client(options.application),query=c.query.bind(c);
   return {release:c.release.bind(c),async query(text,params){if(options.beforeQuery)await options.beforeQuery(text,params,c);const result=await query(text,params);if(options.afterQuery)await options.afterQuery(text,params,result,c);return result;}};
  }});
  const repositories=createDesignPostgresRepositories({executor});
  const service=createPreparedWorkflowService({enabled:true,permissionGate:repositories.employeeAdapter.gate,repository:repositories.workflowRepository,mediaResolver:repositories.mediaResolver,mediaVerifier:repositories.mediaVerifier,candidateAcceptanceVerifier:request=>repositories.verifySynthesisAcceptance(request)});
  return {executor,repositories,service,candidates:repositories.createCandidateRepository({ttlMs:options.ttlMs??60000}),full:repositories.createFullWorkflowArchive({enabled:true})};
 }
 let app=composition();
 const load=(scope,instance=app)=>{
  const pending=instance.service.load({credential,scope});
  if(!requestMemo)return pending;
  return pending.then(result=>{
   const checked=validatePreparedWorkflowRecord(result.record,scope);
   assert.strictEqual(validatePreparedWorkflowRecord(structuredClone(result.record),scope),checked,'actual service validator reuses an exact frozen record within this case only');
   memoHitChecks++;return result;
  });
 };
 async function initialized(id){const scope=await f.seedSource(id);await app.repositories.initializeWorkflow({credential,scope});return scope;}
 async function send(scope,intent,instance=app){const {record}=await load(scope,instance);return instance.service.dispatch({credential,scope,requestId:`candidate-pg-${++serial}`,expectedRevision:record.revision,intent});}
 const source=(text='  【合成测试】我想要短发。\n原话保留🙂  ')=>( {type:'record_source',kind:'text',text});
 async function textCandidate(scope,id=`synthetic-candidate-${++serial}`){
  let {record}=await load(scope);if(!record.session.sources.length)record=(await send(scope,source())).record;
  const s=record.session.sources.at(-1),candidate={phase:record.session.phase,entries:[{id:'extracted:'+id+':0',category:'person_style',field:'requested_style',zone:null,groupId:null,service:null,side:null,track:'context',origin:'extraction',basis:'said',value:'短发',status:'not_confirmed',sources:[{messageId:s.messageId,quote:s.text}],replacesEntryId:null}],questions:[],warnings:[]};
  return validateDesignCandidate({schemaVersion:'design-model-candidate-v1',id,kind:'text_extraction',scope,store,actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:digest(record.session),payloadDigest:digest({syntheticPayload:id}),model:'synthetic-text-model',promptVersion:'synthetic-text-v1',sourceRefs:[],descriptionSources:[],candidate},record.session);
 }
 async function visualCandidate(scope,media,id=`synthetic-vision-${++serial}`){
  const {record}=await load(scope),parts=buildVisualCandidateParts({id,session:record.session,observations:[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:null}]});
  return validateDesignCandidate({schemaVersion:'design-model-candidate-v1',id,kind:'visual_description',scope,store,actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:digest(record.session),payloadDigest:digest({syntheticPayload:id}),model:'synthetic-vision-model',promptVersion:'synthetic-vision-v1',sourceRefs:[{mediaId:media.mediaId,sourceSha256:media.sha256,derivativeSha256:hash('synthetic-derived-png')}],...parts},record.session);
 }
 async function completionCandidate(scope,before,after,angle='front',output=DESIGN_COMPARISON_OUTPUTS[0]){
  const {record}=await load(scope),id=`synthetic-comparison-${++serial}`;
  const parts=buildCompletionCandidateParts({id,session:record.session,angle,output});
  return validateDesignCandidate({schemaVersion:'design-model-candidate-v1',id,kind:'completion_comparison',scope,store,actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:digest(record.session),payloadDigest:digest({syntheticPair:id}),model:'synthetic-pair-model',promptVersion:'synthetic-pair-v1',comparison:{beforeMediaId:before.mediaId,afterMediaId:after.mediaId,angle},sourceRefs:[before,after].map(r=>({mediaId:r.mediaId,sourceSha256:r.sha256,derivativeSha256:hash('derived:'+r.mediaId)})),...parts},record.session);
 }
 async function completed(id){const scope=await initialized(id);for(const phase of ['proposal','execution','completed_review'])await send(scope,{type:'advance',phase});return scope;}
 async function synthesisCandidate(scope,side='left',mutate){
  const {record}=await load(scope),id=`synthetic-synthesis-${++serial}`,prepared=structuredClone(buildSynthesisEvidence({session:record.session,modelCandidates:record.modelCandidates||[],side}));if(mutate)mutate(prepared);
  const parts=buildSynthesisCandidateParts({id,session:record.session,synthesis:prepared.synthesis});
  return validateDesignCandidate({schemaVersion:'design-model-candidate-v1',id,kind:'completion_synthesis',scope,store,actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:digest(record.session),payloadDigest:digest({syntheticSynthesis:id}),model:prepared.synthesis.generation==='deterministic'?'server-deterministic':'synthetic-review-model',promptVersion:'synthetic-synthesis-v1',...prepared,...parts},record.session);
 }
 const verifyRequest=(scope,candidate,stored=false)=>({credential,scope,actor,sessionId:candidate.sessionId,baseRevision:candidate.baseRevision,inputDigest:candidate.inputDigest,synthesis:candidate.synthesis,sourceRefs:candidate.sourceRefs,...(stored?{candidateId:candidate.id}:{})});
 async function acceptedComparison(scope,angle,output=DESIGN_COMPARISON_OUTPUTS[0],ttlMs=60000){
  const before=media(scope,`synthesis-${++serial}-before`,'before',angle),after=media(scope,`synthesis-${++serial}-after`,'after',angle);await send(scope,{type:'attach_media',mediaIds:[before.mediaId,after.mediaId]});
  const candidate=await completionCandidate(scope,before,after,angle,output);await publish(scope,candidate,ttlMs===60000?app:composition({ttlMs}));await app.service.dispatch(await acceptance(scope,candidate));return candidate;
 }
 const publish=(scope,candidate,instance=app)=>instance.candidates.publish({credential,scope,candidate});
 async function acceptance(scope,candidate,requestId=`accept-${++serial}`){return {credential,scope,requestId,expectedRevision:(await load(scope)).record.revision,intent:{type:'accept_model_candidate',candidateId:candidate.id,selectedIndices:[0]}};}
 async function pending(id,options={}){const scope=await initialized(id),candidate=await textCandidate(scope),instance=options.ttlMs?composition(options):app;await publish(scope,candidate,instance);return {scope,candidate,instance,request:await acceptance(scope,candidate)};}
 async function archiveRequest(scope){const {snapshot}=await app.service.snapshot({credential,scope}),head=await app.repositories.loadFullArchive({credential,scope});return {credential,scope,requestId:`archive-${++serial}`,expectedVersion:head.currentVersion,expectedParentDigest:head.currentDigest,snapshot};}
 function media(scope,id,stage='before',angle='front'){const binding={owner:'alice',store,scope},record={mediaId:id,requestId:id,binding,stage,angle,mime:'image/png',byteLength:123,width:64,height:64,sha256:hash('synthetic-original-image-metadata'),active:true};f.sql(`insert into design_private.media_records values(${quote(digest(binding))},${quote(id)},${json(record)},${quote(digest(record))});insert into design_private.media_access values(${quote(digest(binding))},${quote(id)},true,1);`);return record;}
 async function until(predicate,label){for(let i=0;i<150;i++){if(await predicate())return;await sleep(30);}throw Error(`Timed out: ${label}`);}
 const blocked=application=>until(()=>Number(f.sql(`select count(*) from pg_stat_activity where application_name=${quote(application)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`))>0,application+' actual database lock');
 function paused(application,match){const held=latch(),release=latch();let used=false;const value=composition({application,async afterQuery(text){if(!used&&match(text)){used=true;held.resolve();await release.promise;}}});return {...value,held:held.promise,resume:release.resolve};}
 async function ready(pause,work){await Promise.race([pause.held,work.then(()=>{throw Error('Expected SQL pause not reached');})]);}
 let textAccepted,visualAccepted;
 try{
  await test('guarded Stage8 fixture is additive, private and requires explicit bounded TTL',async()=>{
   assert.equal(f.sql("select version from design_private.workflow_contract where id"),'design-workflow-postgres-v1');
   for(const table of ['model_candidates','model_candidate_access','model_candidate_acceptances'])assert.equal(count(table),0);
   for(const ttlMs of [undefined,null,0,999,3600001,1000.5]){const repository=app.repositories.createCandidateRepository({ttlMs});await rejects(repository.publish({}),'PG_CANDIDATE_NOT_CONFIGURED');await rejects(repository.load({}),'PG_CANDIDATE_NOT_CONFIGURED');}
   await rejects(app.repositories.createCandidateRepository().publish({}),'PG_CANDIDATE_NOT_CONFIGURED');
   for(const ttlMs of [1000,3600000])assert.equal(typeof app.repositories.createCandidateRepository({ttlMs}).publish,'function');
  });
  await test('text publication is immutable, exact replay preserves TTL and never changes workflow',async()=>{
   const scope=await initialized(801),candidate=await textCandidate(scope),before=(await load(scope)).record;
   const beforeTime=Number(f.sql('select floor(extract(epoch from clock_timestamp())*1000)::bigint;'));
   const saved=await publish(scope,candidate),expiresAt=Date.parse(expiry(candidate.id));
   const afterTime=Number(f.sql('select floor(extract(epoch from clock_timestamp())*1000)::bigint;'));
   assert.equal(saved.replayed,false);assert.deepEqual(saved.candidate,candidate);assert(expiresAt>=beforeTime+60000&&expiresAt<=afterTime+60000);
   const raw=rawCandidate(candidate.id);assert.equal((await publish(scope,candidate,composition({ttlMs:3600000}))).replayed,true);assert.equal(rawCandidate(candidate.id),raw);
   await rejects(publish(scope,{...candidate,payloadDigest:hash('changed-payload')}),'PG_CANDIDATE_CONFLICT');
   assert.deepEqual((await app.candidates.load({credential,scope,candidateId:candidate.id})).candidate,candidate);
   assert.deepEqual((await load(scope)).record,before);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),0);
   textAccepted={scope,candidate,before,raw,request:await acceptance(scope,candidate)};
  });
  await test('acceptance uses stored text and full provenance, remains pending until explicit confirmation',async()=>{
   const {scope,candidate,before,request}=textAccepted,expected=applyTrustedDesignCandidate({session:before.session,candidate,selectedIndices:[0],requestId:request.requestId});
   const result=await app.service.dispatch(request);assert.equal(result.record.schemaVersion,'design-prepared-workflow-record-v2');assert.equal(result.record.revision,before.revision+1);
   assert.deepEqual(result.record.session,expected.session);assert.deepEqual(result.record.session.sources,before.session.sources);assert.equal(getDesignView(result.record.session).entries[0].status,'not_confirmed');
   const lane={candidate,acceptance:{requestId:request.requestId,workflowRevision:result.record.revision,receipt:expected.acceptedReceipt}};assert.deepEqual(result.record.modelCandidates,[lane]);
   const receipt=JSON.parse(f.sql(`select receipt from design_private.model_candidate_acceptances where ${candidateWhere(candidate.id)};`));
   assert.deepEqual(receipt,{scope,candidateId:candidate.id,candidateDigest:digest(candidate),receiptKey:digest([actor,request.requestId]),acceptance:lane.acceptance});
   assert.equal(rawCandidate(candidate.id),textAccepted.raw);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);
   const confirmed=await send(scope,{type:'confirm_entry',entryId:candidate.candidate.entries[0].id,text:'【合成测试】员工确认短发。'});assert.equal(getDesignView(confirmed.record.session).entries[0].status,'confirmed');
  });
  await test('visual candidates require attached active private media with exact original SHA',async()=>{
   const scope=await initialized(802),original=media(scope,'candidate-visual-original');
   await rejects(publish(scope,await visualCandidate(scope,original)),'PG_CANDIDATE_DENIED');
   await send(scope,{type:'attach_media',mediaIds:[original.mediaId]});
   const candidate=await visualCandidate(scope,original);
   // Keep the visual source IDs valid so refusal exercises provenance rather than ID format.
   const wrongSha={...candidate,sourceRefs:[{...candidate.sourceRefs[0],sourceSha256:hash('different-original')}]};
   await rejects(publish(scope,wrongSha),'PG_CANDIDATE_DENIED');await publish(scope,candidate);
   const request=await acceptance(scope,candidate),result=await app.service.dispatch(request);
   assert.deepEqual(result.record.modelCandidates[0].candidate,candidate);assert.equal(result.record.session.sources.at(-1).actor,'model');assert.equal(result.record.session.sources.at(-1).kind,'image_description');assert.match(result.record.session.sources.at(-1).text,/未确认、非测量或事实/);assert.equal(getDesignView(result.record.session).entries[0].status,'not_confirmed');
   visualAccepted={scope,candidate,request};
   const revokedScope=await initialized(803),revokedMedia=media(revokedScope,'candidate-visual-revoked');await send(revokedScope,{type:'attach_media',mediaIds:[revokedMedia.mediaId]});const revoked=await visualCandidate(revokedScope,revokedMedia);await publish(revokedScope,revoked);const revokeRequest=await acceptance(revokedScope,revoked);
   f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(revokedMedia.mediaId)};`);
   await rejects(app.candidates.load({credential,scope:revokedScope,candidateId:revoked.id}),'PG_CANDIDATE_DENIED');await rejects(app.service.dispatch(revokeRequest),'WORKFLOW_MEDIA_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(revoked.id)),0);
  });
  await test('browser candidate objects, unknown IDs, changed IDs and cross-scope/actor/store attempts fail closed',async()=>{
   const {scope,candidate,request}=await pending(804),other=await initialized(805);
   await rejects(app.service.dispatch({...request,intent:{...request.intent,candidate}}),'WORKFLOW_INVALID_FIELDS');
   await rejects(app.service.dispatch({...request,intent:{...request.intent,candidateId:'not-published'}}),'WORKFLOW_CANDIDATE_DENIED');
   await rejects(app.candidates.load({credential,scope:other,candidateId:candidate.id}),'PG_CANDIDATE_DENIED');
   await rejects(publish(scope,{...candidate,actor:{username:'bob',store}}),'PG_CANDIDATE_DENIED');
   await rejects(publish(scope,{...candidate,store:'向里造型',actor:{...actor,store:'向里造型'}}),'PG_CANDIDATE_DENIED');
   await rejects(publish(other,{...candidate,scope:other}),'PG_CANDIDATE_DENIED');
   await rejects(app.service.dispatch({...request,credential:f.tokens.bob}),'WORKFLOW_ACCESS_DENIED');
   assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),0);
  });
  await test('changed base, expired pending candidate and revoked candidate deny new acceptance',async()=>{
   const stale=await pending(806);await send(stale.scope,source('【合成测试】新的原话。'));const currentRequest={...stale.request,expectedRevision:(await load(stale.scope)).record.revision};
   await rejects(app.service.dispatch(currentRequest),'WORKFLOW_CANDIDATE_DENIED');
   await rejects(publish(stale.scope,{...stale.candidate,id:'stale-unpublished'}),'PG_CANDIDATE_DENIED');
   const expired=await pending(807,{ttlMs:4000});expire(expired.candidate.id);
   await rejects(app.candidates.load({credential,scope:expired.scope,candidateId:expired.candidate.id}),'PG_CANDIDATE_DENIED');await rejects(app.service.dispatch(expired.request),'WORKFLOW_CANDIDATE_DENIED');
   const revoked=await pending(808);f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${candidateWhere(revoked.candidate.id)};`);
   await rejects(app.candidates.load({credential,scope:revoked.scope,candidateId:revoked.candidate.id}),'PG_CANDIDATE_DENIED');await rejects(app.service.dispatch(revoked.request),'WORKFLOW_CANDIDATE_DENIED');
   for(const value of [stale,expired,revoked])assert.equal(count('model_candidate_acceptances',candidateWhere(value.candidate.id)),0);
   const late=await pending(816,{ttlMs:5000});let wrote=false,waited=false;
   const atCommit=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.model_candidate_acceptances'))wrote=true;},beforeQuery(text){if(wrote&&text==='COMMIT'&&!waited){waited=true;expire(late.candidate.id);}}});
   await rejects(atCommit.service.dispatch(late.request),'WORKFLOW_OUTCOME_UNCERTAIN');assert.equal(waited,true);
   assert.equal(count('model_candidate_acceptances',candidateWhere(late.candidate.id)),0);assert.equal(count('workflow_versions',where(late.scope)),late.request.expectedRevision+1);
   assert.equal(count('workflow_receipts',`receipt->'request'->>'requestId'=${quote(late.request.requestId)}`),0);
  });
  await test('actual concurrent CAS consumes once; concurrent identical requests replay one receipt',async()=>{
   for(const sameRequest of [false,true]){
    const {scope,candidate,request}=await pending(sameRequest?810:809),name='candidate-cas-'+sameRequest;
    const first=paused(name+'-first',text=>text.startsWith('INSERT INTO design_private.model_candidate_acceptances'));
    const a=first.service.dispatch(request);await ready(first,a);
    const second=composition({application:name+'-second'}),b=sameRequest?second.service.dispatch(request):rejects(second.service.dispatch({...request,requestId:request.requestId+'-other'}),'WORKFLOW_REVISION_CONFLICT');
    try{await blocked(name+'-second');}finally{first.resume();}
    assert.equal((await a).replayed,false);const result=await b;if(sameRequest)assert.equal(result.replayed,true);
    assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);assert.equal(count('workflow_versions',where(scope)),request.expectedRevision+2);assert.equal(count('workflow_receipts',`receipt->'scope'=${json(scope)} and receipt->'request'->'intent'->>'type'='accept_model_candidate'`),1);
   }
  });
  await test('exact accepted replay returns current head after expiry/revocation without erasing history',async()=>{
   const {scope,candidate,request}=await pending(811,{ttlMs:5000});const accepted=await app.service.dispatch(request);expire(candidate.id);
   assert.deepEqual((await load(scope)).record.modelCandidates,accepted.record.modelCandidates);
   f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${candidateWhere(candidate.id)};`);
   const newer=await send(scope,source('【合成测试】采纳以后新增原话。')),replay=await app.service.dispatch(request);
   assert.equal(replay.replayed,true);assert.deepEqual(replay.record,newer.record);assert.deepEqual(replay.record.modelCandidates,accepted.record.modelCandidates);
   await rejects(app.service.dispatch({...request,requestId:'consume-again',expectedRevision:newer.record.revision}),'WORKFLOW_CANDIDATE_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);
  });
  await test('receipt-stage failures roll back acceptance, workflow version and request receipt atomically',async()=>{
   for(const [id,table] of [[812,'model_candidate_acceptances'],[813,'workflow_receipts']]){
    const {scope,candidate,request}=await pending(id),before=(await load(scope)).record;
    const bad=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.'+table))throw Error('synthetic failure after actual receipt insert');}});
    await rejects(bad.service.dispatch(request),'WORKFLOW_OUTCOME_UNCERTAIN');assert.deepEqual((await load(scope)).record,before);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),0);assert.equal(count('workflow_receipts',`receipt->'request'->>'requestId'=${quote(request.requestId)}`),0);
    assert.equal((await app.service.dispatch(request)).replayed,false);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);
   }
  });
  await test('lost real COMMIT acknowledgement is uncertain and explicit exact retry reconciles once',async()=>{
   const {scope,candidate,request}=await pending(814);let wrote=false,commits=0;
   const uncertain=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.model_candidate_acceptances'))wrote=true;if(wrote&&text==='COMMIT'){commits++;throw Error('synthetic lost commit acknowledgement');}}});
   await assert.rejects(uncertain.service.dispatch(request),e=>e.code==='WORKFLOW_OUTCOME_UNCERTAIN'&&e.outcome==='uncertain'&&e.retryable===false);
   assert.equal(commits,1);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);assert.equal((await app.service.dispatch(request)).replayed,true);assert.equal(count('workflow_versions',where(scope)),request.expectedRevision+2);
  });
  await test('restart reads complete v2 provenance and full archive while old v1 bytes/hashes stay unchanged',async()=>{
   const scope=await initialized(815),candidate=await textCandidate(scope),oldRecord=(await load(scope)).record;
   const oldRequest=await archiveRequest(scope),oldSaved=await app.full.append(oldRequest);assert.equal(oldSaved.version.snapshot.schemaVersion,'design-full-workflow-snapshot-v1');
   const oldRows=f.sql(`select jsonb_agg(to_jsonb(v) order by revision) from design_private.workflow_versions v where ${where(scope)};`),oldFull=f.sql(`select to_jsonb(v) from design_private.full_versions v where ${where(scope)} and version=1;`);
   await publish(scope,candidate);const accepted=await app.service.dispatch(await acceptance(scope,candidate)),newRequest=await archiveRequest(scope),newSaved=await app.full.append(newRequest);
   assert.equal(newSaved.version.snapshot.schemaVersion,'design-full-workflow-snapshot-v2');assert.deepEqual(unpackFullWorkflowSnapshot(newSaved.version.snapshot).modelCandidates,accepted.record.modelCandidates);
   app=composition();assert.deepEqual((await load(scope)).record,accepted.record);const history=await app.repositories.loadFullArchive({credential,scope});assert.deepEqual(history.versions.map(v=>v.snapshot),[oldSaved.version.snapshot,newSaved.version.snapshot]);
   assert.equal(f.sql(`select jsonb_agg(to_jsonb(v) order by revision) from design_private.workflow_versions v where ${where(scope)} and revision<=${oldRecord.revision};`),oldRows);assert.equal(f.sql(`select to_jsonb(v) from design_private.full_versions v where ${where(scope)} and version=1;`),oldFull);
   assert.equal((await app.full.append(oldRequest)).replayed,true);assert.deepEqual((await app.service.snapshot({credential,scope:visualAccepted.scope})).snapshot.modelCandidates[0].candidate,visualAccepted.candidate);
  });
  await test('raw candidate/acceptance rows are immutable and access only revokes once; no role grants',async()=>{
   for(const [table,column] of [['model_candidates','envelope'],['model_candidate_acceptances','receipt']]){
    assert(count(table)>0);for(const operation of [`update design_private.${table} set ${column}=${column}`,`delete from design_private.${table}`])assert.throws(()=>f.sql(operation+';'),e=>String(e.stderr).includes('DESIGN_APPEND_ONLY'));
   }
   const id=textAccepted.candidate.id,condition=candidateWhere(id);
   for(const operation of [`update design_private.model_candidate_access set active=false,revision=revision where ${condition}`,`update design_private.model_candidate_access set active=true,revision=revision+1 where ${condition}`,`delete from design_private.model_candidate_access where ${condition}`])assert.throws(()=>f.sql(operation+';'),e=>String(e.stderr).includes('DESIGN_CANDIDATE_REVOCATION_ONLY'));
   f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${condition};`);
   for(const active of [false,true])assert.throws(()=>f.sql(`update design_private.model_candidate_access set active=${active},revision=revision+1 where ${condition};`),e=>String(e.stderr).includes('DESIGN_CANDIDATE_REVOCATION_ONLY'));
   for(const role of ['anon','authenticated'])for(const table of ['model_candidates','model_candidate_access','model_candidate_acceptances'])assert.equal(f.sql(`select has_table_privilege(${quote(role)},${quote('design_private.'+table)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`),'f');
   assert(f.observed.some(q=>q.parameterCount>0));assert(f.observed.every(q=>q.parameterCount===q.placeholderCount));
  });
  await test('pending preview expiry during its second final authorization is denied without writes',async()=>{
   const {scope,candidate}=await pending(817,{ttlMs:5000});
   const persisted=()=>({candidate:rawCandidate(candidate.id),workflow:f.sql(`select jsonb_agg(to_jsonb(v) order by revision) from design_private.workflow_versions v where ${where(scope)};`),counts:Object.fromEntries(['model_candidates','model_candidate_access','model_candidate_acceptances','workflow_versions','workflow_receipts','commit_checks'].map(table=>[table,count(table)]))});
   const before=persisted(),observedStart=f.observed.length;let acceptanceReads=0,preAuthClockChecks=0,delayed=false;
   const delayedPreview=composition({
    afterQuery(text){if(text.startsWith('SELECT receipt FROM design_private.model_candidate_acceptances'))acceptanceReads++;if(acceptanceReads===2&&!delayed&&text==='SELECT clock_timestamp()::text AS now')preAuthClockChecks++;},
    beforeQuery(text){
     assert(!/^(INSERT|UPDATE|DELETE)\b/.test(text),'candidate preview must remain read-only, including commit checks');
     if(acceptanceReads===2&&!delayed&&text.includes('FROM public.employee_booking_sessions')){assert(preAuthClockChecks>0,'second pending candidate was checked before final authorization');delayed=true;expire(candidate.id);}
    },
   });
   await rejects(delayedPreview.candidates.load({credential,scope,candidateId:candidate.id}),'PG_CANDIDATE_DENIED');
   assert.equal(acceptanceReads,2);assert.equal(delayed,true);assert.deepEqual(persisted(),before);
   assert(f.observed.slice(observedStart).every(query=>['SELECT','BEGIN','SET','COMMIT','ROLLBACK'].includes(query.command)),'no write was attempted by either preview transaction');
  });
  await test('completion comparison preserves ordered two-photo provenance and independent manual review across restart/full history',async()=>{
   const scope=await completed(820),before=media(scope,'comparison-front-before','before','front'),after=media(scope,'comparison-front-after','after','front');
   await send(scope,{type:'attach_media',mediaIds:[before.mediaId,after.mediaId]});
   const said=await send(scope,{type:'record_source',kind:'text',text:'【合成测试】员工观察已经记录，不由模型替换。'}),original=said.record.session.sources.at(-1);
   const manually=await send(scope,{type:'record_review',field:'observed_result',value:original.text,sourceId:original.messageId,quote:original.text,replacesEntryId:null});
   const manualEntry=getDesignView(manually.record.session).entries.find(e=>e.field==='observed_result');
   const firstRequest=await archiveRequest(scope),first=await app.full.append(firstRequest),oldRow=f.sql(`select to_jsonb(v) from design_private.full_versions v where ${where(scope)} and version=1;`);
   const candidate=await completionCandidate(scope,before,after),published=await publish(scope,candidate),request=await acceptance(scope,candidate),accepted=await app.service.dispatch(request);
   assert.equal(published.replayed,false);assert.deepEqual(accepted.record.modelCandidates[0].candidate,candidate);
   const entries=getDesignView(accepted.record.session).entries,model=entries.find(e=>e.id===candidate.candidate.entries[0].id);
   assert.equal(model.status,'not_confirmed');assert.equal(model.track,'actual');assert.equal(model.basis,'observable');assert.deepEqual(entries.find(e=>e.field==='observed_result'),manualEntry);
   assert.deepEqual(candidate.sourceRefs.map(r=>r.mediaId),[before.mediaId,after.mediaId]);assert.equal(accepted.record.session.sources.at(-1).actor,'model');
   const second=await app.full.append(await archiveRequest(scope));assert.deepEqual(second.version.snapshot.modelCandidates[0].candidate,candidate);
   app=composition();assert.deepEqual((await load(scope)).record,accepted.record);assert.deepEqual((await app.repositories.loadFullArchive({credential,scope})).versions.map(v=>v.snapshot),[first.version.snapshot,second.version.snapshot]);assert.equal(f.sql(`select to_jsonb(v) from design_private.full_versions v where ${where(scope)} and version=1;`),oldRow);
   assert.equal((await app.service.dispatch(request)).replayed,true);
  });
  await test('comparison cannot label reference/after as before, mismatch angles or substitute unattached media',async()=>{
   const scope=await completed(821),validBefore=media(scope,'compare-valid-before','before','front'),validAfter=media(scope,'compare-valid-after','after','front');
   const cases=[
    [media(scope,'compare-reference','reference','front'),validAfter],
    [media(scope,'compare-wrong-before','after','front'),validAfter],
    [validBefore,media(scope,'compare-wrong-after','before','front')],
    [validBefore,media(scope,'compare-wrong-angle','after','back')],
    [media(scope,'compare-detail','before','detail'),validAfter],
   ];
   const ids=[...new Set([validBefore.mediaId,validAfter.mediaId,...cases.flat().map(r=>r.mediaId)])];await send(scope,{type:'attach_media',mediaIds:ids});
   const prior=(await load(scope)).record,counts=[count('model_candidates'),count('model_candidate_acceptances'),count('workflow_versions')];
   for(const [before,after]of cases)await rejects(publish(scope,await completionCandidate(scope,before,after)),'PG_CANDIDATE_DENIED');
   const unattached=media(scope,'compare-unattached','after','front');await rejects(publish(scope,await completionCandidate(scope,validBefore,unattached)),'PG_CANDIDATE_DENIED');
   assert.deepEqual((await load(scope)).record,prior);assert.deepEqual([count('model_candidates'),count('model_candidate_acceptances'),count('workflow_versions')],counts);
  });
  await test('sequential front/back comparisons both remain visible and retain two immutable receipts',async()=>{
   const scope=await completed(822),pairs=['front','back'].map(angle=>[media(scope,`pair-${angle}-before`,'before',angle),media(scope,`pair-${angle}-after`,'after',angle)]);
   await send(scope,{type:'attach_media',mediaIds:pairs.flat().map(r=>r.mediaId)});
   const candidates=[];for(const [index,pair]of pairs.entries()){const candidate=await completionCandidate(scope,...pair,index===0?'front':'back',DESIGN_COMPARISON_OUTPUTS[index===0?0:4]);await publish(scope,candidate);await app.service.dispatch(await acceptance(scope,candidate));candidates.push(candidate);}
   const record=(await load(scope)).record,entries=getDesignView(record.session).entries;
   for(const c of candidates){assert(entries.some(e=>e.id===c.candidate.entries[0].id),'another angle must not supersede the earlier angle');assert.equal(count('model_candidate_acceptances',candidateWhere(c.id)),1);}
   assert.deepEqual(record.modelCandidates.map(r=>r.candidate),candidates);assert.notEqual(candidates[0].candidate.entries[0].field,candidates[1].candidate.entries[0].field);
   const archived=await app.full.append(await archiveRequest(scope));assert.deepEqual(unpackFullWorkflowSnapshot(archived.version.snapshot).modelCandidates,record.modelCandidates);
  });
  await test('comparison revoked photo denies acceptance; lost commit acknowledgement is not silently replayed',async()=>{
   const scope=await completed(823),before=media(scope,'revoked-pair-before','before','left'),after=media(scope,'revoked-pair-after','after','left');await send(scope,{type:'attach_media',mediaIds:[before.mediaId,after.mediaId]});
   const candidate=await completionCandidate(scope,before,after,'left');await publish(scope,candidate);const request=await acceptance(scope,candidate),oldWorkflow=f.sql(`select jsonb_agg(to_jsonb(v) order by revision) from design_private.workflow_versions v where ${where(scope)};`);
   f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(after.mediaId)};`);
   await rejects(app.candidates.load({credential,scope,candidateId:candidate.id}),'PG_CANDIDATE_DENIED');await rejects(app.service.dispatch(request),'WORKFLOW_MEDIA_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),0);assert.equal(f.sql(`select jsonb_agg(to_jsonb(v) order by revision) from design_private.workflow_versions v where ${where(scope)};`),oldWorkflow);
   const uncertainScope=await completed(824),b=media(uncertainScope,'uncertain-before','before','right'),a=media(uncertainScope,'uncertain-after','after','right');await send(uncertainScope,{type:'attach_media',mediaIds:[b.mediaId,a.mediaId]});const c=await completionCandidate(uncertainScope,b,a,'right');await publish(uncertainScope,c);const r=await acceptance(uncertainScope,c);let inserted=false,lost=false;
   const uncertain=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.model_candidate_acceptances'))inserted=true;if(inserted&&text==='COMMIT'&&!lost){lost=true;throw Error('synthetic lost acknowledgement');}}});
   await rejects(uncertain.service.dispatch(r),'WORKFLOW_OUTCOME_UNCERTAIN');assert(lost);assert.equal(count('model_candidate_acceptances',candidateWhere(c.id)),1);assert.equal((await app.service.dispatch(r)).replayed,true);assert.equal(count('model_candidate_acceptances',candidateWhere(c.id)),1);
  });
  await test('three-view synthesis preserves immutable ancestors, six originals and full history after restart',async()=>{
   const scope=await completed(830),ancestors=[];for(const angle of ['front','back','left'])ancestors.push(await acceptedComparison(scope,angle));
   const oldRecord=(await load(scope)).record,oldRows=ancestors.map(c=>rawCandidate(c.id)),fullBefore=await app.full.append(await archiveRequest(scope));
   const candidate=await synthesisCandidate(scope);assert.equal(candidate.sourceRefs.length,6);assert.deepEqual(candidate.synthesis.missingAngles,[]);
   const reads={begins:0,commits:0,candidateMetadata:0,candidateEnvelope:0,candidateAccess:0,candidateReceipt:0,mediaRecord:0,mediaAccess:0,total:0};
   const counted=composition({beforeQuery(text){reads.total++;if(text.startsWith('BEGIN'))reads.begins++;if(text==='COMMIT')reads.commits++;for(const [key,prefix] of [['candidateMetadata','SELECT scope_key,sha256,expires_at'],['candidateEnvelope','SELECT envelope FROM design_private.model_candidates'],['candidateAccess','SELECT active,revision FROM design_private.model_candidate_access'],['candidateReceipt','SELECT receipt FROM design_private.model_candidate_acceptances'],['mediaRecord','SELECT record,record_sha256 FROM design_private.media_records'],['mediaAccess','SELECT active,revision FROM design_private.media_access']])if(text.startsWith(prefix))reads[key]++;}});
   assert.equal(await counted.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate)),true);
   assert.equal(reads.begins,2);assert.equal(reads.commits,2,'independent fresh transactions remain mandatory');
   for(const key of ['candidateMetadata','candidateEnvelope','candidateAccess','candidateReceipt'])assert.equal(reads[key],12,'each transaction checks three history candidates plus three current ancestors exactly once');
   for(const key of ['mediaRecord','mediaAccess'])assert.equal(reads[key],12,'all six originals are locked and checked once in each fresh transaction');
   if(requestMemo)assert.equal(reads.total,292,'pure memo does not remove any fresh database query');
   console.log('diagnostic synthesis read counts '+JSON.stringify(reads)+'; removed 48 duplicate SELECTs versus the prior two-transaction algorithm, without omitting either transaction');
   await publish(scope,candidate);const request=await acceptance(scope,candidate),accepted=await app.service.dispatch(request),summary=getDesignView(accepted.record.session).entries.find(e=>e.id===candidate.candidate.entries[0].id);
   assert.equal(summary.origin,'suggestion');assert.equal(summary.basis,'inferred');assert.equal(summary.status,'not_confirmed');assert.deepEqual(accepted.record.modelCandidates.slice(0,3),oldRecord.modelCandidates);assert.deepEqual(ancestors.map(c=>rawCandidate(c.id)),oldRows);
   const fullAfter=await app.full.append(await archiveRequest(scope));app=composition();assert.deepEqual((await load(scope)).record,accepted.record);assert.deepEqual((await app.repositories.loadFullArchive({credential,scope})).versions.map(v=>v.snapshot),[fullBefore.version.snapshot,fullAfter.version.snapshot]);assert.equal((await app.service.dispatch(request)).replayed,true);
  });
  await test('partial/uncertain synthesis keeps missing-angle limits and accepts a valid non-default model focus',async()=>{
   const scope=await completed(831);await acceptedComparison(scope,'front',DESIGN_COMPARISON_OUTPUTS[4]);
   const candidate=await synthesisCandidate(scope,'right',prepared=>{const choices=designSynthesisReviewChoices(prepared.synthesis);assert(choices.length>1);prepared.synthesis.reviewFocus=choices.at(-1);});
   assert.deepEqual(candidate.synthesis.missingAngles,['back','right']);assert.deepEqual(candidate.synthesis.uncomparableAngles,['front']);assert.equal(candidate.synthesis.assessment,'limited_evidence');assert.equal(candidate.synthesis.generation,'model_review_focus');
   assert.equal(await app.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate)),true);await publish(scope,candidate);const accepted=await app.service.dispatch(await acceptance(scope,candidate));assert.deepEqual(accepted.record.modelCandidates.at(-1).candidate,candidate);assert.equal(candidate.sourceRefs.length,2);
   // Valid shape but invented ancestor digest cannot establish immutable evidence.
   const wrong=await synthesisCandidate(scope,'right',prepared=>{prepared.synthesis.evidence[0].candidateDigest=hash('not-the-accepted-artifact');});await rejects(publish(scope,wrong),'PG_CANDIDATE_DENIED');await rejects(app.repositories.verifySynthesisAncestors(verifyRequest(scope,wrong)),'PG_CANDIDATE_DENIED');
  });
  await test('accepted ancestor TTL may expire, but explicit revocation blocks generation, pending preview and acceptance',async()=>{
   const scope=await completed(832),ancestor=await acceptedComparison(scope,'front',DESIGN_COMPARISON_OUTPUTS[0],4000);
   // It may already have expired during other authorized reads; wait only the remaining DB duration.
   f.sql(`select pg_sleep(greatest(extract(epoch from (expires_at-clock_timestamp())),0)+0.02) from design_private.model_candidates where ${candidateWhere(ancestor.id)};`);
   const candidate=await synthesisCandidate(scope);assert.equal(await app.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate)),true);await publish(scope,candidate);const request=await acceptance(scope,candidate),before=(await load(scope)).record;
   f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${candidateWhere(ancestor.id)};`);
   await rejects(app.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate)),'PG_CANDIDATE_DENIED');await rejects(app.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate,true)),'PG_CANDIDATE_DENIED');await rejects(app.candidates.load({credential,scope,candidateId:candidate.id}),'PG_CANDIDATE_DENIED');await rejects(app.service.dispatch(request),'WORKFLOW_CANDIDATE_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),0);assert.deepEqual((await load(scope)).record,before);
  });
  await test('fresh ancestor verifier rejects a revoke between reads and does not trust a caller history flag or changed envelope',async()=>{
   const scope=await completed(833),ancestor=await acceptedComparison(scope,'front'),candidate=await synthesisCandidate(scope);let begins=0;
   const changed=composition({beforeQuery(text){if(text.startsWith('BEGIN')&&++begins===2)f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${candidateWhere(ancestor.id)};`);}});
   await rejects(changed.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate)),'PG_CANDIDATE_DENIED');assert.equal(begins,2);
   await rejects(app.repositories.verifySynthesisAncestors({...verifyRequest(scope,candidate),historical:true}),'PG_WORKFLOW_INVALID');
   const other=await completed(834);await acceptedComparison(other,'front');const saved=await synthesisCandidate(other);await publish(other,saved);
   const noVerifier=createPreparedWorkflowService({enabled:true,permissionGate:app.repositories.employeeAdapter.gate,repository:app.repositories.workflowRepository,mediaResolver:app.repositories.mediaResolver,mediaVerifier:app.repositories.mediaVerifier});
   await rejects(noVerifier.dispatch(await acceptance(other,saved)),'WORKFLOW_CANDIDATE_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(saved.id)),0);
   await rejects(app.repositories.verifySynthesisAncestors({...verifyRequest(other,saved,true),sourceRefs:[]}),'PG_CANDIDATE_DENIED');
   await rejects(app.repositories.verifySynthesisAncestors({...verifyRequest(other,saved,true),actor:{username:'bob',store}}),'PG_WORKFLOW_SCOPE_DENIED','RELATIONSHIP_DENIED');
  });
  await test('post-COMMIT ancestor revocation makes first acceptance uncertain without erasing history or exact replay',async()=>{
   const scope=await completed(835),ancestor=await acceptedComparison(scope,'front'),candidate=await synthesisCandidate(scope);await publish(scope,candidate);const request=await acceptance(scope,candidate);let inserted=false,revoked=false;
   const raced=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.model_candidate_acceptances'))inserted=true;if(inserted&&text==='COMMIT'&&!revoked){revoked=true;f.sql(`update design_private.model_candidate_access set active=false,revision=revision+1 where ${candidateWhere(ancestor.id)};`);}}});
   await rejects(raced.service.dispatch(request),'WORKFLOW_OUTCOME_UNCERTAIN');assert(revoked);assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);
   const record=(await load(scope)).record;assert.equal(record.modelCandidates.at(-1).candidate.id,candidate.id);assert.equal((await app.service.dispatch(request)).replayed,true);
   assert.equal(await app.repositories.verifySynthesisAncestors(verifyRequest(scope,candidate,true)),true,'only stored consumed state permits historical review');assert.deepEqual((await app.candidates.load({credential,scope,candidateId:candidate.id})).candidate,candidate);
   const next=await synthesisCandidate(scope);await rejects(publish(scope,next),'PG_CANDIDATE_DENIED');assert.equal(count('model_candidate_acceptances',candidateWhere(candidate.id)),1);
   const full=await app.full.append(await archiveRequest(scope));assert.deepEqual(full.version.snapshot.modelCandidates,record.modelCandidates);
  });
  await test('same-call locked-row reuse still rejects receipt corruption, original hash/metadata mismatch and revocation between fresh reads',async()=>{
   const scope=await completed(836),ancestor=await acceptedComparison(scope,'front'),candidate=await synthesisCandidate(scope),request=verifyRequest(scope,candidate);
   const before={workflow:count('workflow_versions',where(scope)),candidates:count('model_candidates'),receipts:count('model_candidate_acceptances')};
   if(requestMemo){
    // History records are already warm from candidate preparation. Reusing their
    // pure validation must not hide newly read row hashes or workflow receipts.
    for(const kind of ['row_hash','workflow_receipt']){
     let changed=false;
     const corrupt=composition({afterQuery(text,params,result){
      if(changed)return;
      if(kind==='row_hash'&&text.startsWith('SELECT revision,record,sha256,previous_sha256,receipt_key FROM design_private.workflow_versions')){result.rows[0].sha256=hash('synthetic-corrupt-fresh-row-hash');changed=true;}
      if(kind==='workflow_receipt'&&text.startsWith('SELECT receipt,record_sha256 FROM design_private.workflow_receipts')){result.rows[0].receipt.fingerprint=hash('synthetic-corrupt-fresh-workflow-receipt');changed=true;}
     }});
     await rejects(corrupt.repositories.verifySynthesisAncestors(request),'PG_WORKFLOW_CORRUPT');assert(changed,kind+' must be checked after memo population');
    }
   }
   let receiptReads=0,receiptChanged=false;
   const badReceipt=composition({afterQuery(text,params,result){if(text.startsWith('SELECT receipt FROM design_private.model_candidate_acceptances')&&params[0]===ancestor.id&&++receiptReads===2){result.rows[0].receipt.receiptKey=hash('synthetic-incorrect-locked-receipt');receiptChanged=true;}}});
   await rejects(badReceipt.repositories.verifySynthesisAncestors(request),'PG_CANDIDATE_CORRUPT');assert(receiptChanged,'corrupt the current ancestor row after history verification, not an earlier unrelated query');
   for(const field of ['sha256','angle']){
    let changed=false;
    const corrupt=composition({afterQuery(text,params,result){if(!changed&&text.startsWith('SELECT record,record_sha256 FROM design_private.media_records')&&params[1]===candidate.sourceRefs[0].mediaId){result.rows[0].record[field]=field==='sha256'?hash('synthetic-incorrect-original'):'back';result.rows[0].record_sha256=digest(result.rows[0].record);changed=true;}}});
    await rejects(corrupt.repositories.verifySynthesisAncestors(request),'PG_CANDIDATE_DENIED');assert(changed);
   }
   let begins=0;
   const revoked=composition({beforeQuery(text){if(text.startsWith('BEGIN')&&++begins===2)f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(candidate.sourceRefs[0].mediaId)};`);}});
   await rejects(revoked.repositories.verifySynthesisAncestors(request),'PG_CANDIDATE_DENIED');assert.equal(begins,2,'a successful first transaction must not cache active media into the second');
   assert.deepEqual({workflow:count('workflow_versions',where(scope)),candidates:count('model_candidates'),receipts:count('model_candidate_acceptances')},before);
  });
  if(requestMemo){assert.equal(memoCases,23);assert.equal(memoCases,passed);assert(memoHitChecks>0);console.log(`request-memo verified: ${memoCases} independent case scopes; ${memoHitChecks} exact frozen-record hit assertions; fresh SQL and live checks unchanged`);}
  console.log(`PASS: ${passed} actual PG17 candidate integration cases; synthetic fixtures, no production/RLS/model-quality claim.`);
 }finally{await f.cleanup();console.log('cleanup ok - exact labelled synthetic container absent');}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
