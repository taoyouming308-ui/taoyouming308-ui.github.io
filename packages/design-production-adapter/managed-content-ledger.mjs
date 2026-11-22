/** Fixed, default-closed source-only application manifest repository.
 * No object I/O, vendor credential, processing grant, decoder or native-version
 * claim. Each operation is one fresh short transaction. Unknown commit/release
 * is never retried; only the original request may be reconciled later.
 */
import {types} from 'node:util';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {validateManagedContentWriteIntent,validateManagedContentManifest,validateManagedContentManifestReference,createManagedContentManifest,managedContentDigest as digest,managedContentAddress,managedContentManifestReference} from './managed-content-manifest-contracts.mjs';
const codes=new Set(['CONTENT_LEDGER_DISABLED','CONTENT_LEDGER_INVALID','CONTENT_LEDGER_DENIED','CONTENT_LEDGER_UNCERTAIN']);
export class ManagedContentLedgerError extends Error{constructor(code='CONTENT_LEDGER_DENIED'){super(codes.has(code)?code:'CONTENT_LEDGER_DENIED');this.code=this.message;this.retryable=false;this.outcome=this.code==='CONTENT_LEDGER_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new ManagedContentLedgerError(c);},held=new WeakSet(),quarantined=new WeakSet();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function method(o,k){if(!o||types.isProxy(o))fail();const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return (...a)=>Reflect.apply(d.value,o,a);}
function input(v,keys){try{const r=copy(v);exact(r,['credential','scope',...keys]);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/[\s\x00-\x1f\x7f]/.test(r.credential))fail();r.scope=validateProductionDesignScope(r.scope);if(Object.hasOwn(r,'requestId')&&!id(r.requestId))fail();return r;}catch{fail('CONTENT_LEDGER_INVALID');}}
function value(raw){try{if(!raw||types.isProxy(raw))fail();const ds=Object.getOwnPropertyDescriptors(raw);if(!['command','rowCount','rows'].every(k=>ds[k]&&Object.hasOwn(ds[k],'value')))fail();if(ds.command.value!=='SELECT'||ds.rowCount.value!==1)fail();const rows=copy(ds.rows.value);if(!Array.isArray(rows)||rows.length!==1)fail();exact(rows[0],['value']);return rows[0].value;}catch{fail();}}
function sourceIntent(v,authority){const i=validateManagedContentWriteIntent(v,authority?{authority}:{});if(i.role!=='source')fail('CONTENT_LEDGER_INVALID');return i;}
function context(v,a,{requestId,intent,reference}={}){try{
 const x=copy(v);exact(x,['intent','previous','ancestors','claimId','state','manifest']);x.intent=sourceIntent(x.intent,a);if(requestId&&x.intent.requestId!==requestId||intent&&!equal(x.intent,intent)||!['reserved','claimed','published'].includes(x.state)||!Array.isArray(x.ancestors)||x.ancestors.length)fail();
 const address=managedContentAddress({authority:x.intent.authority,requestId:x.intent.requestId,assetId:x.intent.assetId,content:x.intent.content,target:{projectOrigin:x.intent.target.projectOrigin,bucket:x.intent.target.bucket}}),expectedId='content-claim-'+digest({writeId:address.writeId,intentDigest:digest(x.intent)});
 if(x.claimId!==expectedId)fail();const m=createManagedContentManifest({intent:x.intent,previous:x.previous,ancestors:x.ancestors});
 if(x.state==='published'){if(!equal(x.manifest,m))fail();if(reference&&!equal(managedContentManifestReference(m),reference))fail();}else if(x.manifest!==null||reference)fail();return freeze(x);
 }catch{fail();}}
function binding(r){if(!sha(r.intentDigest)||typeof r.claimId!=='string'||!/^content-claim-[a-f0-9]{64}$/.test(r.claimId))fail('CONTENT_LEDGER_INVALID');return [r.requestId,r.intentDigest,r.claimId];}
function executor(enabled,acquire){return async({credential,scope,sql,params,validate,finalSql,finalParams,finalValidate,issuer=false})=>{
 if(enabled!==true||typeof acquire!=='function')fail('CONTENT_LEDGER_DISABLED');let c,q,release,owned=false,started=false,committing=false,committed=false;
 try{c=await acquire();if(!c||types.isProxy(c)||held.has(c)||quarantined.has(c))fail();q=method(c,'query');release=method(c,'release');held.add(c);owned=true;started=true;if((await q('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')fail();for(const s of ["SET LOCAL statement_timeout='5000ms'","SET LOCAL lock_timeout='2000ms'","SET LOCAL idle_in_transaction_session_timeout='10000ms'",'SET LOCAL search_path=pg_catalog'])await q(s,[]);
 let a=null;if(!issuer)a=validateImmutableDesignAuthority(value(await q('SELECT design_identity.authorize($1::text,$2::jsonb) AS value',[credential,scope])));
 const out=validate(value(await q(sql,params)),a);
 if(!issuer){const last=validateImmutableDesignAuthority(value(await q('SELECT design_identity.recheck_authority() AS value',[])));if(!equal(a,last))fail();if(finalSql)finalValidate(value(await q(finalSql,finalParams)),last,out);if(value(await q('SELECT design_identity.clear_context() AS value',[]))!=='')fail();}
 committing=true;if((await q('COMMIT',[])).command!=='COMMIT')fail();committed=true;return freeze(out);
 }catch(e){let unknown=false;if(owned&&started&&!committed)try{if((await q('ROLLBACK',[])).command!=='ROLLBACK')unknown=true;}catch{unknown=true;}if(committing||unknown){if(owned)quarantined.add(c);fail('CONTENT_LEDGER_UNCERTAIN');}if(!types.isProxy(e)&&e instanceof ManagedContentLedgerError){const d=Object.getOwnPropertyDescriptor(e,'code');throw new ManagedContentLedgerError(d&&Object.hasOwn(d,'value')?d.value:undefined);}fail();}
 finally{if(owned){try{await release(committed?undefined:Error('Discard content lease'));}catch{quarantined.add(c);fail('CONTENT_LEDGER_UNCERTAIN');}finally{held.delete(c);}}}
};}
const reconcileSQL='SELECT design_content_manifest.reconcile($1::text) AS value';
export function createManagedContentLedger({enabled=false,acquireClient}={}){
 const run=executor(enabled,acquireClient),ready=()=>{if(enabled!==true)fail('CONTENT_LEDGER_DISABLED');};
 const finalContext=(r,extra={})=>({finalSql:'SELECT design_content_manifest.read_receipt($1::text) AS value',finalParams:[r.requestId],finalValidate:(v,a)=>context(v,a,{requestId:r.requestId,...extra})});
 return Object.freeze({
 reserve(v){ready();const r=input(v,['requestId','intent']),i=sourceIntent(r.intent);if(i.requestId!==r.requestId)fail('CONTENT_LEDGER_INVALID');return run({...r,sql:'SELECT design_content_manifest.reserve($1::jsonb) AS value',params:[i],validate:(v,a)=>context(v,a,{requestId:r.requestId,intent:i}),...finalContext(r,{intent:i})});},
 claim(v){ready();const r=input(v,['requestId','intentDigest','claimId']),p=binding(r);return run({...r,sql:'SELECT design_content_manifest.claim($1::text,$2::text,$3::text) AS value',params:p,validate:v=>{exact(v,['created']);if(typeof v.created!=='boolean')fail();return v;},...finalContext(r),finalValidate:(v,a)=>{const ctx=context(v,a,{requestId:r.requestId});if(ctx.state==='reserved'||digest(ctx.intent)!==r.intentDigest||ctx.claimId!==r.claimId)fail();}});},
 authorize(v){ready();const r=input(v,['requestId','intentDigest','claimId','phase']),p=binding(r);if(!['before_claim','before_put','before_read','before_publish','before_return','object_read_before','object_read_return'].includes(r.phase))fail('CONTENT_LEDGER_INVALID');const sql='SELECT design_content_manifest.authorize($1::text,$2::text,$3::text,$4::text) AS value',params=[...p,r.phase];return run({...r,sql,params,validate:v=>{if(v!==true)fail();return true;},finalSql:sql,finalParams:params,finalValidate:v=>{if(v!==true)fail();}});},
 publish(v){ready();const r=input(v,['requestId','intentDigest','claimId','manifest']),p=binding(r),m=validateManagedContentManifest(r.manifest);if(m.role!=='source'||m.requestId!==r.requestId||m.intentDigest!==r.intentDigest)fail('CONTENT_LEDGER_INVALID');return run({...r,sql:'SELECT design_content_manifest.publish($1::text,$2::text,$3::text,$4::jsonb) AS value',params:[...p,m],validate:(v,a)=>{const out=validateManagedContentManifest(v,{authority:a,scope:r.scope});if(!equal(out,m))fail();return out;},...finalContext(r),finalValidate:(v,a)=>{const c=context(v,a,{requestId:r.requestId});if(c.state!=='published'||!equal(c.manifest,m)||c.claimId!==r.claimId)fail();}});},
 read(v){ready();const r=input(v,['reference','purpose']);if(!['publication_receipt','object_read'].includes(r.purpose))fail('CONTENT_LEDGER_INVALID');const ref=validateManagedContentManifestReference(r.reference),sql='SELECT design_content_manifest.read_manifest($1::jsonb,$2::text) AS value';return run({...r,sql,params:[ref,r.purpose],validate:(v,a)=>context(v,a,{reference:ref}),finalSql:sql,finalParams:[ref,r.purpose],finalValidate:(v,a,out)=>{if(!equal(context(v,a,{reference:ref}),out))fail();}});},
 reconcile(v){ready();const r=input(v,['requestId']);return run({...r,sql:reconcileSQL,params:[r.requestId],validate:(v,a)=>context(v,a,{requestId:r.requestId}),finalSql:reconcileSQL,finalParams:[r.requestId],finalValidate:(v,a,out)=>{if(!equal(context(v,a,{requestId:r.requestId}),out))fail();}});}
 });
}
/** Independent storage approval only; deployment of this role is NOT authorized
 * by this test draft. This is not a processing/cost/model permission issuer. */
export function createManagedContentStorageIssuer({enabled=false,acquireClient}={}){const run=executor(enabled,acquireClient);return Object.freeze({
 issue(v){const r=input(v,['permissionId','intent','ttlMs']),i=sourceIntent(r.intent);if(!id(r.permissionId)||!Number.isSafeInteger(r.ttlMs)||r.ttlMs<1||r.ttlMs>900000)fail('CONTENT_LEDGER_INVALID');return run({issuer:true,sql:'SELECT design_content_manifest.issue($1::text,$2::jsonb,$3::text,$4::jsonb,$5::bigint) AS value',params:[r.credential,r.scope,r.permissionId,i,r.ttlMs],validate:v=>{if(v!==true)fail();return true;}});},
 issueRead(v){const r=input(v,['permissionId','reference','ttlMs']),ref=validateManagedContentManifestReference(r.reference);if(!id(r.permissionId)||!Number.isSafeInteger(r.ttlMs)||r.ttlMs<1||r.ttlMs>900000)fail('CONTENT_LEDGER_INVALID');return run({issuer:true,sql:'SELECT design_content_manifest.issue_read($1::text,$2::jsonb,$3::text,$4::jsonb,$5::bigint) AS value',params:[r.credential,r.scope,r.permissionId,ref,r.ttlMs],validate:v=>{if(v!==true)fail();return true;}});},
 terminate(v){const r=input(v,['requestId','intentDigest','claimId']),p=binding(r);return run({issuer:true,sql:'SELECT design_content_manifest.terminate($1::text,$2::jsonb,$3::text,$4::text,$5::text) AS value',params:[r.credential,r.scope,...p],validate:v=>{if(v!==true)fail();return true;}});},
 revokeRead(v){let r;try{r=copy(v);exact(r,['permissionId']);if(!id(r.permissionId))fail();}catch{fail('CONTENT_LEDGER_INVALID');}return run({issuer:true,sql:'SELECT design_content_manifest.revoke_read($1::text) AS value',params:[r.permissionId],validate:v=>{if(typeof v!=='boolean')fail();return v;}});},
 revoke(v){let r;try{r=copy(v);exact(r,['permissionId']);if(!id(r.permissionId))fail();}catch{fail('CONTENT_LEDGER_INVALID');}return run({issuer:true,sql:'SELECT design_content_manifest.revoke($1::text) AS value',params:[r.permissionId],validate:v=>{if(typeof v!=='boolean')fail();return v;}});}
});}
