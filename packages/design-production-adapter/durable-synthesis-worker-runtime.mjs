/** Reviewed server composition only. Never starts a daemon or discovers credentials. */
import {createTrustedSynthesisWorkerPgPoolAdapter} from './trusted-synthesis-worker-pg-pool-adapter.mjs';
import {createPostgresDurableSynthesisWorkerRepository,createPostgresDurableSynthesisExecutionRepository} from './postgres-durable-synthesis-repository.mjs';
import {prepareDurableSynthesisPayload} from './durable-synthesis-payload.mjs';
import {createDurableSynthesisWorker} from './durable-synthesis-worker.mjs';
import {DurableSynthesisError} from './durable-synthesis-contracts.mjs';
import {policyCopy,policyFreeze} from './approval-attempt-contracts.mjs';
export function createDurableSynthesisWorkerRuntime({enabled=false,pool,sealer,transport,modelConfig,approvedTextModels=[],timeoutMs=30000}={}){
 const configuration=policyFreeze(policyCopy({modelConfig:modelConfig??null,approvedTextModels}));
 const adapter=createTrustedSynthesisWorkerPgPoolAdapter({enabled,pool,maxLeases:1,maxWaiting:2,acquireTimeoutMs:5000,queryTimeoutMs:10000});
 const repository=createPostgresDurableSynthesisWorkerRepository({enabled,acquireWorkerClient:adapter.acquireClient});
 const executionRepository=createPostgresDurableSynthesisExecutionRepository({enabled,acquireWorkerClient:adapter.acquireClient});
 const pump=createDurableSynthesisWorker({enabled,repository,executionRepository,buildPayload:value=>prepareDurableSynthesisPayload(value,configuration),sealer,transport,timeoutMs});
 const shutdown=new AbortController(),pending=new Set();let closing=null;
 function invoke(method,options={}){
  if(shutdown.signal.aborted)return Promise.reject(new DurableSynthesisError('DURABLE_DISABLED'));
  if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))return Promise.reject(new DurableSynthesisError('DURABLE_INVALID'));
  const signal=options.signal?AbortSignal.any([shutdown.signal,options.signal]):shutdown.signal;
  const task=pump[method]({...options,signal});pending.add(task);void task.finally(()=>pending.delete(task)).catch(()=>{});return task;
 }
 function close(){if(closing)return closing;shutdown.abort();closing=(async()=>{await Promise.allSettled([...pending]);await adapter.close();})();return closing;}
 return Object.freeze({runOnce:options=>invoke('runOnce',options),runBatch:options=>invoke('runBatch',options),close});
}
