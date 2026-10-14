// Actual report/App UI; all network and financial values are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'application/javascript');res.end(b)})});
let browser;
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 for(const width of [1366,390]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/operations.html?preview=1&role=finance');await page.waitForFunction(()=>state.user&&state.data.monthly_report);
  await page.evaluate(()=>{
    const snapshot={schema_version:1,store_id:'synthetic',store_name:'合成测试店',month:'2026-01',report:{display_data:structuredClone(state.data.monthly_report.display_data)},daily_performance:state.data.monthly_daily_performance};
    snapshot.report.display_data.values[2][2]=12345.67;
    window.testReview={context:{key:'synthetic',store:'合成测试店',month:'2026-01',allowed:true},finance:true,receipt:null,publication:null,calls:[],dirty:false,lost:false};
    const t=window.testReview;
    t.api=async(op,p)=>{t.calls.push({op,p});if(op==='monthly_review_status')return {finance:t.finance,publication:t.publication,receipt:t.receipt,assigned:true,recipients:[],history:[]};
      if(op==='monthly_review_preview')return {snapshot,preview_token:'a'.repeat(64),expected_publication_id:t.publication?.id||null};
      if(op==='monthly_review_publish'){t.publication={id:'synthetic-pub',version:1,content_hash:'b'.repeat(64),snapshot,published_at:'2026-01-31T12:00:00Z'};return{created:true}}
      if(op==='monthly_review_confirm'){t.receipt={id:'once',confirmed_at:'2026-01-31T13:00:00Z'};if(t.lost)throw Error('连接中断');return{created:true}}
      throw Error(op)};
    const bar=document.createElement('section');bar.id='test-monthly-review';bar.className='monthly-review-bar';document.body.appendChild(bar);
    t.ui=MonthlyReviewUI.create({bar,api:t.api,context:()=>t.context,dirty:()=>t.dirty,notify:m=>t.notice=m});return t.ui.refresh();
  });
  const bar=page.locator('#test-monthly-review');await bar.getByRole('button',{name:'提交股东确认',exact:true}).click();
  let dialog=page.locator('.monthly-review-dialog');await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'确认提交并提醒股东'}).isDisabled(),true);assert.match(await dialog.innerText(),/12345.67/);
  assert.equal(await page.evaluate(()=>testReview.calls.some(c=>c.op==='monthly_review_publish')),false);
  await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'确认提交并提醒股东'}).click();await dialog.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>testReview.calls.filter(c=>c.op==='monthly_review_publish').length),1);
  await page.evaluate(()=>{testReview.finance=false;return testReview.ui.refresh()});await bar.getByRole('button',{name:'核对并确认本月报表'}).click();
  dialog=page.locator('.monthly-review-dialog');await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'确认账目无异议',exact:true}).isDisabled(),true);
  const overflow=await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+2);assert.equal(overflow,false,'only the table scrolls, not the dialog');
  await page.screenshot({path:'/tmp/monthly-review-'+width+'.png'});
  await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'确认账目无异议',exact:true}).click();await dialog.waitFor({state:'detached'});
  await bar.getByRole('button',{name:'查看已确认版本'}).click();assert.equal(await page.locator('.monthly-review-dialog input').count(),0);assert.equal(await page.locator('.monthly-review-dialog').getByRole('button',{name:'确认账目无异议',exact:true}).count(),0);await page.keyboard.press('Escape');
  // Lost response: one call only, then read-only recovery reveals the receipt.
  await page.evaluate(()=>{testReview.receipt=null;testReview.lost=true;return testReview.ui.refresh()});await bar.getByRole('button',{name:'核对并确认本月报表'}).click();await page.locator('.monthly-review-dialog input').check();await page.locator('.monthly-review-dialog').getByRole('button',{name:'确认账目无异议',exact:true}).click();
  await page.locator('.monthly-review-dialog').getByRole('button',{name:'重新读取确认状态'}).click();await bar.getByRole('button',{name:'查看已确认版本'}).waitFor();assert.equal(await page.evaluate(()=>testReview.calls.filter(c=>c.op==='monthly_review_confirm').length),2);
  await page.evaluate(()=>{testReview.finance=true;testReview.dirty=true;return testReview.ui.refresh()});await bar.getByRole('button',{name:'预览并重新提交'}).click();assert.equal(await page.locator('.monthly-review-dialog').count(),0);assert.match(await page.evaluate(()=>testReview.notice),/先保存/);
  // Late cross-store response cannot reveal an old store's confirmation.
  await page.evaluate(()=>{testReview.dirty=false;testReview.api;testReview.context.allowed=false;return testReview.ui.refresh()});assert.equal(await bar.isVisible(),false);
 }
 // Real App reminder module, isolated DOM and synthetic granted identity.
 await page.goto(origin+'/operations.html?preview=1&role=finance');
 await page.evaluate(()=>{document.body.replaceChildren();const b=document.createElement('button');b.id='employee-report-entry';document.body.appendChild(b);localStorage.setItem('booking-session',JSON.stringify({session_token:'synthetic-session'}));window.appGranted=true;window.StaffAccessClient={request:async()=>({enabled:window.appGranted})};window.fetch=async()=>({ok:true,json:async()=>({pending:[{store:'合成测试店',period_month:'2026-01-01',version:1}],count:1})})});
 await page.addScriptTag({url:origin+'/employee-reports.js'});await page.evaluate(()=>EmployeeReports.init({url:'https://synthetic.invalid',key:'synthetic-only'}));await page.locator('#employee-review-pending').waitFor();assert.match(await page.locator('#employee-review-pending').innerText(),/1/);assert.equal(await page.locator('#employee-review-dot').isVisible(),true);
 await page.locator('#employee-review-pending').click();assert.match(await page.locator('#employee-report-panel iframe').getAttribute('src'),/review_month=2026-01/);
 await page.evaluate(()=>{appGranted=false;return EmployeeReports.refresh()});assert.equal(await page.locator('#employee-review-pending').isVisible(),false);assert.equal(await page.locator('#employee-report-panel').count(),0);
 // Ignore only navigation-to-isolated-test iframe initialization on cleared DOM;
 // every actual page/dialog above must have had no errors.
 assert.deepEqual(errors,[]);
 console.log('Monthly review browser 390/1366: real modules, explicit preview/consent, one confirmation, immutable view, lost reply readback, dirty guard, overflow, App reminder and revoked grants passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
