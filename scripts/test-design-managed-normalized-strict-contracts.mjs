/** Synthetic metadata/protocol tests, not real JPEG/WebP/PNG qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {managedImageDigest as digest} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {createManagedNormalizationProcessingIntent} from '../packages/design-production-adapter/managed-normalization-processing-contracts.mjs';
import {buildManagedNormalizedVerificationBinding,validateManagedNormalizedVerificationReport} from '../packages/design-production-adapter/managed-normalized-verification-contracts.mjs';
import {validateManagedViewHistoryInput} from '../packages/analysis-engine/managed-view-result-history.mjs';
import {SYNTHETIC_CANONICAL_FIXTURE,syntheticCanonicalSourceBytes} from '../packages/design-production-adapter/synthetic-canonical-image-fixture.mjs';
import {
 MANAGED_NORMALIZED_STRICT_POLICY as POLICY,MANAGED_NORMALIZED_STRICT_VERIFIER as VERIFIER,MANAGED_NORMALIZED_STRICT_CHECKS as CHECKS,
 ManagedNormalizedStrictContractError,validateManagedNormalizedStrictTask as task,buildManagedNormalizedStrictBinding as binding,
 validateManagedNormalizedStrictBinaryResult as binary,createManagedNormalizedStrictReport as createReport,buildManagedNormalizedStrictReport as buildReport,
 validateManagedNormalizedStrictReport as report,buildManagedNormalizedStrictInput as buildInput,validateManagedNormalizedStrictInput as input
} from '../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
const rejects=fn=>assert.throws(fn,e=>e instanceof ManagedNormalizedStrictContractError&&e.code==='MANAGED_NORMALIZED_STRICT_INVALID'&&e.retryable===false&&e.outcome==='not_sent');
const all=(value='verified')=>Object.fromEntries(CHECKS.map(k=>[k,value]));
function fixture({mime='image/jpeg',maxEdge=1024,width=80,height=120,stage='before',angle='front',sourceVersion='source-1',parentVersion='parent-1',normalizedVersion='normalized-1',ownerPatch={}}={}){
 const f=managedImageResultFixture({mime,maxEdge}),s=clone(f.sourceRecord);Object.assign(s.owner,ownerPatch);s.stage=stage;s.angle=angle;s.object.version=sourceVersion;
 const d={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width,height,orientation:'confirmed',immutable:true,active:true};
 const p=clone(f.response),scale=Math.min(1,maxEdge/Math.max(width,height));p.sourceRecordDigest=digest(s);p.descriptor.source={bindingDigest:digest(d),objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime,byteLength:s.source.byteLength,width,height,orientation:'confirmed'};
 p.descriptor.requestedTransform.width=Math.floor(width*scale);p.descriptor.requestedTransform.height=Math.floor(height*scale);
 const o={...clone(f.objectReceipt),responseDigest:digest(p),object:{...s.object,key:'managed-derived/'+digest(p)+'/object',version:parentVersion},derivative:clone(p.descriptor.derivative)};
 const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-strict',sourceRecord:s,parentResponse:p,parentObjectReceipt:o,output:{sha256:'f'.repeat(64),byteLength:4096,mime:'image/png',width:p.descriptor.requestedTransform.width,height:p.descriptor.requestedTransform.height}});
 const intent=createManagedNormalizationProcessingIntent({requestId:artifact.requestId,sourceRecord:s,parentResponse:p,parentObjectReceipt:o});
 const claimedArtifact={schemaVersion:'design-claimed-normalization-v1',artifact,processingProvenance:{schemaVersion:'design-normalization-processing-provenance-v1',claimId:'normalization-claim-'+digest(intent),permissionId:'independent-processing-receipt',intentDigest:digest(intent),artifactDigest:digest(artifact)}};
 const objectReceipt={schemaVersion:'design-managed-normalized-object-v1',artifactDigest:digest(artifact),object:{...s.object,key:'managed-normalized/'+digest(artifact)+'/object',version:normalizedVersion},output:clone(artifact.output),private:true,readbackVerified:true};
 const value={schemaVersion:'design-normalized-strict-task-v1',taskId:'strict-task-1',claimedArtifact,objectReceipt,fixtureId:POLICY.fixture.id,verifier:clone(VERIFIER),policy:clone(POLICY)};
 return {f,value,artifact,objectReceipt,intent};
}
function binaryFixture(t){
 const a=t.claimedArtifact.artifact,png=(d,pixel='e'.repeat(64))=>({sha256:d.sha256,byteLength:d.byteLength,mime:'image/png',width:80,height:120,frameCount:1,pixelSha256:pixel,compressedBytes:100,consumedCompressedBytes:100,metadataAbsent:true});
 const producer=d=>({...d,producerSha256:d.sha256,producerByteLength:d.byteLength});
 return {schemaVersion:'design-normalized-strict-binary-result-v1',bindingDigest:digest(binding(t)),fixture:png(POLICY.fixture),source:producer(a.sourceRecord.source),parent:producer(a.parentObjectReceipt.derivative),normalized:png(a.output),reference:png({sha256:'c'.repeat(64),byteLength:4100}),checks:all()};
}
function frozen(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(frozen);}}
test('JPEG/WebP source lineage stays v1 unchanged under a new independently scoped task',()=>{
 for(const mime of ['image/jpeg','image/webp']){const f=fixture({mime}),before=JSON.stringify(f),out=task(f.value);assert.equal(out.claimedArtifact.artifact.sourceRecord.source.mime,mime);assert.equal(out.claimedArtifact.artifact.parentObjectReceipt.derivative.mime,mime);assert.equal(out.claimedArtifact.artifact.output.mime,'image/png');assert.equal(out.claimedArtifact.artifact.state,'pending_validation');assert(Object.values(out.claimedArtifact.artifact.validation).every(v=>v==='not_verified'));assert.equal(JSON.stringify(f),before);frozen(out);}
});
test('reference PNG is literal runtime fixture, never the customer source record',()=>{
 const bytes=syntheticCanonicalSourceBytes();assert.equal(hash(bytes),POLICY.fixture.sha256);assert.equal(bytes.length,POLICY.fixture.byteLength);assert.deepEqual(POLICY.fixture,SYNTHETIC_CANONICAL_FIXTURE);assert.equal(POLICY.fixture.version,'1');
 const f=fixture(),b=binding(f.value);assert.notEqual(b.fixture.sha256,b.sourceSha256);assert.equal(f.value.claimedArtifact.artifact.sourceRecord.source.mime,'image/jpeg');assert.equal(Object.hasOwn(b.fixture,'object'),false);assert.equal(CHECKS.includes('sourcePngComplete'),false);assert.equal(CHECKS.includes('fullDecode'),false);
});
test('binding commits all original and final objects, processing claim and fixed configuration',()=>{
 const f=fixture(),b=binding(f.value),a=f.artifact,p=f.value.claimedArtifact.processingProvenance;assert.equal(b.taskDigest,digest(f.value));assert.deepEqual(b.sourceObject,a.sourceRecord.object);assert.deepEqual(b.parentObject,a.parentObjectReceipt.object);assert.deepEqual(b.normalizedObject,f.objectReceipt.object);assert.deepEqual(b.processingProvenance,p);assert.equal(b.processingProvenanceDigest,digest(p));assert.equal(b.claimedArtifactDigest,digest(f.value.claimedArtifact));assert.equal(b.policyDigest,digest(POLICY));assert.deepEqual(b.policy,POLICY);assert.deepEqual(b.authority,a.authority);frozen(b);
});
test('task cannot pick another verifier, reference fixture, policy, decoder or producer setting',()=>{
 const f=fixture();for(const mutate of [t=>t.verifier.id='old-generic-verifier',t=>t.verifier.version='2',t=>t.fixtureId='caller-png',t=>t.policy.id='general-purpose',t=>t.policy.scope='production',t=>t.policy.fixture.sha256='0'.repeat(64),t=>t.policy.fixture.version='2',t=>t.policy.producer.imageDigest='sha256:'+'0'.repeat(64),t=>t.policy.producer.environment.IMGPROXY_STRIP_METADATA='false',t=>t.policy.sourceEncoder.enlarge=true,t=>t.policy.parentTransform.quality=90,t=>t.policy.normalization.containerNormalization='none',t=>t.policy.decoder.nodeVersion='latest',t=>t.policy.decoder.imageDigest='sha256:'+'1'.repeat(64)]){const t=clone(f.value);mutate(t);rejects(()=>task(t));}
});
test('only bounded reference geometry qualifies; no customer image/general PNG source fallback',()=>{
 for(const dims of [[81,120],[80,121],[3000,2000]])rejects(()=>task(fixture({width:dims[0],height:dims[1]}).value));
 rejects(()=>task(fixture({maxEdge:1536}).value));assert.deepEqual(POLICY.parentTransform.maxEdges,[1024]);
 const f=fixture(),t=clone(f.value);t.claimedArtifact.artifact.sourceRecord.source.mime='image/png';rejects(()=>task(t));
});
test('missing, replayed or self-invented processing provenance cannot bind a task',()=>{
 const f=fixture();for(const mutate of [t=>delete t.claimedArtifact.processingProvenance,t=>t.claimedArtifact.processingProvenance.intentDigest='0'.repeat(64),t=>t.claimedArtifact.processingProvenance.artifactDigest='0'.repeat(64),t=>t.claimedArtifact.processingProvenance.claimId='normalization-claim-'+('0'.repeat(64)),t=>t.claimedArtifact.processingProvenance.permissionId='',t=>t.claimedArtifact.processingProvenance.approved=true]){const t=clone(f.value);mutate(t);rejects(()=>task(t));}
});
test('previous report cannot move to any changed immutable version or same-alias replacement principal',()=>{
 const f=fixture(),r=createReport({task:f.value,checks:all()});for(const opt of [{sourceVersion:'source-2'},{parentVersion:'parent-2'},{normalizedVersion:'normalized-2'},{ownerPatch:{subjectId:'new-person'}},{ownerPatch:{securityEpoch:2}}]){const t=fixture(opt).value;task(t);rejects(()=>report(r,t));}
 const other=clone(f.value);other.taskId='strict-task-2';rejects(()=>report(r,other));
});
test('source, parent and final object cannot splice across tasks or private storage scopes',()=>{
 const f=fixture(),t=clone(f.value);t.objectReceipt.object.bucket='other-private';rejects(()=>task(t));
 for(const k of ['sourceRecord','parentObjectReceipt']){const t=clone(f.value);t.claimedArtifact.artifact[k].object.version='changed';rejects(()=>task(t));}
 for(const key of [f.artifact.sourceRecord.object.key,f.artifact.parentObjectReceipt.object.key]){const t=clone(f.value);t.objectReceipt.object.key=key;rejects(()=>task(t));}
});
test('unknown/failed checks have explicit non-complete states and no evidence',()=>{
 const f=fixture();for(const name of CHECKS)for(const status of ['unknown','failed']){const r=createReport({task:f.value,checks:{...all(),[name]:status}});assert.equal(r.state,status==='failed'?'validation_failed':'pending_validation');assert.equal(r.evidence,null);assert.deepEqual(report(r,f.value),r);rejects(()=>buildInput({task:f.value,report:r}));}
 const r=createReport({task:f.value,checks:{...all('unknown'),metadataAbsent:'failed'}});assert.equal(r.state,'validation_failed');
});
test('complete structural report confers no model/public/adoption permission or generic decode proof',()=>{
 const f=fixture(),before=JSON.stringify(f.artifact),r=createReport({task:f.value,checks:all()});assert.equal(r.state,'evidence_complete');assert.equal(r.taskDigest,digest(f.value));assert.equal(r.evidence.id,'strict-verification-'+digest({binding:r.verificationBinding,checks:r.checks}));assert.deepEqual([r.submissionAuthorized,r.adoptionAuthorized,r.publicEligible],[false,false,false]);assert.equal(Object.hasOwn(r.checks,'fullDecode'),false);assert.equal(JSON.stringify(f.artifact),before);frozen(r);
 // Passing this structural builder is intentionally not issuer provenance.
 assert.deepEqual(report(clone(r),clone(f.value)),r);
});
test('old generic three-object report cannot satisfy the narrow scoped report and vice versa',()=>{
 const f=fixture(),ctx={taskId:f.value.taskId,artifact:f.artifact,objectReceipt:f.objectReceipt,verifier:VERIFIER,policyVersion:POLICY.id},b=buildManagedNormalizedVerificationBinding(ctx),checks=Object.fromEntries(['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry'].map(k=>[k,'verified']));
 const old={schemaVersion:'design-managed-normalized-verification-report-v1',state:'evidence_complete',verificationBinding:b,checks,evidence:{schemaVersion:'design-managed-normalized-evidence-v1',id:'normalized-verification-'+digest({binding:b,checks}),verificationBindingDigest:digest(b),verifier:VERIFIER,policyVersion:POLICY.id,checks},submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false};
 validateManagedNormalizedVerificationReport(old,ctx);rejects(()=>report(old,f.value));assert.throws(()=>validateManagedNormalizedVerificationReport(createReport({task:f.value,checks:all()}),ctx));
});
test('self-attested extra authorization, expiry or generic fullDecode fields reject',()=>{
 const f=fixture(),r=createReport({task:f.value,checks:all()});for(const patch of [{authorized:true},{active:true},{expiresAt:9999999999999},{issuerSignature:'self-signed'},{credential:'private'},{submissionAuthorized:true},{adoptionAuthorized:true},{publicEligible:true}])rejects(()=>report({...r,...patch},f.value));
 rejects(()=>report({...r,checks:{...r.checks,fullDecode:'verified'}},f.value));
});
test('evidence hash, task/binding/claim/policy and checks cannot be detached or relabelled',()=>{
 const f=fixture(),r=createReport({task:f.value,checks:all()});for(const mutate of [r=>r.taskDigest='0'.repeat(64),r=>r.evidence.id='self-authored',r=>r.evidence.verificationBindingDigest='0'.repeat(64),r=>r.evidence.taskDigest='0'.repeat(64),r=>r.evidence.policyDigest='0'.repeat(64),r=>r.evidence.verifier.id='old',r=>r.evidence.checks.metadataAbsent='unknown',r=>r.verificationBinding.processingProvenance.permissionId='different',r=>r.verificationBinding.fixture.sha256='0'.repeat(64)]){const v=clone(r);mutate(v);rejects(()=>report(v,f.value));}
});
test('runtime binary protocol verifies actual descriptors and exact reproduction metrics before report',()=>{
 const f=fixture(),r=binaryFixture(f.value);assert.deepEqual(binary(r,f.value),r);assert.deepEqual(buildReport({task:f.value,binaryResult:r}),createReport({task:f.value,checks:all()}));frozen(binary(r,f.value));
});
test('wrong binding or any actual byte SHA/length/MIME rejects, not a failed report for a different object',()=>{
 const f=fixture();for(const name of ['fixture','source','parent','normalized'])for(const key of ['sha256','byteLength','mime']){const r=binaryFixture(f.value);r[name][key]=key==='sha256'?'0'.repeat(64):key==='byteLength'?r[name][key]+1:'image/other';rejects(()=>binary(r,f.value));}
 const r=binaryFixture(f.value);r.bindingDigest='0'.repeat(64);rejects(()=>binary(r,f.value));
});
test('source and parent must both match the fixed producer byte-for-byte; frame parser is insufficient',()=>{
 const f=fixture();for(const name of ['source','parent'])for(const key of ['producerSha256','producerByteLength']){const r=binaryFixture(f.value);r[name][key]=key==='producerSha256'?'0'.repeat(64):r[name].byteLength-1;rejects(()=>buildReport({task:f.value,binaryResult:r}));}
 const r=binaryFixture(f.value);r.source.fullyConsumed=true;rejects(()=>binary(r,f.value));
});
test('PNG complete means exact consumed compressed bytes, full frame and bounded metadata-free geometry',()=>{
 const f=fixture();for(const name of ['fixture','normalized','reference'])for(const patch of [{consumedCompressedBytes:99},{consumedCompressedBytes:101},{frameCount:2},{pixelSha256:null},{width:79},{height:null},{metadataAbsent:false}]){const r=binaryFixture(f.value);Object.assign(r[name],patch);rejects(()=>binary(r,f.value));}
 const r=binaryFixture(f.value);r.normalized.pixelSha256='a'.repeat(64);rejects(()=>binary(r,f.value));
});
test('binary unknown/failed measurements cannot silently become a successful report',()=>{
 const f=fixture(),r=binaryFixture(f.value);r.checks=all('unknown');r.reference=null;for(const n of ['fixture','normalized'])for(const key of ['width','height','frameCount','pixelSha256','compressedBytes','consumedCompressedBytes','metadataAbsent'])r[n][key]=null;for(const n of ['source','parent']){r[n].producerSha256=null;r[n].producerByteLength=null;}
 assert.equal(buildReport({task:f.value,binaryResult:r}).state,'pending_validation');r.checks.parentExactProducerMatch='failed';assert.equal(buildReport({task:f.value,binaryResult:r}).state,'validation_failed');r.checks=all();rejects(()=>buildReport({task:f.value,binaryResult:r}));
});
test('identity orientation cannot be claimed merely from a structural source field',()=>{
 const f=fixture();for(const field of ['fixturePngComplete','sourceExactFixtureProducerMatch','parentExactProducerMatch','normalizedPngComplete']){const r=binaryFixture(f.value);r.checks[field]='unknown';rejects(()=>binary(r,f.value));}
});
test('strict before input preserves new provenance and is rejected by the old history validator',()=>{
 const f=fixture(),r=createReport({task:f.value,checks:all()}),out=buildInput({task:f.value,report:r});assert.equal(out.schemaVersion,'design-normalized-strict-input-v1');assert.equal(out.stage,'before');assert.equal(out.angle,'front');assert.equal(out.verificationReportDigest,digest(r));assert.deepEqual(input(out,{task:f.value,report:r}),out);assert.throws(()=>validateManagedViewHistoryInput(out));assert.equal(Object.hasOwn(out,'response'),false);assert.equal(Object.hasOwn(out,'imageBinding'),false);frozen(out);
});
test('after/reference/detail cannot enter this single before-view input lane',()=>{
 for(const options of [{stage:'after'},{stage:'reference'},{angle:'detail'}]){const f=fixture(options);task(f.value);const r=createReport({task:f.value,checks:all()});rejects(()=>buildInput({task:f.value,report:r}));}
 for(const angle of ['front','back','left','right']){const f=fixture({angle}),r=createReport({task:f.value,checks:all()});assert.equal(buildInput({task:f.value,report:r}).angle,angle);}
});
test('changed input summary or borrowed self-claimed complete report is not accepted',()=>{
 const f=fixture(),r=createReport({task:f.value,checks:all()}),i=buildInput({task:f.value,report:r});for(const patch of [{taskId:'other'},{angle:'left'},{maxEdge:1536},{verificationReportDigest:'0'.repeat(64)},{submissionAuthorized:true},{bytes:'raw-private-content'}])rejects(()=>input({...i,...patch},{task:f.value,report:r}));
});
test('proxies, inherited toJSON, accessors and hidden fields never execute',()=>{
 const f=fixture();let calls=0;const proxy=new Proxy(f.value,{get(){calls++;},ownKeys(){calls++;}});rejects(()=>task(proxy));const v=clone(f.value);Object.defineProperty(v.policy,'id',{enumerable:true,get(){calls++;return POLICY.id;}});rejects(()=>task(v));
 const r=createReport({task:f.value,checks:all()}),bad=clone(r);Object.setPrototypeOf(bad.checks,{toJSON(){calls++;}});rejects(()=>report(bad,f.value));const hidden=clone(f.value);Object.defineProperty(hidden,'secret',{value:'x'});rejects(()=>task(hidden));assert.equal(calls,0);
});
test('all validated results are snapshots, deeply frozen and cannot change old original bytes',()=>{
 const f=fixture(),original=JSON.stringify(f.value),originalDigest=digest(f.value),t=task(f.value),r=createReport({task:t,checks:all()});assert.equal(JSON.stringify(f.value),original);f.value.verifier.id='mutated';assert.equal(t.verifier.id,VERIFIER.id);frozen(t);frozen(r);assert.equal(digest(t),originalDigest);assert.equal(t.claimedArtifact.artifact.validation.fullDecode,'not_verified');
});
test('missing checks, invalid booleans, numeric string/NaN/fraction and default success are rejected',()=>{
 const f=fixture();for(const v of [true,false,null,1,'complete','not_verified'])rejects(()=>createReport({task:f.value,checks:{...all(),metadataAbsent:v}}));const c=all();delete c.fixturePngComplete;rejects(()=>createReport({task:f.value,checks:c}));
 for(const val of ['100',NaN,Infinity,1.1,-0]){const r=binaryFixture(f.value);r.normalized.compressedBytes=val;rejects(()=>binary(r,f.value));}
});
