import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {managedContentManifestFixture as fixture} from './fixtures/managed-content-manifest.mjs';
import {
  MANAGED_CONTENT_MANIFEST_SCHEMA,MANAGED_CONTENT_WRITE_INTENT_SCHEMA,
  MANAGED_CONTENT_MAX_REVISION,ManagedContentManifestContractError,
  createManagedContentWriteIntent as intent,validateManagedContentWriteIntent as validIntent,
  createManagedContentManifest as manifest,validateManagedContentManifest as validManifest,
  validateManagedContentManifestContext as context,managedContentManifestReference as ref,
  validateManagedContentManifestReference as validRef,managedContentAddress as address,
  managedContentCanonical as canonical,managedContentDigest as digest
} from '../packages/design-production-adapter/managed-content-manifest-contracts.mjs';
import {validateManagedImageSourceRecord} from '../packages/design-production-adapter/managed-image-contracts.mjs';
import {validateManagedNormalizedObjectReceipt} from '../packages/design-production-adapter/managed-normalized-verification-contracts.mjs';
import {createManagedPrivateVersionedStorage} from '../packages/design-production-adapter/managed-private-versioned-storage.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const clone=structuredClone;
const rejects=fn=>assert.throws(fn,e=>e instanceof ManagedContentManifestContractError&&e.code==='MANAGED_CONTENT_CONTRACT_INVALID'&&e.message===e.code&&e.retryable===false&&e.outcome==='not_sent');
function immutable(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));Object.values(v).forEach(immutable);}}
const addr=q=>address({authority:q.authority,requestId:q.requestId,assetId:q.assetId,content:q.content,target:q.target});
function next(f,patch={}){return intent({...f.sourceInput,requestId:'source-write-2',expectedRevision:1,expectedManifestDigest:digest(f.source),...patch});}

test('distinct source/parent/PNG manifests retain exact three contents and references, no native version assertion',()=>{
  const f=fixture();for(const m of [f.source,f.parent,f.normalized]){assert.equal(m.schemaVersion,MANAGED_CONTENT_MANIFEST_SCHEMA);assert.deepEqual(validManifest(m),m);immutable(m);for(const k of ['version','objectVersion','immutable','decoded','fullDecode','submissionAuthorized'])assert(!Object.hasOwn(m,k));assert.equal(m.storageSemantics,'application_create_only_no_native_versions');assert.equal(m.readbackAssertion,'publisher_observed_matching_bytes');}
  assert.equal(f.sourceIntent.schemaVersion,MANAGED_CONTENT_WRITE_INTENT_SCHEMA);assert.deepEqual(f.parent.ancestry.source,ref(f.source));assert.deepEqual(f.normalized.ancestry,{source:ref(f.source),parent:ref(f.parent)});
  assert.equal(new Set([f.source.content.sha256,f.parent.content.sha256,f.normalized.content.sha256]).size,3);
  assert.deepEqual(context({manifest:f.normalized,previous:null,ancestors:[f.parent,f.source]},{authority:f.authority,scope:f.scope,...f.target}),f.normalized);
});
test('canonical hashes deterministic across key ordering and frozen snapshots cannot follow caller mutations',()=>{
  const f=fixture(),a=clone(f.sourceInput),ordered=Object.fromEntries(Object.entries(a).reverse()),made=intent(ordered),before=canonical(made);
  assert.deepEqual(made,f.sourceIntent);assert.equal(digest(made),digest(f.sourceIntent));a.authority.actor.username='changed';a.content.byteLength++;assert.equal(canonical(made),before);immutable(made);
  assert.equal(digest({b:2,a:1}),createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
});
test('stable request tuple excludes epoch binding alias and scope, while full intent and scoped address do not',()=>{
  const f=fixture(),base=addr(f.sourceInput);
  for(const edit of [a=>a.securityEpoch++,a=>a.membershipRevision++,a=>a.bindingRevision='binding-2',a=>a.actor.username='new-display-name']){
    const q=clone(f.sourceInput);edit(q.authority);assert.equal(addr(q).writeId,base.writeId);assert.equal(addr(q).target.key,base.target.key);assert.notEqual(digest(intent(q)),digest(f.sourceIntent));rejects(()=>validIntent(intent(q),{authority:f.authority}));
  }
  const q=clone(f.sourceInput);q.authority.scope.visitId='booking:102';assert.equal(addr(q).writeId,base.writeId);assert.notEqual(addr(q).scopeDigest,base.scopeDigest);assert.notEqual(addr(q).target.key,base.target.key);rejects(()=>validIntent(intent(q),{scope:f.scope}));
  assert.equal(base.writeId,digest([f.authority.subjectId,f.authority.employmentId,f.authority.membershipId,f.authority.storeId,f.sourceInput.requestId]));
});
test('same display name rehire cannot adopt old owner namespace or manifests',()=>{
  const f=fixture(),q=clone(f.sourceInput);q.authority.subjectId='subject-2';q.authority.employmentId='employment-2';q.authority.membershipId='membership-2';
  assert.deepEqual(q.authority.actor,f.authority.actor);assert.notEqual(addr(q).ownerNamespaceDigest,addr(f.sourceInput).ownerNamespaceDigest);assert.notEqual(addr(q).writeId,addr(f.sourceInput).writeId);rejects(()=>validManifest(f.source,{authority:q.authority}));
});
test('content address has exact four hex segments and binds configured project bucket and content SHA',()=>{
  const f=fixture(),a=addr(f.sourceInput);assert.match(a.target.key,/^managed-content\/v1\/(?:[a-f0-9]{64}\/){3}[a-f0-9]{64}$/);assert.equal(a.target.key.split('/').at(-1),f.source.content.sha256);
  for(const patch of [{key:a.target.key+'/extra'},{key:a.target.key.replace('managed-content','managed-normalized')},{key:a.target.key.slice(0,-1)+'0'},{version:'fake-native'}])rejects(()=>validIntent({...f.sourceIntent,target:{...f.sourceIntent.target,...patch}}));
  rejects(()=>intent({...f.sourceInput,target:a.target}));rejects(()=>validManifest(f.source,{projectOrigin:'https://other.supabase.co'}));rejects(()=>validManifest(f.source,{bucket:'other'}));
});
test('source 8MiB and derived storage 512KiB are exact inclusive limits, no model qualification implied',()=>{
  const f=fixture();for(const [input,max] of [[f.sourceInput,8*1024*1024],[f.parentInput,512*1024],[f.normalizedInput,512*1024]]){assert.equal(intent({...input,content:{...input.content,byteLength:max}}).content.byteLength,max);for(const n of [0,-1,max+1,1.5,NaN,Infinity,-0])rejects(()=>intent({...input,content:{...input.content,byteLength:n}}));}
  for(const mime of ['image/png','image/jpeg','image/webp'])assert.equal(intent({...f.sourceInput,content:{...f.sourceInput.content,mime}}).content.mime,mime);
  for(const mime of ['image/jpeg','image/webp','image/svg+xml'])rejects(()=>intent({...f.normalizedInput,content:{...f.normalizedInput.content,mime}}));
});
test('append binds exact prior manifest CAS and preserves original content and hashes byte-for-byte',()=>{
  const f=fixture(),before=JSON.stringify(f.source),i=next(f),m=manifest({intent:i,previous:f.source,ancestors:[]});
  assert.equal(m.manifestId,f.source.manifestId);assert.equal(m.revision,2);assert.deepEqual(m.previous,{revision:1,digest:digest(f.source)});assert.notEqual(m.target.key,f.source.target.key);assert.equal(JSON.stringify(f.source),before);assert.equal(m.intentDigest,digest(i));
  for(const previous of [null,{...f.source,content:{...f.source.content,byteLength:20}},f.parent])rejects(()=>manifest({intent:i,previous,ancestors:[]}));
  rejects(()=>manifest({intent:next(f,{expectedManifestDigest:'0'.repeat(64)}),previous:f.source,ancestors:[]}));
});
test('same request cannot append a revision or silently change asset role',()=>{
  const f=fixture();rejects(()=>manifest({intent:next(f,{requestId:f.source.requestId}),previous:f.source,ancestors:[]}));
  const q={...f.parentInput,assetId:f.source.assetId,expectedRevision:1,expectedManifestDigest:digest(f.source)};rejects(()=>intent(q));
});
test('bounded revision 1000 is explicit, excess rejected without trimming or rewriting history',()=>{
  const f=fixture(),before=JSON.stringify(f.source);assert.equal(MANAGED_CONTENT_MAX_REVISION,1000);
  const q=next(f,{expectedRevision:999,expectedManifestDigest:'a'.repeat(64)});assert.equal(q.expectedRevision,999);
  rejects(()=>next(f,{expectedRevision:1000,expectedManifestDigest:'a'.repeat(64)}));rejects(()=>validManifest({...f.source,revision:1001}));assert.equal(JSON.stringify(f.source),before);
});
test('source parent relationships are mandatory role-specific and never synthesized from matching bytes',()=>{
  const f=fixture();for(const q of [{...f.sourceInput,ancestry:{source:f.sourceRef,parent:null}},{...f.parentInput,ancestry:{source:null,parent:null}},{...f.normalizedInput,ancestry:{source:f.sourceRef,parent:null}},{...f.normalizedInput,ancestry:{source:f.sourceRef,parent:f.sourceRef}}])rejects(()=>intent(q));
  rejects(()=>manifest({intent:f.parentIntent,previous:null,ancestors:[]}));rejects(()=>manifest({intent:f.normalizedIntent,previous:null,ancestors:[f.parent,f.parent]}));rejects(()=>manifest({intent:f.normalizedIntent,previous:null,ancestors:[f.source,f.parent,f.source]}));
});
test('normalization parent must reference the identical source manifest revision and digest',()=>{
  const f=fixture(),source2=manifest({intent:next(f),previous:f.source,ancestors:[]});
  const i=intent({...f.normalizedInput,ancestry:{source:ref(source2),parent:f.parentRef}});rejects(()=>manifest({intent:i,previous:null,ancestors:[source2,f.parent]}));
  const q=clone(f.normalizedInput);q.ancestry.parent.digest='0'.repeat(64);rejects(()=>manifest({intent:intent(q),previous:null,ancestors:[f.source,f.parent]}));
});
test('ancestor scope epoch membership binding author and destination all require exact current context',()=>{
  const f=fixture();for(const edit of [q=>q.authority.scope.visitId='booking:102',q=>q.authority.securityEpoch++,q=>q.authority.membershipRevision++,q=>q.authority.bindingRevision='binding-2',q=>q.authority.actor.username='other',q=>q.target.bucket='other']){
    const s=clone(f.sourceInput);edit(s);const source=manifest({intent:intent(s),previous:null,ancestors:[]});
    const i=intent({...f.parentInput,ancestry:{source:ref(source),parent:null}});rejects(()=>manifest({intent:i,previous:null,ancestors:[source]}));
  }
});
test('processing links are structural references not permissions and cannot change kind or request',()=>{
  const f=fixture();for(const change of [p=>p.kind='normalization',p=>p.requestId='other',p=>p.intentDigest=null,p=>p.artifactDigest='invalid',p=>p.claimId='',p=>p.approved=true]){const p=clone(f.parentInput.processing);change(p);rejects(()=>intent({...f.parentInput,processing:p}));}
  rejects(()=>intent({...f.sourceInput,processing:f.parentInput.processing}));
  // A self-consistent caller can still build the JSON. Only the repository can
  // establish the real claim/approval and source relationship; no pure self-proof.
  assert.equal(intent({...f.parentInput,processing:{...f.parentInput.processing,claimId:'unissued-claim'}}).processing.claimId,'unissued-claim');
});
test('references and historical manifest JSON do not accept locator/version aliases or latest selectors',()=>{
  const f=fixture();assert.deepEqual(validRef(ref(f.source)),f.sourceRef);for(const patch of [{digest:'x'},{manifestId:'https://example.invalid/signed'},{revision:0},{revision:'1'},{version:'1'},{latest:true},{manifestDigest:f.sourceRef.digest}])rejects(()=>validRef({...f.sourceRef,...patch}));
  for(const key of ['nativeVersion','immutable','decoded','verified','readbackVerified','restorable','backupVerified'])rejects(()=>validManifest({...f.source,[key]:true}));
});
test('all output and options exact allowlists reject opaque grants and secrets',()=>{
  const f=fixture();for(const key of ['credential','token','receipt','signedUrl','authorityProof']){rejects(()=>intent({...f.sourceInput,[key]:'secret'}));rejects(()=>validManifest({...f.source,[key]:'secret'}));rejects(()=>validManifest(f.source,{[key]:'secret'}));}
  rejects(()=>validIntent({...f.sourceIntent,private:false}));rejects(()=>validManifest({...f.source,readbackAssertion:'verified'}));rejects(()=>validManifest({...f.source,storageSemantics:'native_versioned'}));
});
test('getters proxies toJSON and function values are rejected without executing attacker code',()=>{
  const f=fixture();let traps=0;const proxy=new Proxy({}, {get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getPrototypeOf(){traps++;throw 0;}});
  rejects(()=>intent(proxy));rejects(()=>validManifest({...f.source,authority:proxy}));rejects(()=>validManifest(f.source,proxy));
  const getter=clone(f.sourceInput);Object.defineProperty(getter,'content',{enumerable:true,get(){traps++;throw 0;}});rejects(()=>intent(getter));
  rejects(()=>intent({...f.sourceInput,toJSON(){traps++;return f.sourceInput;}}));assert.equal(traps,0);
});
test('canonical domain rejects noninteger and oversized data before computation',()=>{
  for(const v of [1.1,-0,NaN,Infinity,undefined,()=>{},new Date(),{nested:'x'.repeat(32769)},Array(2)])rejects(()=>canonical(v));
  let v={};for(let n=0;n<30;n++)v={a:v};rejects(()=>digest(v));
});
test('new application manifests cannot be used as old native-version source/PNG receipts or enabled backend',async()=>{
  const f=fixture();assert.throws(()=>validateManagedImageSourceRecord(f.source));assert.throws(()=>validateManagedNormalizedObjectReceipt(f.normalized,{}));let calls=0;
  const s=createManagedPrivateVersionedStorage({enabled:true,...f.target,backend:{contract:{schemaVersion:MANAGED_CONTENT_MANIFEST_SCHEMA,atomicCreateOnly:true,versionAddressedReads:false,retainedVersionsImmutable:false,privateOnly:true},createOnce:async()=>{calls++;},readVersion:async()=>{calls++;}},authorize:async()=>true,timeoutMs:100});
  await assert.rejects(s.read({}),e=>e.code==='PRIVATE_VERSIONED_DISABLED');assert.equal(calls,0);
});
