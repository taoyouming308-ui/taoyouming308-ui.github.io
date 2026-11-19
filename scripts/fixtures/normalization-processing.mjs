/** Explicit isolated PG fixture. Processing/issuer connections use the existing
 * bounded psql fixture driver; original parent path also retains its wire pool.
 * Bytes/storage/decoders are synthetic protocol fixtures, not qualified images. */
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {createManagedNormalizedFixture} from './managed-normalized-ledger.mjs';
import {createManagedNormalizationProcessing,createManagedNormalizationProcessingIssuer} from '../../packages/design-production-adapter/managed-normalization-processing-ledger.mjs';
export async function createNormalizationProcessingFixture(){const f=await createManagedNormalizedFixture();try{
 const oldSQL="SELECT md5(string_agg(p.oid::text||p.prosrc||coalesce(p.proacl::text,''),'|' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('design_managed_image','design_managed_derived','design_managed_normalized','design_identity')",oldDefinitions=f.sqlAdmin(oldSQL);
 f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage34-normalization-processing-fixture.sql',import.meta.url),'utf8'));assert.equal(f.sqlAdmin(oldSQL),oldDefinitions);
 const client=role=>async()=>{const c=f.clientForRole(role,'normalization-processing-fixture');return {...c,async query(sql,p){try{return await c.query(sql,p);}catch(e){console.log('PROCESSING_SQL_DIAGNOSTIC '+JSON.stringify({role,operation:sql.match(/design_normalization_processing\.([a-z_]+)\(/)?.[1]??'fixed_transaction',sqlstate:/^[A-Z0-9]{5}$/.test(e?.code)?e.code:'unknown',category:/^[A-Z_]{1,80}$/.test(e?.message)?e.message:'other'}));throw e;}}};};
 const acquireProcessing=client('design_normalization_runtime'),acquireProcessingIssuer=client('design_normalization_processing_issuer'),processing=createManagedNormalizationProcessing({enabled:true,acquireClient:acquireProcessing}),processingIssuer=createManagedNormalizationProcessingIssuer({enabled:true,acquireClient:acquireProcessingIssuer});
 async function prepareProcessing(id){const x=await f.prepareNormalization(id);const intent=await processing.prepare({credential:f.credential,scope:f.scope,mediaId:x.sourceRecord.mediaId,parentRequestId:x.parentResponse.descriptor.requestId,requestId:x.artifact.requestId});return {...x,intent};}
 async function approveProcessing(x,id,ttlMs=900000){return processingIssuer.issueProcessing({credential:f.credential,scope:f.scope,permissionId:'processing-'+id,intent:x.intent,ttlMs});}
 return {...f,processing,processingIssuer,acquireProcessing,acquireProcessingIssuer,prepareProcessing,approveProcessing,processingOldSQL:oldSQL,processingOldDefinitions:oldDefinitions};
 }catch(e){await f.cleanup();throw e;}}
