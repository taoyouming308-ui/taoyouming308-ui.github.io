/** Synthetic metadata ONLY. No actual decoder, private store, issuer or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {managedImageDigest as digest,validateManagedImageResponse,createManagedImageCandidate} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from '../packages/design-production-adapter/managed-image-verification.mjs';
import {
 MANAGED_IMAGE_NORMALIZATION_SCHEMA,MANAGED_IMAGE_NORMALIZATION_POLICY,
 ManagedImageNormalizationContractError,createManagedImageNormalizationArtifact as build,
 validateManagedImageNormalizationArtifact as validate,managedImageNormalizationBinding as binding,
 validateManagedImageNormalizationParent as parent
} from '../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone;
function fixture({mime='image/jpeg',maxEdge=1024}={}){
 const f=managedImageResultFixture({mime,maxEdge}),q={requestId:'normalize-synthetic-1',sourceRecord:f.sourceRecord,parentResponse:f.response,parentObjectReceipt:f.objectReceipt,output:{sha256:'f'.repeat(64),byteLength:120000,mime:'image/png',width:f.response.descriptor.requestedTransform.width,height:f.response.descriptor.requestedTransform.height}};
 return {f,q,a:build(q)};
}
function rejects(fn){assert.throws(fn,e=>e instanceof ManagedImageNormalizationContractError&&e.message==='MANAGED_NORMALIZATION_CONTRACT_INVALID'&&e.code===e.message&&e.outcome==='not_sent'&&e.retryable===false);}
function frozen(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(frozen);}}
test('JPEG and WebP get an independent PNG pending artifact, never old verification',()=>{
 for(const mime of ['image/jpeg','image/webp']){const {q,a}=fixture({mime});assert.equal(a.schemaVersion,MANAGED_IMAGE_NORMALIZATION_SCHEMA);assert.equal(a.output.mime,'image/png');assert.equal(a.parentObjectReceipt.derivative.mime,mime);assert.equal(a.state,'pending_validation');assert(Object.values(a.validation).every(v=>v==='not_verified'));assert.deepEqual([a.submissionAuthorized,a.adoptionAuthorized,a.publicEligible],[false,false,false]);assert.equal(Object.hasOwn(a,'evidence'),false);assert.equal(Object.hasOwn(a,'decoded'),false);assert.equal(Object.hasOwn(a,'object'),false);assert.deepEqual(validate(a),a);frozen(a);assert.deepEqual(a.sourceRecord,q.sourceRecord);}
});
test('fixed decoder policy is pinned and cannot be selected by input or mutable caller data',()=>{
 const {q,a}=fixture();assert.equal(a.normalizationPolicy,MANAGED_IMAGE_NORMALIZATION_POLICY);assert.equal(a.normalizationPolicy.runtime.version,'3.8.0');assert.match(a.normalizationPolicy.runtime.imageDigest,/^sha256:[a-f0-9]{64}$/);assert.equal(a.normalizationPolicy.parentOrientation,'absent_or_identity');assert.equal(a.normalizationPolicy.resize,'none');assert.equal(a.normalizationPolicy.containerNormalization,'remove_pHYs_only');assert.equal(a.normalizationPolicy.outputPixelFormat,'rgb8_noninterlaced');assert.equal(a.normalizationPolicy.metadata,'strip_all');frozen(MANAGED_IMAGE_NORMALIZATION_POLICY);
 rejects(()=>build({...q,normalizationPolicy:MANAGED_IMAGE_NORMALIZATION_POLICY}));
 for(const change of [p=>p.runtime.version='latest',p=>p.runtime.imageDigest='sha256:'+'0'.repeat(64),p=>p.resize='contain',p=>p.metadata='retain_exif',p=>p.maximumFrames=2,p=>p.color='unchecked',p=>p.containerNormalization='retain_pHYs',p=>p.containerNormalization='remove_arbitrary_chunks',p=>p.outputPixelFormat='rgba16',p=>delete p.containerNormalization,p=>delete p.outputPixelFormat]){const bad=clone(a);change(bad.normalizationPolicy);rejects(()=>validate(bad));}
});
test('original source response receipt content and canonical hashes are retained, original wire order is unmodified',()=>{
 const {f,q}=fixture(),before=JSON.stringify({source:f.sourceRecord,response:f.response,receipt:f.objectReceipt}),a=build(q);
 const retained={source:a.sourceRecord,response:a.parentResponse,receipt:a.parentObjectReceipt};assert.deepEqual(retained,JSON.parse(before));assert.equal(digest(retained),digest(JSON.parse(before)));assert.equal(JSON.stringify({source:f.sourceRecord,response:f.response,receipt:f.objectReceipt}),before);
 validateManagedDerivedObjectReceipt(a.parentObjectReceipt,{sourceRecord:a.sourceRecord,response:a.parentResponse});validateManagedImageResponse(a.parentResponse,a.sourceRecord);
 const bad=clone(a.parentResponse);bad.descriptor.derivative={sha256:a.output.sha256,byteLength:a.output.byteLength,mime:'image/png'};assert.throws(()=>validateManagedImageResponse(bad,a.sourceRecord));
 assert.throws(()=>validateManagedDerivedObjectReceipt({...a.parentObjectReceipt,derivative:a.output},{sourceRecord:a.sourceRecord,response:a.parentResponse}));
});
test('parent-only validation is available before output and cannot establish verified orientation or bytes',()=>{
 const {q}=fixture(),p=parent({sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:q.parentObjectReceipt});
 assert.deepEqual(Object.keys(p).sort(),['sourceRecord','parentResponse','parentObjectReceipt','normalizationPolicy','maximumOutputBytes','expectedOutput'].sort());assert.equal(p.maximumOutputBytes,262144);assert.deepEqual(p.expectedOutput,{mime:'image/png',width:q.output.width,height:q.output.height});assert.equal(p.parentResponse.descriptor.validation.orientation,'not_verified');frozen(p);
 rejects(()=>parent({...q}));const changed=clone(q.parentObjectReceipt);changed.responseDigest='0'.repeat(64);rejects(()=>parent({sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:changed}));
});
test('new artifact cannot masquerade as an old complete report or input candidate',()=>{
 const {a,f}=fixture();assert.throws(()=>validateManagedImageVerificationReport(a,{sourceRecord:f.sourceRecord,response:f.response,objectReceipt:f.objectReceipt}));assert.throws(()=>createManagedImageCandidate({sourceRecord:f.sourceRecord,response:f.response,evidence:a}));
 const oldBytes=JSON.stringify(f.verificationReport);validateManagedImageVerificationReport(f.verificationReport,{sourceRecord:f.sourceRecord,response:f.response,objectReceipt:f.objectReceipt});assert.equal(JSON.stringify(f.verificationReport),oldBytes);
});
test('output dimensions equal already oriented parent dimensions, never a crop upsample or second resize',()=>{
 for(const maxEdge of [1024,1536]){const {q}=fixture({maxEdge});for(const patch of [{width:q.output.width-1},{height:q.output.height+1},{width:0},{width:maxEdge+1},{height:1.5}])rejects(()=>build({...q,output:{...q.output,...patch}}));}
});
test('new PNG respects exact existing 256/512KiB budgets, including one-byte boundary',()=>{
 for(const maxEdge of [1024,1536]){const {q}=fixture({maxEdge}),max=maxEdge===1024?262144:524288;assert.equal(build({...q,output:{...q.output,byteLength:max}}).output.byteLength,max);for(const n of [0,-1,max+1,NaN,Infinity,1.5,-0])rejects(()=>build({...q,output:{...q.output,byteLength:n}}));}
});
test('old parent limit is not expanded to the raw-source 8MiB allowance',()=>{
 const {q}=fixture();q.parentResponse.descriptor.derivative.byteLength=262145;q.parentObjectReceipt.derivative.byteLength=262145;q.parentObjectReceipt.responseDigest=digest(q.parentResponse);rejects(()=>build(q));
 const {q:source}=fixture();source.sourceRecord.source.byteLength=8*1024*1024+1;rejects(()=>build(source));
});
test('PNG input is outside this JPEG/WebP repair path; unknown and non-image MIME are rejected',()=>{
 assert.throws(()=>fixture({mime:'image/png'}),ManagedImageNormalizationContractError);
 const {q}=fixture();for(const mime of ['image/jpeg','image/webp','image/svg+xml','application/octet-stream'])rejects(()=>build({...q,output:{...q.output,mime}}));
});
test('three hashes and immutable source and parent versions remain independently bound',()=>{
 const {a}=fixture(),b=binding(a);assert.equal(b.artifactDigest,digest(a));assert.equal(b.sourceSha256,a.sourceRecord.source.sha256);assert.equal(b.parentSha256,a.parentObjectReceipt.derivative.sha256);assert.equal(b.output.sha256,a.output.sha256);assert.equal(new Set([b.sourceSha256,b.parentSha256,b.output.sha256]).size,3);
 assert.deepEqual(b.sourceObject,a.sourceRecord.object);assert.deepEqual(b.parentObject,a.parentObjectReceipt.object);assert.deepEqual(b.authority,a.sourceRecord.owner);assert.deepEqual(b.scope,a.sourceRecord.owner.scope);assert.equal(b.parentObjectReceiptDigest,digest(a.parentObjectReceipt));assert.equal(b.parentResponseDigest,digest(a.parentResponse));assert.equal(b.normalizationPolicyDigest,digest(a.normalizationPolicy));frozen(b);
});
test('source or parent substitution rejects rather than silently recomputing original evidence',()=>{
 const {q}=fixture();for(const change of [v=>v.sourceRecord.owner.subjectId='same-name-other',v=>v.sourceRecord.object.version='changed-source',v=>v.sourceRecord.source.sha256='c'.repeat(64),v=>v.parentResponse.sourceRecordDigest='d'.repeat(64),v=>v.parentObjectReceipt.responseDigest='d'.repeat(64),v=>v.parentObjectReceipt.derivative.sha256='d'.repeat(64),v=>v.parentObjectReceipt.object.key=v.sourceRecord.object.key]){const bad=clone(q);change(bad);rejects(()=>build(bad));}
});
test('task, parent-object version and output changes create different exact identities, not implicit verification',()=>{
 const {q,a}=fixture();for(const change of [v=>v.requestId='different-request',v=>v.parentObjectReceipt.object.version='different-parent-version',v=>v.output.sha256='e'.repeat(64)]){const next=clone(q);change(next);const b=build(next);assert.notEqual(b.id,a.id);assert.notEqual(binding(b).artifactDigest,binding(a).artifactDigest);assert.equal(b.state,'pending_validation');}
 // Structural constructors cannot prove a caller-chosen parent version exists.
 // The fixed authorized read/normalizer/final guard must establish that fact.
});
test('no self-issued complete state, metadata success, eligibility, arbitrary key or bearer field',()=>{
 const {a,q}=fixture();for(const patch of [{state:'evidence_complete'},{submissionAuthorized:true},{adoptionAuthorized:true},{publicEligible:true},{decoded:true},{metadataRemoved:true},{credential:'SYNTHETIC_SECRET'},{id:'normalization-'+'0'.repeat(64)}])rejects(()=>validate({...a,...patch}));
 for(const key of Object.keys(a.validation)){const bad=clone(a);bad.validation[key]='verified';rejects(()=>validate(bad));}
 rejects(()=>build({...q,output:{...q.output,object:{key:'caller-path'}}}));
});
test('data is safely copied before use and hidden getters proxies custom prototypes never execute',()=>{
 const {q,a}=fixture();q.output.sha256='1'.repeat(64);assert.equal(a.output.sha256,'f'.repeat(64));let calls=0;
 const bad=clone(q);Object.defineProperty(bad.output,'sha256',{enumerable:true,get(){calls++;return 'f'.repeat(64);}});rejects(()=>build(bad));
 rejects(()=>build(new Proxy(q,{get(){calls++;throw Error('secret');},ownKeys(){calls++;throw Error('secret');}})));
 const inherited=clone(a);Object.setPrototypeOf(inherited.output,{toJSON(){calls++;return {};}});rejects(()=>validate(inherited));assert.equal(calls,0);
});
test('strict exact schemas reject missing hidden cyclic and oversized values with sanitized errors',()=>{
 const {a,q}=fixture();for(const key of Object.keys(a)){const bad=clone(a);delete bad[key];rejects(()=>validate(bad));}
 const hidden=clone(q);Object.defineProperty(hidden,'secret',{value:'no log'});rejects(()=>build(hidden));const cycle=clone(q);cycle.output.self=cycle;rejects(()=>build(cycle));
 for(const requestId of ['', 'x'.repeat(101),'https://secret.invalid'])rejects(()=>build({...q,requestId}));
 for(const sha256 of ['A'.repeat(64),'f'.repeat(63),null,123])rejects(()=>build({...q,output:{...q.output,sha256}}));
});
