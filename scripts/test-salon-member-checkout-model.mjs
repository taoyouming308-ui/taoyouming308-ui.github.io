import assert from 'node:assert/strict';
import {inspectStoredValueAccounts,createStoredValueCheckoutPlan,verifyRecoveredCheckoutLookup} from '../packages/salon-core/member-checkout.mjs';

const scope={organizationId:1,storeId:2,staffId:7},customerId=9;
const rows=[{account_id:11,organization_id:1,store_id:2,customer_id:9,account_type:'stored_value',account_no:'SYNTHETIC-0001',display_name:'合成储值卡',status:'active',cash_balance:100,home_store_id:2,usable_scope:'store'}];
const [account]=inspectStoredValueAccounts(rows,scope,customerId);
assert.equal(account.id,11);assert.equal(account.balanceCents,10000);
const plan=createStoredValueCheckoutPlan({orderId:30,version:4,payable:'100.00',account,storedValueAmount:'40.01',cashTendered:'70'});
assert.deepEqual(plan.payments,[{method:'member_value',amount:'40.01',accountId:11},{method:'cash',amount:'59.99',tenderedAmount:'70.00'}]);
assert.equal(plan.change,'10.01');
const fullyStored=createStoredValueCheckoutPlan({orderId:30,version:4,payable:'100.00',account,storedValueAmount:'100',cashTendered:''});
assert.equal(fullyStored.payments.length,1);assert.equal(fullyStored.cashAmount,'0.00');
assert.throws(()=>inspectStoredValueAccounts([{...rows[0],customer_id:10}],scope,customerId),/不属于当前顾客/);
assert.throws(()=>inspectStoredValueAccounts([{...rows[0],home_store_id:3}],scope,customerId),/不属于当前顾客/);
assert.throws(()=>inspectStoredValueAccounts([{...rows[0],status:'frozen'}],scope,customerId),/不属于当前顾客/);
assert.throws(()=>inspectStoredValueAccounts([{...rows[0],account_type:'package'}],scope,customerId),/不属于当前顾客/);
assert.throws(()=>createStoredValueCheckoutPlan({orderId:30,version:4,payable:'100',account,storedValueAmount:'100.01',cashTendered:'0'}),/不能超过/);
assert.throws(()=>createStoredValueCheckoutPlan({orderId:30,version:4,payable:'100',account,storedValueAmount:'20',cashTendered:'79.99'}),/不能低于/);
assert.throws(()=>createStoredValueCheckoutPlan({orderId:30,version:4,payable:'100',account,storedValueAmount:'1.001',cashTendered:'99'}),/最多两位小数/);

const requestKey='synthetic-member-recovery-0001',receipt={status:'paid',expectedVersion:4,orderId:30,organizationId:1,storeId:2,requestKey,paid:'100.00',change:'10.01',paymentLines:[
 {paymentId:101,method:'member_value',amount:'40.01',accountId:11,tendered:'40.01',change:'0.00'},
 {paymentId:102,method:'cash',amount:'59.99',accountId:null,tendered:'70.00',change:'10.01'}
]};
const lookup={operation:'checkout',status:'committed',resourceType:'order',resourceId:30,completedAt:'2026-09-24T00:00:00Z',receipt};
assert.equal(verifyRecoveredCheckoutLookup(lookup,scope,requestKey,30,'100').receipt,receipt);
assert.throws(()=>verifyRecoveredCheckoutLookup({...lookup,receipt:{...receipt,storeId:1}},scope,requestKey,30,'100'),/禁止重复收款/);
assert.throws(()=>verifyRecoveredCheckoutLookup({...lookup,receipt:{...receipt,change:'9.00'}},scope,requestKey,30,'100'),/禁止重复收款/);
console.log('Member checkout model passed: RPC row mapping, store/customer scope, cents, split payment, recovery and tamper rejection');
