import {serverId,amountToCents,orderEditVersion} from './api-client.mjs';
import {inspectRefund} from './refund-review.mjs';
const fail=()=>{throw Error('现金退款申请数据不完整或不匹配，请重新核对');};
const money=value=>{if(typeof value!=='string'||!/^\d{1,10}\.\d{2}$/.test(value))fail();return amountToCents(value);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function cashRefundSource(data,id,scope){
 if(!data||serverId(data.orderId)!==serverId(id)||serverId(data.organizationId)!==serverId(scope.organizationId)||serverId(data.storeId)!==serverId(scope.storeId)||data.method!=='cash')fail();
 serverId(data.paymentId);orderEditVersion(data.version);
 if(typeof data.number!=='string'||data.number.length>160||!Array.isArray(data.lines)||!data.lines.length||data.lines.length>100)fail();
 const seen=new Set();let total=0;
 for(const row of data.lines){
  const key=serverId(row.id);if(seen.has(key)||typeof row.name!=='string'||row.name.length>200||!['service','product','package','year_card'].includes(row.type)||typeof row.quantity!=='string'||!/^\d{1,9}\.\d{3}$/.test(row.quantity)||Number(row.quantity)<=0)fail();seen.add(key);
  const cents=money(row.amount);if(cents<=0)fail();total+=cents;
 }
 if(money(data.amount)<=0||total!==money(data.amount))fail();
 return freeze(JSON.parse(JSON.stringify(data)));
}
export function verifyCashRefundReceipt(data,key,scope,source=null){
 if(!data||data.status!=='submitted'||data.requestKey!==key||serverId(data.createdByStaffId)!==serverId(scope.staffId))fail();
 serverId(data.refundRequestId);serverId(data.orderId);serverId(data.paymentId);if(money(data.requestedAmount)<=0)fail();
 if(source&&(data.orderId!==source.orderId||data.paymentId!==source.paymentId||data.requestedAmount!==source.amount))fail();
 return Object.freeze({...data});
}
export function verifyCashRefundReadback(data,receipt,scope,source=null,reason=null){
 const current=inspectRefund(data,receipt.refundRequestId,scope),r=data.refund,p=data.payments;
 if(r.orderId!==receipt.orderId||r.createdByStaffId!==scope.staffId||r.type!=='full'||r.amount!==receipt.requestedAmount||(reason!==null&&r.reason!==reason)||p.length!==1||p[0].method!=='cash'||p[0].originalMethod!=='cash'||p[0].paymentId!==receipt.paymentId||p[0].amount!==receipt.requestedAmount||p[0].units!=='0.000')fail();
 if(p[0].originalAmount!==receipt.requestedAmount||p[0].originalUnits!=='0.000')fail();
 if(data.lines.reduce((sum,l)=>sum+money(l.amount),0)!==money(receipt.requestedAmount))fail();
 if(source){
  if(source.lines.length!==data.lines.length)fail();
  for(const row of source.lines){const got=data.lines.find(l=>l.orderLineId===row.id);if(!got||got.quantity!==row.quantity||got.amount!==row.amount||got.name!==row.name||got.type!==row.type)fail();}
 }
 return current;
}
export function renderCashRefundSource(container,data){
 const doc=container.ownerDocument,fragment=doc.createDocumentFragment();
 for(const text of [`原单 ${data.number} · 编号 ${data.orderId} · 核对版本 ${data.version}`,`原现金支付 ${data.paymentId} · 本次申请全退 ¥${data.amount}（不是实收现金含找零）`,...data.lines.map(l=>`${l.name} · 数量 ${l.quantity} · 申请退 ¥${l.amount}${l.type==='product'?' · 商品返库情况需另行核实':''}`),'提交只建立待审批申请；申请人不能审批本人申请。不退钱、不退会员、不返库。']){
  const p=doc.createElement('p');p.textContent=text;fragment.append(p);
 }
 container.replaceChildren(fragment);
}
