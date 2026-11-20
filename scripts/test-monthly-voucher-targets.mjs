// Synthetic metadata only. No private objects, production connections or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readMonthlyVoucherTargets } from '../supabase/functions/_shared/monthly-voucher-targets.mjs';
const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = api.indexOf('function monthlyItemCategory('), end = api.indexOf('\n}', start) + 2;
const context = { cleanText: (v, n) => String(v ?? '').trim().slice(0, n) };
vm.createContext(context); vm.runInContext(stripTypeScriptTypes(api.slice(start, end)), context);
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const values = Array.from({ length: 73 }, () => Array(12).fill(''));
  values[8].splice(0, 3, '支出', '支出类别', 'Nov.');
  const labels = { 10: '房租', 11: '水费', 12: '电费', 13: '技术人员', 14: '产品进货', 15: '备用金', 16: '尚未填写', 17: '明确零', 18: '未登记栏目', 19: '小计', 20: '美发收入', 21: '人工确认零' };
  for (const [row, label] of Object.entries(labels)) values[Number(row) - 1][1] = label;
  values[51].splice(0, 3, '', '合计', '9876.54');
  values[24][5] = '品牌甲'; values[25][5] = '小计';
  const store = { company_id: id(1), id: id(2) };
  const report = { id: id(3), company_id: store.company_id, store_id: store.id, report_type: 'monthly_profit_loss', report_date: '2026-07-01', status: 'active', sha256: 'a'.repeat(64), version: 2,
    display_data: { values, merges: [{ start_row: 9, end_row: 12, start_col: 0, end_col: 0 }] } };
  const cell = (n, row, column, label, numeric_value, display_value = String(numeric_value), cell_kind = 'input') => ({ id: id(n), company_id: id(1), store_id: id(2), report_id: id(3), row_number: row, column_number: column,
    cell_address: String.fromCharCode(64 + column) + row, label, numeric_value, display_value, cell_kind });
  const cells = [cell(10, 10, 3, '房租 / 房租 / Nov.', '1200.2500'), cell(11, 11, 3, '房租 / 水费 / Nov.', '30.1000'), cell(12, 12, 3, '房租 / 电费 / Nov.', '75.2000'),
    cell(13, 13, 3, '技术人员 / 工资 / Nov.', 8000), cell(14, 14, 3, '产品成本 / 产品进货', 1000), cell(15, 15, 3, '其它 / 备用金', 50),
    cell(16, 16, 3, '杂项 / 尚未填写', 0, ''), cell(17, 17, 3, '杂项 / 明确零', 0, '0'), cell(19, 19, 3, '小计 / 合计', 99),
    cell(20, 20, 3, '主营 / 美发收入', 100), cell(21, 21, 3, '杂项 / 人工确认零', 0, ''), cell(52, 52, 3, '合计', 9876.54),
    cell(25, 25, 10, '产品进货 / 品牌甲 / 合计', 100), cell(26, 26, 10, '产品进货 / 小计 / 合计', 100),
    cell(27, 27, 10, '技术人员 / 工资', 100), cell(28, 28, 10, '备用金 / 纸巾 / 合计', 0, ''), cell(29, 29, 10, '主营 / 产品收入', 100)];
  const revisions = [{ id: id(100), source_cell_id: id(10), revision: 1, revision_type: 'amount_change', after_amount: 1100.25 },
    { id: id(101), source_cell_id: id(10), revision: 2, revision_type: 'evidence_update', after_amount: 1100.25 },
    { id: id(102), source_cell_id: id(16), revision: 1, revision_type: 'evidence_update', after_amount: 0 },
    { id: id(103), source_cell_id: id(21), revision: 1, revision_type: 'amount_change', after_amount: 0 }];
  const links = [{ revision_id: id(100), voucher_id: id(200) }, { revision_id: id(101), voucher_id: id(200) }, { revision_id: id(101), voucher_id: id(201) }, { revision_id: id(101), voucher_id: id(201) }];
  const calls = []; let reportReads = 0;
  const deps = { category: context.monthlyItemCategory,
    rows: async query => { calls.push(query); reportReads++; assert(query.includes('company_id=eq.' + id(1)) && query.includes('store_id=eq.' + id(2))); assert(query.includes('order=version.desc&limit=1')); assert(!query.includes('status=eq.active')); return structuredClone([report]); },
    all: async query => { calls.push(query); assert(query.includes('company_id=eq.' + id(1)) && query.includes('store_id=eq.' + id(2))); if (query.startsWith('zysyr_report_cells?')) return structuredClone(cells);
      if (query.startsWith('zysyr_monthly_cell_revisions?')) return structuredClone(revisions);
      if (query.startsWith('zysyr_monthly_cell_revision_vouchers?')) return structuredClone(links.filter(link => query.includes(link.revision_id)));
      throw Error('Unexpected read'); } };
  return { store, report, cells, revisions, links, calls, deps, read: () => readMonthlyVoucherTargets(store, '2026-07', deps), reportReads: () => reportReads };
}

let f = fixture(), result = await f.read();
assert.equal(result.status, 'ready'); assert.equal(result.period_month, '2026-07', 'Nov. template header is not accounting month');
assert.equal(result.layout_identified, true); assert.equal(result.id, id(3)); assert.equal(f.reportReads(), 2);
const at = a => result.targets.find(target => target.cell_address === a);
for (const a of ['C10', 'C11', 'C12', 'C13', 'C14', 'C15']) {
  assert.equal(at(a).can_attach, true); assert.equal(at(a).manual_only, true); assert.equal(at(a).aggregate, true); assert.equal(at(a).left_section, true);
  assert.equal(at(a).id, id(3) + '~' + at(a).cell_id);
}
assert.equal(at('C10').amount, 1100.25); assert.equal(at('C10').revision, 2); assert.deepEqual(at('C10').linked_vouchers, [id(200), id(201)]);
assert.equal(result.cells.find(cell => cell.id === id(10)).amount, 1100.25, 'old electronic projection shape retained');
assert.equal(at('C16').amount, null, 'evidence-only zero cannot make a blank slot known'); assert.equal(at('C16').disabled, true);
assert.equal(at('C17').amount, 0); assert.equal(at('C17').disabled, false);
assert.equal(at('C21').amount, 0); assert.equal(at('C21').can_attach, true, 'explicit amount revision can establish zero');
assert.equal(at('C18').cell_id, null); assert.equal(at('C18').can_attach, false); assert.match(at('C18').disabled_reason, /尚未登记/);
assert(result.targets.some(target => target.cell_address === 'J25'));
for (const a of ['C19', 'C20', 'C52', 'J26', 'J27', 'J28', 'J29']) assert(!at(a), 'exclude non-expense/summary/unknown right cell ' + a);
assert.equal(result.evidence.length, 2, 'historical copied links do not multiply active evidence');
assert(f.calls.every(query => !/rpc|storage|upload|insert|update|delete/i.test(query.replace('zysyr_report_uploads', 'reports'))), 'projection uses table reads only');

f = fixture(); f.report.status = 'superseded'; result = await f.read(); assert.equal(result.status, 'unavailable'); assert.equal(f.reportReads(), 1); assert.equal(result.targets.length, 0);
f = fixture(); f.deps.rows = async () => []; assert.equal((await f.read()).status, 'missing');
f = fixture(); f.report.display_data.values[8][0] = '不明区'; result = await f.read(); assert.equal(result.status, 'partial'); assert(result.targets.every(target => !target.left_section));
f = fixture(); f.report.display_data.values[8][1] = ' 支出类别 '; assert.equal((await f.read()).status, 'ready');
f = fixture(); f.report.display_data.values[60][1] = '合计'; assert.equal((await f.read()).status, 'ready', 'a later unrelated total cannot erase the identified first expense section');
for (const patch of [{ store_id: id(9) }, { company_id: id(9) }, { report_date: '2026-08-01' }, { report_type: 'salary' }, { sha256: 'unknown' }]) {
  f = fixture(); Object.assign(f.report, patch); assert.equal((await f.read()).status, 'unavailable');
}
f = fixture(); const rows = f.deps.rows; f.deps.rows = async query => { const value = await rows(query); if (f.reportReads() > 1) value[0].id = id(99); return value; };
assert.equal((await f.read()).status, 'unavailable', 'concurrent report replacement fails closed');
f = fixture(); f.cells.push({ ...f.cells[0], id: id(99) }); assert.equal((await f.read()).status, 'unavailable', 'ambiguous address is not guessed');
f = fixture(); f.cells[0].store_id = id(9); assert.equal((await f.read()).status, 'unavailable');
f = fixture(); f.revisions.push({ ...f.revisions[0], id: id(999) }); assert.equal((await f.read()).status, 'unavailable');
f = fixture(); f.revisions[0].revision_type='unknown'; assert.equal((await f.read()).status, 'unavailable');
f = fixture(); f.deps.all = async () => { throw Error('synthetic read failure'); }; result = await f.read(); assert.equal(result.status, 'unavailable'); assert.equal(result.targets.length, 0);
for (const value of [null, '', false, 'NaN', 'Infinity', '1,000', 'invalid']) {
  f = fixture(); f.cells[1].numeric_value = value; result = await f.read(); assert.equal(result.targets.find(target => target.cell_address === 'C11').can_attach, false);
}
for (const value of ['2026-00', '2026-13', 'July', '2026-7']) await assert.rejects(readMonthlyVoucherTargets({ id: id(2), company_id: id(1) }, value, fixture().deps), /无效/);
await assert.rejects(readMonthlyVoucherTargets({ id: 'other', company_id: id(1) }, '2026-07', fixture().deps), /无效/);

// The production callback owns formulas, daily/adjustment layers and text
// revisions. This module consumes that display instead of recalculating it.
f = fixture();
f.cells[0].numeric_value = 200; f.cells[0].display_value = '200'; f.cells[0].cell_kind = 'formula';
f.cells[0].sheet_name = '7月'; f.cells[0].formula = 'SUM(C11:C12)'; f.cells[0].precedent_addresses = ['C11', 'C12'];
f.revisions.splice(0, 2); // C10 changes only because a precedent changed.
let projectionCalls = 0;
f.deps.project = async (report, rawCells, revisions) => {
  projectionCalls++;
  assert.equal(report.id, id(3)); assert(rawCells.some(cell => cell.formula === 'SUM(C11:C12)'));
  assert.deepEqual(rawCells[0].precedent_addresses, ['C11', 'C12']); assert.equal(rawCells[0].sheet_name, '7月');
  assert.equal(revisions.some(revision => revision.source_cell_id === id(10)), false);
  const values = structuredClone(report.display_data.values);
  values[8][0] = '开支'; values[8][1] = '开支类别';
  values[9][1] = '当前房租栏目'; values[9][2] = 300;
  values[24][5] = '当前品牌';
  const cells = rawCells.map(cell => ({ ...cell,
    ...(cell.cell_address === 'C10' ? { numeric_value: 300, display_value: '300', label: '房租 / 当前房租栏目' } : {}),
    ...(cell.cell_address === 'J25' ? { numeric_value: 150, label: '产品进货 / 当前品牌 / 合计' } : {}),
    ...(cell.cell_address === 'C16' ? { numeric_value: 0, display_value: '0' } : {}) }));
  return { values, cells };
};
result = await f.read(); assert.equal(result.status, 'ready'); assert.equal(projectionCalls, 1);
const formulaTarget = result.targets.find(target => target.cell_address === 'C10');
assert.equal(formulaTarget.amount, 300, 'effective formula result, not stale original 200');
assert.equal(formulaTarget.summary, '当前房租栏目', 'left label follows effective text grid');
assert.equal(result.cells.find(cell => cell.cell_address === 'C10').numeric_value, 300);
assert.equal(result.targets.find(target => target.cell_address === 'J25').summary, '产品进货 / 当前品牌 / 合计');
assert.equal(result.targets.find(target => target.cell_address === 'J25').amount, 150);
assert.equal(result.targets.find(target => target.cell_address === 'C16').amount, null, 'projection zero cannot turn an old unknown blank into a filled amount');
assert.equal(result.targets.find(target => target.cell_address === 'C16').disabled, true);
assert.equal(f.cells[0].numeric_value, 200, 'projection receives isolated input values');
assert(f.calls.some(query => query.startsWith('zysyr_report_cells?') && query.includes('sheet_name') && query.includes('formula,precedent_addresses')));
assert(!f.calls.some(query => /rpc|insert|update|delete/i.test(query.replace('zysyr_report_uploads', 'reports'))));

for (const invalid of ['missing', 'duplicate', 'foreign', 'partial', 'bad_grid']) {
  f = fixture();
  f.deps.project = async (report, rawCells) => {
    const cells = structuredClone(rawCells), values = structuredClone(report.display_data.values);
    if (invalid === 'missing') return {};
    if (invalid === 'duplicate') cells.push({ ...cells[0] });
    if (invalid === 'foreign') cells[0].report_id = id(99);
    if (invalid === 'partial') cells.pop();
    return { values: invalid === 'bad_grid' ? ['invalid'] : values, cells };
  };
  const failed = await f.read(); assert.equal(failed.status, 'unavailable'); assert.equal(failed.targets.length, 0, 'never fall back to stale amount after projection failure: ' + invalid);
}
f = fixture(); f.deps.project = async () => { throw Error('synthetic projection failure'); };
assert.equal((await f.read()).status, 'unavailable');
console.log('Monthly electronic targets: actual grid/merge-object format, current report scope/race, left salary/summary support, right expense details, blank vs zero, revisions, active evidence dedup and read failure isolation passed.');
console.log('Effective monthly projection: formula 200→300, current right/left names, actual formula inputs, blank-zero boundary, scope/shape validation and projection failure isolation passed.');
