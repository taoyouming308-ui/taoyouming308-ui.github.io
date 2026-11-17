/** Pure protocol fixture. These strings are not decodable images or evidence. */
import {createHash} from 'node:crypto';
import {managedImageResultFixture} from './managed-image-result.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function normalizedVerificationFixture(){
 const f=managedImageResultFixture(),sourceBytes=Buffer.from('SYNTHETIC source'),parentBytes=Buffer.from('SYNTHETIC parent'),normalizedBytes=Buffer.from('SYNTHETIC normalized');
 const sourceRecord=structuredClone(f.sourceRecord);sourceRecord.source={sha256:sha(sourceBytes),byteLength:sourceBytes.length,mime:'image/jpeg'};
 const d={authority:sourceRecord.owner,mediaId:sourceRecord.mediaId,projectOrigin:sourceRecord.object.projectOrigin,bucket:sourceRecord.object.bucket,objectKey:sourceRecord.object.key,objectVersion:sourceRecord.object.version,expectedSourceSha256:sourceRecord.source.sha256,mime:'image/jpeg',byteLength:sourceBytes.length,width:3000,height:2000,orientation:'confirmed',immutable:true,active:true};
 const parentResponse=structuredClone(f.response);parentResponse.sourceRecordDigest=digest(sourceRecord);parentResponse.descriptor.source={bindingDigest:digest(d),objectVersion:d.objectVersion,expectedSourceSha256:d.expectedSourceSha256,mime:d.mime,byteLength:d.byteLength,width:d.width,height:d.height,orientation:d.orientation};
 parentResponse.descriptor.derivative={sha256:sha(parentBytes),byteLength:parentBytes.length,mime:'image/jpeg'};
 const parentObjectReceipt={...structuredClone(f.objectReceipt),responseDigest:digest(parentResponse),object:{...f.objectReceipt.object,key:'managed-derived/'+digest(parentResponse)+'/object'},derivative:parentResponse.descriptor.derivative};
 const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-test',sourceRecord,parentResponse,parentObjectReceipt,output:{sha256:sha(normalizedBytes),byteLength:normalizedBytes.length,mime:'image/png',width:1024,height:682}});
 const objectReceipt={schemaVersion:'design-managed-normalized-object-v1',artifactDigest:digest(artifact),object:{...sourceRecord.object,key:'managed-normalized/'+digest(artifact)+'/object',version:'normalized-v1'},output:artifact.output,private:true,readbackVerified:true};
 const verifier={id:'synthetic-normalized-verifier',version:'1'},policyVersion='synthetic-normalized-policy-1',taskId='normalized-test',input={credential:'synthetic-verification-token',scope:f.scope,taskId};
 return {...f,sourceRecord,parentResponse,parentObjectReceipt,artifact,objectReceipt,sourceBytes,parentBytes,normalizedBytes,verifier,policyVersion,taskId,input};
}
export function normalizedBinaryResult(f,binding,patch={}){
 const measurements=(d,width,height,source=false)=>({...d,frameCount:1,...(source?{displayWidth:width,displayHeight:height}:{width,height})});
 const {width,height,...output}=f.artifact.output;
 return {schemaVersion:'design-managed-normalized-binary-result-v1',bindingDigest:digest(binding),verifier:f.verifier,policyVersion:f.policyVersion,source:measurements(f.sourceRecord.source,3000,2000,true),parent:measurements(f.parentObjectReceipt.derivative,1024,682),normalized:measurements(output,width,height),checks:Object.fromEntries(['sourceBinding','parentBinding','fullDecode','metadataRemoval','orientation','color','geometry'].map(k=>[k,'verified'])),...patch};
}
