import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSalonCustomerHandler} from '../supabase/functions/_shared/salon-customer-api-core.mjs';

const calls=[],logs=[];
const handler=createSalonCustomerHandler({verifyUser:async token=>token==='valid-customer-token-123456789'?{id:'123e4567-e89b-12d3-a456-426614174000'}:null,invoke:async(rpc,args)=>{calls.push({rpc,args});return{ok:true}},log:async row=>logs.push(row)});
const request=(body,token='valid-customer-token-123456789')=>new Request('http://local/salon-customer-api',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
let result=await handler(request({operation:'context'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_get_context');assert.equal(calls.at(-1).args.p_auth_user_id,'123e4567-e89b-12d3-a456-426614174000');
result=await handler(request({operation:'booking_options',organizationId:3,storeId:9}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_list_booking_options');
result=await handler(request({operation:'consent_set',organizationId:3,storeId:9,requestKey:'consent-grant-0001',consentType:'work_publication',granted:true,scope:{channel:'portfolio'},evidenceRef:'customer-confirmation:1'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_set_consent');
result=await handler(request({operation:'booking_create',organizationId:3,storeId:9,requestKey:'booking-create-001',catalogItemId:21,staffId:7,startsAt:'2026-09-08T02:00:00Z',endsAt:'2026-09-08T03:00:00Z',notes:'希望短发'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_request_booking');
result=await handler(request({operation:'booking_cancel',organizationId:3,storeId:9,requestKey:'booking-cancel-001',bookingRequestId:31,reason:'行程变化'}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_request_booking_cancel');
result=await handler(request({operation:'review_create',organizationId:3,storeId:9,requestKey:'review-create-0001',orderId:41,staffId:7,rating:5,comment:'满意',isAnonymous:false,tipAmount:20}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_create_review');assert.equal(calls.at(-1).args.p_tip_amount,20);
result=await handler(request({operation:'works',organizationId:3,storeId:9,limit:50}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_list_public_works');
result=await handler(request({operation:'bookings',organizationId:3,storeId:9,limit:50}));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_list_bookings');
result=await handler(request({operation:'review_create',organizationId:3,storeId:9,requestKey:'review-invalid-001',orderId:41,staffId:7,rating:6}));assert.equal(result.status,400);
result=await handler(request({operation:'context'},'invalid-customer-token-1234'));assert.equal(result.status,403);
assert.ok(logs.every(log=>!('token'in log)&&!('comment'in log)&&!('tipAmount'in log)&&!('amount'in log)),'customer request logs must stay metadata-only');assert.ok(logs.every(log=>typeof log.request_id==='string'&&log.request_id.length>20));
const edge=fs.readFileSync('supabase/functions/salon-customer-api/index.ts','utf8');assert.match(edge,/\/auth\/v1\/user/);assert.match(edge,/SALON_CUSTOMER_ALLOWED_ORIGINS/);assert.match(edge,/salon_api_request_logs/);assert.doesNotMatch(edge,/user_metadata|raw_user_meta_data/);assert.doesNotMatch(edge,/service_role.{0,80}(console|Response|body)/i);
console.log('salon customer api tests passed: verified identity, scoped portal actions, no direct payment confirmation');
const change={operation:'reschedule_request',organizationId:3,storeId:9,bookingRequestId:31,requestKey:'customer-change-001',expectedStartsAt:'2030-01-01T02:00:00Z',expectedEndsAt:'2030-01-01T03:00:00Z',expectedVersion:0,newStartsAt:'2030-01-02T02:00:00Z',reason:'行程变化',authUserId:'forged',customerId:999};
assert.equal((await handler(request({operation:'store_time',organizationId:3,storeId:9,authUserId:'forged'}))).status,200);assert.equal(calls.at(-1).rpc,'salon_customer_get_store_time_context');assert.equal(calls.at(-1).args.p_auth_user_id,'123e4567-e89b-12d3-a456-426614174000');
result=await handler(request(change));assert.equal(result.status,200);assert.equal(calls.at(-1).rpc,'salon_customer_request_reschedule');assert.equal(calls.at(-1).args.p_auth_user_id,'123e4567-e89b-12d3-a456-426614174000');assert.ok(!('p_customer_id' in calls.at(-1).args));
for(const patch of [{expectedVersion:'0'},{expectedVersion:-1},{newStartsAt:'2030-01-02T02:00'},{reason:''}]){const count=calls.length;assert.equal((await handler(request({...change,...patch}))).status,400);assert.equal(calls.length,count);}
assert.equal((await handler(request({operation:'reschedule_requests',organizationId:3,storeId:9}))).status,200);assert.equal(calls.at(-1).rpc,'salon_customer_list_reschedules');
