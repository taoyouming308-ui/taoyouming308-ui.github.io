import {ProductionEmployeeError} from '../packages/design-production-adapter/employee-adapter.mjs';
import {VisitListError} from '../packages/design-production-adapter/visit-list-service.mjs';
import {PreparedWorkflowError} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {FullWorkflowArchiveError} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {PrivateMediaError} from '../packages/design-production-adapter/private-media.mjs';
import {DesignProviderError} from '../packages/design-production-adapter/provider-adapter.mjs';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {createDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden');};
const api='https://synthetic-design.invalid',app='https://synthetic-app.invalid',credential='synthetic-session-token';
const scope={customerProfileId:'123',visitId:'booking:456',assignmentSource:'appointment'};
function fixtures(){
 const state={actor:{username:'synthetic-employee',store:'synthetic-store'},enabled:true,calls:[]};
 const employeeAdapter={authenticate:async token=>{assert.equal(token,credential);state.calls.push('authenticate');if(!state.enabled)throw Error('secret denied');return {active:true,...state.actor,expiresAt:9999999999999};},gate:{authorize:async(token,requested)=>{assert.equal(token,credential);assert.deepEqual(requested,scope);state.calls.push('authorize');if(!state.enabled)throw Error('revoked');return {actor:{...state.actor},scope:{...scope}};}}};
 const options={enabled:true,publicOrigin:api,allowedRequestOrigins:[app],employeeAdapter,sessionRepository:{loadEvidenceSession:async({grant})=>{assert.deepEqual(grant.scope,scope);state.calls.push('load');return createDesignSession({customerId:'123',visitId:'booking:456',sessionId:'server-owned-session'});}},providerAdapter:{analyze:async value=>{state.calls.push('analyze');assert.equal(value.session.scope.sessionId,'server-owned-session');return {kind:'synthetic-candidate',confirmed:false};}},speechAdapter:{transcribe:async value=>{state.calls.push('speech');assert(value.audioBytes instanceof Uint8Array);return {transcript:{text:'synthetic transcript',confirmed:false}};}},archiveAdapter:{appendLegacyVersion:async value=>{state.calls.push('archive');return {saved:true,version:1};}}};
 return {state,options,handler:createDesignHttpHandler(options)};
}
function json(path,body,headers={}){return new Request(api+path,{method:'POST',headers:{'content-type':'application/json','origin':app,'x-employee-session':credential,...headers},body:JSON.stringify(body)});}
async function code(response,expected,status){assert.equal(response.status,status);assert.equal((await response.json()).error.code,expected);}
test('unconfigured entry rejects before any I/O and discloses no credentials',async()=>{await code(await createDesignHttpHandler()(json('/api/design/analyze',{requestId:'req',scope})),'ENTRY_NOT_CONFIGURED',503);});
test('analyze only loads server-owned evidence, never client supplied session/key/model',async()=>{const {handler,state}=fixtures();assert.equal((await handler(json('/api/design/analyze',{requestId:'req',scope}))).status,200);assert(state.calls.includes('load'));for(const key of ['session','apiKey','model','endpoint','actor'])await code(await handler(json('/api/design/analyze',{requestId:'req',scope,[key]:'forged'})),'INVALID_FIELDS',400);});
test('foreign evidence scope is rejected before provider dispatch',async()=>{const {options,state}=fixtures();options.sessionRepository.loadEvidenceSession=async()=>createDesignSession({customerId:'999',visitId:'booking:456',sessionId:'other'});await code(await createDesignHttpHandler(options)(json('/api/design/analyze',{requestId:'req',scope})),'EVIDENCE_SCOPE_MISMATCH',403);assert(!state.calls.includes('analyze'));});
test('origin, route, cookie and unsupported credential channels deny',async()=>{const {handler}=fixtures();await code(await handler(json('/api/design/analyze',{requestId:'req',scope},{origin:'https://other.invalid'})),'ORIGIN_DENIED',403);await code(await handler(json('/api/design/analyze?x=1',{requestId:'req',scope})),'INVALID_ROUTE',404);await code(await handler(json('/api/design/analyze',{requestId:'req',scope},{cookie:'synthetic-cookie'})),'UNSUPPORTED_CREDENTIAL_CHANNEL',400);});
test('preflight grants exact configured origin/header only, never credentials',async()=>{const {handler}=fixtures();const req=new Request(api+'/api/design/analyze',{method:'OPTIONS',headers:{origin:app,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-employee-session'}});const r=await handler(req);assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),app);assert.equal(r.headers.get('access-control-allow-credentials'),null);});
test('unauthenticated upload is rejected before body parsing; dependency errors are redacted',async()=>{const {state,handler}=fixtures();state.enabled=false;const r=await handler(json('/api/design/analyze',{requestId:'req',scope}));assert.equal(r.status,400);assert(!await r.text().then(t=>t.includes('secret')));assert.deepEqual(state.calls,['authenticate']);});
test('actual body size and encoding are bounded, not trusted from MIME or a declared size',async()=>{const {handler}=fixtures();await code(await handler(json('/api/design/analyze',{data:'x'.repeat(768*1024)})),'PAYLOAD_LIMIT',413);await code(await handler(json('/api/design/analyze',{requestId:'req',scope},{'content-encoding':'gzip'})),'ENCODING_NOT_SUPPORTED',415);});
test('speech multipart passes only exact scope/request and actual file bytes, not filename/MIME claims',async()=>{const {handler,state}=fixtures();const body=new FormData();body.append('scope',JSON.stringify(scope));body.append('requestId','speech-1');body.append('file',new Blob([new Uint8Array([1,2,3])],{type:'untrusted/type'}),'ignored-name.bin');const r=await handler(new Request(api+'/api/design/speech',{method:'POST',headers:{origin:app,'x-employee-session':credential},body}));assert.equal(r.status,200);assert(state.calls.includes('speech'));});
test('duplicate multipart fields cannot smuggle authority',async()=>{const {handler}=fixtures();const body=new FormData();body.append('scope',JSON.stringify(scope));body.append('requestId','speech-1');body.append('file',new Blob(['synthetic']));body.append('scope',JSON.stringify({...scope,owner:true}));await code(await handler(new Request(api+'/api/design/speech',{method:'POST',headers:{'x-employee-session':credential},body})),'INVALID_FIELDS',400);});
test('revocation or actor change while provider is pending rejects result delivery',async()=>{for(const change of ['revoke','actor']){const {options,state}=fixtures();options.providerAdapter.analyze=async()=>{if(change==='revoke')state.enabled=false;else state.actor.username='other';return {text:'private withheld'};};const r=await createDesignHttpHandler(options)(json('/api/design/analyze',{requestId:'req',scope}));assert.notEqual(r.status,200);assert(!await r.text().then(t=>t.includes('private withheld')));}});
test('legacy archive only accepts exact legacy envelope and missing adapters fail closed',async()=>{const {handler,options}=fixtures();assert.equal((await handler(json('/api/design/archive/legacy',{requestId:'req',scope,expectedLatestVersionId:null,snapshot:{synthetic:true}}))).status,200);await code(await handler(json('/api/design/archive/legacy',{requestId:'req',scope,expectedLatestVersionId:null,snapshot:{},projection:{}})),'INVALID_FIELDS',400);delete options.sessionRepository;await code(await createDesignHttpHandler(options)(json('/api/design/analyze',{requestId:'req',scope})),'EVIDENCE_ADAPTER_REQUIRED',503);});

test('key-settings entry maps exact approved inputs and only returns public metadata',async()=>{
 const {options}=fixtures();let received;options.keySettings={status:async({credential:token})=>{assert.equal(token,credential);return {configured:false,revision:0,destination:null,model:null};},save:async input=>{received=input;return {configured:true,revision:1,destination:'https://api.deepseek.com/chat/completions',model:'synthetic-approved-model'};}};
 const handler=createDesignHttpHandler(options);const payload={approval:'synthetic-action-time-receipt',expectedRevision:0,config:{destination:'https://api.deepseek.com/chat/completions',model:'synthetic-approved-model'},key:'SYNTHETIC_ONLY_NOT_A_REAL_KEY'};
 const r=await handler(json('/api/design/key-settings/save',payload));assert.equal(r.status,200);const text=await r.text();assert(!text.includes(payload.key));assert.equal(received.credential,credential);assert.equal(received.key,payload.key);
 await code(await handler(json('/api/design/key-settings/save',{...payload,actor:'other'})),'INVALID_FIELDS',400);
 assert.equal((await handler(json('/api/design/key-settings/read',{purpose:'chat'}))).status,200);
 options.keySettings.status=async()=>({configured:true,revision:1,destination:null,model:null,key:'DO_NOT_RETURN'});const blocked=await createDesignHttpHandler(options)(json('/api/design/key-settings/read',{purpose:'chat'}));assert.notEqual(blocked.status,200);assert(!await blocked.text().then(t=>t.includes('DO_NOT_RETURN')));
});

test('uncertain paid outcomes remain explicit and non-retryable at the HTTP boundary',async()=>{
 const {options}=fixtures();options.providerAdapter.analyze=async()=>{throw new DesignProviderError('TIMEOUT','uncertain');};
 const response=await createDesignHttpHandler(options)(json('/api/design/analyze',{requestId:'uncertain',scope}));assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.outcome,'uncertain');assert.equal(body.error.retryable,false);assert.equal(body.error.code,'TIMEOUT');
});

 test('revocation or actor change during evidence loading prevents provider dispatch',async()=>{for(const change of ['revoke','actor']){const {options,state}=fixtures();const load=options.sessionRepository.loadEvidenceSession;options.sessionRepository.loadEvidenceSession=async args=>{const session=await load(args);if(change==='revoke')state.enabled=false;else state.actor.username='other';return session;};const r=await createDesignHttpHandler(options)(json('/api/design/analyze',{requestId:'load-race',scope}));assert.notEqual(r.status,200);assert(!state.calls.includes('analyze'));}});

test('full workflow archive has an independent exact envelope and never falls back to legacy',async()=>{
 const {options,state}=fixtures();let saved;options.fullWorkflowArchive={append:async input=>{saved=input;return {saved:true,synthetic:true};}};
 const payload={requestId:'full-1',scope,expectedVersion:0,expectedParentDigest:null,snapshot:{synthetic:'preserved'}};
 assert.equal((await createDesignHttpHandler(options)(json('/api/design/archive/full',payload))).status,200);assert.deepEqual(saved,{...payload,credential});assert(!state.calls.includes('archive'));
 await code(await createDesignHttpHandler(options)(json('/api/design/archive/full',{...payload,owner:'forged'})),'INVALID_FIELDS',400);
 delete options.fullWorkflowArchive;await code(await createDesignHttpHandler(options)(json('/api/design/archive/full',payload)),'FULL_ARCHIVE_ADAPTER_REQUIRED',503);
});
test('private media multipart forwards only bounded actual bytes and untrusted MIME for validation',async()=>{
 const {options}=fixtures();let saved;options.privateMedia={upload:async input=>{saved=input;return {reference:{mediaId:'photo-1'},replayed:false};}};
 const form=new FormData();for(const [k,v] of Object.entries({scope:JSON.stringify(scope),approval:JSON.stringify('synthetic-approval'),requestId:'photo-1',stage:'before',angle:'front'}))form.append(k,v);
 form.append('file',new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),'private-name-not-forwarded.png');
 const response=await createDesignHttpHandler(options)(new Request(api+'/api/design/media/upload',{method:'POST',headers:{origin:app,'x-employee-session':credential},body:form}));assert.equal(response.status,200);assert.deepEqual(saved.bytes,new Uint8Array([1,2,3]));assert.equal(saved.mime,'image/png');assert.equal(saved.approval,'synthetic-approval');assert(!Object.hasOwn(saved,'filename'));
});
test('private media read delivers only image bytes with no-store/nosniff; invalid results deny',async()=>{
 const {options}=fixtures();options.privateMedia={read:async input=>{assert.equal(input.credential,credential);return {reference:{mime:'image/png'},bytes:new Uint8Array([1,2,3]),cacheControl:'private, no-store',maxAgeSeconds:0};}};
 const request=()=>json('/api/design/media/read',{scope,approval:'synthetic',mediaId:'photo-1'});
 const response=await createDesignHttpHandler(options)(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]));
 options.privateMedia.read=async()=>({reference:{mime:'text/html'},bytes:new Uint8Array([1]),cacheControl:'private, no-store',maxAgeSeconds:0});await code(await createDesignHttpHandler(options)(request()),'INVALID_MEDIA_RESULT',500);
});
test('private reference requests reject authority fields and require their explicit adapter',async()=>{
 const {options}=fixtures();options.privateMedia={resolveReferences:async input=>({references:input.mediaIds.map(mediaId=>({mediaId}))})};
 const body={scope,approval:'synthetic',mediaIds:['photo-1']};assert.equal((await createDesignHttpHandler(options)(json('/api/design/media/references',body))).status,200);
 await code(await createDesignHttpHandler(options)(json('/api/design/media/references',{...body,url:'https://forged.invalid'})),'INVALID_FIELDS',400);
 delete options.privateMedia;await code(await createDesignHttpHandler(options)(json('/api/design/media/references',body)),'PRIVATE_MEDIA_ADAPTER_REQUIRED',503);
});

test('uncertain private storage outcomes remain explicit and never invite auto upload retry',async()=>{const {options}=fixtures();options.privateMedia={resolveReferences:async()=>{throw new PrivateMediaError('MEDIA_OUTCOME_UNCERTAIN');}};const response=await createDesignHttpHandler(options)(json('/api/design/media/references',{scope,approval:'synthetic',mediaIds:['photo-1']}));assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.outcome,'uncertain');assert.equal(body.error.retryable,false);});

test('full archive uses its larger bounded contract instead of the legacy JSON limit',async()=>{const {options}=fixtures();options.fullWorkflowArchive={append:async input=>({size:input.snapshot.synthetic.length})};const payload={requestId:'full-large',scope,expectedVersion:0,expectedParentDigest:null,snapshot:{synthetic:'x'.repeat(800*1024)}};const response=await createDesignHttpHandler(options)(json('/api/design/archive/full',payload));assert.equal(response.status,200);assert.equal((await response.json()).result.size,800*1024);await code(await createDesignHttpHandler(options)(json('/api/design/archive/full',payload,{'content-length':String(33*1024*1024)})),'PAYLOAD_LIMIT',413);});

test('uncertain full-archive commit is preserved at the HTTP boundary',async()=>{const {options}=fixtures();options.fullWorkflowArchive={append:async()=>{throw new FullWorkflowArchiveError('FULL_OUTCOME_UNCERTAIN');}};const response=await createDesignHttpHandler(options)(json('/api/design/archive/full',{requestId:'full-uncertain',scope,expectedVersion:0,expectedParentDigest:null,snapshot:{}}));assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.outcome,'uncertain');assert.equal(body.error.retryable,false);});

test('workflow routes preserve actor-free intent envelope and have no synthetic or legacy fallback',async()=>{const {options,state}=fixtures();const received=[];options.workflowService={load:async input=>{received.push(input);return {record:{synthetic:true}};},dispatch:async input=>{received.push(input);return {saved:true};},snapshot:async input=>{received.push(input);return {saved:false,requiresAuthoritativeSourceVerification:true};}};const handler=createDesignHttpHandler(options);assert.equal((await handler(json('/api/design/workflow/load',{scope}))).status,200);const payload={scope,requestId:'intent-1',expectedRevision:0,intent:{type:'record_source',kind:'text',text:'合成原话'}};assert.equal((await handler(json('/api/design/workflow/dispatch',payload))).status,200);assert.deepEqual(received[1],{...payload,credential});assert.equal((await handler(json('/api/design/workflow/snapshot',{scope}))).status,200);assert(!state.calls.includes('archive'));await code(await handler(json('/api/design/workflow/dispatch',{...payload,actor:'forged'})),'INVALID_FIELDS',400);delete options.workflowService;await code(await createDesignHttpHandler(options)(json('/api/design/workflow/load',{scope})),'WORKFLOW_ADAPTER_REQUIRED',503);});
test('uncertain workflow commit is explicit and cannot be blindly retried',async()=>{const {options}=fixtures();options.workflowService={dispatch:async()=>{throw new PreparedWorkflowError('WORKFLOW_OUTCOME_UNCERTAIN','uncertain');}};const response=await createDesignHttpHandler(options)(json('/api/design/workflow/dispatch',{scope,requestId:'intent-u',expectedRevision:0,intent:{}}));assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.outcome,'uncertain');assert.equal(body.error.retryable,false);});


test('full archive load accepts scope only and requires its authoritative read adapter',async()=>{
 const {options,state}=fixtures();let received;options.fullWorkflowArchive={load:async input=>{received=input;return {currentVersion:0,currentDigest:null,versions:[]};}};
 const handler=createDesignHttpHandler(options);const response=await handler(json('/api/design/archive/full/load',{scope}));assert.equal(response.status,200);assert.deepEqual(received,{scope,credential});assert.deepEqual((await response.json()).result,{currentVersion:0,currentDigest:null,versions:[]});assert(!state.calls.includes('archive'));
 await code(await handler(json('/api/design/archive/full/load',{scope,actor:'forged'})),'INVALID_FIELDS',400);
 options.fullWorkflowArchive={append:async()=>{throw Error('must not append');}};await code(await createDesignHttpHandler(options)(json('/api/design/archive/full/load',{scope})),'FULL_ARCHIVE_ADAPTER_REQUIRED',503);
});
test('full archive read denial never returns dependency details or a stale head',async()=>{const {options}=fixtures();options.fullWorkflowArchive={load:async()=>{throw Error('private stale archive metadata');}};const response=await createDesignHttpHandler(options)(json('/api/design/archive/full/load',{scope}));assert.notEqual(response.status,200);const body=await response.text();assert(!body.includes('private stale'));assert(!body.includes('currentVersion'));});


test('visit resolver accepts only an explicit locator and never identity hints',async()=>{const {options,state}=fixtures();let received;options.visitResolver=async value=>{received=value;return {scope};};const handler=createDesignHttpHandler(options),visit={assignmentSource:'appointment',visitId:'booking:101'};const response=await handler(json('/api/design/visit/resolve',{visit}));assert.equal(response.status,200);assert.deepEqual(received,{visit,credential});assert.deepEqual((await response.json()).result,{scope});assert(!state.calls.includes('archive'));for(const extra of [{phone:'synthetic'},{name:'synthetic'},{customerId:'11'},{actor:'other'}])await code(await handler(json('/api/design/visit/resolve',{visit,...extra})),'INVALID_FIELDS',400);delete options.visitResolver;await code(await createDesignHttpHandler(options)(json('/api/design/visit/resolve',{visit})),'VISIT_RESOLVER_REQUIRED',503);});


test('visit list accepts only explicit business date and returns minimal bounded verified choices',async()=>{
 const {options}=fixtures();let received;const row={id:'booking:101',displayName:'合成同名顾客',visit:{assignmentSource:'appointment',visitId:'booking:101'},bindingRevision:'binding:1'};
 options.visitLister=async input=>{received=input;return {date:input.date,visits:[row]};};const handler=createDesignHttpHandler(options);
 const response=await handler(json('/api/design/visit/list',{date:'2026-11-15'}));assert.equal(response.status,200);assert.deepEqual(received,{credential,date:'2026-11-15'});assert.deepEqual((await response.json()).result.visits,[row]);
 for(const payload of [{},{date:'2026-02-30'},{date:'today'},{date:'2026-11-15',actor:'other'},{date:'2026-11-15',scope}])assert.notEqual((await handler(json('/api/design/visit/list',payload))).status,200);
 delete options.visitLister;await code(await createDesignHttpHandler(options)(json('/api/design/visit/list',{date:'2026-11-15'})),'VISIT_LIST_ADAPTER_REQUIRED',503);
});
test('visit list rejects identity/contact leakage, duplicate rows and silent overflow in adapter result',async()=>{
 const {options}=fixtures(),row={id:'booking:101',displayName:'合成顾客',visit:{assignmentSource:'appointment',visitId:'booking:101'},bindingRevision:'binding:1'};
 for(const result of [{date:'2026-11-15',visits:[{...row,scope}]},{date:'2026-11-15',visits:[{...row,phone:'private-not-allowed'}]},{date:'2026-11-15',visits:[row,row]},{date:'2026-11-15',visits:Array(51).fill(row)},{date:'2026-11-16',visits:[row]},{date:'2026-11-15',visits:[{...row,bindingRevision:''}]}]){
  options.visitLister=async()=>result;const response=await createDesignHttpHandler(options)(json('/api/design/visit/list',{date:'2026-11-15'}));assert.notEqual(response.status,200);assert(!(await response.text()).includes('private-not-allowed'));
 }
});
test('visit resolution forwards explicit selected binding revision without accepting caller authority',async()=>{
 const {options}=fixtures();let received;options.visitResolver=async input=>{received=input;return {scope};};const payload={visit:{assignmentSource:'appointment',visitId:'booking:101'},expectedBindingRevision:'binding:2'};
 assert.equal((await createDesignHttpHandler(options)(json('/api/design/visit/resolve',payload))).status,200);assert.deepEqual(received,{...payload,credential});
 for(const extra of [{expectedBindingRevision:''},{expectedBindingRevision:2},{actor:'forged'},{scope}])assert.notEqual((await createDesignHttpHandler(options)(json('/api/design/visit/resolve',{...payload,...extra}))).status,200);
});

test('visit list capacity is explicit while arbitrary class codes and diagnostics are withheld',async()=>{
 const {options}=fixtures();options.visitLister=async()=>{throw new VisitListError('VISIT_LIST_LIMIT_EXCEEDED');};await code(await createDesignHttpHandler(options)(json('/api/design/visit/list',{date:'2026-11-15'})),'VISIT_LIST_LIMIT_EXCEEDED',409);
 for(const error of [new VisitListError('PRIVATE_CUSTOMER_DIAGNOSTIC'),Object.assign(new Error('PRIVATE_CUSTOMER_DIAGNOSTIC'),{name:'VisitListError',code:'VISIT_LIST_LIMIT_EXCEEDED'})]){options.visitLister=async()=>{throw error;};const response=await createDesignHttpHandler(options)(json('/api/design/visit/list',{date:'2026-11-15'}));const text=await response.text();assert(!text.includes('PRIVATE_CUSTOMER_DIAGNOSTIC'));assert.equal(JSON.parse(text).error.code,'OPERATION_REJECTED');}
});

test('changed selected binding returns a fixed refresh signal without source details',async()=>{
 const {options}=fixtures();options.visitResolver=async()=>{throw new ProductionEmployeeError('CUSTOMER_BINDING_CHANGED');};await code(await createDesignHttpHandler(options)(json('/api/design/visit/resolve',{visit:{assignmentSource:'appointment',visitId:'booking:101'},expectedBindingRevision:'binding:1'})),'CUSTOMER_BINDING_CHANGED',409);
});

 test('completion comparison accepts only exact server media references and requires adapter',async()=>{
 const {options}=fixtures();let received;options.candidateService={compare:async input=>{received=input;return {candidate:{synthetic:true}};}};
 const payload={scope,requestId:'compare-1',beforeMediaId:'before-1',afterMediaId:'after-1',approval:'synthetic'};const handler=createDesignHttpHandler(options);
 const response=await handler(json('/api/design/candidate/compare',payload));assert.equal(response.status,200);assert.deepEqual(received,{...payload,credential});assert.equal(response.headers.get('cache-control'),'no-store');
 for(const key of ['session','model','bytes','url','actor','candidate'])await code(await handler(json('/api/design/candidate/compare',{...payload,[key]:'forged'})),'INVALID_FIELDS',400);
 options.candidateService={};await code(await createDesignHttpHandler(options)(json('/api/design/candidate/compare',payload)),'CANDIDATE_ADAPTER_REQUIRED',503);
});

test('three-view synthesis accepts explicit side only, never client evidence or photos',async()=>{
 const {options}=fixtures();let received;options.candidateService={synthesize:async input=>{received=input;return {candidate:{synthetic:true}};}};const payload={scope,requestId:'synthesis-1',side:'left'},handler=createDesignHttpHandler(options);
 assert.equal((await handler(json('/api/design/candidate/synthesize',payload))).status,200);assert.deepEqual(received,{...payload,credential});
 for(const key of ['session','evidence','media','model','candidate','missingAngles','assessment','actor'])await code(await handler(json('/api/design/candidate/synthesize',{...payload,[key]:'forged'})),'INVALID_FIELDS',400);
 for(const side of ['both','side','front',null])await code(await handler(json('/api/design/candidate/synthesize',{...payload,side})),'INVALID_COMPARISON_SIDE',400);
 options.candidateService={};await code(await createDesignHttpHandler(options)(json('/api/design/candidate/synthesize',payload)),'CANDIDATE_ADAPTER_REQUIRED',503);
});
