import assert from 'node:assert/strict';
import {cashRefundSource,verifyCashRefundReceipt,verifyCashRefundReadback} from '../packages/salon-core/refund-request.mjs';
import {createSalonHandler} from '../supabase/functions/_shared/salon-api-core.mjs';
const scope={organizationId:1,storeId:1,staffId:1};
const source={organizationId:1,storeId:1,orderId:2,number:'TEST',version:4,paymentId:8,method:'cash',amount:'12.34',lines:[{id:5,name:'synthetic',type:'product',quantity:'1.000',amount:'12.34'}]};
assert.ok(Object.isFrozen(cashRefundSource(source,2,scope).lines[0]));
for(const change of [x=>x.storeId=2,x=>x.method='member_balance',x=>x.lines.push(x.lines[0]),x=>x.amount='12.33',x=>x.lines[0].quantity='0.000',x=>x.lines[0].amount='0.00',x=>x.lines[0].amount='1e2',x=>x.version=-1]){const bad=structuredClone(source);change(bad);assert.throws(()=>cashRefundSource(bad,2,scope));}
const receipt={refundRequestId:3,orderId:2,paymentId:8,status:'submitted',requestedAmount:'12.34',createdByStaffId:1,requestKey:'full-unit-key-0001'};
verifyCashRefundReceipt(receipt,receipt.requestKey,scope,source);
for(const delta of [{paymentId:9},{createdByStaffId:2},{requestedAmount:'20.00'},{status:'approved'},{requestKey:'wrong'}])assert.throws(()=>verifyCashRefundReceipt({...receipt,...delta},receipt.requestKey,scope,source));
const detail={refund:{id:3,organizationId:1,storeId:1,orderId:2,type:'full',status:'submitted',amount:'12.34',reason:'test',createdByStaffId:1,reviewedByStaffId:null,decisionReason:''},order:{id:2,number:'TEST',status:'paid',payable:'12.34',refundedTotal:'0.00',version:4},lines:[{orderLineId:5,name:'synthetic',type:'product',quantity:'1.000',amount:'12.34'}],payments:[{paymentId:8,method:'cash',amount:'12.34',units:'0.000',originalMethod:'cash',originalAmount:'12.34',originalUnits:'0.000',originalStatus:'confirmed'}]};
assert.equal(verifyCashRefundReadback(detail,receipt,scope,source,'test').canReview,false);
for(const change of [x=>x.refund.reason='wrong',x=>x.refund.createdByStaffId=2,x=>x.lines[0].name='wrong',x=>x.payments[0].amount='12.33']){const bad=structuredClone(detail);change(bad);assert.throws(()=>verifyCashRefundReadback(bad,receipt,scope,source,'test'));}
const later=structuredClone(detail);later.refund.status='approved';later.refund.reviewedByStaffId=2;verifyCashRefundReadback(later,receipt,scope);
const wrongOriginal=structuredClone(detail);wrongOriginal.payments[0].originalAmount='20.00';assert.throws(()=>verifyCashRefundReadback(wrongOriginal,receipt,scope));
const calls=[];const handler=createSalonHandler({verifyUser:async()=>({id:'test'}),findStaff:async()=>({id:1,organization_id:1,store_id:1,employment_status:'active'}),resolveStore:async()=>1,invoke:async(name,args)=>{calls.push({name,args});return {};}});
const send=body=>handler(new Request('http://127.0.0.1/test',{method:'POST',headers:{Authorization:'Bearer synthetic-token-123456'},body:JSON.stringify(body)}));
const payload={operation:'cash_refund_request',orderId:2,reason:'test',requestKey:receipt.requestKey,expectedSnapshot:source};
assert.equal((await send({...payload,actorStaffId:9,organizationId:9})).status,200);assert.equal(calls.at(-1).name,'salon_request_cash_refund');assert.equal(calls.at(-1).args.p_actor_staff_id,1);assert.equal(calls.at(-1).args.p_organization_id,1);
for(const delta of [{expectedSnapshot:null},{expectedSnapshot:[]},{reason:' '},{reason:'x'.repeat(501)},{requestKey:'short'},{orderId:'2'}]){const count=calls.length;assert.notEqual((await send({...payload,...delta})).status,200);assert.equal(calls.length,count);}
assert.equal((await send({operation:'cash_refund_source',orderId:2})).status,200);assert.equal(calls.at(-1).name,'salon_get_cash_refund_source');
assert.equal((await send({operation:'request_lookup',targetOperation:'cash_refund_request',requestKey:receipt.requestKey})).status,200);
console.log('Cash full refund model/API passed: immutable source, exact allocations, original receipt, historical readback, strict inputs and server identity');
