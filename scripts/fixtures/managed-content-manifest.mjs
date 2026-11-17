/** Pure synthetic byte metadata, not an image/decoder/storage qualification. */
import {createHash} from 'node:crypto';
import {
  createManagedContentWriteIntent,createManagedContentManifest,
  managedContentManifestReference,managedContentDigest
} from '../../packages/design-production-adapter/managed-content-manifest-contracts.mjs';
export function managedContentManifestFixture(){
  const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
  const authority={schemaVersion:'design-immutable-authority-v1',subjectId:'subject-1',employmentId:'employment-1',membershipId:'membership-1',securityEpoch:1,membershipRevision:1,storeId:'store-1',actor:{username:'synthetic-employee',store:'synthetic-store'},scope:structuredClone(scope),bindingRevision:'binding-1'};
  const target={projectOrigin:'https://syntheticcontent.supabase.co',bucket:'synthetic-private'};
  const bytes=Uint8Array.from(Buffer.from('synthetic-source-bytes-no-decode'));
  const sourceInput={authority,requestId:'source-write-1',assetId:'source-asset-1',role:'source',expectedRevision:0,expectedManifestDigest:null,content:{sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,mime:'image/jpeg'},target,ancestry:{source:null,parent:null},processing:null};
  const sourceIntent=createManagedContentWriteIntent(sourceInput),source=createManagedContentManifest({intent:sourceIntent,previous:null,ancestors:[]}),sourceRef=managedContentManifestReference(source);
  const parentInput={...sourceInput,requestId:'parent-write-1',assetId:'parent-asset-1',role:'hosted_parent',content:{sha256:'b'.repeat(64),byteLength:256,mime:'image/jpeg'},ancestry:{source:sourceRef,parent:null},processing:{kind:'hosted_transform',requestId:'parent-write-1',intentDigest:'c'.repeat(64),claimId:'transform-claim-1',artifactDigest:'d'.repeat(64)}};
  const parentIntent=createManagedContentWriteIntent(parentInput),parent=createManagedContentManifest({intent:parentIntent,previous:null,ancestors:[source]}),parentRef=managedContentManifestReference(parent);
  const normalizedInput={...sourceInput,requestId:'normalize-write-1',assetId:'normalized-asset-1',role:'normalized_png',content:{sha256:'e'.repeat(64),byteLength:512,mime:'image/png'},ancestry:{source:sourceRef,parent:parentRef},processing:{kind:'png_normalization',requestId:'normalize-write-1',intentDigest:'f'.repeat(64),claimId:'normalization-claim-1',artifactDigest:'a'.repeat(64)}};
  const normalizedIntent=createManagedContentWriteIntent(normalizedInput),normalized=createManagedContentManifest({intent:normalizedIntent,previous:null,ancestors:[source,parent]});
  return {scope,authority,target,bytes,sourceInput,sourceIntent,source,sourceRef,parentInput,parentIntent,parent,parentRef,normalizedInput,normalizedIntent,normalized,normalizedRef:managedContentManifestReference(normalized),digest:managedContentDigest};
}
