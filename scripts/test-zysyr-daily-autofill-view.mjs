// Actual API reader -> sanitized response -> actual paper renderer. Synthetic only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright';
import { dailyAutofillView } from '../supabase/functions/_shared/daily-autofill-view.mjs';
const store='8d057980-ff8f-4b2c-9c7f-4dd23a568f35',key='stylist_e21764911_b53304c1';
const auto={id:'source-money',section_code:'stylist',row_key:key,row_label:'郭小康',row_number:3,column_number:2,
 column_code:'perm',column_label:'烫发',cell_role:'staff_value',ocr_numeric:100,source_method:'frontdesk_autofill',manual_override:false};
const legacy={...auto,id:'old-blank',row_key:'stylist_7',row_label:'小康',source_method:'manual',ocr_numeric:null};
const cells=[auto,legacy,{...auto,id:'other-source',row_key:'stylist_e12_b53304c1',row_label:'同名合成员工'}];
let draft={id:'synthetic-draft',status:'draft',template_code:'zysyr_frontdesk_project_draft',ocr_model:'frontdesk-autofill-v2',report_date:'2026-09-27',
 autofill_view:{active_staff_row_keys:[key,'stylist_e12_b53304c1'],private_source:'must-not-leak'}};
const original=JSON.stringify({draft,cells});
const paths=[];
const ctx=vm.createContext({dailyAutofillView,Promise,Map,Set,JSON,Error,Array,String,Number,
 cleanText:(v,n)=>String(v??'').trim().slice(0,n),effectiveCellValue:c=>c.manual_override?c.corrected_numeric:c.ocr_numeric,
 restRows:async path=>{paths.push(path);return [{...draft}]},
 restRowsAll:async path=>{paths.push(path);return path.startsWith('zysyr_daily_sheet_cells?')?cells:[]},
 currentDailyValidations:async()=>({unavailable:false,byDraft:new Map([[draft.id,{valid:true}]])}),
 uuidIn:()=>'',VOUCHER_BUCKET:'synthetic',signedStorageUrl:async()=>{throw Error('no attachments expected')},
});
const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const start=api.indexOf('async function dailySheetData('),end=api.indexOf('async function createDailySheetDraft(',start);
assert(start>=0&&end>start);vm.runInContext(stripTypeScriptTypes(api.slice(start,end)),ctx);
const result=await ctx.dailySheetData('synthetic-company',store,draft.id);
assert(paths.every(p=>p.includes('company_id=eq.synthetic-company')&&(p.startsWith('zysyr_period_locks?')||p.includes('store_id=eq.'+store))));
assert(paths[0].includes('autofill_view:ocr_raw_result->autofill'),'real reader must select the renderer contract');
assert(!JSON.stringify(result).includes('must-not-leak'));
assert(!('autofill_view' in result.draft));
assert.deepEqual(JSON.parse(JSON.stringify(result.draft.ocr_raw_result)),{autofill:{active_staff_row_keys:[key,'stylist_e12_b53304c1']}});
assert.equal(result.cells[0].row_label,'小康');assert.equal(result.cells[0].ocr_numeric,100);
assert.equal(JSON.stringify({draft,cells}),original,'presentation does not mutate source objects');
const protectedCell={...auto,id:'00000000-0000-4000-8000-000000000001',manual_override:true,corrected_numeric:77};
const conflictView=dailyAutofillView({...draft,autofill_view:{...draft.autofill_view,manual_conflicts:[{cell_id:protectedCell.id,source_value:100,private_payload:'no-leak'}]}},[protectedCell],store);
assert.equal(conflictView.draft.ocr_raw_result.autofill.manual_conflicts[0].current,77);
assert.equal(conflictView.draft.ocr_raw_result.autofill.manual_conflicts[0].source,100);
assert(!JSON.stringify(conflictView).includes('no-leak'));
assert.equal(dailyAutofillView(draft,cells,'other-store').cells[0].row_label,'郭小康');
assert.equal(dailyAutofillView(draft,[{...auto,row_key:'stylist_e99_b53304c1'}],store).cells[0].row_label,'郭小康');
assert.equal(dailyAutofillView(draft,[{...auto,row_label:'财务自定姓名'}],store).cells[0].row_label,'财务自定姓名');
const sameName = dailyAutofillView(draft, cells.filter(c=>c.source_method==='frontdesk_autofill').map(c=>({...c,row_label:'合成同名员工'})),store);
assert.equal(sameName.draft.ocr_raw_result.autofill.active_staff_row_keys.length,2,'same name cannot merge different employee IDs');
assert.equal(sameName.cells.length,2);
assert.equal(dailyAutofillView({...draft,autofill_view:null},cells,store).draft.ocr_raw_result.autofill.active_staff_row_keys.length,2);
const confirmed=dailyAutofillView({...draft,status:'confirmed'},cells,store);
assert(!('ocr_raw_result' in confirmed.draft));assert.equal(confirmed.cells[0].row_label,'郭小康');
assert.deepEqual(confirmed.cells,cells,'posted names and amounts unchanged');
const issue={row_key:key,employee_name:'合成员工',project_name:'未知项目',project_code:'999',bill_id:'synthetic',amount:125.34,reason:'project_unmapped',private_payload:'never expose'};
const issueView=dailyAutofillView({...draft,autofill_view:{...draft.autofill_view,classification_issues:[issue,{...issue,row_key:'stylist_e99_b53304c1'},{...issue,amount:'125.34'},{...issue,reason:'private'}]}},cells,store);
assert.equal(issueView.draft.ocr_raw_result.autofill.classification_issues.length,1);
assert.equal(issueView.draft.ocr_raw_result.autofill.classification_issues[0].amount,125.34);
assert(!JSON.stringify(issueView).includes('never expose'));
assert(!JSON.stringify(dailyAutofillView({...draft,status:'confirmed',autofill_view:{classification_issues:[issue]}},cells,store)).includes('classification_issues'));
let browser;
try {
 browser=await chromium.launch({...process.platform==='darwin'?{channel:'chrome'}:{},headless:true});
 const html=fs.readFileSync('operations.html','utf8');
 const renderer=html.slice(html.indexOf('  function dailyCellValue(cell)'),html.indexOf('  function renderDailyControls()'));
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',r=>r.abort());
  await page.setContent('<div id="grid"></div>');
  await page.evaluate(sheet=>{window.currentStore=()=> '向里造型';window.esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.state={imports:{sheet}}},JSON.parse(JSON.stringify(result)));
  await page.addScriptTag({content:renderer});await page.evaluate(()=>document.getElementById('grid').innerHTML=dailyPaperSheet());
  assert.equal(await page.locator('[data-row-label-input="stylist_7"]').count(),0);
  assert.equal(await page.locator(`[data-row-label-input="${key}"]`).inputValue(),'小康');
  assert.equal(await page.locator('[data-section="stylist"][data-column-code="perm"][data-role="staff_value"]').count(),2,'different employee IDs never merged by name');
  assert.equal(await page.locator('[data-column-code="actual_total"]').inputValue(),'');
  assert.equal(await page.locator('[data-column-code="cash_flow"]').inputValue(),'','missing full-business total not guessed from performance');
  await page.close();
 }
} finally {if(browser)await browser.close()}
console.log('Actual daily reader -> paper: scoped metadata, archived-row hiding, exact verified nickname, unchanged amounts and confirmed rows passed');
