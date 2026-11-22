/** Server-only candidate generation, disabled by default; no source upload/network/credentials. */
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {createDeepSeekOperationRunner,validateProviderRequest,DEEPSEEK_CHAT_ENDPOINT,DesignProviderError,providerDigest} from './provider-adapter.mjs';
import {validateDesignSession,validateDesignPilotResult} from '../analysis-engine/design-pilot.mjs';
import {DESIGN_CANDIDATE_SCHEMA,designCandidateDigest,validateDesignCandidate,buildVisualCandidateParts,buildCompletionCandidateParts,buildSynthesisEvidence} from '../analysis-engine/design-candidate.mjs';
import {buildSynthesisCandidatePayload,synthesisChatContent} from './synthesis-candidate-payload.mjs';
import {buildDesignCompletionPrompt} from '../prompts/design-completion-image.mjs';
import {buildDesignImagePrompt} from '../prompts/design-image.mjs';
import {buildDesignExtractionPrompt} from '../prompts/design-extraction.mjs';
const clone=structuredClone;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>designCandidateDigest(a)===designCandidateDigest(b);
const fail=code=>{throw new DesignProviderError(code);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('INVALID_REQUEST');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const DESIGN_DERIVATIVE_MAX_BYTES=96*1024;
/** Independent metadata guard: only non-interlaced RGB/RGBA PNG, no ancillary chunks. Full decoder still required. */
export function validateDesignDerivative(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<45||bytes.length>DESIGN_DERIVATIVE_MAX_BYTES||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))fail('INVALID_CONTEXT');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,idat=false,end=false,count=0;
 while(offset+12<=bytes.length){const n=view.getUint32(offset),type=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(offset+12+n>bytes.length)fail('INVALID_CONTEXT');
  if(count++===0){if(type!=='IHDR'||n!==13||![2,6].includes(bytes[offset+17])||bytes[offset+16]!==8||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)fail('INVALID_CONTEXT');const w=view.getUint32(offset+8),h=view.getUint32(offset+12);if(w<1||h<1||w>2048||h>2048)fail('INVALID_CONTEXT');}
  else if(type==='IDAT'&&!end)idat=true;
  else if(type==='IEND'&&n===0&&idat){end=true;if(offset+12!==bytes.length)fail('INVALID_CONTEXT');}
  else fail('INVALID_CONTEXT');offset+=n+12;
 }
 if(!end||offset!==bytes.length)fail('INVALID_CONTEXT');return true;
}
export function createDesignCandidateAdapters(config={}){
 const modelConfig=config.modelConfig?clone(config.modelConfig):null;
 const approvedTextModels=Array.isArray(config.approvedTextModels)?[...config.approvedTextModels]:[],approvedVisionModels=Array.isArray(config.approvedVisionModels)?[...config.approvedVisionModels]:[];
 const chatContent=raw=>synthesisChatContent(raw,modelConfig.model);
 async function setup(request,extra,kind){
  if(config.enabled!==true)fail('ADAPTER_DISABLED');
  const fixed=validateProviderRequest(request,['session',...extra]);if(!/^[A-Za-z0-9_-]{1,80}$/.test(fixed.requestId))fail('INVALID_REQUEST');
  const models=['text_extraction','completion_synthesis'].includes(kind)?approvedTextModels:approvedVisionModels;
  if(kind!=='completion_synthesis'&&(!plain(modelConfig)||Object.keys(modelConfig).sort().join('|')!=='approved|maxTokens|model'||modelConfig.approved!==true||typeof modelConfig.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(modelConfig.model)||!Number.isSafeInteger(modelConfig.maxTokens)||modelConfig.maxTokens<1||modelConfig.maxTokens>8192||!models.includes(modelConfig.model)))fail('MODEL_NOT_APPROVED');
  let session;try{if(Buffer.byteLength(JSON.stringify(request.session))>524288)fail('INVALID_CONTEXT');session=validateDesignSession(clone(request.session));}catch{fail('INVALID_CONTEXT');}
  if(session.scope.customerId!==fixed.scope.customerProfileId||session.scope.visitId!==fixed.scope.visitId)fail('CONTEXT_SCOPE_MISMATCH');
  if(typeof config.permissionGate?.authorize!=='function'||kind!=='completion_synthesis'&&typeof config.processingGate!=='function'||typeof config.sessionVerifier!=='function')fail('ADAPTER_NOT_CONFIGURED');
  let initial;try{initial=await config.permissionGate.authorize(fixed.credential,fixed.scope);}catch{fail('ACCESS_DENIED');}
  if(!plain(initial?.actor)||!same(initial.scope,fixed.scope)||typeof initial.actor.username!=='string'||typeof initial.actor.store!=='string')fail('ACCESS_DENIED');
  const actor=freeze({username:initial.actor.username,store:initial.actor.store}),id=designCandidateDigest([actor,fixed.requestId,kind]),inputDigest=designCandidateDigest(session);
  const gate={async authorize(credential,scope){const grant=await config.permissionGate.authorize(credential,scope);if(!same(grant.actor,actor)||!same(grant.scope,fixed.scope)||await config.sessionVerifier({credential,scope,sessionId:session.scope.sessionId,baseRevision:session.revision,inputDigest})!==true)fail('ACCESS_DENIED');const latest=await config.permissionGate.authorize(credential,scope);if(!same(latest.actor,actor)||!same(latest.scope,fixed.scope))fail('ACCESS_DENIED');return latest;}};
  await gate.authorize(fixed.credential,fixed.scope);
  return {fixed,session,actor,id,inputDigest,gate,kind};
 }
 function envelope(c,{payloadDigest,promptVersion,sourceRefs=[],descriptionSources=[],candidate,comparison,synthesis}){return validateDesignCandidate({...(comparison?{comparison}:{}),...(synthesis?{synthesis}:{}),schemaVersion:DESIGN_CANDIDATE_SCHEMA,id:c.id,kind:c.kind,scope:c.fixed.scope,store:c.actor.store,actor:c.actor,sessionId:c.session.scope.sessionId,baseRevision:c.session.revision,inputDigest:c.inputDigest,payloadDigest,model:synthesis?.generation==='deterministic'?'server-deterministic':modelConfig.model,promptVersion,sourceRefs,descriptionSources,candidate},c.session);}
 async function processing(c,disclosure,sourceRefs=[]){if(await config.processingGate(freeze({...disclosure,candidateKind:c.kind,inputDigest:c.inputDigest,sourceRefs,maxOutputTokens:modelConfig.maxTokens,costAuthorizationRequired:disclosure.mayIncurCharge===true,dataProcessingAuthorizationRequired:true,purpose:c.kind==='completion_synthesis'?'accepted_angle_ai_judgment_synthesis':c.kind==='completion_comparison'?'private_completion_photo_comparison':c.kind==='visual_description'?'private_image_basic_shape_candidates':'verbatim_design_text_extraction'}))!==true)fail('TRANSMISSION_DENIED');return true;}
 const operations={
  async extract(request){
   const c=await setup(request,[],'text_extraction');
   const prompt=buildDesignExtractionPrompt(c.session),body=JSON.stringify({model:modelConfig.model,messages:[...prompt.messages,{role:'system',content:JSON.stringify({responseSchema:prompt.responseSchema})}],max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
   if(Buffer.byteLength(body)>196608)fail('INVALID_CONTEXT');const payloadDigest=providerDigest(body);
   const run=createDeepSeekOperationRunner({...config,permissionGate:c.gate,transmissionGate:d=>processing(c,d)});
   const result=await run(c.fixed,{operation:'analyze',endpoint:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,payloadSha256:payloadDigest,byteLength:Buffer.byteLength(body),dataKinds:['scoped_human_text','speech_transcript_if_present'],body,headers:{'Content-Type':'application/json'},resultFields:['candidateEnvelope'],validateResult(result){const v=validateDesignCandidate(result.candidateEnvelope,c.session);if(v.id!==c.id||v.payloadDigest!==payloadDigest||v.kind!==c.kind||!same(v.actor,c.actor))fail('INVALID_RESULT');},parse(raw){
    let parsed;try{parsed=JSON.parse(chatContent(raw));}catch{fail('INVALID_RESULT');}
    const checked=validateDesignPilotResult(parsed,c.session);const sentSources=new Set(JSON.parse(prompt.messages.at(-1).content).sources.map(s=>s.messageId));if(checked.entries.some(e=>e.sources.some(ref=>!sentSources.has(ref.messageId))))fail('INVALID_RESULT');const ids=new Map(checked.entries.map((e,i)=>[e.id,'extracted:'+c.id+':'+i]));
    const candidate={...clone(checked),entries:checked.entries.map(e=>({...clone(e),id:ids.get(e.id),replacesEntryId:ids.get(e.replacesEntryId)??e.replacesEntryId}))};
    return {candidateEnvelope:envelope(c,{payloadDigest,promptVersion:prompt.promptVersion,candidate})};
   }});
   return freeze({candidate:result.candidateEnvelope,replayed:result.replayed});
  },
  async synthesize(request){
   if(!Array.isArray(request?.modelCandidates)||request.modelCandidates.length>1000||Buffer.byteLength(JSON.stringify(request.modelCandidates))>32*1024*1024)fail('INVALID_CONTEXT');
   const modelCandidates=clone(request.modelCandidates),side=request.side;
   const c=await setup(request,['side','modelCandidates'],'completion_synthesis');
   if(typeof config.mediaVerifier!=='function'||typeof config.synthesisVerifier!=='function')fail('ADAPTER_NOT_CONFIGURED');
   const evidence=buildSynthesisEvidence({session:c.session,modelCandidates,side}),{synthesis,sourceRefs}=evidence;
   async function verifyComposite(){
    if(await config.synthesisVerifier({credential:c.fixed.credential,scope:c.fixed.scope,actor:c.actor,sessionId:c.session.scope.sessionId,baseRevision:c.session.revision,inputDigest:c.inputDigest,synthesis,sourceRefs})!==true)fail('ACCESS_DENIED');
   }
   // The shared runner's final reauthorize must cover ancestors as well as the
   // employee/native session. No extra async dependency follows this composite check.
   const synthesisGate={async authorize(credential,scope){const grant=await c.gate.authorize(credential,scope);await verifyComposite();return grant;}};
   async function verifyEvidence(){
    // The trusted composite verifier checks these exact original media refs as
    // well as actor/session/ancestors in fresh transactions. Keep c.gate: its
    // workflow load also checks attached media outside this synthesis.
    await synthesisGate.authorize(c.fixed.credential,c.fixed.scope);
   }
   await verifyEvidence();
   const payload=buildSynthesisCandidatePayload({scope:c.fixed.scope,actor:c.actor,requestId:c.fixed.requestId,session:c.session,modelCandidates,synthesis,sourceRefs,modelConfig,approvedTextModels});
   if(synthesis.generation==='deterministic'){
    if(typeof config.attemptStore?.reserve!=='function'||typeof config.attemptStore?.settle!=='function')fail('ADAPTER_NOT_CONFIGURED');
    const payloadDigest=payload.payloadSha256,candidate=payload.localCandidate;
    const key=designCandidateDigest([c.actor,c.fixed.requestId]),fingerprint=designCandidateDigest({scope:c.fixed.scope,operation:'server_synthesis',model:'server-deterministic',endpoint:'local',payloadSha256:payloadDigest});
    if(typeof config.attemptStore.bind==='function')await config.attemptStore.bind({key,fingerprint,disclosure:{requestId:c.fixed.requestId,kind:'local',operation:'server_synthesis',destination:'local',model:'server-deterministic',payloadSha256:payloadDigest,byteLength:payload.byteLength,dataKinds:['accepted_angle_ai_judgments_no_images'],purpose:'accepted_angle_ai_judgment_synthesis',inputDigest:c.inputDigest,sourceRefs,maxOutputTokens:0,cost:null}});
    let reservation;try{reservation=await config.attemptStore.reserve({key,fingerprint});}catch{throw new DesignProviderError('ATTEMPT_STORE_FAILED','uncertain');}
    if(!plain(reservation)||typeof reservation.created!=='boolean')fail('ATTEMPT_STORE_FAILED');
    if(!reservation.created){if(reservation.fingerprint!==fingerprint)fail('REQUEST_CONFLICT');if(reservation.state!=='completed')throw new DesignProviderError('OUTCOME_UNCERTAIN','uncertain');if(!same(reservation.result,{candidateEnvelope:candidate}))fail('ATTEMPT_STORE_FAILED');if(typeof config.attemptStore.authorizeReturn==='function')await config.attemptStore.authorizeReturn({key,fingerprint});await verifyEvidence();return freeze({candidate,replayed:true});}
    try{await verifyEvidence();await config.attemptStore.settle({key,fingerprint,state:'completed',result:{candidateEnvelope:candidate}});if(typeof config.attemptStore.authorizeReturn==='function')await config.attemptStore.authorizeReturn({key,fingerprint});await verifyEvidence();}catch{throw new DesignProviderError('ATTEMPT_STORE_FAILED','uncertain');}
    return freeze({candidate,replayed:false});
   }
   if(typeof config.processingGate!=='function')fail('ADAPTER_NOT_CONFIGURED');
   const body=payload.body,payloadDigest=payload.payloadSha256;
   const run=createDeepSeekOperationRunner({...config,permissionGate:synthesisGate,transmissionGate:async d=>{await verifyEvidence();await processing(c,{...d,synthesis},sourceRefs);await verifyEvidence();return true;}});
   const result=await run(c.fixed,{operation:'analyze',endpoint:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,payloadSha256:payloadDigest,byteLength:Buffer.byteLength(body),dataKinds:['accepted_angle_ai_judgments_no_images'],body,headers:{'Content-Type':'application/json'},resultFields:['candidateEnvelope'],validateResult(result){payload.validateCandidate(result.candidateEnvelope);},parse(raw){
    return {candidateEnvelope:payload.parse(raw)};
   }});
   try{await verifyEvidence();}catch{throw new DesignProviderError('ACCESS_DENIED','uncertain');}
   return freeze({candidate:result.candidateEnvelope,replayed:result.replayed});
  },
  async compare(request){
   if(!Array.isArray(request?.media)||request.media.length!==2)fail('INVALID_CONTEXT');
   const media=request.media.map(m=>{exact(m,['reference','bytes']);if(!(m.bytes instanceof Uint8Array)||!m.bytes.length||m.bytes.length>8*1024*1024)fail('INVALID_CONTEXT');return {reference:clone(m.reference),bytes:Uint8Array.from(m.bytes)};});
   const c=await setup(request,['media'],'completion_comparison');
   if(c.session.phase!=='completed_review'||typeof config.derivativeProvider!=='function'||typeof config.derivativeInspector!=='function'||typeof config.mediaVerifier!=='function')fail('ADAPTER_NOT_CONFIGURED');
   const [before,after]=media.map(m=>m.reference);
   if(before.stage!=='before'||after.stage!=='after'||!['front','back','left','right'].includes(before.angle)||before.angle!==after.angle||before.mediaId===after.mediaId||media.some(m=>typeof m.reference.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(m.reference.mediaId)||m.reference.byteLength!==m.bytes.length))fail('INVALID_CONTEXT');
   const comparison=freeze({beforeMediaId:before.mediaId,afterMediaId:after.mediaId,angle:before.angle});
   const source=media.map(m=>({mediaId:m.reference.mediaId,sourceSha256:sha(m.bytes)}));
   async function verifyMedia(sourceRefs){if(await config.mediaVerifier({credential:c.fixed.credential,scope:c.fixed.scope,actor:c.actor,sourceRefs})!==true)fail('ACCESS_DENIED');}
   await verifyMedia(source);await c.gate.authorize(c.fixed.credential,c.fixed.scope);
   await processing(c,{requestId:c.fixed.requestId,actor:c.actor,scope:c.fixed.scope,provider:'deepseek',destination:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,stage:'before_derivative',mayIncurCharge:false,comparison},source);
   await verifyMedia(source);await c.gate.authorize(c.fixed.credential,c.fixed.scope);
   const derivatives=[];
   for(let i=0;i<2;i++){
    const d=await config.derivativeProvider({bytes:Uint8Array.from(media[i].bytes),reference:freeze(clone(media[i].reference)),sourceSha256:source[i].sourceSha256});
    exact(d,['bytes','mime','sourceSha256','metadataRemoved']);if(d.mime!=='image/png'||d.sourceSha256!==source[i].sourceSha256||d.metadataRemoved!==true)fail('INVALID_CONTEXT');
    validateDesignDerivative(d.bytes);if(d.bytes.length>48*1024)fail('INVALID_CONTEXT');const bytes=Uint8Array.from(d.bytes),decoded=await config.derivativeInspector(Uint8Array.from(bytes));
    if(decoded?.decoded!==true||decoded.mime!=='image/png'||decoded.frameCount!==1||decoded.width!==new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)||decoded.height!==new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20))fail('INVALID_CONTEXT');
    derivatives.push(bytes);await verifyMedia(source);await c.gate.authorize(c.fixed.credential,c.fixed.scope);
   }
   const sourceRefs=freeze(source.map((r,i)=>({...r,derivativeSha256:sha(derivatives[i])}))),prompt=buildDesignCompletionPrompt();
   const body=JSON.stringify({model:modelConfig.model,messages:[{role:'system',content:prompt.system},{role:'user',content:[{type:'text',text:'两张记录方向均为'+comparison.angle+'；第一张before，第二张after。标签不保证光线/姿态可比。'},...derivatives.flatMap((bytes,i)=>[{type:'text',text:i===0?'before':'after'},{type:'image_url',image_url:{url:'data:image/png;base64,'+Buffer.from(bytes).toString('base64')}}])]}],max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
   if(Buffer.byteLength(body)>196608)fail('INVALID_CONTEXT');const payloadDigest=providerDigest(body);
   const run=createDeepSeekOperationRunner({...config,permissionGate:c.gate,transmissionGate:async d=>{await verifyMedia(sourceRefs);await processing(c,{...d,comparison},sourceRefs);await verifyMedia(sourceRefs);return true;}});
   const result=await run(c.fixed,{operation:'analyze',endpoint:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,payloadSha256:payloadDigest,byteLength:Buffer.byteLength(body),dataKinds:['private_before_after_metadata_stripped_derivatives'],body,headers:{'Content-Type':'application/json'},resultFields:['candidateEnvelope'],validateResult(result){const v=validateDesignCandidate(result.candidateEnvelope,c.session);if(v.id!==c.id||v.kind!==c.kind||v.payloadDigest!==payloadDigest||!same(v.sourceRefs,sourceRefs)||!same(v.comparison,comparison)||!same(v.actor,c.actor))fail('INVALID_RESULT');},parse(raw){
    let output;try{output=JSON.parse(chatContent(raw));}catch{fail('INVALID_RESULT');}
    return {candidateEnvelope:envelope(c,{payloadDigest,promptVersion:prompt.promptVersion,sourceRefs,comparison,...buildCompletionCandidateParts({id:c.id,session:c.session,output,angle:comparison.angle})})};
   }});
   try{await verifyMedia(sourceRefs);await c.gate.authorize(c.fixed.credential,c.fixed.scope);}catch{throw new DesignProviderError('ACCESS_DENIED','uncertain');}
   return freeze({candidate:result.candidateEnvelope,replayed:result.replayed});
  },
  async describe(request){
   // Source bytes are server-loaded only. Public HTTP must not forward this internal media parameter.
   const fixedMedia=request?.media;exact(fixedMedia,['reference','bytes']);
   if(!(fixedMedia.bytes instanceof Uint8Array)||fixedMedia.bytes.length<1||fixedMedia.bytes.length>8*1024*1024)fail('INVALID_CONTEXT');
   const media={reference:clone(fixedMedia.reference),bytes:Uint8Array.from(fixedMedia.bytes)};
   const c=await setup(request,['media'],'visual_description');
   if(c.session.phase!=='before_analysis'||typeof config.derivativeProvider!=='function'||typeof config.derivativeInspector!=='function'||typeof config.mediaVerifier!=='function')fail('ADAPTER_NOT_CONFIGURED');
   if(typeof media.reference?.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(media.reference.mediaId)||media.reference.byteLength!==media.bytes.length)fail('INVALID_CONTEXT');
   const sourceSha256=sha(media.bytes);
   async function verifyMedia(sourceRefs){if(await config.mediaVerifier({credential:c.fixed.credential,scope:c.fixed.scope,actor:c.actor,sourceRefs})!==true)fail('ACCESS_DENIED');}
   const source=[{mediaId:media.reference.mediaId,sourceSha256}];await verifyMedia(source);
   // This gate authorizes local preparation only. It is NOT the later exact external content/cost approval.
   await processing(c,{requestId:c.fixed.requestId,actor:c.actor,scope:c.fixed.scope,provider:'deepseek',destination:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,stage:'before_derivative',mayIncurCharge:false},source);
   const derivative=await config.derivativeProvider({bytes:Uint8Array.from(media.bytes),reference:freeze(clone(media.reference)),sourceSha256});
   exact(derivative,['bytes','mime','sourceSha256','metadataRemoved']);if(derivative.mime!=='image/png'||derivative.sourceSha256!==sourceSha256||derivative.metadataRemoved!==true)fail('INVALID_CONTEXT');
   validateDesignDerivative(derivative.bytes);const bytes=Uint8Array.from(derivative.bytes),decoded=await config.derivativeInspector(Uint8Array.from(bytes));
   if(decoded?.decoded!==true||decoded.mime!=='image/png'||decoded.frameCount!==1||!Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||decoded.width<1||decoded.height<1||decoded.width>2048||decoded.height>2048||decoded.width!==new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)||decoded.height!==new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20))fail('INVALID_CONTEXT');
   const sourceRefs=freeze([{mediaId:media.reference.mediaId,sourceSha256,derivativeSha256:sha(bytes)}]);
   const prompt=buildDesignImagePrompt(),body=JSON.stringify({model:modelConfig.model,messages:[{role:'system',content:prompt.system},{role:'user',content:[{type:'text',text:'仅返回剪前基础可见外形候选；不确定必须null。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+Buffer.from(bytes).toString('base64')}}]}],max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
   if(Buffer.byteLength(body)>196608||!Number.isSafeInteger(modelConfig.maxTokens)||modelConfig.maxTokens<1||modelConfig.maxTokens>8192)fail('INVALID_CONTEXT');
   const payloadDigest=providerDigest(body);
   const run=createDeepSeekOperationRunner({...config,permissionGate:c.gate,transmissionGate:async d=>{await verifyMedia(sourceRefs);await processing(c,d,sourceRefs);await verifyMedia(sourceRefs);return true;}});
   const result=await run(c.fixed,{operation:'analyze',endpoint:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,payloadSha256:payloadDigest,byteLength:Buffer.byteLength(body),dataKinds:['private_image_metadata_stripped_derivative'],body,headers:{'Content-Type':'application/json'},resultFields:['candidateEnvelope'],validateResult(result){const v=validateDesignCandidate(result.candidateEnvelope,c.session);if(v.id!==c.id||v.payloadDigest!==payloadDigest||!same(v.sourceRefs,sourceRefs)||!same(v.actor,c.actor))fail('INVALID_RESULT');},parse(raw){
    let output;try{output=JSON.parse(chatContent(raw));exact(output,['observations']);}catch{fail('INVALID_RESULT');}
    const parts=buildVisualCandidateParts({id:c.id,session:c.session,observations:output.observations});
    return {candidateEnvelope:envelope(c,{payloadDigest,promptVersion:prompt.promptVersion,sourceRefs,...parts})};
   }});
   try{await verifyMedia(sourceRefs);await c.gate.authorize(c.fixed.credential,c.fixed.scope);}catch{throw new DesignProviderError('ACCESS_DENIED','uncertain');}
   return freeze({candidate:result.candidateEnvelope,replayed:result.replayed});
  },
 };
 return Object.freeze(Object.fromEntries(Object.entries(operations).map(([name,operation])=>[name,async request=>{try{return await operation(request);}catch(error){if(error instanceof DesignProviderError)throw error;fail('INVALID_CONTEXT');}}])));
}
