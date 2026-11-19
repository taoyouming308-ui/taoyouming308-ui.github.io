/** Additive, pure lineage for a new PNG made from an unchanged hosted JPEG/WebP.
 * NO decoding, storage, attestation, authorization, issuer, model or I/O here.
 * Every SHA is a bound declaration until actual byte reads and an independent
 * verifier establish it. The original response/object are retained unchanged;
 * a new PNG must never replace their bytes, hashes or old verification report.
 *
 * This server-only object contains private object locators. Do not return it to
 * a browser. Runtime policy selection is fixed, not a client setting. Even a
 * passing local normalization experiment produces only pending_validation.
 * A future independent normalized-object receipt/report must bind ALL three
 * immutable versions (source, hosted parent, final PNG), with fresh authority,
 * processing/storage approvals and their original expiry/revocation state.
 */
import {
 managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord,
 validateManagedImageResponse,MANAGED_IMAGE_CANDIDATE_BUDGETS
} from './managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt} from './managed-image-verification.mjs';

export const MANAGED_IMAGE_NORMALIZATION_SCHEMA='design-managed-image-normalization-v1';
export const MANAGED_IMAGE_NORMALIZATION_BINDING_SCHEMA='design-managed-image-normalization-binding-v1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const MANAGED_IMAGE_NORMALIZATION_POLICY=freeze({
 id:'managed-imgproxy-png-normalization',version:'1',
 runtime:{id:'supabase-imgproxy',version:'3.8.0',imageDigest:'sha256:0facd355d50f3be665ebe674486f2b2e9cdaebd3f74404acd9b7fece2f661435'},
 inputMimeTypes:['image/jpeg','image/webp'],outputMime:'image/png',resize:'none',
 parentOrientation:'absent_or_identity',color:'srgb',pixelEquality:'exact_srgb',
 metadata:'strip_all',maximumFrames:1,
 // After fixed decoding, validate PNG CRC/order and permit only IHDR/pHYs/
 // IDAT/IEND; remove pHYs alone. Final IHDR/IDAT/IEND bytes need a separate full
 // decode and pixel comparison. Unknown chunks, APNG and trailing data reject.
 containerNormalization:'remove_pHYs_only',outputPixelFormat:'rgb8_noninterlaced'
});
export class ManagedImageNormalizationContractError extends Error{
 constructor(){super('MANAGED_NORMALIZATION_CONTRACT_INVALID');this.name='ManagedImageNormalizationContractError';this.code=this.message;this.retryable=false;this.outcome='not_sent';}
}
const fail=()=>{throw new ManagedImageNormalizationContractError();};
const copy=v=>JSON.parse(managedImageCanonical(v));
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const CHECKS=['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry'];
function parent(input){
 const q=copy(input);exact(q,['sourceRecord','parentResponse','parentObjectReceipt']);
 const sourceRecord=validateManagedImageSourceRecord(q.sourceRecord),parentResponse=validateManagedImageResponse(q.parentResponse,sourceRecord);
 const parentObjectReceipt=validateManagedDerivedObjectReceipt(q.parentObjectReceipt,{sourceRecord,response:parentResponse});
 const p=parentObjectReceipt.derivative,t=parentResponse.descriptor.requestedTransform;
 if(!MANAGED_IMAGE_NORMALIZATION_POLICY.inputMimeTypes.includes(p.mime))fail();
 return freeze({sourceRecord,parentResponse,parentObjectReceipt,normalizationPolicy:MANAGED_IMAGE_NORMALIZATION_POLICY,
  maximumOutputBytes:MANAGED_IMAGE_CANDIDATE_BUDGETS[t.maxEdge]['image/png'],expectedOutput:{mime:'image/png',width:t.width,height:t.height}});
}
/** Parent structure and declared geometry only. Does not independently prove
 * orientation, bytes or immutable storage. It may be used before producing PNG. */
export function validateManagedImageNormalizationParent(value){try{return parent(value);}catch{fail();}}
function build(input){
 const q=copy(input);exact(q,['requestId','sourceRecord','parentResponse','parentObjectReceipt','output']);if(!id(q.requestId))fail();
 const {sourceRecord,parentResponse,parentObjectReceipt,maximumOutputBytes}=parent({sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:q.parentObjectReceipt});
 const t=parentResponse.descriptor.requestedTransform,output=q.output;
 // Preserve existing source <=8MiB and original derivative <=256/512KiB checks.
 // Large PNG output is an explicit failure, never a reason to relax old limits.
 exact(output,['sha256','byteLength','mime','width','height']);
 if(!sha(output.sha256)||output.mime!=='image/png'||!integer(output.byteLength,1,maximumOutputBytes)||!integer(output.width,1,t.maxEdge)||!integer(output.height,1,t.maxEdge)||output.width!==t.width||output.height!==t.height)fail();
 const body={schemaVersion:MANAGED_IMAGE_NORMALIZATION_SCHEMA,requestId:q.requestId,
  authority:sourceRecord.owner,sourceRecord,parentResponse,parentObjectReceipt,
  normalizationPolicy:MANAGED_IMAGE_NORMALIZATION_POLICY,output,
  state:'pending_validation',validation:Object.fromEntries(CHECKS.map(k=>[k,'not_verified'])),
  submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false};
 return freeze({...body,id:'normalization-'+managedImageDigest(body)});
}
/** Binding/structure only; callers must supply output claims from their fixed
 * server runtime, never treat this constructor as validation of image bytes. */
export function createManagedImageNormalizationArtifact(input){try{return build(input);}catch{fail();}}
export function validateManagedImageNormalizationArtifact(value){try{
 const v=copy(value);exact(v,['schemaVersion','id','requestId','authority','sourceRecord','parentResponse','parentObjectReceipt','normalizationPolicy','output','state','validation','submissionAuthorized','adoptionAuthorized','publicEligible']);
 const expected=build({requestId:v.requestId,sourceRecord:v.sourceRecord,parentResponse:v.parentResponse,parentObjectReceipt:v.parentObjectReceipt,output:v.output});
 if(!same(v,expected))fail();return expected;
 }catch{fail();}}
/** Exact server guard input, NOT a capability or proof of current access.
 * Artifact digest commits the complete original records and fixed policy.
 * There is intentionally no invented final PNG object/version before storage.
 */
export function managedImageNormalizationBinding(value){try{
 const a=validateManagedImageNormalizationArtifact(value),s=a.sourceRecord,p=a.parentResponse,o=a.parentObjectReceipt;
 return freeze({schemaVersion:MANAGED_IMAGE_NORMALIZATION_BINDING_SCHEMA,artifactDigest:managedImageDigest(a),requestId:a.requestId,authority:s.owner,scope:s.owner.scope,
  sourceRecordDigest:managedImageDigest(s),sourceObject:s.object,sourceSha256:s.source.sha256,
  parentResponseDigest:managedImageDigest(p),parentObjectReceiptDigest:managedImageDigest(o),parentObject:o.object,parentSha256:o.derivative.sha256,
  transformDigest:managedImageDigest(p.descriptor.requestedTransform),normalizationPolicyDigest:managedImageDigest(a.normalizationPolicy),output:a.output});
 }catch{fail();}}
