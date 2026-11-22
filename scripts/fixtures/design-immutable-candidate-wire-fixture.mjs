/** Actual node-postgres runtime driver on the existing synthetic candidate fixture.
 * Installer/seed/independent issuer helpers remain explicitly psql tooling.
 * No production connection, key, socket mount, exposed port or new SQL grant.
 */
import {createImmutableCandidateProviderPostgresFixture} from './design-immutable-candidate-provider-fixture.mjs';
import {createFixturePgWirePool} from './design-pg-wire-pool.mjs';
import {instrumentCandidateFixtureClient} from './design-candidate-sql-profile.mjs';
import {createTrustedPgPoolAdapter} from '../../packages/design-production-adapter/trusted-pg-pool-adapter.mjs';
export async function createImmutableCandidateWireFixture({queryObserver,profileDatabase=false,canonicalLeaves=true}={}){
 const f=await createImmutableCandidateProviderPostgresFixture({profileDatabase,canonicalLeaves});let wire,adapter;
 try{
  wire=createFixturePgWirePool(f,{max:2});
  adapter=createTrustedPgPoolAdapter({enabled:true,pool:wire.pool,maxLeases:2,maxWaiting:32,acquireTimeoutMs:10000,queryTimeoutMs:20000});
  const acquire=async()=>instrumentCandidateFixtureClient(await adapter.acquireClient(),queryObserver);
  let cleaned=false;
  return Object.freeze({...f,acquire,driver:'pg-8.16.3-wire-docker-relay',wireStats:wire.stats,
   async cleanup(){if(cleaned)return;const errors=[];for(const work of [()=>adapter.close(),()=>wire.close(),()=>f.cleanup()])try{await work();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'SYNTHETIC_WIRE_CLEANUP_FAILED');cleaned=true;console.log('STAGE21_WIRE_CLEANUP '+JSON.stringify(wire.stats()));}
  });
 }catch(error){try{await adapter?.close();}finally{try{await wire?.close();}finally{await f.cleanup();}}throw error;}
}
