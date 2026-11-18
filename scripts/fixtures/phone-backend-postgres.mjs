/** Synthetic-only integration installer. No model key is ever seeded.
 * Only the receipt issuer is a finite in-memory test actor; photo bytes use
 * encrypted fsync'd objects and metadata uses restricted real PostgreSQL. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDesignIdentityPostgresFixture} from './design-identity-postgres-fixture.mjs';
import {createFixturePgWirePool} from './design-pg-wire-pool.mjs';
import {createTrustedPgPoolAdapter} from '../../packages/design-production-adapter/trusted-pg-pool-adapter.mjs';
import {createImmutableDependencyRepository} from '../../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {policyEqual} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
export async function createPhoneBackendPostgresFixture({restoredFixture}={}){
 if(restoredFixture)assert.equal(restoredFixture.offlineRecoveryFixture,true);
 const f=restoredFixture??await createDesignIdentityPostgresFixture();let wire,adapter,changed=0;
 try{
  if(!restoredFixture){
  for(const name of ['stage13-provider-policy','stage15-key-repository','stage16-workflow-authority','stage17-dependency-authority','stage18-provider-key-binding','stage18-immutable-visit','stage37-browser-archive-command'])f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/'+name+'-fixture.sql',import.meta.url),'utf8'));
  const definitions=()=>JSON.parse(f.sqlAdmin("SELECT jsonb_agg(jsonb_build_object('id',p.oid::text,'source',pg_get_functiondef(p.oid),'owner',p.proowner::text,'acl',p.proacl::text) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'design_%' AND p.prokind='f'"));
  const before=definitions();f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage42-phone-heif-fixture.sql',import.meta.url),'utf8'));const after=definitions();assert.equal(after.length,before.length);changed=0;
  for(let i=0;i<before.length;i++){assert.equal(after[i].id,before[i].id);assert.equal(after[i].owner,before[i].owner);assert.equal(after[i].acl,before[i].acl);if(after[i].source!==before[i].source){changed++;assert.equal(after[i].source,before[i].source.replace("coalesce(r->>'mime','') NOT IN ('image/jpeg','image/png','image/webp')","coalesce(r->>'mime','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')"));}}assert.equal(changed,1);
  }
  assert.equal(f.sqlAdmin('SELECT count(*) FROM design_key_private.key_versions'),'0');
  wire=createFixturePgWirePool(f,{max:2});adapter=createTrustedPgPoolAdapter({enabled:true,pool:wire.pool,maxLeases:2,maxWaiting:32,acquireTimeoutMs:10000,queryTimeoutMs:20000});
  const acquire=()=>adapter.acquireClient(),bridge=createImmutableDependencyRepository({enabled:true,acquireClient:acquire,browserArchivesEnabled:true});
  const run=work=>bridge.runRequest({credential:f.credential,scope:f.scopeA},work);await run(()=>bridge.initialize());
  const origin='https://phone-synthetic.supabase.co',binding={owner:'alice',store:f.store,scope:f.scopeA},grants=new Map(),issuerId=randomUUID();let serial=0,revoked=false;
  const approvalVerifier={async verifyImmutable({receipt,intent,authority}){const grant=grants.get(receipt);return !revoked&&!!grant&&policyEqual(grant.authority,authority)&&grant.intents.some(x=>policyEqual(x,intent));}};
  async function issue(intents){assert(grants.size<50);const authority=await run(()=>bridge.resolveAuthority()),receipt='phone-test-'+issuerId+'-'+(++serial);grants.set(receipt,{authority,intents:structuredClone(intents)});return receipt;}
  const grantUpload=q=>issue([{operation:'private_photo_upload',recipient:{kind:'private_storage',origin},binding,requestId:q.requestId,sha256:q.sha256,byteLength:q.byteLength,mime:q.mime,stage:q.stage,angle:q.angle}]);
  async function grantView(id){assert(/^[A-Za-z0-9_-]{1,100}$/.test(id));const digest=f.sqlAdmin("SELECT record->>'sha256' FROM design_private.media_records WHERE media_id='"+id+"'");assert(/^[a-f0-9]{64}$/.test(digest));return issue([{operation:'employee_private_photo_view',recipient:{kind:'employee',username:'alice',store:f.store},binding,mediaIds:[id],sha256:digest}]);}
  async function storageAuthorize(){try{const g=await run(()=>bridge.permissionGate.authorize(f.credential,f.scopeA));return !revoked&&g.actor.username==='alice'&&policyEqual(g.scope,f.scopeA);}catch{return false;}}
  return {...f,async closeRuntime(){await adapter.close();await wire.close();},acquire,bridge,run,storageOrigin:origin,approvalVerifier,grantUpload,grantView,storageAuthorize,setRevoked:v=>{revoked=v;},sqlCompatibility:{changedFunctions:changed,ownersAndACLUnchanged:true},async cleanup(){try{await adapter.close();}finally{try{await wire.close();}finally{await f.cleanup();}}}};
 }catch(e){try{await adapter?.close();}finally{try{await wire?.close();}finally{await f.cleanup();}}throw e;}
}
