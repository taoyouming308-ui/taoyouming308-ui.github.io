'use strict';
// Actual HTTP dispatch and scoped read routes, with synthetic REST/storage only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store={id:id(1),company_id:id(2),name:'Synthetic Store'};
const draft={id:id(3),report_date:'2026-08-01',source_voucher_id:null,status:'draft',template_code:'synthetic',validation_result:{valid:false,grand_total:12.34},edit_revision:7,autofill_view:{}};
const actor={operations_role:'shareholder',auth_account_id:id(4),auth_stores:[store.name],auth_store_records:[store],auth_capabilities:['voucher.read']};
const original=n=>({request_id:id(n),report_date:draft.report_date,original_filename:`synthetic-${n}.jpg`,mime_type:'image/jpeg',size_bytes:123,sha256:'a'.repeat(64),completed_at:'2026-11-13T00:00:00Z',object_path:`${store.company_id}/${store.id}/daily-originals/2026-08/2026-08-01/${id(n)}`});
let mode='ok',granted=true,active=true,calls=[],records=[original(10),original(11)],rpcBodies=[];
let browserEnv;
(async()=>{
 const {dailyAutofillView,isSyncedDailySheet}=await import('../supabase/functions/_shared/daily-autofill-view.mjs');
 const {parseMonth}=await import('../supabase/functions/_shared/zysyr-date.mjs');
 const env=vm.createContext({console,Request,Response,URL,TextEncoder,crypto:webcrypto,AbortSignal,Date,parseMonth,dailyAutofillView,isSyncedDailySheet,
  mockSession:actor,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-key'},serve:fn=>env.handler=fn},
  fetch:async(url,opt={})=>{
   const u=String(url),path=u.split('/rest/v1/')[1],method=opt.method||'GET';calls.push({url:u,path,method});let data=[];
   if(u.includes('/storage/v1/object/sign/'))return new Response(JSON.stringify(mode==='sign-failed'?{error:'unavailable'}:{signedURL:'/object/sign/synthetic-original?token=synthetic'}),{status:mode==='sign-failed'?500:200});
   if(!path)throw Error('Unexpected network '+u);
   if(path==='rpc/zysyr_daily_original_references'){
    rpcBodies.push(JSON.parse(opt.body));if(mode==='query-failed')return new Response('{}',{status:503});
    data={days:records.length?[{report_date:draft.report_date,count:records.length}]:[],archives:JSON.parse(opt.body).p_detail?records:[]};
   }else if(path.startsWith('employee_booking_sessions?'))data=[{username:'Synthetic Staff',store:store.name}];
   else if(path.startsWith('staff?'))data=[{id:24,username:'Synthetic Staff',store:store.name,active,employment_status:'active'}];
   else if(path.startsWith('staff_report_grants?'))data=granted?[{store_id:store.id}]:[];
   else if(path.startsWith('zysyr_stores?'))data=[store];
   else if(path.startsWith('zysyr_daily_sheet_drafts?'))data=[draft];
   else if(path.startsWith('zysyr_daily_sheet_cells?')&&!path.includes('select=draft_id&'))data=[{id:id(6),row_key:'synthetic',column_code:'amount',corrected_numeric:12.34,manual_override:true,cell_role:'input'}];
   else if(!['zysyr_daily_reports?','zysyr_daily_sheet_cells?','zysyr_period_locks?','zysyr_daily_sheet_attachments?','zysyr_daily_sheet_attachment_voids?'].some(prefix=>path.startsWith(prefix)))throw Error('Unexpected REST '+path);
   return new Response(JSON.stringify(data),{status:200});
  }});
 browserEnv=env;
 for(const file of ['supabase/functions/_shared/staff-report-access.ts','supabase/functions/_shared/daily-original-read-bridge.ts','supabase/functions/operations-api/index.ts']){
  const code=fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');vm.runInContext(stripTypeScriptTypes(code),env);
 }
 vm.runInContext('requireSession=async()=>mockSession',env);
 const employeeToken='11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';
 const post=async(op,staff=false,extra={})=>{const res=await env.handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({operation:op,store:store.name,month:'2026-08',draft_id:draft.id,...(staff?{employee_session_token:employeeToken}:{}),...extra})}));return {status:res.status,data:await res.json()};};
 const legacyMonth=JSON.parse(JSON.stringify(await vm.runInContext('dailySheetMonth({store:mockSession.auth_stores[0],month:"2026-08"},mockSession)',env)));
 const legacyDetail=JSON.parse(JSON.stringify(await vm.runInContext('dailySheetRead({store:mockSession.auth_stores[0],draft_id:"'+draft.id+'"},mockSession)',env)));
 const financialOnly=(data,month)=>{const copy=JSON.parse(JSON.stringify(data));if(month)copy.days.forEach(day=>delete day.original_archive);else{delete copy.original_archive;delete copy.archived_originals;}return copy;};
 calls=[];
 let response=await post('daily_sheet_month',false,{actor_user_id:id(99),staff_id:999,company_id:id(99),store_id:id(99)});
 assert.equal(response.status,200);assert.deepEqual(financialOnly(response.data,true),legacyMonth);
 assert.deepEqual(response.data.days[0].original_archive,{state:'archived',count:2});
 assert.equal(response.data.days[0].missing_original,true);assert.equal(response.data.days[0].approved_original_count,0);assert.equal(response.data.recognition.eligible_days,0);assert.equal(response.data.days[0].grand_total,null);
 assert.equal(calls.filter(c=>c.url.includes('/storage/')).length,0,'month never signs images');
 assert.deepEqual(rpcBodies.at(-1),{p_actor_user_id:actor.auth_account_id,p_staff_id:null,p_company_id:store.company_id,p_store_id:store.id,p_start_date:'2026-08-01',p_end_date:'2026-09-01',p_detail:false});
 response=await post('daily_sheet_read',false,{report_date:'2026-07-02',actor_user_id:id(99)});
 assert.equal(response.status,200);assert.deepEqual(financialOnly(response.data,false),legacyDetail);
 assert.deepEqual(response.data.original_archive,{state:'archived',count:2});assert.equal(response.data.archived_originals.length,2);
 assert.equal(response.data.original_image_url,null);assert.equal(response.data.attachments.length,0);assert.equal(response.data.draft.source_voucher_id,null);assert.equal(response.data.automatic_posting_enabled,false);
 for(const row of response.data.archived_originals){assert.equal(row.report_date,draft.report_date);assert.equal(row.review_status,'unreviewed');assert.match(row.private_url,/^https:\/\//);assert.equal(row.url_expires_in,300);assert(!('object_path' in row));assert(!('audit_status' in row));}
 assert.equal(rpcBodies.at(-1).p_end_date,'2026-08-02','detail derives its date from the fetched draft');
 response=await post('daily_sheet_read',true,{auth_staff_id:999,actor_user_id:id(99)});assert.equal(response.status,200);assert.equal(response.data.archived_originals.length,2);
 assert.equal(rpcBodies.at(-1).p_staff_id,24);assert.equal(rpcBodies.at(-1).p_actor_user_id,null,'staff is not a fabricated account');
 for(const op of ['daily_original_archive_url','daily_original_archive_upload','daily_sheet_confirm'])assert.equal((await post(op,true)).status,403,'staff write boundary remains closed');
 assert.equal((await post('daily_sheet_read',true,{store:'Other'})).status,403);
 granted=false;assert.equal((await post('daily_sheet_read',true)).status,403);granted=true;
 active=false;assert.equal((await post('daily_sheet_read',true)).status,403);active=true;
 mode='sign-failed';response=await post('daily_sheet_read');assert.equal(response.status,200);assert.equal(response.data.original_archive.count,2);
 assert(response.data.archived_originals.every(row=>row.private_url===null&&row.url_unavailable===true),'failed signing retains archived metadata');assert.deepEqual(financialOnly(response.data,false),legacyDetail);
 mode='query-failed';response=await post('daily_sheet_month');assert.deepEqual(response.data.days[0].original_archive,{state:'unavailable',count:null});assert.deepEqual(financialOnly(response.data,true),legacyMonth);
 response=await post('daily_sheet_read');assert.deepEqual(response.data.original_archive,{state:'unavailable',count:null});assert.deepEqual(response.data.archived_originals,[]);assert.deepEqual(financialOnly(response.data,false),legacyDetail);
 mode='ok';records=[];response=await post('daily_sheet_read');assert.deepEqual(response.data.original_archive,{state:'none',count:0});assert.equal(response.data.archived_originals.length,0);
 records=[{...original(10),report_date:'2026-08-02'}];response=await post('daily_sheet_read');assert.equal(response.data.original_archive.state,'unavailable','wrong date cannot be signed');
 records=[{...original(10),object_path:original(10).object_path.replace(store.id,id(99))}];calls=[];response=await post('daily_sheet_read');assert.equal(response.data.original_archive.state,'unavailable');assert.equal(calls.filter(c=>c.url.includes('/storage/')).length,0);
 assert(calls.every(c=>c.method==='GET'||c.path==='rpc/zysyr_daily_original_references'),'no financial/archive write or reconciliation is called');
 env.mockSession={...actor,auth_capabilities:[]};assert.equal((await post('daily_sheet_read')).status,403);
 console.log('Daily original bridge real HTTP: account/staff trusted scope, completed-only read facade, month metadata only, exact-date detail URLs, separate unreviewed references, failed signing/query, unchanged financial/recognition and no writes passed. Synthetic only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
