/** Fixed same-connection capabilities. Caller owns BEGIN/identity context/COMMIT.
 * No connection creation, arbitrary SQL, transaction control or issuer privileges. */
import {types} from 'node:util';
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
const fail=()=>{const e=new Error('MANAGED_APPLICATION_VIEW_WORKFLOW_DENIED');e.code=e.message;e.retryable=false;throw e;};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=x=>{if(typeof x!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(x))fail();return x;};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function createManagedApplicationViewWorkflowAuthority(client){
 if(!client||types.isProxy(client))fail();const d=Object.getOwnPropertyDescriptor(client,'query');if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();const fn=d.value,query=(...args)=>Reflect.apply(fn,client,args);let busy=false,closed=false,poisoned=false;
 async function invoke(sql,input,boolean){if(closed||busy||poisoned){poisoned=true;fail();}busy=true;try{const value=copyManagedResultData(input);const r=await query(sql,[value]);if(closed||poisoned||!r||types.isProxy(r))fail();const d=Object.getOwnPropertyDescriptor(r,'rows');if(!d||!Object.hasOwn(d,'value')||types.isProxy(d.value)||!Array.isArray(d.value)||d.value.length!==1)fail();const item=Object.getOwnPropertyDescriptor(d.value,'0');if(!item||!Object.hasOwn(item,'value'))fail();const row=copyManagedResultData(item.value);exact(row,['value']);const out=row.value;if(boolean){if(out!==true)fail();}else{exact(out,['candidate','inputs']);}return freeze(out);}catch{poisoned=true;fail();}finally{busy=false;}}
 function checked(v,keys){const x=copyManagedResultData(v);exact(x,keys);return x;}
 return Object.freeze({
 publish(v){const x=checked(v,['requestId']);id(x.requestId);return invoke('SELECT design_managed_normalized_workflow.publish_application_view($1::jsonb) AS value',x,false);},
 readCandidate(v){const x=checked(v,['candidateId']);id(x.candidateId);return invoke('SELECT design_managed_normalized_workflow.read_application_view_candidate($1::jsonb) AS value',x,false);},
 appendManaged(v){const x=checked(v,['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt']);return invoke('SELECT design_managed_normalized_workflow.append_application_view($1::jsonb) AS value',x,true);},
 verifyHistory(v){const x=checked(v,['managedImageHistory']);return invoke('SELECT design_managed_normalized_workflow.verify_application_view_history($1::jsonb) AS value',x,true);},
 requireConsumed(v){const x=checked(v,['candidateId','acceptance','recordSha256']);id(x.candidateId);return invoke('SELECT design_managed_normalized_workflow.require_application_view_consumed($1::jsonb) AS value',x,true);},
 close(){closed=true;if(busy)poisoned=true;return !busy;}
 });
}
