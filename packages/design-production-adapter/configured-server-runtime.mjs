/** Configurable original-media runtime, NOT the synthetic application lane.
 * Trusted capabilities are provisioned outside this module; none comes from
 * HTTP bodies. No import opens a listener, reads env, issues approval or fetches.
 * This is local delivery code; target permissions/host/TLS need acceptance. */
import {webcrypto} from 'node:crypto';
import {createImmutableGenerationRuntime} from './immutable-generation-runtime.mjs';
import {createImmutableKeySettingsRuntime} from './immutable-key-runtime.mjs';
import {createImmutableDesignKeySealer} from './key-crypto.mjs';
import {createDesignFileSecretProvider} from './server-secret-files.mjs';
import {createPreparedOfficialTransport} from './official-provider-transport.mjs';
import {createScopedPrivateMediaTransport} from './scoped-private-media-transport.mjs';
import {inspectPhonePhotoDerivative} from './phone-photo-processing.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';
const keyPaths=new Set(['read','save','revoke'].map(x=>'/api/design/key-settings/'+x));
export async function createConfiguredDesignServerRuntime({enabled=false,modelsEnabled=false,privateMediaTransport,publicOrigin,secretDirectory,modelConfig,approvedVisionModels=[],approvedTextModels=[],acquireClient,worker,mediaApprovalVerifier,storageOrigin,storageAuthorize,storageCredentialProvider,fetchImplementation}={}){
 if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
 let originsValid=false;try{const u=new URL(publicOrigin),s=new URL(storageOrigin);originsValid=u.protocol==='https:'&&u.origin===publicOrigin&&s.protocol==='https:'&&s.origin===storageOrigin&&/^[a-z0-9-]+\.supabase\.co$/.test(s.hostname);}catch{}
 // Backends can run without any model key/configuration. Model routes are a
 // separate explicit switch and still require their independent durable grants.
 if(!originsValid||typeof acquireClient!=='function'||typeof worker?.inspect!=='function'||typeof worker?.derive!=='function'||typeof mediaApprovalVerifier?.verifyImmutable!=='function'||(typeof privateMediaTransport!=='function'&&[fetchImplementation,storageAuthorize,storageCredentialProvider].some(f=>typeof f!=='function')))throw Error('DESIGN_SERVER_NOT_CONFIGURED');
 let secretProvider,sealer,transport;
 if(modelsEnabled===true){
  if(typeof fetchImplementation!=='function'||modelConfig?.approved!==true||typeof modelConfig.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(modelConfig.model)||!Number.isSafeInteger(modelConfig.maxTokens)||modelConfig.maxTokens<1||modelConfig.maxTokens>8192||!Array.isArray(approvedVisionModels)||!Array.isArray(approvedTextModels)||!approvedVisionModels.includes(modelConfig.model)||!approvedTextModels.includes(modelConfig.model))throw Error('DESIGN_SERVER_NOT_CONFIGURED');
  secretProvider=createDesignFileSecretProvider({enabled:true,directory:secretDirectory});const probe=await secretProvider({purpose:'design-immutable-key-v2'});probe.fill(0);
  sealer=createImmutableDesignKeySealer({secretProvider,cryptoProvider:webcrypto});transport=createPreparedOfficialTransport({enabled:true,fetchImplementation});
 }
 const storageTransport=privateMediaTransport??createScopedPrivateMediaTransport({enabled:true,origin:storageOrigin,credentialProvider:storageCredentialProvider,authorize:storageAuthorize,fetchImplementation});
 const inspectDerivative=bytes=>{const r=inspectPhonePhotoDerivative(bytes);return {mime:r.mime,width:r.width,height:r.height,frameCount:1,decoded:true};};
 const runtime=createImmutableGenerationRuntime({enabled:true,acquireClient,publicOrigin,allowedRequestOrigins:[publicOrigin],browserViews:{enabled:true},media:{enabled:true,approvalVerifier:mediaApprovalVerifier,imageInspector:bytes=>worker.inspect(bytes),imageNormalizer:typeof worker.normalize==='function'?bytes=>worker.normalize(bytes):undefined,storageOrigin,storageTransport},generation:{enabled:modelsEnabled===true,sealer,transport,modelConfig,approvedTextModels,approvedVisionModels,visualEnabled:modelsEnabled===true,synthesisEnabled:modelsEnabled===true,derivativeProvider:q=>worker.derive(q),derivativeInspector:inspectDerivative}});
 const keys=createImmutableKeySettingsRuntime({enabled:modelsEnabled===true,publicOrigin,allowedRequestOrigins:[publicOrigin],acquireClient,secretProvider,cryptoProvider:webcrypto,approvedModels:modelsEnabled===true?[modelConfig.model]:[],allowASR:false});
 return Object.freeze({async handle(request){
  const path=new URL(request.url).pathname;
  // Speech is separately unconfigured. Synthetic application routes stay closed.
  if(path==='/api/design/speech'||modelsEnabled!==true&&keyPaths.has(path))return new Response(JSON.stringify({ok:false,error:{code:path==='/api/design/speech'?'DESIGN_SPEECH_DISABLED':'DESIGN_MODELS_DISABLED',retryable:false,outcome:'not_sent'}}),{status:404,headers:{'content-type':'application/json','cache-control':'no-store'}});
  return (keyPaths.has(path)?keys:runtime).handle(request);
 }});
}
