/** Explicit read-only composition of existing HTTP/readers with PG access sidecars. */
import {createPostgresArtifactAccessRepository} from './postgres-artifact-access-repository.mjs';
import {createPostgresArtifactRenewalRepository} from './postgres-artifact-renewal-repository.mjs';
import {createArtifactIdentityCompatibility} from './artifact-identity-compatibility.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';
const paths=new Set(['/api/design/media/read','/api/design/media/references','/api/design/candidate/load','/api/design/archive/full/load']);
export function createArtifactReadRuntime({enabled=false,publicOrigin,allowedRequestOrigins,acquireClient,readers,employeeAdapter,proofMode='base'}={}){
 if(enabled!==true||!['base','renewal'].includes(proofMode))return Object.freeze({handle:createDesignHttpHandler()});
 const factory=proofMode==='renewal'?createPostgresArtifactRenewalRepository:createPostgresArtifactAccessRepository;
 const {repository,issuer}=factory({enabled:true,acquireClient});
 const access=createArtifactIdentityCompatibility({enabled:true,repository,issuer,readers});
 const inner=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,
  employeeAdapter,privateMedia:access.media,candidateService:access.candidate,fullWorkflowArchive:access.history});
 return Object.freeze({async handle(request){
  let path;try{path=new URL(request.url).pathname;}catch{}
  if(!paths.has(path))return new Response(JSON.stringify({ok:false,error:'ARTIFACT_READ_ONLY'}),{status:404,
   headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  return inner(request);
 }});
}
