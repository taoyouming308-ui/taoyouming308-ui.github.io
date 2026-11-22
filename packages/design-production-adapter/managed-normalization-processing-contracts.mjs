/** Pure pre-decode structures only. Never an authorization or decode proof.
 * Original normalization artifact v1 remains byte-for-byte unchanged. */
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {managedImageDigest as digest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationParent,validateManagedImageNormalizationArtifact,MANAGED_IMAGE_NORMALIZATION_POLICY} from './managed-image-normalization-contracts.mjs';
export const NORMALIZATION_PROCESSING_INTENT_SCHEMA='design-normalization-processing-intent-v1';
export const NORMALIZATION_PROCESSING_PROVENANCE_SCHEMA='design-normalization-processing-provenance-v1';
export const CLAIMED_NORMALIZATION_SCHEMA='design-claimed-normalization-v1';
const fail=()=>{throw Error('NORMALIZATION_PROCESSING_CONTRACT_INVALID');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function createManagedNormalizationProcessingIntent(value){try{
 const q=copy(value);exact(q,['requestId','sourceRecord','parentResponse','parentObjectReceipt']);if(!id(q.requestId))fail();
 const p=validateManagedImageNormalizationParent({sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:q.parentObjectReceipt});
 return freeze({schemaVersion:NORMALIZATION_PROCESSING_INTENT_SCHEMA,purpose:'private_parent_png_normalization',requestId:q.requestId,authority:p.sourceRecord.owner,sourceRecord:p.sourceRecord,parentResponse:p.parentResponse,parentObjectReceipt:p.parentObjectReceipt,normalizationPolicy:MANAGED_IMAGE_NORMALIZATION_POLICY,maximumAttempts:1});
 }catch{fail();}}
export function validateManagedNormalizationProcessingIntent(value){try{
 const q=copy(value);exact(q,['schemaVersion','purpose','requestId','authority','sourceRecord','parentResponse','parentObjectReceipt','normalizationPolicy','maximumAttempts']);
 const out=createManagedNormalizationProcessingIntent({requestId:q.requestId,sourceRecord:q.sourceRecord,parentResponse:q.parentResponse,parentObjectReceipt:q.parentObjectReceipt});if(!equal(q,out))fail();return out;
 }catch{fail();}}
export function validateClaimedNormalizationArtifact(value){try{
 const q=copy(value);exact(q,['schemaVersion','artifact','processingProvenance']);if(q.schemaVersion!==CLAIMED_NORMALIZATION_SCHEMA)fail();
 const a=validateManagedImageNormalizationArtifact(q.artifact),p=q.processingProvenance;exact(p,['schemaVersion','claimId','permissionId','intentDigest','artifactDigest']);
 const i=createManagedNormalizationProcessingIntent({requestId:a.requestId,sourceRecord:a.sourceRecord,parentResponse:a.parentResponse,parentObjectReceipt:a.parentObjectReceipt});
 if(p.schemaVersion!==NORMALIZATION_PROCESSING_PROVENANCE_SCHEMA||!id(p.permissionId)||!sha(p.intentDigest)||!sha(p.artifactDigest)||p.intentDigest!==digest(i)||p.artifactDigest!==digest(a)||p.claimId!=='normalization-claim-'+digest(i))fail();
 return freeze({schemaVersion:CLAIMED_NORMALIZATION_SCHEMA,artifact:a,processingProvenance:p});
 }catch{fail();}}
