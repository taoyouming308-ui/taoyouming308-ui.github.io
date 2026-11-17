/** New immutable-authority capability slice. No connections/DDL/credentials by default. */
import {types as nodeTypes} from 'node:util';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const CODES=new Set(['IDENTITY_INVALID_REQUEST','IDENTITY_RESULT_INVALID','IDENTITY_NOT_CONFIGURED','IDENTITY_SCOPE_DENIED','IDENTITY_AUTHORITY_CHANGED','IDENTITY_DISABLED','IDENTITY_CLIENT_ALREADY_LEASED','IDENTITY_TRANSACTION_INVALID','IDENTITY_OUTCOME_UNCERTAIN','IDENTITY_ACCESS_DENIED']);
export class IdentityCapabilityError extends Error{constructor(code,outcome='not_committed'){code=CODES.has(code)?code:'IDENTITY_ACCESS_DENIED';super(code);this.name='IdentityCapabilityError';this.code=code;this.outcome=outcome==='uncertain'?'uncertain':'not_committed';this.retryable=false;}}
const fail=code=>{throw new IdentityCapabilityError(code);};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const equal=(a,b)=>canonical(a)===canonical(b);
function own(value,keys){
 if(nodeTypes.isProxy(value)||!value||Object.getPrototypeOf(value)!==Object.prototype)fail('IDENTITY_INVALID_REQUEST');
 const names=Reflect.ownKeys(value);if(names.length!==keys.length||names.some(k=>!keys.includes(k)))fail('IDENTITY_INVALID_REQUEST');
 const copy={};for(const key of names){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('IDENTITY_INVALID_REQUEST');copy[key]=d.value;}return copy;
}
function request(input){
 const fixed=own(input,['credential','scope']),scope=own(fixed.scope,['customerProfileId','visitId','assignmentSource']);
 if(Object.values(scope).some(v=>typeof v!=='string'))fail('IDENTITY_INVALID_REQUEST');
 if(typeof fixed.credential!=='string'||fixed.credential.length<32||fixed.credential.length>200||/[\s\u0000-\u001f\u007f]/.test(fixed.credential))fail('IDENTITY_INVALID_REQUEST');
 try{return {credential:fixed.credential,scope:validateProductionDesignScope(scope)};}catch{fail('IDENTITY_INVALID_REQUEST');}
}
async function result(client,sql,params,key){
 let r;try{r=await client.query(sql,params);}catch{fail('IDENTITY_ACCESS_DENIED');}if(!r||!Array.isArray(r.rows)||r.rows.length!==1||r.rowCount!==1)fail('IDENTITY_RESULT_INVALID');
 const row=own(r.rows[0],[key]);return row[key];
}
/** Trusted same-transaction seam. Caller owns BEGIN/guards/COMMIT/ROLLBACK.
 * Methods never create another connection and never accept an actor or GUC.
 */
export function createIdentityCapabilityOperations(client){
 if(typeof client?.query!=='function')fail('IDENTITY_NOT_CONFIGURED');
 return Object.freeze({
  async resolveAuthority(input){const fixed=request(input);const found=validateImmutableDesignAuthority(await result(client,'SELECT design_identity.authorize($1::text,$2::jsonb) AS authority',[fixed.credential,fixed.scope],'authority'));if(!equal(found.scope,fixed.scope))fail('IDENTITY_SCOPE_DENIED');return found;},
  async recheck(expected){const fixed=validateImmutableDesignAuthority(expected),found=validateImmutableDesignAuthority(await result(client,'SELECT design_identity.recheck_authority() AS authority',[],'authority'));if(!equal(found,fixed))fail('IDENTITY_AUTHORITY_CHANGED');return found;},
  async readScopeRecords(){return result(client,'SELECT design_identity.read_scope_records() AS records',[],'records');},
  async clear(){if(await result(client,'SELECT design_identity.clear_context() AS cleared',[],'cleared')!=='')fail('IDENTITY_RESULT_INVALID');},
 });
}
/** Separate fresh transactions; structural equality cannot replace either read. */
export function createIdentityCapabilityAdapter({enabled=false,acquireClient}={}){
 const leased=new WeakSet();
 async function once(fixed){
  if(enabled!==true)fail('IDENTITY_DISABLED');if(typeof acquireClient!=='function')fail('IDENTITY_NOT_CONFIGURED');
  let client,owned=false,begun=false,beginAttempted=false,commitAttempted=false,committed=false;
  try{
   client=await acquireClient();if(!client||typeof client.query!=='function'||typeof client.release!=='function')fail('IDENTITY_NOT_CONFIGURED');if(leased.has(client))fail('IDENTITY_CLIENT_ALREADY_LEASED');leased.add(client);owned=true;
   beginAttempted=true;if((await client.query('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')fail('IDENTITY_TRANSACTION_INVALID');begun=true;
   await client.query("SET LOCAL lock_timeout = '5s'",[]);await client.query("SET LOCAL statement_timeout = '30s'",[]);await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'",[]);await client.query('SET LOCAL search_path = pg_catalog',[]);
   const operations=createIdentityCapabilityOperations(client),authority=await operations.resolveAuthority(fixed);await operations.recheck(authority);await operations.clear();
   commitAttempted=true;if((await client.query('COMMIT',[])).command!=='COMMIT')fail('IDENTITY_TRANSACTION_INVALID');committed=true;return authority;
  }catch(error){
   let rollbackFailed=false;if(owned&&beginAttempted&&!committed)try{await client.query('ROLLBACK',[]);}catch{rollbackFailed=true;}
   if(commitAttempted||rollbackFailed||beginAttempted&&!begun)throw new IdentityCapabilityError('IDENTITY_OUTCOME_UNCERTAIN','uncertain');
   if(error instanceof IdentityCapabilityError)throw new IdentityCapabilityError(error.code);
   throw new IdentityCapabilityError('IDENTITY_ACCESS_DENIED');
  }finally{if(owned)try{await client.release(committed?undefined:new Error('Discard identity capability transaction'));leased.delete(client);}catch{/* Quarantine an uncertain release; never reuse the same object. */}}
 }
 return Object.freeze({async resolveAuthority(input){if(enabled!==true)fail('IDENTITY_DISABLED');const fixed=request(input),first=await once(fixed),latest=await once(fixed);if(!equal(first,latest))fail('IDENTITY_AUTHORITY_CHANGED');return latest;}});
}
