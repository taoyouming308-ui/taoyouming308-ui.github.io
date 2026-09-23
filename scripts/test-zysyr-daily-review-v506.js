#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const pageSource = fs.readFileSync('operations.html', 'utf8');
assert.match(api, /monthlyAdjustmentForSource\(row\.id, adjustments, dailyIncome \? daily : null\)\.applied_delta/);
assert.match(api, /monthlyAdjustmentForSource\(cell\.id, adjustments, daily\)\.applied_delta/);
assert.match(api, /status=eq\.confirmed&source_voucher_id=not\.is\.null/);
assert.match(api, /validation\.valid === true \? dailySheetTotal\(validation\.grand_total\) : null/);
assert.match(api, /source:"confirmed_daily_cash_flow"/);
assert.match(pageSource, /dailyPaperCells\(stylistTotal,serviceCodes,'stylist',Object\.fromEntries\(serviceCodes\.map\(function\(code\)\{return\[code,'category_total'\]\}\)\)/);
assert.match(pageSource, /dailyPaperCells\(techTotal,techCodes,'technician',Object\.fromEntries\(techCodes\.map\(function\(code\)\{return\[code,'technician_category_total'\]\}\)\)/);

const capturedRoles = [];
const controlsFixture = {
  dailyPaperInput(_cell, meta) { capturedRoles.push(meta); return ''; },
  dailyInputValue(input) { return !input || input.value === '' ? null : Number(input.value); },
};
vm.createContext(controlsFixture);
for (const name of ['dailyPaperCells', 'calculateDailyControls']) {
  const functionLine = name === 'dailyPaperCells'
    ? pageSource.match(/^function dailyPaperCells\([^\n]+/m)
    : pageSource.match(/^function calculateDailyControls\([\s\S]*?^\}/m);
  assert(functionLine, `${name} must exist`);
  vm.runInContext(functionLine[0], controlsFixture);
}
controlsFixture.dailyPaperCells({ key: 'stylist_category_total', label: '小计', order: 12, cells: { wash_cut_blow: { cell_role: 'category_total' } } },
  ['wash_cut_blow'], 'stylist', { wash_cut_blow: 'staff_value' }, ['洗剪吹'], 2);
assert.equal(capturedRoles[0].role, 'category_total', 'saved category subtotal must retain its database role');
const amount = (role, value, rowKey, columnCode, section = 'stylist') => ({ dataset: { role, rowKey, columnCode, section }, value: String(value) });
const inputs = [
  amount('staff_value', 2126, 'stylist_1', 'wash_cut_blow'),
  amount('staff_total', 2126, 'stylist_1', 'subtotal'),
  amount('category_total', 2126, 'stylist_category_total', 'wash_cut_blow'),
  amount('summary_value', 2126, 'stylist_category_total', 'subtotal'),
  amount('summary_actual', 2126, 'summary', 'actual_total'),
  amount('summary_grand', 2126, 'summary', 'grand_total'),
  amount('payment_method', 2126, 'payment', 'alipay'),
  amount('payment_cashflow', 2126, 'payment', 'cash_flow'),
  amount('payment_total', 2126, 'payment', 'total'),
];
const controls = controlsFixture.calculateDailyControls({ querySelectorAll: () => inputs });
assert.equal(controls.staffAtomic, 2126, 'stylist subtotal must not double the staff detail');
assert.equal(controls.categoryReported, 2126, 'category subtotal must not disappear');
assert.equal(controls.valid, true, 'matching 2126 totals must pass the visible control check');
inputs[3].value = '126';
const badControls = controlsFixture.calculateDailyControls({ querySelectorAll: () => inputs });
assert.equal(badControls.valid, false, 'an incorrect stylist grand subtotal must block posting');
assert.equal(badControls.stylistSubtotalMismatch, true);

// Save, adoption and posting are covered by the real browser workflow regression.
assert.match(fs.readFileSync('operations-daily-review.js', 'utf8'), /daily-rollup-readonly/);
console.log('ZYSYR_DAILY_REVIEW_V506_OK');
