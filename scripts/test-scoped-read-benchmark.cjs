// Offline browser benchmark. Both versions get the same synthetic payloads and synthetic transport.
// Example: BENCH_BASE=/path/to/v686-baseline node scripts/test-scoped-read-benchmark.cjs
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
if(!process.env.BENCH_BASE)throw Error('Set BENCH_BASE to a separate snapshot of the release being compared.');
const root=path.resolve(__dirname,'..'),base=path.resolve(process.env.BENCH_BASE);
const origin='http://127.0.0.1:43857',delay=Number(process.env.BENCH_RTT||160),bps=256*1024,reps=Number(process.env.BENCH_REPS||3);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),expires='2099-01-01T00:00:00Z';
const token='11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';
const shop='自由手艺人',employee={username:'合成发型师',store:shop,role:'staff',position:'发型师',active:true,employment_status:'active'};
const front={...employee,position:'前台',stores:[shop],can_import:false};
const shareholder={username:employee.username,role:'shareholder',role_label:'股东',store:shop,stores:[shop],can_read_daily_reports:true};
const items=['employee','frontdesk','report'], cfg={
 employee:{path:'perm-app.html',op:'today_bookings',marker:'#booking-list .booking-item',status:'#booking-list'},
 frontdesk:{path:'frontdesk.html',op:'dashboard',marker:'.schedule-event',status:'#consumption-status',pattern:'上次核实'},
 report:{path:'operations.html?entry=staff-shareholder',op:'overview',marker:'#monthly-sheet .sheet-table td',status:'#sync-status',pattern:'已找到本机上次查看'}
};
require(path.join(root,'scoped-read-codec.js'));
const rows=Array.from({length:48},(_,i)=>({id:'demo-'+(i+1),customer_name:'样本预约'+(i+1),barber_name:employee.username,
 time_label:String(9+Math.floor(i/4)).padStart(2,'0')+':'+String((i%4)*15).padStart(2,'0'),service_name:'演示剪发',source:'frontdesk',status:'booking',notes:'合成夹具（非真实客户）'}));
const mime=f=>({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f)]||'application/octet-stream';
async function local(route,dir,url){
 const f=path.resolve(dir,'.'+decodeURIComponent(url.pathname));if(!f.startsWith(dir+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''});
 return route.fulfill({contentType:mime(f),body:fs.readFileSync(f)});
}
async function fixtures(browser){
 const ctx=await browser.newContext({serviceWorkers:'block'});await ctx.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin?local(r,base,u):r.abort()});
 const page=await ctx.newPage();try{await page.goto(origin+'/operations.html?preview=1&role=finance');await page.locator('#monthly-edit-toggle').waitFor();
 return await page.evaluate(()=>JSON.parse(JSON.stringify({overview:state.data,calendar:previewDailySheetMonth(),day:previewDailySheetData()})));}finally{await ctx.close()}
}
async function scenario(browser,dir,variant,app,overview,trial,extra=false){
 const c=cfg[app],ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
 const calls=[],errors=[],unexpected=[],out=[];let holdSession=false,releaseSession;let revoked=false,sessionWaiter,otherDeviceEdited=false;
 await ctx.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());
 if(u.origin===origin&&u.pathname==='/no-script-benchmark-sibling')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>合成测试标签</title>'});
 if(u.origin===origin)return local(r,dir,u);
 if(req.method()==='GET'&&u.pathname.startsWith('/img/'))return r.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64')});
 const body=req.postDataJSON()||{},op=body.operation||req.method()+' '+u.pathname,key=u.pathname.split('/').pop();
 let answer={},status=200;const q={op,rx:0,tx:Buffer.byteLength(req.postData()||''),hint:!!body.read_sync,done:false};
 calls.push(q);
 if(op==='session'){if(holdSession){sessionWaiter?.();await new Promise(resolve=>{releaseSession=resolve})}if(revoked){status=403;answer={error:'请重新登录',code:'AUTH_SESSION_INVALID'}}else answer={user:app==='report'?shareholder:app==='frontdesk'?front:employee,expires_at:expires};}
 else if(op==='today_bookings')answer={date:body.date,store:shop,barber:employee.username,rows:rows.map(row=>({...row,date:body.date})),counts:{}};
 else if(op==='dashboard')answer={date:body.date,store:body.store,bookings:otherDeviceEdited?[{...rows[0],customer_name:'跨设备模拟改名'},...rows.slice(1)]:rows,barbers:[employee.username],technicians:[],assistants:[],reception:[],services:[],synced_at:'2026-11-01T10:15:00Z',consumption_complete:true};
 else if(op==='overview')answer=overview.overview;
 else if(op==='daily_sheet_month')answer={...overview.calendar,permissions:{write:false}};
 else if(op==='daily_sheet_read')answer={...overview.day,draft:{...overview.day.draft,report_date:overview.calendar.days.find(d=>d.draft_id===body.draft_id).report_date,id:body.draft_id},readonly:true,permissions:{write:false,upload_original:false,save_orientation:false}};
 else if(op==='monthly_review_status')answer={publication:null,receipt:null,history:[],finance:false};
 else if(op==='monthly_review_inbox')answer={pending:[],count:0};
 else if(op==='report_access')answer={enabled:false};
 else if(op==='business_details')answer={available:false,store:shop,date:body.date};
 else if(req.method()==='GET'&&u.pathname.startsWith('/rest/v1/'))answer=key==='staff'?[employee]:[];
 else if(op==='bootstrap'&&u.pathname.endsWith('/aesthetic-study'))answer={user:{id:99,username:employee.username,store:shop},server_time:Date.now(),cases:[],rows:[]};
 else{unexpected.push(op);status=403;answer={error:'unrecognized synthetic read; no writes are implemented'};}
 if(body.read_sync&&[c.op,'daily_sheet_month','daily_sheet_read'].includes(op))answer=await globalThis.ZysyrReadCodec.encode(body.read_sync,answer);
 const json=JSON.stringify(answer);q.rx=Buffer.byteLength(json);await wait(delay+1000*(q.tx+q.rx)/bps);
 q.done=true;await r.fulfill({status,contentType:'application/json',body:json}).catch(()=>{});
 });
 await ctx.addInitScript(({app,c,token,expires,employee,front,variant,normalEntry})=>{
 if(variant==='candidate'&&!normalEntry)sessionStorage.setItem('zysyr-scoped-read-preview','1');
 if(!localStorage.getItem('bench-initialized')){
   if(app==='frontdesk')localStorage.setItem('zysyr-frontdesk-session-v1',JSON.stringify({user:front,session_token:token,expires_at:expires}));
   else localStorage.setItem('booking-session',JSON.stringify({...employee,session_token:token,loggedAt:Date.now(),expires_at:expires}));
   localStorage.setItem('bench-initialized','1');
 }
 if(app==='employee')sessionStorage.setItem('_curPage','bookings');
 const now=()=>Math.round(performance.now());window.BM={start:0,usable:null,summary:null,initial:true,verifiedAt:null,op:c.op,marker:c.marker,status:c.status,pattern:c.pattern};
 const scan=()=>{const m=window.BM,el=document.querySelector(m.marker),status=document.querySelector(m.status);
  // Older employee builds visibly displayed a count while verifying. Only that exact
  // normal state counts: neither the error with the same prefix nor the new aria-label is a paint.
  if(m.summary===null&&status&&(m.op==='today_bookings'
    ? status.getClientRects().length&&getComputedStyle(status).visibility==='visible'&&/^上次读取有 \d+ 条预约 · 正在核对，暂不可操作$/.test(status.innerText.trim())
    : status.textContent.includes(m.pattern)))m.summary=now()-m.start;
  if(!m.initial&&!m.verifiedAt)return;
  if(m.usable===null&&el?.getClientRects().length&&(m.op!=='overview'||window.state?.monthlyOverviewReady===true))m.usable=now()-m.start;
 };new MutationObserver(scan).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});window.benchScan=scan;
 const fetch0=window.fetch;window.fetch=async function(input,options){const res=await fetch0.apply(this,arguments);
 let op;try{op=JSON.parse(options?.body||'{}').operation}catch{}if(op===window.BM.op&&res.ok){const m=window.BM; m.verifiedAt=now()-m.start||1;}
 return res;};
 },{app,c,token,expires,employee,front,variant,normalEntry:process.env.BENCH_NORMAL_ENTRY==='1'});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));const url=origin+'/'+c.path;
 try{
 for(const phase of ['cold','repeat','reopen']){
   const before=calls.length;
   if(phase==='cold')await page.goto(url,{waitUntil:'domcontentloaded'});
   else if(phase==='reopen')await page.reload({waitUntil:'domcontentloaded'});
   else await page.evaluate(app=>{const m=window.BM;m.start=performance.now();m.usable=null;m.summary=null;m.verifiedAt=null;m.initial=false;
    if(app==='frontdesk')document.querySelector('#refresh-btn').click();
    if(app==='report')document.querySelector('#refresh').click();
    if(app==='employee')window.openFeature('bookings');
   },app);
   await page.waitForFunction(()=>{window.benchScan();return window.BM.usable!==null&&window.BM.verifiedAt!==null;},{},{timeout:10000});
   // Include ancillary requests triggered by verified rendering, before the first polling cycle.
   await page.waitForTimeout(450);
   const m=await page.evaluate(()=>window.BM),req=calls.slice(before),target=req.filter(x=>x.op===c.op);
   assert(target.length>0&&target.every(x=>x.done),app+' '+phase+' target completed');
   if(variant==='candidate'&&app==='employee')assert.equal(m.summary,null,'the quiet candidate must not paint a normal cached count');
   out.push({variant,app,phase,trial,usableMs:m.usable,cacheSummaryMs:m.summary,verifiedResponseMs:m.verifiedAt,
     calls:req.length,tx:req.reduce((s,x)=>s+x.tx,0),rx:req.reduce((s,x)=>s+x.rx,0),dataRx:target.reduce((s,x)=>s+x.rx,0),
     opCounts:Object.fromEntries([...new Set(req.map(x=>x.op))].map(op=>[op,req.filter(x=>x.op===op).length])),dataHint:target.some(x=>x.hint)});
 }
 if(app==='report'){
   for(const phase of ['cold','repeat'])for(const isDay of [false,true]){
     const op=isDay?'daily_sheet_read':'daily_sheet_month',before=calls.length;
     await page.evaluate(({op,isDay,phase})=>{Object.assign(window.BM,{start:performance.now(),op,usable:null,summary:null,verifiedAt:null,initial:false,
       marker:isDay?'#daily-detail-grid table td':'#daily-report-calendar [data-draft-id]',status:isDay?'#view-daily-report':'#daily-report-calendar',pattern:isDay?'的本机记录':'月历（非最新）'});
       if(isDay)document.querySelector('#daily-report-calendar [data-draft-id]').click();
       else if(phase==='cold')document.querySelector('[data-view="daily-report"]').click();
       else {document.querySelector('#daily-readonly-back').click();document.querySelector('#daily-report-refresh').click();}
     },{op,isDay,phase});
     await page.waitForFunction(()=>{window.benchScan();return window.BM.usable!==null&&window.BM.verifiedAt!==null;},{},{timeout:10000});
     await page.waitForTimeout(450);const m=await page.evaluate(()=>window.BM),req=calls.slice(before),target=req.filter(x=>x.op===op);assert(target.length&&target.every(x=>x.done));
     out.push({variant,app:isDay?'daily-detail':'daily-calendar',phase,trial,usableMs:m.usable,cacheSummaryMs:m.summary,verifiedResponseMs:m.verifiedAt,calls:req.length,tx:req.reduce((s,x)=>s+x.tx,0),rx:req.reduce((s,x)=>s+x.rx,0),dataRx:target.reduce((s,x)=>s+x.rx,0),
       dataHint:target.some(x=>x.hint),opCounts:Object.fromEntries([...new Set(req.map(x=>x.op))].map(k=>[k,req.filter(x=>x.op===k).length]))});
   }
 }
 if(extra&&app==='frontdesk'){
   // Fresh context = fresh device (also true for every cold sample); server revocation gate on reload before any preview.
   assert(!out[0].dataHint&&out[0].cacheSummaryMs===null);
   // Same account, simulated external authoritative change: delta must replace stale values on refresh.
   otherDeviceEdited=true;await page.locator('#refresh-btn').click();await page.locator('.schedule-event').filter({hasText:'跨设备模拟改名'}).first().waitFor({timeout:4000});
   // Real browser storage event from a sibling tab; an old document must no longer expose the loaded roster.
   const sibling=await ctx.newPage();await sibling.goto(origin+'/no-script-benchmark-sibling');const saved=await sibling.evaluate(()=>{const k='zysyr-frontdesk-session-v1',s=localStorage.getItem(k),a=JSON.parse(s);a.session_token+='-other';localStorage.setItem(k,JSON.stringify(a));return s});
   await page.locator('#frontdesk-scope-message').waitFor({timeout:4000});assert(!(await page.locator('.schedule-event').first().isVisible()));
   await sibling.evaluate(s=>localStorage.setItem('zysyr-frontdesk-session-v1',s),saved);await sibling.close();
   const before=calls.length;holdSession=true;revoked=true;const pending=new Promise(resolve=>{sessionWaiter=resolve});
   await page.reload({waitUntil:'domcontentloaded'});await pending;
   assert.equal(await page.locator('.schedule-event').count(),0);assert(!/上次核实/.test(await page.locator('#consumption-status').textContent()));releaseSession();holdSession=false;
   await page.waitForFunction(()=>!localStorage.getItem('zysyr-frontdesk-session-v1'));assert.equal(calls.slice(before).filter(x=>x.op===c.op).length,0);
 }
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);return out;
 }catch(e){console.error({variant,app,calls,errors,unexpected,body:(await page.locator('body').innerText().catch(()=>'' )).slice(-1200)});throw e}finally{await ctx.close()}
}
(async()=>{const useWebKit=process.env.STARTUP_BROWSER==='webkit';const browser=await (useWebKit?webkit:chromium).launch({headless:true,...(!useWebKit&&process.platform==='darwin'?{channel:'chrome'}:{})});try{
 const overview=await fixtures(browser),samples=[];
 for(let trial=1;trial<=reps;trial++)for(const app of items.filter(x=>!process.env.BENCH_APP||x===process.env.BENCH_APP))for(const variant of (trial%2?['baseline','candidate']:['candidate','baseline'])){
   const out=await scenario(browser,variant==='baseline'?base:root,variant,app,overview,trial,trial===1&&variant==='candidate');samples.push(...out);console.error('done',app,variant,trial);
 }
 const median=arr=>{const n=arr.filter(Number.isFinite).sort((a,b)=>a-b);return n.length?n[Math.floor(n.length/2)]:null};
 const aggregated=[];for(const key of new Set(samples.map(x=>[x.variant,x.app,x.phase].join('/')))){const s=samples.filter(x=>[x.variant,x.app,x.phase].join('/')===key);
 const med=Object.fromEntries(['usableMs','cacheSummaryMs','verifiedResponseMs','calls','tx','rx','dataRx'].map(k=>[k,median(s.map(x=>x[k]))]));
 aggregated.push({key,...med,dataHint:s[0].dataHint,opCounts:s[0].opCounts})}
 console.log(JSON.stringify({browser:browser.version(),fixture:'48 synthetic bookings; demo monthly workbook; local HTML/assets; mock network; no production reads/writes',
 definitions:'App cold = fresh browser context with seeded login; app repeat = Refresh or reenter bookings; reopen = reload with same origin storage. Daily calendar/detail cold = first click from an already logged-in monthly report, repeat = return, refresh calendar, click same day. usableMs records first visible rows/cells, even if legacy cached; verifiedResponseMs is separate current response. For repeat already-visible DOM is excluded until fresh response. Bytes are uncompressed request/response bodies, excluding TLS, headers, static assets; call count includes all intercepted backend calls through 450ms after both DOM+response. Simulated delay and bandwidth are per request, not shared. No real backend or true device-to-device sync timing.',delayMsPerRequest:delay,bytesPerSecond:bps,reps,aggregated,samples},null,2));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
