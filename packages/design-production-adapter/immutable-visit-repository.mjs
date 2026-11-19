/** Fixed read-only discovery over explicit immutable visit bindings. No legacy matching. */
import {types} from 'node:util';
import {policyCopy,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {validateImmutableKeyIdentity} from './immutable-key-identity.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope,ProductionEmployeeError} from './employee-adapter.mjs';
import {VisitListError} from './visit-list-service.mjs';
const fail=(code='VISIT_LIST_UNAVAILABLE')=>{throw new VisitListError(code);};
const exact=(v,keys)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('VISIT_LIST_INVALID_REQUEST');};
const copy=v=>policyCopy(v,128*1024);
const stable=i=>Object.fromEntries(['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision'].map(k=>[k,i[k]]));
function credential(c){if(typeof c!=='string'||c.length<32||c.length>200||/[\s\u0000-\u001f\u007f]/.test(c))fail('VISIT_LIST_INVALID_REQUEST');return c;}
function visit(v){exact(v,['assignmentSource','visitId']);validateProductionDesignScope({customerProfileId:'1',...v});return v;}
function identity(x){const i=validateImmutableKeyIdentity(x);if(i.expiresAt<=Date.now())fail('VISIT_LIST_ACCESS_DENIED');return i;}
function authority(a,i){a=validateImmutableDesignAuthority(a);if(!policyEqual(stable(a),stable(i)))fail('VISIT_LIST_CHANGED');return a;}
const leased=new WeakSet();
export function createImmutableVisitRepository({enabled=false,acquireClient}={}){
 async function read(sql,params,validate){
  if(enabled!==true||typeof acquireClient!=='function')fail('VISIT_LIST_NOT_CONFIGURED');
  let c,query,release,owned=false,started=false,committed=false;
  try{
   const pending=acquireClient();if(types.isProxy(pending))fail();c=await pending;if(!c||types.isProxy(c)||leased.has(c))fail();const q=Object.getOwnPropertyDescriptor(c,'query'),r=Object.getOwnPropertyDescriptor(c,'release');if(!q||!r||!Object.hasOwn(q,'value')||!Object.hasOwn(r,'value')||typeof q.value!=='function'||typeof r.value!=='function')fail();query=(...args)=>Reflect.apply(q.value,c,args);release=(...args)=>Reflect.apply(r.value,c,args);leased.add(c);owned=true;
   started=true;if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail();
   await query("SET LOCAL statement_timeout='5000ms'");await query("SET LOCAL lock_timeout='2000ms'");await query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await query('SET LOCAL search_path=pg_catalog');
   const raw=await query(sql,params);if(raw?.rowCount!==1||!Array.isArray(raw.rows)||raw.rows.length!==1)fail();const row=copy(raw.rows[0]);exact(row,['value']);const out=validate(row.value);
   if((await query('COMMIT')).command!=='COMMIT')fail();committed=true;return policyFreeze(out);
  }catch(error){if(owned&&started&&!committed)try{await query('ROLLBACK');}catch{}if(error instanceof VisitListError)throw error;fail();}
  finally{if(owned){try{await release(committed?undefined:new Error('Discard immutable visit lease'));leased.delete(c);}catch{fail();}}}
 }
 async function list(input){const v=copy(input);exact(v,['credential','date']);credential(v.credential);if(typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||v.date.startsWith('0000-')||!Number.isFinite(Date.parse(v.date+'T00:00:00Z'))||new Date(v.date+'T00:00:00Z').toISOString().slice(0,10)!==v.date)fail('VISIT_LIST_INVALID_DATE');
  const validate=b=>{exact(b,['identity','date','rows']);const i=identity(b.identity);if(b.date!==v.date||!Array.isArray(b.rows)||b.rows.length>50)fail();const seen=new Set();for(const r of b.rows){exact(r,['authority','displayName']);const a=authority(r.authority,i);if(seen.has(a.scope.visitId)||typeof r.displayName!=='string'||!r.displayName||r.displayName.length>160||r.displayName.trim()!==r.displayName||/[\u0000-\u001f\u007f]/.test(r.displayName))fail();seen.add(a.scope.visitId);}return b;};
  const once=()=>read('SELECT design_visit_private.read_day($1::text,$2::text) AS value',[v.credential,v.date],validate);const first=await once(),latest=await once();if(!policyEqual(first,latest))fail('VISIT_LIST_CHANGED');return policyFreeze({date:v.date,visits:latest.rows.map(r=>({id:r.authority.scope.visitId,displayName:r.displayName,visit:{assignmentSource:r.authority.scope.assignmentSource,visitId:r.authority.scope.visitId},bindingRevision:r.authority.bindingRevision}))});
 }
 async function resolve(input){const v=copy(input),has=Object.hasOwn(v,'expectedBindingRevision');exact(v,['credential','visit',...(has?['expectedBindingRevision']:[])]);credential(v.credential);visit(v.visit);if(has&&(typeof v.expectedBindingRevision!=='string'||!/^[1-9][0-9]{0,15}$/.test(v.expectedBindingRevision)))fail('VISIT_LIST_INVALID_REQUEST');
  const validate=b=>{exact(b,['identity','authority']);const i=identity(b.identity),a=authority(b.authority,i);if(!policyEqual({assignmentSource:a.scope.assignmentSource,visitId:a.scope.visitId},v.visit))fail('VISIT_LIST_CHANGED');if(has&&a.bindingRevision!==v.expectedBindingRevision)throw new ProductionEmployeeError('CUSTOMER_BINDING_CHANGED');return b;};
  const once=()=>read('SELECT design_visit_private.resolve_visit($1::text,$2::jsonb,$3::text) AS value',[v.credential,v.visit,v.expectedBindingRevision??null],validate);const first=await once(),latest=await once();if(!policyEqual(first,latest))throw new ProductionEmployeeError('CUSTOMER_BINDING_CHANGED');return policyFreeze({scope:latest.authority.scope});
 }
 return Object.freeze({list,resolve});
}
