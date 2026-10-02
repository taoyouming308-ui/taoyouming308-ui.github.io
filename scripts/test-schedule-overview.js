// Real rendering and interaction with synthetic responses; no production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const engine = process.env.FRONTDESK_WEBKIT ? 'webkit' : 'chromium';
const origin = 'https://frontdesk-preview.test';
const user = { username: '预览前台', role: 'admin', position: '前台', store: '界面预览门店', stores: ['界面预览门店'], can_import: true };
const oldNames = ['林女士', '周先生', '陈小姐', '许女士', '沈先生', '顾女士', '欧阳女士（长姓名示例）', '赵先生'];
const names=Array.from({length:17},(_,i)=>'示例客户'+(i+1));
const barbers=['林一','陈安','周越','小北','阿青','一川','小禾'];
const services = ['剪发', '烫发 · 护理', '染发', '剪发 · 头皮护理'];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const bookings = names.map((name, i) => ({ id: 100+i, customer_name: name, customer_phone: `1380000${String(i).padStart(4,'0')}`, barber_name: barbers[i%7], time_label: ['09:30','10:00','11:30','12:00','13:30','14:00','15:30','16:00','17:30','18:00','19:30','20:00','21:30','22:30','12:30','14:30','17:00'][i], service_name: services[i%4] }));
const reception = bookings.slice(0, 5).map((b, i) => ({ ...b, id: `preview-${i}`, business_date: today, arrival_time: b.time_label, service_intent: b.service_name, assistant_name: '小禾', technician_name: '小雨', amount: 380, payment_summary: '微信 · 已核对', status: ['completed','in_service','waiting','arrived','cancelled'][i], reception_notes: '示例接待信息', is_new_customer: i===1, shampoo_qualified: i===0 }));
const ledger = reception.map((r, i) => ({ ...r, record_id: r.id, row_type: i===3?'imported':'today', source: i===3?'历史导入':'当日接待', service_items: r.service_intent, notes: '此处为界面预览的示例记录', amount: i===3?123456.78:380 }));
const detail = { customer: { name: '林女士', phone: '13800000000' }, summary: { visits: 12, consumption: 123456.78, last_visit: today+' 10:30' }, historical_import: { rows: 6 }, packages: [{ package_name:'剪发护理套餐', name:'剪发', left:3, total:5, shop:user.store, expire_date:'2027-06-30' }, { name:'染发护理套餐', left:2, total:3, shop:user.store }], timeline: [{ date:today, source:'美管加消费', items:['剪发','头皮护理'], amount:380, staff:['林一','小禾'], shop:user.store },{date:'2026-08-12',source:'历史导入',items:['染发'],amount:680,staff:['林一'],shop:user.store}] };
detail.packages.push({name:'异店过期套餐',left:1,total:4,shop:'向里造型',expire_date:'2024-05-11',expired:true});
const tinyPhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
detail.hair_records=[{id:'synthetic-hair',archive_store:'',barber:'林一',created_at:today,record_data:{formFields:{'hair-form-perm-notes':'合成配方记录 <script>不执行</script>'},serviceBeforePhoto:tinyPhoto,serviceAfterPhoto:tinyPhoto}}];
detail.hair_scope_note='旧发质档案门店待确认，请在全部门店查看。';

(async () => {
  const browser = await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true}));
  const unexpected = [], errors = [];
  try {
    for (const [width,height] of [[1366,768],[1280,800],[1920,1080],[390,844]]) {
      const context = await browser.newContext({viewport:{width,height},timezoneId:'Asia/Shanghai',hasTouch:width<1100});
      const page = await context.newPage();
      await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=function(fn,ms,...args){if(ms===30000)window.testTodayPoll=fn;return original(fn,ms,...args);};});
      const calls=[];let scenarioBookings=bookings,scenarioReception=reception;
      let dashboardHold=null;
      page.on('pageerror', e=>errors.push(e.message));
      await page.route('**/*', async route=>{
        const url=new URL(route.request().url());
        if(url.origin===origin) {
          const file=path.join(root,url.pathname==='/'?'frontdesk.html':url.pathname.slice(1));
          if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
          return route.fulfill({status:200,body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'image/png'});
        }
        if(url.pathname==='/functions/v1/frontdesk-api') {
          const data=route.request().postDataJSON();calls.push(data);
          if(data.operation==='dashboard'&&dashboardHold)await dashboardHold;
          const responses={
            login:{session_token:'synthetic-only',user}, session:{user}, registration_options:{stores:[user.store]},
            dashboard:{date:today,store:user.store,barbers,technicians:['小雨'],assistants:['小禾'],bookings:scenarioBookings.concat({barber_name:'林一',time_label:'12:00'}),services:[],reception:scenarioReception,synced_at:new Date().toISOString()},
            customer_search:{results:[{name:'林女士',phone:'13800000000',last_visit:today,shops:[user.store],remaining_packages:2}]},
            customer_detail:{...detail,customer_scope:data.customer_scope,packages:detail.packages.filter(pkg=>data.customer_scope==='all'||pkg.shop===user.store),hair_records:data.customer_scope==='all'?detail.hair_records:[]},ledger_records:{rows:ledger},import_batches:{batches:[]},
            shampoo_qualification_stats:{month:today.slice(0,7),stats:[{assistant:'小禾',total:20,qualified:18,rate:90},{assistant:'小雨',total:12,qualified:8,rate:66.7}]}
          };
          if(!(data.operation in responses)) { unexpected.push(data.operation);return route.fulfill({status:400,json:{error:'Unexpected preview operation'}}); }
          return route.fulfill({json:responses[data.operation]});
        }
        unexpected.push(url.origin);return route.abort();
      });
      const bounded=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${engine} ${width}: ${label} page overflows`);
      const shot=async label=>{if(width===1440||width===390)if(width>=1280)assert.ok(bounds.bottom<=height,JSON.stringify(bounds));
      await page.screenshot({path:`/tmp/frontdesk-minimal-${engine}-${width}-${label}.png`,fullPage:true});};
      await page.goto(origin+'/frontdesk.html');
      await bounded('login');await shot('login');
      await page.locator('#show-register-btn').click();
      await page.locator('#register-store option').nth(1).waitFor({state:'attached'});
      await bounded('registration');await page.locator('#back-login-btn').click();
      await page.locator('#login-user').fill('preview');await page.locator('#login-pass').fill('synthetic');await page.locator('#login-btn').click();
      await page.locator('.schedule-event').first().waitFor();
      assert.equal(await page.locator('.overview-event').count(),17);
      assert.equal(await page.locator('.overview-row').count(),7);
      await bounded('overview');
      const bounds=await page.locator('#today-list').evaluate(e=>({bottom:e.getBoundingClientRect().bottom,sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight}));
      assert.ok(bounds.sw<=bounds.cw+1);assert.ok(bounds.sh<=bounds.ch+1);
      
      if(width>=1280)assert.ok(bounds.bottom<=height,JSON.stringify(bounds));
      await page.screenshot({path:require('node:path').join(root,`overview-${width}.png`),fullPage:true});
      await page.locator('.overview-event').first().focus();await page.evaluate(()=>{window.testFocused=document.activeElement;window.testTodayPoll();});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.activeElement===window.testFocused));
      await page.locator('.overview-event').first().focus();await page.keyboard.press('Enter');
      await page.locator('#customer-drawer').waitFor({state:'visible'});
      await page.locator('[data-close="customer-drawer"]').click();
      await page.locator('.overview-add').last().click();
      assert.equal(await page.locator('#today-barber').inputValue(),barbers[6]);
      await page.locator('[data-close="today-form-overlay"]').first().click();
      await page.locator('#schedule-mode').click();assert.equal(await page.locator('.schedule-event').count(),17);
      await page.locator('.schedule-slot').nth(2).click();await page.locator('#today-form-overlay').waitFor({state:'visible'});
      await page.locator('[data-close="today-form-overlay"]').first().click();
      await page.locator('#schedule-mode').click();assert.equal(await page.locator('.overview-event').count(),17);
      if(width===1366){
        scenarioBookings=Array.from({length:45},(_,i)=>({...bookings[i%17],id:500+i,customer_phone:'1390000'+String(i).padStart(4,'0'),customer_name:'密集示例'+(i+1),barber_name:barbers[0],time_label:'12:00',duration_minutes:90}));scenarioReception=[];
        await page.locator('#refresh-btn').click();await page.waitForFunction(()=>document.querySelectorAll('.overview-event').length===45);
        assert.equal(await page.locator('.overview-event b').count(),45);await bounded('dense');
        assert.ok(await page.locator('#today-list').evaluate(e=>e.scrollHeight<=e.clientHeight+1));
        await page.screenshot({path:require('node:path').join(root,'overview-dense.png'),fullPage:true});
        await page.locator('.overview-event').last().click();await page.locator('#customer-drawer').waitFor({state:'visible'});await page.locator('[data-close="customer-drawer"]').click();
        scenarioBookings=[];await page.locator('#refresh-btn').click();await page.waitForFunction(()=>document.querySelectorAll('.overview-event').length===0);
        assert.equal(await page.locator('.overview-row').count(),7);assert.equal(await page.locator('.overview-empty').count(),7);
        await page.locator('.overview-add').last().click();assert.equal(await page.locator('#today-barber').inputValue(),barbers[6]);
      }
      console.log(JSON.stringify({width,height,bounds,clients:17,staff:7}));
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
