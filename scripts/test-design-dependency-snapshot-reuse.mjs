/** Whole-bundle regression using original native/full contracts, no DB or I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
import {createPreparedWorkflowRecord,applyPreparedWorkflowIntent,runPreparedRecordValidationScope} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createFullWorkflowSnapshot,FULL_WORKFLOW_VERSION_SCHEMA} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {createImmutableDependencyRepository,validateAuthorizedDependencyBundle} from '../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {policyDigest as hash} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},credential='SYNTHETIC_SNAPSHOT_SCOPE_01234567890';
const actor={username:'synthetic',store:'synthetic-store'};
const authority={schemaVersion:'design-immutable-authority-v1',subjectId:'synthetic-subject',employmentId:'synthetic-employment',membershipId:'synthetic-membership',securityEpoch:1,membershipRevision:1,storeId:'synthetic-store-id',actor,scope,bindingRevision:'synthetic-binding'};
const clone=structuredClone;
const snapshot=r=>createFullWorkflowSnapshot({scope,store:actor.store,bindings:{uiScope:null,evidenceScope:r.session.scope},ui:null,evidence:{session:r.session,archives:r.archives},legacyVersions:[],photoRefs:[]});
function fixture(text='Synthetic exact original source'){
 const b={schemaVersion:'design-authorized-dependency-bundle-v1',authority:clone(authority),manifest:null,sourceFingerprint:'a'.repeat(64),workflowRows:[],workflowReceipts:[],legacyVersions:[],legacyPhotos:[],fullRows:[],fullReceipts:[],mediaRows:[],candidateRows:[],operationAuthors:[],dependencyAuthors:[]};
 let r=createPreparedWorkflowRecord({scope,store:actor.store,session:createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'synthetic-snapshot-reuse'})});
 function append(request=null){const prior=b.workflowRows.at(-1);if(request)r=applyPreparedWorkflowIntent(r,request);const digest=hash(r),key=request?hash([actor,request.requestId]):null;b.workflowRows.push({revision:r.revision,record:clone(r),sha256:digest,previous_sha256:prior?.sha256??null,receipt_key:key});b.operationAuthors.push({revision:r.revision,receiptKey:key,authority:clone(authority),recordSha256:digest,previousSha256:prior?.sha256??null,manifestId:null});if(request)b.workflowReceipts.push({request_key:key,record_sha256:digest,receipt:{fingerprint:hash({scope,...request}),scope:clone(scope),actor:clone(actor),appliedRevision:r.revision,request:clone(request)}});}
 append();append({requestId:'synthetic-source-a',expectedRevision:0,intent:{type:'record_source',kind:'text',text}});append({requestId:'synthetic-source-b',expectedRevision:1,intent:{type:'record_source',kind:'text',text:'Synthetic second source'}});
 function setFull(value){const base={schemaVersion:FULL_WORKFLOW_VERSION_SCHEMA,version:1,previous:null,scope:clone(scope),actor:clone(actor),requestId:'synthetic-full',createdAt:'2026-11-15T00:00:00.000Z',bindingRevision:'synthetic-binding',snapshot:value},version={...base,sha256:hash(base)},requestKey=hash([actor,base.requestId]);b.fullRows=[{version:1,record:version,sha256:version.sha256}];b.fullReceipts=[{request_key:requestKey,receipt:{requestKey,fingerprint:hash({actor,scope,requestId:base.requestId,expectedVersion:0,expectedParentDigest:null,snapshotSha256:value.sha256}),scope:clone(scope),version:1,sha256:version.sha256}}];b.dependencyAuthors=[{kind:'full',id:'1',authority:clone(authority),sha256:version.sha256,manifestId:null}];}
 setFull(snapshot(b.workflowRows[1].record));return {b,setFull};
}
async function withScope(work){const bridge=createImmutableDependencyRepository({enabled:true});return runPreparedRecordValidationScope(()=>bridge.runRequest({credential,scope},work));}
const checked=b=>validateAuthorizedDependencyBundle(clone(b),authority);
test('fresh whole bundles retain exact bytes/hashes/old archive through warm structural reuse',async()=>{
 const {b}=fixture(),wire=JSON.stringify(b);await withScope(()=>{for(let i=0;i<3;i++){const result=checked(b);assert.equal(JSON.stringify(result),wire);assert.equal(hash(result),hash(b));assert(Object.isFrozen(result.fullRows[0].record.snapshot));}});assert.equal(JSON.stringify(b),wire);
});
test('every fresh bundle still rejects modified record, full digest, receipt or immutable author',async()=>{
 const {b}=fixture();await withScope(()=>{checked(b);for(const change of [x=>x.workflowRows[1].record.session.sources[0].text='changed',x=>x.fullRows[0].sha256='0'.repeat(64),x=>x.fullReceipts[0].receipt.fingerprint='0'.repeat(64),x=>x.operationAuthors[2].authority.employmentId='replacement',x=>x.dependencyAuthors[0].authority.subjectId='replacement']){const bad=clone(b);change(bad);assert.throws(()=>checked(bad));}assert.deepEqual(checked(b),b);});
});
test('warm snapshots do not suppress manifest expiry or current-authority changes',async()=>{
 const {b}=fixture();b.manifest={id:'synthetic-manifest',revision:1,reader:clone(authority),baseWorkflowRevision:2,baseWorkflowSha256:b.workflowRows[2].sha256,sourceFingerprint:b.sourceFingerprint,expiresAt:Date.now()+60000,baseDependencyDigests:[{kind:'full',id:'1',sha256:b.fullRows[0].sha256}]};await withScope(()=>{checked(b);const expired=clone(b);expired.manifest.expiresAt=Date.now()-1;assert.throws(()=>checked(expired),e=>e.code==='IMMUTABLE_DEPENDENCY_DENIED');const replacement={...authority,securityEpoch:2};assert.throws(()=>validateAuthorizedDependencyBundle(clone(b),replacement));assert.deepEqual(checked(b),b);});
});
test('changed valid source history is independently validated and never returns prior snapshots',async()=>{
 const a=fixture('Synthetic source alpha').b,b=fixture('Synthetic source beta').b;await withScope(()=>{const first=checked(a),second=checked(b);assert.notEqual(first.fullRows[0].sha256,second.fullRows[0].sha256);assert.deepEqual(second,b);assert.equal(second.workflowRows[1].record.session.sources[0].text,'Synthetic source beta');});
});
test('valid self-consistent full snapshot without a matching native row is still denied',async()=>{
 const f=fixture();await withScope(()=>{checked(f.b);const last=f.b.workflowRows.at(-1).record,next=applyPreparedWorkflowIntent(last,{requestId:'synthetic-absent',expectedRevision:last.revision,intent:{type:'record_source',kind:'text',text:'Synthetic source absent from trusted rows'}});f.setFull(snapshot(next));assert.throws(()=>checked(f.b),e=>e.code==='IMMUTABLE_DEPENDENCY_CORRUPT');});
});
test('scope/source binding changes and raw accessors cannot use a populated derived cache',async()=>{
 const {b}=fixture();await withScope(()=>{checked(b);let reads=0;for(const kind of ['getter','proxy']){const bad=clone(b),record=bad.workflowRows[1].record;if(kind==='getter')Object.defineProperty(record,'session',{enumerable:true,get(){reads++;throw Error('not executed');}});else record.session=new Proxy(record.session,{ownKeys(){reads++;throw Error('not executed');}});assert.throws(()=>validateAuthorizedDependencyBundle(bad,authority));}assert.equal(reads,0);const wrong=clone(b);wrong.authority.scope.visitId='booking:102';assert.throws(()=>checked(wrong));});
});
test('no-full bundle keeps the original non-derived path; separate requests preserve results',async()=>{
 const {b}=fixture();b.fullRows=[];b.fullReceipts=[];b.dependencyAuthors=[];for(let i=0;i<2;i++)await withScope(()=>assert.deepEqual(checked(b),b));
});
test('different bridge instances isolate nested/concurrent derived scopes and restore outer validation',async()=>{
 const first=createImmutableDependencyRepository({enabled:true}),second=createImmutableDependencyRepository({enabled:true}),a=fixture('Synthetic bridge A').b,b=fixture('Synthetic bridge B').b,request={credential,scope};
 await runPreparedRecordValidationScope(()=>first.runRequest(request,async()=>{assert.deepEqual(checked(a),a);await second.runRequest(request,()=>assert.deepEqual(checked(b),b));assert.deepEqual(checked(a),a);}));
 let release;const paused=new Promise(r=>release=r);
 await runPreparedRecordValidationScope(()=>Promise.all([first.runRequest(request,async()=>{assert.deepEqual(checked(a),a);await paused;assert.deepEqual(checked(a),a);}),second.runRequest(request,()=>{assert.deepEqual(checked(b),b);release();})]));
});
