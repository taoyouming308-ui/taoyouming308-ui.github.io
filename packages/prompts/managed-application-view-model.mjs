/** Explicit application lane. Reuses limited visual rubric, never old input proofs. */
import {buildManagedViewModelPrompt} from './managed-view-model.mjs';
export function buildManagedApplicationViewModelPrompt(kind,context){
 const map={managed_application_completion_comparison:'managed_completion_comparison',managed_application_completion_synthesis:'managed_completion_synthesis'};
 if(!Object.hasOwn(map,kind))throw Error('APPLICATION_VIEW_PROMPT_INVALID');
 const p=buildManagedViewModelPrompt(map[kind],context);
 return Object.freeze({...p,promptVersion:p.promptVersion.replace('managed-','application-'),system:'仅固定合成演练，响应须人工核查，不能用于真实顾客。'+p.system});
}
