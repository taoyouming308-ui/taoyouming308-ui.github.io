// Opt-in synthetic database + real API/browser + concurrent SQL acceptance.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{
 let app,browser,page,counter=0;
 try{
  app=await startServer();
  const {instantToStoreInput}=await import('../packages/salon-core/store-time.mjs');
  app.sql(`insert into public.salon_customers(organization_id,display_name) values(1,'合成改期顾客');
   insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
   insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id) values(1,1,'22222222-2222-4222-8222-222222222222');
   insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price,duration_minutes) values(1,'service','MOVE-SERVICE','合成服务',10,30);
   insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id) values(1,1,2);`);
  const call=expression=>JSON.parse(app.sql(`set role service_role;select ${expression};`));
  const newBooking=()=>{
   const i=++counter;
   const request=call(`public.salon_customer_request_booking('22222222-2222-4222-8222-222222222222',1,1,'move-create-${String(i).padStart(6,'0')}',2,1,current_date+interval '10 days ${i} hours',current_date+interval '10 days ${i} hours 30 minutes','合成预约')`);
   const result=call(`public.salon_review_customer_booking(1,1,1,${request.bookingRequestId},'move-confirm-${String(i).padStart(6,'0')}','confirmed',1,'合成确认')`);
   const times=JSON.parse(app.sql(`select jsonb_build_object('starts',starts_at,'ends',ends_at,'version',reschedule_version) from public.salon_customer_booking_requests where id=${request.bookingRequestId};`));
   return {id:request.bookingRequestId,appointmentId:result.appointmentId,...times};
  };
  const shifted=(value,hours)=>new Date(Date.parse(value)+hours*3600000).toISOString();
  const move=(b,key,start,reason='合成改期')=>`public.salon_reschedule_booking(1,1,1,${b.id},'${key}','${b.starts}','${b.ends}',${b.version},'${start}','${reason}')`;
  const state=b=>JSON.parse(app.sql(`select jsonb_build_object('starts',r.starts_at,'ends',r.ends_at,'version',r.reschedule_version,'request',r.status,'appointment',a.status,'block',s.status,'aligned',r.starts_at=a.starts_at and a.starts_at=s.starts_at and r.ends_at=a.ends_at and a.ends_at=s.ends_at,'staff',a.staff_id,'blockId',s.id) from public.salon_customer_booking_requests r join public.salon_appointments a on a.id=r.appointment_id join public.salon_schedule_blocks s on s.id=a.schedule_block_id where r.id=${b.id};`));
  const auditCount=b=>Number(app.sql(`select count(*) from public.salon_audit_events where entity_type='customer_booking' and entity_id='${b.id}' and action='reschedule';`));
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [1280,390]){
   const b=newBooking(),before=state(b),target=shifted(b.starts,48);page=await browser.newPage({viewport:{width,height:844},timezoneId:'Asia/Shanghai'});const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===app.url?route.continue():route.abort());
   await page.goto(app.url);await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
   await page.locator('#rescheduleRequest').selectOption(String(b.id));await page.locator('#rescheduleReason').fill('合成改期');
   if(width===390){
    const blocked=shifted(b.starts,24);
    app.sql(`insert into public.salon_schedule_blocks(organization_id,store_id,staff_id,block_type,starts_at,ends_at) values(1,1,1,'leave','${blocked}','${shifted(blocked,1)}');`);
    await page.locator('#rescheduleStart').fill(instantToStoreInput(blocked,'Asia/Shanghai'));await page.locator('#rescheduleBooking').click();
    await page.getByText(/新档期与预约或休假冲突，原预约保持不变/).waitFor();assert.deepEqual(state(b),before);assert.equal(auditCount(b),0);
   }
   let dropped=false;
   await page.route('**/api/salon',async route=>{
    if(!dropped&&route.request().postDataJSON().operation==='booking_reschedule'){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();
   });
   await page.locator('#rescheduleStart').fill(instantToStoreInput(target,'Asia/Shanghai'));await page.locator('#rescheduleBooking').click();
   await page.locator('#retry:not([disabled])').waitFor();await page.locator('#retry').click();
   await page.getByText('改期成功，原预约与档期已同步更新。',{exact:true}).waitFor();
   const after=state(b);assert.equal(Date.parse(after.starts),Date.parse(target));assert.equal(Date.parse(after.ends)-Date.parse(after.starts),1800000);assert.equal(after.aligned,true);assert.equal(after.staff,before.staff);assert.equal(after.blockId,before.blockId);assert.equal(auditCount(b),1);
   // The freed old interval can now be booked; the new interval cannot.
   call(`public.salon_create_appointment(1,1,1,1,1,'${b.starts}','${b.ends}','test','原档期复用')`);
   assert.throws(()=>call(`public.salon_create_appointment(1,1,1,1,1,'${target}','${shifted(target,.5)}','test','冲突')`),error=>/已有预约或休假/.test(error.stderr));
   const own=JSON.parse(app.sql("set role service_role;select jsonb_agg(to_jsonb(r)) from public.salon_customer_list_bookings('22222222-2222-4222-8222-222222222222',1,1,100) r;"));
   assert.equal(Date.parse(own.find(row=>row.id===b.id).starts_at),Date.parse(target));
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#store').selectOption('2');await page.getByText('已切换门店，旧选择已清除。',{exact:true}).waitFor();assert.equal(await page.locator('#rescheduleStart').inputValue(),'');assert.equal(await page.locator('#rescheduleReason').inputValue(),'');
   await page.close();page=null;
  }
  const replay=newBooking(),key='move-concurrent-same',target=shifted(replay.starts,72);
  const same=await Promise.all([app.asyncSql(`set role service_role;select ${move(replay,key,target)};`),app.asyncSql(`set role service_role;select ${move(replay,key,target)};`)]);
  assert.equal(same[0],same[1]);assert.equal(auditCount(replay),1);
  assert.throws(()=>call(move(replay,key,shifted(target,1))),error=>/幂等键已被其他业务使用/.test(error.stderr));
  assert.throws(()=>call(move(replay,'move-stale-request',shifted(target,1))),error=>/预约时间已变化/.test(error.stderr));
  const stale=newBooking();const edits=await Promise.allSettled([app.asyncSql(`set role service_role;select ${move(stale,'move-parallel-edit-a',shifted(stale.starts,72))};`),app.asyncSql(`set role service_role;select ${move(stale,'move-parallel-edit-b',shifted(stale.starts,73))};`)]);
  assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.match(edits.find(x=>x.status==='rejected').reason.stderr,/预约时间已变化/);assert.equal(auditCount(stale),1);
  // Two different reservations compete for one free interval: one wins, loser keeps old slot.
  const a=newBooking(),b=newBooking(),shared=shifted(a.starts,120),oldA=state(a),oldB=state(b);
  const compete=await Promise.allSettled([app.asyncSql(`set role service_role;select ${move(a,'move-compete-slot-a',shared)};`),app.asyncSql(`set role service_role;select ${move(b,'move-compete-slot-b',shared)};`)]);
  assert.equal(compete.filter(x=>x.status==='fulfilled').length,1);assert.match(compete.find(x=>x.status==='rejected').reason.stderr,/新档期与预约或休假冲突/);
  if(compete[0].status==='rejected')assert.deepEqual(state(a),oldA);else assert.deepEqual(state(b),oldB);
  const pending=newBooking();call(`public.salon_customer_request_booking_cancel('22222222-2222-4222-8222-222222222222',1,1,${pending.id},'move-cancel-pending','取消')`);
  assert.throws(()=>call(move(pending,'move-pending-denied',shifted(pending.starts,72))),error=>/未申请取消/.test(error.stderr));
  const arrived=newBooking();call(`public.salon_set_appointment_status(1,1,1,${arrived.appointmentId},'arrived','到店')`);
  assert.throws(()=>call(move(arrived,'move-arrived-denied',shifted(arrived.starts,72))),error=>/预约已到店/.test(error.stderr));
  const linked=newBooking();call(`public.salon_create_order(1,1,1,'move-linked-order',1,${linked.appointmentId},'')`);
  assert.throws(()=>call(move(linked,'move-linked-denied',shifted(linked.starts,72))),error=>/预约已关联订单/.test(error.stderr));
  const boundary=newBooking(),oldBoundary=state(boundary);
  // Moving into part of one's own old interval is valid. Returning to the old time must
  // still reject a stale editor that only saw the initial revision (the ABA case).
  const overlap=newBooking();call(move(overlap,'move-self-overlap',shifted(overlap.starts,.25)));
  const moved=state(overlap);assert.equal(moved.version,1);call(move({...overlap,...moved},'move-return-original',overlap.starts));
  assert.equal(state(overlap).version,2);
  assert.throws(()=>call(move(overlap,'move-aba-stale-guard',shifted(overlap.starts,100))),error=>/预约时间已变化/.test(error.stderr));
  assert.throws(()=>call(move(boundary,'move-past-denied','2000-01-01T00:00:00Z')),error=>/时间必须在未来/.test(error.stderr));
  assert.throws(()=>call(move(boundary,'move-cross-denied',shifted(boundary.starts,72)).replace('(1,1,1,','(1,1,2,')),error=>/仅已确认/.test(error.stderr));
  app.sql("delete from public.salon_role_permissions where role_id=1 and resource='scheduling' and action='write';");
  assert.throws(()=>call(move(boundary,'move-no-permission',shifted(boundary.starts,72))));assert.deepEqual(state(boundary),oldBoundary);
  assert.throws(()=>call(move(replay,key,target)),'revoked permission cannot replay success');
  for(const role of ['anon','authenticated'])assert.equal(app.sql(`select has_function_privilege('${role}','public.salon_reschedule_booking(bigint,bigint,bigint,bigint,text,timestamptz,timestamptz,integer,timestamptz,text)','EXECUTE');`),'f');
  assert.equal(app.sql("select prosecdef from pg_proc where proname='salon_reschedule_booking';"),'f');
  console.log('Reschedule passed: 1280/390 browser, conflict rollback, lost-response retry, old-slot reuse, stale edits, competing slots and permission/state guards');
 }catch(error){if(page&&!page.isClosed())console.error(await page.locator('#status').textContent());throw error;}
 finally{if(browser)await browser.close();if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
