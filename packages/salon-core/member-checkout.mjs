import {amountToCents,orderEditVersion,serverId} from './api-client.mjs';

const fail=message=>{throw Error(message);};
const centsText=cents=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
function strictCents(value,label){
 if(typeof value!=='string'||!/^\d{1,10}(?:\.\d{1,2})?$/.test(value))fail(`${label}必须为最多两位小数`);
 try{return amountToCents(value);}catch{fail(`${label}超出安全范围`);}
}
export function inspectStoredValueAccounts(rows,scope,customerId){
 if(!Array.isArray(rows))fail('会员账户列表格式无效');
 const org=serverId(scope.organizationId),store=serverId(scope.storeId),customer=serverId(customerId),seen=new Set();
 return Object.freeze(rows.map(row=>{
  const id=serverId(row.account_id??row.id),rowOrg=serverId(row.organization_id),rowCustomer=serverId(row.customer_id),homeStore=row.home_store_id==null?null:serverId(row.home_store_id);
  if(seen.has(id)||rowOrg!==org||rowCustomer!==customer||row.account_type!=='stored_value'||row.status!=='active'||!['store','organization'].includes(row.usable_scope)||(row.usable_scope==='store'&&homeStore!==store))fail('会员账户不属于当前顾客/门店，或不可用于储值收银');
  seen.add(id);
  const balanceText=typeof row.cash_balance==='number'?row.cash_balance.toFixed(2):row.cash_balance;
  if(typeof balanceText!=='string'||!/^\d{1,10}\.\d{2}$/.test(balanceText))fail('储值余额格式无效');
  const balanceCents=amountToCents(balanceText);
  return Object.freeze({id,organizationId:org,storeId:store,customerId:customer,accountNo:String(row.account_no||''),displayName:String(row.display_name||''),balanceCents,expiresOn:row.expires_on||null});
 }));
}
export function createStoredValueCheckoutPlan({orderId,version,payable,account,storedValueAmount,cashTendered}){
 const id=serverId(orderId),expectedVersion=orderEditVersion(version),payableCents=strictCents(payable,'订单应收');
 if(payableCents<=0||!account||!Number.isSafeInteger(account.id)||account.id<=0||!Number.isSafeInteger(account.balanceCents)||account.balanceCents<0)fail('订单或储值账户无效');
 const memberCents=strictCents(storedValueAmount,'储值抵扣');
 if(memberCents<=0||memberCents>payableCents||memberCents>account.balanceCents)fail('储值抵扣须大于零，且不能超过应收或当前余额');
 const cashCents=payableCents-memberCents;
 let tenderedCents=0;
 if(cashCents>0){tenderedCents=strictCents(cashTendered,'现金实收');if(tenderedCents<cashCents)fail('现金实收不能低于剩余应收');}
 const payments=[{method:'member_value',amount:centsText(memberCents),accountId:account.id}];
 if(cashCents>0)payments.push({method:'cash',amount:centsText(cashCents),tenderedAmount:centsText(tenderedCents)});
 return Object.freeze({orderId:id,version:expectedVersion,payable:centsText(payableCents),memberAmount:centsText(memberCents),cashAmount:centsText(cashCents),cashTendered:centsText(tenderedCents),change:centsText(tenderedCents-cashCents),accountId:account.id,payments:Object.freeze(payments.map(row=>Object.freeze(row)))});
}
export function verifyMemberCheckoutReceipt(receipt,scope,requestKey,expected){
 const invalid=()=>fail('会员收银回执与原请求不匹配，请保留请求号继续核对');
 if(!receipt||receipt.status!=='paid'||receipt.expectedVersion!==expected.version||serverId(receipt.orderId)!==expected.orderId||serverId(receipt.organizationId)!==serverId(scope.organizationId)||serverId(receipt.storeId)!==serverId(scope.storeId)||receipt.requestKey!==requestKey||!Array.isArray(receipt.paymentLines)||receipt.paymentLines.length!==expected.payments.length)invalid();
 if(amountToCents(String(receipt.paid))!==amountToCents(expected.payable))invalid();
 const lines=receipt.paymentLines;
 for(let index=0;index<expected.payments.length;index++){
  const got=lines[index],want=expected.payments[index];
  serverId(got.paymentId);
  if(got.method!==want.method||amountToCents(String(got.amount))!==amountToCents(want.amount))invalid();
  if(want.method==='member_value'&&(serverId(got.accountId)!==want.accountId||Number(got.units||0)!==0))invalid();
  if(want.method==='cash'&&(amountToCents(String(got.tendered))!==amountToCents(want.tenderedAmount)||amountToCents(String(got.change))!==amountToCents(expected.change)))invalid();
 }
 const paidCents=amountToCents(String(receipt.paid)),sum=lines.reduce((total,row)=>total+amountToCents(String(row.amount)),0);
 if(sum!==paidCents||amountToCents(String(receipt.change))!==amountToCents(expected.change))invalid();
 return Object.freeze({receipt,orderId:expected.orderId,version:expected.version,payable:expected.payable,memberAmount:expected.memberAmount,cashAmount:expected.cashAmount,change:expected.change});
}
export function verifyMemberCheckoutLookup(data,scope,requestKey,expected){
 if(data?.operation!=='checkout'||data.status!=='committed'||data.resourceType!=='order'||serverId(data.resourceId)!==expected.orderId||!data.receipt||typeof data.completedAt!=='string'||!Number.isFinite(Date.parse(data.completedAt)))fail('会员收银原请求尚未完整核对，禁止重复提交');
 return verifyMemberCheckoutReceipt(data.receipt,scope,requestKey,expected);
}
export function verifyRecoveredCheckoutLookup(data,scope,requestKey,orderId,payable){
 const failRecovered=()=>fail('收银原请求未能完整核对；请保留请求号并人工核对，禁止重复收款');
 if(data?.operation!=='checkout'||data.status!=='committed'||data.resourceType!=='order'||serverId(data.resourceId)!==serverId(orderId)||!data.receipt||typeof data.completedAt!=='string'||!Number.isFinite(Date.parse(data.completedAt)))failRecovered();
 const r=data.receipt;
 if(r.status!=='paid'||serverId(r.orderId)!==serverId(orderId)||serverId(r.organizationId)!==serverId(scope.organizationId)||serverId(r.storeId)!==serverId(scope.storeId)||r.requestKey!==requestKey||!Array.isArray(r.paymentLines)||!r.paymentLines.length)failRecovered();
 orderEditVersion(r.expectedVersion);
 const paid=amountToCents(String(r.paid)),due=amountToCents(String(payable));let sum=0,change=0;
 for(const row of r.paymentLines){
  serverId(row.paymentId);if(!['cash','wechat','alipay','member_value','member_units'].includes(row.method))failRecovered();
  const amount=amountToCents(String(row.amount));if(amount<=0)failRecovered();sum+=amount;
  if(['member_value','member_units'].includes(row.method)&&serverId(row.accountId)<=0)failRecovered();
  if(row.method==='cash'){const tendered=amountToCents(String(row.tendered)),lineChange=amountToCents(String(row.change));if(tendered<amount||tendered-amount!==lineChange)failRecovered();change+=lineChange;}
  else if(amountToCents(String(row.tendered))!==amount||amountToCents(String(row.change))!==0)failRecovered();
 }
 if(sum!==paid||paid!==due||amountToCents(String(r.change))!==change)failRecovered();
 return Object.freeze({receipt:r,orderId:serverId(orderId),currentPaymentStatus:'historical-record-verified'});
}
export function renderMemberCheckoutReceipt(container,record,currentStatus){
 const doc=container.ownerDocument,heading=doc.createElement('h3'),body=doc.createElement('p'),state=doc.createElement('p'),lines=doc.createElement('ul'),key=doc.createElement('p');
 heading.textContent='原会员收银已核对';
 body.textContent=`订单 ${record.orderId} · 储值扣款 ¥${record.memberAmount} · 现金 ¥${record.cashAmount} · 找零 ¥${record.change}`;
 state.textContent=`历史支付已按原请求回读。当前订单：${currentStatus}；不得因后续退款或状态变化再次扣款。`;
 for(const line of record.receipt.paymentLines){const item=doc.createElement('li');item.textContent=`支付记录 ${serverId(line.paymentId)} · ${line.method==='member_value'?'储值卡':'现金'} ¥${line.amount}`;lines.append(item);}
 key.textContent='本机合成收银完成；会员扣款与订单更新已按原子事务记录。';container.replaceChildren(heading,body,state,lines,key);
}
export function renderRecoveredCheckoutReceipt(container,record,currentStatus){
 const doc=container.ownerDocument,heading=doc.createElement('h3'),body=doc.createElement('p'),state=doc.createElement('p'),lines=doc.createElement('ul'),key=doc.createElement('p');
 heading.textContent='刷新恢复：原收银请求已核对';
 body.textContent=`订单 ${record.orderId} · 已支付 ¥${record.receipt.paid} · 找零 ¥${record.receipt.change}`;
 state.textContent=`支付记录已按原请求回读。当前订单：${currentStatus}；不得因页面刷新再次收款。`;
 for(const line of record.receipt.paymentLines){const item=doc.createElement('li'),label={cash:'现金',wechat:'微信',alipay:'支付宝',member_value:'储值卡',member_units:'次卡/疗程'}[line.method];item.textContent=`支付记录 ${serverId(line.paymentId)} · ${label} ¥${line.amount}${line.method==='member_value'||line.method==='member_units'?` · 账户 ${serverId(line.accountId)}`:''}`;lines.append(item);}
 key.textContent='恢复过程只查询原请求与当前订单，没有重放支付。';container.replaceChildren(heading,body,state,lines,key);
}
