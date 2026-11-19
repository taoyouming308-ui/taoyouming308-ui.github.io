/** Exact retained HTTP identity denial; never accept arbitrary non-200 responses. */
import assert from 'node:assert/strict';
export const IDENTITY_REJECTION={status:400,body:{ok:false,error:{code:'OPERATION_REJECTED',outcome:'unknown',retryable:false,message:'Request was not completed. Check authorization and exact saved state before any retry; never automatically repeat a potentially charged operation.'}}};
export function assertIdentityRejection(actual){assert.deepEqual(actual,IDENTITY_REJECTION);}
