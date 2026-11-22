import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createImmutableKeySettingsRuntime} from '../packages/design-production-adapter/immutable-key-runtime.mjs';
const credential='SYNTHETIC_IMMUTABLE_KEY_HTTP_SESSION_12345',key='SYNTHETIC_ONLY_NOT_A_REAL_PROVIDER_KEY';
const api='https://synthetic-api.invalid',origin='https://synthetic-app.invalid';
const config={destination:'https://api.deepseek.com/chat/completions',model:'synthetic-model'};
const req=(path,body,headers={})=>new Request(api+path,{method:'POST',headers:{origin,'content-type':'application/json','x-employee-session':credential,...headers},body:JSON.stringify(body)});
function fixture(){
 const state={row:null,io:0,consumed:0,approved:true,failGuard:false,epoch:1};
 const identity=()=>({schemaVersion:'design-key-identity-v2',subjectId:'s',employmentId:'e',membershipId:'m',storeId:'store',securityEpoch:state.epoch,membershipRevision:1,expiresAt:Date.now()+60000});
 const resolveIdentity=async r=>{state.io++;assert.equal(r.credential,credential);return identity();};
 const repository={resolveIdentity,async withIdentityLock(owner,work){
  let pending=structuredClone(state.row),consumed=false;const guards=[];
  const value=await work({resolveIdentity,read:async()=>structuredClone(pending),
   consumeKeyApproval:async(receipt,intent)=>{assert.deepEqual(receipt,{receiptId:'synthetic-receipt'});assert.equal(intent.subjectId,owner.subjectId);if(!state.approved)return false;consumed=true;return true;},
   compareAndSwap:async(revision,next)=>{assert.equal(revision,pending?.revision??0);assert(consumed);pending=structuredClone(next);return true;},
   beforeCommit:async guard=>{guards.push(guard);}});
  if(state.failGuard)state.epoch++;for(const guard of guards)await guard();
  state.row=pending;if(consumed)state.consumed++;return value;
 }};
 const options={enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],repository,
  secretProvider:async()=>new Uint8Array(32).fill(42),cryptoProvider:webcrypto,approvedModels:['synthetic-model']};
 return {state,options,runtime:createImmutableKeySettingsRuntime(options)};
}
const path='/api/design/key-settings/';
const save={approval:{receiptId:'synthetic-receipt'},expectedRevision:0,config,key};
test('disabled key runtime performs zero I/O',async()=>{let calls=0;const runtime=createImmutableKeySettingsRuntime({acquireClient:()=>{calls++;throw Error();}});assert.equal((await runtime.handle(req(path+'read',{purpose:'chat'}))).status,503);assert.equal(calls,0);});
test('existing HTTP routes compose immutable save/status/revoke with actual synthetic AES, no scope',async()=>{
 const f=fixture();const saved=await f.runtime.handle(req(path+'save',save));assert.equal(saved.status,200,await saved.clone().text());assert(!JSON.stringify(f.state.row).includes(key));assert.equal(f.state.row.sealed.v,2);
 let r=await f.runtime.handle(req(path+'read',{purpose:'chat'}));assert.deepEqual((await r.json()).result,{configured:true,revision:1,...config,requiresReconfiguration:false});
 f.state.epoch++;r=await f.runtime.handle(req(path+'read',{purpose:'chat'}));assert.equal((await r.json()).result.requiresReconfiguration,true);
 r=await f.runtime.handle(req(path+'revoke',{approval:{receiptId:'synthetic-receipt'},expectedRevision:1,purpose:'chat'}));assert.equal(r.status,200);assert.equal(f.state.row.sealed,null);assert.equal(f.state.consumed,2);
});
test('unapproved save and final revocation leave no key or consumed receipt',async()=>{for(const mode of ['approved','failGuard']){const f=fixture();f.state[mode]=mode==='failGuard';const r=await f.runtime.handle(req(path+'save',save));assert.notEqual(r.status,200);assert(!await r.text().then(t=>t.includes(key)));assert.equal(f.state.row,null);assert.equal(f.state.consumed,0);}});
test('model/workflow/issuer routes stay closed with zero identity access',async()=>{const f=fixture();for(const route of ['/api/design/analyze','/api/design/workflow/dispatch','/api/design/key-approval/issue','/api/design/media/upload'])assert.equal((await f.runtime.handle(req(route,{}))).status,404);assert.equal(f.state.io,0);});
test('origin rejects before identity access; injected owner rejects before slot write',async()=>{const f=fixture();assert.equal((await f.runtime.handle(req(path+'save',save,{origin:'https://untrusted.invalid'}))).status,403);assert.equal(f.state.io,0);assert.equal((await f.runtime.handle(req(path+'save',{...save,subjectId:'forged'}))).status,400);assert.equal(f.state.io,1);assert.equal(f.state.row,null);});
