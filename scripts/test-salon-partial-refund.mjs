import assert from 'node:assert/strict';
import {partialRefundProposal,verifyPartialRefundReceipt,verifyPartialRefundReadback} from '../packages/salon-core/partial-refund.mjs';
import {createSalonHandler} from '../supabase/functions/_shared/salon-api-core.mjs';
const scope={organizationId:1,storeId:1,staffId:1},source={organizationId:1,storeId:1,orderId:2,number:'TEST',version:4,paymentId:8,method:'cash',amount:'12.34',lines:[{id:5,name:'synthetic',type:'product',quantity:'2.000',amount:'12.34'}]};
const lines=[{orderLineId:5,quantity:'1.000',amount:'4.00'}],proposal=partialRefundProposal(source,lines,scope);
assert.equal(proposal.amount,'4.00');assert.ok(Object.isFrozen(proposal.lines[0]));
for(const bad of [[],[lines[0],lines[0]],[{...lines[0],orderLineId:8}],[{...lines[0],quantity:'2.001'}],[{...lines[0],quantity:'0.000'}],[{...lines[0],quantity:'1e0'}],[{...lines[0],amount:'12.34'}],[{...lines[0],amount:'12.35'}],[{...lines[0],amount:'0.00'}],[{...lines[0],amount:'1.001'}]])assert.throws(()=>partialRefundProposal(source,bad,scope));
const receipt={refundRequestId:3,orderId:2,paymentId:8,status:'submitted',refundType:'partial',requestedAmount:'4.00',originalAmount:'12.34',createdByStaffId:1,requestKey:'partial-unit-key01',lines};
verifyPartialRefundReceipt(receipt,receipt.requestKey,scope,proposal);
for(const delta of [{refundType:'full'},{requestedAmount:'5.00'},{originalAmount:'4.00'},{paymentId:9},{createdByStaffId:2},{requestKey:'wrong'},{lines:[{...lines[0],quantity:'1.001'}]}])assert.throws(()=>verifyPartialRefundReceipt({...receipt,...delta},receipt.requestKey,scope,proposal));
const detail={refund:{id:3,organizationId:1,storeId:1,orderId:2,type:'partial',status:'submitted',amount:'4.00',reason:'test',createdByStaffId:1,reviewedByStaffId:null,decisionReason:''},order:{id:2,number:'TEST',status:'paid',payable:'12.34',refundedTotal:'0.00',version:4},lines:[{...lines[0],name:'synthetic',type:'product'}],payments:[{paymentId:8,method:'cash',amount:'4.00',units:'0.000',originalMethod:'cash',originalAmount:'12.34',originalUnits:'0.000',originalStatus:'confirmed'}]};
assert.equal(verifyPartialRefundReadback(detail,receipt,scope,source,'test').canReview,false);
for(const change of [x=>x.lines[0].quantity='1.001',x=>x.refund.reason='wrong',x=>x.refund.type='full',x=>x.payments[0].originalAmount='20.00',x=>x.lines[0].name='wrong']){const bad=structuredClone(detail);change(bad);assert.throws(()=>verifyPartialRefundReadback(bad,receipt,scope,source,'test'));}
const later=structuredClone(detail);later.refund.status='approved';later.refund.reviewedByStaffId=2;verifyPartialRefundReadback(later,receipt,scope);
const calls=[];const handler=createSalonHandler({verifyUser:async()=>({id:'test'}),findStaff:async()=>({id:1,organization_id:1,store_id:1,employment_status:'active'}),resolveStore:async()=>1,invoke:async(name,args)=>{calls.push({name,args});return {};}});
const send=body=>handler(new Request('http://127.0.0.1/test',{method:'POST',headers:{Authorization:'Bearer synthetic-token-123456'},body:JSON.stringify(body)}));
const payload={operation:'partial_cash_refund_request',orderId:2,reason:'test',requestKey:receipt.requestKey,expectedSnapshot:source,lines};
assert.equal((await send({...payload,actorStaffId:9,organizationId:9})).status,200);assert.equal(calls.at(-1).name,'salon_request_partial_cash_refund');assert.equal(calls.at(-1).args.p_actor_staff_id,1);
for(const delta of [{lines:null},{lines:[]},{lines:[lines[0],lines[0]]},{lines:[{...lines[0],quantity:'1.0001'}]},{lines:[{...lines[0],amount:'1e2'}]},{expectedSnapshot:null},{reason:' '},{orderId:'2'}]){const count=calls.length;assert.notEqual((await send({...payload,...delta})).status,200);assert.equal(calls.length,count);}
assert.equal((await send({operation:'request_lookup',targetOperation:'partial_cash_refund_request',requestKey:receipt.requestKey})).status,200);
console.log('Partial cash refund model/API passed: exact separate quantity/amount, limits, no repricing, immutable preview, receipt allocations and strict server identity');
