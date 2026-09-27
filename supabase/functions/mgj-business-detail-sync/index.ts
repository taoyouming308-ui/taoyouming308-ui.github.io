// Fixed signed machine operation; source snapshots only, never financial posting.
const PUBLIC_KEY_BASE64 = "34z6MEMWkfaGzTXGG7YWZaW5UCdiIbU3IfyEsiyF5to=";
const URL_ROOT = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHOPS: Record<string,string> = {"自由手艺人":"1009951","向里造型":"1837032"};
const MAX_BYTES = 2097152;
const PAYMENT_FIELDS = ['cardfee','presentfee','cash','unionpay','cooperation','mall','weixin','pay','voucherfee','dividefee','debtfee','mdfee','luckymoney','coupon','dianpin','onlineCreditPay','offlineCreditPay','mallorderfee',...Array.from({length:10},(_,i)=>`otherfee${i+1}`),'treatfee','treatpresentfee'];
type Row=Record<string,unknown>;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function obj(value:unknown):Row{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_request');return value as Row;}
function exact(value:Row,keys:string[]){if(Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new Error('invalid_request');}
function arr(value:unknown,max=2000):Row[]{if(!Array.isArray(value)||value.length>max)throw new Error('invalid_request');return value.map(obj);}
function id(value:unknown,nullable=false){if(nullable&&value===null)return;if(typeof value!=='string'||!/^\d{1,30}$/.test(value)||value==='0')throw new Error('invalid_request');}
function text(value:unknown){if(typeof value!=='string'||value.length>200)throw new Error('invalid_request');}
function amount(value:unknown){if(value!==null&&!Number.isSafeInteger(value))throw new Error('invalid_request');}
function count(value:unknown){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('invalid_request');}
function validate(payload:Row):Row{
 exact(payload,['operation','shop','date','fetched_at','source']);
 if(payload.operation!=='business_details_append'||typeof payload.shop!=='string'||!Object.hasOwn(SHOPS,payload.shop))throw new Error('invalid_request');
 const day=payload.date;
 if(typeof day!=='string'||!/^2026-\d{2}-\d{2}$/.test(day))throw new Error('invalid_request');
 const parsed=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==day||day>new Date(Date.now()+8*3600000).toISOString().slice(0,10))throw new Error('invalid_request');
 const fetched=typeof payload.fetched_at==='string'?Date.parse(payload.fetched_at):NaN;
 if(!Number.isFinite(fetched)||fetched>Date.now()+10000||fetched<Date.now()-120000)throw new Error('invalid_request');
 const source=obj(payload.source);exact(source,['contract_version','shop_id','business_date','source_scope','bills']);
 if(source.contract_version!=='mgj-business-day-v1'||source.shop_id!==SHOPS[payload.shop]||source.business_date!==day||source.source_scope!=='project_consumption')throw new Error('invalid_request');
 const seen=new Set();
 for(const bill of arr(source.bills,1000)){
  exact(bill,['contract_version','shop_id','business_date','source_bill_id','source_scope_verified','source_type','source_status','source_posted_amount_cents','source_bill_amount_cents','items','payments','employee_allocations','gaps','report_ready','not_applicable_report_fields','normalized_sha256']);
  id(bill.source_bill_id);if(seen.has(bill.source_bill_id))throw new Error('invalid_request');seen.add(bill.source_bill_id);
  if(bill.contract_version!=='mgj-business-detail-v1'||bill.shop_id!==source.shop_id||bill.business_date!==day||bill.source_scope_verified!==true||bill.report_ready!==false||typeof bill.normalized_sha256!=='string'||!/^[a-f0-9]{64}$/.test(bill.normalized_sha256))throw new Error('invalid_request');
  amount(bill.source_posted_amount_cents);amount(bill.source_bill_amount_cents);
  if(!Array.isArray(bill.gaps)||bill.gaps.length>100||bill.gaps.some(x=>typeof x!=='string'||!/^[a-z_]{1,100}$/.test(x)))throw new Error('invalid_request');
  if(JSON.stringify(bill.not_applicable_report_fields)!==JSON.stringify(['payment.public_card','payment.public_qr','payment.private_card','payment.private_qr']))throw new Error('invalid_request');
  const items=new Set();
  for(const row of arr(bill.items)){
   exact(row,['source_item_id','item_code','item_name','source_category_code','source_category_name','source_type','quantity','amount_cents','unit_price_cents']);
   id(row.source_item_id);if(items.has(row.source_item_id))throw new Error('invalid_request');items.add(row.source_item_id);
   for(const k of ['item_code','item_name','source_category_code','source_category_name'])text(row[k]);
   amount(row.amount_cents);amount(row.unit_price_cents);count(row.quantity);
  }
  const allocations=new Set();
  for(const row of arr(bill.employee_allocations)){
   exact(row,['source_allocation_id','employee_id','source_item_id','employee_name','source_role','performance_cents','cash_performance_cents','card_performance_cents','other_performance_cents','source_project_count','source_person_count']);
   id(row.source_allocation_id);id(row.employee_id,true);id(row.source_item_id,true);
   if(allocations.has(row.source_allocation_id))throw new Error('invalid_request');allocations.add(row.source_allocation_id);
   text(row.employee_name);text(row.source_role);
   for(const k of ['performance_cents','cash_performance_cents','card_performance_cents','other_performance_cents'])amount(row[k]);
   count(row.source_project_count);count(row.source_person_count);
  }
  const fields=new Set();
  for(const row of arr(bill.payments,30)){
   exact(row,['source_field','source_label','amount_cents','known']);
   if(typeof row.source_field!=='string'||!PAYMENT_FIELDS.includes(row.source_field)||fields.has(row.source_field))throw new Error('invalid_request');fields.add(row.source_field);
   text(row.source_label);amount(row.amount_cents);if(row.known!==(row.amount_cents!==null))throw new Error('invalid_request');
  }
  if(fields.size!==30)throw new Error('invalid_request');
 }
 return {p_shop:payload.shop,p_day:day,p_fetched_at:payload.fetched_at,p_payload:source};
}
function bytes(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));}
async function authenticated(request:Request,body:Uint8Array){
 const ts=request.headers.get('x-business-sync-ts')||'',sig=request.headers.get('x-business-sync-signature')||'';
 if(!/^\d{10}$/.test(ts)||!/^[\w-]{86}$/.test(sig)||Math.abs(Date.now()-Number(ts)*1000)>120000)return false;
 const key=await crypto.subtle.importKey('raw',bytes(PUBLIC_KEY_BASE64),{name:'Ed25519'},false,['verify']);
 const prefix=new TextEncoder().encode(`mgj-business-detail-sync\n${ts}.`),signed=new Uint8Array(prefix.length+body.length);
 signed.set(prefix);signed.set(body,prefix.length);return crypto.subtle.verify('Ed25519',key,bytes(sig),signed);
}
async function body(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');
 let length=0;const parts:Uint8Array[]=[];
 try{while(true){const row=await reader.read();if(row.done)break;length+=row.value.length;if(length>MAX_BYTES){await reader.cancel();throw new Error('too_large');}parts.push(row.value);}}finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
Deno.serve(async(request:Request)=>{
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 if(!URL_ROOT||!SERVICE_KEY)return json({error:'service_unavailable'},503);
 try{
  const raw=await body(request);if(!await authenticated(request,raw))return json({error:'unauthorized'},401);
  const p=obj(JSON.parse(new TextDecoder().decode(raw)));const params=validate(p);
  const response=await fetch(`${URL_ROOT}/rest/v1/rpc/mgj_ingest_business_details`,{method:'POST',signal:AbortSignal.timeout(20000),headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(params)});
  if(!response.ok)return json({error:'source_not_accepted',outcome:'unconfirmed'},response.status>=500?502:409);
  const receipt=obj(await response.json());
  if(receipt.formal_ledger_amount_changed!==false||typeof receipt.accepted!=='boolean')return json({error:'invalid_receipt',outcome:'unconfirmed'},502);
  if(receipt.accepted&&(receipt.shop!==p.shop||receipt.date!==p.date||receipt.report_ready!==false||receipt.source_count!==(obj(p.source).bills as unknown[]).length||receipt.source_scope!=='project_consumption'||typeof receipt.snapshot_id!=='string'||typeof receipt.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.source_sha256)))return json({error:'invalid_receipt',outcome:'unconfirmed'},502);
  return json(receipt);
 }catch(e){if(e instanceof Error&&e.message==='too_large')return json({error:'too_large'},413);if(e instanceof Error&&e.message==='invalid_request')return json({error:'invalid_request'},400);return json({error:'request_failed',outcome:'unconfirmed'},502);}
});
