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
 // Exercise the real confirmation dispatcher, not only the archive helper.
 let archived=0;let draft={status:'draft',edit_revision:10,source_voucher_id:null};
 context.hasAuthCapability=(s,c)=>s.auth_capabilities?.includes(c);
 context.restRows=async query=>{assert.match(query,new RegExp('company_id=eq.'+id(1)));assert.match(query,new RegExp('store_id=eq.'+id(2)));return [draft];};
 context.confirmElectronicDailySheet=async(company,store,draftId,actor,actualSession,actualDraft,consent,revision)=>{
  assert.equal(company,id(1));assert.equal(store,id(2));assert.equal(draftId,id(5));assert.equal(actor,id(3));
  assert.equal(actualSession.auth_user_id,id(4));assert.equal(revision,10);archived++;return {confirmed:true};};
 vm.runInContext(stripTypeScriptTypes(source.slice(end,source.indexOf('\nasync function confirmElectronicDailySheet(',end))),context);
 const electronic={store:'Synthetic',draft_id:id(5),expected_revision:10,reviewed_all:true,reason:'Synthetic explicit final review',
  company_id:id(98),actor_user_id:id(99),cash_source_confirmation:{statement:'electronic-channels-sales-v1',source_token:'a'.repeat(64),request_id:id(6)}};
 assert.equal((await context.confirmDailySheetDraft(electronic,session)).confirmed,true);
 await assert.rejects(context.confirmDailySheetDraft({...electronic,cash_source_confirmation:null},session),/未提交电子来源确认/);
 for(const patch of [{store:'Other'},{expected_revision:9},{expected_revision:null},{reviewed_all:false},
  {cash_source_confirmation:{...electronic.cash_source_confirmation,source_token:'bad'}},
  {cash_source_confirmation:{...electronic.cash_source_confirmation,statement:'automatic'}}])
  await assert.rejects(context.confirmDailySheetDraft({...electronic,...patch},session));
 for(const patch of [{operations_role:'shareholder'},{auth_capabilities:[]}])
  await assert.rejects(context.confirmDailySheetDraft(electronic,{...session,...patch}));
 draft={...draft,source_voucher_id:id(7)};
 await assert.rejects(context.confirmDailySheetDraft(electronic,session),/原件状态已变化/);
 draft={...draft,source_voucher_id:null,status:'confirmed'};
 await assert.rejects(context.confirmDailySheetDraft(electronic,session),/已经确认/);
 assert.equal(archived,1,'invalid electronic requests never start a storage archive');
 // Project-review failures must explain the next step instead of a generic 409.
 const rpcStart=source.indexOf('async function financeRpcSaved('),rpcEnd=source.indexOf('\nasync function ',rpcStart+1);
 const errors={cleanText:context.cleanText,console:{error:()=>{}},rest:null};vm.createContext(errors);
 vm.runInContext(stripTypeScriptTypes(source.slice(rpcStart,rpcEnd)),errors);
 for(const [message,code,pattern] of [
  ['PROJECT_REVIEW_FINANCE_FORBIDDEN','42501',/身份或门店权限/],['PROJECT_REVIEW_SERVICE_ONLY','42501',/身份或门店权限/],
  ['PROJECT_REVIEW_NOT_READY','55000',/来源复核暂不可用/],['PROJECT_REVIEW_EXPLICIT_ITEMS_REQUIRED','22023',/逐项复核/],
  ['PROJECT_REVIEW_SOURCE_CHANGED','PT409',/最新来源重新逐项复核/],['PROJECT_REVIEW_ITEMS_CHANGED','PT409',/填写值或复核项目已变化/],
  ['lock unavailable','55P03',/来源正在更新/],['deadlock','40P01',/来源正在更新/],
  ['canceling statement due to statement timeout','57014',/超时.*回滚.*草稿仍保留/]]){
  errors.rest=async()=>({ok:false,status:409,json:async()=>({message,code})});
  await assert.rejects(errors.financeRpcSaved('rpc/zysyr_confirm_daily_project_review',{}),pattern);
 }
 console.log('Cash review API: trusted server actor/Auth binding, selected store, strict attestation, revision and RPC failure propagation passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
