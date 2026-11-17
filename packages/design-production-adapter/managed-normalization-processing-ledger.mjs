/** Default-off fixed pre-decode PostgreSQL capability facade.
 * A distinct LOGIN can execute only these token+scope functions, never the old
 * runtime's writes or authorize(). Current original parents/permissions are
 * rechecked under the existing global lock. No byte I/O, decoder or issuer is
 * installed implicitly. A claim is a permanent no-retry tombstone, not evidence
 * of image validity. Checked transaction boundaries do not promise validity at
 * an arbitrary later physical COMMIT/network delivery instant. */
import {types} from 'node:util';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageDigest as digest} from './managed-image-contracts.mjs';
import {validateManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
import {createManagedNormalizationProcessingIntent,validateManagedNormalizationProcessingIntent,validateClaimedNormalizationArtifact} from './managed-normalization-processing-contracts.mjs';
const codes=['NORMALIZATION_PROCESSING_DISABLED','NORMALIZATION_PROCESSING_INVALID','NORMALIZATION_PROCESSING_DENIED','NORMALIZATION_PROCESSING_UNCERTAIN'];
export class ManagedNormalizationProcessingError extends Error{constructor(code){super(codes.includes(code)?code:'NORMALIZATION_PROCESSING_DENIED');this.code=this.message;this.retryable=false;this.outcome=this.code==='NORMALIZATION_PROCESSING_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new ManagedNormalizationProcessingError(c);},held=new WeakSet(),quarantined=new WeakSet();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function input(v,keys){try{const q=copy(v);exact(q,keys);if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential))fail();q.scope=validateProductionDesignScope(q.scope);return q;}catch{fail('NORMALIZATION_PROCESSING_INVALID');}}
function scalar(r){if(r?.command!=='SELECT'||r.rowCount!==1||r.rows?.length!==1)fail();const row=copy(r.rows[0]);exact(row,['value']);return row.value;}
function executor(enabled,acquire){return async({sql,params,validate=v=>v,finalSql=sql,finalParams=params,finalValidate=validate,compareFinal=false})=>{
 if(enabled!==true||typeof acquire!=='function')fail('NORMALIZATION_PROCESSING_DISABLED');let c,q,release,owned=false,started=false,committing=false,committed=false;
 try{c=await acquire();if(!c||types.isProxy(c)||held.has(c)||quarantined.has(c))fail();const method=k=>{const d=Object.getOwnPropertyDescriptor(c,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return (...args)=>Reflect.apply(d.value,c,args);};q=method('query');release=method('release');held.add(c);owned=true;started=true;
 if((await q('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')fail();for(const s of ["SET LOCAL statement_timeout='5000ms'","SET LOCAL lock_timeout='2000ms'","SET LOCAL idle_in_transaction_session_timeout='10000ms'",'SET LOCAL search_path=pg_catalog'])await q(s,[]);
 const out=validate(scalar(await q(sql,params)));const last=finalValidate(scalar(await q(finalSql,finalParams)));if((finalSql===sql||compareFinal)&&!equal(out,last))fail();
 committing=true;if((await q('COMMIT',[])).command!=='COMMIT')fail();committed=true;return freeze(out);
 }catch(e){let unknown=false;if(owned&&started&&!committed)try{if((await q('ROLLBACK',[])).command!=='ROLLBACK')unknown=true;}catch{unknown=true;}
 if(committing||unknown){if(owned)quarantined.add(c);fail('NORMALIZATION_PROCESSING_UNCERTAIN');}
 const d=!types.isProxy(e)&&e instanceof ManagedNormalizationProcessingError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ManagedNormalizationProcessingError(d&&Object.hasOwn(d,'value')?d.value:undefined);
 }finally{if(owned){try{await release(committed?undefined:Error('Discard processing lease'));}catch{quarantined.add(c);fail('NORMALIZATION_PROCESSING_UNCERTAIN');}finally{held.delete(c);}}}
};}
const sql=(name,args)=>`SELECT design_normalization_processing.${name}(${args}) AS value`;
const bool=v=>{if(v!==true)fail();return true;};
function intent(q){const i=validateManagedNormalizationProcessingIntent(q.intent);if(!equal(i.authority.scope,q.scope))fail('NORMALIZATION_PROCESSING_INVALID');return i;}
function bound(v,q){const b=validateClaimedNormalizationArtifact(v);if(!equal(b.artifact.authority.scope,q.scope)||b.artifact.requestId!==q.requestId)fail();return b;}
export function createManagedNormalizationProcessing({enabled=false,acquireClient}={}){
 const run=executor(enabled,acquireClient),ready=()=>{if(enabled!==true)fail('NORMALIZATION_PROCESSING_DISABLED');};
 const gate=(name,value)=>{ready();const q=input(value,['credential','scope','intent']),i=intent(q),params=[q.credential,q.scope,i],validate=name==='claim'?v=>{if(!['created','already_claimed'].includes(v))fail();return v;}:bool;return run({sql:sql(name,'$1::text,$2::jsonb,$3::jsonb'),params,validate,...(name==='claim'?{finalSql:sql('guard','$1::text,$2::jsonb,$3::jsonb'),finalValidate:bool}:{})});};
 return Object.freeze({
 prepare(value){ready();const q=input(value,['credential','scope','mediaId','parentRequestId','requestId']);if(![q.mediaId,q.parentRequestId,q.requestId].every(id))fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('prepare','$1::text,$2::jsonb,$3::text,$4::text,$5::text'),params:[q.credential,q.scope,q.mediaId,q.parentRequestId,q.requestId],validate:v=>{const i=validateManagedNormalizationProcessingIntent(v);if(!equal(i.authority.scope,q.scope)||i.requestId!==q.requestId||i.sourceRecord.mediaId!==q.mediaId||i.parentResponse.descriptor.requestId!==q.parentRequestId)fail();return i;}});},
 authorize:v=>gate('authorize',v),claim:v=>gate('claim',v),guard:v=>gate('guard',v),
 bindArtifact(value){ready();const q=input(value,['credential','scope','intent','artifact']),i=intent(q),a=validateManagedImageNormalizationArtifact(q.artifact);if(!equal(i,createManagedNormalizationProcessingIntent({requestId:a.requestId,sourceRecord:a.sourceRecord,parentResponse:a.parentResponse,parentObjectReceipt:a.parentObjectReceipt})))fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('bind_artifact','$1::text,$2::jsonb,$3::jsonb,$4::jsonb'),params:[q.credential,q.scope,i,a],validate:v=>{const b=bound(v,{...q,requestId:i.requestId});if(!equal(b.artifact,a))fail();return b;},compareFinal:true,finalSql:sql('read_bound_artifact','$1::text,$2::jsonb,$3::text'),finalParams:[q.credential,q.scope,i.requestId],finalValidate:v=>{const b=bound(v,{...q,requestId:i.requestId});if(!equal(b.artifact,a))fail();return b;}});},
 readBoundArtifact(value){ready();const q=input(value,['credential','scope','requestId']);if(!id(q.requestId))fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('read_bound_artifact','$1::text,$2::jsonb,$3::text'),params:[q.credential,q.scope,q.requestId],validate:v=>bound(v,q)});},
 readClaim(value){ready();const q=input(value,['credential','scope','requestId']);if(!id(q.requestId))fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('read_claim','$1::text,$2::jsonb,$3::text'),params:[q.credential,q.scope,q.requestId],validate:v=>{if(v===null)return null;exact(v,['claimId','permissionId','intentDigest','artifactDigest']);if(!id(v.permissionId)||!sha(v.intentDigest)||v.claimId!=='normalization-claim-'+v.intentDigest||(v.artifactDigest!==null&&!sha(v.artifactDigest)))fail();return v;}});}
 });
}
export function createManagedNormalizationProcessingIssuer({enabled=false,acquireClient}={}){
 const run=executor(enabled,acquireClient),ready=()=>{if(enabled!==true)fail('NORMALIZATION_PROCESSING_DISABLED');};
 return Object.freeze({
 issueProcessing(value){ready();const q=input(value,['credential','scope','permissionId','intent','ttlMs']),i=intent(q);if(!id(q.permissionId)||!Number.isSafeInteger(q.ttlMs)||q.ttlMs<1||q.ttlMs>900000)fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('issue_processing','$1::text,$2::jsonb,$3::text,$4::jsonb,$5::bigint'),params:[q.credential,q.scope,q.permissionId,i,q.ttlMs],validate:bool,finalSql:sql('issuer_guard','$1::text,$2::jsonb,$3::jsonb'),finalParams:[q.credential,q.scope,i],finalValidate:bool});},
 revoke(value){ready();const q=copy(value);exact(q,['permissionId']);if(!id(q.permissionId))fail('NORMALIZATION_PROCESSING_INVALID');return run({sql:sql('revoke','$1::text'),params:[q.permissionId],validate:v=>{if(typeof v!=='boolean')fail();return v;},finalSql:sql('is_revoked','$1::text'),finalValidate:bool});}
 });
}
