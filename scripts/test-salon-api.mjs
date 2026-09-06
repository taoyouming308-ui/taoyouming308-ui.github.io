import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSalonHandler} from '../supabase/functions/_shared/salon-api-core.mjs';

const calls=[],logs=[];
const handler=createSalonHandler({
  verifyUser:async token=>token==='valid-user-token-123456789'?{id:'auth-user-1'}:null,
  findStaff:async id=>id==='auth-user-1'?{id:7,organization_id:3,store_id:9,display_name:'员工甲',employment_status:'active'}:null,
  invoke:async(rpc,args)=>{calls.push({rpc,args});return{ok:true,rpc}},
  read:async(operation,scope)=>{calls.push({operation,scope});return[{ok:true}]},
  log:async row=>logs.push(row),
});
const request=(body,token='valid-user-token-123456789')=>new Request('http://local/salon-api',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});

let result=await handler(new Request('http://local/salon-api',{method:'POST'}));
assert.equal(result.status,403,'missing bearer token must be rejected');
result=await handler(request({operation:'checkout',orderId:4,requestKey:'checkout-request-0001',payments:[{method:'cash',amount:120}],p_store_id:999}));
assert.equal(result.status,200);assert.equal(calls[0].rpc,'salon_checkout_order');
assert.deepEqual({actor:calls[0].args.p_actor_staff_id,org:calls[0].args.p_organization_id,store:calls[0].args.p_store_id},{actor:7,org:3,store:9},'identity and store must come from server staff binding');
assert.equal('staffId' in calls[0].args,false);assert.equal(calls[0].args.p_order_id,4);
result=await handler(request({operation:'refund_execute',refundRequestId:51,requestKey:'refund-execute-0001'}));
assert.equal(result.status,200);assert.equal(calls[1].rpc,'salon_execute_refund_request');
result=await handler(request({operation:'inventory_move',catalogItemId:8,requestKey:'inventory-request-001',movementType:'sale',quantity:1,orderId:4,reason:'订单销售'}));
assert.equal(result.status,200);assert.equal(calls[2].rpc,'salon_move_inventory');
result=await handler(request({operation:'context'}));assert.equal(result.status,200);assert.deepEqual(result.body.data,{staffId:7,organizationId:3,storeId:9,displayName:'员工甲'});
result=await handler(request({operation:'order_receipt',orderId:4,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{organizationId:3,storeId:9,orderId:4});
result=await handler(request({operation:'inventory',catalogItemId:8}));assert.equal(result.status,200);assert.equal(calls.at(-1).scope.storeId,9);
result=await handler(request({operation:'customer_create',requestKey:'customer-create-0001',displayName:'测试顾客',phone:'138 0000 0000',ownerStaffId:7,source:'walkin',tags:['新客']}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_create_customer');assert.equal(calls.at(-1).args.p_store_id,9);
result=await handler(request({operation:'customer_status',requestKey:'customer-status-0001',customerId:12,status:'frozen',reason:'顾客申请'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_set_customer_status');
result=await handler(request({operation:'customer_relation',requestKey:'customer-relation-01',customerId:12,ownerStaffId:7,source:'referral',tags:['重点']}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_update_customer_relation');
result=await handler(request({operation:'customers',query:'13800000000',status:'active',limit:50,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{actorStaffId:7,organizationId:3,storeId:9,query:'13800000000',status:'active',limit:50});
result=await handler(request({operation:'catalog_create',requestKey:'catalog-create-0001',code:'prd-01',itemType:'product',name:'洗发水',listPrice:128,memberPrice:108,costPrice:50,unit:'瓶',stockTracked:true,safetyStock:3}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_create_catalog_item');assert.equal(calls.at(-1).args.p_store_id,9);
result=await handler(request({operation:'catalog_enable',requestKey:'catalog-enable-0001',catalogItemId:21,stockTracked:true,safetyStock:2}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_enable_catalog_item');
result=await handler(request({operation:'catalog_status',requestKey:'catalog-status-0001',catalogItemId:21,status:'disabled',reason:'门店停售'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_set_catalog_status');
result=await handler(request({operation:'inventory_count',requestKey:'inventory-count-001',catalogItemId:21,counted:8,reason:'月末盘点'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_count_inventory');
result=await handler(request({operation:'catalog',itemType:'product',status:'active',query:'洗发',limit:50,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{actorStaffId:7,organizationId:3,storeId:9,itemType:'product',status:'active',query:'洗发',limit:50});
result=await handler(request({operation:'member_open',requestKey:'member-open-00001',customerId:12,accountType:'stored_value',accountNo:'SV-1',displayName:'储值卡',usableScope:'store'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_open_member_account');
result=await handler(request({operation:'member_recharge',requestKey:'member-recharge-01',accountId:31,paidAmount:500,cashAdded:500,bonusAdded:50,unitsAdded:0,paymentMethod:'wechat',externalReference:'TEST-1',reason:'测试充值'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_recharge_member_account');
result=await handler(request({operation:'member_status',requestKey:'member-status-0001',accountId:31,status:'frozen',reason:'顾客申请'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_set_member_status');
result=await handler(request({operation:'members',customerId:12,status:'active',limit:50,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{actorStaffId:7,organizationId:3,storeId:9,customerId:12,status:'active',limit:50});
result=await handler(request({operation:'order_create',requestKey:'order-create-00001',customerId:12,notes:'到店开单'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_create_order');
result=await handler(request({operation:'order_lines',requestKey:'order-lines-00001',orderId:41,lines:[{catalogItemId:21,quantity:1,unitPrice:180,discountAmount:20,staffId:7}],discountReason:'新客优惠'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_replace_order_lines');
result=await handler(request({operation:'order_status',requestKey:'order-status-0001',orderId:41,status:'opened'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_set_order_status');
result=await handler(request({operation:'order_detail',orderId:41,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{actorStaffId:7,organizationId:3,storeId:9,orderId:41});
result=await handler(request({operation:'refund_request',requestKey:'refund-apply-0001',orderId:41,refundType:'partial',reason:'部分退货',lines:[{orderLineId:5,quantity:1,amount:80}],payments:[{originalPaymentId:9,amount:80}]}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_submit_refund_request');
result=await handler(request({operation:'refund_review',requestKey:'refund-review-001',refundRequestId:51,decision:'approved',reason:'核对通过'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_review_refund_request');
result=await handler(request({operation:'refunds',status:'submitted',limit:50,storeId:999}));assert.equal(result.status,200);assert.equal(calls.at(-1).scope.storeId,9);
result=await handler(request({operation:'refund_execute',refundRequestId:51,requestKey:'short'}));assert.equal(result.status,400);
result=await handler(request({operation:'checkout',orderId:4,requestKey:'checkout-request-0002',payments:[]}));assert.equal(result.status,400);
result=await handler(request({operation:'unknown'}));assert.equal(result.status,400);
result=await handler(request({operation:'refund_execute',refundRequestId:51,requestKey:'refund-execute-0002'},'invalid-user-token-123456'));assert.equal(result.status,403);
assert.ok(logs.every(log=>!('token'in log)&&!('payments'in log)&&!('amount'in log)),'request logs must not contain credentials or business payloads');
assert.ok(logs.every(log=>typeof log.request_id==='string'&&log.request_id.length>20));
assert.equal(logs.find(log=>log.operation==='unknown').error_code,'UNSUPPORTED_OPERATION');

const failing=createSalonHandler({verifyUser:async()=>({id:'auth-user-1'}),findStaff:async()=>({id:7,organization_id:3,store_id:9,employment_status:'active'}),invoke:async()=>{throw new Error('数据库请求失败 (500) secret internal detail')}});
result=await failing(request({operation:'refund_execute',refundRequestId:51,requestKey:'refund-execute-0003'}));assert.equal(result.status,500);assert.equal(result.body.code,'DATABASE_OPERATION_FAILED');assert.equal(result.body.error,'操作未完成，请稍后重试');assert.doesNotMatch(JSON.stringify(result.body),/secret internal detail/);

const edge=fs.readFileSync('supabase/functions/salon-api/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260906064313_salon_auth_identity.sql','utf8');
assert.match(edge,/\/auth\/v1\/user/);assert.match(edge,/SALON_ALLOWED_ORIGINS/);
assert.match(edge,/salon_api_request_logs/);assert.match(edge,/X-Request-ID/);
assert.match(edge,/tendered_amount,change_amount,external_reference/,'receipt payment evidence missing');
assert.doesNotMatch(edge,/user_metadata|raw_user_meta_data/);
assert.doesNotMatch(edge,/service_role.{0,80}(console|Response|body)/i);
assert.match(edge,/rpc\/salon_list_customers/);assert.doesNotMatch(edge,/select=.*phone_normalized/,'customer list must not select raw phones in Edge code');
assert.match(migration,/auth_user_id uuid/);assert.match(migration,/unique index salon_staff_auth_user_org_idx/);
const logMigration=fs.readFileSync('supabase/migrations/20260906064812_salon_api_request_log.sql','utf8'),logColumns=logMigration.match(/create table public\.salon_api_request_logs\(([\s\S]*?)\);/i)?.[1]||'';assert.ok(logColumns);assert.doesNotMatch(logColumns,/payload|phone|customer_name|amount/i);
console.log('salon api tests passed: scoped reads, stable errors, request ids, metadata-only logs, secret boundary');
