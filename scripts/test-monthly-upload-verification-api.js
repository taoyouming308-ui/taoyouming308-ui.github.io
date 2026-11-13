'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const ExcelJS=require('exceljs'),JSZip=require('jszip');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store={id:id(1),company_id:id(2),name:'Synthetic Store'};
const actor={operations_role:'finance',auth_account_id:id(3),auth_scope_type:'company',auth_stores:[store.name],auth_store_records:[store],auth_capabilities:['report.upload']};
(async()=>{
 const audit=await import('../supabase/functions/_shared/monthly-upload-verification.mjs');
 const {detectReportMetadata}=await import('../supabase/functions/_shared/report-auto-detection.mjs');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('7月');sheet.getCell('A1').value='2026年7月盈亏报表';sheet.getCell('A4').value='盈亏统计';sheet.getCell('A5').value='收入类别';sheet.getCell('A6').value='美发收入';sheet.getCell('A2').value='房租';sheet.getCell('B2').value=123.45;sheet.getCell('B3').value={formula:'SUM(B2:B2)',result:123.45};
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 let calls=[],mode='',persisted,authenticated=true;
 const env=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,URL,Date,Request,Response,AbortSignal,crypto:webcrypto,atob,btoa,ExcelJS,JSZip,...audit,detectReportMetadata,mockSession:actor,
 Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-key'},serve:fn=>{env.handler=fn}},
 fetch:async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET',p=u.pathname;
  calls.push({path:p,method});
  if(p.startsWith('/storage/')){assert.equal(method,'POST');assert.equal(opts.headers['x-upsert'],'false');assert.ok(p.includes(store.company_id+'/'+store.id));return Response.json({})}
  if(p.endsWith('/rpc/zysyr_register_report_upload')){
   assert.equal(method,'POST');const body=JSON.parse(opts.body);assert.equal(body.p_report.company_id,store.company_id);assert.equal(body.p_report.store_id,store.id);assert.equal(body.p_report.uploaded_by_user_id,actor.auth_account_id);
   assert.ok(body.p_report.display_data.upload_source_snapshot.available);assert.equal(body.p_report.display_data.upload_source_snapshot.cells.find(c=>c.address==='B2').numeric,123.45);
   persisted={...body.p_report,id:id(4),cells:body.p_cells};return Response.json({id:id(4),report_type:'monthly_profit_loss',report_date:'2026-07-01',version:1});
  }
  assert.equal(method,'GET');assert.equal(u.searchParams.get('company_id'),'eq.'+store.company_id);assert.equal(u.searchParams.get('store_id'),'eq.'+store.id);
  if(mode==='read-failure')return new Response('{}',{status:503});
  if(p.endsWith('/zysyr_report_uploads')){assert.equal(u.searchParams.get('id'),'eq.'+id(4));return Response.json([persisted])}
  if(p.endsWith('/zysyr_report_cells')){assert.equal(u.searchParams.get('report_id'),'eq.'+id(4));const cells=structuredClone(persisted.cells);if(mode==='mismatch')cells.find(c=>c.cell_address==='B2').numeric_value=999;return Response.json(cells)}
  throw Error('Unexpected operation '+method+' '+p);
 }});
 for(const file of ['supabase/functions/_shared/staff-report-access.ts','supabase/functions/operations-api/index.ts'])vm.runInContext(stripTypeScriptTypes(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')),env);
 env.isSyntheticAuthenticated=()=>authenticated;
 vm.runInContext('var originalRequireSession=requireSession;requireSession=async(payload,request)=>isSyntheticAuthenticated()?mockSession:originalRequireSession(payload,request)',env);
 const post=async extra=>{const r=await env.handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({operation:'report_upload',store:store.name,report_type:'monthly_profit_loss',report_date:'2026-07',month:'2026-07',filename:'2026年7月盈亏报表.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:bytes.toString('base64'),...extra})}));return {status:r.status,data:await r.json()}};
 for(mode of ['', 'mismatch','read-failure']){
  calls=[];const r=await post({company_id:id(99),store_id:id(99),uploaded_by_user_id:id(99),upload_source_snapshot:{available:true}});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.saved.id,id(4));assert.equal(r.data.verification.status,mode==='mismatch'?'mismatch':mode==='read-failure'?'needs_review':'matched');assert.equal(r.data.formal_ledger_changed,false);
  assert.equal(calls.filter(c=>c.path.endsWith('/rpc/zysyr_register_report_upload')).length,1);
  assert.ok(calls.every(c=>c.method==='GET'||c.path.includes('/storage/')||c.path.endsWith('/rpc/zysyr_register_report_upload')),'no posting/approval/ledger writes');
 }
 mode='';calls=[];let r=await post({operation:'report_upload_auto'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.verification.status,'matched');
 for(const session of [{...actor,auth_capabilities:[]},{...actor,operations_role:'shareholder',auth_capabilities:[]},{...actor,operations_role:'employee',auth_capabilities:[]}]){env.mockSession=session;calls=[];r=await post({role:'finance'});assert.notEqual(r.status,200);assert.equal(calls.length,0)}
 env.mockSession=actor;calls=[];r=await post({store:'Foreign Store'});assert.notEqual(r.status,200);assert.equal(calls.length,0);
 authenticated=false;r=await post({});assert.equal(r.status,403);assert.equal(calls.length,0);
 console.log('Monthly audit full HTTP route: real XLSX -> immutable draft registration -> scoped persisted readback; mismatches/read failures preserve saved receipt; denied roles/store, no posting passed');
})().catch(e=>{console.error(e);process.exitCode=1});
