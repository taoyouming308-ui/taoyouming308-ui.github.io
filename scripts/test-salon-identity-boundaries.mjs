import assert from 'node:assert/strict';
import {createSalonHandler} from '../supabase/functions/_shared/salon-api-core.mjs';
import {createSalonCustomerHandler} from '../supabase/functions/_shared/salon-customer-api-core.mjs';
const request=body=>new Request('http://local/test',{method:'POST',headers:{Authorization:'Bearer test-token-long-enough-0001'},body:JSON.stringify(body)});
let calls=0,resolutions=0,allowed=true;
const deps={verifyUser:async()=>({id:'test-user'}),findStaff:async()=>({id:7,organization_id:3,store_id:9,employment_status:'active'}),resolveStore:async()=>{resolutions++;if(!allowed)throw new Error('当前员工不能进入该门店');return 9},invoke:async()=>{calls++;return{}},read:async()=>{calls++;return{}}};
for(const factory of [createSalonHandler,createSalonCustomerHandler]){
 const handler=factory(deps);
 for(const body of [null,[],5,'x',{operation:'constructor'},{operation:'toString'},{operation:'__proto__'}]){
  const before=calls,result=await handler(request(body));assert.equal(result.status,400);assert.equal(calls,before);
 }
}
const handler=createSalonHandler(deps);
assert.equal((await handler(request({operation:'context'}))).status,200);assert.equal(resolutions,1);
allowed=false;
assert.notEqual((await handler(request({operation:'context'}))).status,200);assert.equal(resolutions,2);
allowed=true;
const before=calls;assert.notEqual((await handler(request({operation:'inventory',storeId:99}))).status,200);assert.equal(calls,before);
console.log('salon identity boundaries passed: own-operation whitelist, malformed bodies, home-store revalidation, no silent store substitution');
