import assert from 'node:assert/strict';
import {cashRefundAvailability} from '../packages/salon-core/refund-availability.mjs';
import {partialRefundProposal} from '../packages/salon-core/partial-refund.mjs';
import {createSalonHandler} from '../supabase/functions/_shared/salon-api-core.mjs';
const scope={organizationId:1,storeId:1,staffId:1};
const source={organizationId:1,storeId:1,orderId:2,number:'TEST',version:4,paymentId:8,method:'cash',amount:'12.34',executedAmount:'4.00',pendingAmount:'3.00',availableAmount:'5.34',reservations:[{id:3,status:'executed',amount:'4.00'},{id:4,status:'submitted',amount:'3.00'}],lines:[{id:5,name:'synthetic',type:'product',quantity:'1.000',amount:'12.34',executedQuantity:'0.250',pendingQuantity:'0.250',availableQuantity:'0.500',executedAmount:'4.00',pendingAmount:'3.00',availableAmount:'5.34'}]};
assert.ok(Object.isFrozen(cashRefundAvailability(source,2,scope).reservations[0]));
assert.equal(partialRefundProposal(source,[{orderLineId:5,quantity:'0.500',amount:'5.34'}],scope).amount,'5.34');
for(const change of [x=>x.availableAmount='5.35',x=>x.lines[0].availableQuantity='0.501',x=>x.lines[0].executedAmount='3.99',x=>x.pendingAmount='-3.00',x=>x.reservations.push(x.reservations[0]),x=>x.reservations[1].status='rejected',x=>x.reservations[0].amount='3.00',x=>x.storeId=2]){const bad=structuredClone(source);change(bad);assert.throws(()=>cashRefundAvailability(bad,2,scope));}
for(const lines of [[{orderLineId:5,quantity:'0.501',amount:'1.00'}],[{orderLineId:5,quantity:'0.500',amount:'5.35'}]])assert.throws(()=>partialRefundProposal(source,lines,scope));
const zero=structuredClone(source);zero.executedAmount='12.34';zero.pendingAmount='0.00';zero.availableAmount='0.00';zero.reservations=[{id:3,status:'executed',amount:'12.34'}];Object.assign(zero.lines[0],{executedQuantity:'1.000',pendingQuantity:'0.000',availableQuantity:'0.000',executedAmount:'12.34',pendingAmount:'0.00',availableAmount:'0.00'});cashRefundAvailability(zero,2,scope);assert.throws(()=>partialRefundProposal(zero,[{orderLineId:5,quantity:'0.001',amount:'0.01'}],scope));
let called;const handler=createSalonHandler({verifyUser:async()=>({id:'test'}),findStaff:async()=>({id:1,organization_id:1,store_id:1,employment_status:'active'}),resolveStore:async()=>1,invoke:async(name,args)=>{called={name,args};return {};}});
const send=body=>handler(new Request('http://127.0.0.1/test',{method:'POST',headers:{Authorization:'Bearer synthetic-token-123456'},body:JSON.stringify(body)}));
assert.equal((await send({operation:'cash_refund_availability',orderId:2,actorStaffId:99,organizationId:99})).status,200);assert.equal(called.name,'salon_get_cash_refund_availability');assert.equal(called.args.p_actor_staff_id,1);
assert.notEqual((await send({operation:'cash_refund_availability',orderId:'2'})).status,200);
console.log('Cash refund availability model/API passed: exact executed/pending/available balance, quantities, reservations, zero quota, scoped identity and no over-allocation');
