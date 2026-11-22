import {createManagedApplicationViewPrepareService} from './managed-application-view-prepare-service.mjs';
/** Server-only synthetic composition. Each request gets its own bounded I/O
 * lifetime; durable PG claims, never an in-memory cache, determine replay.
 * Existing restricted roles remain distinct. This factory cannot issue source,
 * processing, derived-storage or provider/cost permissions. No default network,
 * decoder, credential, deployment or production enablement is supplied. */
import {createManagedContentLedger} from './managed-content-ledger.mjs';
import {createManagedContentStore} from './managed-content-store.mjs';
import {createManagedApplicationSourceRepository} from './managed-application-source-repository.mjs';
import {createManagedApplicationContentLedger} from './managed-application-content-ledger.mjs';
import {createManagedApplicationContentStore} from './managed-application-content-store.mjs';
import {createManagedApplicationContentReader} from './managed-application-content-reader.mjs';
import {createManagedContentProcessing} from './managed-content-processing-ledger.mjs';
import {createManagedContentCanonicalLedger,createManagedContentCanonicalIssuers} from './managed-content-canonical-ledger.mjs';
import {createManagedApplicationImageService,ManagedApplicationImageServiceError} from './managed-application-image-service.mjs';
import {createManagedApplicationPrepareService,ManagedApplicationPrepareError} from './managed-application-prepare-service.mjs';
import {createManagedContentNormalizationOperation} from './managed-content-normalization-operation.mjs';
import {createManagedContentVerificationRunner} from './managed-content-verification-runner.mjs';
export function applicationRuntimeReady(c){return c?.enabled===true&&c.executionMode==='synthetic_mock'&&['acquireProcessingClient','acquireAuthorizerClient','acquireVerifierClient'].every(k=>typeof c[k]==='function')&&typeof c.backend?.createOnly==='function'&&typeof c.backend?.readExact==='function'&&typeof c.imageRuntime?.normalizeApplicationSource==='function'&&typeof c.imageRuntime?.verifyApplicationTask==='function';}
export function createManagedApplicationRuntime({enabled=false,acquireClient,config={},authenticate,viewPreparationEnabled=false}={}){
 const ready=enabled===true&&applicationRuntimeReady(config)&&typeof acquireClient==='function'&&typeof authenticate==='function',timeoutMs=config.timeoutMs??30000;
 const sourceRepo=createManagedApplicationSourceRepository({enabled:ready,acquireClient}),sourceLedger=createManagedContentLedger({enabled:ready,acquireClient}),derivedLedger=createManagedApplicationContentLedger({enabled:ready,acquireClient});
 const processing=createManagedContentProcessing({enabled:ready,acquireClient:config.acquireProcessingClient}),canonical=createManagedContentCanonicalLedger({enabled:ready,acquireClient:config.acquireProcessingClient}),issuers=createManagedContentCanonicalIssuers({enabled:ready,acquireAuthorizerClient:config.acquireAuthorizerClient,acquireVerifierClient:config.acquireVerifierClient});
 const sourceStore=()=>createManagedContentStore({enabled:ready,ledger:sourceLedger,backend:config.backend,timeoutMs,maxBytes:8388608}),derivedStore=()=>createManagedApplicationContentStore({enabled:ready,ledger:derivedLedger,backend:config.backend,timeoutMs,maxBytes:262144});
 const storage=createManagedApplicationContentReader({enabled:ready,repository:derivedLedger,sourceStore:{read:q=>sourceStore().read(q)},derivedStore:{read:q=>derivedStore().read(q)}});
 const imageFactory=()=>createManagedApplicationImageService({enabled:ready,executionMode:config.executionMode,repository:sourceRepo,ledger:sourceLedger,backend:config.backend,timeoutMs});
 const prepareFactory=(view=false)=>(view?createManagedApplicationViewPrepareService:createManagedApplicationPrepareService)({enabled:ready&&(!view||viewPreparationEnabled===true),mode:config.executionMode,sourceRepo,processing,
  operation:createManagedContentNormalizationOperation({enabled:ready,processing,storage,runtime:config.imageRuntime,timeoutMs}),derivedStore:{put:q=>derivedStore().put(q)},taskIssuer:issuers,canonical,
  runner:createManagedContentVerificationRunner({enabled:ready,issuer:issuers,storage,runtime:config.imageRuntime,timeoutMs}),timeoutMs,taskTtlMs:config.taskTtlMs??60000});
 const invoke=async(factory,method,q,kind)=>{if(!ready)throw Error('APPLICATION_RUNTIME_DISABLED');await authenticate(q.credential);const value=await factory()[method](q);try{await authenticate(q.credential);}catch{if(kind==='prepare')throw new ManagedApplicationPrepareError(method==='prepare'?'APPLICATION_PREPARE_UNCERTAIN':'APPLICATION_PREPARE_DENIED',method==='prepare');throw new ManagedApplicationImageServiceError('APPLICATION_IMAGE_DENIED',method==='status'?'not_sent':'uncertain');}return value;};
 return Object.freeze({enabled:ready,storage,canonical,
  images:Object.freeze(Object.fromEntries(['upload','status','reconcile'].map(k=>[k,q=>invoke(imageFactory,k,q)]))),
  prepare:Object.freeze(Object.fromEntries(['prepare','status'].map(k=>[k,q=>invoke(prepareFactory,k,q,'prepare')]))),
  viewPrepare:Object.freeze(Object.fromEntries(['prepare','status'].map(k=>[k,q=>{if(viewPreparationEnabled!==true)throw Error('APPLICATION_VIEW_PREPARE_DISABLED');return invoke(()=>prepareFactory(true),k,q,'prepare');}]))),
 });
}
