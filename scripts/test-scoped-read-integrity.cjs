'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const crypto=require('node:crypto').webcrypto;
const source=['scoped-read-codec.js','scoped-read-sync.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
function device(enabled,secret,mode='opt-in',stored,clock=Date) {
  const tab=vm.createContext({crypto,TextEncoder,TextDecoder,Date:clock,setTimeout,clearTimeout,URLSearchParams,
    document:{documentElement:{getAttribute:k=>k==='data-read-sync-rollout'?mode:'demo'}},
    location:{search:typeof enabled==='string'?enabled:enabled?'?read_preview=1':''},sessionStorage:new Map(stored?[['zysyr-scoped-read-preview',stored]]:[])});
  tab.sessionStorage.getItem=tab.sessionStorage.get.bind(tab.sessionStorage);tab.sessionStorage.setItem=tab.sessionStorage.set.bind(tab.sessionStorage);
  vm.runInContext(source,tab);
  return {tab,read:send=>tab.ZysyrReadSync.read({scope:'store-and-day',secret,current:()=>true,send})};
}
const secret='test-session-only-not-production-123456789', copy=x=>JSON.parse(JSON.stringify(x));
(async()=>{
  const A=device(true,secret), B=device(true,secret+'-deviceB'), legacy=device(false,secret);
  for(const [mode,query,stored,want] of [
    ['default-on','',null,true],['default-on','?read_preview=0','1',false],
    ['default-on','','0',false],['opt-in','',null,false],['opt-in','?read_preview=1',null,true],
    ['off','?read_preview=1','1',false],[null,'','1',false]
  ])assert.equal(device(query,secret,mode,stored).tab.ZysyrReadSync.enabled,want);
  const rows=Array.from({length:100},(_,i)=>({id:i,status:'confirmed',label:'样本'+i,memo:'a'.repeat(80)}));
  let data={rows},denied=false,offline=false;const calls=[];
  const send=async h=>{
    calls.push(h?.rev||null);
    if(offline)throw Error('offline');if(denied)throw Object.assign(Error('denied'),{status:403});
    return copy(await A.tab.ZysyrReadCodec.encode(h,data));
  };
  for(const d of [legacy,legacy,A,B])assert.deepEqual(copy(await d.read(send)),data);
  assert(calls.every(h=>!h),'default cohort, first access, or another device cannot use prior hints');
  await A.read(send);await B.read(send);assert.equal(calls.at(-1),calls.at(-2));assert(calls.at(-1));
  offline=true;await assert.rejects(B.read(send),/offline/);
  offline=false;data={rows:[{...rows[5],status:'void'},...rows.slice(25,75).reverse()]};
  for(const d of [A,B])assert.deepEqual(copy(await d.read(send)),data,'deletes, void and reordering must converge');
  denied=true;await assert.rejects(B.read(send),/denied/);denied=false;
  await B.read(send);assert.equal(calls.at(-1),null,'revocation invalidated the old baseline');
  assert.deepEqual(copy(await A.tab.ZysyrReadCodec.encode({v:1,rev:'invalid',ids:Array(401)},data)),data);
  let now=1_000_000;
  class Clock extends Date {static now(){return now}}
  const D=device(true,secret,'opt-in',undefined,Clock),view=D.tab.ZysyrReadSync.view;
  const key='actor-a/store-a/day-01',snap=view.save(key,{rows:[1]});
  assert.equal(view.get('actor-a/store-a/day-02'),null);
  assert.equal(view.get('actor-a/store-b/day-01'),null);
  assert.equal(view.get('actor-b/store-a/day-01'),null);
  assert.equal(view.save(key,{rows:[1]}),snap);
  assert.notEqual(view.save(key,{rows:[2]}),snap);
  now+=300001;assert.equal(view.get(key),null);
  view.save(key,{rows:[1]});for(let i=0;i<6;i++)view.save('other/'+i,[]);
  assert.equal(view.get(key),null);
  view.save(key,{rows:[1]});denied=true;await assert.rejects(D.read(send),/denied/);
  assert.equal(view.get(key),null,'a permission denial clears the UI cache');
  assert.equal(legacy.tab.ZysyrReadSync.view,undefined,'opt-out disables view reuse');
  console.log('PASS: pilot off is legacy, two isolated devices converge after offline/edit/void/delete/reorder, invalidation and full read fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
