const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const extract = name => {
  const asyncStart = api.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : api.indexOf(`function ${name}(`);
  const end = api.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, `${name} must exist`);
  return api.slice(start, end);
};
const fieldsStart = api.indexOf('const MONTHLY_DAILY_PERFORMANCE_FIELDS = [');
const fieldsEnd = api.indexOf('] as const;', fieldsStart) + '] as const;'.length;
assert(fieldsStart >= 0 && fieldsEnd > fieldsStart, 'daily projection field mapping must exist');

const draftId = '00000000-0000-4000-8000-000000000001';
const drafts = [{ id: draftId, report_date: '2026-01-02', edit_revision: 4, status: 'confirmed', confirmed_at: '2026-01-02T12:00:00Z' }];
const columns = [
  ['summary', 'grand_total', 'other', 250, false],
  ['payment', 'cash_flow', 'payment_cashflow', 225, true],
  ['payment', 'card_consumption', 'other', 300, false],
  ['payment', 'group_buy', 'other', 40, false],
  ['payment', 'alipay', 'other', 60, false],
  ['payment', 'wechat', 'other', 70, false],
  ['payment', 'douyin', 'other', 80, false],
];
const cells = columns.map(([section_code, column_code, cell_role, amount, manual_override], index) => ({
  id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
  draft_id: draftId, section_code, column_code,
  row_key: column_code === 'cash_flow' ? 'payment' : 'other', cell_role,
  ocr_numeric: amount, corrected_numeric: 200, manual_override,
}));
const calls = [];
const sandbox = {
  restRowsAll: async path => {
    calls.push(path);
    return path.startsWith('zysyr_daily_sheet_drafts?') ? drafts : cells;
  },
};
vm.createContext(sandbox);
const helperSource = api.slice(api.indexOf('type ConfirmedDailySource ='), api.indexOf('async function historicalMonthlyReport('));
const functions = ['cleanText', 'uuidIn', 'effectiveCellValue', 'confirmedDailySource', 'confirmedDailyRollupFromSource',
  'confirmedDailyRollup', 'MONTHLY_DAILY_PERFORMANCE_FIELDS', 'confirmedDailyPerformanceFromSource', 'confirmedDailyPerformance']
  .map(name => name === 'MONTHLY_DAILY_PERFORMANCE_FIELDS'
    ? api.slice(fieldsStart, fieldsEnd)
    : extract(name));
vm.runInContext(stripTypeScriptTypes(`${helperSource}\n${functions.join('\n')}`), sandbox);

(async () => {
  const source = await sandbox.confirmedDailySource('company', 'store', '2026-01');
  assert.equal(calls.length, 2, 'one overview source load should query drafts once and cells once');
  assert.ok(calls[0].includes('store_id=eq.store') && calls[0].includes('confirmed_at'));
  assert.ok(calls[1].includes('store_id=eq.store') && calls[1].includes('row_key,cell_role'));
  const performance = sandbox.confirmedDailyPerformanceFromSource(source, '2026-01');
  const rollup = sandbox.confirmedDailyRollupFromSource(source);
  assert.equal(performance.totals.labor_performance, 250);
  assert.equal(performance.totals.cash_performance, 200, 'manual cash correction must flow into the daily performance table');
  assert.equal(performance.totals.card_amount, 300);
  assert.equal(rollup.amount, 200, 'cash rollup must continue to use only the corrected cash-flow cell');
  assert.equal(rollup.days[0].cell_id, cells[1].id);

  const overview = api.slice(api.indexOf('async function overview('), api.indexOf('async function reportAcknowledge('));
  assert.match(overview, /confirmedDailySource\(companyId, storeId, month\)/);
  assert.match(overview, /confirmedDailyPerformanceFromSource\(dailySource, month\)/);
  assert.match(overview, /confirmedDailyRollupFromSource\(dailySource\)/);
  assert.doesNotMatch(overview, /confirmedDailyPerformance\(companyId, storeId, month\)/);
  assert.doesNotMatch(overview, /await confirmedDailyRollup\(companyId, storeId, month\)/);

  const missingCash = { ...source, cells: source.cells.filter(cell => cell.cell_role !== 'payment_cashflow') };
  assert.throws(() => sandbox.confirmedDailyRollupFromSource(missingCash), /缺少唯一有效现金业绩/);
  assert.equal(sandbox.confirmedDailyPerformanceFromSource(missingCash, '2026-01').totals.labor_performance, 250,
    'cash rollup guard must not alter the separate daily performance projection');
  console.log('ZYSYR v546 monthly overview daily source dedupe: one scoped read per table, unchanged performance mapping, strict corrected-cash guard passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
