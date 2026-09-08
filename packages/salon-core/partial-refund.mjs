import {serverId,amountToCents} from './api-client.mjs';
import {cashRefundSource,verifyCashRefundReceipt} from './refund-request.mjs';
import {inspectRefund} from './refund-review.mjs';
const fail=()=>{throw Error('部分退款数量、金额或原单核对不匹配');};
const fixed=(value,digits)=>{if(typeof value!=='string'||!new RegExp(`^\\d{1,${digits===2?10:9}}\\.\\d{${digits}}$`).test(value))fail();return Number(value.replace('.',''));};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function allocations(lines){
 if(!Array.isArray(lines)||!lines.length||lines.length>100)fail();
 const seen=new Set();let total=0;
 for(const row of lines){const id=serverId(row.orderLineId);if(seen.has(id)||fixed(row.quantity,3)<=0||fixed(row.amount,2)<=0)fail();seen.add(id);total+=fixed(row.amount,2);}
 if(!Number.isSafeInteger(total))fail();return total;
}
export function partialRefundProposal(source,lines,scope){
 cashRefundSource(source,source.orderId,scope);
 const total=allocations(lines);
 for(const row of lines){const original=source.lines.find(l=>l.id===row.orderLineId);if(!original||fixed(row.quantity,3)>fixed(original.quantity,3)||fixed(row.amount,2)>fixed(original.amount,2))fail();}
 if(total>=amountToCents(source.amount))throw Error('部分退款合计须小于原单应收；全额请使用全退入口');
 return freeze({orderId:source.orderId,paymentId:source.paymentId,originalAmount:source.amount,amount:(total/100).toFixed(2),lines:structuredClone(lines)});
}
export function verifyPartialRefundReceipt(data,key,scope,proposal=null){
 verifyCashRefundReceipt(data,key,scope);
 if(data.refundType!=='partial'||fixed(data.originalAmount,2)<=fixed(data.requestedAmount,2)||allocations(data.lines)!==fixed(data.requestedAmount,2))fail();
 if(proposal&&(data.orderId!==proposal.orderId||data.paymentId!==proposal.paymentId||data.originalAmount!==proposal.originalAmount||data.requestedAmount!==proposal.amount||!sameLines(data.lines,proposal.lines)))fail();
 return freeze(structuredClone(data));
}
function sameLines(actual,expected){return actual.length===expected.length&&expected.every(row=>actual.some(x=>x.orderLineId===row.orderLineId&&x.quantity===row.quantity&&x.amount===row.amount));}
export function verifyPartialRefundReadback(data,receipt,scope,source=null,reason=null){
 const current=inspectRefund(data,receipt.refundRequestId,scope),r=data.refund,p=data.payments;
 if(r.type!=='partial'||r.createdByStaffId!==scope.staffId||r.orderId!==receipt.orderId||r.amount!==receipt.requestedAmount||(reason!==null&&r.reason!==reason)||!sameLines(data.lines,receipt.lines)||p.length!==1||p[0].paymentId!==receipt.paymentId||p[0].method!=='cash'||p[0].originalMethod!=='cash'||p[0].originalAmount!==receipt.originalAmount||p[0].amount!==receipt.requestedAmount||p[0].units!=='0.000'||p[0].originalUnits!=='0.000')fail();
 if(source)for(const row of data.lines){const original=source.lines.find(l=>l.id===row.orderLineId);if(!original||original.name!==row.name||original.type!==row.type)fail();}
 return current;
}
export function renderPartialRefundEditor(container,source,onChange){
 const doc=container.ownerDocument,fragment=doc.createDocumentFragment(),inputs=[];
 const heading=doc.createElement('p');heading.textContent=`原单 ${source.number} · 原现金支付 ${source.paymentId} · 原应收 ¥${source.amount}。勾选项目后分别填写申请数量、金额；不会按当前售价或数量自动计算退款金额。`;fragment.append(heading);
 for(const row of source.lines){
  const box=doc.createElement('fieldset'),legend=doc.createElement('legend');box.style.minWidth='0';box.style.overflowWrap='anywhere';legend.textContent=`${row.name} · 原数量 ${row.quantity} · 原金额 ¥${row.amount}`;box.append(legend);
  const selected=doc.createElement('input'),selectionLabel=doc.createElement('label');selected.type='checkbox';selected.style.width='auto';selected.setAttribute('aria-label',`选择退款明细 ${row.id}`);selectionLabel.append(selected,doc.createTextNode('申请退此项'));box.append(selectionLabel);
  const quantity=doc.createElement('input'),amount=doc.createElement('input');
  for(const [el,label,max] of [[quantity,'申请退款数量（最多三位小数）',13],[amount,'申请退款金额（最多两位小数）',13]]){const l=doc.createElement('label');l.textContent=label;el.inputMode='decimal';el.maxLength=max;el.disabled=true;l.append(el);box.append(l);el.oninput=onChange;}
  selected.onchange=()=>{quantity.disabled=amount.disabled=!selected.checked;onChange();};
  if(row.type==='product'){const warning=doc.createElement('p');warning.textContent='申请数量不代表商品已验收或允许返库；本页不执行返库。';box.append(warning);}
  inputs.push({row,selected,quantity,amount});fragment.append(box);
 }
 container.replaceChildren(fragment);
 const normalize=(value,digits)=>{const s=value.trim();if(!new RegExp(`^\\d{1,${digits===2?10:9}}(?:\\.\\d{1,${digits}})?$`).test(s))fail();const [whole,fraction='']=s.split('.');return `${Number(whole)}.${fraction.padEnd(digits,'0')}`;};
 return ()=>inputs.filter(x=>x.selected.checked).map(x=>({orderLineId:x.row.id,quantity:normalize(x.quantity.value,3),amount:normalize(x.amount.value,2)}));
}
