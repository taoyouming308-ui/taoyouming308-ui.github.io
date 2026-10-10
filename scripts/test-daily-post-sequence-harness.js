// Actual page -> actual Edge save/confirm implementations -> isolated PG17.
// Storage bytes and identity are synthetic; all production/network calls blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module'),{chromium}=require('playwright');
module.exports=async function({sql,json,q,C,S,A,D,V,U}){
 const root=path.resolve(__dirname,'..'),calls=[],uploads=[];
 const service="set request.jwt.claim.role='service_role';";
 const read=()=>json(service+`select jsonb_build_object('draft',(select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='${D}'),
 'cells',(select jsonb_agg(to_jsonb(c) order by c.row_number,c.column_number,c.row_key) from zysyr_daily_sheet_cells c where draft_id='${D}'),
 'cash_review',public.zysyr_daily_cash_review_status('${C}','${S}','${D}'),'permissions',jsonb_build_object('write',true,'upload_original',true),
 'history','[]'::jsonb,'attachments','[]'::jsonb,'locked',false);`);
 const session={operations_role:'finance',auth_account_id:A,auth_user_id:U,auth_capabilities:['daily_report.write']};
 const context={console,crypto:require('node:crypto').webcrypto,SUPABASE_URL:'http://synthetic-storage',SERVICE_KEY:'synthetic',REPORT_BUCKET:'zysyr-reports',
  cleanText:(v,n)=>String(v??'').trim().slice(0,n),safeCellText:(v,n)=>String(v??'').slice(0,n),uuidValue:v=>{if(!/^[a-f0-9-]{36}$/.test(v))throw Error('invalid identity');return v;},
  hasAuthCapability:(s,c)=>s.auth_capabilities?.includes(c),selectedStoreInfo:async(s,p)=>{if(p.store!=='Synthetic store')throw Error('scope');return {id:S,company_id:C,name:'Synthetic store'};},
  restRows:async()=>[read().draft],restRowsAll:async()=>read().cells,dailySheetRead:async()=>read(),
  approvedDailyVoucher:async()=>({id:V,mime_type:'image/jpeg',original_filename:'synthetic.jpg'}),voucherSourceBytes:async()=>new Uint8Array([1,2,3]),
  sha256Bytes:async()=> 'a'.repeat(64),exactArrayBuffer:b=>b.buffer,storagePath:x=>x,effectiveCellValue:c=>c.manual_override?c.corrected_numeric:c.ocr_numeric,
  fetch:async(url,options)=>{assert.match(url,/synthetic-storage/);uploads.push({url,method:options.method});return {ok:true};},
  financeRpcSaved:async(name,p)=>{calls.push({name,p});let query;
   if(name==='rpc/zysyr_save_daily_sheet_cells')query=`select public.zysyr_save_daily_sheet_cells('${A}','${C}','${S}','${D}',${q(JSON.stringify(p.p_cells))}::jsonb,${q(p.p_reason)},${p.p_expected_revision});`;
   else if(name==='rpc/zysyr_confirm_daily_sheet_reviewed')query=`select public.zysyr_confirm_daily_sheet_reviewed('${p.p_actor_user_id}','${p.p_actor_auth_user_id}','${C}','${S}','${D}',${q(JSON.stringify(p.p_report))}::jsonb,true,${q(p.p_reason)},${p.p_expected_revision},${q(p.p_cash_source_token)},'${p.p_cash_request_id}',${q(p.p_cash_statement)});`;
   else throw Error('unexpected privileged RPC '+name);
   return json(service+query);
  }};
 vm.createContext(context);const edge=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
 for(const [start,end] of [['async function saveDailySheetDraft(','\nasync function dailySheetCorrectionStatus('],['async function confirmDailySheetDraft(','\nasync function importCenter(']]){
  const a=edge.indexOf(start),b=edge.indexOf(end,a);vm.runInContext(stripTypeScriptTypes(edge.slice(a,b)),context);
 }
 // Reproduce the reported blank new-card receipt; the final user choice supplies zero
 // and adopting remaining nonempty recognition candidates on final confirmation.
 sql(`update zysyr_daily_sheet_cells set manual_override=false,source_method='codex_local_candidate' where row_label<>'';
 update zysyr_daily_sheet_cells set manual_override=true,corrected_numeric=null where column_code='card_subtotal';
 update zysyr_daily_sheet_drafts set ocr_raw_result=ocr_raw_result #- '{autofill,daily_total_policy}';
 update zysyr_daily_sheet_cells set ocr_numeric=null,corrected_numeric=null,manual_override=false where column_code='card_consumption';
 update zysyr_daily_sheet_cells set ocr_numeric=60,corrected_numeric=60 where column_code='alipay';
 insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric)
 values('${C}','${S}','${D}','payment','payment','Synthetic','wechat','wechat',40,18,'payment_method','codex_local_candidate',20,false,null),
 ('${C}','${S}','${D}','payment','payment','Synthetic','group_buy','group_buy',40,19,'payment_method','codex_local_candidate',20,false,null),
 ('${C}','${S}','${D}','summary','summary','Synthetic','membership_card','membership_card',30,20,'summary_value','blank_template',null,true,null);`);
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/synthetic-api'){
   let data='';for await(const chunk of req)data+=chunk;const {op,p}=JSON.parse(data);let out;
   if(op==='daily_sheet_read')out=read();else if(op==='daily_sheet_save')out=await context.saveDailySheetDraft(p,session);
   else if(op==='daily_sheet_confirm')out=await context.confirmDailySheetDraft(p,session);
   else if(op==='daily_sheet_month')out={days:[]};else if(op==='daily_recognition_job_read')out={job:null};else throw Error('unexpected '+op);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));return;
  }
  const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',f.endsWith('.html')?'text/html':'application/javascript');res.end(fs.readFileSync(f));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e.stderr||e.message)}));}});
 let browser;try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({...process.platform==='darwin'?{channel:'chrome'}:{},headless:true});const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin+'/operations.html?preview=1&role=finance');
  const initial=read();await page.evaluate(async s=>{
   await showView('daily-report');currentStore=()=> 'Synthetic store';isLocalPreview=()=>false;
   window.sequenceDialogs=[];window.confirm=text=>{sequenceDialogs.push(text);return true;};
   api=async(op,p)=>{const response=await fetch('/synthetic-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,p})});const out=await response.json();if(!response.ok)throw Error(out.error);return out;};
   state.imports.sheet=s;state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
  },initial);
  assert.equal(await page.locator('[data-section="summary"][data-column-code="card_subtotal"]').inputValue(),'');
  assert.match(await page.locator('#daily-detail-controls').innerText(),/空白待确认/);
  await page.locator('#daily-detail-confirm-top').click();
  try{await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed',{},{timeout:15000});}
  catch(e){console.error(await page.locator('#daily-detail-note').innerText());throw e;}
  assert.equal(await page.evaluate(()=>sequenceDialogs.length),1);assert.match(await page.evaluate(()=>sequenceDialogs[0]),/没有未知收款/);assert.match(await page.evaluate(()=>sequenceDialogs[0]),/本日没有充值/);
  assert.equal(calls.filter(x=>x.name==='rpc/zysyr_save_daily_sheet_cells').length,1);
  const posts=calls.filter(x=>x.name==='rpc/zysyr_confirm_daily_sheet_reviewed');assert.equal(posts.length,1);assert.equal(posts[0].p.p_expected_revision,1);
  assert.equal(posts[0].p.p_actor_user_id,A);assert.equal(posts[0].p.p_actor_auth_user_id,U);assert.equal(uploads.length,1);
  assert.equal(sql("select corrected_numeric from zysyr_daily_sheet_cells where column_code='card_subtotal'"),'0.00');
  assert.equal(sql("select corrected_numeric is null and manual_override from zysyr_daily_sheet_cells where column_code='membership_card'"),'t','ordinary manual blank retained through actual save and archive');
  assert.equal(sql("select count(*) from zysyr_private.daily_cash_reviews where edit_revision=1"),'1');
  assert.equal(sql("select ocr_raw_result#>>'{autofill,cash_receipts,cash_channels_complete}' from zysyr_daily_sheet_drafts"),'false');
  await page.locator('#daily-detail-confirm-top').click({force:true});assert.equal(calls.filter(x=>x.name==='rpc/zysyr_confirm_daily_sheet_reviewed').length,1,'confirmed page never repeats post');
  console.log('Actual page -> Edge save/read/archive -> transactional review/final confirmation -> PG17 ledger: one explicit dialog, revision increment, manual zero and unique source lineage passed.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
};
