/**
 * Pure, independent managed-image contracts. NO I/O, attestation, current access,
 * decode, publication, model submission or adoption is performed by validation.
 * A structurally complete evidence JSON is NOT trusted evidence. Independent
 * verifier provenance and fresh repository authorization are mandatory outside
 * this module. Old media/PNG/decoded/provider-v3 contracts are not converted.
 */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';

export const MANAGED_IMAGE_SOURCE_SCHEMA='design-managed-image-source-v1';
export const MANAGED_IMAGE_PREFLIGHT_SCHEMA='design-managed-image-preflight-v1';
export const MANAGED_IMAGE_RESPONSE_SCHEMA='design-managed-image-response-v1';
export const MANAGED_IMAGE_EVIDENCE_SCHEMA='design-managed-image-evidence-v1';
export const MANAGED_IMAGE_CANDIDATE_SCHEMA='design-managed-image-candidate-v1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
/** PROVISIONAL new-contract budgets, not measured quality/model-body acceptance.
 * These do not change the old PNG-only 96KiB derivative limit. */
export const MANAGED_IMAGE_CANDIDATE_BUDGETS=freeze({1024:{'image/jpeg':256*1024,'image/png':256*1024,'image/webp':256*1024},1536:{'image/jpeg':512*1024,'image/png':512*1024,'image/webp':512*1024}});
const CODES=new Set(['MANAGED_IMAGE_CONTRACT_INVALID','MANAGED_IMAGE_BINDING_MISMATCH','MANAGED_IMAGE_BUDGET_EXCEEDED']);
export class ManagedImageContractError extends Error{
 constructor(code='MANAGED_IMAGE_CONTRACT_INVALID'){const safe=CODES.has(code)?code:'MANAGED_IMAGE_CONTRACT_INVALID';super(safe);this.name='ManagedImageContractError';this.code=safe;this.retryable=false;}
}
const fail=(code='MANAGED_IMAGE_CONTRACT_INVALID')=>{throw new ManagedImageContractError(code);};
const mismatch=()=>fail('MANAGED_IMAGE_BINDING_MISMATCH');
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const version=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const mime=v=>['image/jpeg','image/png','image/webp'].includes(v);
const checkNames=['sourceBinding','fullDecode','metadataRemoval','orientation','color','geometry'];
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);

// Snapshot own JSON data without invoking getters, Proxies, toJSON or iterators.
// All numbers in these contracts are bounded integers. Reject fractional/-0
// values globally so a DB implementation can use the same canonical domain.
function copy(input){let nodes=0,bytes=0;const charge=n=>{if((bytes+=n)>256*1024)fail();};function visit(v,depth){
 if(++nodes>4096||depth>24||types.isProxy(v))fail();
 if(v===null||typeof v==='boolean'){charge(v===null?4:v?4:5);return v;}
 if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))fail();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
 if(typeof v==='string'){if(v.length>8192)fail();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))fail();
 const keys=Reflect.ownKeys(v);if(keys.length>256)fail();
 if(Array.isArray(v)){if(keys.length!==v.length+1)fail();charge(2+Math.max(0,v.length-1));const out=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out.push(visit(d.value,depth+1));}return out;}
 charge(2+Math.max(0,keys.length-1));const out={};for(const key of keys){if(typeof key!=='string'||key.length>160||['__proto__','prototype','constructor'].includes(key))fail();const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();charge(Buffer.byteLength(JSON.stringify(key))+1);out[key]=visit(d.value,depth+1);}return out;
 }return visit(input,0);}
/** Canonical sorted-key UTF-8 JSON. Never hash PostgreSQL jsonb::text instead. */
export const managedImageCanonical=value=>canonical(copy(value));
export const managedImageDigest=value=>createHash('sha256').update(managedImageCanonical(value)).digest('hex');
function dimensions(v){exact(v,['width','height']);if(!integer(v.width,1,16384)||!integer(v.height,1,16384)||v.width*v.height>40000000)fail();}
function verifier(v){exact(v,['id','version']);if(!id(v.id)||!version(v.version))fail();}
function sourceRecord(v){
 exact(v,['schemaVersion','mediaId','requestId','owner','object','source','stage','angle','state','validation','publicEligible']);
 if(v.schemaVersion!==MANAGED_IMAGE_SOURCE_SCHEMA||!id(v.mediaId)||!id(v.requestId)||!['before','after','reference'].includes(v.stage)||!['front','back','left','right','detail'].includes(v.angle)||v.state!=='quarantined'||v.validation!=='not_performed'||v.publicEligible!==false)fail();
 try{v.owner=validateImmutableDesignAuthority(v.owner);}catch{fail();}
 exact(v.object,['projectOrigin','bucket','key','version']);const o=v.object;let validOrigin=false;try{const u=new URL(o.projectOrigin);validOrigin=u.protocol==='https:'&&u.origin===o.projectOrigin&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);}catch{}
 if(!validOrigin||typeof o.bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(o.bucket)||!version(o.version)||typeof o.key!=='string'||o.key.length>1024||!/^\w[\w./-]*$/.test(o.key)||o.key.split('/').some(p=>!p||p==='.'||p==='..'||!/^[A-Za-z0-9._-]+$/.test(p)))fail();
 // mime is a declared type, NOT decoded content or a model-ready mediaRef.
 exact(v.source,['sha256','byteLength','mime']);if(!sha(v.source.sha256)||!integer(v.source.byteLength,1,PRIVATE_MEDIA_MAX_BYTES)||!mime(v.source.mime))fail();return v;
}
export function validateManagedImageSourceRecord(value){return freeze(sourceRecord(copy(value)));}

/** Issuer/verifier must independently establish exact source bytes, orientation
 * and display dimensions. This validator does not manufacture that trust or
 * claim fullDecode, metadata removal or publication of the quarantined source. */
export function validateManagedImagePreflight(value,source){
 const v=copy(value),s=validateManagedImageSourceRecord(source);exact(v,['schemaVersion','id','sourceRecordDigest','sourceVersion','verifiedSourceSha256','verifier','display','checks']);
 if(v.schemaVersion!==MANAGED_IMAGE_PREFLIGHT_SCHEMA||!id(v.id)||!sha(v.sourceRecordDigest)||!version(v.sourceVersion)||!sha(v.verifiedSourceSha256))fail();verifier(v.verifier);dimensions(v.display);exact(v.checks,['sourceBinding','orientation','displayDimensions']);if(Object.values(v.checks).some(x=>x!=='verified'))fail();
 if(v.sourceRecordDigest!==digest(s)||v.sourceVersion!==s.object.version||v.verifiedSourceSha256!==s.source.sha256)mismatch();return freeze(v);
}
function descriptor(v,s){
 exact(v,['schemaVersion','state','requestId','mediaId','source','requestedTransform','derivative','validation']);if(v.schemaVersion!=='design-managed-image-transform-v1'||v.state!=='pending_validation'||!id(v.requestId)||v.mediaId!==s.mediaId)fail();
 exact(v.source,['bindingDigest','objectVersion','expectedSourceSha256','mime','byteLength','width','height','orientation']);const a=v.source;
 if(!sha(a.bindingDigest)||!version(a.objectVersion)||!sha(a.expectedSourceSha256)||a.orientation!=='confirmed')fail();dimensions({width:a.width,height:a.height});
 if(a.objectVersion!==s.object.version||a.expectedSourceSha256!==s.source.sha256||a.mime!==s.source.mime||a.byteLength!==s.source.byteLength)mismatch();
 // Bind the original Stage26 EXPECTED declaration, including full immutable
 // owner/object/version. This cannot prove what bytes the hosted service read.
 const declared={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:a.width,height:a.height,orientation:'confirmed',immutable:true,active:true};
 if(a.bindingDigest!==digest(declared))mismatch();
 const t=v.requestedTransform;exact(t,['maxEdge','width','height','resize','format','quality']);if(![1024,1536].includes(t.maxEdge)||t.resize!=='contain'||t.format!=='origin'||t.quality!==80)fail();const scale=Math.min(1,t.maxEdge/Math.max(a.width,a.height));if(t.width!==Math.max(1,Math.floor(a.width*scale))||t.height!==Math.max(1,Math.floor(a.height*scale)))mismatch();
 exact(v.derivative,['sha256','byteLength','mime']);if(!sha(v.derivative.sha256)||!integer(v.derivative.byteLength,1,PRIVATE_MEDIA_MAX_BYTES)||v.derivative.mime!==s.source.mime)fail();
 exact(v.validation,['sourceBytes','immutableObject','derivativeSource','fullDecode','metadataRemoval','orientation','color','geometry','candidateEligible','publicEligible']);
 if(v.validation.immutableObject!=='trusted_resolver_assertion'||v.validation.candidateEligible!==false||v.validation.publicEligible!==false||['sourceBytes','derivativeSource','fullDecode','metadataRemoval','orientation','color','geometry'].some(k=>v.validation[k]!=='not_verified'))fail();return v;
}
export function validateManagedImageResponse(value,source){
 const v=copy(value),s=validateManagedImageSourceRecord(source);exact(v,['schemaVersion','sourceRecordDigest','descriptor']);if(v.schemaVersion!==MANAGED_IMAGE_RESPONSE_SCHEMA||!sha(v.sourceRecordDigest))fail();if(v.sourceRecordDigest!==digest(s))mismatch();descriptor(v.descriptor,s);return freeze(v);
}
/** Each verified check is an assertion requiring independent trusted provenance.
 * metadataRemoval includes EXIF/GPS/private metadata; geometry includes actual
 * contain/no-crop/no-upscale behavior, not merely requested parameter equality.
 * Unknown/failed checks cannot yield evidence_complete. */
export function validateManagedImageVerificationEvidence(value,context){
 const c=copy(context);exact(c,['sourceRecord','response']);const s=validateManagedImageSourceRecord(c.sourceRecord),r=validateManagedImageResponse(c.response,s),v=copy(value);
 exact(v,['schemaVersion','id','sourceRecordDigest','responseDigest','transformDigest','verifiedSourceSha256','verifiedDerivativeSha256','verifier','checks']);
 if(v.schemaVersion!==MANAGED_IMAGE_EVIDENCE_SCHEMA||!id(v.id)||![v.sourceRecordDigest,v.responseDigest,v.transformDigest].every(sha))fail();verifier(v.verifier);exact(v.checks,checkNames);if(Object.values(v.checks).some(x=>!['unknown','failed','verified'].includes(x)))fail();
 if(v.sourceRecordDigest!==digest(s)||v.responseDigest!==digest(r)||v.transformDigest!==digest(r.descriptor.requestedTransform))mismatch();
 if(v.verifiedSourceSha256!==null&&!sha(v.verifiedSourceSha256)||v.verifiedDerivativeSha256!==null&&!sha(v.verifiedDerivativeSha256))fail();
 if((v.checks.sourceBinding==='verified')!==(v.verifiedSourceSha256!==null))fail();
 if(v.verifiedSourceSha256!==null&&v.verifiedSourceSha256!==s.source.sha256||v.verifiedDerivativeSha256!==null&&v.verifiedDerivativeSha256!==r.descriptor.derivative.sha256)mismatch();
 if(checkNames.filter(k=>k!=='sourceBinding').some(k=>v.checks[k]==='verified')&&v.verifiedDerivativeSha256===null)fail();return freeze(v);
}
function candidate(input){
 const c=copy(input);exact(c,['sourceRecord','response','evidence']);const s=validateManagedImageSourceRecord(c.sourceRecord),r=validateManagedImageResponse(c.response,s),e=c.evidence===null?null:validateManagedImageVerificationEvidence(c.evidence,{sourceRecord:s,response:r});
 const maxEdge=r.descriptor.requestedTransform.maxEdge,m=r.descriptor.derivative.mime,maximumBytes=MANAGED_IMAGE_CANDIDATE_BUDGETS[maxEdge][m];if(r.descriptor.derivative.byteLength>maximumBytes)fail('MANAGED_IMAGE_BUDGET_EXCEEDED');
 const technicalStatus=e&&checkNames.every(k=>e.checks[k]==='verified')&&e.verifiedSourceSha256!==null&&e.verifiedDerivativeSha256!==null?'evidence_complete':'blocked';
 return {schemaVersion:MANAGED_IMAGE_CANDIDATE_SCHEMA,id:digest({sourceRecord:s,response:r,evidence:e}),sourceRecord:s,response:r,evidence:e,technicalStatus,budget:{maxEdge,mime:m,maximumBytes},submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false};
}
/** Image INPUT candidate only, not a model output or confirmed salon observation.
 * evidence_complete means structurally complete, never authority to send/adopt. */
export function createManagedImageCandidate(input){return freeze(candidate(input));}
export function validateManagedImageCandidate(value){const v=copy(value);exact(v,['schemaVersion','id','sourceRecord','response','evidence','technicalStatus','budget','submissionAuthorized','adoptionAuthorized','publicEligible']);const expected=candidate({sourceRecord:v.sourceRecord,response:v.response,evidence:v.evidence});if(!same(v,expected))mismatch();return freeze(expected);}
