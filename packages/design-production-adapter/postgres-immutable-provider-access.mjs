/** Fixed, default-closed provider key/context access. No network, secret lookup or issuer fallback. */
import {types} from 'node:util';
import {createPostgresProviderPolicyRepository} from './postgres-provider-policy-repository.mjs';
import {policyCopy,policyExact,policyEqual,policyFreeze,policyId,validatePolicyAuthority,validatePolicyScope,validatePolicyIntent,validateProviderKeyBinding,validateProviderSourceBinding} from './approval-attempt-contracts.mjs';
const CODES=new Set(['PROVIDER_ACCESS_DISABLED','PROVIDER_ACCESS_INVALID','PROVIDER_ACCESS_DENIED','PROVIDER_ACCESS_CHANGED','PROVIDER_ACCESS_COMMIT_UNKNOWN','PROVIDER_ACCESS_RELEASE_UNKNOWN']);
export class ImmutableProviderAccessError extends Error{
 constructor(code){const safe=CODES.has(code)?code:'PROVIDER_ACCESS_DENIED';super(safe);this.name='ImmutableProviderAccessError';this.code=safe;this.retryable=false;this.outcome=safe.endsWith('_UNKNOWN')?'uncertain':'not_sent';}
}
const fail=code=>{throw new ImmutableProviderAccessError(code);};
function token(value){if(typeof value!=='string'||value.length<32||value.length>200||/[\s\u0000-\u001f\u007f]/.test(value))fail('PROVIDER_ACCESS_INVALID');return value;}
function request(value,keys){try{const r=policyCopy(value);policyExact(r,keys);token(r.credential);if(Object.hasOwn(r,'scope'))r.scope=validatePolicyScope(r.scope);if(Object.hasOwn(r,'requestId'))policyId(r.requestId);if(Object.hasOwn(r,'receiptId'))policyId(r.receiptId);if(Object.hasOwn(r,'purpose')&&!['chat','speech'].includes(r.purpose))fail('PROVIDER_ACCESS_INVALID');return r;}catch{fail('PROVIDER_ACCESS_INVALID');}}
function context(value,fixed){
 try{
  const v=policyCopy(value);policyExact(v,['authority','keyRecord','keyBinding','sourceBinding']);
  v.authority=validatePolicyAuthority(v.authority);v.keyBinding=validateProviderKeyBinding(v.keyBinding);v.sourceBinding=validateProviderSourceBinding(v.sourceBinding);
  if(!policyEqual(v.authority.scope,fixed.scope)||v.keyBinding.purpose!==fixed.purpose)fail('PROVIDER_ACCESS_DENIED');
  const a=v.authority,k=v.keyBinding,r=v.keyRecord;policyExact(r,['schemaVersion','owner','securityEpoch','membershipRevision','purpose','revision','enabled','destination','model','sealed']);
  if(r.schemaVersion!=='design-key-record-v2'||r.enabled!==true||!policyEqual(k.owner,{subjectId:a.subjectId,employmentId:a.employmentId,membershipId:a.membershipId,storeId:a.storeId}))fail('PROVIDER_ACCESS_DENIED');
  for(const name of ['owner','securityEpoch','membershipRevision','purpose','revision','destination','model'])if(!policyEqual(r[name],k[name]))fail('PROVIDER_ACCESS_DENIED');
  if(r.securityEpoch!==a.securityEpoch||r.membershipRevision!==a.membershipRevision)fail('PROVIDER_ACCESS_DENIED');
  policyExact(r.sealed,['v','iv','data']);if(r.sealed.v!==2||typeof r.sealed.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(r.sealed.iv)||typeof r.sealed.data!=='string'||r.sealed.data.length<24||r.sealed.data.length>5464||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.sealed.data))fail('PROVIDER_ACCESS_DENIED');
  return policyFreeze(v);
 }catch{fail('PROVIDER_ACCESS_DENIED');}
}
function receipt(value,fixed){
 try{
  const r=policyCopy(value);policyExact(r,['receiptId','authority','intent','issuedAt','expiresAt']);policyId(r.receiptId);r.authority=validatePolicyAuthority(r.authority);r.intent=validatePolicyIntent(r.intent);
  if(r.intent.schemaVersion!=='design-provider-intent-v2'||r.intent.kind!=='external'||r.intent.requestId!==fixed.requestId||!policyEqual(r.authority.scope,fixed.scope)||!Number.isSafeInteger(r.issuedAt)||r.issuedAt<0||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=r.issuedAt||r.expiresAt-r.issuedAt>900000)fail('PROVIDER_ACCESS_DENIED');
  return policyFreeze(r);
 }catch{fail('PROVIDER_ACCESS_DENIED');}
}
export function createPostgresImmutableProviderAccess({enabled=false,acquireClient}={}){
 const repository=createPostgresProviderPolicyRepository({enabled,acquireClient,immutableKeyBinding:true});
 const ready=()=>{if(enabled!==true||typeof acquireClient!=='function')fail('PROVIDER_ACCESS_DISABLED');};
 async function once(fixed,read,validate){return repository.withTransaction(async tx=>{const authority=validatePolicyAuthority(await tx.resolveAuthority({credential:fixed.credential,scope:fixed.scope}));const value=validate(await read(tx),fixed);if(!policyEqual(value.authority,authority))fail('PROVIDER_ACCESS_CHANGED');return value;});}
 async function twice(fixed,read,validate){
  try{const first=await once(fixed,read,validate),last=await once(fixed,read,validate);if(!policyEqual(first,last))fail('PROVIDER_ACCESS_CHANGED');return last;}
  catch(e){if(e instanceof ImmutableProviderAccessError)throw new ImmutableProviderAccessError(e.code);if(e?.outcome==='uncertain')fail('PROVIDER_ACCESS_COMMIT_UNKNOWN');fail('PROVIDER_ACCESS_DENIED');}
 }
 return Object.freeze({
  readContext(input){ready();const fixed=request(input,['credential','scope','purpose','requestId']);return twice(fixed,tx=>tx.readProviderContext({purpose:fixed.purpose,requestId:fixed.requestId}),context);},
  readApproval(input){ready();const fixed=request(input,['credential','scope','requestId']);return twice(fixed,tx=>tx.readIssuedApproval(fixed.requestId),receipt);},
  createPolicyRepository(){ready();return repository;}
 });
}
const issuerLeases=new WeakSet();
/** Separate trusted issuer LOGIN only. Never expose this factory through runtime HTTP. */
export function createPostgresProviderApprovalIssuer({enabled=false,acquireIssuerClient}={}){
 async function execute(sql,params,validate){
  if(enabled!==true||typeof acquireIssuerClient!=='function')fail('PROVIDER_ACCESS_DISABLED');
  let client,owned=false,attempted=false,commitAttempted=false,committed=false;
  try{
   client=await acquireIssuerClient();if(!client||types.isProxy(client)||typeof client.query!=='function'||typeof client.release!=='function'||issuerLeases.has(client))fail('PROVIDER_ACCESS_INVALID');issuerLeases.add(client);owned=true;
   attempted=true;if((await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('PROVIDER_ACCESS_INVALID');
   await client.query("SET LOCAL statement_timeout='5000ms'");await client.query("SET LOCAL lock_timeout='2000ms'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog');
   const raw=await client.query(sql,params);if(raw?.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)fail('PROVIDER_ACCESS_INVALID');const row=policyCopy(raw.rows[0]);policyExact(row,['value']);const out=validate(row.value);
   commitAttempted=true;if((await client.query('COMMIT')).command!=='COMMIT')fail('PROVIDER_ACCESS_INVALID');committed=true;return out;
  }catch(error){let rollbackFailed=false;if(owned&&attempted&&!committed)try{if((await client.query('ROLLBACK')).command!=='ROLLBACK')rollbackFailed=true;}catch{rollbackFailed=true;}if(commitAttempted||rollbackFailed)fail('PROVIDER_ACCESS_COMMIT_UNKNOWN');if(error instanceof ImmutableProviderAccessError)throw new ImmutableProviderAccessError(error.code);fail('PROVIDER_ACCESS_DENIED');}
  finally{if(owned)try{await client.release(committed?undefined:new Error('Discard provider issuer transaction'));issuerLeases.delete(client);}catch{fail('PROVIDER_ACCESS_RELEASE_UNKNOWN');}}
 }
 return Object.freeze({
  issue(input){
   if(enabled!==true)fail('PROVIDER_ACCESS_DISABLED');const r=request(input,['credential','scope','receiptId','intent','ttlMs']);
   try{r.intent=validatePolicyIntent(r.intent);if(r.intent.schemaVersion!=='design-provider-intent-v2'||r.intent.kind!=='external'||!Number.isSafeInteger(r.ttlMs)||r.ttlMs<1||r.ttlMs>900000)fail('PROVIDER_ACCESS_INVALID');}catch{fail('PROVIDER_ACCESS_INVALID');}
   return execute('SELECT design_provider_binding.issue_approval($1::text,$2::jsonb,$3::text,$4::jsonb,$5::bigint) AS value',[r.credential,r.scope,r.receiptId,r.intent,r.ttlMs],value=>{const found=receipt(value,{scope:r.scope,requestId:r.intent.requestId});if(found.receiptId!==r.receiptId||!policyEqual(found.intent,r.intent)||found.expiresAt-found.issuedAt>r.ttlMs)fail('PROVIDER_ACCESS_DENIED');return found;});
  },
  revoke(input){if(enabled!==true)fail('PROVIDER_ACCESS_DISABLED');let r;try{r=policyCopy(input);policyExact(r,['receiptId']);policyId(r.receiptId);}catch{fail('PROVIDER_ACCESS_INVALID');}return execute('SELECT design_provider_binding.revoke_approval($1::text) AS value',[r.receiptId],value=>{if(typeof value!=='boolean')fail('PROVIDER_ACCESS_DENIED');return value;});}
 });
}
