/** Default-closed fixed SQL repository. No installer, credential source or transport. */
import {copyManagedResultData} from '../analysis-engine/managed-image-result-candidate.mjs';
import {types as nodeTypes} from 'node:util';
import {createIdentityCapabilityOperations} from './identity-capability-postgres.mjs';
import {DurableProviderPolicyError,policyCopy,policyEqual,policyFail,policySHA,validatePolicyAuthority,validatePolicyIntent} from './approval-attempt-contracts.mjs';
const safeCodes=new Set(['POLICY_REPOSITORY_DISABLED','POLICY_REPOSITORY_UNAVAILABLE','POLICY_CLIENT_INVALID','POLICY_TRANSACTION_REQUIRED','POLICY_REPOSITORY_INVALID','POLICY_TRANSACTION_INVALID','POLICY_AUTHORITY_REQUIRED','POLICY_AUTHORITY_CHANGED','POLICY_REPOSITORY_DENIED','POLICY_INVALID','POLICY_ACCESS_DENIED','POLICY_APPROVAL_REQUIRED','POLICY_BINDING_MISMATCH','POLICY_CORRUPT','POLICY_DISABLED','POLICY_DISPATCH_DENIED','POLICY_ISSUER_UNAVAILABLE','POLICY_NOT_BOUND','POLICY_NOT_CONFIGURED','POLICY_REQUEST_CONFLICT','POLICY_OUTCOME_UNCERTAIN']);
const safeError=error=>{let code='POLICY_REPOSITORY_DENIED',outcome='not_sent';try{const d=Object.getOwnPropertyDescriptor(error,'code'),o=Object.getOwnPropertyDescriptor(error,'outcome');if(error instanceof DurableProviderPolicyError&&d&&Object.hasOwn(d,'value')&&safeCodes.has(d.value)){code=d.value;if(o&&Object.hasOwn(o,'value')&&o.value==='uncertain')outcome='uncertain';}}catch{}return new DurableProviderPolicyError(code,outcome);};
const unknown=()=>new DurableProviderPolicyError('POLICY_COMMIT_UNKNOWN','uncertain');
// Shared by instances: a bad pool must never hand the same physical handle to
// two repositories, nor return a quarantined handle after uncertain release.
const leased=new WeakSet();
export function createPostgresProviderPolicyRepository({enabled=false,acquireClient,immutableKeyBinding=false,candidateBinding=false,managedBinding=false,managedViewBinding=false,normalizedBinding=false,applicationBinding=false,applicationViewBinding=false}={}){
 return Object.freeze({async withTransaction(work){
  if(enabled!==true||typeof acquireClient!=='function'||typeof work!=='function'||typeof immutableKeyBinding!=='boolean'||typeof candidateBinding!=='boolean'||typeof managedBinding!=='boolean'||typeof managedViewBinding!=='boolean'||typeof normalizedBinding!=='boolean'||typeof applicationViewBinding!=='boolean'||typeof applicationBinding!=='boolean'||[candidateBinding,managedBinding,managedViewBinding,normalizedBinding,applicationBinding,applicationViewBinding].filter(Boolean).length>1||(candidateBinding||managedBinding||managedViewBinding||normalizedBinding||applicationBinding||applicationViewBinding)&&!immutableKeyBinding)policyFail('POLICY_REPOSITORY_DISABLED');
  let client,query,release,destroy;
  let acquisition;try{acquisition=acquireClient();}catch{policyFail('POLICY_REPOSITORY_UNAVAILABLE');}
  if(nodeTypes.isProxy(acquisition))policyFail('POLICY_CLIENT_INVALID');
  try{client=await acquisition;}catch{policyFail('POLICY_REPOSITORY_UNAVAILABLE');}
  // Deliberately only own data methods: prototype-only pool classes require a
  // trusted wrapper. Snapshot functions once, never invoke accessors/Proxy traps.
  try{
   if(!client||typeof client!=='object'||nodeTypes.isProxy(client)||leased.has(client))policyFail('POLICY_CLIENT_INVALID');
   const method=(name,optional=false)=>{const d=Object.getOwnPropertyDescriptor(client,name);if(!d&&optional)return undefined;if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||nodeTypes.isProxy(d.value))policyFail('POLICY_CLIENT_INVALID');const fn=d.value;return (...args)=>Reflect.apply(fn,client,args);};
   query=method('query');release=method('release');destroy=method('destroy',true);
  }catch{policyFail('POLICY_CLIENT_INVALID');}
  leased.add(client);
  let beginAttempted=false,begun=false,committing=false,committed=false,closed=false,busy=false,poisoned=false,finalizing=false,finalChecking=false,authority=null,quarantine=false;
  const guards=[];
  const invalid=(code='POLICY_TRANSACTION_INVALID')=>{poisoned=true;policyFail(code);};
  const usable=()=>{if(closed||poisoned)invalid('POLICY_TRANSACTION_REQUIRED');};
  const requireOpen=()=>{usable();if(!begun||!authority)invalid('POLICY_TRANSACTION_REQUIRED');};
  const operation=(fn,needsAuthority=true,internal=false)=>{
   let pending;
   try{usable();if(!begun||busy||finalChecking&&!internal)invalid();if(needsAuthority&&!authority)invalid('POLICY_TRANSACTION_REQUIRED');busy=true;
    pending=(async()=>{try{const value=await fn();usable();return value;}catch(error){poisoned=true;throw safeError(error);}finally{busy=false;}})();
   }catch(error){pending=Promise.reject(safeError(error));}
   // Ignoring an operation must not create an unhandled rejection. It still
   // poisons the transaction; no successful COMMIT follows a swallowed failure.
   void pending.catch(()=>{});return pending;
  };
  const scalar=async(sql,params=[],largeManagedContext=false)=>{const r=await query(sql,params);usable();if(r?.rows?.length!==1||r.rowCount!==1)invalid('POLICY_REPOSITORY_INVALID');const row=largeManagedContext?copyManagedResultData(r.rows[0]):policyCopy(r.rows[0]);if(!row||Array.isArray(row)||Object.keys(row).length!==1||!Object.hasOwn(row,'value'))invalid('POLICY_REPOSITORY_INVALID');return row.value;};
  const bindingSchema=applicationViewBinding?'design_managed_application_view_provider_binding':applicationBinding?'design_application_provider_binding':normalizedBinding?'design_normalized_provider_binding':managedViewBinding?'design_managed_view_provider_binding':managedBinding?'design_managed_provider_binding':candidateBinding?'design_candidate_provider_binding':'design_provider_binding';
  const operations=createIdentityCapabilityOperations({query:async(sql,params)=>{usable();if(immutableKeyBinding){if(sql==='SELECT design_identity.authorize($1::text,$2::jsonb) AS authority')sql=`SELECT ${bindingSchema}.authorize($1::text,$2::jsonb) AS authority`;else if(sql==='SELECT design_identity.recheck_authority() AS authority')sql=`SELECT ${bindingSchema}.recheck() AS authority`;}const r=await query(sql,params);usable();return r;}});
  const checkedRow=(row,allowNull=false)=>{const fixed=policyCopy(row);if(!applicationViewBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v8'||!applicationBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v7'||!normalizedBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v6'||!managedViewBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v5'||!managedBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v4')invalid('POLICY_REPOSITORY_INVALID');if(immutableKeyBinding&&!(allowNull&&fixed===null)&&fixed?.intent?.schemaVersion!==(applicationViewBinding?'design-provider-intent-v8':applicationBinding?'design-provider-intent-v7':normalizedBinding?'design-provider-intent-v6':managedViewBinding?'design-provider-intent-v5':managedBinding?'design-provider-intent-v4':candidateBinding?'design-provider-intent-v3':'design-provider-intent-v2'))invalid('POLICY_REPOSITORY_INVALID');return fixed;};
  const contextSQL=immutableKeyBinding?`SELECT ${bindingSchema}.verify_request_context($1::jsonb,$2::jsonb) AS value`:'SELECT design_policy_private.verify_request_context($1::jsonb,$2::jsonb) AS value';
  const tx=Object.freeze({
   resolveAuthority:input=>operation(async()=>{const a=validatePolicyAuthority(await operations.resolveAuthority(policyCopy(input)));if(authority&&!policyEqual(a,authority))invalid('POLICY_AUTHORITY_CHANGED');authority=a;return a;},false),
   readProviderContext:input=>operation(()=>{if(!immutableKeyBinding||candidateBinding||managedBinding||managedViewBinding||normalizedBinding||applicationBinding||applicationViewBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='purpose|requestId'||!['chat','speech'].includes(fixed.purpose)||typeof fixed.requestId!=='string'||fixed.requestId.length<1||fixed.requestId.length>160||fixed.requestId.trim()!==fixed.requestId||/[\u0000-\u001f\u007f]/.test(fixed.requestId))invalid('POLICY_INVALID');return scalar('SELECT design_provider_binding.read_context($1::text,$2::text) AS value',[fixed.purpose,fixed.requestId]);}),
   readIssuedApproval:requestId=>operation(()=>{if(!immutableKeyBinding)invalid('POLICY_REPOSITORY_DISABLED');if(typeof requestId!=='string'||requestId.length<1||requestId.length>160||requestId.trim()!==requestId||/[\u0000-\u001f\u007f]/.test(requestId))invalid('POLICY_INVALID');return scalar(`SELECT ${bindingSchema}.read_issued($1::text) AS value`,[requestId]);}),
   readNormalizedProviderContext:input=>operation(()=>{if(!normalizedBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='requestId|taskId'||!['requestId','taskId'].every(k=>typeof fixed[k]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(fixed[k])))invalid('POLICY_INVALID');return scalar('SELECT design_normalized_provider_binding.read_context($1::text,$2::text) AS value',[fixed.taskId,fixed.requestId],true);}),
   readApplicationProviderContext:input=>operation(()=>{if(!applicationBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='requestId|taskId'||!['requestId','taskId'].every(k=>typeof fixed[k]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(fixed[k])))invalid('POLICY_INVALID');return scalar('SELECT design_application_provider_binding.read_context($1::text,$2::text) AS value',[fixed.taskId,fixed.requestId],true);}),
   readManagedProviderContext:input=>operation(()=>{if(!managedBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='requestId|taskId'||!['requestId','taskId'].every(k=>typeof fixed[k]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(fixed[k])))invalid('POLICY_INVALID');return scalar('SELECT design_managed_provider_binding.read_context($1::text,$2::text) AS value',[fixed.taskId,fixed.requestId],true);}),
   readManagedViewProviderContext:input=>operation(()=>{if(!managedViewBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='candidateKind|requestId|selectors'||!['managed_before_view','managed_completion_comparison','managed_completion_synthesis'].includes(fixed.candidateKind)||typeof fixed.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(fixed.requestId))invalid('POLICY_INVALID');return scalar('SELECT design_managed_view_provider_binding.read_context($1::text,$2::jsonb,$3::text) AS value',[fixed.candidateKind,fixed.selectors,fixed.requestId],true);}),
   readManagedApplicationViewProviderContext:input=>operation(()=>{if(!applicationViewBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='candidateKind|requestId|selectors'||!['managed_application_completion_comparison','managed_application_completion_synthesis'].includes(fixed.candidateKind)||typeof fixed.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(fixed.requestId))invalid('POLICY_INVALID');return scalar('SELECT design_managed_application_view_provider_binding.read_context($1::text,$2::jsonb,$3::text) AS value',[fixed.candidateKind,fixed.selectors,fixed.requestId],true);}),
   readManagedViewRegistered:requestId=>operation(()=>{if(!managedViewBinding||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))invalid('POLICY_INVALID');return scalar('SELECT design_managed_view_provider_binding.read_registered($1::text) AS value',[requestId]);}),
   readManagedApplicationViewRegistered:requestId=>operation(()=>{if(!applicationViewBinding||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))invalid('POLICY_INVALID');return scalar('SELECT design_managed_application_view_provider_binding.read_registered($1::text) AS value',[requestId]);}),
   registerManagedViewLocal:input=>operation(()=>{if(!managedViewBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=validatePolicyIntent(input);if(fixed.schemaVersion!=='design-provider-intent-v5'||fixed.kind!=='local')invalid('POLICY_INVALID');return scalar('SELECT design_managed_view_provider_binding.register_local_context($1::jsonb) AS value',[fixed]);}),
   registerManagedApplicationViewLocal:input=>operation(()=>{if(!applicationViewBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=validatePolicyIntent(input);if(fixed.schemaVersion!=='design-provider-intent-v8'||fixed.kind!=='local')invalid('POLICY_INVALID');return scalar('SELECT design_managed_application_view_provider_binding.register_local_context($1::jsonb) AS value',[fixed]);}),
   readCandidateProviderContext:input=>operation(()=>{if(!candidateBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=policyCopy(input);if(!fixed||Array.isArray(fixed)||Object.keys(fixed).sort().join('|')!=='candidateKind|evidenceBinding|mode|requestId'||!['visual_description','completion_comparison','completion_synthesis'].includes(fixed.candidateKind)||!['external','local'].includes(fixed.mode)||fixed.mode==='local'&&fixed.candidateKind!=='completion_synthesis'||typeof fixed.requestId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(fixed.requestId))invalid('POLICY_INVALID');return scalar('SELECT design_candidate_provider_binding.read_context($1::text,$2::text,$3::text,$4::jsonb) AS value',[fixed.candidateKind,fixed.mode,fixed.requestId,fixed.evidenceBinding]);}),
   readProcessingApproval:requestId=>operation(()=>{if(!candidateBinding)invalid('POLICY_REPOSITORY_DISABLED');if(typeof requestId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(requestId))invalid('POLICY_INVALID');return scalar('SELECT design_candidate_provider_binding.read_processing($1::text) AS value',[requestId]);}),
   registerLocalProviderContext:input=>operation(()=>{if(!candidateBinding)invalid('POLICY_REPOSITORY_DISABLED');const fixed=validatePolicyIntent(input);if(fixed.schemaVersion!=='design-provider-intent-v3'||fixed.kind!=='local')invalid('POLICY_INVALID');return scalar('SELECT design_candidate_provider_binding.register_local($1::jsonb) AS value',[fixed]);}),
   now:()=>operation(async()=>{const n=Number(await scalar('SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint AS value'));if(!Number.isSafeInteger(n))invalid('POLICY_REPOSITORY_INVALID');return n;}),
   verifyRequestContext:input=>operation(async()=>{const fixed=policyCopy(input);if(!applicationViewBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v8'||!applicationBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v7'||!normalizedBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v6'||!managedViewBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v5'||!managedBinding&&fixed?.intent?.schemaVersion==='design-provider-intent-v4')invalid('POLICY_REPOSITORY_INVALID');return await scalar(contextSQL,[fixed.authority,fixed.intent])===true;}),
   readApproval:key=>operation(async()=>checkedRow(await scalar('SELECT design_policy_private.read_approval($1::text) AS value',[policySHA(key)]),true)),
   insertApproval:(key,row)=>operation(()=>scalar('SELECT design_policy_private.insert_approval($1::text,$2::jsonb) AS value',[policySHA(key),checkedRow(row)])),
   casApproval:(key,revision,row)=>operation(()=>scalar('SELECT design_policy_private.cas_approval($1::text,$2::bigint,$3::jsonb) AS value',[policySHA(key),revision,checkedRow(row)])),
   readAttempt:key=>operation(async()=>checkedRow(await scalar('SELECT design_policy_private.read_attempt($1::text) AS value',[policySHA(key)]),true)),
   insertAttempt:(key,row)=>operation(()=>scalar('SELECT design_policy_private.insert_attempt($1::text,$2::jsonb) AS value',[policySHA(key),checkedRow(row)])),
   casAttempt:(key,revision,row)=>operation(()=>scalar('SELECT design_policy_private.cas_attempt($1::text,$2::bigint,$3::jsonb) AS value',[policySHA(key),revision,checkedRow(row)])),
   beforeCommit(guard){requireOpen();if(busy||finalizing||typeof guard!=='function'||guards.length>=8)invalid();guards.push(guard);}
  });
  try{
   beginAttempted=true;if((await query('BEGIN')).command!=='BEGIN')invalid();begun=true;
   await query("SET LOCAL statement_timeout='5000ms'");await query("SET LOCAL lock_timeout='2000ms'");await query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await query('SET LOCAL search_path=pg_catalog');
   const result=await work(tx);usable();if(busy)invalid();if(!authority)invalid('POLICY_AUTHORITY_REQUIRED');
   finalizing=true;
   for(const guard of guards){await guard();usable();if(busy)invalid();}
   // Close the public facade before final private recheck/clear and cleanup.
   // No guard can register another guard, and late callbacks cannot add SQL.
   finalChecking=true;await operation(()=>operations.recheck(authority),true,true);await operation(()=>operations.clear(),true,true);
   closed=true;committing=true;if((await query('COMMIT')).command!=='COMMIT')policyFail('POLICY_TRANSACTION_INVALID');committed=true;return result;
  }catch(error){
   closed=true;let rollbackFailed=busy;
   // Never send ROLLBACK concurrently with an unawaited query. Discard and
   // quarantine instead; waiting forever would let caller work hang cleanup.
   if(busy)quarantine=true;
   if(beginAttempted&&!committed&&!busy)try{if((await query('ROLLBACK')).command!=='ROLLBACK')rollbackFailed=true;}catch{rollbackFailed=true;}
   if(committing||rollbackFailed||beginAttempted&&!begun)throw unknown();
   throw safeError(error);
  }finally{
   closed=true;
   try{await release(committed?undefined:new Error('Discard policy transaction'));if(!quarantine)leased.delete(client);}
   catch{quarantine=true;try{await destroy?.();}catch{}throw unknown();}
  }
 }});
}
