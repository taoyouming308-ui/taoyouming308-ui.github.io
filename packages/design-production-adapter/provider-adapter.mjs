import {Buffer} from 'node:buffer';
/** Server-only prepared provider boundary. No default network, credentials or storage. */
import {createHash} from 'node:crypto';
import {validateDesignSession,validateDesignPilotResult} from '../analysis-engine/design-pilot.mjs';
import {buildDesignPilotPrompt} from '../prompts/design-pilot.mjs';

export const DEEPSEEK_CHAT_ENDPOINT='https://api.deepseek.com/chat/completions';
export const DEEPSEEK_ASR_ENDPOINT='https://api.deepseek.com/v1/tools/asr';
const CODES=new Set(['ADAPTER_DISABLED','ADAPTER_NOT_CONFIGURED','INVALID_REQUEST','INVALID_SCOPE','INVALID_CONTEXT','CONTEXT_SCOPE_MISMATCH','MODEL_NOT_APPROVED','MEDIA_NOT_SUPPORTED','ACCESS_DENIED','ACTOR_CHANGED','TRANSMISSION_DENIED','KEY_UNAVAILABLE','INVALID_KEY','ATTEMPT_STORE_FAILED','REQUEST_IN_FLIGHT','REQUEST_CONFLICT','PREVIOUS_ATTEMPT_NOT_SENT','OUTCOME_UNCERTAIN','REDIRECT_REJECTED','PROVIDER_REJECTED','INVALID_PROVIDER_RESPONSE','RESPONSE_TOO_LARGE','INVALID_RESULT','TRANSPORT_FAILED','TIMEOUT','ASR_INVALID_WAV','ASR_UNSUPPORTED_FORMAT','ASR_OGG_NOT_SUPPORTED','ASR_STEREO_NOT_SUPPORTED','ASR_TOO_LARGE','ASR_TOO_LONG','ASR_INVALID_RATE','ASR_EMPTY']);
export class DesignProviderError extends Error {
  constructor(code,outcome='not_sent') { const safe=CODES.has(code)?code:'INVALID_REQUEST';super(safe);this.name='DesignProviderError';this.code=safe;this.outcome=outcome;this.retryable=false; }
}
const fail=code=>{throw new DesignProviderError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys,code='INVALID_REQUEST')=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail(code);};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const providerDigest=value=>createHash('sha256').update(value).digest('hex');
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
function scopeOf(value){exact(value,['customerProfileId','visitId','assignmentSource'],'INVALID_SCOPE');if(!identifier(value.customerProfileId)||!identifier(value.visitId)||!['appointment','frontdesk'].includes(value.assignmentSource))fail('INVALID_SCOPE');return freeze({...value});}
export function validateProviderRequest(request,extra){exact(request,['requestId','credential','scope',...extra]);if(!identifier(request.requestId))fail('INVALID_REQUEST');return {requestId:request.requestId,credential:request.credential,scope:scopeOf(request.scope)};}
function safeError(error,outcome){return new DesignProviderError(error instanceof DesignProviderError?error.code:'KEY_UNAVAILABLE',outcome);}
function resultEnvelope(result,fixed,prepared,actor){
  exact(result,['requestId','provider','operation','actor','scope','payloadSha256','requiresReview',...prepared.resultFields],'ATTEMPT_STORE_FAILED');
  if(!plain(result)||result.requestId!==fixed.requestId||result.provider!=='deepseek'||result.operation!==prepared.operation||result.payloadSha256!==prepared.payloadSha256||canonical(result.scope)!==canonical(fixed.scope)||canonical(result.actor)!==canonical(actor)||result.requiresReview!==true)fail('ATTEMPT_STORE_FAILED');
  prepared.validateResult(result);return result;
}
/** Explicit test helper. NOT durable, not a production idempotency implementation. */
export function createInMemoryProviderAttemptStore({testOnly=false}={}){
  if(testOnly!==true)fail('ADAPTER_NOT_CONFIGURED');const rows=new Map();
  return Object.freeze({async reserve({key,fingerprint}){if(rows.has(key))return {created:false,...clone(rows.get(key))};rows.set(key,{fingerprint,state:'pending'});return {created:true};},async settle({key,fingerprint,state,result}){const row=rows.get(key);if(!row||row.fingerprint!==fingerprint||row.state!=='pending'||!['completed','uncertain','not_sent'].includes(state))throw new Error('attempt settlement rejected');rows.set(key,{fingerprint,state,...(state==='completed'?{result:clone(result)}:{})});}});
}
/** Internal shared runner for the two fixed provider operations; transport is trusted server code. */
export function createDeepSeekOperationRunner(config={}){
  const {enabled=false,transport,keyResolver,permissionGate,transmissionGate,attemptStore,timeoutMs=30000}=config;
  return async function run(fixed,prepared){
    if(enabled!==true)fail('ADAPTER_DISABLED');
    if(typeof transport!=='function'||typeof keyResolver!=='function'||typeof permissionGate?.authorize!=='function'||typeof transmissionGate!=='function'||typeof attemptStore?.reserve!=='function'||typeof attemptStore?.settle!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)fail('ADAPTER_NOT_CONFIGURED');
    if(!((prepared.operation==='analyze'&&prepared.endpoint===DEEPSEEK_CHAT_ENDPOINT)||(prepared.operation==='speech'&&prepared.endpoint===DEEPSEEK_ASR_ENDPOINT&&prepared.model===null)))fail('INVALID_REQUEST');
    let actor;
    async function reauthorize(){let grant;try{grant=await permissionGate.authorize(fixed.credential,fixed.scope);}catch{fail('ACCESS_DENIED');}if(!plain(grant)||!plain(grant.actor)||!identifier(grant.actor.username)||!identifier(grant.actor.store)||canonical(grant.scope)!==canonical(fixed.scope))fail('ACCESS_DENIED');const latest={username:grant.actor.username,store:grant.actor.store};if(actor&&canonical(latest)!==canonical(actor))fail('ACTOR_CHANGED');actor=freeze(latest);}
    await reauthorize();
    const disclosure=freeze({requestId:fixed.requestId,actor,scope:fixed.scope,provider:'deepseek',operation:prepared.operation,destination:prepared.endpoint,model:prepared.model,payloadSha256:prepared.payloadSha256,byteLength:prepared.byteLength,dataKinds:[...prepared.dataKinds],purpose:prepared.operation==='speech'?'transcribe_for_employee_review':'design_candidates_for_employee_review',mayIncurCharge:true});
    async function allowTransmission(stage){let allowed;try{allowed=await transmissionGate({...disclosure,stage});}catch{fail('TRANSMISSION_DENIED');}if(allowed!==true)fail('TRANSMISSION_DENIED');}
    // Approval belongs to the exact employee/scope/request/payload and endpoint, never a model-config flag.
    await allowTransmission('before_reserve');
    const key=providerDigest(canonical([actor,fixed.requestId]));
    const fingerprint=providerDigest(canonical({scope:fixed.scope,operation:prepared.operation,model:prepared.model,endpoint:prepared.endpoint,payloadSha256:prepared.payloadSha256}));
    if(typeof attemptStore.bind==='function'){try{if(await attemptStore.bind({key,fingerprint,disclosure})!==true)fail('ATTEMPT_STORE_FAILED');}catch{fail('ATTEMPT_STORE_FAILED');}}
    let reservation;try{reservation=await attemptStore.reserve({key,fingerprint});}catch{if(typeof attemptStore.authorizeDispatch==='function')throw new DesignProviderError('ATTEMPT_STORE_FAILED','uncertain');fail('ATTEMPT_STORE_FAILED');}
    if(!plain(reservation)||typeof reservation.created!=='boolean')fail('ATTEMPT_STORE_FAILED');
    if(!reservation.created){
      if(reservation.fingerprint!==fingerprint)fail('REQUEST_CONFLICT');
      if(reservation.state==='completed'){
        let result;try{result=resultEnvelope(clone(reservation.result),fixed,prepared,actor);}catch{fail('ATTEMPT_STORE_FAILED');}
        await reauthorize();await allowTransmission('before_replay_return');await reauthorize();if(typeof attemptStore.authorizeReturn==='function'&&await attemptStore.authorizeReturn({key,fingerprint})!==true)fail('ACCESS_DENIED');return freeze({...result,replayed:true});
      }
      if(reservation.state==='pending'||reservation.state==='dispatch_claimed')throw new DesignProviderError('REQUEST_IN_FLIGHT','uncertain');
      if(reservation.state==='uncertain')throw new DesignProviderError('OUTCOME_UNCERTAIN','uncertain');
      if(reservation.state==='not_sent')fail('PREVIOUS_ATTEMPT_NOT_SENT');
      fail('ATTEMPT_STORE_FAILED');
    }
    let dispatched=false,dispatchClaimAttempted=false,callbackCalls=0,callbackResult,callbackPromise,closed=false;
    try{
      await keyResolver(freeze({credential:fixed.credential,actor,scope:fixed.scope,provider:'deepseek',destination:prepared.endpoint,model:prepared.model}),keyValue=>{
        callbackCalls++;if(closed||callbackCalls!==1)fail('KEY_UNAVAILABLE');
        callbackPromise=(async()=>{
          if(typeof keyValue!=='string'||keyValue.length<8||keyValue.length>512||!/^[A-Za-z0-9._~-]+$/.test(keyValue))fail('INVALID_KEY');
          await reauthorize();await allowTransmission('before_send');await reauthorize();
          if(closed)fail('KEY_UNAVAILABLE');
          const controller=new AbortController();let timer;
          try{
            const request={url:prepared.endpoint,method:'POST',headers:{...prepared.headers,Authorization:'Bearer '+keyValue},body:prepared.body,redirect:'error',credentials:'omit',signal:controller.signal,maxResponseBytes:262144};
            let transportPromise;
            if(typeof attemptStore.authorizeDispatch==='function'){
              // Claim includes fresh authority, approval and source authorization.
              // Once attempted, loss of commit acknowledgement is not safely retryable.
              dispatchClaimAttempted=true;
              if(await attemptStore.authorizeDispatch({key,fingerprint})!==true)fail('TRANSMISSION_DENIED');
              if(closed)fail('KEY_UNAVAILABLE');
              dispatched=true;
              // No intervening await or deferred microtask after final permission.
              try{transportPromise=Promise.resolve(transport(request));}catch{throw new DesignProviderError('TRANSPORT_FAILED','uncertain');}
            }else{dispatched=true;transportPromise=Promise.resolve().then(()=>transport(request));}
            const response=await Promise.race([
              transportPromise.catch(()=>{throw new DesignProviderError('TRANSPORT_FAILED','uncertain');}),
              new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DesignProviderError('TIMEOUT','uncertain'));},timeoutMs);}),
            ]);
            if(!plain(response)||response.url!==prepared.endpoint||response.redirected!==false||!Number.isInteger(response.status))fail('REDIRECT_REJECTED');
            if(response.status>=300&&response.status<400)fail('REDIRECT_REJECTED');
            if(response.status!==200)fail('PROVIDER_REJECTED');
            if(!plain(response.headers)||!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']||''))fail('INVALID_PROVIDER_RESPONSE');
            const bytes=typeof response.body==='string'?Buffer.from(response.body):response.body instanceof Uint8Array?Buffer.from(response.body):null;
            if(!bytes)fail('INVALID_PROVIDER_RESPONSE');if(bytes.length>262144)fail('RESPONSE_TOO_LARGE');
            let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('INVALID_PROVIDER_RESPONSE');}
            // Never expose a provider/key callback accidentally echoing the credential, even in a successful body.
            if(raw.includes(keyValue))fail('INVALID_PROVIDER_RESPONSE');
            let parsed;try{parsed=JSON.parse(raw);}catch{fail('INVALID_PROVIDER_RESPONSE');}
            callbackResult=prepared.parse(parsed);
            if(JSON.stringify(callbackResult).includes(keyValue))fail('INVALID_PROVIDER_RESPONSE'); // Also catch JSON-escaped echoes after decoding.
            return callbackResult;
          }finally{clearTimeout(timer);controller.abort();}
        })();
        void callbackPromise.catch(()=>{}); // A misbehaving resolver must not create unhandled rejections.
        return callbackPromise;
      });
      closed=true;
      if(callbackCalls!==1||!callbackPromise)fail('KEY_UNAVAILABLE');
      await callbackPromise;
      await reauthorize();await allowTransmission('before_return');
      const result=freeze({requestId:fixed.requestId,provider:'deepseek',operation:prepared.operation,actor,scope:fixed.scope,payloadSha256:prepared.payloadSha256,...callbackResult,requiresReview:true});
      resultEnvelope(result,fixed,prepared,actor);
      try{await attemptStore.settle({key,fingerprint,state:'completed',result});}catch{throw new DesignProviderError('ATTEMPT_STORE_FAILED','uncertain');}
      await reauthorize();if(typeof attemptStore.authorizeReturn==='function'&&await attemptStore.authorizeReturn({key,fingerprint})!==true)fail('ACCESS_DENIED');return freeze({...result,replayed:false});
    }catch(error){
      closed=true;
      // Once transport has been invoked, even malformed/failed responses may have incurred a charge.
      const outcome=dispatched||dispatchClaimAttempted?'uncertain':'not_sent';
      try{await attemptStore.settle({key,fingerprint,state:outcome});}catch{/* Keep existing pending/completed tombstone; never retry or overwrite. */}
      throw safeError(error,outcome);
    }
  };
}

export function createDeepSeekProviderAdapter(config={}){
  const run=createDeepSeekOperationRunner(config);
  // Copy approved server configuration now; request bodies cannot select URLs or models.
  const modelConfig=config.modelConfig?clone(config.modelConfig):null;
  return Object.freeze({async analyze(request){
    if(config.enabled!==true)fail('ADAPTER_DISABLED');
    const fixed=validateProviderRequest(request,['session']);
    if(!plain(modelConfig)||Object.keys(modelConfig).sort().join('|')!=='approved|maxTokens|model'||modelConfig.approved!==true||typeof modelConfig.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(modelConfig.model)||!Number.isInteger(modelConfig.maxTokens)||modelConfig.maxTokens<1||modelConfig.maxTokens>8192)fail('MODEL_NOT_APPROVED');
    let session,prompt;
    try{const serialized=JSON.stringify(request.session);if(Buffer.byteLength(serialized)>524288)fail('INVALID_CONTEXT');session=validateDesignSession(JSON.parse(serialized));}catch{fail('INVALID_CONTEXT');}
    if(session.scope.customerId!==fixed.scope.customerProfileId||session.scope.visitId!==fixed.scope.visitId)fail('CONTEXT_SCOPE_MISMATCH');
    // This prepared stage deliberately has no image input path or inferred photo authorization.
    if(session.sources.some(source=>!['text','speech_transcript'].includes(source.kind)))fail('MEDIA_NOT_SUPPORTED');
    try{prompt=buildDesignPilotPrompt(session);}catch{fail('INVALID_CONTEXT');}
    const body=JSON.stringify({model:modelConfig.model,messages:[prompt.messages[0],{role:'system',content:JSON.stringify({responseSchema:prompt.responseSchema})},...prompt.messages.slice(1)],max_tokens:modelConfig.maxTokens,response_format:{type:'json_object'},stream:false});
    if(Buffer.byteLength(body)>196608)fail('INVALID_CONTEXT');
    const validateResult=result=>{
      if(result.model!==modelConfig.model||result.sessionId!==session.scope.sessionId||result.baseRevision!==session.revision||result.promptVersion!==prompt.promptVersion)fail('INVALID_RESULT');
      try{validateDesignPilotResult(result.candidate,session);}catch{fail('INVALID_RESULT');}
    };
    return run(fixed,{operation:'analyze',endpoint:DEEPSEEK_CHAT_ENDPOINT,model:modelConfig.model,payloadSha256:providerDigest(body),byteLength:Buffer.byteLength(body),dataKinds:['scoped_text','speech_transcript_if_present'],body,headers:{'Content-Type':'application/json'},resultFields:['model','sessionId','baseRevision','promptVersion','candidate'],validateResult,parse(value){
      if(!plain(value)||value.object!=='chat.completion'||!identifier(value.id)||value.model!==modelConfig.model||!Number.isInteger(value.created)||value.created<0||!Array.isArray(value.choices)||value.choices.length!==1)fail('INVALID_PROVIDER_RESPONSE');
      const choice=value.choices[0],message=choice?.message;
      if(!plain(choice)||choice.index!==0||choice.finish_reason!=='stop'||!plain(message)||message.role!=='assistant'||typeof message.content!=='string'||!message.content.trim()||message.content.length>100000||(message.tool_calls!=null&&(!Array.isArray(message.tool_calls)||message.tool_calls.length>0))||(message.server_tool_calls!=null&&(!Array.isArray(message.server_tool_calls)||message.server_tool_calls.length>0))||message.refusal)fail('INVALID_PROVIDER_RESPONSE');
      let candidate;try{candidate=validateDesignPilotResult(JSON.parse(message.content),session);}catch{fail('INVALID_RESULT');}
      return {model:modelConfig.model,sessionId:session.scope.sessionId,baseRevision:session.revision,promptVersion:prompt.promptVersion,candidate};
    }});
  }});
}
