/** Isolated Stage35 composition. One actual fixture database/immutable identity,
 * original key repository and shared provider attempt ledger. No import-side
 * effects. All issuer calls are explicit test actions, never runtime callbacks.
 * Storage is a native-version Map simulation wrapped by the formal adapter.
 * verifiedInput(native:false) is explicitly a MOCK strict verifier report;
 * native:true invokes the existing pinned offline image worker after PG claim.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCanonicalVerificationFixture} from './canonical-verification.mjs';
import {createManagedPrivateVersionedStorage,PRIVATE_VERSIONED_BACKEND_SCHEMA} from '../../packages/design-production-adapter/managed-private-versioned-storage.mjs';
import {createManagedNormalizedStore} from '../../packages/design-production-adapter/managed-normalized-store.mjs';
import {createManagedNormalizedModelPreview} from '../../packages/design-production-adapter/managed-normalized-model-preview.mjs';
import {createManagedNormalizedProviderAccess} from '../../packages/design-production-adapter/managed-normalized-provider-access.mjs';
import {createManagedNormalizedProviderFacade} from '../../packages/design-production-adapter/managed-normalized-provider-facade.mjs';
import {createManagedNormalizedProviderIssuers} from '../../packages/design-production-adapter/managed-normalized-provider-issuer.mjs';
import {buildManagedNormalizedProviderIntent} from '../../packages/design-production-adapter/managed-normalized-provider-contracts.mjs';
import {createManagedNormalizedModelDispatcher} from '../../packages/design-production-adapter/managed-normalized-model-dispatcher.mjs';
import {createImmutableDependencyRepository} from '../../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {createPreparedWorkflowService} from '../../packages/design-production-adapter/prepared-workflow-service.mjs';
import {createCanonicalNormalizationOperation} from '../../packages/design-production-adapter/managed-canonical-normalization-operation.mjs';
import {createCanonicalVerificationRunner} from '../../packages/design-production-adapter/managed-canonical-verification-runner.mjs';
import {createLocalCanonicalImageRuntime} from '../../packages/design-production-adapter/local-canonical-image-runtime.mjs';
import {syntheticCanonicalSourceBytes} from '../../packages/design-production-adapter/synthetic-canonical-image-fixture.mjs';
import {MANAGED_NORMALIZED_STRICT_CHECKS,createManagedNormalizedStrictReport} from '../../packages/design-production-adapter/managed-normalized-strict-contracts.mjs';
import {managedImageDigest as digest} from '../../packages/design-production-adapter/managed-image-contracts.mjs';
import {MANAGED_IMAGE_MODEL_ENDPOINT} from '../../packages/design-production-adapter/managed-image-model-request.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
import {canonicalProducerSeeds as seed} from './canonical-producer-seeds.mjs';
export async function createManagedNormalizedProviderFixture(){
 const f=await createCanonicalVerificationFixture();try{
  const install=file=>f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/'+file,import.meta.url),'utf8'));
  for(const file of ['stage23-dependency-proof-fixture.sql','stage29-managed-provider-binding-fixture.sql','stage29-managed-workflow-fixture.sql','stage30-managed-view-provider-binding-fixture.sql','stage30-managed-view-workflow-fixture.sql','stage30-managed-view-ancestor-helper-fixture.sql','stage30-managed-view-result-helper-fixture.sql'])install(file);
  const functionsSQL=`SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'sourceSha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',coalesce((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantee,x.grantor,x.privilege_type) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'[]'::jsonb)) ORDER BY p.oid),'[]')::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'design_%'`;
  const before=JSON.parse(f.sqlAdmin(functionsSQL));
  for(const file of ['stage35-normalized-provider-binding-fixture.sql','stage35-managed-normalized-workflow-fixture.sql'])install(file);
  const after=new Map(JSON.parse(f.sqlAdmin(functionsSQL)).map(x=>[x.signature,x])),changes=[];
  const expectedSourceChanges=['design_dependency_authority.check_record(jsonb,jsonb)','design_dependency_authority.append_native(jsonb)','design_dependency_authority.append_full(jsonb)','design_managed_workflow.verify_history(jsonb)','design_managed_view_workflow.verify_history(jsonb)'];
  const allowedAcl=['design_identity.require_authority()','design_dependency_authority.read_bundle()','design_dependency_authority.check_record(jsonb,jsonb)','design_dependency_authority.digest(jsonb)','design_dependency_authority.canonical(jsonb)','design_dependency_authority.prefix(jsonb,jsonb)'];
  for(const old of before){const now=after.get(old.signature);assert(now,'existing function disappeared');if(JSON.stringify(old)!==JSON.stringify(now))changes.push({before:old,after:now});}
  console.log('NORMALIZED_SQL_FUNCTION_DIFF '+JSON.stringify(changes));
  assert.deepEqual(changes.filter(x=>x.before.sourceSha256!==x.after.sourceSha256).map(x=>x.before.signature).sort(),expectedSourceChanges.sort());
  for(const {before:old,after:now} of changes){for(const k of ['owner','securityDefiner','config'])assert.deepEqual(now[k],old[k],old.signature+' '+k);for(const acl of old.acl)assert(now.acl.some(x=>JSON.stringify(x)===JSON.stringify(acl)),'original ACL removed');for(const acl of now.acl.filter(x=>!old.acl.some(y=>JSON.stringify(x)===JSON.stringify(y))))assert(allowedAcl.includes(old.signature)&&acl.grantee==='design_managed_normalized_workflow_capability'&&acl.privilege==='EXECUTE'&&acl.grantable===false,'unapproved old-function ACL change');}
  const originalSQL=functionsSQL,original=f.sqlAdmin(originalSQL);
  const {credential,scope}=f,common={credential,scope};let sends=0,keyOpens=0,nativeNormalizations=0,nativeVerifications=0,serial=0;
  const known=new Map(),nativeVersions=new Map();
  const register=(object,content,authorize)=>{known.set(object.key,{object,content:{sha256:content.sha256,byteLength:content.byteLength,mime:content.mime},authorize});nativeVersions.set(object.key,{object,mime:content.mime});};
  const backend={contract:{schemaVersion:PRIVATE_VERSIONED_BACKEND_SCHEMA,atomicCreateOnly:true,versionAddressedReads:true,retainedVersionsImmutable:true,privateOnly:true},
   async createOnce(q){assert.equal(q.ifAbsent,true);const ack=await f.canonicalStorage.putImmutable({target:q.target,source:q.content,bytes:q.bytes,private:q.private,overwrite:false,signal:q.signal});nativeVersions.set(q.target.key,{object:{...q.target,version:ack.objectVersion},mime:q.content.mime});return {target:ack.target,version:ack.objectVersion,created:ack.created,private:ack.private};},
   async readVersion(q){const x=nativeVersions.get(q.object.key);assert(x,'synthetic native object must exist');assert.deepEqual(q.object,x.object,'native version cannot fall back to path/latest');const bytes=await f.canonicalStorage.read({object:q.object});assert(bytes.length<=q.maxBytes);return {object:x.object,private:true,mime:x.mime,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};}}
  const storage=createManagedPrivateVersionedStorage({enabled:true,projectOrigin:'https://syntheticmanaged.supabase.co',bucket:'managed-private',backend,timeoutMs:30000,authorize:async q=>{
   const x=known.get(q.target.key);if(!x||q.target.projectOrigin!==x.object.projectOrigin||q.target.bucket!==x.object.bucket)return false;assert.deepEqual(q.content,x.content);if(q.objectVersion!==null){const current=nativeVersions.get(q.target.key);if(!current||current.object.version!==q.objectVersion)return false;}await x.authorize();return true;
  }});
  const access=createManagedNormalizedProviderAccess({enabled:true,acquireClient:f.acquire}),facade=createManagedNormalizedProviderFacade({enabled:true,acquireClient:f.acquire});
  const diagnosticClient=role=>async()=>{const c=f.clientForRole(role,'stage35-independent-issuer');return {...c,async query(sql,p){try{return await c.query(sql,p);}catch(e){console.log('NORMALIZED_SQL_DIAGNOSTIC '+JSON.stringify({role,operation:sql.match(/design_normalized_provider_binding\.([a-z_]+)\(/)?.[1]??'transaction',sqlstate:/^[A-Z0-9]{5}$/.test(e?.code)?e.code:'unknown',category:/^[A-Z_]{1,80}$/.test(e?.message)?e.message:'other'}));throw e;}}};};
  const issuers=createManagedNormalizedProviderIssuers({enabled:true,...Object.fromEntries(['Processing','Cost','Approval'].map(k=>['acquire'+k+'IssuerClient',diagnosticClient('design_normalized_model_'+k.toLowerCase()+'_issuer')]))});
  const bridge=(acquireClient=f.acquire)=>createImmutableDependencyRepository({enabled:true,acquireClient,managedNormalizedEnabled:true,managedViewsEnabled:true,managedCandidatesEnabled:true,proofReadsEnabled:true});
  const compose=(acquireClient)=>{const repo=bridge(acquireClient),workflow=createPreparedWorkflowService({enabled:true,permissionGate:repo.permissionGate,repository:repo.repository,mediaResolver:repo.mediaResolver,mediaVerifier:repo.mediaVerifier,candidateAcceptanceVerifier:repo.verifySynthesisAcceptance});return {repo,workflow,candidates:repo.createManagedCandidateRepository({normalized:true}),full:repo.createFullWorkflowArchive({enabled:true})};};
  let composition=compose();const run=fn=>composition.repo.runRequest(common,()=>fn(composition));
  const load=()=>run(c=>c.workflow.load(common));
  const dispatch=async(intent,{requestId='stage35-native-'+(++serial),expectedRevision}={})=>{if(expectedRevision===undefined)expectedRevision=(await load()).record.revision;return run(c=>c.workflow.dispatch({...common,requestId,expectedRevision,intent}));};
  const preparer=createManagedNormalizedModelPreview({enabled:true,ledger:f.canonicalLedger,storage,modelConfig:{model:f.modelConfig.model,maxOutputTokens:f.modelConfig.maxTokens},approvedModels:[f.modelConfig.model],timeoutMs:30000});
  async function verifiedInput({id,ext='jpg',native=false}){
   const parent=await f.seedCanonicalParent({id,...seed(ext)});
   register(parent.sourceRecord.object,parent.sourceRecord.source,async()=>{assert.deepEqual((await f.ledger.readSourceStatus({...common,mediaId:parent.sourceRecord.mediaId})).sourceRecord,parent.sourceRecord);});
   register(parent.parentObjectReceipt.object,parent.parentObjectReceipt.derivative,async()=>{assert.deepEqual(await f.derivedLedger.readObject({...common,responseDigest:digest(parent.parentResponse)}),parent.parentObjectReceipt);});
   await f.processingIssuer.issueProcessing({...common,permissionId:'norm-processing-'+id,intent:parent.intent,ttlMs:900000});
   let out;
   if(native){const imageRuntime=createLocalCanonicalImageRuntime({enabled:true}),runtime={async normalizeSynthetic(q){nativeNormalizations++;assert.equal((await f.processing.readClaim({...common,requestId:parent.intent.requestId})).artifactDigest,null);return imageRuntime.normalizeSynthetic(q);}};out=await createCanonicalNormalizationOperation({enabled:true,processing:f.processing,storage,runtime,timeoutMs:30000}).run({...common,mediaId:parent.sourceRecord.mediaId,parentRequestId:parent.parentResponse.descriptor.requestId,requestId:parent.intent.requestId});}
   else{assert.equal(await f.processing.claim({...common,intent:parent.intent}),'created');await f.processing.guard({...common,intent:parent.intent});const bytes=Uint8Array.from(syntheticCanonicalSourceBytes());out={bytes,claimedArtifact:await f.bindCanonicalOutput({parent,normalizedBytes:bytes})};}
   try{
    const {claimedArtifact,bytes}=out,{artifact}=claimedArtifact,intent=f.normalizedPutIntent(artifact);
    known.set(intent.target.key,{object:intent.target,content:{sha256:artifact.output.sha256,byteLength:artifact.output.byteLength,mime:artifact.output.mime},authorize:async()=>{assert.deepEqual(await f.processing.readBoundArtifact({...common,requestId:artifact.requestId}),claimedArtifact);assert.equal(await f.normalizedLedger.guardPut({...common,intent}),true);}});
    await f.approveCanonicalStorage({artifact,permissionId:'norm-storage-'+id});
    await createManagedNormalizedStore({enabled:true,repository:f.normalizedLedger,storage,projectOrigin:intent.target.projectOrigin,bucket:intent.target.bucket,cost:f.cost,timeoutMs:30000}).put({...common,artifact,bytes});
    const objectReceipt=await f.normalizedLedger.readObject({...common,artifactDigest:digest(artifact)}),taskId='norm-task-'+id,task=await f.canonicalIssuers.issueTask({...common,taskId,requestId:artifact.requestId,ttlMs:900000});assert.deepEqual(task.objectReceipt,objectReceipt);
    if(native){const imageRuntime=createLocalCanonicalImageRuntime({enabled:true}),runtime={async verifyTask(q){nativeVerifications++;return imageRuntime.verifyTask(q);}};await createCanonicalVerificationRunner({enabled:true,issuer:f.canonicalIssuers,storage,runtime,timeoutMs:30000}).run({...common,taskId});}
    else{const report=createManagedNormalizedStrictReport({task,checks:Object.fromEntries(MANAGED_NORMALIZED_STRICT_CHECKS.map(k=>[k,'verified']))});await f.canonicalIssuers.publishReport({...common,taskId,report});}
    const packet=await f.canonicalLedger.readVerified({...common,taskId});return {parent,claimedArtifact,objectReceipt,taskId,...packet,native};
   }finally{out.bytes.fill(0);}
  }
  const plan=async({requestId,taskId})=>{const context=await access.readContext({...common,requestId,taskId}),prepared=await preparer.prepare({...common,requestId,taskId}),intent=buildManagedNormalizedProviderIntent({prepared,keyBinding:context.keyBinding,workflowBinding:context.workflowBinding,cost:f.cost});return {context,prepared,intent,request:{...common,requestId,taskId,expectedWorkflowRevision:context.workflowBinding.recordRevision}};};
  async function approve(p,{processing=true,cost=true,approval=true,ttlMs=900000}={}){for(const [key,on] of [['Processing',processing],['Cost',cost],['Approval',approval]])if(on)await issuers['issue'+key]({...common,receiptId:'normalized-'+key.toLowerCase()+'-'+p.intent.requestId,intent:p.intent,ttlMs});return p;}
  const response=(content={observations:[{field:'visible_outline',value:'轮廓偏圆'}]})=>Uint8Array.from(Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}]})));
  const countingSealer={async open(...args){keyOpens++;return f.sealer.open(...args);},digest:(...args)=>f.sealer.digest(...args)};
  const dispatcher=(options={})=>createManagedNormalizedModelDispatcher({enabled:true,executionMode:'synthetic_mock',preparer,facade,sealer:countingSealer,timeoutMs:30000,transport:async r=>{sends++;assert.equal(r.url,MANAGED_IMAGE_MODEL_ENDPOINT);assert.equal(r.redirect,'error');assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_stat_activity WHERE usename='design_identity_runtime' AND state LIKE 'idle in transaction%'"),'0','no key/model call while holding runtime transaction');if(options.beforeReply)await options.beforeReply(r);return {url:r.url,status:200,redirected:false,body:response(options.content)};},...options});
  return {...f,normalizedStorage:storage,normalizedAccess:access,normalizedFacade:facade,normalizedIssuers:issuers,normalizedPreparer:preparer,normalizedPlan:plan,normalizedApprove:approve,normalizedDispatcher:dispatcher,normalizedResponse:response,verifiedNormalizedInput:verifiedInput,normalizedLoad:load,normalizedDispatch:dispatch,normalizedRun:run,normalizedRunWithClient:async(acquireClient,fn)=>{const c=compose(acquireClient);return c.repo.runRequest(common,()=>fn(c));},recreateNormalizedComposition:()=>{composition=compose();},normalizedCounts:()=>({sends,keyOpens,nativeNormalizations,nativeVerifications}),normalizedOriginalSQL:originalSQL,normalizedOriginal:original};
 }catch(e){await f.cleanup();throw e;}
}
