/** REAL isolated PG + pinned offline producer + separate constrained Node PNG
 * decoder. Only fixed synthetic images. Private object-store and model RESPONSE
 * remain mocks; no hosted transformation, customer image, model fee or key. */
import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {createCanonicalVerificationFixture} from './fixtures/canonical-verification.mjs';
import {createCanonicalNormalizationOperation} from '../packages/design-production-adapter/managed-canonical-normalization-operation.mjs';
import {createCanonicalVerificationRunner} from '../packages/design-production-adapter/managed-canonical-verification-runner.mjs';
import {createLocalCanonicalImageRuntime} from '../packages/design-production-adapter/local-canonical-image-runtime.mjs';
import {createManagedNormalizedModelPreview} from '../packages/design-production-adapter/managed-normalized-model-preview.mjs';
import {managedImageDigest as digest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
globalThis.fetch=()=>{throw Error('NO_EXTERNAL_NETWORK');};
const E='/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage34',SEED=E+'/canonical-seed';mkdirSync(E,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex'),runtime=createLocalCanonicalImageRuntime({enabled:true}),rows=[];let f,failed=null,count=0;
const check=async(name,fn)=>{const t=performance.now();await fn();console.log(`ok ${++count} - ${name} (${Math.round(performance.now()-t)}ms)`);};
try{
 f=await createCanonicalVerificationFixture();const {credential,scope}=f;let normalizeCalls=0,verifyCalls=0;
 const normalizer={async normalizeSynthetic(q){normalizeCalls++;const claim=await f.processing.readClaim({credential,scope,requestId:activeRequest});assert(claim&&claim.artifactDigest===null,'durable claim committed BEFORE native decode');return runtime.normalizeSynthetic(q);}};let activeRequest;
 const verifier={async verifyTask(q){verifyCalls++;return runtime.verifyTask(q);}};
 for(const [ext,mime] of [['jpg','image/jpeg'],['webp','image/webp']]){
  await check(`${ext}: actual processing claim → real isolated normalization → independent store/task → real verification → mock candidate preview`,async()=>{
   const sourceBytes=readFileSync(`${SEED}/source.${ext}`),parentBytes=readFileSync(`${SEED}/parent.${ext}`),parent=await f.seedCanonicalParent({id:'real-'+ext,mime,sourceBytes,parentBytes});activeRequest=parent.intent.requestId;
   await f.processingIssuer.issueProcessing({credential,scope,permissionId:'normalize-real-'+ext,intent:parent.intent,ttlMs:900000});
   const op=createCanonicalNormalizationOperation({enabled:true,processing:f.processing,storage:f.canonicalStorage,runtime:normalizer,timeoutMs:30000});
   const started=performance.now(),out=await op.run({credential,scope,mediaId:parent.sourceRecord.mediaId,parentRequestId:parent.parentResponse.descriptor.requestId,requestId:parent.intent.requestId});const normalizeMs=performance.now()-started;
   try{
    assert.equal(out.claimedArtifact.artifact.state,'pending_validation');assert.equal(sha(out.bytes),out.claimedArtifact.artifact.output.sha256);assert.equal((await f.processing.readClaim({credential,scope,requestId:activeRequest})).artifactDigest,digest(out.claimedArtifact.artifact));
    await f.approveCanonicalStorage({artifact:out.claimedArtifact.artifact,permissionId:'normalized-real-'+ext});const receipt=await f.storeCanonicalOutput({claimedArtifact:out.claimedArtifact,bytes:out.bytes});
    const taskId='canonical-real-'+ext,task=await f.canonicalIssuers.issueTask({credential,scope,taskId,requestId:activeRequest,ttlMs:900000});assert.deepEqual(task.objectReceipt,receipt);
    const runner=createCanonicalVerificationRunner({enabled:true,issuer:f.canonicalIssuers,storage:f.canonicalStorage,runtime:verifier,timeoutMs:30000});const at=performance.now(),result=await runner.run({credential,scope,taskId});const verifyMs=performance.now()-at;
    const packet=await f.canonicalLedger.readVerified({credential,scope,taskId});assert.equal(result.reportDigest,digest(packet.report));assert.equal(packet.report.state,'evidence_complete');assert(!Object.hasOwn(packet.report.checks,'fullDecode'));assert(Object.values(packet.report.checks).every(x=>x==='verified'));assert.equal(packet.task.policy.scope,'synthetic_fixture_only');
    const preview=createManagedNormalizedModelPreview({enabled:true,ledger:f.canonicalLedger,storage:f.canonicalStorage,modelConfig:{model:'synthetic-vision',maxOutputTokens:128},approvedModels:['synthetic-vision'],timeoutMs:30000});
    const response=Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({observations:[{field:'visible_outline',value:'轮廓偏圆'},{field:'visible_hair_shape',value:null}]})}}]}));
    const shown=await preview.preview({credential,scope,taskId,requestId:'mock-preview-'+ext,mockResponse:response});assert.equal(shown.prepared.state,'prepared_not_dispatched');assert.equal(shown.candidate.state,'mock_preview_not_dispatched');assert.equal(shown.candidate.generation,'synthetic_mock_response');assert.equal(shown.candidate.adoptionAuthorized,false);
    writeFileSync(`${E}/canonical-real-${ext}-normalized.png`,out.bytes,{mode:0o600});
    rows.push({fixture:ext,sourceBytes:sourceBytes.length,parentBytes:parentBytes.length,normalizedBytes:out.bytes.length,sourceSha256:sha(sourceBytes),parentSha256:sha(parentBytes),normalizedSha256:sha(out.bytes),normalizeMs,verifyMs,reportDigest:result.reportDigest,checks:packet.report.checks,previewState:shown.candidate.state});
    // Revocation is checked through the actual strict reader before another image read.
    await f.processingIssuer.revoke({permissionId:'normalize-real-'+ext});await assert.rejects(f.canonicalLedger.readVerified({credential,scope,taskId}));await assert.rejects(preview.prepare({credential,scope,taskId,requestId:'revoked-'+ext}));
   }finally{out.bytes.fill(0);}
  });
 }
 await check('actual source with appended bytes is rejected by fixed producer match; claimed once, no normalized PUT or report',async()=>{
  const sourceBytes=Buffer.concat([readFileSync(`${SEED}/source.jpg`),Buffer.from('SYNTHETIC-TAIL')]),parentBytes=readFileSync(`${SEED}/parent.jpg`),parent=await f.seedCanonicalParent({id:'bad-source',mime:'image/jpeg',sourceBytes,parentBytes});activeRequest=parent.intent.requestId;
  await f.processingIssuer.issueProcessing({credential,scope,permissionId:'normalize-bad-source',intent:parent.intent,ttlMs:900000});const before=f.canonicalPuts(),op=createCanonicalNormalizationOperation({enabled:true,processing:f.processing,storage:f.canonicalStorage,runtime:normalizer});
  await assert.rejects(op.run({credential,scope,mediaId:parent.sourceRecord.mediaId,parentRequestId:parent.parentResponse.descriptor.requestId,requestId:activeRequest}),e=>e.outcome==='uncertain');assert.equal(f.canonicalPuts(),before);const claim=await f.processing.readClaim({credential,scope,requestId:activeRequest});assert.equal(claim.artifactDigest,null);const n=normalizeCalls;
  await assert.rejects(createCanonicalNormalizationOperation({enabled:true,processing:f.processing,storage:f.canonicalStorage,runtime:normalizer}).run({credential,scope,mediaId:parent.sourceRecord.mediaId,parentRequestId:parent.parentResponse.descriptor.requestId,requestId:activeRequest}),e=>e.outcome==='uncertain');assert.equal(normalizeCalls,n,'no hidden second native attempt');
 });
 assert.equal(normalizeCalls,3);assert.equal(verifyCalls,2);console.log(`PASS ${count} actual canonical PG/worker groups; TWO fixed synthetic fixtures, NOT customer cases; model/storage mocked`);
}catch(e){failed={name:e?.name??'Error',code:e?.code??'TEST_FAILURE'};throw e;}
finally{try{if(f)await f.cleanup();}finally{writeFileSync(`${E}/canonical-real-postgres-summary.json`,JSON.stringify({passedGroups:count,rows,failed,production:false,actualPostgres:true,actualPinnedProducer:true,actualIndependentPngDecode:true,privateStorage:'synthetic_map_mock',model:'synthetic_response_not_dispatched',arbitraryCompressedConsumptionClaimed:false},null,2)+'\n',{mode:0o600});}}
