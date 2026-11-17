import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';
import {startDesignStagingService} from '../packages/design-production-adapter/staging-service.mjs';
import {qualifyPhoneNativeHost} from '../packages/design-production-adapter/phone-native-driver.mjs';
const origin='https://staging.synthetic.invalid';
// Synthetic capabilities test lifecycle only. The full phone/PG/browser suite
// separately exercises this same lifecycle with actual local dependencies.
function fixture(extra={}){const calls={ready:0,close:0,io:0};const deny=async()=>{calls.io++;throw Error('SYNTHETIC_PRIVATE_ERROR');};return {calls,dependencies:{acquireClient:deny,worker:{inspect:deny,normalize:deny,derive:deny},mediaApprovalVerifier:{verifyImmutable:deny},storageOrigin:'https://staging-synthetic.supabase.co',privateMediaTransport:deny,verifyReady:async()=>{calls.ready++;return true;},close:async()=>{calls.close++;},...extra}};}
test('default disabled; invalid config and attempted model activation never acquire ownership',async()=>{
 const f=fixture();await assert.rejects(startDesignStagingService(),/DISABLED/);
 for(const extra of [{publicOrigin:'http://localhost'},{modelsEnabled:true},{port:65536}])await assert.rejects(startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies,...extra}),/INVALID/);
 assert.deepEqual(f.calls,{ready:0,close:0,io:0});
});
test('failed readiness closes dependencies exactly once and hides dependency errors',async()=>{
 for(const verifyReady of [async()=>false,async()=>{throw Error('SYNTHETIC_PRIVATE_ERROR');}]){
  const f=fixture({verifyReady});await assert.rejects(startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies}),e=>e.message==='DESIGN_STAGING_START_FAILED');assert.equal(f.calls.close,1);assert.equal(f.calls.io,0);
 }
});
test('runtime construction failure still closes owned dependencies',async()=>{
 const f=fixture({storageOrigin:'https://wrong.synthetic.invalid'});await assert.rejects(startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies}),/START_FAILED/);assert.equal(f.calls.close,1);
});
test('occupied port is a clean startup failure; another listener is preserved',async()=>{
 const other=createServer((_q,r)=>r.end('independent'));other.listen(0,'127.0.0.1');await once(other,'listening');const f=fixture();
 try{await assert.rejects(startDesignStagingService({enabled:true,publicOrigin:origin,port:other.address().port,dependencies:f.dependencies}),/START_FAILED/);assert.equal(f.calls.close,1);assert.equal(await(await fetch('http://127.0.0.1:'+other.address().port)).text(),'independent');}finally{await new Promise(r=>other.close(r));}
});
test('actual loopback listener keeps model/key/speech routes off and closes idempotently',async()=>{
 const f=fixture(),s=await startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies}),url='http://127.0.0.1:'+s.address.port;
 try{
  assert.deepEqual(s.status(),{state:'ready',modelsEnabled:false});assert.equal(s.address.host,'127.0.0.1');
  for(const path of ['speech','key-settings/read','key-settings/save','candidate/vision','application-views/compare']){const r=await fetch(url+'/api/design/'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert(r.status>=400);assert(!JSON.stringify(await r.json()).includes('SYNTHETIC_PRIVATE_ERROR'));}
  assert.equal(f.calls.io,0);
 }finally{await Promise.all([s.close(),s.close()]);}
 assert.deepEqual(s.status(),{state:'closed',modelsEnabled:false});assert.equal(f.calls.close,1);await assert.rejects(fetch(url));
});
test('shutdown uncertainty remains explicit and cannot be retried as success',async()=>{
 const f=fixture({close:async()=>{throw Error('PRIVATE_SHUTDOWN_DETAIL');}}),s=await startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies});
 await assert.rejects(s.close(),e=>e.message==='DESIGN_STAGING_CLOSE_UNCERTAIN');await assert.rejects(s.close(),/CLOSE_UNCERTAIN/);assert.equal(s.status().state,'close_uncertain');await assert.rejects(fetch('http://127.0.0.1:'+s.address.port));
});
test('startup cleanup uncertainty is surfaced without the private failure text',async()=>{
 const f=fixture({verifyReady:async()=>false,close:async()=>{throw Error('PRIVATE');}});await assert.rejects(startDesignStagingService({enabled:true,publicOrigin:origin,dependencies:f.dependencies}),e=>e.message==='DESIGN_STAGING_CLOSE_UNCERTAIN');
});
test('actual unsupported host is refused; caller cannot inject a platform assertion',async()=>{
 if(process.platform!=='linux'||process.arch!=='arm64'||!process.getuid?.())await assert.rejects(qualifyPhoneNativeHost({image:'sha256:'+'a'.repeat(64),platform:'linux',rootless:true}),/HOST_UNSUPPORTED/);
 else await assert.rejects(qualifyPhoneNativeHost({image:'invalid'}),/IMAGE_UNSUPPORTED/);
});
