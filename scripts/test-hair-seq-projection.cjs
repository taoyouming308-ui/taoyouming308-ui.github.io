'use strict';
// No production endpoint, session, customer records or database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../perm-app.html'), 'utf8');
const block = html.slice(html.indexOf('  function parseHairRecordSeq('), html.indexOf('  function stableHairRecordSeq('));
assert.ok(block.includes('function syncHairSeqCounterFromCloud()'));
const fixture = Array.from({length:2000}, (_,i)=>({record_data:{seq:i%2 ? i+1 : String(i+1),
  selectedTags:['SAMPLE-A','SAMPLE-B'], notes:'synthetic only '.repeat(12), zones:Array(6).fill({method:'simulated',confirmed:false})}}));
fixture[0].record_data.seq=null; fixture[1].record_data.seq='invalid'; fixture[2].record_data={};
const projected=fixture.map(r=>({seq:r.record_data.seq ?? null}));
function setup(respond,initial){
  const rows=new Map([['_hairRecordSeqCounter',String(initial)]]), reqs=[];
  const c={SUPABASE_URL:'https://example.invalid', SUPABASE_KEY:'fixture',localStorage:{
    getItem:k=>rows.get(k) || null,setItem:(k,v)=>{assert.equal(k,'_hairRecordSeqCounter');rows.set(k,v);}
  },fetch:async(url,opt)=>{
    const u=new URL(url);assert.equal(u.origin,'https://example.invalid');assert.equal(u.pathname,'/rest/v1/hair_records');
    assert.equal(opt.method||'GET','GET');assert.equal(opt.headers.apikey,'fixture');
    assert.equal(u.searchParams.get('status'),'neq.deleted');assert.equal(u.searchParams.get('limit'),'2000');
    const fields=u.searchParams.get('select');reqs.push(fields);return respond(fields,reqs.length);
  }};
  vm.runInNewContext(block,c);return {read:c.syncHairSeqCounterFromCloud,reqs,rows};
}
const resp=(status,body)=>({status,ok:status<300,json:async()=>body});
(async()=>{
  const x=setup(()=>resp(200,projected),3);const a=x.read(),b=x.read();assert.strictEqual(a,b);
  assert.equal(await a,2000);assert.deepEqual(x.reqs,['seq:record_data->seq']);
  assert.equal(x.rows.get('_hairRecordSeqCounter'),'2000');await x.read();assert.equal(x.reqs.length,2);
  const ahead=setup(()=>resp(200,projected),2501);await ahead.read();assert.equal(ahead.rows.get('_hairRecordSeqCounter'),'2501');
  for(const code of ['PGRST100','42883']){
    const old=setup((f,n)=>n===1?resp(400,{code}):resp(200,fixture),7);
    assert.equal(await old.read(),2000);assert.deepEqual(old.reqs,['seq:record_data->seq','record_data']);
  }
  for(const status of [400,401,403,429,500]){
    const denied=setup(()=>resp(status,{code:'OTHER'}),15);
    assert.equal(await denied.read(),15);assert.equal(denied.reqs.length,1);
  }
  const offline=setup(()=>{throw Error('OFFLINE');},5);
  assert.equal(await offline.read(),5);assert.equal(offline.reqs.length,1);
  const bytes=v=>Buffer.byteLength(JSON.stringify(v));
  console.log('OK: number projection, in-flight reuse, legacy fallback, auth/network boundaries. Synthetic raw JSON, 2000 rows: '+bytes(fixture)+' -> '+bytes(projected)+' bytes (not a production measurement).');
})().catch(e=>{console.error(e);process.exitCode=1;});
