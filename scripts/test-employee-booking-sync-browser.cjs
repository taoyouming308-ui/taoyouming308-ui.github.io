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
    let held,hold=false;
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
            if(hold){held=route;return;}
            result={date:b.date,store:user.store,barber:user.username,rows:[{id:'mock-1',customer_name:name,customer_phone:phone,
              date:b.date,barber_name:user.username,time_label:'09:00',service_name:'剪发',source:'frontdesk'}]};
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
    await page.goto(origin+'/perm-app.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof openFeature==='function'&&!document.getElementById('identity-recovery'));
    await page.evaluate(()=>openFeature('bookings'));
    await page.locator('#booking-list').getByText(name,{exact:true}).waitFor();
    await page.waitForFunction(async()=>{
      const db=await new Promise(resolve=>{const req=indexedDB.open('zysyr-scoped-reads-v1');req.onsuccess=()=>resolve(req.result);});
      try {if(!db.objectStoreNames.contains('reads'))return false;
        const rows=await new Promise(resolve=>{const r=db.transaction('reads').objectStore('reads').getAll();r.onsuccess=()=>resolve(r.result);});
        return rows.some(r=>r.blob instanceof ArrayBuffer && r.iv instanceof Uint8Array);
      }finally{db.close();}
    });
    hold=true;await page.reload({waitUntil:'domcontentloaded'});
    const list=page.locator('#booking-list');
    await list.getByText(/上次读取有 1 条预约/).waitFor();
    assert.equal(await list.locator('button').count(),0);
    assert(!(await list.innerText()).includes(name));
    assert(!await list.locator('[data-phone]').count());
    assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('hair-form-draft-test'),localStorage.getItem('bookings_cache_OLD-synthetic')]),['untouched',null]);
    await page.waitForFunction(()=>document.getElementById('booking-list').textContent.includes('正在核对'));
    if(!held) await new Promise((resolve,reject)=>{let count=0;const timer=setInterval(()=>{if(held||++count>=200){clearInterval(timer);held?resolve():reject(Error('expected pending booking read'));}},10);});
    await held.fulfill({status:403,json:{error:'账号已停用，请重新登录'}});
    await page.locator('#identity-modal').waitFor();
    assert.equal(await list.textContent(),'');
    assert.equal(await page.evaluate(()=>localStorage.getItem('booking-session')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hair-form-draft-test')),'untouched');
    console.log('PASS synthetic 390px Chromium: same-session encrypted count restored after reload, private rows/actions withheld, revocation clears preview; draft retained');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
