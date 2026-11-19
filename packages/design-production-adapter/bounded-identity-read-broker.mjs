/** Default-closed fixed-operation facade. Caller has no SQL, transaction or settings channel.
 * This is NOT protection against trusted broker code or DB credential compromise. */
import {types} from 'node:util';
import {createIdentityCapabilityOperations} from './identity-capability-postgres.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {policyCopy,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
const CODES=new Set(['BROKER_INVALID_REQUEST','BROKER_DISABLED','BROKER_NOT_CONFIGURED','BROKER_DEADLINE','BROKER_CLIENT_INVALID','BROKER_TRANSACTION_INVALID','BROKER_RESULT_INVALID','BROKER_ACCESS_DENIED','BROKER_COMMIT_UNKNOWN','BROKER_RELEASE_UNCERTAIN','BROKER_CLOCK_INVALID']);
export class BoundedIdentityReadError extends Error{constructor(code){const safe=CODES.has(code)?code:'BROKER_ACCESS_DENIED';super(safe);this.name='BoundedIdentityReadError';this.code=safe;this.outcome='result_withheld';this.retryable=false;}}
const fail=code=>{throw new BoundedIdentityReadError(code);};
function request(input){
 let v;try{v=policyCopy(input);}catch{fail('BROKER_INVALID_REQUEST');}
 if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!=='credential|operation|scope'||v.operation!=='read_scope_records'||typeof v.credential!=='string'||v.credential.length<32||v.credential.length>200||/[\s\u0000-\u001f\u007f]/.test(v.credential)||Buffer.byteLength(JSON.stringify(v))>4096)fail('BROKER_INVALID_REQUEST');
 try{v.scope=validateProductionDesignScope(v.scope);}catch{fail('BROKER_INVALID_REQUEST');}return v;
}
export function createBoundedIdentityReadBroker({enabled=false,acquireClient,maxDurationMs=2000,monotonic=()=>performance.now()}={}){
 const leased=new WeakSet();
 return Object.freeze({async handle(input){
  if(enabled!==true)fail('BROKER_DISABLED');
  if(typeof acquireClient!=='function'||typeof monotonic!=='function'||!Number.isSafeInteger(maxDurationMs)||maxDurationMs<50||maxDurationMs>2000)fail('BROKER_NOT_CONFIGURED');
  function clock(){try{return monotonic();}catch{fail('BROKER_CLOCK_INVALID');}}
  const fixed=request(input);const started=clock();if(!Number.isFinite(started))fail('BROKER_NOT_CONFIGURED');
  let client=null,owned=false,expired=false,finished=false,commitAttempted=false,beginAttempted=false,begun=false,committed=false,timer;
  function alive(){const t=clock();if(expired||finished||!Number.isFinite(t)||t<started||t-started>=maxDurationMs){expired=true;interrupt();fail('BROKER_DEADLINE');}}
  function interrupt(){if(owned&&typeof client?.destroy==='function')void Promise.resolve().then(()=>{if(owned)return client.destroy();}).catch(()=>{});}
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;interrupt();reject(new BoundedIdentityReadError('BROKER_DEADLINE'));},maxDurationMs);});
  const work=(async()=>{
   try{
    client=await acquireClient();
    if(!client||types.isProxy(client)||leased.has(client))fail('BROKER_CLIENT_INVALID');
    if(typeof client.query!=='function'||typeof client.release!=='function'||typeof client.destroy!=='function'){if(typeof client.release==='function')await client.release(new Error('Invalid bounded broker lease'));fail('BROKER_CLIENT_INVALID');}
    leased.add(client);owned=true;alive();
    const bounded={query:async(sql,params=[])=>{alive();const r=await client.query(sql,params);alive();return r;}};
    beginAttempted=true;if((await bounded.query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('BROKER_TRANSACTION_INVALID');begun=true;
    // Fixed trusted setting values; no request-derived SQL or caller timeout option.
    await bounded.query("SET LOCAL transaction_timeout='2000ms'");
    await bounded.query("SET LOCAL statement_timeout='1500ms'");
    await bounded.query("SET LOCAL lock_timeout='1000ms'");
    await bounded.query("SET LOCAL idle_in_transaction_session_timeout='1000ms'");
    await bounded.query('SET LOCAL search_path=pg_catalog');
    const operations=createIdentityCapabilityOperations(bounded),authority=await operations.resolveAuthority({credential:fixed.credential,scope:fixed.scope});
    const records=policyCopy(await operations.readScopeRecords());if(!Array.isArray(records)||records.length>50||records.some(r=>!r||Array.isArray(r)||Object.keys(r).sort().join('|')!=='payload|recordId|scope|storeId'||typeof r.recordId!=='string'||!r.recordId.length||r.recordId.length>160||r.storeId!==authority.storeId||!policyEqual(r.scope,authority.scope)))fail('BROKER_RESULT_INVALID');
    const latest=await operations.recheck(authority);if(!policyEqual(authority,latest))fail('BROKER_ACCESS_DENIED');await operations.clear();
    commitAttempted=true;if((await bounded.query('COMMIT')).command!=='COMMIT')fail('BROKER_TRANSACTION_INVALID');begun=false;committed=true;
    alive();return policyFreeze({schemaVersion:'design-bounded-identity-read-v1',authority,records});
   }catch(error){
    if(owned&&beginAttempted&&!committed&&!expired){try{await client.query('ROLLBACK');}catch{interrupt();}}
    if(expired)fail('BROKER_DEADLINE');
    if(error instanceof BoundedIdentityReadError)throw new BoundedIdentityReadError(error.code);
    fail(commitAttempted?'BROKER_COMMIT_UNKNOWN':'BROKER_ACCESS_DENIED');
   }finally{
    if(owned){
     // Relinquish destroy authority BEFORE handing the lease to the pool. A
     // timer/late callback from this request must never destroy a reused lease.
     const discard=expired||beginAttempted&&!committed;owned=false;
     try{await client.release(discard?new Error('Discard bounded broker lease'):undefined);leased.delete(client);}catch{fail('BROKER_RELEASE_UNCERTAIN');}
    }
   }
  })();
  // A late acquisition/query cannot yield a result after the deadline. Its work
  // observes expired at every boundary, then discards its owned connection.
  void work.catch(()=>{});
  try{const result=await Promise.race([work,deadline]);alive();return result;}
  finally{finished=true;clearTimeout(timer);}
 }});
}
