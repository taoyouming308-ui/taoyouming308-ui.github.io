'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const ExcelJS=require('exceljs'),JSZip=require('jszip');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store={id:id(1),company_id:id(2),name:'向里造型'};
const actor={operations_role:'finance',auth_account_id:id(3),auth_scope_type:'company',auth_stores:[store.name],auth_store_records:[store],auth_capabilities:['report.upload']};
(async()=>{
 const audit=await import('../supabase/functions/_shared/monthly-upload-verification.mjs');
 const compatibility=await import('../supabase/functions/_shared/petty-detail-xlsx.mjs');
 const {detectReportMetadata}=await import('../supabase/functions/_shared/report-auto-detection.mjs');
 const {assertUploadSourceStore}=await import('../supabase/functions/_shared/upload-store-guard.mjs');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('7月');sheet.getCell('A1').value='2026年7月盈亏报表';sheet.getCell('A4').value='盈亏统计';sheet.getCell('A5').value='收入类别';sheet.getCell('A6').value='美发收入';sheet.getCell('A2').value='房租';sheet.getCell('B2').value=123.45;sheet.getCell('B3').value={formula:'SUM(B2:B2)',result:123.45};
 let bytes=Buffer.from(await book.xlsx.writeBuffer());
 let calls=[],mode='',persisted,authenticated=true;
 const env=vm.createContext({console,Error,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,URL,Date,Request,Response,AbortSignal,crypto:webcrypto,atob,btoa,ExcelJS,JSZip,...audit,...compatibility,detectReportMetadata,assertUploadSourceStore,mockSession:actor,
 Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-key'},serve:fn=>{env.handler=fn}},
 fetch:async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET',p=u.pathname;
  calls.push({path:p,method});
  if(p.startsWith('/storage/')){assert.deepEqual(Buffer.from(opts.body),bytes,'storage must retain exact original bytes');assert.equal(method,'POST');assert.equal(opts.headers['x-upsert'],'false');assert.ok(p.includes(store.company_id+'/'+store.id));return Response.json({})}
  if(p.endsWith('/rpc/zysyr_register_report_upload')){
   assert.equal(method,'POST');const body=JSON.parse(opts.body);assert.equal(body.p_report.company_id,store.company_id);assert.equal(body.p_report.store_id,store.id);assert.equal(body.p_report.uploaded_by_user_id,actor.auth_account_id);
   if(body.p_report.report_type==='daily'){
    return Response.json({id:id(4),report_type:'daily',report_date:body.p_report.report_date,version:1});
   }
   assert.ok(body.p_report.display_data.upload_source_snapshot.available);assert.equal(body.p_report.display_data.upload_source_snapshot.cells.find(c=>c.address==='B2').numeric,123.45);
   persisted={...body.p_report,id:id(4),cells:body.p_cells};return Response.json({id:id(4),report_type:'monthly_profit_loss',report_date:'2026-07-01',version:1});
  }
  assert.equal(method,'GET');assert.equal(u.searchParams.get('company_id'),'eq.'+store.company_id);assert.equal(u.searchParams.get('store_id'),'eq.'+store.id);
  if(p.endsWith('/zysyr_daily_sheet_drafts'))return Response.json([{id:id(8),status:'draft',report_date:'2026-07-09'}]);
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
 // Reproduce XML namespace aliases from a valid reserialized single-month XLSX.
 const zipped=await JSZip.loadAsync(bytes);
 for(const entry of Object.values(zipped.files).filter(e=>!e.dir&&/\.(xml|rels)$/.test(e.name))){
  let xml=await entry.async('string');
  for(const [uri,prefix] of [['http://schemas.openxmlformats.org/spreadsheetml/2006/main','ns0'],['http://schemas.openxmlformats.org/package/2006/relationships','pkg'],['http://schemas.openxmlformats.org/package/2006/content-types','ct']]){
   if(xml.includes('xmlns="'+uri+'"'))xml=xml.replace('xmlns="'+uri+'"','xmlns:'+prefix+'="'+uri+'"').replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g,'<$1'+prefix+':$2');
  }
  if(entry.name==='xl/workbook.xml')xml=xml.replaceAll('xmlns:r=','xmlns:relx=').replaceAll('r:id=','relx:id=');
  zipped.file(entry.name,xml);
 }
 bytes=Buffer.from(await zipped.generateAsync({type:'uint8array'}));calls=[];r=await post({operation:'report_upload_auto'});
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.detection.month,'2026-07');assert.equal(r.data.verification.status,'matched');
 assert.equal(calls.filter(c=>c.path.endsWith('/rpc/zysyr_register_report_upload')).length,1);assert.equal(r.data.formal_ledger_changed,false);
 const daily=new ExcelJS.Workbook();
 const earlier=daily.addWorksheet('其它日报'),active=daily.addWorksheet('当前日报');
 daily.views=[{firstSheet:0,activeTab:1,visibility:'visible'}];
 for(const sheet of [earlier,active]){
  sheet.getCell('A1').value='自由手艺人 太合商业中心 店 7月业绩报表';
  sheet.getCell('B1').value='2026年7月9日';
  sheet.getCell('A4').value='现金';sheet.getCell('A5').value='支付';sheet.getCell('A6').value='总计';sheet.getCell('B4').value=9;
 }
 const dailyPayload={filename:'日报原件.xlsx',report_type:'daily',report_date:'2026-07-09',source_store:store.name};
 bytes=Buffer.from(await daily.xlsx.writeBuffer());calls=[];
 for(const operation of ['report_upload','report_upload_auto']){
  r=await post({...dailyPayload,operation});assert.notEqual(r.status,200);
  assert.match(r.data.error,/门店.*不一致/);
 }
 assert.equal(calls.filter(c=>c.method!=='GET').length,0,'mismatching electronic upload must not write');
 env.mockSession={...actor,auth_capabilities:[...actor.auth_capabilities,'daily_report.write']};calls=[];
 r=await post({...dailyPayload,operation:'daily_sheet_attachment_upload',draft_id:id(8)});
 assert.notEqual(r.status,200);assert.match(r.data.error,/门店.*不一致/);assert.equal(calls.filter(c=>c.method!=='GET').length,0);
 r=await post({...dailyPayload,operation:'daily_sheet_attachment_upload',draft_id:id(8),filename:'自由手艺人日报.jpg',mime_type:'image/jpeg'});
 assert.notEqual(r.status,200);assert.match(r.data.error,/门店.*不一致/);assert.equal(calls.filter(c=>c.method!=='GET').length,0);
 active.getCell('A1').value='2026年7月9日 业绩报表（向里造型）';
 bytes=Buffer.from(await daily.xlsx.writeBuffer());calls=[];
 r=await post(dailyPayload);
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.saved.report_type,'daily');
 assert.equal(calls.filter(c=>c.path.startsWith('/storage/')&&c.method==='POST').length,1,'verified active worksheet can save even if an inactive sheet names another store');
 active.getCell('A1').value='业绩报表';
 bytes=Buffer.from(await daily.xlsx.writeBuffer());calls=[];
 r=await post(dailyPayload);
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.saved.report_type,'daily','unnamed report header remains supported after independent confirmation');
 for(const session of [{...actor,auth_capabilities:[]},{...actor,operations_role:'shareholder',auth_capabilities:[]},{...actor,operations_role:'employee',auth_capabilities:[]}]){env.mockSession=session;calls=[];r=await post({role:'finance'});assert.notEqual(r.status,200);assert.equal(calls.length,0)}
 env.mockSession=actor;calls=[];r=await post({store:'Foreign Store'});assert.notEqual(r.status,200);assert.equal(calls.length,0);
 authenticated=false;r=await post({});assert.equal(r.status,403);assert.equal(calls.length,0);
 console.log('Monthly audit full HTTP route: real XLSX -> immutable draft registration -> scoped persisted readback; mismatches/read failures preserve saved receipt; denied roles/store, no posting passed');
})().catch(e=>{console.error(e);process.exitCode=1});
