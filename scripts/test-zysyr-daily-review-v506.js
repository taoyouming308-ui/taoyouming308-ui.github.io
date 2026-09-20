#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
assert.match(api, /const delta = dailyIncome \? 0 : adjustmentMap\.get/);
assert.match(api, /const adjustment = dailyIncome \? 0 : adjustmentMap\.get/);
assert.match(api, /status=eq\.confirmed&source_voucher_id=not\.is\.null/);
assert.match(api, /validation\.valid === true \? dailySheetTotal\(validation\.grand_total\) : null/);
assert.match(api, /美发收入已由已确认日报自动累计，不能在月报重复入账/);

function element() {
  const classes = new Set();
  return {
    value: '', textContent: '', checked: false, disabled: false, dataset: {}, listeners: {},
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      toggle: (name, force) => { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
    },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    removeEventListener(name) { delete this.listeners[name]; },
  };
}

const ids = Object.fromEntries([
  'daily-detail-grid', 'daily-detail-reviewed', 'daily-detail-candidates', 'daily-detail-note',
  'daily-detail-confirm-help', 'daily-detail-confirm', 'daily-detail-adopt',
  'daily-detail-save', 'daily-detail-save-top',
].map(id => [id, element()]));
const candidate = element();
candidate.value = '120';
candidate.dataset.dailyCell = 'candidate-1';
candidate.classList.add('recognition-candidate');
const nameCandidate = element();
nameCandidate.value = '测试发型师';
nameCandidate.dataset.rowLabelInput = 'stylist-1';
nameCandidate.classList.add('recognition-candidate');
ids['daily-detail-grid'].querySelectorAll = () => [candidate, nameCandidate];
const calendarTotal = element();
const monthlyInput = element();
const context = {
  document: {
    getElementById: id => ids[id],
    querySelector: selector => selector.startsWith('#daily-report-calendar') ? calendarTotal : monthlyInput,
  },
  window: { confirm: () => true },
  state: {
    imports: { sheet: { draft: { id: 'draft-1', report_date: '2026-01-01', status: 'draft', edit_revision: 4, validation_result: { valid: false, missing_controls: ['现金流'] } }, permissions: { write: true } }, dirty: {}, dirtyLabels: {} },
    dailyReportMonth: { month: '2026-01' }, user: { role: 'finance' },
  },
  renderDailyDetailControls() {},
  renderDailySheetDetail() {},
  async saveDailyReportDetail() {
    context.state.imports.sheet.draft.edit_revision += 1;
    context.state.imports.dirty = {};
    context.state.imports.dirtyLabels = {};
    return true;
  },
  renderDailyReportCalendar() {},
  renderSheet() {},
  dailySheetDirtyCount: () => Object.keys(context.state.imports.dirty).length + Object.keys(context.state.imports.dirtyLabels).length,
  currentStore: () => '向里造型',
  isLocalPreview: () => false,
  api: async () => ({ month: '2026-01', days: [] }),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('operations-daily-review.js', 'utf8'), context);

(async () => {
  context.renderDailyDetailControls();
  assert.match(ids['daily-detail-candidates'].textContent, /2 格仅是机器候选/);
  assert.match(ids['daily-detail-confirm-help'].textContent, /机器候选数字／姓名未采纳/);
  ids['daily-detail-reviewed'].checked = true;
  context.renderDailyDetailControls();
  await ids['daily-detail-adopt'].listeners.click();
  assert.match(ids['daily-detail-note'].textContent, /保存成功 · 修订 v5/);
  assert.equal(candidate.classList.contains('manual-edit'), true);
  assert.equal(nameCandidate.classList.contains('manual-edit'), true);
  context.renderDailyReportCalendar({ days: [{ status: 'draft', report_date: '2026-01-01', grand_total: 120 }] });
  assert.match(calendarTotal.textContent, /待确认参考金额/);
  context.renderSheet({ cells: [{ cell_address: 'C3', daily_rollup: { confirmed_days: 1 } }] });
  assert.equal(monthlyInput.readOnly, true);
  console.log('ZYSYR_DAILY_REVIEW_V506_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
