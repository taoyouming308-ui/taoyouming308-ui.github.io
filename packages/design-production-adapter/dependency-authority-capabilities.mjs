/** Fixed same-transaction capabilities only. No connection discovery, DDL, driver or default activation. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {artifactCopy as copy,artifactCanonical as canonical} from './postgres-artifact-access-repository.mjs';
import {createIdentityCapabilityOperations} from './identity-capability-postgres.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const CODES=new Set(['DEPENDENCY_AUTHORITY_INVALID','DEPENDENCY_AUTHORITY_UNAVAILABLE','DEPENDENCY_AUTHORITY_CHANGED','DEPENDENCY_AUTHORITY_TRANSACTION','DEPENDENCY_AUTHORITY_RESULT_INVALID']);
export class DependencyAuthorityCapabilityError extends Error{constructor(code){const safe=CODES.has(code)?code:'DEPENDENCY_AUTHORITY_UNAVAILABLE';super(safe);this.name='DependencyAuthorityCapabilityError';this.code=safe;this.retryable=false;}}
const fail=code=>{throw new DependencyAuthorityCapabilityError(code);};
const equal=(a,b)=>canonical(a)===canonical(b),sha=x=>createHash('sha256').update(canonical(x)).digest('hex'),SHA=/^[a-f0-9]{64}$/;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function exact(v,keys){if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('DEPENDENCY_AUTHORITY_INVALID');}
function integer(v,min=0,max=1000){if(!Number.isSafeInteger(v)||v<min||v>max)fail('DEPENDENCY_AUTHORITY_INVALID');return v;}
function token(v){if(typeof v!=='string'||v.length<32||v.length>200||/[\s\u0000-\u001f\u007f]/.test(v))fail('DEPENDENCY_AUTHORITY_INVALID');return v;}
function id(v,max=80){if(typeof v!=='string'||!v.length||v.length>max||!/^[A-Za-z0-9_-]+$/.test(v))fail('DEPENDENCY_AUTHORITY_INVALID');return v;}
function authenticateInput(v){v=copy(v,4096);exact(v,['credential','scope']);return {credential:token(v.credential),scope:validateProductionDesignScope(v.scope)};}
function appendInput(input,initialize){
 const v=copy(input);exact(v,initialize?['expectedSourceFingerprint','record','recordSha256']:['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt']);
 if(!SHA.test(v.expectedSourceFingerprint)||!SHA.test(v.recordSha256)||!v.record||Array.isArray(v.record)||sha(v.record)!==v.recordSha256)fail('DEPENDENCY_AUTHORITY_INVALID');
 if(!initialize){integer(v.expectedRevision);if(!SHA.test(v.receiptKey)||!v.receipt||Array.isArray(v.receipt))fail('DEPENDENCY_AUTHORITY_INVALID');}
 return freeze(v);
}
function dependencyInput(input,kind){
 const v=copy(input,32*1024*1024+65536);
 if(kind==='media'){
  exact(v,['expectedSourceFingerprint','record','recordSha256']);
  if(!SHA.test(v.recordSha256)||!v.record||Array.isArray(v.record)||sha(v.record)!==v.recordSha256)fail('DEPENDENCY_AUTHORITY_INVALID');
 }else if(kind==='candidate'){
  exact(v,['expectedSourceFingerprint','candidate','candidateSha256','ttlMs']);
  if(!SHA.test(v.candidateSha256)||!v.candidate||Array.isArray(v.candidate)||sha(v.candidate)!==v.candidateSha256)fail('DEPENDENCY_AUTHORITY_INVALID');
  integer(v.ttlMs,1,3600000);
 }else{
  exact(v,['expectedSourceFingerprint','expectedVersion','expectedParentDigest','version','receipt']);integer(v.expectedVersion,0,100);
  if(v.expectedParentDigest!==null&&!SHA.test(v.expectedParentDigest))fail('DEPENDENCY_AUTHORITY_INVALID');
  if(!v.version||Array.isArray(v.version)||!SHA.test(v.version.sha256)||!v.receipt||Array.isArray(v.receipt))fail('DEPENDENCY_AUTHORITY_INVALID');
  const {sha256,...body}=v.version;if(sha(body)!==sha256)fail('DEPENDENCY_AUTHORITY_INVALID');
 }
 if(!SHA.test(v.expectedSourceFingerprint))fail('DEPENDENCY_AUTHORITY_INVALID');return freeze(v);
}

/** Strict fixed-DB proof result; never accepts a caller assertion as provenance. */
function bundleProof(input,authority){
 const localNow=Date.now();if(!Number.isSafeInteger(localNow)||localNow<1)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');
 const v=copy(input,1024*1024);exact(v,['schemaVersion','authority','sourceFingerprint','manifest','checkedAt']);
 if(v.schemaVersion!=='design-dependency-proof-v1'||!equal(validateImmutableDesignAuthority(v.authority),authority)||typeof v.sourceFingerprint!=='string'||!SHA.test(v.sourceFingerprint)||!Number.isSafeInteger(v.checkedAt)||v.checkedAt<1)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');
 if(v.manifest!==null){const m=v.manifest;exact(m,['id','revision','reader','baseWorkflowRevision','baseWorkflowSha256','sourceFingerprint','expiresAt','baseDependencyDigests']);
  if(typeof m.id!=='string'||!m.id||m.id.length>160||!Number.isSafeInteger(m.revision)||m.revision<1||!equal(validateImmutableDesignAuthority(m.reader),authority)||!Number.isSafeInteger(m.baseWorkflowRevision)||m.baseWorkflowRevision< -1||m.baseWorkflowRevision>1000||(m.baseWorkflowRevision===-1?m.baseWorkflowSha256!==null:typeof m.baseWorkflowSha256!=='string'||!SHA.test(m.baseWorkflowSha256))||typeof m.sourceFingerprint!=='string'||!SHA.test(m.sourceFingerprint)||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=Math.max(localNow,v.checkedAt)||!Array.isArray(m.baseDependencyDigests)||m.baseDependencyDigests.length>1400)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');
  const seen=new Set();for(const d of m.baseDependencyDigests){exact(d,['kind','id','sha256']);const key=d.kind+':'+d.id;if(!['media','candidate','full'].includes(d.kind)||typeof d.id!=='string'||!d.id||d.id.length>400||typeof d.sha256!=='string'||!SHA.test(d.sha256)||seen.has(key))fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');seen.add(key);}
 }
 return freeze(v);
}

function runner(client){
 if(!client||types.isProxy(client)||typeof client.query!=='function')fail('DEPENDENCY_AUTHORITY_UNAVAILABLE');
 let busy=false,poisoned=false,closed=false;
 const invoke=work=>{
  if(busy||poisoned||closed){poisoned=true;fail('DEPENDENCY_AUTHORITY_TRANSACTION');}busy=true;
  const promise=(async()=>{try{return await work();}catch(error){poisoned=true;if(error instanceof DependencyAuthorityCapabilityError)throw new DependencyAuthorityCapabilityError(error.code);fail('DEPENDENCY_AUTHORITY_UNAVAILABLE');}finally{busy=false;}})();
  void promise.catch(()=>{});return promise;
 };
 async function scalar(sql,params=[]){const raw=await client.query(sql,params);if(raw?.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');const row=copy(raw.rows[0],64*1024*1024+64);exact(row,['value']);return row.value;}
 return {invoke,scalar,close:()=>{closed=true;}};
}
/** Root executor owns BEGIN/global lock/timeouts/COMMIT/rollback/discard and final checks.
 * Repeated authorize cannot replace the credential or immutable authority context.
 */
export function createDependencyAuthorityCapabilities(client){
 const r=runner(client),identity=createIdentityCapabilityOperations(client);let authority=null,credential=null;
 const active=()=>{if(!authority)fail('DEPENDENCY_AUTHORITY_TRANSACTION');};
 async function check(){active();const latest=await identity.recheck(authority);if(!equal(latest,authority))fail('DEPENDENCY_AUTHORITY_CHANGED');return latest;}
 return Object.freeze({
  authorize:input=>r.invoke(async()=>{const fixed=authenticateInput(input);if(authority){if(fixed.credential!==credential||!equal(fixed.scope,authority.scope))fail('DEPENDENCY_AUTHORITY_CHANGED');return check();}const found=await identity.resolveAuthority(fixed);authority=validateImmutableDesignAuthority(found);credential=fixed.credential;return authority;}),
  recheck:expected=>r.invoke(async()=>{active();if(!equal(validateImmutableDesignAuthority(expected),authority))fail('DEPENDENCY_AUTHORITY_CHANGED');return check();}),
  readBundle:()=>r.invoke(async()=>{active();const bundle=await r.scalar('SELECT design_dependency_authority.read_bundle() AS value');if(!bundle||bundle.schemaVersion!=='design-authorized-dependency-bundle-v1'||!equal(bundle.authority,authority))fail('DEPENDENCY_AUTHORITY_CHANGED');return freeze(bundle);}),
  readBundleProof:()=>r.invoke(async()=>{active();return bundleProof(await r.scalar('SELECT design_dependency_authority.read_bundle_proof() AS value'),authority);}),
  initializeNative:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_dependency_authority.initialize_native($1::jsonb) AS value',[appendInput(input,true)]);if(typeof value!=='boolean')fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return value;}),
  appendNative:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_dependency_authority.append_native($1::jsonb) AS value',[appendInput(input,false)]);if(typeof value!=='boolean')fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return value;}),
  insertMedia:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_dependency_authority.insert_media($1::jsonb) AS value',[dependencyInput(input,'media')]);if(typeof value!=='boolean')fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return value;}),
  publishCandidate:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_dependency_authority.publish_candidate($1::jsonb) AS value',[dependencyInput(input,'candidate')]);if(typeof value!=='boolean')fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return value;}),
  appendFull:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_dependency_authority.append_full($1::jsonb) AS value',[dependencyInput(input,'full')]);if(typeof value!=='boolean')fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return value;}),
  clear:()=>r.invoke(async()=>{try{await identity.clear();return true;}finally{authority=null;credential=null;r.close();}}),
 });
}
/** Independent issuer connection only; never a runtime or browser capability. */
export function createDependencyManifestIssuerCapabilities(client){
 const r=runner(client);
 return Object.freeze({
  issue:input=>r.invoke(async()=>{const v=copy(input,8192);exact(v,['credential','scope','requestId','ttlMs']);token(v.credential);v.scope=validateProductionDesignScope(v.scope);id(v.requestId);integer(v.ttlMs,1,3600000);
   const out=await r.scalar('SELECT design_dependency_authority.issue_manifest($1::text,$2::jsonb,$3::text,$4::bigint) AS value',[v.credential,v.scope,v.requestId,v.ttlMs]);exact(out,['manifest','replayed']);if(typeof out.replayed!=='boolean'||!out.manifest)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return freeze(out);}),
  revoke:input=>r.invoke(async()=>{const v=copy(input,4096);exact(v,['manifestId','expectedRevision']);id(v.manifestId,160);integer(v.expectedRevision,1,Number.MAX_SAFE_INTEGER-1);
   const out=await r.scalar('SELECT design_dependency_authority.revoke_manifest($1::text,$2::bigint) AS value',[v.manifestId,v.expectedRevision]);exact(out,['manifest']);if(!out.manifest)fail('DEPENDENCY_AUTHORITY_RESULT_INVALID');return freeze(out);}),
 });
}
