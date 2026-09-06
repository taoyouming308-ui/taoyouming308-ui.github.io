// Explicit opt-in integration test: creates and removes one synthetic Docker database.
// Run: node scripts/test-salon-customer-request-postgres.cjs
const {execFileSync,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asyncExec=promisify(execFile);
const root=path.resolve(__dirname,'..');
const container=`salon-request-test-${process.pid}-${Date.now()}`;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
const sql=input=>docker(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input);
const concurrent=async text=>(await asyncExec('docker',['exec',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At','-c',text],{timeout:20000})).stdout;
async function main(){
 let created=false;
 try{
  docker(['run','--name',container,'-e','POSTGRES_PASSWORD=test','-d','postgres:15']);created=true;
  let ready=false;
  for(let i=0;i<60;i++){
   // The image's temporary initialization server accepts Unix sockets but not TCP.
   try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,200))}
  }
  assert.ok(ready,'PostgreSQL TCP readiness timed out');
  sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
  for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>/_salon_.*\.sql$/.test(f)).sort())
   sql(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  sql('set role service_role;\n'+fs.readFileSync(path.join(root,'scripts/test-salon-engagement.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/test-salon-customer-request-ownership.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/test-salon-staff-replay-and-customer-reads.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/test-salon-financial-request-replay.sql'),'utf8'));
  const call=(key,evidence)=>`set role service_role;select public.salon_customer_set_consent('11111111-1111-4111-8111-111111111111',1,1,'${key}','marketing_messages',true,'{}','${evidence}');`;
  const same=await Promise.all([concurrent(call('concurrent-same-001','test-only')),concurrent(call('concurrent-same-001','test-only'))]);
  assert.equal(same[0],same[1],'same-key concurrent requests must return same result');
  assert.equal(sql("select count(*) from public.salon_customer_consents where evidence_ref='test-only';").trim(),'1');
  const changed=await Promise.allSettled([concurrent(call('concurrent-changed-001','variant-a')),concurrent(call('concurrent-changed-001','variant-b'))]);
  assert.equal(changed.filter(r=>r.status==='fulfilled').length,1);
  assert.match(changed.find(r=>r.status==='rejected').reason.stderr,/幂等键已被其他业务使用/);
  assert.equal(sql("select count(*) from public.salon_customer_consents where evidence_ref in ('variant-a','variant-b');").trim(),'1');
  const campaign=(key,message)=>`set role service_role;select public.salon_create_campaign(2,1,1,'${key}','并发合成活动','in_app','{}','${message}',current_date,current_date+7);`;
  const staffSame=await Promise.all([concurrent(campaign('staff-concurrent-same','one')),concurrent(campaign('staff-concurrent-same','one'))]);
  assert.equal(staffSame[0],staffSame[1]);
  const staffChanged=await Promise.allSettled([concurrent(campaign('staff-concurrent-change','two')),concurrent(campaign('staff-concurrent-change','three'))]);
  assert.equal(staffChanged.filter(r=>r.status==='fulfilled').length,1);
  assert.match(staffChanged.find(r=>r.status==='rejected').reason.stderr,/幂等键已被其他业务使用/);
  assert.equal(sql("select count(*) from public.salon_campaigns where name='并发合成活动';").trim(),'2');
  const fin=JSON.parse(sql("select jsonb_build_object('org',s.organization_id,'store',s.id,'actor',a.id,'customer',m.customer_id,'account',m.id,'item',i.id) from public.salon_stores s join public.salon_staff a on a.organization_id=s.organization_id and a.staff_no='FIN-A' join public.salon_member_accounts m on m.organization_id=s.organization_id and m.account_no='FIN-CARD' join public.salon_catalog_items i on i.organization_id=s.organization_id and i.code='FIN-ITEM' where s.code='FIN-REPLAY';").trim());
  const makeOrder=(no,amount)=>{
   const id=Number(sql(`insert into public.salon_orders(organization_id,store_id,order_no,customer_id,status,subtotal,payable_total) values(${fin.org},${fin.store},'${no}',${fin.customer},'awaiting_payment',${amount},${amount}) returning id;`).trim().split('\n')[0]);
   sql(`insert into public.salon_order_lines(organization_id,order_id,catalog_item_id,quantity,unit_price,line_total,item_code,item_name,item_type) values(${fin.org},${id},${fin.item},1,${amount},${amount},'FIN-ITEM','合成商品','product');`);
   return id;
  };
  const checkout=(id,key,amount)=>`set role service_role;select public.salon_checkout_order(${fin.actor},${fin.org},${fin.store},${id},'${key}','[{"method":"member_value","amount":${amount},"accountId":${fin.account}}]');`;
  const first=makeOrder('FIN-CONCURRENT-1',50);
  const paySame=await Promise.all([concurrent(checkout(first,'fin-concurrent-pay',50)),concurrent(checkout(first,'fin-concurrent-pay',50))]);
  assert.equal(paySame[0],paySame[1]);
  assert.equal(sql(`select cash_balance from public.salon_member_accounts where id=${fin.account};`).trim(),'450.00');
  assert.equal(sql(`select count(*) from public.salon_payments where order_id=${first};`).trim(),'1');
  // Different orders race for the same balance: only one 300-unit debit can succeed.
  const second=makeOrder('FIN-CONCURRENT-2',300),third=makeOrder('FIN-CONCURRENT-3',300);
  const overspend=await Promise.allSettled([concurrent(checkout(second,'fin-race-balance-2',300)),concurrent(checkout(third,'fin-race-balance-3',300))]);
  assert.equal(overspend.filter(r=>r.status==='fulfilled').length,1);
  assert.match(overspend.find(r=>r.status==='rejected').reason.stderr,/储值余额不足/);
  assert.equal(sql(`select cash_balance from public.salon_member_accounts where id=${fin.account};`).trim(),'150.00');
  assert.equal(sql(`select count(*) from public.salon_payments where order_id in (${second},${third});`).trim(),'1');
  assert.equal(sql(`select count(*) from public.salon_orders where id in (${second},${third}) and status='awaiting_payment';`).trim(),'1');
  assert.equal(sql(`select count(*) from public.salon_operation_requests where organization_id=${fin.org} and request_key in ('fin-race-balance-2','fin-race-balance-3');`).trim(),'1');
  assert.equal(sql(`select quantity from public.salon_inventory_balances where store_id=${fin.store} and catalog_item_id=${fin.item};`).trim(),'6.000');
  console.log('financial PostgreSQL passed: 12 transaction replays, balance/stock restoration, same-request single debit, concurrent balance shortage rollback');
  console.log('Salon request PostgreSQL passed: staff/customer ownership, replay, rollback, restricted reads, real-role access, concurrent identical and conflicting requests');
 }finally{
  if(created)docker(['rm','-f',container]);
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
