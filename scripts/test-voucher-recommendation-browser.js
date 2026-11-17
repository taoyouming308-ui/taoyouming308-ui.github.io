const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(b);});});let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
for(const width of [390,1280])for(const mode of ['petty','monthly','legacy']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
 await page.evaluate(mode=>{
  window.recMode=mode;document.getElementById('month').value='2026-08';state.data.monthly_report.report_date='2026-08-01';state.view='finance-workbench';state.user.can_match_expense_vouchers=true;state.user.can_manage_finance_workbench=true;isLocalPreview=()=>false;window.confirm=()=>true;
  window.recCalls=[];window.recLinked=false;window.recFail=false;
  const report=state.data.monthly_report,target={id:'target',target_kind:mode==='petty'?'source_petty':'monthly_source',amount:mode==='petty'?59.9:3680.44,summary:mode==='petty'?'植物再生剂':'app',transaction_date:'2026-08-21',period_month:'2026-08',aggregate:mode!=='petty',source_locator:'C39',electronic_cell:{report_id:report.id}};
  const item=(id,amount,fields={})=>({id,source_voucher_id:id,original_filename:id+'.png',mime_type:'image/png',component_index:0,latest_ocr_task:{id:'task-'+id},candidate_fields:{amount,...fields}});
  const plant=item('nutrition-order',null,{document_date:null,document_kind:'unknown',document_type:'order',summary:'植物再生剂，先用后付待扣款',evidence:{amount:'实付 ¥59.9',expense_category:'植物再生剂2盒'},date_candidates:[{date:'2026-08-21',role:'order',confidence:.99,evidence:'下单2026-08-21'}]});
  const chat=item('chat',null,{document_date:null,document_kind:'unknown',summary:'转账聊天',evidence:{amount:'¥150.00；你发起了一笔转账'}});
  const far=item('logistics',4244.53,{summary:'物流账单'}),orphan=item('uploaded-but-unmatched',1000,{document_kind:'receipt'}),summary=item('monthly-summary',2680.44,{document_kind:'monthly_summary',evidence_kind:'monthly_summary',period_month:'2026-08'});
  const canvas=document.createElement('canvas');canvas.width=250;canvas.height=300;canvas.getContext('2d').fillRect(10,10,230,280);window.recImage=canvas.toDataURL('image/png');
  api=async(op,p)=>{recCalls.push({op,p});
   if(op==='cell_trace')return {report,target:{id:'cell-C39',cell_address:'C39',label:'市场 / app',numeric_value:3680.44,cell_kind:'input'},item_category:'expense',mode:'input',can_upload_vouchers:true,can_edit:true,voucher_library_source:mode==='monthly'?'store_uploads':undefined,evidence:mode==='monthly'&&recLinked?['uploaded-but-unmatched','monthly-summary'].map(id=>({id,original_filename:id+'.png',mime_type:'image/png',evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:rec'})):[],business_details:[]};
   if(op==='expense_voucher_workspace')return {month:'2026-08',targets:[target],items:mode==='monthly'?[far]:mode==='legacy'?[recLinked?{...chat,confirmed_target_kind:'monthly_source',confirmed_target_id:'target',corrected_fields:{amount:150,evidence_kind:'monthly_summary',period_month:'2026-08'}}:chat]:[far,chat,plant,item('unknown',null)]};
   if(op==='monthly_voucher_library'&&p.action==='list')return {items:[far,chat,plant,orphan,summary]};
   if(op==='voucher_url')return {url:recImage,filename:p.voucher_id+'.png'};
   if(op==='monthly_voucher_library'&&p.action==='attach_combination'){if(recFail)throw Error('synthetic failed association');recLinked=true;return {combination_saved:true};}
   if(op==='expense_voucher_match_apply'){recLinked=true;return {saved:{inserted:1}};}
   throw Error('Unexpected API/write '+op);
  };
 },mode);
 async function open(){await page.evaluate(mode=>mode==='petty'?ZysyrExpenseVoucherWorkspace.openPettyDetail('source_petty','target'):openCellTrace('C39'),mode);await page.locator('[data-library-open]').click();await page.locator('.monthly-library-item').first().waitFor();}
 await open();
 if(mode==='petty'){
  assert.match(await page.locator('.monthly-library-item').first().innerText(),/nutrition-order.*订单原文金额 59.90.*付款待核对.*金额一致/);
  await page.locator('[data-library-search]').fill('59.90');assert.equal(await page.locator('.monthly-library-item').count(),1);await page.locator('.monthly-library-item').click();assert.equal(await page.locator('[data-library-amount]').inputValue(),'');assert.equal(await page.locator('[data-library-date]').inputValue(),'');
  await page.locator('.voucher-combinations details summary').click();assert.equal(await page.locator('[data-combination-options] input').first().getAttribute('data-combination-pick'),'nutrition-order:0');
  await page.locator('input[aria-label="组合凭证搜索"]').fill('植物');assert.equal(await page.locator('[data-combination-options] input').count(),1);
  assert.equal(await page.evaluate(()=>recCalls.some(c=>/apply|attach/.test(c.op)||c.p.action==='attach_combination')),false);
 }else if(mode==='monthly'){
  assert.equal(await page.locator('.monthly-library-item').count(),5,'all uploaded originals, including missing workspace item and summary');
  assert.equal(await page.evaluate(()=>recCalls.some(c=>c.op==='monthly_voucher_library'&&c.p.action==='list')),true,'mapped monthly cell also uses canonical upload library');
  async function select(){await page.locator('.voucher-combinations details summary').click();await page.locator('[data-combination-pick="uploaded-but-unmatched:0"]').check();await page.locator('[data-combination-pick="monthly-summary:0"]').check();await page.locator('[data-combination-review]').click();for(const card of await page.locator('[data-combination-cards] > section').all()){await card.locator('[data-combination-preview]').click();await card.locator('img').waitFor();await card.locator('[data-combination-attest]').check();}}
  await select();await page.evaluate(()=>recFail=true);await page.locator('[data-combination-save]').click();await page.locator('[data-combination-status]').filter({hasText:'synthetic failed association'}).waitFor();
  await open();assert.equal(await page.locator('.monthly-library-item').count(),5,'failed association never removes uploaded files from picker');await select();await page.evaluate(()=>recFail=false);await page.locator('[data-combination-save]').click();await page.waitForFunction(()=>recLinked);await page.waitForFunction(()=>document.querySelectorAll('.voucher-file-preview').length===2);assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'3680.44');
  assert.equal(await page.evaluate(()=>recCalls.some(c=>c.op==='expense_voucher_match_apply')),false,'homepage evidence does not depend on pending batch match');
 }else{
  await page.locator('.monthly-library-item').click();await page.locator('[data-library-preview] img').waitFor();await page.locator('[data-library-kind]').selectOption('monthly_summary');await page.locator('[data-library-month]').evaluate(input=>{input.type='text';input.value='8月';});await page.locator('[data-library-amount]').fill('150');await page.locator('[data-library-attest]').check();await page.locator('[data-library-confirm]').click();await page.waitForFunction(()=>recCalls.some(c=>c.op==='expense_voucher_match_apply'));
  const p=await page.evaluate(()=>recCalls.find(c=>c.op==='expense_voucher_match_apply').p);assert.equal(p.items[0].corrected_fields.period_month,'2026-08');assert.equal(p.items[0].corrected_fields.document_date,null);assert.equal(p.items[0].corrected_fields.evidence_kind,'monthly_summary');
 }
 assert.deepEqual(errors,[]);fs.mkdirSync(path.join(root,'artifacts/v666-acceptance'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/v666-acceptance/'+mode+'-'+width+'.png')});await page.close();
}
console.log('Recommendation/all-upload browser390/1280: printed59.90 plant first, same multi-select order and product/amount search; payment/date remain blank; mapped homepage uses all originals, summary+orphan selectable, failed association retains all files, unchanged3680.44 and Safari8月 becomes2026-08 without payment inference passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
