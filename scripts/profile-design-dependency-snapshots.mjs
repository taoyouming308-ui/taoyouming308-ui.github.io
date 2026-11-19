/** Offline attribution ONLY. Reads the exact synthetic Stage21 failure bundle.
 * No database, network, credentials, fixture rewriting or production-source edits.
 * The in-memory instrumented copy is compared against the unchanged validator.
 * The bounded derived-snapshot prototype is NOT an authorization/runtime cache.
 */
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {validateAuthorizedDependencyBundle,createImmutableDependencyRepository} from '../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {validatePreparedWorkflowRecord,runPreparedRecordValidationScope} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {policyEqual} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';

assert.deepEqual(process.argv.slice(2),['--synthetic-profile'],'Explicit offline synthetic profile opt-in required');
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const filename='/tmp/stage21-synthetic-history-bundle.json',MAX_INPUT=4*1024*1024;
assert(statSync(filename).isFile());assert(statSync(filename).size<=MAX_INPUT);
const wire=readFileSync(filename,'utf8'),input=JSON.parse(wire);
assert.deepEqual(Object.keys(input).sort(),['authority','bundle','syntheticOnly']);
assert.equal(input.syntheticOnly,true);
const b=input.bundle,authority=input.authority;
assert(b.workflowRows.length>0&&b.workflowRows.length<=64);
assert(b.fullRows.length>0&&b.fullRows.length<=3);
assert.equal(b.manifest,null,'This exact diagnostic capture has no expiring manifest; do not rewrite one to profile');
const bundleWire=JSON.stringify(b),sha=s=>createHash('sha256').update(s).digest('hex'),round=n=>Math.round(n*1000)/1000;
const result={schemaVersion:'synthetic-dependency-snapshot-profile-v1',inputBytes:Buffer.byteLength(wire),inputSha256:sha(wire),
 shape:{workflowRows:b.workflowRows.length,workflowRevision:b.workflowRows.at(-1).record.revision,nativeRevision:b.workflowRows.at(-1).record.session.revision,fullVersions:b.fullRows.length,fullNativeRevisions:b.fullRows.map(v=>v.record.snapshot.evidence.session.revision),photoRefs:b.workflowRows.at(-1).record.photoRefs.length,acceptedCandidates:b.workflowRows.at(-1).record.modelCandidates?.length??0},
 limits:['Exact captured 24-native/one-full failure shape; NOT evidence for 32-native/three-full acceptance.',
  'Whole validator, matching and snapshot build are nested inclusive timings; never add them.',
  'Difference whole-minus-matching includes all remaining validation/copy/hash/equality work, not only native replay.',
  'The in-memory profiling module changes counters/timers only and must equal the unmodified production validator.',
  'Prototype measures matching plus existing record revalidation only; it is not an optimized whole-runtime result.',
  'No authority, bundle, source, TTL, expiry or SQL result is cached. No database/access acceptance is claimed.',
  'Two warm repeats are a bounded diagnostic, not production latency or statistical confidence.']};
const deadline=performance.now()+30000;
const pureRequest={credential:'SYNTHETIC_PROFILE_REQUEST_0123456789',scope:authority.scope};
const controlBridge=createImmutableDependencyRepository({enabled:true});
function budget(){assert(performance.now()<deadline,'Bounded pure diagnostic exhausted; no larger workload or retry');}
function deeplyFrozen(v){return v===null||typeof v!=='object'||Object.isFrozen(v)&&Object.values(v).every(deeplyFrozen);}

// Independent unchanged-validator control, in its own normal request-local scope.
budget();let expected;
await runPreparedRecordValidationScope(()=>controlBridge.runRequest(pureRequest,()=>{const start=performance.now();expected=validateAuthorizedDependencyBundle(JSON.parse(bundleWire),authority);result.controlWholeMs=round(performance.now()-start);}));
assert.equal(JSON.stringify(expected),bundleWire,'Original whole validation must preserve every captured byte/order');

// Fixed-anchor in-memory instrumentation, never written over a production file.
const moduleURL=new URL('../packages/design-production-adapter/immutable-dependency-repository.mjs',import.meta.url);
const source=readFileSync(moduleURL,'utf8');result.productionSourceSha256=sha(source);
function once(text,from,to){assert.equal(text.split(from).length-1,1,'Profiling anchor changed: review rather than silently instrument another expression');return text.replace(from,to);}
let profiled=source;
const derivedProduct=source.includes('checkedRecords.some(r=>equal(r.snapshot(),v.snapshot))');
result.productDerivedMemoActive=derivedProduct;
if(derivedProduct){
 profiled=once(profiled,'if(proof)checkedRecords.push(proof);','if(proof)checkedRecords.push(proof);__observeRecord(r);');
 profiled=once(profiled,'checkedRecords.some(r=>equal(r.snapshot(),v.snapshot))','__profileMatch(checkedRecords,v.snapshot)');
}else{
 profiled=once(profiled,'const r=validatePreparedWorkflowRecord(row.record,a.scope);','const r=validatePreparedWorkflowRecord(row.record,a.scope);__observeRecord(r);');
 profiled=once(profiled,'b.workflowRows.some(r=>equal(snapshotOf(r.record),v.snapshot))','__profileMatch(b.workflowRows,v.snapshot)');
}
const snapshotLine=source.split('\n').find(line=>line.startsWith('const snapshotOf=r=>'));
assert(snapshotLine?.endsWith(';'));
const snapshotExpression=snapshotLine.slice('const snapshotOf=r=>'.length,-1);
profiled=once(profiled,snapshotLine,`const snapshotOf=r=>{const start=performance.now();try{return ${snapshotExpression};}finally{__trace.snapshotCalls++;__trace.snapshotBuildMs+=performance.now()-start;}};`);
profiled=profiled.replace(/from '(\.\.?\/[^']+)'/g,(_,path)=>`from '${new URL(path,moduleURL).href}'`);
profiled+=`
let __trace=null;const __seen=new WeakSet();
function __observeRecord(record){if(__seen.has(record))__trace.reusedValidatedRecords++;else{__seen.add(record);__trace.newValidatedRecords++;}}
function __profileMatch(rows,snapshot){const start=performance.now();let at=-1;try{return rows.some((row,index)=>{__trace.comparisons++;const same=equal(${derivedProduct?'row.snapshot()':'snapshotOf(row.record)'},snapshot);if(same)at=index;return same;});}finally{__trace.matchingMs+=performance.now()-start;__trace.matchIndices.push(at);}}
export function __profileOnce(input,authority){__trace={matchingMs:0,snapshotBuildMs:0,snapshotCalls:0,comparisons:0,newValidatedRecords:0,reusedValidatedRecords:0,matchIndices:[]};const start=performance.now();const value=validateAuthorizedDependencyBundle(input,authority);return {value,trace:{...__trace,wholeMs:performance.now()-start}};}
`;
const instrumented=await import('data:text/javascript;base64,'+Buffer.from(profiled).toString('base64'));
result.wholeTrials=[];
const instrumentedBridge=instrumented.createImmutableDependencyRepository({enabled:true});
await runPreparedRecordValidationScope(()=>instrumentedBridge.runRequest(pureRequest,()=>{
 for(let i=0;i<3;i++){
  budget();const {value,trace}=instrumented.__profileOnce(JSON.parse(bundleWire),authority);
  assert.equal(JSON.stringify(value),bundleWire);assert.deepEqual(value,expected);
  result.wholeTrials.push({pass:i===0?'cold':'warm-'+i,...Object.fromEntries(Object.entries(trace).map(([k,v])=>[k,typeof v==='number'?round(v):v])),outsideMatchingMs:round(trace.wholeMs-trace.matchingMs),matchingOutsideSnapshotBuildMs:round(trace.matchingMs-trace.snapshotBuildMs)});
 }
}));

// A local prototype consumes ONLY successful, deeply-frozen output of the real
// record validator. Keys are object identities, never hashes, aliases or bundles.
// Its map is created and destroyed inside one existing validation request scope.
result.prototypeMatchingOnly=[];
await runPreparedRecordValidationScope(()=>{
 const memo=new Map();let retainedBytes=0;const MAX_ENTRIES=64,MAX_BYTES=16*1024*1024;
 try{
  for(let i=0;i<3;i++){
   budget();const fresh=JSON.parse(bundleWire),recordStart=performance.now();
   const records=fresh.workflowRows.map(row=>validatePreparedWorkflowRecord(row.record,authority.scope));
   const recordRevalidationMs=performance.now()-recordStart;
   let hits=0,builds=0,fallbacks=0,buildMs=0,admissionMs=0,comparisons=0;const matches=[];
   const derived=record=>{
    if(memo.has(record)){hits++;return memo.get(record);}
    const start=performance.now();
    const snapshot=createFullWorkflowSnapshot({scope:record.scope,store:record.store,bindings:{uiScope:null,evidenceScope:record.session.scope},ui:null,evidence:{session:record.session,archives:record.archives},legacyVersions:record.legacyVersions,photoRefs:record.photoRefs,...(record.modelCandidates?{modelCandidates:record.modelCandidates}:{})});
    builds++;buildMs+=performance.now()-start;
    const checkStart=performance.now();assert(deeplyFrozen(record));assert(deeplyFrozen(snapshot));
    // Count both key record and derived snapshot retention conservatively.
    const bytes=Buffer.byteLength(JSON.stringify(record))+Buffer.byteLength(JSON.stringify(snapshot));
    if(memo.size<MAX_ENTRIES&&bytes<=MAX_BYTES-retainedBytes){memo.set(record,snapshot);retainedBytes+=bytes;}else fallbacks++;
    admissionMs+=performance.now()-checkStart;return snapshot;
   };
   const start=performance.now();
   for(const full of fresh.fullRows){let matched=-1;const found=records.some((record,index)=>{comparisons++;const same=policyEqual(derived(record),full.record.snapshot);if(same)matched=index;return same;});assert(found);matches.push(matched);}
   const matchingMs=performance.now()-start;
   assert.deepEqual(matches,result.wholeTrials[i].matchIndices);
   result.prototypeMatchingOnly.push({pass:i===0?'cold':'warm-'+i,recordRevalidationMs:round(recordRevalidationMs),matchingMs:round(matchingMs),snapshotBuildMs:round(buildMs),cacheAdmissionMs:round(admissionMs),hits,builds,fallbacks,comparisons,matchIndices:matches,retainedEntries:memo.size,retainedBytes});
  }
 }finally{memo.clear();retainedBytes=0;}
});
assert.equal(readFileSync(filename,'utf8'),wire,'Synthetic input must not change');
assert.equal(readFileSync(moduleURL,'utf8'),source,'Production source must not change');
result.inputAndProductionSourceUnchanged=true;
console.log(JSON.stringify(result,null,2));
