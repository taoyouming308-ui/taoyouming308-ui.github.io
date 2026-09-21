// Real pages, synthetic network responses; never uses production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(data)});
});
let browser;
async function run(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext();
  const calls=[];let access=true,revoked=false,financeRequests=0;
  let overview,daily,month;
  const employeeToken='11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';
  const user={username:'测试股东',store:'向里造型',stores:['向里造型'],role:'shareholder',role_label:'股东',can_read_daily_reports:true,can_read_salary:true,can_read_petty_cash_reports:true};
  const stores=[{id:'00000000-0000-4000-8000-000000000001',name:'向里造型'},{id:'00000000-0000-4000-8000-000000000002',name:'自由手艺人'}];
  const staff={id:3,username:'测试股东',store:'向里造型',position:'发型师',role:'staff',active:true,employment_status:'active'};
  await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url.startsWith(origin))return route.continue();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(url.includes('/functions/v1/operations-auth')){financeRequests++;return ok({});}
    if(url.includes('/functions/v1/operations-api')){
      const data=request.postDataJSON();calls.push(data);
      if(revoked)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'尚未开通股东报表权限'})});
      if(data.operation==='session')return ok({user});
      if(data.operation==='overview')return ok(overview);
      if(data.operation==='daily_sheet_month')return ok(month);
      if(data.operation==='daily_sheet_read')return ok(daily);
      return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'未授权操作 '+data.operation})});
    }
    if(url.includes('/functions/v1/staff-access-api')){
      const data=request.postDataJSON();calls.push(data);
      if(data.operation==='report_access')return ok({enabled:access,stores:access?stores:[]});
      if(data.operation==='staff_access'||data.operation==='stores')return ok({stores,report_store_ids:[stores[0].id],can_manage:true});
      if(data.operation==='save')return ok({saved:staff});
      if(data.operation==='session')return ok({user:{username:'管理员',role:'admin',store:'向里造型'}});
    }
    if(url.includes('/functions/v1/employee-bookings-api'))return ok({user:staff,session_token:employeeToken,expires_at:'2099-01-01T00:00:00Z',rows:[],counts:{}});
    if(url.includes('/rest/v1/staff?'))return ok([staff]);
    if(url.includes('/rest/v1/')||url.includes('/functions/v1/'))return ok([]);
    return route.abort();
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/operations.html?preview=1&role=finance');
  await page.locator('#monthly-edit-toggle').waitFor();
  ({overview,daily,month}=await page.evaluate(()=>({overview:state.data,daily:previewDailySheetData(),month:previewDailySheetMonth()})));
  daily.readonly=true;daily.permissions={write:false,upload_original:false,save_orientation:false};
  // Store unrelated finance login exactly; employee mode must not read/use/clear it.
  await page.evaluate(token=>{
    localStorage.setItem('booking-session',JSON.stringify({session_token:token,username:'测试股东',store:'向里造型',position:'股东',loggedAt:Date.now(),expires_at:'2099-01-01T00:00:00Z'}));
    localStorage.setItem('zysyr-operations-session-v1','FINANCE_SESSION_UNCHANGED');
    localStorage.setItem('perm_admin',JSON.stringify({user:'管理员',role:'admin',store:'向里造型',staffToken:token,loggedAt:Date.now()}));
  },employeeToken);
  calls.length=0;financeRequests=0;
  await page.goto(origin+'/operations.html?entry=staff-shareholder');
  await page.waitForFunction(()=>state.monthlyOverviewReady===true);
  assert.equal(financeRequests,0,'employee view never attempts finance authentication');
  assert.equal(await page.locator('#store-select option').count(),1);
  assert.equal(await page.locator('#monthly-ack').count(),0,'read-only view hides acknowledge write');
  assert.equal(await page.locator('#monthly-edit-toggle').isVisible(),false);
  assert(!await page.locator('#user-card').innerText().then(t=>t.includes('退出登录')));
  await page.evaluate(()=>showView('daily-report'));
  await page.waitForFunction(()=>state.dailyReportMonth!==null);
  await page.evaluate(async()=>{state.imports.sheet=await api('daily_sheet_read',{store:currentStore(),draft_id:'synthetic'});renderDailySheetDetail()});
  assert.equal(await page.locator('#daily-detail-grid input:not([disabled]):not([readonly])').count(),0);
  assert.equal(await page.locator('#daily-detail-save').isVisible(),false);
  for(const [width,height] of [[844,390],[1024,768],[1440,900]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(120);
    const overflow=await page.locator('#daily-detail-grid').evaluate(el=>el.scrollWidth>el.clientWidth+2);assert.equal(overflow,false);
  }
  assert(calls.filter(c=>['session','overview','daily_sheet_month','daily_sheet_read'].includes(c.operation)).every(c=>c.employee_session_token===employeeToken&&!c.session_token&&!c.access_token));
  await page.evaluate(()=>logout());
  assert.equal(await page.evaluate(()=>localStorage.getItem('zysyr-operations-session-v1')),'FINANCE_SESSION_UNCHANGED');
  assert(!calls.some(c=>c.operation==='logout'));
  await page.reload();await page.waitForFunction(()=>state.monthlyOverviewReady);
  revoked=true;await page.evaluate(()=>maintainSession());
  assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#login').isVisible(),false);revoked=false;
  // Actual employee editor: independent store-grants controls, save through API.
  await page.goto(origin+'/admin.html');
  await page.evaluate(()=>openModal('staff',3));
  await page.waitForFunction(()=>document.getElementById('staff-report-access')?.dataset.ready==='true');
  const grantBoxes=page.locator('#staff-report-access input');assert.equal(await grantBoxes.count(),2);
  await page.screenshot({path:'/tmp/zysyr-v514-admin-grants.png'});
  assert.equal(await grantBoxes.nth(0).isChecked(),true);assert.equal(await grantBoxes.nth(1).isChecked(),false);
  await grantBoxes.nth(1).check();await page.evaluate(()=>saveStaff(3));
  const saved=calls.filter(c=>c.operation==='save').at(-1);assert.deepEqual(saved.data.report_store_ids,stores.map(s=>s.id));
  assert(!saved.data.password_hash);assert.equal(saved.session_token,employeeToken);
  // Actual App loads integration, opens iframe and removes it after access revocation.
  await page.goto(origin+'/perm-app.html');
  await page.waitForFunction(()=>window.EmployeeReports&&document.getElementById('employee-report-entry').hidden===false);
  await page.evaluate(()=>document.getElementById('employee-report-entry').click());
  await page.locator('#employee-report-panel iframe').waitFor();
  assert.match(await page.locator('#employee-report-panel iframe').getAttribute('src'),/^operations\.html\?entry=staff-shareholder$/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('zysyr-operations-session-v1')),'FINANCE_SESSION_UNCHANGED');
  access=false;await page.evaluate(()=>EmployeeReports.refresh());assert.equal(await page.locator('#employee-report-panel').count(),0);
  assert.equal(await page.locator('#employee-report-entry').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('staff report browser passed: actual App, admin grants, read-only reports, finance-session isolation, revocation and landscape fit');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
