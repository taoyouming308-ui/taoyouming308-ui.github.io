/** Stage37 TEST ONLY: existing Stage36/35 isolated PG + actual immutable
 * runtime, fixed synthetic image worker, explicit independent issuer actions.
 * No import startup. Private snapshots are captured only through trusted
 * server services; browser DTOs are never used as historical proof. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createManagedNormalizedRuntimeFixture} from './managed-normalized-runtime.mjs';
import {createImmutableGenerationRuntime} from '../../packages/design-production-adapter/immutable-generation-runtime.mjs';
import {MANAGED_IMAGE_MODEL_ENDPOINT} from '../../packages/design-production-adapter/managed-image-model-request.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
export async function createBrowserViewsRuntimeFixture({origin='https://browser-views.synthetic.invalid'}={}){
 const f=await createManagedNormalizedRuntimeFixture({origin});let sends=0,keyOpens=0;const sqlDiagnostics=[],sqlStages={};
 const archiveAcquire=async()=>{const c=await f.acquire();return {...c,async query(sql,params){const op=sql.match(/design_browser_archive_command\.(read_command|append_current)\(/)?.[1]??(['COMMIT','ROLLBACK'].includes(sql)?sql:'other_fixed');sqlStages[op]=(sqlStages[op]??0)+1;try{return await c.query(sql,params);}catch(e){const item={operation:op,sqlstate:/^[A-Z0-9]{5}$/.test(e?.code)?e.code:'unknown',category:/^[A-Z_]{1,80}$/.test(e?.message)?e.message:'other'};sqlDiagnostics.push(item);console.log('BROWSER_ARCHIVE_SQL_DIAGNOSTIC '+JSON.stringify(item));throw e;}}};};
 try{
  f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage37-browser-archive-command-fixture.sql',import.meta.url),'utf8'));
  const sealer={digest:(...a)=>f.sealer.digest(...a),async open(...a){keyOpens++;return f.sealer.open(...a);}};
  const makeBrowserRuntime=(enabled=true)=>createImmutableGenerationRuntime({enabled:true,acquireClient:archiveAcquire,proofReadsEnabled:true,publicOrigin:origin,allowedRequestOrigins:[origin],browserViews:{enabled},managedNormalized:{enabled:true,executionMode:'synthetic_mock',acquireVerificationClient:f.acquireCanonicalReader,storage:f.normalizedStorage,sealer,modelConfig:{model:f.modelConfig.model,maxOutputTokens:f.modelConfig.maxTokens},approvedModels:[f.modelConfig.model],transport:async q=>{sends++;assert.equal(q.url,MANAGED_IMAGE_MODEL_ENDPOINT);assert.equal(q.redirect,'error');assert.equal(q.credentials,'omit');assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_stat_activity WHERE usename IN ('design_identity_runtime','design_normalization_runtime') AND state LIKE 'idle in transaction%'"),'0');return {url:q.url,status:200,redirected:false,body:f.normalizedResponse()};}}});
  const capturePrivate=async()=>{const record=(await f.normalizedLoad()).record,full=await f.normalizedRun(c=>c.full.load({credential:f.credential,scope:f.scope}));return {record,full,recordDigest:digest(record),fullDigest:digest(full),versionDigests:full.versions.map(digest)};};
  const seedOldFull=async()=>{const snapshot=(await f.normalizedRun(c=>c.workflow.snapshot({credential:f.credential,scope:f.scope}))).snapshot;assert.equal(snapshot.schemaVersion,'design-full-workflow-snapshot-v1');const result=await f.normalizedRun(c=>c.full.append({credential:f.credential,scope:f.scope,requestId:'stage37-old-private-full',expectedVersion:0,expectedParentDigest:null,snapshot}));assert.equal(result.appliedVersion,1);return capturePrivate();};
  return {...f,archiveAcquire,sqlDiagnostics,sqlStages,makeBrowserRuntime,capturePrivate,seedOldFull,browserCounts:()=>({sends,keyOpens,issued:f.issuedRequests.size,nativeNormalizations:f.normalizedCounts().nativeNormalizations,nativeVerifications:f.normalizedCounts().nativeVerifications}),commandCount:()=>Number(f.sqlAdmin('SELECT count(*) FROM design_browser_archive_command.commands'))};
 }catch(error){await f.cleanup();throw error;}
}
