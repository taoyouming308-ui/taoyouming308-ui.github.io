const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const html=fs.readFileSync('operations.html','utf8');
const source=html.slice(html.indexOf('  function dailyCellValue(cell)'),html.indexOf('  function renderDailyControls()'));
assert(source.includes('function dailyPaperSheet()'));
let browser;
(async()=>{
 browser=await chromium.launch({...process.platform==='darwin'?{channel:'chrome'}:{},headless:true});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',route=>route.abort());
  await page.setContent('<div id="grid"></div>');
  await page.evaluate(()=>{
   window.currentStore=()=> '向里造型';window.esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
   let n=0;const cell=(section,key,label,code,colLabel,role,value)=>({id:'synthetic-'+(++n),section_code:section,row_key:key,row_label:label,
    column_code:code,column_label:colLabel,cell_role:role,row_number:section==='technician'?15:3,column_number:2,
    ocr_numeric:value,manual_override:false,source_method:'frontdesk_autofill'});
   window.state={imports:{sheet:{draft:{template_code:'zysyr_frontdesk_project_draft',ocr_model:'frontdesk-autofill-v1',status:'draft',report_date:'2026-09-27'},cells:[
    cell('stylist','stylist_e11','合成发型师','perm','烫发','staff_value',100),
    cell('stylist','stylist_e11','合成发型师','subtotal','小计','staff_total',100),
    cell('technician','technician_e22','<img src=x onerror=alert(1)>','perm_count','烫（个）','technician_value',2),
    cell('technician','technician_e22','<img src=x onerror=alert(1)>','dye_count','染（个）','technician_value',null),
    cell('technician','technician_e22','<img src=x onerror=alert(1)>','care_count','护（个）','technician_value',1),
    cell('technician','technician_e22','<img src=x onerror=alert(1)>','subtotal','烫染护合计（个）','technician_total',3),
    cell('payment','payment','支付','alipay','支付宝','payment_method',100),
    cell('payment','payment','支付','bank_card','银行卡','payment_method',56)]}}};
  });
  await page.addScriptTag({content:source});await page.evaluate(()=>document.getElementById('grid').innerHTML=dailyPaperSheet());
  assert.equal(await page.locator('[data-section="technician"][data-column-code="perm_count"]').first().inputValue(),'2');
  assert.equal(await page.locator('[data-section="technician"][data-column-code="dye_count"]').first().inputValue(),'');
  assert.equal(await page.locator('[data-section="technician"][data-column-code="base_perm"]').count(),0);
  assert.equal(await page.locator('[data-column-code="grand_total"]').inputValue(),'');
  assert.equal(await page.locator('[data-paper-column="bank_card"]').innerText(),'银行卡');
  assert.equal(await page.locator('[data-column-code="bank_card"]').inputValue(),'56');
  assert.equal(await page.locator('[data-column-code="public_card"]').inputValue(),'');
  assert.equal(await page.evaluate(()=>calculateDailyControls(document).methodTotal),156);
  assert.equal(await page.locator('[data-paper-column="cash"]').evaluate(el=>Array.from(el.parentNode.cells).slice(0,el.cellIndex).reduce((n,c)=>n+c.colSpan,0)+1),9,'new bank column uses spare cell, all existing payment positions preserved');
  assert.equal(await page.locator('#grid img').count(),0,'employee names escaped');
  assert((await page.locator('[data-section="technician"][data-column-code="perm_count"]').first().getAttribute('title')).includes('收银明细'));
  await page.evaluate(()=>{const sheet=state.imports.sheet;sheet.draft.ocr_raw_result={autofill:{active_staff_row_keys:['stylist_e11','technician_e22']}};sheet.cells.push({...sheet.cells[0],id:'old-preserved-cell',row_key:'stylist_1',row_label:'旧占位行',ocr_numeric:null});document.getElementById('grid').innerHTML=dailyPaperSheet()});
  assert.equal(await page.locator('[data-row-label-input="stylist_1"]').count(),0,'archived old rows are not double-displayed');
  assert.equal(await page.locator('[data-column-code="perm"][data-section="stylist"]').first().inputValue(),'100');
  const spans=await page.locator('tr').evaluateAll(rows=>rows.map(row=>Array.from(row.cells).reduce((n,cell)=>n+cell.colSpan,0)));
  assert(spans.every(n=>n===25),'count layout preserves the 25-column January sheet: '+spans.join(','));
  await page.evaluate(()=>{const sheet=state.imports.sheet;sheet.cells[2].manual_override=true;sheet.cells[2].corrected_numeric=null;document.getElementById('grid').innerHTML=dailyPaperSheet()});
  assert.equal(await page.locator('[data-section="technician"][data-column-code="perm_count"]').first().inputValue(),'','explicit manual blank is not replaced with source');
  await page.evaluate(()=>{const sheet=state.imports.sheet;sheet.draft.ocr_model='frontdesk-autofill-v2';
    sheet.cells.push({...sheet.cells[0],id:'known-zero',column_code:'douyin',ocr_numeric:0},
      {...sheet.cells[0],id:'unknown-color',column_code:'color',ocr_numeric:null});
    document.getElementById('grid').innerHTML=dailyPaperSheet();});
  const zero=page.locator('[data-section="stylist"][data-row-key="stylist_e11"][data-column-code="douyin"]');
  assert.equal(await zero.inputValue(),'','known absence displays blank like January');
  assert.equal(await zero.getAttribute('data-known-zero'),'1');
  assert.equal(await page.locator('[data-section="stylist"][data-row-key="stylist_e11"][data-column-code="color"]').getAttribute('data-autofill-unknown'),'1');
  const controls=await page.evaluate(()=>calculateDailyControls(document));
  assert.deepEqual(controls.pendingRows,['stylist_e11']);assert.equal(controls.rowMismatch,0);
  assert.equal(controls.valid,false,'partial source cannot enable confirmation');
  await page.evaluate(()=>{state.imports.sheet.draft.template_code='zysyr_daily_performance_photo';state.imports.sheet.draft.status='confirmed';state.imports.sheet.cells=[];document.getElementById('grid').innerHTML=dailyPaperSheet()});
  assert((await page.locator('#grid').innerText()).includes('基础烫发'),'old confirmed template remains unchanged');
  assert(!(await page.locator('#grid').innerText()).includes('烫（个）'));
  assert.equal(await page.locator('[data-paper-column="bank_card"]').count(),0,'old confirmed sheets do not acquire a new bank column');
  await page.close();
 }
 console.log('Automatic draft browser: real paper rendering, count columns, blanks, manual overrides, escaping, 25-column layout and legacy compatibility passed');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});
