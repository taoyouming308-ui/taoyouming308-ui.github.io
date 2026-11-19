/** Actual PostgreSQL + native full decode + private Storage protocol MOCK. No real uploads. */
import assert from 'node:assert/strict';
import {createDesignPostgresFixture} from './fixtures/design-postgres-fixture.mjs';
import {createDesignPostgresExecutor} from '../packages/design-production-adapter/postgres-executor.mjs';
import {createDesignPostgresRepositories} from '../packages/design-production-adapter/postgres-workflow-repositories.mjs';
import {createPrivateMediaService} from '../packages/design-production-adapter/private-media-service.mjs';
import {syntheticPrivatePNG,createSyntheticWhitelistedInspector} from './fixtures/design-private-media-native.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const f=await createDesignPostgresFixture();let passed=0;
const test=async(name,fn)=>{await fn();console.log(`ok ${++passed} - ${name}`);};
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code&&!e.message.includes('SENSITIVE'));
try{
 const executor=createDesignPostgresExecutor({acquireClient:f.acquireClient,lifecyclePolicy:f.lifecyclePolicy});
 const repos=createDesignPostgresRepositories({executor}),inspector=createSyntheticWhitelistedInspector(),origin='https://syntheticstage7.supabase.co';
 const state={objects:new Map(),calls:[],denyPublish:false,loseCommit:false,revokeAfterCommit:null,postLost:false,approved:true};
 const count=id=>Number(f.sql(`select count(*) from design_private.media_records where media_id='${id}';`));
 const revoke=id=>f.sql(`update design_private.media_access set active=false,revision=revision+1 where media_id='${id}' and active;`);
 const options=()=>{
  const metadata=repos.createMediaMetadataRepository({resolveCredential:()=>f.credential});
  return {enabled:true,permissionGate:repos.employeeAdapter.gate,imageInspector:inspector,approvalVerifier:{verify:async()=>state.approved},storageOrigin:origin,
   metadataRepository:{async withScopeLock(binding,work){
    if(state.denyPublish&&state.objects.size)throw Error('SENSITIVE_METADATA_FAILURE');
    const result=await metadata.withScopeLock(binding,work);
    if(state.revokeAfterCommit&&count(state.revokeAfterCommit))revoke(state.revokeAfterCommit);
    if(state.loseCommit&&Number(f.sql('select count(*) from design_private.media_records;')))throw Error('SENSITIVE_LOST_COMMIT');
    return result;
   },verifyRecords:(...args)=>metadata.verifyRecords(...args)},
   storageTransport:async req=>{
    // Actual PG read probes that no executor transaction remains open across network I/O.
    assert.equal(Number(f.sql("select count(*) from pg_stat_activity where application_name like 'executor-%' and state like 'idle in transaction%';")),0);
    state.calls.push(req.method);const response=(status,body=new Uint8Array())=>({url:req.url,redirected:false,status,body});
    if(req.method==='POST'){const exists=state.objects.has(req.url);if(!exists)state.objects.set(req.url,Uint8Array.from(req.body));if(state.postLost)throw Error('SENSITIVE_OBJECT_ACK');return response(exists?409:200);}
    return response(state.objects.has(req.url)?200:404,Uint8Array.from(state.objects.get(req.url)||[]));
   }};
 };
 const service=()=>createPrivateMediaService(options());
 const upload=id=>({credential:f.credential,scope:f.scopeA,approval:'SYNTHETIC_APPROVAL',requestId:id,bytes:syntheticPrivatePNG(),mime:'image/png',stage:'before',angle:'front'});
 const read=id=>({credential:f.credential,scope:f.scopeA,approval:'SYNTHETIC_APPROVAL',mediaId:id});
 await test('actual native upload/read publishes one PG row without network I/O under lock',async()=>{await service().upload(upload('synthetic-main'));assert.equal(count('synthetic-main'),1);assert.deepEqual((await service().read(read('synthetic-main'))).bytes,syntheticPrivatePNG());});
 await test('recreated service and fresh PG leases retain same-ID replay without second POST',async()=>{const posts=state.calls.filter(v=>v==='POST').length;assert.equal((await service().upload(upload('synthetic-main'))).replayed,true);assert.equal(state.calls.filter(v=>v==='POST').length,posts);});
 await test('PG immutable metadata cannot be rewritten or silently reused in another scope',async()=>{assert.throws(()=>f.sql("update design_private.media_records set record=record where media_id='synthetic-main';"));await rejects(service().read({...read('synthetic-main'),scope:f.scopeB}),'MEDIA_NOT_FOUND');});
 await test('object ack loss reconciles readback and then commits metadata once',async()=>{state.postLost=true;await service().upload(upload('synthetic-object-ack'));state.postLost=false;assert.equal(count('synthetic-object-ack'),1);});
 await test('failed metadata publication retains private orphan and explicit identical recovery',async()=>{const before=state.objects.size;state.denyPublish=true;await rejects(service().upload(upload('synthetic-orphan')),'MEDIA_UNAVAILABLE');state.denyPublish=false;
  // Inject only after this new object's POST, not during initial metadata read.
  const config=options(),transport=config.storageTransport;config.storageTransport=async req=>{const response=await transport(req);if(req.method==='GET')state.denyPublish=true;return response;};
  await rejects(createPrivateMediaService(config).upload(upload('synthetic-orphan')),'MEDIA_OUTCOME_UNCERTAIN');state.denyPublish=false;assert.equal(count('synthetic-orphan'),0);assert.equal(state.objects.size,before+1);await rejects(service().read(read('synthetic-orphan')),'MEDIA_NOT_FOUND');await service().upload(upload('synthetic-orphan'));assert.equal(count('synthetic-orphan'),1);
 });
 await test('lost metadata ack is uncertain; committed record recovers without another POST',async()=>{const config=options(),original=config.metadataRepository.withScopeLock;config.metadataRepository.withScopeLock=async(...args)=>{const result=await original(...args);if(count('synthetic-db-ack'))throw Error('SENSITIVE_ACK');return result;};await rejects(createPrivateMediaService(config).upload(upload('synthetic-db-ack')),'MEDIA_OUTCOME_UNCERTAIN');const posts=state.calls.filter(v=>v==='POST').length;assert.equal((await service().upload(upload('synthetic-db-ack'))).replayed,true);assert.equal(state.calls.filter(v=>v==='POST').length,posts);});
 await test('actual PG active tombstone blocks final response and later byte access',async()=>{state.revokeAfterCommit='synthetic-revoked';await rejects(service().upload(upload('synthetic-revoked')),'MEDIA_OUTCOME_UNCERTAIN');state.revokeAfterCommit=null;await rejects(service().read(read('synthetic-revoked')),'MEDIA_SCOPE_DENIED');assert.throws(()=>f.sql("update design_private.media_access set active=true,revision=revision+1 where media_id='synthetic-revoked';"));});
 console.log(`PASS ${passed} actual PostgreSQL/private-media composition tests; Storage remains mock.`);
}finally{await f.cleanup();console.log('Verified isolated PostgreSQL fixture cleanup.');}
