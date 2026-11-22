/** Separate SYNTHETIC PINNED-PRODUCER qualification. This is NOT the generic
 * three-object fullDecode report and cannot upgrade one. The customer-lineage
 * source remains JPEG/WebP. A literal runtime PNG fixture is a REFERENCE asset,
 * not that source: source bytes must exactly match its fixed encoder output,
 * and parent bytes must exactly match the next fixed producer invocation.
 * Only the reference and final PNG streams are independently fully decoded.
 * No arbitrary JPEG entropy/VP8 stream-consumption claim is made.
 *
 * All exports are pure structures, not authorization or a signature. A valid
 * self-consistent JSON is not provenance. Only an independently assigned task,
 * current processing claim/access, qualified runtime and independent issuer may
 * turn these structures into a usable synthetic test input. Fresh repository
 * expiry/revocation checks remain required before/after every external wait.
 * No real customer/model submission, adoption or publication is authorized.
 */
import {managedImageCanonical,managedImageDigest} from './managed-image-contracts.mjs';
import {validateClaimedNormalizationArtifact} from './managed-normalization-processing-contracts.mjs';
import {validateManagedNormalizedObjectReceipt,buildManagedNormalizedVerificationBinding} from './managed-normalized-verification-contracts.mjs';
import {SYNTHETIC_CANONICAL_FIXTURE} from './synthetic-canonical-image-fixture.mjs';

const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const copy=v=>JSON.parse(managedImageCanonical(v)),digest=managedImageDigest;
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export class ManagedNormalizedStrictContractError extends Error{constructor(){super('MANAGED_NORMALIZED_STRICT_INVALID');this.name='ManagedNormalizedStrictContractError';this.code=this.message;this.outcome='not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedNormalizedStrictContractError();};
export const MANAGED_NORMALIZED_STRICT_TASK_SCHEMA='design-normalized-strict-task-v1';
export const MANAGED_NORMALIZED_STRICT_BINDING_SCHEMA='design-normalized-strict-binding-v1';
export const MANAGED_NORMALIZED_STRICT_BINARY_SCHEMA='design-normalized-strict-binary-result-v1';
export const MANAGED_NORMALIZED_STRICT_REPORT_SCHEMA='design-normalized-strict-report-v1';
export const MANAGED_NORMALIZED_STRICT_EVIDENCE_SCHEMA='design-normalized-strict-evidence-v1';
export const MANAGED_NORMALIZED_STRICT_INPUT_SCHEMA='design-normalized-strict-input-v1';
export const MANAGED_NORMALIZED_STRICT_VERIFIER=freeze({id:'local-canonical-imgproxy-node',version:'1'});
export const MANAGED_NORMALIZED_STRICT_CHECKS=Object.freeze(['fixturePngComplete','sourceExactFixtureProducerMatch','parentExactProducerMatch','normalizedPngComplete','normalizedPixelsEqual','metadataAbsent','identityOrientation','sameGeometry']);
export const MANAGED_NORMALIZED_STRICT_POLICY=freeze({
 id:'synthetic-pinned-producer-rgb8-v1',version:'1',scope:'synthetic_fixture_only',
 fixture:copy(SYNTHETIC_CANONICAL_FIXTURE),
 producer:{id:'supabase-imgproxy',version:'3.8.0',imageDigest:'sha256:0facd355d50f3be665ebe674486f2b2e9cdaebd3f74404acd9b7fece2f661435',
  environment:{IMGPROXY_AUTO_ROTATE:'true',IMGPROXY_STRIP_METADATA:'true',IMGPROXY_KEEP_COPYRIGHT:'false',IMGPROXY_STRIP_COLOR_PROFILE:'true',IMGPROXY_JPEG_PROGRESSIVE:'false',IMGPROXY_PNG_INTERLACED:'false',IMGPROXY_QUALITY:'80'}},
 sourceEncoder:{resize:'contain',width:80,height:120,enlarge:false,quality:80,format:'source_mime'},
 parentTransform:{resize:'contain',maxEdges:[1024],enlarge:false,quality:80,format:'origin'},
 normalization:{resize:'none',width:80,height:120,quality:80,format:'png',containerNormalization:'remove_pHYs_only',pixelFormat:'rgb8_noninterlaced'},
 decoder:{id:'strict-rgb-png-node',version:'1',runtimeImage:'public.ecr.aws/supabase/storage-api',imageDigest:'sha256:1dbe962d9862ef12e20357f9d7ba5431989c1daf4a556d6cb20ee4efd1c57320',nodeVersion:'24.18.0',zlibVersion:'1.3.1-e00f703',allowedChunks:['IHDR','IDAT','IEND'],pixelFormat:'rgb8_noninterlaced',maximumFrames:1},
 sourceMimeTypes:['image/jpeg','image/webp'],outputMime:'image/png',maximumFrames:1
});

export function validateManagedNormalizedStrictTask(value){try{
 const t=copy(value);exact(t,['schemaVersion','taskId','claimedArtifact','objectReceipt','fixtureId','verifier','policy']);
 if(t.schemaVersion!==MANAGED_NORMALIZED_STRICT_TASK_SCHEMA||!id(t.taskId)||t.fixtureId!==MANAGED_NORMALIZED_STRICT_POLICY.fixture.id||!same(t.verifier,MANAGED_NORMALIZED_STRICT_VERIFIER)||!same(t.policy,MANAGED_NORMALIZED_STRICT_POLICY))fail();
 t.claimedArtifact=validateClaimedNormalizationArtifact(t.claimedArtifact);const a=t.claimedArtifact.artifact;
 t.objectReceipt=validateManagedNormalizedObjectReceipt(t.objectReceipt,{artifact:a});
 const s=a.parentResponse.descriptor.source,p=a.parentResponse.descriptor.requestedTransform,o=a.output,f=MANAGED_NORMALIZED_STRICT_POLICY.fixture;
 if(!MANAGED_NORMALIZED_STRICT_POLICY.parentTransform.maxEdges.includes(p.maxEdge)||!MANAGED_NORMALIZED_STRICT_POLICY.sourceMimeTypes.includes(a.sourceRecord.source.mime)||a.parentObjectReceipt.derivative.mime!==a.sourceRecord.source.mime||s.width!==f.width||s.height!==f.height||p.width!==f.width||p.height!==f.height||o.width!==f.width||o.height!==f.height||o.mime!=='image/png')fail();
 return freeze(t);
 }catch{fail();}}

export function buildManagedNormalizedStrictBinding(value){try{
 const t=validateManagedNormalizedStrictTask(value),a=t.claimedArtifact.artifact,p=t.claimedArtifact.processingProvenance;
 return freeze({...buildManagedNormalizedVerificationBinding({taskId:t.taskId,artifact:a,objectReceipt:t.objectReceipt,verifier:t.verifier,policyVersion:t.policy.id}),
  schemaVersion:MANAGED_NORMALIZED_STRICT_BINDING_SCHEMA,taskDigest:digest(t),claimedArtifactDigest:digest(t.claimedArtifact),processingProvenance:p,processingProvenanceDigest:digest(p),policy:t.policy,policyDigest:digest(t.policy),fixture:t.policy.fixture});
 }catch{fail();}}
function checkedChecks(value){const c=copy(value);exact(c,MANAGED_NORMALIZED_STRICT_CHECKS);if(Object.values(c).some(v=>!['unknown','failed','verified'].includes(v)))fail();return c;}
const stateFor=c=>Object.values(c).includes('failed')?'validation_failed':Object.values(c).every(v=>v==='verified')?'evidence_complete':'pending_validation';
function evidenceFor(binding,checks){return {schemaVersion:MANAGED_NORMALIZED_STRICT_EVIDENCE_SCHEMA,id:'strict-verification-'+digest({binding,checks}),taskDigest:binding.taskDigest,verificationBindingDigest:digest(binding),policyDigest:binding.policyDigest,verifier:binding.verifier,checks};}

/** Structural builder only. Never call this instead of a real independent
 * verifier; arbitrary consistent checks can satisfy a pure JSON contract. */
export function createManagedNormalizedStrictReport(value){try{
 const q=copy(value);exact(q,['task','checks']);const binding=buildManagedNormalizedStrictBinding(q.task),checks=checkedChecks(q.checks),state=stateFor(checks);
 return freeze({schemaVersion:MANAGED_NORMALIZED_STRICT_REPORT_SCHEMA,taskDigest:binding.taskDigest,verificationBinding:binding,checks,state,evidence:state==='evidence_complete'?evidenceFor(binding,checks):null,submissionAuthorized:false,adoptionAuthorized:false,publicEligible:false});
 }catch{fail();}}
export function validateManagedNormalizedStrictReport(value,task){try{
 const r=copy(value);exact(r,['schemaVersion','taskDigest','verificationBinding','checks','state','evidence','submissionAuthorized','adoptionAuthorized','publicEligible']);
 const expected=createManagedNormalizedStrictReport({task,checks:r.checks});if(!same(r,expected))fail();return expected;
 }catch{fail();}}

function pngMeasurement(m,expected,maximum){
 exact(m,['sha256','byteLength','mime','width','height','frameCount','pixelSha256','compressedBytes','consumedCompressedBytes','metadataAbsent']);
 if(!sha(m.sha256)||!integer(m.byteLength,1,maximum)||m.mime!=='image/png')fail();
 if(expected&&(m.sha256!==expected.sha256||m.byteLength!==expected.byteLength||m.mime!==expected.mime))fail();
 if(m.width!==null&&m.width!==80||m.height!==null&&m.height!==120||m.frameCount!==null&&m.frameCount!==1||m.pixelSha256!==null&&!sha(m.pixelSha256)||m.metadataAbsent!==null&&typeof m.metadataAbsent!=='boolean')fail();
 for(const k of ['compressedBytes','consumedCompressedBytes'])if(m[k]!==null&&!integer(m[k],1,m.byteLength))fail();
}
function pngComplete(m){return m&&m.width===80&&m.height===120&&m.frameCount===1&&sha(m.pixelSha256)&&integer(m.compressedBytes,1,m.byteLength)&&m.consumedCompressedBytes===m.compressedBytes&&m.metadataAbsent===true;}
function producerMeasurement(m,expected){
 exact(m,['sha256','byteLength','mime','producerSha256','producerByteLength']);
 if(m.sha256!==expected.sha256||m.byteLength!==expected.byteLength||m.mime!==expected.mime||m.producerSha256!==null&&!sha(m.producerSha256)||m.producerByteLength!==null&&!integer(m.producerByteLength,1,8*1024*1024))fail();
}
/** Validates the fixed runtime's actual measurements. This cannot independently
 * recompute compressed-stream consumption, pixels or producer output from JSON.
 * The trusted runtime/issuer boundary, actual bytes and fresh guards are required.
 */
export function validateManagedNormalizedStrictBinaryResult(value,task){try{
 const t=validateManagedNormalizedStrictTask(task),a=t.claimedArtifact.artifact,b=buildManagedNormalizedStrictBinding(t),r=copy(value);
 exact(r,['schemaVersion','bindingDigest','fixture','source','parent','normalized','reference','checks']);
 if(r.schemaVersion!==MANAGED_NORMALIZED_STRICT_BINARY_SCHEMA||r.bindingDigest!==digest(b))fail();
 const c=checkedChecks(r.checks),maximum=a.parentResponse.descriptor.requestedTransform.maxEdge===1024?262144:524288;
 pngMeasurement(r.fixture,t.policy.fixture,262144);pngMeasurement(r.normalized,a.output,maximum);
 if(r.reference!==null)pngMeasurement(r.reference,null,maximum);
 producerMeasurement(r.source,a.sourceRecord.source);producerMeasurement(r.parent,a.parentObjectReceipt.derivative);
 if(c.fixturePngComplete==='verified'&&!pngComplete(r.fixture)||c.normalizedPngComplete==='verified'&&!pngComplete(r.normalized))fail();
 if(c.sourceExactFixtureProducerMatch==='verified'&&(r.source.producerSha256!==r.source.sha256||r.source.producerByteLength!==r.source.byteLength))fail();
 if(c.parentExactProducerMatch==='verified'&&(r.parent.producerSha256!==r.parent.sha256||r.parent.producerByteLength!==r.parent.byteLength))fail();
 if(c.normalizedPixelsEqual==='verified'&&(!pngComplete(r.normalized)||!pngComplete(r.reference)||r.normalized.pixelSha256!==r.reference.pixelSha256))fail();
 if(c.metadataAbsent==='verified'&&r.normalized.metadataAbsent!==true)fail();
 if(c.sameGeometry==='verified'&&(!pngComplete(r.fixture)||!pngComplete(r.normalized)||!pngComplete(r.reference)))fail();
 // Identity orientation is a scoped producer property, not an EXIF decoder
 // claim about arbitrary customer JPEG/WebP files.
 if(c.identityOrientation==='verified'&&(c.fixturePngComplete!=='verified'||c.sourceExactFixtureProducerMatch!=='verified'||c.parentExactProducerMatch!=='verified'||c.normalizedPngComplete!=='verified'))fail();
 return freeze(r);
 }catch{fail();}}
export function buildManagedNormalizedStrictReport(value){try{
 const q=copy(value);exact(q,['task','binaryResult']);const task=validateManagedNormalizedStrictTask(q.task),result=validateManagedNormalizedStrictBinaryResult(q.binaryResult,task);
 return createManagedNormalizedStrictReport({task,checks:result.checks});
 }catch{fail();}}

/** Server-only normalized image INPUT, not a model-result candidate. No old
 * response/evidence is relabelled and no old archive/history accepts this shape.
 * Only a current independently issued report may feed the future shared send
 * ledger. This pure object never supplies transmission/adoption authorization.
 */
export function buildManagedNormalizedStrictInput(value){try{
 const q=copy(value);exact(q,['task','report']);const t=validateManagedNormalizedStrictTask(q.task),r=validateManagedNormalizedStrictReport(q.report,t),a=t.claimedArtifact.artifact,s=a.sourceRecord;
 if(r.state!=='evidence_complete'||s.stage!=='before'||!['front','back','left','right'].includes(s.angle))fail();
 return freeze({schemaVersion:MANAGED_NORMALIZED_STRICT_INPUT_SCHEMA,taskId:t.taskId,taskDigest:digest(t),verificationBinding:r.verificationBinding,verificationReportDigest:digest(r),policyId:t.policy.id,stage:'before',angle:s.angle,maxEdge:a.parentResponse.descriptor.requestedTransform.maxEdge});
 }catch{fail();}}
export function validateManagedNormalizedStrictInput(value,context){try{const v=copy(value),expected=buildManagedNormalizedStrictInput(context);if(!same(v,expected))fail();return expected;}catch{fail();}}
