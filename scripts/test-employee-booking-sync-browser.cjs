// Fresh isolated Chromium; every request is fulfilled locally. No real employee or customer data.
const { chromium } = require('playwright'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..'), origin = 'http://127.0.0.1:45291';
const user = {username:'synthetic-user',store:'synthetic-store',position:'synthetic-role'};
const phone = '55500011199', name = '合成测试顾客';
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    let notifyRead;
    function nextRead(){
      assert(!notifyRead,'previous synthetic read is still pending');
      let timer;
      return new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('expected pending booking read')),8000);
        notifyRead=route=>{clearTimeout(timer);resolve(route);};
      });
    }
    function bookingsReply(route,rows){ const date=route.request().postDataJSON().date;return {date,store:user.store,barber:user.username,rows:rows.map(row=>({...row,date}))}; }
    const fixtureRow={id:'mock-1',customer_name:name,customer_phone:phone,barber_name:user.username,time_label:'09:00',service_name:'剪发',source:'frontdesk'};
    await ctx.addInitScript(user=>{
      sessionStorage.setItem('zysyr-scoped-read-preview','1');
      if(!localStorage.getItem('test-setup')){
        localStorage.setItem('test-setup','1');
        localStorage.setItem('booking-session',JSON.stringify({...user,session_token:'synthetic-secret-that-is-at-least-24-bytes-long',loggedAt:Date.now()}));
        localStorage.setItem('bookings_cache_OLD-synthetic','legacy');
        localStorage.setItem('hair-form-draft-test','untouched');
      }
    },user);
    await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!==origin){
        let result=[];
        if(route.request().method()==='POST'){
          const b=route.request().postDataJSON();
          assert(['session','today_bookings','report_access','bootstrap'].includes(b.operation),'only known synthetic reads allowed: '+b.operation);
          if(b.operation==='today_bookings'){
            if(notifyRead){const f=notifyRead;notifyRead=null;f(route);return;}
            result=bookingsReply(route,[fixtureRow]);
          }else result=b.operation==='session'?{user}:{enabled:false};
        }
        return route.fulfill({json:result}).catch(()=>{});
      }
      const f=path.resolve(root,'.'+u.pathname);
      if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''}).catch(()=>{});
      const type=f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'application/json';
      return route.fulfill({body:fs.readFileSync(f),contentType:type}).catch(()=>{});
    });
    const page=await ctx.newPage();
    const list=page.locator('#booking-list');
    async function assertQuiet(){
      await list.getByRole('status',{name:'正在核对预约',exact:true}).waitFor({state:'attached'});
      assert.equal((await list.innerText()).trim(),'','normal verification is visually silent');
      assert.equal(await list.locator(':scope > *').count(),1,'only the accessible status placeholder remains');
      assert.equal(await list.locator('.booking-item,button,[data-phone]').count(),0,'no rows, actions or phone data before verification');
    }
    await page.goto(origin+'/perm-app.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof openFeature==='function'&&!document.getElementById('identity-recovery'));
    const first=nextRead();
    await page.evaluate(()=>openFeature('bookings'));
    const cold=await first;await assertQuiet();await cold.fulfill({json:bookingsReply(cold,[fixtureRow])});
    await list.getByText(name,{exact:true}).waitFor();
    await page.evaluate(()=>{window.firstBooking=document.querySelector('.booking-item');goHome()});
    const revisit=nextRead();await page.evaluate(()=>openFeature('bookings'));
    const unchanged=await revisit;
    assert(await list.getByText(name,{exact:true}).isVisible(),'same-page revisit shows the original row before the request returns');
    assert(await list.evaluate(el=>el.inert),'cached data cannot initiate an action');
    await unchanged.fulfill({json:bookingsReply(unchanged,[fixtureRow])});
    await page.waitForFunction(()=>!document.getElementById('booking-list').inert);
    assert(await page.evaluate(()=>firstBooking===document.querySelector('.booking-item')),'no rebuild on an unchanged result');
    const day=await page.locator('#date-strip .date-chip.on').getAttribute('data-date');
    const another=await page.locator('#date-strip .date-chip:not(.on)').first().getAttribute('data-date');
    const switchDay=nextRead();await page.evaluate(d=>pickDate(d),another);const newDay=await switchDay;
    await assertQuiet();
    await newDay.fulfill({json:bookingsReply(newDay,[])});await list.getByText('当天暂无预约',{exact:true}).waitFor();
    const back=nextRead();await page.evaluate(d=>pickDate(d),day);const changed=await back;
    assert(await list.getByText(name,{exact:true}).isVisible(),'previously visited date restored from memory');
    await changed.fulfill({json:bookingsReply(changed,[{...fixtureRow,customer_name:'合成改期顾客',time_label:'10:30'}])});
    await list.getByText('合成改期顾客',{exact:true}).waitFor();
    await page.waitForFunction(async()=>{
      const db=await new Promise(resolve=>{const req=indexedDB.open('zysyr-scoped-reads-v1');req.onsuccess=()=>resolve(req.result);});
      try {if(!db.objectStoreNames.contains('reads'))return false;
        const rows=await new Promise(resolve=>{const r=db.transaction('reads').objectStore('reads').getAll();r.onsuccess=()=>resolve(r.result);});
        return rows.some(r=>r.blob instanceof ArrayBuffer && r.iv instanceof Uint8Array);
      }finally{db.close();}
    });
    const second=nextRead();await page.reload({waitUntil:'domcontentloaded'});
    const offline=await second;await assertQuiet();
    assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('hair-form-draft-test'),localStorage.getItem('bookings_cache_OLD-synthetic')]),['untouched',null]);
    await offline.fulfill({status:503,json:{error:'synthetic offline'}});
    // A failed read exposes only the actual cached count and retry hint, not a verified empty list.
    await list.getByText(/上次读取有 1 条预约.*尚未核实.*重试/).waitFor();
    assert.doesNotMatch(await list.innerText(),/当天暂无预约/);assert.equal(await list.locator('.booking-item,button,[data-phone]').count(),0);
    const third=nextRead();await page.evaluate(()=>openFeature('bookings'));const empty=await third;await assertQuiet();
    await empty.fulfill({json:bookingsReply(empty,[])});await list.getByText('当天暂无预约',{exact:true}).waitFor();
    const fourth=nextRead();await page.evaluate(()=>openFeature('bookings'));const denied=await fourth;
    assert(await list.getByText('当天暂无预约',{exact:true}).isVisible());
    assert(await list.evaluate(el=>el.inert));
    await denied.fulfill({status:403,json:{error:'账号已停用，请重新登录'}});
    await page.locator('#identity-modal').waitFor();
    assert.equal(await list.textContent(),'');
    assert.equal(await page.evaluate(()=>localStorage.getItem('booking-session')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hair-form-draft-test')),'untouched');
    console.log('PASS synthetic 390px Chromium: quiet accessible cold/warm reads, encrypted count only in retry warning, verified rows/empty distinct from offline, revocation clears list, draft retained');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
