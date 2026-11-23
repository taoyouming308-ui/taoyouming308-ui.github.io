/* Run in Chromium. All files and synthetic responses are local; no business endpoint is contacted. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),baseline=process.argv.includes('--baseline'),origin='http://127.0.0.1:48670';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!==origin||route.request().method()!=='GET')return route.abort();
    const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const relative=path.relative(root,file);
    const body=baseline&&['operations.html','operations-petty-detail-import.js','operations-petty-cash-evidence.js'].includes(relative)?cp.execFileSync('git',['show','1b70a903:'+relative],{cwd:root,maxBuffer:15000000}):fs.readFileSync(file);
    return route.fulfill({body,contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream'});
  });
  await page.goto(origin+'/operations.html?preview=1&role=finance');await page.locator('#monthly-sheet').waitFor();
  const stats=await page.evaluate(async()=>{
    window.isLocalPreview=()=>false;reportLocalDemo=false;
    window.__reads=[];window.__writes=0;
    const money={rows:Array.from({length:24},(_,i)=>({id:i,amount:i===0?null:i*123.45})),testOnly:'fixture-private-finance'};
    window.apiRequest=async(op,payload)=>{
      __reads.push(op);await new Promise(r=>setTimeout(r,45));return JSON.parse(JSON.stringify(money));
    };
    const ops=['payroll_center','salary_sheet_read','petty_cash_report','finance_workbench','report_cells','voucher_center','voucher_url','expense_voucher_workspace'];
    const before=performance.now(),results=await Promise.all(ops.flatMap(op=>Array.from({length:4},()=>api(op,{store:'测试店',month:'2026-09'}))));
    if(results.some(v=>JSON.stringify(v)!==JSON.stringify(money)))throw Error('wrong read');
    return {endpoints:ops.length,calls:__reads.length,responseBytes:__reads.length*new TextEncoder().encode(JSON.stringify(money)).length,concurrentMs:Math.round(performance.now()-before)};
  });
  assert.equal(stats.calls,baseline?32:8);console.log(baseline?'before':'after',JSON.stringify(stats));
  if(baseline)return;
  await page.evaluate(async()=>{
    function check(v,label){if(!v)throw Error(label)}
    // Repeated confirmed reads are fresh; independent requests remain separated by scope, permissions and mutation.
    const p={store:'测试店',month:'2026-09'};__reads=[];
    await api('salary_sheet_read',p);await api('salary_sheet_read',p);check(__reads.length===2,'no settled response cache');
    __reads=[];const a=api('voucher_center',p);state.user={...state.user,can_upload_reports:!state.user.can_upload_reports};
    await Promise.all([a,api('voucher_center',p),api('voucher_center',{...p,month:'2026-10'})]);check(__reads.length===3,'roles and months isolated');
    __reads=[];await Promise.all([api('salary_sheet_read',p),api('synthetic_save',{}),api('synthetic_save',{}),api('salary_sheet_read',p)]);
    check(__reads.length===4,'each write sent; no shared read across write');
    const pending=[];window.apiRequest=(op,payload)=>new Promise((resolve,reject)=>pending.push({op,payload,resolve,reject}));
    function take(op){const i=pending.findIndex(item=>item.op===op);check(i!==-1,'no deferred '+op);return pending.splice(i,1)[0]}
    const tick=()=>new Promise(r=>setTimeout(r,0));
    function row(id){return {id,original_filename:id+'.jpg',document_type:'payment',audit_status:'pending',ocr_status:'ready',mime_type:'image/jpeg'}}
    const month=document.getElementById('month');state.view='upload';month.value='2026-09';
    const one=loadVoucherCenter();await tick();const old=take('voucher_center');month.value='2026-10';
    const two=loadVoucherCenter();await tick();take('voucher_center').resolve({vouchers:[row('October')]});await two;
    old.resolve({vouchers:[row('September')]});await one;
    check(state.vouchers.data.vouchers[0].id==='October'&&!document.getElementById('voucher-list').textContent.includes('September'),'late voucher month');
    const rev=loadVoucherCenter();await tick();state.user={...state.user,role:'other'};take('voucher_center').reject(Error('late previous role'));await rev;
    check(!document.getElementById('voucher-status').textContent.includes('late previous role'),'stale role error');
    const current=loadVoucherCenter();await tick();check(!document.getElementById('voucher-list').textContent.includes('October'),'previous role cleared before reading');take('voucher_center').resolve({vouchers:[]});await current;
    const va=openVoucherReview(row('A'));await tick();const previous=take('voucher_url');
    const vb=openVoucherReview(row('B'));await tick();const next=take('voucher_url');
    next.resolve({url:'about:blank#B'});await vb;previous.resolve({url:'about:blank#A'});await va;
    check(document.querySelector('#voucher-preview img').getAttribute('src')==='about:blank#B','stale original replaced current');
    const vc=openVoucherReview(row('C'));await tick();closeVoucherReview();take('voucher_url').reject(Error('closed original'));await vc;
    check(!document.querySelector('#voucher-preview').textContent,'closed preview repopulated');
    state.view='salary-report';state.user={...state.user,role:'finance'};const s=loadSalaryReport();await tick();
    document.getElementById('salary-report-table').textContent='UNSAVED-test';markSalarySheetDirty();
    take('payroll_center').resolve({employees:[]});take('salary_sheet_read').resolve({rows:[]});await s;
    check(state.salarySheet.dirty&&document.getElementById('salary-report-table').textContent==='UNSAVED-test','salary edit erased');
    const unchanged=await loadSalaryReport();check(!pending.length,'dirty salary unexpectedly read');
    state.salarySheet.dirty=false;const offline=loadSalaryReport();await tick();take('payroll_center').reject(Error('synthetic offline'));take('salary_sheet_read').resolve({});await offline;
    check(document.getElementById('salary-report-status').textContent.includes('offline'),'no offline feedback');
    const recovered=loadSalaryReport();await tick();take('payroll_center').resolve({employees:[]});take('salary_sheet_read').resolve({rows:[],marker:'recovered'});await recovered;
    check(state.salarySheet.data.marker==='recovered','online retry failed');
    state.view='finance-workbench';prepareSecondaryScope('petty',secondaryScope());state.user.can_manage_finance_workbench=true;state.pettyCash.data={records:[],opening_balance:10};
    renderPettyCashReport();const ledger=document.getElementById('ledger-summary');ledger.value='未提交备用金说明';ledger.dispatchEvent(new Event('input',{bubbles:true}));
    renderPettyCashReport();check(document.getElementById('ledger-summary').value==='未提交备用金说明','petty input erased');
    month.value='2026-11';prepareSecondaryScope('petty',secondaryScope());renderPettyCashReport();check(document.getElementById('ledger-summary').value==='','petty input leaked across months');
    // Static payroll input values must stay only within a single authorized scope, not just the dynamic selects.
    state.view='payroll';prepareSecondaryScope('payroll',secondaryScope());
    const originalMonth=month.value,amount=document.getElementById('salary-base'),reason=document.getElementById('salary-reason');
    const fixed=document.getElementById('attendance-type');check(fixed.options.length>2,'fixed enums lost');
    amount.value='1234';reason.value='fixture private edit';reason.dispatchEvent(new Event('input',{bubbles:true}));
    const ref=loadPayroll();await tick();take('payroll_center').resolve({permissions:{write:true},employees:[],salary_reports:[]});await ref;
    check(amount.value==='1234'&&reason.value==='fixture private edit','payroll edit lost on same-scope refresh');
    const alternate=Array.from(month.options).find(o=>o.value&&o.value!==originalMonth).value;
    window.confirm=()=>false;month.value=alternate;month.dispatchEvent(new Event('change',{bubbles:true}));
    check(month.value===originalMonth&&reason.value==='fixture private edit','cancelled switch lost draft');
    window.confirm=()=>true;month.value=alternate;month.dispatchEvent(new Event('change',{bubbles:true}));await tick();
    check(month.value===alternate&&reason.value===''&&amount.value==='0'&&fixed.options.length>2,'new month leaked draft or deleted static choices');
    take('payroll_center').resolve({permissions:{write:true},employees:[],salary_reports:[]});await tick();
    reason.value='second private edit';reason.dispatchEvent(new Event('input',{bubbles:true}));
    window.confirm=()=>{throw Error('revocation must not prompt')};blockReportTab('模拟撤权');
    check(!reason.value&&amount.value==='0'&&document.documentElement.classList.contains('report-scope-invalid'),'revoked form still visible');
    await tick();
    const storage=[...Object.values(localStorage),...Object.values(sessionStorage)].join(' ');check(!/fixture-private-finance|未提交备用金说明|UNSAVED-test|October.jpg/.test(storage),'sensitive data entered browser storage');
    check(!pending.some(x=>!/^(expense_voucher_workspace|petty_cash_batch_status)$/.test(x.op)),'an unintended write or read');
  });
  assert.deepEqual(errors,[]);console.log('PASS: role/month races, signed originals, close before response, salary and petty drafts, offline recovery, no private browser storage.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
