import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import {monthlyReviewRequest,monthlyReviewSnapshot,canonicalReview,monthlyReviewError,MONTHLY_REVIEW_OPERATIONS} from '../supabase/functions/_shared/monthly-review.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store={id:id(1),company_id:id(2),name:'Synthetic only'},hash=async s=>createHash('sha256').update(s).digest('hex');
const shareholder={operations_role:'shareholder',auth_account_id:id(3),auth_store_records:[store]};
const staff={operations_role:'shareholder',staff_report_readonly:true,auth_staff_id:24,auth_store_records:[store]};
const finance={...shareholder,operations_role:'finance'};
let calls=[],data={monthly_report:{id:id(4),display_data:{values:[['Synthetic',null,12.34]],rows:1,columns:3},vouchers:[{url:'secret'}]},monthly_daily_performance:{rows:[]}},changing=false,token='a'.repeat(64),pub=null;
const deps={hash,selectedStore:async(s,p)=>{assert.equal(p.store,store.name);return store},requireFinance:s=>{if(s!==finance)throw Error('finance denied')},
  overview:async(p,s)=>{if(changing)token='b'.repeat(64);return data},rpc:async(name,body)=>{calls.push({name,body});if(name.endsWith('source_token'))return token;if(name.endsWith('status'))return{publication:pub,receipt:null};if(name.endsWith('inbox'))return{pending:[],count:0};return{created:true}}};
const payload={store:store.name,month:'2026-01'};
const call=(op,s=finance,p={})=>monthlyReviewRequest({...payload,operation:op,...p},s,deps);
let preview=await call('monthly_review_preview');assert.equal(preview.snapshot.report.display_data.values[0][2],12.34);assert.equal(preview.snapshot.report.display_data.values[0][1],null);assert(!JSON.stringify(preview).includes('secret'));
await call('monthly_review_publish',finance,{...preview,reviewed_complete:true,actor_user_id:id(99),snapshot:{values:[[999]]},source_token:'spoof'});
assert.equal(calls.at(-1).body.p_actor_user_id,id(3));assert.equal(calls.at(-1).body.p_snapshot.report.display_data.values[0][2],12.34);assert.equal(calls.at(-1).body.p_source_token,'a'.repeat(64));
await assert.rejects(call('monthly_review_publish',finance,{...preview,reviewed_complete:false}));
for(const s of [staff,shareholder,{...finance,auth_account_id:null}])await assert.rejects(call('monthly_review_publish',s,{...preview,reviewed_complete:true}));
changing=true;await assert.rejects(call('monthly_review_preview'),/来源/);changing=false;
await assert.rejects(call('monthly_review_publish',finance,{...preview,reviewed_complete:true}),/预览后/);
preview=await call('monthly_review_preview');data.monthly_report.display_data.values[0][2]=100;
await assert.rejects(call('monthly_review_publish',finance,{...preview,reviewed_complete:true}),/预览后/);
await call('monthly_review_confirm',staff,{publication_id:id(7),content_hash:'c'.repeat(64),statement_code:'reviewed_no_objection_v1',staff_id:99,actor_user_id:id(99)});
assert.equal(calls.at(-1).body.p_staff_id,24);assert.equal(calls.at(-1).body.p_user_account_id,null);assert.equal(calls.at(-1).body.p_current_snapshot.report.display_data.values[0][2],100);
await assert.rejects(call('monthly_review_confirm',staff,{publication_id:id(7),content_hash:'c'.repeat(64),statement_code:'opened'}));
await assert.rejects(call('monthly_review_confirm',finance,{publication_id:id(7),content_hash:'c'.repeat(64),statement_code:'reviewed_no_objection_v1'}));
calls=[];await call('monthly_review_inbox',staff);assert.equal(calls.length,1);assert.equal(calls[0].name,'zysyr_monthly_review_inbox');
await assert.rejects(call('monthly_review_inbox',{...staff,auth_store_records:[]}));
assert.equal(canonicalReview({b:1,a:null}),canonicalReview({a:null,b:1}));
const before=monthlyReviewSnapshot(data,store,'2026-01');data.monthly_report.uploaded_at='tomorrow';assert.deepEqual(before,monthlyReviewSnapshot(data,store,'2026-01'));
// Execute the REAL HTTP dispatch and staff-session verifier. Only synthetic
// session/grant/DB responses are used; no live actors, financial rows or tokens.
let granted=true,active=true,writes=[],status={publication:null},responseCode=null;
const env=vm.createContext({console,Request,Response,TextEncoder,crypto:webcrypto,Date,
  MONTHLY_REVIEW_OPERATIONS,monthlyReviewRequest,monthlyReviewError,
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-key'},serve:fn=>env.handler=fn},
  fetch:async(url,opt={})=>{const path=String(url).split('/rest/v1/')[1];let result;
    if(path.startsWith('employee_booking_sessions?'))result=[{username:'Synthetic',store:store.name}];
    else if(path.startsWith('staff?'))result=[{id:24,username:'Synthetic',store:store.name,active,employment_status:'active'}];
    else if(path.startsWith('staff_report_grants?'))result=granted?[{store_id:store.id}]:[];
    else if(path.startsWith('zysyr_stores?'))result=[store];
    else if(path==='rpc/zysyr_monthly_review_status'){writes.push(JSON.parse(opt.body));result=responseCode?{message:responseCode,code:'P0001'}:status;}
    else throw Error('unexpected '+path);
    return new Response(JSON.stringify(result),{status:responseCode&&path.startsWith('rpc/')?400:200});
  }});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/staff-report-access.ts','utf8').replaceAll('export ','')),env);
vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/operations-api/index.ts','utf8').replace(/^import .*;\n/gm,'')),env);
const employeeToken='11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';
const post=async p=>env.handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({...payload,employee_session_token:employeeToken,...p})}));
let res=await post({operation:'monthly_review_status',auth_staff_id:99});assert.equal(res.status,200);assert.equal(writes.at(-1).p_staff_id,24);assert.equal(writes.at(-1).p_store_id,store.id);
for(const operation of ['monthly_review_publish','monthly_review_preview','daily_sheet_confirm','monthly_cell_save'])assert.equal((await post({operation})).status,403);
assert.equal((await post({operation:'monthly_review_status',store:'Other'})).status,403);
granted=false;assert.equal((await post({operation:'monthly_review_status'})).status,403);granted=true;
active=false;assert.equal((await post({operation:'monthly_review_status'})).status,403);active=true;
responseCode='MONTHLY_REVIEW_STAFF_DENIED';res=await post({operation:'monthly_review_status'});assert.equal(res.status,403);assert.match((await res.json()).error,/权限/);
console.log('Monthly review real HTTP + adapter: trusted actor/store, staff allowlist, current grants, preview hash, no financial writes, immutable snapshot, source races, consent and safe errors passed.');
