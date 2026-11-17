import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { voucherCents, combinationTotal, recommendVoucherCombinations } from '../voucher-combination-core.js';
import { expenseCombinationPlan } from '../supabase/functions/_shared/expense-voucher-combinations.mjs';
import { expenseMatchPlan } from '../supabase/functions/_shared/expense-voucher-workspace.mjs';
import { monthlyCellVoucherLibrary } from '../supabase/functions/_shared/monthly-cell-voucher-library.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const target={id:id(1),target_kind:'source_petty',amount:170.30,summary:'纸巾',transaction_date:'2026-08-05',period_month:'2026-08',aggregate:false};
const item=(n,amount,date='2026-08-05')=>({id:id(n),source_voucher_id:id(n),component_index:0,original_filename:'synthetic-'+n+'.png',latest_ocr_task:{id:id(n+100)},candidate_fields:{amount,document_date:date,summary:'纸巾',document_kind:'receipt',evidence_kind:'transaction'}});
const receipts=[item(2,80),item(3,90.30),item(4,50),item(5,60),item(6,60.30),item(7,170.30),item(8,null),item(9,0),item(10,90.30,'2026-07-05')];
let result=recommendVoucherCombinations(receipts,target,'2026-08');
assert(result.groups.some(g=>g.items.length===2&&g.items.some(i=>i.id===id(2))&&g.items.some(i=>i.id===id(3))));
assert(result.groups.some(g=>g.items.length===3));assert(result.groups.every(g=>combinationTotal(g.items)===17030));
assert(result.groups.every(g=>!g.items.some(i=>[id(8),id(9),id(10)].includes(i.id))));
assert.equal(combinationTotal([item(2,.1),item(3,.2)]),30,'exact cents, not float equality');
assert.equal(combinationTotal([item(2,80),item(2,90.30)]),null,'one original cannot be counted twice');
for(const value of [null,'',true,0,-1,Infinity,'NaN',.001])assert.equal(voucherCents(value),null);
assert.equal(combinationTotal([{...item(2,80),recognized_amounts:[80],corrected_fields:{amount:''}},item(3,90.3)]),null,'cleared human amount stays unknown');
const corrected={...item(2,999),corrected_fields:{amount:80}};assert(recommendVoucherCombinations([corrected,item(3,90.30)],target,'2026-08').groups.length);
const elsewhere={...item(2,80),confirmed_target_kind:'source_petty',confirmed_target_id:id(99)};assert.equal(recommendVoucherCombinations([elsewhere,item(3,90.30)],target,'2026-08').groups.length,0);
const summary={...item(2,80),candidate_fields:{amount:80,evidence_kind:'monthly_summary'}};assert.equal(recommendVoucherCombinations([summary,item(3,90.3)],target,'2026-08').groups.length,0);
assert.equal(recommendVoucherCombinations(Array.from({length:100},(_,i)=>item(i+200,1)),{...target,amount:20},'2026-08').limited,true);
const workspace={month:'2026-08',targets:[target],items:receipts};
const request=i=>({voucher_id:i.id,component_index:0,task_id:i.latest_ocr_task.id,target_kind:target.target_kind,target_id:target.id,corrected_fields:{...i.candidate_fields},reason:'Synthetic explicit group confirmation'});
const requests=receipts.slice(0,2).map(request);
assert.equal(expenseCombinationPlan(workspace,requests).plan.length,2);
for(const mutate of [r=>r.slice(0,1),r=>[r[0],r[0]],r=>r.map((x,i)=>i?{...x,corrected_fields:{...x.corrected_fields,amount:90.31}}:x),r=>r.map((x,i)=>i?{...x,target_id:id(99)}:x),r=>r.map((x,i)=>i?{...x,task_id:id(999)}:x),r=>r.map((x,i)=>i?{...x,corrected_fields:{...x.corrected_fields,document_date:'2026-09-05'}}:x)])assert.throws(()=>expenseCombinationPlan(workspace,mutate(requests)));
const linked={...receipts[0],confirmed_target_kind:target.target_kind,confirmed_target_id:target.id,expense_association:{source_task_id:id(102)},corrected_fields:{...receipts[0].candidate_fields}};
assert.equal(expenseCombinationPlan({...workspace,items:[linked,receipts[1]]},requests).plan.length,2);
const allLinked=[linked,{...receipts[1],confirmed_target_kind:target.target_kind,confirmed_target_id:target.id,expense_association:{source_task_id:id(103)},corrected_fields:{...receipts[1].candidate_fields}}];
assert.equal(expenseCombinationPlan({...workspace,items:allLinked},requests).plan.length,2,'safe complete repeat');
assert.throws(()=>expenseCombinationPlan({...workspace,items:[elsewhere,receipts[1]]},requests),/其他开支/);
assert.throws(()=>expenseCombinationPlan({...workspace,items:[summary,receipts[1]]},requests),/汇总/);
const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8'),a=api.indexOf('async function applyExpenseVoucherMatches('),b=api.indexOf('async function recoverExpenseVoucherFailures(',a),calls=[];
const methods=new Function('expenseVoucherWorkspace','expenseCombinationPlan','expenseMatchPlan','selectedStoreInfo','financeRpcSaved','cleanText',stripTypeScriptTypes(api.slice(a,b))+';return applyExpenseVoucherMatches;')(
 async()=>workspace,expenseCombinationPlan,expenseMatchPlan,async()=>({company_id:id(20),id:id(21)}),async(route,body)=>{calls.push({route,body});return {inserted:2};},(v,n)=>String(v||'').slice(0,n));
const payload={month:'2026-08',mode:'manual',combination:true,confirmed:true,items:requests};
assert.equal((await methods(payload,{auth_account_id:id(22)})).combination_saved,true);assert.equal(calls[0].route,'rpc/zysyr_save_expense_voucher_combination');assert.equal(calls[0].body.p_actor,id(22));
await assert.rejects(methods({...payload,mode:'auto'},{}),/逐张核对/);await assert.rejects(methods({...payload,confirmed:false},{}),/逐张核对/);assert.equal(calls.length,1);
function monthly(options={}){
 const writes=[],scope='company_id=eq.'+id(20)+'&store_id=eq.'+id(21);
 const deps={canUpload:()=>true,canRead:()=>true,store:async()=>({company_id:id(20),id:id(21)}),category:()=> 'expense',
 rows:async q=>{assert(q.includes(scope));if(q.startsWith('zysyr_report_uploads?'))return [{id:id(30)}];if(q.startsWith('zysyr_report_cells?'))return [{id:id(31)}];return [];},
 all:async q=>{assert(q.includes(scope));return options.summary&&q.startsWith('zysyr_voucher_ocr_tasks?')?[{voucher_id:id(2),candidate_fields:{evidence_kind:'monthly_summary'}}]:[];},
 effective:async()=>({cells:[{id:id(31),numeric_value:options.changed?180:170.3}],versions:{},adjustments:[]}),save:async(route,body)=>{writes.push({route,body});return {inserted:2};}};
 const p={report_id:id(30),cell_id:id(31),month:'2026-08',action:'attach_combination',confirmed:true,items:[{voucher_id:id(2),amount:80},{voucher_id:id(3),amount:90.3}]};
 return {writes,run:patch=>monthlyCellVoucherLibrary({...p,...patch},{auth_account_id:id(22)},deps)};
}
const monthlyGood=monthly();assert.equal((await monthlyGood.run({})).combination_saved,true);assert.equal(monthlyGood.writes[0].route,'rpc/zysyr_attach_monthly_voucher_combination');assert.equal(monthlyGood.writes[0].body.p_expected_amount,170.3);assert.deepEqual(monthlyGood.writes[0].body.p_expected_adjustments,[]);
await assert.rejects(monthly({changed:true}).run({}),/合计必须/);await assert.rejects(monthly({summary:true}).run({}),/月度汇总/);await assert.rejects(monthly().run({confirmed:false}),/逐张核对/);
await assert.rejects(monthly().run({items:[{voucher_id:id(2),amount:80},{voucher_id:id(2),amount:90.3}]}),/重复计入/);
console.log('Voucher combinations: 170.30 pair/triple, exact cents, corrected/unknown/cross-month/duplicate/claimed guards, bounded search, explicit fresh-target API batch, existing links/retry and monthly evidence-only snapshot checks passed. Synthetic only.');
