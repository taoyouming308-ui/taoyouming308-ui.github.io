/** Offline cumulative workflow history profile. No database or provider invocation. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
import {createPreparedWorkflowRecord,applyPreparedWorkflowIntent,replayPreparedWorkflowIntentAgainstValidated,validatePreparedWorkflowRecord} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {DESIGN_CANDIDATE_SCHEMA,designCandidateDigest as digest,buildCompletionCandidateParts,buildSynthesisCandidateParts,buildSynthesisEvidence,validateDesignCandidate,validateSynthesisEvidence} from '../packages/analysis-engine/design-candidate.mjs';
import {reconstructCandidateSessionPrefix} from '../packages/analysis-engine/design-candidate-history.mjs';
import {syntheticSynthesisScope as scope,syntheticSynthesisActor as actor} from './fixtures/design-synthesis.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const round=n=>Math.round(n*1000)/1000,canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}',equal=(a,b)=>canonical(a)===canonical(b);
let record=createPreparedWorkflowRecord({scope,store:actor.store,session:createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'synthetic-history-profile'})});
const versions=[record],requests=[],candidates=new Map();
function dispatch(intent,mediaReferences=null,candidate=null){const request={requestId:'profile-'+(record.revision+1),expectedRevision:record.revision,intent};record=applyPreparedWorkflowIntent(record,request,mediaReferences,candidate);requests.push(request);versions.push(record);return record;}
function envelope(kind,extra,parts){const id=digest([kind,record.revision]);return {schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind,scope,store:actor.store,actor,sessionId:record.session.scope.sessionId,baseRevision:record.session.revision,inputDigest:digest(record.session),payloadDigest:'c'.repeat(64),model:kind==='completion_synthesis'?'server-deterministic':'synthetic-vision',promptVersion:'synthetic-history-v1',...extra,...parts(id)};}
function accept(candidate){candidates.set(candidate.id,candidate);dispatch({type:'accept_model_candidate',candidateId:candidate.id,selectedIndices:[0]},null,candidate);return candidate;}
function compare(angle,output){const sourceRefs=['before','after'].map(stage=>({mediaId:stage+'-'+angle,sourceSha256:'a'.repeat(64),derivativeSha256:'b'.repeat(64)}));return accept(envelope('completion_comparison',{sourceRefs,comparison:{beforeMediaId:sourceRefs[0].mediaId,afterMediaId:sourceRefs[1].mediaId,angle}},id=>buildCompletionCandidateParts({id,session:record.session,output,angle})));}
dispatch({type:'record_source',kind:'text',text:'合成计划杠甲，实际杠乙。'});
dispatch({type:'advance',phase:'proposal'});
dispatch({type:'create_group',zone:'top',service:'perm',side:'left'});
const placeholder=record.session.entries.at(-1),sourceId=record.session.sources[0].messageId;
dispatch({type:'record_technique',groupId:placeholder.groupId,field:'rod_type',track:'planned',value:'杠甲',sourceId,quote:'计划杠甲',replacesEntryId:placeholder.id});
dispatch({type:'advance',phase:'execution'});
dispatch({type:'record_technique',groupId:placeholder.groupId,field:'rod_type',track:'actual',value:'杠乙',sourceId,quote:'实际杠乙',replacesEntryId:null});
dispatch({type:'advance',phase:'completed_review'});
dispatch({type:'record_source',kind:'text',text:'合成人工完成观察。'});
dispatch({type:'record_review',field:'observed_result',value:'人工完成观察',sourceId:record.session.sources.at(-1).messageId,quote:'人工完成观察',replacesEntryId:null});
for(const angle of ['front','back','left'])for(const stage of ['before','after']){const mediaId=stage+'-'+angle;dispatch({type:'attach_media',mediaIds:[mediaId]},[{mediaId,stage,angle,mime:'image/png',byteLength:80,width:3,height:2}]);}
const front=compare('front',{comparability:'comparable',reason:null,change:'卷曲形态看起来更明显'});
dispatch({type:'confirm_entry',entryId:front.candidate.entries[0].id,text:front.candidate.entries[0].value});
const evidence=buildSynthesisEvidence({...record,side:'left'});assert.equal(evidence.synthesis.generation,'deterministic');accept(envelope('completion_synthesis',evidence,id=>buildSynthesisCandidateParts({id,session:record.session,synthesis:evidence.synthesis})));
dispatch({type:'archive'});dispatch({type:'reopen',resumePhase:'completed_review',reason:'合成新增角度复核'});
compare('back',{comparability:'comparable',reason:null,change:'卷曲形态看起来较不明显'});
compare('left',{comparability:'not_comparable',reason:'光线差异',change:null});
const wire=JSON.stringify(versions),hashes=versions.map(digest),receiptKeys=requests.map(request=>digest([actor,request.requestId]));
function cumulative(){const times={};function phase(name,fn){const start=performance.now();try{return fn();}finally{times[name]=(times[name]??0)+performance.now()-start;}}
 const start=performance.now(),rows=phase('jsonDecodeClone',()=>JSON.parse(wire));let previous=null;
 for(let i=0;i<rows.length;i++){
  const current=phase('validateRecord',()=>validatePreparedWorkflowRecord(rows[i],scope));
  phase('hashChain',()=>{assert.equal(current.revision,i);assert.equal(digest(current),hashes[i]);if(previous)assert.equal(digest(previous),hashes[i-1]);});
  if(previous){const request=requests[i-1],accepted=request.intent.type==='accept_model_candidate'?current.modelCandidates.at(-1):null;
   if(accepted)phase('acceptedArtifactValidation',()=>{const candidate=candidates.get(accepted.candidate.id),base=reconstructCandidateSessionPrefix(current.session,candidate.baseRevision);validateDesignCandidate(candidate,base);validateSynthesisEvidence({candidate,session:base,modelCandidates:current.modelCandidates});assert(equal(candidate,accepted.candidate));assert.equal(receiptKeys[i-1],digest([candidate.actor,accepted.acceptance.requestId]));});
   const refs=request.intent.type==='attach_media'?current.photoRefs.slice(previous.photoRefs.length).map(p=>p.reference):null;
   const replay=phase('applyIntentReplay',()=>replayPreparedWorkflowIntentAgainstValidated({prior:previous,request,mediaReferences:refs,trustedCandidate:accepted?.candidate,expected:current}));phase('canonicalEquality',()=>assert(equal(replay,current)));
  }previous=current;
 }return {totalMs:round(performance.now()-start),exclusiveStagesMs:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,round(v)]))};}
const trials=[];for(let i=0;i<3;i++)trials.push(cumulative());
console.log(JSON.stringify({mode:'synthetic-cumulative-history-no-db',workflowVersions:versions.length,lastWorkflowRevision:record.revision,nativeRevision:record.session.revision,latestBytes:Buffer.byteLength(JSON.stringify(record)),cumulativeBytes:Buffer.byteLength(wire),nativeArchives:record.archives.length,acceptedCandidates:record.modelCandidates.length,mediaRefs:record.photoRefs.length,trials,limits:['Mirrors repository history record validation, accepted-artifact prefix verification, intent replay, hash/equality and JSON copy. All measured stages are mutually exclusive.','Includes manual planned/actual fields, human review, six refs, confirmed front, accepted local synthesis, archive/reopen, then back and left.','Does not measure SQL/locks, employee/media access, candidate metadata decoding, receipt query framing, full-archive DB versions or entire runtime orchestration.','One cumulative history scan is not the whole request; multiply only by measured actual scan counts, not by guesses.']},null,2));
