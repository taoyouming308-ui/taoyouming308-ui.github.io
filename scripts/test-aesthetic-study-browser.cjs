const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict'),{chromium}=require('playwright');
const feed=JSON.parse(fs.readFileSync('docs/aesthetic-training/feed.v1.json')),item=feed.items[0],version=crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');
const manifest=[{id:item.id,title:item.title,date:item.date,version}];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:process.platform==='darwin'?{channel:'chrome'}:{})});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[],synced=[];let offline=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async r=>{
   const url=r.request().url();if(url.includes('/functions/v1/aesthetic-study')){
    const p=r.request().postDataJSON();if(offline)return r.abort('internetdisconnected');
    if(p.operation==='bootstrap')return r.fulfill({json:{user:{id:p.session_token==='second-token'?2:1,username:'synthetic',store:'A'},server_time:Date.now(),cases:manifest,rows:[]}});
    if(p.operation==='sync'){synced.push(p);return r.fulfill({json:{accepted:p.events.map(e=>e.event_id)}});}
   }
   if(url.includes('feed.v1.json'))return r.fulfill({json:feed});
   if(url.endsWith(item.image))return r.fulfill({body:fs.readFileSync(item.image),contentType:'image/jpeg'});
   return r.fulfill({body:'<!doctype html><meta charset="utf-8"><style>body{margin:16px;font:16px sans-serif}img{max-width:100%}.hidden{display:none}</style><section class="tab-content active"><div id="perm-academy-root"></div></section><script>const SUPABASE_URL="https://db.test",SUPABASE_KEY="synthetic-public";</script>'});
  });
  await page.goto('https://study.test/');await page.evaluate(async()=>{localStorage.setItem('booking-session',JSON.stringify({session_token:'first-token'}));localStorage.setItem('aesthetic_daily_learning_v1',JSON.stringify({completed:['legacy-only']}));});
  await page.clock.install();await page.addScriptTag({path:'aesthetic-study.js'});await page.addScriptTag({path:'aesthetic-daily.js'});
  await page.getByRole('button',{name:'标记学完',exact:true}).waitFor();await page.waitForFunction(()=>window.AestheticStudy.ready());await page.waitForTimeout(100);
  await page.getByRole('button',{name:'标记学完',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'已学完 ✓'}).count(),1,await page.locator('[data-study-status]').innerText());
  await page.clock.runFor(20000);await page.clock.runFor(20000);await page.clock.runFor(20000);await page.waitForTimeout(100);
  assert(synced.some(p=>p.events.some(e=>e.kind==='complete')));assert(synced.some(p=>p.events.some(e=>e.kind==='time')));
  assert(synced.every(p=>p.employee_id===1&&p.events.every(e=>!('username'in e)&&!('employee_answer'in e))));
  const queueBefore=await page.evaluate(async()=>(await new Promise((resolve,reject)=>{const r=indexedDB.open('aesthetic-study-records-v1',1);r.onsuccess=()=>{const q=r.result.transaction('events').objectStore('events').index('employee_id').getAll(1);q.onsuccess=()=>resolve(q.result);q.onerror=reject;};r.onerror=reject;})));
  await page.clock.runFor(80000);await page.waitForTimeout(100);
  assert(!synced.slice(1).some(p=>p.events.some(e=>e.kind==='time'&&Date.parse(e.at)>Date.parse(synced[0].events.at(-1).at)+60000)));
  // Hide the actual study tab: no time during another App page.
  await page.evaluate(async()=>document.querySelector('section').classList.add('hidden'));await page.clock.runFor(40000);await page.waitForTimeout(50);
  const countBefore=synced.flatMap(p=>p.events).filter(e=>e.kind==='time').length;
  await page.clock.runFor(60000);await page.waitForTimeout(100);assert.equal(synced.flatMap(p=>p.events).filter(e=>e.kind==='time').length,countBefore);
  await page.evaluate(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(120000);await page.waitForTimeout(100);assert.equal(synced.flatMap(p=>p.events).filter(e=>e.kind==='time').length,countBefore);
  await page.evaluate(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.evaluate(async()=>document.querySelector('section').classList.remove('hidden'));offline=true;await page.mouse.click(8,8);await page.clock.runFor(20000);await page.clock.runFor(60000);await page.waitForTimeout(100);
  const pending=await page.evaluate(async()=>(await new Promise((resolve,reject)=>{const r=indexedDB.open('aesthetic-study-records-v1',1);r.onsuccess=()=>{const q=r.result.transaction('events').objectStore('events').index('employee_id').getAll(1);q.onsuccess=()=>resolve(q.result);q.onerror=reject;};r.onerror=reject;})));assert(pending.length>0);
  const events=new Set(synced.flatMap(p=>p.events).map(e=>e.event_id));assert(pending.some(e=>!events.has(e.event_id)));
  offline=false;await page.evaluate(async()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(200);
  assert.equal(await page.evaluate(async()=>(await new Promise((resolve,reject)=>{const r=indexedDB.open('aesthetic-study-records-v1',1);r.onsuccess=()=>{const q=r.result.transaction('events').objectStore('events').index('employee_id').getAll(1);q.onsuccess=()=>resolve(q.result);q.onerror=reject;};r.onerror=reject;})).length),0);
  await page.evaluate(async()=>{localStorage.setItem('booking-session',JSON.stringify({session_token:'second-token'}));window.dispatchEvent(new Event('staff-identity-changed'));});await page.waitForTimeout(200);
  assert.equal(await page.getByRole('button',{name:'标记学完',exact:true}).count(),1);
  const last=synced.length;await page.getByRole('button',{name:'标记学完',exact:true}).click();await page.evaluate(async()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(150);
  assert(synced.slice(last).every(p=>p.employee_id===2));assert.deepEqual(errors,[]);
  assert(await page.evaluate(async()=>document.documentElement.scrollWidth<=innerWidth));
  fs.mkdirSync('artifacts/study',{recursive:true});await page.screenshot({path:'artifacts/study/employee-'+width+'.png',fullPage:true});await context.close();
 }
 console.log('study browser390/1280: verified binding, distinct marks, inactivity/other tab pause, offline retry, account switch, minimal payload passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
