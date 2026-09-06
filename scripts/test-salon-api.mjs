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
result=await handler(request({operation:'refund',orderId:4,requestKey:'refund-request-00001',reason:'顾客取消'}));
assert.equal(result.status,200);assert.equal(calls[1].rpc,'salon_refund_order');
result=await handler(request({operation:'inventory_move',catalogItemId:8,requestKey:'inventory-request-001',movementType:'sale',quantity:1,orderId:4,reason:'订单销售'}));
assert.equal(result.status,200);assert.equal(calls[2].rpc,'salon_move_inventory');
result=await handler(request({operation:'context'}));assert.equal(result.status,200);assert.deepEqual(result.body.data,{staffId:7,organizationId:3,storeId:9,displayName:'员工甲'});
result=await handler(request({operation:'order_receipt',orderId:4,storeId:999}));assert.equal(result.status,200);assert.deepEqual(calls.at(-1).scope,{organizationId:3,storeId:9,orderId:4});
result=await handler(request({operation:'inventory',catalogItemId:8}));assert.equal(result.status,200);assert.equal(calls.at(-1).scope.storeId,9);
result=await handler(request({operation:'refund',orderId:4,requestKey:'short',reason:'顾客取消'}));assert.equal(result.status,400);
result=await handler(request({operation:'checkout',orderId:4,requestKey:'checkout-request-0002',payments:[]}));assert.equal(result.status,400);
result=await handler(request({operation:'unknown'}));assert.equal(result.status,400);
result=await handler(request({operation:'refund',orderId:4,requestKey:'refund-request-00002',reason:'x'},'invalid-user-token-123456'));assert.equal(result.status,403);
assert.ok(logs.every(log=>!('token'in log)&&!('payments'in log)&&!('amount'in log)),'request logs must not contain credentials or business payloads');
assert.ok(logs.every(log=>typeof log.request_id==='string'&&log.request_id.length>20));
assert.equal(logs.find(log=>log.operation==='unknown').error_code,'UNSUPPORTED_OPERATION');

const failing=createSalonHandler({verifyUser:async()=>({id:'auth-user-1'}),findStaff:async()=>({id:7,organization_id:3,store_id:9,employment_status:'active'}),invoke:async()=>{throw new Error('数据库请求失败 (500) secret internal detail')}});
result=await failing(request({operation:'refund',orderId:4,requestKey:'refund-request-00003',reason:'测试'}));assert.equal(result.status,500);assert.equal(result.body.code,'DATABASE_OPERATION_FAILED');assert.equal(result.body.error,'操作未完成，请稍后重试');assert.doesNotMatch(JSON.stringify(result.body),/secret internal detail/);

const edge=fs.readFileSync('supabase/functions/salon-api/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260906064313_salon_auth_identity.sql','utf8');
assert.match(edge,/\/auth\/v1\/user/);assert.match(edge,/SALON_ALLOWED_ORIGINS/);
assert.match(edge,/salon_api_request_logs/);assert.match(edge,/X-Request-ID/);
assert.doesNotMatch(edge,/user_metadata|raw_user_meta_data/);
assert.doesNotMatch(edge,/service_role.{0,80}(console|Response|body)/i);
assert.match(migration,/auth_user_id uuid/);assert.match(migration,/unique index salon_staff_auth_user_org_idx/);
const logMigration=fs.readFileSync('supabase/migrations/20260906064812_salon_api_request_log.sql','utf8'),logColumns=logMigration.match(/create table public\.salon_api_request_logs\(([\s\S]*?)\);/i)?.[1]||'';assert.ok(logColumns);assert.doesNotMatch(logColumns,/payload|phone|customer_name|amount/i);
console.log('salon api tests passed: scoped reads, stable errors, request ids, metadata-only logs, secret boundary');
