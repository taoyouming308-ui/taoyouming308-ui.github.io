/** Private application refs only. No fallback into native object versions. */
import {policyEqual} from './approval-attempt-contracts.mjs';
import {buildManagedApplicationViewInput} from './managed-application-view-input.mjs';
export function createManagedApplicationViewVerifiedInputAccess({enabled=false,ledger,storage}={}){
 return Object.freeze({async read(q){if(enabled!==true||typeof ledger?.readVerified!=='function'||typeof storage?.read!=='function')throw Error('APPLICATION_VIEW_INPUT_DISABLED');const first=await ledger.readVerified(q),input=buildManagedApplicationViewInput(first);if(input.taskId!==q.taskId||!policyEqual(input.verificationBinding.authority.scope,q.scope))throw Error('APPLICATION_VIEW_INPUT_DENIED');const stored=await storage.read({credential:q.credential,scope:q.scope,reference:input.verificationBinding.normalizedReference});const last=await ledger.readVerified(q);if(!policyEqual(first,last)||!policyEqual(stored.manifest,first.task.normalizedManifest))throw Error('APPLICATION_VIEW_INPUT_CHANGED');return {task:first.task,report:first.report,manifest:stored.manifest,bytes:stored.bytes};}});
}
