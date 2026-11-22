/** Stage39 isolated PG17 + actual node-postgres restricted runtime. Storage HTTP
 * and credentials below are synthetic; not a cloud/WORM/decoder qualification.
 * No import starts resources. Installer/independent issuer is test-only.
 */
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createDesignIdentityPostgresFixture} from './design-identity-postgres-fixture.mjs';
import {createFixturePgWirePool} from './design-pg-wire-pool.mjs';
import {createTrustedPgPoolAdapter} from '../../packages/design-production-adapter/trusted-pg-pool-adapter.mjs';
import {createIdentityCapabilityAdapter} from '../../packages/design-production-adapter/identity-capability-postgres.mjs';
import {createManagedContentLedger,createManagedContentStorageIssuer} from '../../packages/design-production-adapter/managed-content-ledger.mjs';
import {createManagedContentStore} from '../../packages/design-production-adapter/managed-content-store.mjs';
import {createSupabaseApplicationObjectBackend} from '../../packages/design-production-adapter/supabase-application-object-backend.mjs';
import {createManagedContentWriteIntent,managedContentDigest as digest} from '../../packages/design-production-adapter/managed-content-manifest-contracts.mjs';
const quote=v=>"'"+String(v).replaceAll("'","''")+"'",hash=v=>createHash('sha256').update(v).digest('hex');
export async function createManagedContentLedgerFixture(){const base=await createDesignIdentityPostgresFixture();let wire,adapter;try{
 const oldDefsSQL="SELECT md5(string_agg(p.oid::text||p.prosrc||p.proowner::text,'|' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='design_identity'::regnamespace",oldDefs=base.sqlAdmin(oldDefsSQL);
 base.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage39-managed-content-manifest-fixture.sql',import.meta.url),'utf8'));assert.equal(base.sqlAdmin(oldDefsSQL),oldDefs);
 const target={projectOrigin:'https://syntheticcontent.supabase.co',bucket:'synthetic-private'};base.sqlAdmin(`INSERT INTO design_content_manifest.config VALUES(true,${quote(target.projectOrigin)},${quote(target.bucket)})`);
 wire=createFixturePgWirePool(base,{max:2});adapter=createTrustedPgPoolAdapter({enabled:true,pool:wire.pool,maxLeases:2,maxWaiting:16,acquireTimeoutMs:10000,queryTimeoutMs:10000});
 const diagnostics=[],acquire=async()=>{const c=await adapter.acquireClient();return {...c,async query(sql,p){try{return await c.query(sql,p);}catch(e){diagnostics.push({op:sql.match(/design_content_manifest\.([a-z_]+)\(/)?.[1]??'transaction',code:/^[A-Z0-9]{5}$/.test(e.code)?e.code:'sanitized',category:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'other'});throw e;}}};};
 const acquireIssuer=async()=>base.clientForRole('design_content_storage_issuer','content-storage-issuer'),issuer=createManagedContentStorageIssuer({enabled:true,acquireClient:acquireIssuer}),ledger=createManagedContentLedger({enabled:true,acquireClient:acquire});
 const credential=base.tokens.alice,scope=base.scopeA,common={credential,scope},authority=await createIdentityCapabilityAdapter({enabled:true,acquireClient:acquire}).resolveAuthority(common),objects=new Map(),events=[];
 function makeCase(id,{assetId=id,expectedRevision=0,expectedManifestDigest=null,bytes=Buffer.from('synthetic-content-'+id),scope:sc=scope,authority:a=authority}={}){const data=Buffer.from(bytes),intent=createManagedContentWriteIntent({authority:a,requestId:id,assetId,role:'source',expectedRevision,expectedManifestDigest,content:{sha256:hash(data),byteLength:data.length,mime:'image/png'},target,ancestry:{source:null,parent:null},processing:null});return {credential,scope:sc,requestId:id,intent,bytes:data};}
 const approve=(q,ttlMs=900000)=>issuer.issue({credential,scope:q.scope,permissionId:'write-'+q.requestId,intent:q.intent,ttlMs});
 const binding=ctx=>({...common,requestId:ctx.intent.requestId,intentDigest:digest(ctx.intent),claimId:ctx.claimId});
 function makeStore(q,{useLedger=ledger,transportHook=null}={}){
  const backend=createSupabaseApplicationObjectBackend({enabled:true,...target,keyPrefix:'managed-content/v1',timeoutMs:10000,maxBytes:8388608,
   credentialProvider:async()=>{const exp=Math.floor(Date.now()/1000)+120;return {apiKey:'sb_publishable_synthetic_only',accessToken:'e30.'+Buffer.from(JSON.stringify({role:'authenticated',exp})).toString('base64url')+'.synthetic',expiresAt:exp*1000};},
   authorize:async r=>{assert.deepEqual(r.target,q.intent.target);assert.deepEqual(r.content,q.intent.content);const ctx=await ledger.reconcile({credential,scope:q.scope,requestId:q.requestId});return ledger.authorize({...binding(ctx),scope:q.scope,phase:r.operation==='create'?'before_put':ctx.state==='published'?'object_read_before':'before_read'});},
   transport:async r=>{events.push({method:r.method,key:q.intent.target.key});const key=q.intent.target.key;let status=200,body;if(r.method==='POST'){if(objects.has(key)){status=409;body=Buffer.from('{}');}else{objects.set(key,Buffer.from(r.body));body=Buffer.from('{}');}}else{body=objects.get(key);if(!body){status=404;body=Buffer.from('{}');}}if(transportHook)await transportHook(r,{objects,key,status});return {url:r.url,redirected:false,status,mime:r.method==='POST'?'application/json':q.intent.content.mime,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(body));c.close();}})};}});
  return createManagedContentStore({enabled:true,ledger:useLedger,backend,timeoutMs:30000,maxBytes:8388608});
 }
 let cleaned=false;return {...base,credential,scope,common,authority,target,acquire,acquireIssuer,issuer,ledger,objects,events,diagnostics,makeCase,approve,binding,makeStore,
  counts:()=>Object.fromEntries(['permissions','reservations','claims','manifests','read_grants','terminations'].map(t=>[t,Number(base.sqlAdmin('SELECT count(*) FROM design_content_manifest.'+t))])),
  async cleanup(){if(cleaned)return;const errors=[];for(const f of [()=>adapter.close(),()=>wire.close(),()=>base.cleanup()])try{await f();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'CONTENT_PG_CLEANUP_UNCERTAIN');cleaned=true;console.log('CONTENT_PG_EXACT_CLEANUP '+JSON.stringify(wire.stats()));}
 };
 }catch(e){try{await adapter?.close();}finally{try{await wire?.close();}finally{await base.cleanup();}}throw e;}}
