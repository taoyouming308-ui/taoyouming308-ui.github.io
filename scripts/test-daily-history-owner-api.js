// Exercise the real request handler and Auth scope resolution over local HTTP.
// Auth/database transports are synthetic; no production login or finance writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const {stripTypeScriptTypes}=require('node:module');
const root=process.cwd(),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner={id:'57aba56a-23ca-482b-acc2-e00da5a5d1f7',auth_user_id:'d205de6f-2bbe-46f3-a591-4725a2423777',company_id:'02463a53-dfdb-4291-b04d-dd1d85f9d998',login_name:'admin'};
const store={id:id(1),company_id:owner.company_id,name:'Synthetic',status:'active'},draft={id:id(2),report_date:'2026-10-11',status:'draft',template_code:'manual',edit_revision:1};
const audit={id:id(3),cell_id:id(4),changed_by_user_id:owner.id,before_value:10,after_value:20,reason:'SYNTHETIC_PRIVATE_AUDIT'};
let paths=[],server;
function authScope(token){
 const user={...owner,display_name:'Synthetic owner'},scope={type:'company'};
 let role='shareholder',caps=['dashboard.group.read','voucher.read','daily_report.write','daily_report.correct_confirmed'];
 if(token!=='owner')user.id=id(10),user.auth_user_id=id(11);
 if(token==='finance'){role='finance';scope.type='store';scope.store_id=store.id;caps=['dashboard.store.read','voucher.read','daily_report.write'];}
 if(token==='revoked')user.id=owner.id,user.auth_user_id=owner.auth_user_id,caps=caps.filter(c=>c!=='daily_report.correct_confirmed');
 if(token==='wrong-auth')user.id=owner.id;
 if(token==='wrong-company')user.id=owner.id,user.auth_user_id=owner.auth_user_id,user.company_id=id(30);
 if(token==='renamed-owner')Object.assign(user,owner,{login_name:'renamed',display_name:'not admin'});
 if(token==='display-spoof')user.login_name='ordinary',user.display_name='admin';
 return {auth_boundary:'supabase_auth_rls',user,roles:[{code:role,scope}],capabilities:caps.map(code=>({code,scopes:[scope]})),stores:[store]};
}
async function main(){
 const {dailyAutofillView}=await import(root+'/supabase/functions/_shared/daily-autofill-view.mjs');
 const ctx=vm.createContext({console,Request,Response,Headers,URL,TextEncoder,TextDecoder,crypto,Buffer,AbortSignal,setTimeout,clearTimeout,
  dailyAutofillView,parseMonth:v=>v||'2026-10',STAFF_REPORT_CAPABILITIES:[],
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-service':''},serve:()=>{}},
  fetch:async(url,opt={})=>{
   const u=new URL(url);if(u.pathname==='/functions/v1/operations-auth'){
    const token=String(opt.headers.Authorization).replace('Bearer ','');
    return Response.json(token==='invalid'?{error:'invalid'}:authScope(token),{status:token==='invalid'?401:200});
   }
   assert.equal(u.origin,'https://synthetic.invalid');paths.push(u.pathname+u.search);
   const table=u.pathname.split('/').at(-1),q=u.searchParams;
   if(table==='zysyr_daily_sheet_drafts')return Response.json(q.get('company_id')==='eq.'+owner.company_id&&q.get('store_id')==='eq.'+store.id&&(!q.has('id')||q.get('id')==='eq.'+draft.id)?[draft]:[]);
   if(table==='zysyr_daily_sheet_cells')return Response.json([{id:id(4),section_code:'stylist',row_label:'Synthetic',ocr_numeric:20}]);
   if(table==='zysyr_daily_sheet_cell_changes'){assert.equal(q.get('company_id'),'eq.'+owner.company_id);assert.equal(q.get('store_id'),'eq.'+store.id);return Response.json([audit]);}
   if(table==='zysyr_user_accounts')return Response.json([{id:owner.id,display_name:'Synthetic actor'}]);
   return Response.json([]);
  }});
 const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),ctx);
 server=http.createServer(async(req,res)=>{try{let body='';for await(const c of req)body+=c;const result=await ctx.handleOperationsApiRequest(new Request('https://synthetic.invalid/operations-api',{method:req.method,headers:req.headers,body}),()=>{});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());}catch(e){res.writeHead(500);res.end(String(e));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=async(token,operation='daily_sheet_read',extra={})=>{paths=[];const r=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({operation,store:'Synthetic',draft_id:draft.id,...extra})});return {status:r.status,data:await r.json(),queries:[...paths]};};
 for(const token of ['owner','renamed-owner']){const r=await request(token);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.permissions.read_history,true);assert.equal(r.data.history[0].reason,audit.reason);}
 for(const token of ['finance','shareholder','display-spoof','revoked','wrong-auth','wrong-company']){
  for(const operation of ['daily_sheet_read','daily_sheet_get','daily_sheet_month']){
   const r=await request(token,operation,{read_history:true,can_read_daily_history:true,role:'admin',auth_account_id:owner.id,auth_user_id:owner.auth_user_id});
   assert.ok(!JSON.stringify(r.data).includes(audit.reason),token+' '+operation);assert.equal(Object.hasOwn(r.data,'history'),false);
   assert.ok(!r.queries.some(p=>p.includes('zysyr_daily_sheet_cell_changes')),token+' never queries history');
   if(operation==='daily_sheet_read'&&token!=='wrong-company'){assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.permissions.read_history,false);assert.equal(r.data.cells[0].effective_numeric,20);}
  }
  for(const operation of ['daily_sheet_history','daily_history_export','daily_sheet_export']){const r=await request(token,operation);assert.notEqual(r.status,200);assert.ok(!JSON.stringify(r.data).includes(audit.reason));}
 }
 const finance=await request('finance');assert.equal(finance.data.permissions.write,true,'ordinary daily editing preserved');
 const denied=await request('owner','daily_sheet_read',{store:'Unauthorized'});assert.notEqual(denied.status,200);assert.equal(denied.queries.length,0,'scope denial before DB read');
 const scoped=await request('finance','daily_sheet_read',{store:'Unauthorized'});assert.equal(scoped.status,200);assert.ok(scoped.queries.every(p=>!p.includes('Unauthorized')),'store-scoped account always uses server store');
 const foreign=await request('finance','daily_sheet_read',{draft_id:id(90)});assert.notEqual(foreign.status,200);assert.ok(!JSON.stringify(foreign.data).includes(audit.reason));
 const invalid=await request('invalid');assert.notEqual(invalid.status,200);assert.equal(invalid.queries.length,0);
 console.log('Direct HTTP API: exact live owner mapping, renamed owner, finance/shareholder/name/client spoof and revoked/wrong Auth/company denial; list/detail/unsupported export, store isolation and ordinary write permission passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server?.close());
