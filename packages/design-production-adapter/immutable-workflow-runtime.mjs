/** Restricted native workflow composition. Reuses original service, records and HTTP routes. */
import {createImmutableWorkflowRepository,assertImmutableWorkflowIntent} from './immutable-workflow-repository.mjs';
import {createPreparedWorkflowService,runPreparedRecordValidationScope} from './prepared-workflow-service.mjs';
import {createPostgresImmutableKeyRepository} from './postgres-immutable-key-repository.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';
const paths=new Set(['/api/design/workflow/load','/api/design/workflow/dispatch','/api/design/workflow/snapshot']);
export function createImmutableWorkflowRuntime({enabled=false,acquireClient,publicOrigin,allowedRequestOrigins}={}){
 if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
 const bridge=createImmutableWorkflowRepository({enabled:true,acquireClient});
 const service=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository});
 const run=(request,work)=>bridge.runRequest({credential:request.credential,scope:request.scope},()=>runPreparedRecordValidationScope(work));
 const workflowService=Object.freeze({
  load:request=>run(request,async()=>{await bridge.initialize();return service.load(request);}),
  dispatch:request=>{assertImmutableWorkflowIntent(request.intent);return run(request,()=>service.dispatch(request));},
  snapshot:request=>run(request,()=>service.snapshot(request)),
 });
 // Existing session-only immutable capability authenticates BEFORE body buffering.
 // It does not lease a key or issue an approval and is not a substitute for visit authority.
 const identity=createPostgresImmutableKeyRepository({enabled:true,acquireClient});
 const inner=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,workflowService,
  employeeAdapter:{authenticate:credential=>identity.resolveIdentity({credential}),gate:Object.freeze({})}});
 return Object.freeze({async handle(request){
  let path;try{path=new URL(request.url).pathname;}catch{}
  if(!paths.has(path))return new Response(JSON.stringify({ok:false,error:'IMMUTABLE_WORKFLOW_ROUTE_CLOSED'}),{status:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  return inner(request);
 }});
}
