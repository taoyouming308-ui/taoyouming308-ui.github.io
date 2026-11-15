/* Synthetic monthly petty total -> detail sheet -> exact receipt; no production access. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(bytes);});});
let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
 await page.evaluate(()=>{
  const report=state.data.monthly_report;document.getElementById('month').value='2026-07';report.display_data.cells.push({cell_address:'C46',label:'其它 / 备用金 / Nov.'});
  state.user.can_match_expense_vouchers=true;state.user.can_manage_finance_workbench=true;window.pettyCalls=[];window.linkedB=false;
  const targets=[{id:'total',target_kind:'monthly_source',summary:'备用金',amount:151,aggregate:true,source_locator:'C46',electronic_cell:{report_id:report.id}},
   {id:'row-a',target_kind:'source_petty',summary:'测试明细甲',transaction_date:'2026-07-05',amount:50,aggregate:false},
   {id:'row-b',target_kind:'draft',summary:'测试明细乙',transaction_date:'2026-07-06',amount:51,aggregate:false},{id:'row-h',target_kind:'history',summary:'历史测试明细',transaction_date:'2026-07-07',amount:20,aggregate:false},{id:'row-f',target_kind:'formal',summary:'正式测试明细',transaction_date:'2026-07-08',amount:30,aggregate:false}];
  const item=(id,amount,date,kind,target)=>({id,source_voucher_id:id,original_filename:id+'.png',mime_type:'image/png',latest_ocr_task:{id:'task-'+id},component_index:0,
    candidate_fields:{amount,document_date:date},confirmed_target_kind:kind,confirmed_target_id:target});
  const canvas=document.createElement('canvas');canvas.width=350;canvas.height=400;canvas.getContext('2d').fillRect(10,10,300,350);window.pettyImage=canvas.toDataURL('image/png');
  isLocalPreview=()=>false;
  api=async(op,p)=>{pettyCalls.push({op,p});
   if(op==='finance_workbench')return {categories:[],approved_vouchers:[],permissions:{}};
   if(op==='petty_cash_report')return {records:[{id:'row-f',transaction_date:'2026-07-08',amount:30,direction:'outflow',status:'confirmed',summary:'正式测试明细'}],voucher_links:[{voucher_id:'legacy-f',business_type:'petty_cash_record',business_id:'row-f'}],vouchers:[{id:'legacy-f',original_filename:'legacy-f.png',mime_type:'image/png'}],history_records:[{id:'row-h',import_row_id:'import-h',transaction_date:'2026-07-07',amount:20,direction:'outflow',summary:'历史测试明细'}],history_evidence_links:[{evidence_id:'legacy-h',import_row_id:'import-h',source_locator:'word/media/image1.png',link_level:'page_confirmed'},{evidence_id:'legacy-bundle',import_row_id:'import-h',link_level:'bundle_only'}],history_evidence:[{id:'legacy-h',original_filename:'历史原件.docx'},{id:'legacy-bundle',original_filename:'整月留底.docx'}],permissions:{batch_voucher:true}};
   if(op==='cell_trace'&&p.cell_address==='C12'){await new Promise(r=>window.releaseOldTrace=r);return {report,item_category:'expense',mode:'input',target:{id:'cell-old',cell_address:'C12',numeric_value:300,label:'迟到的旧金额'},evidence:[]};}
   if(op==='cell_trace')return {report,item_category:'expense',mode:'formula',target:{id:'cell-total',cell_address:'C46',numeric_value:151,label:'备用金'},evidence:[]};
   if(op==='expense_voucher_workspace')return {month:'2026-07',summary:{total:4,recognizing:0},source_selection:{sha256:'a'.repeat(64)},targets,items:[item('receipt-a',50,'2026-07-05','source_petty','row-a'),item('near',50.99,'2026-07-06',null,null),item('receipt-b',51,'2026-07-06',linkedB?'draft':null,linkedB?'row-b':null),item('month-bundle',151,null,'monthly_source','total')]};
   if(op==='history_evidence_images'){if(p.evidence_id!=='legacy-h')throw Error('Wrong historical evidence');return {images:[{filename:'image1.png',data_url:pettyImage}],image_manifest:['image1.png']};}
   if(op==='voucher_url')return {url:pettyImage,filename:p.voucher_id+'.png'};
   if(op==='expense_voucher_match_apply'){assertPayload(p);linkedB=true;return {saved:{inserted:1}};}
   throw Error('Unexpected production operation '+op);
  };
  function assertPayload(p){if(p.mode!=='manual'||p.items.length!==1||p.items[0].target_kind!=='draft'||p.items[0].target_id!=='row-b'||p.items[0].voucher_id!=='receipt-b')throw Error('Wrong detail association');}
 });
 await page.evaluate(()=>openMonthlyVoucher('C46'));await page.locator('#petty-detail-sheet tbody tr').first().waitFor();
 assert.equal(await page.evaluate(()=>state.view),'finance-workbench');assert.equal(await page.locator('#view-cell-trace').getAttribute('aria-hidden'),'true');
 await page.waitForFunction(()=>ZysyrPettyCashEvidenceReady===true);await page.evaluate(()=>renderFinanceWorkbench());
 await page.locator('#petty-detail-sheet tbody tr').first().waitFor();
 assert.equal(await page.locator('#petty-detail-sheet tbody tr').count(),4,'cached finance redraw preserves the detail sheet; total is not a detail');assert.match(await page.locator('#petty-detail-sheet').innerText(),/整月.*汇总/);
 assert.equal(await page.evaluate(()=>pettyCalls.some(c=>c.op==='voucher_url')),false,'clicking total opens the sheet, not images');
 await page.locator('[data-petty-detail-open="0"]').click();await page.locator('.voucher-file-preview img').waitFor();
 assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='voucher_url').at(-1).p.voucher_id),'receipt-a','only the selected detail receipt opens');
 assert.equal(await page.locator('#monthly-inline-amount').count(),0,'detail viewer never edits monthly or petty amounts');
 await page.locator('#cell-trace-back').click();await page.locator('[data-petty-detail-open="1"]').click();await page.locator('[data-library-open]').click();
 assert.match(await page.locator('.monthly-library-item').first().innerText(),/^receipt-b.*金额一致/,'recommendations use this detail amount, not total');
 await page.locator('.monthly-library-item').first().click();await page.locator('[data-library-preview] img').waitFor();
 assert.equal(await page.locator('[data-library-kind] option[value="monthly_summary"]').count(),0,'month evidence cannot be forced onto one detail');
 await page.locator('[data-library-confirm]').click();assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='expense_voucher_match_apply').length),0);
 await page.locator('[data-library-attest]').check();await page.locator('[data-library-confirm]').click();await page.locator('.voucher-file-preview img').waitFor();
 const write=await page.evaluate(()=>pettyCalls.find(c=>c.op==='expense_voucher_match_apply').p);assert.equal(write.items[0].corrected_fields.amount,'51');assert.equal(write.items[0].corrected_fields.document_date,'2026-07-06');
 assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='voucher_url').at(-1).p.voucher_id),'receipt-b');assert.match(await page.locator('#petty-detail-sheet tbody tr').nth(1).innerText(),/51.*未入账.*查看本笔凭证/s);
 await page.locator('#cell-trace-back').click();
 assert.match(await page.locator('[data-petty-detail-open="2"]').innerText(),/查看本笔凭证（1）/,'historical exact page retained; bundle excluded');
 await page.locator('[data-petty-detail-open="2"]').click();await page.locator('.voucher-file-preview img').waitFor();assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='history_evidence_images').at(-1).p.evidence_id),'legacy-h');
 await page.locator('#cell-trace-back').click();await page.locator('[data-petty-detail-open="3"]').click();await page.locator('.voucher-file-preview img').waitFor();assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='voucher_url').at(-1).p.voucher_id),'legacy-f','formal originals outside batch retained');
 await page.locator('#cell-trace-back').click();await page.evaluate(()=>openCellTrace('C46'));await page.waitForFunction(()=>document.getElementById('view-cell-trace').classList.contains('hidden'));
 assert.equal(await page.evaluate(()=>state.view),'finance-workbench','direct/badge routes also use the detail sheet');
 await page.evaluate(()=>{window.oldTracePromise=openCellTrace('C12');});await page.waitForFunction(()=>typeof releaseOldTrace==='function');
 await page.evaluate(()=>closeMonthlyWorkbench());await page.locator('[data-petty-detail-open="0"]').click();await page.locator('.voucher-file-preview img').waitFor();
 await page.evaluate(async()=>{releaseOldTrace();await oldTracePromise;});assert.match(await page.locator('#cell-trace-body').innerText(),/测试明细甲/);assert.doesNotMatch(await page.locator('#cell-trace-body').innerText(),/迟到的旧金额/,'closed root request cannot overwrite the selected detail');
 await page.locator('#cell-trace-back').click();
 const auto=await page.evaluate(async()=>{const data=await api('expense_voucher_workspace',{});data.items=[{id:'aggregate-auto',match:{auto_eligible:true,target_kind:'monthly_source',target_id:'total'}}];return ZysyrExpenseVoucherWorkspace.autoMatch(data,{},()=>true,()=>false,true);});assert.equal(auto,0,'petty total is never an auto association target');
 assert.equal(await page.evaluate(()=>ZysyrExpenseVoucherWorkspace.options([{id:'total',target_kind:'monthly_source',summary:'备用金'}],'',[]).includes('monthly_source:total')),false);
 assert.equal(await page.evaluate(()=>pettyCalls.filter(c=>c.op==='expense_voucher_match_apply').length),1);
 assert.equal(await page.evaluate(()=>pettyCalls.some(c=>/voucher_review|reanalyze|monthly_cell_save|petty_cash_record|batch_confirm/.test(c.op))),false);
 assert.deepEqual(errors,[]);await page.close();
}
console.log('Petty hierarchy 390/1280: total opens detail sheet; exact per-row originals, detail amount recommendations, explicit one-row association, preserved monthly/financial data and aggregate exclusion passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
