import {serverId,amountToCents,orderEditVersion} from './api-client.mjs';
export const refundStates=Object.freeze({submitted:'待审批',approved:'已批准（未执行）',rejected:'已拒绝',executed:'已执行',cancelled:'已取消'});
const methods=Object.freeze({cash:'现金',wechat:'微信',alipay:'支付宝',member_value:'储值卡',member_units:'次卡/疗程'});
const fail=()=>{throw Error('退款核对数据不完整或范围不匹配，请重新读取');};
const money=value=>{if(typeof value!=='string'||!/^\d{1,10}\.\d{2}$/.test(value))fail();return amountToCents(value);};
const units=value=>{if(typeof value!=='string'||!/^\d{1,11}\.\d{3}$/.test(value))fail();const n=Number(value.replace('.',''));if(!Number.isSafeInteger(n))fail();return n;};
const label=(value,max=500)=>{if(typeof value!=='string'||value.length>max)fail();return value;};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function refundPage(data,scope,{status='submitted',beforeId=null}={}){
 if(!data||serverId(data.organizationId)!==serverId(scope.organizationId)||serverId(data.storeId)!==serverId(scope.storeId)||!Array.isArray(data.rows)||data.rows.length>50)fail();
 let previous=beforeId??Infinity;
 const rows=data.rows.map(row=>{
  const id=serverId(row.id);serverId(row.orderId);money(row.amount);
  if(id>=previous||!Object.hasOwn(refundStates,row.status)||(status&&row.status!==status))fail();previous=id;
  return Object.freeze({...row});
 });
 const next=data.nextBeforeId===null?null:serverId(data.nextBeforeId);
 if(next!==null&&(rows.length!==50||next!==rows.at(-1).id))fail();
 return Object.freeze({rows:Object.freeze(rows),nextBeforeId:next});
}
export function inspectRefund(data,id,scope){
 const r=data?.refund,o=data?.order;
 if(!r||!o||serverId(r.id)!==serverId(id)||serverId(r.organizationId)!==serverId(scope.organizationId)||serverId(r.storeId)!==serverId(scope.storeId)||serverId(r.orderId)!==serverId(o.id))fail();
 if(!Object.hasOwn(refundStates,r.status)||!['full','partial'].includes(r.type)||!['paid','reversed','draft','opened','in_service','awaiting_payment','cancelled'].includes(o.status))fail();
 serverId(r.createdByStaffId);if(r.reviewedByStaffId!==null)serverId(r.reviewedByStaffId);orderEditVersion(o.version);
 const withdrawnBy=r.withdrawnByStaffId??null,withdrawalReason=r.withdrawalReason??'';
 if(withdrawnBy!==null){serverId(withdrawnBy);if(r.status!=='cancelled'||!withdrawalReason)fail();}label(withdrawalReason);
 label(r.reason);label(r.decisionReason);label(o.number,160);
 const total=money(r.amount),payable=money(o.payable),refunded=money(o.refundedTotal);
 if(!Array.isArray(data.lines)||data.lines.length>100||!Array.isArray(data.payments)||data.payments.length>100)fail();
 let lineTotal=0,paymentTotal=0,validPayments=true;const ids=new Set();
 for(const l of data.lines){const key=serverId(l.orderLineId);if(ids.has(key)||!['service','product','package','year_card'].includes(l.type)||units(l.quantity)<=0)fail();ids.add(key);label(l.name,200);lineTotal+=money(l.amount);
  if(l.stockInspection!=null){const i=l.stockInspection;if(l.type!=='product'||!Number.isSafeInteger(i.revision)||i.revision<=0||units(i.requestedQuantity)!==units(l.quantity)||units(i.acceptedQuantity)>units(l.quantity)||!['sealed','opened','damaged','not_returnable'].includes(i.condition)||!Number.isFinite(Date.parse(i.inspectedAt)))fail();serverId(i.inspectedByStaffId);label(i.reason);}
 }
 ids.clear();
 for(const p of data.payments){
  const key=serverId(p.paymentId);if(ids.has(key)||!Object.hasOwn(methods,p.method)||!Object.hasOwn(methods,p.originalMethod)||!['pending','confirmed','failed','reversed'].includes(p.originalStatus))fail();ids.add(key);
  const amount=money(p.amount),original=money(p.originalAmount),requestedUnits=units(p.units),originalUnits=units(p.originalUnits);
  paymentTotal+=amount;validPayments&&=amount>0&&amount<=original&&p.method===p.originalMethod&&p.originalStatus==='confirmed'&&(p.method==='member_units'?(requestedUnits>0&&requestedUnits<=originalUnits):requestedUnits===0);
 }
 const canReview=r.status==='submitted'&&serverId(r.createdByStaffId)!==serverId(scope.staffId);
 const canWithdraw=r.status==='submitted'&&serverId(r.createdByStaffId)===serverId(scope.staffId);
 const canInspectStock=r.status==='approved'&&data.lines.some(line=>line.type==='product');
 const canApprove=canReview&&o.status==='paid'&&total>0&&total<=payable-refunded&&lineTotal===total&&paymentTotal===total&&data.lines.length>0&&data.payments.length>0&&validPayments;
 return Object.freeze({snapshot:freeze(JSON.parse(JSON.stringify(data))),canReview,canApprove,canWithdraw,canInspectStock});
}
export function verifyRefundStockInspection(data,refundId,scope,{orderLineId,acceptedQuantity,condition}){
 if(!data||serverId(data.refundRequestId)!==serverId(refundId)||serverId(data.orderLineId)!==serverId(orderLineId)||data.status!=='recorded'||!Number.isSafeInteger(data.revision)||data.revision<1||data.acceptedQuantity!==acceptedQuantity||data.condition!==condition)throw Error('商品验收回执不匹配，请只读核对原请求');
 return Object.freeze({...data});
}
export function verifyRefundDecision(data,id,scope,decision=null){
 if(!data||serverId(data.refundRequestId)!==serverId(id)||serverId(data.reviewedByStaffId)!==serverId(scope.staffId)||!['approved','rejected'].includes(data.status)||(decision&&data.status!==decision))throw Error('退款审批回执不匹配，请核对原请求');
 serverId(data.orderId);return Object.freeze({...data});
}
export function renderRefund(container,record){
 const d=container.ownerDocument,{refund:r,order:o,lines,payments}=record.snapshot,fragment=d.createDocumentFragment();
 const add=(tag,text)=>{const el=d.createElement(tag);el.textContent=text;fragment.append(el);};
 add('h3',`退款申请 ${r.id} · ${refundStates[r.status]}`);
 add('p',`原单 ${o.number}（${o.id}）· 当前 ${o.status} · 原应收 ¥${o.payable} · 已执行退款 ¥${o.refundedTotal}`);
 add('p',`${r.type==='full'?'全额':'部分'}退款 ¥${r.amount} · 申请人编号 ${r.createdByStaffId} · 原因：${r.reason}`);
 for(const l of lines){add('p',`明细 ${l.orderLineId} · ${l.name} · ${l.quantity} · 申请退 ¥${l.amount}${l.type==='product'?'（商品；执行前需验收）':''}`);
  if(l.type==='product'&&l.stockInspection)add('p',`最近验收 v${l.stockInspection.revision} · 可返库 ${l.stockInspection.acceptedQuantity}/${l.quantity} · ${l.stockInspection.condition} · 员工 ${l.stockInspection.inspectedByStaffId} · ${l.stockInspection.reason}`);
  if(l.type==='product'&&r.status==='approved'){
   const box=d.createElement('fieldset'),qty=d.createElement('input'),condition=d.createElement('select'),reason=d.createElement('input'),button=d.createElement('button');box.dataset.stockLineId=String(l.orderLineId);
   const qLabel=d.createElement('label');qLabel.textContent=`明细 ${l.orderLineId} 实物验收可返库数量（最多 ${l.quantity}）`;qty.type='text';qty.inputMode='decimal';qty.autocomplete='off';qty.maxLength=13;qty.placeholder='例如 1.000';qty.value=l.stockInspection?.acceptedQuantity??'';qLabel.append(qty);
   const cLabel=d.createElement('label');cLabel.textContent='商品状态';for(const [value,text] of [['sealed','未拆封'],['opened','已拆封可再售'],['damaged','破损/瑕疵'],['not_returnable','不可再售']]){const option=d.createElement('option');option.value=value;option.textContent=text;condition.append(option);}condition.value=l.stockInspection?.condition??'sealed';cLabel.append(condition);
   const rLabel=d.createElement('label');rLabel.textContent='验收说明';reason.type='text';reason.maxLength=500;reason.autocomplete='off';reason.placeholder='说明实收、外观及处理';reason.value=l.stockInspection?.reason??'';rLabel.append(reason);
   button.type='button';button.dataset.refundStockInspect='true';button.textContent=l.stockInspection?'追加验收修订（不执行退款）':'记录商品验收（不执行退款）';box.append(qLabel,cLabel,rLabel,button);fragment.append(box);
  }
 }
 for(const p of payments)add('p',`原支付 ${p.paymentId} · ${methods[p.method]} · 原金额 ¥${p.originalAmount} · 申请退 ¥${p.amount} · 原状态 ${p.originalStatus}${p.method==='member_units'?' · 申请退次数 '+p.units+' / 原次数 '+p.originalUnits:''}`);
 if(r.reviewedByStaffId!==null)add('p',`审批人编号 ${r.reviewedByStaffId} · 意见：${r.decisionReason}`);
 if(r.status==='cancelled'&&r.withdrawnByStaffId!=null)add('p',`撤回人编号 ${r.withdrawnByStaffId} · 撤回原因：${r.withdrawalReason||''}`);
 add('p',record.canApprove?'请逐项核对原因、原支付和返库情况；批准只改变审批状态。':record.canReview?'分配或原单状态不满足批准条件；可以核实后拒绝，不可强行批准。':'当前不可审批：申请人与审批人须分开，且申请必须处于待审批。');
 add('p','验收只记录可返库数量；不会改库存，也不执行退款。实际支付渠道退款回执与返库仍须后续独立核验。');
 container.replaceChildren(fragment);
}
