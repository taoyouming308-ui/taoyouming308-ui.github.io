/** Isolated PG only. Storage is a version-specific private Map mock. Source and
 * parent BYTES are supplied by the caller: real runtime tests supply real pinned
 * producer bytes; protocol-only tests explicitly use synthetic mock bytes. No
 * normalized bytes are created here, and no image qualification is asserted.
 * All issuer calls are fixture-only explicit test setup, never runtime config. */
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createNormalizationProcessingFixture} from './normalization-processing.mjs';
import {createCanonicalVerificationLedger,createCanonicalVerificationIssuers} from '../../packages/design-production-adapter/managed-canonical-verification-ledger.mjs';
import {MANAGED_NORMALIZED_STRICT_POLICY as POLICY,MANAGED_NORMALIZED_STRICT_VERIFIER as VERIFIER} from '../../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {createManagedImageService} from '../../packages/design-production-adapter/managed-image-service.mjs';
import {createManagedImageTransform} from '../../packages/design-production-adapter/managed-image-transform.mjs';
import {createManagedImagePersistenceSink} from '../../packages/design-production-adapter/managed-image-persistence-sink.mjs';
import {createManagedDerivedStore} from '../../packages/design-production-adapter/managed-derived-store.mjs';
import {createManagedNormalizedStore} from '../../packages/design-production-adapter/managed-normalized-store.mjs';
import {createManagedImageNormalizationArtifact} from '../../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),q=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>q(JSON.stringify(v))+'::jsonb';
export async function createCanonicalVerificationFixture(){const f=await createNormalizationProcessingFixture();try{
 const oldSQL="SELECT md5(string_agg(p.oid::text||p.prosrc||coalesce(p.proacl::text,''),'|' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('design_managed_image','design_managed_derived','design_managed_normalized','design_identity','design_normalization_processing')",oldDefinitions=f.sqlAdmin(oldSQL);
 f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage34-canonical-verification-fixture.sql',import.meta.url),'utf8'));assert.equal(f.sqlAdmin(oldSQL),oldDefinitions);
 // Exactly once, as isolated fixture owner. Runtime and both issuers cannot seed config.
 f.sqlAdmin(`INSERT INTO design_canonical_verification.config VALUES(true,${json(POLICY)},${json(VERIFIER)})`);
 const client=role=>async()=>{const c=f.clientForRole(role,'canonical-fixture');return {...c,async query(sql,p){try{return await c.query(sql,p);}catch(e){console.log('CANONICAL_SQL_DIAGNOSTIC '+JSON.stringify({role,operation:sql.match(/design_canonical_verification\.([a-z_]+)\(/)?.[1]??'fixed_transaction',sqlstate:/^[A-Z0-9]{5}$/.test(e?.code)?e.code:'unknown',category:/^[A-Z_]{1,80}$/.test(e?.message)?e.message:'other'}));throw e;}}};};
 const acquireCanonicalReader=client('design_normalization_runtime'),acquireCanonicalAuthorizer=client('design_canonical_authorizer'),acquireCanonicalVerifier=client('design_canonical_verifier');
 const canonicalLedger=createCanonicalVerificationLedger({enabled:true,acquireClient:acquireCanonicalReader}),canonicalIssuers=createCanonicalVerificationIssuers({enabled:true,acquireAuthorizerClient:acquireCanonicalAuthorizer,acquireVerifierClient:acquireCanonicalVerifier});
 const {credential,scope}=f,projectOrigin='https://syntheticmanaged.supabase.co',bucket='managed-private',objects=new Map();let puts=0,transports=0;
 const canonicalStorage={async putImmutable(r){assert.equal(r.private,true);assert.equal(r.overwrite,false);const key=digest(r.target);assert(!objects.has(key),'immutable synthetic target');const d=r.source??r.derivative??r.output,bytes=Uint8Array.from(r.bytes);assert.equal(hash(bytes),d.sha256);assert.equal(bytes.length,d.byteLength);const version='canonical-object-'+(++puts);objects.set(key,{bytes,version});return {target:r.target,objectVersion:version,sha256:d.sha256,byteLength:d.byteLength,mime:d.mime,created:true,private:true,immutable:true};},async read({object}){const {version,...target}=object,row=objects.get(digest(target));assert(row&&row.version===version,'exact synthetic private object version');return Uint8Array.from(row.bytes);}};
 const makeParentStore=()=>createManagedDerivedStore({enabled:true,repository:f.derivedLedger,storage:canonicalStorage,projectOrigin,bucket,cost:f.cost,timeoutMs:10000});
 const makeNormalizedStore=()=>createManagedNormalizedStore({enabled:true,repository:f.normalizedLedger,storage:canonicalStorage,projectOrigin,bucket,cost:f.cost,timeoutMs:10000});
 async function seedCanonicalParent({id,mime,sourceBytes,parentBytes}){
  assert(/^[A-Za-z0-9_-]{1,70}$/.test(id));assert(['image/jpeg','image/webp'].includes(mime));const src=Uint8Array.from(sourceBytes),parent=Uint8Array.from(parentBytes);assert(src.length>0&&src.length<=8388608);assert(parent.length>0&&parent.length<=262144);
  const mediaId='canonical-'+id,uploadId='upload-'+id,upload={schemaVersion:'design-managed-image-upload-intent-v1',requestId:uploadId,mediaId,authority:f.authority,target:{projectOrigin,bucket,key:'managed-quarantine/'+digest({authority:f.authority,mediaId})+'/source'},source:{sha256:hash(src),byteLength:src.length,mime},stage:'before',angle:'front',cost:f.cost};
  await f.issuers.issueStorage({credential,scope,receiptId:'storage-'+id,binding:upload,budget:f.cost,ttlMs:900000});
  const service=createManagedImageService({enabled:true,repository:f.ledger,storage:canonicalStorage,projectOrigin,bucket,storageCost:f.cost,timeoutMs:10000});
  await service.upload({credential,scope,mediaId,requestId:uploadId,bytes:src,mime,stage:'before',angle:'front'});
  const {sourceRecord}=await f.ledger.readSourceStatus({credential,scope,mediaId});
  await f.issuers.issuePreflight({credential,scope,sourceRecord,preflight:{schemaVersion:'design-managed-image-preflight-v1',id:'preflight-'+id,sourceRecordDigest:digest(sourceRecord),sourceVersion:sourceRecord.object.version,verifiedSourceSha256:sourceRecord.source.sha256,verifier:{id:'synthetic-fixed-80x120',version:'1'},display:{width:80,height:120},checks:{sourceBinding:'verified',orientation:'verified',displayDimensions:'verified'}}});
  const parentRequestId='parent-'+id,source=await f.ledger.resolveSource({credential,scope,mediaId,phase:'initial'}),transformIntent={schemaVersion:'design-managed-image-transform-intent-v1',requestId:parentRequestId,purpose:'private_image_managed_transform_quarantine',recipient:projectOrigin,bucket,source,maxEdge:1024,transform:{width:80,height:120,resize:'contain',format:'origin',quality:80},maxResponseBytes:262144};await f.approve(transformIntent);
  const sink=createManagedImagePersistenceSink({enabled:true,repository:f.ledger,store:makeParentStore()});
  const transform=createManagedImageTransform({enabled:true,projectOrigin,bucket,...f.ledger,timeoutMs:10000,maxResponseBytes:262144,derivativePersistenceEnabled:true,
   // Explicit fixture setup based on known synthetic response. No product auto-issuer.
   persistDerivative:async r=>{const response={schemaVersion:'design-managed-image-response-v1',sourceRecordDigest:digest(sourceRecord),descriptor:r.descriptor};await f.ledger.publishResponse({credential,scope,sourceRecordDigest:response.sourceRecordDigest,descriptor:r.descriptor});await f.derivedIssuers.issuePut({credential,scope,receiptId:'parent-put-'+id,intent:f.putIntent(response),ttlMs:900000});return sink(r);},
   transport:async r=>{transports++;return {url:r.url,status:200,redirected:false,mime,body:new ReadableStream({start(c){c.enqueue(parent);c.close();}})};}});
  const descriptor=await transform.transform({credential,scope,mediaId,requestId:parentRequestId,maxEdge:1024}),parentResponse={schemaVersion:'design-managed-image-response-v1',sourceRecordDigest:digest(sourceRecord),descriptor},parentObjectReceipt=await f.derivedLedger.readObject({credential,scope,responseDigest:digest(parentResponse)}),requestId='normalize-'+id;
  const intent=await f.processing.prepare({credential,scope,mediaId,parentRequestId,requestId});
  return {sourceRecord,parentResponse,parentObjectReceipt,intent,sourceBytes:src,parentBytes:parent};
 }
 async function bindCanonicalOutput({parent,normalizedBytes}){const bytes=Uint8Array.from(normalizedBytes);const artifact=createManagedImageNormalizationArtifact({requestId:parent.intent.requestId,sourceRecord:parent.sourceRecord,parentResponse:parent.parentResponse,parentObjectReceipt:parent.parentObjectReceipt,output:{sha256:hash(bytes),byteLength:bytes.length,mime:'image/png',width:80,height:120}});return f.processing.bindArtifact({credential,scope,intent:parent.intent,artifact});}
 async function approveCanonicalStorage({artifact,permissionId}){return f.normalizedIssuers.issuePut({credential,scope,receiptId:permissionId,intent:f.normalizedPutIntent(artifact),ttlMs:900000});}
 async function storeCanonicalOutput({claimedArtifact,bytes}){const {artifact}=claimedArtifact,request={credential,scope,requestId:artifact.requestId};assert.deepEqual(await f.processing.readBoundArtifact(request),claimedArtifact);await makeNormalizedStore().put({credential,scope,artifact,bytes});assert.deepEqual(await f.processing.readBoundArtifact(request),claimedArtifact);return f.normalizedLedger.readObject({credential,scope,artifactDigest:digest(artifact)});}
 return {...f,canonicalLedger,canonicalIssuers,canonicalStorage,acquireCanonicalReader,acquireCanonicalAuthorizer,acquireCanonicalVerifier,seedCanonicalParent,bindCanonicalOutput,approveCanonicalStorage,storeCanonicalOutput,canonicalPuts:()=>puts,canonicalTransports:()=>transports,canonicalOldSQL:oldSQL,canonicalOldDefinitions:oldDefinitions};
 }catch(e){await f.cleanup();throw e;}}
