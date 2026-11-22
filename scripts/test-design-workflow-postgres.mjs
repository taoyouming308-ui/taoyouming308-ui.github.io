/** Actual prepared workflow/full archive services over PostgreSQL 17.
 * Offline synthetic test only. No runtime driver, live data, provider or deployment.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createDesignPostgresFixture} from './fixtures/design-postgres-fixture.mjs';
import {createDesignPostgresExecutor} from '../packages/design-production-adapter/postgres-executor.mjs';
import {createDesignPostgresRepositories} from '../packages/design-production-adapter/postgres-workflow-repositories.mjs';
import {createPreparedWorkflowService} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createFullWorkflowSnapshot,unpackFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {appendDesignEvent,getDesignView} from '../packages/analysis-engine/design-pilot.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden in synthetic PostgreSQL tests');};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(canonical(v));
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const json=v=>`${quote(canonical(v))}::jsonb`;
const copy=v=>JSON.parse(JSON.stringify(v));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rejects=(promise,...codes)=>assert.rejects(promise,error=>{assert(codes.includes(error.code),`expected ${codes.join('|')}, got ${error.code}`);return true;});
function latch(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
let passed=0,serial=0;const failures=[];
async function test(name,fn){try{await fn();console.log(`ok ${++passed} - ${name}`);}catch(error){if(!process.argv.includes('--keep-going'))throw error;failures.push({name,error});console.error(`not ok - ${name}\n${error.stack}`);}}
async function main(){
 const f=await createDesignPostgresFixture();
 const {credential,scopeA,scopeB,store}=f;
 const count=(table,where='true')=>Number(f.sql(`select count(*) from design_private.${table} where ${where};`));
 const where=scope=>`scope_key=${quote(digest(scope))}`;
 function composition(options={}){
  const executor=createDesignPostgresExecutor({lifecyclePolicy:f.lifecyclePolicy,acquireClient:async()=>{
   const c=f.client(options.application),query=c.query.bind(c);
   return {release:c.release.bind(c),async query(text,params){if(options.beforeQuery)await options.beforeQuery(text,params,c);const result=await query(text,params);if(options.afterQuery)await options.afterQuery(text,params,result,c);return result;}};
  }});
  const repositories=createDesignPostgresRepositories({executor});
  const service=createPreparedWorkflowService({enabled:true,permissionGate:repositories.employeeAdapter.gate,repository:repositories.workflowRepository,mediaResolver:repositories.mediaResolver,mediaVerifier:repositories.mediaVerifier});
  return {executor,repositories,service,full:repositories.createFullWorkflowArchive({enabled:true})};
 }
 let app=composition();
 async function initialized(id,options={}){const scope=await f.seedSource(id,options);await app.repositories.initializeWorkflow({credential,scope});return scope;}
 const load=(scope=scopeA,instance=app)=>instance.service.load({credential,scope});
 async function send(intent,scope=scopeA,extra={},instance=app){const {record}=await load(scope,instance);return instance.service.dispatch({credential,scope,requestId:`pg-${++serial}`,expectedRevision:record.revision,intent,...extra});}
 const source=(text='【合成测试】左侧合成杠甲，实际合成杠乙。')=>({type:'record_source',kind:'text',text});
 async function advance(scope,target){const phases=['before_analysis','proposal','execution','completed_review'];while((await load(scope)).record.session.phase!==target){const phase=(await load(scope)).record.session.phase;await send({type:'advance',phase:phases[phases.indexOf(phase)+1]},scope);}}
 async function archiveRequest(scope=scopeA,extra={}){const {snapshot}=await app.service.snapshot({credential,scope});const head=await app.repositories.loadFullArchive({credential,scope});return {credential,scope,requestId:`full-${++serial}`,expectedVersion:head.currentVersion,expectedParentDigest:head.currentDigest,snapshot,...extra};}
 function media(scope,id,patch={}){
  const binding={owner:'alice',store,scope};
  const record={mediaId:id,requestId:id,binding,stage:'reference',angle:'detail',mime:'image/png',byteLength:123,width:64,height:64,sha256:hash('synthetic-image-metadata-only'),active:true,...patch};
  f.sql(`insert into design_private.media_records(binding_key,media_id,record,record_sha256) values(${quote(digest(binding))},${quote(id)},${json(record)},${quote(digest(record))}); insert into design_private.media_access(binding_key,media_id,active,revision) values(${quote(digest(binding))},${quote(id)},true,1);`);return record;
 }
 async function until(predicate,label){for(let i=0;i<150;i++){if(await predicate())return;await sleep(30);}throw Error(`Timed out: ${label}`);}
 const blocked=application=>until(()=>Number(f.sql(`select count(*) from pg_stat_activity where application_name=${quote(application)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`))>0,application+' row/advisory lock');
 function paused(application,match){const held=latch(),release=latch();let used=false;const value=composition({application,async afterQuery(text){if(!used&&match(text)){used=true;held.resolve();await release.promise;}}});return {...value,held:held.promise,resume:release.resolve};}
 async function ready(pause,work){await Promise.race([pause.held,work.then(()=>{throw Error('Expected SQL pause not reached');})]);}
 try{
  await test('guarded Stage7 schema and isolated PG17 fixture initialized with actual employee binding',async()=>{
   assert.equal(f.sql("select version from design_private.workflow_contract where id"),'design-workflow-postgres-v1');
   assert.equal((await app.repositories.employeeAdapter.gate.authorize(credential,scopeA)).actor.username,'alice');
   assert.equal(count('workflow_versions'),0);
  });
  await test('ordered test bridge retains exact error frames and split UTF-8 data',async()=>{
   const c=f.client('stage7-bridge');try{
    const value=" ' ; DROP TABLE staff; -- 合成🙂\\\n ".repeat(5000);
    assert.equal((await c.query('select $1::text as value,$2::text as absent',[value,null])).rows[0].value,value);
    for(let i=0;i<128;i++){
     const legacy=i%2===0;let failure;try{await c.query(legacy?'SELECT public.append_customer_design_version($1::jsonb,$2::text,$3::text) AS result':'SELECT 1/0 AS value',legacy?[{},'','manual']:[]);}catch(e){failure=e;}
     assert.deepEqual(failure&&{code:failure.code,message:failure.message},legacy?{code:'22023',message:'CUSTOMER_DESIGN_AUTHOR_REQUIRED'}:{code:'22012',message:'division by zero'});
    }
   }finally{await c.release();}
  });
  await test('server initialization is idempotent and restart recovers exact native free text',async()=>{
   for(const scope of [scopeA,scopeB])await app.repositories.initializeWorkflow({credential,scope});
   await app.repositories.initializeWorkflow({credential,scope:scopeA});assert.equal(count('workflow_versions'),2);
   const raw="  【合成测试】<img src=x onerror=alert(1)> ' ; --\n原始文字🙂  ";
   const saved=await send(source(raw));app=composition();const restored=await load();assert.deepEqual(restored.record,saved.record);assert.equal(restored.record.session.sources[0].text,raw);assert.equal(restored.record.session.sources[0].actor,'employee');assert.equal(count('workflow_versions',where(scopeA)),2);
  });
  await test('workflow receipt replay returns current head, altered payload and cross-scope request conflict',async()=>{
   const request={credential,scope:scopeA,requestId:'workflow-replay',expectedRevision:(await load()).record.revision,intent:source('【合成测试】原始请求')};
   const saved=await app.service.dispatch(request);await send(source('【合成测试】之后的版本'));
   const replay=await app.service.dispatch(request);assert.equal(replay.replayed,true);assert.equal(replay.record.revision,saved.record.revision+1);
   await rejects(app.service.dispatch({...request,intent:source('changed')}),'WORKFLOW_REQUEST_CONFLICT');
   await rejects(app.service.dispatch({...request,scope:scopeB}),'WORKFLOW_REQUEST_CONFLICT');
  });
  await test('actual PostgreSQL CAS concurrency has one writer and no losing receipt',async()=>{
   const scope=await initialized(201),request={credential,scope,requestId:'cas-one',expectedRevision:0,intent:source()};
   const first=paused('workflow-cas-first',text=>text.startsWith('INSERT INTO design_private.workflow_versions'));
   const a=first.service.dispatch(request);await ready(first,a);
   const b=rejects(composition({application:'workflow-cas-second'}).service.dispatch({...request,requestId:'cas-two'}),'WORKFLOW_REVISION_CONFLICT');
   try{await blocked('workflow-cas-second');}finally{first.resume();}await a;await b;
   assert.equal(count('workflow_versions',where(scope)),2);assert.equal(count('workflow_receipts',`receipt->'scope'=${json(scope)}`),1);
  });
  await test('concurrent identical workflow request appends once and replays once',async()=>{
   const scope=await initialized(202),request={credential,scope,requestId:'same-request',expectedRevision:0,intent:source()};
   const first=paused('workflow-replay-first',text=>text.startsWith('INSERT INTO design_private.workflow_versions'));
   const a=first.service.dispatch(request);await ready(first,a);const b=composition({application:'workflow-replay-second'}).service.dispatch(request);
   try{await blocked('workflow-replay-second');}finally{first.resume();}assert.equal((await a).replayed,false);assert.equal((await b).replayed,true);assert.equal(count('workflow_versions',where(scope)),2);
  });
  await test('native group identity, explicit confirmation, plan/actual and archive/reopen survive DB restart',async()=>{
   const scope=await initialized(203),s=(await send(source(),scope)).record.session.sources.at(-1);await advance(scope,'proposal');
   const g=(await send({type:'create_group',zone:'top',service:'perm',side:'left'},scope)).record.session.entries.at(-1);
   const intent={type:'record_technique',groupId:g.groupId,field:'rod_type',track:'planned',value:'合成杠甲',sourceId:s.messageId,quote:s.text,replacesEntryId:g.id};
   const entry=(await send(intent,scope)).record.session.entries.at(-1);await send({type:'confirm_entry',entryId:entry.id,text:'【合成测试】本人确认合成杠甲。'},scope);
   await advance(scope,'execution');await send({...intent,track:'actual',value:'合成杠乙',replacesEntryId:null},scope);await advance(scope,'completed_review');await send({type:'record_note',field:'care',text:'【合成测试】原始护理说明'},scope);await send({type:'archive'},scope);
   const before=(await load(scope)).record;const first=await app.full.append(await archiveRequest(scope));
   await send({type:'reopen',resumePhase:'completed_review',reason:'【合成测试】追加说明'},scope);await send(source('【合成测试】原始补充'),scope);await send({type:'archive'},scope);
   const second=await app.full.append(await archiveRequest(scope));app=composition();const after=(await load(scope)).record,chain=await app.repositories.loadFullArchive({credential,scope});
   assert.deepEqual(after.archives[0],before.archives[0]);assert.equal(after.archives.length,2);assert.equal(chain.currentVersion,2);assert.equal(second.version.previous.sha256,first.version.sha256);
   const view=getDesignView(after.session);assert.equal(view.entries.find(e=>e.track==='planned').status,'confirmed');assert.equal(view.entries.find(e=>e.track==='actual').status,'not_confirmed');assert.equal(view.entries.find(e=>e.track==='actual').value,'合成杠乙');
  });
  await test('full archive independently rejects self-consistent fabricated source and stale fresh checkpoint',async()=>{
   const scope=await initialized(204),request=await archiveRequest(scope),parts=copy(unpackFullWorkflowSnapshot(request.snapshot));
   parts.evidence.session=appendDesignEvent(parts.evidence.session,{requestId:'forged-source',expectedRevision:0,scope:parts.evidence.session.scope,event:{type:'source_recorded',source:{messageId:'forged',kind:'text',actor:'employee',text:'【合成测试】从未存入权威记录'}}}).session;
   await rejects(app.full.append({...request,snapshot:createFullWorkflowSnapshot(parts)}),'FULL_SOURCE_SNAPSHOT_DENIED');
   await send(source(),scope);await rejects(app.full.append(request),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(count('full_versions',where(scope)),0);
  });
  await test('full archive exact historical replay remains original after newer workflow and archive heads',async()=>{
   const scope=await initialized(205),request=await archiveRequest(scope),first=await app.full.append(request);await send(source(),scope);await app.full.append(await archiveRequest(scope));
   const replay=await app.full.append(request);assert.equal(replay.replayed,true);assert.deepEqual(replay.version,first.version);assert.equal(replay.observedHeadVersion,2);
   await rejects(app.full.append({...request,scope:scopeB,snapshot:(await app.service.snapshot({credential,scope:scopeB})).snapshot}),'FULL_REQUEST_CONFLICT');
  });
  await test('concurrent full archive CAS has one append and one atomic immutable receipt',async()=>{
   const scope=await initialized(206),request=await archiveRequest(scope),first=paused('full-cas-first',text=>text.startsWith('INSERT INTO design_private.full_versions'));
   const a=first.full.append(request);await ready(first,a);const b=rejects(composition({application:'full-cas-second'}).full.append({...request,requestId:'different-full-request'}),'FULL_VERSION_CONFLICT');
   try{await blocked('full-cas-second');}finally{first.resume();}await a;await b;assert.equal(count('full_versions',where(scope)),1);assert.equal(count('full_receipts',`receipt->'scope'=${json(scope)}`),1);
  });
  await test('concurrent identical full archive request returns one original version',async()=>{
   const scope=await initialized(207),request=await archiveRequest(scope),first=paused('full-replay-first',text=>text.startsWith('INSERT INTO design_private.full_versions'));
   const a=first.full.append(request);await ready(first,a);const b=composition({application:'full-replay-second'}).full.append(request);
   try{await blocked('full-replay-second');}finally{first.resume();}const saved=await a,replay=await b;assert.equal(replay.replayed,true);assert.deepEqual(replay.version,saved.version);assert.equal(count('full_versions',where(scope)),1);
  });
  await test('failure after workflow receipt insert rolls back record and receipt together',async()=>{
   const scope=await initialized(208),request={credential,scope,requestId:'rollback-workflow',expectedRevision:0,intent:source()};
   const bad=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.workflow_receipts'))throw Error('synthetic post-insert failure');}});
   await rejects(bad.service.dispatch(request),'WORKFLOW_OUTCOME_UNCERTAIN');assert.equal(count('workflow_versions',where(scope)),1);assert.equal(count('workflow_receipts',`receipt->'scope'=${json(scope)}`),0);assert.equal((await app.service.dispatch(request)).replayed,false);
  });
  await test('failure after full receipt insert rolls back full chain and receipt together',async()=>{
   const scope=await initialized(209),request=await archiveRequest(scope),bad=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.full_receipts'))throw Error('synthetic post-insert failure');}});
   await rejects(bad.full.append(request),'FULL_OUTCOME_UNCERTAIN');assert.equal(count('full_versions',where(scope)),0);assert.equal(count('full_receipts',`receipt->'scope'=${json(scope)}`),0);
  });
  await test('lost actual workflow COMMIT acknowledgment is uncertain and exact retry reconciles once',async()=>{
   const scope=await initialized(210),request={credential,scope,requestId:'lost-workflow-ack',expectedRevision:0,intent:source()};let wrote=false,commits=0;
   const uncertain=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.workflow_versions'))wrote=true;if(wrote&&text==='COMMIT'){commits++;throw Error('lost ACK');}}});
   await assert.rejects(uncertain.service.dispatch(request),e=>e.code==='WORKFLOW_OUTCOME_UNCERTAIN'&&e.outcome==='uncertain'&&e.retryable===false);assert.equal(commits,1);assert.equal(count('workflow_versions',where(scope)),2);assert.equal((await app.service.dispatch(request)).replayed,true);assert.equal(count('workflow_versions',where(scope)),2);
  });
  await test('lost actual full COMMIT acknowledgment is uncertain and exact readback returns one version',async()=>{
   const scope=await initialized(211),request=await archiveRequest(scope);let wrote=false;
   const uncertain=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.full_versions'))wrote=true;if(wrote&&text==='COMMIT')throw Error('lost ACK');}});
   await assert.rejects(uncertain.full.append(request),e=>e.code==='FULL_OUTCOME_UNCERTAIN'&&e.outcome==='uncertain'&&e.retryable===false);assert.equal(count('full_versions',where(scope)),1);assert.equal((await app.full.append(request)).replayed,true);
  });
  await test('active private-media metadata attaches with exact reference/detail fields and survives restart',async()=>{
   const scope=await initialized(212);media(scope,'synthetic-detail');const result=await send({type:'attach_media',mediaIds:['synthetic-detail']},scope);
   assert.equal(result.record.photoRefs[0].reference.stage,'reference');assert.equal(result.record.photoRefs[0].reference.angle,'detail');app=composition();assert.deepEqual((await load(scope)).record,result.record);await app.full.append(await archiveRequest(scope));
   await rejects(send({type:'attach_media',mediaIds:['synthetic-detail']},scopeB),'WORKFLOW_MEDIA_DENIED');
  });
  await test('revoked media blocks workflow load, replay, snapshot and full archive replay',async()=>{
   const scope=await initialized(213),record=media(scope,'synthetic-revoke'),request={credential,scope,requestId:'media-attach-revoke',expectedRevision:0,intent:{type:'attach_media',mediaIds:[record.mediaId]}};
   await app.service.dispatch(request);const full=await archiveRequest(scope);await app.full.append(full);
   f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(record.mediaId)};`);
   for(const operation of [()=>load(scope),()=>app.service.snapshot({credential,scope}),()=>app.service.dispatch(request)])await rejects(operation(),'WORKFLOW_MEDIA_DENIED');
   await rejects(app.full.append(full),'FULL_BINDING_DENIED');
   assert.throws(()=>f.sql(`update design_private.media_access set active=true,revision=revision+1 where media_id=${quote(record.mediaId)};`),e=>String(e.stderr).includes('DESIGN_MEDIA_REVOCATION_ONLY'));
  });
  await test('media revocation committed first blocks real row lock then denies attachment without writes',async()=>{
   const scope=await initialized(214),record=media(scope,'synthetic-lock-revoke'),mutator=f.client('media-revoker');try{
    await mutator.query('BEGIN');await mutator.query('UPDATE design_private.media_access SET active=false,revision=revision+1 WHERE media_id=$1 RETURNING media_id',[record.mediaId]);
    const denied=rejects(composition({application:'media-revoked-workflow'}).service.dispatch({credential,scope,requestId:'blocked-media',expectedRevision:0,intent:{type:'attach_media',mediaIds:[record.mediaId]}}),'WORKFLOW_MEDIA_DENIED');
    await blocked('media-revoked-workflow');await mutator.query('COMMIT');await denied;assert.equal(count('workflow_versions',where(scope)),1);
   }finally{await mutator.release();}
  });
  await test('session revocation committed first denies workflow after actual PostgreSQL lock contention',async()=>{
   const scope=await initialized(215),mutator=f.client('session-revoker');try{
    await mutator.query('BEGIN');await mutator.query("UPDATE public.employee_booking_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1 RETURNING token_hash",[hash(credential)]);
    const denied=rejects(composition({application:'session-revoked-workflow'}).service.dispatch({credential,scope,requestId:'revoked-session',expectedRevision:0,intent:source()}),'WORKFLOW_ACCESS_DENIED');
    await blocked('session-revoked-workflow');await mutator.query('COMMIT');await denied;assert.equal(count('workflow_versions',where(scope)),1);
   }finally{await mutator.release();f.session('alice');}
  });
  await test('explicit lifecycle revocation and source reassignment deny fresh workflow/full access',async()=>{
   const scope=await initialized(216),request=await archiveRequest(scope);await app.full.append(request);
   f.sql(`update design_private.lifecycle_decisions set allowed=false where visit_id=${quote(scope.visitId)};`);
   await rejects(load(scope),'WORKFLOW_ACCESS_DENIED');await rejects(app.full.append(request),'FULL_ACCESS_DENIED');
   f.lifecycle(f.sourceRow(216));f.sql('update public.bookings set barber_name=\'bob\' where id=216;');await rejects(load(scope),'WORKFLOW_ACCESS_DENIED');
  });
  await test('append-first source lock holds reassignment until commit and final authorization withholds stale result',async()=>{
   const scope=await initialized(217),first=paused('workflow-lock-holder',text=>text.startsWith('INSERT INTO design_private.workflow_versions'));
   const a=first.service.dispatch({credential,scope,requestId:'append-before-reassign',expectedRevision:0,intent:source()});const result=a.catch(e=>e);await ready(first,a);const mutator=f.client('waiting-reassigner');try{
    await mutator.query('BEGIN');const update=mutator.query("UPDATE public.bookings SET barber_name='bob' WHERE id=$1 RETURNING id",[217]);try{await blocked('waiting-reassigner');}finally{first.resume();}await update;await mutator.query('COMMIT');
    const outcome=await result;assert.equal(outcome.code,'WORKFLOW_OUTCOME_UNCERTAIN');assert.equal(count('workflow_versions',where(scope)),2);await rejects(load(scope),'WORKFLOW_ACCESS_DENIED');
   }finally{first.resume();await mutator.release();}
  });
  await test('database deferred authority deadline rejects final JS-to-COMMIT expiry and rolls back all workflow rows',async()=>{
   const scope=await initialized(218),expiry=Date.now()+10000;f.lifecycle(f.sourceRow(218),{expires_at:new Date(expiry).toISOString()});let wrote=false,delayed=false;
   const bad=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.workflow_versions'))wrote=true;},async beforeQuery(text){if(wrote&&text==='COMMIT'&&!delayed){assert(Date.now()<expiry);delayed=true;await sleep(expiry-Date.now()+100);}}});
   await rejects(bad.service.dispatch({credential,scope,requestId:'deadline-expiry',expectedRevision:0,intent:source()}),'WORKFLOW_OUTCOME_UNCERTAIN');assert.equal(delayed,true);assert.equal(count('workflow_versions',where(scope)),1);assert.equal(count('workflow_receipts',`receipt->'scope'=${json(scope)}`),0);
  });
  await test('every persisted workflow/full/media record and receipt is append-only at database boundary',async()=>{
   for(const table of ['workflow_versions','workflow_receipts','full_versions','full_receipts','media_records']){
    assert(count(table)>0);for(const operation of [`delete from design_private.${table}`,`update design_private.${table} set ${table.includes('receipts')?'receipt=receipt':'record=record'}`])assert.throws(()=>f.sql(operation+';'),e=>String(e.stderr).includes('DESIGN_APPEND_ONLY'));
   }
   assert.throws(()=>f.sql('delete from design_private.media_access;'),e=>String(e.stderr).includes('DESIGN_MEDIA_REVOCATION_ONLY'));
  });
  await test('self-consistent rewritten workflow history cannot bypass original immutable intent replay',async()=>{
   const scope=await initialized(219);await send(source('【合成测试】可信原话'),scope);
   const original=JSON.parse(f.sql(`select record from design_private.workflow_versions where ${where(scope)} and revision=0;`));
   const forged=copy((await load(scope)).record);forged.session=appendDesignEvent(original.session,{requestId:forged.session.journal[0].requestId,expectedRevision:0,scope:original.session.scope,event:{type:'source_recorded',source:{...forged.session.sources[0],text:'【合成测试】篡改且重算摘要'}}}).session;
   // Privileged fixture corruption is intentional: prove hashes alone do not authenticate a source.
   f.sql(`alter table design_private.workflow_versions disable trigger workflow_versions_immutable;alter table design_private.workflow_receipts disable trigger workflow_receipts_immutable;
    update design_private.workflow_versions set record=${json(forged)},sha256=${quote(digest(forged))} where ${where(scope)} and revision=1;
    update design_private.workflow_receipts set record_sha256=${quote(digest(forged))} where receipt->'scope'=${json(scope)};
    alter table design_private.workflow_versions enable trigger workflow_versions_immutable;alter table design_private.workflow_receipts enable trigger workflow_receipts_immutable;`);
   await rejects(load(scope),'WORKFLOW_OUTCOME_UNCERTAIN');
  });
  await test('missing workflow receipt and altered full receipt fail closed instead of authorizing hash-only records',async()=>{
   const scope=await initialized(220);await send(source(),scope);const request=await archiveRequest(scope);await app.full.append(request);
   f.sql(`alter table design_private.full_receipts disable trigger full_receipts_immutable;update design_private.full_receipts set receipt=jsonb_set(receipt,'{fingerprint}',to_jsonb(repeat('0',64))) where receipt->'scope'=${json(scope)};alter table design_private.full_receipts enable trigger full_receipts_immutable;`);
   await rejects(app.full.append(request),'FULL_OUTCOME_UNCERTAIN');
   f.sql(`alter table design_private.workflow_receipts disable trigger workflow_receipts_immutable;delete from design_private.workflow_receipts where receipt->'scope'=${json(scope)};alter table design_private.workflow_receipts enable trigger workflow_receipts_immutable;`);
   await rejects(load(scope),'WORKFLOW_OUTCOME_UNCERTAIN');
  });
  await test('initialization accepts only credential and authorized scope, never client-authored records',async()=>{
   const scope=await f.seedSource(221);
   assert.throws(()=>app.repositories.initializeWorkflow({credential,scope,record:{actor:'forged'}}),e=>e.code==='PG_WORKFLOW_INVALID');
   assert.equal(count('workflow_versions',where(scope)),0);
  });
  await test('post-COMMIT media revocation withholds workflow success while preserving one committed revision',async()=>{
   const scope=await initialized(222),record=media(scope,'synthetic-postcommit-workflow');let wrote=false,revoked=false;
   const changed=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.workflow_versions'))wrote=true;if(wrote&&text==='COMMIT'&&!revoked){revoked=true;f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(record.mediaId)};`);}}});
   await rejects(changed.service.dispatch({credential,scope,requestId:'postcommit-media',expectedRevision:0,intent:{type:'attach_media',mediaIds:[record.mediaId]}}),'WORKFLOW_OUTCOME_UNCERTAIN');
   assert.equal(revoked,true);assert.equal(count('workflow_versions',where(scope)),2);await rejects(load(scope),'WORKFLOW_MEDIA_DENIED');
  });
  await test('post-COMMIT media revocation withholds full archive success and subsequent load',async()=>{
   const scope=await initialized(223),record=media(scope,'synthetic-postcommit-full');await send({type:'attach_media',mediaIds:[record.mediaId]},scope);const request=await archiveRequest(scope);let wrote=false,revoked=false;
   const changed=composition({afterQuery(text){if(text.startsWith('INSERT INTO design_private.full_versions'))wrote=true;if(wrote&&text==='COMMIT'&&!revoked){revoked=true;f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id=${quote(record.mediaId)};`);}}});
   await rejects(changed.full.append(request),'FULL_OUTCOME_UNCERTAIN');assert.equal(revoked,true);assert.equal(count('full_versions',where(scope)),1);await assert.rejects(app.repositories.loadFullArchive({credential,scope}));
  });
  let legacyFixture;
  await test('nonempty actual legacy RPC versions and scoped asset initialize losslessly without rewriting raw rows',async()=>{
   const scope=await f.seedSource(224),context={customer_profile_id:11,booking_id:224,booking_date:f.sourceRow(224).bookingDate,visit_key:scope.visitId},assetId=randomUUID();
   const steps=['style','person','length','features','layers','bangs','curls','care'];
   function snapshot(number){
    const model=label=>({outline:`合成${label}轮廓${number}`,root_flow:`合成${label}发根${number}`,steps:Object.fromEntries(steps.map(field=>[field,`合成${label}${field}${number}`]))});
    return {baseline:model('原案'),optimized:model('改案'),reasons:Object.fromEntries(['outline','root_flow',...steps].map(field=>[field,`合成理由${field}${number}`])),
     execution:Object.fromEntries(['bangs','top','ear_front','ear_back','middle','bottom'].map(zone=>[zone,Object.fromEntries(['issue','target','actions','check'].map(field=>[field,`合成${zone}${field}${number}`]))])),
     process:Object.fromEntries(['care_texture','styling','style_feel','application','winding','rod_direction','curl_control','thinning_space','proposal','technique_layers'].map(field=>[field,`合成工序${field}${number}`])),
     review:{achieved:`合成已达成${number}`,pending:`合成待检${number}`,next:`合成下次${number}`},status:number===1?'completed':'followup',photo_ids:[assetId],archive_url:null};
   }
   const assetPayload={...context,id:assetId,request_id:randomUUID(),stage:'before',angle:'front',bucket:'customer-design-photos',path:`11/synthetic-stage7/${assetId}.png`,mime_type:'image/png',byte_size:123,sha256:hash('synthetic-legacy-metadata-only'),filename:'synthetic-legacy-private-original.png',caption:'合成旧档案原图元数据'};
   const writer=f.client('legacy-initial-writer');const versions=[];let asset;
   try{
    asset=(await writer.query('SELECT public.register_customer_design_asset($1::jsonb,$2::text,$3::text) AS result',[assetPayload,'alice','manual'])).rows[0].result.asset;
    for(const number of [1,2]){
     const result=(await writer.query('SELECT public.append_customer_design_version($1::jsonb,$2::text,$3::text) AS result',[{...context,...snapshot(number),request_id:randomUUID(),expected_latest_version_id:versions.at(-1)?.id??null},number===1?'bob':'alice','manual'])).rows[0].result;
     assert.equal(result.saved,true);assert.equal(result.already_applied,false);versions.push(result.version);
    }
   }finally{await writer.release();}
   const publicVersion=v=>({id:v.id,requestId:v.request_id,versionNumber:v.version_no,previousVersionId:v.previous_version_id,createdAt:v.created_at,actor:{username:v.author,store:v.store},scope,
    snapshot:{...Object.fromEntries(['baseline','optimized','reasons','execution','process','review','status','photo_ids'].map(key=>[key,v[key]])),archive_url:null}});
   const rawVersions=()=>f.sql(`select jsonb_agg(to_jsonb(v) order by version_no) from public.customer_design_versions v where customer_profile_id=11 and visit_key=${quote(scope.visitId)};`);
   const rawAsset=()=>f.sql(`select to_jsonb(a) from public.customer_design_assets a where id=${quote(assetId)}::uuid;`);
   const beforeVersions=rawVersions(),beforeAsset=rawAsset(),expected=versions.map(publicVersion);
   assert.deepEqual(expected.map(v=>v.snapshot),[snapshot(1),snapshot(2)],'real RPC persisted every populated legacy field');
   const record=await app.repositories.initializeWorkflow({credential,scope});assert.deepEqual(record.legacyVersions,expected);assert.deepEqual(record.legacyVersions.map(v=>v.actor.username),['bob','alice']);assert.deepEqual(record.photoRefs,[{kind:'legacy_asset',assetId,scope,store,stage:'before',angle:'front'}]);
   await send(source('【合成测试】旧档案初始化后的原生记录'),scope);
   const candidate=await app.service.snapshot({credential,scope});assert.deepEqual(candidate.snapshot.legacyVersions,expected);assert.deepEqual(candidate.snapshot.photoRefs,record.photoRefs);
   const full=await app.full.append(await archiveRequest(scope));assert.deepEqual(full.version.snapshot.legacyVersions,expected);
   assert.equal(rawVersions(),beforeVersions,'initialization/full persistence must not rewrite original complete SQL rows');assert.equal(rawAsset(),beforeAsset,'original complete asset metadata stays unchanged');
   const banned=new Set(['request_hash','bucket','path','filename','phone','customer_phone']);
   function publicOnly(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){assert(!banned.has(key),`private legacy field ${key} not exposed`);publicOnly(child);}}
   publicOnly(candidate.snapshot.legacyVersions);publicOnly(candidate.snapshot.photoRefs);
   const exposed=JSON.stringify(candidate.snapshot);for(const value of [asset.bucket,asset.path,asset.filename,'13000000000',...JSON.parse(beforeVersions).map(v=>v.request_hash)])assert(!exposed.includes(value),'private storage/contact/hash values absent from complete public snapshot');
   legacyFixture={scope,context,snapshot,versions,beforeVersions,beforeAsset,rawVersions,rawAsset};
  });
  await test('independent third legacy RPC append makes current prepared workflow fail closed without new writes or rewritten history',async()=>{
   assert(legacyFixture,'nonempty legacy fixture initialized');const {scope,context,snapshot,versions,beforeVersions,beforeAsset,rawVersions,rawAsset}=legacyFixture;
   const stored=table=>f.sql(`select coalesce(jsonb_agg(to_jsonb(v) order by ${table==='full_versions'?'version':'revision'}),'[]'::jsonb) from design_private.${table} v where ${where(scope)};`);
   const receipts=table=>f.sql(`select coalesce(jsonb_agg(to_jsonb(r) order by request_key),'[]'::jsonb) from design_private.${table} r where receipt->'scope'=${json(scope)};`);
   const staleFullRequest=await archiveRequest(scope),currentRevision=(await load(scope)).record.revision;
   const beforeWorkflow=stored('workflow_versions'),beforeFull=stored('full_versions'),beforeWorkflowReceipts=receipts('workflow_receipts'),beforeFullReceipts=receipts('full_receipts');
   assert.equal(JSON.parse(beforeWorkflowReceipts).length,1);assert.equal(JSON.parse(beforeFullReceipts).length,1);
   const independent=f.client('legacy-independent-third-writer');try{
    const result=(await independent.query('SELECT public.append_customer_design_version($1::jsonb,$2::text,$3::text) AS result',[{...context,...snapshot(3),request_id:randomUUID(),expected_latest_version_id:versions[1].id},'alice','manual'])).rows[0].result;
    assert.equal(result.saved,true);assert.equal(result.version.version_no,3);assert.equal(result.version.previous_version_id,versions[1].id);
   }finally{await independent.release();}
   await rejects(app.repositories.initializeWorkflow({credential,scope}),'PG_LEGACY_SOURCE_CHANGED');
   await rejects(load(scope),'WORKFLOW_OUTCOME_UNCERTAIN');
   await rejects(app.service.snapshot({credential,scope}),'WORKFLOW_OUTCOME_UNCERTAIN');
   await rejects(app.service.dispatch({credential,scope,requestId:'legacy-source-stale-write',expectedRevision:currentRevision,intent:source()}),'WORKFLOW_OUTCOME_UNCERTAIN');
   await rejects(app.full.append(staleFullRequest),'FULL_OUTCOME_UNCERTAIN');
   assert.equal(stored('workflow_versions'),beforeWorkflow);assert.equal(stored('full_versions'),beforeFull);assert.equal(receipts('workflow_receipts'),beforeWorkflowReceipts);assert.equal(receipts('full_receipts'),beforeFullReceipts);
   const after=JSON.parse(rawVersions());assert.equal(after.length,3);assert.deepEqual(after.slice(0,2),JSON.parse(beforeVersions));assert.equal(rawAsset(),beforeAsset);
  });
  await test('all actual repository values reach PostgreSQL bound parameters',async()=>{
   assert(f.observed.some(q=>q.parameterCount>0));assert(f.observed.every(q=>q.parameterCount===q.placeholderCount));
  });
  if(failures.length)throw new AggregateError(failures.map(f=>f.error),`${failures.length} failed integration checks: ${failures.map(f=>f.name).join('; ')}`);
  console.log(`PASS: ${passed} actual PG17 prepared-workflow/full-archive integration tests; synthetic data only.`);
 }finally{await f.cleanup();console.log('cleanup ok - exact labelled synthetic container absent');}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
