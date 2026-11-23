// Run the production read adapters against synthetic, deferred responses; no network or DB.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('frontdesk.html', 'utf8');
const edge = fs.readFileSync('supabase/functions/frontdesk-api/index.ts', 'utf8');
const take = (a,b) => {
  const start=html.indexOf(a), end=html.indexOf(b,start); assert(start>=0 && end>start);
  return html.slice(start,end);
};
function crossTabAndResume(){
  for(const change of ['logout','different-user','same-token-revoked','other-store','same-scope','bfcache']){
    const verified={session_token:'test-secret',expires_at:'2030-01-01',user:{username:'甲',role:'staff',position:'前台',store:'A',stores:['A','B'],can_import:true}};
    const next=structuredClone(verified),classes=new Set(),events={},uiEvents={},calls=[];
    if(change==='different-user'){next.user.username='乙';next.session_token='next-secret'}
    if(change==='same-token-revoked')next.user.can_import=false;
    if(change==='other-store')next.user.stores=['B'];
    if(change==='same-scope'){next.expires_at='2040-02-01';next.user.stores.reverse()}
    let disk=['logout','bfcache'].includes(change)?null:JSON.stringify(next);
    const oldDetail={textContent:'old private row'},s={view:'import',session:verified,store:'A',dashboard:{},todayRows:[{}],ledgerRows:[{}],drawerRequest:1,customerRequest:1,searchRequest:1,ledgerRequest:2};
    const ctx={state:s,STORAGE_KEY:'session',window:{addEventListener:(k,f)=>events[k]=f,ZysyrReadSync:{enabled:false,clear(){calls.push('clear')}}},
      localStorage:{getItem:()=>disk,setItem(){throw Error('must not replace new session')},removeItem(){throw Error('must not log other tab out')}},
      document:{hidden:false,getElementById:id=>id==='customer-detail'?oldDetail:null,documentElement:{classList:{add:k=>classes.add(k)}},createElement:()=>({setAttribute(){}}),body:{appendChild(n){calls.push(n.id)}},addEventListener:(k,f)=>uiEvents[k]=f},
      $:id=>({value:id==='ledger-date'?'2026-01-02':'',classList:{contains:()=>true}}),phoneSuffixQuery:()=>'',loadDashboard:()=>calls.push('today'),loadLedger:()=>calls.push('ledger')};
    vm.runInNewContext(take('    function sameFrontdeskIdentity(', '    function saveSession(')+take("    document.addEventListener('visibilitychange'","    setInterval(function(){if(!document.hidden"),ctx);
    if(change==='bfcache')events.pageshow({persisted:true});else events.storage({key:'session'});
    if(change==='same-scope'){
      assert.equal(s.session,verified);uiEvents.visibilitychange();assert.deepEqual(calls,[],'opt-out: no ledger resume read');
      ctx.window.ZysyrReadSync.enabled=true;uiEvents.visibilitychange();assert.deepEqual(calls,['ledger']);
      s.view='today';ctx.window.ZysyrReadSync.enabled=false;uiEvents.visibilitychange();assert.deepEqual(calls,['ledger','today'],'legacy today refresh preserved');
    } else {
      assert.equal(s.session,null);assert.equal(s.dashboard,null);assert.equal(s.ledgerRows.length,0);assert.equal(s.todayRows.length,0);assert.equal(oldDetail.textContent,'');
      assert(classes.has('frontdesk-scope-invalid'));assert.deepEqual(calls,['clear','frontdesk-scope-message']);uiEvents.visibilitychange();assert.equal(calls.length,2);
    }
    assert.equal(disk,['logout','bfcache'].includes(change)?null:JSON.stringify(next));
  }
  assert.match(take('    async function apiRequest(', '    businessUI.init('),/state\.frontdeskScopeBlocked[\s\S]+await fetch[\s\S]+state\.frontdeskScopeBlocked/);
}
crossTabAndResume();
const cut = take('    function frontdeskReadScope(', "    $('today-date').value=localDate()") +
  take('    async function loadLedger(', "    $('ledger-search').addEventListener");
const context={state:{session:{session_token:'synthetic-session-not-a-real-key',user:{username:'u',role:'staff',position:'前台',store:'A',stores:['A','B'],can_import:false}},store:'A',view:'today',ledgerRequest:0,ledgerRows:[]},
  businessUI:{refresh(){}},window:{},Date,Number,JSON,setBusy(){},localDate:()=>'2026-01-02',
  bookingPlaceholder:r=>!r.customer_name&&!r.customer_phone,phoneSuffixQuery:s=>/^\d{4}$/.test(s)?s:'',
  esc:String,toast(){},renderToday(){},updateStaffOptions(){},renderLedger(){}};
const nodes=new Map();
context.$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:''});return nodes.get(id)};
context.$('today-date').value=context.$('ledger-date').value='2026-01-02';
const env=vm.createContext(context);vm.runInContext(cut,env);
const user=context.state.session.user, day='2026-01-02', store='A', state=context.state;
const holding=()=>{let resolve;const p=new Promise(r=>resolve=r);return {p,resolve}};
const calls=[];
context.api=async(op,payload)=>{calls.push({op,payload});return op==='dashboard'?{store,date:day,bookings:[{customer_name:'fixture',customer_phone:'fixture-private',amount:500},{}]}:
  {store,business_date:payload.business_date||'',phone_suffix:payload.phone_suffix||'',rows:[{customer_name:'fixture-private',amount:500}]};};
const plain=x=>JSON.parse(JSON.stringify(x));
(async()=>{
  const initial=context.frontdeskReadScope('dashboard',store,day);
  for(const [key,value] of [['role','admin'],['username','another'],['position','助理'],['can_import',true],['stores',['A']]]){
    const backup=user[key];user[key]=value;assert.notEqual(context.frontdeskReadScope('dashboard',store,day),initial,key);user[key]=backup;
  }
  assert.notEqual(context.frontdeskReadScope('dashboard','B',day),initial);
  assert.notEqual(context.frontdeskReadScope('dashboard','A','2026-01-03'),initial);
  assert.notEqual(context.frontdeskReadScope('ledger_records',store,day),initial);
  assert(!initial.includes(state.session.session_token));
  await context.loadDashboard(); // legacy client: full response, no cache protocol on the wire
  assert.equal(Object.hasOwn(calls.at(-1).payload,'read_sync'),false);
  const gate=holding();let opts;
  state.dashboard=null;
  context.window.ZysyrReadSync={enabled:true,read:async options=>{
    opts=options;
    assert.equal(options.persist,false,'customer rows must never be stored on disk');
    options.onSummary({store,date:day,count:7},Date.now()); // only a signed-in, noninteractive count before confirmation
    const reply=await options.send({version:1});await gate.p;return reply;
  }};
  context.window.ZysyrReadSync.enabled=false;
  await context.loadDashboard();
  assert.equal(opts,undefined,'off must bypass cache even when library is present');
  assert.equal(calls.at(-1).payload.read_sync,undefined);
  state.dashboard=null;context.window.ZysyrReadSync.enabled=true;
  const pending=context.loadDashboard();
  assert.match(context.$('consumption-status').textContent,/预约 7 条.*正在更新/);
  assert.equal(state.dashboard,null);
  assert.deepEqual(plain(opts.summary({store,date:day,bookings:[{customer_phone:'private',amount:99},{}]})),{store,date:day,count:1});
  assert.equal(opts.summary({store:'B',date:day,bookings:[]}),null);
  state.store='B';assert.equal(opts.current(),false);gate.resolve();await pending;
  assert.equal(state.dashboard,null,'late response from old store must be discarded');
  assert(calls.at(-1).payload.read_sync);
  state.store=store;state.view='import';calls.length=0;
  await context.loadLedger();
  assert(calls.at(-1).payload.read_sync);assert.equal(state.ledgerRows[0].amount,500);
  assert.deepEqual(plain(opts.summary({store,business_date:day,rows:[{notes:'private',amount:500}]})),{store,date:day,count:1});
  assert.equal(opts.summary({store,business_date:day,phone_suffix:'1111',rows:[]}),null);
  for(const [suffix,date] of [['1234',day],['','']]){
    await context.loadLedger(suffix,date);assert.equal(calls.at(-1).payload.read_sync,undefined,'no all-history or phone suffix cache');
  }
  assert(calls.every(c=>c.op==='ledger_records'),'reads must not replay writes');
  assert(edge.indexOf('const session = await requireSession(payload)')<edge.indexOf('encodeReadSync(payload.read_sync'));
  assert.match(edge,/data\.business_date && !data\.phone_suffix \? await encodeReadSync/);
  assert.match(html,/function clearSession\(\)\{\s*if\(window.ZysyrReadSync\)window.ZysyrReadSync.clear\(\)/);
  // Exercise the real codec + cache runtime with the same Edge encoder and
  // old server fallback. Full private results must be identical on all paths.
  Object.assign(context,{crypto:require('node:crypto').webcrypto,TextDecoder,TextEncoder,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('scoped-read-codec.js','utf8'),env);
  vm.runInContext(fs.readFileSync('scoped-read-sync.js','utf8'),env);
  context.window.ZysyrReadSync=context.ZysyrReadSync;
  const fresh={store,date:day,bookings:Array.from({length:120},(_,i)=>({customer_name:'test'+i,customer_phone:'synthetic'+i,notes:'x'.repeat(128)}))};
  state.view='today';state.dashboard=null;
  const replies=[];
  context.api=async(op,payload)=>{
    assert.equal(op,'dashboard');
    const resp=await context.ZysyrReadCodec.encode(payload.read_sync,structuredClone(fresh));
    replies.push(resp);return resp;
  };
  await context.loadDashboard();await context.loadDashboard();
  assert.equal(replies[1].__zysyr_read,1);
  assert.equal(Object.hasOwn(replies[1],'patch'),false);
  fresh.bookings[80].notes='changed';
  await context.loadDashboard();
  assert(Array.isArray(replies[2].patch),'small change must transfer a delta');
  assert.deepEqual(plain(state.dashboard),fresh);
  context.api=async()=>structuredClone(fresh);
  await context.loadDashboard();assert.deepEqual(plain(state.dashboard),fresh,'old full-response server still works');
  console.log('Frontdesk read sync: verified scope, count-only persisted preview, date/suffix isolation, late responses and legacy flow OK');
})().catch(e=>{console.error(e);process.exitCode=1});
