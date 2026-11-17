/** Structural membership/session identity only. Trusted resolver must establish it. */
import {policyCopy} from './approval-attempt-contracts.mjs';
export function validateImmutableKeyIdentity(input){
 const x=policyCopy(input),keys=['schemaVersion','subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','expiresAt'];
 if(!x||Array.isArray(x)||Object.keys(x).sort().join('|')!==keys.sort().join('|')||x.schemaVersion!=='design-key-identity-v2')throw Error('KEY_IDENTITY_INVALID');
 for(const k of ['subjectId','employmentId','membershipId','storeId'])if(typeof x[k]!=='string'||!x[k]||x[k].length>160||x[k].trim()!==x[k]||/[\u0000-\u001f\u007f]/.test(x[k]))throw Error('KEY_IDENTITY_INVALID');
 for(const k of ['securityEpoch','membershipRevision','expiresAt'])if(!Number.isSafeInteger(x[k])||x[k]<1)throw Error('KEY_IDENTITY_INVALID');
 return Object.freeze(x);
}
export const immutableKeyOwner=x=>Object.freeze({subjectId:x.subjectId,employmentId:x.employmentId,membershipId:x.membershipId,storeId:x.storeId});
