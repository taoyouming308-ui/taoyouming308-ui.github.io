// Two actual tabs, delayed synthetic reads and no contact with production.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require('playwright'), root=path.resolve(__dirname,'..'), origin='http://127.0.0.1:45292';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{for(const change of ['logout','replace']){
    const ctx=await browser.newContext({serviceWorkers:'block'}), key='zysyr-frontdesk-session-v1';
    const user={username:'synthetic-employee',store:'mock-store-A',stores:['mock-store-A'],role:'staff',can_import:false};
    const saved={session_token:'test-only-session-token-with-over-24-bytes',user};
    let held=null,allow,delay=false;
    const late=new Promise(resolve=>{allow=resolve;}), calls=[];
    await ctx.route('**/*',async r=>{
      const u=new URL(r.request().url());
      if(u.origin===origin){
        if(u.pathname==='/blank')return r.fulfill({body:'<!doctype html>',contentType:'text/html'});
        const f=path.resolve(root,'.'+u.pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return r.fulfill({status:404,body:''}).catch(()=>{});
        return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'application/json'}).catch(()=>{});
      }
      const b=r.request().postDataJSON();calls.push(b.operation);let data={};
      if(b.operation==='session')data={user};
      else if(b.operation==='dashboard'){
        const name=delay?'LATE_PRIVATE_ROW':'CURRENT_PRIVATE_ROW';
        if(delay){held=true;await late;}
        data={store:user.store,date:b.date,bookings:[{id:'booking',customer_name:name,customer_phone:'55512345678',barber_name:user.username,time_label:'10:00'}],barbers:[user.username]};
      }else if(b.operation==='registration_options')data={stores:[user.store]};
      else if(b.operation==='business_details')data={available:false,store:user.store,date:b.date};
      else throw Error('unexpected simulated operation: '+b.operation);
      return r.fulfill({json:data}).catch(()=>{});
    });
    const other=await ctx.newPage();await other.goto(origin+'/blank');
    await other.evaluate(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),[key,saved]);
    const page=await ctx.newPage();await page.goto(origin+'/frontdesk.html',{waitUntil:'domcontentloaded'});
    await page.locator('#today-list').getByText('CURRENT_PRIVATE_ROW',{exact:false}).first().waitFor();
    delay=true;await page.locator('#refresh-btn').click();
    for(let i=0;!held&&i<200;i++)await new Promise(r=>setTimeout(r,10));assert(held,'dashboard in flight');
    await other.evaluate(([k,change])=>{if(change==='logout')localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify({session_token:'next-secret',user:{username:'other',store:'mock-store-B'}}));},[key,change]);
    await page.locator('#frontdesk-scope-message').waitFor();
    assert.equal(await page.locator('#today-list').textContent(),'','existing rows scrubbed');
    const observed=page.waitForResponse(res=>res.request().postDataJSON()?.operation==='dashboard');
    allow();await observed;
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert(!(await page.locator('body').textContent()).includes('LATE_PRIVATE_ROW'),'late response rejected');
    assert.equal(await page.locator('#frontdesk-scope-message').isVisible(),true);
    assert.equal(await other.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null')?.session_token||null,key),change==='logout'?null:'next-secret');
    assert(!calls.includes('logout'),'locking stale tab must not revoke current account');
    await ctx.close();
  }}finally{await browser.close();}
  console.log('PASS: cross-tab logout and switched account immediately mask and scrub previous rows; late pending dashboard never appears; new session untouched');
})().catch(e=>{console.error(e);process.exitCode=1;});
