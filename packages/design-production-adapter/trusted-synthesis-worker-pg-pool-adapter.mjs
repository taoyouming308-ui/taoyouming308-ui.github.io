/** Default-closed fixed design_synthesis_worker pool adapter.
 * Uses the shared physical-client exclusion/quarantine engine; never accepts a role
 * option or configures pg. Worker leases always destroy their physical connection
 * on release, even after COMMIT: no independently proven reusable cleanup exists.
 * Owner supplies a separate bounded pg.Pool, calls close(), then pool.end().
 */
export {createTrustedSynthesisWorkerPgPoolAdapter} from './trusted-pg-pool-adapter.mjs';
