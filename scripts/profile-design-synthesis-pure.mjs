/** Bounded, offline synthesis attribution. Synthetic inputs; no PG, files, keys or network. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {syntheticSynthesisWorkflow,syntheticSynthesisActor as actor} from './fixtures/design-synthesis.mjs';
import {appendDesignEvent,validateDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
import {validateAcceptedCandidateHistory} from '../packages/analysis-engine/design-candidate-history.mjs';
import {validateSynthesisContext,designCandidateDigest,buildSynthesisEvidence} from '../packages/analysis-engine/design-candidate.mjs';
import {validatePreparedWorkflowRecord,PREPARED_MODEL_RECORD_SCHEMA} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createDesignCandidateAdapters} from '../packages/design-production-adapter/design-candidate-provider.mjs';
import {createDesignCandidateService} from '../packages/design-production-adapter/candidate-service.mjs';
import {createInMemoryProviderAttemptStore} from '../packages/design-production-adapter/provider-adapter.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const round=n=>Math.round(n*1000)/1000;
function recordAt(revision){
 const workflow=syntheticSynthesisWorkflow();
 while(workflow.session.revision<revision){const n=workflow.session.revision;workflow.session=appendDesignEvent(workflow.session,{requestId:'profile-source-'+n,scope:workflow.session.scope,expectedRevision:n,event:{type:'source_recorded',source:{messageId:'profile-source-'+n,kind:'text',actor:'employee',text:'Synthetic profiling source '+n}}}).session;}
 return {...workflow,schemaVersion:PREPARED_MODEL_RECORD_SCHEMA,revision,archives:[],legacyVersions:[]};
}
function micro(record){
 const result={};
 for(const [name,fn] of Object.entries({session:()=>validateDesignSession(record.session),acceptedHistory:()=>validateAcceptedCandidateHistory(record),preparedRecord:()=>validatePreparedWorkflowRecord(record,record.scope),synthesisEvidence:()=>buildSynthesisEvidence({...record,side:'left'})})){
  fn();const samples=[];for(let i=0;i<10;i++){const start=performance.now();fn();samples.push(performance.now()-start);}
  result[name]={runs:samples.length,totalMs:round(samples.reduce((a,b)=>a+b,0)),maxMs:round(Math.max(...samples))};
 }return result;
}
async function chain(record){
 const stats={};let activeDepth=0,dependencyUnionMs=0,providerCalls=0;
 // Wrapper time is inclusive. Only outermost intervals contribute to dependency
 // union, so parent/child measurements are never naively summed as CPU time.
 function timed(name,fn){return async(...args)=>{const outer=activeDepth++===0,start=performance.now();try{return await fn(...args);}finally{const elapsed=performance.now()-start;activeDepth--;if(outer)dependencyUnionMs+=elapsed;const row=stats[name]??={calls:0,inclusiveMs:0};row.calls++;row.inclusiveMs+=elapsed;}};}
 const scope=record.scope,credential='SYNTHETIC_PROFILE_TOKEN',model='synthetic-approved-model';
 const permissionGate={authorize:timed('employeeGate',async()=>({actor,scope}))};
 const synthesisVerifier=timed('synthesisVerifier',async input=>validateSynthesisContext({...input,session:record.session,modelCandidates:record.modelCandidates}));
 const mediaVerifier=timed('mediaVerifier',async()=>true);
 const adapters=createDesignCandidateAdapters({enabled:true,modelConfig:{approved:true,model,maxTokens:512},approvedTextModels:[model],permissionGate,
  sessionVerifier:timed('sessionVerifier',async input=>input.inputDigest===designCandidateDigest(record.session)),synthesisVerifier,mediaVerifier,
  attemptStore:createInMemoryProviderAttemptStore({testOnly:true}),
  keyResolver:timed('keyResolver',async(_,use)=>use('SYNTHETIC_PROFILE_KEY')),
  processingGate:timed('processingGate',async()=>true),
  transport:timed('mockTransport',async request=>{providerCalls++;const body=JSON.parse(request.body),input=JSON.parse(body.messages[1].content);assert.equal(body.model,model);assert(!request.body.includes('image_url'));return {url:request.url,redirected:false,status:200,headers:{'content-type':'application/json'},body:JSON.stringify({id:'synthetic-profile',object:'chat.completion',model,created:1,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({reviewFocus:input.allowedReviewFocus.at(-1)})}}]})};})});
 let saved;
 const service=createDesignCandidateService({enabled:true,permissionGate,adapters,synthesisVerifier,mediaVerifier,
  workflowService:{load:timed('workflowLoad',async()=>({record:structuredClone(record)}))},
  repository:{publish:timed('publish',async({candidate})=>{const replayed=Boolean(saved);if(saved)assert.deepEqual(candidate,saved);saved=candidate;return {candidate,replayed};}),load:async()=>({candidate:saved})}});
 const output={};
 for(const mode of ['generate','replay']){
  dependencyUnionMs=0;for(const key of Object.keys(stats))delete stats[key];const start=performance.now();const result=await service.synthesize({credential,scope,requestId:'synthetic-profile',side:'left'}),totalMs=performance.now()-start;
  assert.equal(result.candidate.kind,'completion_synthesis');assert.equal(result.candidate.synthesis.generation,'model_review_focus');assert.equal(providerCalls,1);assert.equal(result.replayed,mode==='replay');
  output[mode]={totalMs:round(totalMs),dependencyUnionMs:round(dependencyUnionMs),outsideWrappedDependenciesMs:round(totalMs-dependencyUnionMs),stages:Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,{calls:value.calls,inclusiveMs:round(value.inclusiveMs)}]))};
 }return output;
}
const output={mode:'synthetic-pure-no-pg',notes:['Timings are bounded observations, not latency thresholds.','Stage inclusive times overlap; do not add them. Union counts nested dependency intervals once.','Session revision is native evidence revision, not a PG workflow-version count.','Three accepted comparisons, six metadata refs and extra synthetic human sources; no prior archive or accepted synthesis, so this is not the full browser fixture.','Mock verifier measures pure context checks, not real identity/media/ancestor DB authority. No live authorization is bypassed or changed.'],profiles:[]};
for(const revision of [17,33]){const record=recordAt(revision);output.profiles.push({nativeRevision:revision,serializedBytes:Buffer.byteLength(JSON.stringify(record)),micro:micro(record),chain:await chain(record)});}
console.log(JSON.stringify(output,null,2));
