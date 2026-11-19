import {createManagedApplicationViewHttpService} from './managed-application-view-http-service.mjs';
import {createManagedApplicationViewModelRequestPreparer} from './managed-application-view-model-request.mjs';
import {createManagedApplicationViewDispatcher} from './managed-application-view-model-dispatcher.mjs';
import {createManagedApplicationViewProviderFacade} from './managed-application-view-provider-facade.mjs';
import {createManagedApplicationViewProviderAccess} from './managed-application-view-provider-access.mjs';
import {createManagedApplicationViewVerifiedInputAccess} from './managed-application-view-verified-input-access.mjs';
import {createManagedApplicationRuntime,applicationRuntimeReady} from './managed-application-runtime.mjs';
import {createManagedApplicationHttpService} from './managed-application-http-service.mjs';
import {createManagedApplicationModelPreview} from './managed-application-model-preview.mjs';
import {createManagedApplicationModelDispatcher} from './managed-application-model-dispatcher.mjs';
import {createManagedApplicationProviderFacade} from './managed-application-provider-facade.mjs';
import {projectWorkflowViewResult,projectWorkflowSnapshotPreview,projectFullWorkflowHistoryView,projectFullWorkflowSaveView} from './workflow-view-projector.mjs';
import {createManagedNormalizedHttpService} from './managed-normalized-http-service.mjs';
import {createCanonicalVerificationLedger} from './managed-canonical-verification-ledger.mjs';
import {createManagedNormalizedModelPreview} from './managed-normalized-model-preview.mjs';
import {createManagedNormalizedModelDispatcher} from './managed-normalized-model-dispatcher.mjs';
import {createManagedNormalizedProviderFacade} from './managed-normalized-provider-facade.mjs';
import {createManagedViewHttpService} from './managed-view-http-service.mjs';
import {createManagedViewVerifiedInputAccess} from './managed-view-verified-input-access.mjs';
import {createManagedViewModelRequestPreparer} from './managed-view-model-request.mjs';
import {createManagedViewDispatcher} from './managed-view-model-dispatcher.mjs';
import {createManagedViewProviderFacade} from './managed-view-provider-facade.mjs';
import {createManagedViewProviderAccess} from './managed-view-provider-access.mjs';
import {createManagedModelHttpService} from './managed-model-http-service.mjs';
import {createManagedDerivedLedger} from './managed-derived-ledger.mjs';
import {createManagedVerifiedInputAccess} from './managed-verified-input-access.mjs';
import {createManagedImageModelRequestPreparer} from './managed-image-model-request.mjs';
import {createManagedImageDispatcher} from './managed-image-dispatcher.mjs';
import {createManagedModelProviderFacade} from './managed-model-provider-facade.mjs';
import {createManagedImageService} from './managed-image-service.mjs';
import {createManagedImageLedger} from './managed-image-ledger.mjs';
/** Immutable request composition for the existing homepage, native services and ASR.
 * Default closed. No driver, key, receipt issuer, network or production UI enablement.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createPostgresDurableSynthesisRepository} from './postgres-durable-synthesis-repository.mjs';
import {createPostgresImmutableCandidateProviderAccess} from './postgres-immutable-candidate-provider-access.mjs';
import {createDurableSynthesisPreparation} from './durable-synthesis-preparation.mjs';
import {createImmutableDependencyRepository,ImmutableDependencyError} from './immutable-dependency-repository.mjs';
import {createPreparedWorkflowService,runPreparedRecordValidationScope} from './prepared-workflow-service.mjs';
import {createPrivateMediaService} from './private-media-service.mjs';
import {createDesignCandidateService} from './candidate-service.mjs';
import {createDesignCandidateAdapters} from './design-candidate-provider.mjs';
import {createDeepSeekSpeechAdapter} from './speech-adapter.mjs';
import {providerDigest,DEEPSEEK_CHAT_ENDPOINT,DEEPSEEK_ASR_ENDPOINT} from './provider-adapter.mjs';
import {createPostgresImmutableKeyRepository} from './postgres-immutable-key-repository.mjs';
import {createImmutableVisitRepository} from './immutable-visit-repository.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';
import {policyEqual,policyFreeze,policyCopy,policyDigest} from './approval-attempt-contracts.mjs';
import {createImmutableProviderRequestFacade} from './immutable-provider-request-facade.mjs';
import {buildSynthesisEvidence} from '../analysis-engine/design-candidate.mjs';
const ownerFields=['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision'];
const owner=x=>Object.fromEntries(ownerFields.map(k=>[k,x[k]]));
const denied=()=>{throw new ImmutableDependencyError('IMMUTABLE_DEPENDENCY_DENIED');};
export function createImmutableGenerationRuntime({enabled=false,acquireClient,proofReadsEnabled=false,publicOrigin,allowedRequestOrigins,media:mediaConfig,generation:generationConfig,managedImages:managedConfig,managedModel:managedModelConfig,managedViews:managedViewConfig,managedNormalized:normalizedConfig,browserViews:browserViewsConfig,applicationContent:applicationConfig,applicationViews:applicationViewsConfig}={}){
 if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
 // Independent synthetic-only mode. Neither old media flags nor a browser flag
 // can enable this route; no verifier, approval issuer or arbitrary task JSON is accepted.
 const browserViewsEnabled=browserViewsConfig?.enabled===true;
 const normalized=normalizedConfig||{},normalizedEnabled=browserViewsEnabled&&normalized.enabled===true&&normalized.executionMode==='synthetic_mock'&&typeof normalized.acquireVerificationClient==='function';
 const app=applicationConfig||{},applicationEnabled=browserViewsEnabled&&applicationRuntimeReady(app),av=applicationViewsConfig||{},applicationViewsEnabled=applicationEnabled&&av.enabled===true&&av.executionMode==='synthetic_mock';
 const httpScope=new AsyncLocalStorage(),bridge=createImmutableDependencyRepository({enabled:true,acquireClient,proofReadsEnabled,browserArchivesEnabled:browserViewsEnabled,managedNormalizedEnabled:normalizedEnabled,managedApplicationEnabled:applicationEnabled,managedApplicationViewsEnabled:applicationViewsEnabled,managedCandidatesEnabled:managedConfig?.enabled===true&&managedModelConfig?.enabled===true,managedViewsEnabled:managedConfig?.enabled===true&&managedViewConfig?.enabled===true}),identity=createPostgresImmutableKeyRepository({enabled:true,acquireClient}),visits=createImmutableVisitRepository({enabled:true,acquireClient});
 function pin(a){const s=httpScope.getStore();if(!s||s.closed||!s.identity||!policyEqual(owner(a),owner(s.identity))||s.authority&&!policyEqual(s.authority,a))denied();s.authority??=a;return a;}
 const run=(request,work)=>bridge.runRequest({credential:request.credential,scope:request.scope},async()=>{pin(await bridge.resolveAuthority());return work();});
 const gate=Object.freeze({authorize:(credential,scope)=>run({credential,scope},async()=>bridge.permissionGate.authorize(credential,scope))});
 const native=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository,mediaResolver:bridge.mediaResolver,mediaVerifier:bridge.mediaVerifier,candidateAcceptanceVerifier:bridge.verifySynthesisAcceptance});
 const workflow=Object.freeze({async load(request){await bridge.initialize();return native.load(request);},dispatch:request=>native.dispatch(request),snapshot:request=>native.snapshot(request)});
 const {enabled:mediaEnabled=false,approvalVerifier,imageInspector,imageNormalizer,storageOrigin,storageTransport}=mediaConfig||{};
 const privateMedia=Object.freeze(Object.fromEntries(['upload','read','preview','resolveReferences'].map(method=>[method,input=>createPrivateMediaService({enabled:mediaEnabled===true,permissionGate:bridge.permissionGate,metadataRepository:bridge.createMediaMetadataRepository({forUpload:method==='upload'}),approvalVerifier:{verify:(receipt,intent,phase,context)=>bridge.verifyMediaApproval(approvalVerifier,receipt,intent,phase,context)},imageInspector,imageNormalizer,storageOrigin,storageTransport})[method](input)])));
 const full=bridge.createFullWorkflowArchive({enabled:true});
 // Only server configuration is consulted. None of the legacy provider hooks,
 // user-selected endpoints/models, or caller-supplied candidate JSON are accepted.
 const cfg=generationConfig||{},generationEnabled=cfg.enabled===true&&typeof cfg.transport==='function'&&typeof cfg.sealer?.open==='function'&&typeof cfg.sealer?.digest==='function';
 let modelConfig=null,approvedTextModels=[],approvedVisionModels=[];
 try{modelConfig=cfg.modelConfig?policyFreeze(policyCopy(cfg.modelConfig)):null;approvedTextModels=policyFreeze(policyCopy(cfg.approvedTextModels||[]));approvedVisionModels=policyFreeze(policyCopy(cfg.approvedVisionModels||[]));}catch{}
 const modelReady=modelConfig?.approved===true&&typeof modelConfig.model==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(modelConfig.model)&&Number.isSafeInteger(modelConfig.maxTokens)&&modelConfig.maxTokens>0&&modelConfig.maxTokens<=8192;
 const textEnabled=generationEnabled&&modelReady&&Array.isArray(approvedTextModels)&&approvedTextModels.includes(modelConfig.model);
 const derivativeProvider=cfg.derivativeProvider,derivativeInspector=cfg.derivativeInspector;
 // New functionality requires new trusted flags; existing Stage18 configuration
 // must not silently enable image processing or synthesis.
 const visualEnabled=cfg.visualEnabled===true&&generationEnabled&&modelReady&&Array.isArray(approvedVisionModels)&&approvedVisionModels.includes(modelConfig.model)&&typeof derivativeProvider==='function'&&typeof derivativeInspector==='function'&&mediaEnabled===true&&typeof approvalVerifier?.verifyImmutable==='function'&&typeof imageInspector==='function'&&typeof storageTransport==='function'&&typeof storageOrigin==='string';
 const synthesisEnabled=cfg.enabled===true&&cfg.synthesisEnabled===true;
 const durableSynthesisEnabled=synthesisEnabled&&cfg.durableSynthesisEnabled===true;
 const transport=cfg.transport,facade=createImmutableProviderRequestFacade({enabled:cfg.enabled===true,acquireClient,sealer:cfg.sealer});
 const closed=()=>{throw new ImmutableDependencyError('IMMUTABLE_DEPENDENCY_DEPENDENCY_UNSUPPORTED');};
 async function prepared(request,kind){const result=await bridge.prepareGeneration({credential:request.credential,scope:request.scope,requestId:request.requestId,kind});pin(result.authority);return result;}
 async function candidateOperation(method,kind,request){
   if(method==='extract'?!textEnabled:method==='synthesize'?!synthesisEnabled:!visualEnabled)return closed();
   const initial=await prepared(request,kind);
   if(!policyEqual(initial.record.session,request.session))denied();
   let evidenceBinding,local=false;
   if(method==='describe'||method==='compare'){
    const media=method==='describe'?[request.media]:request.media;
    if(!Array.isArray(media)||media.length!==(method==='describe'?1:2))denied();
    const sourceRefs=media.map(m=>{
     if(!(m?.bytes instanceof Uint8Array)||m.bytes.length<1||m.bytes.length>8*1024*1024||!initial.record.photoRefs.some(p=>p.kind==='private_media'&&policyEqual(p.reference,m.reference)))denied();
     return {mediaId:m.reference.mediaId,sourceSha256:providerDigest(m.bytes)};
    });
    let comparison=null;
    if(method==='compare'){
     const [before,after]=media.map(m=>m.reference);
     if(before.stage!=='before'||after.stage!=='after'||before.angle!==after.angle||!['front','back','left','right'].includes(before.angle)||before.mediaId===after.mediaId)denied();
     comparison={beforeMediaId:before.mediaId,afterMediaId:after.mediaId,angle:before.angle};
    }
    evidenceBinding=policyFreeze({sourceRefs,comparison,synthesis:null});
    if(await bridge.verifyCandidateMedia({credential:request.credential,scope:request.scope,actor:initial.authority.actor,sourceRefs})!==true)denied();
   }else if(method==='synthesize'){
    if(!policyEqual(initial.record.modelCandidates||[],request.modelCandidates))denied();
    const evidence=buildSynthesisEvidence({session:initial.record.session,modelCandidates:initial.record.modelCandidates||[],side:request.side});
    evidenceBinding=policyFreeze({sourceRefs:evidence.sourceRefs,comparison:null,synthesis:evidence.synthesis});
    local=evidence.synthesis.generation==='deterministic';
    if(!local&&!textEnabled)return closed();
    if(await bridge.verifySynthesisAncestors({credential:request.credential,scope:request.scope,actor:initial.authority.actor,sessionId:initial.record.session.scope.sessionId,baseRevision:initial.record.session.revision,inputDigest:policyDigest(initial.record.session),...evidence})!==true)denied();
   }
   const hooks=await facade.forRequest({credential:request.credential,scope:request.scope,requestId:request.requestId,operation:local?'server_synthesis':'analyze',destination:local?'local':DEEPSEEK_CHAT_ENDPOINT,model:local?'server-deterministic':modelConfig.model,expectedAuthority:initial.authority,...(evidenceBinding?{candidateKind:kind,evidenceBinding}:{})});
   const sessionVerifier=async input=>{const latest=await prepared(request,kind);return policyEqual(input.scope,request.scope)&&input.credential===request.credential&&input.sessionId===latest.record.session.scope.sessionId&&input.baseRevision===latest.record.session.revision&&input.inputDigest===policyDigest(latest.record.session);};
   return createDesignCandidateAdapters({enabled:true,modelConfig,approvedTextModels,approvedVisionModels,permissionGate:bridge.permissionGate,sessionVerifier,mediaVerifier:bridge.verifyCandidateMedia,synthesisVerifier:bridge.verifySynthesisAncestors,derivativeProvider,derivativeInspector,transport,...hooks})[method](request);
 }
 const adapters=Object.freeze({extract:r=>candidateOperation('extract','text_extraction',r),describe:r=>candidateOperation('describe','visual_description',r),compare:r=>candidateOperation('compare','completion_comparison',r),synthesize:r=>candidateOperation('synthesize','completion_synthesis',r)});
 const candidates=createDesignCandidateService({enabled:true,permissionGate:bridge.permissionGate,workflowService:workflow,privateMedia,adapters,repository:bridge.createCandidateRepository({ttlMs:60000}),mediaVerifier:bridge.verifyCandidateMedia,synthesisVerifier:bridge.verifySynthesisAncestors});
 const speech=Object.freeze({async transcribe(request){
   if(!generationEnabled)return closed();
   const initial=await prepared(request,'speech');
   const hooks=await facade.forRequest({credential:request.credential,scope:request.scope,requestId:request.requestId,operation:'speech',destination:DEEPSEEK_ASR_ENDPOINT,model:null,expectedAuthority:initial.authority});
   return createDeepSeekSpeechAdapter({enabled:true,permissionGate:bridge.permissionGate,transport,...hooks}).transcribe(request);
 }});
 const wrapped=(service,methods)=>Object.freeze(Object.fromEntries(methods.map(method=>[method,request=>run(request,()=>service[method](request))])));
 const employeeAdapter={async authenticate(credential){const result=await identity.resolveIdentity({credential}),s=httpScope.getStore();if(!s||s.closed||s.identity&&!policyEqual(owner(s.identity),owner(result)))denied();s.identity??=result;return result;},gate};
 const discovery=async(method,request)=>{await employeeAdapter.authenticate(request.credential);const result=await visits[method](request);await employeeAdapter.authenticate(request.credential);return result;};
 const durableRepository=createPostgresDurableSynthesisRepository({enabled:durableSynthesisEnabled,acquireClient});
 const enqueuePreparation=createDurableSynthesisPreparation({enabled:durableSynthesisEnabled,prepareGeneration:r=>prepared(r,'completion_synthesis'),verifySynthesisAncestors:bridge.verifySynthesisAncestors,access:createPostgresImmutableCandidateProviderAccess({enabled:durableSynthesisEnabled,acquireClient}),repository:durableRepository,modelConfig,approvedTextModels});
 const durableService=Object.freeze({enqueue:r=>run(r,()=>enqueuePreparation.enqueue(r)),...Object.fromEntries(['status','lookup','list','cancel'].map(name=>[name,async r=>{await employeeAdapter.authenticate(r.credential);const result=await durableRepository[name](r);await employeeAdapter.authenticate(r.credential);return result;}]))});
 const managedEnabled=managedConfig?.enabled===true;
 const managedNative=createManagedImageService({...managedConfig,enabled:managedEnabled,repository:createManagedImageLedger({enabled:managedEnabled,acquireClient})});
 // Separate short transactions: never keep the workflow bridge locked over I/O.
 const managedBaseService=Object.freeze(Object.fromEntries(['upload','status'].map(method=>[method,async r=>{await employeeAdapter.authenticate(r.credential);const value=await managedNative[method](r);await employeeAdapter.authenticate(r.credential);return value;}]))) ;
 const derivedLedger=createManagedDerivedLedger({enabled:managedEnabled,acquireClient});
 const managedService=Object.freeze({...managedBaseService,async verificationStatus(r){
  await employeeAdapter.authenticate(r.credential);
  const v=await derivedLedger.readVerificationStatus({credential:r.credential,scope:r.scope,taskId:r.taskId});
  await employeeAdapter.authenticate(r.credential);
  return policyFreeze({schemaVersion:'design-managed-verification-status-v1',taskId:r.taskId,mediaId:v.sourceRecord.mediaId,sourceVersion:v.sourceRecord.object.version,state:v.verificationReport.state,modelSubmissionAuthorized:false});
 }});
 const mm=managedModelConfig||{},managedModelEnabled=managedEnabled&&mm.enabled===true;
 const managedModelService=createManagedModelHttpService({enabled:managedModelEnabled,run,authenticate:credential=>employeeAdapter.authenticate(credential),repository:bridge.createManagedCandidateRepository(),createDispatcher:()=>{
  const access=createManagedVerifiedInputAccess({enabled:managedModelEnabled,ledger:derivedLedger,storage:mm.storage});
  const preparer=createManagedImageModelRequestPreparer({enabled:managedModelEnabled,modelConfig:mm.modelConfig,approvedModels:mm.approvedModels,recipient:mm.recipient,purpose:mm.purpose,...access});
  return createManagedImageDispatcher({enabled:managedModelEnabled,preparer,facade:createManagedModelProviderFacade({enabled:managedModelEnabled,acquireClient}),sealer:mm.sealer,transport:mm.transport});
 }});
 const mv=managedViewConfig||{},managedViewsEnabled=managedEnabled&&mv.enabled===true;
 const viewAccess=createManagedViewProviderAccess({enabled:managedViewsEnabled,acquireClient});
 const managedViewService=createManagedViewHttpService({enabled:managedViewsEnabled,run,authenticate:credential=>employeeAdapter.authenticate(credential),repository:bridge.createManagedCandidateRepository({views:true}),verificationStatus:async r=>{
  const v=await derivedLedger.readVerificationStatus({credential:r.credential,scope:r.scope,taskId:r.taskId});return policyFreeze({schemaVersion:'design-managed-view-verification-v1',taskId:r.taskId,mediaId:v.sourceRecord.mediaId,stage:v.sourceRecord.stage,angle:v.sourceRecord.angle,sourceVersion:v.sourceRecord.object.version,derivativeVersion:v.objectReceipt.object.version,state:v.verificationReport.state,modelSubmissionAuthorized:false});
 },createDispatcher:()=>{
  const bytes=createManagedViewVerifiedInputAccess({enabled:managedViewsEnabled,ledger:derivedLedger,storage:mv.storage});
  const verifyCurrentEvidence=async r=>{const c=r.context,e=c.evidenceBinding,images=e.images,kind=images?(images.length===1?'managed_before_view':'managed_completion_comparison'):'managed_completion_synthesis',selectors=images?(images.length===1?{taskId:images[0].taskId}:{beforeTaskId:images[0].taskId,afterTaskId:images[1].taskId}):{side:e.side};const fresh=await viewAccess.readContext({credential:r.credential,scope:r.scope,requestId:r.requestId,candidateKind:kind,selectors});return ['authority','keyRecord','keyBinding','workflowBinding','evidenceBinding','session','managedImageHistory'].every(k=>policyEqual(fresh[k],c[k]));};
  const preparer=createManagedViewModelRequestPreparer({enabled:managedViewsEnabled,modelConfig:mv.modelConfig,approvedModels:mv.approvedModels,readVerifiedInput:bytes.readVerifiedInput,verifyCurrentEvidence});
  return createManagedViewDispatcher({enabled:managedViewsEnabled,preparer,facade:createManagedViewProviderFacade({enabled:managedViewsEnabled,acquireClient}),sealer:mv.sealer,transport:mv.transport});
 }});
 // Uses fixed PG capabilities for fresh provenance/authority. Injected storage,
 // sealer and mock transport are trusted server dependencies, never HTTP fields.
 // No transaction is held across preparation or transport, and publication uses
 // the same original immutable workflow bridge and original request ledger.
 const normalizedService=createManagedNormalizedHttpService({enabled:normalizedEnabled,run,
  authenticate:credential=>employeeAdapter.authenticate(credential),
  repository:bridge.createManagedCandidateRepository({normalized:true}),createDispatcher:()=>{
   const preparer=createManagedNormalizedModelPreview({enabled:normalizedEnabled,
    ledger:createCanonicalVerificationLedger({enabled:normalizedEnabled,acquireClient:normalized.acquireVerificationClient}),
    storage:normalized.storage,modelConfig:normalized.modelConfig,approvedModels:normalized.approvedModels,
    timeoutMs:normalized.timeoutMs??30000});
   return createManagedNormalizedModelDispatcher({enabled:normalizedEnabled,executionMode:normalized.executionMode,
    preparer,facade:createManagedNormalizedProviderFacade({enabled:normalizedEnabled,acquireClient}),
    sealer:normalized.sealer,transport:normalized.transport,timeoutMs:normalized.timeoutMs??30000});
  }});
 // Application manifest-v1 source and direct canonical-PNG-v2 remain distinct
 // from native-version media. The independent roles do not mint processing,
 // storage or fee approvals. Entire route family remains synthetic and opt-in.
 const application=createManagedApplicationRuntime({enabled:applicationEnabled,acquireClient,config:app,authenticate:credential=>employeeAdapter.authenticate(credential),viewPreparationEnabled:applicationViewsEnabled});
 const applicationModel=createManagedApplicationHttpService({enabled:applicationEnabled,run,
  authenticate:credential=>employeeAdapter.authenticate(credential),repository:bridge.createManagedCandidateRepository({application:true}),createDispatcher:()=>{
   const preparer=createManagedApplicationModelPreview({enabled:applicationEnabled,ledger:application.canonical,storage:application.storage,modelConfig:app.modelConfig,approvedModels:app.approvedModels,timeoutMs:app.timeoutMs??30000});
   return createManagedApplicationModelDispatcher({enabled:applicationEnabled,executionMode:app.executionMode,preparer,facade:createManagedApplicationProviderFacade({enabled:applicationEnabled,acquireClient}),sealer:app.sealer,transport:app.transport,timeoutMs:app.timeoutMs??30000});
  }});
 const applicationViewAccess=createManagedApplicationViewProviderAccess({enabled:applicationViewsEnabled,acquireClient});
 const applicationViews=createManagedApplicationViewHttpService({enabled:applicationViewsEnabled,inlineReviewEnabled:true,run,
  authenticate:credential=>employeeAdapter.authenticate(credential),repository:bridge.createManagedCandidateRepository({applicationViews:true}),createDispatcher:()=>{
   const bytes=createManagedApplicationViewVerifiedInputAccess({enabled:applicationViewsEnabled,ledger:application.canonical,storage:application.storage});
   const verifyCurrentEvidence=async r=>{const c=r.context,e=c.evidenceBinding,comparison=Array.isArray(e.images),candidateKind=comparison?'managed_application_completion_comparison':'managed_application_completion_synthesis',selectors=comparison?{beforeTaskId:e.images[0].taskId,afterTaskId:e.images[1].taskId}:{side:e.side};const fresh=await applicationViewAccess.readContext({credential:r.credential,scope:r.scope,requestId:r.requestId,candidateKind,selectors});return ['authority','keyRecord','keyBinding','workflowBinding','evidenceBinding','session',comparison?'inputs':'managedImageHistory'].every(k=>policyEqual(fresh[k],c[k]));};
   const preparer=createManagedApplicationViewModelRequestPreparer({enabled:applicationViewsEnabled,executionMode:av.executionMode,modelConfig:av.modelConfig,approvedModels:av.approvedModels,readVerifiedInput:bytes.read,verifyCurrentEvidence});
   return createManagedApplicationViewDispatcher({enabled:applicationViewsEnabled,executionMode:av.executionMode,preparer,facade:createManagedApplicationViewProviderFacade({enabled:applicationViewsEnabled,acquireClient}),sealer:av.sealer,transport:av.transport,timeoutMs:av.timeoutMs??30000});
  }});
 // Explicit read-only view schemas. Full source records remain server-side;
 // neither a browser digest nor a feature flag is an authority grant.
 const workflowViewService=Object.freeze({
  load:r=>run(r,async()=>projectWorkflowViewResult(await workflow.load(r),{scope:r.scope})),
  dispatch:r=>run(r,async()=>projectWorkflowViewResult(await workflow.dispatch(r),{scope:r.scope})),
  snapshot:r=>run(r,async()=>projectWorkflowSnapshotPreview((await workflow.load(r)).record,{scope:r.scope})),
 });
 const archiveViewService=Object.freeze({
  load:r=>run(r,async()=>projectFullWorkflowHistoryView(await full.load(r),{scope:r.scope})),
  append:r=>run(r,async()=>projectFullWorkflowSaveView(await bridge.appendBrowserArchive(r),{scope:r.scope})),
 });
 const inner=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,employeeAdapter,applicationViewPrepare:applicationViewsEnabled?application.viewPrepare:undefined,applicationViews:applicationViewsEnabled?applicationViews:undefined,applicationImages:applicationEnabled?application.images:undefined,applicationPrepare:applicationEnabled?application.prepare:undefined,applicationModel:applicationEnabled?applicationModel:undefined,workflowViewService:browserViewsEnabled?workflowViewService:undefined,archiveViewService:browserViewsEnabled?archiveViewService:undefined,managedNormalized:normalizedEnabled?normalizedService:undefined,managedViews:managedViewsEnabled?managedViewService:undefined,managedModel:managedModelEnabled?managedModelService:undefined,managedImages:managedEnabled?managedService:undefined,durableSynthesisService:durableSynthesisEnabled?durableService:undefined,workflowService:browserViewsEnabled?undefined:wrapped(workflow,['load','dispatch','snapshot']),fullWorkflowArchive:browserViewsEnabled?undefined:wrapped(full,['append','load']),privateMedia:wrapped(privateMedia,['upload','read','preview','resolveReferences']),candidateService:wrapped(candidates,['extract','vision','compare','synthesize','load']),speechAdapter:wrapped(speech,['transcribe']),visitLister:r=>discovery('list',r),visitResolver:r=>discovery('resolve',r)});
 const paths=new Set(['/api/design/visit/list','/api/design/visit/resolve','/api/design/candidate/load']);
 if(browserViewsEnabled){
  for(const path of ['load','dispatch','snapshot'])paths.add('/api/design/workflow-view/'+path);
  for(const path of ['load','append'])paths.add('/api/design/archive-view/'+path);
 }else for(const path of ['/api/design/workflow/load','/api/design/workflow/dispatch','/api/design/workflow/snapshot','/api/design/archive/full','/api/design/archive/full/load'])paths.add(path);
 if(applicationViewsEnabled){for(const path of ['prepare','prepare-status'])paths.add('/api/design/application-view-images/'+path);for(const path of ['compare','synthesize','status','load'])paths.add('/api/design/application-views/'+path);}
 if(applicationEnabled){for(const path of ['upload','status','reconcile','prepare','prepare-status'])paths.add('/api/design/application-images/'+path);for(const path of ['describe','status','load'])paths.add('/api/design/application-model/'+path);}
 if(normalizedEnabled)for(const path of ['describe','status','load'])paths.add('/api/design/managed-normalized/'+path);
 if(managedEnabled)for(const path of ['upload','status','verification-status'])paths.add('/api/design/managed-images/'+path);
 if(managedViewsEnabled)for(const path of ['verification-status','describe','compare','synthesize','status','load'])paths.add('/api/design/managed-views/'+path);
 if(managedModelEnabled)for(const path of ['describe','status','load'])paths.add('/api/design/managed-model/'+path);
 if(mediaEnabled===true)for(const path of ['upload','read','references',...(typeof imageNormalizer==='function'?['preview']:[])])paths.add('/api/design/media/'+path);
 if(generationEnabled)paths.add('/api/design/speech');
 if(textEnabled)paths.add('/api/design/candidate/extract');
 if(visualEnabled){paths.add('/api/design/candidate/vision');paths.add('/api/design/candidate/compare');}
 if(synthesisEnabled&&!durableSynthesisEnabled)paths.add('/api/design/candidate/synthesize');
 if(durableSynthesisEnabled)for(const name of ['enqueue','status','lookup','list','cancel'])paths.add('/api/design/synthesis-operations/'+name);
 return Object.freeze({async handle(request){let path;try{path=new URL(request.url).pathname;}catch{}if(!paths.has(path))return new Response(JSON.stringify({ok:false,error:'IMMUTABLE_GENERATION_ROUTE_CLOSED'}),{status:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});const s={identity:null,authority:null,closed:false};try{return await runPreparedRecordValidationScope(()=>httpScope.run(s,()=>inner(request)));}finally{s.closed=true;}}});
}
