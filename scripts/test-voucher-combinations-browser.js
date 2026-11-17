/* Full real page, synthetic August paper purchases; external calls are blocked. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(b);});});
let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
for(const width of [390,1280])for(const mode of ['petty','mapped','direct']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
 await page.evaluate(mode=>{
  window.comboMode=mode;document.getElementById('month').value='2026-08';state.data.monthly_report.report_date='2026-08-01';state.view='finance-workbench';state.user.can_match_expense_vouchers=true;state.user.can_manage_finance_workbench=true;isLocalPreview=()=>false;
  window.comboCalls=[];window.comboLinked=false;window.comboFail=false;window.comboLate=false;
  const report=state.data.monthly_report,target={id:'paper',target_kind:mode==='mapped'?'monthly_source':'source_petty',summary:'纸巾',transaction_date:'2026-08-05',period_month:'2026-08',amount:170.3,aggregate:mode==='mapped',source_locator:'C17',electronic_cell:{report_id:report.id}};
  const items=()=>[['a',80,'2026-08-04'],['b',90.3,'2026-08-05'],['single',170.3,'2026-08-05'],['unknown',null,null]].map(([id,amount,date])=>({id,source_voucher_id:id,original_filename:'synthetic-'+id+'.png',mime_type:'image/png',component_index:0,latest_ocr_task:{id:'task-'+id},candidate_fields:{amount,document_date:date,summary:'纸巾',document_kind:'receipt',evidence_kind:'transaction'},confirmed_target_kind:comboLinked&&['a','b'].includes(id)?target.target_kind:null,confirmed_target_id:comboLinked&&['a','b'].includes(id)?target.id:null}));
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=350;canvas.getContext('2d').fillRect(10,10,280,330);window.comboImage=canvas.toDataURL('image/png');
  api=async(op,p)=>{comboCalls.push({op,p});
   if(op==='expense_voucher_workspace')return {month:'2026-08',targets:mode==='direct'?[]:[target],items:items()};
   if(op==='cell_trace')return {report,item_category:'expense',mode:'input',target:{id:'cell-'+p.cell_address,cell_address:p.cell_address,label:'备用金 / 纸巾 / 合计',numeric_value:170.3,cell_kind:'input'},can_upload_vouchers:true,can_edit:true,evidence:mode==='direct'&&comboLinked?items().slice(0,2).map(i=>({...i,evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:combo'})):[],business_details:[]};
   if(op==='voucher_url'){if(comboLate)await new Promise(r=>window.comboRelease=r);return {url:comboImage,filename:p.voucher_id+'.png'};}
   if(op==='monthly_voucher_library'&&p.action==='list')return {items:items().map(i=>({...i,already_linked:comboLinked&&['a','b'].includes(i.id)}))};
   if(op==='expense_voucher_combination_apply'||op==='monthly_voucher_library'&&p.action==='attach_combination'){if(comboFail)throw Error('synthetic group failure');comboLinked=true;return {combination_saved:true,saved:{inserted:2}};}
   throw Error('Unexpected API/write '+op);
  };
 },mode);
 async function open(){await page.evaluate(mode=>mode==='petty'?ZysyrExpenseVoucherWorkspace.openPettyDetail('source_petty','paper'):openCellTrace(mode==='mapped'?'C17':'N33'),mode);await page.locator('[data-library-open]').click();await page.locator('[data-combination-recommend]').waitFor();}
 await open();assert.match((await page.locator('.monthly-library-item').first().innerText()),/single.*金额一致/,'single exact remains available');
 const recommended=await page.locator('[data-combination-recommend]').first().innerText();assert(recommended.includes('80.00')&&recommended.includes('90.30')&&recommended.includes('170.30'));
 if(mode==='direct'){
  await page.locator('.voucher-combinations details summary').click();await page.locator('input[aria-label="组合凭证搜索"]').fill('synthetic-a');await page.locator('[data-combination-pick="a:0"]').check();await page.locator('input[aria-label="组合凭证搜索"]').fill('synthetic-b');await page.locator('[data-combination-pick="b:0"]').check();await page.locator('[data-combination-review]').click();
 }else await page.locator('[data-combination-recommend]').first().click();
 const save=page.locator('[data-combination-save]');assert.equal(await save.isDisabled(),true,'no blind combination save');
 const cards=page.locator('[data-combination-cards] > section');assert.equal(await cards.count(),2);
 for(let i=0;i<2;i++){await cards.nth(i).locator('[data-combination-preview]').click();await cards.nth(i).locator('img').waitFor();await cards.nth(i).locator('[data-combination-attest]').check();}
 assert.equal(await save.isEnabled(),true);const amount=cards.first().locator('input[type=number]'),beforeAmount=await amount.inputValue();await amount.fill('');assert.equal(await save.isDisabled(),true);assert.match(await page.locator('[data-combination-total]').innerText(),/待核对/);
 await amount.fill(String(Number(beforeAmount)+.01));await cards.first().locator('[data-combination-attest]').check();assert.equal(await save.isDisabled(),true,'off-by-one cent cannot save');await amount.fill(beforeAmount);await cards.first().locator('[data-combination-attest]').check();
 if(mode!=='direct')assert.deepEqual(await page.locator('input[aria-label="组合凭证日期"]').evaluateAll(nodes=>nodes.map(n=>n.value).sort()),['2026-08-04','2026-08-05']);
 fs.mkdirSync(path.join(root,'artifacts/v665-acceptance'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/v665-acceptance/review-'+mode+'-'+width+'.png')});await page.evaluate(()=>comboFail=true);await save.click();await page.locator('[data-combination-status]').filter({hasText:'synthetic group failure'}).waitFor();assert.equal(await save.isEnabled(),true);
 await page.evaluate(()=>comboFail=false);await save.click();await page.waitForFunction(()=>comboLinked);await page.waitForFunction(()=>document.querySelectorAll('.voucher-file-preview').length===2);
 for(let i=0;i<2;i++){const host=page.locator('.voucher-file-preview').nth(i);await host.scrollIntoViewIfNeeded();await host.locator('img').waitFor();}
 if(mode==='petty')assert.equal(await page.locator('#monthly-inline-amount').count(),0);else assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'170.3');
 const writes=await page.evaluate(()=>comboCalls.filter(c=>c.op==='expense_voucher_combination_apply'||c.op==='monthly_voucher_library'&&c.p.action==='attach_combination'));
 assert.equal(writes.length,2);for(const w of writes){assert.equal(w.p.confirmed,true);assert.equal(w.p.items.length,2);assert.deepEqual(w.p.items.map(i=>i.amount??i.corrected_fields.amount).sort((a,b)=>a-b),[80,90.3]);if(mode!=='direct'){assert.equal(w.p.combination,true);assert.equal(w.p.mode,'manual');assert(w.p.items.every(i=>i.target_id==='paper'));}}
 assert.equal(await page.evaluate(()=>comboCalls.some(c=>/voucher_upload|monthly_cell_save|petty_cash_record|reanalyze|voucher_review/.test(c.op))),false);
 fs.mkdirSync(path.join(root,'artifacts/v665-acceptance'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/v665-acceptance/combined-'+mode+'-'+width+'.png')});
 if(mode==='petty'){
  await page.evaluate(()=>{comboLinked=false;return ZysyrExpenseVoucherWorkspace.openPettyDetail('source_petty','paper');});await page.locator('[data-library-open]').click();await page.locator('[data-combination-recommend]').first().click();await page.evaluate(()=>comboLate=true);await page.locator('[data-combination-preview]').first().click();await page.waitForFunction(()=>!!window.comboRelease);await page.evaluate(()=>{document.getElementById('month').value='2026-09';comboRelease();});await page.waitForTimeout(40);assert.equal(await page.locator('[data-combination-save]').isDisabled(),true,'stale preview cannot authorize another month');
 }
 assert.deepEqual(errors,[]);await page.close();
}
console.log('Combination browser 390/1280: petty/mapped/direct libraries, single exact plus 80+90.30=170.30, manual search selection, every-image preview/attestation, cent mismatch/unknown guards, atomic request/retry, both originals/readback, retained amount and stale-month rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
