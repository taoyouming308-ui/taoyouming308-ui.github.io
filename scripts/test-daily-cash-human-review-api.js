const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8'),begin=source.indexOf('async function reviewDailyCashSources('),end=source.indexOf('\nasync function confirmDailySheetDraft(',begin);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');let calls=[];
const context={cleanText:(v,n)=>String(v??'').trim().slice(0,n),uuidValue:v=>{if(!/^[a-f0-9-]{36}$/.test(v))throw Error('identity');return v;},
 requireFinanceCapability:(s,c)=>{if(s.operations_role!=='finance'||!s.auth_capabilities?.includes(c))throw Error('forbidden');},
 selectedStoreInfo:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return {id:id(2),company_id:id(1)};},
 financeRpcSaved:async(path,body)=>{calls.push({path,body});return {status:'current'};},dailySheetRead:async()=>({cash_review:{status:'current'}})};
vm.createContext(context);vm.runInContext(stripTypeScriptTypes(source.slice(begin,end)),context);
async function main(){
 const session={operations_role:'finance',auth_account_id:id(3),auth_user_id:id(4),auth_capabilities:['daily_report.write']};
 const payload={store:'Synthetic',draft_id:id(5),expected_revision:10,source_token:'a'.repeat(64),request_id:id(6),reviewed_original:true,reviewed_channels:true,reviewed_card_sales:true,reason:'Synthetic original and channels checked',actor_user_id:id(99),actor_auth_user_id:id(98)};
 await context.reviewDailyCashSources(payload,session);
 assert.equal(calls[0].body.p_actor_user_id,id(3));assert.equal(calls[0].body.p_actor_auth_user_id,id(4));assert.equal(calls[0].body.p_expected_revision,10);
 for(const patch of [{expected_revision:null},{expected_revision:-1},{expected_revision:1.5},{reason:'x'},{reviewed_original:false},{reviewed_channels:'true'},{reviewed_card_sales:null},{source_token:'fake'},{request_id:'fake'},{store:'Other'}])
  await assert.rejects(context.reviewDailyCashSources({...payload,...patch},session));
 for(const patch of [{operations_role:'shareholder'},{auth_user_id:'fake'},{auth_capabilities:[]}])
  await assert.rejects(context.reviewDailyCashSources(payload,{...session,...patch}));
 assert.equal(calls.length,1,'invalid requests never reach privileged RPC');
 context.financeRpcSaved=async()=>{throw Error('DAILY_CASH_REVIEW_SOURCE_CHANGED');};
 await assert.rejects(context.reviewDailyCashSources(payload,session),/SOURCE_CHANGED/);
 console.log('Cash review API: trusted server actor/Auth binding, selected store, strict attestation, revision and RPC failure propagation passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
