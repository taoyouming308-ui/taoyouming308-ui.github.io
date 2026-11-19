import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
/** Pure accepted-candidate integrity. No repository, authorization, network or provenance claim. */
import {Buffer} from 'node:buffer';
import {validateDesignSession,createDesignSession,DESIGN_SCHEMA_VERSION,LEGACY_DESIGN_SCHEMA_VERSION} from './design-pilot.mjs';
import {validateDesignCandidate,applyTrustedDesignCandidate,designCandidateDigest,validateSynthesisEvidence} from './design-candidate.mjs';

export class CandidateHistoryError extends Error {
  constructor(code){super(code);this.name='CandidateHistoryError';this.code=code;this.retryable=false;}
}
const fail=code=>{throw new CandidateHistoryError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('CANDIDATE_HISTORY_INVALID');};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const integer=v=>{if(!Number.isSafeInteger(v)||v<0)fail('CANDIDATE_HISTORY_INVALID');};
const id=v=>{if(typeof v!=='string'||!v.length||v.length>160||v!==v.trim()||/[\u0000-\u001f\u007f]/.test(v)||['__proto__','prototype','constructor'].includes(v))fail('CANDIDATE_HISTORY_INVALID');};
const requestId=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v))fail('CANDIDATE_HISTORY_INVALID');};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const numericId=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v)&&Number.isSafeInteger(Number(v));
function copy(value){
  let nodes=0,bytes=0;
  const charge=n=>{bytes+=n;if(bytes>32*1024*1024)fail('CANDIDATE_HISTORY_LIMIT');};
  function visit(v,depth){
    if(++nodes>750000||depth>80)fail('CANDIDATE_HISTORY_LIMIT');
    if(v===null||typeof v==='string'||typeof v==='boolean'){if(typeof v==='string'&&v.length>65536)fail('CANDIDATE_HISTORY_LIMIT');charge(Buffer.byteLength(JSON.stringify(v)));return;}
    if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail('CANDIDATE_HISTORY_INVALID');charge(Buffer.byteLength(JSON.stringify(v)));return;}
    if(Array.isArray(v)){
      if(Reflect.ownKeys(v).length!==v.length+1)fail('CANDIDATE_HISTORY_INVALID');charge(2+Math.max(0,v.length-1));
      for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('CANDIDATE_HISTORY_INVALID');visit(d.value,depth+1);}return;
    }
    if(!plain(v))fail('CANDIDATE_HISTORY_INVALID');charge(2+Math.max(0,Reflect.ownKeys(v).length-1));
    for(const key of Reflect.ownKeys(v)){
      if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))fail('CANDIDATE_HISTORY_INVALID');
      if(key.length>65536)fail('CANDIDATE_HISTORY_LIMIT');charge(Buffer.byteLength(JSON.stringify(key))+1);
      const d=Object.getOwnPropertyDescriptor(v,key);if(!d.enumerable||!Object.hasOwn(d,'value'))fail('CANDIDATE_HISTORY_INVALID');visit(d.value,depth+1);
    }
  }
  visit(value,0);return JSON.parse(canonical(value));
}
function checkedSession(value){try{return validateDesignSession(value);}catch{fail('CANDIDATE_HISTORY_SESSION_INVALID');}}
function checkScope(scope){
  exact(scope,['customerProfileId','visitId','assignmentSource']);
  if(!numericId(scope.customerProfileId)||typeof scope.visitId!=='string'||!(scope.assignmentSource==='appointment'&&scope.visitId.startsWith('booking:')&&numericId(scope.visitId.slice(8))||scope.assignmentSource==='frontdesk'&&scope.visitId.startsWith('frontdesk:')&&uuid(scope.visitId.slice(10))))fail('CANDIDATE_HISTORY_SCOPE_MISMATCH');
}
function checkPhotos(photoRefs,scope,store){
  if(!Array.isArray(photoRefs)||photoRefs.length>300)fail('CANDIDATE_HISTORY_MEDIA_INVALID');
  const seen=new Set(),media=new Map();
  for(const photo of photoRefs){
    if(!plain(photo))fail('CANDIDATE_HISTORY_MEDIA_INVALID');
    if(photo.kind==='private_media'){
      exact(photo,['kind','scope','store','reference']);const ref=photo.reference;
      exact(ref,['mediaId','stage','angle','mime','byteLength','width','height']);
      if(typeof ref.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.mediaId)||seen.has('private:'+ref.mediaId)||!['before','after','reference'].includes(ref.stage)||!['front','back','left','right','detail'].includes(ref.angle)||!PHONE_SOURCE_MIMES.includes(ref.mime)||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<1||ref.byteLength>8*1024*1024||!['width','height'].every(k=>Number.isSafeInteger(ref[k])&&ref[k]>0&&ref[k]<=16384)||ref.width*ref.height>40000000)fail('CANDIDATE_HISTORY_MEDIA_INVALID');
      seen.add('private:'+ref.mediaId);media.set(ref.mediaId,ref);
    }else if(photo.kind==='legacy_asset'){
      exact(photo,['kind','assetId','scope','store','stage','angle']);
      if(!uuid(photo.assetId)||seen.has('legacy:'+photo.assetId)||!['before','after','unknown'].includes(photo.stage)||!['front','back','left','right','unknown'].includes(photo.angle))fail('CANDIDATE_HISTORY_MEDIA_INVALID');
      seen.add('legacy:'+photo.assetId);
    }else fail('CANDIDATE_HISTORY_MEDIA_INVALID');
    if(!same(photo.scope,scope)||photo.store!==store)fail('CANDIDATE_HISTORY_SCOPE_MISMATCH');
  }
  return media;
}
function checkCandidatePhotoRefs(candidate,media,scope,store){
  if(!plain(candidate)||!same(candidate.scope,scope)||candidate.store!==store)fail('CANDIDATE_HISTORY_SCOPE_MISMATCH');
  const counts={text_extraction:0,visual_description:1,completion_comparison:2,completion_synthesis:null};
  if(!Object.hasOwn(counts,candidate.kind)||!Array.isArray(candidate.sourceRefs)||candidate.kind!=='completion_synthesis'&&candidate.sourceRefs.length!==counts[candidate.kind])fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');
  if(candidate.kind==='completion_synthesis'){
    exact(candidate.synthesis,['side','evidence','missingAngles','uncomparableAngles','conflictingAngles','assessment','generation','reviewFocus']);
    const {side,evidence}=candidate.synthesis;
    if(!['left','right'].includes(side)||!Array.isArray(evidence)||evidence.length<1||evidence.length>3||candidate.sourceRefs.length!==evidence.length*2)fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');
    const angles=['front','back',side];let previous=-1;
    for(const item of evidence){
      exact(item,['candidateId','candidateDigest','angle','entryId','acceptanceRequestId','entryStatus','judgment']);
      const index=angles.indexOf(item.angle);if(index<=previous)fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');previous=index;
    }
  }
  const seen=new Set();
  for(const ref of candidate.sourceRefs){
    exact(ref,['mediaId','sourceSha256','derivativeSha256']);
    if(typeof ref.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.mediaId)||!sha(ref.sourceSha256)||!sha(ref.derivativeSha256)||seen.has(ref.mediaId))fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');seen.add(ref.mediaId);
    if(!media.has(ref.mediaId))fail('CANDIDATE_HISTORY_MEDIA_MISSING');
  }
  if(candidate.kind==='completion_comparison'){
    exact(candidate.comparison,['beforeMediaId','afterMediaId','angle']);
    const pair=candidate.comparison;
    if(pair.beforeMediaId===pair.afterMediaId||!['front','back','left','right'].includes(pair.angle)||candidate.sourceRefs[0].mediaId!==pair.beforeMediaId||candidate.sourceRefs[1].mediaId!==pair.afterMediaId)fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');
    if(media.get(pair.beforeMediaId).stage!=='before'||media.get(pair.afterMediaId).stage!=='after'||media.get(pair.beforeMediaId).angle!==pair.angle||media.get(pair.afterMediaId).angle!==pair.angle)fail('CANDIDATE_HISTORY_MEDIA_MISMATCH');
  }
  if(candidate.kind==='completion_synthesis'){
    // References retain each ancestor's before/after order; the history validator
    // separately checks those exact ancestor identities and their declared hashes.
    candidate.synthesis.evidence.forEach((item,index)=>{
      const before=media.get(candidate.sourceRefs[index*2].mediaId),after=media.get(candidate.sourceRefs[index*2+1].mediaId);
      if(before.stage!=='before'||after.stage!=='after'||before.angle!==item.angle||after.angle!==item.angle)fail('CANDIDATE_HISTORY_MEDIA_MISMATCH');
    });
  }
  return true;
}
/** Check scoped attached-photo bindings only. Callers still validate the candidate/session
 * and authorize/re-read originals; a declared digest is not proof of the media bytes.
 */
export function validateDesignCandidatePhotoRefs({candidate,photoRefs,scope,store}={}){
  const input=copy({candidate,photoRefs,scope,store});checkScope(input.scope);id(input.store);
  return checkCandidatePhotoRefs(input.candidate,checkPhotos(input.photoRefs,input.scope,input.store),input.scope,input.store);
}
function initialSession(session){
  const state=JSON.parse(canonical(createDesignSession(session.scope)));
  // A migrated v2 journal starts as v1 even when the requested prefix precedes migration.
  state.schemaVersion=session.journal.some(row=>row.event.type==='schema_migrated')?LEGACY_DESIGN_SCHEMA_VERSION:session.schemaVersion;
  return checkedSession(state);
}
function prefixFromChecked(session,revision){
  integer(revision);if(revision>session.revision)fail('CANDIDATE_HISTORY_REVISION_INVALID');
  if(revision===session.revision)return session;
  // Materialize a checkpoint only from an already validated journal. The native validator
  // replays and checks this projection below; there is no new event or migration here.
  const prefix=JSON.parse(canonical(initialSession(session))),entries=new Map();
  for(const request of session.journal.slice(0,revision)){
    const row=JSON.parse(canonical(request)),event=row.event;
    if(event.type==='source_recorded')prefix.sources.push(event.source);
    else if(event.type==='entry_recorded'){
      const entry={...event.entry,confirmation:null};prefix.entries.push(entry);entries.set(entry.id,entry);
    }else if(event.type==='entry_confirmed'){
      const entry=entries.get(event.entryId);if(!entry)fail('CANDIDATE_HISTORY_SESSION_INVALID');
      entry.status='confirmed';entry.confirmation={revision:prefix.revision+1,sources:event.sources};
    }else if(event.type==='phase_advanced')prefix.phase=event.phase;
    else if(event.type==='revision_opened'){prefix.sources.push(event.reasonSource);prefix.phase=event.resumePhase;}
    else if(event.type==='schema_migrated'){
      prefix.schemaVersion=DESIGN_SCHEMA_VERSION;
      for(const entry of prefix.entries)Object.assign(entry,entry.category==='technique'?{groupId:'legacy-ungrouped',service:'unknown',side:'unknown'}:{groupId:null,service:null,side:null});
    }else fail('CANDIDATE_HISTORY_SESSION_INVALID');
    prefix.journal.push(row);prefix.revision++;
  }
  return checkedSession(prefix);
}
/** Rebuild, never relabel, the exact native journal checkpoint. Caller still owns authorization. */
export function reconstructCandidateSessionPrefix(session,revision){
  return prefixFromChecked(checkedSession(copy(session)),revision);
}
/** Return a frozen lossless copy. An absent historical lane is represented by [] by the caller. */
export function validateAcceptedCandidateHistory({session,scope,store,modelCandidates,photoRefs,workflowRevision}={}){
  const input=copy({session,scope,store,modelCandidates,photoRefs,...(workflowRevision===undefined?{}:{workflowRevision})});
  checkScope(input.scope);id(input.store);
  if(input.workflowRevision!==undefined)integer(input.workflowRevision);
  const checked=checkedSession(input.session);
  if(checked.scope.customerId!==input.scope.customerProfileId||checked.scope.visitId!==input.scope.visitId)fail('CANDIDATE_HISTORY_SCOPE_MISMATCH');
  if(!Array.isArray(input.modelCandidates)||input.modelCandidates.length>1000)fail('CANDIDATE_HISTORY_LIMIT');
  const media=checkPhotos(input.photoRefs,input.scope,input.store),candidateIds=new Set(),requests=new Set(),priorAccepted=[];
  let priorWorkflowRevision=0,priorResultRevision=0,replay=initialSession(checked);
  for(const row of input.modelCandidates){
    exact(row,['candidate','acceptance']);exact(row.acceptance,['requestId','workflowRevision','receipt']);
    const {candidate,acceptance}=row,{receipt}=acceptance;
    exact(receipt,['candidateId','kind','candidateDigest','inputDigest','baseRevision','resultRevision','selectedIndices','sourceRefs']);
    requestId(acceptance.requestId);integer(acceptance.workflowRevision);integer(receipt.baseRevision);integer(receipt.resultRevision);
    if(acceptance.workflowRevision<=priorWorkflowRevision||input.workflowRevision!==undefined&&acceptance.workflowRevision>input.workflowRevision||receipt.baseRevision<priorResultRevision||receipt.resultRevision<=receipt.baseRevision||receipt.resultRevision>checked.revision)fail('CANDIDATE_HISTORY_REVISION_INVALID');
    if(!plain(candidate)||!same(candidate.scope,input.scope)||candidate.store!==input.store)fail('CANDIDATE_HISTORY_SCOPE_MISMATCH');
    if(candidateIds.has(candidate.id)||requests.has(acceptance.requestId))fail('CANDIDATE_HISTORY_DUPLICATE');
    if(!sha(receipt.candidateDigest)||!sha(receipt.inputDigest)||!Array.isArray(receipt.selectedIndices)||!receipt.selectedIndices.length||receipt.selectedIndices.length>100||!Array.isArray(receipt.sourceRefs)||receipt.sourceRefs.length>(candidate.kind==='completion_synthesis'?6:candidate.kind==='completion_comparison'?2:1))fail('CANDIDATE_HISTORY_INVALID');
    if(receipt.baseRevision>checked.revision)fail('CANDIDATE_HISTORY_REVISION_INVALID');
    if(replay.revision<receipt.baseRevision)replay=prefixFromChecked(checked,receipt.baseRevision);
    const prefix=replay;let validated,applied;
    try{
      validated=validateDesignCandidate(candidate,prefix);
      // Never recompute an older summary against the final session or later rows.
      // Only already verified accepted artifacts existing at its exact checkpoint
      // may establish its evidence; JSON hashes are not independent provenance.
      if(validated.kind==='completion_synthesis')validateSynthesisEvidence({candidate:validated,session:prefix,modelCandidates:priorAccepted.filter(prior=>prior.acceptance.receipt.resultRevision<=validated.baseRevision)});
      applied=applyTrustedDesignCandidate({session:prefix,candidate:validated,selectedIndices:receipt.selectedIndices,requestId:acceptance.requestId});
    }catch{fail('CANDIDATE_HISTORY_CANDIDATE_INVALID');}
    if(!same(receipt,applied.acceptedReceipt)||receipt.candidateDigest!==designCandidateDigest(candidate))fail('CANDIDATE_HISTORY_RECEIPT_MISMATCH');
    if(!same(applied.session.journal,checked.journal.slice(0,receipt.resultRevision)))fail('CANDIDATE_HISTORY_JOURNAL_MISMATCH');
    checkCandidatePhotoRefs(validated,media,input.scope,input.store);
    candidateIds.add(candidate.id);requests.add(acceptance.requestId);priorAccepted.push(row);priorWorkflowRevision=acceptance.workflowRevision;priorResultRevision=receipt.resultRevision;replay=applied.session;
  }
  return freeze(input.modelCandidates);
}
