// Real rendering and interaction with synthetic responses; no production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const engine = process.env.FRONTDESK_WEBKIT ? 'webkit' : 'chromium';
const origin = 'https://frontdesk-preview.test';
const user = { username: '预览前台', role: 'admin', position: '前台', store: '界面预览门店', stores: ['界面预览门店'], can_import: true };
const names = ['林女士', '周先生', '陈小姐', '许女士', '沈先生', '顾女士', '欧阳女士（长姓名示例）', '赵先生'];
const barbers = ['林一', '陈安', '周越', '小北', '阿青', '一川'];
const services = ['剪发', '烫发 · 护理', '染发', '剪发 · 头皮护理'];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const bookings = names.map((name, i) => ({ id: 100+i, customer_name: name, customer_phone: `1380000${String(i).padStart(4,'0')}`, barber_name: barbers[i%6], time_label: ['10:30','11:00','12:30','13:00','11:30','14:00','13:30','12:00'][i], service_name: services[i%4] }));
const reception = bookings.slice(0, 5).map((b, i) => ({ ...b, id: `preview-${i}`, business_date: today, arrival_time: b.time_label, service_intent: b.service_name, assistant_name: '小禾', technician_name: '小雨', amount: 380, payment_summary: '微信 · 已核对', status: ['completed','in_service','waiting','arrived','cancelled'][i], reception_notes: '示例接待信息', is_new_customer: i===1, shampoo_qualified: i===0 }));
const ledger = reception.map((r, i) => ({ ...r, record_id: r.id, row_type: i===3?'imported':'today', source: i===3?'历史导入':'当日接待', service_items: r.service_intent, notes: '此处为界面预览的示例记录', amount: i===3?123456.78:380 }));
const detail = { customer: { name: '林女士', phone: '13800000000' }, summary: { visits: 12, consumption: 123456.78, last_visit: today+' 10:30' }, historical_import: { rows: 6 }, packages: [{ package_name:'剪发护理套餐', name:'剪发', left:3, total:5, shop:user.store, expire_date:'2027-06-30' }, { name:'染发护理套餐', left:2, total:3, shop:user.store }], timeline: [{ date:today, source:'美管加消费', items:['剪发','头皮护理'], amount:380, staff:['林一','小禾'], shop:user.store },{date:'2026-08-12',source:'历史导入',items:['染发'],amount:680,staff:['林一'],shop:user.store}] };
detail.packages.push({name:'异店过期套餐',left:1,total:4,shop:'向里造型',expire_date:'2024-05-11',expired:true});
const tinyPhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
detail.hair_records=[{id:'synthetic-hair',archive_store:'',barber:'林一',created_at:today,record_data:{formFields:{'hair-form-perm-notes':'合成配方记录 <script>不执行</script>'},serviceBeforePhoto:tinyPhoto,serviceAfterPhoto:tinyPhoto}}];
detail.hair_scope_note='旧发质档案门店待确认，请在全部门店查看。';

(async () => {
  const browser = await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({...(process.platform==='darwin'?{channel:'chrome'}:{}),headless:true}));
  const unexpected = [], errors = [];
  try {
    for (const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[844,390]]) {
      const context = await browser.newContext({viewport:{width,height},timezoneId:'Asia/Shanghai',hasTouch:width<1100});
      const page = await context.newPage();
      await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=function(fn,ms,...args){if(ms===30000)window.testTodayPoll=fn;return original(fn,ms,...args);};});
      const calls=[];
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
            dashboard:{date:today,store:user.store,barbers,technicians:['小雨'],assistants:['小禾'],bookings:bookings.concat({barber_name:'林一',time_label:'12:00'}),services:[],reception,synced_at:new Date().toISOString()},
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
      const shot=async label=>{if(width===1440||width===390)await page.screenshot({path:`/tmp/frontdesk-minimal-${engine}-${width}-${label}.png`,fullPage:true});};
      await page.goto(origin+'/frontdesk.html');
      await bounded('login');await shot('login');
      await page.locator('#show-register-btn').click();
      await page.locator('#register-store option').nth(1).waitFor({state:'attached'});
      await bounded('registration');await page.locator('#back-login-btn').click();
      await page.locator('#login-user').fill('preview');await page.locator('#login-pass').fill('synthetic');await page.locator('#login-btn').click();
      await page.locator('.schedule-event').first().waitFor();
      assert.equal(await page.locator('.schedule-event').count(),bookings.length,'visual change preserves customer count');
      assert.equal(await page.locator('.schedule-event.green').count(),1);
      assert.equal(await page.locator('.schedule-event.gold').count(),1);
      await bounded('today');await shot('today');
      if(width===1440){
        let release;dashboardHold=new Promise(resolve=>{release=resolve;});
        const response=page.waitForResponse(res=>res.url().includes('/frontdesk-api')&&res.request().postDataJSON().operation==='dashboard');
        await page.evaluate(()=>{window.previousGrid=document.querySelector('.schedule-grid');document.getElementById('today-list').scrollLeft=240;window.testTodayPoll();});
        assert.equal(await page.locator('#refresh-btn').innerText(),'刷新数据','automatic refresh stays quiet');
        assert(await page.evaluate(()=>window.previousGrid===document.querySelector('.schedule-grid')),'pending refresh keeps the schedule visible');
        release();dashboardHold=null;await response;await page.waitForTimeout(50);
        assert(await page.evaluate(()=>window.previousGrid===document.querySelector('.schedule-grid')),'unchanged schedule must not be rebuilt');
        assert.equal(await page.locator('#today-list').evaluate(el=>el.scrollLeft),240,'poll retains horizontal position');
      }
      if(width<681) {
        await page.locator('.schedule-guide').scrollIntoViewIfNeeded();
        assert.ok(await page.locator('.schedule-guide').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'mobile calendar footer is reachable');
        await page.evaluate(()=>scrollTo(0,0));
      }
      const marker=page.locator('.schedule-now');
      if(await marker.count())assert.ok(await marker.evaluate(e=>{
        const grid=e.parentElement,s=getComputedStyle(grid),now=new Date(),start=Number(grid.querySelector('.schedule-time').textContent.split(':')[0])*60;
        const expected=parseFloat(s.getPropertyValue('--staff-col'))+(now.getHours()*60+now.getMinutes()-start)/30*parseFloat(s.getPropertyValue('--slot'));
        return Math.abs(e.offsetLeft-expected)<2;
      }),'current-time line follows responsive slot width');
      assert.equal(await page.locator('header').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(251, 250, 246)','low-glare frontdesk header keeps its warm off-white surface');
      await page.locator('#schedule-right').click();
      await page.waitForFunction(()=>document.querySelector('#today-list').scrollLeft>0);
      await page.locator('#today-list').evaluate(e=>{e.scrollLeft=0;});
      await page.locator('.schedule-event').first().click();
      await page.locator('.delete-today-record').waitFor();await bounded('customer drawer');await shot('drawer');
      await page.locator('.edit-today-record').click();
      assert.equal(await page.locator('#today-amount').inputValue(),'380');
      assert.equal(await page.locator('#today-payment-summary').inputValue(),'微信 · 已核对');
      await bounded('reception form');await shot('form');
      await page.locator('#today-save-btn').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#today-save-btn').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'save control remains reachable');
      await page.locator('#today-form-overlay [data-close]').first().click();await page.locator('#customer-drawer [data-close]').click();
      await page.locator('[data-view="customers"]').click();await page.locator('#customer-query').fill('0000');await page.locator('#customer-search-btn').click();await page.locator('.result').first().click();
      await page.locator('#customer-detail .package').first().waitFor();await bounded('customer archive');await shot('customers');
      assert((await page.locator('#customer-detail').innerText()).includes('异店过期套餐'));
      assert((await page.locator('#customer-detail').innerText()).includes('已过期'));
      await page.locator('#customer-detail details.package summary').click();
      assert.equal(await page.locator('#customer-detail img[alt="服务前照片"]').count(),1);
      assert.equal(await page.locator('#customer-detail img[alt="服务后照片"]').count(),1);
      assert.equal(await page.locator('#customer-detail script').count(),0,'saved form content must be escaped');
      await bounded('shared photos');
      await page.locator('#customer-scope').selectOption('store');
      await page.waitForFunction(()=>document.querySelector('#customer-detail .detail-customer-scope')?.value==='store');
      assert(!(await page.locator('#customer-detail').innerText()).includes('异店过期套餐'));
      assert.equal(await page.locator('#customer-detail details.package').count(),0,'unconfirmed old archives are not guessed into current store');
      assert(calls.some(c=>c.operation==='customer_detail'&&c.customer_scope==='all'));
      assert(calls.some(c=>c.operation==='customer_detail'&&c.customer_scope==='store'));
      await page.locator('[data-view="import"]').click();await page.locator('.table-edit').first().waitFor();await bounded('ledger');await shot('ledger');
      assert.equal(await page.locator('#import-tools').getAttribute('open'),null);
      await page.locator('#import-tools > summary').click();
      await page.locator('#import-tools .drop').waitFor({state:'visible'});await bounded('import');
      await page.locator('.table-edit').first().click();await page.locator('#ledger-form-overlay').waitFor({state:'visible'});
      assert.equal(await page.locator('#ledger-amount').inputValue(),'380');await bounded('ledger edit');
      await page.locator('#ledger-form-overlay [data-close]').first().click();
      await page.locator('[data-view="shampoo"]').click();await page.locator('#shampoo-stats-btn').click();
      await page.getByText('90%',{exact:true}).waitFor();await bounded('stats');await shot('stats');
      await page.locator('[data-view="today"]').click();await page.locator('#add-today-btn').click();
      assert.equal(await page.locator('#today-amount').inputValue(),'','new reception keeps blank amount');
      await page.locator('#today-form-overlay [data-close]').first().click();
      assert.ok(!calls.some(c=>/save|delete|mark|import_records/.test(c.operation)),'preview never writes business data');
      await context.close();console.log(`${engine} ${width}x${height}: all frontdesk views and edit entry points passed`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
