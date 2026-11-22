/** Synthetic protocol tests ONLY. No fixture is a real decoded image, no test
 * certifies vendor EXIF removal, color, geometry, provenance or native isolation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 createManagedImageVerification,ManagedImageVerificationError,
 validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport,
 MANAGED_IMAGE_BINARY_RESULT_SCHEMA
} from '../packages/design-production-adapter/managed-image-verification.mjs';
import {managedImageDigest as digest,createManagedImageCandidate} from '../packages/design-production-adapter/managed-image-contracts.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const hash=b=>createHash('sha256').update(b).digest('hex'),clone=structuredClone;
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const authority=()=>({schemaVersion:'design-immutable-authority-v1',subjectId:'subject-1',employmentId:'employment-1',membershipId:'membership-1',securityEpoch:1,membershipRevision:1,storeId:'store-1',actor:{username:'synthetic-alias',store:'Synthetic Store'},scope:{...scope},bindingRevision:'binding-1'});
const verifier={id:'synthetic-protocol-verifier',version:'mock-1'},policyVersion='synthetic-policy-1';
const names=['sourceBinding','fullDecode','metadataRemoval','orientation','color','geometry'];
const checks=(value='verified')=>Object.fromEntries(names.map(k=>[k,value]));
function fixture({maxEdge=1024,mime='image/jpeg',width=3000,height=2000,sourceBytes=Buffer.from('synthetic original Exif GPS ICC'),derivativeBytes=Buffer.from('synthetic unchanged hosted output')}={}){
 const sourceRecord={schemaVersion:'design-managed-image-source-v1',mediaId:'media-1',requestId:'upload-1',owner:authority(),object:{projectOrigin:'https://syntheticproject00001.supabase.co',bucket:'customer-design-photos',key:'11/quarantine/media-1',version:'source-1'},source:{sha256:hash(sourceBytes),byteLength:sourceBytes.length,mime},stage:'before',angle:'front',state:'quarantined',validation:'not_performed',publicEligible:false};
 const declaration={authority:sourceRecord.owner,mediaId:sourceRecord.mediaId,projectOrigin:sourceRecord.object.projectOrigin,bucket:sourceRecord.object.bucket,objectKey:sourceRecord.object.key,objectVersion:sourceRecord.object.version,expectedSourceSha256:sourceRecord.source.sha256,mime,byteLength:sourceBytes.length,width,height,orientation:'confirmed',immutable:true,active:true};
 const scale=Math.min(1,maxEdge/Math.max(width,height)),response={schemaVersion:'design-managed-image-response-v1',sourceRecordDigest:digest(sourceRecord),descriptor:{schemaVersion:'design-managed-image-transform-v1',state:'pending_validation',requestId:'transform-1',mediaId:'media-1',source:{bindingDigest:digest(declaration),objectVersion:'source-1',expectedSourceSha256:sourceRecord.source.sha256,mime,byteLength:sourceBytes.length,width,height,orientation:'confirmed'},requestedTransform:{maxEdge,width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),resize:'contain',format:'origin',quality:80},derivative:{sha256:hash(derivativeBytes),byteLength:derivativeBytes.length,mime},validation:{sourceBytes:'not_verified',immutableObject:'trusted_resolver_assertion',derivativeSource:'not_verified',fullDecode:'not_verified',metadataRemoval:'not_verified',orientation:'not_verified',color:'not_verified',geometry:'not_verified',candidateEligible:false,publicEligible:false}}};
 const objectReceipt={schemaVersion:'design-managed-derived-object-v1',responseDigest:digest(response),object:{...sourceRecord.object,key:'managed-derived/'+digest(response)+'/object',version:'derived-1'},derivative:clone(response.descriptor.derivative),private:true,readbackVerified:true};
 const inputs={sourceRecord,response,objectReceipt,sourceBytes,derivativeBytes};
 const request={credential:'synthetic-current-credential',scope:{...scope},mediaId:'media-1',requestId:'transform-1'};
 const result=q=>({schemaVersion:MANAGED_IMAGE_BINARY_RESULT_SCHEMA,bindingDigest:digest(q.binding),verifier:clone(verifier),policyVersion,source:{...sourceRecord.source,frameCount:1,displayWidth:width,displayHeight:height},derivative:{...response.descriptor.derivative,frameCount:1,width:response.descriptor.requestedTransform.width,height:response.descriptor.requestedTransform.height},checks:checks()});
 const ctx={sourceRecord,response,objectReceipt};
 let reads=0,runs=0;const guards=[],seen=[];
 const options={enabled:true,verifier,policyVersion,timeoutMs:500,readInputs:()=>{reads++;return inputs;},finalGuard:q=>{guards.push(q);return true;},runtime:{verifyBinary:q=>{runs++;seen.push(q);return result(q);}}};
 return {inputs,request,result,ctx,options,guards,seen,counts:()=>({reads,runs}),make:patch=>createManagedImageVerification({...options,...patch})};
}
const reject=async(fn,code)=>assert.rejects(fn,e=>e instanceof ManagedImageVerificationError&&(!code||e.code===code)&&e.message===e.code&&e.retryable===false);
const throws=(fn,code)=>assert.throws(fn,e=>e instanceof ManagedImageVerificationError&&(!code||e.code===code)&&e.message===e.code);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function frozen(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(frozen);}}

test('default disabled and absent/unqualified runtime never reads bytes or runs',async()=>{
 const f=fixture();for(const patch of [{enabled:false},{runtime:undefined},{runtime:{}},{timeoutMs:0},{timeoutMs:30001},{verifier:{id:'',version:'1'}},{policyVersion:'https://untrusted.invalid'}])await reject(()=>f.make(patch).verify(f.request),'MANAGED_VERIFICATION_DISABLED');assert.deepEqual(f.counts(),{reads:0,runs:0});
});
test('fixed server configuration is snapshotted; runtime accessor/Proxy cannot install code',async()=>{
 let traps=0;const f=fixture(),runtime={get verifyBinary(){traps++;return ()=>{};}};await reject(()=>f.make({runtime}).verify(f.request),'MANAGED_VERIFICATION_DISABLED');await reject(()=>f.make({runtime:new Proxy({}, {getOwnPropertyDescriptor(){traps++;}})}).verify(f.request),'MANAGED_VERIFICATION_DISABLED');assert.equal(traps,0);
 const v=clone(verifier),api=f.make({verifier:v});v.id='changed';assert.equal((await api.verify(f.request)).verificationBinding.verifier.id,verifier.id);
});
test('complete synthetic protocol binds real byte hashes/object versions but grants no rights',async()=>{
 const f=fixture(),before=clone(f.inputs),out=await f.make().verify(f.request);assert.equal(out.state,'evidence_complete');frozen(out);assert.equal(out.verificationBinding.sourceSha256,hash(f.inputs.sourceBytes));assert.equal(out.verificationBinding.derivativeSha256,hash(f.inputs.derivativeBytes));assert.equal(out.verificationBinding.objectReceiptDigest,digest(f.inputs.objectReceipt));assert.equal(out.verificationBinding.sourceObjectVersion,'source-1');assert.equal(out.verificationBinding.derivativeObjectVersion,'derived-1');assert.deepEqual(f.guards.map(q=>q.phase),['before_verification','after_verification']);
 assert.equal(out.submissionAuthorized,false);assert.equal(out.adoptionAuthorized,false);assert.equal(out.publicEligible,false);assert(!JSON.stringify(out).includes(f.request.credential));assert(!JSON.stringify(out).includes('Exif GPS'));assert(!('decoded' in out));assert.deepEqual(clone(f.inputs),before);assert(f.seen[0].sourceBytes.every(x=>x===0));assert(f.seen[0].derivativeBytes.every(x=>x===0));
 assert.deepEqual(validateManagedImageVerificationReport(out,f.ctx),out);const c=createManagedImageCandidate({sourceRecord:f.inputs.sourceRecord,response:f.inputs.response,evidence:out.evidence});assert.equal(c.technicalStatus,'evidence_complete');assert.equal(c.submissionAuthorized,false);
});
test('runtime receives no bearer, storage path, URL or mutable configuration',async()=>{
 const f=fixture();await f.make().verify(f.request);const q=f.seen[0];assert.deepEqual(Object.keys(q).sort(),['binding','derivativeBytes','expected','limits','sourceBytes']);for(const k of ['binding','expected','limits'])frozen(q[k]);assert(!JSON.stringify({binding:q.binding,expected:q.expected,limits:q.limits}).includes('supabase'));assert(!JSON.stringify(q.binding).includes('credential'));assert.equal(q.expected.transform.resize,'contain');assert.equal(q.expected.transform.format,'origin');assert.equal(q.limits.maximumSourceBytes,8*1024*1024);assert.equal(q.limits.maximumFrames,1);
});
test('all six unknown/failed checks retain distinct pending/failed state and no evidence',async()=>{
 for(const name of names)for(const value of ['unknown','failed']){const f=fixture();const out=await f.make({runtime:{verifyBinary:q=>{const r=f.result(q);r.checks[name]=value;return r;}}}).verify(f.request);assert.equal(out.state,value==='unknown'?'pending_validation':'validation_failed');assert.equal(out.evidence,null);assert.equal(out.submissionAuthorized,false);assert.deepEqual(validateManagedImageVerificationReport(out,f.ctx),out);}
});
test('all-unknown with null measurements stays pending and never means decoded',async()=>{
 const f=fixture(),out=await f.make({runtime:{verifyBinary:q=>{const r=f.result(q);r.checks=checks('unknown');Object.assign(r.source,{frameCount:null,displayWidth:null,displayHeight:null});Object.assign(r.derivative,{frameCount:null,width:null,height:null});return r;}}}).verify(f.request);assert.equal(out.state,'pending_validation');assert.equal(out.evidence,null);
});
test('synthetic EXIF/GPS/color/orientation bytes are not falsely stripped or certified',async()=>{
 const bytes=Buffer.from('Exif GPS ICC orientation=6 partial-decode synthetic'),f=fixture({derivativeBytes:bytes});let observed;
 const out=await f.make({runtime:{verifyBinary:q=>{observed=Buffer.from(q.derivativeBytes);const r=f.result(q);r.checks={sourceBinding:'unknown',fullDecode:'failed',metadataRemoval:'failed',orientation:'unknown',color:'unknown',geometry:'unknown'};return r;}}}).verify(f.request);assert.deepEqual(observed,bytes);assert.deepEqual(f.inputs.derivativeBytes,bytes);assert.equal(out.state,'validation_failed');assert.equal(out.evidence,null);assert(!JSON.stringify(out).includes('Exif GPS'));
});
test('actual original and derivative hash/length mismatch reject before runtime',async()=>{
 for(const key of ['sourceBytes','derivativeBytes']){const f=fixture();f.inputs[key]=Buffer.from('wrong actual bytes');await reject(()=>f.make().verify(f.request),'MANAGED_VERIFICATION_BINDING_MISMATCH');assert.equal(f.counts().runs,0);}
});
test('private receipt binds response, original owner storage, version and exact MIME/hash',()=>{
 const f=fixture();frozen(validateManagedDerivedObjectReceipt(f.inputs.objectReceipt,{sourceRecord:f.ctx.sourceRecord,response:f.ctx.response}));
 for(const alter of [o=>o.private=false,o=>o.readbackVerified=false,o=>o.responseDigest='a'.repeat(64),o=>o.object.key=f.inputs.sourceRecord.object.key,o=>o.object.projectOrigin='https://otherproject.supabase.co',o=>o.object.bucket='other',o=>o.object.version='https://bad',o=>o.derivative.mime='image/png',o=>o.derivative.byteLength++,o=>o.extra=true]){const o=clone(f.inputs.objectReceipt);alter(o);throws(()=>validateManagedDerivedObjectReceipt(o,{sourceRecord:f.ctx.sourceRecord,response:f.ctx.response}));}
});
test('request scope, media and transform request cannot substitute another private input',async()=>{
 for(const patch of [{mediaId:'other'},{requestId:'other'},{scope:{...scope,customerProfileId:'12'}}]){const f=fixture();await reject(()=>f.make().verify({...f.request,...patch}),'MANAGED_VERIFICATION_BINDING_MISMATCH');assert.equal(f.counts().runs,0);}
});
test('original max remains 8MiB and derivative uses 1024/1536 JPEG/PNG/WebP exact provisional budget',async()=>{
 for(const maxEdge of [1024,1536])for(const mime of ['image/jpeg','image/png','image/webp']){const cap=maxEdge===1024?262144:524288,f=fixture({maxEdge,mime,derivativeBytes:Buffer.alloc(cap,7)});assert.equal((await f.make().verify(f.request)).state,'evidence_complete');assert.equal(f.seen[0].limits.maximumDerivativeBytes,cap);const over=fixture({maxEdge,mime,derivativeBytes:Buffer.alloc(cap+1,7)});await reject(()=>over.make().verify(over.request),'MANAGED_VERIFICATION_BUDGET_EXCEEDED');assert.equal(over.counts().runs,0);}
 const f=fixture();f.inputs.sourceBytes=Buffer.alloc(8*1024*1024+1);await reject(()=>f.make().verify(f.request),'MANAGED_VERIFICATION_BUDGET_EXCEEDED');
});
test('no upscale and portrait display geometry are strict; no silent rounding acceptance',async()=>{
 for(const [width,height,maxEdge] of [[100,200,1024],[2000,3000,1536]]){const f=fixture({width,height,maxEdge});assert.equal((await f.make().verify(f.request)).state,'evidence_complete');assert(f.seen[0].expected.transform.width<=width);assert(f.seen[0].expected.transform.height<=height);}
 const f=fixture();await reject(()=>f.make({runtime:{verifyBinary:q=>{const r=f.result(q);r.derivative.height++;return r;}}}).verify(f.request),'MANAGED_VERIFICATION_RUNTIME_INVALID');
});
test('full decode cannot be asserted for animation, omitted dimensions or over-pixel source',async()=>{
 for(const alter of [r=>r.source.frameCount=2,r=>r.derivative.frameCount=2,r=>r.source.displayWidth=null,r=>r.derivative.height=null,r=>{r.source.displayWidth=10000;r.source.displayHeight=10000;}]){const f=fixture();await reject(()=>f.make({runtime:{verifyBinary:q=>{const r=f.result(q);alter(r);return r;}}}).verify(f.request),'MANAGED_VERIFICATION_RUNTIME_INVALID');}
});
test('source display orientation mismatch does not become verified',async()=>{
 const f=fixture();await reject(()=>f.make({runtime:{verifyBinary:q=>{const r=f.result(q);[r.source.displayWidth,r.source.displayHeight]=[r.source.displayHeight,r.source.displayWidth];return r;}}}).verify(f.request),'MANAGED_VERIFICATION_RUNTIME_INVALID');
});
test('fixed result binding/verifier/version/policy/hash/keys reject substitution',async()=>{
 for(const alter of [r=>r.bindingDigest='a'.repeat(64),r=>r.verifier.id='other',r=>r.verifier.version='other',r=>r.policyVersion='other',r=>r.source.sha256='a'.repeat(64),r=>r.derivative.byteLength++,r=>r.schemaVersion='old',r=>r.extra=true,r=>r.checks.metadataRemoval=true]){const f=fixture();await reject(()=>f.make({runtime:{verifyBinary:q=>{const r=f.result(q);alter(r);return r;}}}).verify(f.request));}
});
test('report is exact and cannot move evidence to another derivative object or version',async()=>{
 const f=fixture(),out=await f.make().verify(f.request);for(const alter of [o=>o.verificationBinding.objectReceiptDigest='a'.repeat(64),o=>o.verificationBinding.derivativeObjectVersion='v2',o=>o.verificationBinding.sourceObjectVersion='v2',o=>o.verificationBinding.mediaId='other',o=>o.evidence.id='other',o=>o.evidence.checks.geometry='unknown',o=>o.submissionAuthorized=true,o=>o.adoptionAuthorized=true,o=>o.publicEligible=true,o=>o.extra=true,o=>o.state='pending_validation']){const changed=clone(out);alter(changed);throws(()=>validateManagedImageVerificationReport(changed,f.ctx));}
 const receipt=clone(f.inputs.objectReceipt);receipt.object.version='derived-2';throws(()=>validateManagedImageVerificationReport(out,{...f.ctx,objectReceipt:receipt}),'MANAGED_VERIFICATION_BINDING_MISMATCH');
});
test('noncomplete report cannot contain complete or partial evidence',async()=>{
 const f=fixture(),complete=await f.make().verify(f.request);const bad=clone(complete);bad.checks.geometry='unknown';bad.state='pending_validation';throws(()=>validateManagedImageVerificationReport(bad,f.ctx));
});
test('getters/Proxy/custom prototypes in inputs and callback metadata execute zero traps',async()=>{
 let calls=0;const f=fixture(),q={...f.request};Object.defineProperty(q,'mediaId',{enumerable:true,get(){calls++;return 'media-1';}});await reject(()=>f.make().verify(q));await reject(()=>f.make().verify(new Proxy(f.request,{ownKeys(){calls++;return [];}})));
 const r=clone(f.inputs.response);Object.defineProperty(r.descriptor,'mediaId',{enumerable:true,get(){calls++;return 'media-1';}});await reject(()=>f.make({readInputs:()=>({...f.inputs,response:r})}).verify(f.request));await reject(()=>f.make({readInputs:()=>new Proxy(f.inputs,{ownKeys(){calls++;return [];}})}).verify(f.request));assert.equal(calls,0);
});
test('byte copying ignores custom accessors and rejects shared/proxy buffers',async()=>{
 let getters=0;const f=fixture(),bytes=Buffer.from(f.inputs.sourceBytes);Object.defineProperty(bytes,'buffer',{get(){getters++;throw Error('secret');}});Object.defineProperty(bytes,'byteLength',{get(){getters++;throw Error('secret');}});f.inputs.sourceBytes=bytes;assert.equal((await f.make().verify(f.request)).state,'evidence_complete');assert.equal(getters,0);
 for(const b of [new Uint8Array(new SharedArrayBuffer(16)),new Proxy(new Uint8Array(16),{})]){const g=fixture();g.inputs.sourceBytes=b;await reject(()=>g.make().verify(g.request));assert.equal(g.counts().runs,0);}
});
test('runtime cannot mutate owned bytes then assert the old SHA',async()=>{
 const f=fixture();await reject(()=>f.make({runtime:{verifyBinary:q=>{q.derivativeBytes[0]^=1;return f.result(q);}}}).verify(f.request),'MANAGED_VERIFICATION_BINDING_MISMATCH');assert.equal(f.inputs.derivativeBytes.toString(),'synthetic unchanged hosted output');
});
test('runtime held bytes changed during final guard are rehashed before delivery',async()=>{
 const f=fixture();let bytes;await reject(()=>f.make({runtime:{verifyBinary:q=>{bytes=q.sourceBytes;return f.result(q);}},finalGuard:q=>{if(q.phase==='after_verification')bytes[0]^=1;return true;}}).verify(f.request),'MANAGED_VERIFICATION_BINDING_MISMATCH');
});
test('composite denial after private read prevents runtime',async()=>{
 const f=fixture();await reject(()=>f.make({finalGuard:()=>false}).verify(f.request),'MANAGED_VERIFICATION_DENIED');assert.deepEqual(f.counts(),{reads:1,runs:0});
});
test('revocation during private read is seen by last composite gate',async()=>{
 const f=fixture(),wait=deferred();let active=true;const api=f.make({readInputs:async()=>{await wait.promise;return f.inputs;},finalGuard:()=>active}),p=api.verify(f.request);active=false;wait.resolve();await reject(()=>p,'MANAGED_VERIFICATION_DENIED');assert.equal(f.counts().runs,0);
});
test('revocation during runtime prevents report/evidence delivery',async()=>{
 const f=fixture(),wait=deferred(),entered=deferred();let active=true;const api=f.make({finalGuard:()=>active,runtime:{verifyBinary:async q=>{entered.resolve();await wait.promise;return f.result(q);}}}),p=api.verify(f.request);await entered.promise;active=false;wait.resolve();await reject(()=>p,'MANAGED_VERIFICATION_DENIED');
});
test('timeout covers private read, retains admission until late read settles, no runtime retry',async()=>{
 const f=fixture(),wait=deferred(),api=f.make({timeoutMs:20,readInputs:()=>wait.promise});await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_TIMEOUT');await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_BUSY');wait.resolve(f.inputs);await tick();assert.equal(f.counts().runs,0);
});
test('late runtime after deadline never publishes, retains owned bytes/admission until settled',async()=>{
 const f=fixture(),wait=deferred(),entered=deferred();let seen,runs=0;const api=f.make({timeoutMs:25,runtime:{verifyBinary:async q=>{runs++;seen=q;entered.resolve();await wait.promise;return f.result(q);}}});const p=api.verify(f.request);await entered.promise;await reject(()=>p,'MANAGED_VERIFICATION_TIMEOUT');assert(seen.sourceBytes.some(x=>x!==0));await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_BUSY');wait.resolve();await tick();assert(seen.sourceBytes.every(x=>x===0));assert(seen.derivativeBytes.every(x=>x===0));assert.equal(runs,1);assert.equal(f.guards.length,1);
});
test('pre-abort calls no reader, and mid-runtime abort has no late report',async()=>{
 const f=fixture(),a=new AbortController();a.abort();await reject(()=>f.make().verify({...f.request,signal:a.signal}),'MANAGED_VERIFICATION_ABORTED');assert.equal(f.counts().reads,0);
 const wait=deferred(),entered=deferred(),b=new AbortController(),api=f.make({runtime:{verifyBinary:async q=>{entered.resolve();await wait.promise;return f.result(q);}}}),p=api.verify({...f.request,signal:b.signal});await entered.promise;b.abort();await reject(()=>p,'MANAGED_VERIFICATION_ABORTED');wait.resolve();await tick();assert.equal(f.guards.length,1);
});
test('deadline includes final composite guard, no report after late allow',async()=>{
 const f=fixture(),wait=deferred(),api=f.make({timeoutMs:20,finalGuard:q=>q.phase==='after_verification'?wait.promise:true});await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_TIMEOUT');await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_BUSY');wait.resolve(true);await tick();
});
test('single concurrent verification rejected; settled instance can be used explicitly again',async()=>{
 const f=fixture(),wait=deferred(),api=f.make({readInputs:()=>wait.promise}),p=api.verify(f.request);await reject(()=>api.verify(f.request),'MANAGED_VERIFICATION_BUSY');wait.resolve(f.inputs);assert.equal((await p).state,'evidence_complete');assert.equal((await api.verify(f.request)).state,'evidence_complete');assert.equal(f.counts().runs,2);
});
test('dependency errors/mutated exported errors never disclose messages or execute error getters',async()=>{
 const f=fixture();for(const e of [Error('SECRET_STORAGE_KEY'),Object.assign(new ManagedImageVerificationError('MANAGED_VERIFICATION_DENIED'),{code:'SECRET',message:'SECRET',extra:'SECRET'})]){await assert.rejects(()=>f.make({readInputs:()=>{throw e;}}).verify(f.request),x=>x instanceof ManagedImageVerificationError&&!JSON.stringify(x).includes('SECRET')&&x.message===x.code);}
 let reads=0;const e=new ManagedImageVerificationError('MANAGED_VERIFICATION_DENIED');Object.defineProperty(e,'code',{get(){reads++;return 'SECRET';}});await reject(()=>f.make({readInputs:()=>{throw e;}}).verify(f.request),'MANAGED_VERIFICATION_UNAVAILABLE');assert.equal(reads,0);
});
test('malformed/cross-realm rejected async result is handled, not an unhandled rejection',async()=>{
 const {runInNewContext}=await import('node:vm'),f=fixture();await reject(()=>f.make({runtime:{verifyBinary:()=>runInNewContext('Promise.reject(new Error("SECRET"))')}}).verify(f.request),'MANAGED_VERIFICATION_UNAVAILABLE');await tick();
});
