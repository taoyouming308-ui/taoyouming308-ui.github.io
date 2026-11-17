import {validateManagedApplicationViewProviderIntent} from './managed-application-view-provider-contracts.mjs';
import {validateManagedApplicationProviderIntent} from './managed-application-provider-contracts.mjs';
import {validateManagedNormalizedProviderIntent} from './managed-normalized-provider-contracts.mjs';
import {validateManagedViewProviderIntent} from './managed-view-provider-contracts.mjs';
import {validateManagedModelProviderIntent} from './managed-model-provider-contracts.mjs';
/** Server-only immutable policy contracts; no issuer, secrets or network defaults. */
import {createHash} from 'node:crypto';import {types} from 'node:util';
import {DESIGN_COMPARISON_OUTPUTS,DESIGN_COMPARISON_CHANGES,designSynthesisReviewChoices} from '../analysis-engine/design-candidate.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
export class DurableProviderPolicyError extends Error{constructor(code,outcome='not_sent'){super(code);this.name='DurableProviderPolicyError';this.code=code;this.outcome=outcome;this.retryable=false;}}
export const policyFail=(code='POLICY_INVALID',outcome)=>{throw new DurableProviderPolicyError(code,outcome);};
export const policyCanonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(policyCanonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+policyCanonical(v[k])).join(',')+'}';
export const policyDigest=v=>createHash('sha256').update(policyCanonical(v)).digest('hex');
export const policyEqual=(a,b)=>policyCanonical(a)===policyCanonical(b);
export const policyFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(policyFreeze);Object.freeze(v);}return v;};
export function policyCopy(value){
 let nodes=0,bytes=0;const charge=n=>{bytes+=n;if(bytes>1048576)policyFail();};
 function walk(v,depth){
  if(++nodes>50000||depth>30||types.isProxy(v))policyFail();
  if(v===null||['string','boolean','number'].includes(typeof v)){if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))policyFail();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))policyFail();
  const keys=Reflect.ownKeys(v);
  if(Array.isArray(v)){
   if(keys.length!==v.length+1)policyFail();charge(2+Math.max(0,v.length-1));const out=[];
   for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))policyFail();out.push(walk(d.value,depth+1));}return out;
  }
  charge(2+Math.max(0,keys.length-1));const out={};
  for(const key of keys){if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))policyFail();const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))policyFail();charge(Buffer.byteLength(JSON.stringify(key))+1);out[key]=walk(d.value,depth+1);}return out;
 }return walk(value,0);
}

export function policyExact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))policyFail();}
export const policyId=v=>{if(typeof v!=='string'||!v.length||v.length>160||v!==v.trim()||/[\u0000-\u001f\u007f]/.test(v))policyFail();return v;};
const revision=v=>{if(!Number.isSafeInteger(v)||v<1)policyFail();};
export const policySHA=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))policyFail();return v;};
export function validatePolicyScope(value){const v=policyCopy(value);policyExact(v,['customerProfileId','visitId','assignmentSource']);policyId(v.customerProfileId);policyId(v.visitId);if(!['appointment','frontdesk'].includes(v.assignmentSource))policyFail();return policyFreeze(v);}
export function validatePolicyAuthority(value){try{return validateImmutableDesignAuthority(value);}catch{policyFail('POLICY_INVALID');}}
export function policyOwnerKey(a,requestId){return policyDigest([a.subjectId,a.employmentId,a.membershipId,a.storeId,policyId(requestId)]);}
export function validateProviderKeyBinding(value){
 const v=policyCopy(value);policyExact(v,['owner','securityEpoch','membershipRevision','purpose','revision','destination','model','keyDigest']);policyExact(v.owner,['subjectId','employmentId','membershipId','storeId']);Object.values(v.owner).forEach(policyId);revision(v.securityEpoch);revision(v.membershipRevision);revision(v.revision);
 if(v.purpose==='chat'){if(v.destination!=='https://api.deepseek.com/chat/completions'||typeof v.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(v.model))policyFail();}else if(v.purpose!=='speech'||v.destination!=='https://api.deepseek.com/v1/tools/asr'||v.model!==null)policyFail();
 if(typeof v.keyDigest!=='string'||v.keyDigest.length!==44||Buffer.from(v.keyDigest,'base64').length!==32||Buffer.from(v.keyDigest,'base64').toString('base64')!==v.keyDigest)policyFail();return policyFreeze(v);
}
export function validateProviderSourceBinding(value){
 const v=policyCopy(value);policyExact(v,['workflowRevision','workflowSha256','sessionId','sessionRevision','sessionDigest','manifestId','manifestFingerprint']);
 for(const k of ['workflowRevision','sessionRevision'])if(!Number.isSafeInteger(v[k])||v[k]<0||v[k]>1000)policyFail();policyId(v.sessionId);policySHA(v.workflowSha256);policySHA(v.sessionDigest);
 if(v.manifestId===null){if(v.manifestFingerprint!==null)policyFail();}else{policyId(v.manifestId);policySHA(v.manifestFingerprint);}return policyFreeze(v);
}
/** Structural evidence only. Fixed database context additionally proves media and ancestor provenance. */
export function validateProviderEvidenceBinding(value,candidateKind){
 const v=policyCopy(value);policyExact(v,['sourceRefs','comparison','synthesis']);
 if(!Array.isArray(v.sourceRefs)||v.sourceRefs.length>6)policyFail();const seen=new Set();
 for(const r of v.sourceRefs){policyExact(r,['mediaId','sourceSha256',...(Object.hasOwn(r,'derivativeSha256')?['derivativeSha256']:[])]);policyId(r.mediaId);policySHA(r.sourceSha256);if(Object.hasOwn(r,'derivativeSha256'))policySHA(r.derivativeSha256);if(seen.has(r.mediaId))policyFail();seen.add(r.mediaId);}
 if(candidateKind==='visual_description'){if(v.sourceRefs.length!==1||v.comparison!==null||v.synthesis!==null)policyFail();}
 else if(candidateKind==='completion_comparison'){const c=v.comparison;policyExact(c,['beforeMediaId','afterMediaId','angle']);if(v.synthesis!==null||v.sourceRefs.length!==2||c.beforeMediaId!==v.sourceRefs[0].mediaId||c.afterMediaId!==v.sourceRefs[1].mediaId||!['front','back','left','right'].includes(c.angle))policyFail();}
 else if(candidateKind==='completion_synthesis'){
  if(v.comparison!==null)policyFail();const x=v.synthesis;policyExact(x,['side','evidence','missingAngles','uncomparableAngles','conflictingAngles','assessment','generation','reviewFocus']);if(!['left','right'].includes(x.side)||!Array.isArray(x.evidence)||x.evidence.length<1||x.evidence.length>3)policyFail();
  const angles=['front','back',x.side],ids=new Set();let prior=-1;
  for(const e of x.evidence){policyExact(e,['candidateId','candidateDigest','angle','entryId','acceptanceRequestId','entryStatus','judgment']);policyId(e.candidateId);policyId(e.acceptanceRequestId);policySHA(e.candidateDigest);const at=angles.indexOf(e.angle);if(at<=prior||ids.has(e.candidateId)||e.entryId!=='comparison-entry:'+e.candidateId+':0'||!['not_confirmed','confirmed'].includes(e.entryStatus)||!DESIGN_COMPARISON_OUTPUTS.some(j=>policyEqual(j,e.judgment)))policyFail();ids.add(e.candidateId);prior=at;}
  const missing=angles.filter(a=>!x.evidence.some(e=>e.angle===a)),uncomparable=x.evidence.filter(e=>e.judgment.comparability==='not_comparable').map(e=>e.angle),up=x.evidence.some(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[1]),down=x.evidence.some(e=>e.judgment.change===DESIGN_COMPARISON_CHANGES[2]),conflicting=up&&down?x.evidence.filter(e=>[DESIGN_COMPARISON_CHANGES[1],DESIGN_COMPARISON_CHANGES[2]].includes(e.judgment.change)).map(e=>e.angle):[];
  const assessment=missing.length||uncomparable.length?'limited_evidence':conflicting.length?'potential_conflict':new Set(x.evidence.map(e=>e.judgment.change)).size===1?'consistent_judgments':'mixed_judgments';
  if(!policyEqual(x.missingAngles,missing)||!policyEqual(x.uncomparableAngles,uncomparable)||!policyEqual(x.conflictingAngles,conflicting)||x.assessment!==assessment||v.sourceRefs.length!==x.evidence.length*2||v.sourceRefs.some(r=>!Object.hasOwn(r,'derivativeSha256')))policyFail();
  const choices=designSynthesisReviewChoices(x);if(x.generation!==(choices.length>1?'model_review_focus':'deterministic')||(choices.length?!choices.some(c=>policyEqual(c,x.reviewFocus)):x.reviewFocus!==null))policyFail();
 }else policyFail();return policyFreeze(v);
}
export function validatePolicyIntent(value){const v=policyCopy(value);if(v?.schemaVersion==='design-provider-intent-v8')return validateManagedApplicationViewProviderIntent(v);if(v?.schemaVersion==='design-provider-intent-v7')return validateManagedApplicationProviderIntent(v);if(v?.schemaVersion==='design-provider-intent-v6')return validateManagedNormalizedProviderIntent(v);if(v?.schemaVersion==='design-provider-intent-v5')return validateManagedViewProviderIntent(v);if(v?.schemaVersion==='design-provider-intent-v4')return validateManagedModelProviderIntent(v);const bound=Boolean(v&&(Object.hasOwn(v,'schemaVersion')||Object.hasOwn(v,'keyBinding')||Object.hasOwn(v,'sourceBinding')));policyExact(v,['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost',...(bound?['schemaVersion','keyBinding','sourceBinding',...(v.schemaVersion==='design-provider-intent-v3'?['candidateKind','evidenceBinding']:[])]:[])]);policyId(v.requestId);policyId(v.purpose);policySHA(v.payloadSha256);policySHA(v.inputDigest);if(!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>8*1024*1024||!Array.isArray(v.dataKinds)||!v.dataKinds.length||v.dataKinds.length>8||new Set(v.dataKinds).size!==v.dataKinds.length)policyFail();v.dataKinds.forEach(policyId);if(!Array.isArray(v.sourceRefs)||v.sourceRefs.length>6)policyFail();const ids=new Set();for(const ref of v.sourceRefs){policyExact(ref,['mediaId','sourceSha256',...(Object.hasOwn(ref,'derivativeSha256')?['derivativeSha256']:[])]);policyId(ref.mediaId);policySHA(ref.sourceSha256);if(Object.hasOwn(ref,'derivativeSha256'))policySHA(ref.derivativeSha256);if(ids.has(ref.mediaId))policyFail();ids.add(ref.mediaId);}
 if(v.kind==='local'){if(v.operation!=='server_synthesis'||v.destination!=='local'||v.model!=='server-deterministic'||v.cost!==null||v.maxOutputTokens!==0)policyFail();}
 else if(v.kind==='external'){if(v.operation==='analyze'){if(v.destination!=='https://api.deepseek.com/chat/completions'||typeof v.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(v.model)||!Number.isSafeInteger(v.maxOutputTokens)||v.maxOutputTokens<1||v.maxOutputTokens>8192)policyFail();}else if(v.operation==='speech'){if(v.destination!=='https://api.deepseek.com/v1/tools/asr'||v.model!==null||v.maxOutputTokens!==null)policyFail();}else policyFail();policyExact(v.cost,['currency','maximumMinorUnits','commitment']);if(!/^[A-Z]{3}$/.test(v.cost.currency)||!Number.isSafeInteger(v.cost.maximumMinorUnits)||v.cost.maximumMinorUnits<1||v.cost.commitment!=='one_time')policyFail();}else policyFail();
 if(bound&&v.schemaVersion==='design-provider-intent-v3'){
  v.sourceBinding=validateProviderSourceBinding(v.sourceBinding);v.evidenceBinding=validateProviderEvidenceBinding(v.evidenceBinding,v.candidateKind);if(!policyEqual(v.sourceRefs,v.evidenceBinding.sourceRefs)||v.inputDigest!==v.sourceBinding.sessionDigest)policyFail();
  const purpose={visual_description:'private_image_basic_shape_candidates',completion_comparison:'private_completion_photo_comparison',completion_synthesis:'accepted_angle_ai_judgment_synthesis'}[v.candidateKind],data={visual_description:['private_image_metadata_stripped_derivative'],completion_comparison:['private_before_after_metadata_stripped_derivatives'],completion_synthesis:['accepted_angle_ai_judgments_no_images']}[v.candidateKind];
  if(v.purpose!==purpose||!policyEqual(v.dataKinds,data)||v.sourceRefs.some(r=>!Object.hasOwn(r,'derivativeSha256')))policyFail();
  if(v.kind==='local'){if(v.keyBinding!==null||v.candidateKind!=='completion_synthesis'||v.evidenceBinding.synthesis.generation!=='deterministic')policyFail();}
  else {v.keyBinding=validateProviderKeyBinding(v.keyBinding);if(v.operation!=='analyze'||v.keyBinding.purpose!=='chat'||v.keyBinding.destination!==v.destination||v.keyBinding.model!==v.model||v.candidateKind==='completion_synthesis'&&v.evidenceBinding.synthesis.generation!=='model_review_focus')policyFail();}
 }else if(bound){if(v.schemaVersion!=='design-provider-intent-v2'||v.kind!=='external')policyFail();v.keyBinding=validateProviderKeyBinding(v.keyBinding);v.sourceBinding=validateProviderSourceBinding(v.sourceBinding);if(v.keyBinding.destination!==v.destination||v.keyBinding.model!==v.model||v.keyBinding.purpose!==(v.operation==='speech'?'speech':'chat')||v.inputDigest!==(v.operation==='speech'?v.payloadSha256:v.sourceBinding.sessionDigest))policyFail();if(v.sourceRefs.length||v.purpose!==(v.operation==='speech'?'transcribe_for_employee_review':'verbatim_design_text_extraction')||!policyEqual(v.dataKinds,v.operation==='speech'?['mono_pcm16_wav']:['scoped_human_text','speech_transcript_if_present']))policyFail();}
 return policyFreeze(v);
}
export function policyLegacyBinding(authority,intent){return {key:policyDigest([authority.actor,intent.requestId]),fingerprint:policyDigest({scope:authority.scope,operation:intent.operation,model:intent.model,endpoint:intent.destination,payloadSha256:intent.payloadSha256})};}
