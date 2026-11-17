/** Actual non-owner LOGIN/RLS acceptance for the new identity capability slice only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesignIdentityPostgresFixture} from './fixtures/design-identity-postgres-fixture.mjs';
import {createIdentityCapabilityAdapter,createIdentityCapabilityOperations} from '../packages/design-production-adapter/identity-capability-postgres.mjs';
globalThis.fetch=()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const hash=v=>createHash('sha256').update(v).digest('hex'),quote=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>`${quote(JSON.stringify(v))}::jsonb`;
const f=await createDesignIdentityPostgresFixture();let passed=0;
const adapter=createIdentityCapabilityAdapter({enabled:true,acquireClient:f.acquireRuntimeClient});
const resolve=(credential=f.credential,scope=f.scopeA)=>adapter.resolveAuthority({credential,scope});
const deny=promise=>assert.rejects(promise,e=>['IDENTITY_ACCESS_DENIED','IDENTITY_AUTHORITY_CHANGED','IDENTITY_INVALID_REQUEST'].includes(e.code));
async function test(name,work){await work();console.log(`ok ${++passed} - ${name}`);}
async function transaction(work){const client=await f.acquireRuntimeClient();try{await client.query('BEGIN');const out=await work(client,createIdentityCapabilityOperations(client));await client.query('COMMIT');return out;}catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{await client.release();}}
function sqlDenied(sql){assert.throws(()=>f.sqlAsRole(sql,f.runtimeRole),e=>/ERROR:\s+42501:/.test(String(e.stderr)),'actual PostgreSQL denies the runtime role');}
async function seed({id,label,username=label,subjectId=`subject-${label}`,employmentId=`employment-${label}`,storeId='synthetic-store-a',store=f.store,profileId='11',expires="interval '1 hour'"}){
 const membershipId=`membership-${label}`,token=`synthetic-identity-${label}-`+'0'.repeat(48),scope={customerProfileId:profileId,visitId:`booking:${id}`,assignmentSource:'appointment'};
 f.sqlAdmin(`INSERT INTO public.staff(username,store,position) SELECT ${quote(username)},${quote(store)},'stylist' WHERE NOT EXISTS(SELECT 1 FROM public.staff WHERE username=${quote(username)} AND store=${quote(store)});
  INSERT INTO public.customer_profiles(id,name,phone,shop_name) VALUES(${Number(profileId)},'Synthetic Identity','13000000000',${quote(store)}) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.bookings(id,barber_name,shop_name,date,status,customer_name,customer_phone) VALUES(${id},${quote(username)},${quote(store)},'2026-11-15',0,'Synthetic Identity','13000000000');
  INSERT INTO public.employee_booking_sessions(token_hash,username,store,expires_at) VALUES(${quote(hash(token))},${quote(username)},${quote(store)},clock_timestamp()+interval '1 hour');
  INSERT INTO design_identity.subjects VALUES(${quote(subjectId)},1,true) ON CONFLICT(subject_id) DO NOTHING;
  INSERT INTO design_identity.employments VALUES(${quote(employmentId)},${quote(subjectId)},true) ON CONFLICT(employment_id) DO NOTHING;
  INSERT INTO design_identity.memberships VALUES(${quote(membershipId)},${quote(employmentId)},${quote(storeId)},1,true);
  INSERT INTO design_identity.aliases VALUES(${quote('alias-'+label)},${quote(membershipId)},${quote(storeId)},${quote(username)},true);
  INSERT INTO design_identity.sessions VALUES(${quote(hash(token))},${quote(subjectId)},${quote(employmentId)},${quote(membershipId)},1,1,clock_timestamp()+${expires},false);
  INSERT INTO design_identity.visit_bindings VALUES('appointment',${quote(scope.visitId)},${Number(profileId)},${quote(membershipId)},${quote(storeId)},'2026-11-15',1,true);`);
 f.lifecycle({source:'appointment',visitId:scope.visitId,id:String(id),staffUsername:username,store,bookingDate:'2026-11-15',status:0});
 return {id,label,username,subjectId,employmentId,membershipId,storeId,store,profileId,token,scope};
}
try{
 // Only binding history is nonempty here; legacy/workflow compatibility uses the separate workflow PG suite.
 const oldRows=f.sqlAdmin("SELECT jsonb_build_object('bindings',(SELECT jsonb_agg(to_jsonb(v) ORDER BY visit_id,revision) FROM design_private.binding_versions v),'workflow',(SELECT jsonb_agg(to_jsonb(v) ORDER BY scope_key,revision) FROM design_private.workflow_versions v),'legacy',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_design_versions v));");
 await test('actual runtime LOGIN is neither table owner nor superuser/BYPASSRLS/member of privileged roles',async()=>{
  await transaction(async c=>{const r=(await c.query('SELECT session_user::text AS session_login,current_user::text AS current_login')).rows[0];assert.deepEqual(r,{session_login:f.runtimeRole,current_login:f.runtimeRole});const roles=(await c.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit FROM pg_catalog.pg_roles WHERE rolname=current_user')).rows[0];assert(Object.values(roles).every(v=>v===false));assert.equal((await c.query('SELECT pg_has_role(current_user,$1,\'MEMBER\') AS member',[f.identityOwner])).rows[0].member,false);assert.equal((await c.query('SELECT pg_has_role(current_user,$1,\'MEMBER\') AS member',[f.capabilityOwner])).rows[0].member,false);});
  assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='design_identity' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);"),'0');
 });
 await test('exact opaque session resolves immutable identity and real RLS filters a query without scope WHERE',async()=>{
  await transaction(async(c,ops)=>{await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});assert.deepEqual((await c.query('SELECT design_identity.clear_context() AS cleared')).rows,[{cleared:''}],'actual PostgreSQL void JSON result is the empty string, not null');});
  const a=await resolve();assert.equal(a.subjectId,'synthetic-subject-alice');assert.equal(a.employmentId,'synthetic-employment-alice');assert.equal(a.membershipId,'synthetic-membership-alice');assert.equal(a.bindingRevision,'1');
  await transaction(async(c,ops)=>{const authority=await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});const rows=await ops.readScopeRecords();assert.equal(rows.length,1);assert.equal(rows[0].recordId,'synthetic-record-a');assert.deepEqual(rows[0].scope,f.scopeA);await ops.recheck(authority);await ops.clear();});
  const bob=await resolve(f.tokens.bob,f.scopeC);assert.equal(bob.subjectId,'synthetic-subject-bob');await deny(resolve(f.tokens.bob,f.scopeA));await deny(resolve(f.credential,f.scopeC));await deny(resolve(f.tokens.manager,f.scopeA));await deny(resolve(f.credential,{...f.scopeA,customerProfileId:'12'}));
 });
 await test('direct SQL cannot read/write authority, issue approvals, forge history, revive access or change schema/roles',async()=>{
  for(const sql of ["SELECT * FROM design_identity.sessions;","SELECT * FROM design_identity.transaction_contexts;","SELECT * FROM design_identity.scope_records;","INSERT INTO design_identity.transaction_contexts DEFAULT VALUES;","UPDATE public.staff SET active=true WHERE username='bob';","DELETE FROM public.bookings WHERE id=103;","UPDATE design_identity.sessions SET revoked=false;","INSERT INTO design_private.workflow_versions DEFAULT VALUES;","INSERT INTO design_private.model_candidates DEFAULT VALUES;","INSERT INTO design_private.full_versions DEFAULT VALUES;","INSERT INTO design_private.binding_approvals DEFAULT VALUES;","UPDATE design_private.media_access SET active=true;","TRUNCATE design_identity.scope_records;","ALTER TABLE public.staff DISABLE TRIGGER ALL;","CREATE TABLE public.identity_attack(id int);","CREATE TEMP TABLE identity_attack(id int);",`SET ROLE ${f.capabilityOwner};`,`SET ROLE ${f.identityOwner};`,"SET SESSION AUTHORIZATION postgres;","SELECT design_identity.resolve_hash(repeat('0',64),'{}');","SELECT design_identity.require_authority();"])sqlDenied(sql);
  assert.equal(f.sqlAsRole('RESET ROLE; SELECT current_user;',f.runtimeRole).trim(),f.runtimeRole);
 });
 await test('forged GUCs and hostile search_path cannot create a context or widen its RLS scope',async()=>{
  await transaction(async(c,ops)=>{await c.query("SET LOCAL request.jwt.claims = '{\"role\":\"service_role\",\"sub\":\"fake\"}'");await c.query("SET LOCAL design_identity.subject_id = 'synthetic-subject-bob'");await c.query('SET LOCAL search_path = pg_temp, public');await assert.rejects(ops.readScopeRecords(),e=>e.code==='IDENTITY_ACCESS_DENIED');throw Object.assign(Error('expected rollback'),{code:'EXPECTED_ROLLBACK'});}).catch(e=>assert.equal(e.code,'EXPECTED_ROLLBACK'));
  await transaction(async(c,ops)=>{const a=await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});await c.query("SET LOCAL design_identity.subject_id = 'synthetic-subject-bob'");await c.query('SET LOCAL search_path = pg_temp, public');assert.deepEqual(await ops.recheck(a),a);assert.deepEqual((await ops.readScopeRecords()).map(r=>r.recordId),['synthetic-record-a']);await ops.clear();});
 });
 await test('committed context cannot cross transaction/backend and next authorize removes own stale context',async()=>{
  const c=await f.acquireRuntimeClient(),ops=createIdentityCapabilityOperations(c);let a;
  try{await c.query('BEGIN');a=await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});await c.query('COMMIT');await c.query('BEGIN');await deny(ops.recheck(a));await c.query('ROLLBACK');await transaction(async(other,otherOps)=>{await deny(otherOps.recheck(a));throw Object.assign(Error('expected rollback'),{code:'EXPECTED_ROLLBACK'});}).catch(e=>assert.equal(e.code,'EXPECTED_ROLLBACK'));await c.query('BEGIN');await ops.resolveAuthority({credential:f.credential,scope:f.scopeA});await ops.clear();await c.query('COMMIT');}finally{await c.release();}
  assert.equal(f.sqlAdmin('SELECT count(*) FROM design_identity.transaction_contexts;'),'0');
 });
 await test('legacy logout and staff disable still deny immutable sidecar sessions',async()=>{
  const x=await seed({id:201,label:'logout'});assert((await resolve(x.token,x.scope)).subjectId===x.subjectId);f.sqlAdmin(`DELETE FROM public.employee_booking_sessions WHERE token_hash=${quote(hash(x.token))};`);await deny(resolve(x.token,x.scope));
  const y=await seed({id:202,label:'staff-disabled'});f.sqlAdmin(`UPDATE public.staff SET active=false WHERE username=${quote(y.username)};`);await deny(resolve(y.token,y.scope));
 });
 await test('username reuse does not transfer old sessions bindings or immutable subject ownership',async()=>{
  const old=await seed({id:203,label:'old-person',username:'reused-alias'}),before=await resolve(old.token,old.scope);
  f.sqlAdmin(`UPDATE design_identity.employments SET active=false WHERE employment_id=${quote(old.employmentId)};UPDATE design_identity.memberships SET active=false,membership_revision=2 WHERE membership_id=${quote(old.membershipId)};UPDATE design_identity.aliases SET active=false WHERE membership_id=${quote(old.membershipId)};`);
  const current=await seed({id:204,label:'new-person',username:'reused-alias'}),after=await resolve(current.token,current.scope);assert.equal(before.actor.username,after.actor.username);assert.notEqual(before.subjectId,after.subjectId);await deny(resolve(old.token,old.scope));await deny(resolve(current.token,old.scope));
  assert.throws(()=>f.sqlAdmin(`UPDATE design_identity.employments SET active=true WHERE employment_id=${quote(old.employmentId)};`),e=>String(e.stderr).includes('IDENTITY_IMMUTABLE'));
 });
 await test('offboarding rehire and A-B-A membership transitions never reactivate old tuples',async()=>{
  const first=await seed({id:205,label:'store-a-old',username:'transfer-alias'});await resolve(first.token,first.scope);
  f.sqlAdmin(`UPDATE design_identity.memberships SET active=false,membership_revision=2 WHERE membership_id=${quote(first.membershipId)};UPDATE design_identity.aliases SET active=false WHERE membership_id=${quote(first.membershipId)};`);
  const second=await seed({id:206,label:'store-b',username:'transfer-b',subjectId:first.subjectId,employmentId:first.employmentId,storeId:'synthetic-store-b',store:'向里造型',profileId:'22'});await resolve(second.token,second.scope);await deny(resolve(first.token,first.scope));
  f.sqlAdmin(`UPDATE design_identity.memberships SET active=false,membership_revision=2 WHERE membership_id=${quote(second.membershipId)};UPDATE design_identity.aliases SET active=false WHERE membership_id=${quote(second.membershipId)};`);
  const third=await seed({id:207,label:'store-a-new',username:'transfer-alias',subjectId:first.subjectId,employmentId:first.employmentId});const a=await resolve(third.token,third.scope);assert.notEqual(a.membershipId,first.membershipId);await deny(resolve(first.token,first.scope));await deny(resolve(second.token,second.scope));
  f.sqlAdmin(`UPDATE design_identity.employments SET active=false WHERE employment_id=${quote(first.employmentId)};`);await deny(resolve(third.token,third.scope));
  const rehire=await seed({id:208,label:'rehire',subjectId:first.subjectId});assert.notEqual((await resolve(rehire.token,rehire.scope)).employmentId,first.employmentId);await deny(resolve(first.token,first.scope));
 });
 await test('epoch changes source reassignment lifecycle and binding changes fail closed',async()=>{
  const x=await seed({id:209,label:'epoch'});f.sqlAdmin(`UPDATE design_identity.subjects SET security_epoch=2 WHERE subject_id=${quote(x.subjectId)};`);await deny(resolve(x.token,x.scope));
  const y=await seed({id:210,label:'source-change'});f.sqlAdmin(`UPDATE public.bookings SET barber_name='bob' WHERE id=${y.id};`);await deny(resolve(y.token,y.scope));
  const z=await seed({id:211,label:'lifecycle'});f.sqlAdmin(`UPDATE design_private.lifecycle_decisions SET allowed=false WHERE visit_id=${quote(z.scope.visitId)};`);await deny(resolve(z.token,z.scope));
  const b=await seed({id:212,label:'binding'});const before=await resolve(b.token,b.scope);f.sqlAdmin(`UPDATE design_identity.visit_bindings SET binding_revision=2 WHERE visit_id=${quote(b.scope.visitId)};`);assert.equal((await resolve(b.token,b.scope)).bindingRevision,'2');assert.equal(before.bindingRevision,'1');
 });
 await test('deferred deadline still rejects COMMIT after context was cleared',async()=>{
  const x=await seed({id:213,label:'deadline',expires:"interval '2 seconds'"}),c=await f.acquireRuntimeClient(),ops=createIdentityCapabilityOperations(c);
  try{await c.query('BEGIN');await ops.resolveAuthority({credential:x.token,scope:x.scope});await ops.clear();await c.query('SELECT pg_sleep(2.2) AS waited');await assert.rejects(c.query('COMMIT'),e=>e.code==='42501'&&e.message==='IDENTITY_AUTHORITY_EXPIRED');await c.query('ROLLBACK');}finally{await c.release();}
  assert.equal(f.sqlAdmin(`SELECT count(*) FROM design_identity.transaction_contexts WHERE session_hash=${quote(hash(x.token))};`),'0');
 });
 // Exposure control, deliberately NOT counted as a protection passing: a SQL
 // client may force a DEFERRABLE constraint early. Fixed adapters never do this.
 {
  const x=await seed({id:215,label:'deadline-immediate',expires:"interval '2 seconds'"}),c=await f.acquireRuntimeClient(),ops=createIdentityCapabilityOperations(c);
  try{await c.query('BEGIN');await ops.resolveAuthority({credential:x.token,scope:x.scope});await c.query('SET CONSTRAINTS ALL IMMEDIATE');await ops.clear();await c.query('SELECT pg_sleep(2.2) AS waited');assert.equal((await c.query('COMMIT')).command,'COMMIT');}finally{try{await c.query('ROLLBACK');}catch{}await c.release();}
  console.log('EXPOSED 1 - SET CONSTRAINTS IMMEDIATE permits expired commit after early trigger: deployment blocker, not a protection pass');
 }
 await test('each capability call still rejects expired context after attacker forced constraints early',async()=>{
  const x=await seed({id:216,label:'deadline-call',expires:"interval '2 seconds'"}),c=await f.acquireRuntimeClient(),ops=createIdentityCapabilityOperations(c);
  try{await c.query('BEGIN');const a=await ops.resolveAuthority({credential:x.token,scope:x.scope});await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SELECT pg_sleep(2.2) AS waited');await deny(ops.recheck(a));await c.query('ROLLBACK');}finally{await c.release();}
 });
 await test('authorization locks serialize revocation and next fresh transaction denies',async()=>{
  const x=await seed({id:214,label:'lock-order'}),c=await f.acquireRuntimeClient(),ops=createIdentityCapabilityOperations(c),revoker=f.client('identity-fixture-revoker');
  try{await c.query('BEGIN');const a=await ops.resolveAuthority({credential:x.token,scope:x.scope});await revoker.query('BEGIN');const change=revoker.query('UPDATE design_identity.employments SET active=false WHERE employment_id=$1 RETURNING employment_id',[x.employmentId]);
   for(let i=0;i<100;i++){if(Number(f.sqlAdmin("SELECT count(*) FROM pg_stat_activity WHERE application_name='identity-fixture-revoker' AND wait_event_type='Lock';"))>0)break;if(i===99)throw Error('REVOCATION_LOCK_NOT_OBSERVED');await new Promise(r=>setTimeout(r,10));}
   await ops.recheck(a);await ops.clear();await c.query('COMMIT');await change;await revoker.query('COMMIT');await deny(resolve(x.token,x.scope));
  }finally{try{await c.query('ROLLBACK');}catch{}try{await revoker.query('ROLLBACK');}catch{}await c.release();await revoker.release();}
 });
 await test('existing nonempty binding rows stay unchanged and this slice writes no legacy/workflow rows',async()=>{
  assert.equal(f.sqlAdmin("SELECT jsonb_build_object('bindings',(SELECT jsonb_agg(to_jsonb(v) ORDER BY visit_id,revision) FROM design_private.binding_versions v),'workflow',(SELECT jsonb_agg(to_jsonb(v) ORDER BY scope_key,revision) FROM design_private.workflow_versions v),'legacy',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_design_versions v));"),oldRows);
 });
 console.log(`PASS: ${passed} normal/denial non-owner identity capability cases; EXPOSED: 1 direct-SQL commit-deadline bypass. New slice only, NOT complete security acceptance or production migration.`);
}finally{await f.cleanup();console.log('cleanup ok - exact labelled synthetic identity container absent');}
