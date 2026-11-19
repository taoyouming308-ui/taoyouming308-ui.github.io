/** Independent synthetic pure schemas; these tests do not verify real images. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 MANAGED_IMAGE_SOURCE_SCHEMA,MANAGED_IMAGE_PREFLIGHT_SCHEMA,MANAGED_IMAGE_RESPONSE_SCHEMA,MANAGED_IMAGE_EVIDENCE_SCHEMA,MANAGED_IMAGE_CANDIDATE_SCHEMA,MANAGED_IMAGE_CANDIDATE_BUDGETS,
 ManagedImageContractError,managedImageCanonical,managedImageDigest,validateManagedImageSourceRecord as source,
 validateManagedImagePreflight as preflight,validateManagedImageResponse as response,validateManagedImageVerificationEvidence as evidence,
 createManagedImageCandidate as build,validateManagedImageCandidate as candidate
} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {createManagedImageTransform} from '../packages/design-production-adapter/managed-image-transform.mjs';
import {validateDesignCandidate} from '../packages/analysis-engine/design-candidate.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=v=>structuredClone(v),digest=managedImageDigest;
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const authority=()=>({schemaVersion:'design-immutable-authority-v1',subjectId:'subject-1',employmentId:'employment-1',membershipId:'membership-1',securityEpoch:1,membershipRevision:1,storeId:'store-1',actor:{username:'synthetic-alias',store:'Synthetic Store'},scope:{...scope},bindingRevision:'binding-1'});
const makeSource=()=>({schemaVersion:MANAGED_IMAGE_SOURCE_SCHEMA,mediaId:'media-1',requestId:'upload-1',owner:authority(),object:{projectOrigin:'https://syntheticproject00001.supabase.co',bucket:'customer-design-photos',key:'11/quarantine/media-1.jpg',version:'version-1'},source:{sha256:'a'.repeat(64),byteLength:1024,mime:'image/jpeg'},stage:'before',angle:'front',state:'quarantined',validation:'not_performed',publicEligible:false});
const declaration=(s,width=3000,height=2000)=>({authority:clone(s.owner),mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width,height,orientation:'confirmed',immutable:true,active:true});
function makeResponse(s=makeSource(),maxEdge=1024){const d=declaration(s),scale=Math.min(1,maxEdge/Math.max(d.width,d.height));return {schemaVersion:MANAGED_IMAGE_RESPONSE_SCHEMA,sourceRecordDigest:digest(s),descriptor:{schemaVersion:'design-managed-image-transform-v1',state:'pending_validation',requestId:'transform-1',mediaId:s.mediaId,source:{bindingDigest:digest(d),objectVersion:d.objectVersion,expectedSourceSha256:d.expectedSourceSha256,mime:d.mime,byteLength:d.byteLength,width:d.width,height:d.height,orientation:'confirmed'},requestedTransform:{maxEdge,width:Math.floor(d.width*scale),height:Math.floor(d.height*scale),resize:'contain',format:'origin',quality:80},derivative:{sha256:'b'.repeat(64),byteLength:100000,mime:s.source.mime},validation:{sourceBytes:'not_verified',immutableObject:'trusted_resolver_assertion',derivativeSource:'not_verified',fullDecode:'not_verified',metadataRemoval:'not_verified',orientation:'not_verified',color:'not_verified',geometry:'not_verified',candidateEligible:false,publicEligible:false}}};}
const makePreflight=s=>({schemaVersion:MANAGED_IMAGE_PREFLIGHT_SCHEMA,id:'preflight-1',sourceRecordDigest:digest(s),sourceVersion:s.object.version,verifiedSourceSha256:s.source.sha256,verifier:{id:'synthetic-validator',version:'fixture-v1'},display:{width:3000,height:2000},checks:{sourceBinding:'verified',orientation:'verified',displayDimensions:'verified'}});
const makeEvidence=(s,r)=>({schemaVersion:MANAGED_IMAGE_EVIDENCE_SCHEMA,id:'verification-1',sourceRecordDigest:digest(s),responseDigest:digest(r),transformDigest:digest(r.descriptor.requestedTransform),verifiedSourceSha256:s.source.sha256,verifiedDerivativeSha256:r.descriptor.derivative.sha256,verifier:{id:'synthetic-verifier',version:'fixture-v1'},checks:{sourceBinding:'verified',fullDecode:'verified',metadataRemoval:'verified',orientation:'verified',color:'verified',geometry:'verified'}});
const fixture=()=>{const s=makeSource(),r=makeResponse(s),e=makeEvidence(s,r);return {s,r,e,context:{sourceRecord:s,response:r}};};
function rejects(fn,code){assert.throws(fn,e=>e instanceof ManagedImageContractError&&(!code||e.code===code)&&e.message===e.code&&e.retryable===false);}
function frozen(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(frozen);}}
test('quarantined source keeps declared MIME, no dimensions, no decoded/public assertion',()=>{
 const s=makeSource(),r=source(s);assert.deepEqual(r,s);assert.notEqual(r,s);frozen(r);s.owner.securityEpoch=2;assert.equal(r.owner.securityEpoch,1);assert.equal(r.state,'quarantined');assert.equal(r.validation,'not_performed');assert.equal(r.publicEligible,false);assert(!('decoded' in r));assert(!('width' in r));assert(!('height' in r));
});
test('source exact keys reject silent conversion from legacy/public/decoded schemas',()=>{
 for(const patch of [{decoded:true},{decoded:false},{width:3000},{height:2000},{metadataRemoved:true},{active:true},{state:'published'},{validation:'verified'},{publicEligible:true},{schemaVersion:'private-media-v1'}])rejects(()=>source({...makeSource(),...patch}));
 for(const k of Object.keys(makeSource())){const s=makeSource();delete s[k];rejects(()=>source(s));}
});
test('source IDs/stage/angle and immutable authority are bounded rather than alias-only',()=>{
 for(const patch of [{mediaId:''},{requestId:'a'.repeat(101)},{mediaId:'https://example.invalid'},{stage:'unknown'},{angle:'three_quarter'}])rejects(()=>source({...makeSource(),...patch}));
 const s=makeSource();s.owner={username:'synthetic-alias',store:'Synthetic Store'};rejects(()=>source(s));
 for(const stage of ['before','after','reference'])for(const angle of ['front','back','left','right','detail'])assert.equal(source({...makeSource(),stage,angle}).angle,angle);
});
test('object location accepts only bounded server metadata, never URLs/tokens in key or version',()=>{
 for(const patch of [{projectOrigin:'https://other.invalid'},{projectOrigin:'http://syntheticproject00001.supabase.co'},{projectOrigin:'https://user@syntheticproject00001.supabase.co'},{projectOrigin:'https://syntheticproject00001.supabase.co/'},{bucket:'public/path'},{key:'../secret'},{key:'x//a'},{key:'x/%2e%2e/a'},{key:'x?token=secret'},{version:'https://secret.invalid'}]){const s=makeSource();Object.assign(s.object,patch);rejects(()=>source(s));}
});
test('source original limit remains exactly 8MiB with JPEG/PNG/WebP declaration only',()=>{
 for(const mime of ['image/jpeg','image/png','image/webp']){const s=makeSource();s.source={...s.source,mime,byteLength:8*1024*1024};assert.equal(source(s).source.byteLength,8*1024*1024);}
 for(const patch of [{byteLength:0},{byteLength:8*1024*1024+1},{byteLength:1.5},{mime:'image/svg+xml'},{mime:'image/jpg'},{sha256:'A'.repeat(64)}]){const s=makeSource();Object.assign(s.source,patch);rejects(()=>source(s));}
});
test('canonical/hash helper sorts complete content and never uses jsonb text formatting',()=>{
 const a={b:2,a:{z:1,y:'合成'}},b={a:{y:'合成',z:1},b:2};assert.equal(managedImageCanonical(a),'{"a":{"y":"合成","z":1},"b":2}');assert.equal(digest(a),digest(b));assert.equal(digest(a),createHash('sha256').update(managedImageCanonical(a)).digest('hex'));assert.notEqual(digest(a),digest({...a,b:3}));
 for(const number of [-0,1.1,NaN,Infinity,2**53])rejects(()=>digest({number}));
});
test('getters/Proxy/toJSON/custom prototypes cannot execute or alternate validation data',()=>{
 let calls=0;const s=makeSource();Object.defineProperty(s.source,'sha256',{enumerable:true,get(){calls++;return 'a'.repeat(64);}});rejects(()=>source(s));
 rejects(()=>source(new Proxy(makeSource(),{get(){calls++;throw Error('secret');},ownKeys(){calls++;throw Error('secret');}})));
 const t=makeSource();Object.setPrototypeOf(t.object,{toJSON(){calls++;return {};}});rejects(()=>source(t));assert.equal(calls,0);
});
test('metadata budget, cycles, symbols, hidden fields and non-JSON types reject safely',()=>{
 for(const bad of [undefined,()=>{},new Date(),new Uint8Array([1]),{value:'x'.repeat(8193)},{a:1n}])rejects(()=>digest(bad));
 const cyclic={};cyclic.self=cyclic;rejects(()=>digest(cyclic));const symbolic={};symbolic[Symbol('secret')]=1;rejects(()=>digest(symbolic));const hidden={};Object.defineProperty(hidden,'x',{value:1});rejects(()=>digest(hidden));
 const many=Array.from({length:257},()=>1);rejects(()=>digest(many));
});
test('preflight is exact source/version/hash-bound declaration, source remains quarantined',()=>{
 const s=makeSource(),before=JSON.stringify(s),p=preflight(makePreflight(s),s);frozen(p);assert.equal(JSON.stringify(s),before);assert.equal(source(s).validation,'not_performed');assert(!('fullDecode' in p.checks));assert(!('decoded' in p));
});
test('preflight refuses unknown/failed orientation, guessed display dimensions and wrong source bytes',()=>{
 const s=makeSource();for(const key of ['sourceBinding','orientation','displayDimensions'])for(const state of ['unknown','failed',true]){const p=makePreflight(s);p.checks[key]=state;rejects(()=>preflight(p,s));}
 for(const patch of [{sourceRecordDigest:'c'.repeat(64)},{sourceVersion:'version-2'},{verifiedSourceSha256:'d'.repeat(64)}])rejects(()=>preflight({...makePreflight(s),...patch},s),'MANAGED_IMAGE_BINDING_MISMATCH');
 for(const display of [{width:0,height:1},{width:16385,height:1},{width:10000,height:10000},{width:1.5,height:1}])rejects(()=>preflight({...makePreflight(s),display},s));
});
test('source upload request and transform request are different but media identity is exact',()=>{
 const {s,r}=fixture(),out=response(r,s);assert.equal(out.descriptor.mediaId,s.mediaId);assert.notEqual(out.descriptor.requestId,s.requestId);frozen(out);
 const bad=clone(r);bad.descriptor.mediaId='other-media';rejects(()=>response(bad,s));
});
test('response binding includes full immutable owner, object version, original expected hash',()=>{
 const {s,r}=fixture();for(const mutate of [x=>x.owner.subjectId='same-alias-replacement',x=>x.owner.securityEpoch++,x=>x.owner.bindingRevision='binding-2',x=>x.object.key='another/object.jpg',x=>x.object.version='version-2',x=>x.source.sha256='c'.repeat(64)]){const changed=clone(s);mutate(changed);const wrap={...r,sourceRecordDigest:digest(changed)};rejects(()=>response(wrap,changed),'MANAGED_IMAGE_BINDING_MISMATCH');}
});
test('response retains Stage26 expected-not-verified semantics and cannot certify itself',()=>{
 const {s,r}=fixture();for(const key of ['sourceBytes','derivativeSource','fullDecode','metadataRemoval','orientation','color','geometry']){const bad=clone(r);bad.descriptor.validation[key]='verified';rejects(()=>response(bad,s));}
 for(const key of ['candidateEligible','publicEligible']){const bad=clone(r);bad.descriptor.validation[key]=true;rejects(()=>response(bad,s));}
 const bad=clone(r);bad.descriptor.source.verifiedSourceSha256=bad.descriptor.source.expectedSourceSha256;rejects(()=>response(bad,s));
});
test('transform parameters bind exact 1024/1536 contain/origin/quality80 and no requested upscale',()=>{
 const s=makeSource();for(const maxEdge of [1024,1536])assert.equal(response(makeResponse(s,maxEdge),s).descriptor.requestedTransform.maxEdge,maxEdge);
 for(const patch of [{maxEdge:2500},{resize:'cover'},{format:'png'},{quality:90},{width:1025},{height:683}]){const r=makeResponse(s);Object.assign(r.descriptor.requestedTransform,patch);rejects(()=>response(r,s));}
 const r=makeResponse(s);r.descriptor.source.width=100;r.descriptor.source.height=200;r.descriptor.source.bindingDigest=digest(declaration(s,100,200));r.descriptor.requestedTransform.width=100;r.descriptor.requestedTransform.height=200;assert.equal(response(r,s).descriptor.requestedTransform.width,100);
});
test('response derivative only allows exact original MIME, positive capped byte count and SHA256',()=>{
 const {s,r}=fixture();for(const patch of [{mime:'image/png'},{byteLength:0},{byteLength:8*1024*1024+1},{sha256:'bad'}]){const v=clone(r);Object.assign(v.descriptor.derivative,patch);rejects(()=>response(v,s));}
});
test('evidence binds all original, response, transform and derivative digest domains',()=>{
 const {s,r,e,context}=fixture();assert.deepEqual(evidence(e,context),e);for(const key of ['sourceRecordDigest','responseDigest','transformDigest','verifiedSourceSha256','verifiedDerivativeSha256'])rejects(()=>evidence({...e,[key]:'e'.repeat(64)},context),'MANAGED_IMAGE_BINDING_MISMATCH');
 const changed=clone(r);changed.descriptor.requestId='other-transform';rejects(()=>evidence(e,{sourceRecord:s,response:changed}),'MANAGED_IMAGE_BINDING_MISMATCH');
});
test('version/parameters change cannot inherit evidence by copying expected hashes',()=>{
 const {s,r,e}=fixture();const source2=clone(s);source2.object.version='version-2';const response2=makeResponse(source2);rejects(()=>evidence(e,{sourceRecord:source2,response:response2}));
 const r2=makeResponse(s,1536);rejects(()=>evidence(e,{sourceRecord:s,response:r2}));
});
test('verification identity/version are explicit and no URL/bearer/self-authorized keys are accepted',()=>{
 const {e,context}=fixture();for(const verifier of [{id:'',version:'1'},{id:'https://verifier.invalid',version:'1'},{id:'v',version:'https://secret.invalid'},{id:'v',version:'1',approved:true}])rejects(()=>evidence({...e,verifier},context));
 rejects(()=>evidence({...e,credential:'bearer'},context));rejects(()=>evidence({...e,trusted:true},context));
});
test('all-unknown evidence is valid pending data but never becomes eligible',()=>{
 const {s,r,e,context}=fixture();Object.keys(e.checks).forEach(k=>e.checks[k]='unknown');e.verifiedSourceSha256=null;e.verifiedDerivativeSha256=null;assert.equal(evidence(e,context).verifiedSourceSha256,null);assert.equal(build({sourceRecord:s,response:r,evidence:e}).technicalStatus,'blocked');assert.equal(build({sourceRecord:s,response:r,evidence:null}).technicalStatus,'blocked');
});
test('each unknown/failed EXIF, decode, orientation, color, geometry or source proof blocks',()=>{
 const {s,r,e}=fixture();for(const key of Object.keys(e.checks))for(const status of ['unknown','failed']){const v=clone(e);v.checks[key]=status;if(key==='sourceBinding')v.verifiedSourceSha256=null;const out=build({sourceRecord:s,response:r,evidence:v});assert.equal(out.technicalStatus,'blocked');assert.equal(out.submissionAuthorized,false);assert.equal(out.publicEligible,false);}
});
test('verified labels cannot omit actual claimed byte hashes or alias expected as verified',()=>{
 const {e,context}=fixture();rejects(()=>evidence({...e,verifiedSourceSha256:null},context));rejects(()=>evidence({...e,verifiedDerivativeSha256:null},context));const unknown=clone(e);unknown.checks.sourceBinding='unknown';rejects(()=>evidence(unknown,context));
 for(const status of [true,'approved','not_verified']){const v=clone(e);v.checks.fullDecode=status;rejects(()=>evidence(v,context));}
});
test('structurally complete evidence yields only evidence_complete, no send/adopt/public authority',()=>{
 const {s,r,e}=fixture(),c=build({sourceRecord:s,response:r,evidence:e});assert.equal(c.schemaVersion,MANAGED_IMAGE_CANDIDATE_SCHEMA);assert.equal(c.technicalStatus,'evidence_complete');assert.equal(c.submissionAuthorized,false);assert.equal(c.adoptionAuthorized,false);assert.equal(c.publicEligible,false);assert.deepEqual(candidate(c),c);frozen(c);assert.equal(c.id,digest({sourceRecord:s,response:r,evidence:e}));
});
test('provisional independent MIME/edge budget exact thresholds reject one extra byte',()=>{
 for(const maxEdge of [1024,1536])for(const m of ['image/jpeg','image/png','image/webp']){const s=makeSource();s.source.mime=m;const r=makeResponse(s,maxEdge),limit=MANAGED_IMAGE_CANDIDATE_BUDGETS[maxEdge][m];assert.equal(limit,maxEdge===1024?262144:524288);r.descriptor.derivative.byteLength=limit;assert.equal(build({sourceRecord:s,response:r,evidence:null}).budget.maximumBytes,limit);r.descriptor.derivative.byteLength++;rejects(()=>build({sourceRecord:s,response:r,evidence:null}),'MANAGED_IMAGE_BUDGET_EXCEEDED');}
});
test('candidate fields are derived and cannot be edited to grant rights or suppress unknowns',()=>{
 const {s,r}=fixture(),c=build({sourceRecord:s,response:r,evidence:null});for(const patch of [{technicalStatus:'evidence_complete'},{submissionAuthorized:true},{adoptionAuthorized:true},{publicEligible:true},{id:'f'.repeat(64)},{decoded:true}])rejects(()=>candidate({...c,...patch}));const b=clone(c);b.budget.maximumBytes++;rejects(()=>candidate(b));
});
test('new input candidate cannot be interpreted as old model output/v3 derivative',()=>{
 const {s,r,e}=fixture(),c=build({sourceRecord:s,response:r,evidence:e});assert.throws(()=>validateDesignCandidate(c,{}));for(const key of ['bytes','metadataRemoved','decoded','entries','model','sourceRefs'])assert(!Object.hasOwn(c,key));assert.notEqual(c.schemaVersion,'design-model-candidate-v1');
});
test('source and response hashes stay unchanged when separate later evidence is attached',()=>{
 const {s,r,e}=fixture(),before=JSON.stringify({s,r}),beforeDigests=[digest(s),digest(r)];const pending=build({sourceRecord:s,response:r,evidence:null}),complete=build({sourceRecord:s,response:r,evidence:e});assert.equal(JSON.stringify({s,r}),before);assert.deepEqual([digest(complete.sourceRecord),digest(complete.response)],beforeDigests);assert.deepEqual(pending.response,complete.response);assert.notEqual(pending.id,complete.id);
});
test('actual Stage26 mock output wraps without upgrading metadata verification or returning bytes',async()=>{
 const s=makeSource(),declared=declaration(s),synthetic=Buffer.concat([Buffer.from([255,216,255]),Buffer.from('Exif GPS ICC synthetic truncated')]);const adapter=createManagedImageTransform({enabled:true,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,timeoutMs:1000,maxResponseBytes:262144,resolveSource:()=>declared,authorize:()=>true,approveCost:()=>true,finalGuard:()=>true,claimAttempt:()=> 'created',transport:req=>({url:req.url,status:200,redirected:false,mime:s.source.mime,body:new ReadableStream({start(c){c.enqueue(synthetic);c.close();}})})});
 const descriptor=await adapter.transform({credential:'synthetic-credential',scope:s.owner.scope,mediaId:s.mediaId,requestId:'transform-1',maxEdge:1024});const r=response({schemaVersion:MANAGED_IMAGE_RESPONSE_SCHEMA,sourceRecordDigest:digest(s),descriptor},s),c=build({sourceRecord:s,response:r,evidence:null});assert.equal(c.technicalStatus,'blocked');assert.equal(c.response.descriptor.validation.metadataRemoval,'not_verified');assert(!JSON.stringify(c).includes('Exif GPS'));assert(!JSON.stringify(c).includes('synthetic-credential'));
});
