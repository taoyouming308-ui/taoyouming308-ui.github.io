const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app,browser;try{
 app=await startServer();
 app.sql(`insert into public.salon_customers(organization_id,display_name) values(1,'合成顾客');
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
 insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id) values(1,1,'22222222-2222-4222-8222-222222222222');
 insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price,duration_minutes) values(1,'service','DUAL','合成服务',10,30);
 insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id) values(1,1,2);`);
 const call=q=>JSON.parse(app.sql(`set role service_role;select ${q}`));
 const {instantToStoreInput}=await import('../packages/salon-core/store-time.mjs');
 app.sql("update public.salon_stores set timezone='America/New_York' where id=2");
 assert.deepEqual(call('public.salon_get_store_time_context(1,1,1)'),{organizationId:1,storeId:1,timeZone:'Asia/Shanghai',timeVersion:0});
 assert.throws(()=>call('public.salon_get_store_time_context(1,1,3)'));
 assert.throws(()=>call("public.salon_customer_get_store_time_context('22222222-2222-4222-8222-222222222222',2,1)"));
 for(const role of ['anon','authenticated'])assert.equal(app.sql(`select has_function_privilege('${role}','public.salon_get_store_time_context(bigint,bigint,bigint)','EXECUTE') or has_function_privilege('${role}','public.salon_customer_get_store_time_context(uuid,bigint,bigint)','EXECUTE')`),'f');
 browser=await chromium.launch({channel:'chrome',headless:true});
 let i=0;
 for(const width of [1280,390]){
  i++;const b=call(`public.salon_customer_request_booking('22222222-2222-4222-8222-222222222222',1,1,'dual-booking-0000${i}',2,1,current_date+interval '${i+10} days 10 hours',current_date+interval '${i+10} days 10 hours 30 minutes','合成')`);
  call(`public.salon_review_customer_booking(1,1,1,${b.bookingRequestId},'dual-confirm-0000${i}','confirmed',1,'合成确认')`);
  const original=app.sql(`select starts_at from public.salon_customer_booking_requests where id=${b.bookingRequestId}`),target=new Date(Date.parse(original)+48*3600000).toISOString();
  const customer=await browser.newPage({viewport:{width,height:844},timezoneId:'America/Los_Angeles'}),staff=await browser.newPage({viewport:{width,height:844},timezoneId:'Asia/Tokyo'}),errors=[];
  for(const page of [customer,staff]){page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===app.url?route.continue():route.abort());}
  let customerToken,staffToken;
  customer.on('request',r=>{if(r.url().endsWith('/api/salon-customer'))customerToken=r.headers().authorization;});
  staff.on('request',r=>{if(r.url().endsWith('/api/salon'))staffToken=r.headers().authorization;});
  await customer.goto(app.url+'/customer');await customer.locator('#connect').click();await customer.getByText('已连接合成顾客，仅显示本人数据。',{exact:true}).waitFor();
  const timeCheck=await customer.evaluate(async()=>{const t=await import('/packages/salon-core/store-time.mjs');return {shanghai:t.storeTimeToInstant('2026-09-07T00:15','Asia/Shanghai'),gap:t.resolveStoreTime('2026-03-08T02:30','America/New_York').status,fold:t.resolveStoreTime('2026-11-01T01:30','America/New_York').instants.length};});
  assert.deepEqual(timeCheck,{shanghai:'2026-09-06T16:15:00.000Z',gap:'nonexistent',fold:2});
  assert.match(await customer.locator('#timeZone').textContent(),/Asia\/Shanghai/);
  await customer.locator('#booking').selectOption(String(b.bookingRequestId));assert.equal(await customer.locator('#starts').inputValue(),instantToStoreInput(new Date(original).toISOString(),'Asia/Shanghai'));await customer.locator('#starts').fill(instantToStoreInput(target,'Asia/Shanghai'));await customer.locator('#reason').fill('合成行程变化');
  let dropped=false;
  await customer.route('**/api/salon-customer',async route=>{if(!dropped&&route.request().postDataJSON().operation==='reschedule_request'){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await customer.locator('#submit').click();await customer.locator('#retry:not([disabled])').waitFor();assert.equal(await customer.locator('#submit').isDisabled(),true);assert.equal(await customer.locator('#connect').isDisabled(),true);
  await customer.locator('#retry').click();await customer.getByText('申请已提交，原档期保留，等待门店确认。',{exact:true}).waitFor();
  assert.equal(app.sql(`select starts_at from public.salon_customer_booking_requests where id=${b.bookingRequestId}`),original);
  const id=app.sql(`select id from public.salon_booking_change_requests where booking_request_id=${b.bookingRequestId}`);assert.match(id,/^\d+$/);
  await staff.goto(app.url);await staff.locator('#connect').click();await staff.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
  const post=async(path,auth,body)=>fetch(app.url+path,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/salon',customerToken,{operation:'context'})).status,403);
  assert.equal((await post('/api/salon-customer',staffToken,{operation:'context'})).status,403);
  await staff.locator('#changeRequest').selectOption(id);await staff.locator('#changeReason').fill('合成复核');
  if(width===390){
   app.sql(`insert into public.salon_schedule_blocks(organization_id,store_id,staff_id,block_type,starts_at,ends_at) values(1,1,1,'leave','${target}','${target}'::timestamptz+interval '1 hour')`);
   await staff.locator('#approveChange').click();await staff.getByText(/新档期与预约或休假冲突/).waitFor();assert.equal(app.sql(`select status from public.salon_booking_change_requests where id=${id}`),'submitted');
   await staff.locator('#rejectChange').click();await staff.getByText('改期申请已拒绝，原预约保留。',{exact:true}).waitFor();
   assert.equal(app.sql(`select starts_at from public.salon_customer_booking_requests where id=${b.bookingRequestId}`),original);
  }else{
   let lost=false;await staff.route('**/api/salon',async route=>{if(!lost&&route.request().postDataJSON().operation==='reschedule_review'){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
   await staff.locator('#approveChange').click();await staff.locator('#retry:not([disabled])').waitFor();await staff.locator('#retry').click();await staff.getByText('改期申请已批准，预约已更新。',{exact:true}).waitFor();
   assert.equal(Date.parse(app.sql(`select starts_at from public.salon_customer_booking_requests where id=${b.bookingRequestId}`)),Date.parse(target));
  }
  await customer.locator('#refresh').click();await customer.getByText('已刷新本人数据。',{exact:true}).waitFor();assert.match(await customer.locator('#results').textContent(),width===390?/已拒绝/:/已批准/);
  assert.equal(app.sql(`select count(*) from public.salon_audit_events where entity_type='booking_change' and entity_id='${id}' and action='review'`),'1');
  await staff.locator('#changeReason').fill('切店须清除');await staff.locator('#store').selectOption('2');await staff.getByText('已切换门店，旧选择已清除。',{exact:true}).waitFor();assert.equal(await staff.locator('#changeReason').inputValue(),'');assert.equal(await staff.locator('#changeRequest option').count(),1);assert.match(await staff.locator('#timeZone').textContent(),/America\/New_York/);
  for(const page of [customer,staff])assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await customer.evaluate(()=>localStorage.length+sessionStorage.length),0);
  if(width===390)await customer.screenshot({path:'/private/tmp/salon-customer-mobile.png',fullPage:true});
  await customer.locator('#logout').click();await customer.getByText('顾客会话已退出，旧令牌已撤销。',{exact:true}).waitFor();assert.equal((await post('/api/salon-customer',customerToken,{operation:'context'})).status,403);assert.equal(await customer.locator('#booking option').count(),1);
  assert.deepEqual(errors,[]);await customer.close();await staff.close();
 }
 // Revocation clears rendered data. Unbound logins cannot auto-create a customer.
 const revoked=await browser.newPage();await revoked.goto(app.url+'/customer');await revoked.locator('#connect').click();await revoked.getByText('已连接合成顾客，仅显示本人数据。',{exact:true}).waitFor();
 await revoked.locator('#booking').selectOption({index:1});await revoked.locator('#starts').fill('2030-01-01T10:00');await revoked.locator('#reason').fill('配置变化测试');
 const countBefore=app.sql('select count(*) from public.salon_booking_change_requests');
 app.sql("update public.salon_stores set timezone='America/New_York' where id=1");
 await revoked.locator('#submit').click();await revoked.getByText(/门店时区已变化/).waitFor();assert.equal(app.sql('select count(*) from public.salon_booking_change_requests'),countBefore);
 await revoked.locator('#refresh').click();await revoked.getByText('已刷新本人数据。',{exact:true}).waitFor();assert.match(await revoked.locator('#timeZone').textContent(),/America\/New_York/);
 await revoked.locator('#booking').selectOption({index:1});await revoked.locator('#starts').fill('2030-11-03T01:30');await revoked.locator('#reason').fill('重复时间测试');
 await revoked.locator('#submit').click();await revoked.getByText(/该门店时间重复出现/).waitFor();assert.equal(app.sql('select count(*) from public.salon_booking_change_requests'),countBefore);
 app.sql("update public.salon_stores set timezone='Invalid/Zone' where id=1");await revoked.locator('#refresh').click();await revoked.getByText(/门店时区配置无效/).waitFor();assert.equal(await revoked.locator('#submit').isDisabled(),true);
 app.sql("update public.salon_stores set timezone='Asia/Shanghai' where id=1");await revoked.locator('#refresh').click();await revoked.getByText('已刷新本人数据。',{exact:true}).waitFor();
 // Change config AFTER the UI preflight but BEFORE the mutation reaches the API.
 let raced=false;
 await revoked.route('**/api/salon-customer',async route=>{if(!raced&&route.request().postDataJSON().operation==='reschedule_request'){raced=true;app.sql("update public.salon_stores set timezone='America/New_York' where id=1");}await route.continue();});
 await revoked.locator('#booking').selectOption({index:1});await revoked.locator('#starts').fill('2030-01-01T10:00');await revoked.locator('#reason').fill('事务窗口测试');await revoked.locator('#submit').click();await revoked.getByText(/门店时区版本已变化/).waitFor();assert.equal(raced,true);assert.equal(app.sql('select count(*) from public.salon_booking_change_requests'),countBefore);
 app.sql("update public.salon_customer_auth_identities set status='disabled' where customer_id=1");
 await revoked.locator('#refresh').click();await revoked.getByText(/会话已锁定/).waitFor();assert.equal(await revoked.locator('#submit').isDisabled(),true);assert.equal(await revoked.locator('#results li').count(),0);
 await revoked.locator('#connect').click();await revoked.getByText(/会话已锁定/).waitFor();assert.equal(app.sql('select count(*) from public.salon_customers'),'1');await revoked.close();
 console.log('Dual workbench passed: 1280/390 customer→HTTP→SQL→staff→customer, both lost-response retries, conflict/reject, isolated tokens, store clear and logout');
}finally{if(browser)await browser.close();if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1});
