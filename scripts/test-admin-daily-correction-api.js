'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const start=source.indexOf('function canCorrectConfirmedDaily('),end=source.indexOf('\nasync function confirmDailySheetDraft(',start);
let calls=[],requests=[],archiveFailure=false,applied=false,copyStatus=200,hash='hash';
const scope={
 cleanText:(v,n=500)=>String(v??'').trim().slice(0,n),safeCellText:(v,n=500)=>String(v??'').trim().slice(0,n),
 uuidValue:v=>{if(!/^[0-9a-f-]{36}$/.test(v))throw Error('uuid');return v},
 hasAuthCapability:(s,c)=>Boolean(s.auth_account_id&&s.auth_capabilities?.includes(c)),
 selectedStoreInfo:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return {id:'store',company_id:'company',name:'Synthetic'}},
 financeRpcSaved:async(ep,body)=>{calls.push({ep,body});return ep.endsWith('status')?{applied}:{request_id:body.p_request_id,corrected:true}},
 restRows:async(path)=>path.startsWith('zysyr_daily_sheet_drafts')?[{status:'confirmed',edit_revision:4}]:path.startsWith('zysyr_daily_sheet_versions')?[{source_report_id:'00000000-0000-4000-8000-000000000003'}]:[{bucket_id:'reports',object_path:'old.jpg',size_bytes:3,sha256:'hash'}],
 REPORT_BUCKET:'reports',SUPABASE_URL:'https://synthetic.invalid',SERVICE_KEY:'synthetic-only',storagePath:v=>v,sha256Bytes:async()=>hash,
 fetch:async(url,opt)=>{requests.push({url,opt});if(archiveFailure) return {ok:false,status:500,json:async()=>({})};
  if(opt.method==='POST')return {ok:copyStatus===200,status:copyStatus,json:async()=>({statusCode:'409'})};
  return {ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};},
 dailySheetRead:async()=>({})
};
vm.createContext(scope);vm.runInContext(stripTypeScriptTypes(source.slice(start,end)),scope);
const admin={username:'admin',operations_role:'shareholder',auth_account_id:'server-admin',auth_capabilities:['daily_report.correct_confirmed']};
const payload={store:'Synthetic',draft_id:'00000000-0000-4000-8000-000000000001',request_id:'00000000-0000-4000-8000-000000000002',expected_revision:4,reviewed_all:true,reason:'Synthetic correction',cells:[{id:'00000000-0000-4000-8000-000000000004',value:120}]};
async function main(){
 for(const s of [{...admin,username:'other'},{...admin,operations_role:'finance'},{...admin,auth_capabilities:[]},{...admin,auth_account_id:null}])await assert.rejects(scope.saveDailySheetDraft(payload,s,true));
 assert.equal(calls.length,0);assert.equal(requests.length,0);
 for(const p of [{...payload,reviewed_all:false},{...payload,expected_revision:null},{...payload,reason:''},{...payload,store:'other'},{...payload,cells:[{...payload.cells[0],value:-1}]}])await assert.rejects(scope.saveDailySheetDraft(p,admin,true));
 const result=await scope.saveDailySheetDraft({...payload,actor_user_id:'spoof'},admin,true);
 assert.equal(result.corrected,true);const rpc=calls.at(-1);assert.equal(rpc.body.p_actor_user_id,'server-admin');assert.equal(rpc.body.p_expected_revision,4);
 assert.equal(rpc.ep,'rpc/zysyr_correct_confirmed_daily_sheet');const copy=JSON.parse(requests[0].opt.body);
 assert.equal(copy.sourceKey,'old.jpg');assert.equal(copy.destinationKey,'old.jpg.correction-'+payload.request_id);assert.equal(copy.bucketId,'reports');assert.equal(Object.hasOwn(copy,'upsert'),false);
 calls=[];requests=[];archiveFailure=true;await assert.rejects(scope.saveDailySheetDraft(payload,admin,true));assert.equal(calls.some(c=>c.ep.endsWith('correct_confirmed_daily_sheet')),false);
 archiveFailure=false;copyStatus=409;calls=[];requests=[];await scope.saveDailySheetDraft(payload,admin,true);assert.equal(requests.length,2);
 hash='different';calls=[];await assert.rejects(scope.saveDailySheetDraft(payload,admin,true));assert.equal(calls.some(c=>c.ep.endsWith('correct_confirmed_daily_sheet')),false);
 applied=true;requests=[];await scope.saveDailySheetDraft(payload,admin,true);assert.equal(requests.length,0);
 console.log('Admin correction API: account-only, server actor/scope, validation, immutable copy, failed/duplicate copy and receipt recovery passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
