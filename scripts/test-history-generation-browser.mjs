// Isolated real Chromium DOM test. No production app startup, credentials, or network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const launchOptions={headless:true};
if(process.env.CHROMIUM_EXECUTABLE)launchOptions.executablePath=process.env.CHROMIUM_EXECUTABLE;
const browser=await chromium.launch(launchOptions);
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',offline:true});
const requests=[];await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
const source=fs.readFileSync('operations.html','utf8');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('');
await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+styles+'<main class="content"><div id="history-import-summary"></div><div id="history-import-status"></div></main>');
await page.evaluate(()=>{
 window.$=id=>document.getElementById(id);window.esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.currentStore=()=> 'synthetic-store';window.toast=message=>window.lastToast=message;
 if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> 'test-'+Math.random()});
 window.state={view:'history-import',user:{can_adjust_confirmed_finance:true},historyImport:{selectedBatchId:'batch',data:{reparse_generation:{id:'gen',version:1},generationFinance:{active_generation:{id:'gen',version:1},state_fingerprint:'fp',finance:{issue_digest:'issues',reviewed_count:0,posted_count:0}},batches:[{id:'batch',import_type:'monthly_profit_loss',reason:'synthetic',source_warnings:[{message:'业务差异保留'}]}],rows:[{id:'row',source_locator:'7月!B2',mapped_json:{period_month:'2026-07-01',amount:10},validation_status:'warning',validation_issues:[{message:'待核对来源'}]}],original_rows:[{source_locator:'7月!B2',mapped_json:{amount:10}},{source_locator:'7月!C2',mapped_json:{amount:10}}],ledger_entries:[]}}};
 window.renderHistoryImport=()=>{$('history-import-summary').innerHTML=''};window.loadHistoryImport=async()=>{renderHistoryImport()};window.calls=[];
 window.api=async(op,p)=>{calls.push({op,p});await new Promise(r=>setTimeout(r,80));const data=state.historyImport.data,finance=data.generationFinance.finance;
 if(op.endsWith('_review')){finance.reviewed_count=1;finance.review_fingerprint='review'}
 if(op.endsWith('_confirm'))finance.confirmation_id='confirm';
 if(op.endsWith('_post')){finance.posted_count=1;data.ledger_entries=[{id:'entry',version:1,generation_id:'gen',generation_version:1,status:'posted',posted_payload:{period_month:'2026-07-01',amount:10},current_payload:{period_month:'2026-07-01',amount:10}}]}
 if(op.endsWith('_reverse'))return {status:'committed',action:'reverse',request_id:p.request_id,generation_id:p.generation_id,generation_version:p.generation_version,ledger_entry_id:p.ledger_entry_id,previous_ledger_version:p.expected_ledger_version,ledger_version:p.expected_ledger_version+1,formal_ledger_changed:true};
 if(op.endsWith('_revise'))return {status:'committed',request_id:'wrong'};
 if(op.endsWith('_request_status'))return {status:'not_found'};
 return {status:'committed'};
 };
});
const start=source.indexOf('  function historyGenerationSummary('),end=source.indexOf('  var openHistoryCorrectionBeforeFormalLedger=',start);
const labelStart=source.indexOf('  function historyFieldLabel('),labelEnd=source.indexOf('\n',labelStart);
await page.addScriptTag({content:source.slice(labelStart,labelEnd)+'\n'+source.slice(start,end)+'\nrenderHistoryImport();'});
try{
 await page.locator('#history-generation-scope').check();await page.locator('#history-generation-reason').fill('synthetic review');await page.locator('#history-generation-review').click();await page.waitForFunction(()=>document.querySelector('#history-generation-confirm')?.disabled===false);
 assert.equal(await page.locator('#history-generation-scope').isChecked(),false);
 await page.locator('#history-generation-scope').check();await page.locator('#history-generation-reason').fill('synthetic confirm');await page.locator('#history-generation-confirm').click();await page.waitForFunction(()=>document.querySelector('#history-generation-post')?.disabled===false);
 await page.locator('#history-generation-scope').check();await page.locator('#history-generation-reason').fill('synthetic post');await page.locator('#history-generation-post').click();await page.waitForSelector('#generation-ledger-entry');
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.op)),['history_import_generation_review','history_import_generation_confirm','history_import_generation_post']);
 await page.locator('#generation-ledger-entry summary').click();await page.locator('#generation-ledger-reason-entry').fill('synthetic amend');await page.locator('[data-generation-field="amount"]').fill('');await page.locator('[data-generation-revise]').click();assert.equal(await page.evaluate(()=>calls.length),3);assert.match(await page.evaluate(()=>lastToast),/空白/);
 await page.locator('[data-generation-field="amount"]').fill('0');await page.locator('[data-generation-revise]').evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>document.querySelector('#history-generation-query')?.disabled===false);assert.equal(await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_revise')).length),1);assert.equal(await page.evaluate(()=>calls.at(-1).p.current_payload.amount),0);
 await page.locator('#history-generation-query').click();await page.waitForFunction(()=>lastToast.includes('暂未找到'));assert.equal(await page.locator('#history-generation-post').isDisabled(),true);
 // Exercise source-provenance presentation using synthetic salary metadata.
 await page.evaluate(()=>{const d=state.historyImport.data;d.batches[0].import_type='salary';const salary={period_month:'2026-07-01',employee_name:'合成员工',employee_id:'employee',position:'岗位',notes:null};historyGenerationLedgerFields('salary').forEach(f=>{if(!(f in salary))salary[f]=0});salary.base_salary=1000;salary.gross_pay=1000;salary.net_pay=1000;salary.shooting_deduction=null;salary.leave_deduction=null;salary._source_provenance={synthetic:true};d.ledger_entries[0].posted_payload=JSON.parse(JSON.stringify(salary));d.ledger_entries[0].current_payload=JSON.parse(JSON.stringify(salary));d.rows[0].mapped_json=JSON.parse(JSON.stringify(salary));d.source_provenance={status:'verified',fields:[{import_row_id:'row',field:'shooting_deduction',status:'missing_column',legacy_value:0},{import_row_id:'row',field:'leave_deduction',status:'blank',source_locator:'7月!N25',legacy_value:0},{import_row_id:'row',field:'gross_pay',status:'source_value',legacy_value:10}]};renderHistoryImport()});
 assert.match(await page.locator('#history-source-provenance').innerText(),/原表未提供此列/);assert.match(await page.locator('#history-source-provenance').innerText(),/原表单元格空白/);
 assert.equal(await page.locator('#history-source-provenance details').evaluate(el=>el.open),false);
 await page.locator('#generation-ledger-entry summary').click();assert.equal(await page.locator('#generation-ledger-reverse-check-entry').isChecked(),false);
 const checkbox=await page.locator('#generation-ledger-reverse-check-entry').boundingBox();assert.ok(checkbox.width>0&&checkbox.x>=0&&checkbox.x+checkbox.width<=390);
 await page.screenshot({path:'/tmp/history-generation-browser-390.png',fullPage:true});
 await page.evaluate(()=>{state.historyImport.selectedBatchId='batch2';state.historyImport.data.batches[0].id='batch2';state.historyImport.data.batches[0].import_type='salary';renderHistoryImport()});
 await page.locator('#generation-ledger-entry summary').click();await page.locator('[data-generation-field="base_salary"]').fill('1100');await page.locator('[data-generation-field="notes"]').fill('保留未知金额');await page.locator('#generation-ledger-reason-entry').fill('synthetic salary amendment');await page.locator('[data-generation-revise]').click();await page.waitForFunction(()=>calls.at(-1).op.endsWith('_revise'));
 const salaryPayload=await page.evaluate(()=>calls.at(-1).p.current_payload);assert.equal(salaryPayload.shooting_deduction,null);assert.equal(salaryPayload.leave_deduction,null);assert.equal(salaryPayload.base_salary,1100);assert.equal(salaryPayload.notes,'保留未知金额');
 await page.waitForFunction(()=>document.querySelector('#history-generation-query')?.disabled===false);
 await page.evaluate(()=>{state.historyImport.selectedBatchId='batch3';state.historyImport.data.batches[0].id='batch3';renderHistoryImport()});
 await page.locator('#generation-ledger-entry summary').click();await page.locator('#generation-ledger-reason-entry').fill('synthetic reverse');
 await page.screenshot({path:'/tmp/history-generation-browser-salary-390.png',fullPage:true});
 const beforeReverse=await page.evaluate(()=>calls.length);await page.locator('[data-generation-reverse]').click();assert.equal(await page.evaluate(()=>calls.length),beforeReverse);
 await page.locator('#generation-ledger-reverse-check-entry').check();await page.locator('[data-generation-reverse]').click();await page.waitForFunction(()=>calls.at(-1).op.endsWith('_reverse'));assert.equal(await page.evaluate(()=>calls.at(-1).p.confirm_reverse),true);
 assert.deepEqual(requests,[]);console.log('real Chromium isolated DOM passed: three separate steps, missing provenance, ledger expand, blank/zero, double-click, mismatched response lock, not-found query, 390px reverse checkbox. No network or user session. Screenshot /tmp/history-generation-browser-390.png');
}finally{await context.close();await browser.close()}
