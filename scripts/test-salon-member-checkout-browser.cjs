// Explicit opt-in: disposable PostgreSQL + headless Chrome, synthetic records only.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app,browser;try{
 app=await startServer();browser=await chromium.launch({channel:'chrome',headless:true});
 app.sql(`insert into public.salon_role_permissions(role_id,resource,action) values(1,'orders','checkout'),(1,'members','read');
 insert into public.salon_customers(organization_id,display_name,status) values(1,'合成储值顾客','active');
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
 insert into public.salon_member_accounts(organization_id,customer_id,account_type,account_no,display_name,home_store_id,usable_scope,status,cash_balance) values(1,1,'stored_value','SYNTHETIC-CARD-0001','合成储值卡',1,'store','active',200);
 insert into public.salon_orders(organization_id,store_id,order_no,customer_id,status,subtotal,payable_total) values(1,1,'SYNTHETIC-MEMBER-ORDER-A',1,'awaiting_payment',100,100),(1,1,'SYNTHETIC-MEMBER-ORDER-B',1,'awaiting_payment',100,100);
 insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,quantity,unit_price,line_total,item_code,item_name,item_type) values(1,1,1,1,100,100,'TEST-P','合成商品','product'),(1,2,1,1,100,100,'TEST-P','合成商品','product');
 update public.salon_catalog_store_settings set stock_tracked=true where store_id=1 and catalog_item_id=1;
 insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id,quantity) values(1,1,1,20);`);
 const errors=[];let dropped=false,lookupDebug=null;
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',r=>new URL(r.request().url()).origin===app.url?r.continue():r.abort());
  await page.route('**/api/salon',async route=>{
   const body=route.request().postDataJSON();
   if(width===390&&!dropped&&body.operation==='checkout'){
    dropped=true;await route.fetch();return route.abort('failed');
   }
   if(body.operation==='request_lookup'&&body.targetOperation==='checkout'){
    const response=await route.fetch();lookupDebug=await response.json();return route.fulfill({response,json:lookupDebug});
   }
   return route.continue();
  });
  const connect=async()=>{await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();};
  const orderId=width===1280?1:2;
  const load=async()=>{await page.locator('#listOrders').click();await page.locator(`#orderList article[data-order-id="${orderId}"]`).getByText('载入订单处理',{exact:true}).click();await page.getByText('已载入订单处理，尚未修改状态或收款。',{exact:true}).waitFor();};
  await page.goto(app.url);await connect();await load();
  await page.locator('#loadMemberAccounts').click();
  try{await page.locator('#memberCheckoutAccount:not([disabled])').waitFor({timeout:5000});}
  catch{throw Error(`会员账户读取未完成: ${await page.locator('#status').textContent()} / ${await page.locator('#memberCheckoutStatus').textContent()}`);}
  await page.locator('#memberCheckoutAccount').selectOption('1');
  assert.match(await page.locator('#memberCheckoutAccount').textContent(),/····0001/);assert.doesNotMatch(await page.locator('#memberCheckoutAccount').textContent(),/SYNTHETIC-CARD/);
  await page.locator('#memberValueAmount').fill('40');await page.locator('#memberCashTendered').fill('70');await page.locator('#previewMemberCheckout').click();
  await page.getByText(/储值扣款 ¥40\.00 · 现金余款 ¥60\.00 · 现金实收 ¥70\.00 · 找零 ¥10\.00/).waitFor();assert.equal(await page.locator('#confirmMemberCheckout').isDisabled(),false);
  await page.locator('#confirmMemberCheckout').click();
  if(width===1280){
   try{await page.getByText(/会员储值收银已按原请求核对/).waitFor({timeout:5000});}
   catch{throw Error(`桌面收银未完成: ${await page.locator('#status').textContent()} / ${await page.locator('#memberCheckoutStatus').textContent()} / ${JSON.stringify(lookupDebug)}`);}
   assert.equal(app.sql('select cash_balance from public.salon_member_accounts where id=1'),'160.00');
   assert.equal(app.sql("select count(*) from public.salon_account_ledger where entry_type='consume'"),'1');
  }else{
   await page.getByText(/未收到有效结果/).waitFor();
   assert.equal(app.sql('select cash_balance from public.salon_member_accounts where id=1'),'120.00');
   assert.equal(app.sql(`select count(*) from public.salon_payments where order_id=${orderId}`),'2');
   await page.reload();await connect();
   const options=await page.locator('#recoveryRequest option').evaluateAll(rows=>rows.map(x=>({value:x.value,label:x.textContent})));
   const checkout=options.find(x=>x.label.includes('checkout'));
   if(!checkout)throw Error('刷新后没有待核对的合成收银请求');await page.locator('#recoveryRequest').selectOption(checkout.value);
   await page.locator('#lookupRequest').click();
   try{await page.getByText('刷新恢复：原收银请求已核对',{exact:true}).waitFor({timeout:5000});}
   catch{throw Error(`刷新恢复失败: ${await page.locator('#status').textContent()} / ${await page.locator('#recoveryStatus').textContent()} / ${JSON.stringify(lookupDebug)}`);}
   assert.equal(app.sql('select cash_balance from public.salon_member_accounts where id=1'),'120.00');
   assert.equal(app.sql("select count(*) from public.salon_account_ledger where entry_type='consume'"),'2');
   assert.match(await page.locator('#cashResult').textContent(),/没有重放支付/);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('Member checkout browser passed: real local handler/RPC, masked account, explicit split preview, direct confirmation, lost-response reload recovery, no duplicate debit, desktop/mobile');
}finally{if(browser)await browser.close();if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
