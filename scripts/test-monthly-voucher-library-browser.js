/* Synthetic monthly click-to-image and library-link acceptance; no external access. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(bytes);});});
let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
browser=await chromium.launch({channel:'chrome',headless:true});
for(const width of [390,1280]){
 fs.mkdirSync(path.join(root,'artifacts/v661-acceptance'),{recursive:true});
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
 await page.evaluate(()=>{
  const report=state.data.monthly_report;document.getElementById('month').value='2026-07';
  state.user.can_match_expense_vouchers=true;state.user.can_manage_finance_workbench=true;
  window.libraryCalls=[];window.libraryLinked=false;window.libraryLate=false;window.libraryFail=false;window.librarySaved=true;
  const target=address=>({id:'selection~'+address,target_kind:'monthly_source',source_locator:address,summary:address==='C12'?'物业费':'水费',amount:address==='C12'?1648.27:318.42,aggregate:true,electronic_cell:{report_id:report.id}});
  const item=(id,amount,date,linked)=>({id,source_voucher_id:id,original_filename:id+'.png',mime_type:'image/png',component_index:0,latest_ocr_task:{id:'task-'+id},task_status:'succeeded',candidate_fields:{amount,document_date:date,counterparty:'测试商户'},confirmed_target_kind:linked?'monthly_source':null,confirmed_target_id:linked?'selection~C12':null});
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=500;const ctx=canvas.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,400,500);ctx.fillStyle='#222';ctx.font='30px sans-serif';ctx.fillText('Synthetic receipt',20,50);window.libraryImage=canvas.toDataURL('image/png');
  isLocalPreview=()=>false;
  api=async(op,p)=>{libraryCalls.push({op,p});
   if(op==='cell_trace')return {report,target:{id:'cell-'+p.cell_address,cell_address:p.cell_address,label:target(p.cell_address).summary,numeric_value:target(p.cell_address).amount,cell_kind:'input'},mode:'input',item_category:'expense',can_edit:true,can_upload_vouchers:true,evidence:[],business_details:[]};
   if(op==='expense_voucher_workspace'){
    if(libraryLate)await new Promise(r=>window.libraryRelease=r);
    if(libraryFail)throw Error('synthetic read failure');
    const second=item('unmatched',318.42,null,false);if(libraryLinked){second.confirmed_target_id='selection~C17';second.confirmed_target_kind='monthly_source';}
    return {month:'2026-07',source_selection:{sha256:'a'.repeat(64)},targets:[target('C12'),target('C17')],items:[item('existing',1648.27,'2026-07-05',true),item('unknown',null,null,false),item('far',200,null,false),item('near-high',318.43,null,false),second,item('near-low',318.40,null,false),item('corrected',10,null,false),item('other',50,'2026-08-05',false)].map(row=>row.id==='corrected'?{...row,corrected_fields:{amount:318.42},confirmed_target_id:'selection~other'}:row)};
   }
   if(op==='voucher_url')return {url:libraryImage,filename:p.voucher_id+'.png'};
   if(op==='expense_voucher_match_apply'){if(librarySaved)libraryLinked=true;return {saved:{inserted:librarySaved?1:0}};}
   throw Error('Unexpected API/write '+op);
  };
 });
 await page.evaluate(()=>openCellTrace('C12'));
 await page.locator('.monthly-voucher-preview img').waitFor();
 assert.equal(await page.locator('.monthly-voucher-preview img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 assert.equal(await page.locator('[data-expense-open]').count(),0,'images do not require an intermediate filename click');
 assert.equal(await page.locator('.monthly-voucher-preview').evaluate(el=>el.getBoundingClientRect().top<document.querySelector('.monthly-simple-workbench').getBoundingClientRect().top),true,'originals appear before amount controls');
 assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'1648.27');
 await page.screenshot({path:path.join(root,'artifacts/v661-acceptance/original-'+width+'.png')});
 await page.locator('[data-library-open]').click();await page.locator('[data-library-search]').fill('existing');await page.locator('.monthly-library-item').click();
 assert.equal(await page.locator('[data-library-confirm]').count(),0,'existing associations are read-only');
 await page.evaluate(()=>openCellTrace('C17'));
 await page.locator('[data-library-open]').click();
 const recommendations=await page.locator('.monthly-library-item').allTextContents();
 assert.match(recommendations[0],/^unmatched.*金额一致/);assert.match(recommendations[1],/^corrected.*金额一致.*已关联/,'manual corrected amount is used for recommendation without changing association');
 assert.match(recommendations[2],/^near-high.*相差 0.01/);assert.match(recommendations[3],/^near-low.*相差 0.02/);assert.match(recommendations.at(-1),/^unknown/,'unknown is never treated as zero');
 await page.locator('[data-library-search]').fill('near');assert.deepEqual((await page.locator('.monthly-library-item').allTextContents()).map(t=>t.split('.')[0]),['near-high','near-low'],'search preserves amount-distance order');
 await page.locator('[data-library-search]').fill('unmatched');await page.locator('.monthly-library-item').click();
 await page.locator('[data-library-preview] img').waitFor();
 assert.equal(await page.locator('[data-library-date]').inputValue(),'');assert.equal(await page.locator('[data-library-month]').inputValue(),'','unknown dates/months remain blank');
 await page.locator('[data-library-confirm]').click();assert.equal(await page.evaluate(()=>libraryCalls.filter(c=>c.op==='expense_voucher_match_apply').length),0,'opening and selecting are read-only; confirmation attestation required');
 await page.locator('[data-library-kind]').selectOption('monthly_summary');await page.locator('[data-library-month]').fill('2026-07');await page.locator('[data-library-attest]').check();
 await page.evaluate(()=>{librarySaved=false;});await page.locator('[data-library-confirm]').click();await page.locator('[data-library-status]').filter({hasText:'关联未新增'}).waitFor();
 await page.evaluate(()=>{librarySaved=true;});await page.locator('[data-library-confirm]').click();await page.locator('.voucher-file-preview img').waitFor();
 const write=await page.evaluate(()=>libraryCalls.filter(c=>c.op==='expense_voucher_match_apply').at(-1));assert.equal(write.p.items[0].target_id,'selection~C17');assert.equal(write.p.items[0].corrected_fields.document_date,null);assert.equal(write.p.mode,'manual');
 assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'318.42','linking must preserve the report amount');
 await page.evaluate(()=>{libraryLate=true;window.libraryOpening=openCellTrace('C17');});await page.waitForFunction(()=>typeof libraryRelease==='function');
 await page.evaluate(()=>{document.getElementById('month').value='2026-08';libraryRelease();});await page.waitForTimeout(80);
 assert.equal(await page.locator('[data-library-open]').count(),0,'stale month read cannot mount a picker');
 assert.equal(await page.evaluate(()=>libraryCalls.some(c=>/voucher_review|reanalyze|monthly_cell_save|petty_cash_record|batch_confirm/.test(c.op))),false);
 assert.deepEqual(errors,[]);await page.close();
}
console.log('Monthly vouchers: click-to-image, gallery first, exact/near-amount recommendations, searchable library, explicit monthly evidence, no-op saves, preserved associations/amounts and stale-month isolation passed (390/1280).');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
