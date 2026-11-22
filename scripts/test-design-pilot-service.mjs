#!/usr/bin/env node
/** Synthetic fixture HTTP/persistence regression. No external endpoints or real identities. */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startSyntheticDesignService,SYNTHETIC_OPT_IN,UI_SYNTHETIC_ACTOR,createSyntheticMemoryStorageAdapter} from '../packages/design-pilot-service/server.mjs';
import * as uiContract from '../packages/analysis-engine/design-pilot-ui-draft.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'design-pilot-service-test-'));
const dataDir=path.join(directory,'fixture-store');
let service,checks=0,denied=false,fault=null,revokeAtCommit=false,sequence=0;
const passed=label=>{checks++;console.log('PASS '+label);};
const options={optIn:SYNTHETIC_OPT_IN,dataDir,uiRoot:repo,relationshipAllowed:()=>!denied,fault:async stage=>{if(stage==='after-temp-sync'&&revokeAtCommit){revokeAtCommit=false;denied=true;}if(stage===fault){fault=null;throw new Error('Synthetic injected storage interruption');}}};
const scope={customerId:'demo-customer-a',visitId:'demo-visit-a',sessionId:'fixture-session-a'};
const createBody={requestId:'create-a',...scope};
function send(method,pathname,body,settings={}){
  return new Promise((resolve,reject)=>{
    const bytes=settings.raw===undefined?(body===undefined?null:Buffer.from(JSON.stringify(body))):Buffer.from(settings.raw);
    const url=new URL(service.url);
    const headers={'x-design-pilot-actor':'demo-stylist-a',...(bytes?{'content-type':'application/json','content-length':bytes.length}:{}),...(settings.headers||{})};
    if(settings.actor===null)delete headers['x-design-pilot-actor'];else if(settings.actor)headers['x-design-pilot-actor']=settings.actor;
    const request=http.request(url,{method,headers,path:pathname},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
        resolve({status:response.statusCode,headers:response.headers,body:json,text});
      });
    });request.on('error',reject);if(bytes)request.write(bytes);request.end();
  });
}
function error(result,code,status){assert.equal(result.status,status);assert.equal(result.body.ok,false);assert.equal(result.body.error.code,code);}
async function expectThrows(operation,code){await assert.rejects(operation,error=>error.code===code);}
const source=(id,text='【合成测试】只用于本地流程验证。')=>({type:'source_recorded',source:{messageId:id,kind:'text',actor:'employee',text}});
let session;
async function append(event,id){
  const result=await send('POST','/api/sessions/'+scope.sessionId+'/events',{requestId:id||'event-'+(++sequence),expectedRevision:session.revision,scope,event});
  assert.equal(result.status,200,JSON.stringify(result.body));session=result.body.session;return result;
}
async function get(){const result=await send('GET','/api/sessions/'+scope.sessionId);assert.equal(result.status,200);return result.body.session;}
const content=()=>fs.readFile(path.join(dataDir,'store.json'),'utf8');

try{
  await expectThrows(()=>startSyntheticDesignService({dataDir}),'OPT_IN_REQUIRED');
  await expectThrows(()=>startSyntheticDesignService({...options,host:'0.0.0.0'}),'LOOPBACK_ONLY');
  await expectThrows(()=>startSyntheticDesignService({...options,port:-1}),'INVALID_PORT');
  const production=spawnSync(process.execPath,['packages/design-pilot-service/cli.mjs','--enable-synthetic-pilot','--data-dir',path.join(directory,'production')],{cwd:repo,env:{...process.env,NODE_ENV:'production'},encoding:'utf8'});
  assert.equal(production.status,1);assert.match(production.stderr,/PRODUCTION_DISABLED/);
  const noOptIn=spawnSync(process.execPath,['packages/design-pilot-service/cli.mjs','--data-dir',path.join(directory,'cli-no-opt')],{cwd:repo,encoding:'utf8'});
  assert.equal(noOptIn.status,1);assert.match(noOptIn.stderr,/OPT_IN_REQUIRED/);
  passed('explicit opt-in, production refusal, loopback-only and CLI guards');

  service=await startSyntheticDesignService(options);
  assert.equal(new URL(service.url).hostname,'127.0.0.1');
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_LOCKED');
  passed('exclusive lifetime store lock prevents a second writer');
  const symlinkDir=path.join(directory,'symlink-dir');await fs.symlink(dataDir,symlinkDir);
  await expectThrows(()=>startSyntheticDesignService({...options,dataDir:symlinkDir}),'UNSAFE_DIRECTORY');
  passed('symlink directory refused');

  const demo=await send('GET','/api/demo');assert.equal(demo.status,200);assert.equal(demo.body.actors.length,2);
  assert.equal(demo.body.mode,'synthetic-only');assert.match(demo.body.warning,/not authentication/);
  error(await send('GET','/api/demo',undefined,{actor:null}),'SYNTHETIC_ACTOR_REQUIRED',401);
  error(await send('GET','/api/demo',undefined,{actor:'owner'}),'SYNTHETIC_ACTOR_REQUIRED',401);
  error(await send('GET','/api/demo',undefined,{headers:{authorization:'Bearer synthetic-placeholder'}}),'CREDENTIALS_FORBIDDEN',400);
  passed('only fixed synthetic actors and explicit no-authentication disclosure');
  const host=new URL(service.url).host;
  error(await send('GET','/api/demo',undefined,{headers:{host:'evil.invalid:'+new URL(service.url).port}}),'HOST_REJECTED',403);
  error(await send('GET','/api/demo',undefined,{headers:{origin:'https://example.invalid'}}),'ORIGIN_REJECTED',403);
  error(await send('GET','/api/demo',undefined,{headers:{origin:'null'}}),'ORIGIN_REJECTED',403);
  error(await send('GET','/api/demo',undefined,{headers:{'sec-fetch-site':'cross-site'}}),'ORIGIN_REJECTED',403);
  error(await send('OPTIONS','/api/demo'),'METHOD_NOT_ALLOWED',405);
  assert.equal((await send('GET','/api/demo',undefined,{headers:{origin:service.url,host}})).status,200);
  passed('Host/Origin/fetch-site checks reject DNS-rebinding and cross-site request surfaces');

  error(await send('POST','/api/sessions',{...createBody,owner:'owner'}),'INVALID_FIELDS',400);
  error(await send('POST','/api/sessions',{...createBody,customerId:'real-customer'}),'FORBIDDEN',403);
  error(await send('POST','/api/sessions',{...createBody,sessionId:'../outside'}),'INVALID_ID',400);
  error(await send('POST','/api/sessions',{...createBody,sessionId:'__proto__'}),'INVALID_ID',400);
  error(await send('POST','/api/sessions',undefined,{raw:'{broken'}),'INVALID_JSON',400);
  error(await send('POST','/api/sessions',createBody,{headers:{'content-type':'image/png'}}),'JSON_REQUIRED',415);
  error(await send('POST','/api/sessions',createBody,{headers:{'content-encoding':'gzip'}}),'ENCODING_FORBIDDEN',415);
  passed('strict creation schema rejects spoofed owner, real scope, paths, malformed JSON and binary uploads');

  const created=await send('POST','/api/sessions',createBody);assert.equal(created.status,200);session=created.body.session;
  assert.equal(session.revision,0);assert.equal(session.schemaVersion,'design-pilot-local-v2');
  const initialBytes=await content();
  const createRetry=await send('POST','/api/sessions',createBody);assert.equal(createRetry.body.replayed,true);assert.equal(await content(),initialBytes);
  error(await send('POST','/api/sessions',{...createBody,sessionId:'changed-session'}),'IDEMPOTENCY_CONFLICT',409);
  assert.equal(await content(),initialBytes);
  passed('durable session creation and exact idempotent retry without rewriting the store');

  error(await send('GET','/api/sessions/'+scope.sessionId,undefined,{actor:'demo-stylist-b'}),'FORBIDDEN',403);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{requestId:'cross-owner',expectedRevision:0,scope,event:source('cross-owner-source')},{actor:'demo-stylist-b'}),'FORBIDDEN',403);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{requestId:'scope-forged',expectedRevision:0,scope:{...scope,visitId:'demo-visit-b'},event:source('scope-forged-source')}),'FORBIDDEN',403);
  assert.equal(await content(),initialBytes);
  passed('every session read/write checks service relationship and ignores client scope grants');

  const invalidBase={requestId:'bad-payload',expectedRevision:0,scope};
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...invalidBase,event:source('bad-prefix','不是合成标识')}),'SYNTHETIC_SOURCE_ONLY',400);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...invalidBase,event:{type:'source_recorded',source:{messageId:'image',kind:'image_description',actor:'employee',text:'【合成测试】图像描述'}}}),'SYNTHETIC_SOURCE_ONLY',400);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...invalidBase,event:source('data-image','【合成测试】data:image/png;base64,abcd')}),'UNSAFE_PAYLOAD',400);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...invalidBase,event:source('bare-base64','【合成测试】'+'a'.repeat(300))}),'UNSAFE_PAYLOAD',400);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...invalidBase,event:source('fake-key','【合成测试】sk-syntheticNOTArealKey123456789')}),'UNSAFE_PAYLOAD',400);
  error(await send('POST','/api/sessions',undefined,{raw:'x'.repeat(128*1024+1)}),'PAYLOAD_LIMIT',413);
  assert.equal(await content(),initialBytes);
  passed('no image/audio/model source, data URLs, large encoded payloads or credential-like values');

  const firstRequest={requestId:'source-first',expectedRevision:0,scope,event:source('source-first','【合成测试】刘海左侧A组使用虚构杠A；刘海右侧B组使用虚构杠B。')};
  let result=await send('POST','/api/sessions/'+scope.sessionId+'/events',firstRequest);assert.equal(result.status,200);session=result.body.session;
  await append(source('source-second'));
  result=await send('POST','/api/sessions/'+scope.sessionId+'/events',firstRequest);assert.equal(result.status,200);assert.equal(result.body.replayed,true);assert.equal(result.body.appliedRevision,1);assert.equal(result.body.session.revision,2);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{...firstRequest,event:source('changed-source')}),'IDEMPOTENCY_CONFLICT',409);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{requestId:'old-revision',expectedRevision:0,scope,event:source('old-source')}),'REVISION_CONFLICT',409);
  passed('event retries after later writes return original applied revision plus latest session; changed retries and stale CAS conflict');

  const parallelRevision=session.revision;
  const competing=['one','two'].map(suffix=>({requestId:'parallel-'+suffix,expectedRevision:parallelRevision,scope,event:source('parallel-source-'+suffix)}));
  const races=await Promise.all(competing.map(body=>send('POST','/api/sessions/'+scope.sessionId+'/events',body)));
  assert.deepEqual(races.map(item=>item.status).sort(),[200,409]);session=await get();assert.equal(session.revision,parallelRevision+1);
  const loser=races.findIndex(item=>item.status===409);const retried=await send('POST','/api/sessions/'+scope.sessionId+'/events',{...competing[loser],expectedRevision:session.revision});assert.equal(retried.status,200);session=retried.body.session;
  const sameRequest={requestId:'parallel-same',expectedRevision:session.revision,scope,event:source('parallel-same-source')};
  const same=await Promise.all([send('POST','/api/sessions/'+scope.sessionId+'/events',sameRequest),send('POST','/api/sessions/'+scope.sessionId+'/events',sameRequest)]);
  assert.ok(same.every(item=>item.status===200));assert.deepEqual(same.map(item=>item.body.replayed).sort(),[false,true]);session=await get();
  passed('concurrent distinct writes serialize with one CAS winner; concurrent identical requests append once');

  await append({type:'phase_advanced',phase:'proposal'});
  const entry=(id,groupId,side,value)=>({id,category:'technique',field:'rod_type',zone:'bangs',groupId,service:'perm',side,track:'planned',origin:'extraction',basis:'said',value,status:'not_confirmed',sources:[{messageId:'source-first',quote:'刘海左侧A组使用虚构杠A；刘海右侧B组使用虚构杠B。'}],replacesEntryId:null});
  await append({type:'entry_recorded',entry:entry('entry-left-a','group-a','left','虚构杠A')});
  const groupResult=await append({type:'entry_recorded',entry:entry('entry-right-b','group-b','right','虚构杠B')});
  assert.equal(groupResult.body.view.zones.bangs.groups.length,2);
  assert.deepEqual(groupResult.body.view.zones.bangs.groups.map(group=>group.side).sort(),['left','right']);
  passed('v2 group/service/side survive real HTTP and durable projection without flattening');

  const beforeRevoke=await content();denied=true;
  error(await send('GET','/api/sessions/'+scope.sessionId),'RELATIONSHIP_REVOKED',403);
  error(await send('POST','/api/sessions',createBody),'RELATIONSHIP_REVOKED',403);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',firstRequest),'RELATIONSHIP_REVOKED',403);
  assert.equal(await content(),beforeRevoke);denied=false;
  passed('revocation checked on reads, original idempotent retries and new writes');
  revokeAtCommit=true;
  const lateRevocation={requestId:'revoked-before-rename',expectedRevision:session.revision,scope,event:source('late-revocation-source')};
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',lateRevocation),'RELATIONSHIP_REVOKED',403);
  assert.equal(await content(),beforeRevoke);denied=false;
  assert.equal((await get()).sources.some(item=>item.messageId==='late-revocation-source'),false);
  passed('relationship is rechecked immediately before atomic rename; in-flight revocation preserves original store');

  const beforeFailure=await content();fault='after-temp-sync';
  const interrupted={requestId:'interrupted-write',expectedRevision:session.revision,scope,event:source('interrupted-source')};
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',interrupted),'STORAGE_FAILURE',500);
  assert.equal(await content(),beforeFailure);assert.equal((await get()).revision,session.revision);
  result=await send('POST','/api/sessions/'+scope.sessionId+'/events',interrupted);assert.equal(result.status,200);assert.equal(result.body.replayed,false);session=result.body.session;
  assert.equal((await fs.readdir(dataDir)).filter(name=>name.endsWith('.tmp')).length,0);
  passed('interrupted temp write preserves original bytes and CAS; same request can safely retry');
  fault='after-rename';const lostAck={requestId:'lost-ack',expectedRevision:session.revision,scope,event:source('lost-ack-source')};
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',lostAck),'STORAGE_FAILURE',500);
  result=await send('POST','/api/sessions/'+scope.sessionId+'/events',lostAck);assert.equal(result.status,200);assert.equal(result.body.replayed,true);session=result.body.session;
  assert.equal(session.sources.filter(item=>item.messageId==='lost-ack-source').length,1);
  passed('uncertain post-rename response recovers by exact durable receipt without duplicate events');

  await append({type:'phase_advanced',phase:'execution'});await append({type:'phase_advanced',phase:'completed_review'});await append({type:'phase_advanced',phase:'archive'});
  const revisionRequest={requestId:'open-revision',expectedRevision:session.revision,scope,resumePhase:'proposal',reasonSource:{messageId:'revision-reason',kind:'text',actor:'employee',text:'【合成测试】归档后补充下一版，保留原档。'}};
  error(await send('POST','/api/sessions/'+scope.sessionId+'/revisions',revisionRequest),'ARCHIVE_REQUIRED',409);
  error(await send('POST','/api/sessions/'+scope.sessionId+'/events',{requestId:'bypass-revision',expectedRevision:session.revision,scope,event:{type:'revision_opened',parentArchiveRevision:session.revision,resumePhase:'proposal',reasonSource:revisionRequest.reasonSource}}),'UNSUPPORTED_EVENT',400);
  passed('phase=archive alone cannot reopen; direct revision event cannot bypass persisted checkpoint');
  const archiveRequest={requestId:'archive-first',expectedRevision:session.revision,scope};
  const firstArchiveResult=await send('POST','/api/sessions/'+scope.sessionId+'/archive',archiveRequest);assert.equal(firstArchiveResult.status,200);
  const firstArchive=structuredClone(firstArchiveResult.body.archive),archiveBytes=JSON.stringify(firstArchive);
  assert.equal((await send('POST','/api/sessions/'+scope.sessionId+'/archive',archiveRequest)).body.replayed,true);
  result=await send('POST','/api/sessions/'+scope.sessionId+'/archive',{...archiveRequest,requestId:'archive-same-checkpoint'});assert.equal(result.status,200);
  assert.equal((await send('GET','/api/sessions/'+scope.sessionId+'/archives')).body.archives.length,1);
  passed('archive checkpoint append is immutable, idempotent and deduplicated across request IDs');
  result=await send('POST','/api/sessions/'+scope.sessionId+'/revisions',revisionRequest);assert.equal(result.status,200);session=result.body.session;assert.equal(session.phase,'proposal');
  const prefix=firstArchive.archive.snapshot.journal;assert.deepEqual(session.journal.slice(0,prefix.length),prefix);
  result=await send('POST','/api/sessions/'+scope.sessionId+'/revisions',revisionRequest);assert.equal(result.body.replayed,true);
  await append(source('revised-source','【合成测试】刘海左侧A组改用虚构杠C。'));
  const correction={...entry('entry-left-c','group-a','left','虚构杠C'),sources:[{messageId:'revised-source',quote:'刘海左侧A组改用虚构杠C。'}],replacesEntryId:'entry-left-a'};
  await append({type:'entry_recorded',entry:correction});
  await append({type:'phase_advanced',phase:'execution'});await append({type:'phase_advanced',phase:'completed_review'});await append({type:'phase_advanced',phase:'archive'});
  result=await send('POST','/api/sessions/'+scope.sessionId+'/archive',{requestId:'archive-second',expectedRevision:session.revision,scope});assert.equal(result.status,200);
  const archives=(await send('GET','/api/sessions/'+scope.sessionId+'/archives')).body.archives;
  assert.equal(archives.length,2);assert.equal(JSON.stringify(archives[0]),archiveBytes);assert.notEqual(archives[0].sha256,archives[1].sha256);
  passed('same-session revision links exact parent, preserves journal/old archive and appends a distinct new archive');

  const beforeRestart=await content();await service.close();service=null;
  await fs.writeFile(path.join(dataDir,'.store-interrupted-fixture.tmp'),'{incomplete synthetic temp');
  service=await startSyntheticDesignService(options);
  assert.equal(await content(),beforeRestart);assert.deepEqual(await get(),session);
  assert.equal((await send('GET','/api/sessions/'+scope.sessionId+'/archives')).body.archives.length,2);
  assert.equal((await send('POST','/api/sessions/'+scope.sessionId+'/events',firstRequest)).body.replayed,true);
  passed('restart restores sessions, archives and idempotency while ignoring incomplete uncommitted temp files');

  error(await send('GET','/api/sessions/toString'),'SESSION_NOT_FOUND',404);
  error(await send('GET','/store.json'),'NOT_FOUND',404);
  error(await send('GET','/packages/design-pilot-service/server.mjs'),'NOT_FOUND',404);
  error(await send('GET','/%2e%2e/store.json'),'INVALID_PATH',400);
  error(await send('GET','/api/demo?scope=all'),'INVALID_PATH',400);
  const staticResult=await send('GET','/ai-design-pilot-service-test.html');
  if(staticResult.status===200){assert.match(staticResult.headers['content-security-policy'],/connect-src 'self'/);assert.match(staticResult.headers['content-security-policy'],/frame-ancestors 'none'/);}
  assert.equal(staticResult.headers['cache-control'],'no-store');assert.equal(staticResult.headers['access-control-allow-origin'],undefined);
  passed('static whitelist cannot expose store, source tree or encoded traversal; CSP and no CORS are enforced');

  const scopeB={customerId:'demo-customer-b',visitId:'demo-visit-b',sessionId:'fixture-session-b'};
  let sessionB=(await send('POST','/api/sessions',{requestId:'create-b',...scopeB},{actor:'demo-stylist-b'})).body.session;
  for(const phase of ['proposal','execution','completed_review','archive']){
    const advanced=await send('POST','/api/sessions/'+scopeB.sessionId+'/events',{requestId:'b-phase-'+phase,expectedRevision:sessionB.revision,scope:scopeB,event:{type:'phase_advanced',phase}},{actor:'demo-stylist-b'});
    assert.equal(advanced.status,200);sessionB=advanced.body.session;
  }
  const archiveB=await send('POST','/api/sessions/'+scopeB.sessionId+'/archive',{requestId:'archive-b',expectedRevision:sessionB.revision,scope:scopeB},{actor:'demo-stylist-b'});
  assert.equal(archiveB.status,200);
  const goodStore=await content();await service.close();service=null;
  await fs.writeFile(path.join(dataDir,'store.json'),'{incomplete committed document');
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_CORRUPT');
  assert.equal(await content(),'{incomplete committed document');await fs.writeFile(path.join(dataDir,'store.json'),goodStore);
  const forged=JSON.parse(goodStore);forged.archives[Object.keys(forged.archives)[0]].sha256='0'.repeat(64);await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(forged));
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');await fs.writeFile(path.join(dataDir,'store.json'),goodStore);
  passed('corrupt committed store or altered archive fails closed and is never silently reset');
  const crossArchive=JSON.parse(goodStore);
  crossArchive.receipts['demo-stylist-a|archive-first'].result.archiveId=archiveB.body.archive.archiveId;
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(crossArchive));
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');await fs.writeFile(path.join(dataDir,'store.json'),goodStore);
  const wrongOperation=JSON.parse(goodStore);
  wrongOperation.receipts['demo-stylist-a|archive-first'].operation='archive:fixture-session-b';
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(wrongOperation));
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');await fs.writeFile(path.join(dataDir,'store.json'),goodStore);
  passed('corrupted idempotency receipt cannot replay another actor archive or another session operation');
  const missingParent=JSON.parse(goodStore);delete missingParent.archives[firstArchive.archiveId];
  for(const [key,receipt] of Object.entries(missingParent.receipts))if(receipt.result.archiveId===firstArchive.archiveId)delete missingParent.receipts[key];
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(missingParent));
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');await fs.writeFile(path.join(dataDir,'store.json'),goodStore);
  passed('orphaned revision journal fails closed even after deleting parent-related receipts');
  service=await startSyntheticDesignService(options);
  await fs.rename(path.join(dataDir,'store.json'),path.join(dataDir,'synthetic-original.json'));
  error(await send('GET','/api/sessions/'+scope.sessionId),'STORE_MISSING',500);
  assert.equal(await fs.readFile(path.join(dataDir,'synthetic-original.json'),'utf8'),goodStore);
  await fs.rename(path.join(dataDir,'synthetic-original.json'),path.join(dataDir,'store.json'));
  passed('missing previously committed file is a blocker, not a new empty database');
  await service.close();service=null;
  await fs.rename(path.join(dataDir,'store.json'),path.join(dataDir,'synthetic-original.json'));
  await expectThrows(()=>startSyntheticDesignService(options),'STORE_MISSING');
  assert.equal(await fs.readFile(path.join(dataDir,'synthetic-original.json'),'utf8'),goodStore);
  await fs.rename(path.join(dataDir,'synthetic-original.json'),path.join(dataDir,'store.json'));
  service=await startSyntheticDesignService(options);assert.deepEqual(await get(),session);
  passed('durable initialization marker refuses a missing main store across a normal restart');

  const eventOnlyStore=await content(),uiSettings={actor:UI_SYNTHETIC_ACTOR};
  const uiSend=(method,url,body,settings={})=>send(method,url,body,{...uiSettings,...settings});
  const catalog=await uiSend('GET','/api/ui-catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.customers.length,3);
  assert.equal((await send('GET','/api/ui-catalog',undefined,{actor:'demo-stylist-b'})).body.customers.length,0);
  const uiScope=catalog.body.customers[0].scope,uiScopeB=catalog.body.customers[1].scope,uiPath='/api/ui-drafts/'+uiScope.sessionId;
  const uiCreate={requestId:'ui-create',scope:uiScope};let uiResult=await uiSend('POST','/api/ui-drafts',uiCreate);assert.equal(uiResult.status,200);let ui=uiResult.body.uiDraft;
  assert.equal(ui.schemaVersion,'design-pilot-ui-state-v1');assert.equal(uiResult.body.projection,'ui-draft-not-event-contract');
  assert.equal((await uiSend('POST','/api/ui-drafts',uiCreate)).body.replayed,true);
  error(await uiSend('GET',uiPath,undefined,{actor:'demo-stylist-b'}),'FORBIDDEN',403);
  error(await uiSend('POST','/api/ui-drafts',{requestId:'ui-real',scope:{...uiScope,customerId:'real-customer'}}),'FORBIDDEN',403);
  error(await uiSend('POST','/api/ui-drafts',{...uiCreate,actor:'owner'}),'INVALID_FIELDS',400);
  error(await uiSend('POST','/api/ui-drafts',{requestId:'ui-foreign-session',scope:{...uiScope,sessionId:'arbitrary-session'}}),'FORBIDDEN',403);
  passed('UI catalogue filters one explicit synthetic owner across three fixed fixtures; no implicit identity switching or client authority');
  const blank=structuredClone(ui.draft),clone=structuredClone;
  function uiBody(id,draft,expected=ui.revision){return {requestId:id,expectedRevision:expected,scope:uiScope,draft};}
  const small=clone(blank);small.text=uiContract.UI_FIXTURE_TEXT.sample;small.demoLoaded=true;small.materialRevision=1;small.designRevision=1;
  Object.assign(small.basic.style,{value:uiContract.UI_FIXTURE_TEXT.style,original:uiContract.UI_FIXTURE_TEXT.quote,origin:'demo_extract',confirmed:true});
  const saveFirst=uiBody('ui-save-1',small);
  uiResult=await uiSend('POST',uiPath+'/save',saveFirst);assert.equal(uiResult.status,200,JSON.stringify(uiResult.body));ui=uiResult.body.uiDraft;
  const uiSavedBytes=await content();assert.equal((await uiSend('POST',uiPath+'/save',saveFirst)).body.replayed,true);assert.equal(await content(),uiSavedBytes);
  assert.deepEqual((await uiSend('GET',uiPath)).body.draft,small);
  for(const extra of [{revision:99},{revisions:[]},{history:[]},{scope:uiScope},{role:'owner'}])error(await uiSend('POST',uiPath+'/save',uiBody('ui-bad-'+(++sequence),{...small,...extra})),'UI_INVALID_FIELDS',400);
  error(await uiSend('POST',uiPath+'/save',{...uiBody('ui-body-version',small),revision:99}),'INVALID_FIELDS',400);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-wrong-schema',{...small,schemaVersion:'design-pilot-local-v2'})),'UI_SCHEMA_MISMATCH',400);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-free-text',{...small,text:'not a fixed synthetic fixture'})),'UI_SYNTHETIC_TEXT_ONLY',400);
  for(const photo of [{id:1,kind:'demo',angle:'front',url:'https://example.invalid/image'},{id:1,kind:'demo',angle:'front',filename:'synthetic.png'},{id:1,kind:'demo',angle:'front',bytes:'AAAA'}])error(await uiSend('POST',uiPath+'/save',uiBody('ui-bad-photo-'+(++sequence),{...small,photos:{before:[photo],after:[]}})),'UI_INVALID_FIELDS',400);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-local-photo',{...small,photos:{before:[{id:1,kind:'local',angle:'front'}],after:[]}})),'UI_SYNTHETIC_PHOTO_ONLY',400);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-key',{...small,text:'sk-012345678901234567890123456789'})),'UNSAFE_PAYLOAD',400);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-old-revision',small,0)),'REVISION_CONFLICT',409);
  assert.equal(await content(),uiSavedBytes);
  passed('UI projection save preserves original/source flags; strict schema rejects version/history injection, real/free text, URL/name/bytes and keys');

  const competingUI=[1,2].map(n=>uiBody('ui-race-'+n,{...small,designRevision:1+n}));
  const uiRace=await Promise.all(competingUI.map(body=>uiSend('POST',uiPath+'/save',body)));assert.deepEqual(uiRace.map(r=>r.status).sort(),[200,409]);ui=(await uiSend('GET',uiPath)).body.uiDraft;
  const uiDuplicate=uiBody('ui-parallel-identical',ui.draft);const duplicateUI=await Promise.all([uiSend('POST',uiPath+'/save',uiDuplicate),uiSend('POST',uiPath+'/save',uiDuplicate)]);assert.deepEqual(duplicateUI.map(r=>r.body.replayed).sort(),[false,true]);ui=(await uiSend('GET',uiPath)).body.uiDraft;
  error(await uiSend('POST',uiPath+'/save',{...uiDuplicate,draft:blank}),'IDEMPOTENCY_CONFLICT',409);
  denied=true;error(await uiSend('GET',uiPath),'RELATIONSHIP_REVOKED',403);error(await uiSend('POST',uiPath+'/save',saveFirst),'RELATIONSHIP_REVOKED',403);assert.equal((await uiSend('GET','/api/ui-catalog')).body.customers.length,0);denied=false;
  const lateUI=uiBody('ui-revoke-before-commit',ui.draft),preRevoke=await content();revokeAtCommit=true;
  error(await uiSend('POST',uiPath+'/save',lateUI),'RELATIONSHIP_REVOKED',403);denied=false;assert.equal(await content(),preRevoke);
  passed('UI CAS and identical retries are serialized; reads/replays/catalogue/commit boundary all recheck revocation');

  const uiInterrupted=uiBody('ui-pre-rename',ui.draft);fault='after-temp-sync';const preUIFailure=await content();error(await uiSend('POST',uiPath+'/save',uiInterrupted),'STORAGE_FAILURE',500);assert.equal(await content(),preUIFailure);
  uiResult=await uiSend('POST',uiPath+'/save',uiInterrupted);assert.equal(uiResult.status,200);ui=uiResult.body.uiDraft;
  const uiLost=uiBody('ui-lost-ack',ui.draft);fault='after-rename';error(await uiSend('POST',uiPath+'/save',uiLost),'STORAGE_FAILURE',500);
  uiResult=await uiSend('POST',uiPath+'/save',uiLost);assert.equal(uiResult.body.replayed,true);ui=uiResult.body.uiDraft;
  assert.equal(ui.history.filter(item=>item.requestId==='ui-lost-ack').length,1);
  passed('UI interruption preserves old bytes; uncertain committed response recovers by the exact stored receipt');

  const maximum=clone(catalog.body.emptyDraft);maximum.text=uiContract.UI_FIXTURE_TEXT.sample;maximum.demoLoaded=true;maximum.materialRevision=20;maximum.designRevision=50;
  const track=record=>Object.fromEntries(['value','original','origin','confirmed','phase','edited'].map(key=>[key,record[key]]));
  const fill=(record,fieldPath)=>{record.value=[...uiContract.getUIFieldOptions(fieldPath)].sort((a,b)=>Buffer.byteLength(b)-Buffer.byteLength(a))[0];record.original=record.value;record.confirmed=Boolean(record.value);if(record.phase!=='context'&&!fieldPath.startsWith('review.')&&fieldPath!=='care'){record.tracks.planned={...track(record),phase:'planned'};record.tracks.actual={...track(record),phase:'actual'};}};
  for(const [field,record]of Object.entries(maximum.basic))fill(record,'basic.'+field);fill(maximum.proposal,'proposal');fill(maximum.care,'care');
  for(const zone of uiContract.UI_ZONES){for(const [field,record]of Object.entries(maximum.zones[zone]))fill(record,'zones.'+zone+'.'+field);for(const kind of ['perm','dye'])for(let i=0;i<8;i++){const group=clone(uiContract.createUIProcessGroup(kind));for(const [field,record]of Object.entries(group))fill(record,`zoneProcesses.${zone}.${kind}.${i}.${field}`);maximum.zoneProcesses[zone][kind].push(group);}}
  for(const kind of ['perm','dye','review'])for(const [field,record]of Object.entries(maximum[kind]))fill(record,kind+'.'+field);
  let photoId=1;for(const stage of ['before','after'])for(const angle of ['front','back','left'])for(let i=0;i<4;i++)maximum.photos[stage].push({id:photoId++,kind:'demo',angle});
  const maxBytes=Buffer.byteLength(JSON.stringify(maximum));assert.ok(maxBytes>128*1024&&maxBytes<512*1024);
  uiResult=await uiSend('POST',uiPath+'/save',uiBody('ui-max-96',maximum));assert.equal(uiResult.status,200,JSON.stringify(uiResult.body));ui=uiResult.body.uiDraft;assert.deepEqual(ui.draft,maximum);
  assert.equal(ui.draft.zoneProcesses.bottom.dye.length,8);assert.equal(ui.draft.zoneProcesses.bangs.perm[0].rods.tracks.actual.value,maximum.zoneProcesses.bangs.perm[0].rods.tracks.actual.value);
  passed('full 96-group populated planned/actual UI and 24 synthetic markers round-trip '+maxBytes+' bytes; legacy event body limit remains separate');

  const uiArchiveReq={requestId:'ui-archive-1',expectedRevision:ui.revision,scope:uiScope};
  error(await uiSend('POST',uiPath+'/archive',{...uiArchiveReq,draft:blank}),'INVALID_FIELDS',400);
  uiResult=await uiSend('POST',uiPath+'/archive',uiArchiveReq);assert.equal(uiResult.status,200);ui=uiResult.body.uiDraft;
  assert.equal(ui.status,'archived');assert.deepEqual(uiResult.body.archives[0].draft,maximum);const uiOriginalArchive=clone(uiResult.body.archives[0]);
  assert.equal((await uiSend('POST',uiPath+'/archive',uiArchiveReq)).body.replayed,true);
  error(await uiSend('POST',uiPath+'/save',uiBody('ui-edit-closed',maximum)),'ARCHIVE_IMMUTABLE',409);
  const reopenUI={requestId:'ui-reopen-1',expectedRevision:ui.revision,scope:uiScope,reason:uiContract.UI_FIXTURE_TEXT.revisionReason};
  uiResult=await uiSend('POST',uiPath+'/reopen',reopenUI);assert.equal(uiResult.status,200);ui=uiResult.body.uiDraft;assert.equal(ui.status,'draft');
  assert.equal((await uiSend('POST',uiPath+'/reopen',reopenUI)).body.replayed,true);
  const changedUI=clone(maximum);changedUI.zoneProcesses.bangs.perm[0].rods.value=uiContract.UI_FIXTURE_TEXT.rodA;changedUI.zoneProcesses.bangs.perm[0].rods.confirmed=false;changedUI.zoneProcesses.bangs.perm[0].rods.edited=true;changedUI.designRevision++;
  uiResult=await uiSend('POST',uiPath+'/save',uiBody('ui-revised-save',changedUI));assert.equal(uiResult.status,200);ui=uiResult.body.uiDraft;
  uiResult=await uiSend('POST',uiPath+'/archive',{requestId:'ui-archive-2',expectedRevision:ui.revision,scope:uiScope});assert.equal(uiResult.status,200);ui=uiResult.body.uiDraft;
  assert.equal(uiResult.body.archives.length,2);assert.deepEqual(uiResult.body.archives[0],uiOriginalArchive);assert.equal(uiResult.body.archives[1].previousArchiveRevision,uiOriginalArchive.revision);
  assert.equal(ui.draft.proposal.phase,'planned');
  const replayUI=await uiSend('POST',uiPath+'/save',saveFirst);assert.equal(replayUI.body.appliedRevision,1);assert.equal(replayUI.body.revision,ui.revision);assert.equal(replayUI.body.uiDraft.scope.sessionId,uiScope.sessionId);
  passed('server archives only the latest saved projection; reopen appends same-scope lineage, old sources/tracks/archive stay immutable and are never marked executed');

  const uiBeforeRestart=await content();await service.close();service=null;service=await startSyntheticDesignService(options);
  assert.deepEqual((await uiSend('GET',uiPath)).body.uiDraft,ui);assert.equal(await content(),uiBeforeRestart);
  assert.deepEqual((await uiSend('POST',uiPath+'/archive',uiArchiveReq)).body.archives[0],uiOriginalArchive);
  const connected=await uiSend('GET','/ai-design-pilot-connected.html');assert.equal(connected.status,200);assert.match(connected.headers['content-security-policy'],/img-src data:/);
  const simplePage=await send('GET','/ai-design-pilot-service-test.html');assert.match(simplePage.headers['content-security-policy'],/img-src 'none'/);
  error(await uiSend('GET','/packages/analysis-engine/design-pilot-ui-draft.mjs'),'NOT_FOUND',404);error(await uiSend('GET','/ai-design-pilot.html'),'NOT_FOUND',404);
  passed('complete UI restores exact source/plan/actual after normal restart; only connected shell gets data-image CSP, no package-tree static access');

  await uiSend('POST','/api/ui-drafts',{requestId:'ui-create-b',scope:uiScopeB});
  const secondUIArchive=await uiSend('POST','/api/ui-drafts/'+uiScopeB.sessionId+'/archive',{requestId:'ui-archive-b',expectedRevision:0,scope:uiScopeB});assert.equal(secondUIArchive.status,200);
  const uiGoodStore=await content();await service.close();service=null;
  const uiForged=JSON.parse(uiGoodStore);uiForged.uiReceipts[UI_SYNTHETIC_ACTOR+'|ui-archive-1'].result.archiveId=secondUIArchive.body.archives[0].archiveId;
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(uiForged));await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');
  const uiMissing=JSON.parse(uiGoodStore);delete uiMissing.uiArchives[uiOriginalArchive.archiveId];for(const [key,receipt]of Object.entries(uiMissing.uiReceipts))if(receipt.result.archiveId===uiOriginalArchive.archiveId)delete uiMissing.uiReceipts[key];
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(uiMissing));await expectThrows(()=>startSyntheticDesignService(options),'STORE_INVALID');
  const uiHistoryDamage=JSON.parse(uiGoodStore);uiHistoryDamage.uiDrafts[uiScope.sessionId].uiDraft.history[0].draft.text='altered fixture outside catalogue';
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(uiHistoryDamage));await expectThrows(()=>startSyntheticDesignService(options),'UI_SYNTHETIC_TEXT_ONLY');
  await fs.writeFile(path.join(dataDir,'store.json'),uiGoodStore);
  passed('damaged UI history, cross-session archive receipts and missing parent archives fail closed');

  const oldFormat=JSON.parse(eventOnlyStore);delete oldFormat.uiDrafts;delete oldFormat.uiArchives;delete oldFormat.uiReceipts;
  await fs.writeFile(path.join(dataDir,'store.json'),JSON.stringify(oldFormat));service=await startSyntheticDesignService(options);
  assert.deepEqual(await get(),session);assert.equal((JSON.parse(await content())).uiDrafts,undefined,'opening old store does not rewrite it');
  assert.equal((await uiSend('POST','/api/ui-drafts',{requestId:'legacy-ui-create',scope:uiScope})).status,200);
  const upgraded=JSON.parse(await content());for(const field of ['sessions','archives','receipts'])assert.deepEqual(upgraded[field],oldFormat[field]);
  await service.close();service=null;await fs.writeFile(path.join(dataDir,'store.json'),uiGoodStore);service=await startSyntheticDesignService(options);
  passed('additive old-store upgrade preserves every prior event session/archive/digest/receipt without resetting or rewriting on read');

  await expectThrows(()=>startSyntheticDesignService({...options,storageAdapter:{kind:'remote',open(){throw new Error('must never be called');}}}),'UNSUPPORTED_STORAGE_ADAPTER');
  const adapter=createSyntheticMemoryStorageAdapter();const fileService=service;service=await startSyntheticDesignService({optIn:SYNTHETIC_OPT_IN,storageAdapter:adapter});
  assert.equal((await uiSend('POST','/api/ui-drafts',{requestId:'memory-create',scope:uiScope})).status,200);
  await expectThrows(()=>startSyntheticDesignService({optIn:SYNTHETIC_OPT_IN,storageAdapter:adapter}),'STORE_LOCKED');
  await service.close();service=await startSyntheticDesignService({optIn:SYNTHETIC_OPT_IN,storageAdapter:adapter});assert.equal((await uiSend('GET',uiPath)).status,200);await service.close();service=fileService;
  passed('storage dependency-injection seam admits only isolated built-in synthetic memory; unconfigured real/external stores fail closed');

  const leasedAdapter=createSyntheticMemoryStorageAdapter(),oldHandle=await leasedAdapter.open(),initialMemory=await oldHandle.load();await oldHandle.close();
  const newHandle=await leasedAdapter.open();await oldHandle.close();await expectThrows(()=>oldHandle.load(),'STORE_CLOSED');await expectThrows(()=>oldHandle.persist(initialMemory,()=>{}),'STORE_CLOSED');
  assert.deepEqual(await newHandle.load(),initialMemory);await expectThrows(()=>leasedAdapter.open(),'STORE_LOCKED');
  await newHandle.persist(initialMemory,()=>{});await newHandle.close();
  passed('closed memory handles cannot read, write or close a later writer lease');

  console.log('\n'+checks+' local synthetic service checks passed.');
}finally{
  if(service)await service.close();
  await fs.rm(directory,{recursive:true,force:true});
}
