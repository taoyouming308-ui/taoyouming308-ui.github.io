const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,b)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(b)})});
const fixture={name:'2026年7月月报.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic upload')};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1180,height:820}});const url=`http://127.0.0.1:${server.address().port}/operations.html?preview=1&role=finance`;
 async function setup(status,options={}){
  await page.goto(url);await page.waitForSelector('#monthly-material-toggle:not(.hidden)');
  await page.evaluate(({status,options})=>{
   const original=state.data.monthly_report;
   const v={status,checked_cells:12,checked_formulas:3,issue_count:status==='matched'?0:1,issues:status==='matched'?[]:[{code:'amount',address:'B3',message:status==='needs_review'?'草稿已保存，但核对暂未完成':'金额与原件不同',expected:100,actual:200}]};
   const report={...original,id:'11111111-1111-4111-8111-111111111111',historical:false,report_type:'monthly_profit_loss',report_date:'2026-07-01',version:2,original_filename:'2026年7月月报.xlsx',display_data:previewFilledMonthly(),upload_verification:v,vouchers:[]};
   window.testReport=report;window.testCalls=[];window.fixtureResolve=null;isLocalPreview=()=>false;
   api=async(op,payload)=>{testCalls.push({op,payload});if(op==='report_upload_auto'||op==='report_upload'){if(options.delay)await new Promise(r=>{window.fixtureResolve=r});return {saved:report,verification:v,detection:{report_type:'monthly_profit_loss',type_label:'月报原表',month:'2026-07'}}}if(op==='voucher_upload')return {saved:{id:'test-voucher'}};throw Error('unexpected '+op)};
   loadOverview=async()=>{if(options.refreshFails)throw Error('refresh failed');state.data.monthly_report=report;renderAll()};
   if(options.reopen){state.data.monthly_report=report;renderAll()}
  },{status,options});
 }
 for(const status of ['matched','mismatch','needs_review']){
  await setup(status);await page.locator('#monthly-material-toggle').click();await page.setInputFiles('#monthly-material-file',fixture);await page.locator('#monthly-material-form button[type=submit]').click();
  await page.waitForFunction(()=>!state.monthlyUploadBusy);const receipt=await page.locator('#monthly-material-result').textContent();assert.match(receipt,/草稿已保存/);assert.match(receipt,/未自动入账/);
  assert.equal(await page.locator('#monthly-upload-verification').getAttribute('data-status'),status);
  if(status==='mismatch'){assert.match(await page.locator('#monthly-upload-verification').textContent(),/B3.*100.*200/);assert.equal(await page.locator('#monthly-upload-verification').getAttribute('role'),'alert')}
  assert.deepEqual((await page.evaluate(()=>testCalls)).map(c=>c.op),['report_upload_auto']);
  // Fresh page reopens the same server projection, independent of upload toast state.
  await setup(status,{reopen:true});assert.equal(await page.locator('#monthly-upload-verification').getAttribute('data-status'),status);
 }
 await setup('needs_review',{refreshFails:true});await page.locator('#monthly-material-toggle').click();await page.setInputFiles('#monthly-material-file',fixture);await page.locator('#monthly-material-form button[type=submit]').click();await page.waitForFunction(()=>!state.monthlyUploadBusy);assert.match(await page.locator('#monthly-material-result').textContent(),/不要重复上传/);
 await setup('mismatch',{delay:true});await page.locator('#monthly-material-toggle').click();await page.setInputFiles('#monthly-material-file',fixture);await page.locator('#monthly-material-form button[type=submit]').click();await page.waitForFunction(()=>!!window.fixtureResolve);
 await page.evaluate(()=>{document.getElementById('monthly-material-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:document.querySelector('#monthly-material-form button[type=submit]')}));state.session='different-account';document.getElementById('monthly-material-result').textContent='新账号页面';window.fixtureResolve()});await page.waitForFunction(()=>!state.monthlyUploadBusy);assert.equal(await page.locator('#monthly-material-result').textContent(),'新账号页面');assert.equal((await page.evaluate(()=>testCalls)).length,1);
 // Direct/manual form shares the same verification and draft-only API.
 await setup('mismatch');await page.evaluate(()=>{document.getElementById('report-type').value='monthly_profit_loss';document.getElementById('report-month').value='2026-07'});await page.setInputFiles('#report-file',fixture);
 await page.evaluate(()=>document.getElementById('report-upload-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:document.querySelector('#report-upload-form button[type=submit]')})));
 await page.waitForFunction(()=>!state.monthlyUploadBusy&&window.testCalls.length>0);assert.match(await page.locator('#upload-progress').textContent(),/草稿已保存.*发现 1 处差异/s);assert.deepEqual((await page.evaluate(()=>testCalls)).map(c=>c.op),['report_upload']);
 await page.evaluate(()=>{MonthlyUploadVerification.render(document.getElementById('monthly-upload-verification'),{upload_verification:{status:'mismatch',issue_count:1,issues:[{message:'<img src=x onerror=alert(1)>',address:'A1',expected:'<b>x</b>',actual:1}]}})});assert.equal(await page.locator('#monthly-upload-verification img').count(),0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/monthly-verification-mobile.png',fullPage:true});
 console.log('Monthly verification browser: both upload forms, persistent states/reopen, exact differences, escaped content, failed refresh receipt, duplicate submit and stale-account response protections; no approval/posting calls passed');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
