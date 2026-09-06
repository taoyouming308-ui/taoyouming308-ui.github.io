// Explicit, disposable PostgreSQL + real handler + desktop/mobile acceptance.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{
 let app,browser,page;let counter=0;
 try{
  app=await startServer();
  app.sql(`insert into public.salon_customers(organization_id,display_name) values(1,'合成取消顾客');
   insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
   insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id) values(1,1,'22222222-2222-4222-8222-222222222222');
   insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price,duration_minutes) values(1,'service','CANCEL-SERVICE','合成服务',10,30);
   insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id) values(1,1,2);`);
  const call=expression=>JSON.parse(app.sql(`set role service_role;select ${expression};`));
  const newBooking=()=>{
   const i=++counter;
   const request=call(`public.salon_customer_request_booking('22222222-2222-4222-8222-222222222222',1,1,'cancel-create-${String(i).padStart(6,'0')}',2,1,current_date+interval '10 days ${i} hours',current_date+interval '10 days ${i} hours 30 minutes','合成预约')`);
   const id=request.bookingRequestId;
   const confirmed=call(`public.salon_review_customer_booking(1,1,1,${id},'cancel-confirm-${String(i).padStart(6,'0')}','confirmed',1,'合成确认')`);
   call(`public.salon_customer_request_booking_cancel('22222222-2222-4222-8222-222222222222',1,1,${id},'cancel-request-${String(i).padStart(6,'0')}','顾客申请取消')`);
   return {id,appointmentId:confirmed.appointmentId};
  };
  const review=(b,key,decision='approved')=>`public.salon_review_booking_cancel(1,1,1,${b.id},'${key}','${decision}','合成复核')`;
  const state=b=>JSON.parse(app.sql(`select jsonb_build_object('request',r.status,'appointment',a.status,'block',s.status) from public.salon_customer_booking_requests r join public.salon_appointments a on a.id=r.appointment_id join public.salon_schedule_blocks s on s.id=a.schedule_block_id where r.id=${b.id};`));
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const [width,decision] of [[1280,'approved'],[390,'rejected']]){
   const b=newBooking();page=await browser.newPage({viewport:{width,height:844}});const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===app.url?route.continue():route.abort());
   await page.goto(app.url);await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
   await page.locator('#cancelRequest').selectOption(String(b.id));await page.locator('#cancelReason').fill('合成复核');
   await page.locator(decision==='approved'?'#approveCancel':'#rejectCancel').click();
   await page.getByText(decision==='approved'?'取消已批准，档期已释放。':'取消已拒绝，原预约和档期保留。',{exact:true}).waitFor();
   assert.deepEqual(state(b),decision==='approved'?{request:'cancelled',appointment:'cancelled',block:'cancelled'}:{request:'confirmed',appointment:'confirmed',block:'active'});
   const own=JSON.parse(app.sql("set role service_role;select jsonb_agg(to_jsonb(r)) from public.salon_customer_list_bookings('22222222-2222-4222-8222-222222222222',1,1,100) r;"));
   assert.equal(own.find(row=>row.id===b.id).status,decision==='approved'?'cancelled':'confirmed');
   assert.equal(own.find(row=>row.id===b.id).handle_reason,'合成复核');
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();page=null;
  }
  const b=newBooking(),key='cancel-review-replay-01';
  const results=await Promise.all([app.asyncSql(`set role service_role;select ${review(b,key)};`),app.asyncSql(`set role service_role;select ${review(b,key)};`)]);
  assert.equal(results[0],results[1]);assert.equal(app.sql(`select count(*) from public.salon_audit_events where entity_type='customer_booking' and entity_id='${b.id}' and action='cancel_review';`),'1');
  assert.throws(()=>call(review(b,key,'rejected')),error=>/幂等键已被其他业务使用/.test(error.stderr));
  assert.throws(()=>call(`public.salon_create_order(1,1,1,'cancelled-late-order',1,${b.appointmentId},'')`),error=>/预约不存在、已结束/.test(error.stderr));
  for(let i=0;i<4;i++){
   const race=newBooking();
   const pair=await Promise.allSettled([
    app.asyncSql(`set role service_role;select ${review(race,'race-cancel-request-'+i)};`),
    app.asyncSql(`set role service_role;select public.salon_create_order(1,1,1,'race-order-request-${i}',1,${race.appointmentId},'');`)
   ]);
   assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);
   assert.match(pair.find(x=>x.status==='rejected').reason.stderr,/预约已关联订单|预约不存在、已结束/);
   const count=Number(app.sql(`select count(*) from public.salon_orders where appointment_id=${race.appointmentId};`));
   assert.equal(state(race).appointment,count?'confirmed':'cancelled');
  }
  const arrived=newBooking();call(`public.salon_set_appointment_status(1,1,1,${arrived.appointmentId},'arrived','到店')`);
  assert.throws(()=>call(review(arrived,'cancel-arrived-guard')),error=>/预约已到店/.test(error.stderr));assert.equal(state(arrived).request,'cancel_requested');
  const linked=newBooking();call(`public.salon_create_order(1,1,1,'linked-order-first',1,${linked.appointmentId},'')`);
  assert.throws(()=>call(review(linked,'cancel-linked-guard')),error=>/预约已关联订单/.test(error.stderr));assert.equal(state(linked).block,'active');
  const denied=newBooking();
  assert.throws(()=>call(`public.salon_review_booking_cancel(1,1,2,${denied.id},'cancel-cross-store-guard','approved','合成')`),error=>/没有待复核/.test(error.stderr));
  app.sql("delete from public.salon_role_permissions where role_id=1 and resource='scheduling' and action='write';");
  assert.throws(()=>call(review(denied,'cancel-permission-guard')));assert.equal(state(denied).block,'active');
  assert.throws(()=>call(review(b,key)),'revoked permission must also reject a completed replay');
  for(const role of ['anon','authenticated'])assert.equal(app.sql(`select has_function_privilege('${role}','public.salon_review_booking_cancel(bigint,bigint,bigint,bigint,text,text,text)','EXECUTE');`),'f');
  assert.equal(app.sql("select prosecdef from pg_proc where proname='salon_review_booking_cancel';"),'f');
  console.log('Booking cancellation: desktop/mobile approve/reject, real SQL, replay, permissions, arrival and 4 concurrent order/cancel races passed');
 }catch(error){if(page&&!page.isClosed())console.error(await page.locator('#status').textContent());throw error;}
 finally{if(browser)await browser.close();if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
