'use strict';
// Browser rendering with isolated source responses only. No production requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');let browser;
(async()=>{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 await page.setContent('<style>.hidden{display:none}</style><div id="app"><select id="store-select"><option>A</option><option>B</option></select><input id="month" value="2026-07"><section id="view-monthly"></section><section id="view-finance-workbench"></section></div>');
 await page.evaluate(()=>{
  window.state={user:{role:'finance',can_manage_finance_workbench:true},monthlyOverviewReady:true};window.currentStore=()=>document.getElementById('store-select').value;
  window.renderAll=()=>{};window.isLocalPreview=()=>false;window.calls=[];window.mode='ok';window.openPrivate=(op,p)=>calls.push({op,...p});
  window.api=async(op,p)=>{calls.push({op,...p});if(op!=='report_source_review')throw Error('unexpected operation');if(mode==='hold')await new Promise(r=>window.release=r);if(mode==='error')throw Error('读取失败');return{kind:p.kind,month:p.month,status:mode==='conflict'?'conflict':'ready',message:mode==='conflict'?'来源版本冲突':null,financial_records_unchanged:true,
   source:{filename:'synthetic.xlsx',worksheet_name:p.month.slice(-2)+'月 ',sha256:'a'.repeat(64)},
   monthly:{column_count:3,rows:[{row:1,cells:[{column:1,address:'A1',value:'<script>source</script>'},{column:3,address:'C1',value:0}]},{row:2,cells:[{column:3,address:'C2',value:null,formula:'SUM(C1)'}]}],expense_rows:[{row:9,cells:[{column:1,address:'A9',value:'小计'},{column:2,address:'B9',value:null},{column:3,address:'C9',value:123.45}]}]},
   expenses:Array.from({length:{'2026-07':16,'2026-08':23,'2026-09':30}[p.month]||0},(_,i)=>({id:String(i),date:p.month+'-01',voucher_number:i===0?'8503':String(i),summary:i===0?'<img src=x onerror=alert(1)>':'项目',category:'日用品',inflow:null,outflow:i===1?null:1,source_sheet:'原表',source_locator:'原表!A'+(i+3),review_status:i===0?'confirmed':i===1?'needs_correction':'pending',import_status:'pending'})),
   evidence:[{id:'synthetic-evidence',filename:'整月原件.docx'}],batches:[]};};
 });
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'operations-report-source-review.js'),'utf8')});
 assert.equal(await page.evaluate(()=>calls.length),0,'no eager requests');
 for(const month of ['2026-07','2026-08','2026-09']){
  await page.locator('#month').fill(month);await page.locator('#month').dispatchEvent('change');
  await page.locator('#report-source-review-monthly button').first().click();
  await page.locator('#report-source-review-monthly table').waitFor();
  assert.match(await page.locator('#report-source-review-monthly').innerText(),/公式无缓存值/);
  assert.equal(await page.locator('#report-source-review-monthly script').count(),0);
  await page.locator('#report-source-review-expenses button').first().click();
  assert.match(await page.locator('#report-source-review-expenses').innerText(),new RegExp('备用金来源明细 · '+({'2026-07':16,'2026-08':23,'2026-09':30}[month])+' 笔'));
  assert.match(await page.locator('#report-source-review-expenses').innerText(),/8503/);
  assert.equal(await page.locator('#report-source-review-expenses img').count(),0);
  assert.match(await page.locator('#report-source-review-expenses').innerText(),/未入账/);
  assert.match(await page.locator('#report-source-review-expenses').innerText(),/小计/);
  assert.match(await page.locator('#report-source-review-expenses').innerText(),/已确认/);
  assert.match(await page.locator('#report-source-review-expenses').innerText(),/待修正/);
  assert.doesNotMatch(await page.locator('#report-source-review-expenses').innerText(),/原表!原表!/);
  assert.equal(await page.locator('#report-source-review-expenses tbody').nth(1).locator('tr').nth(1).locator('td').nth(5).innerText(),'—');
 }
 await page.locator('[data-source-evidence]').last().click();
 assert.equal(await page.evaluate(()=>calls.at(-1).op),'history_import_file_url');
 await page.evaluate(()=>mode='hold');await page.locator('#report-source-review-monthly button').first().click();
 await page.locator('#store-select').selectOption('B');await page.evaluate(()=>release());
 await page.waitForTimeout(30);assert.equal(await page.locator('#report-source-review-monthly table').count(),0,'late response cannot cross stores');
 await page.evaluate(()=>mode='conflict');await page.locator('#report-source-review-monthly button').first().click();
 assert.match(await page.locator('#report-source-review-monthly').innerText(),/来源版本冲突/);
 await page.evaluate(()=>mode='error');await page.locator('#report-source-review-monthly button').first().click();
 assert.match(await page.locator('#report-source-review-monthly').innerText(),/来源暂时无法读取/);
 await page.evaluate(()=>{state.user=null;renderAll();});assert.equal(await page.locator('#report-source-review-monthly').isVisible(),false);
 assert.equal(await page.locator('#report-source-review-monthly [data-source-body]').innerText(),'');
 await page.evaluate(()=>{state.user={role:'shareholder',can_manage_finance_workbench:false};renderAll();});
 assert.equal(await page.locator('#report-source-review-expenses').isVisible(),false);
 assert.deepEqual(errors,[]);assert(await page.evaluate(()=>calls.every(c=>['report_source_review','history_import_file_url'].includes(c.op))));
 console.log('Source review browser passed: three months, 16/23/30 expense rows, null/zero/formula, escaping, stale scopes, conflict/failure, logout and no writes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
