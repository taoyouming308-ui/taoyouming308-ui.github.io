#!/usr/bin/env node
// Synthetic in-memory fixtures only. No real keys, employees, audio, network or charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekProviderAdapter,createInMemoryProviderAttemptStore,DEEPSEEK_CHAT_ENDPOINT,DEEPSEEK_ASR_ENDPOINT} from '../packages/design-production-adapter/provider-adapter.mjs';
import {createDeepSeekSpeechAdapter,validateMonoPcmWav,ASR_MAX_BYTES} from '../packages/design-production-adapter/speech-adapter.mjs';
import {createDesignSession,appendDesignEvent} from '../packages/analysis-engine/design-pilot.mjs';
globalThis.fetch=()=>{throw new Error('Network forbidden in provider tests');};
const CREDENTIAL=Symbol('synthetic-session-only'),KEY='test-only-not-a-real-key',MODEL='approved-test-model';
const SCOPE={customerProfileId:'synthetic-profile',visitId:'synthetic-visit',assignmentSource:'appointment'};
const ACTOR={username:'synthetic-employee',store:'synthetic-store'};
const copy=v=>JSON.parse(JSON.stringify(v));
function session(){const s=createDesignSession({customerId:SCOPE.customerProfileId,visitId:SCOPE.visitId,sessionId:'synthetic-session'});return appendDesignEvent(s,{requestId:'source-1',expectedRevision:0,scope:s.scope,event:{type:'source_recorded',source:{messageId:'message-1',kind:'text',actor:'employee',text:'【合成测试】想要简洁。'}}}).session;}
const candidate=()=>({phase:'before_analysis',entries:[{id:'candidate-1',category:'person_style',field:'requested_style',zone:null,groupId:null,service:null,side:null,track:'context',origin:'extraction',basis:'said',value:'简洁',status:'not_confirmed',sources:[{messageId:'message-1',quote:'想要简洁'}],replacesEntryId:null}],questions:[],warnings:[]});
const response=(value,url=DEEPSEEK_CHAT_ENDPOINT)=>({status:200,url,redirected:false,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(value)});
const chatResponse=(result=candidate(),extra={})=>response({id:'synthetic-response',object:'chat.completion',created:1,model:MODEL,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result),reasoning_content:'Private reasoning not returned'}}],...extra});
const request=(extra={})=>({requestId:'synthetic-request',credential:CREDENTIAL,scope:copy(SCOPE),session:session(),...extra});
const rejectCode=(promise,code,outcome)=>assert.rejects(promise,e=>e.code===code&&(!outcome||e.outcome===outcome)&&e.retryable===false&&!e.message.includes(KEY));
function harness(overrides={}){
  const calls=[],disclosures=[],keyContexts=[];let authCount=0;
  const config={enabled:true,modelConfig:{model:MODEL,approved:true,maxTokens:2048},permissionGate:{async authorize(credential,scope){assert.equal(credential,CREDENTIAL);authCount++;return {actor:copy(ACTOR),scope:copy(scope)};}},transmissionGate:async disclosure=>{disclosures.push(disclosure);return true;},keyResolver:async(context,use)=>{keyContexts.push(context);return use(KEY);},attemptStore:createInMemoryProviderAttemptStore({testOnly:true}),transport:async input=>{calls.push(input);return chatResponse();},...overrides};
  return {config,calls,disclosures,keyContexts,authCount:()=>authCount,adapter:createDeepSeekProviderAdapter(config)};
}
function wav({sampleRate=16000,frames=sampleRate,channels=1,bits=16,format=1}={}){const align=channels*bits/8,data=frames*align,b=Buffer.alloc(44+data);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(format,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*align,28);b.writeUInt16LE(align,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(data,40);return b;}
const speechRequest=(extra={})=>({requestId:'speech-request',credential:CREDENTIAL,scope:copy(SCOPE),audioBytes:wav(),...extra});

 test('default disabled and missing dependencies never resolve keys or call transport',async()=>{
  await rejectCode(createDeepSeekProviderAdapter().analyze(request()),'ADAPTER_DISABLED');
  await rejectCode(createDeepSeekSpeechAdapter().transcribe(speechRequest()),'ADAPTER_DISABLED');
  const h=harness();for(const name of ['transport','keyResolver','permissionGate','transmissionGate','attemptStore'])await rejectCode(createDeepSeekProviderAdapter({...h.config,[name]:undefined}).analyze(request()),'ADAPTER_NOT_CONFIGURED');
  assert.equal(h.calls.length,0);assert.equal(h.keyContexts.length,0);
});
test('model has no default approval; requests cannot supply endpoint/model/key or photos',async()=>{
  for(const modelConfig of [null,{}, {model:MODEL,approved:false,maxTokens:2048},{model:'https://elsewhere.invalid',approved:true,maxTokens:2048},{model:MODEL,approved:true,maxTokens:9000}])await rejectCode(harness({modelConfig}).adapter.analyze(request()),'MODEL_NOT_APPROVED');
  for(const extra of [{url:'https://elsewhere.invalid'},{model:MODEL},{key:KEY},{photos:[]},{scope:{...SCOPE,owner:'other'}}])await rejectCode(harness().adapter.analyze(request(extra)),extra.scope?'INVALID_SCOPE':'INVALID_REQUEST');
});
test('validated minimal chat request uses fixed official endpoint and JSON protocol, no routing identity',async()=>{
  const h=harness(),result=await h.adapter.analyze(request());assert.equal(h.calls.length,1);const sent=h.calls[0],body=JSON.parse(sent.body);
  assert.equal(sent.url,DEEPSEEK_CHAT_ENDPOINT);assert.equal(sent.method,'POST');assert.equal(sent.redirect,'error');assert.equal(sent.credentials,'omit');assert.equal(sent.headers.Authorization,'Bearer '+KEY);
  assert.deepEqual(Object.keys(body).sort(),['max_tokens','messages','model','response_format','stream']);assert.equal(body.stream,false);assert.deepEqual(body.response_format,{type:'json_object'});
  assert.ok(body.messages[1].content.includes('responseSchema'));assert.ok(!sent.body.includes(SCOPE.customerProfileId));assert.ok(!sent.body.includes(SCOPE.visitId));assert.ok(!sent.body.includes(ACTOR.username));assert.ok(!sent.body.includes('synthetic-session'));
  assert.equal(result.candidate.entries[0].status,'not_confirmed');assert.equal(result.requiresReview,true);assert.equal(result.replayed,false);assert.ok(!JSON.stringify(result).includes(KEY));assert.ok(!JSON.stringify(result).includes('Private reasoning'));
  assert.ok(h.authCount()>=4);assert.deepEqual(h.disclosures.map(d=>d.stage),['before_reserve','before_send','before_return']);assert.equal(h.disclosures[1].payloadSha256,result.payloadSha256);assert.equal(h.disclosures[1].mayIncurCharge,true);
});
test('context must be bounded valid v2 journal and exact profile/visit mapping',async()=>{
  await rejectCode(harness().adapter.analyze(request({session:{...session(),revision:999}})),'INVALID_CONTEXT');
  await rejectCode(harness().adapter.analyze(request({scope:{...SCOPE,customerProfileId:'other'}})),'CONTEXT_SCOPE_MISMATCH');
  await rejectCode(harness().adapter.analyze(request({scope:{...SCOPE,visitId:'other'}})),'CONTEXT_SCOPE_MISMATCH');
  const large={...session(),extra:'x'.repeat(524289)};await rejectCode(harness().adapter.analyze(request({session:large})),'INVALID_CONTEXT');
});
test('image-description sources are explicitly unsupported even when caller claims approval',async()=>{
  const s=createDesignSession({customerId:SCOPE.customerProfileId,visitId:SCOPE.visitId,sessionId:'image-session'});
  const withImage=appendDesignEvent(s,{requestId:'image-source',expectedRevision:0,scope:s.scope,event:{type:'source_recorded',source:{messageId:'image',kind:'image_description',actor:'employee',text:'【合成测试】图片描述'}}}).session;
  await rejectCode(harness().adapter.analyze(request({session:withImage})),'MEDIA_NOT_SUPPORTED');
});
test('permission failures and forged scope deny before key lookup',async()=>{
  for(const permissionGate of [{authorize:async()=>{throw new Error(KEY);}},{authorize:async()=>({actor:ACTOR,scope:{...SCOPE,visitId:'other'}})}]){const h=harness({permissionGate});await rejectCode(h.adapter.analyze(request()),'ACCESS_DENIED');assert.equal(h.calls.length,0);assert.equal(h.keyContexts.length,0);}
});
test('separate exact transmission permission denies before key lookup or paid call',async()=>{
  const h=harness({transmissionGate:async()=>false});await rejectCode(h.adapter.analyze(request()),'TRANSMISSION_DENIED');assert.equal(h.keyContexts.length,0);assert.equal(h.calls.length,0);
  const late=harness({transmissionGate:async d=>d.stage!=='before_send'});await rejectCode(late.adapter.analyze(request()),'TRANSMISSION_DENIED','not_sent');assert.equal(late.calls.length,0);await rejectCode(late.adapter.analyze(request()),'PREVIOUS_ATTEMPT_NOT_SENT');
});
test('reassignment while obtaining key and after transport rejects delivery',async()=>{
  let count=0;const h=harness({permissionGate:{authorize:async()=>({actor:++count===1?ACTOR:{...ACTOR,username:'other'},scope:SCOPE})}});await rejectCode(h.adapter.analyze(request()),'ACTOR_CHANGED','not_sent');assert.equal(h.calls.length,0);
  let revoked=false;const late=harness({permissionGate:{authorize:async()=>{if(revoked)throw new Error('revoked');return {actor:ACTOR,scope:SCOPE};}},transport:async()=>{revoked=true;return chatResponse();}});await rejectCode(late.adapter.analyze(request()),'ACCESS_DENIED','uncertain');
});
test('key callback is short-lived, validated and all thrown secret details are sanitized',async()=>{
  for(const keyResolver of [async()=>{throw new Error('secret '+KEY);},async()=>KEY,async(_,use)=>use('bad\r\nAuthorization: leaked')]){const h=harness({keyResolver});await assert.rejects(h.adapter.analyze(request()),e=>['KEY_UNAVAILABLE','INVALID_KEY'].includes(e.code)&&!JSON.stringify(e).includes(KEY)&&!e.stack.includes(KEY));assert.equal(h.calls.length,0);}
});
test('resolver that starts callback then rejects cannot trigger a delayed paid send',async()=>{
  const h=harness({keyResolver:async(_,use)=>{void use(KEY);throw new Error(KEY);}});await rejectCode(h.adapter.analyze(request()),'KEY_UNAVAILABLE');await new Promise(r=>setTimeout(r,10));assert.equal(h.calls.length,0);
});
test('completed request replay is reauthorized and does not send again, changed payload conflicts',async()=>{
  const h=harness(),a=await h.adapter.analyze(request()),b=await h.adapter.analyze(request());assert.equal(b.replayed,true);assert.deepEqual(b.candidate,a.candidate);assert.equal(h.calls.length,1);assert.equal(h.keyContexts.length,1);
  await rejectCode(h.adapter.analyze(request({session:createDesignSession(session().scope)})),'REQUEST_CONFLICT');
});
test('atomic reservation rejects concurrent duplicate across adapter instances',async()=>{
  let release,start;const held=new Promise(r=>release=r),started=new Promise(r=>start=r);const h=harness({transport:async()=>{start();await held;return chatResponse();}});
  const first=h.adapter.analyze(request());await started;await rejectCode(createDeepSeekProviderAdapter(h.config).analyze(request()),'REQUEST_IN_FLIGHT','uncertain');release();await first;
});
test('uncertain transport failure is never retried, even by another adapter sharing ledger',async()=>{
  let calls=0;const h=harness({transport:async()=>{calls++;throw new Error(KEY);}});await rejectCode(h.adapter.analyze(request()),'TRANSPORT_FAILED','uncertain');await rejectCode(createDeepSeekProviderAdapter(h.config).analyze(request()),'OUTCOME_UNCERTAIN','uncertain');assert.equal(calls,1);
});
test('transport timeout aborts once, marks uncertainty and never resends',async()=>{
  let signal,calls=0;const h=harness({timeoutMs:5,transport:async input=>{calls++;signal=input.signal;return new Promise(()=>{});}});await rejectCode(h.adapter.analyze(request()),'TIMEOUT','uncertain');assert.equal(signal.aborted,true);await rejectCode(h.adapter.analyze(request()),'OUTCOME_UNCERTAIN','uncertain');assert.equal(calls,1);
});
test('redirects/final URL changes/non-200 responses fail closed without exposing response text',async()=>{
  for(const mutate of [r=>({...r,status:302}),r=>({...r,redirected:true}),r=>({...r,url:'https://elsewhere.invalid'}),r=>({...r,status:429,body:KEY})]){const h=harness({transport:async()=>mutate(chatResponse())});await assert.rejects(h.adapter.analyze(request()),e=>['REDIRECT_REJECTED','PROVIDER_REJECTED'].includes(e.code)&&e.outcome==='uncertain'&&!e.message.includes(KEY));}
});
test('response body is UTF-8, JSON and bounded; provider/key echo is not exposed',async()=>{
  for(const body of [' ',KEY,'{"incomplete":',Buffer.from([255]),'x'.repeat(262145)]){const h=harness({transport:async()=>({...chatResponse(),body})});await assert.rejects(h.adapter.analyze(request()),e=>['INVALID_PROVIDER_RESPONSE','RESPONSE_TOO_LARGE'].includes(e.code)&&e.outcome==='uncertain');}
  const h=harness({transport:async()=>({...chatResponse(),headers:{'content-type':'text/html'}})});await rejectCode(h.adapter.analyze(request()),'INVALID_PROVIDER_RESPONSE','uncertain');
});
test('wrong model, truncated/blank/tool responses and malformed choices reject candidates',async()=>{
  for(const mutate of [r=>({...r,model:'other-model'}),r=>({...r,choices:[]}),r=>{r.choices[0].finish_reason='length';return r;},r=>{r.choices[0].message.content=' ';return r;},r=>{r.choices[0].message.tool_calls=[{type:'function'}];return r;},r=>{r.choices[0].message.tool_calls={};return r;}]){const h=harness({transport:async()=>response(mutate(JSON.parse(chatResponse().body)))});await rejectCode(h.adapter.analyze(request()),'INVALID_PROVIDER_RESPONSE','uncertain');}
});
test('candidate schema preserves unknowns and never accepts confirmation, invented quote or before care',async()=>{
  for(const mutate of [r=>{r.entries[0].status='confirmed';},r=>{r.entries[0].sources[0].quote='not in source';},r=>{r.entries[0].field='daily_routine';},r=>{r.extra='not allowed';}]){const result=candidate();mutate(result);const h=harness({transport:async()=>chatResponse(result)});await rejectCode(h.adapter.analyze(request()),'INVALID_RESULT','uncertain');}
});
test('attempt store failures are closed; completed result corruption is not delivered',async()=>{
  const h=harness({attemptStore:{reserve:async()=>{throw new Error(KEY);},settle:async()=>{}}});await rejectCode(h.adapter.analyze(request()),'ATTEMPT_STORE_FAILED');assert.equal(h.calls.length,0);
  const base=createInMemoryProviderAttemptStore({testOnly:true});const settleFail=harness({attemptStore:{reserve:base.reserve,settle:async()=>{throw new Error(KEY);}}});await rejectCode(settleFail.adapter.analyze(request()),'ATTEMPT_STORE_FAILED','uncertain');await rejectCode(settleFail.adapter.analyze(request()),'REQUEST_IN_FLIGHT','uncertain');assert.equal(settleFail.calls.length,1);
});
test('WAV validates actual bytes and computes frames/duration, never client MIME metadata',()=>{
  const meta=validateMonoPcmWav(wav());assert.equal(meta.durationMs,1000);assert.equal(meta.sampleRate,16000);assert.equal(meta.channels,1);assert.equal(meta.bitsPerSample,16);assert.equal(meta.frames,16000);
  assert.throws(()=>validateMonoPcmWav({type:'audio/wav',duration:1,bytes:wav()}),e=>e.code==='ASR_INVALID_WAV');
  const bytes=wav(),wrapped=Buffer.concat([Buffer.from('junk'),bytes,Buffer.from('tail')]);assert.deepEqual(validateMonoPcmWav(wrapped.subarray(4,4+bytes.length)),meta);
});
test('WAV rejects truncated boundaries, extra bytes, forged RIFF/data sizes and wrong chunk IDs',()=>{
  const original=wav();for(const cut of [0,1,4,12,20,43,44,original.length-1])assert.throws(()=>validateMonoPcmWav(original.subarray(0,cut)));
  for(const mutate of [b=>b.writeUInt32LE(0xffffffff,4),b=>b.writeUInt32LE(0xffffffff,40),b=>b.writeUInt32LE(17,16),b=>b.write('JUNK',36),b=>b.writeUInt32LE(1,28),b=>b.writeUInt16LE(4,32)]){const b=Buffer.from(original);mutate(b);assert.throws(()=>validateMonoPcmWav(b),e=>e.code==='ASR_INVALID_WAV');}
  assert.throws(()=>validateMonoPcmWav(Buffer.concat([original,Buffer.alloc(2)])),e=>e.code==='ASR_INVALID_WAV');
});
test('WAV refuses Ogg, stereo-left-only ambiguity, float/compressed/extended and unsupported sample rates',()=>{
  assert.throws(()=>validateMonoPcmWav(Buffer.from('OggS synthetic opus data')),e=>e.code==='ASR_OGG_NOT_SUPPORTED');
  for(const settings of [{channels:2},{channels:3},{format:3},{format:65534},{bits:8},{sampleRate:12345}])assert.throws(()=>validateMonoPcmWav(wav(settings)),e=>['ASR_STEREO_NOT_SUPPORTED','ASR_UNSUPPORTED_FORMAT','ASR_INVALID_RATE'].includes(e.code));
});
test('WAV independently enforces 120 seconds and 8 MiB including 44.1kHz oversize trap',()=>{
  assert.equal(validateMonoPcmWav(wav({sampleRate:32000,frames:32000*120})).durationMs,120000);
  assert.throws(()=>validateMonoPcmWav(wav({sampleRate:8000,frames:8000*120+1})),e=>e.code==='ASR_TOO_LONG');
  assert.throws(()=>validateMonoPcmWav(wav({sampleRate:44100,frames:44100*120})),e=>e.code==='ASR_TOO_LARGE');
  assert.throws(()=>validateMonoPcmWav(wav({sampleRate:44100,frames:44100*120,channels:2})),e=>e.code==='ASR_TOO_LARGE');
  assert.equal(validateMonoPcmWav(wav({sampleRate:48000,frames:(ASR_MAX_BYTES-44)/2})).byteLength,ASR_MAX_BYTES);
  assert.throws(()=>validateMonoPcmWav(wav({sampleRate:48000,frames:(ASR_MAX_BYTES-44)/2+1})),e=>e.code==='ASR_TOO_LARGE');
  assert.throws(()=>validateMonoPcmWav(wav({frames:0})),e=>e.code==='ASR_EMPTY');
});
test('ASR sends one file to exact official endpoint, with no invented model/name/identity fields',async()=>{
  let wire;const h=harness({transport:async input=>{wire=input;return response({request_id:'asr-response',text:'【合成测试】简洁',duration_ms:1000},DEEPSEEK_ASR_ENDPOINT);}});
  const speech=createDeepSeekSpeechAdapter(h.config),result=await speech.transcribe(speechRequest());assert.equal(wire.url,DEEPSEEK_ASR_ENDPOINT);assert.deepEqual([...wire.body.keys()],['file']);const file=wire.body.get('file');assert.equal(file.name,'speech.wav');assert.equal(file.type,'audio/wav');assert.deepEqual(Buffer.from(await file.arrayBuffer()),wav());assert.equal(wire.headers['Content-Type'],undefined);
  assert.equal(h.keyContexts[0].model,null);assert.equal(result.transcript.kind,'speech_transcript');assert.equal(result.transcript.confirmed,false);assert.equal(result.audio.durationMs,1000);assert.equal(result.requiresReview,true);assert.equal((await speech.transcribe(speechRequest())).replayed,true);assert.ok(!JSON.stringify(result).includes('audioBytes'));
});
test('ASR copies input before async permission waits; byte mutation cannot change approved file',async()=>{
  let release,start,wire;const held=new Promise(r=>release=r),started=new Promise(r=>start=r);const original=wav();const h=harness({permissionGate:{authorize:async()=>{start();await held;return {actor:ACTOR,scope:SCOPE};}},transport:async input=>{wire=input;return response({request_id:'id',text:'',duration_ms:1000},DEEPSEEK_ASR_ENDPOINT);}});
  const pending=createDeepSeekSpeechAdapter(h.config).transcribe(speechRequest({audioBytes:original}));await started;original.fill(0);release();const result=await pending;assert.deepEqual(Buffer.from(await wire.body.get('file').arrayBuffer()),wav());assert.equal(result.transcript.text,'');
});
test('ASR rejects client duration/MIME and invalid bytes before auth/key/send',async()=>{
  const h=harness(),speech=createDeepSeekSpeechAdapter(h.config);await rejectCode(speech.transcribe(speechRequest({duration:1})),'INVALID_REQUEST');await rejectCode(speech.transcribe(speechRequest({mime:'audio/wav'})),'INVALID_REQUEST');await rejectCode(speech.transcribe(speechRequest({audioBytes:Buffer.alloc(44)})),'ASR_INVALID_WAV');assert.equal(h.calls.length,0);assert.equal(h.authCount(),0);
});
test('ASR response requires exact bounded schema and duration consistent with validated audio',async()=>{
  for(const value of [{request_id:'r',text:'text',duration_ms:999999},{request_id:'r',text:'text',duration_ms:1005},{request_id:'r',text:'text',duration_ms:1000,model:'guess'},{request_id:'r',text:'x'.repeat(12001),duration_ms:1000},{request_id:'r',text:'text\u0000',duration_ms:1000}]){const h=harness({transport:async()=>response(value,DEEPSEEK_ASR_ENDPOINT)});await assert.rejects(createDeepSeekSpeechAdapter(h.config).transcribe(speechRequest()),e=>['INVALID_PROVIDER_RESPONSE','INVALID_RESULT'].includes(e.code)&&e.outcome==='uncertain');}
});

test('raw and JSON-escaped keys in candidate warnings or response metadata never leave callback',async()=>{
  for(const encoded of [false,true]){const result=candidate();result.warnings=[KEY];let wire=chatResponse(result);if(encoded){const doc=JSON.parse(wire.body);doc.choices[0].message.content=doc.choices[0].message.content.replace(KEY,[...KEY].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));wire=response(doc);}const h=harness({transport:async()=>wire});await rejectCode(h.adapter.analyze(request()),'INVALID_PROVIDER_RESPONSE','uncertain');}
  const h=harness({transport:async()=>chatResponse(candidate(),{system_fingerprint:KEY})});await rejectCode(h.adapter.analyze(request()),'INVALID_PROVIDER_RESPONSE','uncertain');
});
test('persisted replay with forged identity or extra data fields fails closed',async()=>{
  for(const alter of [r=>{r.actor.username='other';},r=>{r.secret='unexpected';}]){const base=createInMemoryProviderAttemptStore({testOnly:true});const store={settle:base.settle,async reserve(value){const r=await base.reserve(value);if(!r.created&&r.state==='completed')alter(r.result);return r;}};const h=harness({attemptStore:store});await h.adapter.analyze(request());await rejectCode(h.adapter.analyze(request()),'ATTEMPT_STORE_FAILED');assert.equal(h.calls.length,1);}
});

test('WAV magic is matched byte-for-byte, not lossy ASCII high-bit masking',()=>{
  for(const offset of [0,8,12,36]){const b=wav();b[offset]|=0x80;assert.throws(()=>validateMonoPcmWav(b),e=>e.code==='ASR_INVALID_WAV');}
});

test('ASR transcript containing an escaped key is rejected without returning or persisting it',async()=>{
  const value={request_id:'asr-id',text:KEY,duration_ms:1000};const wire=response(value,DEEPSEEK_ASR_ENDPOINT);wire.body=wire.body.replace(KEY,[...KEY].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
  const h=harness({transport:async()=>wire});await rejectCode(createDeepSeekSpeechAdapter(h.config).transcribe(speechRequest()),'INVALID_PROVIDER_RESPONSE','uncertain');
});

for(const operation of ['analyze','speech'])test(operation+' replay rechecks employee after waiting for transmission authorization',async()=>{
  for(const change of ['revoke','reassign']){
    let active=true,actor=copy(ACTOR),holdReplay=false,release,markStarted,calls=0;
    const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});
    const h=harness({
      permissionGate:{async authorize(){if(!active)throw new Error('revoked');return {actor:copy(actor),scope:copy(SCOPE)};}},
      transmissionGate:async disclosure=>{if(holdReplay&&disclosure.stage==='before_replay_return'){markStarted();await held;}return true;},
      transport:async()=>{calls++;return operation==='speech'?response({request_id:'speech-response',text:'【合成测试】简洁',duration_ms:1000},DEEPSEEK_ASR_ENDPOINT):chatResponse();},
    });
    const adapter=operation==='speech'?createDeepSeekSpeechAdapter(h.config):h.adapter;
    const invoke=()=>operation==='speech'?adapter.transcribe(speechRequest()):adapter.analyze(request());
    await invoke();holdReplay=true;
    const replay=invoke();await started;
    if(change==='revoke')active=false;else actor={...ACTOR,username:'reassigned-employee'};
    release();await rejectCode(replay,change==='revoke'?'ACCESS_DENIED':'ACTOR_CHANGED');
    assert.equal(calls,1);assert.equal(h.keyContexts.length,1);
    active=true;actor=copy(ACTOR);holdReplay=false;
    assert.equal((await invoke()).replayed,true);assert.equal(calls,1);assert.equal(h.keyContexts.length,1);
  }
});

for(const mutation of ['reordered','changed','extra','missing','wrong_type'])test('ASR persisted audio metadata '+mutation+' uses exact order-independent comparison',async()=>{
  const base=createInMemoryProviderAttemptStore({testOnly:true});let sends=0;
  const store={settle:base.settle,async reserve(value){const r=await base.reserve(value);if(!r.created&&r.state==='completed'){
    r.result.audio=Object.fromEntries(Object.entries(r.result.audio).reverse());
    if(mutation==='changed')r.result.audio.sampleRate++;
    if(mutation==='extra')r.result.audio.extra='unapproved';
    if(mutation==='missing')delete r.result.audio.channels;
    if(mutation==='wrong_type')r.result.audio.durationMs=String(r.result.audio.durationMs);
  }return r;}};
  const h=harness({attemptStore:store,transport:async()=>{sends++;return response({request_id:'synthetic-asr',text:'合成',duration_ms:1000},DEEPSEEK_ASR_ENDPOINT);}}),a=createDeepSeekSpeechAdapter(h.config);
  const initial=await a.transcribe(speechRequest());
  if(mutation==='reordered'){const replay=await a.transcribe(speechRequest());assert.equal(replay.replayed,true);assert.deepEqual(replay.audio,initial.audio);}
  else await assert.rejects(a.transcribe(speechRequest()),e=>['INVALID_RESULT','ATTEMPT_STORE_FAILED'].includes(e.code));
  assert.equal(sends,1);assert.equal(h.keyContexts.length,1);
});
