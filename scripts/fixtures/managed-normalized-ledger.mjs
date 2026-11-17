/** Explicit isolated PG fixture. Import has no side effects. Object bytes,
 * transformation and independent verifier are synthetic protocol mocks only. */
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createManagedDerivedFixture} from './managed-derived-ledger.mjs';
import {createManagedImageTransform} from '../../packages/design-production-adapter/managed-image-transform.mjs';
import {createManagedImagePersistenceSink} from '../../packages/design-production-adapter/managed-image-persistence-sink.mjs';
import {createManagedImageNormalizationArtifact} from '../../packages/design-production-adapter/managed-image-normalization-contracts.mjs';
import {createManagedNormalizedLedger,createManagedNormalizedIssuers} from '../../packages/design-production-adapter/managed-normalized-ledger.mjs';
import {createManagedNormalizedStore} from '../../packages/design-production-adapter/managed-normalized-store.mjs';
import {managedImageDigest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function createManagedNormalizedFixture(){const f=await createManagedDerivedFixture();try{
 const definitionsSQL="SELECT md5(string_agg(p.oid::text||p.prosrc||coalesce(p.proacl::text,''),'|' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('design_managed_image','design_managed_derived','design_identity','design_candidate_provider_binding')",original=f.sqlAdmin(definitionsSQL);
 f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage33-managed-normalized-fixture.sql',import.meta.url),'utf8'));assert.equal(f.sqlAdmin(definitionsSQL),original);
 const {credential,scope}=f,ledger=createManagedNormalizedLedger({enabled:true,acquireClient:f.acquire});
 const roleClient=role=>async()=>{const c=f.clientForRole(role,'normalized-fixture');return {...c,async query(sql,params){try{return await c.query(sql,params);}catch(e){console.log('NORMALIZED_SQL_DIAGNOSTIC '+JSON.stringify({role,operation:sql.match(/design_managed_normalized\.([a-z_]+)\(/)?.[1]??'fixed_transaction',sqlstate:/^[A-Z0-9]{5}$/.test(e?.code)?e.code:'unknown',category:/^[A-Z_]{1,80}$/.test(e?.message)?e.message:'other'}));throw e;}}};};
 const issuers=createManagedNormalizedIssuers({enabled:true,acquireStorageIssuerClient:roleClient('design_normalized_storage_issuer'),acquireVerifierAuthorizerClient:roleClient('design_normalized_verifier_authorizer'),acquireVerifierClient:roleClient('design_normalized_verifier')});
 const objects=new Map();let puts=0;const storage={async putImmutable(q){puts++;const key=managedImageDigest(q.target);if(objects.has(key))throw Error('SYNTHETIC_NO_OVERWRITE');const bytes=Uint8Array.from(q.bytes),version='normalized-v1';objects.set(key,{bytes,version});return {target:q.target,objectVersion:version,sha256:hash(bytes),byteLength:bytes.length,mime:'image/png',created:true,private:true,immutable:true};},async read({object}){const {version,...target}=object,key=managedImageDigest(target),row=objects.get(key);if(row){if(version!==row.version)throw Error('SYNTHETIC_VERSION_REQUIRED');return Uint8Array.from(row.bytes);}return f.storage.read({object});}};
 const makeStore=()=>createManagedNormalizedStore({enabled:true,repository:ledger,storage,projectOrigin:'https://syntheticmanaged.supabase.co',bucket:'managed-private',cost:f.cost,timeoutMs:10000}),store=makeStore();
 const putIntent=artifact=>({schemaVersion:'design-managed-normalized-put-intent-v1',artifact,target:{projectOrigin:artifact.sourceRecord.object.projectOrigin,bucket:artifact.sourceRecord.object.bucket,key:'managed-normalized/'+managedImageDigest(artifact)+'/object'},cost:f.cost});
 async function prepare(id){
  const sourceBytes=Buffer.from('SYNTHETIC original JPEG '+id),parentBytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.from('SYNTHETIC hosted JPEG '+id)]),normalizedBytes=Buffer.from('SYNTHETIC normalized PNG '+id),upload=f.uploadIntent('source-'+id);upload.source={sha256:hash(sourceBytes),byteLength:sourceBytes.length,mime:'image/jpeg'};
  await f.issuers.issueStorage({credential,scope,receiptId:'storage-'+id,binding:upload,budget:f.cost,ttlMs:900000});await f.ledger.claimUpload({credential,intent:upload});
  const sourceRecord={schemaVersion:'design-managed-image-source-v1',mediaId:upload.mediaId,requestId:upload.requestId,owner:f.authority,object:{...upload.target,version:'source-v1'},source:upload.source,stage:'before',angle:'front',state:'quarantined',validation:'not_performed',publicEligible:false};
  await f.ledger.publishSource({credential,sourceRecord});await f.preflight(sourceRecord);objects.set(managedImageDigest(upload.target),{bytes:sourceBytes,version:'source-v1'});
  const requestId='parent-'+id,intent=await f.intentFor(sourceRecord,requestId);await f.approve(intent);
  const sink=createManagedImagePersistenceSink({enabled:true,repository:f.ledger,store:f.store});
  const transform=createManagedImageTransform({enabled:true,projectOrigin:upload.target.projectOrigin,bucket:upload.target.bucket,...f.ledger,timeoutMs:10000,maxResponseBytes:262144,derivativePersistenceEnabled:true,
   // Explicit fixture issuance only, not a callback installed in product config.
   persistDerivative:async r=>{const response={schemaVersion:'design-managed-image-response-v1',sourceRecordDigest:managedImageDigest(sourceRecord),descriptor:r.descriptor};await f.ledger.publishResponse({credential,scope,sourceRecordDigest:response.sourceRecordDigest,descriptor:r.descriptor});await f.derivedIssuers.issuePut({credential,scope,receiptId:'parent-put-'+id,intent:f.putIntent(response),ttlMs:900000});return sink(r);},
   transport:async r=>({url:r.url,status:200,redirected:false,mime:'image/jpeg',body:new ReadableStream({start(c){c.enqueue(parentBytes);c.close();}})})});
  const descriptor=await transform.transform({credential,scope,mediaId:sourceRecord.mediaId,requestId,maxEdge:1024}),parentResponse={schemaVersion:'design-managed-image-response-v1',sourceRecordDigest:managedImageDigest(sourceRecord),descriptor};
  const parentObjectReceipt=await f.derivedLedger.readObject({credential,scope,responseDigest:managedImageDigest(parentResponse)});
  const artifact=createManagedImageNormalizationArtifact({requestId:'normalize-'+id,sourceRecord,parentResponse,parentObjectReceipt,output:{sha256:hash(normalizedBytes),byteLength:normalizedBytes.length,mime:'image/png',width:1024,height:682}});
  return {artifact,sourceRecord,parentResponse,parentObjectReceipt,sourceBytes,parentBytes,normalizedBytes};
 }
 async function save(x,id,ttlMs=900000){await issuers.issuePut({credential,scope,receiptId:'normalized-put-'+id,intent:putIntent(x.artifact),ttlMs});await makeStore().put({credential,scope,artifact:x.artifact,bytes:x.normalizedBytes});return {...x,objectReceipt:await ledger.readObject({credential,scope,artifactDigest:managedImageDigest(x.artifact)})};}
 return {...f,normalizedLedger:ledger,normalizedIssuers:issuers,normalizedStore:store,makeNormalizedStore:makeStore,normalizedStorage:storage,prepareNormalization:prepare,saveNormalization:save,normalizedPutIntent:putIntent,normalizedPuts:()=>puts,normalizedDefinitionsSQL:definitionsSQL,normalizedOriginalDefinitions:original};
 }catch(e){await f.cleanup();throw e;}}
