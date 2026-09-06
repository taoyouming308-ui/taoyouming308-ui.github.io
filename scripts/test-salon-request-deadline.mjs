import assert from 'node:assert/strict';
import {withRequestDeadline} from '../packages/salon-core/request-deadline.mjs';
import {createSalonClient} from '../packages/salon-core/api-client.mjs';

for (const value of [0, -1, 1.5, NaN, Infinity, '30', 120001]) {
  assert.throws(() => withRequestDeadline(() => {}, value), RangeError);
  assert.throws(() => createSalonClient({endpoint:'https://example.invalid/api', requestTimeoutMs:value}), {code:'INVALID_TIMEOUT'});
}
let successSignal;
assert.equal(await withRequestDeadline(signal => {successSignal=signal;return 'ok';}, 20), 'ok');
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(successSignal.aborted, false, 'success cancels its timer');
await assert.rejects(withRequestDeadline(() => {throw Error('transport error');}), /transport error/);
let hungSignal;
await assert.rejects(withRequestDeadline(signal => {hungSignal=signal;return new Promise(() => {});}, 20), {code:'REQUEST_TIMEOUT'});
assert.equal(hungSignal.aborted, true);

const result = data => ({ok:true,status:200,json:async()=>({data})});
let mode='normal', late, signal;
const calls=[];
const client=createSalonClient({endpoint:'http://127.0.0.1/api',requestTimeoutMs:20,getAccessToken:()=> 'synthetic-token-not-production',fetchImpl:async(_,options)=>{
  const body=JSON.parse(options.body);calls.push(body);signal=options.signal;
  if(body.operation==='context')return result({organizationId:1,storeId:body.storeId||1,staffId:1});
  if(mode==='hang-fetch')return new Promise(resolve=>{late=resolve;});
  if(mode==='hang-body')return {ok:true,status:200,json:()=>new Promise(resolve=>{late=resolve;})};
  return result({customerId:7});
}});
await client.connect(1);
for(const failure of ['hang-fetch','hang-body']) {
  mode=failure;
  const ticket=client.prepare('customer_create',{displayName:'合成测试'});
  const first=client.submit(ticket);
  assert.equal(first,client.submit(ticket),'duplicate clicks share in-flight request');
  await assert.rejects(first,{code:'OUTCOME_UNKNOWN'});
  assert.equal(signal.aborted,true);
  const before=calls.length, original=calls.at(-1);
  mode='normal';
  assert.deepEqual((await client.submit(ticket)).data,{customerId:7});
  assert.equal(calls.length,before+1,'only explicit retry sends another request');
  assert.deepEqual(calls.at(-1),original,'retry preserves payload and key');
  late(failure==='hang-fetch'?result({customerId:999}):{data:{customerId:999}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(client.scope.storeId,1,'late result does not mutate context');
}
mode='hang-fetch';
const ticket=client.prepare('customer_create',{displayName:'旧门店'});
const old=client.submit(ticket);
const rejected=assert.rejects(old,{code:'STALE_SCOPE'});
await client.connect(2);
await rejected;
assert.throws(()=>client.submit(ticket),{code:'STALE_SCOPE'});
assert.equal(client.scope.storeId,2);
console.log('Salon request deadline: fetch/body stalls, timer cleanup, abort, frozen manual retries and stale scope passed');
