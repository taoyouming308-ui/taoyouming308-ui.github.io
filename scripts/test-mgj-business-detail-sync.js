const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{generateKeyPairSync,sign,webcrypto}=require('node:crypto'),{execFileSync}=require('node:child_process');
const keys=generateKeyPairSync('ed25519'),pub=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const bill=JSON.parse(execFileSync('/usr/bin/python3',['-c','import json;from scripts.test_mgj_business_detail import normalized;print(json.dumps(normalized()))'],{encoding:'utf8'}));
const valid=()=>({operation:'business_details_append',shop:'向里造型',date:'2026-01-01',fetched_at:new Date().toISOString(),source:{contract_version:'mgj-business-day-v1',shop_id:'1837032',business_date:'2026-01-01',source_scope:'project_consumption',bills:[structuredClone(bill)]}});
let handler,calls=[];let receipt={accepted:true,snapshot_id:'snapshot',source_sha256:'a'.repeat(64),shop:'向里造型',date:'2026-01-01',source_count:1,source_scope:'project_consumption',report_ready:false,formal_ledger_amount_changed:false};
let src=fs.readFileSync('supabase/functions/mgj-business-detail-sync/index.ts','utf8').replace(/const PUBLIC_KEY_BASE64 = "[^"]+";/,`const PUBLIC_KEY_BASE64 = "${pub}";`);
const ctx=vm.createContext({Request,Response,Uint8Array,TextEncoder,TextDecoder,Date,Object,JSON,Number,Array,Error,AbortSignal,atob,crypto:webcrypto,Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f},fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(receipt));}});
vm.runInContext(stripTypeScriptTypes(src),ctx);
async function send(payload,domain='mgj-business-detail-sync\n',unsigned=false){const body=JSON.stringify(payload),ts=String(Math.floor(Date.now()/1000));return handler(new Request('https://fixture.invalid',{method:'POST',body,headers:unsigned?{}:{'x-business-sync-ts':ts,'x-business-sync-signature':sign(null,Buffer.from(domain+ts+'.'+body),keys.privateKey).toString('base64url')}}));}
(async()=>{
 assert.equal((await send(valid(),'mgj-daily-report-sync\n')).status,401);assert.equal((await send(valid(),undefined,true)).status,401);
 for(const mutation of [p=>p.shop='自由手艺人',p=>p.date='2026-02-30',p=>p.source.bills.push(p.source.bills[0]),p=>p.source.bills[0].customer_phone='PRIVATE',p=>p.source.bills[0].payments.pop(),p=>p.source.bills[0].payments[0].amount_cents=0.001,p=>p.operation='confirm',p=>p.source.bills[0].report_ready=true]){
  const p=valid();mutation(p);assert.equal((await send(p)).status,400);
 }
 assert.equal(calls.length,0);
 assert.equal((await send(valid())).status,200);assert(calls[0].url.endsWith('/rpc/mgj_ingest_business_details'));
 assert.equal(JSON.parse(calls[0].init.body).p_shop,'向里造型');
 receipt={...receipt,formal_ledger_amount_changed:true};assert.equal((await send(valid())).status,502);
 console.log('Business writer: signed domain, fixed RPC, private fields, scope, completeness, integer cents and no posting passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
