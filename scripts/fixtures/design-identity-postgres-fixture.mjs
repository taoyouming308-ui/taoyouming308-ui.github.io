/** Isolated identity/RLS fixture. sqlAdmin is installer/seed only, never the tested runtime identity. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDesignPostgresFixture} from './design-postgres-fixture.mjs';
import {createIdentityCapabilityOperations} from '../../packages/design-production-adapter/identity-capability-postgres.mjs';
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function createDesignIdentityPostgresFixture({timingObserver,profileDatabase=false}={}){
 const base=await createDesignPostgresFixture({timingObserver,profileDatabase});
 const runtimeRole='design_identity_runtime',capabilityOwner='design_identity_capability',identityOwner='design_identity_owner';
 try{
  base.sql(readFileSync(new URL('../../packages/design-production-adapter/drafts/stage13-identity-capability-fixture.sql',import.meta.url),'utf8'));
  const scopeC=await base.seedSource(103,{customerProfileId:'12',staffUsername:'bob'});
  base.sql(`
   INSERT INTO design_identity.subjects(subject_id,security_epoch,active) VALUES('synthetic-subject-alice',1,true),('synthetic-subject-bob',1,true);
   INSERT INTO design_identity.employments(employment_id,subject_id,active) VALUES('synthetic-employment-alice','synthetic-subject-alice',true),('synthetic-employment-bob','synthetic-subject-bob',true);
   INSERT INTO design_identity.stores(store_id,label,active) VALUES('synthetic-store-a',${quote(base.store)},true),('synthetic-store-b','向里造型',true);
   INSERT INTO design_identity.memberships(membership_id,employment_id,store_id,membership_revision,active) VALUES('synthetic-membership-alice','synthetic-employment-alice','synthetic-store-a',1,true),('synthetic-membership-bob','synthetic-employment-bob','synthetic-store-a',1,true);
   INSERT INTO design_identity.aliases(alias_id,membership_id,store_id,username,active) VALUES('synthetic-alias-alice','synthetic-membership-alice','synthetic-store-a','alice',true),('synthetic-alias-bob','synthetic-membership-bob','synthetic-store-a','bob',true);
   INSERT INTO design_identity.sessions(session_hash,subject_id,employment_id,membership_id,security_epoch,membership_revision,expires_at,revoked) VALUES(${quote(hash(base.tokens.alice))},'synthetic-subject-alice','synthetic-employment-alice','synthetic-membership-alice',1,1,clock_timestamp()+interval '1 hour',false),(${quote(hash(base.tokens.bob))},'synthetic-subject-bob','synthetic-employment-bob','synthetic-membership-bob',1,1,clock_timestamp()+interval '1 hour',false);
   INSERT INTO design_identity.visit_bindings(assignment_source,visit_id,customer_profile_id,membership_id,store_id,business_date,binding_revision,active) VALUES('appointment','booking:101',11,'synthetic-membership-alice','synthetic-store-a','2026-11-15',1,true),('appointment','booking:102',12,'synthetic-membership-alice','synthetic-store-a','2026-11-15',1,true),('appointment','booking:103',12,'synthetic-membership-bob','synthetic-store-a','2026-11-15',1,true);
   INSERT INTO design_identity.scope_records(record_id,scope,store_id,payload) VALUES('synthetic-record-a',${quote(JSON.stringify(base.scopeA))}::jsonb,'synthetic-store-a','{"original":"synthetic A"}'),('synthetic-record-b',${quote(JSON.stringify(base.scopeB))}::jsonb,'synthetic-store-a','{"original":"synthetic B"}'),('synthetic-record-c',${quote(JSON.stringify(scopeC))}::jsonb,'synthetic-store-a','{"original":"synthetic C"}');
  `);
  return Object.freeze({...base,scopeC,runtimeRole,capabilityOwner,identityOwner,
   sqlAdmin:base.sql,
   acquireRuntimeClient:async()=>base.clientForRole(runtimeRole,'identity-runtime'),
   identityOperations:createIdentityCapabilityOperations,
  });
 }catch(error){await base.cleanup();throw error;}
}
