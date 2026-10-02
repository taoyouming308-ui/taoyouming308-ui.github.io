const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:43857';
(async()=>{const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const mode of ['resource-delay','resource-404','offline','auth-delay','invalid-session','ready-edits']){
  const context=await browser.newContext({viewport:{width:mode==='ready-edits'?1280:390,height:844}}),page=await context.newPage();let release;const barrier=new Promise(resolve=>release=resolve);let navigations=0,readCalls=0,writes=0;
  if(mode==='auth-delay')await page.addInitScript(()=>localStorage.setItem('zysyr-operations-auth-v1',JSON.stringify({session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600}})));
  if(mode==='invalid-session')await page.addInitScript(()=>localStorage.setItem('zysyr-operations-session-v1','synthetic-session'));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){
    if(url.pathname==='/functions/v1/operations-auth'&&mode==='auth-delay'){readCalls++;await barrier;return route.fulfill({status:503,json:{error:'synthetic unavailable'}}).catch(()=>{});}
    if(url.pathname==='/functions/v1/operations-api'&&mode==='invalid-session'){
     const data=route.request().postDataJSON();if(data.operation!=='session')writes++;readCalls++;return route.fulfill({status:403,json:{code:'AUTH_SESSION_INVALID',error:'请重新登录'}});
    }
    writes++;return route.abort();
   }
   const name=url.pathname.slice(1);if(name==='operations.html'){navigations++;return route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:'text/html'});}
   if(name==='operations-time.js'){
    if(mode==='resource-delay')await barrier;
    if(mode==='resource-404')return route.fulfill({status:404,body:''});
    if(mode==='offline')return route.abort('internetdisconnected');
   }
   const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/json'}).catch(()=>{});
  });
  const url=origin+'/operations.html'+(mode==='ready-edits'?'?preview=1&role=finance&store='+encodeURIComponent('合成门店'):'');
  await page.goto(url,{waitUntil:'commit'});
  if(mode==='resource-delay'){
   await page.locator('#app-startup').waitFor({state:'visible'});await page.waitForTimeout(600);assert.ok(await page.evaluate(()=>performance.getEntriesByName('first-contentful-paint').length));
   await page.waitForFunction(()=>document.getElementById('app-startup').dataset.phase==='slow',{},{timeout:10000});assert.equal(navigations,1,'no automatic reload');
   await page.locator('#app-startup-retry').focus();await page.keyboard.press('Enter');await page.waitForTimeout(350);assert.equal(navigations,2,'one explicit keyboard reload');release();await page.locator('#app-startup').waitFor({state:'hidden'});assert.equal(await page.locator('#login').evaluate(el=>el.inert),false);
  }else if(mode==='resource-404'||mode==='offline'){
   await page.waitForFunction(()=>document.getElementById('app-startup').dataset.phase==='failed');assert.ok(await page.locator('#app-startup-message').innerText());assert.equal(navigations,1);assert.equal(await page.locator('#login').evaluate(el=>el.inert),true);
  }else if(mode==='auth-delay'){
   await page.waitForFunction(()=>document.getElementById('app-startup').dataset.phase==='slow',{},{timeout:10000});assert.equal(navigations,1);assert.equal(readCalls,1,'no repeated pending auth request');assert.ok(await page.evaluate(()=>!!localStorage.getItem('zysyr-operations-auth-v1')));
   release();await page.locator('#app-startup').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>!!localStorage.getItem('zysyr-operations-auth-v1')),'transient failure keeps stored auth');assert.equal(await page.locator('#app').isVisible(),false,'no auth bypass');assert.match(await page.locator('#login-error').innerText(),/网络/);
  }else if(mode==='invalid-session'){
   await page.locator('#app-startup').waitFor({state:'hidden'});assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('zysyr-operations-session-v1')),null);assert.equal(readCalls,1);
  }else{
   await page.locator('#app-startup').waitFor({state:'hidden'});await page.locator('#monthly-edit-toggle').click();const input=page.locator('input[data-monthly-cell]').first();await input.fill('543.21');
   const before=await page.evaluate(()=>({value:document.querySelector('input[data-monthly-cell]').value,dirty:JSON.stringify(state.monthlyDirty)}));
   await page.evaluate(()=>{window.dispatchEvent(new ErrorEvent('error',{message:'synthetic late error'}));window.ZysyrStartup.failed();window.ZysyrStartup.finish();document.getElementById('app-startup-retry').click();});
   assert.deepEqual(await page.evaluate(()=>({value:document.querySelector('input[data-monthly-cell]').value,dirty:JSON.stringify(state.monthlyDirty)})),before);assert.equal(navigations,1);assert.equal(await page.locator('#app-startup').isVisible(),false);
  }
  release();assert.equal(writes,0,'no business/auth writes from guard');results.push({mode,passed:true,navigations,readCalls,writes});console.log(mode+' passed');await context.close();
 }
}finally{await browser.close();}
fs.writeFileSync('/tmp/task3-startup-fix-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
