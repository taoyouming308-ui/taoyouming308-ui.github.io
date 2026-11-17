/** Default-closed fixed operations only. No worker loop, credential retention, transport or retries. */
import {validatePreparedWorkflowRecord} from './prepared-workflow-service.mjs';
import {validateDesignCandidate,validateSynthesisEvidence,validateSynthesisContext} from '../analysis-engine/design-candidate.mjs';
import {types} from 'node:util';
import {policyCopy as copy,policyExact as exact,policySHA,policyEqual as equal,policyFreeze as freeze,policyDigest,policyOwnerKey,validateProviderKeyBinding} from './approval-attempt-contracts.mjs';
import {DurableSynthesisError,validateDurableRequest,validateDurableResult,validateDurableLease} from './durable-synthesis-contracts.mjs';
const leased=new WeakSet();const fail=code=>{throw new DurableSynthesisError(code);};
const unknown=()=>new DurableSynthesisError('DURABLE_OUTCOME_UNCERTAIN','uncertain');
const errors=new Set(['DURABLE_CAPACITY','DURABLE_CONFLICT','DURABLE_LEASE_LOST','DURABLE_DENIED','DURABLE_INVALID']);
function executor(enabled,acquire){return async(sql,params,validate)=>{
 if(enabled!==true||typeof acquire!=='function')fail('DURABLE_DISABLED');let c,q,release,destroy,owned=false,beginAttempted=false,begun=false,commitAttempted=false,committed=false;
 try{const pending=acquire();if(types.isProxy(pending))fail('DURABLE_INVALID');c=await pending;if(!c||types.isProxy(c)||leased.has(c))fail('DURABLE_INVALID');const method=k=>{const d=Object.getOwnPropertyDescriptor(c,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail('DURABLE_INVALID');return (...a)=>Reflect.apply(d.value,c,a);};q=method('query');release=method('release');if(Object.hasOwn(c,'destroy'))destroy=method('destroy');leased.add(c);owned=true;
 beginAttempted=true;if((await q('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('DURABLE_RESULT_INVALID');begun=true;await q("SET LOCAL statement_timeout='5000ms'");await q("SET LOCAL lock_timeout='2000ms'");await q("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await q('SET LOCAL search_path=pg_catalog');
 const raw=await q(sql,params);if(raw?.rowCount!==1||raw.rows?.length!==1)fail('DURABLE_RESULT_INVALID');const row=copy(raw.rows[0]);exact(row,['value']);const result=validate(row.value);commitAttempted=true;if((await q('COMMIT')).command!=='COMMIT')fail('DURABLE_RESULT_INVALID');committed=true;return result;
 }catch(e){let rollbackFailed=false;if(owned&&beginAttempted&&!committed)try{if((await q('ROLLBACK')).command!=='ROLLBACK')rollbackFailed=true;}catch{rollbackFailed=true;}if(commitAttempted||rollbackFailed||beginAttempted&&!begun)throw unknown();if(e instanceof DurableSynthesisError)throw new DurableSynthesisError(e.code);if(e?.code==='42501'&&errors.has(e?.message))fail(e.message);fail('DURABLE_DENIED');}
 finally{if(owned)try{await release(committed?undefined:Error('Discard durable operation lease'));leased.delete(c);}catch{try{await destroy?.();}catch{}throw unknown();}}
};}
export function createPostgresDurableSynthesisRepository({enabled=false,acquireClient}={}){
 const run=executor(enabled,acquireClient),call=(kind,input)=>{if(enabled!==true)fail('DURABLE_DISABLED');const r=validateDurableRequest(input,kind);const args=kind==='enqueue'?[r.credential,r.scope,r.requestId,r.side,r.intent]:kind==='list'?[r.credential,r.scope]:[r.credential,r.scope,kind==='lookup'?r.requestId:r.operationId];const casts=kind==='enqueue'?'$1::text,$2::jsonb,$3::text,$4::text,$5::jsonb':kind==='list'?'$1::text,$2::jsonb':'$1::text,$2::jsonb,$3::text';return run(`SELECT design_durable_synthesis.${kind}(${casts}) AS value`,args,v=>validateDurableResult(v,{list:kind==='list'}));};
 return Object.freeze(Object.fromEntries(['enqueue','status','lookup','list','cancel'].map(k=>[k,input=>call(k,input)])));
}
export function createPostgresDurableSynthesisWorkerRepository({enabled=false,acquireWorkerClient}={}){
 const run=executor(enabled,acquireWorkerClient);const fenced=(input,extra=[])=>{try{const r=copy(input);exact(r,['operationId','fence',...extra]);policySHA(r.operationId);if(!Number.isSafeInteger(r.fence)||r.fence<1)fail('DURABLE_INVALID');return r;}catch{fail('DURABLE_INVALID');}};
 return Object.freeze({
  claim:()=>run('SELECT design_durable_synthesis.claim() AS value',[],validateDurableLease),
  recheck(input){const r=fenced(input);return run('SELECT design_durable_synthesis.recheck($1::text,$2::bigint) AS value',[r.operationId,r.fence],validateDurableLease);},
  dispatch(input){const r=fenced(input);return run('SELECT design_durable_synthesis.dispatch($1::text,$2::bigint) AS value',[r.operationId,r.fence],v=>{if(v!==true)fail('DURABLE_RESULT_INVALID');return true;});},
  finish(input){const r=fenced(input,['candidateEnvelope']);return run('SELECT design_durable_synthesis.finish($1::text,$2::bigint,$3::jsonb) AS value',[r.operationId,r.fence,r.candidateEnvelope],v=>{const raw=copy(v);exact(raw,['operation','validationRecord']);const record=validatePreparedWorkflowRecord(raw.validationRecord,r.candidateEnvelope.scope),candidate=validateDesignCandidate(r.candidateEnvelope,record.session);validateSynthesisEvidence({candidate,session:record.session,modelCandidates:record.modelCandidates||[]});if(candidate.kind!=='completion_synthesis')fail('DURABLE_RESULT_INVALID');return validateDurableResult({operation:raw.operation});});},
  fail(input){const r=fenced(input);return run('SELECT design_durable_synthesis.fail($1::text,$2::bigint) AS value',[r.operationId,r.fence],v=>validateDurableResult(v));}
 });
}

/** Stage24 additive fixed input access; shares physical-client ownership with Stage23. */
export function createPostgresDurableSynthesisExecutionRepository({enabled=false,acquireWorkerClient}={}){
 const run=executor(enabled,acquireWorkerClient);
 function request(input){if(enabled!==true)fail('DURABLE_DISABLED');try{const r=copy(input);exact(r,['operationId','fence']);policySHA(r.operationId);if(!Number.isSafeInteger(r.fence)||r.fence<1)fail('DURABLE_INVALID');return r;}catch{fail('DURABLE_INVALID');}}
 function lease(value,fixed){const l=validateDurableLease(value);if(!l||l.operationId!==fixed.operationId||l.fence!==fixed.fence||policyOwnerKey(l.authority,l.intent.requestId)!==l.operationId)fail('DURABLE_RESULT_INVALID');return l;}
 return Object.freeze({
  prepare(input){const fixed=request(input);return run('SELECT design_durable_worker.prepare($1::text,$2::bigint) AS value',[fixed.operationId,fixed.fence],value=>{
   try{const v=copy(value);exact(v,['lease','record']);v.lease=lease(v.lease,fixed);const l=v.lease,s=l.intent.sourceBinding;
    v.record=validatePreparedWorkflowRecord(v.record,l.authority.scope);
    if(v.record.store!==l.authority.actor.store||v.record.revision!==s.workflowRevision||policyDigest(v.record)!==s.workflowSha256||v.record.session.scope.sessionId!==s.sessionId||v.record.session.revision!==s.sessionRevision||policyDigest(v.record.session)!==s.sessionDigest||l.intent.inputDigest!==s.sessionDigest)fail('DURABLE_RESULT_INVALID');
    validateSynthesisContext({synthesis:l.intent.evidenceBinding.synthesis,sourceRefs:l.intent.sourceRefs,session:v.record.session,modelCandidates:v.record.modelCandidates||[]});
    return freeze(v);
   }catch{fail('DURABLE_RESULT_INVALID');}
  });},
  readKey(input){const fixed=request(input);return run('SELECT design_durable_worker.read_key($1::text,$2::bigint) AS value',[fixed.operationId,fixed.fence],value=>{
   try{const v=copy(value);exact(v,['lease','keyRecord']);v.lease=lease(v.lease,fixed);const l=v.lease,a=l.authority,k=v.keyRecord,b=validateProviderKeyBinding(l.intent.keyBinding);
    if(l.intent.kind!=='external'||b.purpose!=='chat'||!equal(b.owner,Object.fromEntries(['subjectId','employmentId','membershipId','storeId'].map(n=>[n,a[n]])))||b.securityEpoch!==a.securityEpoch||b.membershipRevision!==a.membershipRevision||b.destination!==l.intent.destination||b.model!==l.intent.model)fail('DURABLE_RESULT_INVALID');
    exact(k,['schemaVersion','owner','securityEpoch','membershipRevision','purpose','revision','enabled','destination','model','sealed']);
    if(k.schemaVersion!=='design-key-record-v2'||k.enabled!==true)fail('DURABLE_RESULT_INVALID');
    for(const n of ['owner','securityEpoch','membershipRevision','purpose','revision','destination','model'])if(!equal(k[n],b[n]))fail('DURABLE_RESULT_INVALID');
    exact(k.sealed,['v','iv','data']);if(k.sealed.v!==2||typeof k.sealed.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(k.sealed.iv)||typeof k.sealed.data!=='string'||k.sealed.data.length<24||k.sealed.data.length>5464||!/^[A-Za-z0-9+/]+={0,2}$/.test(k.sealed.data))fail('DURABLE_RESULT_INVALID');
    return freeze(v);
   }catch{fail('DURABLE_RESULT_INVALID');}
  });}
 });
}
