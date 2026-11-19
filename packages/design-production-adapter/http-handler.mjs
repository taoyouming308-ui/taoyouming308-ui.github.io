import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
import {ManagedApplicationViewDispatchError} from './managed-application-view-model-dispatcher.mjs';
import {validateManagedApplicationViewProjection} from './managed-application-view-http-projection.mjs';
import {ManagedApplicationDispatchError} from './managed-application-model-dispatcher.mjs';
import {validateManagedApplicationProjection} from './managed-application-http-projection.mjs';
import {ManagedApplicationPrepareError} from './managed-application-prepare-service.mjs';
import {validateManagedContentManifestReference} from './managed-content-manifest-contracts.mjs';
import {ManagedApplicationImageServiceError} from './managed-application-image-service.mjs';
import {validateManagedApplicationImageProjection} from './managed-application-image-http-projection.mjs';
import {validateWorkflowViewResult,validateWorkflowSnapshotPreview,validateFullWorkflowHistoryView,validateFullWorkflowSaveView} from '../design-prepared-ui/workflow-view-contracts.mjs';
import {ManagedNormalizedDispatchError} from './managed-normalized-model-dispatcher.mjs';
import {validateManagedNormalizedProjection} from './managed-normalized-http-projection.mjs';
import {ManagedViewDispatchError} from './managed-view-model-dispatcher.mjs';
import {validateManagedViewProjection} from './managed-view-http-projection.mjs';
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {DESIGN_VISUAL_VALUES} from '../analysis-engine/design-candidate.mjs';
import {ManagedImageDispatchError} from './managed-image-dispatcher.mjs';
import {ManagedImageServiceError} from './managed-image-service.mjs';
import {validateDurableOperation,DurableSynthesisError} from './durable-synthesis-contracts.mjs';
import {ImmutableDependencyError} from './immutable-dependency-repository.mjs';
import {VisitListError} from './visit-list-service.mjs';
import {validateProductionDesignScope,ProductionEmployeeError} from './employee-adapter.mjs';
import {CandidateServiceError} from './candidate-service.mjs';
import {PreparedWorkflowError} from './prepared-workflow-service.mjs';
/** Reviewed entry-point preparation only. No listener, deployment or default live I/O. */
import {FULL_WORKFLOW_MAX_BYTES,FullWorkflowArchiveError} from './full-workflow-archive.mjs';
import {validateDesignSession} from '../analysis-engine/design-pilot.mjs';
import {PRIVATE_MEDIA_MAX_BYTES,PrivateMediaError} from './private-media.mjs';
import {DesignProviderError} from './provider-adapter.mjs';
const JSON_LIMIT=768*1024, AUDIO_FORM_LIMIT=8*1024*1024+64*1024;
const routes=new Map([
 ...['compare','synthesize','status','load'].map(name=>['/api/design/application-views/'+name,'applicationViews:'+name]),
 ['/api/design/application-view-images/prepare','applicationViewPrepare:prepare'],['/api/design/application-view-images/prepare-status','applicationViewPrepare:status'],
 ...['describe','status','load'].map(name=>['/api/design/application-model/'+name,'applicationModel:'+name]),
 ['/api/design/application-images/prepare','applicationPrepare:prepare'],['/api/design/application-images/prepare-status','applicationPrepare:status'],
 ...['upload','status','reconcile'].map(name=>['/api/design/application-images/'+name,'applicationImage:'+name]),
 ...['load','dispatch','snapshot'].map(name=>['/api/design/workflow-view/'+name,'workflowView:'+name]),
 ...['load','append'].map(name=>['/api/design/archive-view/'+name,'archiveView:'+name]),
 ...['describe','status','load'].map(name=>['/api/design/managed-normalized/'+name,'managedNormalized:'+name]),
 ...['verification-status','describe','compare','synthesize','status','load'].map(name=>['/api/design/managed-views/'+name,'managedViews:'+name]),
 ['/api/design/managed-images/verification-status','managedVerification'],
 ...['describe','status','load'].map(name=>['/api/design/managed-model/'+name,'managedModel:'+name]),
 ['/api/design/managed-images/upload','managedUpload'],['/api/design/managed-images/status','managedStatus'],
 ...['enqueue','status','lookup','list','cancel'].map(name=>['/api/design/synthesis-operations/'+name,'synthesisOperation:'+name]),
 ['/api/design/candidate/synthesize','candidateSynthesize'],['/api/design/candidate/compare','candidateCompare'],['/api/design/candidate/extract','candidateExtract'],['/api/design/candidate/vision','candidateVision'],['/api/design/candidate/load','candidateLoad'],
 ['/api/design/visit/resolve','visitResolve'],['/api/design/visit/list','visitList'],
 ['/api/design/workflow/load','workflowLoad'],['/api/design/workflow/dispatch','workflowDispatch'],['/api/design/workflow/snapshot','workflowSnapshot'],
 ['/api/design/analyze','analyze'],['/api/design/speech','speech'],
 ['/api/design/archive/legacy','archive'],['/api/design/archive/full','fullArchive'],['/api/design/archive/full/load','fullArchiveLoad'],
 ['/api/design/media/upload','mediaUpload'],['/api/design/media/read','mediaRead'],['/api/design/media/preview','mediaPreview'],['/api/design/media/references','mediaReferences'],['/api/design/key-settings/read','keyRead'],
 ['/api/design/key-settings/save','keySave'],['/api/design/key-settings/revoke','keyRevoke'],
]);
class EntryError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new EntryError(code,status);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function exact(v,keys){if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('INVALID_FIELDS');}
function origin(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value||url.username||url.password) return null;return url.origin;}catch{return null;}}
async function boundedBody(request,maximum){
 if(request.headers.has('content-encoding'))fail('ENCODING_NOT_SUPPORTED',415);
 const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))fail('PAYLOAD_LIMIT',413);
 if(!request.body)fail('BODY_REQUIRED');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum){await reader.cancel();fail('PAYLOAD_LIMIT',413);}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function requestId(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fail('INVALID_REQUEST_ID');}
// Strict browser-only projections. Internal candidates, binary request bodies,
// object paths, immutable authority and verifier evidence never pass this lane.
function managedProjection(value,kind,payload){try{
 const v=copyManagedResultData(value,65536),scopeSame=(a,b)=>['customerProfileId','visitId','assignmentSource'].every(k=>a[k]===b[k]);
 if(kind==='verification'){
  exact(v,['schemaVersion','taskId','mediaId','sourceVersion','state','modelSubmissionAuthorized']);requestId(v.taskId);requestId(v.mediaId);
  if(v.schemaVersion!=='design-managed-verification-status-v1'||v.taskId!==payload.taskId||typeof v.sourceVersion!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(v.sourceVersion)||!['pending_validation','validation_failed','evidence_complete'].includes(v.state)||v.modelSubmissionAuthorized!==false)throw 0;
 }else if(kind==='status'){
  exact(v,['schemaVersion','requestId','state','candidateId','retryable']);requestId(v.requestId);if(v.schemaVersion!=='design-managed-model-status-v1'||v.requestId!==payload.requestId||!['not_found','pending','uncertain','completed'].includes(v.state)||v.retryable!==false)throw 0;if(v.state==='completed')requestId(v.candidateId);else if(v.candidateId!==null)throw 0;
 }else{
  exact(v,['schemaVersion','id','kind','scope','sessionId','baseRevision','candidate','reviewOnly']);requestId(v.id);validateProductionDesignScope(v.scope);if(v.schemaVersion!=='design-managed-model-review-v1'||v.id!==payload.candidateId||v.kind!=='managed_visual_description'||v.reviewOnly!==true||!scopeSame(v.scope,payload.scope)||typeof v.sessionId!=='string'||!v.sessionId||v.sessionId.length>160||!Number.isSafeInteger(v.baseRevision)||v.baseRevision<0)throw 0;
  const c=v.candidate;exact(c,['phase','entries','questions','warnings']);if(c.phase!=='before_analysis'||!Array.isArray(c.entries)||c.entries.length>2||!Array.isArray(c.questions)||c.questions.length||!Array.isArray(c.warnings)||c.warnings.length>10||c.warnings.some(w=>typeof w!=='string'||w.length>1000))throw 0;
  const ids=new Set(),fields=new Set();for(const e of c.entries){exact(e,['id','category','field','zone','groupId','service','side','track','origin','basis','value','status','sources','replacesEntryId']);if(typeof e.id!=='string'||!e.id||e.id.length>200||ids.has(e.id)||fields.has(e.field)||!Object.hasOwn(DESIGN_VISUAL_VALUES,e.field)||e.category!=='person_style'||['zone','groupId','service','side'].some(k=>e[k]!==null)||e.track!=='context'||e.origin!=='extraction'||e.basis!=='observable'||(e.value===null?e.status!=='unknown':!DESIGN_VISUAL_VALUES[e.field].includes(e.value)||e.status!=='not_confirmed')||e.replacesEntryId!==null&&(typeof e.replacesEntryId!=='string'||!e.replacesEntryId||e.replacesEntryId.length>200)||!Array.isArray(e.sources)||e.sources.length!==(e.value===null?0:1))throw 0;ids.add(e.id);fields.add(e.field);for(const source of e.sources){exact(source,['messageId','quote']);if(typeof source.messageId!=='string'||!source.messageId||source.messageId.length>200||typeof source.quote!=='string'||!source.quote||source.quote.length>2000)throw 0;}}
 }
 return v;
 }catch{fail('INVALID_MANAGED_MODEL_RESULT',500);}}
function applicationPrepareProjection(raw,payload){try{
 const v=copyManagedResultData(raw,16384);exact(v,['schemaVersion','requestId','state','taskId','source','synthetic','modelDispatched']);
 exact(v.source,['mediaId','reference']);const r=validateManagedContentManifestReference(v.source.reference),expected=validateManagedContentManifestReference(payload.source);
 if(v.schemaVersion!=='design-application-prepare-status-v1'||v.requestId!==payload.requestId||!['missing','pending','ready','failed'].includes(v.state)||v.source.mediaId!==payload.mediaId||['manifestId','revision','digest'].some(k=>r[k]!==expected[k])||v.synthetic!==true||v.modelDispatched!==false)throw 0;
 if(v.state==='ready'){if(typeof v.taskId!=='string'||!/^application-task-[a-f0-9]{64}$/.test(v.taskId))throw 0;}else if(v.taskId!==null)throw 0;
 return v;
 }catch{fail('INVALID_APPLICATION_PREPARE_RESULT',500);}}
function applicationViewPrepareProjection(raw,payload){try{
 const v=copyManagedResultData(raw,16384);exact(v,['schemaVersion','requestId','state','taskId','source','synthetic','modelDispatched']);
 exact(v.source,['mediaId','reference','stage','angle']);const r=validateManagedContentManifestReference(v.source.reference),expected=validateManagedContentManifestReference(payload.source);
 if(v.schemaVersion!=='design-application-view-prepare-status-v1'||v.requestId!==payload.requestId||!['missing','pending','ready','failed'].includes(v.state)||v.source.mediaId!==payload.mediaId||v.source.stage!==payload.stage||v.source.angle!==payload.angle||['manifestId','revision','digest'].some(k=>r[k]!==expected[k])||v.synthetic!==true||v.modelDispatched!==false)throw 0;
 if(v.state==='ready'){if(typeof v.taskId!=='string'||!/^application-task-[a-f0-9]{64}$/.test(v.taskId))throw 0;}else if(v.taskId!==null)throw 0;
 return v;
 }catch{fail('INVALID_APPLICATION_PREPARE_RESULT',500);}}
/**
 * employeeAdapter must be the authoritative server verifier, never mock actor headers.
 * sessionRepository must return a validated evidence session for the exact grant.
 * keySettings operations are server-only wrappers with their own approval verifier.
 */
export function createDesignHttpHandler(options={}){
 const {enabled=false,publicOrigin,allowedRequestOrigins=[],employeeAdapter,sessionRepository,providerAdapter,speechAdapter,archiveAdapter,keySettings,keySettingsSchema='legacy',fullWorkflowArchive,privateMedia,workflowService,visitResolver,visitLister,candidateService,durableSynthesisService,managedImages,managedModel,managedViews,managedNormalized,applicationImages,applicationPrepare,applicationViewPrepare,applicationModel,applicationViews,workflowViewService,archiveViewService}=options;
 const configured=origin(publicOrigin)&&Array.isArray(allowedRequestOrigins)&&allowedRequestOrigins.length>0&&allowedRequestOrigins.every(value=>origin(value));
 function response(status,data,cors){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(cors?{'Access-Control-Allow-Origin':cors,'Vary':'Origin'}:{})}});}
 return async function handle(request){
  let cors=null;
  try{
   if(enabled!==true||!configured)fail('ENTRY_NOT_CONFIGURED',503);
   const url=new URL(request.url);
   if(url.origin!==publicOrigin||url.search||url.hash||/%|\\/.test(url.pathname))fail('INVALID_ROUTE',404);
   const source=request.headers.get('origin');if(source!==null){if(!allowedRequestOrigins.includes(source))fail('ORIGIN_DENIED',403);cors=source;}
   const operation=routes.get(url.pathname);if(!operation)fail('NOT_FOUND',404);
   if(request.method==='OPTIONS'){
    if(!cors||request.headers.get('access-control-request-method')!=='POST')fail('PREFLIGHT_DENIED',403);
    const headers=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(headers.some(header=>!['content-type','x-employee-session'].includes(header)))fail('PREFLIGHT_DENIED',403);
    return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':cors,'Vary':'Origin','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Employee-Session','Cache-Control':'no-store'}});
   }
   if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
   if(request.headers.has('cookie')||request.headers.has('authorization'))fail('UNSUPPORTED_CREDENTIAL_CHANNEL',400);
   const credential=request.headers.get('x-employee-session');
   if(typeof credential!=='string'||credential.length<1||credential.length>200)fail('AUTHENTICATION_REQUIRED',401);
   if(!employeeAdapter||typeof employeeAdapter.authenticate!=='function'||!employeeAdapter.gate)fail('EMPLOYEE_ADAPTER_REQUIRED',503);
   // Authenticate before buffering an upload or processing secret input.
   await employeeAdapter.authenticate(credential);
   let payload;
   if(operation==='speech'||operation==='mediaUpload'||operation==='managedUpload'||operation==='applicationImage:upload'){
    const type=request.headers.get('content-type')||'';if(!/^multipart\/form-data;\s*boundary=/.test(type))fail('MULTIPART_REQUIRED',415);
    const bytes=await boundedBody(request,AUDIO_FORM_LIMIT);
    let form;try{form=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}catch{fail('INVALID_MULTIPART');}
    const expectedFields=operation==='speech'?'file|requestId|scope':(operation==='managedUpload'||operation==='applicationImage:upload')?'angle|file|mediaId|requestId|scope|stage':'angle|approval|file|requestId|scope|stage';
    if([...form.keys()].sort().join('|')!==expectedFields)fail('INVALID_FIELDS');
    const file=form.get('file');if(typeof file==='string'||!file||typeof file.arrayBuffer!=='function')fail('AUDIO_REQUIRED');
    let scope;try{scope=JSON.parse(form.get('scope'));}catch{fail('INVALID_SCOPE');}
    const bytesSnapshot=new Uint8Array(await file.arrayBuffer());
    if(operation==='speech')payload={requestId:form.get('requestId'),scope,audioBytes:bytesSnapshot};
    else if(operation==='managedUpload'||operation==='applicationImage:upload')payload={mediaId:form.get('mediaId'),requestId:form.get('requestId'),scope,bytes:bytesSnapshot,mime:file.type,stage:form.get('stage'),angle:form.get('angle')};
    else{let approval;try{approval=JSON.parse(form.get('approval'));}catch{fail('INVALID_APPROVAL');}
     payload={requestId:form.get('requestId'),scope,approval,bytes:bytesSnapshot,mime:file.type,stage:form.get('stage'),angle:form.get('angle')};}
   }else{
    if((request.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')fail('JSON_REQUIRED',415);
    const bytes=await boundedBody(request,operation.startsWith('key')?8192:operation==='fullArchive'?FULL_WORKFLOW_MAX_BYTES+64*1024:JSON_LIMIT);
    try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_JSON');}
   }
   let result,responseStatus=200;
   if(operation.startsWith('workflowView:')){
    const method=operation.split(':')[1];exact(payload,method==='dispatch'?['scope','requestId','expectedRevision','intent']:['scope']);validateProductionDesignScope(payload.scope);if(method==='dispatch'){requestId(payload.requestId);if(!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0||Object.is(payload.expectedRevision,-0))fail('INVALID_REVISION');}
    if(typeof workflowViewService?.[method]!=='function')fail('WORKFLOW_VIEW_NOT_CONFIGURED',503);
    const raw=await workflowViewService[method]({...payload,credential});result=method==='snapshot'?validateWorkflowSnapshotPreview(raw,{scope:payload.scope}):validateWorkflowViewResult(raw,{scope:payload.scope});await employeeAdapter.authenticate(credential);
   }else if(operation.startsWith('archiveView:')){
    const method=operation.split(':')[1];exact(payload,method==='load'?['scope']:['scope','requestId','expectedVersion','expectedParentDigest','sourceRevision','sourceDigest']);validateProductionDesignScope(payload.scope);
    if(method==='append'){requestId(payload.requestId);if(!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion<0||Object.is(payload.expectedVersion,-0)||!Number.isSafeInteger(payload.sourceRevision)||payload.sourceRevision<0||Object.is(payload.sourceRevision,-0)||typeof payload.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(payload.sourceDigest)||(payload.expectedVersion===0?payload.expectedParentDigest!==null:typeof payload.expectedParentDigest!=='string'||!/^[a-f0-9]{64}$/.test(payload.expectedParentDigest)))fail('INVALID_ARCHIVE_SELECTOR');}
    if(typeof archiveViewService?.[method]!=='function')fail('ARCHIVE_VIEW_NOT_CONFIGURED',503);
    const raw=await archiveViewService[method]({...payload,credential});result=method==='load'?validateFullWorkflowHistoryView(raw,{scope:payload.scope}):validateFullWorkflowSaveView(raw,{scope:payload.scope});await employeeAdapter.authenticate(credential);
   }else if(operation.startsWith('managedNormalized:')){
    const method=operation.split(':')[1];if(typeof managedNormalized?.[method]!=='function')fail('MANAGED_NORMALIZED_NOT_CONFIGURED',503);
    const keys=method==='describe'?['scope','requestId','taskId','expectedWorkflowRevision']:method==='load'?['scope','candidateId']:['scope','requestId'];exact(payload,keys);validateProductionDesignScope(payload.scope);for(const k of ['requestId','taskId','candidateId'])if(keys.includes(k))requestId(payload[k]);
    if(method==='describe'&&(!Number.isSafeInteger(payload.expectedWorkflowRevision)||payload.expectedWorkflowRevision<0||Object.is(payload.expectedWorkflowRevision,-0)))fail('INVALID_REVISION');
    try{result=validateManagedNormalizedProjection(await managedNormalized[method]({...payload,credential}),{type:method==='load'?'review':'status',payload});}catch(error){if(error?.message==='INVALID_MANAGED_NORMALIZED_RESULT')fail('INVALID_MANAGED_NORMALIZED_RESULT',500);throw error;}
    await employeeAdapter.authenticate(credential);
   }else if(operation.startsWith('managedViews:')){
    const method=operation.split(':')[1],verify=method==='verification-status',serviceMethod=verify?'verificationStatus':method;
    if(typeof managedViews?.[serviceMethod]!=='function')fail('MANAGED_VIEWS_NOT_CONFIGURED',503);
    const keys=verify?['scope','taskId']:method==='describe'?['scope','requestId','taskId','expectedWorkflowRevision']:method==='compare'?['scope','requestId','beforeTaskId','afterTaskId','expectedWorkflowRevision']:method==='synthesize'?['scope','requestId','side','expectedWorkflowRevision']:method==='load'?['scope','candidateId']:['scope','requestId'];
    exact(payload,keys);validateProductionDesignScope(payload.scope);for(const key of ['requestId','taskId','beforeTaskId','afterTaskId','candidateId'])if(keys.includes(key))requestId(payload[key]);
    if(keys.includes('expectedWorkflowRevision')&&(!Number.isSafeInteger(payload.expectedWorkflowRevision)||payload.expectedWorkflowRevision<0||Object.is(payload.expectedWorkflowRevision,-0)))fail('INVALID_REVISION');
    if(method==='synthesize'&&!['left','right'].includes(payload.side))fail('INVALID_MANAGED_VIEW_SIDE');if(method==='compare'&&payload.beforeTaskId===payload.afterTaskId)fail('INVALID_MANAGED_VIEW_PAIR');
    try{result=validateManagedViewProjection(await managedViews[serviceMethod]({...payload,credential}),{type:verify?'verification':method==='load'?'review':'status',payload});}catch(error){if(error?.message==='INVALID_MANAGED_VIEW_RESULT')fail('INVALID_MANAGED_VIEW_RESULT',500);throw error;}
    await employeeAdapter.authenticate(credential);
   }else if(operation==='managedVerification'||operation.startsWith('managedModel:')){
    const verify=operation==='managedVerification',method=verify?'verificationStatus':operation.split(':')[1],service=verify?managedImages:managedModel;
    if(typeof service?.[method]!=='function')fail('MANAGED_MODEL_NOT_CONFIGURED',503);
    exact(payload,verify?['scope','taskId']:method==='describe'?['scope','requestId','taskId','expectedWorkflowRevision']:method==='load'?['scope','candidateId']:['scope','requestId']);validateProductionDesignScope(payload.scope);
    if(verify||method==='describe')requestId(payload.taskId);if(method==='describe'||method==='status')requestId(payload.requestId);if(method==='load')requestId(payload.candidateId);if(method==='describe'&&(!Number.isSafeInteger(payload.expectedWorkflowRevision)||payload.expectedWorkflowRevision<0||Object.is(payload.expectedWorkflowRevision,-0)))fail('INVALID_REVISION');
    result=managedProjection(await service[method]({...payload,credential}),verify?'verification':method==='load'?'review':'status',payload);
    await employeeAdapter.authenticate(credential);
   }else if(operation.startsWith('applicationViews:')){
    const method=operation.split(':')[1];if(typeof applicationViews?.[method]!=='function')fail('APPLICATION_VIEWS_NOT_CONFIGURED',503);
    const keys=method==='compare'?['scope','requestId','beforeTaskId','afterTaskId','expectedWorkflowRevision']:method==='synthesize'?['scope','requestId','side','expectedWorkflowRevision']:method==='load'?['scope','candidateId']:['scope','requestId'];exact(payload,keys);validateProductionDesignScope(payload.scope);for(const k of ['requestId','beforeTaskId','afterTaskId','candidateId'])if(keys.includes(k))requestId(payload[k]);
    if(keys.includes('expectedWorkflowRevision')&&(!Number.isSafeInteger(payload.expectedWorkflowRevision)||payload.expectedWorkflowRevision<0||Object.is(payload.expectedWorkflowRevision,-0)))fail('INVALID_REVISION');
    if(method==='synthesize'&&!['left','right'].includes(payload.side)||method==='compare'&&payload.beforeTaskId===payload.afterTaskId)fail('INVALID_APPLICATION_VIEW_SELECTORS');
    const raw=await applicationViews[method]({...payload,credential});try{result=validateManagedApplicationViewProjection(raw,{type:method==='load'?'review':'status',payload});}catch{fail('INVALID_APPLICATION_VIEW_RESULT',500);}
    try{await employeeAdapter.authenticate(credential);}catch{throw new ManagedApplicationViewDispatchError(method==='load'?'not_sent':'uncertain');}
   }else if(operation.startsWith('applicationModel:')){
    const method=operation.split(':')[1];if(typeof applicationModel?.[method]!=='function')fail('APPLICATION_MODEL_NOT_CONFIGURED',503);
    const keys=method==='describe'?['scope','requestId','taskId','expectedWorkflowRevision']:method==='load'?['scope','candidateId']:['scope','requestId'];exact(payload,keys);validateProductionDesignScope(payload.scope);for(const k of ['requestId','taskId','candidateId'])if(keys.includes(k))requestId(payload[k]);
    if(method==='describe'&&(!Number.isSafeInteger(payload.expectedWorkflowRevision)||payload.expectedWorkflowRevision<0||Object.is(payload.expectedWorkflowRevision,-0)))fail('INVALID_REVISION');
    const raw=await applicationModel[method]({...payload,credential});try{result=validateManagedApplicationProjection(raw,{type:method==='load'?'review':'status',payload});}catch{fail('INVALID_APPLICATION_MODEL_RESULT',500);}
    try{await employeeAdapter.authenticate(credential);}catch{throw new ManagedApplicationDispatchError(method==='load'?'not_sent':'uncertain');}
   }else if(operation.startsWith('applicationViewPrepare:')){
    const method=operation.split(':')[1];if(typeof applicationViewPrepare?.[method]!=='function')fail('APPLICATION_PREPARE_NOT_CONFIGURED',503);
    exact(payload,['scope','mediaId','source','requestId','stage','angle']);validateProductionDesignScope(payload.scope);requestId(payload.mediaId);requestId(payload.requestId);
    if(!['before','after'].includes(payload.stage)||!['front','back','left','right'].includes(payload.angle))fail('INVALID_APPLICATION_VIEW_SOURCE');
    try{payload.source=validateManagedContentManifestReference(payload.source);}catch{fail('INVALID_APPLICATION_SOURCE');}
    const raw=await applicationViewPrepare[method]({...payload,credential,signal:request.signal});result=applicationViewPrepareProjection(raw,payload);
    // A post-operation identity failure cannot claim that prepare's side effects
    // did not happen. Status never invokes the mutating preparation method.
    try{await employeeAdapter.authenticate(credential);}catch{throw new ManagedApplicationPrepareError(method==='prepare'?'APPLICATION_PREPARE_UNCERTAIN':'APPLICATION_PREPARE_DENIED',method==='prepare');}
   }else if(operation.startsWith('applicationPrepare:')){
    const method=operation.split(':')[1];if(typeof applicationPrepare?.[method]!=='function')fail('APPLICATION_PREPARE_NOT_CONFIGURED',503);
    exact(payload,['scope','mediaId','source','requestId']);validateProductionDesignScope(payload.scope);requestId(payload.mediaId);requestId(payload.requestId);
    try{payload.source=validateManagedContentManifestReference(payload.source);}catch{fail('INVALID_APPLICATION_SOURCE');}
    const raw=await applicationPrepare[method]({...payload,credential,signal:request.signal});result=applicationPrepareProjection(raw,payload);
    // A post-operation identity failure cannot claim that prepare's side effects
    // did not happen. Status never invokes the mutating preparation method.
    try{await employeeAdapter.authenticate(credential);}catch{throw new ManagedApplicationPrepareError(method==='prepare'?'APPLICATION_PREPARE_UNCERTAIN':'APPLICATION_PREPARE_DENIED',method==='prepare');}
   }else if(operation.startsWith('applicationImage:')){
    const method=operation.split(':')[1],upload=method==='upload';
    if(typeof applicationImages?.[method]!=='function')fail('APPLICATION_IMAGES_NOT_CONFIGURED',503);
    exact(payload,upload?['mediaId','requestId','scope','bytes','mime','stage','angle']:['mediaId','requestId','scope']);
    requestId(payload.mediaId);requestId(payload.requestId);validateProductionDesignScope(payload.scope);
    let raw;try{raw=await applicationImages[method]({...payload,credential,signal:request.signal});}finally{if(upload)payload.bytes.fill(0);}
    try{result=validateManagedApplicationImageProjection(raw,{scope:payload.scope,mediaId:payload.mediaId,requestId:payload.requestId});}catch{fail('INVALID_APPLICATION_IMAGE_RESULT',500);}
    await employeeAdapter.authenticate(credential);
   }else if(operation==='managedUpload'||operation==='managedStatus'){
    const upload=operation==='managedUpload',method=upload?'upload':'status';
    if(typeof managedImages?.[method]!=='function')fail('MANAGED_IMAGES_NOT_CONFIGURED',503);
    exact(payload,upload?['mediaId','requestId','scope','bytes','mime','stage','angle']:['mediaId','scope']);requestId(payload.mediaId);if(upload)requestId(payload.requestId);
    validateProductionDesignScope(payload.scope); // managed service rechecks immutable identity and service scope on every operation.
    try{result=await managedImages[method]({...payload,credential,signal:request.signal});}finally{if(upload)payload.bytes.fill(0);}
    try{exact(result,['schemaVersion','mediaId','sourceVersion','requestId','state','candidateEligible','publicEligible']);}catch{fail('INVALID_MANAGED_IMAGE_RESULT',500);}
    if(result.schemaVersion!=='design-managed-image-status-v1'||result.mediaId!==payload.mediaId||typeof result.sourceVersion!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(result.sourceVersion)||!['quarantined','pending_validation'].includes(result.state)||result.candidateEligible!==false||result.publicEligible!==false)fail('INVALID_MANAGED_IMAGE_RESULT',500);requestId(result.requestId);
   }else if(operation==='visitList'){
    exact(payload,['date']);
    if(typeof payload.date!=='string'||payload.date.startsWith('0000-')||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)||!Number.isFinite(Date.parse(payload.date+'T00:00:00Z'))||new Date(payload.date+'T00:00:00Z').toISOString().slice(0,10)!==payload.date)fail('INVALID_BUSINESS_DATE');
    if(typeof visitLister!=='function')fail('VISIT_LIST_ADAPTER_REQUIRED',503);
    result=await visitLister({...payload,credential});exact(result,['date','visits']);
    if(result.date!==payload.date||!Array.isArray(result.visits)||result.visits.length>50)fail('INVALID_VISIT_LIST_RESULT',500);
    const ids=new Set();for(const row of result.visits){exact(row,['id','displayName','visit','bindingRevision']);exact(row.visit,['assignmentSource','visitId']);
     try{validateProductionDesignScope({customerProfileId:'1',...row.visit});}catch{fail('INVALID_VISIT_LIST_RESULT',500);}
     if(row.id!==row.visit.visitId||ids.has(row.id)||typeof row.displayName!=='string'||!row.displayName.trim()||row.displayName!==row.displayName.trim()||row.displayName.length>160||/[\u0000-\u001f\u007f]/.test(row.displayName)||typeof row.bindingRevision!=='string'||!row.bindingRevision||row.bindingRevision.length>160||row.bindingRevision!==row.bindingRevision.trim()||/[\u0000-\u001f\u007f]/.test(row.bindingRevision))fail('INVALID_VISIT_LIST_RESULT',500);ids.add(row.id);
    }
   }else if(operation==='visitResolve'){
    exact(payload,plain(payload)&&Object.hasOwn(payload,'expectedBindingRevision')?['visit','expectedBindingRevision']:['visit']);
    if(Object.hasOwn(payload,'expectedBindingRevision')&&(typeof payload.expectedBindingRevision!=='string'||!payload.expectedBindingRevision||payload.expectedBindingRevision.length>160||payload.expectedBindingRevision!==payload.expectedBindingRevision.trim()||/[\u0000-\u001f\u007f]/.test(payload.expectedBindingRevision)))fail('INVALID_BINDING_REVISION');
    if(typeof visitResolver!=='function')fail('VISIT_RESOLVER_REQUIRED',503);
    result=await visitResolver({...payload,credential});
   }else if(operation==='analyze'){
    exact(payload,['requestId','scope']);requestId(payload.requestId);
    if(typeof sessionRepository?.loadEvidenceSession!=='function'||typeof providerAdapter?.analyze!=='function')fail('EVIDENCE_ADAPTER_REQUIRED',503);
    const grant=await employeeAdapter.gate.authorize(credential,payload.scope);
    const session=validateDesignSession(await sessionRepository.loadEvidenceSession({grant}));
    if(session.scope.customerId!==grant.scope.customerProfileId||session.scope.visitId!==grant.scope.visitId)fail('EVIDENCE_SCOPE_MISMATCH',403);
    const beforeSend=await employeeAdapter.gate.authorize(credential,grant.scope);
    if(beforeSend.actor.username!==grant.actor.username||beforeSend.actor.store!==grant.actor.store)fail('ACTOR_CHANGED',403);
    result=await providerAdapter.analyze({requestId:payload.requestId,credential,scope:grant.scope,session});
    const latest=await employeeAdapter.gate.authorize(credential,grant.scope);
    if(latest.actor.username!==grant.actor.username||latest.actor.store!==grant.actor.store)fail('ACTOR_CHANGED',403);
   }else if(operation==='speech'){
    requestId(payload.requestId);if(typeof speechAdapter?.transcribe!=='function')fail('SPEECH_ADAPTER_REQUIRED',503);
    const grant=await employeeAdapter.gate.authorize(credential,payload.scope);
    result=await speechAdapter.transcribe({...payload,credential,scope:grant.scope});
    const latest=await employeeAdapter.gate.authorize(credential,grant.scope);
    if(latest.actor.username!==grant.actor.username||latest.actor.store!==grant.actor.store)fail('ACTOR_CHANGED',403);
   }else if(operation==='archive'){
    exact(payload,['requestId','scope','expectedLatestVersionId','snapshot']);requestId(payload.requestId);
    if(typeof archiveAdapter?.appendLegacyVersion!=='function')fail('ARCHIVE_ADAPTER_REQUIRED',503);
    result=await archiveAdapter.appendLegacyVersion({...payload,credential});
   }else if(operation.startsWith('synthesisOperation:')){
    const method=operation.split(':')[1];
    exact(payload,method==='enqueue'?['scope','requestId','side']:method==='lookup'?['scope','requestId']:method==='list'?['scope']:['scope','operationId']);
    validateProductionDesignScope(payload.scope);
    if(method==='enqueue'||method==='lookup'){requestId(payload.requestId);if(payload.requestId.length>80)fail('INVALID_REQUEST_ID');}
    if(method==='enqueue'&&!['left','right'].includes(payload.side))fail('INVALID_COMPARISON_SIDE');
    if((method==='status'||method==='cancel')&&(typeof payload.operationId!=='string'||!/^[a-f0-9]{64}$/.test(payload.operationId)))fail('INVALID_OPERATION_ID');
    if(typeof durableSynthesisService?.[method]!=='function')fail('DURABLE_SYNTHESIS_NOT_CONFIGURED',503);
    result=await durableSynthesisService[method]({...payload,credential});
    exact(result,method==='list'?['operations']:['operation']);
    if(method==='list'){
     if(!Array.isArray(result.operations)||result.operations.length>20)fail('INVALID_OPERATION_RESULT',500);
     const ids=new Set();for(const op of result.operations){validateDurableOperation(op);if(ids.has(op.id))fail('INVALID_OPERATION_RESULT',500);ids.add(op.id);}
    }else if(result.operation!==null){
     const op=validateDurableOperation(result.operation);
     if(payload.operationId&&op.id!==payload.operationId||payload.requestId&&op.requestId!==payload.requestId||method==='enqueue'&&op.side!==payload.side)fail('INVALID_OPERATION_RESULT',500);
    }else if(method==='enqueue')fail('INVALID_OPERATION_RESULT',500);
    if(method==='enqueue')responseStatus=202;
   }else if(operation.startsWith('candidate')){
    const method={candidateExtract:'extract',candidateVision:'vision',candidateCompare:'compare',candidateSynthesize:'synthesize',candidateLoad:'load'}[operation];
    exact(payload,method==='extract'?['scope','requestId']:method==='vision'?['scope','requestId','mediaId','approval']:method==='compare'?['scope','requestId','beforeMediaId','afterMediaId','approval']:method==='synthesize'?['scope','requestId','side']:['scope','candidateId']);
    requestId(method==='load'?payload.candidateId:payload.requestId);
    if(method==='synthesize'&&!['left','right'].includes(payload.side))fail('INVALID_COMPARISON_SIDE');
    if(typeof candidateService?.[method]!=='function')fail('CANDIDATE_ADAPTER_REQUIRED',503);
    result=await candidateService[method]({...payload,credential});
   }else if(operation.startsWith('workflow')){
    const method={workflowLoad:'load',workflowDispatch:'dispatch',workflowSnapshot:'snapshot'}[operation];
    exact(payload,operation==='workflowDispatch'?['scope','requestId','expectedRevision','intent']:['scope']);
    if(operation==='workflowDispatch')requestId(payload.requestId);
    if(typeof workflowService?.[method]!=='function')fail('WORKFLOW_ADAPTER_REQUIRED',503);
    result=await workflowService[method]({...payload,credential});
   }else if(operation==='fullArchiveLoad'){
    exact(payload,['scope']);
    if(typeof fullWorkflowArchive?.load!=='function')fail('FULL_ARCHIVE_ADAPTER_REQUIRED',503);
    result=await fullWorkflowArchive.load({...payload,credential});
   }else if(operation==='fullArchive'){
    exact(payload,['requestId','scope','expectedVersion','expectedParentDigest','snapshot']);requestId(payload.requestId);
    if(typeof fullWorkflowArchive?.append!=='function')fail('FULL_ARCHIVE_ADAPTER_REQUIRED',503);
    result=await fullWorkflowArchive.append({...payload,credential});
   }else if(operation.startsWith('media')){
    const method={mediaUpload:'upload',mediaRead:'read',mediaPreview:'preview',mediaReferences:'resolveReferences'}[operation];
    if(typeof privateMedia?.[method]!=='function')fail('PRIVATE_MEDIA_ADAPTER_REQUIRED',503);
    if(operation==='mediaUpload')requestId(payload.requestId);
    else exact(payload,['mediaRead','mediaPreview'].includes(operation)?['scope','approval','mediaId']:['scope','approval','mediaIds']);
    result=await privateMedia[method]({...payload,credential});
    if(operation==='mediaPreview'){
     exact(result,['reference','bytes','preview','cacheControl','maxAgeSeconds']);const p=result.preview;
     exact(p,['mime','width','height','sourceSha256']);if(!(result.bytes instanceof Uint8Array)||result.bytes.length<1||result.bytes.length>524288||p.mime!=='image/jpeg'||![p.width,p.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024)||!/^[a-f0-9]{64}$/.test(p.sourceSha256)||result.reference?.mediaId!==payload.mediaId||result.cacheControl!=='private, no-store'||result.maxAgeSeconds!==0)fail('INVALID_MEDIA_RESULT',500);
     return new Response(result.bytes,{status:200,headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Design-Preview':'phone-v2','X-Design-Preview-Width':String(p.width),'X-Design-Preview-Height':String(p.height),'X-Design-Source-Media':result.reference.mediaId,'X-Design-Source-Bytes':String(result.reference.byteLength),'X-Design-Source-Mime':result.reference.mime,...(cors?{'Access-Control-Allow-Origin':cors,'Vary':'Origin'}:{})}});
    }
    if(operation==='mediaRead'){
     exact(result,['reference','bytes','cacheControl','maxAgeSeconds']);
     if(!(result.bytes instanceof Uint8Array)||!result.bytes.length||result.bytes.length>PRIVATE_MEDIA_MAX_BYTES||
        !PHONE_SOURCE_MIMES.includes(result.reference?.mime)||result.cacheControl!=='private, no-store'||result.maxAgeSeconds!==0)fail('INVALID_MEDIA_RESULT',500);
     return new Response(result.bytes,{status:200,headers:{'Content-Type':result.reference.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(cors?{'Access-Control-Allow-Origin':cors,'Vary':'Origin'}:{})}});
    }
   }else{
    if(!keySettings)fail('KEY_SETTINGS_ADAPTER_REQUIRED',503);
    const method={keyRead:'status',keySave:'save',keyRevoke:'revoke'}[operation];
    if(typeof keySettings[method]!=='function')fail('KEY_SETTINGS_ADAPTER_REQUIRED',503);
    exact(payload,operation==='keyRead'?['purpose']:operation==='keySave'?['approval','expectedRevision','config','key']:['approval','expectedRevision','purpose']);
    result=await keySettings[method]({credential,...payload});
    // Public shape and destination guard; the trusted settings adapter also validates stored model identity.
    const immutableStatus=keySettingsSchema==='immutable-v2'&&operation==='keyRead';
    exact(result,immutableStatus?['configured','revision','destination','model','requiresReconfiguration']:['configured','revision','destination','model']);
    if(immutableStatus&&typeof result.requiresReconfiguration!=='boolean')fail('INVALID_SETTINGS_RESULT',500);
    if(typeof result.configured!=='boolean'||!Number.isSafeInteger(result.revision)||result.revision<0||
       ![null,'https://api.deepseek.com/chat/completions','https://api.deepseek.com/v1/tools/asr'].includes(result.destination)||
       !(result.model===null||(typeof result.model==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(result.model))))fail('INVALID_SETTINGS_RESULT',500);
    if(result.destination==='https://api.deepseek.com/v1/tools/asr'&&result.model!==null)fail('INVALID_SETTINGS_RESULT',500);
    if(operation==='keySave'&&(result.destination!==payload.config.destination||result.model!==payload.config.model))fail('INVALID_SETTINGS_RESULT',500);
    result={configured:result.configured,revision:result.revision,destination:result.destination,model:result.model,...(immutableStatus?{requiresReconfiguration:result.requiresReconfiguration}:{})};
   }
   return response(responseStatus,{ok:true,result},cors);
  }catch(error){
   // Never echo errors from injected resolvers, providers, stores or key handling.
   if(error instanceof ManagedApplicationViewDispatchError){const od=Object.getOwnPropertyDescriptor(error,'outcome');const safe=new ManagedApplicationViewDispatchError(od&&Object.hasOwn(od,'value')?od.value:undefined);return response(409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:'Query the original application view request; do not automatically dispatch again.'}},cors);}
   if(error instanceof ManagedApplicationDispatchError){const od=Object.getOwnPropertyDescriptor(error,'outcome');const safe=new ManagedApplicationDispatchError(od&&Object.hasOwn(od,'value')?od.value:undefined);return response(409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:'Query the original synthetic application model request; do not automatically dispatch again.'}},cors);}
   if(error instanceof ManagedApplicationPrepareError){const cd=Object.getOwnPropertyDescriptor(error,'code'),od=Object.getOwnPropertyDescriptor(error,'outcome');const safe=new ManagedApplicationPrepareError(cd&&Object.hasOwn(cd,'value')?cd.value:undefined,od&&Object.hasOwn(od,'value')&&od.value==='uncertain');return response(409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:'Query the original preparation request; do not automatically process or upload again.'}},cors);}
   if(error instanceof ManagedNormalizedDispatchError){const d=Object.getOwnPropertyDescriptor(error,'outcome');return response(409,{ok:false,error:{code:'MANAGED_NORMALIZED_DISPATCH_FAILED',outcome:d&&Object.hasOwn(d,'value')&&d.value==='uncertain'?'uncertain':'not_sent',retryable:false,message:'Check the original synthetic request; do not automatically submit again.'}},cors);}
   if(error instanceof ManagedViewDispatchError){const d=Object.getOwnPropertyDescriptor(error,'outcome');return response(409,{ok:false,error:{code:'MANAGED_VIEW_DISPATCH_FAILED',outcome:d&&Object.hasOwn(d,'value')&&d.value==='uncertain'?'uncertain':'not_sent',retryable:false,message:'Check the original managed view request; do not automatically submit again.'}},cors);}
   if(error instanceof ManagedImageDispatchError){const d=Object.getOwnPropertyDescriptor(error,'outcome');return response(409,{ok:false,error:{code:'MANAGED_IMAGE_DISPATCH_FAILED',outcome:d&&Object.hasOwn(d,'value')&&d.value==='uncertain'?'uncertain':'not_sent',retryable:false,message:'Check the original managed request; do not automatically submit again.'}},cors);}
   if(error instanceof ManagedApplicationImageServiceError){const cd=Object.getOwnPropertyDescriptor(error,'code'),od=Object.getOwnPropertyDescriptor(error,'outcome');const safe=new ManagedApplicationImageServiceError(cd&&Object.hasOwn(cd,'value')?cd.value:undefined,od&&Object.hasOwn(od,'value')?od.value:undefined);const tooLarge=safe.code==='APPLICATION_IMAGE_TOO_LARGE'&&safe.outcome==='not_sent';return response(tooLarge?413:safe.code==='APPLICATION_IMAGE_NOT_FOUND'&&safe.outcome==='not_sent'?404:409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:tooLarge?'Photo exceeds the inclusive 8 MiB limit; this upload was not sent.':'Check the original application image request; do not automatically upload again.'}},cors);}
   if(error instanceof ManagedImageServiceError){const code=Object.getOwnPropertyDescriptor(error,'code'),outcome=Object.getOwnPropertyDescriptor(error,'outcome');const safe=new ManagedImageServiceError(code&&Object.hasOwn(code,'value')?code.value:undefined,outcome&&Object.hasOwn(outcome,'value')?outcome.value:undefined);const tooLarge=safe.code==='MANAGED_IMAGE_SERVICE_TOO_LARGE'&&safe.outcome==='not_sent';return response(tooLarge?413:409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:tooLarge?'Photo exceeds the inclusive 8 MiB limit; this upload was not sent.':'Check the original private image status; do not automatically upload again.'}},cors);}
   const immutableCodes=new Set(['IMMUTABLE_DEPENDENCY_DISABLED','IMMUTABLE_DEPENDENCY_INVALID','IMMUTABLE_DEPENDENCY_DENIED','IMMUTABLE_DEPENDENCY_DEPENDENCY_UNSUPPORTED','IMMUTABLE_DEPENDENCY_CORRUPT','IMMUTABLE_DEPENDENCY_CHANGED','IMMUTABLE_DEPENDENCY_TRANSACTION','IMMUTABLE_DEPENDENCY_UNCERTAIN']);
   if(error instanceof ImmutableDependencyError&&immutableCodes.has(error.code))return response(409,{ok:false,error:{code:error.code,outcome:error.code==='IMMUTABLE_DEPENDENCY_UNCERTAIN'?'uncertain':'withheld',retryable:false,message:'Request was not completed. Check authorization and exact saved state before any retry; never automatically repeat a potentially charged operation.'}},cors);
   if(error instanceof DurableSynthesisError){const safe=new DurableSynthesisError(error.code,error.outcome);return response(409,{ok:false,error:{code:safe.code,outcome:safe.outcome,retryable:false,message:'Check the original operation; do not automatically resubmit or repeat a potentially charged request.'}},cors);}
   const providerError=error instanceof DesignProviderError;
   const mediaError=error instanceof PrivateMediaError;
   const fullError=error instanceof FullWorkflowArchiveError;
   const workflowError=error instanceof PreparedWorkflowError;
   const candidateError=error instanceof CandidateServiceError;
   const visitResolveError=error instanceof ProductionEmployeeError&&error.code==='CUSTOMER_BINDING_CHANGED';
   const visitListError=error instanceof VisitListError&&new Set(['VISIT_LIST_LIMIT_EXCEEDED','VISIT_LIST_INVALID_REQUEST','VISIT_LIST_INVALID_DATE','VISIT_LIST_NOT_CONFIGURED','VISIT_LIST_ACCESS_DENIED','VISIT_LIST_UNAVAILABLE','VISIT_LIST_CHANGED']).has(error.code);
   return response(error instanceof EntryError?error.status:(providerError||mediaError||fullError||workflowError||candidateError||visitListError||visitResolveError)?409:400,{ok:false,error:{code:error instanceof EntryError?error.code:(providerError||mediaError||fullError||workflowError||candidateError||visitListError||visitResolveError)?error.code:'OPERATION_REJECTED',outcome:(providerError||mediaError||fullError||workflowError||candidateError||visitListError||visitResolveError)?(error.outcome||'unknown'):'unknown',retryable:false,message:'Request was not completed. Check authorization and exact saved state before any retry; never automatically repeat a potentially charged operation.'}},cors);
  }
 };
}
