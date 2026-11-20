import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readMonthlyVoucherTargets } from '../supabase/functions/_shared/monthly-voucher-targets.mjs';
import { expenseSourceTargets, matchExpenseComponent } from '../supabase/functions/_shared/expense-voucher-matching.mjs';
import { buildExpenseVoucherWorkspace, expenseMatchPlan } from '../supabase/functions/_shared/expense-voucher-workspace.mjs';
import { expenseCombinationPlan } from '../supabase/functions/_shared/expense-voucher-combinations.mjs';

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const month = '2026-07';
const target = { id: id(1) + '~' + id(2), target_kind: 'monthly_cell', report_id: id(1), cell_id: id(2),
  source_locator: 'C10', summary: '房租', category: '房租', amount: 1200.25, period_month: month,
  aggregate: true, manual_only: true, can_attach: true, disabled: false, linked_vouchers: [id(3)] };
const empty = { ...target, id: id(1) + '~' + id(4), cell_id: id(4), source_locator: 'C11', summary: '物业费',
  category: '物业费', amount: null, can_attach: false, disabled: true, disabled_reason: '金额尚未填写', linked_vouchers: [] };
const source = { status: 'missing', monthly_status: 'missing', month,
  electronic_report: { status: 'ready', id: id(1), cells: [{ id: id(2), cell_address: 'C10', label: '房租 / 房租', amount: 1200.25, revision: 0 }],
    targets: [target, empty], message: '已读取当前月报，栏目关联需人工核对' } };
const candidate = { document_date: '2026-07-05', amount: 1200.25, expense_category: '房租', document_kind: 'receipt',
  evidence: { document_date: '2026-07-05', amount: '1200.25', expense_category: '房租' },
  confidence: { document_date: 1, amount: 1, expense_category: 1 } };
const parent = { id: id(3), task_status: 'succeeded', audit_status: 'pending', candidate_fields: candidate,
  latest_ocr_task: { id: id(5) } };
const petty = { id: id(6), target_kind: 'draft', transaction_date: '2026-07-02', summary: '纸巾', category: '日用消耗品', amount: 12 };
const base = { month, items: [parent], targets: [petty], summary: { total: 1 } };

const targets = expenseSourceTargets(source, base.targets);
assert.equal(targets.length, 3, 'missing original selection must not hide an uploaded report');
assert.equal(targets.find(t => t.cell_id === id(4)).amount, null, 'unknown is not zero');
assert.equal(targets.find(t => t.id === id(6)).aggregate, false, 'keep transaction rows separate');
assert.equal(matchExpenseComponent(candidate, targets, month).auto_eligible, false);
assert.equal(matchExpenseComponent(candidate, targets, month).unique_exact, false);
assert.equal(matchExpenseComponent({ ...candidate, evidence_kind: 'monthly_summary', period_month: month }, targets, month).auto_eligible, false);
assert.equal(matchExpenseComponent({ ...candidate, amount: 0, expense_category: '物业费' }, targets, month).candidates.some(c => c.target_id === empty.id), false);
assert.equal(expenseSourceTargets({ ...source, month: '2026-08' }, []).length, 0, 'never leak a projection from another month');

let workspace = buildExpenseVoucherWorkspace(base, source);
assert.equal(workspace.targets.length, 3);
assert.equal(workspace.monthly_targets_status, 'ready');
assert.equal(workspace.summary.monthly_evidence, 1);
assert.equal(workspace.summary.confirmed, 0);
assert.equal(workspace.items[0].confirmed_target_id, null);
assert.equal(workspace.items[0].expense_association, null);
assert.equal(workspace.items[0].monthly_cell_evidence[0].target_id, target.id);
assert.equal(workspace.items[0].candidate_fields.amount, 1200.25);
const request = { voucher_id: id(3), component_index: 0, task_id: id(5), target_kind: 'monthly_cell',
  target_id: target.id, corrected_fields: candidate };
for (const mode of ['auto', 'manual']) assert.throws(() => expenseMatchPlan(workspace, [request], mode), /人工补充佐证/);
assert.throws(() => expenseCombinationPlan(workspace, [request, { ...request, voucher_id: id(7) }]), /月报栏目佐证/);

const splitBase = { ...base, items: [{ ...parent, candidate_fields: { document_kind: 'multiple_transactions', transactions: [candidate, { ...candidate, amount: 15 }] } }] };
workspace = buildExpenseVoucherWorkspace(splitBase, source);
assert.equal(workspace.items.length, 2);
assert.equal(workspace.summary.monthly_evidence, 1, 'one original, not two component evidence counts');
assert.equal(workspace.summary.confirmed, 0, 'original evidence does not confirm either payment');
assert(workspace.items.every(item => item.monthly_cell_evidence.length === 1 && !item.confirmed_target_id));

const original = { ...source, status: 'ready', monthly_status: 'ready', source: { selection_id: id(8) },
  monthly: { expense_rows: [{ cells: [{ column: 2, value: '房租' }, { column: 3, address: 'C10', value: 1200.25 }] }] } };
const merged = expenseSourceTargets(original, base.targets);
assert.equal(merged.filter(t => t.source_locator === 'C10').length, 1, 'avoid duplicating a mapped monthly source target');
assert.equal(merged.find(t => t.source_locator === 'C10').target_kind, 'monthly_source');
assert.equal(merged.find(t => t.source_locator === 'C10').id, id(8) + '~C10', 'stable historical source identity');
const oldLink = { id: id(9), voucher_id: id(3), component_index: 0, status: 'active', mode: 'manual',
  target_kind: 'monthly_source', target_id: id(8) + '~C10', corrected_fields: { ...candidate, amount: 1199.25 } };
workspace = buildExpenseVoucherWorkspace(base, original, [oldLink]);
assert.equal(workspace.items[0].confirmed_target_id, oldLink.target_id);
assert.equal(workspace.items[0].corrected_fields.amount, 1199.25, 'never rewrite historical human-reviewed amount');
assert.equal(workspace.items[0].monthly_cell_evidence.length, 1, 'evidence survives display deduplication');
const oldPetty = buildExpenseVoucherWorkspace({ ...base, items: [{ ...parent, confirmed_target_id: id(6), confirmed_target_kind: 'draft' }] }, source);
assert.equal(oldPetty.items[0].confirmed_target_id, id(6));
assert.equal(oldPetty.items[0].monthly_cell_evidence.length, 1);

for (const status of ['partial', 'unavailable', 'missing']) {
  const data = buildExpenseVoucherWorkspace(base, { ...source, electronic_report: { status, message: '请刷新核验', targets: [] } });
  assert.equal(data.monthly_targets_status, status);
  assert.equal(data.monthly_targets_message, '请刷新核验');
  assert.equal(data.targets.length, 1, 'keep existing transaction targets when monthly projection is unavailable');
}
console.log('Monthly target workspace: missing source selection, manual-only guards, scoped candidates, blank values, source dedup, whole-original evidence and historical links passed.');

// Execute the actual monthly-page projection and the API's new adapter, not a
// second formula implementation. No external I/O or business records are used.
const apiSource = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const names = ['cleanText','columnLetters','reportCellLabel','monthlyEditableNameCells','safeFormulaValue',
  'monthlyAdjustmentForSource','monthlyItemCategory','latestMonthlyCellRevisionMap','effectiveMonthlyDisplay','isDailyIncomeCell'];
const snippets = names.map(name => {
  const start = apiSource.indexOf('function ' + name + '(');
  assert(start >= 0);
  return apiSource.slice(start, apiSource.indexOf('\n}', start) + 2);
});
const adapterStart = apiSource.indexOf('async function projectVoucherMonthlyDisplay(');
snippets.push(apiSource.slice(adapterStart, apiSource.indexOf('\n}', adapterStart) + 2));
const store = { company_id: id(50), id: id(51) };
const values = Array.from({length:73}, () => Array(12).fill(''));
values[8].splice(0,3,'支出','支出类别','Nov.');
values[9].splice(0,3,'产品成本','产品进货','200');
values[10].splice(0,3,'','杂项','');
values[51][1] = '合计';
values[30][3] = '产品进货'; values[30][4] = '品牌旧'; values[30][6] = '100';
values[31][4] = '品牌乙'; values[31][6] = '100';
const report = {id:id(52),...{company_id:store.company_id,store_id:store.id},report_type:'monthly_profit_loss',report_date:month+'-01',status:'active',sha256:'a'.repeat(64),version:1,
  display_data:{values,rows:73,columns:12,merges:[{start_row:30,end_row:41,start_col:3,end_col:3}]}};
const cell = (n,address,row,column,value,label,formula=null,precedents=[]) => ({id:id(n),company_id:store.company_id,store_id:store.id,report_id:report.id,
  cell_address:address,row_number:row,column_number:column,numeric_value:value,display_value:String(value),label,cell_kind:formula?'formula':'input',formula,precedent_addresses:precedents});
const cells = [cell(53,'C10',10,3,200,'产品成本 / 产品进货','SUM(G31:G32)',['G31','G32']),
  {...cell(54,'C11',11,3,0,'杂项'),display_value:''},cell(55,'G31',31,7,100,'产品进货 / 品牌旧'),cell(56,'G32',32,7,100,'产品进货 / 品牌乙')];
const revisions = [{id:id(57),source_cell_id:id(55),revision:1,revision_type:'amount_change',after_amount:200}];
let adjustmentReads=0,dailyReads=0,textReads=0;
const sandbox = {
  monthlyIncomeAdjustments:async(company,shop,period)=>{assert.equal(company,store.company_id);assert.equal(shop,store.id);assert.equal(period,month);adjustmentReads++;return [];},
  confirmedDailyRollup:async(company,shop,period)=>{assert.equal(company,store.company_id);assert.equal(shop,store.id);assert.equal(period,month);dailyReads++;return null;},
  restRowsAll:async path=>{assert(path.startsWith('zysyr_monthly_text_revisions?'));assert(path.includes('report_id=eq.'+report.id));assert(path.includes('store_id=eq.'+store.id));textReads++;return [{cell_address:'E31',revision:1,after_text:'品牌新'}];},
};
vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(snippets.join('\n')),sandbox);
const projected = await readMonthlyVoucherTargets(store,month,{
  category:sandbox.monthlyItemCategory,project:sandbox.projectVoucherMonthlyDisplay,
  rows:async()=>structuredClone([report]),all:async path=>path.startsWith('zysyr_report_cells?')?structuredClone(cells):path.startsWith('zysyr_monthly_cell_revisions?')?structuredClone(revisions):[],
});
assert.equal(projected.status,'ready');
assert.equal(projected.targets.find(t=>t.source_locator==='C10').amount,300,'same formula amount as the current monthly page');
assert.equal(projected.targets.find(t=>t.source_locator==='C11').amount,null,'shared display does not convert an unknown blank to zero');
assert.match(projected.targets.find(t=>t.source_locator==='G31').summary,/品牌新/,'current effective name follows text revision');
assert.equal(adjustmentReads,1);assert.equal(dailyReads,1);assert.equal(textReads,1);
assert.equal(cells[0].numeric_value,200,'cached original remains immutable');
assert.equal(report.display_data.values[30][4],'品牌旧','original text remains immutable');
console.log('Monthly target/API integration: real shared formula recalculation, current text names, scoped adjustment/daily inputs, immutable originals and unknown blanks passed.');
