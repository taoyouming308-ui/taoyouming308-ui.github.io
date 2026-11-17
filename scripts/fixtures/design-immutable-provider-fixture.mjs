/** Synthetic-only Stage18 composition helper. No production issuer, credentials or network. */
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {createDesignIdentityPostgresFixture} from './design-identity-postgres-fixture.mjs';
import {createPostgresImmutableKeyRepository,createPostgresKeyApprovalIssuer} from '../../packages/design-production-adapter/postgres-immutable-key-repository.mjs';
import {createImmutablePreparedDesignKeySettings} from '../../packages/design-production-adapter/key-settings.mjs';
import {createImmutableDesignKeySealer} from '../../packages/design-production-adapter/key-crypto.mjs';
import {createPostgresImmutableProviderAccess,createPostgresProviderApprovalIssuer} from '../../packages/design-production-adapter/postgres-immutable-provider-access.mjs';
import {createImmutableDependencyRepository} from '../../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {createPreparedWorkflowService} from '../../packages/design-production-adapter/prepared-workflow-service.mjs';
import {buildDesignExtractionPrompt} from '../../packages/prompts/design-extraction.mjs';
import {validateMonoPcmWav} from '../../packages/design-production-adapter/speech-adapter.mjs';
import {validatePolicyIntent,policyOwnerKey} from '../../packages/design-production-adapter/approval-attempt-contracts.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
export const STAGE18_SYNTHETIC_KEY='STAGE18_SYNTHETIC_NOT_A_REAL_PROVIDER_KEY_123456';
export const STAGE18_MODEL_CONFIG=Object.freeze({model:'synthetic-model',maxTokens:256,approved:true});
export function stage18SyntheticWav(){const b=Buffer.alloc(44+320);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(320,40);return Uint8Array.from(b);}
export async function createImmutableProviderPostgresFixture({timingObserver,profileDatabase=false}={}){
 const f=await createDesignIdentityPostgresFixture({timingObserver,profileDatabase});let serial=0;
 try{
  for(const file of ['stage13-provider-policy-fixture.sql','stage15-key-repository-fixture.sql','stage16-workflow-authority-fixture.sql','stage17-dependency-authority-fixture.sql','stage18-provider-key-binding-fixture.sql','stage18-immutable-visit-fixture.sql'])f.sqlAdmin(readFileSync(new URL('../../packages/design-production-adapter/drafts/'+file,import.meta.url),'utf8'));
  const secretProvider=async()=>new Uint8Array(32).fill(42),sealer=createImmutableDesignKeySealer({secretProvider,cryptoProvider:webcrypto});
  const keyRepo=createPostgresImmutableKeyRepository({enabled:true,acquireClient:f.acquireRuntimeClient});
  const keyIssuer=createPostgresKeyApprovalIssuer({enabled:true,acquireIssuerClient:async()=>f.clientForRole('design_key_issuer','stage18-key-issuer')});
  const keySettings=createImmutablePreparedDesignKeySettings({enabled:true,resolveIdentity:keyRepo.resolveIdentity,repository:keyRepo,sealer,approvedModels:['synthetic-model'],allowASR:true});
  const access=createPostgresImmutableProviderAccess({enabled:true,acquireClient:f.acquireRuntimeClient});
  // Test-only fixed diagnostics: never SQL, parameters, credentials, key digest or payload.
  const issuerDiagnostic=client=>({...client,async query(sql,params){
   const operation=sql.startsWith('SELECT design_provider_binding.issue_approval(')?'issue_approval':sql.startsWith('SELECT design_provider_binding.revoke_approval(')?'revoke_approval':['COMMIT','ROLLBACK'].includes(sql)?sql:'control';
   try{const result=await client.query(sql,params);if(operation==='issue_approval')console.log('PROVIDER_ISSUER_DIAGNOSTIC '+JSON.stringify({operation,stage:'sql_returned',rowCount:result.rowCount}));return result;}
   catch(error){const allowed=new Set(['PROVIDER_APPROVAL_INVALID','PROVIDER_BINDING_CHANGED','PROVIDER_APPROVAL_CONFLICT','PROVIDER_REQUEST_CONFLICT','PROVIDER_AUTHORITY_CHANGED','PROVIDER_APPROVAL_EXPIRED','PROVIDER_CONTEXT_UNAVAILABLE','PROVIDER_KEY_DENIED','PROVIDER_SOURCE_DENIED','PROVIDER_CANDIDATE_OWNERSHIP_DENIED','IDENTITY_DENIED']);console.log('PROVIDER_ISSUER_DIAGNOSTIC '+JSON.stringify({operation,stage:'sql_rejected',sqlstate:/^[A-Z0-9]{5}$/.test(error?.code)?error.code:'unknown',category:allowed.has(error?.message)?error.message:error?.message==='permission denied for function canonical'?'permission_canonical':error?.message==='permission denied for function digest'?'permission_digest':'other'}));throw error;}
  }});
  const providerIssuer=createPostgresProviderApprovalIssuer({enabled:true,acquireIssuerClient:async()=>issuerDiagnostic(f.clientForRole('design_provider_approval_issuer','stage18-provider-issuer'))});
  const bridge=createImmutableDependencyRepository({enabled:true,acquireClient:f.acquireRuntimeClient});
  const workflow=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository,mediaResolver:bridge.mediaResolver,mediaVerifier:bridge.mediaVerifier,candidateAcceptanceVerifier:bridge.verifySynthesisAcceptance});
  const run=(work,credential=f.credential,scope=f.scopeA)=>bridge.runRequest({credential,scope},work);
  const load=(credential=f.credential,scope=f.scopeA)=>run(()=>workflow.load({credential,scope}),credential,scope);
  async function dispatch(intent,{credential=f.credential,scope=f.scopeA,requestId='stage18-fixture-'+(++serial)}={}){return run(async()=>{const {record}=await workflow.load({credential,scope});return workflow.dispatch({credential,scope,requestId,expectedRevision:record.revision,intent});},credential,scope);}
  async function saveKey({credential=f.credential,purpose='chat',key=STAGE18_SYNTHETIC_KEY,remove=false}={}){
   const identity=await keyRepo.resolveIdentity({credential}),status=await keySettings.status({credential,purpose}),receiptId='stage18-key-'+(++serial),config=purpose==='chat'?{destination:'https://api.deepseek.com/chat/completions',model:'synthetic-model'}:{destination:'https://api.deepseek.com/v1/tools/asr',model:null};
   const intent={schemaVersion:'design-key-approval-v2',...Object.fromEntries(['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision'].map(k=>[k,identity[k]])),purpose,action:remove?'revoke-design-key':'persist-design-key',...config,expectedRevision:status.revision,keyDigest:remove?null:await sealer.digest(key)};
   await keyIssuer.issue({credential,receiptId,intent,ttlMs:300000});return remove?keySettings.revoke({credential,approval:{receiptId},purpose,expectedRevision:status.revision}):keySettings.save({credential,approval:{receiptId},expectedRevision:status.revision,config,key});
  }
  async function plan({requestId,operation='analyze',audioBytes=stage18SyntheticWav(),credential=f.credential,scope=f.scopeA,cost={currency:'USD',maximumMinorUnits:2,commitment:'one_time'}}){
   const context=await access.readContext({credential,scope,purpose:operation==='speech'?'speech':'chat',requestId});let payloadSha256,byteLength,dataKinds,purpose,inputDigest,maxOutputTokens;
   if(operation==='analyze'){
    const {record}=await load(credential,scope),prompt=buildDesignExtractionPrompt(record.session),body=JSON.stringify({model:STAGE18_MODEL_CONFIG.model,messages:[...prompt.messages,{role:'system',content:JSON.stringify({responseSchema:prompt.responseSchema})}],max_tokens:STAGE18_MODEL_CONFIG.maxTokens,response_format:{type:'json_object'},stream:false});
    payloadSha256=sha(body);byteLength=Buffer.byteLength(body);dataKinds=['scoped_human_text','speech_transcript_if_present'];purpose='verbatim_design_text_extraction';inputDigest=context.sourceBinding.sessionDigest;maxOutputTokens=STAGE18_MODEL_CONFIG.maxTokens;
   }else{const wav=validateMonoPcmWav(audioBytes);payloadSha256=wav.sha256;byteLength=wav.byteLength;dataKinds=['mono_pcm16_wav'];purpose='transcribe_for_employee_review';inputDigest=payloadSha256;maxOutputTokens=null;}
   const intent=validatePolicyIntent({schemaVersion:'design-provider-intent-v2',requestId,kind:'external',operation,destination:context.keyBinding.destination,model:context.keyBinding.model,payloadSha256,byteLength,dataKinds,purpose,inputDigest,sourceRefs:[],maxOutputTokens,cost,keyBinding:context.keyBinding,sourceBinding:context.sourceBinding});return {context,intent,ownerKey:policyOwnerKey(context.authority,requestId)};
  }
  async function issueRequest(input){const prepared=await plan(input),receiptId='stage18-provider-'+(++serial);const receipt=await providerIssuer.issue({credential:input.credential??f.credential,scope:input.scope??f.scopeA,receiptId,intent:prepared.intent,ttlMs:900000});return {...prepared,receipt};}
  await run(()=>bridge.initialize());await dispatch({type:'record_source',kind:'text',text:'【合成原话】我希望短发。'});await saveKey();await saveKey({purpose:'speech'});
  return Object.freeze({...f,secretProvider,sealer,keyRepo,keyIssuer,keySettings,access,providerIssuer,bridge,workflow,run,load,dispatch,saveKey,plan,issueRequest,modelConfig:STAGE18_MODEL_CONFIG});
 }catch(error){await f.cleanup();throw error;}
}
