/** Distinct managed v5 transport factory. Reuses the independently bounded 1MiB
 * wire implementation without widening either v4 or the old 196608-byte path.
 * No default network; no automatic retry; dispatch authority lives in the ledger. */
import {createManagedImageModelTransport} from './managed-image-model-transport.mjs';
export const MANAGED_VIEW_MODEL_MAX_BODY_BYTES=1048576;
export function createManagedViewModelTransport(options){return createManagedImageModelTransport(options);}
