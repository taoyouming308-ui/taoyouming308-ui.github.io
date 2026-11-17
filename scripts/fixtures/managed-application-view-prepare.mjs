/** Synthetic structure/measurements only. This fixture does NOT run a decoder,
 * storage backend, processing issuer or verifier. Never use as real evidence. */
import {createHash} from 'node:crypto';
import {managedContentManifestFixture} from './managed-content-manifest.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
import * as C from '../../packages/design-production-adapter/managed-application-image-contracts.mjs';
export function managedApplicationViewPrepareFixture({stage='after',angle='front'}={}){
 const f=managedContentManifestFixture(),sourceManifest=f.source,sourceBytes=f.bytes;
 const sourceBinding=C.createManagedApplicationSourceBinding({authority:f.authority,requestId:sourceManifest.requestId,mediaId:sourceManifest.assetId,stage,angle,sourceManifest});
 const intent=C.createManagedApplicationProcessingIntent({requestId:'direct-normalize-1',authority:f.authority,sourceBinding,sourceManifest});
 const normalizedBytes=Uint8Array.from(Buffer.from('synthetic-PNG-placeholder-NOT-REAL-DECODE'));
 const output={sha256:createHash('sha256').update(normalizedBytes).digest('hex'),byteLength:normalizedBytes.length,mime:'image/png',width:80,height:120};
 const artifact=C.createManagedApplicationNormalizationArtifact({intent,output}),claimedArtifact=C.createClaimedApplicationNormalizationArtifact({artifact,permissionId:'processing-permission-1'});
 const writeIntent=C.createManagedApplicationContentWriteIntent({claimedArtifact}),normalizedManifest=C.createManagedApplicationContentManifest({intent:writeIntent,claimedArtifact});
 const task=C.validateManagedApplicationStrictTask({schemaVersion:'design-normalized-strict-task-v2',taskId:'application-task-1',claimedArtifact,normalizedManifest,fixtureId:C.MANAGED_APPLICATION_DIRECT_POLICY.fixture.id,verifier:C.MANAGED_APPLICATION_DIRECT_VERIFIER,policy:C.MANAGED_APPLICATION_DIRECT_POLICY});
 const binding=C.buildManagedApplicationStrictBinding(task),checks=Object.fromEntries(C.MANAGED_APPLICATION_DIRECT_CHECKS.map(k=>[k,'verified']));
 const png=m=>({...m,width:80,height:120,frameCount:1,pixelSha256:'e'.repeat(64),compressedBytes:10,consumedCompressedBytes:10,metadataAbsent:true});
 const binaryResult={schemaVersion:'design-normalized-strict-binary-result-v2',bindingDigest:digest(binding),fixture:png({sha256:task.policy.fixture.sha256,byteLength:task.policy.fixture.byteLength,mime:'image/png'}),source:{...sourceManifest.content,producerSha256:sourceManifest.content.sha256,producerByteLength:sourceManifest.content.byteLength},normalized:png({sha256:output.sha256,byteLength:output.byteLength,mime:'image/png'}),reference:png({sha256:output.sha256,byteLength:output.byteLength,mime:'image/png'}),checks};
 const report=C.buildManagedApplicationStrictReport({task,binaryResult}),input=null;
 return {scope:f.scope,authority:f.authority,target:f.target,sourceManifest,sourceBytes,sourceBinding,intent,output,artifact,claimedArtifact,writeIntent,normalizedManifest,task,binding,binaryResult,report,input,normalizedBytes,digest};
}
