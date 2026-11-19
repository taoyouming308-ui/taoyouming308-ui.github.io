/* Real prepared modules composed with synthetic in-memory sources only. No sockets/fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {createProductionEmployeeAdapter} from '../packages/design-production-adapter/employee-adapter.mjs';
import {createPreparedDesignKeySettings,DESIGN_KEY_DESTINATION,DESIGN_ASR_DESTINATION} from '../packages/design-production-adapter/key-settings.mjs';
import {createDesignKeySealer} from '../packages/design-production-adapter/key-crypto.mjs';
import {createDeepSeekProviderAdapter,createInMemoryProviderAttemptStore} from '../packages/design-production-adapter/provider-adapter.mjs';
import {createDeepSeekSpeechAdapter} from '../packages/design-production-adapter/speech-adapter.mjs';
import {createPreparedOfficialTransport} from '../packages/design-production-adapter/official-provider-transport.mjs';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {createDesignSession} from '../packages/analysis-engine/design-pilot.mjs';
globalThis.fetch=()=>{throw Error('No external network permitted');};
const token='00000000-0000-4000-8000-00000000000100000000-0000-4000-8000-000000000002';
const digest=createHash('sha256').update(token).digest('hex');
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const owner={username:'synthetic-stylist',store:'自由手艺人'};
const api='https://synthetic-design.invalid',origin='https://synthetic-app.invalid',model='synthetic-approved-model';
const fakeKey='SYNTHETIC_NOT_A_REAL_DEEPSEEK_KEY';
async function fixture(official=false){
 const state={active:true,approved:true,sent:[],rows:new Map(),approvals:new Map(),sequence:0,queue:Promise.resolve()};
 const employeeAdapter=createProductionEmployeeAdapter({clock:()=>Date.parse('2026-11-15T12:00:00Z'),
  restRows:async route=>{const url=new URL(route,api),table=url.pathname.slice(1);assert(!route.includes(token));
   if(table==='employee_booking_sessions'){assert.equal(url.searchParams.get('token_hash'),'eq.'+digest);return [{...owner,expires_at:'2026-11-15T23:00:00Z'}];}
   if(table==='staff')return [{...owner,active:state.active,employment_status:'active'}];
   if(table==='bookings')return [{id:101,barber_name:owner.username,shop_name:owner.store,date:'2026-11-15',status:0}];
   if(table==='customer_profiles')return [{id:11,shop_name:owner.store,card_packages:[],service_history:[]}];throw Error('unexpected fixture source');},
  resolveVisitBinding:async row=>[{assignmentSource:row.source,visitId:row.visitId,customerProfileId:'11',store:owner.store,bookingDate:'2026-11-15',visitKey:'booking:101',active:state.active,revision:'binding-1'}],
  rpc:async(name,p)=>{assert.equal(name,'customer_design_resolve_context');return {customer_profile_id:11,booking_id:101,booking_date:'2026-11-15',visit_key:'booking:101',store:owner.store};}});
 // Fixed public test bytes are NOT a generated production secret or credential.
 const sealer=createDesignKeySealer({secretProvider:async()=>new Uint8Array(32).fill(19),cryptoProvider:webcrypto});
 const keySettings=createPreparedDesignKeySettings({enabled:true,approvedModels:[model],allowASR:true,authenticate:employeeAdapter.authenticate,now:()=>Date.parse('2026-11-15T12:00:00Z'),sealer,
  approvalVerifier:{consume:async(receipt,intent)=>{const expected=state.approvals.get(receipt);if(!expected||JSON.stringify(expected)!==JSON.stringify(intent))return false;state.approvals.delete(receipt);return true;}},
  repository:{withEmployeeLock:(actor,work)=>{assert.deepEqual(actor,owner);const action=state.queue.then(()=>work({read:async purpose=>structuredClone(state.rows.get(purpose)||null),compareAndSwap:async(expected,next)=>{if((state.rows.get(next.purpose)?.revision||0)!==expected)return false;state.rows.set(next.purpose,structuredClone(next));return true;}}));state.queue=action.catch(()=>{});return action;}}});
 const keyResolver=async(context,use)=>{const purpose=context.destination===DESIGN_ASR_DESTINATION?'speech':'chat',meta=await keySettings.status({credential:context.credential,purpose});if(!meta.configured||meta.destination!==context.destination||meta.model!==context.model)throw Error('key configuration mismatch');return keySettings.withProviderKey({credential:context.credential,expectedRevision:meta.revision,destination:meta.destination,model:meta.model},lease=>{assert.deepEqual(lease.actor,context.actor);return use(lease.key);});};
 const attemptStore=createInMemoryProviderAttemptStore({testOnly:true});
 const mockResponse=async request=>{assert.equal(request.headers.Authorization,'Bearer '+fakeKey);assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');state.sent.push(request.url);
  const response=request.url===DESIGN_KEY_DESTINATION?{id:'synthetic-completion',object:'chat.completion',created:1,model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({phase:'before_analysis',entries:[],questions:[],warnings:[]})}}]}:{request_id:'synthetic-asr',text:'合成口述',duration_ms:1000};
  return {url:request.url,redirected:false,status:200,headers:{'content-type':'application/json'},body:JSON.stringify(response)};};
 const transport=official?createPreparedOfficialTransport({enabled:true,fetchImplementation:async request=>{const result=await mockResponse({url:request.url,headers:{Authorization:request.headers.get('authorization')},redirect:request.redirect,credentials:request.credentials});const response=new Response(result.body,{status:result.status,headers:result.headers});Object.defineProperty(response,'url',{value:request.url});return response;}}):mockResponse;
 const transmissionGate=async disclosure=>{assert.equal(disclosure.mayIncurCharge,true);assert.deepEqual(disclosure.actor,owner);assert.deepEqual(disclosure.scope,scope);assert(/^[a-f0-9]{64}$/.test(disclosure.payloadSha256));return state.approved;};
 const shared={enabled:true,transport,keyResolver,permissionGate:employeeAdapter.gate,transmissionGate,attemptStore};
 const handler=createDesignHttpHandler({enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],employeeAdapter,keySettings,providerAdapter:createDeepSeekProviderAdapter({...shared,modelConfig:{model,approved:true,maxTokens:256}}),speechAdapter:createDeepSeekSpeechAdapter(shared),sessionRepository:{loadEvidenceSession:async()=>createDesignSession({customerId:'11',visitId:'booking:101',sessionId:'trusted-session'})}});
 const request=(path,payload)=>handler(new Request(api+path,{method:'POST',headers:{origin,'content-type':'application/json','x-employee-session':token},body:JSON.stringify(payload)}));
 async function save(purpose){const config={destination:purpose==='chat'?DESIGN_KEY_DESTINATION:DESIGN_ASR_DESTINATION,model:purpose==='chat'?model:null},approval='synthetic-receipt-'+(++state.sequence),intent={...owner,purpose,action:'persist-design-key',...config,expectedRevision:0,keyDigest:await sealer.digest(fakeKey)};state.approvals.set(approval,intent);const response=await request('/api/design/key-settings/save',{approval,expectedRevision:0,config,key:fakeKey});assert.equal(response.status,200,await response.clone().text());assert(!(await response.text()).includes(fakeKey));}
 return {state,handler,request,save};
}
function wav(){const bytes=Buffer.alloc(44+32000);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);return bytes;}
test('HTTP + existing-session adapter + encrypted purpose slots + scoped provider compose without live I/O',async()=>{const f=await fixture();await f.save('chat');await f.save('speech');assert.equal(f.state.rows.size,2);assert(!JSON.stringify([...f.state.rows.values()]).includes(fakeKey));
 const first=await f.request('/api/design/analyze',{requestId:'analyze-1',scope});assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).result.candidate.entries.length,0);
 const replay=await f.request('/api/design/analyze',{requestId:'analyze-1',scope});assert.equal((await replay.json()).result.replayed,true);assert.equal(f.state.sent.length,1);
 const body=new FormData();body.append('scope',JSON.stringify(scope));body.append('requestId','speech-1');body.append('file',new Blob([wav()],{type:'audio/wav'}),'synthetic.wav');
 const speech=await f.handler(new Request(api+'/api/design/speech',{method:'POST',headers:{origin,'x-employee-session':token},body}));assert.equal(speech.status,200,await speech.clone().text());assert.equal((await speech.json()).result.transcript.confirmed,false);assert.deepEqual(f.state.sent,[DESIGN_KEY_DESTINATION,DESIGN_ASR_DESTINATION]);
 const status=await f.request('/api/design/key-settings/read',{purpose:'chat'});assert.equal((await status.json()).result.configured,true);
});
test('composed route cannot dispatch without separate transmission approval or after staff revocation',async()=>{const f=await fixture();await f.save('chat');f.state.approved=false;assert.notEqual((await f.request('/api/design/analyze',{requestId:'denied',scope})).status,200);assert.equal(f.state.sent.length,0);f.state.approved=true;f.state.active=false;assert.notEqual((await f.request('/api/design/analyze',{requestId:'revoked',scope})).status,200);assert.equal(f.state.sent.length,0);});

test('official transport composes with actual provider, ASR, key and HTTP modules using synthetic fetch responses',async()=>{const f=await fixture(true);await f.save('chat');await f.save('speech');assert.equal((await f.request('/api/design/analyze',{requestId:'official-text',scope})).status,200);const body=new FormData();body.append('scope',JSON.stringify(scope));body.append('requestId','official-speech');body.append('file',new Blob([wav()],{type:'audio/wav'}),'synthetic.wav');const response=await f.handler(new Request(api+'/api/design/speech',{method:'POST',headers:{origin,'x-employee-session':token},body}));assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).result.transcript.text,'合成口述');assert.deepEqual(f.state.sent,[DESIGN_KEY_DESTINATION,DESIGN_ASR_DESTINATION]);});
