/** Default-closed fixed local canonical verifier repository. No image processing,
 * credential creation, production migration, model authority or transport here. */
import {types} from 'node:util';
import {policyCopy as copy,policyExact as exact,policyEqual as equal,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {managedImageDigest as digest} from './managed-image-contracts.mjs';
import {validateManagedNormalizedStrictTask,validateManagedNormalizedStrictReport} from './managed-normalized-strict-contracts.mjs';
export class CanonicalVerificationLedgerError extends Error{constructor(code='CANONICAL_LEDGER_DENIED'){const c=['CANONICAL_LEDGER_DISABLED','CANONICAL_LEDGER_INVALID','CANONICAL_LEDGER_DENIED','CANONICAL_LEDGER_UNCERTAIN'].includes(code)?code:'CANONICAL_LEDGER_DENIED';super(c);this.code=c;this.retryable=false;this.outcome=c==='CANONICAL_LEDGER_UNCERTAIN'?'uncertain':'not_sent';}}
const fail=c=>{throw new CanonicalVerificationLedgerError(c);},held=new WeakSet(),poisoned=new WeakSet(),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function input(v,keys){try{const r=copy(v);exact(r,keys);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/[\s\x00-\x1f\x7f]/.test(r.credential))fail();r.scope=validateProductionDesignScope(r.scope);if(!id(r.taskId))fail();return r;}catch{fail('CANONICAL_LEDGER_INVALID');}}
const scalar=r=>{if(r?.command!=='SELECT'||r.rowCount!==1||r.rows?.length!==1)fail();const o=copy(r.rows[0]);exact(o,['value']);return o.value;};
function executor(enabled,acquire){return async(sql,params,validate)=>{
 if(enabled!==true||typeof acquire!=='function')fail('CANONICAL_LEDGER_DISABLED');let c,query,release,owned=false,started=false,committing=false,committed=false;
 try{c=await acquire();if(!c||types.isProxy(c)||held.has(c)||poisoned.has(c))fail();const method=k=>{const d=Object.getOwnPropertyDescriptor(c,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return(...a)=>Reflect.apply(d.value,c,a);};query=method('query');release=method('release');held.add(c);owned=true;started=true;
  if((await query('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')fail();for(const s of ["SET LOCAL statement_timeout='5000ms'","SET LOCAL lock_timeout='2000ms'","SET LOCAL idle_in_transaction_session_timeout='10000ms'",'SET LOCAL search_path=pg_catalog'])await query(s,[]);
  const out=validate(scalar(await query(sql,params)));committing=true;if((await query('COMMIT',[])).command!=='COMMIT')fail();committed=true;return freeze(out);
 }catch(e){let unknown=false;if(owned&&started&&!committed)try{if((await query('ROLLBACK',[])).command!=='ROLLBACK')unknown=true;}catch{unknown=true;}if(committing||unknown){if(owned)poisoned.add(c);fail('CANONICAL_LEDGER_UNCERTAIN');}if(!types.isProxy(e)&&e instanceof CanonicalVerificationLedgerError){const d=Object.getOwnPropertyDescriptor(e,'code');throw new CanonicalVerificationLedgerError(d&&Object.hasOwn(d,'value')?d.value:undefined);}fail();}
 finally{if(owned){try{await release(committed?undefined:Error('Discard canonical verification lease'));}catch{poisoned.add(c);fail('CANONICAL_LEDGER_UNCERTAIN');}finally{held.delete(c);}}}
};}
function task(v,q){const t=validateManagedNormalizedStrictTask(v);if(t.taskId!==q.taskId||!equal(t.claimedArtifact.artifact.authority.scope,q.scope)||(q.requestId!==undefined&&t.claimedArtifact.artifact.requestId!==q.requestId))fail();return t;}
function packet(v,q,complete=false){const p=copy(v);exact(p,['task','report']);p.task=task(p.task,q);p.report=validateManagedNormalizedStrictReport(p.report,p.task);if(complete&&p.report.state!=='evidence_complete')fail();return p;}
export function createCanonicalVerificationLedger({enabled=false,acquireClient}={}){const run=executor(enabled,acquireClient);return Object.freeze({
 readStatus(value){const q=input(value,['credential','scope','taskId']);return run('SELECT design_canonical_verification.read_status($1::text,$2::jsonb,$3::text) AS value',[q.credential,q.scope,q.taskId],v=>packet(v,q));},
 readVerified(value){const q=input(value,['credential','scope','taskId']);return run('SELECT design_canonical_verification.read_verified($1::text,$2::jsonb,$3::text) AS value',[q.credential,q.scope,q.taskId],v=>packet(v,q,true));}
});}
export function createCanonicalVerificationIssuers({enabled=false,acquireAuthorizerClient,acquireVerifierClient}={}){
 const authorizer=executor(enabled,acquireAuthorizerClient),verifier=executor(enabled,acquireVerifierClient);
 return Object.freeze({
 issueTask(value){const q=input(value,['credential','scope','taskId','requestId','ttlMs']);if(!id(q.requestId)||!Number.isSafeInteger(q.ttlMs)||q.ttlMs<1||q.ttlMs>900000)fail('CANONICAL_LEDGER_INVALID');return authorizer('SELECT design_canonical_verification.issue_task($1::text,$2::jsonb,$3::text,$4::text,$5::bigint) AS value',[q.credential,q.scope,q.taskId,q.requestId,q.ttlMs],v=>task(v,q));},
 readTask(value){const q=input(value,['credential','scope','taskId']);return verifier('SELECT design_canonical_verification.read_task($1::text,$2::jsonb,$3::text) AS value',[q.credential,q.scope,q.taskId],v=>task(v,q));},
 guardTask(value){const q=input(value,['credential','scope','taskId','taskDigest']);if(typeof q.taskDigest!=='string'||!/^[a-f0-9]{64}$/.test(q.taskDigest))fail('CANONICAL_LEDGER_INVALID');return verifier('SELECT design_canonical_verification.guard_task($1::text,$2::jsonb,$3::text,$4::text) AS value',[q.credential,q.scope,q.taskId,q.taskDigest],v=>{if(v!==true)fail();return true;});},
 publishReport(value){const q=input(value,['credential','scope','taskId','report']),r=copy(q.report);return verifier('SELECT design_canonical_verification.publish_report($1::text,$2::jsonb,$3::text,$4::jsonb) AS value',[q.credential,q.scope,q.taskId,r],v=>{const p=packet(v,q);if(!equal(p.report,r))fail();return p;});},
 revoke(value){const q=copy(value);exact(q,['kind','id']);if(!['task','report'].includes(q.kind)||!id(q.id))fail('CANONICAL_LEDGER_INVALID');return(q.kind==='task'?authorizer:verifier)('SELECT design_canonical_verification.revoke($1::text,$2::text) AS value',[q.kind,q.id],v=>{if(typeof v!=='boolean')fail();return v;});}
 });
}
