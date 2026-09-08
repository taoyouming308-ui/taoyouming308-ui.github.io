const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app,browser;try{
 app=await startServer();let serial=0;
 const call=q=>JSON.parse(app.sql(`set role service_role;select ${q}`));
 const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 app.sql("insert into public.salon_role_permissions(role_id,resource,action) values(1,'orders','checkout'),(1,'orders','refund_request'),(1,'orders','refund_read'),(1,'orders','refund_approve');insert into public.salon_staff(organization_id,store_id,role_id,staff_no,display_name) values(1,1,1,'REVIEWER','合成复核人');insert into public.salon_staff_store_roles(organization_id,staff_id,store_id,role_id,reason) values(1,2,1,1,'合成测试');update public.salon_catalog_store_settings set stock_tracked=true where store_id=1;insert into public.salon_inventory_balances(organization_id,store_id,catalog_item_id,quantity) values(1,1,1,100)");
 const make=()=>{
  const n=++serial,id=Number(app.sql(`insert into public.salon_orders(organization_id,store_id,order_no) values(1,1,'FULL-REFUND-${n}') returning id`));
  call(`public.salon_replace_order_lines_versioned(1,1,1,${id},'full-refund-lines-${n}','[{"catalogItemId":1,"quantity":1,"unitPrice":12.34}]'::jsonb,'',0)`);
  app.sql(`update public.salon_orders set status='awaiting_payment' where id=${id}`);
  const version=Number(app.sql(`select edit_version from public.salon_orders where id=${id}`));
  call(`public.salon_checkout_cash(1,1,1,${id},'full-refund-cash-${n}',${version},'12.34','20.00')`);return id;
 };
 const source=id=>call(`public.salon_get_cash_refund_source(1,1,1,${id})`);
 const request=(id,key,snapshot,reason='合成原因 <img src=x>')=>`public.salon_request_cash_refund(1,1,1,${id},'${key}','${reason}',${quote(snapshot)})`;
 const lookup=key=>call(`public.salon_lookup_staff_request(1,1,1,'${key}','cash_refund_request')`);
 const balances=()=>app.sql("select jsonb_build_object('payments',(select jsonb_agg(p order by id) from public.salon_payments p),'orders',(select jsonb_agg(o order by id) from public.salon_orders o),'stock',(select jsonb_agg(s order by catalog_item_id) from public.salon_inventory_balances s),'stockLedger',(select jsonb_agg(l order by id) from public.salon_inventory_ledger l),'members',(select jsonb_agg(m order by id) from public.salon_account_ledger m),'performance',(select jsonb_agg(p order by id) from public.salon_performance_ledger p))");
 const id=make(),snapshot=source(id),before=balances();
 assert.equal(snapshot.amount,'12.34');assert.equal(snapshot.lines[0].quantity,'1.000');
 assert.deepEqual(Object.keys(snapshot).sort(),['amount','lines','method','number','orderId','organizationId','paymentId','storeId','version']);
 const receipt=call(request(id,'full-request-ok-001',snapshot));assert.equal(receipt.status,'submitted');assert.equal(balances(),before);
 assert.deepEqual(call(request(id,'full-request-ok-001',snapshot)),receipt);
 assert.throws(()=>call(request(id,'full-request-ok-001',snapshot,'不同原因')));
 assert.throws(()=>source(id),/已有/);assert.throws(()=>call(request(id,'full-request-new-01',snapshot)),/已有/);
 assert.equal(lookup('full-request-ok-001').resourceId,receipt.refundRequestId);
 assert.equal(call("public.salon_lookup_staff_request(2,1,1,'full-request-ok-001','cash_refund_request')").status,'unconfirmed');
 assert.equal(call("public.salon_lookup_staff_request(1,1,2,'full-request-ok-001','cash_refund_request')").status,'unconfirmed');
 assert.throws(()=>call(`public.salon_get_cash_refund_source(1,1,2,${id})`),/当前门店/);
 const detail=call(`public.salon_get_refund_review(1,1,1,${receipt.refundRequestId})`);
 assert.throws(()=>call(`public.salon_review_refund_checked(1,1,1,${receipt.refundRequestId},'full-self-review-01','approved','合成审批',${quote(detail)})`),/同一人/);
 call(`public.salon_review_refund_checked(2,1,1,${receipt.refundRequestId},'full-other-review-1','approved','合成审批',${quote(detail)})`);assert.equal(balances(),before);
 const stale=make(),old=source(stale);app.sql(`update public.salon_orders set notes='changed' where id=${stale}`);
 assert.throws(()=>call(request(stale,'full-stale-key-001',old)),/内容已变化/);
 const fresh=source(stale),same=await Promise.all([1,2].map(()=>app.asyncSql(`set role service_role;select ${request(stale,'full-same-key-0001',fresh)}`)));assert.equal(same[0],same[1]);
 const raced=make(),rs=source(raced),race=await Promise.allSettled([1,2].map(n=>app.asyncSql(`set role service_role;select ${request(raced,'full-race-key-000'+n,rs)}`)));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 app.sql("delete from public.salon_role_permissions where resource='orders' and action='refund_request'");
 assert.throws(()=>lookup('full-request-ok-001'),/权限/);assert.throws(()=>call(request(id,'full-request-ok-001',snapshot)),/权限/);
 app.sql("insert into public.salon_role_permissions(role_id,resource,action) values(1,'orders','refund_request')");
 const rollback=make(),rb=source(rollback),rbBefore=balances();
 app.sql("create function public.synthetic_request_failure() returns trigger language plpgsql as $$begin if new.action='submit' then raise exception 'synthetic request failure';end if;return new;end $$;create trigger synthetic_request_failure before insert on public.salon_audit_events for each row execute function public.synthetic_request_failure()");
 assert.throws(()=>call(request(rollback,'full-rollback-key1',rb)),/synthetic request failure/);assert.equal(lookup('full-rollback-key1').status,'unconfirmed');assert.equal(balances(),rbBefore);assert.deepEqual(source(rollback),rb);
 app.sql("drop trigger synthetic_request_failure on public.salon_audit_events;drop function public.synthetic_request_failure()");
 for(const role of ['anon','authenticated'])for(const signature of ['salon_get_cash_refund_source(bigint,bigint,bigint,bigint)','salon_request_cash_refund(bigint,bigint,bigint,bigint,text,text,jsonb)'])assert.equal(app.sql(`select has_function_privilege('${role}','public.${signature}','execute')`),'f');
 const unsupported=make(),us=source(unsupported);
 app.sql(`update public.salon_payments set payment_method='wechat' where id=${us.paymentId}`);assert.throws(()=>source(unsupported),/原现金/);
 app.sql(`update public.salon_payments set payment_method='cash' where id=${us.paymentId};update public.salon_order_lines set line_total=0 where order_id=${unsupported}`);assert.throws(()=>source(unsupported),/明细/);
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),writes=[],errors=[];let mode='normal';
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',r=>new URL(r.request().url()).origin===app.url?r.continue():r.abort());
  await page.route('**/api/salon',async route=>{
   const body=route.request().postDataJSON();
   if(body.operation==='cash_refund_request'){writes.push(body);if(mode==='drop'){mode='normal';await route.fetch();return route.abort('failed');}}
   if(body.operation==='refund_detail'&&mode==='bad-readback'){mode='normal';const response=await route.fetch(),json=await response.json();json.data.refund.reason='wrong';return route.fulfill({response,json});}
   return route.continue();
  });
  const connect=async()=>{await page.locator('#connect').click();await page.getByText('已连接临时数据库；所有操作只影响本次合成数据。',{exact:true}).waitFor();};
  const load=async n=>{await page.locator('#cashRefundOrderId').fill(String(n));await page.locator('#loadCashRefund').click();await page.getByText('已核对现金全退原单，请填写申请原因；尚未提交或退款。',{exact:true}).waitFor();await page.locator('#cashRefundReason').fill('合成原因 <img src=x>');};
  const journal=()=>page.evaluate(()=>sessionStorage.getItem('salon.pending.v1:1:1:1'));
  await page.goto(app.url);await connect();const target=make();await load(target);const financialBefore=balances();
  mode='drop';await page.locator('#submitCashRefund').click();await page.getByText(/未收到有效结果/).waitFor();assert.ok(await journal());
  if(width===1280){await page.locator('#retry').click();await page.getByText(/现金全额退款申请已保存并回读确认/).waitFor();assert.deepEqual(writes[0],writes[1]);}
  else{await page.reload();await connect();await page.locator('#lookupRequest').click();await page.getByText(/原全退申请已核对/).waitFor();assert.equal(writes.length,1);}
  assert.equal(await journal(),null);assert.equal(balances(),financialBefore);assert.equal(await page.locator('#approveRefund').isDisabled(),true);assert.equal(await page.locator('#refundDetail img').count(),0);
  if(width===390)await page.screenshot({path:'/private/tmp/salon-refund-request-filled-mobile.png',fullPage:true});
  const bad=make();await load(bad);mode='bad-readback';await page.locator('#submitCashRefund').click();await page.getByText(/后续回读失败/).waitFor();assert.ok(await journal());assert.equal(await page.locator('#retry').isDisabled(),true);
  await page.locator('#lookupRequest').click();await page.getByText(/原全退申请已核对/).waitFor();assert.equal(await journal(),null);
  const changed=make();await load(changed);app.sql(`update public.salon_orders set notes='stale' where id=${changed}`);await page.locator('#submitCashRefund').click();await page.getByText(/内容已变化/).waitFor();assert.equal(await journal(),null);assert.equal(await page.locator('#submitCashRefund').isDisabled(),true);
  await load(changed);await page.locator('#cashRefundOrderId').fill('999999');assert.equal(await page.locator('#cashRefundSource').textContent(),'');assert.equal(await page.locator('#submitCashRefund').isDisabled(),true);
  await load(changed);await page.locator('#store').selectOption('2');await page.getByText('已切换门店，旧选择已清除。',{exact:true}).waitFor();assert.equal(await page.locator('#cashRefundSource').textContent(),'');
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===390)await page.screenshot({path:'/private/tmp/salon-refund-request-mobile.png',fullPage:true});await page.close();
 }
 console.log('Cash full refund request PG/browser passed: allocation, idempotency, races, snapshot, scope, permission, rollback, maker-checker, response loss/reload/readback, mobile and no financial writes');
}finally{if(browser)await browser.close();if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
