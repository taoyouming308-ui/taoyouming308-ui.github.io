'use strict';
// Exercise the actual page adapter, actual transport, and actual HTTP dispatch.
// No network or real accounts: only the data accessors and UI surface are fakes.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module'), {webcrypto} = require('node:crypto');
const file = p => fs.readFileSync(p,'utf8'), sample = 'a'.repeat(800);
const html = file('operations.html'), service = file('supabase/functions/operations-api/index.ts');
async function test() {
  const {encodeReadSync} = await import('../supabase/functions/_shared/read-sync.mjs');
  const reads = [], authCalls = [], requests = [], previews = [], month = '2026-08';
  let authorized = true, offline = false, spyOptions, held;
  const fresh = {overview:{month,monthly_report:{id:'private',secret:sample}},
    daily_sheet_month:{month,days:[{report_date:'2026-08-09',grand_total:123456,hidden:sample}]},
    daily_sheet_read:{draft:{id:'draft'},private_url:'private/signed/'+sample}};
  const server = vm.createContext({Request,Response,URL,Error,encodeReadSync,console:{info(){},error(){}},Date,
    Deno:{env:{get:()=> 'synthetic'},serve:()=>{}},
    authorize:async()=>{authCalls.push(true);if(!authorized)throw Error('当前账号没有查看日报权限');return {operations_role:'finance'}},
    reader:async(op,p)=>{reads.push(op);assert.equal(p.store,'店一');return structuredClone(fresh[op])}});
  vm.runInContext(stripTypeScriptTypes(service.replace(/^import .*;\n/gm,'')),server);
  vm.runInContext("requireSession=authorize;overview=p=>reader('overview',p);dailySheetMonth=p=>reader('daily_sheet_month',p);dailySheetRead=p=>reader('daily_sheet_read',p);dailyOriginalReadPresentation=async(m,d)=>d",server);
  const replies=[];
  async function api(operation,payload){
    requests.push({operation,payload});
    if(offline)throw Object.assign(Error('offline'),{code:'API_NETWORK_FAILED'});
    if(held)await held;
    const r=await server.handleOperationsApiRequest(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({operation,...payload})}),()=>{});
    const out=await r.json();if(!r.ok)throw Object.assign(Error(out.error),{status:r.status,code:out.code});replies.push(out);return out;
  }
  const makeEl=()=>{const cls=new Set();return {value:'',textContent:'',getAttribute(){return null},setAttribute(){},classList:{contains:k=>cls.has(k),add:k=>cls.add(k),remove:k=>cls.delete(k)}}};
  const els=new Map(),$=id=>{if(!els.has(id))els.set(id,makeEl());return els.get(id)};
  $('month').value=month;$('daily-month').value=month;$('daily-report-detail').classList.add('hidden');
  const document={hidden:false,documentElement:makeEl(),addEventListener(){},querySelector(){return null}};
  const state={view:'daily-report',session:'s'.repeat(64),user:{username:'测试账号',stores:['店一'],role:'finance',can_read_daily_reports:true}};
  let dirty=false, store='店一';
  const env=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Date,setTimeout,clearTimeout,document,navigator:{onLine:true},
    $,state,api,StaffReportView:{enabled:false},currentStore:()=>store,monthlyHasUnsaved:()=>dirty,
    dailySheetDirtyCount:()=>0,isSessionInvalidError:()=>false,isLocalPreview:()=>false,addEventListener(){},
    dailyOverviewRequest:0,dailyOpenState:null,renderDailyReportCalendar:()=>{$('daily-report-calendar').textContent='online'},beijingTimeNow:()=>''});
  vm.runInContext('window=globalThis',env);
  vm.runInContext(file('scoped-read-codec.js'),env);vm.runInContext(file('scoped-read-sync.js'),env);
  const core=env.ZysyrReadSync;
  env.ZysyrReadSync={enabled:true,clear:core.clear,read:o=>{spyOptions=o;return core.read(o)}};
  vm.runInContext(html.slice(html.indexOf('  var reportSyncPrincipal='),html.indexOf('  function beginScopedRead(')),env);
  vm.runInContext(html.slice(html.indexOf('  async function loadDailyReportOverview('),html.indexOf('  function dailyArchivePresence(')),env);
  const read=(op)=>env.readScopedReport(op,{store,...(op==='daily_sheet_read'?{draft_id:'draft'}:{month})},()=>true,s=>previews.push(s));
  env.ZysyrReadSync.enabled=false;
  env.reportSyncCalendarVisit=JSON.stringify([env.reportPrincipal(),store,month]);
  env.revalidateVisitedReport();assert.equal(requests.length,0,'no new automatic report read when rollout is off');
  await read('overview');assert.equal(spyOptions,undefined);assert.equal(requests[0].payload.read_sync,undefined,'legacy explicit read remains available');
  env.ZysyrReadSync.enabled=true;
  for(const op of Object.keys(fresh)){
    const authBefore=authCalls.length;
    const first=await read(op);assert.deepEqual(JSON.parse(JSON.stringify(first)),fresh[op]);assert.equal(spyOptions.persist,false);
    if(op==='daily_sheet_read')assert.equal(spyOptions.summary,undefined,'no signed URLs on disk');
    else assert(!JSON.stringify(spyOptions.summary(first)).includes(sample),'persist only a projection');
    assert.deepEqual(JSON.parse(JSON.stringify(await read(op))),fresh[op]);
    assert.equal(authCalls.length,authBefore+2);assert.equal(replies.at(-1).__zysyr_read,1);assert.equal(reads.at(-1),op);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(previews)),[{month},{month,dates:['2026-08-09']},null]);
  fresh.daily_sheet_month.days[0].grand_total=234567;
  assert.equal((await read('daily_sheet_month')).days[0].grand_total,234567);
  const count=previews.length;dirty=true;await read('overview');dirty=false;assert.equal(count,previews.length);
  offline=true;assert.equal(await env.loadDailyReportOverview(),false);
  assert.match($('daily-report-calendar').textContent,/非最新.*09.*未能核对/);assert(!/234567|private/.test($('daily-report-calendar').textContent));
  offline=false;
  let release;held=new Promise(r=>release=r);
  const pending=read('daily_sheet_month');await new Promise(setImmediate);store='店二';release();
  await assert.rejects(pending,/变化/);store='店一';held=null;
  authorized=false;const readCount=reads.length;
  await assert.rejects(read('daily_sheet_month'),/权限/);assert.equal(reads.length,readCount,'denial before conditional compare');
  assert(document.documentElement.classList.contains('report-scope-invalid'));assert.equal($('daily-report-calendar').textContent,'');
  await assert.rejects(read('daily_sheet_create'),/不是可同步/);
  assert(requests.every(r=>Object.hasOwn(fresh,r.operation)),'no write dispatched');
  console.log('Report sync: 3 authorized full/conditional reads, change, safe offline summary, dirty/scope race, denial and write exclusion passed.');
}
test().catch(e=>{console.error(e);process.exitCode=1});
