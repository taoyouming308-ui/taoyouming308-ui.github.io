const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app,browser;try{
 app=await startServer();let serial=0;
 app.sql("insert into public.salon_role_permissions(role_id,resource,action) values(1,'orders','checkout'),(1,'orders','refund_request'),(1,'orders','refund_read'),(1,'orders','refund_approve');insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'REVIEWER','合成复核人');insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,reason) values(1,2,1,1,'合成测试');update public.salon_catalog_store_settings set stock_tracked=true where store_id=1;insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id,quantity) values(1,1,1,100)");
 const call=q=>JSON.parse(app.sql(`set role service_role;select ${q}`));
 const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const make=()=>{
  const n=++serial,id=Number(app.sql(`insert into public.salon_orders(organization_id,store_id,order_no) values(1,1,'WITHDRAW-${n}') returning id`));
  call(`public.salon_replace_order_lines_versioned(1,1,1,${id},'withdraw-lines-${String(n).padStart(5,'0')}','[{"catalogItemId":1,"quantity":1,"unitPrice":12.34}]'::jsonb,'',0)`);
  app.sql(`update public.salon_orders set status='awaiting_payment' where id=${id}`);
  const version=Number(app.sql(`select edit_version from public.salon_orders where id=${id}`));
  call(`public.salon_checkout_cash(1,1,1,${id},'withdraw-cash-${String(n).padStart(6,'0')}',${version},'12.34','12.34')`);
  return {orderId:id,refundId:call(`public.salon_submit_refund_request(1,1,1,${id},'withdraw-request-${String(n).padStart(5,'0')}','full','合成退款申请')`).refundRequestId};
 };
 const detail=id=>call(`public.salon_get_refund_review(1,1,1,${id})`);
 const withdraw=(actor,id,key,snapshot,reason='合成撤回')=>`public.salon_withdraw_refund_request(${actor},1,1,${id},'${key}','${reason}',${quote(snapshot)})`;
 const financialState=()=>app.sql("select jsonb_build_object('payments',(select jsonb_agg(p order by id) from public.salon_payments p),'orders',(select jsonb_agg(jsonb_build_object('id',id,'refunded_total',refunded_total,'status',status) order by id) from public.salon_orders),'stock',(select jsonb_agg(s order by catalog_item_id) from public.salon_inventory_balances s),'inventory',(select jsonb_agg(l order by id) from public.salon_inventory_ledger l),'members',(select jsonb_agg(m order by id) from public.salon_account_ledger m),'performance',(select jsonb_agg(p order by id) from public.salon_performance_ledger p))").trim();
 const first=make(),original=detail(first.refundId),unchanged=financialState();
 assert.throws(()=>call(withdraw(2,first.refundId,'withdraw-wrong-actor01',original)),/本人/);
 assert.throws(()=>app.sql(`set role service_role;select public.salon_withdraw_refund_request(1,1,2,${first.refundId},'withdraw-cross-store01','合成撤回',${quote(original)})`));
 assert.throws(()=>call(withdraw(1,first.refundId,'withdraw-bad-snapshot01',{...original,order:{...original.order,number:'stale'}})),/内容已变化/);
 const result=call(withdraw(1,first.refundId,'withdraw-good-request01',original,'顾客改变主意'));
 assert.equal(result.status,'cancelled');assert.equal(result.withdrawnByStaffId,1);assert.deepEqual(call(withdraw(1,first.refundId,'withdraw-good-request01',original,'顾客改变主意')),result);
 const after=detail(first.refundId);assert.equal(after.refund.status,'cancelled');assert.equal(after.refund.withdrawalReason,'顾客改变主意');
 assert.equal(financialState(),unchanged);
 const reopened=call(`public.salon_get_cash_refund_availability(1,1,1,${first.orderId})`);
 assert.equal(reopened.availableAmount,'12.34');assert.equal(reopened.lines[0].availableAmount,'12.34');assert.equal(reopened.lines[0].availableQuantity,'1.000');
 assert.equal(app.sql(`select count(*) from public.salon_payments where order_id=${first.orderId} and reversal_of_id is not null`),'0');
 assert.equal(app.sql(`select count(*) from public.salon_inventory_ledger where order_id=${first.orderId} and movement_type='refund'`),'0');
 assert.equal(app.sql(`select count(*) from public.salon_account_ledger where order_id=${first.orderId} and entry_type='refund'`),'0');
 assert.equal(app.sql(`select count(*) from public.salon_performance_ledger where order_id=${first.orderId} and entry_type='refund'`),'0');
 for(const role of ['anon','authenticated']){
  assert.equal(app.sql(`select has_function_privilege('${role}','public.salon_withdraw_refund_request(bigint,bigint,bigint,bigint,text,text,jsonb)','execute')`),'f');
  assert.equal(app.sql(`select has_function_privilege('${role}','public.salon_lookup_refund_withdraw(bigint,bigint,bigint,text)','execute')`),'f');
 }
 assert.throws(()=>call(withdraw(1,first.refundId,'withdraw-new-request-001',after)),/不可撤回/);
 const approved=make(),approvedSnapshot=detail(approved.refundId);
 call(`public.salon_review_refund_checked(2,1,1,${approved.refundId},'withdraw-approve-0001','approved','合成审批',${quote(approvedSnapshot)})`);
 assert.throws(()=>call(withdraw(1,approved.refundId,'withdraw-after-approve01',approvedSnapshot)),/已审批/);
 const raced=make(),raceSnapshot=detail(raced.refundId);
 const outcomes=await Promise.allSettled([
  app.asyncSql(`set role service_role;select ${withdraw(1,raced.refundId,'withdraw-race-key-001',raceSnapshot)}`),
  app.asyncSql(`set role service_role;select public.salon_review_refund_checked(2,1,1,${raced.refundId},'withdraw-race-key-002','approved','合成审批竞争',${quote(raceSnapshot)})`),
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.ok(['cancelled','approved'].includes(app.sql(`select status from public.salon_refund_requests where id=${raced.refundId}`)));
 // A lost HTTP response is recovered by request lookup; the browser never performs a second withdrawal.
 const pending=make();browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];let dropped=false,writes=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>new URL(r.request().url()).origin===app.url?r.continue():r.abort());
 await page.route('**/api/salon',async route=>{
  const body=route.request().postDataJSON();
  if(body.operation==='refund_withdraw'){writes++;if(!dropped){dropped=true;await route.fetch();return route.abort('failed');}}
  return route.continue();
 });
 await page.goto(app.url);await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
 await page.locator('#listRefunds').click();await page.locator('#refundSelection').selectOption(String(pending.refundId));await page.locator('#loadRefund').click();await page.getByText('退款申请与原支付已读取；尚未审批或退款。',{exact:true}).waitFor();
 assert.equal(await page.locator('#withdrawRefund').isEnabled(),true,`${await page.locator('#status').textContent()} ${await page.locator('#refundDetail').textContent()}`);
 await page.locator('#refundReason').fill('顾客改约，不再退款');await page.locator('#withdrawRefund').click();await page.getByText(/未收到有效结果/).waitFor();
 assert.equal(app.sql(`select status from public.salon_refund_requests where id=${pending.refundId}`),'cancelled');
 await page.reload();await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();
 await page.locator('#lookupRequest').click();await page.getByText(/本人退款申请已撤回并读取确认/).waitFor();
 assert.equal(writes,1);assert.equal(await page.locator('#withdrawRefund').isDisabled(),true);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/private/tmp/salon-refund-withdrawal-mobile.png',fullPage:true});
 console.log('Refund withdrawal PG/browser passed: owner-only, submitted-only, frozen snapshot, idempotency, permission boundary, no payment/member/stock/performance reversal, lost-response recovery, mobile UI');
}finally{if(browser)await browser.close();if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
