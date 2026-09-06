// Browser + real local HTTP/handlers + disposable PostgreSQL, synthetic identities only.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app,browser;try{
 app=await startServer();
 app.sql(`insert into public.salon_customers(organization_id,display_name) values(1,'合成顾客');
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
 insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id) values(1,1,'22222222-2222-4222-8222-222222222222');`);
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,390])for(const role of ['staff','customer']){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[],logouts=[];let businessCalls=0;
  const isStaff=role==='staff',loginPath=isStaff?'/__salon_test_session':'/__salon_test_customer_session',logoutPath=isStaff?'/__salon_test_logout':'/__salon_test_customer_logout';
  const connected=isStaff?'已连接临时数据库；所有操作只影响本次合成数据。':'已连接合成顾客，仅显示本人数据。';
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/'))businessCalls++;if(path===logoutPath)logouts.push(r.headers().authorization);});
  await page.route('**/*',r=>new URL(r.request().url()).origin===app.url?r.continue():r.abort());
  await page.addInitScript(()=>{
   const fetchReal=window.fetch.bind(window),timerReal=window.setTimeout.bind(window);
   window.setTimeout=(fn,ms,...args)=>timerReal(fn,ms===30000?1000:ms,...args);
   window.fetch=async(input,options)=>{
    const response=await fetchReal(input,options);
    const plan=window.__stall;
    if(plan&&new URL(input,location.href).pathname===plan.path){
     window.__stall=null;
     if(plan.body){
      // Buffer before abort, then stall delivery: deliberately model a transport ignoring cancellation.
      const data=await response.json();
      return {ok:response.ok,status:response.status,json:()=>new Promise(resolve=>{window.__release=()=>resolve(data);})};
     }
     return new Promise(resolve=>{window.__release=()=>resolve(response);});
    }
    return response;
   };
  });
  await page.goto(app.url+(isStaff?'':'/customer'));
  await page.evaluate(path=>{localStorage.setItem('other-app-sentinel','keep');window.__stall={path,body:innerWidth===390};},loginPath);
  await page.locator('#connect').click();await page.getByText(/请求等待超时/).waitFor();
  assert.equal(await page.locator('#connect').isDisabled(),false);assert.equal(await page.locator('#refresh').isDisabled(),true);assert.equal(businessCalls,0);
  await page.evaluate(async()=>{await window.__release();await new Promise(r=>setTimeout(r,20));});
  assert.equal(businessCalls,0,'late login cannot start business reads');assert.equal(await page.locator('#refresh').isDisabled(),true);
  await page.locator('#connect').click();await page.getByText(connected,{exact:true}).waitFor();
  if(isStaff){
   const count=businessCalls;
   await page.evaluate(()=>{window.__stall={path:'/__salon_test_user',body:true};});
   await page.locator('#refresh').click();await page.getByText('会话已锁定，旧业务选择已清除；请重新连接。',{exact:true}).waitFor();
   assert.equal(businessCalls,count,'verification timeout must not send business read');
   await page.evaluate(async()=>{await window.__release();await new Promise(r=>setTimeout(r,20));});
   assert.equal(await page.locator('#refresh').isDisabled(),true);assert.equal(businessCalls,count);
   await page.locator('#connect').click();await page.getByText(connected,{exact:true}).waitFor();
  }
  await page.evaluate(path=>{window.__stall={path};},logoutPath);
  await page.locator('#logout').click();await page.getByText(isStaff?/本页面已锁定，但服务器退出未确认/:/退出未确认，请重试退出/).waitFor();
  assert.equal(await page.locator('#connect').isDisabled(),true);assert.equal(await page.locator('#refresh').isDisabled(),true);assert.equal(await page.locator('#logout').isDisabled(),false);
  const count=businessCalls;
  await page.evaluate(async()=>{await window.__release();await new Promise(r=>setTimeout(r,20));});
  assert.equal(await page.locator('#connect').isDisabled(),true,'late logout event cannot re-enable login');
  assert.equal(await page.locator('#refresh').isDisabled(),true);assert.equal(businessCalls,count);
  await page.locator('#logout').click();await page.getByText(isStaff?'已退出本次测试会话；旧请求不能继续提交。':'顾客会话已退出，旧令牌已撤销。',{exact:true}).waitFor();
  assert.equal(logouts.length,2);assert.equal(logouts[0],logouts[1],'logout retry uses original synthetic session');
  assert.equal(await page.locator('#connect').isDisabled(),false);assert.equal(await page.locator('#refresh').isDisabled(),true);
  const denied=await fetch(app.url+(isStaff?'/__salon_test_user':'/api/salon-customer'),{method:'POST',headers:{Authorization:logouts[0],'Content-Type':'application/json'},body:JSON.stringify({operation:'context',organizationId:1,storeId:1})});
  assert.equal(denied.status,403,'old synthetic token is not accepted');
  await page.locator('#connect').click();await page.getByText(connected,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('other-app-sentinel')),'keep');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.close();
 }
 assert.equal(app.sql('select count(*) from public.salon_orders'),'0');assert.equal(app.sql('select count(*) from public.salon_customers'),'1');
 console.log('Session timeout browser passed: 1280/390 staff/customer login fetch/body stalls, verified-user timeout, late logout lock, original-token retry, recovery and zero business writes');
}finally{if(browser)await browser.close();if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
