/* Synthetic actual drawer/file-picker regression, without external requests. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(bytes);});});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
  await page.evaluate(()=>{
   document.getElementById('month').value='2026-07';window.supplementCalls=[];window.supplementLinked=false;window.supplementFailure=false;
   state.user.can_match_expense_vouchers=false;isLocalPreview=()=>false;
   const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;window.syntheticImage=canvas.toDataURL('image/png');
   api=async(op,p)=>{supplementCalls.push({op,p});
    if(op==='cell_trace')return {report:state.data.monthly_report,target:{id:'11111111-1111-4111-8111-111111111111',cell_address:'C40',label:'其它 / 维修费',numeric_value:3800,cell_kind:'input'},mode:'input',item_category:'expense',can_edit:true,can_upload_vouchers:true,evidence:supplementLinked?[{id:'22222222-2222-4222-8222-222222222222',evidence_source:'voucher_attachment',trace_link_level:'page_confirmed',trace_source_locator:'manual-upload:synthetic',original_filename:'existing.png',mime_type:'image/png'}]:[],business_details:[]};
    if(op==='voucher_upload'){if(supplementFailure)throw Error('synthetic link failure');supplementLinked=true;return {saved:{id:'22222222-2222-4222-8222-222222222222'},reused:true,cell_linked:true,formal_ledger_amount_changed:false};}
    if(op==='voucher_url')return {url:syntheticImage,filename:'existing.png'};
    throw Error('Unexpected API/write '+op);
   };
  });
  await page.evaluate(()=>openCellTrace('C40'));
  assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'3800');
  async function choose(){const chosen=page.waitForEvent('filechooser');await page.locator('#monthly-inline-upload').click();await (await chosen).setFiles({name:'existing.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=','base64')});await page.locator('#monthly-photo-pending').waitFor();}
  await choose();assert.equal(await page.evaluate(()=>supplementCalls.some(c=>c.op==='voucher_upload')),false,'selection/preview must not upload');
  assert.match(await page.locator('#monthly-photo-pending').innerText(),/月报金额保持不变/);
  await page.locator('[data-cancel-photo]').click();assert.equal(await page.locator('#monthly-photo-pending').count(),0);
  await choose();await page.evaluate(()=>supplementFailure=true);await page.locator('[data-save-photo]').click();
  await page.waitForFunction(()=>document.querySelector('[data-photo-status]').textContent.includes('synthetic link failure'));
  assert.equal(await page.locator('[data-save-photo]').isEnabled(),true);assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'3800');
  await page.evaluate(()=>supplementFailure=false);await page.locator('[data-save-photo]').click();await page.waitForFunction(()=>!document.getElementById('monthly-photo-pending'));
  await page.locator('.voucher-file-preview img').waitFor();assert.equal(await page.locator('#monthly-inline-amount').inputValue(),'3800');
  const writes=await page.evaluate(()=>supplementCalls.filter(c=>c.op!=='cell_trace'&&c.op!=='voucher_url'));
  assert.equal(writes.length,2);for(const c of writes){assert.equal(c.op,'voucher_upload');assert.equal(c.p.monthly_cell_id,'11111111-1111-4111-8111-111111111111');assert.equal(c.p.skip_ocr,true);assert.equal(c.p.monthly_cell_reason,'补充当前金额凭证');assert.equal(Object.hasOwn(c.p,'after_amount'),false);}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Monthly voucher supplement drawer: preview/cancel, unchanged 3800, link failure/retry, duplicate-original success/readback, no amount editor save or OCR passed (390/1280).');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
