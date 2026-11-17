/** Pure, additive THREE-object contracts, not an issuer or trusted verifier.
 * Source -> unchanged hosted parent -> distinct private normalized PNG.
 * Old response/object/report v1 meanings and bytes are never upgraded in place.
 *
 * The context below must come from a fixed, independently authorized task:
 * taskId, expected verifier/policy, current immutable authority/scope and all
 * immutable object versions. A browser's context or structurally complete JSON
 * is NOT that provenance. Only the independent verifier role may publish a
 * report after actual reads/inspection. Runtime reads must freshly check the
 * task, source/parent/PNG access, processing/storage approvals, expiry and
 * revocation. No TTL, signature, bearer, authorization token or retry is created.
 *
 * sourceBinding means actual source-to-hosted-parent relationship, not matching
 * declared hashes. parentBinding means actual parent-to-final-PNG pixel equality.
 * fullDecode covers ALL THREE byte streams. metadataRemoval applies to the final
 * PNG only; the original source/parent may retain EXIF and are not rewritten.
 * orientation/color/geometry are independently verified along the full lineage.
 * Even evidence_complete grants no model submission, adoption or public access.
 */
import {
 managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord
} from './managed-image-contracts.mjs';
import {
 validateManagedImageNormalizationArtifact,managedImageNormalizationBinding
} from './managed-image-normalization-contracts.mjs';

export const MANAGED_NORMALIZED_OBJECT_SCHEMA='design-managed-normalized-object-v1';
export const MANAGED_NORMALIZED_VERIFICATION_BINDING_SCHEMA='design-managed-normalized-verification-binding-v1';
export const MANAGED_NORMALIZED_VERIFICATION_REPORT_SCHEMA='design-managed-normalized-verification-report-v1';
export const MANAGED_NORMALIZED_EVIDENCE_SCHEMA='design-managed-normalized-evidence-v1';
export const MANAGED_NORMALIZED_VERIFICATION_CHECKS=Object.freeze(['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry']);
export class ManagedNormalizedVerificationContractError extends Error{
 constructor(){super('MANAGED_NORMALIZED_VERIFICATION_INVALID');this.name='ManagedNormalizedVerificationContractError';this.code=this.message;this.retryable=false;this.outcome='not_sent';}
}
const fail=()=>{throw new ManagedNormalizedVerificationContractError();};
const copy=v=>JSON.parse(managedImageCanonical(v));
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const version=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(v);
function receipt(value,artifact){
 const v=copy(value);exact(v,['schemaVersion','artifactDigest','object','output','private','readbackVerified']);
 if(v.schemaVersion!==MANAGED_NORMALIZED_OBJECT_SCHEMA||v.artifactDigest!==managedImageDigest(artifact)||v.private!==true||v.readbackVerified!==true||!same(v.output,artifact.output))fail();
 // Reuse the original private object grammar, without treating its dimensions
 // or readbackVerified storage assertion as image-decode evidence.
 validateManagedImageSourceRecord({...artifact.sourceRecord,object:v.object});
 const source=artifact.sourceRecord.object,parent=artifact.parentObjectReceipt.object;
 if(v.object.projectOrigin!==source.projectOrigin||v.object.bucket!==source.bucket||v.object.key===source.key||v.object.key===parent.key)fail();
 return freeze(v);
}
export function validateManagedNormalizedObjectReceipt(value,context){try{
 const c=copy(context);exact(c,['artifact']);const artifact=validateManagedImageNormalizationArtifact(c.artifact);return receipt(value,artifact);
 }catch{fail();}}
function binding(context){
 const c=copy(context);exact(c,['taskId','artifact','objectReceipt','verifier','policyVersion']);
 if(!id(c.taskId)||!version(c.policyVersion))fail();exact(c.verifier,['id','version']);if(!id(c.verifier.id)||!version(c.verifier.version))fail();
 const artifact=validateManagedImageNormalizationArtifact(c.artifact),object=receipt(c.objectReceipt,artifact);
 return freeze({...managedImageNormalizationBinding(artifact),schemaVersion:MANAGED_NORMALIZED_VERIFICATION_BINDING_SCHEMA,
  taskId:c.taskId,normalizedObjectReceiptDigest:managedImageDigest(object),normalizedObject:object.object,
  normalizedSha256:object.output.sha256,verifier:c.verifier,policyVersion:c.policyVersion});
}
/** Builds an exact guard binding from trusted task metadata; it does not grant
 * that trust, read objects, verify pixels or check current access itself. */
export function buildManagedNormalizedVerificationBinding(context){try{return binding(context);}catch{fail();}}
function evidence(b,checks){return {schemaVersion:MANAGED_NORMALIZED_EVIDENCE_SCHEMA,
 id:'normalized-verification-'+managedImageDigest({binding:b,checks}),verificationBindingDigest:managedImageDigest(b),
 verifier:b.verifier,policyVersion:b.policyVersion,checks};}
export function validateManagedNormalizedVerificationReport(value,context){try{
 // Snapshot value/context separately before accessing any fields. Exact task
 // verifier and policy come from context, NEVER from the presented report.
 const v=copy(value),b=binding(context);exact(v,['schemaVersion','state','verificationBinding','checks','evidence','submissionAuthorized','adoptionAuthorized','publicEligible']);
 if(v.schemaVersion!==MANAGED_NORMALIZED_VERIFICATION_REPORT_SCHEMA||v.submissionAuthorized!==false||v.adoptionAuthorized!==false||v.publicEligible!==false||!same(v.verificationBinding,b))fail();
 exact(v.checks,MANAGED_NORMALIZED_VERIFICATION_CHECKS);
 const checks=Object.values(v.checks);if(checks.some(x=>!['unknown','failed','verified'].includes(x)))fail();
 const state=checks.includes('failed')?'validation_failed':checks.every(x=>x==='verified')?'evidence_complete':'pending_validation';
 if(v.state!==state)fail();if(state==='evidence_complete'){if(!same(v.evidence,evidence(b,v.checks)))fail();}else if(v.evidence!==null)fail();
 return freeze(v);
 }catch{fail();}}
