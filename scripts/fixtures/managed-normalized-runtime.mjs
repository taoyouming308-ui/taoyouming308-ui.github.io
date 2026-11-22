/** Stage36 isolated fixture. Actual immutable runtime/PG/key+request ledgers,
 * restricted canonical reader and fixed offline worker; native-version storage
 * and provider remain synthetic. Explicit issueDescribe is TEST SETUP only,
 * never supplied to the product runtime, query/load or browser code. */
import assert from 'node:assert/strict';
import {createManagedNormalizedProviderFixture} from './managed-normalized-provider.mjs';
import {createImmutableGenerationRuntime} from '../../packages/design-production-adapter/immutable-generation-runtime.mjs';
import {MANAGED_IMAGE_MODEL_ENDPOINT} from '../../packages/design-production-adapter/managed-image-model-request.mjs';
export async function createManagedNormalizedRuntimeFixture({origin='https://normalized-http.synthetic.invalid'}={}){
 const f=await createManagedNormalizedProviderFixture();let sends=0,keyOpens=0,loseProviderReply=false;
 const issued=new Map(),sealer={digest:(...a)=>f.sealer.digest(...a),async open(...a){keyOpens++;return f.sealer.open(...a);}};
 try{
  // A second legitimate, explicitly bound fixture visit tests navigation. It
  // does not receive an image task, provider approval or copied A history.
  await f.bridge.runRequest({credential:f.credential,scope:f.scopeB},()=>f.bridge.initialize());
  const makeRuntime=(enabled=true)=>createImmutableGenerationRuntime({enabled:true,acquireClient:f.acquire,proofReadsEnabled:true,publicOrigin:origin,allowedRequestOrigins:[origin],managedNormalized:{enabled,executionMode:'synthetic_mock',acquireVerificationClient:f.acquireCanonicalReader,storage:f.normalizedStorage,sealer,modelConfig:{model:f.modelConfig.model,maxOutputTokens:f.modelConfig.maxTokens},approvedModels:[f.modelConfig.model],transport:async request=>{
   sends++;assert.equal(request.url,MANAGED_IMAGE_MODEL_ENDPOINT);assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_stat_activity WHERE usename IN ('design_identity_runtime','design_normalization_runtime') AND state LIKE 'idle in transaction%'"),'0');
   if(loseProviderReply)throw Error('SYNTHETIC_REPLY_LOST_AFTER_SEND');return {url:request.url,status:200,redirected:false,body:f.normalizedResponse()};
  }}});
  async function issueDescribe(body,{taskId,maximumRequests=2}){
   assert.deepEqual(Object.keys(body).sort(),['scope','requestId','taskId','expectedWorkflowRevision'].sort());assert.deepEqual(body.scope,f.scope);assert.equal(body.taskId,taskId);assert.equal(issued.has(body.requestId),false,'test must expose duplicate describe HTTP instead of hiding it');assert(issued.size<maximumRequests,'only the enumerated explicit synthetic actions may receive approval');
   const plan=await f.normalizedPlan({requestId:body.requestId,taskId});assert.equal(body.expectedWorkflowRevision,plan.request.expectedWorkflowRevision);await f.normalizedApprove(plan);issued.set(body.requestId,plan);return plan;
  }
  return {...f,origin,makeRuntime,issueDescribe,setLostProviderReply:v=>{loseProviderReply=v===true;},runtimeCounts:()=>({...f.normalizedCounts(),sends,keyOpens,issued:issued.size}),runtimeSendCount:()=>sends,runtimeKeyOpenCount:()=>keyOpens,issuedRequests:issued};
 }catch(error){await f.cleanup();throw error;}
}
