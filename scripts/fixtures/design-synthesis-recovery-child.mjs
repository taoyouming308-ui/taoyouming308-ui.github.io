/** TEST ONLY actual Node worker process. IPC never receives an employee bearer/key. */
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFixtureSynthesisWorkerPgWirePool} from './design-synthesis-worker-pg-wire-pool.mjs';
import {STAGE18_MODEL_CONFIG} from './design-immutable-provider-fixture.mjs';
import {createTrustedSynthesisWorkerPgPoolAdapter} from '../../packages/design-production-adapter/trusted-synthesis-worker-pg-pool-adapter.mjs';
import {createPostgresDurableSynthesisWorkerRepository} from '../../packages/design-production-adapter/postgres-durable-synthesis-repository.mjs';
import {createPostgresDurableSynthesisExecutionRepository} from '../../packages/design-production-adapter/postgres-durable-synthesis-execution-repository.mjs';
import {createDurableSynthesisWorker} from '../../packages/design-production-adapter/durable-synthesis-worker.mjs';
import {prepareDurableSynthesisPayload} from '../../packages/design-production-adapter/durable-synthesis-payload.mjs';
import {createImmutableDesignKeySealer} from '../../packages/design-production-adapter/key-crypto.mjs';
import {designSynthesisReviewChoices} from '../../packages/analysis-engine/design-candidate.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const send=message=>new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
process.once('message',async input=>{
 let wire,adapter,transportCalls=0,keyOpens=0,prepared;
 try{
  assert.deepEqual(Object.keys(input).sort(),['container','mode']);assert(['prepare','transport','complete'].includes(input.mode));assert(/^design-workflow-synthetic-[0-9]+-[a-f0-9]{8}$/.test(input.container));
  wire=createFixtureSynthesisWorkerPgWirePool({container:input.container,db:'design_executor_synthetic',runtimeRole:'design_identity_runtime'},{max:1});
  adapter=createTrustedSynthesisWorkerPgPoolAdapter({enabled:true,pool:wire.pool,maxLeases:1,maxWaiting:1,acquireTimeoutMs:5000,queryTimeoutMs:10000});
  const repository=createPostgresDurableSynthesisWorkerRepository({enabled:true,acquireWorkerClient:adapter.acquireClient});
  const actual=createPostgresDurableSynthesisExecutionRepository({enabled:true,acquireWorkerClient:adapter.acquireClient});
  const checkpoint=async phase=>{
   // Every short transaction has released/destroyed its socket before a crash.
   for(let i=0;i<100&&wire.stats().activeRelayChildren;i++)await new Promise(r=>setTimeout(r,10));
   const stats=wire.stats();assert.equal(stats.activeRelayChildren,0);assert.equal(stats.totalCount,0);
   await send({type:'checkpoint',phase,transportCalls,keyOpens,stats});await new Promise(()=>{});
  };
  const executionRepository={...actual,async prepare(fenced){prepared=await actual.prepare(fenced);if(input.mode==='prepare')await checkpoint('prepare');return prepared;}};
  const original=createImmutableDesignKeySealer({secretProvider:async()=>new Uint8Array(32).fill(42),cryptoProvider:webcrypto});
  const sealer={...original,async open(...args){keyOpens++;return original.open(...args);}};
  const worker=createDurableSynthesisWorker({enabled:true,repository,executionRepository,sealer,timeoutMs:30000,
   buildPayload:value=>prepareDurableSynthesisPayload(value,{modelConfig:STAGE18_MODEL_CONFIG,approvedTextModels:[STAGE18_MODEL_CONFIG.model]}),
   transport:async request=>{transportCalls++;if(input.mode==='transport')await checkpoint('transport');const reviewFocus=designSynthesisReviewChoices(prepared.lease.intent.evidenceBinding.synthesis)[0];return {url:request.url,redirected:false,status:200,headers:{'content-type':'application/json'},body:JSON.stringify({id:'synthetic-recovery',object:'chat.completion',model:STAGE18_MODEL_CONFIG.model,created:1,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({reviewFocus})}}]})};}
  });
  const result=await worker.runOnce();await adapter.close();await wire.close();await send({type:'result',result,transportCalls,keyOpens,stats:wire.stats()});
 }catch{try{await adapter?.close();}catch{}try{await wire?.close();}catch{}await send({type:'failed',stats:wire?.stats()??null}).catch(()=>{});process.exitCode=1;}
 finally{process.disconnect();}
});
