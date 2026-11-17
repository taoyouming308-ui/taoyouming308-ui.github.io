/** Stage17 opt-in composition of the existing workflow/media/candidate/full services.
 * No driver, network, credential, approval or legacy-executor fallback is supplied.
 */
import {createImmutableDependencyRepository} from './immutable-dependency-repository.mjs';
import {createPreparedWorkflowService,runPreparedRecordValidationScope} from './prepared-workflow-service.mjs';
import {createPrivateMediaService} from './private-media-service.mjs';
import {createDesignCandidateService} from './candidate-service.mjs';
import {createPostgresImmutableKeyRepository} from './postgres-immutable-key-repository.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';
export function createImmutableDependencyRuntime({enabled=false,acquireClient,proofReadsEnabled=false,publicOrigin,allowedRequestOrigins,media:mediaConfig,candidates:candidateConfig}={}){
 if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
 const bridge=createImmutableDependencyRepository({enabled:true,acquireClient,proofReadsEnabled});
 const run=(request,work)=>bridge.runRequest({credential:request.credential,scope:request.scope},()=>runPreparedRecordValidationScope(work));
 const native=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository,mediaResolver:bridge.mediaResolver,mediaVerifier:bridge.mediaVerifier,candidateAcceptanceVerifier:bridge.verifySynthesisAcceptance});
 const workflow=Object.freeze({async load(request){await bridge.initialize();return native.load(request);},dispatch:request=>native.dispatch(request),snapshot:request=>native.snapshot(request)});
 const {enabled:mediaEnabled=false,approvalVerifier,imageInspector,storageOrigin,storageTransport}=mediaConfig||{};
 const privateMedia=Object.freeze(Object.fromEntries(['upload','read','resolveReferences'].map(method=>[method,input=>createPrivateMediaService({enabled:mediaEnabled===true,permissionGate:bridge.permissionGate,metadataRepository:bridge.createMediaMetadataRepository({forUpload:method==='upload'}),approvalVerifier:{verify:(receipt,intent,phase,context)=>bridge.verifyMediaApproval(approvalVerifier,receipt,intent,phase,context)},imageInspector,storageOrigin,storageTransport})[method](input)])));
 const full=bridge.createFullWorkflowArchive({enabled:true});
 const candidatesEnabled=candidateConfig?.enabled===true&&Number.isSafeInteger(candidateConfig.ttlMs)&&candidateConfig.ttlMs>=1000&&candidateConfig.ttlMs<=3600000;
 let candidates=createDesignCandidateService();
 if(candidatesEnabled){
  // Generation stays closed: legacy provider attempt/key ownership is alias-based.
  // Only server-published immutable candidates can be read and explicitly accepted.
  const disabled=()=>{throw new Error('IMMUTABLE_GENERATION_UNAVAILABLE');};
  candidates=createDesignCandidateService({enabled:true,permissionGate:bridge.permissionGate,workflowService:workflow,privateMedia,adapters:Object.freeze({extract:disabled,describe:disabled}),repository:bridge.createCandidateRepository({ttlMs:candidateConfig.ttlMs}),mediaVerifier:bridge.verifyCandidateMedia,synthesisVerifier:bridge.verifySynthesisAncestors});
 }
 const wrapped=(service,methods)=>Object.freeze(Object.fromEntries(methods.map(method=>[method,request=>run(request,()=>service[method](request))])));
 const identity=createPostgresImmutableKeyRepository({enabled:true,acquireClient});
 const inner=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,employeeAdapter:{authenticate:credential=>identity.resolveIdentity({credential}),gate:Object.freeze({})},workflowService:wrapped(workflow,['load','dispatch','snapshot']),fullWorkflowArchive:wrapped(full,['append','load']),privateMedia:wrapped(privateMedia,['upload','read','resolveReferences']),candidateService:wrapped(candidates,['extract','vision','compare','synthesize','load'])});
 const paths=new Set(['/api/design/workflow/load','/api/design/workflow/dispatch','/api/design/workflow/snapshot','/api/design/archive/full','/api/design/archive/full/load']);
 if(mediaEnabled===true)for(const path of ['upload','read','references'])paths.add('/api/design/media/'+path);
 if(candidatesEnabled)paths.add('/api/design/candidate/load');
 return Object.freeze({async handle(request){let path;try{path=new URL(request.url).pathname;}catch{}if(!paths.has(path))return new Response(JSON.stringify({ok:false,error:'IMMUTABLE_DEPENDENCY_ROUTE_CLOSED'}),{status:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});return inner(request);}});
}
