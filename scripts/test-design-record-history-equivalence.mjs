/** Regression oracle for removing duplicate accepted-history traversal. No runtime changes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {syntheticSynthesisWorkflow} from './fixtures/design-synthesis.mjs';
import {createDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../packages/analysis-engine/design-candidate.mjs';
import {createPreparedWorkflowRecord,validatePreparedWorkflowRecord,PREPARED_MODEL_RECORD_SCHEMA} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone;
const base=()=>clone({...syntheticSynthesisWorkflow(),schemaVersion:PREPARED_MODEL_RECORD_SCHEMA,revision:3,archives:[],legacyVersions:[]});
// This test-only oracle models ONLY the proposed replacement for the duplicate
// history check. The public validator still performs all current checks first.
// Future runtime refactor must pass the same cases without changing error codes.
function proposedHistoryBoundary(record){
 try{
  if(record.schemaVersion===PREPARED_MODEL_RECORD_SCHEMA&&(!Array.isArray(record.modelCandidates)||!record.modelCandidates.length||record.modelCandidates.length>1000))throw Error('invalid');
  const snapshot=createFullWorkflowSnapshot({scope:record.scope,store:record.store,bindings:{uiScope:null,evidenceScope:record.session.scope},ui:null,evidence:{session:record.session,archives:record.archives},photoRefs:record.photoRefs,legacyVersions:record.legacyVersions,...(record.schemaVersion===PREPARED_MODEL_RECORD_SCHEMA?{modelCandidates:record.modelCandidates}:{})});
  if(record.schemaVersion===PREPARED_MODEL_RECORD_SCHEMA)for(const row of snapshot.modelCandidates)if(row.acceptance.workflowRevision>record.revision)throw Error('future');
  return snapshot;
 }catch{throw Object.assign(Error('WORKFLOW_RECORD_INVALID'),{code:'WORKFLOW_RECORD_INVALID'});}
}
function denied(record){assert.throws(()=>validatePreparedWorkflowRecord(record,record.scope),e=>e.code==='WORKFLOW_RECORD_INVALID');assert.throws(()=>proposedHistoryBoundary(record),e=>e.code==='WORKFLOW_RECORD_INVALID');}
test('valid v2 preserves complete record bytes and canonical hash',()=>{const record=base(),before=JSON.stringify(record),hash=digest(record),actual=validatePreparedWorkflowRecord(record,record.scope);proposedHistoryBoundary(record);assert.equal(JSON.stringify(actual),before);assert.equal(digest(actual),hash);assert.equal(JSON.stringify(record),before);});
test('legacy v1 bytes and hash remain unchanged and gain no candidate lane',()=>{const seed=base(),record=createPreparedWorkflowRecord({scope:seed.scope,store:seed.store,session:createDesignSession({customerId:seed.scope.customerProfileId,visitId:seed.scope.visitId,sessionId:'synthetic-legacy-equivalence'})}),before=JSON.stringify(record);proposedHistoryBoundary(record);const actual=validatePreparedWorkflowRecord(record,record.scope);assert.equal(JSON.stringify(actual),before);assert.equal(digest(actual),digest(record));assert(!Object.hasOwn(actual,'modelCandidates'));});
test('future acceptance revision retains original safe error mapping',()=>{const record=base();record.modelCandidates.at(-1).acceptance.workflowRevision=record.revision+1;denied(record);});
test('malformed and empty model lanes retain original safe error mapping',()=>{for(const lane of [[],null,{},'synthetic', [null]]){const record=base();record.modelCandidates=lane;denied(record);}});
test('noninteger and malformed acceptance revisions remain rejected',()=>{for(const revision of [-1,1.5,'3',null,NaN]){const record=base();record.modelCandidates[0].acceptance.workflowRevision=revision;denied(record);}});
test('receipt and input hashes cannot be changed',()=>{for(const key of ['candidateDigest','inputDigest']){const record=base();record.modelCandidates[0].acceptance.receipt[key]='f'.repeat(64);denied(record);}});
test('model source provenance cannot become employee original words',()=>{const record=base();record.modelCandidates[0].candidate.descriptionSources[0].actor='employee';denied(record);});
test('original media hash and angle provenance remain bound',()=>{for(const mutate of [r=>{r.modelCandidates[0].candidate.sourceRefs[0].sourceSha256='f'.repeat(64);},r=>{r.photoRefs[0].reference.angle='back';},r=>{r.photoRefs[0].reference.stage='after';}]){const record=base();mutate(record);denied(record);}});
test('acceptance order and journal replay remain enforced',()=>{for(const mutate of [r=>{r.modelCandidates.reverse();},r=>{r.session.journal.at(-1).requestId='forged-synthetic';}]){const record=base();mutate(record);denied(record);}});
test('legacy artifact corruption is still rejected by full snapshot validation',()=>{const record=base();record.legacyVersions=[{id:'invalid-synthetic'}];denied(record);});

test('candidate row accessors and custom iterator never execute before rejection',()=>{for(const path of ['index','acceptance','revision','iterator']){const record=base();let reads=0;const get=()=>{reads++;throw Error('must not execute');};if(path==='index')Object.defineProperty(record.modelCandidates,'0',{enumerable:true,get});if(path==='acceptance')Object.defineProperty(record.modelCandidates[0],'acceptance',{enumerable:true,get});if(path==='revision')Object.defineProperty(record.modelCandidates[0].acceptance,'workflowRevision',{enumerable:true,get});if(path==='iterator')Object.defineProperty(record.modelCandidates,Symbol.iterator,{enumerable:true,value:()=>{reads++;throw Error('must not execute');}});denied(record);assert.equal(reads,0,path);}});
