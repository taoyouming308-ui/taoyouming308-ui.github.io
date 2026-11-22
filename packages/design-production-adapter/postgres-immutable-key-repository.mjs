/** Default-closed fixed PostgreSQL capabilities for v2 keys. No installer or credential discovery. */
import {Buffer} from 'node:buffer';
import {types} from 'node:util';
import {policyCopy,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {validateImmutableKeyIdentity,immutableKeyOwner} from './immutable-key-identity.mjs';

const CODES=new Set(['KEY_REPOSITORY_DISABLED','KEY_REPOSITORY_INVALID','KEY_REPOSITORY_DENIED','KEY_REPOSITORY_TRANSACTION_REQUIRED','KEY_REPOSITORY_CLIENT_INVALID','KEY_REPOSITORY_AUTHORITY_CHANGED','KEY_REPOSITORY_COMMIT_UNKNOWN','KEY_REPOSITORY_RELEASE_UNKNOWN']);
export class ImmutableKeyRepositoryError extends Error{
 constructor(code){const safe=CODES.has(code)?code:'KEY_REPOSITORY_DENIED';super(safe);this.name='ImmutableKeyRepositoryError';this.code=safe;this.retryable=false;this.outcome=['KEY_REPOSITORY_COMMIT_UNKNOWN','KEY_REPOSITORY_RELEASE_UNKNOWN'].includes(safe)?'uncertain':'not_committed';}
}
const fail=code=>{throw new ImmutableKeyRepositoryError(code);};
function exact(v,keys){if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('KEY_REPOSITORY_INVALID');}
function ident(v){if(typeof v!=='string'||!v.length||v.length>160||v.trim()!==v||/[\u0000-\u001f\u007f]/.test(v))fail('KEY_REPOSITORY_INVALID');return v;}
function credential(input){const r=policyCopy(input);exact(r,['credential']);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/[\s\u0000-\u001f\u007f]/.test(r.credential))fail('KEY_REPOSITORY_INVALID');return r.credential;}
function revision(v){if(!Number.isSafeInteger(v)||v<0||v>=Number.MAX_SAFE_INTEGER)fail('KEY_REPOSITORY_INVALID');return v;}
const stable=x=>({...immutableKeyOwner(x),securityEpoch:x.securityEpoch,membershipRevision:x.membershipRevision});
const purpose=v=>{if(!['chat','speech'].includes(v))fail('KEY_REPOSITORY_INVALID');return v;};
function intent(input){
 const r=policyCopy(input);exact(r,['schemaVersion','subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','purpose','action','destination','model','expectedRevision','keyDigest']);
 if(r.schemaVersion!=='design-key-approval-v2')fail('KEY_REPOSITORY_INVALID');
 for(const k of ['subjectId','employmentId','membershipId','storeId'])ident(r[k]);
 for(const k of ['securityEpoch','membershipRevision'])if(!Number.isSafeInteger(r[k])||r[k]<1)fail('KEY_REPOSITORY_INVALID');
 purpose(r.purpose);revision(r.expectedRevision);
 if(r.purpose==='chat'?(r.destination!=='https://api.deepseek.com/chat/completions'||typeof r.model!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(r.model)):(r.destination!=='https://api.deepseek.com/v1/tools/asr'||r.model!==null))fail('KEY_REPOSITORY_INVALID');
 if(r.action==='persist-design-key'){
  if(typeof r.keyDigest!=='string'||r.keyDigest.length!==44||Buffer.from(r.keyDigest,'base64').length!==32||Buffer.from(r.keyDigest,'base64').toString('base64')!==r.keyDigest)fail('KEY_REPOSITORY_INVALID');
 }else if(r.action!=='revoke-design-key'||r.keyDigest!==null)fail('KEY_REPOSITORY_INVALID');
 return policyFreeze(r);
}

function executor(enabled,acquireClient){
 const leased=new WeakSet();
 return async work=>{
  if(enabled!==true||typeof acquireClient!=='function')fail('KEY_REPOSITORY_DISABLED');
  let client,owned=false,attempted=false,commitAttempted=false,committed=false,closed=false,busy=false,poisoned=false;
  try{
   client=await acquireClient();
   if(!client||types.isProxy(client)||typeof client.query!=='function'||typeof client.release!=='function'||leased.has(client))fail('KEY_REPOSITORY_CLIENT_INVALID');
   leased.add(client);owned=true;
   const poison=()=>{poisoned=true;};
   const idle=()=>{if(closed||busy||poisoned){poison();fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');}};
   const query=async(sql,params=[])=>{idle();busy=true;try{return await client.query(sql,params);}catch(error){poison();throw error;}finally{busy=false;}};
   const scalar=async(sql,params=[])=>{
    const raw=await query(sql,params);
    if(raw?.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)fail('KEY_REPOSITORY_INVALID');
    const r=policyCopy(raw.rows[0]);exact(r,['value']);return r.value;
   };
   attempted=true;if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('KEY_REPOSITORY_INVALID');
   await query("SET LOCAL statement_timeout='5000ms'");await query("SET LOCAL lock_timeout='2000ms'");await query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await query('SET LOCAL search_path=pg_catalog');
   const result=await work({scalar,query,poison,idle,usable:()=>{if(closed||poisoned)fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');}});
   idle();
   commitAttempted=true;if((await query('COMMIT')).command!=='COMMIT')fail('KEY_REPOSITORY_INVALID');committed=true;return result;
  }catch(error){
   closed=true;let rollbackFailed=busy;if(owned&&attempted&&!committed&&!busy)try{if((await client.query('ROLLBACK')).command!=='ROLLBACK')rollbackFailed=true;}catch{rollbackFailed=true;}
   if(commitAttempted||rollbackFailed)fail('KEY_REPOSITORY_COMMIT_UNKNOWN');
   if(error instanceof ImmutableKeyRepositoryError)throw new ImmutableKeyRepositoryError(error.code);
   fail('KEY_REPOSITORY_DENIED');
  }finally{
   closed=true;
   if(owned){owned=false;try{await client.release(committed?undefined:new Error('Discard immutable key transaction'));leased.delete(client);}catch{fail('KEY_REPOSITORY_RELEASE_UNKNOWN');}}
  }
 };
}

export function createPostgresImmutableKeyRepository({enabled=false,acquireClient}={}){
 const transact=executor(enabled,acquireClient);
 async function withIdentityLock(expected,work){
  if(enabled!==true||typeof work!=='function')fail('KEY_REPOSITORY_DISABLED');
  let fixed;try{fixed=expected===null?null:validateImmutableKeyIdentity(expected);}catch{fail('KEY_REPOSITORY_INVALID');}
  return transact(async db=>{
   let authority=null,token=null,closed=false,operationBusy=false,finalizing=false;const guards=[];
   const idle=()=>{db.idle();if(operationBusy){db.poison();fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');}};
   const operation=fn=>{
    if(closed||operationBusy){db.poison();fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');}
    db.usable();operationBusy=true;
    const pending=(async()=>{try{return await fn();}catch(error){db.poison();throw error;}finally{operationBusy=false;}})();
    void pending.catch(()=>{});return pending;
   };
   const active=()=>{db.usable();if(closed||!authority)fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');};
   const recheck=async()=>{
    active();const current=validateImmutableKeyIdentity(await db.scalar('SELECT design_key_private.recheck_identity($1::jsonb) AS value',[authority]));
    if(!policyEqual(stable(current),stable(authority)))fail('KEY_REPOSITORY_AUTHORITY_CHANGED');return current;
   };
   const tx=Object.freeze({
    resolveIdentity:input=>operation(async()=>{
     db.usable();if(closed)fail('KEY_REPOSITORY_TRANSACTION_REQUIRED');const supplied=credential(input);
     if(authority){if(supplied!==token)fail('KEY_REPOSITORY_AUTHORITY_CHANGED');return recheck();}
     const current=validateImmutableKeyIdentity(await db.scalar('SELECT design_key_private.authenticate($1::text) AS value',[supplied]));
     if(fixed&&!policyEqual(stable(current),stable(fixed)))fail('KEY_REPOSITORY_AUTHORITY_CHANGED');authority=current;token=supplied;return current;
    }),
    read:input=>operation(async()=>{active();return db.scalar('SELECT design_key_private.read_key($1::text) AS value',[purpose(input)]);}),
    consumeKeyApproval:(approval,input)=>operation(async()=>{
     active();const a=policyCopy(approval);exact(a,['receiptId']);ident(a.receiptId);const i=intent(input);
     if(!policyEqual(stable(i),stable(authority)))fail('KEY_REPOSITORY_AUTHORITY_CHANGED');
     const result=await db.scalar('SELECT design_key_private.consume_approval($1::text,$2::jsonb) AS value',[a.receiptId,i]);
     if(typeof result!=='boolean')fail('KEY_REPOSITORY_INVALID');return result;
    }),
    compareAndSwap:(expectedRevision,next)=>operation(async()=>{
     active();revision(expectedRevision);const row=policyCopy(next);
     const result=await db.scalar('SELECT design_key_private.cas_key($1::bigint,$2::jsonb) AS value',[expectedRevision,row]);
     if(typeof result!=='boolean')fail('KEY_REPOSITORY_INVALID');return result;
    }),
    beforeCommit(guard){active();idle();if(finalizing||guards.length>=1||typeof guard!=='function'){db.poison();fail('KEY_REPOSITORY_INVALID');}guards.push(guard);}
   });
   try{
    const result=await work(tx);active();idle();finalizing=true;
    for(const guard of guards){await guard();idle();}await recheck();idle();
    if(await db.scalar('SELECT design_key_private.clear_context() AS value')!=='')fail('KEY_REPOSITORY_INVALID');
    return result;
   }finally{closed=true;}
  });
 }
 return Object.freeze({
  withIdentityLock:(identity,work)=>{if(identity===null)fail('KEY_REPOSITORY_INVALID');return withIdentityLock(identity,work);},
  resolveIdentity:input=>{if(enabled!==true)fail('KEY_REPOSITORY_DISABLED');const token=credential(input);return withIdentityLock(null,tx=>tx.resolveIdentity({credential:token}));},
 });
}

/** Independent issuer-only connection. Never put this factory on a public key route. */
export function createPostgresKeyApprovalIssuer({enabled=false,acquireIssuerClient}={}){
 const transact=executor(enabled,acquireIssuerClient);
 return Object.freeze({
  async issue(input){
   if(enabled!==true)fail('KEY_REPOSITORY_DISABLED');
   let r;try{r=policyCopy(input);exact(r,['credential','receiptId','intent','ttlMs']);credential({credential:r.credential});ident(r.receiptId);r.intent=intent(r.intent);if(!Number.isSafeInteger(r.ttlMs)||r.ttlMs<1||r.ttlMs>300000)fail('KEY_REPOSITORY_INVALID');}catch(error){if(error instanceof ImmutableKeyRepositoryError)throw error;fail('KEY_REPOSITORY_INVALID');}
   return transact(async db=>{
    const found=await db.scalar('SELECT design_key_private.issue_approval($1::text,$2::text,$3::jsonb,$4::bigint) AS value',[r.credential,r.receiptId,r.intent,r.ttlMs]);
    exact(found,['receiptId','issuedAt','expiresAt']);
    if(found.receiptId!==r.receiptId||!Number.isSafeInteger(found.issuedAt)||found.issuedAt<0||!Number.isSafeInteger(found.expiresAt)||found.expiresAt<=found.issuedAt||found.expiresAt-found.issuedAt>r.ttlMs)fail('KEY_REPOSITORY_INVALID');
    return policyFreeze(found);
   });
  },
  async revoke(input){
   if(enabled!==true)fail('KEY_REPOSITORY_DISABLED');const r=policyCopy(input);exact(r,['receiptId']);ident(r.receiptId);
   return transact(async db=>{const result=await db.scalar('SELECT design_key_private.revoke_approval($1::text) AS value',[r.receiptId]);if(typeof result!=='boolean')fail('KEY_REPOSITORY_INVALID');return result;});
  }
 });
}
