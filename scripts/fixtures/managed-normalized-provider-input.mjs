/** Protocol-only fixture. No actual approvals or image validation. */
import {createHash} from 'node:crypto';
import {managedImageResultFixture} from './managed-image-result.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageNormalizationArtifact} from '../../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {createManagedNormalizationProcessingIntent} from '../../packages/design-production-adapter/managed-normalization-processing-contracts.mjs';
import {MANAGED_NORMALIZED_STRICT_POLICY as POLICY,MANAGED_NORMALIZED_STRICT_VERIFIER as VERIFIER,MANAGED_NORMALIZED_STRICT_CHECKS as CHECKS,createManagedNormalizedStrictReport} from '../../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {syntheticCanonicalSourceBytes} from '../../packages/design-production-adapter/synthetic-canonical-image-fixture.mjs';
const clone=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
export function normalizedProviderInputFixture({stage='before',angle='front',version='final-1',subject='subject-1',bytes=syntheticCanonicalSourceBytes(),state='verified'}={}){
 const f=managedImageResultFixture(),s=clone(f.sourceRecord);s.owner.subjectId=subject;s.stage=stage;s.angle=angle;
 const d={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:80,height:120,orientation:'confirmed',immutable:true,active:true};
 const p=clone(f.response);p.sourceRecordDigest=digest(s);p.descriptor.source={bindingDigest:digest(d),objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:80,height:120,orientation:'confirmed'};p.descriptor.requestedTransform.width=80;p.descriptor.requestedTransform.height=120;
 const parent={...clone(f.objectReceipt),responseDigest:digest(p),object:{...s.object,key:'managed-derived/'+digest(p)+'/object',version:'parent-1'},derivative:clone(p.descriptor.derivative)};
 const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-1',sourceRecord:s,parentResponse:p,parentObjectReceipt:parent,output:{sha256:hash(bytes),byteLength:bytes.length,mime:'image/png',width:80,height:120}});
 const intent=createManagedNormalizationProcessingIntent({requestId:artifact.requestId,sourceRecord:s,parentResponse:p,parentObjectReceipt:parent});
 const claimedArtifact={schemaVersion:'design-claimed-normalization-v1',artifact,processingProvenance:{schemaVersion:'design-normalization-processing-provenance-v1',claimId:'normalization-claim-'+digest(intent),permissionId:'synthetic-permission',intentDigest:digest(intent),artifactDigest:digest(artifact)}};
 const objectReceipt={schemaVersion:'design-managed-normalized-object-v1',artifactDigest:digest(artifact),object:{...s.object,key:'managed-normalized/'+digest(artifact)+'/object',version},output:clone(artifact.output),private:true,readbackVerified:true};
 const task={schemaVersion:'design-normalized-strict-task-v1',taskId:'strict-task-1',claimedArtifact,objectReceipt,fixtureId:POLICY.fixture.id,verifier:clone(VERIFIER),policy:clone(POLICY)};
 const report=createManagedNormalizedStrictReport({task,checks:Object.fromEntries(CHECKS.map(k=>[k,state]))});
 const packet={task,report},calls={ledger:[],storage:[]},q={credential:'SYNTHETIC_'+ 'x'.repeat(40),scope:s.owner.scope,taskId:task.taskId,requestId:'preview-1'};
 const config={enabled:true,ledger:{async readVerified(v){calls.ledger.push(v);return clone(packet);}},storage:{async read(v){calls.storage.push(v);return bytes;}},modelConfig:{model:'synthetic-vision',maxOutputTokens:128},approvedModels:['synthetic-vision']};
 return {f,packet,bytes,q,calls,config};
}
