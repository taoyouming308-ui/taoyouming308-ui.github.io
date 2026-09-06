import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSalonHandler } from "../_shared/salon-api-core.mjs";

const url=Deno.env.get("SUPABASE_URL")||"";
function namedSecret(jsonName:string,legacyName:string):string{
  const raw=Deno.env.get(jsonName)||"";
  if(raw){try{const values=JSON.parse(raw);return values.default||Object.values(values)[0]||""}catch{return""}}
  return Deno.env.get(legacyName)||"";
}
const publishable=namedSecret("SUPABASE_PUBLISHABLE_KEYS","SUPABASE_ANON_KEY");
const secret=namedSecret("SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY");
const allowed=(Deno.env.get("SALON_ALLOWED_ORIGINS")||"").split(",").map(x=>x.trim()).filter(Boolean);

function adminHeaders(){return{"apikey":secret,"Content-Type":"application/json",...(secret.startsWith("ey")?{"Authorization":`Bearer ${secret}`}:{})}}
async function admin(path:string,init:RequestInit={}){const response=await fetch(`${url}/rest/v1/${path}`,{...init,headers:{...adminHeaders(),...(init.headers||{})}});if(!response.ok){const detail=await response.text();throw new Error(`数据库请求失败 (${response.status}) ${detail.slice(0,160)}`)}return response}

const handler=createSalonHandler({
  verifyUser:async(token:string)=>{const response=await fetch(`${url}/auth/v1/user`,{headers:{apikey:publishable,Authorization:`Bearer ${token}`}});if(!response.ok)return null;return response.json()},
  findStaff:async(userId:string)=>{const response=await admin(`salon_staff?select=id,organization_id,store_id,display_name,employment_status&auth_user_id=eq.${encodeURIComponent(userId)}&limit=2`);const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1)return null;return rows[0]},
  invoke:async(rpc:string,args:Record<string,unknown>)=>{const response=await admin(`rpc/${rpc}`,{method:"POST",body:JSON.stringify(args)});return response.json()},
  read:async(operation:string,scope:Record<string,unknown>)=>{
    const org=Number(scope.organizationId),store=Number(scope.storeId);
    if(operation==="customers"){
      const response=await admin("rpc/salon_list_customers",{method:"POST",body:JSON.stringify({p_actor_staff_id:Number(scope.actorStaffId),p_organization_id:org,p_store_id:store,p_query:String(scope.query||""),p_status:String(scope.status||""),p_limit:Number(scope.limit||100)})});
      return response.json();
    }
    if(operation==="order_receipt"){
      const orderId=Number(scope.orderId),orderResponse=await admin(`salon_orders?select=id,order_no,status,subtotal,discount_total,payable_total,paid_at&organization_id=eq.${org}&store_id=eq.${store}&id=eq.${orderId}&limit=1`),orders=await orderResponse.json();
      if(!Array.isArray(orders)||orders.length!==1)throw new Error("订单不存在或不属于当前门店");
      const [paymentsResponse,ledgerResponse]=await Promise.all([
        admin(`salon_payments?select=id,payment_method,amount,member_units,status,reversal_of_id,confirmed_at&organization_id=eq.${org}&store_id=eq.${store}&order_id=eq.${orderId}&order=id.asc&limit=100`),
        admin(`salon_account_ledger?select=id,entry_type,cash_delta,bonus_delta,units_delta,reversal_of_id,occurred_at&organization_id=eq.${org}&store_id=eq.${store}&order_id=eq.${orderId}&order=id.asc&limit=100`),
      ]);
      return{order:orders[0],payments:await paymentsResponse.json(),memberLedger:await ledgerResponse.json()};
    }
    const itemFilter=scope.catalogItemId?`&catalog_item_id=eq.${Number(scope.catalogItemId)}`:"";
    const response=await admin(`salon_inventory_balances?select=catalog_item_id,quantity,updated_at&organization_id=eq.${org}&store_id=eq.${store}${itemFilter}&order=catalog_item_id.asc&limit=500`);
    return response.json();
  },
  log:async(row:Record<string,unknown>)=>{await admin("salon_api_request_logs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(row)})},
});

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("Origin")||"";
  if(origin&&(!allowed.length||!allowed.includes(origin)))return new Response(JSON.stringify({error:"来源不允许"}),{status:403,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  const cors={"Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"Content-Type, Authorization, apikey","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Cache-Control":"no-store"};
  if(!url||!publishable||!secret)return new Response(JSON.stringify({error:"service not configured"}),{status:503,headers:{...cors,"Content-Type":"application/json"}});
  const result=await handler(request);
  return new Response(result.body==null?null:JSON.stringify(result.body),{status:result.status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","X-Request-ID":result.body?.requestId||""}});
});
