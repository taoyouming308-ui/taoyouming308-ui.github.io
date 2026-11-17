/** Default-closed fixed Stage33 calls. No byte I/O or implicit verification authority. */
import {types} from 'node:util';
import {validateManagedNormalizedObjectReceipt,validateManagedNormalizedVerificationReport,buildManagedNormalizedVerificationBinding} from './managed-normalized-verification-contracts.mjs';
import {validateManagedImageNormalizationArtifact} from './managed-image-normalization-contracts.mjs';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageDigest} from './managed-image-contracts.mjs';
import {validateManagedImageCost} from './managed-image-ledger-contracts.mjs';

export class ManagedNormalizedLedgerError extends Error{constructor(code='MANAGED_NORMALIZED_LEDGER_DENIED'){super(['MANAGED_NORMALIZED_LEDGER_DISABLED','MANAGED_NORMALIZED_LEDGER_INVALID','MANAGED_NORMALIZED_LEDGER_DENIED','MANAGED_NORMALIZED_LEDGER_UNCERTAIN'].includes(code)?code:'MANAGED_NORMALIZED_LEDGER_DENIED');this.code=this.message;this.retryable=false;this.outcome=this.code==='MANAGED_NORMALIZED_LEDGER_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new ManagedNormalizedLedgerError(c);},held=new WeakSet(),quarantined=new WeakSet();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function input(v,keys){try{const r=copy(v);exact(r,keys);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/[\s\x00-\x1f\x7f]/.test(r.credential))fail('MANAGED_NORMALIZED_LEDGER_INVALID');if(r.scope)r.scope=validateProductionDesignScope(r.scope);return r;}catch{fail('MANAGED_NORMALIZED_LEDGER_INVALID');}}
const scalar=r=>{if(r?.command!=='SELECT'||r.rowCount!==1||r.rows?.length!==1)fail();const row=copy(r.rows[0]);exact(row,['value']);return row.value;};
function executor(enabled,acquire){return async({credential,scope,sql,params=[],validate=x=>x,finalSql,finalParams=params,issuer=false})=>{
 if(enabled!==true||typeof acquire!=='function')fail('MANAGED_NORMALIZED_LEDGER_DISABLED');let c,q,release,started=false,committing=false,committed=false,owned=false;
 try{c=await acquire();if(!c||types.isProxy(c)||held.has(c)||quarantined.has(c))fail();const method=k=>{const d=Object.getOwnPropertyDescriptor(c,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return (...a)=>Reflect.apply(d.value,c,a);};q=method('query');release=method('release');held.add(c);owned=true;started=true;if((await q('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')fail();for(const s of ["SET LOCAL statement_timeout='5000ms'","SET LOCAL lock_timeout='2000ms'","SET LOCAL idle_in_transaction_session_timeout='10000ms'",'SET LOCAL search_path=pg_catalog'])await q(s,[]);
 let authority=null;if(!issuer)authority=validateImmutableDesignAuthority(scalar(await q('SELECT design_identity.authorize($1::text,$2::jsonb) AS value',[credential,scope])));
 const value=validate(scalar(await q(sql,params)),authority);
 if(!issuer){const current=validateImmutableDesignAuthority(scalar(await q('SELECT design_identity.recheck_authority() AS value',[])));if(!equal(current,authority))fail();if(finalSql){const checked=scalar(await q(finalSql,finalParams));if(finalSql===sql){if(!equal(validate(checked,current),value))fail();}else if(checked!==true)fail();}if(scalar(await q('SELECT design_identity.clear_context() AS value',[]))!=='')fail();}
 committing=true;if((await q('COMMIT',[])).command!=='COMMIT')fail();committed=true;return freeze(value);
 }catch(e){let unknown=false;if(owned&&started&&!committed)try{if((await q('ROLLBACK',[])).command!=='ROLLBACK')unknown=true;}catch{unknown=true;}if(committing||unknown){if(owned)quarantined.add(c);fail('MANAGED_NORMALIZED_LEDGER_UNCERTAIN');}if(!types.isProxy(e)&&e instanceof ManagedNormalizedLedgerError){const code=Object.getOwnPropertyDescriptor(e,'code');throw new ManagedNormalizedLedgerError(code&&Object.hasOwn(code,'value')?code.value:undefined);}fail();}
 finally{if(owned){try{await release(committed?undefined:Error('Discard managed lease'));}catch{quarantined.add(c);fail('MANAGED_NORMALIZED_LEDGER_UNCERTAIN');}finally{held.delete(c);}}}
};}
const digestId=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('MANAGED_NORMALIZED_LEDGER_INVALID');return v;};
/** Structural fixed intent, not a grant. The independent SQL issuer supplies permission. */
export function validateManagedNormalizedPutIntent(value){try{
 const i=copy(value);exact(i,['schemaVersion','artifact','target','cost']);
 if(i.schemaVersion!=='design-managed-normalized-put-intent-v1')fail();
 i.artifact=validateManagedImageNormalizationArtifact(i.artifact);i.cost=validateManagedImageCost(i.cost);
 const s=i.artifact.sourceRecord.object;
 if(!equal(i.target,{projectOrigin:s.projectOrigin,bucket:s.bucket,key:'managed-normalized/'+managedImageDigest(i.artifact)+'/object'}))fail();
 return freeze(i);
 }catch{fail('MANAGED_NORMALIZED_LEDGER_INVALID');}}
function context(v,{report=false,authority=null,taskId=null}={}){
 const c=copy(v);exact(c,['taskId','artifact','objectReceipt','verifier','policyVersion',...(report?['verificationReport']:[])]);
 if(!id(c.taskId)||(taskId!==null&&c.taskId!==taskId))fail();
 c.artifact=validateManagedImageNormalizationArtifact(c.artifact);
 if(authority&&!equal(c.artifact.authority,authority))fail();
 c.objectReceipt=validateManagedNormalizedObjectReceipt(c.objectReceipt,{artifact:c.artifact});
 const expected={taskId:c.taskId,artifact:c.artifact,objectReceipt:c.objectReceipt,verifier:c.verifier,policyVersion:c.policyVersion};
 buildManagedNormalizedVerificationBinding(expected);
 if(report)c.verificationReport=validateManagedNormalizedVerificationReport(c.verificationReport,expected);
 return freeze(c);
}
export function createManagedNormalizedLedger({enabled=false,acquireClient}={}){
 const run=executor(enabled,acquireClient),ready=()=>{if(enabled!==true)fail('MANAGED_NORMALIZED_LEDGER_DISABLED');};
 const object=(value,write)=>{ready();const r=input(value,['credential','scope','artifactDigest',...(write?['receipt']:[])]),ad=digestId(r.artifactDigest),sql=`SELECT design_managed_normalized.${write?'publish_object($1::text,$2::jsonb)':'read_object($1::text)'} AS value`;
  // SQL returns its trusted artifact alongside the receipt. Validate using it,
  // never using a caller-supplied self-consistent artifact as evidence.
  return run({...r,sql,params:write?[ad,r.receipt]:[ad],validate:(v,a)=>{exact(v,['artifact','objectReceipt']);const artifact=validateManagedImageNormalizationArtifact(v.artifact);if(managedImageDigest(artifact)!==ad||!equal(artifact.authority,a))fail();const receipt=validateManagedNormalizedObjectReceipt(v.objectReceipt,{artifact});if(write&&!equal(receipt,r.receipt))fail();return v;},finalSql:sql}).then(v=>v.objectReceipt);
 };
 const read=(value,complete)=>{ready();const r=input(value,['credential','scope','taskId']);if(!id(r.taskId))fail('MANAGED_NORMALIZED_LEDGER_INVALID');const sql=`SELECT design_managed_normalized.${complete?'read_verified':'read_verification_status'}($1::text) AS value`;return run({...r,sql,params:[r.taskId],validate:(v,a)=>{const c=context(v,{report:true,authority:a,taskId:r.taskId});if(complete&&c.verificationReport.state!=='evidence_complete')fail();return c;},finalSql:sql});};
 return Object.freeze({
 claimPut(value){ready();const r=input(value,['credential','scope','intent']),i=validateManagedNormalizedPutIntent(r.intent);return run({...r,sql:'SELECT design_managed_normalized.claim_put($1::jsonb) AS value',params:[i],validate:(v,a)=>{if(!equal(a,i.artifact.authority)||!['created','already_claimed'].includes(v))fail();return v;},finalSql:'SELECT design_managed_normalized.guard_put($1::jsonb) AS value'});},
 guardPut(value){ready();const r=input(value,['credential','scope','intent']),i=validateManagedNormalizedPutIntent(r.intent),sql='SELECT design_managed_normalized.guard_put($1::jsonb) AS value';return run({...r,sql,params:[i],validate:(v,a)=>{if(v!==true||!equal(a,i.artifact.authority))fail();return true;},finalSql:sql});},
 publishObject:v=>object(v,true),readObject:v=>object(v,false),
 readVerificationStatus:v=>read(v,false),readVerifiedInput:v=>read(v,true)
 });
}
export function createManagedNormalizedIssuers({enabled=false,acquireStorageIssuerClient,acquireVerifierAuthorizerClient,acquireVerifierClient}={}){
 const runs={permission:executor(enabled,acquireStorageIssuerClient),task:executor(enabled,acquireVerifierAuthorizerClient),report:executor(enabled,acquireVerifierClient)},ready=()=>{if(enabled!==true)fail('MANAGED_NORMALIZED_LEDGER_DISABLED');};
 const ttl=v=>{if(!Number.isSafeInteger(v)||v<1||v>900000)fail('MANAGED_NORMALIZED_LEDGER_INVALID');return v;};
 return Object.freeze({
 issuePut(value){ready();const r=input(value,['credential','scope','receiptId','intent','ttlMs']);if(!id(r.receiptId))fail();return runs.permission({issuer:true,sql:'SELECT design_managed_normalized.issue_put($1::text,$2::jsonb,$3::text,$4::jsonb,$5::bigint) AS value',params:[r.credential,r.scope,r.receiptId,validateManagedNormalizedPutIntent(r.intent),ttl(r.ttlMs)],validate:v=>{if(v!==true)fail();return true;}});},
 issueVerificationTask(value){ready();const r=input(value,['credential','scope','taskId','artifactDigest','verifier','policyVersion','ttlMs']);if(!id(r.taskId)||!id(r.verifier?.id)||typeof r.verifier?.version!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(r.verifier.version)||typeof r.policyVersion!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(r.policyVersion))fail();exact(r.verifier,['id','version']);return runs.task({issuer:true,sql:'SELECT design_managed_normalized.issue_task($1::text,$2::jsonb,$3::text,$4::text,$5::jsonb,$6::text,$7::bigint) AS value',params:[r.credential,r.scope,r.taskId,digestId(r.artifactDigest),r.verifier,r.policyVersion,ttl(r.ttlMs)],validate:v=>{if(v!==true)fail();return true;}});},
 readVerificationTask(value){ready();const r=input(value,['credential','scope','taskId']);if(!id(r.taskId))fail();return runs.report({issuer:true,sql:'SELECT design_managed_normalized.read_task($1::text,$2::jsonb,$3::text) AS value',params:[r.credential,r.scope,r.taskId],validate:v=>context(v,{taskId:r.taskId})});},
 checkVerificationBinding(value){ready();const r=input(value,['credential','scope','taskId','binding']);if(!id(r.taskId))fail();return runs.report({issuer:true,sql:'SELECT design_managed_normalized.guard_task($1::text,$2::jsonb,$3::text,$4::jsonb) AS value',params:[r.credential,r.scope,r.taskId,r.binding],validate:v=>{if(v!==true)fail();return true;}});},
 publishVerification(value){ready();const r=input(value,['credential','scope','taskId','report']);if(!id(r.taskId))fail();return runs.report({issuer:true,sql:'SELECT design_managed_normalized.publish_report($1::text,$2::jsonb,$3::text,$4::jsonb) AS value',params:[r.credential,r.scope,r.taskId,r.report],validate:v=>{const c=context(v,{report:true,taskId:r.taskId});if(!equal(c.verificationReport,r.report))fail();return c;}});},
 revoke(value){ready();const r=copy(value);exact(r,['kind','id']);if(!Object.hasOwn(runs,r.kind)||!id(r.id))fail();return runs[r.kind]({issuer:true,sql:'SELECT design_managed_normalized.revoke($1::text,$2::text) AS value',params:[r.kind,r.id],validate:v=>{if(typeof v!=='boolean')fail();return v;}});}
 });
}
