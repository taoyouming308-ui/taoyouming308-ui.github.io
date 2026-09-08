const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/operations-api/index.ts'), 'utf8');
const names = ['cleanText', 'mergeCoordinates', 'columnLetters', 'formulaPrecedents', 'safeFormulaValue', 'effectiveHistoryMonthlyEntries', 'monthlyItemCategory', 'defaultMonthlyEvidencePolicy', 'latestMonthlyCellRevisionMap', 'effectiveMonthlyDisplay'];
const snippets = names.map(name => {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}).join('\n');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(snippets), sandbox);
const row = (address, amount, formula = null, posted = amount) => ({
  source_sheet: '6月', posted_payload: { amount: posted },
  current_payload: { cell_address: address, amount, formula, cell_kind: formula ? 'formula' : 'input' }
});
const entries = [row('R3', 100000), row('R4', 47259), row('R28', 147259, 'SUM(R3:R27)'), row('S28', 59.9), row('C3', 147199.1, 'R28-S28'), row('C4', 435.9), row('C8', 147635, 'SUM(C3:C4)'), row('Z9', 999, '1+2')];
assert.equal(sandbox.effectiveHistoryMonthlyEntries(entries).find(r => r.current_payload.cell_address === 'Z9').current_payload.amount, 999, 'do not alter untouched source caches');
entries[0].current_payload.amount = 100200;
const result = sandbox.effectiveHistoryMonthlyEntries(entries);
const amount = address => result.find(r => r.current_payload.cell_address === address).current_payload.amount;
assert.equal(amount('R28'), 147459);
assert.equal(amount('C3'), 147399.1);
assert.equal(amount('C8'), 147835);
assert.equal(entries[2].current_payload.amount, 147259, 'read calculation never mutates original input rows');
assert.equal(entries[0].posted_payload.amount, 100000);
assert.equal(amount('Z9'), 999);
const invalid = sandbox.effectiveHistoryMonthlyEntries([row('A1', 3, null, 2), row('B1', 8, "'别月'!A1")]);
assert.equal(invalid[1].current_payload.amount, 8, 'unsupported references retain source value');
console.log('Monthly formula recalculation: nested actual C3=R28-S28 path, immutable originals, unaffected cells and unsupported references passed');
const sourceRows = entries.map((entry, i) => ({ ...entry, id: String(i), current_payload: { ...entry.current_payload, amount: entry.posted_payload.amount } }));
const adjustments = [{ source_id: '4', adjustment_delta: 200, revision: 2 }, { source_id: '4', adjustment_delta: 100, revision: 1 }];
const adjusted = sandbox.effectiveHistoryMonthlyEntries(sourceRows, adjustments);
assert.equal(adjusted[4].current_payload.amount, 147399.1);
assert.equal(adjusted[6].current_payload.amount, 147835);
assert.equal(adjusted[0].current_payload.amount, 100000, 'monthly income editing never edits a constituent');
assert.equal(sourceRows[4].current_payload.amount, 147199.1, 'source report remains unchanged');
const cells = sourceRows.map(row => ({ ...row.current_payload, id: row.id, numeric_value: row.current_payload.amount, precedent_addresses: sandbox.formulaPrecedents(row.current_payload.formula || '', '6月') }));
const effective = sandbox.effectiveMonthlyDisplay({ cells, values: [] }, cells, [], adjustments);
assert.equal(effective.cells[4].numeric_value, 147399.1);
assert.equal(effective.cells[6].numeric_value, 147835);
for (const [label, kind, category, policy] of [
  ['主营 / 美发收入 / Nov.', 'formula', 'income', 'none'],
  ['主营 / 普通美发产品 / Nov.', 'formula', 'income', 'none'],
  ['主营 / 发型师成本 / Nov.', 'formula', 'income', 'none'],
  ['房租 / Nov.', 'input', 'expense', 'voucher_required'],
  ['产品成本 / 产品进货', 'formula', 'expense', 'voucher_required'],
  ['小计 / Nov.', 'formula', 'total', 'none'],
  ['盈亏', 'formula', 'total', 'none'],
  ['人工 / 技术人员', 'formula', 'salary', 'none'],
  ['技术人员 / 测试员工 / 底薪', 'input', 'salary', 'none'],
  ['后勤 / 测试员工 / 小计', 'input', 'salary', 'none'],
  ['技术人员 / 编号', 'input', 'fixed', 'none'],
]) {
  const cell = { label, cell_kind: kind, numeric_value: 100 };
  assert.equal(sandbox.monthlyItemCategory(cell), category, label);
  assert.equal(sandbox.defaultMonthlyEvidencePolicy(cell), policy, label);
}
console.log('Income adjustment added once, source preservation, rollup and real monthly category labels passed');
const apiStart = source.indexOf('async function monthlyIncomeAdjustmentSave(');
const apiEnd = source.indexOf('\n}', apiStart) + 2;
let writes = [], category = '主营 / 美发收入';
Object.assign(sandbox, {
  requireFinanceCapability: session => { if (session.role !== 'finance') throw Error('denied'); },
  selectedStoreInfo: async () => ({ id: 'store-A', company_id: 'company-A' }),
  cellTrace: async () => ({ historical: true, target: { id: 'income-A', label: category }, report: { id: 'report-A', report_date: '2026-06-01' } }),
  monthlyAdjustmentContext: async () => ({ cells: [{ id: 'income-A', numeric_value: 120 }], versions: { 'income-A': 1 }, adjustments: [{ id: 'adjust-1', source_id: 'income-A', revision: 1, adjustment_delta: 20 }] }),
  financeRpcSaved: async (rpc, payload) => { writes.push({ rpc, payload }); return payload; },
});
vm.runInContext(stripTypeScriptTypes(source.slice(apiStart, apiEnd)), sandbox);
(async () => {
  const payload = { after_amount: '130', expected_before: 120, expected_revision: 1, reason: '核对调整', base_amount: -9999 };
  await assert.rejects(sandbox.monthlyIncomeAdjustmentSave(payload, { role: 'shareholder' }), /denied/);
  await assert.rejects(sandbox.monthlyIncomeAdjustmentSave({ ...payload, expected_before: 100 }, { role: 'finance' }), /修改/);
  category = '房租';
  await assert.rejects(sandbox.monthlyIncomeAdjustmentSave(payload, { role: 'finance' }), /收入/);
  assert.equal(writes.length, 0);
  category = '主营 / 美发收入';
  await sandbox.monthlyIncomeAdjustmentSave(payload, { role: 'finance', auth_account_id: 'actor-A' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.p_base_amount, 100, 'never trust client baseline');
  assert.equal(writes[0].payload.p_store_id, 'store-A');
  assert.equal(writes[0].rpc, 'rpc/zysyr_save_monthly_income_adjustment', 'never calls source amount mutation RPC');
  console.log('Income API: finance-only, stale preview denial, income-only, server-derived baseline and scoped adjustment RPC passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
