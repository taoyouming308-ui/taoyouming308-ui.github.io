import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createPreparedDesignKeySettings,DESIGN_KEY_DESTINATION as destination} from '../packages/design-production-adapter/key-settings.mjs';
import {createDesignKeySealer} from '../packages/design-production-adapter/key-crypto.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden');};
const synthetic='SYNTHETIC-NOT-A-PROVIDER-CREDENTIAL';
const config={destination,model:'deepseek-chat'};
const credential=Symbol('synthetic session');
const rejects=(p,code)=>assert.rejects(p,e=>e.message===code);
function fixture(options={}){
  const state={employee:{username:'synthetic-employee-a',store:'synthetic-store',active:true,expiresAt:2000},rows:new Map(),receipts:new Set(),seen:[],afterSeal:null};
  const sealer={digest:async k=>'synthetic-digest:'+k,seal:async(k,context)=>{if(state.afterSeal)state.afterSeal();return {v:1,syntheticValue:k,context:JSON.stringify(context)};},open:async value=>value.syntheticValue};
  const service=createPreparedDesignKeySettings({enabled:true,approvedModels:['deepseek-chat'],...options,now:()=>1000,authenticate:async c=>{assert.equal(c,credential);return {...state.employee};},sealer,
    approvalVerifier:{consume:async(receipt,intent)=>{state.seen.push(intent);if(!receipt||JSON.stringify(receipt.intent)!==JSON.stringify(intent)||state.receipts.has(receipt))return false;state.receipts.add(receipt);return true;}},
    repository:{withEmployeeLock:async(owner,work)=>{const id=JSON.stringify(owner);return work({read:async purpose=>state.rows.get(id+'|'+purpose)||null,compareAndSwap:async(expected,next)=>{const slot=id+'|'+next.purpose;if((state.rows.get(slot)?.revision||0)!==expected)return false;state.rows.set(slot,structuredClone(next));return true;}});}}
  });
  function request(expectedRevision=0,key=synthetic){const intent={username:state.employee.username,store:state.employee.store,purpose:'chat',action:'persist-design-key',...config,expectedRevision,keyDigest:'synthetic-digest:'+key};return {credential,expectedRevision,config:{...config},key,approval:{intent}};}
  const provider=(revision=1)=>({credential,expectedRevision:revision,...config});
  return {state,service,request,provider};
}
test('default disabled cannot read or save credentials',async()=>{await rejects(createPreparedDesignKeySettings().status({credential,purpose:'chat'}),'KEY_SETTINGS_DISABLED');});
test('exact action approval required; identity and revision cannot be changed',async()=>{const f=fixture();const r=f.request();r.approval.intent.username='someone-else';await rejects(f.service.save(r),'KEY_APPROVAL_REQUIRED');assert.equal(f.state.rows.size,0);});
test('save returns metadata only and internal callback resolves own key',async()=>{const f=fixture();const result=await f.service.save(f.request());assert.deepEqual(result,{configured:true,revision:1,...config});assert(!JSON.stringify(result).includes(synthetic));const output=await f.service.withProviderKey(f.provider(),async lease=>{assert.equal(lease.key,synthetic);return {ok:true};});assert.deepEqual(output,{ok:true});});
test('different employees and stores have no fallback',async()=>{const f=fixture();await f.service.save(f.request());f.state.employee.username='synthetic-b';assert.equal((await f.service.status({credential,purpose:'chat'})).configured,false);await rejects(f.service.withProviderKey(f.provider(),()=>{}),'KEY_NOT_CONFIGURED');f.state.employee.username='synthetic-employee-a';f.state.employee.store='other-store';await rejects(f.service.withProviderKey(f.provider(),()=>{}),'KEY_NOT_CONFIGURED');});
test('nonofficial destination, unknown model, extra authority and whitespace keys reject',async()=>{for(const mutate of [r=>r.config.destination='https://example.invalid',r=>r.config.model='unknown',r=>r.owner='claimed',r=>r.key='contains spaces in key']){const f=fixture(),r=f.request();mutate(r);await rejects(f.service.save(r),'INVALID_KEY_REQUEST');assert.equal(f.state.rows.size,0);}});
test('stale revision and replayed approval cannot change key',async()=>{const f=fixture(),r=f.request();await f.service.save(r);await rejects(f.service.save(r),'KEY_REVISION_CONFLICT');const next=f.request(1);next.approval=r.approval;await rejects(f.service.save(next),'KEY_APPROVAL_REQUIRED');assert.equal((await f.service.status({credential,purpose:'chat'})).revision,1);});
test('revocation leaves CAS tombstone, deletes sealed value, blocks resolver',async()=>{const f=fixture();await f.service.save(f.request());const intent={username:f.state.employee.username,store:f.state.employee.store,purpose:'chat',action:'revoke-design-key',...config,expectedRevision:1,keyDigest:null};const result=await f.service.revoke({credential,purpose:'chat',expectedRevision:1,approval:{intent}});assert.equal(result.configured,false);assert.equal(result.revision,2);assert.equal([...f.state.rows.values()][0].sealed,null);await rejects(f.service.withProviderKey(f.provider(2),()=>{}),'KEY_NOT_CONFIGURED');await rejects(f.service.save(f.request(0)),'KEY_REVISION_CONFLICT');await f.service.save(f.request(2));});
test('deactivation while sealing prevents commit',async()=>{const f=fixture();f.state.afterSeal=()=>{f.state.employee.active=false;};await rejects(f.service.save(f.request()),'AUTHENTICATION_REQUIRED');assert.equal(f.state.rows.size,0);});
test('expired identity and changed actor reject provider delivery',async()=>{const f=fixture();await f.service.save(f.request());await rejects(f.service.withProviderKey(f.provider(),async()=>{f.state.employee.username='other';return 'not delivered';}),'ACTOR_CHANGED');});
test('provider errors are scrubbed, no secret copied into exception',async()=>{const f=fixture();await f.service.save(f.request());await rejects(f.service.withProviderKey(f.provider(),async()=>{throw Error(synthetic); }),'KEY_SETTINGS_UNAVAILABLE');});
test('changed config revision blocks dispatch before callback',async()=>{const f=fixture();await f.service.save(f.request());let calls=0;await rejects(f.service.withProviderKey(f.provider(0),()=>{calls++;}),'KEY_REVISION_CONFLICT');assert.equal(calls,0);});
test('AES-GCM AAD binds employee/store/model/destination/revision; synthetic material only',async()=>{
  // Fixed conspicuously synthetic encryption bytes, not generated account/API credentials.
  const material=new TextEncoder().encode('SYNTHETIC-ENCRYPTION-TEST-ONLY-0');assert.equal(material.length,32);
  const cryptoProvider={subtle:webcrypto.subtle,getRandomValues:bytes=>{bytes.fill(37);return bytes;}};
  const sealer=createDesignKeySealer({cryptoProvider,secretProvider:async({purpose})=>{assert.equal(purpose,'design-employee-key-v1');return material;}});
  const context={username:'synthetic-a',store:'synthetic-store',...config,revision:1};
  const sealed=await sealer.seal(synthetic,context);assert.equal(await sealer.open(sealed,context),synthetic);assert(!JSON.stringify(sealed).includes(synthetic));
  for(const [key,value] of Object.entries({username:'other',store:'other',model:'deepseek-reasoner',destination:'https://example.invalid',revision:2}))await rejects(sealer.open(sealed,{...context,[key]:value}),'DESIGN_KEY_CRYPTO_FAILED');
  await rejects(sealer.open({...sealed,data:sealed.data.slice(0,-4)+'AAAA'},context),'DESIGN_KEY_CRYPTO_FAILED');
  await rejects(createDesignKeySealer().seal(synthetic,context),'DESIGN_KEY_CRYPTO_FAILED');
});

test('no implicit model allowlist and ASR requires separate opt-in with null model',async()=>{
  const disabled=fixture({approvedModels:[]});await rejects(disabled.service.save(disabled.request()),'INVALID_KEY_REQUEST');
  const f=fixture({allowASR:true});const r=f.request();r.config={destination:'https://api.deepseek.com/v1/tools/asr',model:null};Object.assign(r.approval.intent,r.config,{purpose:'speech'});await f.service.save(r);
  assert.equal(await f.service.withProviderKey({credential,expectedRevision:1,...r.config},async lease=>lease.model),null);
  const g=fixture();const denied=g.request();denied.config=r.config;await rejects(g.service.save(denied),'INVALID_KEY_REQUEST');
});
test('caller mutation during approval cannot replace approved key or expected revision',async()=>{
  const f=fixture(),r=f.request();const pending=f.service.save(r);r.key='SYNTHETIC-UNAPPROVED-OTHER-KEY';r.expectedRevision=30;r.config.model='unknown';await pending;
  assert.equal(await f.service.withProviderKey(f.provider(),async lease=>lease.key),synthetic);
});

test('chat and speech keys coexist with independent CAS and revocation',async()=>{
 const f=fixture({allowASR:true});await f.service.save(f.request());
 const speech=f.request();speech.config={destination:'https://api.deepseek.com/v1/tools/asr',model:null};Object.assign(speech.approval.intent,speech.config,{purpose:'speech'});await f.service.save(speech);
 assert.equal(f.state.rows.size,2);assert.equal((await f.service.status({credential,purpose:'chat'})).revision,1);assert.equal((await f.service.status({credential,purpose:'speech'})).revision,1);
 const intent={username:f.state.employee.username,store:f.state.employee.store,purpose:'speech',action:'revoke-design-key',...speech.config,expectedRevision:1,keyDigest:null};
 await f.service.revoke({credential,purpose:'speech',expectedRevision:1,approval:{intent}});
 assert.equal(await f.service.withProviderKey(f.provider(),async lease=>lease.key),synthetic);
 await rejects(f.service.withProviderKey({credential,expectedRevision:2,...speech.config},()=>{}),'KEY_NOT_CONFIGURED');
 assert.equal((await f.service.status({credential,purpose:'chat'})).configured,true);
});

test('retired model/capability stays readable and revocable, but cannot dispatch',async()=>{
 const f=fixture();await f.service.save(f.request());const g=fixture({approvedModels:[]});g.state.rows=f.state.rows;
 assert.equal((await g.service.status({credential,purpose:'chat'})).configured,true);
 await rejects(g.service.withProviderKey(g.provider(),()=>{}),'INVALID_KEY_REQUEST');
 const intent={username:g.state.employee.username,store:g.state.employee.store,purpose:'chat',action:'revoke-design-key',...config,expectedRevision:1,keyDigest:null};
 assert.equal((await g.service.revoke({credential,purpose:'chat',expectedRevision:1,approval:{intent}})).configured,false);
});
