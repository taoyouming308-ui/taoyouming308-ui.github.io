/** Request-bound immutable provider hooks. No transport, key source or automatic approval. */
import {createDurableProviderPolicy} from './durable-provider-policy.mjs';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze,policyId,validatePolicyAuthority,validatePolicyScope,validatePolicyIntent,validateProviderKeyBinding,validateProviderSourceBinding,validateProviderEvidenceBinding} from './approval-attempt-contracts.mjs';
const CODES=new Set(['IMMUTABLE_PROVIDER_DISABLED','IMMUTABLE_PROVIDER_INVALID','IMMUTABLE_PROVIDER_CHANGED','IMMUTABLE_PROVIDER_APPROVAL_REQUIRED','IMMUTABLE_PROVIDER_KEY_UNAVAILABLE','IMMUTABLE_PROVIDER_UNAVAILABLE','IMMUTABLE_PROVIDER_CLOSED']);
export class ImmutableProviderRequestError extends Error{constructor(code){super(CODES.has(code)?code:'IMMUTABLE_PROVIDER_UNAVAILABLE');this.name='ImmutableProviderRequestError';this.code=this.message;this.retryable=false;this.outcome='not_sent';}}
const fail=code=>{throw new ImmutableProviderRequestError(code);};
const owner=a=>Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(k=>[k,a[k]]));
function request(input){const r=copy(input);exact(r,['credential','scope','requestId','operation','destination','model','expectedAuthority']);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/[\s\u0000-\u001f\u007f]/.test(r.credential))fail('IMMUTABLE_PROVIDER_INVALID');policyId(r.requestId);r.scope=validatePolicyScope(r.scope);r.expectedAuthority=validatePolicyAuthority(r.expectedAuthority);if(!equal(r.scope,r.expectedAuthority.scope)||!['analyze','speech'].includes(r.operation))fail('IMMUTABLE_PROVIDER_INVALID');if(r.operation==='speech'?(r.destination!=='https://api.deepseek.com/v1/tools/asr'||r.model!==null):(r.destination!=='https://api.deepseek.com/chat/completions'||typeof r.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(r.model)))fail('IMMUTABLE_PROVIDER_INVALID');return freeze(r);}
function context(raw,r){
 const c=copy(raw);exact(c,['authority','keyRecord','keyBinding','sourceBinding']);c.authority=validatePolicyAuthority(c.authority);c.keyBinding=validateProviderKeyBinding(c.keyBinding);c.sourceBinding=validateProviderSourceBinding(c.sourceBinding);
 const b=c.keyBinding,k=c.keyRecord;exact(k,['schemaVersion','owner','securityEpoch','membershipRevision','purpose','revision','enabled','destination','model','sealed']);
 if(!equal(c.authority,r.expectedAuthority)||!equal(b.owner,owner(c.authority))||b.securityEpoch!==c.authority.securityEpoch||b.membershipRevision!==c.authority.membershipRevision||b.purpose!==(r.operation==='speech'?'speech':'chat')||b.destination!==r.destination||b.model!==r.model||k.schemaVersion!=='design-key-record-v2'||k.enabled!==true)fail('IMMUTABLE_PROVIDER_CHANGED');
 for(const field of ['owner','securityEpoch','membershipRevision','purpose','revision','destination','model'])if(!equal(k[field],b[field]))fail('IMMUTABLE_PROVIDER_CHANGED');
 exact(k.sealed,['v','iv','data']);if(k.sealed.v!==2||typeof k.sealed.iv!=='string'||typeof k.sealed.data!=='string'||k.sealed.iv.length>100||k.sealed.data.length>6000)fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');return freeze(c);
}
function factory({enabled=false,access,sealer,clock=()=>Date.now()}={}){
 return Object.freeze({async forRequest(input){
  if(enabled!==true||!access||['readContext','readApproval','createPolicyRepository'].some(k=>typeof access[k]!=='function')||!sealer||['open','digest'].some(k=>typeof sealer[k]!=='function')||typeof clock!=='function')fail('IMMUTABLE_PROVIDER_DISABLED');
  const r=request(input),purpose=r.operation==='speech'?'speech':'chat',ctxInput=freeze({credential:r.credential,scope:r.scope,purpose,requestId:r.requestId}),approvalInput=freeze({credential:r.credential,scope:r.scope,requestId:r.requestId});
  let initial;try{initial=context(await access.readContext(ctxInput),r);}catch{fail('IMMUTABLE_PROVIDER_CHANGED');}
  async function fresh(){let c;try{c=context(await access.readContext(ctxInput),r);}catch{fail('IMMUTABLE_PROVIDER_CHANGED');}if(!equal(c,initial))fail('IMMUTABLE_PROVIDER_CHANGED');return c;}
  async function approvalReceipt(){
   await fresh();let a;try{a=copy(await access.readApproval(approvalInput));exact(a,['receiptId','authority','intent','issuedAt','expiresAt']);policyId(a.receiptId);a.authority=validatePolicyAuthority(a.authority);a.intent=validatePolicyIntent(a.intent);}catch{fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');}
   const i=a.intent,now=clock();if(!Number.isSafeInteger(now)||!Number.isSafeInteger(a.issuedAt)||!Number.isSafeInteger(a.expiresAt)||a.issuedAt>now||a.expiresAt<=now||a.expiresAt-a.issuedAt>900000||a.expiresAt<=a.issuedAt||i.schemaVersion!=='design-provider-intent-v2'||i.kind!=='external'||i.requestId!==r.requestId||i.operation!==r.operation||i.destination!==r.destination||i.model!==r.model||!equal(a.authority,initial.authority)||!equal(i.keyBinding,initial.keyBinding)||!equal(i.sourceBinding,initial.sourceBinding))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');return freeze(a);
  }
  const approvalIssuer=Object.freeze({async verify(input){
   const v=copy(input);exact(v,['action','evidence','authority','requestId']);exact(v.evidence,['requestId']);
   if(v.action!=='approve'||v.requestId!==r.requestId||v.evidence.requestId!==r.requestId||!equal(v.authority,initial.authority))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');return approvalReceipt();
  }});
  const policy=createDurableProviderPolicy({enabled:true,repository:access.createPolicyRepository(),approvalIssuer,intentResolver:async()=>{return (await approvalReceipt()).intent;}});
  // Import an already independently issued exact receipt. This never mints approval,
  // extends its deadline, changes its amount, or revives an inactive runtime approval.
  const persisted=await policy.persistApproval({...approvalInput,evidence:{requestId:r.requestId}});
  if(persisted.active!==true)fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');
  const handles=await policy.forRequest(approvalInput);
  let busy=false,poisoned=false,keyUsed=false,keyClosed=false,keyPreparing=false,reserved=false;
  const call=async fn=>{if(busy||poisoned||keyPreparing){poisoned=true;fail('IMMUTABLE_PROVIDER_CLOSED');}busy=true;try{const result=await fn();if(poisoned)fail('IMMUTABLE_PROVIDER_CLOSED');return result;}catch(e){poisoned=true;throw e;}finally{busy=false;}};
  const attemptStore=freeze(Object.fromEntries(['bind','reserve','authorizeDispatch','authorizeReturn','settle'].map(name=>[name,input=>call(async()=>{const result=await handles.attemptStore[name](input);if(name==='reserve')reserved=result?.created===true;return result;})])));
  const processingGate=disclosure=>call(()=>handles.processingGate(disclosure));
  async function keyResolver(input,use){
   if(!reserved||keyUsed||keyClosed||poisoned||busy||typeof use!=='function')fail('IMMUTABLE_PROVIDER_CLOSED');keyUsed=true;keyPreparing=true;
   let key=null;
   try{
    const v=copy(input);exact(v,['credential','actor','scope','provider','destination','model']);if(v.credential!==r.credential||v.provider!=='deepseek'||!equal(v.actor,r.expectedAuthority.actor)||!equal(v.scope,r.scope)||v.destination!==r.destination||v.model!==r.model)fail('IMMUTABLE_PROVIDER_INVALID');
    await fresh();try{key=await sealer.open(initial.keyRecord.sealed,initial.keyRecord);}catch{fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');}
    if(typeof key!=='string'||key.length<16||key.length>500||!/^[A-Za-z0-9._~-]+$/.test(key))fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');
    let digest;try{digest=await sealer.digest(key);}catch{fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');}if(digest!==initial.keyBinding.keyDigest)fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');
    await fresh();if(poisoned)fail('IMMUTABLE_PROVIDER_CLOSED');keyPreparing=false;const result=await use(key);keyPreparing=true;await fresh();return result;
   }finally{key=null;keyClosed=true;keyPreparing=false;}
  }
  return freeze({attemptStore,processingGate,transmissionGate:processingGate,keyResolver});
 }});
}
/** Production composition always constructs the fixed PostgreSQL access adapter. */
export function createImmutableProviderRequestFacade({enabled=false,acquireClient,sealer,clock=()=>Date.now()}={}){
 return Object.freeze({async forRequest(input){if(enabled!==true)fail('IMMUTABLE_PROVIDER_DISABLED');const fixed=copy(input);if(Object.hasOwn(fixed,'candidateKind')||Object.hasOwn(fixed,'evidenceBinding')){const {createPostgresImmutableCandidateProviderAccess}=await import('./postgres-immutable-candidate-provider-access.mjs');return candidateFactory({enabled:true,access:createPostgresImmutableCandidateProviderAccess({enabled:true,acquireClient}),sealer,clock}).forRequest(fixed);}const {createPostgresImmutableProviderAccess}=await import('./postgres-immutable-provider-access.mjs');return factory({enabled:true,access:createPostgresImmutableProviderAccess({enabled:true,acquireClient}),sealer,clock}).forRequest(input);}});
}
/** Explicit synthetic dependency seam; never selected by the production composition. */
export function createImmutableProviderRequestFacadeForTesting({testOnly=false,...config}={}){if(testOnly!==true)fail('IMMUTABLE_PROVIDER_DISABLED');return factory(config);}

/** Additive v3 candidate facade. Original v2 construction above remains unchanged. */
function candidateFactory({enabled=false,access,sealer,clock=()=>Date.now()}={}){
 return Object.freeze({async forRequest(input){
  if(enabled!==true||!access||['readCandidateContext','readApproval','readProcessingApproval','registerLocalContext','createPolicyRepository'].some(k=>typeof access[k]!=='function')||typeof clock!=='function')fail('IMMUTABLE_PROVIDER_DISABLED');
  const r=copy(input);exact(r,['credential','scope','requestId','operation','destination','model','expectedAuthority','candidateKind','evidenceBinding']);
  const local=r.operation==='server_synthesis';
  // Reuse strict credential/authority/endpoint validation without requiring a key for local work.
  request({...Object.fromEntries(['credential','scope','requestId','expectedAuthority'].map(k=>[k,r[k]])),operation:'analyze',destination:local?'https://api.deepseek.com/chat/completions':r.destination,model:local?'server-deterministic':r.model});
  if(local?(r.destination!=='local'||r.model!=='server-deterministic'||r.candidateKind!=='completion_synthesis'):r.operation!=='analyze')fail('IMMUTABLE_PROVIDER_INVALID');
  r.evidenceBinding=validateProviderEvidenceBinding(r.evidenceBinding,r.candidateKind);
  if(r.candidateKind==='completion_synthesis'&&(r.evidenceBinding.synthesis.generation==='deterministic')!==local)fail('IMMUTABLE_PROVIDER_INVALID');
  if(!local&&(!sealer||['open','digest'].some(k=>typeof sealer[k]!=='function')))fail('IMMUTABLE_PROVIDER_DISABLED');
  if(r.candidateKind!=='completion_synthesis'&&r.evidenceBinding.sourceRefs.some(ref=>Object.hasOwn(ref,'derivativeSha256')))fail('IMMUTABLE_PROVIDER_INVALID');
  freeze(r);
  const base=freeze({credential:r.credential,scope:r.scope,requestId:r.requestId}),ctx=freeze({...base,candidateKind:r.candidateKind,mode:local?'local':'external',evidenceBinding:r.evidenceBinding});
  function checked(raw){const c=copy(raw);exact(c,['authority','keyRecord','keyBinding','sourceBinding','evidenceBinding']);c.evidenceBinding=validateProviderEvidenceBinding(c.evidenceBinding,r.candidateKind);if(!equal(c.evidenceBinding,r.evidenceBinding))fail('IMMUTABLE_PROVIDER_CHANGED');
   if(local){c.authority=validatePolicyAuthority(c.authority);c.sourceBinding=validateProviderSourceBinding(c.sourceBinding);if(!equal(c.authority,r.expectedAuthority)||c.keyRecord!==null||c.keyBinding!==null)fail('IMMUTABLE_PROVIDER_CHANGED');}
   else context(Object.fromEntries(['authority','keyRecord','keyBinding','sourceBinding'].map(k=>[k,c[k]])),r);return freeze(c);}
  let initial;try{initial=checked(await access.readCandidateContext(ctx));}catch{fail('IMMUTABLE_PROVIDER_CHANGED');}
  async function fresh(){let c;try{c=checked(await access.readCandidateContext(ctx));}catch{fail('IMMUTABLE_PROVIDER_CHANGED');}if(!equal(c,initial))fail('IMMUTABLE_PROVIDER_CHANGED');return c;}
  function validTime(a){const now=clock();if(!Number.isSafeInteger(now)||!Number.isSafeInteger(a.issuedAt)||a.issuedAt<0||!Number.isSafeInteger(a.expiresAt)||a.issuedAt>now||a.expiresAt<=now||a.expiresAt<=a.issuedAt||a.expiresAt-a.issuedAt>900000)fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');}
  function sameEvidence(e){const normalized=copy(e);if(r.candidateKind!=='completion_synthesis')normalized.sourceRefs=normalized.sourceRefs.map(({mediaId,sourceSha256})=>({mediaId,sourceSha256}));return equal(normalized,r.evidenceBinding);}
  async function approvalReceipt(){await fresh();let a;try{a=copy(await access.readApproval(base));exact(a,['receiptId','authority','intent','issuedAt','expiresAt']);policyId(a.receiptId);a.authority=validatePolicyAuthority(a.authority);a.intent=validatePolicyIntent(a.intent);}catch{fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');}validTime(a);const i=a.intent;
   if(local||i.schemaVersion!=='design-provider-intent-v3'||i.kind!=='external'||i.requestId!==r.requestId||i.operation!==r.operation||i.destination!==r.destination||i.model!==r.model||i.candidateKind!==r.candidateKind||!equal(a.authority,initial.authority)||!equal(i.keyBinding,initial.keyBinding)||!equal(i.sourceBinding,initial.sourceBinding)||!sameEvidence(i.evidenceBinding))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');return freeze(a);}
  const approvalIssuer=Object.freeze({async verify(input){const v=copy(input);exact(v,['action','evidence','authority','requestId']);exact(v.evidence,['requestId']);if(v.action!=='approve'||v.requestId!==r.requestId||v.evidence.requestId!==r.requestId||!equal(v.authority,initial.authority))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');return approvalReceipt();}});
  const policy=createDurableProviderPolicy({enabled:true,repository:access.createPolicyRepository(),approvalIssuer,intentResolver:approvalReceiptIntent});
  async function approvalReceiptIntent(){return (await approvalReceipt()).intent;}
  const handles=await policy.forRequest(base);
  let busy=false,poisoned=false,reserved=false,keyUsed=false,keyClosed=false,keyPreparing=false,persisted=false,prepared=false;
  const call=async fn=>{if(busy||poisoned||keyPreparing){poisoned=true;fail('IMMUTABLE_PROVIDER_CLOSED');}busy=true;try{const result=await fn();if(poisoned)fail('IMMUTABLE_PROVIDER_CLOSED');return result;}catch(e){poisoned=true;throw e;}finally{busy=false;}};
  async function derivativeApproval(disclosure){
   if(local||r.candidateKind==='completion_synthesis'||prepared)fail('IMMUTABLE_PROVIDER_INVALID');const d=copy(disclosure);exact(d,['requestId','actor','scope','provider','destination','model','stage','mayIncurCharge','candidateKind','inputDigest','sourceRefs','maxOutputTokens','costAuthorizationRequired','dataProcessingAuthorizationRequired','purpose',...(r.candidateKind==='completion_comparison'?['comparison']:[])]);
   await fresh();let a;try{a=copy(await access.readProcessingApproval(base));exact(a,['receiptId','authority','requestId','candidateKind','sourceBinding','evidenceBinding','destination','model','purpose','maxOutputTokens','issuedAt','expiresAt']);policyId(a.receiptId);a.authority=validatePolicyAuthority(a.authority);a.sourceBinding=validateProviderSourceBinding(a.sourceBinding);a.evidenceBinding=validateProviderEvidenceBinding(a.evidenceBinding,r.candidateKind);}catch{fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');}validTime(a);
   const purpose=r.candidateKind==='visual_description'?'private_image_basic_shape_candidates':'private_completion_photo_comparison';
   if(a.requestId!==r.requestId||a.candidateKind!==r.candidateKind||!equal(a.authority,initial.authority)||!equal(a.sourceBinding,initial.sourceBinding)||!equal(a.evidenceBinding,r.evidenceBinding)||a.destination!==r.destination||a.model!==r.model||a.purpose!==purpose||!Number.isSafeInteger(a.maxOutputTokens)||a.maxOutputTokens<1||a.maxOutputTokens>8192||d.requestId!==r.requestId||!equal(d.actor,initial.authority.actor)||!equal(d.scope,r.scope)||d.provider!=='deepseek'||d.destination!==r.destination||d.model!==r.model||d.stage!=='before_derivative'||d.mayIncurCharge!==false||d.candidateKind!==r.candidateKind||d.inputDigest!==initial.sourceBinding.sessionDigest||!equal(d.sourceRefs,r.evidenceBinding.sourceRefs)||d.maxOutputTokens!==a.maxOutputTokens||d.costAuthorizationRequired!==false||d.dataProcessingAuthorizationRequired!==true||d.purpose!==purpose||r.candidateKind==='completion_comparison'&&!equal(d.comparison,r.evidenceBinding.comparison))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');
   await fresh();let finalReceipt;try{finalReceipt=copy(await access.readProcessingApproval(base));}catch{fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');}if(!equal(finalReceipt,a))fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');validTime(finalReceipt);prepared=true;return true;
  }
  const processingGate=disclosure=>call(async()=>{
   const d=copy(disclosure);if(d.stage==='before_derivative')return derivativeApproval(d);if(local||r.candidateKind!=='completion_synthesis'&&!prepared)fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');
   if(d.candidateKind!==r.candidateKind||d.dataProcessingAuthorizationRequired!==true||d.costAuthorizationRequired!==(d.mayIncurCharge===true)||r.candidateKind==='completion_comparison'&&!equal(d.comparison,r.evidenceBinding.comparison)||r.candidateKind==='completion_synthesis'&&!equal(d.synthesis,r.evidenceBinding.synthesis))fail('IMMUTABLE_PROVIDER_INVALID');
   if(!persisted){const p=await policy.persistApproval({...base,evidence:{requestId:r.requestId}});if(p.active!==true)fail('IMMUTABLE_PROVIDER_APPROVAL_REQUIRED');persisted=true;}
   return handles.processingGate(d);
  });
  const attemptStore=freeze(Object.fromEntries(['bind','reserve','authorizeDispatch','authorizeReturn','settle'].map(name=>[name,value=>call(async()=>{
   let input=copy(value);
   if(name==='bind'&&local){exact(input,['key','fingerprint','disclosure']);const original=validatePolicyIntent(input.disclosure);if(Object.hasOwn(original,'schemaVersion'))fail('IMMUTABLE_PROVIDER_INVALID');
    const intent=validatePolicyIntent({...original,schemaVersion:'design-provider-intent-v3',keyBinding:null,sourceBinding:initial.sourceBinding,candidateKind:r.candidateKind,evidenceBinding:r.evidenceBinding});
    if(intent.requestId!==r.requestId)fail('IMMUTABLE_PROVIDER_INVALID');await fresh();if(await access.registerLocalContext({...base,intent})!==true)fail('IMMUTABLE_PROVIDER_CHANGED');input={...input,disclosure:intent};
   }
   const result=await handles.attemptStore[name](input);if(name==='reserve')reserved=result?.created===true;return result;
  })])));
  async function keyResolver(input,use){
   if(local||!reserved||keyUsed||keyClosed||poisoned||busy||typeof use!=='function')fail('IMMUTABLE_PROVIDER_CLOSED');keyUsed=true;keyPreparing=true;let key=null;
   try{const v=copy(input);exact(v,['credential','actor','scope','provider','destination','model']);if(v.credential!==r.credential||v.provider!=='deepseek'||!equal(v.actor,r.expectedAuthority.actor)||!equal(v.scope,r.scope)||v.destination!==r.destination||v.model!==r.model)fail('IMMUTABLE_PROVIDER_INVALID');
    await fresh();try{key=await sealer.open(initial.keyRecord.sealed,initial.keyRecord);}catch{fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');}if(typeof key!=='string'||key.length<16||key.length>500||!/^[A-Za-z0-9._~-]+$/.test(key))fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');let digest;try{digest=await sealer.digest(key);}catch{fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');}if(digest!==initial.keyBinding.keyDigest)fail('IMMUTABLE_PROVIDER_KEY_UNAVAILABLE');await fresh();if(poisoned)fail('IMMUTABLE_PROVIDER_CLOSED');keyPreparing=false;const result=await use(key);keyPreparing=true;await fresh();return result;
   }finally{key=null;keyClosed=true;keyPreparing=false;}
  }
  return freeze({attemptStore,processingGate,transmissionGate:processingGate,keyResolver});
 }});
}
export function createImmutableCandidateProviderRequestFacadeForTesting({testOnly=false,...config}={}){if(testOnly!==true)fail('IMMUTABLE_PROVIDER_DISABLED');return candidateFactory(config);}
