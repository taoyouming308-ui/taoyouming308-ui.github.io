// Offline synthetic regression: all external traffic is intercepted; no real sessions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=require('playwright')[process.env.STARTUP_BROWSER||'chromium'];
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:43857';
(async()=>{const browser=await engine.launch({headless:true});try{
for(const entry of ['frontdesk.html','perm-app.html'])for(const mode of ['recover','expired','permission','timeout','stale','edits']){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();let phase=mode,reads=0,business=0,navigations=0,held;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const front=entry==='frontdesk.html',key=front?'zysyr-frontdesk-session-v1':'booking-session';
 await page.addInitScript(({key,front})=>{localStorage.setItem(key,JSON.stringify({username:'合成员工',store:'合成门店',session_token:'synthetic',loggedAt:Date.now(),expires_at:new Date(Date.now()+3600000).toISOString(),user:{username:'合成员工',store:'合成门店',stores:['合成门店'],role:'admin',can_import:true}}));},{key,front});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin){
   if(u.pathname.endsWith(front?'frontdesk-api':'employee-bookings-api')){
    const body=route.request().postDataJSON();if(body.operation==='session'){
     reads++;if(phase==='timeout'||phase==='stale'){held=route;return;} // held until timeout or context close
     if(phase==='expired')return route.fulfill({status:403,json:{error:'登录已过期，请重新登录'}});
     if(phase==='permission')return route.fulfill({status:403,json:{error:'没有此操作权限'}});
     if(phase==='recover'||phase==='edits')return route.abort('internetdisconnected');
     return route.fulfill({json:{user:{username:'已验证员工',store:'合成门店',stores:['合成门店'],role:'staff',can_import:true},expires_at:new Date(Date.now()+3600000).toISOString()}});
    }
    business++;assert.ok(['dashboard','today_bookings'].includes(body.operation),'no non-first-screen import read or write');return route.fulfill({status:503,json:{error:'合成接口故障'}});
   }
   if(u.pathname.endsWith('aesthetic-study')){assert.equal(route.request().postDataJSON().operation,'bootstrap','only existing read bootstrap');return route.fulfill({status:503,json:{error:'合成失败'}});}if(u.pathname.endsWith('staff-access-api')){assert.equal(route.request().postDataJSON().operation,'report_access');assert.equal(phase,'ready','report permission waits for verified identity');return route.fulfill({json:{enabled:false}});}assert.equal(route.request().method(),'GET','no external writes: '+u.pathname);return route.fulfill({status:503,json:{error:'合成失败'}});
  }
  if(u.pathname==='/'+entry)navigations++;const file=path.resolve(root,u.pathname.slice(1));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/json'}).catch(()=>{});
 });
 await page.goto(origin+'/'+entry+'?v=1',{waitUntil:'commit'});
 if(mode==='stale'){await page.waitForTimeout(300);await page.evaluate(key=>localStorage.removeItem(key),key);await held.fulfill({json:{user:{username:'迟到响应',store:'合成门店'}}}).catch(()=>{});}
 await page.locator('#app-startup').waitFor({state:'hidden'});
 const retry=page.locator(front?'#session-retry':'#identity-recovery button');
 if(mode==='expired'){
  await page.waitForFunction(key=>!localStorage.getItem(key),key);assert.equal(business,0);
 }else if(mode==='stale'){
  await page.waitForTimeout(100);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);assert.equal(business,0);
 }else{
  await retry.waitFor({state:'visible'});await page.waitForFunction(selector=>!document.querySelector(selector).disabled,front?'#session-retry':'#identity-recovery button',{timeout:20000});
  assert.ok(await page.evaluate(key=>localStorage.getItem(key),key),'transient / permission failure retains credentials');assert.equal(business,0,'unverified identity cannot load business data');
  if(mode==='edits'){
   if(front){await page.locator('#login-user').fill('未提交姓名');await page.locator('#login-pass').fill('未提交输入');}
   else{await page.evaluate(()=>{const i=document.getElementById('calc-amount');i.value='73';i.dispatchEvent(new Event('input',{bubbles:true}));});}
   await page.evaluate(()=>{window.ZysyrStartup.failed();document.getElementById('app-startup-retry').click();});
   assert.equal(await page.locator(front?'#login-pass':'#calc-amount').inputValue(),front?'未提交输入':'73');
  }else if(mode==='recover'||mode==='timeout'){
   phase='ready';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await page.waitForFunction(({key,front})=>{const v=JSON.parse(localStorage.getItem(key)||'{}');return(front?v.user&&v.user.username:v.username)==='已验证员工';},{key,front});
   if(front){await page.waitForFunction(()=>document.getElementById('sync-label').textContent.includes('失败'));assert.equal(await page.locator('#login').isVisible(),false);}
   else assert.equal(await page.locator('#identity-recovery').count(),0);
  }
 }
 assert.equal(navigations,1,'including old URL version, no automatic reload');assert.deepEqual(errors,[]);console.log(entry+' '+mode+' passed ('+reads+' session reads)');await context.close();
}
// Monthly request may remain pending while the verified shell becomes usable.
const context=await browser.newContext(),page=await context.newPage();let monthly=0,monthRoute;
await page.addInitScript(()=>localStorage.setItem('zysyr-operations-session-v1','synthetic'));
await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin){const body=route.request().postDataJSON();if(body.operation==='session')return route.fulfill({json:{user:{username:'合成股东',role:'shareholder',role_label:'股东',stores:['合成门店'],store:'合成门店'}}});if(body.operation==='overview'){monthly++;if(monthly===1){monthRoute=route;return;}return route.fulfill({status:503,json:{error:'合成月报失败'}});}throw Error('Unexpected operation '+body.operation);}
const file=path.resolve(root,u.pathname.slice(1));return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/json'}).catch(()=>{});});
await page.goto(origin+'/operations.html',{waitUntil:'commit'});await page.locator('#app-startup').waitFor({state:'hidden'});assert.ok(await page.locator('#app').isVisible());assert.equal(monthly,1);assert.match(await page.locator('#report-state').innerText(),/加载/);await monthRoute.fulfill({status:503,json:{error:'合成月报失败'}});await page.waitForFunction(()=>document.getElementById('report-state').textContent.includes('重试'));assert.ok(await page.locator('#monthly-edit-toggle').isDisabled());await page.locator('#refresh').click();await page.waitForFunction(()=>state.monthlyLoadRequest>=2);assert.equal(monthly,2);console.log('operations month failure/retry passed');await context.close();
const authContext=await browser.newContext(),authPage=await authContext.newPage();let scopeReads=0;
await authPage.addInitScript(()=>localStorage.setItem('zysyr-operations-auth-v1',JSON.stringify({session:{access_token:'synthetic',refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}})));
await authPage.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin){assert.ok(u.pathname.endsWith('/operations-auth'));scopeReads++;return;}const f=path.resolve(root,u.pathname.slice(1));return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'application/json'}).catch(()=>{});});
await authPage.goto(origin+'/operations.html',{waitUntil:'commit'});await authPage.locator('#app-startup').waitFor({state:'hidden'});assert.ok(await authPage.evaluate(()=>localStorage.getItem('zysyr-operations-auth-v1')));assert.equal(await authPage.locator('#app').isVisible(),false);assert.match(await authPage.locator('#login-error').innerText(),/网络/);assert.equal(scopeReads,1);console.log('operations scope timeout keeps credentials and denies data passed');await authContext.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
