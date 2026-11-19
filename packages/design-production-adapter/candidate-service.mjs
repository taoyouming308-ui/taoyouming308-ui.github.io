/** Server orchestration only: scoped authoritative inputs -> provider -> immutable candidate publication. */
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {DesignProviderError} from './provider-adapter.mjs';
import {validateDesignSession} from '../analysis-engine/design-pilot.mjs';
import {validateDesignCandidate,designCandidateDigest,buildSynthesisEvidence,validateSynthesisEvidence} from '../analysis-engine/design-candidate.mjs';
import {reconstructCandidateSessionPrefix} from '../analysis-engine/design-candidate-history.mjs';
const codes=new Set(['CANDIDATE_SERVICE_DISABLED','CANDIDATE_SERVICE_INVALID','CANDIDATE_SERVICE_ACCESS_DENIED','CANDIDATE_SERVICE_SOURCE_CHANGED','CANDIDATE_SERVICE_MEDIA_DENIED','CANDIDATE_SERVICE_RESULT_INVALID','CANDIDATE_SERVICE_UNAVAILABLE','CANDIDATE_SERVICE_OUTCOME_UNCERTAIN']);
export class CandidateServiceError extends Error{constructor(code,outcome='not_sent'){super(codes.has(code)?code:'CANDIDATE_SERVICE_UNAVAILABLE');this.name='CandidateServiceError';this.code=this.message;this.outcome=outcome;this.retryable=false;}}
const fail=code=>{throw new CandidateServiceError(code);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('CANDIDATE_SERVICE_INVALID');};
const same=(a,b)=>designCandidateDigest(a)===designCandidateDigest(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v))fail('CANDIDATE_SERVICE_INVALID');return v;};
function verifyComparisonPhotos(candidate,photoRefs){
 if(candidate.kind==='completion_synthesis'){candidate.synthesis.evidence.forEach((e,i)=>verifyComparisonPhotos({kind:'completion_comparison',comparison:{beforeMediaId:candidate.sourceRefs[i*2]?.mediaId,afterMediaId:candidate.sourceRefs[i*2+1]?.mediaId,angle:e.angle}},photoRefs));return;}
 if(candidate.kind!=='completion_comparison')return;
 const p=candidate.comparison,b=photoRefs.find(x=>x.kind==='private_media'&&x.reference.mediaId===p.beforeMediaId)?.reference,a=photoRefs.find(x=>x.kind==='private_media'&&x.reference.mediaId===p.afterMediaId)?.reference;
 if(!b||!a||b.stage!=='before'||a.stage!=='after'||b.angle!==p.angle||a.angle!==p.angle||!['front','back','left','right'].includes(p.angle))fail('CANDIDATE_SERVICE_MEDIA_DENIED');
}
export function createDesignCandidateService({enabled=false,permissionGate,workflowService,privateMedia,adapters,repository,mediaVerifier,synthesisVerifier}={}){
 function ready(){if(enabled!==true||typeof permissionGate?.authorize!=='function'||typeof workflowService?.load!=='function'||typeof adapters?.extract!=='function'||typeof adapters?.describe!=='function'||typeof repository?.publish!=='function'||typeof repository?.load!=='function'||typeof mediaVerifier!=='function')fail('CANDIDATE_SERVICE_DISABLED');}
 async function authorize(credential,scope,expected){let grant;try{grant=await permissionGate.authorize(credential,scope);}catch{fail('CANDIDATE_SERVICE_ACCESS_DENIED');}if(!plain(grant)||!plain(grant.actor)||typeof grant.actor.username!=='string'||typeof grant.actor.store!=='string'||!same(grant.scope,scope)||expected&&!same(expected,grant.actor))fail('CANDIDATE_SERVICE_ACCESS_DENIED');return freeze(structuredClone({username:grant.actor.username,store:grant.actor.store}));}
 async function current(fixed,actor){const result=await workflowService.load({credential:fixed.credential,scope:fixed.scope});const record=result?.record;if(!plain(record)||!same(record.scope,fixed.scope)||record.store!==actor.store||!Array.isArray(record.photoRefs))fail('CANDIDATE_SERVICE_SOURCE_CHANGED');const session=validateDesignSession(record.session);if(session.scope.customerId!==fixed.scope.customerProfileId||session.scope.visitId!==fixed.scope.visitId)fail('CANDIDATE_SERVICE_SOURCE_CHANGED');await authorize(fixed.credential,fixed.scope,actor);return {record,session};}
 async function verify(fixed,actor,candidate,{generation=false}={}){
  const state=await current(fixed,actor);
  if(!same(candidate.actor,actor)||candidate.store!==actor.store||!same(candidate.scope,fixed.scope))fail('CANDIDATE_SERVICE_ACCESS_DENIED');
  const base=generation?state.session:reconstructCandidateSessionPrefix(state.session,candidate.baseRevision);
  try{validateDesignCandidate(candidate,base);validateSynthesisEvidence({candidate,session:base,modelCandidates:state.record.modelCandidates||[]});}catch{fail('CANDIDATE_SERVICE_SOURCE_CHANGED');}
  for(const ref of candidate.sourceRefs){if(!state.record.photoRefs.some(p=>p.kind==='private_media'&&p.reference.mediaId===ref.mediaId&&same(p.scope,fixed.scope)&&p.store===actor.store))fail('CANDIDATE_SERVICE_MEDIA_DENIED');}
  verifyComparisonPhotos(candidate,state.record.photoRefs);
  if(await mediaVerifier({credential:fixed.credential,scope:fixed.scope,actor,sourceRefs:candidate.sourceRefs})!==true)fail('CANDIDATE_SERVICE_MEDIA_DENIED');
  if(candidate.kind==='completion_synthesis'&&typeof synthesisVerifier!=='function')fail('CANDIDATE_SERVICE_ACCESS_DENIED');
  const latest=await current(fixed,actor);
  const finalBase=generation?latest.session:reconstructCandidateSessionPrefix(latest.session,candidate.baseRevision);
  try{validateDesignCandidate(candidate,finalBase);validateSynthesisEvidence({candidate,session:finalBase,modelCandidates:latest.record.modelCandidates||[]});}catch{fail('CANDIDATE_SERVICE_SOURCE_CHANGED');}
  for(const ref of candidate.sourceRefs){if(!latest.record.photoRefs.some(p=>p.kind==='private_media'&&p.reference.mediaId===ref.mediaId&&same(p.scope,fixed.scope)&&p.store===actor.store))fail('CANDIDATE_SERVICE_MEDIA_DENIED');}
  verifyComparisonPhotos(candidate,latest.record.photoRefs);
  // The composite repository check is last: it rechecks employee, ancestors and media
  // together after the final workflow read. Return is a verification-time snapshot.
  if(candidate.kind==='completion_synthesis'&&await synthesisVerifier({credential:fixed.credential,scope:fixed.scope,actor,sessionId:candidate.sessionId,baseRevision:candidate.baseRevision,inputDigest:candidate.inputDigest,synthesis:candidate.synthesis,sourceRefs:candidate.sourceRefs,...(!generation?{candidateId:candidate.id}:{})})!==true)fail('CANDIDATE_SERVICE_ACCESS_DENIED');
  return candidate;
 }
 async function perform(operation,input){
  ready();exact(input,operation==='load'?['credential','scope','candidateId']:operation==='synthesize'?['credential','scope','requestId','side']:operation==='compare'?['credential','scope','requestId','beforeMediaId','afterMediaId','approval']:operation==='vision'?['credential','scope','requestId','mediaId','approval']:['credential','scope','requestId']);
  let fixed;try{const {credential,...rest}=input;fixed={credential,...structuredClone(rest),scope:validateProductionDesignScope(rest.scope)};}catch{fail('CANDIDATE_SERVICE_INVALID');}
  id(operation==='load'?fixed.candidateId:fixed.requestId);if(operation==='vision'&&(typeof fixed.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(fixed.mediaId)))fail('CANDIDATE_SERVICE_INVALID');
  if(operation==='compare'&&([fixed.beforeMediaId,fixed.afterMediaId].some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))||fixed.beforeMediaId===fixed.afterMediaId||typeof adapters.compare!=='function'))fail('CANDIDATE_SERVICE_INVALID');
  if(operation==='synthesize'&&(!['left','right'].includes(fixed.side)||typeof adapters.synthesize!=='function'||typeof synthesisVerifier!=='function'))fail('CANDIDATE_SERVICE_INVALID');
  let generated=false;
  try{
   const actor=await authorize(fixed.credential,fixed.scope);
   if(operation==='load'){
    const result=await repository.load({credential:fixed.credential,scope:fixed.scope,candidateId:fixed.candidateId});exact(result,['candidate']);
    if(result.candidate?.id!==fixed.candidateId)fail('CANDIDATE_SERVICE_RESULT_INVALID');const candidate=structuredClone(result.candidate);
    await verify(fixed,actor,candidate);return freeze({candidate});
   }
   const state=await current(fixed,actor),request={credential:fixed.credential,scope:fixed.scope,requestId:fixed.requestId,session:state.session};
   if(operation==='synthesize'){const prepared=buildSynthesisEvidence({session:state.session,modelCandidates:state.record.modelCandidates||[],side:fixed.side});if(await synthesisVerifier({credential:fixed.credential,scope:fixed.scope,actor,sessionId:state.session.scope.sessionId,baseRevision:state.session.revision,inputDigest:designCandidateDigest(state.session),...prepared})!==true)fail('CANDIDATE_SERVICE_ACCESS_DENIED');request.side=fixed.side;request.modelCandidates=structuredClone(state.record.modelCandidates||[]);}
   if(operation==='compare'&&state.session.phase!=='completed_review')fail('CANDIDATE_SERVICE_INVALID');
   if(operation==='vision'||operation==='compare'){
    const ids=operation==='compare'?[fixed.beforeMediaId,fixed.afterMediaId]:[fixed.mediaId],refs=ids.map(mediaId=>state.record.photoRefs.find(p=>p.kind==='private_media'&&p.reference.mediaId===mediaId&&same(p.scope,fixed.scope)&&p.store===actor.store));
    if(refs.some(r=>!r)||typeof privateMedia?.read!=='function')fail('CANDIDATE_SERVICE_MEDIA_DENIED');
    if(operation==='compare')verifyComparisonPhotos({kind:'completion_comparison',comparison:{beforeMediaId:fixed.beforeMediaId,afterMediaId:fixed.afterMediaId,angle:refs[0].reference.angle}},state.record.photoRefs);
    const loaded=[];
    for(let i=0;i<ids.length;i++){
     const media=await privateMedia.read({credential:fixed.credential,scope:fixed.scope,mediaId:ids[i],approval:fixed.approval});
     if(!same(media?.reference,refs[i].reference)||!(media.bytes instanceof Uint8Array)||media.cacheControl!=='private, no-store'||media.maxAgeSeconds!==0)fail('CANDIDATE_SERVICE_MEDIA_DENIED');
     const latest=await current(fixed,actor);if(!same(latest.session,state.session)||!same(latest.record.photoRefs,state.record.photoRefs))fail('CANDIDATE_SERVICE_SOURCE_CHANGED');
     loaded.push({reference:structuredClone(media.reference),bytes:Uint8Array.from(media.bytes)});
    }
    request.media=operation==='compare'?loaded:loaded[0];
   }
   const result=await adapters[operation==='synthesize'?'synthesize':operation==='compare'?'compare':operation==='vision'?'describe':'extract'](request);generated=true;
   exact(result,['candidate','replayed']);if(typeof result.replayed!=='boolean')fail('CANDIDATE_SERVICE_RESULT_INVALID');
   const candidate=validateDesignCandidate(result.candidate,state.session),kind=operation==='synthesize'?'completion_synthesis':operation==='compare'?'completion_comparison':operation==='vision'?'visual_description':'text_extraction';
   if(candidate.kind!==kind||candidate.id!==designCandidateDigest([actor,fixed.requestId,kind])||operation==='vision'&&(candidate.sourceRefs.length!==1||candidate.sourceRefs[0].mediaId!==fixed.mediaId))fail('CANDIDATE_SERVICE_RESULT_INVALID');
   if(operation==='synthesize'&&candidate.synthesis.side!==fixed.side)fail('CANDIDATE_SERVICE_RESULT_INVALID');
   if(operation==='compare'&&(candidate.sourceRefs.length!==2||candidate.comparison.beforeMediaId!==fixed.beforeMediaId||candidate.comparison.afterMediaId!==fixed.afterMediaId))fail('CANDIDATE_SERVICE_RESULT_INVALID');
   await verify(fixed,actor,candidate,{generation:true});
   const published=await repository.publish({credential:fixed.credential,scope:fixed.scope,candidate});exact(published,['candidate','replayed']);
   if(typeof published.replayed!=='boolean'||!same(published.candidate,candidate))fail('CANDIDATE_SERVICE_RESULT_INVALID');
   await verify(fixed,actor,candidate,{generation:true});
   return freeze({candidate,replayed:result.replayed||published.replayed});
  }catch(error){
   if(generated)throw new CandidateServiceError('CANDIDATE_SERVICE_OUTCOME_UNCERTAIN','uncertain');
   if(error instanceof CandidateServiceError||error instanceof DesignProviderError)throw error;
   throw new CandidateServiceError('CANDIDATE_SERVICE_UNAVAILABLE');
  }
 }
 return Object.freeze({extract:input=>perform('extract',input),vision:input=>perform('vision',input),compare:input=>perform('compare',input),synthesize:input=>perform('synthesize',input),load:input=>perform('load',input)});
}
