// Synthetic legacy January source -> real page/Edge/PG17. Never contacts production.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),http=require('node:http'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module'),{chromium}=require('playwright'),crypto=require('node:crypto');
module.exports=async function({sql,json,q,C,S,A,U,V:baseVoucher,id}){
 const D=id(300),SN=id(301),V=id(302),service="set request.jwt.claim.role='service_role';",root=path.resolve(__dirname,'..');
 const functionSQL=(file,name)=>{const s=fs.readFileSync(file,'utf8'),a=s.indexOf('create or replace function '+name+'(');assert(a>=0);return s.slice(a,s.indexOf('revoke all on function '+name,a));};
 for(const [f,n] of [
  ['20260930034900_zysyr_daily_project_routes_v5.sql','platform_item_routes'],
  ['20261002020000_zysyr_daily_exact_catalog_v10.sql','report_project_category'],
  ['20260930045230_zysyr_daily_source_protection_v7.sql','autofill_cells']])
  sql(functionSQL('supabase/migrations/'+f,'zysyr_daily_electronic_private.'+n));
 sql(fs.readFileSync('supabase/migrations/20261007044552_zysyr_daily_bleaching_color_family.sql','utf8'));
 const role='发型师',suffix=crypto.createHash('md5').update(role).digest('hex').slice(0,8),row=n=>'stylist_e'+n+'_'+suffix;
 const columns=['dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment'];
 const payload={bills:[54,10,36].map((amount,i)=>({source_bill_id:'test-project-'+i,shop_id:'1009951',source_posted_amount_cents:amount*100,
  items:[{source_item_id:'i'+i,item_code:i===2?'523':'201',item_name:i===2?'歌薇酸护（盖白发）880':'剪发120',amount_cents:amount*100}],
  employee_allocations:[{employee_id:String(101+i),employee_name:'测试员工'+i,source_role:role,source_item_id:'i'+i,performance_cents:amount*100,source_project_count:1}],
  payments:[{source_field:'pay',source_label:'支付宝',amount_cents:amount*100}]}))};
 sql(`insert into zysyr_voucher_attachments select (jsonb_populate_record(null::zysyr_voucher_attachments,to_jsonb(v)||jsonb_build_object('id','${V}','object_path','synthetic/january-original.jpg'))).* from zysyr_voucher_attachments v where id='${baseVoucher}';
 insert into zysyr_daily_sheet_drafts select (jsonb_populate_record(null::zysyr_daily_sheet_drafts,to_jsonb(d)||jsonb_build_object(
 'id','${D}','report_date','2026-01-02','status','draft','edit_revision',0,'source_voucher_id','${V}','confirmed_at',null,'confirmed_by_user_id',null,'confirm_reason',null,
 'template_code','zysyr_frontdesk_project_draft','ocr_provider','frontdesk-autofill','ocr_model','frontdesk-autofill-v2','ocr_raw_result',
 '{"autofill":{"snapshot_id":"${SN}","mapping_version":"frontdesk-autofill-v7","cash_receipts":{"policy":"operating-external-cash-v1","state":"candidate","cash_channels_complete":false}}}'::jsonb))).* from zysyr_daily_sheet_drafts d limit 1;
 insert into mgj_business_detail_snapshots(id,source_sha256,shop_name,business_date,payload,source_count) values('${SN}',repeat('b',64),'Synthetic store','2026-01-02',${q(JSON.stringify(payload))}::jsonb,3);
 insert into mgj_business_detail_heads values('Synthetic store','2026-01-02','${SN}',now());
 insert into mgj_daily_consumption values('Synthetic store','2026-01-02',${q(JSON.stringify(payload.bills.map(b=>({source_id:b.source_bill_id,amount:b.source_posted_amount_cents/100}))))}::jsonb,now());`);
 const cells=[];let seq=400,unknown=0;
 function add(section,key,label,code,cellRole,value,r,c,manual=true){cells.push({id:id(seq++),section_code:section,row_key:key,row_label:label,column_code:code,column_label:code,cell_role:cellRole,ocr_numeric:value,corrected_numeric:manual?value:null,manual_override:manual,source_method:'frontdesk_autofill',row_number:r,column_number:c});}
 for(let i=0;i<3;i++){
  for(const [j,code] of columns.entries()){
   const amount=(i<2&&code==='wash_cut_blow')?[54,10][i]:(i===2&&code==='color')?36:0;
   const pending=amount===0&&(unknown<12||i===2&&code==='treatment');if(pending)unknown++;
   add('stylist',row(101+i),'测试员工'+i,code,'staff_value',pending?null:amount,i+3,j+2,amount!==0);
  }
  add('stylist',row(101+i),'测试员工'+i,'subtotal','staff_total',[54,10,36][i],i+3,20);
 }
 assert.equal(unknown,13);
 for(const [j,code] of columns.entries())add('stylist','stylist_category_total','小计',code,'category_total',code==='wash_cut_blow'?64:code==='color'?36:0,12,j+2);
 add('stylist','stylist_category_total','小计','subtotal','summary_value',100,12,20);
 for(const [section,code,role,value,r,c] of [
  ['summary','actual_total','summary_actual',100,30,9],['summary','grand_total','summary_grand',100,30,20],['summary','card_subtotal','summary_value',0,30,19],
  ['payment','alipay','payment_method',100,33,12],['payment','cash_flow','payment_cashflow',100,33,18],['payment','card_consumption','payment_card_consumption',0,33,19],['payment','total','payment_total',100,33,20]])add(section,section,section,code,role,value,r,c);
 for(const cell of cells)sql(`insert into zysyr_daily_sheet_cells select (jsonb_populate_record(null::zysyr_daily_sheet_cells,${q(JSON.stringify({...cell,company_id:C,store_id:S,draft_id:D,row_label_source_method:'template',created_at:'2026-01-02T12:00:00Z',updated_at:'2026-01-02T12:00:00Z'}))}::jsonb)).*;`);
 const snapshot=()=>sql(`select jsonb_build_object('cells',(select jsonb_agg(to_jsonb(c) order by id) from zysyr_daily_sheet_cells c),'drafts',(select jsonb_agg(to_jsonb(d) order by id) from zysyr_daily_sheet_drafts d),'audit',(select count(*) from zysyr_audit_events),'income',(select count(*) from zysyr_income_records),'reports',(select count(*) from zysyr_daily_reports));`);
 const before=snapshot(),migration=fs.readFileSync('supabase/migrations/20261011074944_zysyr_daily_project_review.sql','utf8');sql(migration);sql(migration);
 const history=()=>sql(`select jsonb_build_object('drafts',(select jsonb_agg(to_jsonb(d) order by id) from zysyr_daily_sheet_drafts d where id<>'${D}' and status='confirmed'),
  'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from zysyr_daily_sheet_cells c join zysyr_daily_sheet_drafts d on d.id=c.draft_id where d.id<>'${D}' and d.status='confirmed'));`);
 const priorHistory=history();
 assert.equal(snapshot(),before,'definition-only migration never mutates finance data');
 const reference=()=>json(service+`select public.zysyr_daily_project_review_context('${C}','${S}','${D}');`);
 const items=()=>reference().cells.filter(x=>JSON.stringify(x.value)!==JSON.stringify(x.source_value)||x.unknown);
 assert.equal(reference().ready,true);assert.equal(items().length,14);assert.equal(items().filter(x=>x.value===null).length,13);
 assert.equal(items().find(x=>x.row_key===row(103)&&x.column_code==='treatment').source_value,36);
 const consent=()=>({statement:'finance-project-review-v1',source_token:reference().source_token,items:items().map(x=>({cell_id:x.cell_id,value:x.value,acknowledged:true}))});
 const cash=()=>({statement:'cash-original-channels-sales-v1',source_token:json(service+`select public.zysyr_daily_cash_review_status('${C}','${S}','${D}');`).source_token,request_id:id(700)});
 const report={original_filename:'test.jpg',mime_type:'image/jpeg',size_bytes:3,sha256:'a'.repeat(64),bucket_id:'zysyr-reports',object_path:'synthetic/january.jpg',display_data:{}};
 const post=(p={})=>service+`select public.zysyr_confirm_daily_project_review('${p.actor||A}','${p.auth||U}','${C}','${p.store||S}','${D}',${p.revision??0},${q(JSON.stringify(p.report||report))}::jsonb,null,'Synthetic item-by-item review',${q(JSON.stringify(p.consent||consent()))}::jsonb,${q(JSON.stringify(p.cash||cash()))}::jsonb,${p.cellHash?q(p.cellHash):'null'});`;
 const fail=(query,re)=>assert.throws(()=>sql(query),e=>re.test(String(e.stderr||e)));
 for(const role of ['anon','authenticated'])fail('set role '+role+';'+post(),/permission denied/);
 for(const patch of [{auth:id(999)},{store:id(999)},{revision:9},{consent:{}},{consent:{...consent(),items:[]}},{consent:{...consent(),source_token:'wrong'}}])fail(post(patch),/FORBIDDEN|DRAFT_NOT_FOUND|REVISION_CONFLICT|EXPLICIT_ITEMS_REQUIRED|ITEMS_CHANGED|SOURCE_CHANGED/);
 const partial=consent();partial.items.pop();fail(post({consent:partial}),/ITEMS_CHANGED/);
 const duplicate=consent();duplicate.items.push(duplicate.items[0]);fail(post({consent:duplicate}),/ITEMS_CHANGED/);
 const spoof=consent();spoof.items[0].acknowledged=false;fail(post({consent:spoof}),/ITEMS_CHANGED/);
 const oldConsent=consent();sql(`update zysyr_daily_sheet_cells set corrected_numeric=1,manual_override=true where draft_id='${D}' and id='${oldConsent.items[0].cell_id}'`);
 fail(post({consent:oldConsent}),/ITEMS_CHANGED/);sql(`update zysyr_daily_sheet_cells set corrected_numeric=null,manual_override=false where draft_id='${D}' and id='${oldConsent.items[0].cell_id}'`);
 for(const mutation of [`update mgj_business_detail_heads set last_seen_at=last_seen_at+interval '1 second' where snapshot_id='${SN}'`,
  `create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text) returns text language sql immutable as $$select 'color'::text$$`,
  `update zysyr_daily_sheet_cells set corrected_numeric=99 where draft_id='${D}' and cell_role='payment_total'`,
  `update zysyr_user_accounts set status='disabled' where id='${A}'`,`set test.locked='yes'`])
  fail('begin;'+mutation+';'+post(),/SOURCE_CHANGED|VALUES_INCOMPLETE|CONTROL_MISMATCH|FORBIDDEN|PERIOD_LOCKED/);
 sql("create function public.project_fail_income() returns trigger language plpgsql as $$begin raise exception 'synthetic project downstream';end$$;create trigger project_fail before insert on zysyr_income_records for each row execute function public.project_fail_income();");
 fail(post(),/synthetic project downstream/);sql('drop trigger project_fail on zysyr_income_records;drop function public.project_fail_income();');
 assert.equal(snapshot(),before,'failed checks and final downstream error roll back proofs and ledger');
 await browserSequence();
 assert.equal(history(),priorHistory,'all previously posted drafts and cells remain byte-identical');
 // The same project proof also wraps the existing electronic-evidence transaction.
 const E=id(305),ES=id(306),EQ=id(307),day='2026-10-07';
 sql(`insert into zysyr_daily_sheet_drafts select (jsonb_populate_record(null::zysyr_daily_sheet_drafts,to_jsonb(d)||jsonb_build_object(
 'id','${E}','report_date','${day}','status','draft','edit_revision',0,'source_voucher_id',null,'confirmed_at',null,'confirmed_by_user_id',null,'confirm_reason',null,
 'ocr_raw_result',jsonb_set(d.ocr_raw_result,'{autofill,snapshot_id}',to_jsonb('${ES}'::text))))).* from zysyr_daily_sheet_drafts d where id='${D}';
 insert into zysyr_daily_sheet_cells select (jsonb_populate_record(null::zysyr_daily_sheet_cells,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'draft_id','${E}'))).* from zysyr_daily_sheet_cells c where draft_id='${D}';
 insert into mgj_business_detail_snapshots(id,source_sha256,shop_name,business_date,payload,source_count) select '${ES}',source_sha256,shop_name,'${day}',payload,source_count from mgj_business_detail_snapshots where id='${SN}';
 insert into mgj_business_detail_heads values('Synthetic store','${day}','${ES}',now());
 insert into mgj_daily_consumption select shop_name,'${day}',services,fetched_at from mgj_daily_consumption where business_date='2026-01-02';`);
 const er=json(service+`select public.zysyr_daily_project_review_context('${C}','${S}','${E}');`),ee=json(service+`select public.zysyr_daily_electronic_post_context('${C}','${S}','${E}');`);
 assert.equal(ee.ready,true);
 const ep={statement:'finance-project-review-v1',source_token:er.source_token,items:er.cells.filter(x=>x.value!==x.source_value||x.unknown).map(x=>({cell_id:x.cell_id,value:x.value,acknowledged:true}))};
 const ec={statement:'electronic-channels-sales-v1',source_token:ee.source_token,request_id:EQ};
 const archive={...report,original_filename:'synthetic-electronic.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',object_path:`${C}/${S}/daily/${day}/electronic-${E}-${EQ}.xlsx`,display_data:{electronic_source:ee.evidence}};
 const epost=hash=>service+`select public.zysyr_confirm_daily_project_review('${A}','${U}','${C}','${S}','${E}',0,${q(JSON.stringify(archive))}::jsonb,null,'Synthetic electronic project review',${q(JSON.stringify(ep))}::jsonb,${q(JSON.stringify(ec))}::jsonb,${q(hash)});`;
 const eBefore=sql(`select jsonb_agg(to_jsonb(c) order by id) from zysyr_daily_sheet_cells c where draft_id='${E}'`);
 fail(epost('stale'),/SOURCE_OR_CELLS_CHANGED/);json(epost(ee.cell_hash));
 assert.equal(sql(`select jsonb_agg(to_jsonb(c) order by id) from zysyr_daily_sheet_cells c where draft_id='${E}'`),eBefore);
 assert.equal(sql(`select count(*) from zysyr_audit_events where entity_id='${E}' and action in('review_project_sources','review_electronic_source')`),'2');
 async function browserSequence(){
  const calls=[],uploads=[];
  const read=()=>json(service+`select jsonb_build_object('draft',(select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='${D}'),
   'cells',(select jsonb_agg(to_jsonb(c) order by row_number,column_number) from zysyr_daily_sheet_cells c where draft_id='${D}'),
   'cash_review',public.zysyr_daily_cash_review_status('${C}','${S}','${D}'),'project_review',public.zysyr_daily_project_review_context('${C}','${S}','${D}'),
   'permissions',jsonb_build_object('write',true,'upload_original',true),'history','[]'::jsonb,'attachments','[]'::jsonb,'locked',false);`);
  const context={console,crypto:crypto.webcrypto,SUPABASE_URL:'http://synthetic-storage',SERVICE_KEY:'synthetic',REPORT_BUCKET:'zysyr-reports',
   cleanText:(v,n)=>String(v??'').trim().slice(0,n),safeCellText:(v,n)=>String(v??'').slice(0,n),uuidValue:v=>v,
   hasAuthCapability:()=>true,selectedStoreInfo:async()=>({id:S,company_id:C,name:'Synthetic store'}),restRows:async()=>[read().draft],restRowsAll:async()=>read().cells,dailySheetRead:async()=>read(),
   approvedDailyVoucher:async()=>({id:V,mime_type:'image/jpeg',original_filename:'test.jpg'}),voucherSourceBytes:async()=>new Uint8Array([1,2,3]),sha256Bytes:async()=> 'a'.repeat(64),exactArrayBuffer:b=>b.buffer,storagePath:x=>x,
   effectiveCellValue:c=>c.manual_override?c.corrected_numeric:c.ocr_numeric,fetch:async(url)=>{assert.match(url,/synthetic-storage/);uploads.push(url);return {ok:true};},
   financeRpcSaved:async(name,p)=>{calls.push({name,p});let query;
    if(name==='rpc/zysyr_save_daily_sheet_cells')query=`select public.zysyr_save_daily_sheet_cells('${A}','${C}','${S}','${D}',${q(JSON.stringify(p.p_cells))}::jsonb,${q(p.p_reason)},${p.p_expected_revision});`;
    else if(name==='rpc/zysyr_confirm_daily_project_review')query=`select public.zysyr_confirm_daily_project_review('${p.p_actor_user_id}','${p.p_actor_auth_user_id}','${C}','${S}','${D}',${p.p_expected_revision},${q(JSON.stringify(p.p_report))}::jsonb,null,${q(p.p_reason)},${q(JSON.stringify(p.p_project_confirmation))}::jsonb,${q(JSON.stringify(p.p_cash_confirmation))}::jsonb,null);`;
    else throw Error('unexpected '+name);return json(service+query);
   }};
  vm.createContext(context);const edge=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
  for(const [start,end] of [['async function saveDailySheetDraft(','\nasync function dailySheetCorrectionStatus('],['async function confirmDailySheetDraft(','\nasync function importCenter(']]){const a=edge.indexOf(start);vm.runInContext(stripTypeScriptTypes(edge.slice(a,edge.indexOf(end,a))),context);}
  const session={operations_role:'finance',auth_account_id:A,auth_user_id:U};
  await assert.rejects(context.confirmDailySheetDraft({draft_id:D,expected_revision:0,reason:'synthetic',reviewed_all:true},session),/逐项复核/);
  const server=http.createServer(async(req,res)=>{try{
   if(req.url==='/synthetic-api'){let body='';for await(const part of req)body+=part;const {op,p}=JSON.parse(body);let out;
    if(op==='daily_sheet_read')out=read();else if(op==='daily_sheet_save')out=await context.saveDailySheetDraft(p,session);
    else if(op==='daily_sheet_confirm')out=await context.confirmDailySheetDraft(p,session);else if(op==='daily_sheet_month')out={days:[]};else if(op==='daily_recognition_job_read')out={job:null};else throw Error(op);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));return;}
   const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(f));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:String(e.stderr||e.message)}));}});
  let browser;try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
   browser=await chromium.launch({...process.platform==='darwin'?{channel:'chrome'}:{},headless:true});
   for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
    await page.goto(origin+'/operations.html?preview=1&role=finance');await page.evaluate(async s=>{
     await showView('daily-report');currentStore=()=> 'Synthetic store';isLocalPreview=()=>false;window.testDialogs=[];window.confirm=t=>{testDialogs.push(t);return true;};
     api=async(op,p)=>{const r=await fetch('/synthetic-api',{method:'POST',body:JSON.stringify({op,p})}),out=await r.json();if(!r.ok)throw Error(out.error);return out;};
     state.imports.sheet=s;state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
    },read());
    assert.equal(await page.locator('#daily-detail-confirm-top').getAttribute('data-block-reason'),'');
    assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/14 项/);
    await page.locator('#daily-detail-confirm-top').click();await page.locator('#daily-project-review').waitFor();
    assert.equal(await page.locator('[data-project-review-item]').count(),14);assert.equal(await page.locator('[data-project-review-continue]').isDisabled(),true);
    assert.match(await page.locator('#daily-project-review').innerText(),/36\.00 元.*空白/);assert.match(await page.locator('#daily-project-review').innerText(),/保留当前财务填写值/);
    assert.equal(await page.locator('#daily-project-review').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true,'dialog fits mobile viewport');
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts','daily-project-review-'+width+'.png')});
    await page.locator('[data-project-review-item]').first().check();assert.equal(await page.locator('[data-project-review-continue]').isDisabled(),true);
    await page.locator('[data-project-review-cancel]').click();assert.equal(calls.length,0,'cancel never saves or posts');assert.equal(snapshot(),before);
    const value=page.locator('[data-row-key="'+row(101)+'"][data-column-code="wash_cut_blow"]');await value.fill('55');
    assert.equal(await value.getAttribute('aria-invalid'),'true');assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/差额.*1\.00/);
    await page.locator('#daily-detail-confirm-top').click();assert.equal(await page.locator('#daily-project-review').count(),0,'arithmetic errors never reach source override');await value.fill('54');
    if(width===390){await page.close();continue;}
    await page.locator('#daily-detail-confirm-top').click();await page.locator('#daily-project-review').waitFor();for(const checkbox of await page.locator('[data-project-review-item]').all())await checkbox.check();
    await page.locator('[data-project-review-continue]').click();
    try{await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed',null,{timeout:20000});}catch(e){console.error(await page.locator('#daily-detail-note').innerText());throw e;}
    assert.equal(await page.evaluate(()=>testDialogs.length),1);assert.deepEqual(errors,[]);await page.close();
   }
   assert.equal(calls.filter(c=>c.name==='rpc/zysyr_confirm_daily_project_review').length,1);assert.equal(uploads.length,1);
   assert.equal(sql(`select count(*) from zysyr_daily_sheet_cells where draft_id='${D}' and cell_role='staff_value' and ocr_numeric is null and corrected_numeric is null`),'13','all unknown blanks stay NULL after explicit review');
   assert.equal(sql(`select corrected_numeric from zysyr_daily_sheet_cells where draft_id='${D}' and row_key='${row(103)}' and column_code='color'`),'36.00','finance correction never replaced by source');
   assert.equal(sql(`select count(*) from zysyr_audit_events where entity_id='${D}' and action='review_project_sources' and jsonb_array_length(after_json->'items')=14`),'1');
   assert.equal(sql(`select sum(amount) from zysyr_income_records where income_date='2026-01-02'`),'100.00');
   fail(post({consent:{statement:'finance-project-review-v1',source_token:'a'.repeat(64),items:[]}}),/ALREADY_CONFIRMED/);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
 }
 console.log('Project review: 13 legacy NULLs + one positive classification conflict; explicit per-item review, red arithmetic errors, NULL/manual preservation, source/revision/ACL/atomic rollback and real browser->Edge->PG posting passed.');
};
