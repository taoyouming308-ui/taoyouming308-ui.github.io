/** Default-closed adapter for a caller-owned node-postgres Pool.
 * No pg import, connection construction, environment/options inspection, SQL installation,
 * retry, or pool.end(). The owner must configure finite pg connection timeouts, distinct
 * runtime/issuer pools and call adapter.close(), then pool.end() during shutdown.
 * close() waits up to acquireTimeoutMs for outstanding checkout/query/release work;
 * PG_ADAPTER_CLOSE_UNSETTLED means the owner must finish pool shutdown. Late
 * checkouts remain cancelled and are destroyed even after that rejection.
 * API basis: https://node-postgres.com/apis/pool and /features/transactions.
 */
import {types} from 'node:util';
import {policyCopy,policyExact} from './approval-attempt-contracts.mjs';
const held=new WeakMap(),quarantined=new WeakSet(),observedClients=new WeakSet();
const CODES=new Set(['PG_ADAPTER_DISABLED','PG_ADAPTER_INVALID','PG_ADAPTER_CLOSED','PG_ADAPTER_QUEUE_FULL','PG_ADAPTER_ACQUIRE_TIMEOUT','PG_ADAPTER_QUERY_TIMEOUT','PG_ADAPTER_UNAVAILABLE','PG_ADAPTER_ROLE_DENIED','PG_ADAPTER_LEASE_INVALID','PG_ADAPTER_RELEASE_UNKNOWN','PG_ADAPTER_CLOSE_UNSETTLED']);
export class TrustedPgPoolError extends Error {constructor(code,outcome){super(CODES.has(code)?code:'PG_ADAPTER_UNAVAILABLE');this.name='TrustedPgPoolError';this.code=this.message;this.retryable=false;this.outcome=outcome==='uncertain'||['PG_ADAPTER_QUERY_TIMEOUT','PG_ADAPTER_RELEASE_UNKNOWN','PG_ADAPTER_CLOSE_UNSETTLED'].includes(this.code)?'uncertain':'not_sent';}}
const fail=code=>{throw new TrustedPgPoolError(code);};
export const TRUSTED_PG_RUNTIME_ROLE_SQL="SELECT session_user::text AS session_role,current_user::text AS current_role,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolinherit FROM pg_catalog.pg_roles WHERE rolname=current_user";
const SQLSTATES=new Set(['40001','40P01','55P03','57014','23505','42501','P0002']);
const SENTINELS=new Set(['CUSTOMER_DESIGN_REQUEST_REUSED','CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED']);
const WORKER_SENTINELS=new Set(['DURABLE_CAPACITY','DURABLE_CONFLICT','DURABLE_LEASE_LOST','DURABLE_DENIED','DURABLE_INVALID']);
function queryError(error,worker){
 if(error instanceof TrustedPgPoolError)return new TrustedPgPoolError(error.code,'uncertain');
 if(error&&typeof error==='object'&&!types.isProxy(error)){
  const code=Object.getOwnPropertyDescriptor(error,'code'),message=Object.getOwnPropertyDescriptor(error,'message');
  if(code&&Object.hasOwn(code,'value')&&(SQLSTATES.has(code.value)||code.value==='22023'&&message&&Object.hasOwn(message,'value')&&SENTINELS.has(message.value))){const out=new Error(code.value==='22023'||worker&&code.value==='42501'&&message&&Object.hasOwn(message,'value')&&WORKER_SENTINELS.has(message.value)?message.value:'PG_ADAPTER_DATABASE_ERROR');out.code=code.value;out.retryable=false;out.outcome='uncertain';return out;}
 }
 return new TrustedPgPoolError('PG_ADAPTER_UNAVAILABLE','uncertain');
}
const CLEAR=new Map([['SELECT design_identity.clear_context() AS cleared','cleared'],['SELECT design_identity.clear_context() AS value','value'],['SELECT design_key_private.clear_context() AS value','value']]);
// pg methods live on class prototypes. Walk data descriptors without invoking getters.
function method(object,name){let p=object;for(let depth=0;p&&depth<12;depth++,p=Object.getPrototypeOf(p)){if(types.isProxy(p))fail('PG_ADAPTER_INVALID');const d=Object.getOwnPropertyDescriptor(p,name);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail('PG_ADAPTER_INVALID');return (...args)=>Reflect.apply(d.value,object,args);}}fail('PG_ADAPTER_INVALID');}
function roleResult(raw,worker){try{const r=policyCopy(raw.rows);if(raw.command!=='SELECT'||raw.rowCount!==1||r.length!==1)fail('PG_ADAPTER_ROLE_DENIED');const row=r[0];policyExact(row,['session_role','current_role','rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','rolinherit']);if(row.session_role!==(worker?'design_synthesis_worker':'design_identity_runtime')||row.current_role!==(worker?'design_synthesis_worker':'design_identity_runtime')||['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','rolinherit'].some(k=>row[k]!==false))fail('PG_ADAPTER_ROLE_DENIED');}catch{fail('PG_ADAPTER_ROLE_DENIED');}}
function clearResult(raw,key){try{if(raw.command!=='SELECT'||raw.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)return false;const row=policyCopy(raw.rows[0]);policyExact(row,[key]);return row[key]==='';}catch{return false;}}
// Closed factories: no caller-selected role, role SQL, cleanup SQL or reuse policy.
export function createTrustedPgPoolAdapter(options){return createAdapter(options,false);}
export function createTrustedSynthesisWorkerPgPoolAdapter(options){return createAdapter(options,true);}
function createAdapter({enabled=false,pool,maxLeases,maxWaiting,acquireTimeoutMs,queryTimeoutMs,onEvent}={},worker){
 if(enabled!==true)return Object.freeze({acquireClient:async()=>fail('PG_ADAPTER_DISABLED'),close:async()=>{}});
 if(!pool||types.isProxy(pool)||typeof pool!=='object'||!Number.isInteger(maxLeases)||maxLeases<1||maxLeases>16||!Number.isInteger(maxWaiting)||maxWaiting<0||maxWaiting>64||!Number.isInteger(acquireTimeoutMs)||acquireTimeoutMs<1||acquireTimeoutMs>30000||!Number.isInteger(queryTimeoutMs)||queryTimeoutMs<1||queryTimeoutMs>30000||onEvent!==undefined&&(typeof onEvent!=='function'||types.isProxy(onEvent)))fail('PG_ADAPTER_INVALID');
 const connect=method(pool,'connect'),on=method(pool,'on');
 const emit=code=>{try{void Promise.resolve(onEvent?.(Object.freeze({code}))).catch(()=>{});}catch{/* Diagnostics cannot change a permission or cleanup result. */}};
 const queue=[],slots=new Set(),outstanding=new Set();let closed=false,closePromise=null,cleanupUnknown=false;
 // Keep this sanitized listener installed until the caller ends its pool, including
 // the interval after close(). Never propagate driver messages or connection data.
 on('error',(_error,raw)=>{if(raw&&typeof raw==='object'&&!types.isProxy(raw)){quarantined.add(raw);held.get(raw)?.poison();}emit('pool_error');});
 function finish(slot){slots.delete(slot);drain();}
 function drain(){if(closed)return;while(queue.length&&slots.size<maxLeases){const item=queue.shift();if(!item.cancelled)start(item);}}
 function queryDeadline(fn,onTimeout,slot){let timer;const operation=Promise.resolve().then(fn);slot.inflight.add(operation);outstanding.add(operation);void operation.finally(()=>{slot.inflight.delete(operation);outstanding.delete(operation);}).catch(()=>{});return Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout();reject(new TrustedPgPoolError('PG_ADAPTER_QUERY_TIMEOUT'));},queryTimeoutMs);})]).finally(()=>clearTimeout(timer));}
 function start(item){const slot={retire:null,startTask:null,inflight:new Set()};slots.add(slot);
  const task=(async()=>{let raw,release,claimed=false,retired=false,retirePromise=null;let poison=false,busy=false,ended=false,transaction=false,committed=false,cleared=false;
   function retire(destroy){if(retirePromise)return retirePromise;retired=true;ended=true;if(destroy&&raw)quarantined.add(raw);let resolveRetire,rejectRetire;retirePromise=new Promise((resolve,reject)=>{resolveRetire=resolve;rejectRetire=reject;});void retirePromise.catch(()=>{});
    const cleanup=(async()=>{try{if(release){const released=release(destroy===true);if(released!==undefined){let timer;try{await Promise.race([released,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new TrustedPgPoolError('PG_ADAPTER_RELEASE_UNKNOWN')),acquireTimeoutMs);})]);}finally{clearTimeout(timer);}}}if(claimed){held.delete(raw);if(!destroy)quarantined.delete(raw);}}
    catch{cleanupUnknown=true;if(raw)quarantined.add(raw);emit('release_unknown');throw new TrustedPgPoolError('PG_ADAPTER_RELEASE_UNKNOWN');}
    finally{finish(slot);}})();void cleanup.then(resolveRetire,rejectRetire);return retirePromise;
   }
   item.cancelLease=()=>claimed?retire(true):undefined;
   slot.retire=()=>{item.cancelled=true;if(!item.done){clearTimeout(item.timer);item.done=true;item.reject(new TrustedPgPoolError('PG_ADAPTER_CLOSED'));}return claimed?retire(true):undefined;};
   try{
    raw=await connect();if(!raw||typeof raw!=='object'||types.isProxy(raw))fail('PG_ADAPTER_INVALID');
    // A duplicate live physical client belongs to its original lease. Do not
    // release it through the duplicate acquisition and disrupt that transaction.
    if(held.has(raw)){held.get(raw).poison();fail('PG_ADAPTER_LEASE_INVALID');}
    if(quarantined.has(raw))fail('PG_ADAPTER_LEASE_INVALID');
    release=method(raw,'release');const rawQuery=method(raw,'query'),clientOn=method(raw,'on');held.set(raw,{poison(){poison=true;},notify:emit});claimed=true;
    // pg removes its idle listener on checkout. Keep one harmless client listener
    // so a checked-out socket error cannot become an unhandled EventEmitter error.
    if(!observedClients.has(raw)){clientOn('error',()=>{quarantined.add(raw);const owner=held.get(raw);owner?.poison();owner?.notify('client_error');});observedClients.add(raw);}
    if(closed||item.cancelled){await retire(true);return;}
    busy=true;try{const result=await queryDeadline(()=>rawQuery(TRUSTED_PG_RUNTIME_ROLE_SQL,[]),()=>{poison=true;void retire(true).catch(()=>{});},slot);if(poison||ended||closed||item.cancelled)fail('PG_ADAPTER_LEASE_INVALID');roleResult(result,worker);}finally{busy=false;}
    if(closed||item.cancelled){await retire(true);return;}
    function query(sql,params=[]){let pending;try{
     const rollback=sql==='ROLLBACK';if(ended||closed||busy||poison&&!rollback||typeof sql!=='string'||!Array.isArray(params))fail('PG_ADAPTER_LEASE_INVALID');
     const begin=sql==='BEGIN'||sql==='BEGIN ISOLATION LEVEL READ COMMITTED',commit=sql==='COMMIT',clearKey=CLEAR.get(sql);
     if(begin?(transaction||committed):!transaction)fail('PG_ADAPTER_LEASE_INVALID');if((begin||commit||rollback||clearKey)&&params.length)fail('PG_ADAPTER_LEASE_INVALID');if(commit&&poison)fail('PG_ADAPTER_LEASE_INVALID');
     busy=true;if(begin)transaction=true;if(!commit&&!clearKey)cleared=false;
     pending=(async()=>{try{const result=await queryDeadline(()=>rawQuery(sql,params),()=>{poison=true;void retire(true).catch(()=>{});},slot);if(ended||closed||poison&&!rollback)fail('PG_ADAPTER_LEASE_INVALID');
      if(begin&&result?.command!=='BEGIN'||commit&&result?.command!=='COMMIT'||rollback&&result?.command!=='ROLLBACK')fail('PG_ADAPTER_LEASE_INVALID');
      if(clearKey){cleared=clearResult(result,clearKey);if(!cleared)fail('PG_ADAPTER_LEASE_INVALID');}
      if(commit){transaction=false;committed=true;}if(rollback){transaction=false;poison=true;}return result;
     }catch(error){poison=true;throw queryError(error,worker);}finally{busy=false;}})();
    }catch(error){poison=true;pending=Promise.reject(new TrustedPgPoolError(error instanceof TrustedPgPoolError?error.code:'PG_ADAPTER_LEASE_INVALID','uncertain'));}void pending.catch(()=>{});return pending;}
    const lease=Object.freeze({query,async release(error){if(ended)return retirePromise;await retire(worker||Boolean(error)||closed||poison||busy||transaction||!committed||!cleared);},async destroy(){if(ended)return retirePromise;await retire(true);}});
    clearTimeout(item.timer);item.done=true;item.resolve(lease);
   }catch(error){if(!retired){if(claimed||release)try{await retire(true);}catch{}else finish(slot);}if(!item.cancelled&&!item.done){clearTimeout(item.timer);item.done=true;item.reject(new TrustedPgPoolError(error instanceof TrustedPgPoolError?error.code:'PG_ADAPTER_UNAVAILABLE'));}}
  })();slot.startTask=task;outstanding.add(task);void task.finally(()=>outstanding.delete(task)).catch(()=>{});
 }
 function acquireClient(){if(closed)return Promise.reject(new TrustedPgPoolError('PG_ADAPTER_CLOSED'));if(slots.size>=maxLeases&&queue.length>=maxWaiting)return Promise.reject(new TrustedPgPoolError('PG_ADAPTER_QUEUE_FULL'));
  return new Promise((resolve,reject)=>{const item={resolve,reject,cancelled:false,done:false,timer:null};item.timer=setTimeout(()=>{if(item.done)return;item.cancelled=true;const at=queue.indexOf(item);if(at>=0)queue.splice(at,1);reject(new TrustedPgPoolError('PG_ADAPTER_ACQUIRE_TIMEOUT'));emit('acquire_timeout');void Promise.resolve(item.cancelLease?.()).catch(()=>{});},acquireTimeoutMs);if(slots.size<maxLeases)start(item);else queue.push(item);});
 }
 function close(){if(closePromise)return closePromise;closed=true;for(const item of queue.splice(0)){clearTimeout(item.timer);item.cancelled=true;item.reject(new TrustedPgPoolError('PG_ADAPTER_CLOSED'));}
  const snapshot=[...slots],retirements=snapshot.map(slot=>slot.retire?.());
  // A late connect must still arrive and be destroyed. A hung foreign driver is
  // not silently reported closed: bounded shutdown reports uncertainty instead.
  const drain=Promise.allSettled([...retirements,...snapshot.map(slot=>slot.startTask),...outstanding]);
  let timer;closePromise=Promise.race([drain.then(results=>{if(results.some(r=>r.status==='rejected')||slots.size||cleanupUnknown)fail('PG_ADAPTER_CLOSE_UNSETTLED');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new TrustedPgPoolError('PG_ADAPTER_CLOSE_UNSETTLED')),acquireTimeoutMs);})]).finally(()=>clearTimeout(timer));void closePromise.catch(()=>{});return closePromise;
 }
 return Object.freeze({acquireClient,close});
}
