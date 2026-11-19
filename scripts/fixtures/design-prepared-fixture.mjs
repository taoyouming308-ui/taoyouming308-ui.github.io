/** Test-only synthetic in-memory transaction, not a production repository. */
import assert from 'node:assert/strict';
import {createPreparedWorkflowRecord,createPreparedWorkflowService} from '../../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createDesignSession} from '../../packages/analysis-engine/design-pilot.mjs';
export const copy=v=>JSON.parse(JSON.stringify(v));
export const credential='SYNTHETIC_SESSION_ONLY';
export const scopeA={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
export const scopeB={customerProfileId:'12',visitId:'booking:102',assignmentSource:'appointment'};
export const customers=[{id:'A',title:'合成预约 A',scope:scopeA},{id:'B',title:'合成预约 B',scope:scopeB}];
export function preparedFixture(){
 const state={active:true,actor:{username:'synthetic-employee',store:'synthetic-store'},records:new Map(),receipts:new Map(),mediaActive:true,beforeCommit:async()=>{},afterCommit:async()=>{},writes:0};let queue=Promise.resolve(),serial=0;
 for(const scope of [scopeA,scopeB])state.records.set(scope.customerProfileId,createPreparedWorkflowRecord({scope,store:state.actor.store,session:createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'synthetic-native-'+scope.customerProfileId})}));
 const gate={async authorize(token,scope){assert.equal(token,credential);if(!state.active||![scopeA,scopeB].some(s=>JSON.stringify(s)===JSON.stringify(scope)))throw Error('denied');return {actor:copy(state.actor),scope:copy(scope)};}};
 const mediaResolver=async({grant,scope,mediaIds})=>{if(!state.mediaActive||grant.actor.store!==state.actor.store||scope.customerProfileId!=='11'||mediaIds.some(id=>!['synthetic-before','synthetic-after','synthetic-detail'].includes(id)))throw Error('media denied');return mediaIds.map(mediaId=>({mediaId,stage:mediaId==='synthetic-before'?'before':mediaId==='synthetic-after'?'after':'reference',angle:mediaId==='synthetic-detail'?'detail':'front',mime:'image/png',byteLength:123,width:64,height:64}));};
 const repository={transaction(context,work){const job=queue.then(async()=>{const records=new Map([...state.records].map(([k,v])=>[k,copy(v)])),receipts=new Map([...state.receipts].map(([k,v])=>[k,copy(v)])),hooks=[],key=context.scope.customerProfileId;const tx={permissionGate:gate,async read(){return copy(records.get(key));},async findReceipt(k){return receipts.has(k)?copy(receipts.get(k)):null;},async write({expectedRevision,record,receiptKey,receipt}){if(records.get(key).revision!==expectedRevision)return false;records.set(key,copy(record));receipts.set(receiptKey,copy(receipt));state.writes++;return true;},async beforeCommit(fn){hooks.push(fn);}};const result=await work(tx);await state.beforeCommit();for(const hook of hooks)await hook();state.records=records;state.receipts=receipts;await state.afterCommit();return result;});queue=job.catch(()=>{});return job;}};
 const service=createPreparedWorkflowService({enabled:true,permissionGate:gate,repository,mediaResolver,mediaVerifier:mediaResolver});
 const adapter={load:scope=>service.load({credential,scope}),dispatch:(scope,request)=>service.dispatch({credential,scope,...request}),snapshot:scope=>service.snapshot({credential,scope}),transcript:async()=>({kind:'speech_transcript',text:'【合成测试】转写候选，左侧使用合成杠乙。',confirmed:false})};
 async function send(intent,scope=scopeA,extra={}){return service.dispatch({credential,scope,requestId:'synthetic-'+(++serial),expectedRevision:state.records.get(scope.customerProfileId).revision,intent,...extra});}
 return {state,gate,repository,mediaResolver,service,adapter,send,record:(scope=scopeA)=>copy(state.records.get(scope.customerProfileId))};
}
