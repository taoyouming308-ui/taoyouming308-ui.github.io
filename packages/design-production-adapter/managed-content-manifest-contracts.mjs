/** Server-only pure contracts for application content addressing, NOT native
 * retained object versions. No I/O, grants, publication, restore, decoder or
 * production activation occurs here. Both untrusted write intents and validated
 * manifest JSON remain untrusted data until a fixed repository authenticates
 * their origin and freshly authorizes the entire current immutable authority.
 *
 * readbackAssertion describes what a trusted publisher MUST have observed. A
 * caller can construct the same JSON; this validator cannot prove any byte read.
 * An authenticated manifest reference is not a bearer capability. Read the exact
 * target and hash/length/MIME every time, including reconciliation after unknown
 * writes. Never convert these manifests to the old native-version receipts.
 * Admin/provider deletion is detectable, not recoverable by this contract.
 */
import {managedImageCanonical, managedImageDigest} from './managed-image-contracts.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';

export const MANAGED_CONTENT_MANIFEST_SCHEMA = 'application-content-addressed-manifest-v1';
export const MANAGED_CONTENT_WRITE_INTENT_SCHEMA = 'application-content-write-intent-v1';
export const MANAGED_CONTENT_STORAGE_SEMANTICS = 'application_create_only_no_native_versions';
export const MANAGED_CONTENT_READBACK_ASSERTION = 'publisher_observed_matching_bytes';
export const MANAGED_CONTENT_MAX_REVISION = 1000; // bounded stage, never truncate old history
export const MANAGED_CONTENT_MAX_DERIVED_BYTES = 512 * 1024; // storage only, not model eligibility
export const MANAGED_CONTENT_KEY_PATTERN = /^managed-content\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}$/;
export class ManagedContentManifestContractError extends Error {
  constructor() { super('MANAGED_CONTENT_CONTRACT_INVALID'); this.code=this.message; this.outcome='not_sent'; this.retryable=false; }
}
const fail=()=>{throw new ManagedContentManifestContractError();};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
// The existing canonical copier rejects accessors, Proxies (without traps),
// prototypes, sparse arrays, noninteger/-0 numbers and unbounded nesting.
const copy=v=>{const text=managedImageCanonical(v);if(Buffer.byteLength(text)>32768)fail();return JSON.parse(text);};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const safe=fn=>{try{return freeze(fn());}catch{fail();}};
export const managedContentCanonical=v=>safe(()=>managedImageCanonical(copy(v)));
export const managedContentDigest=v=>safe(()=>managedImageDigest(copy(v)));
function location(v,withKey=false){
  exact(v,['projectOrigin','bucket',...(withKey?['key']:[])]);
  const u=new URL(v.projectOrigin);
  if(u.origin!==v.projectOrigin||u.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)||typeof v.bucket!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.bucket))fail();
  if(withKey&&(typeof v.key!=='string'||!MANAGED_CONTENT_KEY_PATTERN.test(v.key)))fail();
  return v;
}
function content(v,role){
  exact(v,['sha256','byteLength','mime']);
  if(!sha(v.sha256)||!integer(v.byteLength,1,role==='source'?IMAGE_UPLOAD_MAX_BYTES:MANAGED_CONTENT_MAX_DERIVED_BYTES)||!['image/png','image/jpeg','image/webp'].includes(v.mime)||role==='normalized_png'&&v.mime!=='image/png')fail();
  return v;
}
function ref(v){exact(v,['manifestId','revision','digest']);if(typeof v.manifestId!=='string'||!/^content-manifest-[a-f0-9]{64}$/.test(v.manifestId)||!integer(v.revision,1,MANAGED_CONTENT_MAX_REVISION)||!sha(v.digest))fail();return v;}
export const validateManagedContentManifestReference=value=>safe(()=>ref(copy(value)));
const stableOwner=a=>[a.subjectId,a.employmentId,a.membershipId,a.storeId];
function address(q){
  exact(q,['authority','requestId','assetId','content','target']);
  const authority=validateImmutableDesignAuthority(q.authority);if(!id(q.requestId)||!id(q.assetId))fail();
  // Address construction does not imply source/derived content qualification.
  content(q.content,'source');const target=location(q.target);
  const scopeDigest=managedImageDigest(authority.scope),ownerNamespaceDigest=managedImageDigest(stableOwner(authority));
  // Exactly the existing policyOwnerKey tuple. Excluding scope/epoch prevents a
  // new scope/epoch from manufacturing a second claim for the original request.
  const writeId=managedImageDigest([...stableOwner(authority),q.requestId]);
  const manifestId='content-manifest-'+managedImageDigest({schemaVersion:MANAGED_CONTENT_MANIFEST_SCHEMA,ownerNamespaceDigest,scopeDigest,assetId:q.assetId});
  return {scopeDigest,ownerNamespaceDigest,writeId,manifestId,target:{...target,key:`managed-content/v1/${scopeDigest}/${ownerNamespaceDigest}/${writeId}/${q.content.sha256}`}};
}
export const managedContentAddress=value=>safe(()=>address(copy(value)));
function ancestry(v,p,role,requestId){
  exact(v,['source','parent']);if(v.source!==null)ref(v.source);if(v.parent!==null)ref(v.parent);
  if(role==='source'){if(v.source!==null||v.parent!==null||p!==null)fail();return;}
  if(v.source===null||(role==='hosted_parent'?v.parent!==null:v.parent===null))fail();
  if(v.parent!==null&&v.parent.manifestId===v.source.manifestId)fail();
  exact(p,['kind','requestId','intentDigest','claimId','artifactDigest']);
  if(p.kind!==(role==='hosted_parent'?'hosted_transform':'png_normalization')||p.requestId!==requestId||!sha(p.intentDigest)||!sha(p.artifactDigest)||typeof p.claimId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(p.claimId))fail();
}
function options(v,o={}){
  const q=copy(o),keys=Object.keys(q);if(keys.some(k=>!['authority','scope','projectOrigin','bucket'].includes(k)))fail();
  if(Object.hasOwn(q,'authority')&&!same(validateImmutableDesignAuthority(q.authority),v.authority))fail();
  if(Object.hasOwn(q,'scope')&&!same(validateProductionDesignScope(q.scope),v.authority.scope))fail();
  for(const k of ['projectOrigin','bucket'])if(Object.hasOwn(q,k)&&q[k]!==v.target[k])fail();
  return v;
}
const inputKeys=['authority','requestId','assetId','role','expectedRevision','expectedManifestDigest','content','target','ancestry','processing'];
function createIntent(q){
  exact(q,inputKeys);q.authority=validateImmutableDesignAuthority(q.authority);
  if(!id(q.requestId)||!id(q.assetId)||!['source','hosted_parent','normalized_png'].includes(q.role)||!integer(q.expectedRevision,0,MANAGED_CONTENT_MAX_REVISION-1)||(q.expectedRevision===0?q.expectedManifestDigest!==null:!sha(q.expectedManifestDigest)))fail();
  content(q.content,q.role);ancestry(q.ancestry,q.processing,q.role,q.requestId);
  const a=address({authority:q.authority,requestId:q.requestId,assetId:q.assetId,content:q.content,target:q.target});
  if([q.ancestry.source,q.ancestry.parent].some(r=>r?.manifestId===a.manifestId))fail();
  return {schemaVersion:MANAGED_CONTENT_WRITE_INTENT_SCHEMA,...q,target:a.target,private:true,storageSemantics:MANAGED_CONTENT_STORAGE_SEMANTICS};
}
/** Builder accepts only a server-owned configured project/bucket, not a key. */
export const createManagedContentWriteIntent=value=>safe(()=>createIntent(copy(value)));
function intent(v){
  exact(v,['schemaVersion',...inputKeys,'private','storageSemantics']);location(v.target,true);
  const {schemaVersion,private:priv,storageSemantics,target,...q}=v;
  const expected=createIntent({...q,target:{projectOrigin:target.projectOrigin,bucket:target.bucket}});
  if(!same(v,expected))fail();return expected;
}
export const validateManagedContentWriteIntent=(value,o={})=>safe(()=>options(intent(copy(value)),o));
function manifestFields(i){
  const a=address({authority:i.authority,requestId:i.requestId,assetId:i.assetId,content:i.content,target:{projectOrigin:i.target.projectOrigin,bucket:i.target.bucket}});
  return {schemaVersion:MANAGED_CONTENT_MANIFEST_SCHEMA,manifestId:a.manifestId,revision:i.expectedRevision+1,previous:i.expectedRevision===0?null:{revision:i.expectedRevision,digest:i.expectedManifestDigest},intentDigest:managedImageDigest(i),authority:i.authority,requestId:i.requestId,assetId:i.assetId,role:i.role,content:i.content,target:i.target,ancestry:i.ancestry,processing:i.processing,private:true,readbackAssertion:MANAGED_CONTENT_READBACK_ASSERTION,storageSemantics:MANAGED_CONTENT_STORAGE_SEMANTICS};
}
function manifest(v){
  exact(v,['schemaVersion','manifestId','revision','previous','intentDigest','authority','requestId','assetId','role','content','target','ancestry','processing','private','readbackAssertion','storageSemantics']);
  if(!integer(v.revision,1,MANAGED_CONTENT_MAX_REVISION))fail();
  if(v.revision===1){if(v.previous!==null)fail();}else{exact(v.previous,['revision','digest']);if(v.previous.revision!==v.revision-1||!sha(v.previous.digest))fail();}
  location(v.target,true);
  const i=createIntent({authority:v.authority,requestId:v.requestId,assetId:v.assetId,role:v.role,expectedRevision:v.revision-1,expectedManifestDigest:v.previous?.digest??null,content:v.content,target:{projectOrigin:v.target.projectOrigin,bucket:v.target.bucket},ancestry:v.ancestry,processing:v.processing});
  const expected=manifestFields(i);if(!same(v,expected))fail();return expected;
}
/** Structure only; a caller-created manifest must never bypass fixed publish. */
export const validateManagedContentManifest=(value,o={})=>safe(()=>options(manifest(copy(value)),o));
function reference(v){return {manifestId:v.manifestId,revision:v.revision,digest:managedImageDigest(v)};}
export const managedContentManifestReference=value=>safe(()=>reference(manifest(copy(value))));
function sameContext(a,b){return same(a.authority,b.authority)&&a.target.projectOrigin===b.target.projectOrigin&&a.target.bucket===b.target.bucket;}
function context(v,previous,ancestors){
  if(!Array.isArray(ancestors)||ancestors.length>2)fail();
  if(v.revision===1){if(previous!==null)fail();}else{
    const p=manifest(previous);
    if(p.manifestId!==v.manifestId||p.revision!==v.previous.revision||managedImageDigest(p)!==v.previous.digest||p.assetId!==v.assetId||p.role!==v.role||!sameContext(p,v)||p.requestId===v.requestId||p.target.key===v.target.key)fail();
  }
  const refs=[v.ancestry.source,v.ancestry.parent].filter(r=>r!==null);
  if(refs.length!==ancestors.length)fail();
  const validated=ancestors.map(manifest),seen=new Set();
  for(const p of validated){if(!sameContext(v,p)||seen.has(p.manifestId)||!refs.some(r=>same(reference(p),r)))fail();seen.add(p.manifestId);}
  if(v.role!=='source'){
    const source=validated.find(p=>same(reference(p),v.ancestry.source));if(!source||source.role!=='source')fail();
    if(v.role==='normalized_png'){const parent=validated.find(p=>same(reference(p),v.ancestry.parent));if(!parent||parent.role!=='hosted_parent'||!same(parent.ancestry.source,v.ancestry.source))fail();}
  }
  return v;
}
/** These input manifests MUST come from a fresh authenticated repository, not
 * caller JSON. Structural checks deliberately cannot establish their issuance.
 * Current minimal lane denies cross-epoch/regrant; it never adopts old authors. */
export const validateManagedContentManifestContext=(value,o={})=>safe(()=>{
  const q=copy(value);exact(q,['manifest','previous','ancestors']);
  return options(context(manifest(q.manifest),q.previous,q.ancestors),o);
});
/** Run only after trusted exact readback plus same-transaction live checks.
 * Construction itself performs neither and is safe only as structural tooling. */
export const createManagedContentManifest=value=>safe(()=>{
  const q=copy(value);exact(q,['intent','previous','ancestors']);
  return context(manifestFields(intent(q.intent)),q.previous,q.ancestors);
});
