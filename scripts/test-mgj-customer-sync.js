// Real signature validation, synthetic data only; never contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {generateKeyPairSync,sign,webcrypto} = require('node:crypto');
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const calls=[];let handler, existing=[], writeRows=[], dailyReceipt={written:1,count:1};
const source = fs.readFileSync('supabase/functions/mgj-customer-sync/index.ts','utf8').replace(/const PUBLIC_KEY_BASE64 = "[^"]+";/,`const PUBLIC_KEY_BASE64 = "${publicKey}";`);
const ctx = vm.createContext({console,Request,Response,TextEncoder,TextDecoder,Uint8Array,Date,JSON,Number,Array,Error,DOMException,AbortSignal,atob,crypto:webcrypto,
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':'synthetic-secret'},serve:f=>{handler=f;}},
  fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(String(url).includes('/rpc/')?dailyReceipt:init.method?writeRows:String(url).includes('select=shop_name')?existing:[]),{status:200});}});
vm.runInContext(stripTypeScriptTypes(source),ctx);
async function send(payload,{unsigned=false,old=false,domain='mgj-customer-sync\n'}={}){
  const body=JSON.stringify(payload),ts=String(Math.floor(Date.now()/1000)-(old?300:0));
  const headers=unsigned?{}:{'x-customer-sync-ts':ts,'x-customer-sync-signature':sign(null,Buffer.from(domain+ts+'.'+body),keys.privateKey).toString('base64url')};
  return handler(new Request('https://test.invalid',{method:'POST',body,headers}));
}
(async()=>{
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const booking={operation:'booking_phones',start:today,end:today,end_inclusive:true,limit:500};
  for(const options of [{unsigned:true},{old:true},{domain:''}])assert.equal((await send(booking,options)).status,401);
  assert.equal(calls.length,0,'invalid signatures never touch database');
  for(const payload of [{operation:'delete'}, {...booking,table:'staff'}, {...booking,start:'1900-01-01'}, {...booking,start:'2026-02-31'}, {...booking,limit:50000}, {operation:'profile_read',phone:'x&limit=1000'}])assert.equal((await send(payload)).status,400);
  assert.equal(calls.length,0,'invalid scopes never touch database');
  assert.equal((await send(booking)).status,200);
  assert.match(calls.at(-1).url,/shop_id=in\.\(1009951,1837032\)/);
  assert.match(calls.at(-1).url,/select=customer_phone&/);
  assert.equal((await send({operation:'profile_read',phone:'13800000000'})).status,200);
  assert.match(calls.at(-1).url,/phone=eq\.13800000000/);
  assert.match(calls.at(-1).url,/shop_name.in/);
  assert.equal((await send({operation:'profile_scan',cursor:12,limit:500})).status,200);
  assert.match(calls.at(-1).url,/id=gt\.12/);
  const profile={phone:'13800000000',name:'测试客户',shop_name:'自由手艺人',barber_name:'测试',total_visits:1,total_consumption:100,last_visit_date:today,notes:'保留备注',last_updated:new Date().toISOString(),card_packages:[{name:'套餐',left:2}],service_history:[{source_id:'fake',date:today}]};
  const write={operation:'profile_write',phone:profile.phone,profile,create:true};
  writeRows=[profile];
  assert.equal((await send(write)).status,200);
  assert.equal(calls.at(-1).init.method,'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),profile,'arrays and notes preserved');
  existing=[{shop_name:'自由手艺人'}];
  assert.equal((await send(write)).status,409,'stale create never upserts over existing profile');
  assert.equal((await send({...write,create:false})).status,200);
  assert.equal(calls.at(-1).init.method,'PATCH');
  assert.match(calls.at(-1).url,/phone=eq\.13800000000/);
  existing=[{shop_name:'其他门店'}];
  const count=calls.filter(c=>c.init.method).length;
  assert.equal((await send({...write,create:false})).status,400);
  assert.equal(calls.filter(c=>c.init.method).length,count,'unknown store master never modified');
  for(const p of [{...profile,shop_name:'其他门店'},{...profile,id:999},{...profile,phone:'13800000001'},{...profile,total_consumption:-1}])assert.equal((await send({...write,profile:p})).status,400);
  assert.equal(calls.filter(c=>c.init.method).length,count);
  const bill={source_id:'123',bill_no:'synthetic',customer_name:'合成',customer_phone:'13800000000',shop_name:'自由手艺人',service_date:today,service_time:'10:30',amount:100.12,staff:['合成'],items:[{name:'剪发'}],service_types:[]};
  const snapshot={operation:'daily_consumption_write',shop:bill.shop_name,date:today,fetched_at:new Date().toISOString(),source_count:1,services:[bill]};
  const initial=calls.length;
  for(const options of [{unsigned:true},{old:true},{domain:'mgj-booking-sync\n'}])assert.equal((await send(snapshot,options)).status,401);
  for(const bad of [{...snapshot,source_count:2},{...snapshot,shop:'其他门店'},{...snapshot,services:[{...bill,service_date:'2020-01-01'}]},{...snapshot,services:[{...bill,shop_name:'向里造型'}]},{...snapshot,source_count:2,services:[bill,bill]},{...snapshot,fetched_at:'2020-01-01'},{...snapshot,services:[{...bill,amount:-1}]},{...snapshot,table:'staff'}])assert.equal((await send(bad)).status,400);
  assert.equal(calls.length,initial,'invalid snapshot cannot reach database');
  assert.equal((await send(snapshot)).status,200);
  assert.match(calls.at(-1).url,/rpc\/write_mgj_daily_consumption$/);
  assert.equal(JSON.parse(calls.at(-1).init.body).p_shop,'自由手艺人');
  dailyReceipt={written:0,count:1};
  assert.equal((await send(snapshot)).status,409,'older snapshot cannot overwrite');
  dailyReceipt={written:1,count:0};
  assert.equal((await send({...snapshot,source_count:0,services:[]})).status,200,'verified empty day is a valid snapshot');
  console.log('Private customer sync: signatures, domain/expiry, table/field/shop/phone scope, no delete, exact write count, conflict and array preservation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
