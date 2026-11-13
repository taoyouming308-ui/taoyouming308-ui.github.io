'use strict';
// Isolated handler contract tests. RPC mocks enforce metadata/scope; not a DB RLS test.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { createHash } = require('node:crypto');
const source = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = source.indexOf('async function dailyOriginalArchive(');
const end = source.indexOf('\nasync function uploadDailySheetAttachment(', start);
assert(start >= 0 && end > start);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const session = { auth_account_id: 'server-actor', auth_capabilities: ['daily_report.write'] };
const payload = { store: 'Synthetic', request_id: '00000000-0000-4000-8000-000000000001', report_date: '2026-11-12', filename: 'original.png', mime_type: 'image/png', base64: 'AQID', note: 'synthetic only' };
function harness(options = {}) {
  const calls = [], network = [], signed = []; let receipt, stored;
  const scope = {
    cleanText: (v,n=500) => String(v ?? '').trim().slice(0,n),
    hasAuthCapability: (s,c) => s.auth_capabilities?.includes(c),
    selectedStoreInfo: async (s,p) => { if(p.store !== 'Synthetic') throw Error('store denied'); return { id:'store',company_id:'company' }; },
    uuidValue: v => { if(!/^[0-9a-f-]{36}$/.test(v)) throw Error('uuid'); return v; },
    SUPABASE_URL:'https://synthetic.invalid', VOUCHER_BUCKET:'private-vouchers', SERVICE_KEY:'synthetic', MAX_VOUCHER_BYTES:10,
    storagePath: p => p, sha256Bytes: async b => hash(b), decodeBase64: b => { if(b==='bad!') throw Error('decode'); return new Uint8Array(Buffer.from(b,'base64')); },
    exactArrayBuffer: b => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),
    signedStorageUrl: async (bucket,path) => {signed.push({bucket,path});return 'https://synthetic.invalid/signed';},
    rest: async (path,init) => {
      assert(['rpc/zysyr_daily_original_archive','rpc/zysyr_daily_original_manage'].includes(path)); const b=JSON.parse(init.body); calls.push(b);
      assert.equal(b.p_actor_user_id,'server-actor'); assert.equal(b.p_store_id,'store'); assert.equal(b.p_company_id,'company');
      const response = (data,ok=true) => ({ok,status:ok?200:403,json:async()=>structuredClone(data)});
      if(options.denyDb) return response({message:'revoked'},false);
      if(path==='rpc/zysyr_daily_original_manage') {
        if(b.p_action==='status')return response({states:b.p_request_ids.map(request_id=>({request_id,voided:!!options.voided,display_rotation_degrees:options.degrees||0}))});
        if(b.p_action==='void'){options.voided=true;return response({action:'void',requested:b.p_request_ids.length,changed:b.p_request_ids.length,financial_records_unchanged:true});}
        if(b.p_action==='rotate'){options.degrees=b.p_degrees;return response({action:'rotate',requested:1,changed:1,financial_records_unchanged:true});}
      }
      if(b.p_action==='list') return response({archives:receipt?[receipt.archive]:[]});
      if(b.p_action==='reserve') {
        if(receipt) { if(JSON.stringify(b.p_metadata)!==JSON.stringify(receipt.metadata)) return response({message:'replay mismatch'},false); return response({...receipt,newly_reserved:false}); }
        receipt={status:'pending',newly_reserved:false,request_id:payload.request_id,metadata:b.p_metadata,archive:{...b.p_metadata,request_id:payload.request_id,status:'archived',object_path:'company/store/immutable-original'}};
        return response({...receipt,newly_reserved:true});
      }
      if(b.p_action==='complete') {
        if(options.completeFail) throw Error('completion unavailable');
        receipt.status='archived';
        if(options.completeReplyLost) { options.completeReplyLost=false; throw Error('response lost'); }
      }
      return response(receipt || {status:'not_found'});
    },
    fetch: async (url,init={}) => {
      network.push({url,init}); assert.match(url,/private-vouchers\/company\/store\/immutable-original$/);
      assert.notEqual(init.method,'DELETE');
      if(init.method==='POST') {
        assert.equal(init.headers['x-upsert'],'false'); stored = options.absent ? undefined : new Uint8Array(init.body);
        if(options.uploadLost) throw Error('unknown upload outcome');
        return {ok:!options.uploadFail};
      }
      const bytes=options.corrupt ? new Uint8Array([9,9,9]) : options.wrongSize ? new Uint8Array([1]) : stored;
      return {ok:!!bytes,status:bytes?200:(options.readStatus || 404),arrayBuffer:async()=>bytes.buffer};
    }
  };
  vm.createContext(scope); vm.runInContext(stripTypeScriptTypes(source.slice(start,end)),scope);
  return {call:(op='upload',p=payload,s=session)=>scope.dailyOriginalArchive('daily_original_archive_'+op,p,s),
    manage:(op,p,s=session)=>scope.dailyOriginalManage('daily_original_archive_'+op,p,s),calls,network,signed,options};
}
async function main() {
  let h=harness();
  await assert.rejects(h.call('upload',payload,{...session,auth_capabilities:[]}));
  for(const patch of [{store:'Other'},{request_id:'invalid'},{report_date:'2026-02-30'},{filename:''},{mime_type:'text/html'},{base64:''},{base64:'bad!'},{base64:Buffer.alloc(11).toString('base64')}]) await assert.rejects(h.call('upload',{...payload,...patch}));
  assert.equal(h.calls.length,0); assert.equal(h.network.length,0);
  assert.equal((await h.call('upload',{...payload,actor_user_id:'spoof',company_id:'spoof',store_id:'spoof'})).status,'archived');
  assert.equal(h.calls[0].p_metadata.sha256,hash(Buffer.from([1,2,3]))); assert.equal(h.calls[0].p_metadata.size_bytes,3);
  await h.call(); assert.equal(h.network.filter(c=>c.init.method==='POST').length,1);
  await assert.rejects(h.call('upload',{...payload,base64:'BAUG'})); assert.equal(h.network.length,2);
  await h.call('list',{store:'Synthetic',month:'2026-11',offset:0});
  assert.equal(h.calls.findLast(c=>c.p_action==='list').p_metadata.limit,201); assert.equal(h.calls.findLast(c=>c.p_action==='list').p_request_id,null);
  await assert.rejects(h.call('list',{store:'Synthetic',month:'2026-13'}));
  await assert.rejects(h.call('list',{store:'Synthetic',month:'2026-11',offset:-1}));
  await h.call('url'); assert.deepEqual(h.signed,[{bucket:'private-vouchers',path:'company/store/immutable-original'}]);
  assert.equal(h.network.length,2,'list/url cannot read or write storage objects');
  assert.equal((await h.manage('orientation_save',{store:'Synthetic',request_id:payload.request_id,degrees:90,reason:'synthetic rotation'})).changed,1);
  assert.equal((await h.call('list',{store:'Synthetic',month:'2026-11'})).archives[0].display_rotation_degrees,90);
  assert.equal((await h.manage('void',{store:'Synthetic',request_ids:[payload.request_id],reason:'synthetic mistaken upload'})).changed,1);
  assert.equal((await h.call('list',{store:'Synthetic',month:'2026-11'})).archives[0].status,'voided');
  await assert.rejects(h.call('url'));
  assert.equal((await h.call('upload')).status,'voided','reusing a voided request cannot report an active archive');
  assert.equal(h.network.length,2,'voided replay never reuploads');
  h=harness({denyDb:true}); await assert.rejects(h.call()); assert.equal(h.network.length,0);
  for(const mode of ['uploadLost','uploadFail','completeFail','completeReplyLost']) {
    h=harness({[mode]:true}); assert.equal((await h.call()).status,'pending');
    h.options.completeFail=false;
    assert.equal((await h.call('status')).status,'archived',mode+' recovers through status');
    await h.call(); assert.equal(h.network.filter(c=>c.init.method==='POST').length,1);
  }
  for(const mode of ['corrupt','wrongSize']) {
    h=harness({uploadLost:true,[mode]:true}); await h.call();
    const result=await h.call('status'); assert.equal(result.status,'pending'); assert.equal(result.integrity_error,true);
    assert.equal(h.calls.filter(c=>c.p_action==='complete').length,0);
    await assert.rejects(h.call('url')); assert.equal(h.signed.length,0);
    await h.call(); assert.equal(h.network.filter(c=>c.init.method==='POST').length,1,'pending replay never uploads again');
  }
  for(const status of [403,500]) {
    h=harness({uploadLost:true,absent:true,readStatus:status}); await h.call(); await h.call('resume');
    assert.equal(h.network.filter(c=>c.init.method==='POST').length,1,'ambiguous storage read must not resume');
  }
  h=harness({uploadLost:true,absent:true}); await h.call();
  h.options.absent=false; h.options.uploadLost=false;
  assert.equal((await h.call('resume')).status,'archived');
  assert.equal(h.network.filter(c=>c.init.method==='POST').length,2,'explicit resume can create missing object');
  console.log('Daily original archive API: validation, authorization boundary, immutable reserve/replay, uncertain outcomes, hash reconciliation, scoped list/private URL passed (synthetic mocks only).');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
