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
  findStaff:async(userId:string)=>{const response=await admin(`salon_staff?select=id,organization_id,store_id,employment_status&auth_user_id=eq.${encodeURIComponent(userId)}&limit=2`);const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1)return null;return rows[0]},
  invoke:async(rpc:string,args:Record<string,unknown>)=>{const response=await admin(`rpc/${rpc}`,{method:"POST",body:JSON.stringify(args)});return response.json()},
});

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("Origin")||"";
  if(origin&&(!allowed.length||!allowed.includes(origin)))return new Response(JSON.stringify({error:"来源不允许"}),{status:403,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  const cors={"Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"Content-Type, Authorization, apikey","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Cache-Control":"no-store"};
  if(!url||!publishable||!secret)return new Response(JSON.stringify({error:"service not configured"}),{status:503,headers:{...cors,"Content-Type":"application/json"}});
  const result=await handler(request);
  return new Response(result.body==null?null:JSON.stringify(result.body),{status:result.status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
});
