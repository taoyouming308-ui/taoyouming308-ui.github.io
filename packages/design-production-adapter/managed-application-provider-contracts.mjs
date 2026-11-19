import {createHash} from 'node:crypto';
import {buildDesignImagePrompt} from '../prompts/design-image.mjs';
import {validateManagedApplicationResultInput as validateManagedApplicationInputBinding} from './managed-application-image-contracts.mjs';
export {validateManagedApplicationInputBinding};
/** Additive synthetic-only application provider v7. Existing v1-v6 remain unchanged. No native-version substitution. */
import {managedImageCanonical,managedImageDigest,MANAGED_IMAGE_CANDIDATE_BUDGETS} from './managed-image-contracts.mjs';
import {types} from 'node:util';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProviderKeyBinding} from './approval-attempt-contracts.mjs';
import {validateManagedImageModelTransportRequest} from './managed-image-model-request.mjs';
export const MANAGED_APPLICATION_INTENT_SCHEMA='design-provider-intent-v7';
const copy=v=>JSON.parse(managedImageCanonical(v)),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=(v,n=100)=>typeof v==='string'&&v.length<=n&&/^[A-Za-z0-9_-]+$/.test(v),integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=()=>{throw Error('MANAGED_MODEL_INTENT_INVALID');};
const own=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
export {validateManagedWorkflowBinding} from './managed-normalized-provider-contracts.mjs';
import {validateManagedWorkflowBinding} from './managed-normalized-provider-contracts.mjs';
export function validateManagedApplicationProviderIntent(value){const v=copy(value);exact(v,['requestId','kind','operation','destination','model','payloadSha256','byteLength','dataKinds','purpose','inputDigest','sourceRefs','maxOutputTokens','cost','schemaVersion','keyBinding','workflowBinding','applicationBinding']);if(v.schemaVersion!==MANAGED_APPLICATION_INTENT_SCHEMA||!id(v.requestId)||v.kind!=='external'||v.operation!=='analyze'||v.destination!=='https://api.deepseek.com/chat/completions'||typeof v.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(v.model)||!sha(v.payloadSha256)||!integer(v.byteLength,1,1048576)||!same(v.dataKinds,['synthetic_application_verified_image'])||v.purpose!=='synthetic_application_before_candidates_for_employee_review'||!same(v.sourceRefs,[])||!integer(v.maxOutputTokens,1,8192))fail();
 v.keyBinding=validateProviderKeyBinding(v.keyBinding);v.workflowBinding=validateManagedWorkflowBinding(v.workflowBinding);exact(v.applicationBinding,['promptVersion','input']);if(typeof v.applicationBinding.promptVersion!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(v.applicationBinding.promptVersion))fail();v.applicationBinding.input=validateManagedApplicationInputBinding(v.applicationBinding.input);const a=v.applicationBinding.input.verificationBinding.authority,k=v.keyBinding;
 if(k.purpose!=='chat'||k.destination!==v.destination||k.model!==v.model||k.securityEpoch!==a.securityEpoch||k.membershipRevision!==a.membershipRevision||!same(k.owner,Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(n=>[n,a[n]])))||v.inputDigest!==managedImageDigest(v.applicationBinding))fail();
 exact(v.cost,['currency','maximumMinorUnits','maximumDispatches','commitment']);if(typeof v.cost.currency!=='string'||!/^[A-Z]{3}$/.test(v.cost.currency)||!integer(v.cost.maximumMinorUnits,1,100000000)||v.cost.maximumDispatches!==1||v.cost.commitment!=='one_time')fail();return freeze(v);
}

export function buildManagedApplicationProviderIntent(value){
 const q=own(value,['prepared','keyBinding','workflowBinding','cost']);
 const p=own(q.prepared,['schemaVersion','state','requestId','input','model','maxOutputTokens','promptVersion','transportRequest','keyAccessAuthorized','requestLedgerAuthorized','submissionAuthorized','adoptionAuthorized','publicEligible']);
 if(p.schemaVersion!=='design-application-model-prepared-v1'||p.state!=='prepared_not_dispatched'||['keyAccessAuthorized','requestLedgerAuthorized','submissionAuthorized','adoptionAuthorized','publicEligible'].some(k=>p[k]!==false))fail();
 const t=validateManagedImageModelTransportRequest(p.transportRequest),input=validateManagedApplicationInputBinding(p.input),applicationBinding={promptVersion:p.promptVersion,input};
 const prompt=buildDesignImagePrompt();if(p.promptVersion!==prompt.promptVersion)fail();
 let parsed;try{parsed=JSON.parse(t.body);}catch{fail();}const url=parsed?.messages?.[1]?.content?.[1]?.image_url?.url;if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))fail();
 const base64=url.slice('data:image/png;base64,'.length),bytes=Buffer.from(base64,'base64');
 try{const output=input.verificationBinding.output;
 if(bytes.length!==output.byteLength||bytes.length>262144||bytes.toString('base64')!==base64||createHash('sha256').update(bytes).digest('hex')!==output.sha256)fail();
 const body=JSON.stringify({model:p.model,messages:[{role:'system',content:prompt.system},{role:'user',content:[{type:'text',text:'剪前单图；方向：'+input.angle+'。未知不得补猜，结果仅待员工复核。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+base64}}]}],max_tokens:p.maxOutputTokens,response_format:{type:'json_object'},stream:false});
 if(t.body!==body)fail();
 }finally{bytes.fill(0);}

 return validateManagedApplicationProviderIntent({schemaVersion:MANAGED_APPLICATION_INTENT_SCHEMA,requestId:p.requestId,kind:'external',operation:'analyze',destination:t.url,model:p.model,payloadSha256:t.payloadSha256,byteLength:t.byteLength,dataKinds:['synthetic_application_verified_image'],purpose:'synthetic_application_before_candidates_for_employee_review',inputDigest:managedImageDigest(applicationBinding),sourceRefs:[],maxOutputTokens:p.maxOutputTokens,cost:q.cost,keyBinding:q.keyBinding,workflowBinding:q.workflowBinding,applicationBinding});
}
