// Explicit opt-in: Chrome + disposable PostgreSQL, no external traffic or real data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{
 let app,browser,activePage;
 try{
  app=await startServer();browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:844}});activePage=page;const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===app.url?route.continue():route.abort());
   await page.goto(app.url);await page.locator('#connect').click();
   await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
   assert.equal(await page.locator('#store option').count(),3);
   const name=`合成 ${width} <img src=x onerror=alert(1)> O'Brien`;
   await page.locator('#name').fill(name);
   // Lose a successful response: retry must return the same database customer.
   let dropped=false;
   await page.route('**/api/salon',async route=>{
    if(!dropped&&route.request().postDataJSON().operation==='customer_create'){
     dropped=true;await route.fetch();await route.abort('failed');
    }else await route.continue();
   });
   await page.locator('#createCustomer').click();await page.locator('#retry:not([disabled])').waitFor();
   await page.locator('#retry').click();await page.locator('#panel:not([disabled])').waitFor();
   assert.equal(await page.locator('#customer option:checked').textContent(),name);
   const customerId=await page.locator('#customer').inputValue();
   assert.equal(app.sql(`select count(*) from public.salon_customers where id=${Number(customerId)};`),'1');
   await page.locator('#item').selectOption('1');await page.locator('#createOrder').click();
   await page.locator('#saveLines:not([disabled])').waitFor();await page.locator('#panel:not([disabled])').waitFor();
   await page.locator('#saveLines').click();await page.getByText(/明细已从数据库读取确认/).waitFor();
   assert.equal(app.sql(`select payable_total from public.salon_orders where customer_id=${Number(customerId)};`),'12.34');
   await page.locator('#store').selectOption('2');await page.getByText('已切换门店，旧选择已清除。',{exact:true}).waitFor();
   assert.equal(await page.locator('#customer option').count(),1);assert.equal(await page.locator('#customer').inputValue(),'');
   assert.equal(await page.locator('#order').textContent(),'尚未创建订单');
   const boundary=await page.evaluate(async customerId=>{
    const {token}=await (await fetch('/__salon_test_session',{method:'POST'})).json();
    const call=body=>fetch('/api/salon',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)}).then(r=>r.status);
    const crossStore=await call({operation:'order_create',storeId:2,customerId:Number(customerId),requestKey:'cross-store-rejected-test'});
    return [await call({operation:'context',storeId:3}),await call({operation:'checkout',storeId:1}),localStorage.length,document.documentElement.scrollWidth,innerWidth,crossStore];
   },customerId);
   assert.deepEqual(boundary.slice(0,3),[403,403,0]);assert.ok(boundary[3]<=boundary[4]);assert.deepEqual(errors,[]);
   assert.equal(boundary[5],400,'another store cannot create an order for this customer');
   await page.close();
  }
  assert.equal(app.sql('select count(*) from public.salon_customers;'),'2');
  assert.equal(app.sql('select count(*) from public.salon_orders;'),'2');
  assert.equal((await fetch(app.url+'/__salon_test_session',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(app.url+'/api/salon',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"operation":"context"}'})).status,403);
  console.log('Workbench: 1280/390 browser → HTTP → real handler → PostgreSQL, lost response replay and store boundaries passed');
 }catch(error){if(activePage&&!activePage.isClosed())console.error('Workbench status:',await activePage.locator('#status').textContent());throw error;}
 finally{if(browser)await browser.close();if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
