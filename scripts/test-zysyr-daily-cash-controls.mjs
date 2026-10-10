// Real paper controls and real review messages; fake inputs, no browser/network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dailyAutofillView} from '../supabase/functions/_shared/daily-autofill-view.mjs';
const html=fs.readFileSync('operations.html','utf8'),review=fs.readFileSync('operations-daily-review.js','utf8');
const calc=html.slice(html.indexOf('function dailyCashReviewCurrent('),html.indexOf('  function renderDailyControls()'));
const messages=review.slice(review.indexOf('  function controlDifferences('),review.indexOf('  function localBlockReason('));
let fields=[],draft={};
const context=vm.createContext({state:{imports:{sheet:{draft}}},Number,Array,Math,Object,String,
 dailyInputValue:input=>!input||input.value===''?null:Number(input.value)});
vm.runInContext(calc+messages,context);
function set(cash=true,{staff=979,actual=100,cashflow=100,card=879,sales=300,grand=400,payment=400,channelsComplete=true,earned=false}={}){
 context.state.imports.sheet.draft.ocr_raw_result=cash?{autofill:{cash_receipts:{policy:'operating-external-cash-v1',state:'candidate',cash_channels_complete:channelsComplete}}}:{};
 if(earned)context.state.imports.sheet.draft.ocr_raw_result.autofill.daily_total_policy='cash-plus-earned-card-v1';
 fields=[
  ['stylist','stylist_1','perm','staff_value',staff],['stylist','stylist_1','subtotal','staff_total',staff],
  ['stylist','stylist_category_total','perm','category_total',staff],['stylist','stylist_category_total','subtotal','summary_value',staff],
  ['summary','summary','actual_total','summary_actual',actual],['summary','summary','grand_total','summary_grand',grand],['summary','summary','card_subtotal','summary_value',sales],
  ['payment','payment','alipay','payment_method',cashflow],['payment','payment','cash_flow','payment_cashflow',cashflow],
  ['payment','payment','card_consumption','payment_card_consumption',card],['payment','payment','total','payment_total',payment]
 ].map(([section,rowKey,columnCode,role,value])=>({value:value===null?'':String(value),dataset:{section,rowKey,columnCode,role}}));
 return context.calculateDailyControls({querySelectorAll:()=>fields});
}
assert.equal(set().valid,true,'979 performance and 879 stored-value consumption must not contaminate 100 operating receipts');
assert.equal(context.controlDifferences(set()).length,0);
assert.equal(set(false,{staff:979,actual:979,grand:979,payment:979}).valid,true,'January old model remains unchanged');
assert.equal(set(true,{actual:979}).valid,false);
assert.equal(set(true,{grand:1279,payment:1279}).valid,false);
assert.equal(set(true,{sales:null}).valid,false,'unknown card-sale receipts are not assumed zero');
assert.equal(set(true,{channelsComplete:false}).valid,false);
assert.equal(set(true,{staff:1000}).valid,true,'independent employee control, not a cash receipt estimate');
const differences=context.controlDifferences(set(true,{actual:979}));
assert(differences.some(d=>d.role==='summary_actual'&&d.message.includes('项目及零售实际收款')));
const cash={policy:'operating-external-cash-v1',state:'candidate',cash_channels_complete:true,
 operating_snapshot_id:'00000000-0000-0000-0000-000000000001',all_snapshot_id:'00000000-0000-0000-0000-000000000002',card_sales_snapshot_id:'00000000-0000-0000-0000-000000000003',card_sales_sha256:'c'.repeat(64),operating_sha256:'a'.repeat(64),all_sha256:'b'.repeat(64),private_source:'secret'};
for(const status of['draft','confirmed']){
 const projected=dailyAutofillView({status,template_code:'zysyr_frontdesk_project_draft',autofill_view:{cash_receipts:cash}},[],'synthetic-store');
 assert.equal(projected.draft.ocr_raw_result.autofill.cash_receipts.policy,cash.policy);
 assert(!JSON.stringify(projected).includes('secret'));assert(!JSON.stringify(projected).includes('a'.repeat(64)));
}
assert(!dailyAutofillView({status:'draft',template_code:'zysyr_frontdesk_project_draft',autofill_view:{cash_receipts:{...cash,cash_channels_complete:'true'}}},[],'x').draft.ocr_raw_result.autofill.cash_receipts);
const earnedExample={earned:true,staff:3762.24,actual:3762.24,cashflow:2934,card:828.24,sales:0,grand:3762.24,payment:3762.24};
assert.equal(set(true,earnedExample).valid,true);
assert.equal(context.controlDifferences(set(true,earnedExample)).length,0);
assert.equal(set(true,{...earnedExample,actual:2934,grand:2934,payment:2934}).valid,false);
assert.equal(set(true,{...earnedExample,card:null}).valid,false);
assert.equal(set(true,{...earnedExample,sales:300,grand:4062.24,payment:4062.24}).valid,true);
for(const status of ['draft','confirmed']){
 const view=dailyAutofillView({status,template_code:'zysyr_frontdesk_project_draft',autofill_view:{cash_receipts:cash,daily_total_policy:'cash-plus-earned-card-v1'}},[],'x');
 assert.equal(view.draft.ocr_raw_result.autofill.daily_total_policy,'cash-plus-earned-card-v1');
}
console.log('Actual UI checks: independent performance/cash controls, stored-value exclusion, new card-sales separation, old January compatibility and metadata allowlist passed');

// Regression: unknown sales are a missing source, not a numeric discrepancy.
const missingSales = set(true,{staff:28839,actual:28839,cashflow:28839,sales:null,grand:28839,payment:28839,card:2180});
assert.equal(missingSales.valid,false);
const missingMessage=context.controlDifferences(missingSales).find(d=>d.role==='summary_grand');
assert.equal(missingMessage.kind,'unknown');
assert.equal(missingMessage.columnCode,'card_subtotal');
assert.match(missingMessage.message,/充值售卡实收未核实/);
assert.match(missingMessage.message,/不能凭总计相等推定为0/);
const realMismatch=context.controlDifferences(set(true,{sales:300,grand:100,payment:100})).find(d=>d.role==='summary_grand');
assert.equal(realMismatch.kind,'mismatch');
assert.match(realMismatch.message,/汇总总计/);
assert.equal(set(true,{sales:0,grand:100,payment:100}).valid,true);
assert.equal(set(true,{sales:0,grand:100,payment:100,channelsComplete:false}).valid,false,'known sales zero does not bypass other source gaps');
// Render the real paper cell: explicit source/manual zero is visible and reviewable.
context.esc=v=>String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
vm.runInContext(['dailyCellValue','dailyInputValue','dailyPaperTextRole','dailyAmountDisplay','dailyPaperInput'].map(name=>html.split('\n').find(line=>new RegExp('^\\s*function '+name+'\\(').test(line))).join('\n'),context);
context.state.imports.sheet.draft.ocr_model='frontdesk-autofill-v2';
const salesMeta={section:'summary',rowKey:'summary',rowLabel:'汇总',columnCode:'card_subtotal',columnLabel:'卡类小计',rowNumber:30,columnNumber:9,role:'summary_value'};
function render(cell,meta=salesMeta){const before=JSON.stringify(cell);const out=context.dailyPaperInput(cell,meta);assert.equal(JSON.stringify(cell),before,'render never changes source/manual/confirmed values');return out;}
const sourceZero={id:'synthetic-zero',source_method:'frontdesk_autofill',manual_override:false,ocr_numeric:0};
const renderedZero=render(sourceZero);assert.match(renderedZero,/value="0"/);assert.match(renderedZero,/充值售卡实收为0/);assert.match(renderedZero,/recognition-candidate/);
assert.equal(context.dailyInputValue({value:'0',dataset:{knownZero:'1'}}),0);
for(const cell of [null,{...sourceZero,ocr_numeric:null},{...sourceZero,ocr_numeric:NaN},{...sourceZero,ocr_numeric:99,manual_override:true,corrected_numeric:null}]){
 const out=render(cell);assert.match(out,/value=""/);assert.match(out,/充值售卡实收未核实/);assert.doesNotMatch(out,/data-known-zero/);
}
assert.match(render({...sourceZero,ocr_numeric:99,manual_override:true,corrected_numeric:0}),/value="0"/);
assert.match(render({...sourceZero,ocr_numeric:0,manual_override:true,corrected_numeric:77}),/value="77"/);
context.state.imports.sheet.draft.status='confirmed';assert.match(render({...sourceZero,manual_override:true,corrected_numeric:77}),/value="77"/);
const cardOut=render(sourceZero,{...salesMeta,section:'payment',columnCode:'card_consumption',role:'payment_card_consumption'});
assert.doesNotMatch(cardOut,/充值售卡实收/);assert.match(cardOut,/value=""/,'existing card-consumption rendering remains unchanged');
console.log('Missing-sales regression: visible/reviewable explicit zero; unknown versus mismatch; manual blank/value and confirmed protection; card consumption separate; posting/source gates unchanged');

vm.runInContext(review.slice(review.indexOf('  function pendingCandidates('),review.indexOf('  function notice(')),context);
context.grid=()=>({querySelectorAll:()=>[{value:'0',classList:{contains:()=>false}}]});
assert.equal(context.pendingCandidates().length,1,'visible source zero remains an explicit review candidate rather than skipped blank');

vm.runInContext(review.slice(review.indexOf('  function localBlockReason('),review.indexOf('  var renderControlsBase')),context);
context.state.user={role:'finance'};context.state.imports.sheet.permissions={write:true};
context.state.imports.sheet.draft.status='draft';context.state.imports.sheet.draft.source_voucher_id='synthetic-reviewed-original';
context.grid=()=>({querySelectorAll:()=>fields});
set(true,{sales:0,grand:100,payment:100,channelsComplete:false});
assert.match(context.localBlockReason(),/收款来源仍待人工核实/);
set(true,{sales:null,grand:100,payment:100});
assert.match(context.localBlockReason(),/充值售卡实收未核实/);
set(true,{sales:300,grand:100,payment:100});
assert.match(context.localBlockReason(),/汇总总计为/);
assert.doesNotMatch(context.localBlockReason(),/未核实字段/);
