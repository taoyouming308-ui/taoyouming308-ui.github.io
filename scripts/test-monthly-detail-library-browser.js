/* Actual amount drawer, private synthetic API: no production records or calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(b);});});
let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
 await page.evaluate(()=>{
  document.getElementById('month').value='2026-07';state.user.can_match_expense_vouchers=true;state.user.can_manage_finance_workbench=true;isLocalPreview=()=>false;
  window.detailCalls=[];window.detailLinked={};window.detailFail=false;window.detailLate=false;window.detailReadFail=false;
  const report=state.data.monthly_report,labels={G33:'产品进货 / 品牌甲 / 合计',G46:'零售产品成本 / 品牌乙 / 合计',N34:'备用金 / 食品 / 合计',N50:'杂项 / 拍摄 / 合计'},amounts={G33:1474,G46:50,N34:757.84,N50:1000};
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;canvas.getContext('2d').fillRect(0,0,300,300);window.detailImage=canvas.toDataURL('image/png');
  api=async(op,p)=>{detailCalls.push({op,p});
   if(op==='cell_trace')return {report,target:{id:'cell-'+p.cell_address,cell_address:p.cell_address,label:labels[p.cell_address],numeric_value:amounts[p.cell_address],cell_kind:'input'},mode:'input',item_category:'expense',can_edit:true,can_upload_vouchers:true,evidence:detailLinked[p.cell_address]?[{id:'exact',original_filename:'exact.png',mime_type:'image/png',evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:synthetic'}]:[],business_details:[]};
   if(op==='expense_voucher_workspace')return {month:'2026-07',targets:[],items:[]};
   if(op==='voucher_url')return {url:detailImage,filename:p.voucher_id+'.png'};
   if(op==='monthly_voucher_library'){
    if(p.action==='attach'){if(detailFail)throw Error('synthetic save failure');detailLinked[p.cell_id.replace('cell-','')]=true;return {cell_linked:true};}
    if(detailLate)await new Promise(r=>window.detailRelease=r);if(detailReadFail)throw Error('synthetic read failure');
    const amount=amounts[p.cell_id.replace('cell-','')];return {items:[{id:'unknown',original_filename:'unknown.png',candidate_fields:{}},{id:'near',original_filename:'near.png',candidate_fields:{amount:amount+.01}},{id:'exact',original_filename:'exact.png',mime_type:'image/png',candidate_fields:{amount},already_linked:!!detailLinked[p.cell_id.replace('cell-','')]}]};
   }throw Error('Unexpected API/write '+op);
  };
 });
 for(const [address,amount] of [['G33',1474],['G46',50],['N34',757.84],['N50',1000]]){
  await page.evaluate(a=>openCellTrace(a),address);await page.locator('[data-library-open]').click();await page.locator('[data-library-search]').waitFor();
  assert.deepEqual(await page.locator('.monthly-library-item').allTextContents().then(t=>t.map(s=>s.split('.')[0])),['exact','near','unknown']);
  await page.locator('.monthly-library-item').first().click();await page.locator('[data-library-preview] img').waitFor();await page.locator('[data-library-confirm]').click();assert.match(await page.locator('[data-library-status]').innerText(),/先读取并核对/);
  await page.locator('[data-library-attest]').check();await page.evaluate(()=>detailFail=true);await page.locator('[data-library-confirm]').click();assert.match(await page.locator('[data-library-status]').innerText(),/synthetic save failure/);
  await page.evaluate(()=>detailFail=false);await page.locator('[data-library-confirm]').click();await page.locator('.monthly-voucher-preview img').waitFor();
  assert.equal(await page.locator('#monthly-inline-amount').inputValue(),String(amount));
  await page.locator('[data-library-open]').click();await page.locator('.monthly-library-item').first().click();assert.equal(await page.locator('[data-library-confirm]').count(),0);
 }
 await page.evaluate(()=>{detailReadFail=true;return openCellTrace('G33');});await page.locator('[data-library-open]').click();await page.waitForFunction(()=>document.querySelector('[data-library-panel]').textContent.includes('synthetic read failure'));await page.locator('[data-library-open]').click();await page.evaluate(()=>detailReadFail=false);await page.locator('[data-library-open]').click();await page.locator('[data-library-search]').waitFor();
 await page.evaluate(()=>{detailLate=true;return openCellTrace('N50');});await page.locator('[data-library-open]').click();await page.waitForFunction(()=>!!window.detailRelease);await page.evaluate(()=>{document.getElementById('month').value='2026-08';detailRelease();});await page.waitForTimeout(50);assert.equal(await page.locator('[data-library-confirm]').count(),0,'late list cannot act in another month');
 assert.equal(await page.evaluate(()=>detailCalls.some(c=>/voucher_upload|voucher_review|reanalyze|monthly_cell_save|petty_cash_record/.test(c.op))),false);assert.deepEqual(errors,[]);
 fs.mkdirSync(path.join(root,'artifacts/v664-acceptance'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/v664-acceptance/details-'+width+'.png')});await page.close();
}
console.log('Monthly detail library: four circled sections, exact/near ranking, image preview, attestation, save retry/readback, unchanged amounts, old links and stale-month isolation passed (390/1280).');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
