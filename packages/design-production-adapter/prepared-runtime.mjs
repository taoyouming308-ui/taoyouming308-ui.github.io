/** One explicit composition root. No driver, listener, credential lookup or network defaults. */
import {createDesignPostgresExecutor} from './postgres-executor.mjs';
import {createDesignPostgresRepositories} from './postgres-workflow-repositories.mjs';
import {createPreparedWorkflowService,runPreparedRecordValidationScope} from './prepared-workflow-service.mjs';
import {createPrivateMediaService} from './private-media-service.mjs';
import {createDesignCandidateService} from './candidate-service.mjs';
import {createDesignCandidateAdapters} from './design-candidate-provider.mjs';
import {designCandidateDigest} from '../analysis-engine/design-candidate.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';

/** Dependencies are trusted server configuration, never request fields.
 * Provider/key routes remain absent unless their independently approved adapters
 * are supplied. Merely enabling this root supplies no such approval.
 */
export function createPreparedDesignRuntime({enabled=false,acquireClient,lifecyclePolicy,diagnostics,
  publicOrigin,allowedRequestOrigins,media:mediaConfig,candidates:candidateConfig,
  speechAdapter,providerAdapter,sessionRepository,keySettings}={}){
  if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
  const executor=createDesignPostgresExecutor({acquireClient,lifecyclePolicy,diagnostics});
  const repositories=createDesignPostgresRepositories({executor});
  const workflow=createPreparedWorkflowService({enabled:true,
    permissionGate:repositories.employeeAdapter.gate,
    repository:repositories.workflowRepository,
    mediaResolver:repositories.mediaResolver,mediaVerifier:repositories.mediaVerifier,
    candidateAcceptanceVerifier:request=>repositories.verifySynthesisAcceptance(request)});
  const workflowService=Object.freeze({
    async load(request){const fixed=structuredClone(request);await repositories.initializeWorkflow(fixed);return workflow.load(fixed);},
    dispatch:request=>workflow.dispatch(request),snapshot:request=>workflow.snapshot(request),
  });
  const fullArchive=repositories.createFullWorkflowArchive({enabled:true});
  const fullWorkflowArchive=Object.freeze({append:request=>fullArchive.append(request),load:request=>repositories.loadFullArchive(request)});
  // A fresh closure per operation binds the existing opaque credential to DB
  // checks. It never derives identity from media owner fields or stores a token.
  const {enabled:mediaEnabled=false,approvalVerifier,imageInspector,storageOrigin,storageTransport}=mediaConfig||{};
  const mediaCall=(method,input)=>{
    const credential=input?.credential;
    const metadataRepository=repositories.createMediaMetadataRepository({resolveCredential:()=>credential});
    return createPrivateMediaService({
      enabled:mediaEnabled===true,
      permissionGate:repositories.employeeAdapter.gate,metadataRepository,
      approvalVerifier,imageInspector,storageOrigin,storageTransport,
    })[method](input);
  };
  const privateMedia=Object.freeze(Object.fromEntries(['upload','read','resolveReferences'].map(method=>[method,input=>mediaCall(method,input)])));
  const candidatesEnabled=candidateConfig?.enabled===true&&Number.isSafeInteger(candidateConfig?.ttlMs)&&candidateConfig.ttlMs>=1000&&candidateConfig.ttlMs<=3600000;
  let candidateService=createDesignCandidateService();
  if(candidatesEnabled){
    // Copy only approved operational dependencies; caller cannot replace identity/source/media gates.
    const {ttlMs,modelConfig,approvedTextModels,approvedVisionModels,transport,keyResolver,attemptStore,timeoutMs,
      processingGate,derivativeProvider,derivativeInspector}=candidateConfig;
    const candidateRepository=repositories.createCandidateRepository({ttlMs});
    const mediaVerifier=request=>repositories.verifyCandidateMedia(request);
    const synthesisVerifier=request=>repositories.verifySynthesisAncestors(request);
    const adapters=createDesignCandidateAdapters({enabled:true,modelConfig,approvedTextModels,approvedVisionModels,
      transport,keyResolver,attemptStore,timeoutMs,processingGate,derivativeProvider,derivativeInspector,
      permissionGate:repositories.employeeAdapter.gate,mediaVerifier,synthesisVerifier,
      sessionVerifier:async({credential,scope,sessionId,baseRevision,inputDigest})=>{
        const {record}=await workflow.load({credential,scope});
        return record.session.scope.sessionId===sessionId&&record.session.revision===baseRevision&&designCandidateDigest(record.session)===inputDigest;
      }});
    candidateService=createDesignCandidateService({enabled:true,permissionGate:repositories.employeeAdapter.gate,
      workflowService,privateMedia,adapters,repository:candidateRepository,mediaVerifier,synthesisVerifier});
  }
  const handle=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,
    employeeAdapter:repositories.employeeAdapter,workflowService,fullWorkflowArchive,privateMedia,candidateService,
    visitResolver:request=>repositories.resolveVisitScope(request),visitLister:request=>repositories.listAuthorizedVisits(request),
    speechAdapter,providerAdapter,sessionRepository,keySettings});
  // One bounded pure-validation scope per HTTP request. Fresh database,
  // identity, media and receipt checks still run on every operation.
  return Object.freeze({handle:request=>runPreparedRecordValidationScope(()=>handle(request))});
}
