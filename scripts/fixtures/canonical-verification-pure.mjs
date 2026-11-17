/** Pure protocol data. Source/parent are synthetic strings, NOT qualified
 * compressed images. Binary measurements below are mocks, never an issuer or
 * real runtime qualification. The PNG is only a literal synthetic fixture. */
import {createHash} from 'node:crypto';
import {normalizedVerificationFixture} from './managed-normalized-verification.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {createManagedNormalizationProcessingIntent} from '../../packages/design-production-adapter/managed-normalization-processing-contracts.mjs';
import {MANAGED_NORMALIZED_STRICT_POLICY as POLICY,MANAGED_NORMALIZED_STRICT_VERIFIER as VERIFIER,MANAGED_NORMALIZED_STRICT_CHECKS as CHECKS,validateManagedNormalizedStrictTask,buildManagedNormalizedStrictBinding} from '../../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {syntheticCanonicalSourceBytes} from '../../packages/design-production-adapter/synthetic-canonical-image-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function canonicalVerificationPureFixture(){
 const f=normalizedVerificationFixture(),sourceRecord=structuredClone(f.sourceRecord),parentResponse=structuredClone(f.parentResponse),normalizedBytes=Buffer.from(syntheticCanonicalSourceBytes());
 const declaration={authority:sourceRecord.owner,mediaId:sourceRecord.mediaId,projectOrigin:sourceRecord.object.projectOrigin,bucket:sourceRecord.object.bucket,objectKey:sourceRecord.object.key,objectVersion:sourceRecord.object.version,expectedSourceSha256:sourceRecord.source.sha256,mime:sourceRecord.source.mime,byteLength:sourceRecord.source.byteLength,width:80,height:120,orientation:'confirmed',immutable:true,active:true};
 Object.assign(parentResponse.descriptor.source,{bindingDigest:digest(declaration),width:80,height:120});Object.assign(parentResponse.descriptor.requestedTransform,{width:80,height:120});
 const parentObjectReceipt={...f.parentObjectReceipt,responseDigest:digest(parentResponse),object:{...f.parentObjectReceipt.object,key:'managed-derived/'+digest(parentResponse)+'/object'}};
 const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-canonical-pure',sourceRecord,parentResponse,parentObjectReceipt,output:{sha256:sha(normalizedBytes),byteLength:normalizedBytes.length,mime:'image/png',width:80,height:120}}),intent=createManagedNormalizationProcessingIntent({requestId:artifact.requestId,sourceRecord,parentResponse,parentObjectReceipt});
 const claimedArtifact={schemaVersion:'design-claimed-normalization-v1',artifact,processingProvenance:{schemaVersion:'design-normalization-processing-provenance-v1',claimId:'normalization-claim-'+digest(intent),permissionId:'synthetic-canonical-processing',intentDigest:digest(intent),artifactDigest:digest(artifact)}};
 const objectReceipt={...f.objectReceipt,artifactDigest:digest(artifact),object:{...f.objectReceipt.object,key:'managed-normalized/'+digest(artifact)+'/object'},output:artifact.output};
 const task=validateManagedNormalizedStrictTask({schemaVersion:'design-normalized-strict-task-v1',taskId:'canonical-pure-task',claimedArtifact,objectReceipt,fixtureId:POLICY.fixture.id,verifier:VERIFIER,policy:POLICY}),query={credential:'SYNTHETIC_CANONICAL_CREDENTIAL'.padEnd(40,'x'),scope:sourceRecord.owner.scope,taskId:task.taskId};
 return {...f,sourceRecord,parentResponse,parentObjectReceipt,artifact,objectReceipt,sourceBytes:Buffer.from(f.sourceBytes),parentBytes:Buffer.from(f.parentBytes),normalizedBytes,task,query};
}
export function canonicalBinaryResult(task,{check='verified'}={}){
 const a=task.claimedArtifact.artifact,png=d=>({sha256:d.sha256,byteLength:d.byteLength,mime:'image/png',width:80,height:120,frameCount:1,pixelSha256:'e'.repeat(64),compressedBytes:100,consumedCompressedBytes:100,metadataAbsent:true}),producer=d=>({...d,producerSha256:d.sha256,producerByteLength:d.byteLength});
 return {schemaVersion:'design-normalized-strict-binary-result-v1',bindingDigest:digest(buildManagedNormalizedStrictBinding(task)),fixture:png(POLICY.fixture),source:producer(a.sourceRecord.source),parent:producer(a.parentObjectReceipt.derivative),normalized:png(a.output),reference:png(a.output),checks:Object.fromEntries(CHECKS.map(k=>[k,check]))};
}
