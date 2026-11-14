const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width"><select id="month"><option>2026-07</option></select><div id="finance-workbench-status"></div><div id="petty-cash-report-table"></div><table><tr><td id="cell"><input value="6468.56"></td></tr></table><div id="trace-backdrop" class="hidden"><div id="trace-content"></div></div>');});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
const {buildExpenseVoucherWorkspace,expenseMatchPlan}=await import('../supabase/functions/_shared/expense-voucher-workspace.mjs');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),confidence={document_date:.99,amount:.99,expense_category:.99};
const source={status:'ready',monthly_status:'ready',source:{selection_id:id(1),source_request_id:id(2),sha256:'a'.repeat(64)},monthly:{expense_rows:[['物业费',6468.56,12],['水费',4357.14,17],['工资',120627.33,22]].map(([label,amount,row])=>({row,cells:[{column:2,value:label},{column:3,address:'C'+row,value:amount}]}))},expenses:[]};
const fields={document_kind:'receipt',document_type:'invoice',document_date:'2026-07-05',amount:6468.56,expense_category:'物业费',evidence:{document_date:'2026-07-05',amount:'6468.56',expense_category:'物业费'},recognition_schema_version:'expense-voucher-v2'};
const base={month:'2026-07',summary:{total:4},targets:[],items:[{id:id(3),original_filename:'物业凭证.png',batch_id:id(4),latest_ocr_task:{id:id(5)},field_confidences:confidence,candidate_fields:fields,task_status:'succeeded',audit_status:'pending'},
{id:id(6),original_filename:'跨月.png',batch_id:id(4),latest_ocr_task:{id:id(7)},field_confidences:confidence,candidate_fields:{...fields,document_date:'2026-08-05'},task_status:'succeeded',audit_status:'pending'},
{id:id(8),original_filename:'失败.png',batch_id:id(4),latest_ocr_task:{id:id(9),error_message:'Legacy transport failed'},candidate_fields:{},task_status:'dead_letter',audit_status:'pending'},
{id:id(30),original_filename:'旧版月度汇总.png',batch_id:id(4),latest_ocr_task:{id:id(31)},candidate_fields:{document_kind:'bank_summary',document_type:'advertising_report'},task_status:'succeeded',audit_status:'pending'}]};
let links=[],calls=[],late=false,release;
browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.exposeFunction('backend',async(operation,payload)=>{calls.push({operation,payload});
 if(operation==='expense_voucher_workspace'){if(late)await new Promise(r=>release=r);return buildExpenseVoucherWorkspace(base,source,links);}
 if(operation==='expense_voucher_match_apply'){const plan=expenseMatchPlan(buildExpenseVoucherWorkspace(base,source,links),payload.items,payload.mode);links.push(...plan.map((p,i)=>({...p,id:id(20+i),status:'active',mode:payload.mode,corrected_fields:p.corrected_fields})));return {saved:{inserted:plan.length}};}
 if(operation==='expense_voucher_failures_retry'){assert.deepEqual(payload.voucher_ids,[id(8)]);base.items[2].task_status='queued';return {queued:1};}
 if(operation==='expense_voucher_match_void'){links[0].status='void';return {status:'void'};}
 if(operation==='voucher_url')return {url:'synthetic'};
 throw Error('Unexpected '+operation);
});
await page.goto('http://127.0.0.1:'+server.address().port);
await page.evaluate(()=>{window.store='一店';window.currentStore=()=>window.store;window.state={session:'synthetic',user:{role:'finance',can_manage_finance_workbench:true,can_match_expense_vouchers:true},data:{monthly_report:{sha256:'a'.repeat(64)}},pettyCash:{data:{records:[],history_records:[],permissions:{batch_voucher:true}}}};
window.ZysyrPettyScopeIdentity=()=>state.session;window.ZysyrTime={dateTime:()=>''};window.esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.formatAmount=v=>Number(v).toFixed(2);window.isLocalPreview=()=>false;window.api=(o,p)=>window.backend(o,p);window.toast=()=>{};window.openPrivate=(o,p)=>window.backend(o,p);window.renderPettyCashReport=()=>{};window.loadPettyCashReport=async()=>{};window.prompt=()=> 'Synthetic correction';});
for(const file of ['operations-expense-voucher-workspace.js','operations-petty-cash-evidence.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
await page.evaluate(()=>renderPettyCashReport());
await page.waitForFunction(()=>document.querySelector('[data-petty-batch-item]')?.innerText.includes('AI 已匹配'));
assert.equal(calls.filter(c=>c.operation==='expense_voucher_match_apply').length,1,'normal unique evidence associates without a human click');
assert.equal(links.length,1);assert.equal(links[0].target_kind,'monthly_source');
assert.match(await page.locator('#petty-batch-list').innerText(),/跨月|其他月份/);
const options=await page.locator('[data-batch-target]').nth(1).innerText();assert.equal(await page.locator('[data-batch-target]').nth(1).locator('optgroup').first().getAttribute('label'),'月报全部开支栏目');assert.match(options,/水费/);assert.match(options,/工资/);
await page.evaluate(()=>ZysyrExpenseVoucherWorkspace.decorateMonthly({C12:document.getElementById('cell')}));
await page.waitForSelector('[data-expense-cell-vouchers]');assert.equal(await page.locator('#cell input').inputValue(),'6468.56');
await page.locator('[data-expense-cell-vouchers]').click();await page.locator('[data-expense-open]').click();
assert.equal(calls.find(c=>c.operation==='voucher_url').payload.voucher_id,id(3),'monthly cell opens the matching original');
await page.locator('[data-expense-match-change]').click();await page.waitForFunction(()=>!document.querySelector('[data-expense-match-change]'));
assert.equal(calls.filter(c=>c.operation==='expense_voucher_match_apply').length,1,'a human correction suppresses immediate auto-rematching');
await page.locator('#expense-voucher-retry-failed').click();await page.waitForFunction(()=>document.getElementById('petty-batch-list').innerText.includes('正在识别'));
assert.equal(calls.filter(c=>c.operation==='expense_voucher_failures_retry').length,1);
const monthlyCard=page.locator('[data-petty-batch-item=\"'+id(30)+'\"]');
await monthlyCard.locator('[data-batch-target]').selectOption('monthly_source:'+id(1)+'~C17');
await monthlyCard.locator('[data-batch-period]').waitFor();assert.equal(await monthlyCard.locator('[data-batch-period]').inputValue(),'','a missing year is not filled from current scope');
await monthlyCard.locator('[data-batch-period]').fill('2026-07');await monthlyCard.locator('[data-batch-amount]').fill('4357.14');
const beforeSummary=calls.filter(c=>c.operation==='expense_voucher_match_apply').length;
page.once('dialog',dialog=>dialog.dismiss());await monthlyCard.locator('[data-petty-batch-confirm]').click();
assert.equal(calls.filter(c=>c.operation==='expense_voucher_match_apply').length,beforeSummary,'declining the human month attestation cannot write');
page.once('dialog',dialog=>dialog.accept());await monthlyCard.locator('[data-petty-batch-confirm]').click();await monthlyCard.locator('[data-expense-match-change]').waitFor();
assert.equal(links.at(-1).mode,'manual');assert.equal(links.at(-1).corrected_fields.document_date,null);assert.equal(links.at(-1).corrected_fields.period_month,'2026-07');
late=true;await page.locator('#petty-batch-refresh').click();await page.waitForTimeout(50);const before=calls.filter(c=>c.operation==='expense_voucher_match_apply').length;
await page.evaluate(()=>{store='二店';document.getElementById('petty-cash-report-table').innerHTML='';});release();await page.waitForTimeout(100);
assert.equal(calls.filter(c=>c.operation==='expense_voucher_match_apply').length,before,'stale store response cannot associate evidence');
assert.equal(calls.some(c=>/petty_cash_record|voucher_review|monthly_cell_save/.test(c.operation)),false);assert.deepEqual(errors,[]);
console.log('Expense browser: all monthly options, automatic unique match, exception-only review, monthly original viewing, reversible correction, failed-only recovery, preserved amounts and stale-store write isolation passed.');
}finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
