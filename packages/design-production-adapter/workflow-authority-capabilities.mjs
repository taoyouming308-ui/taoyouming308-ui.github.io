/** Fixed same-transaction capabilities only. No connection discovery, DDL, driver or default activation. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {artifactCopy as copy,artifactCanonical as canonical} from './postgres-artifact-access-repository.mjs';
import {createIdentityCapabilityOperations} from './identity-capability-postgres.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const CODES=new Set(['WORKFLOW_AUTHORITY_INVALID','WORKFLOW_AUTHORITY_UNAVAILABLE','WORKFLOW_AUTHORITY_CHANGED','WORKFLOW_AUTHORITY_TRANSACTION','WORKFLOW_AUTHORITY_RESULT_INVALID']);
export class WorkflowAuthorityCapabilityError extends Error{constructor(code){const safe=CODES.has(code)?code:'WORKFLOW_AUTHORITY_UNAVAILABLE';super(safe);this.name='WorkflowAuthorityCapabilityError';this.code=safe;this.retryable=false;}}
const fail=code=>{throw new WorkflowAuthorityCapabilityError(code);};
const equal=(a,b)=>canonical(a)===canonical(b),sha=x=>createHash('sha256').update(canonical(x)).digest('hex'),SHA=/^[a-f0-9]{64}$/;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function exact(v,keys){if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('WORKFLOW_AUTHORITY_INVALID');}
function integer(v,min=0,max=1000){if(!Number.isSafeInteger(v)||v<min||v>max)fail('WORKFLOW_AUTHORITY_INVALID');return v;}
function token(v){if(typeof v!=='string'||v.length<32||v.length>200||/[\s\u0000-\u001f\u007f]/.test(v))fail('WORKFLOW_AUTHORITY_INVALID');return v;}
function id(v,max=80){if(typeof v!=='string'||!v.length||v.length>max||!/^[A-Za-z0-9_-]+$/.test(v))fail('WORKFLOW_AUTHORITY_INVALID');return v;}
function authenticateInput(v){v=copy(v,4096);exact(v,['credential','scope']);return {credential:token(v.credential),scope:validateProductionDesignScope(v.scope)};}
function appendInput(input,initialize){
 const v=copy(input);exact(v,initialize?['expectedSourceFingerprint','record','recordSha256']:['expectedSourceFingerprint','expectedRevision','record','recordSha256','receiptKey','receipt']);
 if(!SHA.test(v.expectedSourceFingerprint)||!SHA.test(v.recordSha256)||!v.record||Array.isArray(v.record)||sha(v.record)!==v.recordSha256)fail('WORKFLOW_AUTHORITY_INVALID');
 if(!initialize){integer(v.expectedRevision);if(!SHA.test(v.receiptKey)||!v.receipt||Array.isArray(v.receipt))fail('WORKFLOW_AUTHORITY_INVALID');}
 return freeze(v);
}
function runner(client){
 if(!client||types.isProxy(client)||typeof client.query!=='function')fail('WORKFLOW_AUTHORITY_UNAVAILABLE');
 let busy=false,poisoned=false,closed=false;
 const invoke=work=>{
  if(busy||poisoned||closed){poisoned=true;fail('WORKFLOW_AUTHORITY_TRANSACTION');}busy=true;
  const promise=(async()=>{try{return await work();}catch(error){poisoned=true;if(error instanceof WorkflowAuthorityCapabilityError)throw new WorkflowAuthorityCapabilityError(error.code);fail('WORKFLOW_AUTHORITY_UNAVAILABLE');}finally{busy=false;}})();
  void promise.catch(()=>{});return promise;
 };
 async function scalar(sql,params=[]){const raw=await client.query(sql,params);if(raw?.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)fail('WORKFLOW_AUTHORITY_RESULT_INVALID');const row=copy(raw.rows[0]);exact(row,['value']);return row.value;}
 return {invoke,scalar,close:()=>{closed=true;}};
}
/** Root executor owns BEGIN/global lock/timeouts/COMMIT/rollback/discard and final checks.
 * Repeated authorize cannot replace the credential or immutable authority context.
 */
export function createWorkflowAuthorityCapabilities(client){
 const r=runner(client),identity=createIdentityCapabilityOperations(client);let authority=null,credential=null;
 const active=()=>{if(!authority)fail('WORKFLOW_AUTHORITY_TRANSACTION');};
 async function check(){active();const latest=await identity.recheck(authority);if(!equal(latest,authority))fail('WORKFLOW_AUTHORITY_CHANGED');return latest;}
 return Object.freeze({
  authorize:input=>r.invoke(async()=>{const fixed=authenticateInput(input);if(authority){if(fixed.credential!==credential||!equal(fixed.scope,authority.scope))fail('WORKFLOW_AUTHORITY_CHANGED');return check();}const found=await identity.resolveAuthority(fixed);authority=validateImmutableDesignAuthority(found);credential=fixed.credential;return authority;}),
  recheck:expected=>r.invoke(async()=>{active();if(!equal(validateImmutableDesignAuthority(expected),authority))fail('WORKFLOW_AUTHORITY_CHANGED');return check();}),
  readBundle:()=>r.invoke(async()=>{active();const bundle=await r.scalar('SELECT design_workflow_authority.read_bundle() AS value');if(!bundle||!equal(bundle.authority,authority))fail('WORKFLOW_AUTHORITY_CHANGED');return freeze(bundle);}),
  initializeNative:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_workflow_authority.initialize_native($1::jsonb) AS value',[appendInput(input,true)]);if(typeof value!=='boolean')fail('WORKFLOW_AUTHORITY_RESULT_INVALID');return value;}),
  appendNative:input=>r.invoke(async()=>{active();const value=await r.scalar('SELECT design_workflow_authority.append_native($1::jsonb) AS value',[appendInput(input,false)]);if(typeof value!=='boolean')fail('WORKFLOW_AUTHORITY_RESULT_INVALID');return value;}),
  clear:()=>r.invoke(async()=>{try{await identity.clear();return true;}finally{authority=null;credential=null;r.close();}}),
 });
}
/** Independent issuer connection only; never a runtime or browser capability. */
export function createWorkflowManifestIssuerCapabilities(client){
 const r=runner(client);
 return Object.freeze({
  issue:input=>r.invoke(async()=>{const v=copy(input,8192);exact(v,['credential','scope','requestId','ttlMs']);token(v.credential);v.scope=validateProductionDesignScope(v.scope);id(v.requestId);integer(v.ttlMs,1,3600000);
   const out=await r.scalar('SELECT design_workflow_authority.issue_manifest($1::text,$2::jsonb,$3::text,$4::bigint) AS value',[v.credential,v.scope,v.requestId,v.ttlMs]);exact(out,['manifest','replayed']);if(typeof out.replayed!=='boolean'||!out.manifest)fail('WORKFLOW_AUTHORITY_RESULT_INVALID');return freeze(out);}),
  revoke:input=>r.invoke(async()=>{const v=copy(input,4096);exact(v,['manifestId','expectedRevision']);id(v.manifestId,160);integer(v.expectedRevision,1,Number.MAX_SAFE_INTEGER-1);
   const out=await r.scalar('SELECT design_workflow_authority.revoke_manifest($1::text,$2::bigint) AS value',[v.manifestId,v.expectedRevision]);exact(out,['manifest']);if(!out.manifest)fail('WORKFLOW_AUTHORITY_RESULT_INVALID');return freeze(out);}),
 });
}
