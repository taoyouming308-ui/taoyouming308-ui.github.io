// Actual page/actions with local synthetic API, all remote requests blocked.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':'application/javascript');res.end(b);});});
let browser;
async function setup(page,origin){
 await page.goto(origin+'/operations.html?preview=1&role=finance');
 await page.evaluate(async()=>{
  await showView('daily-report');const s=previewDailySheetData();
  s.draft={...s.draft,id:'synthetic-cash',report_date:'2026-10-09',edit_revision:0,ocr_raw_result:{autofill:{daily_total_policy:'cash-plus-earned-card-v1',cash_receipts:{policy:'operating-external-cash-v1',state:'candidate',cash_channels_complete:false}}},validation_result:{valid:false}};
  const specs=[
   ['stylist','stylist_1','wash_cut_blow','staff_value',100],['stylist','stylist_1','subtotal','staff_total',100],
   ['stylist','stylist_category_total','wash_cut_blow','category_total',100],['stylist','stylist_category_total','subtotal','summary_value',100],
   ['summary','summary','actual_total','summary_actual',100],['summary','summary','grand_total','summary_grand',100],
   ['summary','summary','card_subtotal','summary_value',null],['payment','payment','alipay','payment_method',100],
   ['payment','payment','cash_flow','payment_cashflow',100],['payment','payment','total','payment_total',100],
   ['payment','payment','card_consumption','payment_card_consumption',0]];
  s.cells=specs.map(([section,key,code,role,value],i)=>({id:'synthetic-'+i,section_code:section,row_key:key,row_label:'Synthetic',column_code:code,column_label:code,cell_role:role,row_number:section==='stylist'?3:30,column_number:i+1,ocr_numeric:value,manual_override:false,source_method:'meiguanjia_cash_autofill'}));
  s.permissions={write:true,upload_original:true};s.cash_review={status:'required',revision:0,source_token:'a'.repeat(64),original_ready:true};s.history=[];
  window.syntheticSheet=structuredClone(s);window.syntheticOps=[];window.syntheticRace=false;window.syntheticLost=false;
  api=async(op,p)=>{syntheticOps.push({op,p});
   if(op==='daily_recognition_job_read')return {job:null};
   if(op==='daily_sheet_read'){const copy=structuredClone(syntheticSheet);if(syntheticRace)copy.cash_review.source_token='b'.repeat(64);return copy;}
   if(op==='daily_sheet_save'){
    for(const change of p.cells){const c=syntheticSheet.cells.find(x=>x.id===change.id);if(c){if('value' in change){c.manual_override=true;c.corrected_numeric=change.value;}if('row_label' in change)c.row_label=change.row_label;}}
    syntheticSheet.draft.edit_revision++;syntheticSheet.cash_review.revision=syntheticSheet.draft.edit_revision;syntheticSheet.draft.validation_result={valid:calculateDailyControls(document.getElementById('daily-detail-grid')).numericValid};return structuredClone(syntheticSheet);
   }
   if(op==='daily_sheet_cash_review'){
    if(p.expected_revision!==syntheticSheet.draft.edit_revision||p.source_token!==syntheticSheet.cash_review.source_token)throw Error('synthetic stale');
    syntheticSheet.cash_review={...syntheticSheet.cash_review,status:'current',reason:p.reason};syntheticSheet.draft.validation_result={valid:true};
    if(syntheticLost)throw Error('synthetic lost response');return structuredClone(syntheticSheet);
   }
   if(op==='daily_sheet_confirm'){if(syntheticSheet.cash_review.electronic_ready||syntheticSheet.draft.ocr_raw_result.autofill.cash_receipts?.state==='candidate'){if(p.cash_source_confirmation?.statement!==(syntheticSheet.cash_review.electronic_ready?'electronic-channels-sales-v1':'cash-original-channels-sales-v1'))throw Error('explicit consent required');}else if(p.cash_source_confirmation||syntheticSheet.draft.validation_result.valid!==true)throw Error('legacy numeric validation required');syntheticSheet.cash_review.status='current';syntheticSheet.draft.status='confirmed';if(syntheticLost)throw Error('synthetic lost reply');return structuredClone(syntheticSheet);}
   if(op==='daily_sheet_month')return {days:[]};throw Error('Unexpected '+op);
  };
  window.assertSynthetic=()=>{if(syntheticSheet.cash_review.status!=='current')throw Error('synthetic proof required');};
  isLocalPreview=()=>false;window.syntheticCancel=false;window.syntheticDialogs=[];window.confirm=(text)=>{syntheticDialogs.push(text);return !syntheticCancel;};state.imports.sheet=structuredClone(s);state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
 });
}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...process.platform==='darwin'?{channel:'chrome'}:{},headless:true});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await setup(page,origin);
  assert.equal(await page.locator('#daily-cash-review-panel').count(),0);
  await page.evaluate(()=>syntheticCancel=true);
  await page.locator('#daily-detail-confirm-top').click();
  assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_save'||x.op==='daily_sheet_confirm')),false,'cancelled blank choice never writes');
  const sales=page.locator('[data-section="summary"][data-column-code="card_subtotal"]');await sales.fill('0');
  await page.evaluate(()=>syntheticCancel=true);await page.locator('#daily-detail-confirm-top').click();
  assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_save'||x.op==='daily_sheet_confirm')),false,'cancel writes nothing');
  await page.evaluate(()=>{syntheticCancel=false;syntheticDialogs=[];});
  await page.locator('#daily-detail-confirm-top').click();await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed');
  assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),1);
  assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_cash_review')),false,'no separate review step');
  assert.equal(await page.evaluate(()=>syntheticDialogs.length),1);
  assert.match(await page.evaluate(()=>syntheticDialogs[0]),/充值售卡实收/);
  assert.equal(await page.evaluate(()=>Number(syntheticSheet.cells.find(x=>x.column_code==='card_subtotal').corrected_numeric)),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 // Legacy source draft: balanced visible totals do not resolve two unknown project
 // cells. Typing a value resolves that cell immediately; no inferred zero or write.
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await setup(page,origin);
  await page.evaluate(()=>{
   syntheticSheet.draft.ocr_model='frontdesk-autofill-v2';
   syntheticSheet.draft.ocr_raw_result.autofill={cash_receipts:{policy:'operating-external-cash-v1',state:'unavailable'}};
   syntheticSheet.cells.filter(c=>c.section_code==='stylist').forEach(c=>c.source_method='frontdesk_autofill');
   for(const code of ['douyin','treatment'])syntheticSheet.cells.push({id:'unknown-'+code,section_code:'stylist',row_key:'stylist_1',row_label:'Synthetic',column_code:code,column_label:code,cell_role:'staff_value',row_number:3,column_number:3,ocr_numeric:null,manual_override:false,source_method:'frontdesk_autofill'});
   state.imports.sheet=structuredClone(syntheticSheet);renderDailySheetDetail();syntheticCancel=true;
  });
  const first=page.locator('[data-daily-cell="synthetic-0"]'),unknown=page.locator('[data-daily-cell="unknown-douyin"]'),second=page.locator('[data-daily-cell="unknown-treatment"]');
  assert.equal(await page.locator('#daily-detail-controls .pending').count()>0,true,'balanced unknown projects must not present all-green readiness');
  assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/Synthetic.*抖音.*护理/);
  await first.fill('101');
  assert.equal(await first.evaluate(el=>el.classList.contains('control-mismatch')),true,'wrong amount remains red even with unknown project cells in same row');
  assert.equal(await page.locator('[data-daily-cell="synthetic-1"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(253, 229, 223)','red validation visibly overrides the yellow candidate style');
  assert.equal(await page.locator('[data-daily-cell="synthetic-3"]').evaluate(el=>el.classList.contains('control-mismatch')),true,'the actual stylist subtotal cell is highlighted, not just a nonexistent virtual role');
  assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/差额.*1\.00/);
  await page.locator('#daily-detail-confirm-top').click();
  assert.equal(await page.evaluate(()=>syntheticDialogs.length),0,'wrong amount never reaches final consent');
  await first.fill('100');await unknown.fill('0');
  assert.equal(await unknown.evaluate(el=>el.classList.contains('control-pending')),false,'live explicit zero clears stale unknown marker');
  assert.equal(await second.evaluate(el=>el.classList.contains('control-pending')),true,'other unknown remains unresolved');
  await second.fill('0');
  assert.equal(await page.locator('#daily-detail-confirm-top').getAttribute('data-block-reason'),'');
  await page.locator('#daily-detail-confirm-top').click();
  assert.equal(await page.evaluate(()=>syntheticDialogs.length),1,'balanced explicitly reviewed projects reach final consent');
  assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_save'||x.op==='daily_sheet_confirm')),false,'cancelled consent never writes');
  await unknown.fill('');
  assert.equal(await unknown.evaluate(el=>el.classList.contains('control-pending')),true,'clearing the input restores unknown state');
  await unknown.fill('0');await first.fill('-1');
  assert.equal(await first.evaluate(el=>el.classList.contains('control-mismatch')),true,'negative input is immediately red');
  assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/非负/);
  await first.fill('100');
  const method=page.locator('[data-daily-cell="synthetic-7"]');await method.fill('99');
  assert.equal(await method.getAttribute('aria-invalid'),'true','wrong payment channel is visibly marked');
  assert.equal(await method.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(253, 229, 223)');
  assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/现金流.*差额.*1\.00/);
  await page.locator('[data-daily-cell="synthetic-8"]').fill('99');await page.locator('[data-daily-cell="synthetic-9"]').fill('99');
  assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/支付总计.*员工合计.*差额.*-1\.00/,'legacy payment-to-staff guard has an explicit reason');
  await method.fill('100');await page.locator('[data-daily-cell="synthetic-8"]').fill('100');await page.locator('[data-daily-cell="synthetic-9"]').fill('100');
  assert.equal(await page.locator('#daily-detail-controls .bad,#daily-detail-controls .pending').count(),0,'resolved legacy draft restores consistent cards');
  await page.evaluate(()=>{syntheticCancel=false;syntheticDialogs=[];});
  await page.locator('#daily-detail-confirm-top').click();await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed');
  assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),1,'legacy save/readback/final posting still works after explicit corrections');
  assert.equal(await page.evaluate(()=>Number(syntheticSheet.cells.find(x=>x.id==='unknown-douyin').corrected_numeric)),0);
  await page.close();
 }
 // New cash and earned-card policies must not inherit legacy staff=receipt
 // presentation. Different amounts can legitimately reconcile under each policy.
 for(const earned of [false,true]){
  const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await setup(page,origin);
  await page.evaluate(earned=>{
   const m=syntheticSheet.draft.ocr_raw_result.autofill;m.daily_total_policy=earned?'cash-plus-earned-card-v1':null;m.cash_receipts.cash_channels_complete=true;
   for(const c of syntheticSheet.cells){if(['alipay','cash_flow'].includes(c.column_code))c.ocr_numeric=80;if(c.column_code==='card_consumption')c.ocr_numeric=20;if(c.column_code==='card_subtotal')c.ocr_numeric=0;if(['actual_total','grand_total','total'].includes(c.column_code))c.ocr_numeric=earned?100:80;}
   state.imports.sheet=structuredClone(syntheticSheet);renderDailySheetDetail();
  },earned);
  assert.equal(await page.locator('#daily-detail-controls .bad,#daily-detail-controls .pending').count(),0,'cash policy cards agree with the numeric gate');
  assert.equal(await page.locator('#daily-detail-confirm-top').getAttribute('data-block-reason'),'');
  if(earned){await page.locator('[data-role="payment_card_consumption"]').fill('');assert.match(await page.locator('#daily-detail-confirm-help').innerText(),/卡金消费尚未核实/);}
  await page.close();
 }
 // Screenshot-shaped blank receipt: known three-channel totals, ordinary blanks,
 // no earned-card policy. Synthetic normalized amounts contain no business data.
 for(const width of [390,1280])for(const mode of ['blank-post','blank-cancel','blank-unknown','blank-mismatch','blank-no-source']){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await setup(page,origin);
  await page.evaluate(mode=>{
   syntheticSheet.draft.ocr_raw_result.autofill.daily_total_policy=null;
   syntheticSheet.cells.find(x=>x.column_code==='alipay').ocr_numeric=60;
   const add=(id,section,key,code,role,value)=>syntheticSheet.cells.push({id,section_code:section,row_key:key,row_label:'Synthetic',column_code:code,column_label:code,cell_role:role,row_number:30,column_number:15,ocr_numeric:value,manual_override:true,corrected_numeric:value,source_method:'blank_template'});
   add('synthetic-wechat','payment','payment','wechat','payment_method',20);
   add('synthetic-group','payment','payment','group_buy','payment_method',20);
   add('synthetic-blank','stylist','stylist_1','perm','staff_value',null);
   syntheticSheet.cells.find(x=>x.column_code==='card_consumption').ocr_numeric=null;
   if(mode==='blank-mismatch')syntheticSheet.cells.find(x=>x.cell_role==='payment_total').ocr_numeric=99;
   if(mode==='blank-no-source')syntheticSheet.cash_review.original_ready=false;
   state.imports.sheet=structuredClone(syntheticSheet);renderDailySheetDetail();
   if(mode==='blank-unknown'){
    document.querySelector('[data-daily-cell="synthetic-blank"]').dataset.autofillUnknown='1';renderDailyDetailControls();
   }
   syntheticCancel=mode==='blank-cancel';syntheticDialogs=[];
  },mode);
  assert.equal(await page.locator('[data-column-code="card_subtotal"][data-section="summary"]').inputValue(),'');
  assert.doesNotMatch(await page.locator('#daily-detail-controls').innerText(),/充值售卡实收|空白待确认/,'no redundant receipt status card; final consent still checks blank receipts');
  await page.locator('#daily-detail-confirm-top').click();
  if(mode==='blank-post'){
   await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed');
   assert.equal(await page.evaluate(()=>syntheticDialogs.length),1);
   assert.match(await page.evaluate(()=>syntheticDialogs[0]),/本日没有充值/);
   assert.equal(await page.evaluate(()=>Number(syntheticSheet.cells.find(x=>x.column_code==='card_subtotal').corrected_numeric)),0);
   assert.equal(await page.evaluate(()=>syntheticSheet.cells.find(x=>x.id==='synthetic-blank').corrected_numeric),null,'ordinary manual blank retained');
   assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),1);
  }else{
   assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_save'||x.op==='daily_sheet_confirm')),false);
   assert.equal(await page.locator('[data-column-code="card_subtotal"][data-section="summary"]').inputValue(),'','no inferred zero before explicit consent');
   assert.equal(await page.evaluate(()=>syntheticDialogs.length),mode==='blank-cancel'?1:0);
  }
  await page.close();
 }
 for(const width of [390,1280])for(const mode of ['ready','missing','cancel','lost','legacy-unavailable','legacy-stripped']){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await setup(page,origin);
  await page.evaluate(mode=>{
   syntheticSheet.draft.source_voucher_id=null;syntheticSheet.attachments=[];
   syntheticSheet.cash_review.original_ready=false;syntheticSheet.cash_review.electronic_ready=mode!=='missing';
   syntheticSheet.cash_review.electronic_reason='电子明细与来源清单尚未同步一致';
   syntheticCancel=mode==='cancel';syntheticLost=mode==='lost';
   if(mode.startsWith('legacy-')){
    syntheticSheet.draft.ocr_raw_result.autofill.cash_receipts=mode==='legacy-unavailable'?{policy:'operating-external-cash-v1',state:'unavailable'}:null;
    syntheticSheet.cells=syntheticSheet.cells.filter(c=>c.column_code!=='card_subtotal');
    syntheticSheet.cells.find(c=>c.column_code==='alipay').ocr_numeric=80;
    syntheticSheet.cells.find(c=>c.column_code==='cash_flow').ocr_numeric=80;
    syntheticSheet.cells.find(c=>c.column_code==='card_consumption').ocr_numeric=20;
    syntheticSheet.draft.validation_result={valid:true};
   }
   state.imports.sheet=structuredClone(syntheticSheet);renderDailySheetDetail();
  },mode);
  if(!mode.startsWith('legacy-'))await page.locator('[data-section="summary"][data-column-code="card_subtotal"]').fill('0');
  assert.equal(await page.locator('#daily-detail-confirm-top').evaluate(b=>b.classList.contains('blocked-action')),mode==='missing');
  await page.locator('#daily-detail-confirm-top').click();
  if(['ready','lost'].includes(mode)||mode.startsWith('legacy-')){
   try { await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed',{},{timeout:5000}); }
   catch(e){console.error({mode,width,note:await page.locator('#daily-detail-note').innerText(),ops:await page.evaluate(()=>syntheticOps.map(x=>x.op))});throw e;}
   assert.match(await page.evaluate(()=>syntheticDialogs[0]),/电子来源.*无需上传照片/);
   assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),1);
   if(mode.startsWith('legacy-')){
    assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_save')),false,'legacy evidence routing does not rewrite amounts');
    assert.equal(await page.evaluate(()=>syntheticSheet.cells.find(c=>c.column_code==='card_consumption').ocr_numeric),20);
   }
  }else assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_confirm'||x.op==='daily_sheet_save')),false);
  await page.close();
 }
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const mode of ['difference','race','lost']){
  await setup(page,origin);await page.locator('[data-section="summary"][data-column-code="card_subtotal"]').fill('0');
  if(mode==='difference')await page.locator('[data-role="payment_total"]').fill('99');
  await page.evaluate(mode=>{syntheticRace=mode==='race';syntheticLost=mode==='lost';},mode);
  await page.locator('#daily-detail-confirm-top').click();
  if(mode==='lost')await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed');
  else {await page.waitForFunction(()=>/请核对：|变化|更新/.test(document.getElementById('daily-detail-note').textContent));assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_cash_review')),false);}
  assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),mode==='lost'?1:0);
 }
 await page.close();console.log('Simple final confirmation browser: mobile/desktop explicit zero, one dialog/save/post, cancel no writes, unknown/difference/source races blocked, lost reply recovered once.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
