/** v7 request facade over the ORIGINAL durable provider ledger. No key opening or transport. */
import {createManagedApplicationProviderAccess} from './managed-application-provider-access.mjs';
import {createDurableProviderPolicy} from './durable-provider-policy.mjs';
import {policyCopy as copy,policyExact as exact,policyEqual as same,policyFreeze as freeze,policyLegacyBinding,policyOwnerKey} from './approval-attempt-contracts.mjs';
import {validateManagedApplicationProviderIntent} from './managed-application-provider-contracts.mjs';
export class ManagedApplicationProviderError extends Error{constructor(outcome='not_sent'){super('MANAGED_APPLICATION_PROVIDER_DENIED');this.code=this.message;this.outcome=outcome==='uncertain'?'uncertain':'not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedApplicationProviderError();};
const sanitized=e=>{let uncertain=false;try{const d=Object.getOwnPropertyDescriptor(e,'outcome');uncertain=d&&Object.hasOwn(d,'value')&&d.value==='uncertain';}catch{}return new ManagedApplicationProviderError(uncertain?'uncertain':'not_sent');};
export function createManagedApplicationProviderFacade({enabled=false,acquireClient}={}){
 const access=createManagedApplicationProviderAccess({enabled,acquireClient});
 async function bind(input,query=false){if(enabled!==true)fail();const r=copy(input);exact(r,['credential','scope','requestId',...(query?[]:['taskId'])]);
 const approvalInput={credential:r.credential,scope:r.scope,requestId:r.requestId};let issued,ctx;
 try{issued=await access.readApproval(approvalInput);const taskId=query?issued.intent.applicationBinding.input.taskId:r.taskId;ctx=await access.readContext({...approvalInput,taskId});if(!same(issued.authority,ctx.authority)||issued.intent.requestId!==r.requestId||issued.intent.applicationBinding.input.taskId!==taskId||!same(issued.intent.keyBinding,ctx.keyBinding)||!same(issued.intent.workflowBinding,ctx.workflowBinding)||!same(issued.intent.applicationBinding.input,ctx.applicationInputBinding))fail();}catch(e){throw sanitized(e);}
 const context=freeze({...ctx,approvedIntent:issued.intent,approvedReceiptId:issued.receiptId,ownerKey:policyOwnerKey(ctx.authority,r.requestId)});let closed=false,busy=false,handles=null,pair=null,created=false;
 const work=async fn=>{if(closed||busy)fail();busy=true;try{return await fn();}catch(e){closed=true;throw sanitized(e);}finally{busy=false;}};
 async function freshApproval(){const a=await access.readApproval(approvalInput);if(!same(a,issued))fail();return a;}
 const readResult=()=>work(()=>access.readResult(approvalInput));
 if(query){const {keyRecord,...publicContext}=context;return freeze({context:publicContext,readResult});}
 return freeze({context,
 reserve:input=>work(async()=>{const v=copy(input);exact(v,['intent']);const intent=validateManagedApplicationProviderIntent(v.intent);if(handles||!same(intent,issued.intent))fail();
 const issuer={async verify(v){v=copy(v);exact(v,['action','evidence','authority','requestId']);exact(v.evidence,['requestId']);if(v.action!=='approve'||v.requestId!==r.requestId||v.evidence.requestId!==r.requestId||!same(v.authority,ctx.authority))fail();return freshApproval();}};
 const policy=createDurableProviderPolicy({enabled:true,repository:access.createPolicyRepository(),approvalIssuer:issuer,intentResolver:async()=>{await freshApproval();return intent;}});
 await policy.persistApproval({...approvalInput,evidence:{requestId:r.requestId}});handles=await policy.forRequest(approvalInput);pair=policyLegacyBinding(ctx.authority,intent);
 const disclosure={...intent,actor:ctx.authority.actor,scope:r.scope,stage:'before_reserve'};await handles.processingGate(disclosure);await handles.attemptStore.bind({...pair,disclosure});const result=await handles.attemptStore.reserve(pair);created=result.created===true;return result;
 }),
 dispatchClaim:()=>work(async()=>{if(!handles||!created)fail();return handles.attemptStore.authorizeDispatch(pair);}),
 complete:input=>work(async()=>{const v=copy(input);exact(v,['result']);if(!handles||!created)fail();return handles.attemptStore.settle({...pair,state:'completed',result:v.result});}),
 readResult,
 markUncertain:()=>work(async()=>{if(!handles||!created)fail();return handles.attemptStore.settle({...pair,state:'uncertain'});})
 });
 }
 return Object.freeze({forRequest:input=>bind(input),forQuery:input=>bind(input,true)});
}
