/** v5 request facade over the ORIGINAL durable provider ledger. No key opening or transport. */
import {createManagedViewProviderAccess} from './managed-view-provider-access.mjs';
import {createDurableProviderPolicy} from './durable-provider-policy.mjs';
import {policyCopy as copy,policyExact as exact,policyEqual as same,policyFreeze as freeze,policyLegacyBinding} from './approval-attempt-contracts.mjs';
import {validateManagedViewProviderIntent,managedViewSelectors} from './managed-view-provider-contracts.mjs';
export class ManagedViewProviderError extends Error{constructor(outcome='not_sent'){super('MANAGED_VIEW_PROVIDER_DENIED');this.code=this.message;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedViewProviderError();};
const sanitized=e=>{let uncertain=false;try{const d=Object.getOwnPropertyDescriptor(e,'outcome');uncertain=d&&Object.hasOwn(d,'value')&&d.value==='uncertain';}catch{}return new ManagedViewProviderError(uncertain?'uncertain':'not_sent');};
export function createManagedViewProviderFacade({enabled=false,acquireClient}={}){
 const access=createManagedViewProviderAccess({enabled,acquireClient});
 async function bind(input,query=false){if(enabled!==true)fail();const r=copy(input);exact(r,['credential','scope','requestId',...(query?[]:['candidateKind','selectors'])]);
 const approvalInput={credential:r.credential,scope:r.scope,requestId:r.requestId};let issued,ctx;
 let registered=null;
 try{if(query){registered=await access.readRegistered(approvalInput);ctx=await access.readContext({...approvalInput,candidateKind:registered.intent.candidateKind,selectors:managedViewSelectors(registered.intent)});if(registered.intent.kind==='external')issued=await access.readApproval(approvalInput);}else{ctx=await access.readContext(r);if(ctx.keyBinding!==null)issued=await access.readApproval(approvalInput);}const intent=query?registered.intent:issued?.intent;if(intent&&(!same(intent.keyBinding,ctx.keyBinding)||!same(intent.workflowBinding,ctx.workflowBinding)||!same(intent.evidenceBinding,ctx.evidenceBinding)||intent.requestId!==r.requestId))fail();if(issued&&!same(issued.authority,ctx.authority)||registered&&!same(registered.authority,ctx.authority))fail();}catch(e){throw sanitized(e);}
 const local=ctx.keyBinding===null,context=freeze({...ctx,approvedIntent:issued?.intent??null,intent:registered?.intent??issued?.intent??null});let closed=false,busy=false,handles=null,pair=null,created=false;
 const work=async fn=>{if(closed||busy)fail();busy=true;try{return await fn();}catch(e){closed=true;throw sanitized(e);}finally{busy=false;}};
 async function freshApproval(){const a=await access.readApproval(approvalInput);if(!same(a,issued))fail();return a;}
 const readResult=()=>work(()=>access.readResult(approvalInput));
 if(query){const {keyRecord,...publicContext}=context;return freeze({context:publicContext,readResult});}
 return freeze({context,
 reserve:input=>work(async()=>{const v=copy(input);exact(v,['intent']);const intent=validateManagedViewProviderIntent(v.intent);if(handles||(local?intent.kind!=='local':!same(intent,issued.intent)))fail();if(!same(intent.keyBinding,ctx.keyBinding)||!same(intent.workflowBinding,ctx.workflowBinding)||!same(intent.evidenceBinding,ctx.evidenceBinding)||intent.requestId!==r.requestId)fail();
 const issuer={async verify(v){v=copy(v);exact(v,['action','evidence','authority','requestId']);exact(v.evidence,['requestId']);if(v.action!=='approve'||v.requestId!==r.requestId||v.evidence.requestId!==r.requestId||!same(v.authority,ctx.authority))fail();return freshApproval();}};
 const policy=createDurableProviderPolicy({enabled:true,repository:access.createPolicyRepository(),approvalIssuer:issuer,intentResolver:async()=>{await freshApproval();return intent;}});
 if(local)await access.registerLocal({request:approvalInput,intent});else await policy.persistApproval({...approvalInput,evidence:{requestId:r.requestId}});handles=await policy.forRequest(approvalInput);pair=policyLegacyBinding(ctx.authority,intent);
 const disclosure=local?intent:{...intent,actor:ctx.authority.actor,scope:r.scope,stage:'before_reserve'};if(!local)await handles.processingGate(disclosure);await handles.attemptStore.bind({...pair,disclosure});const result=await handles.attemptStore.reserve(pair);created=result.created===true;return result;
 }),
 dispatchClaim:()=>work(async()=>{if(!handles||!created)fail();return local?handles.attemptStore.authorizeReturn(pair):handles.attemptStore.authorizeDispatch(pair);}),
 complete:input=>work(async()=>{const v=copy(input);exact(v,['result']);if(!handles||!created)fail();return handles.attemptStore.settle({...pair,state:'completed',result:v.result});}),
 readResult,
 markUncertain:()=>work(async()=>{if(!handles||!created)fail();return handles.attemptStore.settle({...pair,state:'uncertain'});})
 });
 }
 return Object.freeze({forRequest:input=>bind(input),forQuery:input=>bind(input,true)});
}
