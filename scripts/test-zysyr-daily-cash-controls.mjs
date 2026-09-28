// Real paper controls and real review messages; fake inputs, no browser/network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dailyAutofillView} from '../supabase/functions/_shared/daily-autofill-view.mjs';
const html=fs.readFileSync('operations.html','utf8'),review=fs.readFileSync('operations-daily-review.js','utf8');
const calc=html.slice(html.indexOf('function calculateDailyControls('),html.indexOf('  function renderDailyControls()'));
const messages=review.slice(review.indexOf('  function controlDifferences('),review.indexOf('  function localBlockReason('));
let fields=[],draft={};
const context=vm.createContext({state:{imports:{sheet:{draft}}},Number,Array,Math,Object,String,
 dailyInputValue:input=>!input||input.value===''?null:Number(input.value)});
vm.runInContext(calc+messages,context);
function set(cash=true,{staff=979,actual=100,cashflow=100,card=879,sales=300,grand=400,payment=400,channelsComplete=true}={}){
 context.state.imports.sheet.draft.ocr_raw_result=cash?{autofill:{cash_receipts:{policy:'operating-external-cash-v1',state:'candidate',cash_channels_complete:channelsComplete}}}:{};
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
console.log('Actual UI checks: independent performance/cash controls, stored-value exclusion, new card-sales separation, old January compatibility and metadata allowlist passed');
