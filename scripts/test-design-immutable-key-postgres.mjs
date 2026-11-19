/** Actual restricted runtime + independent issuer LOGIN. Synthetic keys only; no provider/network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {createDesignIdentityPostgresFixture} from './fixtures/design-identity-postgres-fixture.mjs';
import {createPostgresImmutableKeyRepository,createPostgresKeyApprovalIssuer} from '../packages/design-production-adapter/postgres-immutable-key-repository.mjs';
import {createImmutablePreparedDesignKeySettings} from '../packages/design-production-adapter/key-settings.mjs';
import {createImmutableDesignKeySealer} from '../packages/design-production-adapter/key-crypto.mjs';
import {createImmutableKeySettingsRuntime} from '../packages/design-production-adapter/immutable-key-runtime.mjs';
globalThis.fetch=()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const f=await createDesignIdentityPostgresFixture();let count=0,serial=0;
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`,sha=v=>createHash('sha256').update(v).digest('hex');
const KEY='SYNTHETIC_NOT_A_REAL_PROVIDER_KEY_12345',OTHER='SYNTHETIC_OTHER_NOT_A_REAL_KEY_12345';
const config={destination:'https://api.deepseek.com/chat/completions',model:'synthetic-model'},speech={destination:'https://api.deepseek.com/v1/tools/asr',model:null};
const owner=i=>Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(k=>[k,i[k]]));
const sealer=createImmutableDesignKeySealer({secretProvider:async()=>new Uint8Array(32).fill(42),cryptoProvider:webcrypto});
// Test-only diagnostics: fixed operation/category enums and SQLSTATE, never SQL/parameters/messages.
function diagnosticClient(client){
 const operations=['authenticate','recheck_identity','clear_context','read_key','consume_approval','cas_key','issue_approval','revoke_approval'];
 const categories=new Set(['KEY_AUTHENTICATION_REQUIRED','KEY_APPROVAL_REQUIRED','KEY_APPROVAL_CONFLICT','KEY_RECORD_INVALID','KEY_REVISION_CONFLICT','KEY_NOT_CONFIGURED','KEY_IMMUTABLE','KEY_AUTHORITY_EXPIRED']);
 return {...client,async query(sql,params){try{return await client.query(sql,params);}catch(error){
  const operation=operations.find(name=>sql.startsWith(`SELECT design_key_private.${name}(`))??(['BEGIN ISOLATION LEVEL READ COMMITTED','COMMIT','ROLLBACK'].includes(sql)?sql.split(' ')[0]:'control');
  const sqlstate=typeof error?.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:'unknown';
  console.log('KEY_PG_DIAGNOSTIC '+JSON.stringify({operation,sqlstate,category:categories.has(error?.message)?error.message:'other'}));throw error;
 }}};
}
const acquireRuntimeClient=async()=>diagnosticClient(await f.acquireRuntimeClient());
const acquireIssuerClient=async()=>diagnosticClient(f.clientForRole('design_key_issuer','key-independent-issuer'));
const repo=()=>createPostgresImmutableKeyRepository({enabled:true,acquireClient:acquireRuntimeClient});
const issuer=createPostgresKeyApprovalIssuer({enabled:true,acquireIssuerClient});
const settings=(repository=repo())=>createImmutablePreparedDesignKeySettings({enabled:true,resolveIdentity:repository.resolveIdentity,repository,sealer,approvedModels:['synthetic-model'],allowASR:true});
const tableCount=(table,where='true')=>Number(f.sqlAdmin(`SELECT count(*) FROM design_key_private.${table} WHERE ${where};`));
const consumed=id=>tableCount('consumptions',`receipt_id=${q(id)}`);
const test=async(name,work)=>{await work();console.log(`ok ${++count} - ${name}`);};
const deniedSQL=(sql,role=f.runtimeRole)=>assert.throws(()=>f.sqlAsRole(sql,role),error=>/ERROR:\s+42501:/.test(String(error.stderr)));
async function approval({credential=f.credential,purpose='chat',revision=0,key=KEY,remove=false,ttlMs=60000,receiptId=`synthetic-key-receipt-${++serial}`}={}){
 const identity=await repo().resolveIdentity({credential});
 const intent={schemaVersion:'design-key-approval-v2',...owner(identity),securityEpoch:identity.securityEpoch,membershipRevision:identity.membershipRevision,purpose,action:remove?'revoke-design-key':'persist-design-key',...(purpose==='chat'?config:speech),expectedRevision:revision,keyDigest:remove?null:await sealer.digest(key)};
 const issued=await issuer.issue({credential,receiptId,intent,ttlMs});
 return {identity,intent,issued,receiptId,credential,purpose,revision,key,approval:{receiptId}};
}
const save=(a,service=settings())=>service.save({credential:a.credential,approval:a.approval,expectedRevision:a.revision,config:a.purpose==='chat'?config:speech,key:a.key});
const status=(credential=f.credential,purpose='chat')=>settings().status({credential,purpose});
async function rowFor(a,patch={}){const r={schemaVersion:'design-key-record-v2',owner:owner(a.identity),securityEpoch:a.identity.securityEpoch,membershipRevision:a.identity.membershipRevision,purpose:a.purpose,revision:a.revision+1,enabled:true,...(a.purpose==='chat'?config:speech),sealed:null,...patch};r.sealed=await sealer.seal(a.key,r);return r;}
try{
 f.sqlAdmin(readFileSync(new URL('../packages/design-production-adapter/drafts/stage15-key-repository-fixture.sql',import.meta.url),'utf8'));
 await test('constant JSON subtraction regression preserves exact sealed-shape validation',async()=>{
  const constant=`'{"sealed":{"v":2,"iv":"synthetic","data":"synthetic"}}'::jsonb`;
  assert.throws(()=>f.sqlAdmin(`SELECT (${constant}->'sealed'-array['v','iv','data'])::text;`),e=>/ERROR:\s+22P02:/.test(String(e.stderr)));
  assert.equal(f.sqlAdmin(`SELECT ((${constant}->'sealed')-array['v','iv','data'])::text;`),'{}');
  assert.equal(f.sqlAdmin(`SELECT ((('{"sealed":{"v":2,"iv":"synthetic","data":"synthetic","extra":true}}'::jsonb->'sealed')-array['v','iv','data'])<>'{}'::jsonb)::text;`),'true');
 });
 await test('actual restricted runtime and independent issuer are separate non-owner LOGIN identities',async()=>{
  for(const role of [f.runtimeRole,'design_key_issuer']){
   const row=JSON.parse(f.sqlAsRole("SELECT json_build_object('session',session_user::text,'current',current_user::text,'restricted',NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit) FROM pg_roles WHERE rolname=current_user;",role));
   assert.equal(row.session,role);assert.equal(row.current,role);assert.equal(row.restricted,true);
  }
  assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='design_key_private' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);"),'0');
 });
 await test('runtime cannot issue approval or read tables; issuer cannot consume/read key; no role escalation',async()=>{
  for(const sql of ["SELECT * FROM design_key_private.approvals;","SELECT * FROM design_key_private.key_versions;","SELECT design_key_private.issue_approval('x','x','{}',1000);","SET ROLE design_key_issuer;","SET ROLE design_identity_capability;","TRUNCATE design_key_private.key_versions;","UPDATE design_key_private.approvals SET revoked=false;"])deniedSQL(sql);
  for(const sql of ["SELECT * FROM design_key_private.key_versions;","SELECT design_key_private.read_key('chat');","SELECT design_key_private.consume_approval('x','{}');","SET ROLE design_identity_runtime;"])deniedSQL(sql,'design_key_issuer');
 });
 await test('session-only status needs no customer and creates no slot or consumed approval',async()=>{
  assert.deepEqual(await status(),{configured:false,revision:0,destination:null,model:null,requiresReconfiguration:false});assert.equal(tableCount('key_heads')+tableCount('consumptions'),0);
 });
 await test('fabricated receipt and approved digest for a different key cannot write',async()=>{
  await assert.rejects(settings().save({credential:f.credential,approval:{receiptId:'never-issued'},expectedRevision:0,config,key:KEY}));
  const a=await approval();await assert.rejects(save({...a,key:OTHER}));assert.equal(consumed(a.receiptId),0);assert.equal(tableCount('key_versions'),0);
 });
 await test('independent issuer exact replay preserves original expiry; changed intent or TTL conflicts',async()=>{
  const a=await approval();assert.deepEqual(await issuer.issue({credential:a.credential,receiptId:a.receiptId,intent:a.intent,ttlMs:60000}),a.issued);
  await assert.rejects(issuer.issue({credential:a.credential,receiptId:a.receiptId,intent:a.intent,ttlMs:61000}));
  await assert.rejects(issuer.issue({credential:a.credential,receiptId:a.receiptId,intent:{...a.intent,model:'other-model'},ttlMs:60000}));
 });
 await test('approved synthetic AES key persists one immutable version and one atomic consumption',async()=>{
  const a=await approval();assert.equal((await save(a)).revision,1);assert.equal(consumed(a.receiptId),1);assert.equal(tableCount('key_versions'),1);
  assert(!f.sqlAdmin('SELECT record::text FROM design_key_private.key_versions;').includes(KEY));
  assert.equal(await settings().withProviderKey({credential:f.credential,expectedRevision:1,...config},lease=>lease.key.length),KEY.length);
 });
 await test('different immutable employee cannot read original key or consume its approval',async()=>{
  assert.equal((await status(f.tokens.bob)).configured,false);const a=await approval({revision:1});await assert.rejects(save({...a,credential:f.tokens.bob}));assert.equal(consumed(a.receiptId),0);
  await assert.rejects(issuer.issue({credential:f.tokens.bob,receiptId:'wrong-person',intent:a.intent,ttlMs:1000}));
 });
 await test('issuer revocation is monotonic and blocks later consumption',async()=>{
  const a=await approval({revision:1});assert.equal(await issuer.revoke({receiptId:a.receiptId}),true);assert.equal(await issuer.revoke({receiptId:a.receiptId}),true);await assert.rejects(save(a));assert.equal(consumed(a.receiptId),0);
 });
 await test('failure after consume rolls back receipt and key together; same approval remains usable',async()=>{
  const a=await approval({revision:1}),r=repo();await assert.rejects(r.withIdentityLock(a.identity,async tx=>{await tx.resolveIdentity({credential:a.credential});await tx.read('chat');await tx.consumeKeyApproval(a.approval,a.intent);throw Error('SYNTHETIC_ROLLBACK');}));assert.equal(consumed(a.receiptId),0);assert.equal((await status()).revision,1);assert.equal((await save(a)).revision,2);
 });
 await test('consume without matching CAS cannot commit an orphan even if application returns success',async()=>{
  const a=await approval({revision:2});await assert.rejects(repo().withIdentityLock(a.identity,async tx=>{await tx.resolveIdentity({credential:a.credential});await tx.consumeKeyApproval(a.approval,a.intent);}));assert.equal(consumed(a.receiptId),0);assert.equal((await status()).revision,2);
 });
 await test('CAS without approval or with another approved configuration cannot write',async()=>{
  const a=await approval({revision:2}),next=await rowFor(a);
  await assert.rejects(repo().withIdentityLock(a.identity,async tx=>{await tx.resolveIdentity({credential:a.credential});await tx.compareAndSwap(2,next);}));
  await assert.rejects(repo().withIdentityLock(a.identity,async tx=>{await tx.resolveIdentity({credential:a.credential});await tx.consumeKeyApproval(a.approval,a.intent);await tx.compareAndSwap(2,{...next,model:'unapproved-model'});}));assert.equal(consumed(a.receiptId),0);assert.equal((await status()).revision,2);
 });
 await test('concurrent distinct exact approvals produce only one CAS winner and one consumption',async()=>{
  const a=await approval({revision:2}),b=await approval({revision:2});const results=await Promise.allSettled([save(a),save(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(consumed(a.receiptId)+consumed(b.receiptId),1);assert.equal((await status()).revision,3);
 });
 await test('fresh repository/service instances decrypt same v2 slot, never regenerate or issue',async()=>{
  assert.equal(await settings(repo()).withProviderKey({credential:f.credential,expectedRevision:3,...config},lease=>lease.key.length),KEY.length);
 });
 await test('lost actual CAS COMMIT acknowledgment is uncertain and stale retry cannot overwrite',async()=>{
  const a=await approval({revision:3});let lose=true;
  const acquire=async()=>{const c=await acquireRuntimeClient();let wrote=false;return {...c,query:async(sql,params)=>{const r=await c.query(sql,params);if(sql.includes('cas_key'))wrote=true;if(sql==='COMMIT'&&wrote&&lose){lose=false;throw Error('SYNTHETIC_LOST_COMMIT_ACK');}return r;}};};
  const r=createPostgresImmutableKeyRepository({enabled:true,acquireClient:acquire});await assert.rejects(save(a,settings(r)),e=>e.code==='KEY_OUTCOME_UNCERTAIN');assert.equal(consumed(a.receiptId),1);assert.equal((await status()).revision,4);await assert.rejects(save(a));assert.equal((await status()).revision,4);
 });
 await test('expired receipt rejects before mutation without a replacement approval',async()=>{
  const a=await approval({revision:4,ttlMs:50});await new Promise(r=>setTimeout(r,75));await assert.rejects(save(a));assert.equal(consumed(a.receiptId),0);
 });
 await test('near-expiry session truncates issuer TTL without extending or rejecting the receipt',async()=>{
  const token='SYNTHETIC_SHORT_SESSION_'+ '0'.repeat(48),h=q(sha(token));
  f.sqlAdmin(`INSERT INTO public.employee_booking_sessions(token_hash,username,store,expires_at) VALUES(${h},'alice',${q(f.store)},clock_timestamp()+interval '30 seconds');`);
  f.sqlAdmin(`INSERT INTO design_identity.sessions VALUES(${h},'synthetic-subject-alice','synthetic-employment-alice','synthetic-membership-alice',1,1,clock_timestamp()+interval '30 seconds',false);`);
  const a=await approval({credential:token,revision:4,ttlMs:300000});assert(a.issued.expiresAt-a.issued.issuedAt>0);assert(a.issued.expiresAt-a.issued.issuedAt<300000);
 });
 await test('actual key-only HTTP runtime saves reads and revokes the independent speech slot',async()=>{
  const api='https://synthetic-key-api.invalid',origin='https://synthetic-key-ui.invalid';
  const runtime=createImmutableKeySettingsRuntime({enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],acquireClient:acquireRuntimeClient,secretProvider:async()=>new Uint8Array(32).fill(42),cryptoProvider:webcrypto,approvedModels:['synthetic-model'],allowASR:true});
  const request=(path,body)=>new Request(api+'/api/design/key-settings/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-employee-session':f.credential},body:JSON.stringify(body)});
  const a=await approval({purpose:'speech'});let r=await runtime.handle(request('save',{approval:a.approval,expectedRevision:0,config:speech,key:KEY}));assert.equal(r.status,200,await r.clone().text());
  r=await runtime.handle(request('read',{purpose:'speech'}));assert.equal(r.status,200);assert.equal((await r.json()).result.configured,true);
  const b=await approval({purpose:'speech',revision:1,remove:true});r=await runtime.handle(request('revoke',{approval:b.approval,expectedRevision:1,purpose:'speech'}));assert.equal(r.status,200);assert.equal((await status(f.credential,'speech')).configured,false);assert.equal((await status()).revision,4);
 });
 await test('key revoke creates a tombstone and cannot reset old revision or delete history',async()=>{
  const before=tableCount('key_versions'),a=await approval({revision:4,remove:true});assert.equal((await settings().revoke({credential:a.credential,approval:a.approval,expectedRevision:4,purpose:'chat'})).revision,5);assert.equal(tableCount('key_versions'),before+1);assert.equal((await status()).configured,false);
  deniedSQL('DELETE FROM design_key_private.key_versions;');deniedSQL("UPDATE design_key_private.key_heads SET revision=0;");
  const stale=await approval();await assert.rejects(save(stale));assert.equal(consumed(stale.receiptId),0);
 });
 await test('epoch replacement requires reconfiguration and old token cannot inherit the new epoch',async()=>{
  const a=await approval({credential:f.tokens.bob});await save(a);f.sqlAdmin("UPDATE design_identity.subjects SET security_epoch=2 WHERE subject_id='synthetic-subject-bob';");await assert.rejects(status(f.tokens.bob));
  const token='SYNTHETIC_EPOCH_TWO_'+ '0'.repeat(48),h=q(sha(token));
  f.sqlAdmin(`INSERT INTO public.employee_booking_sessions(token_hash,username,store,expires_at) VALUES(${h},'bob',${q(f.store)},clock_timestamp()+interval '1 hour');INSERT INTO design_identity.sessions VALUES(${h},'synthetic-subject-bob','synthetic-employment-bob','synthetic-membership-bob',2,1,clock_timestamp()+interval '1 hour',false);`);
  assert.equal((await status(token)).requiresReconfiguration,true);await assert.rejects(settings().withProviderKey({credential:token,expectedRevision:1,...config},()=>{throw Error('MUST_NOT_DECRYPT');}));
 });
 console.log(`PASS ${count} actual non-owner key/issuer PostgreSQL checks; synthetic AES/keys only. Known hostile-SQL deadline and trusted-sealer boundaries remain.`);
}finally{await f.cleanup();console.log('Verified exact labelled key/issuer PostgreSQL fixture cleanup.');}
