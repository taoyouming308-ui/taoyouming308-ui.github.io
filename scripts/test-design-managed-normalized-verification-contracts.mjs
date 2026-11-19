/** Synthetic protocol data only; no actual decoder, issuer, SQL, bytes or I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import {managedImageDigest as digest,createManagedImageCandidate} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from '../packages/design-production-adapter/managed-image-verification.mjs';
import {
 MANAGED_NORMALIZED_OBJECT_SCHEMA,MANAGED_NORMALIZED_VERIFICATION_REPORT_SCHEMA,MANAGED_NORMALIZED_EVIDENCE_SCHEMA,
 MANAGED_NORMALIZED_VERIFICATION_CHECKS,ManagedNormalizedVerificationContractError,
 validateManagedNormalizedObjectReceipt as receipt,buildManagedNormalizedVerificationBinding as binding,
 validateManagedNormalizedVerificationReport as report
} from '../packages/design-production-adapter/managed-normalized-verification-contracts.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const copy=structuredClone;
function fixture({mime='image/jpeg',maxEdge=1024}={}){
 const old=managedImageResultFixture({mime,maxEdge}),artifact=createManagedImageNormalizationArtifact({requestId:'normalization-1',sourceRecord:old.sourceRecord,parentResponse:old.response,parentObjectReceipt:old.objectReceipt,output:{sha256:'f'.repeat(64),byteLength:100000,mime:'image/png',width:old.response.descriptor.requestedTransform.width,height:old.response.descriptor.requestedTransform.height}});
 const objectReceipt={schemaVersion:MANAGED_NORMALIZED_OBJECT_SCHEMA,artifactDigest:digest(artifact),object:{...old.sourceRecord.object,key:'managed-normalized/'+digest(artifact)+'/object',version:'normalized-v1'},output:copy(artifact.output),private:true,readbackVerified:true};
 const context={taskId:'independent-task-1',artifact,objectReceipt,verifier:{id:'synthetic-three-object-inspector',version:'fixture-v1'},policyVersion:'synthetic-normalized-policy-v1'};
 return {old,artifact,objectReceipt,context};
}
function makeReport(context,changes={}){
 const b=binding(context),checks={...Object.fromEntries(MANAGED_NORMALIZED_VERIFICATION_CHECKS.map(k=>[k,'verified'])),...changes},values=Object.values(checks),state=values.includes('failed')?'validation_failed':values.every(x=>x==='verified')?'evidence_complete':'pending_validation';
 return {schemaVersion:MANAGED_NORMALIZED_VERIFICATION_REPORT_SCHEMA,state,verificationBinding:b,checks,evidence:state==='evidence_complete'?{schemaVersion:MANAGED_NORMALIZED_EVIDENCE_SCHEMA,id:'normalized-verification-'+digest({binding:b,checks}),verificationBindingDigest:digest(b),verifier:copy(b.verifier),policyVersion:b.policyVersion,checks:copy(checks)}:null,submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false};
}
const rejects=fn=>assert.throws(fn,e=>e instanceof ManagedNormalizedVerificationContractError&&e.code==='MANAGED_NORMALIZED_VERIFICATION_INVALID'&&e.message===e.code&&e.outcome==='not_sent'&&e.retryable===false);
function frozen(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(frozen);}}
test('new receipt preserves the source/hosted versions and binds a distinct private PNG version',()=>{
 for(const mime of ['image/jpeg','image/webp']){const f=fixture({mime}),original=JSON.stringify(f);assert.deepEqual(receipt(f.objectReceipt,{artifact:f.artifact}),f.objectReceipt);const b=binding(f.context);assert.deepEqual(b.sourceObject,f.old.sourceRecord.object);assert.deepEqual(b.parentObject,f.old.objectReceipt.object);assert.deepEqual(b.normalizedObject,f.objectReceipt.object);assert.equal(new Set([b.sourceSha256,b.parentSha256,b.normalizedSha256]).size,3);assert.equal(b.output.mime,'image/png');assert.deepEqual(b.authority,f.artifact.authority);assert.deepEqual(b.scope,f.artifact.authority.scope);assert.equal(JSON.stringify(f),original);frozen(b);}
});
test('all three object digests and exact fixed normalization policy are in the verification binding',()=>{
 const f=fixture(),b=binding(f.context);assert.equal(b.artifactDigest,digest(f.artifact));assert.equal(b.sourceRecordDigest,digest(f.old.sourceRecord));assert.equal(b.parentResponseDigest,digest(f.old.response));assert.equal(b.parentObjectReceiptDigest,digest(f.old.objectReceipt));assert.equal(b.normalizedObjectReceiptDigest,digest(f.objectReceipt));assert.equal(b.normalizationPolicyDigest,digest(f.artifact.normalizationPolicy));assert.equal(b.taskId,f.context.taskId);assert.equal(b.requestId,f.artifact.requestId);assert.deepEqual(b.verifier,f.context.verifier);assert.equal(b.policyVersion,f.context.policyVersion);
});
test('same path as source or parent, other project/bucket and malformed private versions are rejected',()=>{
 const f=fixture();for(const patch of [{key:f.old.sourceRecord.object.key},{key:f.old.objectReceipt.object.key},{projectOrigin:'https://otherproject.supabase.co'},{bucket:'other-private'},{key:'../escape'},{key:'object?token=secret'},{version:''},{version:'https://secret.invalid'}]){const r=copy(f.objectReceipt);Object.assign(r.object,patch);rejects(()=>receipt(r,{artifact:f.artifact}));}
});
test('wrong artifact hash/output hash/dimensions/type and false storage assertions reject',()=>{
 const f=fixture();for(const change of [r=>r.artifactDigest='0'.repeat(64),r=>r.output.sha256='1'.repeat(64),r=>r.output.byteLength++,r=>r.output.width--,r=>r.output.mime='image/jpeg',r=>r.private=false,r=>r.readbackVerified=false,r=>r.output.extra=true]){const r=copy(f.objectReceipt);change(r);rejects(()=>receipt(r,{artifact:f.artifact}));}
});
test('strict unknown and failed states carry no complete evidence or implicit default success',()=>{
 const f=fixture();for(const name of MANAGED_NORMALIZED_VERIFICATION_CHECKS)for(const value of ['unknown','failed']){const r=makeReport(f.context,{[name]:value});assert.equal(report(r,f.context).state,value==='unknown'?'pending_validation':'validation_failed');assert.equal(r.evidence,null);const bad=copy(r);bad.evidence=makeReport(f.context).evidence;rejects(()=>report(bad,f.context));}
 const mixed=makeReport(f.context,{sourceBinding:'unknown',metadataRemoval:'failed'});assert.equal(report(mixed,f.context).state,'validation_failed');
});
test('complete structural report never grants trust/public access/submission/adoption or upgrades pending artifact',()=>{
 const f=fixture(),bytes=JSON.stringify(f.artifact),r=report(makeReport(f.context),f.context);assert.equal(r.state,'evidence_complete');assert.deepEqual([r.submissionAuthorized,r.adoptionAuthorized,r.publicEligible],[false,false,false]);assert.equal(Object.hasOwn(r,'trusted'),false);assert.equal(Object.hasOwn(r,'token'),false);assert.equal(JSON.stringify(f.artifact),bytes);assert.equal(f.artifact.state,'pending_validation');assert(Object.values(f.artifact.validation).every(x=>x==='not_verified'));frozen(r);
 // A fully self-consistent JSON may pass STRUCTURE. Only DB task/issuer
 // provenance and a current read may confer availability; there is no pure
 // API here that grants it, or claims to detect an otherwise identical forgery.
 assert.throws(()=>createManagedImageCandidate({sourceRecord:f.old.sourceRecord,response:f.old.response,evidence:r.evidence}));
});
test('expected task/verifier/policy are trusted context, never chosen by the presented report',()=>{
 const f=fixture(),r=makeReport(f.context);for(const patch of [{taskId:'other-task'},{verifier:{id:'old-two-object-inspector',version:'v1'}},{policyVersion:'old-two-object-v1'}])rejects(()=>report(r,{...f.context,...patch}));
 const spoof=copy(r);spoof.verificationBinding.verifier=f.old.verificationReport.verificationBinding.verifier;rejects(()=>report(spoof,f.context));
 for(const bad of [{...f.context,taskId:''},{...f.context,policyVersion:''},{...f.context,verifier:{id:'x',version:'v1',trusted:true}}])rejects(()=>binding(bad));
});
test('changing any immutable object version invalidates the previously built report',()=>{
 const f=fixture(),r=makeReport(f.context),next=copy(f.context);next.objectReceipt.object.version='normalized-v2';rejects(()=>report(r,next));assert.notDeepEqual(binding(next),binding(f.context));
 for(const change of [c=>c.artifact.sourceRecord.object.version='source-v2',c=>c.artifact.parentObjectReceipt.object.version='parent-v2',c=>c.artifact.authority.securityEpoch++,c=>c.artifact.sourceRecord.owner.membershipId='replacement-membership']){const c=copy(f.context);change(c);rejects(()=>report(r,c));}
});
test('source/hosted response/normalized artifact cannot be spliced across identities or source records',()=>{
 const f=fixture(),other=fixture({mime:'image/webp'});for(const patch of [{artifact:other.artifact},{objectReceipt:other.objectReceipt}])rejects(()=>binding({...f.context,...patch}));
 const bad=copy(f.context);bad.artifact.authority.subjectId='same-alias-new-person';rejects(()=>binding(bad));
});
test('old v1 receipt and report cannot upgrade into the three-object schema',()=>{
 const f=fixture();rejects(()=>receipt(f.old.objectReceipt,{artifact:f.artifact}));rejects(()=>report(f.old.verificationReport,f.context));
 assert.throws(()=>validateManagedDerivedObjectReceipt(f.objectReceipt,{sourceRecord:f.old.sourceRecord,response:f.old.response}));assert.throws(()=>validateManagedImageVerificationReport(makeReport(f.context),{sourceRecord:f.old.sourceRecord,response:f.old.response,objectReceipt:f.old.objectReceipt}));
 const oldBytes=JSON.stringify(f.old);validateManagedImageVerificationReport(f.old.verificationReport,{sourceRecord:f.old.sourceRecord,response:f.old.response,objectReceipt:f.old.objectReceipt});assert.equal(JSON.stringify(f.old),oldBytes);
});
test('false complete state or unsupported check values fail instead of being normalized to success',()=>{
 const f=fixture();for(const value of [true,false,null,'not_verified','complete',1]){const r=makeReport(f.context);r.checks.sourceBinding=value;rejects(()=>report(r,f.context));}
 for(const state of ['verified','unknown','failed','pending_validation','validation_failed']){const r=makeReport(f.context);r.state=state;rejects(()=>report(r,f.context));}
 for(const name of MANAGED_NORMALIZED_VERIFICATION_CHECKS){const r=makeReport(f.context);delete r.checks[name];rejects(()=>report(r,f.context));}
});
test('evidence digest/id/checks/verifier/schema are exact and cannot be reattached to other bindings',()=>{
 const f=fixture();for(const change of [e=>e.id='normalized-verification-'+'0'.repeat(64),e=>e.verificationBindingDigest='0'.repeat(64),e=>e.checks.parentBinding='unknown',e=>e.verifier.version='other',e=>e.policyVersion='other',e=>e.schemaVersion='design-managed-image-evidence-v1',e=>e.summary='verified by caller']){const r=makeReport(f.context);change(r.evidence);rejects(()=>report(r,f.context));}
});
test('proxies/accessors/hidden fields/toJSON never execute in report or context',()=>{
 const f=fixture(),r=makeReport(f.context);let calls=0;const proxy=new Proxy(r,{get(){calls++;throw Error('secret');},ownKeys(){calls++;throw Error('secret');}});rejects(()=>report(proxy,f.context));
 const context=copy(f.context);Object.defineProperty(context.verifier,'id',{enumerable:true,get(){calls++;return 'forged';}});rejects(()=>binding(context));
 const inherited=copy(r);Object.setPrototypeOf(inherited.checks,{toJSON(){calls++;return {};}});rejects(()=>report(inherited,f.context));
 const hidden=copy(r);Object.defineProperty(hidden,'hidden',{value:'secret'});rejects(()=>report(hidden,f.context));assert.equal(calls,0);
});
test('receipt and context are deeply copied and immutable; caller mutation cannot change a validated proof shape',()=>{
 const f=fixture(),r=makeReport(f.context),out=report(r,f.context),b=binding(f.context);f.context.verifier.id='mutated';r.checks.fullDecode='unknown';assert.equal(out.checks.fullDecode,'verified');assert.equal(b.verifier.id,'synthetic-three-object-inspector');frozen(out);frozen(receipt(f.objectReceipt,{artifact:f.artifact}));
});
test('fresh revocation/expiry are not claimed or cached by a pure validator; ad-hoc authorization fields reject',()=>{
 const f=fixture(),r=makeReport(f.context);for(const patch of [{active:true},{expiresAt:9999999999999},{authorized:true},{issuerSignature:'self-reported'},{credential:'synthetic-bearer'},{submissionAuthorized:true},{adoptionAuthorized:true},{publicEligible:true}])rejects(()=>report({...r,...patch},f.context));
 rejects(()=>binding({...f.context,active:true}));assert.equal(Object.hasOwn(report(r,f.context),'active'),false);
});
