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
    syntheticSheet.draft.edit_revision++;syntheticSheet.cash_review.revision=syntheticSheet.draft.edit_revision;return structuredClone(syntheticSheet);
   }
   if(op==='daily_sheet_cash_review'){
    if(p.expected_revision!==syntheticSheet.draft.edit_revision||p.source_token!==syntheticSheet.cash_review.source_token)throw Error('synthetic stale');
    syntheticSheet.cash_review={...syntheticSheet.cash_review,status:'current',reason:p.reason};syntheticSheet.draft.validation_result={valid:true};
    if(syntheticLost)throw Error('synthetic lost response');return structuredClone(syntheticSheet);
   }
   if(op==='daily_sheet_confirm'){if(p.cash_source_confirmation?.statement!=='cash-original-channels-sales-v1')throw Error('explicit consent required');syntheticSheet.cash_review.status='current';syntheticSheet.draft.status='confirmed';if(syntheticLost)throw Error('synthetic lost reply');return structuredClone(syntheticSheet);}
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
  await page.locator('#daily-detail-confirm-top').click();
  assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_confirm')),false,'unknown cannot be posted');
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
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const mode of ['difference','race','lost']){
  await setup(page,origin);await page.locator('[data-section="summary"][data-column-code="card_subtotal"]').fill('0');
  if(mode==='difference')await page.locator('[data-role="payment_total"]').fill('99');
  await page.evaluate(mode=>{syntheticRace=mode==='race';syntheticLost=mode==='lost';},mode);
  await page.locator('#daily-detail-confirm-top').click();
  if(mode==='lost')await page.waitForFunction(()=>state.imports.sheet.draft.status==='confirmed');
  else {await page.waitForFunction(()=>document.getElementById('daily-detail-note').textContent.includes('请核对：')||document.getElementById('daily-detail-note').textContent.includes('变化'));assert.equal(await page.evaluate(()=>syntheticOps.some(x=>x.op==='daily_sheet_cash_review')),false);}
  assert.equal(await page.evaluate(()=>syntheticOps.filter(x=>x.op==='daily_sheet_confirm').length),mode==='lost'?1:0);
 }
 await page.close();console.log('Simple final confirmation browser: mobile/desktop explicit zero, one dialog/save/post, cancel no writes, unknown/difference/source races blocked, lost reply recovered once.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
